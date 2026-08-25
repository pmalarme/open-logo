// Tests for the lint-scope gate (issue #978, epic #901).
//
// Every `INJECTED DRIFT:` title below names one drift this gate detects, and the test either fires
// or it does not — the convention `scripts/built-in-names-gate.test.mjs` established, for the reason
// it records: a capability claim written in prose is a claim nothing recomputes, which is the very
// defect epic #901 exists to close.
//
// The headline case is `INJECTED DRIFT: biome.json's includes narrowed back to the pre-fix globs`.
// It is a *real* mutation, not a simulated one: it runs the actual Biome binary against an actual
// narrowed configuration via `--config-path`, and asserts the gate fails. A gate that passes on
// deliberately broken input asserts nothing.

import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  CONFIG_FILE,
  chunk,
  findUncheckedFiles,
  isSourcePath,
  listSourceFiles,
  parseCheckedCount,
  resolveBiomeEntry,
  runBiome,
  runLintScopeGate,
  spawnBiome,
} from "./lint-scope-gate.mjs";

/** One of the 191 test files the pre-fix `files.includes` left unlinted — issue #978's subject. */
const A_PREVIOUSLY_UNLINTED_FILE =
  "packages/parser/src/value-of-key-newline.test.mjs";

/** A Biome summary line for `count` files, in Biome's own singular/plural wording. */
function summary(count) {
  return `Checked ${count} file${count === 1 ? "" : "s"} in 12ms. No fixes applied.`;
}

/**
 * A fake Biome that reports whichever of the paths it was handed are in `linted`, and answers the
 * whole-repository and config probes from `repo` and `config`.
 */
function fakeBiome({ linted, repo, config }) {
  return (args) => {
    const paths = args.slice(2);
    if (paths.length === 1 && paths[0] === ".") {
      return repo;
    }
    if (paths.length === 1 && paths[0] === CONFIG_FILE) {
      return config;
    }
    return summary(paths.filter((path) => linted.has(path)).length);
  };
}

test("isSourcePath accepts the JavaScript/TypeScript family and nothing else", () => {
  for (const path of [
    "a.ts",
    "a.tsx",
    "a.mts",
    "a.cts",
    "a.js",
    "a.jsx",
    "a.mjs",
    "a.cjs",
    "packages/parser/src/deep/nested.test.mjs",
  ]) {
    assert.equal(isSourcePath(path), true, `${path} must be treated as source`);
  }
  for (const path of [
    "biome.json",
    "README.md",
    "spec/grammar.md",
    "a.png",
    "a.css",
    "a.mjs.bak",
  ]) {
    assert.equal(
      isSourcePath(path),
      false,
      `${path} must not be treated as source`,
    );
  }
});

test("chunk splits into runs of at most size, and yields nothing for an empty input", () => {
  assert.deepEqual(chunk([], 3), []);
  assert.deepEqual(chunk([1, 2, 3], 3), [[1, 2, 3]]);
  assert.deepEqual(chunk([1, 2, 3, 4], 3), [[1, 2, 3], [4]]);
});

test("parseCheckedCount reads Biome's singular and plural summaries", () => {
  assert.equal(parseCheckedCount(summary(1)), 1);
  assert.equal(parseCheckedCount(summary(325)), 325);
  assert.equal(parseCheckedCount(summary(0)), 0);
});

test("parseCheckedCount takes the last summary when Biome prints more than one", () => {
  assert.equal(parseCheckedCount(`${summary(4)}\n${summary(9)}`), 9);
});

test("parseCheckedCount returns null — not zero — when there is no summary to read", () => {
  // "Biome said nothing we understood" and "Biome checked nothing" are different states; only one
  // of them is safe to report as a count, so the gate must be able to tell them apart.
  assert.equal(parseCheckedCount(""), null);
  assert.equal(parseCheckedCount("error: could not load configuration"), null);
});

test("resolveBiomeEntry resolves the installed Biome entry point", () => {
  assert.match(
    resolveBiomeEntry().replaceAll("\\", "/"),
    /@biomejs\/biome\/bin\/biome$/,
  );
});

test("runBiome returns Biome's real summary for the configuration file", () => {
  assert.equal(
    parseCheckedCount(runBiome(["lint", "--reporter=summary", CONFIG_FILE])),
    1,
  );
});

test("runBiome returns output rather than throwing when Biome exits non-zero", () => {
  // spawnBiome is the throwing half; runBiome's contract is that a diagnostic exit is still a
  // readable answer, because this gate only ever asks Biome how many files it looked at.
  assert.throws(() => spawnBiome(["lint", "--definitely-not-a-real-flag"]));
  assert.notEqual(runBiome(["lint", "--definitely-not-a-real-flag"]), "");
});

test("runBiome concatenates stdout and stderr off a thrown error", () => {
  const thrown = Object.assign(new Error("boom"), {
    stdout: "out-",
    stderr: "err",
  });
  assert.equal(
    runBiome(["lint"], () => {
      throw thrown;
    }),
    "out-err",
  );
});

test("runBiome yields an empty string when a failure carried no output at all", () => {
  // Which parseCheckedCount turns into null, and the gate reports as a finding — never as zero.
  const output = runBiome(["lint"], () => {
    throw new Error("boom");
  });
  assert.equal(output, "");
  assert.equal(parseCheckedCount(output), null);
});

test("listSourceFiles enumerates source files git knows about, and only those", () => {
  const files = listSourceFiles();
  assert.ok(files.length > 0, "the corpus must not be empty");
  assert.ok(
    files.includes("scripts/lint-scope-gate.test.mjs"),
    "this very test file is tracked source and must be in the corpus",
  );
  assert.ok(
    files.includes(A_PREVIOUSLY_UNLINTED_FILE),
    "the test corpus issue #978 found unlinted must be in the corpus",
  );
  assert.ok(
    files.every(isSourcePath),
    "no non-source path may reach the corpus (README.md, biome.json, images...)",
  );
  assert.deepEqual(
    [...files].sort(),
    files,
    "the corpus must be sorted for a stable report",
  );
});

test("findUncheckedFiles names the files Biome does not check", () => {
  const biome = fakeBiome({ linted: new Set(["a.ts"]), repo: "", config: "" });
  assert.deepEqual(findUncheckedFiles(["a.ts", "b.mjs", "c.mjs"], biome), [
    "b.mjs",
    "c.mjs",
  ]);
});

test("findUncheckedFiles stops probing at the report limit", () => {
  const probed = [];
  const biome = (args) => {
    probed.push(args[2]);
    return summary(0);
  };
  assert.deepEqual(
    findUncheckedFiles(["a.ts", "b.ts", "c.ts", "d.ts"], biome, 2),
    ["a.ts", "b.ts"],
  );
  assert.deepEqual(
    probed,
    ["a.ts", "b.ts"],
    "probing must stop once the limit is reached",
  );
});

test("the gate passes when every source file git knows about is linted", () => {
  const corpus = ["a.ts", "b.mjs"];
  const result = runLintScopeGate({
    listFiles: () => corpus,
    biome: fakeBiome({
      linted: new Set(corpus),
      repo: summary(3),
      config: summary(1),
    }),
  });
  assert.equal(result.ok, true, result.lines.join("\n"));
  assert.match(
    result.lines.join("\n"),
    /2 source file\(s\) git knows about, all linted/,
  );
  assert.match(
    result.lines.join("\n"),
    /Biome checked 3 = 2 \+ 1 \(biome\.json/,
  );
});

test("INJECTED DRIFT: an empty corpus fails closed instead of passing vacuously", () => {
  const result = runLintScopeGate({
    listFiles: () => [],
    biome: fakeBiome({ linted: new Set() }),
  });
  assert.equal(result.ok, false);
  assert.match(result.lines.join("\n"), /corpus is empty/);
});

test("INJECTED DRIFT: a source file that Biome does not check fails the gate and is named", () => {
  const corpus = ["a.ts", "b.mjs"];
  const result = runLintScopeGate({
    listFiles: () => corpus,
    biome: fakeBiome({
      linted: new Set(["a.ts"]),
      repo: summary(2),
      config: summary(1),
    }),
  });
  const report = result.lines.join("\n");
  assert.equal(result.ok, false);
  assert.match(
    report,
    /1 of 2 source file\(s\) git knows about are NOT linted/,
  );
  assert.match(report, /b\.mjs/);
  assert.doesNotMatch(
    report,
    /first \d+ shown/,
    "nothing is elided when every name is reported",
  );
});

test("INJECTED DRIFT: a large narrowing reports a capped list and says so", () => {
  const corpus = Array.from(
    { length: 40 },
    (_unused, index) => `f${index}.mjs`,
  );
  const result = runLintScopeGate({
    listFiles: () => corpus,
    biome: fakeBiome({
      linted: new Set(),
      repo: summary(41),
      config: summary(1),
    }),
  });
  const report = result.lines.join("\n");
  assert.equal(result.ok, false);
  assert.match(
    report,
    /40 of 40 source file\(s\) git knows about are NOT linted/,
  );
  assert.match(report, /\(first 20 shown\)/);
});

test("INJECTED DRIFT: an unparseable chunk summary fails closed rather than counting zero", () => {
  const result = runLintScopeGate({
    listFiles: () => ["a.ts"],
    biome: (args) =>
      args[2] === "." || args[2] === CONFIG_FILE ? summary(1) : "biome crashed",
  });
  assert.equal(result.ok, false);
  assert.match(
    result.lines.join("\n"),
    /no parseable `Checked <n> files` summary for a corpus chunk/,
  );
});

test("INJECTED DRIFT: an unparseable whole-repository summary fails closed", () => {
  const corpus = ["a.ts"];
  const result = runLintScopeGate({
    listFiles: () => corpus,
    biome: fakeBiome({
      linted: new Set(corpus),
      repo: "biome crashed",
      config: summary(1),
    }),
  });
  assert.equal(result.ok, false);
  assert.match(result.lines.join("\n"), /cannot reconcile its count/);
});

test("INJECTED DRIFT: an unparseable configuration probe fails closed", () => {
  const corpus = ["a.ts"];
  const result = runLintScopeGate({
    listFiles: () => corpus,
    biome: fakeBiome({
      linted: new Set(corpus),
      repo: summary(2),
      config: "biome crashed",
    }),
  });
  assert.equal(result.ok, false);
  assert.match(result.lines.join("\n"), /cannot reconcile its count/);
});

test("INJECTED DRIFT: Biome checking more than the corpus plus its config fails the gate", () => {
  // The direction that catches an unexplained `+1` — the discrepancy #978 recorded and could not
  // identify. The gate must never let an unreconciled number pass.
  const corpus = ["a.ts"];
  const result = runLintScopeGate({
    listFiles: () => corpus,
    biome: fakeBiome({
      linted: new Set(corpus),
      repo: summary(9),
      config: summary(1),
    }),
  });
  assert.equal(result.ok, false);
  assert.match(
    result.lines.join("\n"),
    /Biome checked 9 file\(s\) over the whole repository/,
  );
  assert.match(result.lines.join("\n"), /do not adjust the number/);
});

test("ACCEPTANCE #978: Biome checks a packages/*/src test file, rather than ignoring it", () => {
  // The acceptance criterion verbatim: `Checked 1 file`, not `Checked 0 files`.
  assert.equal(
    parseCheckedCount(
      runBiome(["lint", "--reporter=summary", A_PREVIOUSLY_UNLINTED_FILE]),
    ),
    1,
  );
});

test("INJECTED DRIFT: biome.json's includes narrowed back to the pre-fix globs", () => {
  // A real mutation against the real Biome binary: a configuration whose `files.includes` is the
  // pre-fix pair, supplied through --config-path. Under it the gate must fail and name the test
  // files that stop being linted. If this ever passes, the gate has stopped asserting anything.
  const directory = mkdtempSync(join(tmpdir(), "openlogo-lint-scope-"));
  writeFileSync(
    join(directory, CONFIG_FILE),
    JSON.stringify({
      files: { includes: ["packages/**/src/**/*.ts", "scripts/**/*.mjs"] },
      linter: { enabled: true, rules: { preset: "recommended" } },
      formatter: { enabled: false },
      assist: { enabled: false },
    }),
  );

  const narrowed = (args) =>
    runBiome(["lint", `--config-path=${directory}`, ...args.slice(1)]);
  const corpus = [
    A_PREVIOUSLY_UNLINTED_FILE,
    "packages/core/src/values.test.mjs",
  ];

  const result = runLintScopeGate({ listFiles: () => corpus, biome: narrowed });
  const report = result.lines.join("\n");
  assert.equal(
    result.ok,
    false,
    `the narrowed configuration must fail the gate:\n${report}`,
  );
  assert.match(
    report,
    /2 of 2 source file\(s\) git knows about are NOT linted/,
  );
  for (const path of corpus) {
    assert.ok(report.includes(path), `${path} must be named as unlinted`);
  }
});

test("the gate reconciles this repository's real lint scope end to end", () => {
  // Exercises the real git enumeration, the real Biome binary and the default chunk size together —
  // the same reconciliation `npm run lint` performs, asserted here so a break shows up as a failing
  // test and not only as a red pipeline.
  const result = runLintScopeGate({});
  assert.equal(result.ok, true, result.lines.join("\n"));
});
