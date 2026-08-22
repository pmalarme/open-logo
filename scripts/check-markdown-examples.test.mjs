// Unit + regression tests for the markdown fenced-block DoD gate (issue #850). These import
// scripts/markdown-examples-gate.mjs's logic directly (for 100% coverage) plus subprocess tests for
// the CLI shell (scripts/check-markdown-examples.mjs), pointed at isolated temp fixtures via
// --root/--expectations rather than the real spec/ + docs/ corpus.
//
// The SELF-TEST block at the end is the gate's own proof that it can go red — the same discipline
// as tests/conformance/_harness-selftest/, whose fixtures deliberately declare expect: "mismatch".
// A gate that passes because it checks nothing is worse than no gate, so every way this one is
// supposed to fail has a test that asserts it actually fails: the runtime `ol-type` from the
// `set_shape "bee"` regression that motivated #850, a misspelled command name (the case an earlier
// design's automatic fragment tolerance would have swallowed), a mistyped variable, an edited or
// stale expectation, a block that quietly starts needing an unimplemented profile, an unterminated
// fence, and a malformed manifest entry.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { parse } from "@openlogo/parser";
import {
  DOCUMENTATION_INSTRUCTION_BUDGET,
  EXPECTATIONS_PATH,
  EXPECTATION_KINDS,
  MARKDOWN_ROOTS,
  UNSUPPORTED_FENCE_REASONS,
  analyzeBlock,
  blockFingerprint,
  describeExpectationMismatch,
  extractFencedBlocks,
  findMarkdownFiles,
  lastStatementLine,
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

/** The manifest key a file written by {@link writeMarkdown} gets. */
function keyFor(name) {
  return `${toPosixPath(TEMP_DIR)}/${name}`;
}

/** Run the gate over the temp directory with an inline (already-parsed) expectations manifest. */
function runOverTemp(expectations = {}) {
  return runMarkdownExamplesGate({ roots: [TEMP_DIR], expectations });
}

/** A well-formed expectation entry for `source`, overridable field by field. */
function expectationFor(source, overrides = {}) {
  return {
    fingerprint: blockFingerprint(source),
    excerpt: source.split("\n")[0],
    kind: "deliberate-error",
    why: "the prose teaches this diagnostic",
    codes: ["ol-type"],
    ...overrides,
  };
}

/**
 * A block that makes the parser exhaust the call stack. It is the one input reachable from real
 * markdown that proves the gate reports an internal failure instead of crashing.
 */
const STACK_BUSTING_SOURCE = `print ${"(".repeat(20_000)}1${")".repeat(20_000)}`;

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
  const { blocks, problems } = extractFencedBlocks(
    ["prose", "```logo", "forward 10", "```", "more"].join("\n"),
  );
  assert.deepEqual(problems, []);
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

test("extractFencedBlocks needs a closer at least as long as the opener", () => {
  const { blocks } = extractFencedBlocks(
    ["````logo", "```", "forward 10", "````"].join("\n"),
  );
  assert.equal(blocks[0].source, "```\nforward 10");
});

test("extractFencedBlocks reports a fence that is never closed", () => {
  const { blocks, problems } = extractFencedBlocks(
    ["```logo", "forward 10"].join("\n"),
  );
  assert.deepEqual(problems, [
    { line: 1, reason: UNSUPPORTED_FENCE_REASONS.UNCLOSED },
  ]);
  assert.equal(blocks[0].source, "forward 10");
});

test("extractFencedBlocks refuses to guess at fence constructs it does not implement", () => {
  for (const [markdown, reason] of [
    ["> ```logo\n> forward 10\n> ```", UNSUPPORTED_FENCE_REASONS.BLOCKQUOTE],
    ["- ```logo\n  forward 10\n  ```", UNSUPPORTED_FENCE_REASONS.LIST_MARKER],
    [
      "1. ```logo\n   forward 10\n   ```",
      UNSUPPORTED_FENCE_REASONS.LIST_MARKER,
    ],
    [
      "    ```logo\n    forward 10\n    ```",
      UNSUPPORTED_FENCE_REASONS.DEEP_INDENT,
    ],
    ["\t```logo\n\tforward 10\n\t```", UNSUPPORTED_FENCE_REASONS.DEEP_INDENT],
    ["```lo`go\nforward 10\n```", UNSUPPORTED_FENCE_REASONS.BACKTICK_IN_INFO],
  ]) {
    const { blocks, problems } = extractFencedBlocks(markdown);
    assert.deepEqual(
      problems[0],
      { line: 1, reason },
      `expected ${reason} for ${JSON.stringify(markdown)}`,
    );
    // Refusing means it never yields a half-read `logo` block from the construct.
    assert.deepEqual(
      blocks.filter((block) => block.language === "logo"),
      [],
    );
  }
});

test("extractFencedBlocks allows a backtick in a TILDE fence's info string", () => {
  // CommonMark forbids backticks only in a BACKTICK fence's info string.
  const { blocks, problems } = extractFencedBlocks(
    ["~~~lo`go", "forward 10", "~~~"].join("\n"),
  );
  assert.deepEqual(problems, []);
  assert.equal(blocks[0].language, "lo`go");
});

test("extractFencedBlocks does not accept a four-column-indented closing fence", () => {
  // Four columns is indented code, so it does not close the block — the fence runs to EOF.
  const { blocks, problems } = extractFencedBlocks(
    ["```logo", "forward 10", "    ```"].join("\n"),
  );
  assert.deepEqual(problems, [
    { line: 1, reason: UNSUPPORTED_FENCE_REASONS.UNCLOSED },
  ]);
  assert.equal(blocks[0].source, "forward 10\n    ```");

  // Three columns still closes it.
  assert.deepEqual(
    extractFencedBlocks(["```logo", "forward 10", "   ```"].join("\n"))
      .problems,
    [],
  );
});

test("extractFencedBlocks removes UP TO the opener's indentation, not all or nothing", () => {
  const { blocks } = extractFencedBlocks(
    ["   ```logo", "   forward 10", " right 90", "     back 5", "   ```"].join(
      "\n",
    ),
  );
  // Three columns removed: the 1-space line loses its one space, the 5-space line keeps two.
  assert.equal(blocks[0].source, "forward 10\nright 90\n  back 5");
});

// --- analyzeBlock ---------------------------------------------------------------------------

test("analyzeBlock reports no codes for a clean program", () => {
  assert.deepEqual(analyzeBlock("forward 10\nright 90", "clean"), {
    unimplementedProfiles: [],
    codes: [],
    details: [],
    internalError: null,
    setupError: null,
    partialFrom: null,
  });
});

test("analyzeBlock collects sorted, de-duplicated codes with absolute line numbers", () => {
  const result = analyzeBlock('set_shape "bee"', "bee", { startLine: 118 });
  assert.deepEqual(result.codes, ["ol-type"]);
  assert.match(result.details[0], /^119: ol-type — /);
});

test("analyzeBlock gates a block needing an unimplemented profile by default", () => {
  const result = analyzeBlock("alias avance forward", "localized");
  assert.deepEqual(result.unimplementedProfiles, ["localization"]);
  assert.deepEqual(result.codes, []);
});

test("analyzeBlock analyzes for real when the caller turns profile gating off", () => {
  const result = analyzeBlock("alias avance forward", "localized", {
    gateUnimplementedProfiles: false,
  });
  assert.deepEqual(result.unimplementedProfiles, ["localization"]);
  assert.deepEqual(result.codes, ["ol-bad-token", "ol-unknown-command"]);
});

test("analyzeBlock reports an internal failure instead of crashing the gate", () => {
  const result = analyzeBlock(STACK_BUSTING_SOURCE, "deep");
  assert.match(result.internalError, /call stack/i);
  assert.deepEqual(result.codes, []);
});

test("the documentation instruction budget is a fixed, deterministic ceiling", () => {
  assert.equal(DOCUMENTATION_INSTRUCTION_BUDGET, 100_000);
  assert.deepEqual(analyzeBlock("forever [ forward 1 ]", "spin").codes, [
    "ol-limit",
  ]);
});

test("analyzeBlock reports where execution stopped short of the block's end", () => {
  // The runtime halts at the first error, so line 2 is parsed and statically checked but never
  // run. That limit is surfaced, not hidden — see the module header.
  const halted = analyzeBlock('forward :size\nset_shape "arrow"', "halted", {
    startLine: 100,
  });
  assert.equal(halted.partialFrom, 101);

  // A block whose only error is on its last executable line ran to the end: not partial.
  assert.equal(analyzeBlock("forward :size", "whole").partialFrom, null);
  // Trailing blank lines and comments are not executable, so they do not make a block partial.
  assert.equal(
    analyzeBlock("forward :size\n\n# just a comment", "trailing").partialFrom,
    null,
  );
  // A clean block never halts at all.
  assert.equal(analyzeBlock("forward 10\nright 90", "clean").partialFrom, null);
});

test("analyzeBlock counts only a RUNTIME error as an execution halt", () => {
  // `execute()` returns the parse diagnostics it collected on the way in. Treating those as a halt
  // would mislabel a block that never ran at all as one whose later lines were skipped.
  const parseOnly = analyzeBlock("repeat 4\nforward 10", "static", {
    startLine: 10,
  });
  assert.deepEqual(parseOnly.codes, ["ol-missing-end"]);
  assert.equal(parseOnly.partialFrom, null);
});

test("analyzeBlock runs a block to completion when given a setup preamble", () => {
  const source = 'forward :size\nset_shape "bee"';
  // Without context the runtime halts on line 1 and never sees the bad shape word.
  const bare = analyzeBlock(source, "bare", { startLine: 100 });
  assert.deepEqual(bare.codes, ["ol-undefined-var"]);
  assert.equal(bare.partialFrom, 101);

  // With it, the block executes to the end — and the real defect surfaces.
  const withSetup = analyzeBlock(source, "with-setup", {
    startLine: 100,
    setup: ":size = 50",
  });
  assert.deepEqual(withSetup.codes, ["ol-type"]);
  assert.equal(withSetup.partialFrom, null);
  // Line numbers stay anchored to the file, not to the preamble.
  assert.match(withSetup.details[0], /^102: ol-type — /);
});

test("analyzeBlock asserts a clean run when the setup supplies everything missing", () => {
  const result = analyzeBlock("forward :size\nright 90", "clean-with-setup", {
    startLine: 5,
    setup: ":size = 50",
  });
  assert.deepEqual(result.codes, []);
  assert.equal(result.setupError, null);
  assert.equal(result.partialFrom, null);
});

test("analyzeBlock reports a broken setup preamble as its own failure, not the block's", () => {
  const result = analyzeBlock("forward :size", "bad-setup", {
    setup: ":size = :never_defined",
  });
  assert.match(result.setupError, /ol-undefined-var/);
  assert.deepEqual(result.codes, []);
});

test("analyzeBlock treats a wholly blank block as having no executable line", () => {
  assert.equal(analyzeBlock("\n   \n", "blank").partialFrom, null);
});

test("lastStatementLine finds the last top-level statement, or 0 when there is none", () => {
  const { ast } = parse(
    ["forward 10", ":doubled = map num in [1] [", "  print :num", "]"].join(
      "\n",
    ),
    "probe",
  );
  assert.equal(lastStatementLine(ast), 2);
  assert.equal(lastStatementLine(parse("", "empty").ast), 0);
});

test("analyzeBlock does not call a multi-line final statement partial", () => {
  // The `map` raises ol-no-value, and its span points at the assignment's head line — but the
  // body did run and no later statement was skipped. A span is not a program counter.
  const result = analyzeBlock(
    [
      ":nums = [1 2 3]",
      ":doubled = map num in :nums [",
      "  print :num",
      "]",
    ].join("\n"),
    "map",
  );
  assert.deepEqual(result.codes, ["ol-no-value"]);
  assert.equal(result.partialFrom, null);
});

test("PARTIAL is scoped to top-level statements, which is its documented limit", () => {
  // A halt INSIDE the final statement is not reported: nothing after that statement was skipped,
  // even though its body never ran. The remedy is a setup, not a wider measure.
  const nested = analyzeBlock('if :done [ print "finished" ]', "nested");
  assert.deepEqual(nested.codes, ["ol-undefined-var"]);
  assert.equal(nested.partialFrom, null);
  // Given the context, the body does run and the block is clean.
  assert.deepEqual(
    analyzeBlock('if :done [ print "finished" ]', "nested", {
      setup: ":done = true",
    }).codes,
    [],
  );
});

test("analyzeBlock rejects a setup that does not stand on its own", () => {
  // Parsing alone is not enough. `setup: "helper"` plus a block that defines `helper` would
  // satisfy each other — the preamble leaning on the block it is supposed to be supporting.
  const leaning = analyzeBlock("define helper\nend define", "leaning", {
    setup: "helper",
  });
  assert.match(leaning.setupError, /ol-unknown-command/);
  assert.deepEqual(leaning.codes, []);

  // And a preamble must not absorb the block's own malformed structure.
  const absorbed = analyzeBlock("forward 10\nend repeat", "absorbed", {
    setup: "repeat 1",
  });
  assert.match(absorbed.setupError, /ol-missing-end/);
  assert.deepEqual(absorbed.codes, []);
});

test("analyzeBlock rejects a setup that shadows anything OpenLogo provides, at any depth", () => {
  // `define set_shape :s end` would make the canonical set_shape "bee" regression go green…
  for (const setup of [
    "define set_shape :s\nend define",
    // …and a one-token wrapper must not smuggle it past the guard.
    "repeat 1 [\n  define set_shape :s\n  end\n]",
  ]) {
    const result = analyzeBlock('set_shape "bee"', "shadowed", { setup });
    assert.match(
      result.setupError,
      /redefines the built-in set_shape — a setup supplies context, it must not shadow a primitive/,
      `setup ${JSON.stringify(setup)} should be rejected`,
    );
    assert.deepEqual(result.codes, []);
  }
  // Heritage surface spellings are provided names too: `define fd :n end` would silence `fd "x"`.
  assert.deepEqual(analyzeBlock('fd "x"', "heritage").codes, ["ol-type"]);
  for (const setup of [
    "define fd :n\nend define",
    // OpenLogo identifiers are case-insensitive, so a mixed-case spelling shadows it too.
    "define FD :n\nend define",
  ]) {
    assert.match(
      analyzeBlock('fd "x"', "heritage", { setup }).setupError,
      /redefines the built-in fd/,
      `setup ${JSON.stringify(setup)} should be rejected`,
    );
  }
  assert.match(
    analyzeBlock('set_shape "bee"', "cased", {
      setup: "define SET_SHAPE :s\nend define",
    }).setupError,
    /redefines the built-in set_shape/,
  );
  // A setup MAY define a name of its own — that is ordinary context.
  assert.equal(
    analyzeBlock("move_and_turn", "helper", {
      setup: "define move_and_turn\n  forward 10\nend define",
    }).setupError,
    null,
  );
});

test("analyzeBlock rejects a setup and block defining the same name, whatever the casing", () => {
  // Procedure resolution is whole-program, so a block redefining a preamble name changes what the
  // preamble means — it is no longer the standalone-clean program that was validated.
  for (const block of [
    "define helper :n\nend define\nhelper 1",
    "define HELPER :n\nend define\nHELPER 1",
  ]) {
    const result = analyzeBlock(block, "clash", {
      setup: "define helper\nend define",
    });
    assert.match(
      result.setupError,
      /both it and the block define helper/,
      `block ${JSON.stringify(block)} should collide`,
    );
    assert.deepEqual(result.codes, []);
  }
});

test("a defect raised inside setup-supplied code fails unsuppressibly and cannot mask a later one", () => {
  // A `define` in the preamble defers its body, so standalone validation says nothing about what
  // is inside it. When the block calls it, the run halts there — so if that diagnostic were an
  // ordinary block code, an expectation declaring it would pass while the block's OWN later
  // defect (`set_shape "bee"`) never executed and was never seen.
  const result = analyzeBlock('helper\nset_shape "bee"', "deferred", {
    startLine: 100,
    setup: 'define helper\n  forward "far"\nend define',
  });
  assert.deepEqual(result.codes, []);
  assert.equal(result.partialFrom, null);
  assert.match(
    result.setupError,
    /the block raised inside this entry's setup-supplied code — ol-type at preamble line 2 .* — a setup must be context the block can use/,
  );
  // And it cannot be declared away by an expectation.
  assert.match(
    describeExpectationMismatch(
      { kind: "prose-fragment", codes: ["ol-type"] },
      result,
    ),
    /setup" preamble is broken/,
  );
});
test("analyzeBlock reports a malformed setup as an internal failure rather than crashing", () => {
  // A non-string setup used to throw out of the gate entirely, past the state built for exactly
  // this: the preamble arithmetic now lives inside the try.
  const result = analyzeBlock("forward 10", "bad-type", { setup: 42 });
  assert.match(result.internalError, /split is not a function|not a function/);
  assert.deepEqual(result.codes, []);
});

test("analyzeBlock scripts a blocking input read from `inputs`", () => {
  const source = ':name = input "who?"\nprint word "hello " :name';
  // With no answer the read is cancelled and line 2 never runs.
  const unanswered = analyzeBlock(source, "unanswered");
  assert.deepEqual(unanswered.codes, ["ol-limit"]);
  // With one, the whole example runs.
  const answered = analyzeBlock(source, "answered", { inputs: ["tom"] });
  assert.deepEqual(answered.codes, []);
  assert.equal(answered.partialFrom, null);
});

// --- suggestExpectation ---------------------------------------------------------------------

test("suggestExpectation prints a pasteable entry using the first non-blank line", () => {
  const suggestion = suggestExpectation(
    { source: "\n\nforward 10\nright 90" },
    ["ol-type"],
    join("scripts", "expectations.json"),
  );
  assert.match(suggestion, /"excerpt":"forward 10"/);
  assert.match(suggestion, /"codes":\["ol-type"\]/);
  assert.match(suggestion, /"why":"TODO/);
  assert.match(suggestion, /scripts\/expectations\.json/);
});

test("suggestExpectation copes with a block that has no non-blank line", () => {
  assert.match(
    suggestExpectation({ source: "" }, ["ol-type"], "x.json"),
    /"excerpt":""/,
  );
});

// --- validateExpectationEntry ---------------------------------------------------------------

test("validateExpectationEntry accepts a well-formed entry of every kind", () => {
  for (const [kind, asserts] of EXPECTATION_KINDS) {
    const entry = {
      fingerprint: "abc",
      kind,
      why: "because",
      [asserts]: asserts === "codes" ? ["ol-type"] : ["modules"],
    };
    if (kind === "known-broken") {
      entry.issue = "#42";
    }
    assert.deepEqual(
      validateExpectationEntry(entry, "spec/x.md", 0),
      [],
      `kind ${kind} should validate`,
    );
  }
});

test("validateExpectationEntry rejects a missing fingerprint, rationale, and kind", () => {
  const problems = validateExpectationEntry(
    { fingerprint: "", kind: "made-up", why: "   ", codes: [] },
    "spec/x.md",
    2,
  );
  assert.equal(problems.length, 3);
  assert.ok(
    problems.every((problem) => problem.startsWith("spec/x.md entry 2:")),
  );
  assert.ok(
    problems.some((problem) => problem.includes('missing "fingerprint"')),
  );
  assert.ok(problems.some((problem) => problem.includes('missing "why"')));
  assert.ok(
    problems.some((problem) => problem.includes('"kind" must be one of')),
  );
});

test("validateExpectationEntry rejects wrongly-typed fingerprint and rationale", () => {
  const problems = validateExpectationEntry(
    { fingerprint: 7, kind: "not-openlogo", why: 7, codes: ["ol-type"] },
    "spec/x.md",
    0,
  );
  assert.equal(problems.length, 2);
});

test("validateExpectationEntry requires the field its kind asserts", () => {
  assert.match(
    validateExpectationEntry(
      { fingerprint: "a", kind: "prose-fragment", why: "w", codes: [] },
      "spec/x.md",
      0,
    )[0],
    /must list the codes it asserts/,
  );
  assert.match(
    validateExpectationEntry(
      { fingerprint: "a", kind: "profile-not-implemented", why: "w" },
      "spec/x.md",
      0,
    )[0],
    /must list the profiles it asserts/,
  );
});

test("validateExpectationEntry rejects a declared code outside @openlogo/core's ol-* registry", () => {
  const problems = validateExpectationEntry(
    {
      fingerprint: "a",
      kind: "prose-fragment",
      why: "w",
      codes: ["ol-type", "gate-threw", "ol-not-real", 42],
    },
    "spec/x.md",
    0,
  );
  // `ol-not-real` is ol-shaped but not in the registry, and 42 is not a string at all.
  assert.match(
    problems[0],
    /must be codes from @openlogo\/core's ol-\* registry/,
  );
  assert.match(problems[0], /gate-threw/);
  assert.match(problems[0], /ol-not-real/);
  assert.match(problems[0], /42/);
});

test("validateExpectationEntry accepts an empty codes list only alongside a setup", () => {
  const base = {
    fingerprint: "a",
    kind: "prose-fragment",
    why: "w",
    codes: [],
  };
  assert.match(
    validateExpectationEntry(base, "spec/x.md", 0)[0],
    /must list the codes it asserts/,
  );
  // With a setup, `codes: []` is a real assertion: "given this context, it runs clean".
  assert.deepEqual(
    validateExpectationEntry({ ...base, setup: ":size = 50" }, "spec/x.md", 0),
    [],
  );
  // Scripted `inputs` are context too.
  assert.deepEqual(
    validateExpectationEntry({ ...base, inputs: ["tom"] }, "spec/x.md", 0),
    [],
  );
  // But only for a prose excerpt: every other kind must still name what it produces.
  assert.match(
    validateExpectationEntry(
      { ...base, kind: "deliberate-error", setup: ":size = 50" },
      "spec/x.md",
      0,
    )[0],
    /must list the codes it asserts/,
  );
});

test("validateExpectationEntry rejects context on a profile-not-implemented entry", () => {
  for (const field of ["setup", "inputs"]) {
    assert.match(
      validateExpectationEntry(
        {
          fingerprint: "a",
          kind: "profile-not-implemented",
          why: "w",
          profiles: ["modules"],
          [field]: field === "setup" ? ":x = 1" : ["tom"],
        },
        "spec/x.md",
        0,
      )[0],
      new RegExp(
        `"${field}" cannot apply to a "profile-not-implemented" entry`,
      ),
    );
  }
});

test("validateExpectationEntry rejects malformed inputs", () => {
  for (const inputs of [[], "tom", [42]]) {
    assert.match(
      validateExpectationEntry(
        {
          fingerprint: "a",
          kind: "prose-fragment",
          why: "w",
          codes: ["ol-type"],
          inputs,
        },
        "spec/x.md",
        0,
      )[0],
      /"inputs" must be a non-empty array/,
      `inputs ${JSON.stringify(inputs)} should be rejected`,
    );
  }
});

test("validateExpectationEntry rejects a non-string setup", () => {
  assert.match(
    validateExpectationEntry(
      {
        fingerprint: "a",
        kind: "prose-fragment",
        why: "w",
        codes: ["ol-type"],
        setup: 7,
      },
      "spec/x.md",
      0,
    )[0],
    /"setup" must be a string of OpenLogo source/,
  );
});

test("validateExpectationEntry allows an issue on any kind but validates its shape", () => {
  const base = {
    fingerprint: "a",
    kind: "not-openlogo",
    why: "w",
    codes: ["ol-bad-token"],
  };
  assert.deepEqual(validateExpectationEntry(base, "spec/x.md", 0), []);
  assert.deepEqual(
    validateExpectationEntry({ ...base, issue: "#42" }, "spec/x.md", 0),
    [],
  );
  assert.match(
    validateExpectationEntry({ ...base, issue: "42" }, "spec/x.md", 0)[0],
    /"issue" must look like "#123"/,
  );
});

test("validateExpectationEntry requires a known-broken entry to carry its tracking issue", () => {
  for (const issue of [undefined, "", "nope", "850"]) {
    assert.match(
      validateExpectationEntry(
        {
          fingerprint: "a",
          kind: "known-broken",
          why: "a real defect",
          issue,
          codes: ["ol-bad-token"],
        },
        "spec/x.md",
        0,
      )[0],
      /must carry its tracking "issue"/,
      `issue ${JSON.stringify(issue)} should be rejected`,
    );
  }
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

// --- describeExpectationMismatch ------------------------------------------------------------

test("describeExpectationMismatch accepts a matching codes expectation", () => {
  assert.equal(
    describeExpectationMismatch(
      { kind: "deliberate-error", codes: ["ol-type", "ol-range"] },
      {
        codes: ["ol-range", "ol-type"],
        unimplementedProfiles: [],
        internalError: null,
        setupError: null,
      },
    ),
    null,
  );
});

test("describeExpectationMismatch names what it got instead", () => {
  const analysis = {
    codes: ["ol-range"],
    unimplementedProfiles: [],
    internalError: null,
    setupError: null,
  };
  assert.match(
    describeExpectationMismatch(
      { kind: "deliberate-error", codes: ["ol-type"] },
      analysis,
    ),
    /expected ol-type but got ol-range/,
  );
  assert.match(
    describeExpectationMismatch(
      { kind: "deliberate-error", codes: ["ol-type"] },
      { ...analysis, codes: [] },
    ),
    /but got a clean run/,
  );
});

test("describeExpectationMismatch asserts the profile set for a skip expectation", () => {
  const expectation = {
    kind: "profile-not-implemented",
    profiles: ["modules", "localization"],
  };
  assert.equal(
    describeExpectationMismatch(expectation, {
      codes: [],
      unimplementedProfiles: ["localization", "modules"],
      internalError: null,
      setupError: null,
    }),
    null,
  );
  assert.match(
    describeExpectationMismatch(expectation, {
      codes: [],
      unimplementedProfiles: ["modules"],
      internalError: null,
      setupError: null,
    }),
    /expected it to need localization, modules but it needs modules/,
  );
  assert.match(
    describeExpectationMismatch(expectation, {
      codes: [],
      unimplementedProfiles: [],
      internalError: null,
      setupError: null,
    }),
    /no unimplemented profile — it can run now/,
  );
});

test("describeExpectationMismatch never lets an expectation excuse an internal failure", () => {
  assert.match(
    describeExpectationMismatch(
      { kind: "deliberate-error", codes: ["ol-type"] },
      {
        codes: [],
        unimplementedProfiles: [],
        internalError: "boom",
        setupError: null,
      },
    ),
    /the gate itself threw \(boom\), which no expectation may declare/,
  );
});

test("describeExpectationMismatch blames a broken setup on the entry, not the document", () => {
  assert.match(
    describeExpectationMismatch(
      { kind: "prose-fragment", codes: [] },
      {
        codes: [],
        unimplementedProfiles: [],
        internalError: null,
        setupError: "ol-undefined-var: :nope has no value yet",
      },
    ),
    /this entry's own "setup" preamble is broken \(ol-undefined-var[^)]*\) — fix the preamble/,
  );
});

test("the gate fails an entry whose setup preamble is itself broken", () => {
  const source = "forward :size";
  writeMarkdown("excerpt.md", logoBlock(source));
  const result = runOverTemp({
    [keyFor("excerpt.md")]: [
      expectationFor(source, {
        kind: "prose-fragment",
        why: "context from the prose",
        codes: [],
        setup: ":size = :typo_in_the_preamble",
      }),
    ],
  });
  assert.equal(result.ok, false);
  assert.match(result.lines[0], /this entry's own "setup" preamble is broken/);
});

test("the gate runs a listed excerpt to completion when its setup supplies the context", () => {
  const source = 'forward :size\nset_shape "arrow"';
  writeMarkdown("excerpt.md", logoBlock(source));
  const expectations = {
    [keyFor("excerpt.md")]: [
      expectationFor(source, {
        kind: "prose-fragment",
        why: ":size comes from the surrounding prose",
        codes: [],
        setup: ":size = 50",
      }),
    ],
  };
  const passing = runOverTemp(expectations);
  assert.equal(passing.ok, true);
  assert.equal(passing.counts.partial, 0);

  // …and the second line is genuinely executed: break it and the gate notices.
  writeMarkdown("excerpt.md", logoBlock('forward :size\nset_shape "bee"'));
  assert.equal(runOverTemp(expectations).ok, false);
});

// --- runMarkdownExamplesGate ----------------------------------------------------------------

test("the gate passes a clean corpus and counts what it checked", () => {
  writeMarkdown("clean.md", logoBlock("forward 10\nright 90"));
  const result = runOverTemp();
  assert.equal(result.ok, true);
  assert.deepEqual(result.counts, {
    total: 1,
    clean: 1,
    expected: 0,
    knownBroken: 0,
    partial: 0,
    failed: 0,
  });
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

test("the gate fails an unlisted block that raises any diagnostic, and says how to triage it", () => {
  writeMarkdown("fragment.md", logoBlock("forward :size"));
  const result = runOverTemp();
  assert.equal(result.ok, false);
  // The headline leads with the offending line, not the fence, so a CI-log skim lands on it.
  assert.match(
    result.lines[0],
    /FAIL .*fragment\.md:2: ol-undefined-var \(in the logo block opening at .*fragment\.md:1\)/,
  );
  assert.match(result.lines[1], /:2: ol-undefined-var — /);
  assert.ok(
    result.lines.some((line) => /add to .*: \{"fingerprint"/.test(line)),
    "the report offers the manifest entry to paste after triage",
  );
});

test("the gate fails an unterminated fence, which would swallow later blocks", () => {
  writeMarkdown("broken.md", ["```logo", "forward 10"].join("\n"));
  const result = runOverTemp();
  assert.equal(result.ok, false);
  assert.match(result.lines[0], /is never closed/);
});

test("the gate refuses to silently skip a block needing an unimplemented profile", () => {
  writeMarkdown("one.md", logoBlock("alias avance forward"));
  writeMarkdown(
    "two.md",
    logoBlock('# module: francais\nalias avance forward\nimport "x"'),
  );
  const result = runOverTemp();
  assert.equal(result.ok, false);
  assert.match(
    result.lines[0],
    /needs localization, which no implementation provides yet/,
  );
  assert.match(
    result.lines[1],
    /needs localization, modules, which no implementation provides yet/,
  );
  assert.ok(result.lines.every((line) => !line.startsWith("SKIP")));
});

test("a listed profile-not-implemented block passes and is counted as asserted", () => {
  const source = "alias avance forward";
  writeMarkdown("localized.md", logoBlock(source));
  const result = runOverTemp({
    [keyFor("localized.md")]: [
      expectationFor(source, {
        kind: "profile-not-implemented",
        why: "Localization has no implementation yet",
        codes: undefined,
        profiles: ["localization"],
      }),
    ],
  });
  assert.equal(result.ok, true);
  assert.equal(result.counts.expected, 1);
});

test("an expected-diagnostic block passes when it produces exactly its declared codes", () => {
  const source = 'set_shape "bee"';
  writeMarkdown("expected.md", logoBlock(source));
  const result = runOverTemp({
    [keyFor("expected.md")]: [expectationFor(source)],
  });
  assert.equal(result.ok, true);
  assert.equal(result.counts.expected, 1);
});

test("a listed block is analyzed for real, not waved through by a profile mention", () => {
  // Declaring anything other than profile-not-implemented turns profile gating off, so the block
  // cannot hide a diagnostic behind an incidental unimplemented-profile spelling. `explain` is an
  // Educational primitive — unimplemented — but it parses, so the rest of the block is real
  // OpenLogo and its bad shape word is a genuine defect.
  const source = 'set_shape "bee"\nexplain';
  writeMarkdown("mixed.md", logoBlock(source));

  // Left to the profile gate, the block would be skipped whole and the bad shape word never seen.
  assert.deepEqual(analyzeBlock(source, "mixed").codes, []);

  const result = runOverTemp({
    [keyFor("mixed.md")]: [
      expectationFor(source, {
        kind: "prose-fragment",
        codes: ["ol-undefined-var"],
      }),
    ],
  });
  assert.equal(result.ok, false);
  assert.match(result.lines[0], /expected ol-undefined-var but got ol-type/);
});

test("a known-broken block passes but is announced on every run", () => {
  const source = ":x = [1, 2, 3]";
  writeMarkdown("defect.md", logoBlock(source));
  const result = runOverTemp({
    [keyFor("defect.md")]: [
      expectationFor(source, {
        kind: "known-broken",
        issue: "#851",
        why: "commas are not OpenLogo",
        codes: ["ol-bad-token"],
      }),
    ],
  });
  assert.equal(result.ok, true);
  assert.equal(result.counts.knownBroken, 1);
  assert.match(
    result.lines[0],
    /^KNOWN-BROKEN .*defect\.md:1 \(#851\): commas are not OpenLogo$/,
  );
  assert.match(result.lines.at(-1), /of which 1 known-broken/);
});

test("a listed excerpt that stops the runtime early is announced as PARTIAL, not silently passed", () => {
  // The QA finding this exists for: `execute()` halts at the first error, so a runtime-only defect
  // BELOW that line is never observed. The block still passes — its declared codes match — but the
  // gate says out loud how far it actually got, so nobody reads green as "every line ran".
  const source = 'forward :size\nset_shape "bee"';
  writeMarkdown("excerpt.md", logoBlock(source));
  const result = runOverTemp({
    [keyFor("excerpt.md")]: [
      expectationFor(source, {
        kind: "prose-fragment",
        why: ":size is assigned in the surrounding prose",
        codes: ["ol-undefined-var"],
      }),
    ],
  });
  assert.equal(result.ok, true);
  assert.equal(result.counts.partial, 1);
  assert.match(
    result.lines[0],
    /^PARTIAL .*excerpt\.md:1: execution stopped at line 2$/,
  );
  assert.match(result.lines.at(-2), /and 1 only partially executed/);
  assert.match(result.lines.at(-1), /^ {2}PARTIAL means the runtime stopped/);
});

test("the gate fails a listed block whose codes changed", () => {
  const source = 'set_shape "bee"';
  writeMarkdown("expected.md", logoBlock(source));
  const result = runOverTemp({
    [keyFor("expected.md")]: [expectationFor(source, { codes: ["ol-range"] })],
  });
  assert.equal(result.ok, false);
  assert.match(result.lines[0], /expected ol-range but got ol-type/);
  assert.match(result.lines[1], /ol-type — /);
});

test("the gate fails a stale expectation whose block became clean", () => {
  const source = "forward 10";
  writeMarkdown("fixed.md", logoBlock(source));
  const result = runOverTemp({
    [keyFor("fixed.md")]: [expectationFor(source, { why: "used to be wrong" })],
  });
  assert.equal(result.ok, false);
  assert.match(result.lines[0], /but got a clean run/);
});

test("the gate fails an expectation whose fingerprint matches no block", () => {
  writeMarkdown("clean.md", logoBlock("forward 10"));
  const result = runOverTemp({
    [keyFor("clean.md")]: [
      expectationFor("gone", { fingerprint: "0000000000000000" }),
    ],
  });
  assert.equal(result.ok, false);
  assert.match(result.lines[0], /stale expectation .* matches no logo block/);
});

test("a stale-expectation report copes with an entry that has no excerpt", () => {
  writeMarkdown("clean.md", logoBlock("forward 10"));
  const result = runOverTemp({
    [keyFor("clean.md")]: [
      expectationFor("gone", {
        fingerprint: "0000000000000000",
        excerpt: undefined,
      }),
    ],
  });
  assert.equal(result.ok, false);
  assert.match(result.lines[0], /entry 0 \(\)/);
});

test("the gate fails a malformed expectation entry", () => {
  writeMarkdown("clean.md", logoBlock("forward 10"));
  const result = runOverTemp({
    [keyFor("clean.md")]: [
      { fingerprint: "abc", kind: "typo", why: "", codes: [] },
    ],
  });
  assert.equal(result.ok, false);
  assert.ok(
    result.lines.some((line) => line.includes('"kind" must be one of')),
  );
});

test("the gate does not also analyse a block whose entry failed validation", () => {
  // A non-string `setup` used to reach analyzeBlock and throw out of the whole run, so no other
  // finding was reported at all. The entry's own problem is the finding; the block is left alone.
  const source = "forward 10";
  writeMarkdown("clean.md", logoBlock(source));
  const result = runOverTemp({
    [keyFor("clean.md")]: [
      expectationFor(source, { kind: "prose-fragment", setup: 42 }),
    ],
  });
  assert.equal(result.ok, false);
  assert.equal(result.counts.failed, 1);
  assert.match(result.lines[0], /"setup" must be a string of OpenLogo source/);
  // No second, confusing failure for the same cause — and no stale-expectation noise either.
  assert.ok(result.lines.every((line) => !line.includes("stale expectation")));
});

test("the gate fails two entries that pin the same block, since one of them is dead", () => {
  const source = 'set_shape "bee"';
  writeMarkdown("expected.md", logoBlock(source));
  const entry = expectationFor(source);
  const result = runOverTemp({
    [keyFor("expected.md")]: [entry, { ...entry }],
  });
  assert.equal(result.ok, false);
  assert.ok(
    result.lines.some((line) => line.includes("duplicate fingerprint")),
  );
});

test("the gate fails when one expectation would excuse two identical blocks", () => {
  const source = 'set_shape "bee"';
  writeMarkdown("twice.md", logoBlock(source) + logoBlock(source));
  const result = runOverTemp({
    [keyFor("twice.md")]: [expectationFor(source)],
  });
  assert.equal(result.ok, false);
  assert.match(
    result.lines[0],
    /a second block in this file has the same content/,
  );
});

test("the gate reports an internal failure rather than crashing, listed or not", () => {
  writeMarkdown("deep.md", logoBlock(STACK_BUSTING_SOURCE));
  const unlisted = runOverTemp();
  assert.equal(unlisted.ok, false);
  assert.match(unlisted.lines[0], /the gate threw — .*call stack/i);

  const listed = runOverTemp({
    [keyFor("deep.md")]: [expectationFor(STACK_BUSTING_SOURCE)],
  });
  assert.equal(listed.ok, false);
  assert.match(listed.lines[0], /which no expectation may declare/);
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
  assert.match(
    result.lines[0],
    /FAIL .*turtles-and-sprites\.md:4: ol-type \(in the logo block opening at .*:1\)$/,
  );
  // The report quotes the learner message, so a human can find it without re-running anything…
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

test("SELF-TEST: a misspelled command name fails even though it looks like a prose excerpt", () => {
  // `forwad 100` is indistinguishable by diagnostic code from a legitimate excerpt calling a
  // procedure defined in the surrounding prose. An earlier design auto-tolerated that pairing and
  // would have swallowed this; the manifest rule does not.
  writeMarkdown("typo.md", logoBlock("forwad 100"));
  const result = runOverTemp();
  assert.equal(result.ok, false);
  assert.match(result.lines[0], /ol-bad-token, ol-unknown-command/);
  assert.ok(
    result.lines.some((line) => line.includes("did you mean forward?")),
    "the report quotes the did-you-mean message",
  );
});

test("SELF-TEST: a mistyped variable inside a listed excerpt fails, because editing re-fingerprints it", () => {
  const original = "forward :size";
  const typo = "forward :szie";
  writeMarkdown("excerpt.md", logoBlock(original));
  const expectations = {
    [keyFor("excerpt.md")]: [
      expectationFor(original, {
        kind: "prose-fragment",
        why: ":size is assigned in the surrounding prose",
        codes: ["ol-undefined-var"],
      }),
    ],
  };
  assert.equal(runOverTemp(expectations).ok, true);

  writeMarkdown("excerpt.md", logoBlock(typo));
  const result = runOverTemp(expectations);
  assert.equal(result.ok, false);
  assert.ok(result.lines.some((line) => line.includes("stale expectation")));
});

test("SELF-TEST: the real spec/ + docs/ corpus is green against the committed manifest", () => {
  const result = runMarkdownExamplesGate();
  assert.equal(
    result.ok,
    true,
    `markdown examples gate failed:\n${result.lines.join("\n")}`,
  );
  assert.ok(result.counts.total > 300);
});

// --- parseArgs + CLI shell ------------------------------------------------------------------

test("parseArgs collects repeated --root flags and --expectations", () => {
  assert.deepEqual(
    parseArgs(["--root=spec", "--root=docs", "--expectations=x.json"]),
    { roots: ["spec", "docs"], expectationsPath: "x.json" },
  );
});

test("parseArgs leaves both options undefined when nothing is passed", () => {
  assert.deepEqual(parseArgs(["--unrelated"]), {
    roots: undefined,
    expectationsPath: undefined,
  });
});

/** Run the CLI shell over the temp directory with an empty on-disk manifest. */
function runCli() {
  const expectationsPath = join(TEMP_DIR, "expectations.json");
  writeFileSync(expectationsPath, JSON.stringify({}), "utf8");
  return spawnSync(
    process.execPath,
    [
      join("scripts", "check-markdown-examples.mjs"),
      `--root=${TEMP_DIR}`,
      `--expectations=${expectationsPath}`,
    ],
    { encoding: "utf8" },
  );
}

test("the CLI shell exits 0 and prints the report for a clean corpus", () => {
  writeMarkdown("clean.md", logoBlock("forward 10"));
  const run = runCli();
  assert.equal(run.status, 0);
  assert.match(run.stdout, /1 logo block\(s\) — 1 clean/);
});

test("the CLI shell exits 1 when a block regresses", () => {
  writeMarkdown("regressed.md", logoBlock('set_shape "bee"'));
  const run = runCli();
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
