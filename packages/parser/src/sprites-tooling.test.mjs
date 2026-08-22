// Unit tests for the **tooling** view of the Sprites profile's six names — the block-heads
// `tell`/`ask`/`each` (issues #674/#675/#676, slices SP2–SP4) and the turtle-identity reporters
// `new_turtle`/`who`/`turtles` (issue #673, slice SP1; C3 rows in `spec/turtles-and-sprites.md`'s
// "Canonical forms" table). This file is slice SP6 of the Sprites epic #660 (`spec/tooling.md`'s
// token classes + three checker layers, `spec/turtles-and-sprites.md`'s reserved-word section).
//
// Two shapes with deliberately different mechanics — proven not to leak into each other:
//
//   1. Block-head forms `tell`/`ask`/`each` lower to a `ProfileStatement` and are keywords of the
//      Sprites profile — matched by `isKeyword` only while that profile is active today
//      (`spec/turtles-and-sprites.md#reserved-words-in-this-profile`, C1 #663), though
//      `spec/grammar.md:408` now makes profile words built-in **unconditionally** and issue #841
//      lands the always-on list that retires the gate (the profile documents are realigned by #855).
//      The Layer-2 checker was taught to treat them as visible command names by SP2–SP4
//      (`spritesStatementFormNames` in `collectVisibleNames`), and **declaring** one — `define` or
//      `struct`, not a binding — under an active profile raises `ol-reserved-word`. This slice locks
//      that with fixtures rather than re-adding.
//   2. Reporters `new_turtle`/`who`/`turtles` are ordinary zero-arity primitives in the arity table
//      (`spec/turtles-and-sprites.md`'s C3 rows: each Kind-R, arity 0). SP1 registered their arities
//      but deliberately deferred their *checker visibility* to this slice; before SP6 they raised
//      `ol-unknown-command` even under an active `sprites` profile — a profile whose own reporters
//      are unknown is not conformant. SP6 registers them in `collectVisibleNames`' `sprites` gate,
//      so they now check clean with the profile active and stay `ol-unknown-command` without it.
//      Issue #746 then closed the mirror-image hole: being a *primitive* rather than a reserved word
//      decides which `namespace` a redefinition reports (`"primitive"`, not `"reserved"`), not
//      whether it is reportable at all (`spec/tooling.md:185`), so `define who` now collides under
//      an active profile exactly as `define grid`/`define wait` do — and stays legal without it.
//
// Highlighting is currently **profile-blind** — `highlight()`/`semanticTokens()` take no profile
// argument — so every one of the six names classifies as `primitive` + `defaultLibrary`, exactly as
// `when`/`every` (Interaction) and the Sound commands do. Note this is a KNOWN DEVIATION from the
// normative token-class model, not the final word: `spec/tooling.md:30` puts the profile block-heads
// and the mode-switch command `tell` in the `keyword` class while their profile is active, so under
// an active `sprites` profile those three SHOULD ultimately be `keyword`. The parser cannot express
// that yet — giving the highlighter a profile set changes one of the four shared cross-package
// contracts and is tracked as its own serialized slice, issue #740. The reporters are unaffected
// either way: they are ordinary primitives, so `primitive` is their correct final class. This
// mirrors the reusable shape `sound-tooling.test.mjs` established for the M5 tooling slices.
//
// Every name is exercised in **awkward positions** — inside a `[ … ]` instruction block, inside
// `repeat`, and nested in a procedure body — via one shared whole-program constant, so a regression
// that only handled a top-level occurrence (or only a subset of the six names) cannot slip through.

import assert from "node:assert/strict";
import { test } from "node:test";
import * as OL from "@openlogo/parser";

const doc = "sprites-tooling.logo";

const SPRITES_PROFILES = ["core-language", "turtle-rendering", "sprites"];
const CORE_PROFILES = ["core-language", "turtle-rendering"];

/** Every Sprites block-head, one representative correct occurrence each. */
const SPRITES_BLOCK_HEADS = Object.freeze({
  tell: "tell turtles",
  ask: "ask who [ forward 10 ]",
  each: "each [ forward 10 ]",
});

/** Every Sprites reporter, one representative correct bare-call occurrence each. */
const SPRITES_REPORTERS = Object.freeze({
  new_turtle: "new_turtle",
  who: "print who",
  turtles: "print turtles",
});

/** All six Sprites names, block-heads and reporters together. */
const SPRITES_NAMES = Object.freeze([
  ...Object.keys(SPRITES_BLOCK_HEADS),
  ...Object.keys(SPRITES_REPORTERS),
]);

/**
 * A whole Sprites program placing every one of the six names in an awkward position — a procedure
 * body, inside `repeat`, inside a `[ … ]` block, and as reporter arguments — so a regression that
 * only handled a top-level occurrence of one name cannot pass. Each of the six spellings occurs
 * exactly once, letting the highlighting/semantic-token assertions count `=== 1` per name.
 *
 *   - `tell turtles`     — block-head `tell` + reporter `turtles`, in the procedure body.
 *   - `ask new_turtle …` — block-head `ask` + reporter `new_turtle` as its addressed value.
 *   - `each [ … who … ]` — block-head `each` + reporter `who` inside its bracketed block, and the
 *     whole `each` nested inside `repeat`.
 */
const NESTED_SPRITES_PROGRAM = [
  "define swarm",
  "  tell turtles",
  "  ask new_turtle [ forward 5 ]",
  "  repeat 2 [ each [ forward who ] ]",
  "end",
  "swarm",
].join("\n");

// --- Highlighting: every Sprites name classifies as primitive (profile-blind) ------------------

test("highlight: each Sprites block-head and reporter classifies as primitive (profile-blind)", () => {
  for (const source of [
    ...Object.values(SPRITES_BLOCK_HEADS),
    ...Object.values(SPRITES_REPORTERS),
  ]) {
    for (const name of SPRITES_NAMES) {
      const tokens = OL.highlight(source, doc).filter((t) => t.text === name);
      for (const token of tokens) {
        assert.equal(
          token.class,
          "primitive",
          `${name} should highlight as primitive in ${JSON.stringify(source)}`,
        );
      }
    }
  }
});

test("highlight: every Sprites name stays primitive nested in a whole program (block, repeat, procedure body)", () => {
  const tokens = OL.highlight(NESTED_SPRITES_PROGRAM, doc);
  for (const name of SPRITES_NAMES) {
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

test("highlight: a Sprites reporter name is never a keyword — its call site highlights as a procedure name", () => {
  // The reporters are not reserved words in any profile, so a user procedure literally named `who`
  // resolves to `procedure-name` at its call site, proving the name is not locked to
  // `primitive`/`keyword` the way a Core reserved word is. This is a *highlighting* claim only —
  // highlighting is profile-blind (`spec/tooling.md:26`), and the checker separately rejects this
  // very program under an active `sprites` profile (issue #746, asserted below).
  const source = "define who\nend\nwho";
  const tokens = OL.highlight(source, doc).filter((t) => t.text === "who");
  assert.equal(tokens.length, 2);
  assert.ok(tokens.every((t) => t.class === "procedure-name"));
});

// --- Semantic tokens: every Sprites name carries defaultLibrary --------------------------------

test("semanticTokens: each Sprites block-head and reporter call carries the defaultLibrary modifier", () => {
  for (const [name, source] of [
    ...Object.entries(SPRITES_BLOCK_HEADS),
    ...Object.entries(SPRITES_REPORTERS),
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

test("semanticTokens: every Sprites name carries defaultLibrary when nested in a whole program", () => {
  const tokens = OL.semanticTokens(NESTED_SPRITES_PROGRAM, doc);
  for (const name of SPRITES_NAMES) {
    const token = tokens.find((t) => t.text === name);
    assert.ok(token, `expected a semantic token for nested ${name}`);
    assert.equal(token.class, "primitive");
    assert.ok(
      token.modifiers.includes("defaultLibrary"),
      `nested ${name} should be a defaultLibrary primitive`,
    );
  }
});

// --- Checker recognition: active `sprites` clean; Core-only unknown ----------------------------

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

test("check: with the sprites profile active, every Sprites reporter is a known callee (checks clean)", () => {
  // The SP6 gap this slice closes: before registration these raised `ol-unknown-command` even with
  // the profile active. A profile whose own reporters are unknown is not conformant.
  for (const source of Object.values(SPRITES_REPORTERS)) {
    assert.deepEqual(
      checkDiagnostics(source, SPRITES_PROFILES),
      [],
      `${JSON.stringify(source)} should check clean under an active sprites profile`,
    );
  }
});

test("check: with the sprites profile active, every Sprites block-head is a known callee (checks clean)", () => {
  for (const source of Object.values(SPRITES_BLOCK_HEADS)) {
    assert.deepEqual(
      checkDiagnostics(source, SPRITES_PROFILES),
      [],
      `${JSON.stringify(source)} should check clean under an active sprites profile`,
    );
  }
});

test("check: without the sprites profile, every Sprites reporter is ol-unknown-command", () => {
  for (const [name, source] of Object.entries(SPRITES_REPORTERS)) {
    const diagnostics = checkDiagnostics(source, CORE_PROFILES);
    assert.equal(
      diagnostics.length,
      1,
      `${name} should raise exactly one diagnostic under Core-only`,
    );
    assert.equal(diagnostics[0].code, "ol-unknown-command");
    assert.equal(diagnostics[0].params.name, name);
    assert.equal(diagnostics[0].stage, "semantic");
  }
});

test("check: a whole Sprites program in awkward positions checks clean under an active sprites profile", () => {
  assert.deepEqual(
    checkDiagnostics(NESTED_SPRITES_PROGRAM, SPRITES_PROFILES),
    [],
  );
});

test("check: that same program under Core-only flags each Sprites name as unknown, once each", () => {
  // Nesting must not hide a Sprites name from the checker: every reporter (`turtles`, `new_turtle`,
  // `who`) and every block-head (`tell`, `ask`, `each`) is reported once — and only the Sprites
  // names are (the user procedure `swarm` and its call are known). This proves both shapes route
  // through `collectVisibleNames` and are gated purely on the `sprites` profile.
  const diagnostics = checkDiagnostics(NESTED_SPRITES_PROGRAM, CORE_PROFILES);
  const unknownNames = diagnostics
    .filter((d) => d.code === "ol-unknown-command")
    .map((d) => d.params.name)
    .sort();
  assert.deepEqual(unknownNames, [...SPRITES_NAMES].sort());
  assert.equal(
    diagnostics.length,
    SPRITES_NAMES.length,
    "only the six Sprites names are unknown under Core-only",
  );
});

// --- Reserved-word gating: block-heads only, and only under an active profile ------------------

test("check: redefining a Sprites block-head under an active profile raises ol-reserved-word", () => {
  // `tell`/`ask`/`each` are treated as reserved only when Sprites is active (C1 #663) — the shipped
  // behaviour, which `spec/turtles-and-sprites.md:154` now makes unconditional; retiring the gate
  // is #841. The reporters are NOT reserved in any profile — they collide as *primitives* instead,
  // with `namespace: "primitive"` rather than `"reserved"` (issue #746, asserted by the reporter
  // redefinition tests below).
  for (const head of Object.keys(SPRITES_BLOCK_HEADS)) {
    const diagnostics = checkDiagnostics(
      `define ${head}\nend`,
      SPRITES_PROFILES,
    );
    const codes = diagnostics.map((d) => d.code);
    assert.ok(
      codes.includes("ol-reserved-word"),
      `redefining ${head} under an active sprites profile should raise ol-reserved-word`,
    );
  }
});

test("check: redefining a Sprites block-head is allowed under Core-only (no sprite-specific diagnostic)", () => {
  for (const head of Object.keys(SPRITES_BLOCK_HEADS)) {
    assert.deepEqual(
      checkDiagnostics(`define ${head}\nend`, CORE_PROFILES),
      [],
      `${head} is an ordinary name under Core-only and may be redefined`,
    );
  }
});

test("check: redefining a Sprites reporter under an active profile raises ol-reserved-word as a primitive, not a reserved word", () => {
  // Issue #746. Until this fix the reporters were the one Sprites shape a program could silently
  // shadow: this test asserted `define who … end` checked *clean* under an active profile, which
  // pinned the defect rather than the rule. `spec/tooling.md:185` is a normative Layer-2 "Required
  // behavior" row listing **primitive** beside "keyword" — and profile primitives count there
  // whether or not their profile is claimed — so `new_turtle`/`who`/`turtles` (C3 Kind-R
  // primitives) collide exactly
  // as `grid` (Geometry), `set_tempo` (Sound), `dict` (Data), and `wait` (Interaction) already did.
  //
  // The reporter/block-head distinction this file exists to keep separate is preserved and now
  // asserted *precisely* rather than as presence-vs-absence: a block-head reports
  // `namespace: "reserved"` (above), a reporter reports `namespace: "primitive"`. `params.name` is
  // the surface spelling the learner wrote, at that name's own span (#737).
  for (const reporter of Object.keys(SPRITES_REPORTERS)) {
    const diagnostics = checkDiagnostics(
      `define ${reporter}\nend`,
      SPRITES_PROFILES,
    );
    assert.equal(
      diagnostics.length,
      1,
      `redefining ${reporter} should raise exactly one diagnostic`,
    );
    const [finding] = diagnostics;
    assert.equal(finding.code, "ol-reserved-word");
    assert.deepEqual(finding.params, {
      name: reporter,
      namespace: "primitive",
    });
    assert.equal(finding.stage, "semantic");
    assert.equal(finding.severity, "error");
    assert.deepEqual(
      finding.source_span.start,
      [1, 8],
      `${reporter} should be reported at the procedure-name token, not the define`,
    );
    assert.deepEqual(finding.source_span.end, [1, 8 + reporter.length]);
  }
});

test("check: redefining a Sprites reporter is allowed under Core-only — the rule is profile-gated", () => {
  // The other direction of #746, and the property the reporters share with the block-heads above:
  // with `sprites` inactive the name registers nothing, so it stays an ordinary name a Core-only
  // program is currently accepted in declaring — exactly as `define ask` is accepted without
  // Sprites. That gate is shipped behaviour, not what the spec requires (`spec/grammar.md:408`
  // makes profile primitives built-in names unconditionally); retiring it is #841's. The
  // `ol-unknown-command` a *call* to it would raise is a different rule, exercised above; a bare
  // declaration is fully clean.
  for (const reporter of Object.keys(SPRITES_REPORTERS)) {
    assert.deepEqual(
      checkDiagnostics(`define ${reporter}\nend`, CORE_PROFILES),
      [],
      `${reporter} is an ordinary name under Core-only and may be redefined`,
    );
  }
});
