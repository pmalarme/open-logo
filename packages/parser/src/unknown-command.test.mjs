import assert from "node:assert/strict";
import { test } from "node:test";
import * as OL from "@openlogo/parser";

/**
 * Unit tests for the `ol-unknown-command` rule (issue #117) — the checker-rule LEAD slice.
 * Behavior is verified directly against the built `check()` entry point, per the shared
 * black-box test convention (co-located `*.test.mjs` importing only `@openlogo/parser`).
 */

function checkSource(source, profiles) {
  const { ast, diagnostics: parseDiagnostics } = OL.parse(source, "unit.logo");
  assert.deepEqual(
    parseDiagnostics,
    [],
    `expected clean parse for ${JSON.stringify(source)}`,
  );
  return OL.check(ast, { profiles }).diagnostics;
}

test("flags an unknown callee and suggests the nearest visible Core primitive", () => {
  const diagnostics = checkSource("(prnt 5)", ["core-language"]);
  assert.equal(diagnostics.length, 1);
  const [finding] = diagnostics;
  assert.equal(finding.code, "ol-unknown-command");
  assert.equal(finding.stage, "semantic");
  assert.equal(finding.severity, "error");
  assert.deepEqual(finding.params, { name: "prnt", suggestion: "print" });
});

test("message template matches spec/error-model.md:96 exactly, with a suggestion", () => {
  const [finding] = checkSource("(prnt 5)", ["core-language"]);
  assert.equal(
    finding.message,
    "i don't know how to prnt. did you mean print?",
  );
});

test("message template omits a did-you-mean clause when no candidate qualifies", () => {
  const [finding] = checkSource("xyzxyzxyz", ["core-language"]);
  assert.deepEqual(finding.params, { name: "xyzxyzxyz" });
  assert.equal(
    finding.message,
    "i don't know how to xyzxyzxyz. check the spelling, or define it with 'define'.",
  );
});

test("a correctly-spelled Core primitive call is never flagged", () => {
  assert.deepEqual(checkSource("print 1", ["core-language"]), []);
});

test("a correctly-spelled call in parenthesized (variadic) form is never flagged", () => {
  assert.deepEqual(checkSource("(print 1 2)", ["core-language"]), []);
});

test("a correctly-spelled user-declared procedure call is never flagged", () => {
  const source = "define greet\n  print 1\nend\n\ngreet\n";
  assert.deepEqual(checkSource(source, ["core-language"]), []);
});

test("a bare variable read is never flagged as ol-unknown-command (ol-undefined-var is a different rule's job)", () => {
  const diagnostics = checkSource("print :x", ["core-language"]).filter(
    (d) => d.code === "ol-unknown-command",
  );
  assert.deepEqual(diagnostics, []);
});

test("a typo of a reserved structural word is suggested (reserved words are candidates)", () => {
  const [finding] = checkSource("repaet", ["core-language"]);
  assert.deepEqual(finding.params, { name: "repaet", suggestion: "repeat" });
});

test("grammar operator callees (+, -, mod, and, or, not, comparisons) are never flagged", () => {
  const sources = [
    "print 1 + 2",
    "print 1 - 2",
    "print 2 * 3",
    "print 6 / 2",
    "print 5 mod 2",
    "print true and false",
    "print true or false",
    "print not true",
    "print 1 < 2",
    "print 1 <= 2",
    "print 1 > 2",
    "print 1 >= 2",
    "print 1 == 2",
    "print 1 != 2",
  ];
  for (const source of sources) {
    assert.deepEqual(
      checkSource(source, ["core-language"]),
      [],
      `expected no diagnostics for ${JSON.stringify(source)}`,
    );
  }
});

test("at Core-only (turtle-rendering NOT active), forward is still not visible: fowad is unknown with NO suggestion", () => {
  // forward is a Turtle & Rendering primitive; when that profile is not part of the active set,
  // fowad's nearest visible candidate is still out of reach, exactly as before issue #136.
  const [finding] = checkSource("(fowad 100)", ["core-language"]);
  assert.equal(finding.code, "ol-unknown-command");
  assert.deepEqual(finding.params, { name: "fowad" });
  assert.equal(finding.params.suggestion, undefined);
});

test("issue #136 / spec/tooling.md:200-207 worked example: with turtle-rendering active, fowad suggests forward", () => {
  // Parenthesized form, per the same reasoning as the Core-only known-gap test above: an
  // unrecognized bare callee's arity falls back to 0 in the reader, so a bare `fowad 100` would
  // leave `100` as a stray second statement on the line (a parse-stage ol-bad-token) — orthogonal
  // to this rule. `(fowad 100)` groups the argument explicitly, isolating the semantic finding.
  const [finding] = checkSource("(fowad 100)", [
    "core-language",
    "turtle-rendering",
  ]);
  assert.equal(finding.code, "ol-unknown-command");
  assert.equal(finding.stage, "semantic");
  assert.equal(finding.severity, "error");
  assert.deepEqual(finding.params, { name: "fowad", suggestion: "forward" });
  assert.equal(
    finding.message,
    "i don't know how to fowad. did you mean forward?",
  );
});

test("did-you-mean tie-break (spec/error-model.md:146-147): a Core word beats an optional-profile word at the same edit distance", () => {
  // "clea" is Levenshtein distance 1 from BOTH the reserved word "clear" (Core) and the Turtle &
  // Rendering primitive "clean" (optional profile) — a genuine tie now that turtle names are
  // registered (issue #136). The spec requires Core to win the tie, never lexicographic order
  // alone (which would otherwise pick "clean" over "clear").
  const [finding] = checkSource("(clea)", [
    "core-language",
    "turtle-rendering",
  ]);
  assert.equal(finding.code, "ol-unknown-command");
  assert.deepEqual(finding.params, { name: "clea", suggestion: "clear" });
});

test("profile gating: when core-language is not active, Core primitives are not visible", () => {
  const diagnostics = checkSource("print", []);
  assert.equal(diagnostics.length, 1);
  assert.deepEqual(diagnostics[0].params, { name: "print" });
});

test("profile gating: when core-language is active, Core primitives are visible", () => {
  // A complete call: `print 1` exercises visibility without tripping the arity rule (#111),
  // which — correctly — treats a bare zero-argument `print` as `ol-not-enough-inputs`.
  assert.deepEqual(checkSource("print 1", ["core-language"]), []);
});

test("profile gating: when turtle-rendering is not active, Turtle & Rendering primitives are not visible", () => {
  const diagnostics = checkSource("(forward 100)", ["core-language"]);
  assert.equal(diagnostics.length, 1);
  assert.deepEqual(diagnostics[0].params, { name: "forward" });
});

test("profile gating: when turtle-rendering is active, Turtle & Rendering primitives are visible", () => {
  assert.deepEqual(
    checkSource("forward 100", ["core-language", "turtle-rendering"]),
    [],
  );
});

test("the ol-unknown-command rule stays profile-generic: turtle primitives are never hardcoded into the Core-only visible set", () => {
  // Core-only active: none of the turtle-rendering primitives are visible, so each is reported
  // as unknown — confirming checker-names.ts gates the turtle table on its own profile flag
  // rather than always including it.
  for (const name of ["forward", "back", "left", "right", "pen_up"]) {
    const [finding] = checkSource(`(${name})`, ["core-language"]);
    assert.equal(finding.code, "ol-unknown-command");
    assert.equal(finding.params.name, name);
  }
});

test("profile gating: user-declared procedures are visible regardless of active profiles", () => {
  const source = "define greet\n  print 1\nend\n\ngreet\n";
  // core-language is NOT active here, so `print` inside the body is itself flagged, but the
  // call to `greet` must not be — procedure visibility does not depend on profile gating.
  const diagnostics = checkSource(source, []);
  assert.ok(
    diagnostics.every((d) => d.params.name !== "greet"),
    "the call to the declared procedure `greet` must not be flagged",
  );
});

// --- profile block-heads are gated exactly like any other call-site name (issue #664) ---
// The reader is profile-blind, so it always lowers a registered profile head (`ask`/`each`/`tell`
// and the four event heads) into a `ProfileStatement`. In a Core-only program none of those words
// is made visible by any active profile, so `ol-unknown-command` MUST flag them — otherwise a
// Core-only program would silently accept e.g. `tell 5` (a false-accept), violating the
// Core-neutrality guarantee of `spec/interaction-events.md` §Profiles and reservation. Once a
// profile is active, its per-profile checker slice (#674 registers Sprites' `tell`, #687
// Interaction) registers the head name in `collectVisibleNames` and the diagnostic disappears —
// the C2 slice (#664) itself adds no per-profile name table, only the shared-node walk.

test("a bodyless profile head (`tell 5`) is flagged ol-unknown-command in a Core-only program", () => {
  // `tell 5` parses cleanly (bodyless mode-switch shape), so without the ProfileStatement gate it
  // would be silently accepted — the exact false-accept this test locks out.
  const diagnostics = checkSource("tell 5", ["core-language"]);
  assert.equal(diagnostics.length, 1);
  const [finding] = diagnostics;
  assert.equal(finding.code, "ol-unknown-command");
  assert.equal(finding.params.name, "tell");
  assert.equal(finding.stage, "semantic");
  assert.equal(finding.severity, "error");
});

test("every registered profile head is flagged ol-unknown-command when its profile is inactive", () => {
  // `tell` is bodyless; the block heads need a block to parse cleanly for this checker-only assertion.
  const cases = [
    "tell 5",
    "ask :fish [ hint ]",
    "each [ hint ]",
    "when :e [ hint ]",
    "every :e [ hint ]",
    "on_key :k [ hint ]",
    "on_click [ hint ]",
  ];
  for (const source of cases) {
    const { ast } = OL.parse(source, "unit.logo");
    const diagnostics = OL.check(ast, {
      profiles: ["core-language"],
    }).diagnostics;
    const head = source.split(/[\s:[]/, 1)[0];
    assert.ok(
      diagnostics.some(
        (d) => d.code === "ol-unknown-command" && d.params.name === head,
      ),
      `expected ol-unknown-command for the inactive profile head ${JSON.stringify(head)}`,
    );
  }
});

test("the profile-head diagnostic points at the head keyword's own span", () => {
  const { ast } = OL.parse("tell 5", "unit.logo");
  const [finding] = OL.check(ast, {
    profiles: ["core-language"],
  }).diagnostics;
  // `tell` occupies columns 1-4 on line 1.
  assert.deepEqual(finding.source_span.start, [1, 1]);
  assert.deepEqual(finding.source_span.end, [1, 5]);
});

// --- Sprites registers `tell` as a visible command name (issue #674, SP2) ---
// The other half of the slice: registering the runtime semantics is not enough — with `sprites`
// active the checker must ALSO recognize `tell` as a visible head, or `unknownCommandRule` would
// still reject it `ol-unknown-command` (the C2 gate is live). `ask` is registered by SP3 (#675);
// `each` lands with its executing slice (#676).

test("`tell` checks clean under an active sprites profile (its head name is visible)", () => {
  const diagnostics = checkSource(":x = 1\ntell :x", ["sprites"]);
  assert.deepEqual(diagnostics, []);
});

test("a typo of `tell` suggests it under sprites (tell is in the did-you-mean candidate set)", () => {
  // `tel` is distance 1 from `tell`; with sprites active `tell` is a visible candidate.
  const { ast } = OL.parse(":x = 1\ntel :x", "unit.logo");
  const diagnostics = OL.check(ast, { profiles: ["sprites"] }).diagnostics;
  const finding = diagnostics.find(
    (d) => d.code === "ol-unknown-command" && d.params.name === "tel",
  );
  assert.ok(finding, "expected an ol-unknown-command for the typo `tel`");
  assert.equal(finding.params.suggestion, "tell");
});

test("`tell` stays unknown when sprites is inactive even though other profiles are active", () => {
  const diagnostics = checkSource(":x = 1\ntell :x", [
    "core-language",
    "turtle-rendering",
  ]);
  const finding = diagnostics.find((d) => d.code === "ol-unknown-command");
  assert.ok(finding, "expected tell to be unknown without sprites");
  assert.equal(finding.params.name, "tell");
});

// --- Sprites registers `ask` as a visible command name (issue #675, SP3) ---
// `ask` is the scoped block-head this slice runs. Like `tell`, registering the runtime semantics is
// not enough: with `sprites` active the checker must ALSO recognize `ask` as a visible head, or
// `unknownCommandRule` would reject the parsed `ProfileStatement` `ol-unknown-command` (the C2 gate
// is live). These lock BOTH halves of the slice — parses AND checks clean under sprites, still
// rejected Core-only.

test("`ask` checks clean under an active sprites profile (its head name is visible)", () => {
  const diagnostics = checkSource(":x = 1\nask :x [ forward 10 ]", [
    "sprites",
    "turtle-rendering",
  ]);
  assert.deepEqual(diagnostics, []);
});

test("a typo of `ask` suggests it under sprites (ask is in the did-you-mean candidate set)", () => {
  // `sk` is distance 1 from `ask`; with sprites active `ask` is a visible candidate. Written as a
  // bodyless head so the program parses cleanly for this checker-only assertion.
  const { ast } = OL.parse(":x = 1\nsk :x", "unit.logo");
  const diagnostics = OL.check(ast, { profiles: ["sprites"] }).diagnostics;
  const finding = diagnostics.find(
    (d) => d.code === "ol-unknown-command" && d.params.name === "sk",
  );
  assert.ok(finding, "expected an ol-unknown-command for the typo `sk`");
  assert.equal(finding.params.suggestion, "ask");
});

test("`ask` stays unknown when sprites is inactive even though other profiles are active", () => {
  const diagnostics = checkSource("ask :x [ hint ]", [
    "core-language",
    "turtle-rendering",
  ]);
  const finding = diagnostics.find((d) => d.code === "ol-unknown-command");
  assert.ok(finding, "expected ask to be unknown without sprites");
  assert.equal(finding.params.name, "ask");
});

// --- Sprites registers `each` as a visible command name (issue #676, SP4) ---
// `each` is the once-per-turtle block-head this slice runs. Like `tell`/`ask`, registering the
// runtime semantics is not enough: with `sprites` active the checker must ALSO recognize `each` as a
// visible head, or `unknownCommandRule` would reject the parsed `ProfileStatement` `ol-unknown-command`
// (the C2 gate is live). These lock BOTH halves — parses AND checks clean under sprites, still
// rejected Core-only.

test("`each` checks clean under an active sprites profile (its head name is visible)", () => {
  const diagnostics = checkSource("each [ forward 10 ]", [
    "sprites",
    "turtle-rendering",
  ]);
  assert.deepEqual(diagnostics, []);
});

test("a typo of `each` suggests it under sprites (each is in the did-you-mean candidate set)", () => {
  // `eah` is distance 1 from `each`; with sprites active `each` is a visible candidate. Written as a
  // bodyless head so the program parses cleanly for this checker-only assertion.
  const { ast } = OL.parse("eah", "unit.logo");
  const diagnostics = OL.check(ast, { profiles: ["sprites"] }).diagnostics;
  const finding = diagnostics.find(
    (d) => d.code === "ol-unknown-command" && d.params.name === "eah",
  );
  assert.ok(finding, "expected an ol-unknown-command for the typo `eah`");
  assert.equal(finding.params.suggestion, "each");
});

test("`each` stays unknown when sprites is inactive even though other profiles are active", () => {
  const diagnostics = checkSource("each [ forward 10 ]", [
    "core-language",
    "turtle-rendering",
  ]);
  const finding = diagnostics.find((d) => d.code === "ol-unknown-command");
  assert.ok(finding, "expected each to be unknown without sprites");
  assert.equal(finding.params.name, "each");
});

test("tie-break is deterministic: equal-distance candidates resolve lexicographically", () => {
  // `xat` is distance 1 from both `hat` and `bat`; `hat` is declared (and so inserted into the
  // candidate set) first, so this also exercises the branch where a later, lexicographically
  // smaller candidate overtakes an earlier tie leader.
  const source =
    "define hat\n  print 1\nend\ndefine bat\n  print 1\nend\nxat\n";
  const diagnostics = checkSource(source, []);
  const xat = diagnostics.find((d) => d.params.name === "xat");
  assert.ok(xat, "expected a finding for the unknown callee xat");
  assert.deepEqual(xat.params, { name: "xat", suggestion: "bat" });
});

test("tie-break prefers a reserved word over a declared procedure at the same distance, lexicographically", () => {
  // With core-language active, `at` (reserved) and `cat`/`bat`/`hat` (declared) are all
  // distance 1 from `xat`; `at` sorts first lexicographically.
  const source =
    "define cat\n  print 1\nend\ndefine hat\n  print 1\nend\ndefine bat\n  print 1\nend\nxat\n";
  const diagnostics = checkSource(source, ["core-language"]);
  assert.equal(diagnostics.length, 1);
  assert.deepEqual(diagnostics[0].params, { name: "xat", suggestion: "at" });
});
