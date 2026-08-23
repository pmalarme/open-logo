// Unit tests for the **tooling** view of the Interaction & Events profile's six names — the
// block-heads `when`/`every`/`on_key`/`on_click` (issues #682–#685, slices I3–I6), the `wait <n>`
// primitive (issue #680, slice I1), and the `input <prompt>` reporter (issue #681, slice I2). This
// file is slice I8 of the Interaction epic #661
// (`spec/tooling.md`'s token classes + three checker layers, `spec/interaction-events.md`'s
// "Profiles and reservation" section).
//
// Two shapes with deliberately different mechanics — proven not to leak into each other:
//
//   1. Block-head forms `when`/`every`/`on_key`/`on_click` lower to a `ProfileStatement`. Their
//      PAINT is profile-gated, but their DECLARATION is not: `spec/grammar.md:408` and
//      `spec/interaction-events.md:43-47` state an unconditional rule ("what a profile decides is
//      whether a name *works*, never whether a program may declare it"), #855 deleted the earlier
//      "reserved only within this profile" wording from `spec/`, and #841 removed the matching gate
//      from the checker — so the assertions below expect the SAME answer with the profile active
//      and inactive. Slices I3–I6 already taught the Layer-2 checker to treat them as visible
//      command names (`interactionEventsBlockHeadNames` in `collectVisibleNames`), so this slice
//      LOCKS that half with fixtures rather than re-adding it.
//      Reservation is a *legality* question and is independent of the token class, which #740
//      makes profile-dependent — see the highlighting note below.
//   2. `wait` and `input` are the profile's two ordinary calls (`spec/interaction-events.md:65`:
//      "`input` and `wait` are ordinary calls and take no block") and live in the arity table — a
//      Kind-C command taking one number and a Kind-R reporter taking one prompt
//      (`spec/interaction-events.md`'s "Profiles and reservation" table). I1 registered `wait`'s
//      *reader* arity but deliberately deferred its *checker visibility* to this slice; before I8
//      `wait` raised `ol-unknown-command` even under an active `interaction-events` profile — a
//      profile whose own primitive is unknown is not conformant. I8 registers it in
//      `collectVisibleNames`' `interaction-events` gate (via `interactionPrimitiveNames()`), so it
//      now checks clean with the profile active and stays `ol-unknown-command` without it. I8 also
//      gives it the static arity range its fixed-arity shape requires, so a wrong input count is
//      caught at `stage=semantic` exactly as Sound's identically-shaped `set_tempo` already was.
//
// `input` reaches this file through the SAME table, but it got there in its own slice. I8
// deliberately left it out and locked the exclusion (see the test below, now updated): `input` had
// no evaluator, and registering a known callee with nothing behind it would let a program check
// clean and then fail at runtime — a false tooling claim, worse for a learner than the honest
// `ol-unknown-command`. Slice I2 (#681) ships the evaluator, so `input` joins
// `INTERACTION_PRIMITIVE_ARITY` there and both halves of its registration land together. The
// assertion that replaces the old exclusion is its mirror image — `input` now checks clean under an
// active profile and is STILL `ol-unknown-command` without one — so the profile gate this file
// guards is proven in both directions for every name.
//
// Highlighting is **profile-aware** since issue #740: `highlight()`/`semanticTokens()` take an
// active-profile set. `spec/tooling.md:30` puts the profile block-heads in the `keyword` class
// "while their profile is active", and `:31` puts "a profile word whose profile is inactive" in
// `primitive`. So the six names split, and the split is the point of this file's highlighting
// half: the four BLOCK-HEADS `when`/`every`/`on_key`/`on_click` are `keyword` with
// `interaction-events` claimed and `primitive` without it, while `wait` and `input` are
// `primitive` either way — they are ordinary primitives (`:31`, "profile primitives when
// enabled"), the same control case `sound-tooling.test.mjs` locks for the Sound commands.
// `spec/interaction-events.md:47` states it directly: "`input` and `wait` are ordinary primitives
// rather than block-heads, as are the Sound command names; all of them are built-in names on the
// same unconditional terms, and their profile decides only whether they work" — so declaring one
// IS blocked while its token class stays `primitive`. Legality and classification are different
// questions and the highlighting half of this file answers only the second.
//
// Both directions are asserted for every name. Before #740 this file asserted only the
// profile-neutral `primitive` reading and carried a KNOWN DEVIATION note saying the parser could
// not express the other one; it can now, so the note is retired. Nothing here is inverted — the
// old assertions were the INACTIVE half of the pair and remain true; the ACTIVE half is new.
//
// Every name is exercised in **awkward positions** — inside a `[ … ]` instruction block, inside
// `repeat`, inside an `if`, and nested in a procedure body — via one shared whole-program constant,
// so a regression that only handled a top-level occurrence (or only a subset of the six names)
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
  input: ':answer = input "who?"',
});

/** All six implemented Interaction names, block-heads and primitives together. */
const INTERACTION_NAMES = Object.freeze([
  ...Object.keys(INTERACTION_BLOCK_HEADS),
  ...Object.keys(INTERACTION_PRIMITIVES),
]);

/**
 * A whole Interaction program placing every one of the six names in an awkward position — a
 * procedure body, inside `repeat`, and inside a `[ … ]` block — so a regression that only handled a
 * top-level occurrence of one name cannot pass. Not one of the six sits at top level. Each of the
 * six spellings occurs exactly once, letting the highlighting/semantic-token assertions count
 * `=== 1` per name.
 *
 *   - `wait 1`   — inside a `[ … ]` block inside `repeat`, inside `tick`'s procedure body.
 *   - `input`    — in a value position inside `tick`'s procedure body (it is the profile's only
 *                  reporter, so it appears as the right-hand side of an assignment rather than as a
 *                  statement of its own).
 *   - `when`     — inside `arm`'s procedure body.
 *   - `every`    — inside a `[ … ]` block inside `repeat`, inside `arm`'s body.
 *   - `on_key`   — inside an `if` block inside `arm`'s body.
 *   - `on_click` — inside a `[ … ]` block inside `repeat`, at top level.
 */
const NESTED_INTERACTION_PROGRAM = [
  "define tick",
  "  repeat 2 [ wait 1 ]",
  '  :answer = input "who?"',
  "end",
  "define arm",
  '  when "start" [ tick ]',
  "  repeat 2 [ every 2 [ tick ] ]",
  '  if true [ on_key "a" [ tick ] ]',
  "end",
  "repeat 2 [ on_click [ tick ] ]",
  "arm",
].join("\n");

// --- Highlighting: block-heads move with the profile, primitives never do ----------------------

/**
 * The class each of the six names takes, written as DATA for both profile settings rather than
 * computed from the same rule the classifier implements — a helper that re-derives the rule would
 * agree with a broken classifier. Read down the two columns and the asymmetry #740 exists to
 * create is visible at a glance: only the four block-heads move; `wait` and `input` never do.
 */
const EXPECTED_CLASS = Object.freeze({
  inactive: Object.freeze({
    when: "primitive",
    every: "primitive",
    on_key: "primitive",
    on_click: "primitive",
    wait: "primitive",
    input: "primitive",
  }),
  active: Object.freeze({
    when: "keyword",
    every: "keyword",
    on_key: "keyword",
    on_click: "keyword",
    wait: "primitive",
    input: "primitive",
  }),
});

/** The two profile settings under test, paired with the expectation table above. */
const PROFILE_CASES = Object.freeze([
  {
    label: "interaction INACTIVE",
    profiles: CORE_PROFILES,
    expected: "inactive",
  },
  {
    label: "interaction ACTIVE",
    profiles: INTERACTION_PROFILES,
    expected: "active",
  },
]);

test("highlight: each Interaction name takes its profile-dependent class in isolation", () => {
  for (const { label, profiles, expected } of PROFILE_CASES) {
    for (const [name, source] of [
      ...Object.entries(INTERACTION_BLOCK_HEADS),
      ...Object.entries(INTERACTION_PRIMITIVES),
    ]) {
      const tokens = OL.highlight(source, doc, { profiles }).filter(
        (t) => t.text === name,
      );
      // Assert the token EXISTS before asserting its class: a `filter(...).every(...)` over an
      // empty list passes vacuously, which would hide the very regression this test guards.
      assert.equal(
        tokens.length,
        1,
        `expected exactly one ${name} token in ${JSON.stringify(source)} (${label})`,
      );
      assert.equal(
        tokens[0].class,
        EXPECTED_CLASS[expected][name],
        `${name} in ${JSON.stringify(source)} with ${label}`,
      );
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
  // `{ when: 1 }` is the deliberate exception and is asserted alongside: a bare dict key is
  // `dict-key` "on grammatical grounds alone" (`:30`), so it must NOT follow the profile.
  const ORDINARY_NAME_SOURCES = Object.freeze({
    local: "local when",
    "set-to": "set when to 1",
    "for-from": "for when from 1 to 3 [ print 1 ]",
    export: "export when",
    "dot-field": "print :rec.when",
  });
  for (const { label, profiles, expected } of PROFILE_CASES) {
    for (const [position, source] of Object.entries(ORDINARY_NAME_SOURCES)) {
      const tokens = OL.highlight(source, doc, { profiles }).filter(
        (t) => t.text === "when",
      );
      assert.equal(
        tokens.length,
        1,
        `expected one when in ${position} (${label})`,
      );
      assert.equal(
        tokens[0].class,
        EXPECTED_CLASS[expected].when,
        `when in ${position} with ${label}`,
      );
    }
    const dictKey = OL.highlight("print { when: 1 }", doc, { profiles }).filter(
      (t) => t.text === "when",
    );
    assert.equal(dictKey.length, 1, `expected one when dict key (${label})`);
    assert.equal(
      dictKey[0].class,
      "dict-key",
      `a bare dict key is dict-key on grammatical grounds alone, in both directions (${label})`,
    );
  }
});

test("highlight: the profile-dependent class survives nesting in a whole program", () => {
  for (const { label, profiles, expected } of PROFILE_CASES) {
    const tokens = OL.highlight(NESTED_INTERACTION_PROGRAM, doc, { profiles });
    for (const name of INTERACTION_NAMES) {
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
  for (const [name, source] of [
    ...Object.entries(INTERACTION_BLOCK_HEADS),
    ...Object.entries(INTERACTION_PRIMITIVES),
  ]) {
    const omitted = OL.highlight(source, doc).filter((t) => t.text === name);
    const explicit = OL.highlight(source, doc, {
      profiles: CORE_PROFILES,
    }).filter((t) => t.text === name);
    assert.equal(omitted.length, 1, `expected a ${name} token`);
    assert.deepEqual(
      omitted.map((t) => t.class),
      explicit.map((t) => t.class),
    );
    assert.equal(omitted[0].class, EXPECTED_CLASS.inactive[name]);
  }
});

test("highlight: matching stays case-insensitive in BOTH profile directions", () => {
  // `spec/tooling.md:23`: tokenization is case-insensitive for keywords and built-in primitives.
  // Note what this does and does not pin: `highlight.ts` lowercases once before either lookup, so
  // both share that normalization and this test cannot detect `isProfileKeyword` losing its own
  // `.toLowerCase()` — `keywords.profiles.test.mjs`'s "Sprites keyword matching is
  // case-insensitive" is what pins that. What this DOES pin is that an upper-case spelling still
  // reaches the profile-aware branch at all, in both directions.
  for (const { label, profiles, expected } of PROFILE_CASES) {
    for (const name of INTERACTION_NAMES) {
      const upper = name.toUpperCase();
      const [token] = OL.highlight(upper, doc, { profiles });
      assert.equal(
        token.class,
        EXPECTED_CLASS[expected][name],
        `${upper} with ${label}`,
      );
    }
  }
});

test("highlight: `wait` is never a keyword — a same-named procedure highlights as procedure-name", () => {
  // `wait` is an ordinary primitive, not a block-head, so it never reaches the `keyword` class in
  // either direction — `spec/interaction-events.md:47` puts `input`/`wait` and the Sound names in
  // that category. It is still a built-in name there, "on the same unconditional terms", so the
  // checker separately reports this redefinition as `ol-reserved-word` (asserted below) — a
  // legality question the highlighter does not answer.
  const source = "define wait\nend\nwait";
  for (const { label, profiles } of PROFILE_CASES) {
    const tokens = OL.highlight(source, doc, { profiles }).filter(
      (t) => t.text === "wait",
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
  const source = "define when\n  print 1\nend\nwhen";
  const tokens = OL.highlight(source, doc, {
    profiles: INTERACTION_PROFILES,
  }).filter((t) => t.text === "when");
  assert.equal(tokens.length, 2);
  assert.ok(tokens.every((t) => t.class === "procedure-name"));
});

// --- Semantic tokens: defaultLibrary follows the class, not the name ---------------------------

test("semanticTokens: a primitive keeps defaultLibrary in both directions; a block-head loses it when active", () => {
  // `defaultLibrary` is scoped to the `primitive` class, so an active block-head sheds it purely
  // by becoming `keyword` — #740's step 3 falls out of the classification instead of needing its
  // own rule. (That the INACTIVE fallback still carries `defaultLibrary` at all is the separate,
  // tracked defect #831; this file pins today's behaviour either way.)
  for (const { label, profiles, expected } of PROFILE_CASES) {
    for (const [name, source] of [
      ...Object.entries(INTERACTION_BLOCK_HEADS),
      ...Object.entries(INTERACTION_PRIMITIVES),
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
    const tokens = OL.semanticTokens(NESTED_INTERACTION_PROGRAM, doc, {
      profiles,
    });
    for (const name of INTERACTION_NAMES) {
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
  // Nesting must not hide an Interaction name from the checker: each primitive (`wait`, `input`) and
  // every block-head (`when`, `every`, `on_key`, `on_click`) is reported once — and only those are
  // (the user procedure `tick` and its calls are known). This proves both shapes route through
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
    "only the six Interaction names are unknown under Core-only",
  );
});

test("check: `input` checks clean under an active profile now that its slice (#681) implements it", () => {
  // The mirror image of I8's original scope boundary (recorded on issue #687), updated to the truth
  // slice I2 (#681) established. `input` is listed in the profile's spec table but, while it had no
  // evaluator, registering it as a known callee here would have been a false tooling claim:
  // `check()` would pass and the program would then fail at runtime. #681 ships `evaluateInput`, so
  // both halves of its registration land together and the honest answer flips from
  // `ol-unknown-command` to clean. Written as a real one-argument call, since `input` is a Kind-R
  // reporter that reports a value.
  assert.deepEqual(
    checkDiagnostics(':answer = input "who?"', INTERACTION_PROFILES),
    [],
  );
});

test("check: `input` is STILL ol-unknown-command without the profile — it is not a Core name", () => {
  // The other direction of the same gate: `spec/conformance.md:169-173` puts `input` in Interaction &
  // Events, and `spec/interaction-events.md:11` is explicit that "OpenLogo **Core** remains
  // non-interactive: `input` is defined here, not in Core". A Core-only program that calls it must
  // still be told the name is unknown. Written as a bare call (with an argument the profile-blind
  // reader CAN now group, since the reader's arity table is profile-blind by design, the semantic
  // finding is the only one).
  const diagnostics = checkDiagnostics(':answer = input "who?"', CORE_PROFILES);
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].code, "ol-unknown-command");
  assert.equal(diagnostics[0].params.name, "input");
});

// --- Reserved-word gating: retired by issue #841, asserted in both directions ------------------

test("check: redefining an Interaction block-head under an active profile raises ol-reserved-word", () => {
  // This section is a lock on the RULE, not on a profile's behaviour. `when`/`every`/`on_key`/
  // `on_click` were once treated as reserved only while Interaction & Events was active (C1 #663);
  // `spec/grammar.md:408` and `spec/interaction-events.md:43-47` make them unconditional ("reserved
  // **unconditionally**: every implementation reserves them whether or not it claims this
  // profile"), for `wait`/`input` and the Sound names too, and #841 removed the gate. So this test
  // and its Core-only twin below must agree name for name; a difference between them is the defect.
  // `wait` is NOT a block-head — asserted by the redefinition test below and the `wait` procedure
  // highlight test above.
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

test("#841: redefining an Interaction block-head raises under Core-only too", () => {
  // `spec/interaction-events.md:43-47` and `spec/grammar.md:408` make these words built-in names
  // unconditionally, so the answer here must match the profile-ACTIVE test above name for name. A
  // difference between the two is the defect, not the point.
  for (const head of Object.keys(INTERACTION_BLOCK_HEADS)) {
    const codes = checkDiagnostics(`define ${head}\nend`, CORE_PROFILES).map(
      (d) => d.code,
    );
    assert.deepEqual(
      codes,
      ["ol-reserved-word"],
      `${head} is a built-in name whether or not interaction-events is claimed`,
    );
  }
});

test("check: `wait` is a primitive, so redefining it under an active profile raises ol-reserved-word", () => {
  // `wait` is NOT a profile block-head (contrast the four heads above — it never appears in
  // `OL_PROFILE_KEYWORDS`), but `spec/tooling.md:185` makes redefining a *primitive*
  // `ol-reserved-word` all the same. That block-head/primitive distinction decides which BRANCH of
  // the checker reports it, and since issue #838 no longer shows up in the diagnostic at all:
  // `spec/error-model.md:125` gives the code `params: { name }` only, and requires that "the words
  // *keyword*, *primitive*, and *alias* MUST NOT appear in the learner message" — because, as
  // `spec/error-model.md:136` puts it, that is "an implementation distinction the learner never has
  // to learn". Sound's identically-shaped `set_tempo`, Geometry's `grid`, and Data's `list` already
  // behaved this way; before I8 `wait` was the only one of those four profiles' primitives a
  // program could silently shadow.
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
    });
  }
});

test("#841: `wait` raises under Core-only too — the same rule, on the primitive branch", () => {
  // `spec/interaction-events.md:47`: `input`/`wait` "are built-in names on the same unconditional
  // terms". Asserting it on the PRIMITIVE branch as well as the block-head branch above is the
  // point — the two reach the predicate through different lookups, so a change that moves only one
  // of them leaves the other red.
  for (const primitive of Object.keys(INTERACTION_PRIMITIVES)) {
    const codes = checkDiagnostics(
      `define ${primitive}\nend`,
      CORE_PROFILES,
    ).map((d) => d.code);
    assert.deepEqual(
      codes,
      ["ol-reserved-word"],
      `${primitive} is a built-in name whether or not interaction-events is claimed`,
    );
  }
});

// --- Static arity: `wait` is strictly fixed-arity, gated on the same profile --------------------

test("check: a `wait` call short of its one input raises ol-not-enough-inputs at stage=semantic", () => {
  // `wait <n>` is Kind-C taking exactly one number (`spec/interaction-events.md:31`), so a bare
  // `wait` that ran out of line is statically short — `spec/tooling.md:182`, "Not enough inputs for
  // a fixed-arity or selected call form". Before I8 this checked clean, because `wait` had no
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

test("check: a parenthesized (input) with no prompt raises ol-not-enough-inputs at stage=semantic", () => {
  // `input <prompt>` is Kind-R taking exactly one prompt, so the same fixed-arity range `wait` has
  // catches an under-supplied call statically rather than leaving it to the runtime guard.
  const [finding, ...rest] = checkDiagnostics(
    ":answer = (input)",
    INTERACTION_PROFILES,
  );
  assert.deepEqual(rest, []);
  assert.equal(finding.code, "ol-not-enough-inputs");
  assert.equal(finding.stage, "semantic");
  assert.deepEqual(finding.params, {
    callable: "input",
    expected: 1,
    actual: 0,
  });
});

test("check: an over-supplied parenthesized (input a b) raises ol-too-many-inputs", () => {
  const [finding, ...rest] = checkDiagnostics(
    ':answer = (input "a" "b")',
    INTERACTION_PROFILES,
  );
  assert.deepEqual(rest, []);
  assert.equal(finding.code, "ol-too-many-inputs");
  assert.equal(finding.stage, "semantic");
  assert.deepEqual(finding.params, {
    callable: "input",
    expected: 1,
    actual: 2,
  });
});

test("check: `input`'s arity is not checked without the profile — the name is unknown instead", () => {
  const diagnostics = checkDiagnostics(
    ':answer = (input "a" "b")',
    CORE_PROFILES,
  );
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].code, "ol-unknown-command");
});
