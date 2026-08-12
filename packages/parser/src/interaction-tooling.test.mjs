// Unit tests for the **tooling** view of the Interaction & Events profile's five implemented names
// — the block-heads `when`/`every`/`on_key`/`on_click` (issues #682–#685, slices I3–I6) and the
// `wait <n>` primitive (issue #680, slice I1). This file is slice I8 of the Interaction epic #661
// (`spec/tooling.md`'s token classes + three checker layers, `spec/interaction-events.md`'s
// "Profiles and reservation" section).
//
// Two shapes with deliberately different mechanics — proven not to leak into each other:
//
//   1. Block-head forms `when`/`every`/`on_key`/`on_click` lower to a `ProfileStatement` and are
//      reserved words *only when the Interaction & Events profile is active*
//      (`spec/interaction-events.md`: "They are reserved **only within the Interaction & Events
//      profile**"). Slices I3–I6 already taught the Layer-2 checker to treat them as visible
//      command names (`interactionEventsBlockHeadNames` in `collectVisibleNames`), so this slice
//      LOCKS that half with fixtures rather than re-adding it.
//   2. `wait` is an ordinary Kind-C primitive in the arity table (`spec/interaction-events.md`'s
//      "Profiles and reservation" table: `wait <n>` | C | number). I1 registered its *reader*
//      arity but deliberately deferred its *checker visibility* to this slice; before I8 `wait`
//      raised `ol-unknown-command` even under an active `interaction-events` profile — a profile
//      whose own primitive is unknown is not conformant. I8 registers it in `collectVisibleNames`'
//      `interaction-events` gate (via `interactionPrimitiveNames()`), so it now checks clean with
//      the profile active and stays `ol-unknown-command` without it. I8 also gives `wait` the
//      static arity range its fixed-arity shape requires, so a wrong input count is caught at
//      `stage=semantic` exactly as Sound's identically-shaped `set_tempo` already was.
//
// `input` is deliberately NOT covered here: its slice (#681, I2) is unimplemented, so it has no
// arity entry and is not a visible name. Registering it as a known callee while no evaluator
// exists would let a program check clean and then fail at runtime — a false tooling claim, worse
// for a learner than the honest `ol-unknown-command`. Its tooling ships with its evaluator.
//
// Highlighting is currently **profile-blind**: `highlight()`/`semanticTokens()` take no active-
// profile argument, so they emit the profile-neutral fallback `primitive` for all five names. Note
// this is a KNOWN DEVIATION from the normative token-class model, not the final word:
// `spec/tooling.md:30` puts "profile block-heads when their profile is active" in the `keyword`
// class, so under an active `interaction-events` profile the four block-heads SHOULD ultimately be
// `keyword`. The parser cannot express that yet — giving the highlighter a profile set changes one
// of the four shared cross-package contracts and is tracked as its own serialized slice, issue
// #740. `wait` is unaffected either way: it is an ordinary Kind-C primitive, so `primitive` is its
// correct final class (as it is for the Sound commands, `spec/interaction-events.md`: "Sound
// command names are ordinary primitive names when the Sound profile is present").
//
// The assertions below therefore lock TODAY's profile-neutral fallback so the behavior is
// intentional and visible rather than accidental — matching `sound-tooling.test.mjs` and
// `sprites-tooling.test.mjs`. #740 updates all three together.
//
// Every name is exercised in **awkward positions** — inside a `[ … ]` instruction block, inside
// `repeat`, inside an `if`, and nested in a procedure body — via one shared whole-program constant,
// so a regression that only handled a top-level occurrence (or only a subset of the five names)
// cannot slip through.

import assert from "node:assert/strict";
import { test } from "node:test";
import * as OL from "@openlogo/parser";

const doc = "interaction-tooling.logo";

const INTERACTION_PROFILES = [
  "core-language",
  "turtle-rendering",
  "interaction-events",
];
const CORE_PROFILES = ["core-language", "turtle-rendering"];

/** Every Interaction block-head, one representative correct occurrence each. */
const INTERACTION_BLOCK_HEADS = Object.freeze({
  when: 'when "start" [ forward 10 ]',
  every: "every 2 [ forward 10 ]",
  on_key: 'on_key "a" [ forward 10 ]',
  on_click: "on_click [ forward 10 ]",
});

/** The profile's ordinary primitives, one representative correct call each. */
const INTERACTION_PRIMITIVES = Object.freeze({
  wait: "wait 1",
});

/** All five implemented Interaction names, block-heads and primitives together. */
const INTERACTION_NAMES = Object.freeze([
  ...Object.keys(INTERACTION_BLOCK_HEADS),
  ...Object.keys(INTERACTION_PRIMITIVES),
]);

/**
 * A whole Interaction program placing every one of the five names in an awkward position — a
 * procedure body, inside `repeat`, and inside a `[ … ]` block — so a regression that only handled a
 * top-level occurrence of one name cannot pass. Not one of the five sits at top level. Each of the
 * five spellings occurs exactly once, letting the highlighting/semantic-token assertions count
 * `=== 1` per name.
 *
 *   - `wait 1`   — inside a `[ … ]` block inside `repeat`, inside `tick`'s procedure body.
 *   - `when`     — inside `arm`'s procedure body.
 *   - `every`    — inside a `[ … ]` block inside `repeat`, inside `arm`'s body.
 *   - `on_key`   — inside an `if` block inside `arm`'s body.
 *   - `on_click` — inside a `[ … ]` block inside `repeat`, at top level.
 */
const NESTED_INTERACTION_PROGRAM = [
  "define tick",
  "  repeat 2 [ wait 1 ]",
  "end",
  "define arm",
  '  when "start" [ tick ]',
  "  repeat 2 [ every 2 [ tick ] ]",
  '  if true [ on_key "a" [ tick ] ]',
  "end",
  "repeat 2 [ on_click [ tick ] ]",
  "arm",
].join("\n");

// --- Highlighting: every Interaction name classifies as primitive (profile-blind) --------------

test("highlight: each Interaction block-head and primitive classifies as primitive (profile-blind)", () => {
  for (const [name, source] of [
    ...Object.entries(INTERACTION_BLOCK_HEADS),
    ...Object.entries(INTERACTION_PRIMITIVES),
  ]) {
    const tokens = OL.highlight(source, doc).filter((t) => t.text === name);
    // Assert the token EXISTS before asserting its class: a `filter(...).every(...)` over an empty
    // list passes vacuously, which would hide the very regression this test guards against.
    assert.equal(
      tokens.length,
      1,
      `expected exactly one ${name} token in ${JSON.stringify(source)}`,
    );
    assert.equal(
      tokens[0].class,
      "primitive",
      `${name} should highlight as primitive in ${JSON.stringify(source)}`,
    );
  }
});

test("highlight: every Interaction name stays primitive nested in a whole program (block, repeat, procedure body)", () => {
  const tokens = OL.highlight(NESTED_INTERACTION_PROGRAM, doc);
  for (const name of INTERACTION_NAMES) {
    const nameTokens = tokens.filter((t) => t.text === name);
    assert.equal(
      nameTokens.length,
      1,
      `expected exactly one ${name} token in the nested program`,
    );
    assert.equal(
      nameTokens[0].class,
      "primitive",
      `${name} should highlight as primitive even when nested`,
    );
  }
});

test("highlight: keywords are case-insensitive — an upper-case Interaction name is still primitive", () => {
  // `spec/tooling.md:23`: tokenization is case-insensitive for keywords and built-in primitives.
  for (const name of INTERACTION_NAMES) {
    const upper = name.toUpperCase();
    const [token] = OL.highlight(upper, doc);
    assert.equal(
      token.class,
      "primitive",
      `${upper} should highlight as primitive`,
    );
  }
});

test("highlight: `wait` is never a keyword — a same-named procedure highlights as procedure-name", () => {
  // `wait` is an ordinary primitive, not a reserved word in any profile
  // (`spec/interaction-events.md` reserves only the four block-heads), so it never reaches the
  // `keyword` class: the profile-blind highlighter resolves a user `define wait` to
  // `procedure-name` at its call site, unlike a Core reserved word which stays `keyword` no matter
  // what. This is purely a *token-class* statement — the checker separately reports that
  // redefinition as `ol-reserved-word` (`namespace: "primitive"`, asserted below), which is a
  // legality question the highlighter deliberately does not answer.
  const source = "define wait\nend\nwait";
  const tokens = OL.highlight(source, doc).filter((t) => t.text === "wait");
  assert.equal(tokens.length, 2);
  assert.ok(tokens.every((t) => t.class === "procedure-name"));
});

// --- Semantic tokens: every Interaction name carries defaultLibrary -----------------------------

test("semanticTokens: each Interaction block-head and primitive call carries the defaultLibrary modifier", () => {
  for (const [name, source] of [
    ...Object.entries(INTERACTION_BLOCK_HEADS),
    ...Object.entries(INTERACTION_PRIMITIVES),
  ]) {
    const token = OL.semanticTokens(source, doc).find((t) => t.text === name);
    assert.ok(token, `expected a semantic token for ${name}`);
    assert.equal(token.class, "primitive");
    assert.ok(
      token.modifiers.includes("defaultLibrary"),
      `${name} should be a defaultLibrary primitive`,
    );
  }
});

test("semanticTokens: every Interaction name carries defaultLibrary when nested in a whole program", () => {
  const tokens = OL.semanticTokens(NESTED_INTERACTION_PROGRAM, doc);
  for (const name of INTERACTION_NAMES) {
    const token = tokens.find((t) => t.text === name);
    assert.ok(token, `expected a semantic token for nested ${name}`);
    assert.equal(token.class, "primitive");
    assert.ok(
      token.modifiers.includes("defaultLibrary"),
      `nested ${name} should be a defaultLibrary primitive`,
    );
  }
});

// --- Checker recognition: active `interaction-events` clean; Core-only unknown ------------------

/** `check()` diagnostics for `source` under the given profiles (parse must be clean first). */
function checkDiagnostics(source, profiles) {
  const { ast, diagnostics: parseDiagnostics } = OL.parse(source, doc);
  assert.deepEqual(
    parseDiagnostics,
    [],
    `expected a clean parse for ${JSON.stringify(source)}`,
  );
  return OL.check(ast, { profiles }).diagnostics;
}

test("check: with the interaction-events profile active, `wait` is a known callee (checks clean)", () => {
  // The I8 gap this slice closes: before registration `wait` raised `ol-unknown-command` even with
  // the profile active. A profile whose own primitive is unknown is not conformant.
  for (const source of Object.values(INTERACTION_PRIMITIVES)) {
    assert.deepEqual(
      checkDiagnostics(source, INTERACTION_PROFILES),
      [],
      `${JSON.stringify(source)} should check clean under an active interaction-events profile`,
    );
  }
});

test("check: with the interaction-events profile active, every block-head is a known callee (checks clean)", () => {
  for (const source of Object.values(INTERACTION_BLOCK_HEADS)) {
    assert.deepEqual(
      checkDiagnostics(source, INTERACTION_PROFILES),
      [],
      `${JSON.stringify(source)} should check clean under an active interaction-events profile`,
    );
  }
});

test("check: without the interaction-events profile, `wait` is ol-unknown-command", () => {
  for (const [name, source] of Object.entries(INTERACTION_PRIMITIVES)) {
    const diagnostics = checkDiagnostics(source, CORE_PROFILES);
    assert.equal(
      diagnostics.length,
      1,
      `${name} should raise exactly one diagnostic under Core-only`,
    );
    assert.equal(diagnostics[0].code, "ol-unknown-command");
    assert.equal(diagnostics[0].params.name, name);
    assert.equal(diagnostics[0].stage, "semantic");
    assert.equal(diagnostics[0].severity, "error");
  }
});

test("check: the `wait` rejection span covers just the callee word", () => {
  const [finding] = checkDiagnostics("wait 1", CORE_PROFILES);
  assert.deepEqual(finding.source_span.start, [1, 1]);
  assert.deepEqual(finding.source_span.end, [1, 5]);
});

test("check: `wait` is not made visible by a sibling profile alone", () => {
  // Guards against the visible-name entry leaking outside its `active.has("interaction-events")`
  // gate: Sound and Sprites active but NOT interaction-events leaves `wait` unknown.
  const diagnostics = checkDiagnostics("wait 1", [
    "core-language",
    "turtle-rendering",
    "sound",
    "sprites",
  ]);
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].code, "ol-unknown-command");
  assert.equal(diagnostics[0].params.name, "wait");
});

test("check: a whole Interaction program in awkward positions checks clean under an active profile", () => {
  assert.deepEqual(
    checkDiagnostics(NESTED_INTERACTION_PROGRAM, INTERACTION_PROFILES),
    [],
  );
});

test("check: that same program under Core-only flags each Interaction name as unknown, once each", () => {
  // Nesting must not hide an Interaction name from the checker: the primitive (`wait`) and every
  // block-head (`when`, `every`, `on_key`, `on_click`) is reported once — and only those are (the
  // user procedure `tick` and its calls are known). This proves both shapes route through
  // `collectVisibleNames` and are gated purely on the `interaction-events` profile.
  const diagnostics = checkDiagnostics(
    NESTED_INTERACTION_PROGRAM,
    CORE_PROFILES,
  );
  const unknownNames = diagnostics
    .filter((d) => d.code === "ol-unknown-command")
    .map((d) => d.params.name)
    .sort();
  assert.deepEqual(unknownNames, [...INTERACTION_NAMES].sort());
  assert.equal(
    diagnostics.length,
    INTERACTION_NAMES.length,
    "only the five Interaction names are unknown under Core-only",
  );
});

test("check: `input` stays ol-unknown-command even under an active profile — its slice (#681) is unimplemented", () => {
  // Deliberate scope boundary for I8 (recorded on issue #687). `input` is listed in the profile's
  // spec table but has no evaluator and no arity entry, so registering it as a known callee here
  // would be a false tooling claim: `check()` would pass and the program would then fail at
  // runtime. The honest `ol-unknown-command` is the better learner experience, and `input`'s
  // tooling ships in the same slice as its implementation. Written as a bare call (with an
  // argument the profile-blind reader cannot group for an unregistered name, `input "x"` is a
  // parse-stage `ol-bad-token`, which would mask the semantic finding under test).
  const diagnostics = checkDiagnostics("input", INTERACTION_PROFILES);
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].code, "ol-unknown-command");
  assert.equal(diagnostics[0].params.name, "input");
});

// --- Reserved-word gating: block-heads only, and only under an active profile -------------------

test("check: redefining an Interaction block-head under an active profile raises ol-reserved-word", () => {
  // `when`/`every`/`on_key`/`on_click` are reserved only when Interaction & Events is active
  // (`spec/interaction-events.md` §Profiles and reservation, C1 #663). `wait` is NOT reserved —
  // asserted by the redefinition test below and the `wait` procedure highlight test above.
  for (const head of Object.keys(INTERACTION_BLOCK_HEADS)) {
    const diagnostics = checkDiagnostics(
      `define ${head}\nend`,
      INTERACTION_PROFILES,
    );
    const codes = diagnostics.map((d) => d.code);
    assert.ok(
      codes.includes("ol-reserved-word"),
      `redefining ${head} under an active interaction-events profile should raise ol-reserved-word`,
    );
  }
});

test("check: redefining an Interaction block-head is allowed under Core-only (no interaction-specific diagnostic)", () => {
  for (const head of Object.keys(INTERACTION_BLOCK_HEADS)) {
    assert.deepEqual(
      checkDiagnostics(`define ${head}\nend`, CORE_PROFILES),
      [],
      `${head} is an ordinary name under Core-only and may be redefined`,
    );
  }
});

test("check: `wait` is a primitive, so redefining it under an active profile raises ol-reserved-word", () => {
  // `wait` is NOT a reserved block-head (contrast the four heads above — it never appears in
  // `OL_PROFILE_RESERVED_WORDS`), but `spec/tooling.md:184` makes redefining a *primitive*
  // `ol-reserved-word` all the same, with `namespace: "primitive"` rather than `"reserved"`.
  // Sound's identically-shaped `set_tempo`, Geometry's `grid`, and Data's `list` already behaved
  // this way; before I8 `wait` was the only one of those four profiles' primitives a program could
  // silently shadow.
  for (const primitive of Object.keys(INTERACTION_PRIMITIVES)) {
    const [finding, ...rest] = checkDiagnostics(
      `define ${primitive}\nend`,
      INTERACTION_PROFILES,
    );
    assert.deepEqual(rest, []);
    assert.equal(finding.code, "ol-reserved-word");
    assert.equal(finding.stage, "semantic");
    assert.deepEqual(finding.params, {
      name: primitive,
      namespace: "primitive",
    });
  }
});

test("check: `wait` may be redefined under Core-only — it is not visible, so it collides with nothing", () => {
  // The profile gate cuts both ways: with `interaction-events` inactive `wait` registers no
  // primitive at all (`collectVisibleNames`), so a Core-only program is free to `define wait`,
  // exactly as it is free to `define grid` without Geometry.
  for (const primitive of Object.keys(INTERACTION_PRIMITIVES)) {
    assert.deepEqual(
      checkDiagnostics(`define ${primitive}\nend`, CORE_PROFILES),
      [],
      `${primitive} is an ordinary name under Core-only and may be redefined`,
    );
  }
});

// --- Static arity: `wait` is strictly fixed-arity, gated on the same profile --------------------

test("check: a `wait` call short of its one input raises ol-not-enough-inputs at stage=semantic", () => {
  // `wait <n>` is Kind-C taking exactly one number, so a bare `wait` that ran out of line is
  // statically short (`spec/tooling.md:181`). Before I8 this checked clean, because `wait` had no
  // static arity range — the same shape Sound's `set_tempo` already had via #689.
  const [finding, ...rest] = checkDiagnostics("wait", INTERACTION_PROFILES);
  assert.deepEqual(rest, []);
  assert.equal(finding.code, "ol-not-enough-inputs");
  assert.equal(finding.stage, "semantic");
  assert.deepEqual(finding.params, {
    callable: "wait",
    expected: 1,
    actual: 0,
  });
});

test("check: a parenthesized (wait) with no input also raises ol-not-enough-inputs", () => {
  // The explicit regression the arity range closes in the parenthesized form: `(wait)` supplies
  // zero inputs where exactly one is required. Bare `wait` (above) and `(wait)` reach the check by
  // different call-node kinds (`Call` vs `ParenCall`), so both are locked.
  const [finding, ...rest] = checkDiagnostics("(wait)", INTERACTION_PROFILES);
  assert.deepEqual(rest, []);
  assert.equal(finding.code, "ol-not-enough-inputs");
  assert.equal(finding.stage, "semantic");
  assert.deepEqual(finding.params, {
    callable: "wait",
    expected: 1,
    actual: 0,
  });
});

test("check: an over-supplied parenthesized (wait 1 2) raises ol-too-many-inputs", () => {
  // The parenthesized form is the only place a learner can over-supply a bare command, and `wait`
  // has no variadic alternate, so `max === min === 1`.
  const [finding, ...rest] = checkDiagnostics(
    "(wait 1 2)",
    INTERACTION_PROFILES,
  );
  assert.deepEqual(rest, []);
  assert.equal(finding.code, "ol-too-many-inputs");
  assert.equal(finding.stage, "semantic");
  assert.deepEqual(finding.params, {
    callable: "wait",
    expected: 1,
    actual: 2,
  });
});

test("check: `wait`'s arity is not checked without the profile — the name is unknown instead", () => {
  // The two rules must never double-report: under Core-only `wait` is not visible, so it is
  // `ol-unknown-command`'s concern alone and the arity rule stays silent.
  const diagnostics = checkDiagnostics("(wait 1 2)", CORE_PROFILES);
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].code, "ol-unknown-command");
});
