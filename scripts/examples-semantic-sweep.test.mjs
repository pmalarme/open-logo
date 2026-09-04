// The no-false-positive sweep for saga #811 (issue #816 item 7).
//
// Saga #811's defect is that a statement containing an unresolvable name runs silently. The `[spec]`
// ruling that chooses the fix (#814) has since merged, and it routes part of the answer through the
// checker: `spec/tooling.md:193` makes a built-in Command in value position MUST-reportable there as
// `ol-no-output`. Any solution that surfaces checker output to a learner is only an improvement if
// the checker is quiet on programs that are correct — a checker that reports a name as unknown
// because the profile owning it was not in the active set would turn every learner's turtle program
// red. That exact false positive is the documented reason `packages/studio/src/diagnostics.ts` still
// defaults `semanticCheck` to `false`. This sweep is therefore the gate that stops the fix from
// being worse than the bug; it is deliberately agnostic about which stage ends up reporting what,
// and stays valuable however #815 divides the work, since the studio would still surface checker
// output.
//
// It sweeps every `spec/examples/*.logo` file under TWO profile sets, because a false positive can
// come from either side:
//   - the example's own declared minimal set (`scripts/examples-profiles.json`), and
//   - `@openlogo/core`'s `SUPPORTED_PROFILES` — the studio's active set, which `STUDIO_PROFILES`
//     (`packages/studio/src/profiles.ts`) is a frozen copy of.
//
// This lives in `node:test` rather than `tests/conformance/` deliberately: a conformance fixture is
// one source paired with one expected stream, and this assertion is a property over a whole corpus
// that is not part of that corpus. `scripts/check-examples.mjs` already parses and EXECUTES these
// same files; what it has never done is run the semantic checker over them.

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { SUPPORTED_PROFILES } from "@openlogo/core";
import { check, parse } from "@openlogo/parser";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const EXAMPLES_DIR = join(ROOT, "spec", "examples");

/** Every `spec/examples/*.logo` file on disk, read from the directory rather than from the
 * profile manifest, so an example added without a manifest entry fails here instead of being
 * silently skipped. */
const EXAMPLE_FILES = readdirSync(EXAMPLES_DIR)
  .filter((entry) => entry.endsWith(".logo"))
  .sort();

/** `scripts/examples-profiles.json` minus its `_comment` key: filename -> declared minimal
 * profile set, the same map `scripts/examples-gate.mjs` reads. */
const DECLARED_PROFILES = JSON.parse(
  readFileSync(join(ROOT, "scripts", "examples-profiles.json"), "utf8"),
);

const STUDIO_ACTIVE_PROFILES = [...SUPPORTED_PROFILES];

/** Render a diagnostic list compactly enough to be readable in an assertion failure. */
function summarize(diagnostics) {
  return diagnostics.map(
    (diagnostic) =>
      `${diagnostic.code} at ${diagnostic.source_span.start.join(":")}` +
      ` ${JSON.stringify(diagnostic.params)}`,
  );
}

test("the sweep can fail: check() does report an unresolvable name in argument position", () => {
  // Sanity-assert the probe before trusting any negative result from it. A sweep that reports
  // "nothing" is an UNPROVEN result unless the same call is known to fire on a case that must fail
  // — a `check()` handed the wrong argument type, for instance, returns a clean, confident, and
  // entirely false empty list (see `.github/skills/shared/conformance-fixture/SKILL.md`).
  const source = "print (wibble 2)\n";
  const diagnostics = check(parse(source, "sanity").ast, {
    profiles: STUDIO_ACTIVE_PROFILES,
    source,
  }).diagnostics;
  assert.deepEqual(summarize(diagnostics), [
    'ol-unknown-command at 1:8 {"name":"wibble"}',
  ]);
});

test("every spec example has a declared profile set", () => {
  assert.ok(
    EXAMPLE_FILES.length > 0,
    "no spec/examples/*.logo files were discovered",
  );
  for (const file of EXAMPLE_FILES) {
    assert.ok(
      Object.hasOwn(DECLARED_PROFILES, file),
      `${file} has no entry in scripts/examples-profiles.json, so this sweep would skip it`,
    );
  }
});

test("no spec example produces a semantic diagnostic under its declared profiles", () => {
  for (const file of EXAMPLE_FILES) {
    const source = readFileSync(join(EXAMPLES_DIR, file), "utf8");
    const parsed = parse(source, file);
    assert.deepEqual(
      summarize(parsed.diagnostics),
      [],
      `${file} failed to parse cleanly`,
    );
    const diagnostics = check(parsed.ast, {
      profiles: DECLARED_PROFILES[file],
      source,
    }).diagnostics;
    assert.deepEqual(
      summarize(diagnostics),
      [],
      `${file} is a correct program, so the checker reporting anything here is a false positive`,
    );
  }
});

test("no spec example produces a semantic diagnostic under the studio's active profiles", () => {
  for (const file of EXAMPLE_FILES) {
    const source = readFileSync(join(EXAMPLES_DIR, file), "utf8");
    const parsed = parse(source, file);
    assert.deepEqual(
      summarize(parsed.diagnostics),
      [],
      `${file} failed to parse cleanly`,
    );
    const diagnostics = check(parsed.ast, {
      profiles: STUDIO_ACTIVE_PROFILES,
      source,
    }).diagnostics;
    assert.deepEqual(
      summarize(diagnostics),
      [],
      `${file} is a correct program, so the checker reporting anything under the studio's own ` +
        "profile set is the false positive that keeps semantic checking switched off on Run",
    );
  }
});
