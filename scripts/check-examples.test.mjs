// Unit + regression tests for the examples DoD gate (issue #283). Per ADR-0009's pattern, these
// import scripts/examples-gate.mjs's logic directly (for 100% coverage) plus one subprocess test
// for the CLI shell (scripts/check-examples.mjs), pointed at isolated temp fixtures via --dir/
// --manifest rather than the real spec/examples/ corpus.

import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import {
  IMPLEMENTED_PROFILES,
  MANIFEST_PATH,
  classifyExample,
  isRunnable,
  loadManifest,
  parseArgs,
  runExamplesGate,
} from "./examples-gate.mjs";

// Each test gets its own fresh, uniquely-named OS temp directory — never a shared or repo-tracked
// fixture path (same convention scripts/conformance.test.mjs uses, issue #140).
let TEMP_DIR;

beforeEach(() => {
  TEMP_DIR = mkdtempSync(join(tmpdir(), "ol-examples-gate-"));
});

afterEach(() => {
  rmSync(TEMP_DIR, { recursive: true, force: true });
});

function writeExample(name, source) {
  writeFileSync(join(TEMP_DIR, name), source, "utf8");
}

function writeManifestFile(manifest) {
  const manifestPath = join(TEMP_DIR, "profiles.json");
  writeFileSync(manifestPath, JSON.stringify(manifest), "utf8");
  return manifestPath;
}

// --- Unit tests ---------------------------------------------------------------------------

test("isRunnable is true when every required profile is implemented", () => {
  assert.equal(isRunnable(["core-language"], ["core-language"]), true);
  assert.equal(
    isRunnable(
      ["core-language", "turtle-rendering"],
      ["core-language", "turtle-rendering"],
    ),
    true,
  );
});

test("isRunnable is false when any required profile is missing", () => {
  assert.equal(isRunnable(["core-language", "data"], ["core-language"]), false);
});

test("isRunnable is vacuously true for an empty requirement list", () => {
  assert.equal(isRunnable([], ["core-language"]), true);
});

test("classifyExample passes a clean, error-free program", () => {
  const result = classifyExample("forward 10\nright 90\n", "clean.logo");
  assert.deepEqual(result, { status: "pass" });
});

test("classifyExample fails a program with an error-severity diagnostic", () => {
  const result = classifyExample("print :undefined_name\n", "broken.logo");
  assert.equal(result.status, "fail");
  assert.match(result.reason, /ol-undefined-var/);
});

test("classifyExample reports a thrown exception as a failure rather than propagating it", () => {
  // execute() throws a plain TypeError for a non-string source rather than returning
  // diagnostics — this exercises classifyExample's defensive catch branch.
  const result = classifyExample(undefined, "throws.logo");
  assert.equal(result.status, "fail");
  assert.match(result.reason, /^threw: /);
});

test("loadManifest parses the real repo manifest and covers every real example", () => {
  const manifest = loadManifest(MANIFEST_PATH);
  assert.equal(manifest["05-procedures.logo"].includes("heritage"), true);
  assert.equal(
    manifest["01-movement.logo"].every((p) => IMPLEMENTED_PROFILES.includes(p)),
    true,
  );
});

test("parseArgs reads --dir and --manifest overrides", () => {
  assert.deepEqual(
    parseArgs(["--dir=tmp/examples", "--manifest=tmp/profiles.json"]),
    { dir: "tmp/examples", manifestPath: "tmp/profiles.json" },
  );
});

test("parseArgs returns undefined overrides when no flags are given", () => {
  assert.deepEqual(parseArgs([]), { dir: undefined, manifestPath: undefined });
});

// --- runExamplesGate regression tests -----------------------------------------------------

test("runExamplesGate: a known-good Core example passes", () => {
  writeExample("good.logo", "clear_screen\nforward 50\nright 90\n");
  const manifest = { "good.logo": ["core-language", "turtle-rendering"] };

  const result = runExamplesGate({
    dir: TEMP_DIR,
    manifest,
    implementedProfiles: ["core-language", "turtle-rendering"],
  });

  assert.equal(result.ok, true);
  assert.equal(result.ran, 1);
  assert.equal(result.skipped, 0);
  assert.equal(result.failed, 0);
  assert.ok(result.lines.some((line) => line === "PASS good.logo"));
});

test("runExamplesGate: FAILS the gate on a deliberately-broken example and SKIPS a Heritage one", () => {
  writeExample("good.logo", "forward 50\n");
  writeExample("broken.logo", "print :missing\n");
  // Mirrors 05-procedures.logo's real Heritage `to … end` form, which the parser does not yet
  // implement (`to`/`output`/`op` are reserved words with no AST node).
  writeExample("heritage.logo", "to draw_tick :size\nforward :size\nend\n");

  const manifest = {
    "good.logo": ["core-language", "turtle-rendering"],
    "broken.logo": ["core-language", "turtle-rendering"],
    "heritage.logo": ["core-language", "turtle-rendering", "heritage"],
  };

  const result = runExamplesGate({
    dir: TEMP_DIR,
    manifest,
    implementedProfiles: ["core-language", "turtle-rendering"],
  });

  assert.equal(result.ok, false, "the gate must fail overall");
  assert.equal(result.ran, 2, "good.logo and broken.logo both actually ran");
  assert.equal(result.skipped, 1, "heritage.logo must be skipped, not run");
  assert.equal(result.failed, 1, "only broken.logo counts as a failure");
  assert.ok(result.lines.some((line) => line === "PASS good.logo"));
  assert.ok(result.lines.some((line) => line.startsWith("FAIL broken.logo:")));
  assert.ok(
    result.lines.some((line) =>
      line.startsWith("SKIP heritage.logo (requires heritage"),
    ),
    "a skipped example must print a visible notice naming the missing profile — " +
      "this is what keeps the gate from silently degrading back to a presence-only check",
  );
});

test("runExamplesGate: an example missing from the manifest fails loudly, not silently", () => {
  writeExample("undeclared.logo", "forward 10\n");

  const result = runExamplesGate({
    dir: TEMP_DIR,
    manifest: {},
    implementedProfiles: ["core-language", "turtle-rendering"],
  });

  assert.equal(result.ok, false);
  assert.equal(result.failed, 1);
  assert.ok(
    result.lines.some((line) =>
      line.startsWith("FAIL undeclared.logo: no entry in the profile manifest"),
    ),
  );
});

test("runExamplesGate: a manifest requiring several missing profiles lists all of them", () => {
  writeExample("needs-many.logo", "ask :leader [ forward 10 ]\n");
  const result = runExamplesGate({
    dir: TEMP_DIR,
    manifest: { "needs-many.logo": ["core-language", "sprites", "sound"] },
    implementedProfiles: ["core-language"],
  });

  assert.equal(result.skipped, 1);
  assert.ok(
    result.lines.some((line) =>
      line.startsWith("SKIP needs-many.logo (requires sprites, sound"),
    ),
  );
});

test("runExamplesGate: loads the manifest from disk when none is passed in", () => {
  writeExample("good.logo", "forward 10\n");
  const manifestPath = writeManifestFile({
    "good.logo": ["core-language", "turtle-rendering"],
  });

  const result = runExamplesGate({
    dir: TEMP_DIR,
    manifestPath,
    implementedProfiles: ["core-language", "turtle-rendering"],
  });

  assert.equal(result.ok, true);
  assert.equal(result.ran, 1);
});

test("runExamplesGate: reports a missing examples directory instead of crashing", () => {
  const result = runExamplesGate({ dir: join(TEMP_DIR, "does-not-exist") });
  assert.equal(result.ok, false);
  assert.equal(result.ran, 0);
  assert.ok(result.lines.some((line) => line.includes("does not exist")));
});

test("runExamplesGate: reports an empty examples directory instead of crashing", () => {
  const result = runExamplesGate({ dir: TEMP_DIR, manifest: {} });
  assert.equal(result.ok, false);
  assert.ok(result.lines.some((line) => line.includes("no .logo files found")));
});

test("runExamplesGate defaults exercise the real spec/examples/ corpus and manifest", () => {
  // No overrides: covers the EXAMPLES_DIR/MANIFEST_PATH default parameters directly, and doubles
  // as a sanity check that the shipped manifest still accounts for every real example (an
  // unlisted example would otherwise fail with a misleading "no entry in the profile manifest").
  const result = runExamplesGate();
  const missingManifestEntry = result.lines.some((line) =>
    line.includes("no entry in the profile manifest"),
  );
  assert.equal(
    missingManifestEntry,
    false,
    "every spec/examples/*.logo file must have a scripts/examples-profiles.json entry",
  );
  assert.equal(result.ran + result.skipped, 13);
});

test("runExamplesGate skips every example that needs a not-yet-implemented profile in the real corpus", () => {
  const result = runExamplesGate();
  assert.ok(
    result.lines.some((line) =>
      line.startsWith("SKIP 05-procedures.logo (requires heritage"),
    ),
  );
});

// --- CLI subprocess test (out of the loaded-module coverage set, per ADR-0009) -------------

test("the check-examples.mjs CLI prints PASS/FAIL/SKIP lines and exits non-zero on failure", () => {
  writeExample("good.logo", "forward 10\n");
  writeExample("broken.logo", "print :missing\n");
  const manifestPath = writeManifestFile({
    "good.logo": ["core-language"],
    "broken.logo": ["core-language"],
  });

  const child = spawnSync(
    process.execPath,
    [
      "scripts/check-examples.mjs",
      `--dir=${TEMP_DIR}`,
      `--manifest=${manifestPath}`,
    ],
    { encoding: "utf8" },
  );

  assert.equal(child.status, 1);
  assert.match(child.stdout, /PASS good\.logo/);
  assert.match(child.stdout, /FAIL broken\.logo/);
});

test("the check-examples.mjs CLI exits 0 when every example passes or is skipped", () => {
  writeExample("good.logo", "forward 10\n");
  const manifestPath = writeManifestFile({
    "good.logo": ["core-language"],
  });

  const cliPath = "scripts/check-examples.mjs";
  const child = spawnSync(
    process.execPath,
    [cliPath, `--dir=${TEMP_DIR}`, `--manifest=${manifestPath}`],
    { encoding: "utf8" },
  );

  assert.equal(child.status, 0);
  assert.match(child.stdout, /PASS good\.logo/);
});
