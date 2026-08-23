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
//      Issue #746 then closed the mirror-image hole: being a *primitive* rather than a keyword
//      decides which BRANCH of the checker reports a redefinition, not
//      whether it is reportable at all (`spec/tooling.md:185`), so `define who` now collides under
//      an active profile exactly as `define grid`/`define wait` do — and stays legal without it.
//      (Issue #838 removed the `namespace` param that used to make the branch visible in the
//      diagnostic; the branches remain, the label does not.)
//
// Highlighting is **profile-aware** since issue #740: `highlight()`/`semanticTokens()` take an
// active-profile set. `spec/tooling.md:30` puts in the `keyword` class, "while their profile is
// active", "the profile block-heads together with the Sprites mode-switch command `tell`, which
// takes no block" — so precisely: `ask` and `each` are the block-heads and `tell` is the
// mode-switch command, and all three move. `:31` puts "a profile word whose profile is inactive"
// in `primitive`. So the six names split, and the split is the point of this file's highlighting
// half: `tell`/`ask`/`each` are `keyword` with `sprites` claimed and
// `primitive` without it, while the three REPORTERS `new_turtle`/`who`/`turtles` are `primitive`
// either way — they are ordinary primitives (`:31`, "profile primitives when enabled"), which is
// the same control case `sound-tooling.test.mjs` locks for the Sound commands.
// (Elsewhere this file uses "block-head" as long-standing shorthand for all three forms, which
// predates #740 and is left as-is; `spec/tooling.md:30` is the precise wording.)
//
// Both directions are asserted for every name. Before #740 this file asserted only the
// profile-neutral `primitive` reading and carried a KNOWN DEVIATION note saying the parser could
// not express the other one; it can now, so the note is retired. Nothing here is inverted — the
// old assertions were the INACTIVE half of the pair and remain true; the ACTIVE half is new.
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

// --- Highlighting: block-heads move with the profile, reporters never do -----------------------

/**
 * The class each of the six names takes, written as DATA for both profile settings rather than
 * computed from the same rule the classifier implements — a helper that re-derives the rule would
 * agree with a broken classifier. Read down the two columns and the asymmetry #740 exists to
 * create is visible at a glance: only `tell`/`ask`/`each` move.
 */
const EXPECTED_CLASS = Object.freeze({
  inactive: Object.freeze({
    tell: "primitive",
    ask: "primitive",
    each: "primitive",
    new_turtle: "primitive",
    who: "primitive",
    turtles: "primitive",
  }),
  active: Object.freeze({
    tell: "keyword",
    ask: "keyword",
    each: "keyword",
    new_turtle: "primitive",
    who: "primitive",
    turtles: "primitive",
  }),
});

/** The two profile settings under test, paired with the expectation table above. */
const PROFILE_CASES = Object.freeze([
  { label: "sprites INACTIVE", profiles: CORE_PROFILES, expected: "inactive" },
  { label: "sprites ACTIVE", profiles: SPRITES_PROFILES, expected: "active" },
]);

test("highlight: each Sprites name takes its profile-dependent class in isolation", () => {
  for (const { label, profiles, expected } of PROFILE_CASES) {
    for (const source of [
      ...Object.values(SPRITES_BLOCK_HEADS),
      ...Object.values(SPRITES_REPORTERS),
    ]) {
      for (const name of SPRITES_NAMES) {
        const tokens = OL.highlight(source, doc, { profiles }).filter(
          (t) => t.text === name,
        );
        // A `for … of` over an empty filter passes vacuously, and most (source, name) pairs here
        // ARE empty by construction — each source contains only its own name. The nested test
        // below is what pins presence (`length === 1` per name); this loop only pins that no
        // occurrence, wherever it appears, takes the wrong class.
        for (const token of tokens) {
          assert.equal(
            token.class,
            EXPECTED_CLASS[expected][name],
            `${name} in ${JSON.stringify(source)} with ${label}`,
          );
        }
      }
    }
  }
});

test("highlight: a profile word in an ORDINARY-NAME position still follows the profile", () => {
  // `spec/tooling.md:30` is explicit that the keyword class applies "wherever they appear,
  // **including the positions where the grammar admits one as an ordinary name (`local end`,
  // `for end from 1 to 3`, `export end`, `:p.end`)**". All four of the spec's own examples are
  // covered below, plus `set … to`. Every other test in this file uses a CALL position — so
  // without this row a change that suppressed the profile check in exactly these forms would pass
  // the whole suite (that mutant survived all 3813 tests before this row existed).
  //
  // "Ordinary-name position" is the spec's own framing and the wording is deliberate:
  // `local`/`set`/`for` BIND a name, `export` REFERENCES one, and `.field` is field ACCESS. What
  // unites them is that the grammar admits an ordinary identifier there, not that they bind.
  //
  // `{ ask: 1 }` is the deliberate exception and is asserted alongside: a bare dict key is
  // `dict-key` "on grammatical grounds alone" (`:30`), so it must NOT follow the profile. Pinning
  // it here rather than only transitively is what keeps the dict-key/profile ordering honest.
  const ORDINARY_NAME_SOURCES = Object.freeze({
    local: "local ask",
    "set-to": "set ask to 1",
    "for-from": "for ask from 1 to 3 [ print 1 ]",
    export: "export ask",
    "dot-field": "print :rec.ask",
  });
  for (const { label, profiles, expected } of PROFILE_CASES) {
    for (const [position, source] of Object.entries(ORDINARY_NAME_SOURCES)) {
      const tokens = OL.highlight(source, doc, { profiles }).filter(
        (t) => t.text === "ask",
      );
      assert.equal(
        tokens.length,
        1,
        `expected one ask in ${position} (${label})`,
      );
      assert.equal(
        tokens[0].class,
        EXPECTED_CLASS[expected].ask,
        `ask in ${position} with ${label}`,
      );
    }
    const dictKey = OL.highlight("print { ask: 1 }", doc, { profiles }).filter(
      (t) => t.text === "ask",
    );
    assert.equal(dictKey.length, 1, `expected one ask dict key (${label})`);
    assert.equal(
      dictKey[0].class,
      "dict-key",
      `a bare dict key is dict-key on grammatical grounds alone, in both directions (${label})`,
    );
  }
});

test("highlight: the profile-dependent class survives nesting in a whole program", () => {
  for (const { label, profiles, expected } of PROFILE_CASES) {
    const tokens = OL.highlight(NESTED_SPRITES_PROGRAM, doc, { profiles });
    for (const name of SPRITES_NAMES) {
      const nameTokens = tokens.filter((t) => t.text === name);
      assert.equal(
        nameTokens.length,
        1,
        `expected exactly one ${name} token in the nested program (${label})`,
      );
      assert.equal(
        nameTokens[0].class,
        EXPECTED_CLASS[expected][name],
        `nested ${name} with ${label}`,
      );
    }
  }
});

test("highlight: omitting the profile set reads as Core-only, so it matches the INACTIVE column", () => {
  // The parameter is optional and defaults to `DEFAULT_CHECK_PROFILES`. This is what kept #740
  // additive rather than breaking: every pre-existing caller asserts the inactive reading, which
  // is still correct. Asserted rather than assumed, because it is the whole compatibility claim.
  for (const name of SPRITES_NAMES) {
    const source = { ...SPRITES_BLOCK_HEADS, ...SPRITES_REPORTERS }[name];
    const omitted = OL.highlight(source, doc).filter((t) => t.text === name);
    const explicit = OL.highlight(source, doc, {
      profiles: CORE_PROFILES,
    }).filter((t) => t.text === name);
    assert.ok(omitted.length > 0, `expected a ${name} token`);
    assert.deepEqual(
      omitted.map((t) => t.class),
      explicit.map((t) => t.class),
    );
    assert.equal(omitted[0].class, EXPECTED_CLASS.inactive[name]);
  }
});

test("highlight: a Sprites reporter name is never a keyword — its call site highlights as a procedure name", () => {
  // The reporters are not block-heads in any profile, so a user procedure literally named `who`
  // resolves to `procedure-name` at its call site, proving the name is not locked to
  // `primitive`/`keyword`. The checker separately rejects this very program under an active
  // `sprites` profile (issue #746, asserted below); this is a *highlighting* claim only.
  const source = "define who\nend\nwho";
  for (const { label, profiles } of PROFILE_CASES) {
    const tokens = OL.highlight(source, doc, { profiles }).filter(
      (t) => t.text === "who",
    );
    assert.equal(tokens.length, 2, label);
    assert.ok(
      tokens.every((t) => t.class === "procedure-name"),
      label,
    );
  }
});

test("highlight: symbol discovery still demotes a BLOCK-HEAD under an active profile", () => {
  // `spec/tooling.md:30` — "[Disambiguating identifiers] is what demotes a token to
  // `procedure-name`, `type-name`, or `field-name` once parsing or symbol discovery resolves it."
  // So the profile check must run AFTER discovery, not before. Hoisting it would silently paint
  // this learner's own procedure `keyword`, and nothing else in the suite would notice.
  const source = "define ask\n  print 1\nend\nask";
  const tokens = OL.highlight(source, doc, {
    profiles: SPRITES_PROFILES,
  }).filter((t) => t.text === "ask");
  assert.equal(tokens.length, 2);
  assert.ok(tokens.every((t) => t.class === "procedure-name"));
});

// --- Semantic tokens: defaultLibrary follows the class, not the name ---------------------------

test("semanticTokens: a reporter keeps defaultLibrary in both directions; a block-head loses it when active", () => {
  // `defaultLibrary` is scoped to the `primitive` class, so an active block-head sheds it purely
  // by becoming `keyword` — #740's step 3 falls out of the classification instead of needing its
  // own rule. (That the INACTIVE fallback still carries `defaultLibrary` at all is the separate,
  // tracked defect #831; this file pins today's behaviour either way.)
  for (const { label, profiles, expected } of PROFILE_CASES) {
    for (const [name, source] of [
      ...Object.entries(SPRITES_BLOCK_HEADS),
      ...Object.entries(SPRITES_REPORTERS),
    ]) {
      const token = OL.semanticTokens(source, doc, { profiles }).find(
        (t) => t.text === name,
      );
      assert.ok(token, `expected a semantic token for ${name} (${label})`);
      const expectedClass = EXPECTED_CLASS[expected][name];
      assert.equal(token.class, expectedClass, `${name} (${label})`);
      assert.equal(
        token.modifiers.includes("defaultLibrary"),
        expectedClass === "primitive",
        `${name} (${label}) defaultLibrary must follow the class`,
      );
    }
  }
});

test("semanticTokens: the same split holds when nested in a whole program", () => {
  for (const { label, profiles, expected } of PROFILE_CASES) {
    const tokens = OL.semanticTokens(NESTED_SPRITES_PROGRAM, doc, { profiles });
    for (const name of SPRITES_NAMES) {
      const token = tokens.find((t) => t.text === name);
      assert.ok(
        token,
        `expected a semantic token for nested ${name} (${label})`,
      );
      const expectedClass = EXPECTED_CLASS[expected][name];
      assert.equal(token.class, expectedClass, `nested ${name} (${label})`);
      assert.equal(
        token.modifiers.includes("defaultLibrary"),
        expectedClass === "primitive",
        `nested ${name} (${label}) defaultLibrary must follow the class`,
      );
    }
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
  // `tell`/`ask`/`each` are reserved only when Sprites is active (C1 #663; a gate
  // `spec/grammar.md:408` has since overruled and issue #841 retires). The reporters are NOT
  // keywords in any profile — they collide through the checker's *primitive* branch instead
  // (issue #746, asserted by the reporter redefinition tests below), which since issue #838 is a
  // difference in branch only: both report the same one-param `ol-reserved-word`.
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

test("check: redefining a Sprites reporter under an active profile raises ol-reserved-word", () => {
  // Issue #746. Until this fix the reporters were the one Sprites shape a program could silently
  // shadow: this test asserted `define who … end` checked *clean* under an active profile, which
  // pinned the defect rather than the rule. `spec/tooling.md:185` is a normative Layer-2 "Required
  // behavior" row listing **primitive** beside "keyword" — and profile primitives count there
  // whether or not their profile is claimed — so `new_turtle`/`who`/`turtles` (C3 Kind-R
  // primitives) collide exactly
  // as `grid` (Geometry), `set_tempo` (Sound), `dict` (Data), and `wait` (Interaction) already did.
  //
  // The reporter/block-head distinction this file exists to keep separate is preserved in the
  // checker's BRANCHES, but is no longer visible in the diagnostic: issue #838 removed the
  // `namespace` param, because `spec/error-model.md:125,132-141` makes keyword-vs-primitive "an
  // implementation distinction the learner never has to learn". `params.name` is the surface
  // spelling the learner wrote, at that name's own span (#737).
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
    assert.deepEqual(finding.params, { name: reporter });
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
  // program is free to declare — exactly as `define ask` is legal without Sprites. The `ol-unknown-
  // command` a *call* to it would raise is a different rule, exercised above; a bare declaration is
  // fully clean.
  for (const reporter of Object.keys(SPRITES_REPORTERS)) {
    assert.deepEqual(
      checkDiagnostics(`define ${reporter}\nend`, CORE_PROFILES),
      [],
      `${reporter} is an ordinary name under Core-only and may be redefined`,
    );
  }
});
