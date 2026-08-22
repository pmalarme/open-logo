// Unit + regression tests for the markdown fenced-block DoD gate (issue #850). Per ADR-0009's
// pattern these import scripts/markdown-examples-gate.mjs's logic directly (for 100% coverage)
// plus one subprocess test for the CLI shell (scripts/check-markdown-examples.mjs), pointed at
// isolated temp fixtures via --root/--expectations rather than the real spec/ + docs/ corpus.
//
// The self-test block at the end is the gate's own proof that it can go red — the same discipline
// as tests/conformance/_harness-selftest/, whose fixtures deliberately declare expect: "mismatch".
// A gate that passes because it checks nothing is worse than no gate, so every way this one is
// supposed to fail (a runtime ol-type like the `set_shape "bee"` regression that motivated issue
// #850, a stale expectation, a changed expectation, an unterminated fence, a malformed manifest
// entry) has a test that asserts it actually fails.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import {
  CONTEXT_TOLERATED_CODES,
  DOCUMENTATION_INSTRUCTION_BUDGET,
  EXPECTATION_KINDS,
  EXPECTATIONS_PATH,
  MARKDOWN_ROOTS,
  analyzeBlock,
  blockFingerprint,
  extractFencedBlocks,
  findMarkdownFiles,
  isContextFragment,
  loadExpectations,
  parseArgs,
  runMarkdownExamplesGate,
  suggestExpectation,
  toPosixPath,
  validateExpectationEntry,
} from "./markdown-examples-gate.mjs";

// Each test gets its own fresh, uniquely-named OS temp directory — never a shared or repo-tracked
// fixture path (the convention scripts/check-examples.test.mjs and conformance.test.mjs use).
let TEMP_DIR;

beforeEach(() => {
  TEMP_DIR = mkdtempSync(join(tmpdir(), "ol-markdown-gate-"));
});

afterEach(() => {
  rmSync(TEMP_DIR, { recursive: true, force: true });
});

/** Write `text` to `<TEMP_DIR>/<name>`, creating intermediate directories. */
function writeMarkdown(name, text) {
  const path = join(TEMP_DIR, name);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, text, "utf8");
  return path;
}

/** Wrap `source` in a ```logo fence, the shape every markdown fixture below uses. */
function logoBlock(source) {
  return ["```logo", source, "```", ""].join("\n");
}

/** Run the gate over the temp directory with an inline (already-parsed) expectations manifest. */
function runOverTemp(expectations = {}) {
  return runMarkdownExamplesGate({ roots: [TEMP_DIR], expectations });
}

// --- toPosixPath / blockFingerprint ---------------------------------------------------------

test("toPosixPath rewrites native separators to forward slashes", () => {
  assert.equal(toPosixPath(join("spec", "grammar.md")), "spec/grammar.md");
});

test("blockFingerprint is a stable 16-hex digest that changes with the source", () => {
  const fingerprint = blockFingerprint("forward 10");
  assert.match(fingerprint, /^[0-9a-f]{16}$/);
  assert.equal(fingerprint, blockFingerprint("forward 10"));
  assert.notEqual(fingerprint, blockFingerprint("forward 11"));
});

// --- findMarkdownFiles ----------------------------------------------------------------------

test("findMarkdownFiles returns sorted .md paths and recurses into subdirectories", () => {
  writeMarkdown("b.md", "");
  writeMarkdown("a.md", "");
  writeMarkdown("nested/c.md", "");
  writeMarkdown("nested/not-markdown.txt", "");
  const found = findMarkdownFiles([TEMP_DIR]).map((path) =>
    path.slice(toPosixPath(TEMP_DIR).length + 1),
  );
  assert.deepEqual(found, ["a.md", "b.md", "nested/c.md"]);
});

test("findMarkdownFiles ignores a root that does not exist", () => {
  assert.deepEqual(findMarkdownFiles([join(TEMP_DIR, "absent")]), []);
});

test("findMarkdownFiles defaults to the repository's spec/ and docs/ roots", () => {
  assert.deepEqual(MARKDOWN_ROOTS, ["spec", "docs"]);
  const found = findMarkdownFiles();
  assert.ok(found.includes("spec/grammar.md"));
  assert.ok(found.includes("docs/architecture.md"));
});

// --- extractFencedBlocks --------------------------------------------------------------------

test("extractFencedBlocks reads the language, source, and 1-based opener line", () => {
  const { blocks, unterminated } = extractFencedBlocks(
    ["prose", "```logo", "forward 10", "```", "more"].join("\n"),
  );
  assert.deepEqual(unterminated, []);
  assert.deepEqual(blocks, [
    { language: "logo", source: "forward 10", startLine: 2 },
  ]);
});

test("extractFencedBlocks lowercases the info string and keeps only its first word", () => {
  const { blocks } = extractFencedBlocks(
    ["```LOGO title=x", "forward 10", "```"].join("\n"),
  );
  assert.equal(blocks[0].language, "logo");
});

test("extractFencedBlocks strips the opener's indentation from the body", () => {
  const { blocks } = extractFencedBlocks(
    ["1. item", "", "   ```logo", "   forward 10", "unindented", "   ```"].join(
      "\n",
    ),
  );
  // The under-indented line is kept verbatim rather than mangled.
  assert.equal(blocks[0].source, "forward 10\nunindented");
});

test("extractFencedBlocks treats a tilde fence as its own fence family", () => {
  const { blocks } = extractFencedBlocks(
    ["~~~logo", "forward 10", "```", "~~~"].join("\n"),
  );
  assert.equal(blocks[0].source, "forward 10\n```");
});

test("extractFencedBlocks reports a fence that is never closed", () => {
  const { blocks, unterminated } = extractFencedBlocks(
    ["```logo", "forward 10"].join("\n"),
  );
  assert.deepEqual(unterminated, [1]);
  assert.equal(blocks[0].source, "forward 10");
});

// --- analyzeBlock ---------------------------------------------------------------------------

test("analyzeBlock reports no codes for a clean program", () => {
  const result = analyzeBlock("forward 10\nright 90", "clean");
  assert.deepEqual(result, {
    unimplementedProfiles: [],
    codes: [],
    details: [],
  });
});

test("analyzeBlock collects sorted, de-duplicated error codes with absolute line numbers", () => {
  const result = analyzeBlock('set_shape "bee"', "bee", 118);
  assert.deepEqual(result.codes, ["ol-type"]);
  assert.match(result.details[0], /^119: ol-type — /);
});

test("analyzeBlock reports a block needing an unimplemented profile instead of failing it", () => {
  const result = analyzeBlock("alias avance forward", "localized");
  assert.deepEqual(result.unimplementedProfiles, ["localization"]);
  assert.deepEqual(result.codes, []);
});

test("analyzeBlock turns an unexpected internal throw into a finding rather than crashing", () => {
  // parse()/execute() reject a non-string source by throwing, which exercises the defensive
  // catch: a gate must never itself crash on an unexpected internal error.
  const result = analyzeBlock(undefined, "not-a-source", 5);
  assert.deepEqual(result.codes, ["gate-threw"]);
  assert.match(result.details[0], /^5: gate-threw — /);
});

test("the documentation instruction budget is a fixed, deterministic ceiling", () => {
  assert.equal(DOCUMENTATION_INSTRUCTION_BUDGET, 100_000);
  assert.deepEqual(analyzeBlock("forever [ forward 1 ]", "spin").codes, [
    "ol-limit",
  ]);
});

// --- isContextFragment ----------------------------------------------------------------------

test("isContextFragment tolerates only names defined in the surrounding prose", () => {
  assert.deepEqual([...CONTEXT_TOLERATED_CODES].sort(), [
    "ol-undefined-var",
    "ol-unknown-command",
  ]);
  assert.equal(isContextFragment(["ol-undefined-var"]), true);
  assert.equal(isContextFragment(["ol-unknown-command"]), true);
});

test("isContextFragment does not treat a clean block as a fragment", () => {
  assert.equal(isContextFragment([]), false);
});

test("isContextFragment tolerates ol-bad-token only beside an unknown command", () => {
  // `polygon 5 100` — the parser mis-arities a call to a procedure defined in the prose.
  assert.equal(isContextFragment(["ol-bad-token", "ol-unknown-command"]), true);
  // `:x = [1, 2, 3]` — a real lexical error with nothing to excuse it.
  assert.equal(isContextFragment(["ol-bad-token"]), false);
});

test("isContextFragment fails a fragment that also raises a real error", () => {
  assert.equal(isContextFragment(["ol-type", "ol-undefined-var"]), false);
});

// --- suggestExpectation ---------------------------------------------------------------------

test("suggestExpectation prints a pasteable entry using the first non-blank line", () => {
  const suggestion = suggestExpectation(
    { source: "\n\nforward 10\nright 90" },
    ["ol-type"],
  );
  assert.match(suggestion, /"excerpt":"forward 10"/);
  assert.match(suggestion, /"codes":\["ol-type"\]/);
  assert.match(suggestion, /"why":"TODO/);
});

test("suggestExpectation copes with a block that has no non-blank line", () => {
  assert.match(suggestExpectation({ source: "" }, ["ol-type"]), /"excerpt":""/);
});

// --- validateExpectationEntry ---------------------------------------------------------------

test("validateExpectationEntry accepts a well-formed entry", () => {
  assert.deepEqual(
    validateExpectationEntry(
      {
        fingerprint: "abc",
        kind: "deliberate-error",
        why: "because",
        codes: ["ol-type"],
      },
      "spec/x.md",
      0,
    ),
    [],
  );
});

test("validateExpectationEntry rejects every malformed field", () => {
  const problems = validateExpectationEntry(
    { fingerprint: "", kind: "made-up", why: "   ", codes: [] },
    "spec/x.md",
    2,
  );
  assert.equal(problems.length, 4);
  assert.ok(
    problems.every((problem) => problem.startsWith("spec/x.md entry 2:")),
  );
  assert.ok(
    problems.some((problem) => problem.includes('missing "fingerprint"')),
  );
  assert.ok(
    problems.some((problem) => problem.includes('"kind" must be one of')),
  );
  assert.ok(problems.some((problem) => problem.includes('missing "why"')));
  assert.ok(problems.some((problem) => problem.includes('"codes" must list')));
});

test("validateExpectationEntry rejects wrongly-typed fields too", () => {
  const problems = validateExpectationEntry(
    { fingerprint: 7, kind: "not-openlogo", why: 7, codes: "ol-type" },
    "spec/x.md",
    0,
  );
  assert.equal(problems.length, 3);
});

test("the expectation kinds are a closed, documented set", () => {
  assert.deepEqual([...EXPECTATION_KINDS].sort(), [
    "deliberate-error",
    "known-broken",
    "non-terminating",
    "not-openlogo",
  ]);
});

// --- loadExpectations -----------------------------------------------------------------------

test("loadExpectations drops underscore-prefixed documentation keys", () => {
  const path = join(TEMP_DIR, "expectations.json");
  writeFileSync(
    path,
    JSON.stringify({ _readme: ["note"], "spec/x.md": [] }),
    "utf8",
  );
  assert.deepEqual(loadExpectations(path), { "spec/x.md": [] });
});

test("the repository's committed expectations manifest is well-formed", () => {
  const expectations = loadExpectations();
  assert.ok(Object.keys(expectations).length > 0);
  for (const [file, entries] of Object.entries(expectations)) {
    for (const [position, entry] of entries.entries()) {
      assert.deepEqual(validateExpectationEntry(entry, file, position), []);
    }
  }
});

// --- runMarkdownExamplesGate ----------------------------------------------------------------

test("the gate passes a clean corpus and counts what it checked", () => {
  writeMarkdown("clean.md", logoBlock("forward 10\nright 90"));
  const result = runOverTemp();
  assert.equal(result.ok, true);
  assert.equal(result.counts.total, 1);
  assert.equal(result.counts.clean, 1);
  assert.match(result.lines.at(-1), /1 logo block\(s\) — 1 clean/);
});

test("the gate ignores fenced blocks in other languages", () => {
  writeMarkdown(
    "mixed.md",
    ["```text", "not logo at all", "```", ""].join("\n"),
  );
  const result = runOverTemp();
  assert.equal(result.ok, true);
  assert.equal(result.counts.total, 0);
});

test("the gate fails when no markdown file is found at all", () => {
  const result = runMarkdownExamplesGate({
    roots: [join(TEMP_DIR, "absent")],
    expectations: {},
  });
  assert.equal(result.ok, false);
  assert.match(result.lines[0], /no \.md files found/);
});

test("the gate tolerates a prose fragment but still counts it visibly", () => {
  writeMarkdown("fragment.md", logoBlock("forward :size"));
  const result = runOverTemp();
  assert.equal(result.ok, true);
  assert.equal(result.counts.fragment, 1);
  assert.match(result.lines.at(-1), /1 prose fragment\(s\)/);
});

test("the gate skips a block that needs a profile with no implementation yet", () => {
  writeMarkdown("localized.md", logoBlock("alias avance forward"));
  const result = runOverTemp();
  assert.equal(result.ok, true);
  assert.equal(result.counts.skipped, 1);
  assert.match(result.lines[0], /SKIP .*requires localization/);
});

test("the gate fails an unterminated fence, which would swallow later blocks", () => {
  writeMarkdown("broken.md", ["```logo", "forward 10"].join("\n"));
  const result = runOverTemp();
  assert.equal(result.ok, false);
  assert.match(result.lines[0], /fence opened here is never closed/);
});

test("an expected-diagnostic block passes when it produces exactly its declared codes", () => {
  const source = 'set_shape "bee"';
  writeMarkdown("expected.md", logoBlock(source));
  const result = runOverTemp({
    [`${toPosixPath(TEMP_DIR)}/expected.md`]: [
      {
        fingerprint: blockFingerprint(source),
        excerpt: source,
        kind: "deliberate-error",
        why: "teaches the diagnostic",
        codes: ["ol-type"],
      },
    ],
  });
  assert.equal(result.ok, true);
  assert.equal(result.counts.expected, 1);
});

test("the gate fails a listed block whose codes changed", () => {
  const source = 'set_shape "bee"';
  writeMarkdown("expected.md", logoBlock(source));
  const result = runOverTemp({
    [`${toPosixPath(TEMP_DIR)}/expected.md`]: [
      {
        fingerprint: blockFingerprint(source),
        excerpt: source,
        kind: "deliberate-error",
        why: "teaches the diagnostic",
        codes: ["ol-range"],
      },
    ],
  });
  assert.equal(result.ok, false);
  assert.match(result.lines[0], /expected ol-range .* but got ol-type/);
  assert.match(result.lines[1], /ol-type — /);
});

test("the gate fails a stale expectation whose block became clean", () => {
  const source = "forward 10";
  writeMarkdown("fixed.md", logoBlock(source));
  const result = runOverTemp({
    [`${toPosixPath(TEMP_DIR)}/fixed.md`]: [
      {
        fingerprint: blockFingerprint(source),
        excerpt: source,
        kind: "deliberate-error",
        why: "used to be wrong",
        codes: ["ol-type"],
      },
    ],
  });
  assert.equal(result.ok, false);
  assert.match(result.lines[0], /but got a clean run/);
});

test("the gate explains that a listed block was skipped for an unimplemented profile", () => {
  const source = "alias avance forward";
  writeMarkdown("localized.md", logoBlock(source));
  const result = runOverTemp({
    [`${toPosixPath(TEMP_DIR)}/localized.md`]: [
      {
        fingerprint: blockFingerprint(source),
        excerpt: source,
        kind: "deliberate-error",
        why: "stale expectation",
        codes: ["ol-bad-token"],
      },
    ],
  });
  assert.equal(result.ok, false);
  assert.match(result.lines[0], /skipped because it needs localization/);
});

test("the gate fails an expectation whose fingerprint matches no block", () => {
  writeMarkdown("clean.md", logoBlock("forward 10"));
  const result = runOverTemp({
    [`${toPosixPath(TEMP_DIR)}/clean.md`]: [
      {
        fingerprint: "0000000000000000",
        excerpt: "gone",
        kind: "deliberate-error",
        why: "the block it described was deleted or edited",
        codes: ["ol-type"],
      },
    ],
  });
  assert.equal(result.ok, false);
  assert.match(result.lines[0], /stale expectation .* matches no logo block/);
});

test("a stale-expectation report copes with an entry that has no excerpt", () => {
  writeMarkdown("clean.md", logoBlock("forward 10"));
  const result = runOverTemp({
    [`${toPosixPath(TEMP_DIR)}/clean.md`]: [
      {
        fingerprint: "0000000000000000",
        kind: "deliberate-error",
        why: "no excerpt recorded",
        codes: ["ol-type"],
      },
    ],
  });
  assert.equal(result.ok, false);
  assert.match(result.lines[0], /entry 0 \(\)/);
});

test("the gate fails a malformed expectation entry", () => {
  writeMarkdown("clean.md", logoBlock("forward 10"));
  const result = runOverTemp({
    [`${toPosixPath(TEMP_DIR)}/clean.md`]: [
      { fingerprint: "abc", kind: "typo", why: "", codes: [] },
    ],
  });
  assert.equal(result.ok, false);
  assert.ok(
    result.lines.some((line) => line.includes('"kind" must be one of')),
  );
});

test("the gate fails two entries that pin the same block, since one of them is dead", () => {
  const source = 'set_shape "bee"';
  writeMarkdown("expected.md", logoBlock(source));
  const entry = {
    fingerprint: blockFingerprint(source),
    excerpt: source,
    kind: "deliberate-error",
    why: "teaches the diagnostic",
    codes: ["ol-type"],
  };
  const result = runOverTemp({
    [`${toPosixPath(TEMP_DIR)}/expected.md`]: [entry, { ...entry }],
  });
  assert.equal(result.ok, false);
  assert.ok(
    result.lines.some((line) => line.includes("duplicate fingerprint")),
  );
});

test("the gate reads its manifest from disk when none is passed in", () => {
  writeMarkdown("clean.md", logoBlock("forward 10"));
  const expectationsPath = join(TEMP_DIR, "expectations.json");
  writeFileSync(expectationsPath, JSON.stringify({}), "utf8");
  const result = runMarkdownExamplesGate({
    roots: [TEMP_DIR],
    expectationsPath,
  });
  assert.equal(result.ok, true);
});

// --- the gate's own proof that it goes red (see the header comment) --------------------------

test('SELF-TEST: the gate fails the set_shape "bee" regression that motivated issue #850', () => {
  // The exact spec/turtles-and-sprites.md sprite example, with the shape word that shipped in the
  // 0.1.0 conformance claim and was found by a human rather than by CI.
  writeMarkdown(
    "turtles-and-sprites.md",
    logoBlock(
      [
        ":bee = new_turtle",
        "ask :bee [",
        '  set_shape "bee"',
        '  set_color "yellow"',
        "  forward 60",
        "]",
      ].join("\n"),
    ),
  );
  const result = runOverTemp();
  assert.equal(result.ok, false);
  assert.equal(result.counts.failed, 1);
  assert.match(result.lines[0], /FAIL .*turtles-and-sprites\.md:1: ol-type$/);
  // The report names the offending line inside the block and quotes the learner message, so a
  // human can find it without re-running anything.
  assert.match(result.lines[1], /:4: ol-type — i don't know the shape "bee"/);
  // …and prints the manifest entry to paste if the failure is ever legitimate.
  assert.match(
    result.lines[2],
    /add to .*markdown-examples-expectations\.json/,
  );
});

test("SELF-TEST: the same block passes once the shape word is a portable one", () => {
  writeMarkdown(
    "turtles-and-sprites.md",
    logoBlock(
      [
        ":bee = new_turtle",
        "ask :bee [",
        '  set_shape "arrow"',
        '  set_color "yellow"',
        "  forward 60",
        "]",
      ].join("\n"),
    ),
  );
  assert.equal(runOverTemp().ok, true);
});

test("SELF-TEST: the real spec/ + docs/ corpus is green against the committed manifest", () => {
  const result = runMarkdownExamplesGate();
  assert.equal(
    result.ok,
    true,
    `markdown examples gate failed:\n${result.lines.join("\n")}`,
  );
  assert.ok(result.counts.total > 100);
});

// --- parseArgs + CLI shell ------------------------------------------------------------------

test("parseArgs collects repeated --root flags and --expectations", () => {
  assert.deepEqual(
    parseArgs(["--root=spec", "--root=docs", "--expectations=x.json"]),
    {
      roots: ["spec", "docs"],
      expectationsPath: "x.json",
    },
  );
});

test("parseArgs leaves both options undefined when nothing is passed", () => {
  assert.deepEqual(parseArgs(["--unrelated"]), {
    roots: undefined,
    expectationsPath: undefined,
  });
});

test("the CLI shell exits 0 and prints the report for a clean corpus", () => {
  writeMarkdown("clean.md", logoBlock("forward 10"));
  const expectationsPath = join(TEMP_DIR, "expectations.json");
  writeFileSync(expectationsPath, JSON.stringify({}), "utf8");
  const run = spawnSync(
    process.execPath,
    [
      join("scripts", "check-markdown-examples.mjs"),
      `--root=${TEMP_DIR}`,
      `--expectations=${expectationsPath}`,
    ],
    { encoding: "utf8" },
  );
  assert.equal(run.status, 0);
  assert.match(run.stdout, /1 logo block\(s\) — 1 clean/);
});

test("the CLI shell exits 1 when a block regresses", () => {
  writeMarkdown("regressed.md", logoBlock('set_shape "bee"'));
  const expectationsPath = join(TEMP_DIR, "expectations.json");
  writeFileSync(expectationsPath, JSON.stringify({}), "utf8");
  const run = spawnSync(
    process.execPath,
    [
      join("scripts", "check-markdown-examples.mjs"),
      `--root=${TEMP_DIR}`,
      `--expectations=${expectationsPath}`,
    ],
    { encoding: "utf8" },
  );
  assert.equal(run.status, 1);
  assert.match(run.stdout, /FAIL .*ol-type/);
});

test("the CLI shell defaults to the repository corpus and its committed manifest", () => {
  assert.equal(
    toPosixPath(EXPECTATIONS_PATH),
    "scripts/markdown-examples-expectations.json",
  );
  const run = spawnSync(
    process.execPath,
    [join("scripts", "check-markdown-examples.mjs")],
    { encoding: "utf8" },
  );
  assert.equal(run.status, 0, run.stdout);
  assert.match(run.stdout, /markdown examples: \d+ logo block\(s\)/);
});
