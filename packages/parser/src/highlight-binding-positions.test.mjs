// Unit tests for issue #840: **a built-in name in a binding position is not painted as `keyword`
// or `primitive`** — it is painted as the variable it is.
//
// This is the highlighter half of maintainer ruling #833, whose normative text landed in #875:
//
//   spec/grammar.md:363 — "A program may not declare a built-in name. A program may bind a value to
//                          any name."
//   spec/grammar.md:386 — every binding form "MUST accept **any** name, including a keyword, a
//                          primitive, or an alias spelling of one … `:end = 1` and `local count`
//                          are conforming programs."
//   spec/grammar.md:390 — "The positions that name data, or refer to a name rather than declaring
//                          one, admit keywords freely … That is what makes `:value = 1`,
//                          `{ value: 1 }`, `local end`, and `for end from 1 to 3` legal."
//
// Registration is still blocked, and that is the checker's rule (`checker-reserved-word.ts`,
// pinned by `keyword-binding-forms.test.mjs`). This file asserts only the *token class*: a
// learner who writes `set end to 5` must see their own variable, because a mismatched colour is
// the first thing that tells them they did something wrong.
//
// The class is `:variable` (`spec/tooling.md:34`, "a colon-prefixed variable read or colon-form
// assignable place head"), extended to the bare-form spelling of the same place and to the bare
// `local`/`for`/comprehension binders. It is emphatically neither of the two classes the
// highlighter used to reach for:
//   * `keyword` (`spec/tooling.md:30`) is "structural words recognized by the reader" — a binder
//     is a name the *program* chose, not structure;
//   * `primitive` (`spec/tooling.md:31`) is scoped to "the C3 primitive matrix", so painting a
//     learner's own binder `primitive` asserts standard-library membership it does not have —
//     `semanticTokens` then decorated it `defaultLibrary` (`spec/tooling.md:277-279`), which is
//     pinned against below.
//
// Measured at the previous HEAD (`fc4371d`), sanity-asserted with a probe that classified
// `print 1` correctly first: `set if to 5`, `local if`, `for if in …`, and `map if in …` all
// painted `if` **keyword**; `set count to 5`, `local forward`, `for fd in …`, and
// `map hint in …` all painted their name **primitive** — 8 of the 10 rows of #840's AC1 table
// wrong, with `:if = 5` and `{ if: 1 }` already correct. After this change all ten are
// `:variable`, and 552 registry-driven combinations (44 keywords + 13 heritage aliases + 7
// profile words + 4 primitives + 1 ordinary control, across 8 binding templates) parse clean and
// classify `:variable`.
//
// Every assertion is driven off the public registries (`OL_KEYWORDS`, `heritageAliasNames()`,
// `OL_PROFILE_KEYWORDS`) rather than a hand-kept sample, so a built-in name added later is pulled
// into this guard automatically. The registry-driven sweeps locate their token by SOURCE POSITION,
// never by text: a keyword binder repeats its own spelling elsewhere in several templates
// (`for in in [1 2] …`, `set to to 1`), so a text lookup would silently assert the wrong token.
// The hand-written rows further down DO use a text lookup, which is sound only because each of
// their sources contains the word under test exactly once — check that before adding a row.
//
// Two boundaries are deliberately pinned rather than fixed here, so neither can drift unnoticed:
//   * a destructuring `[ :x :y ]` binder keeps `declaration: false` — its names were never
//     mispainted (they are already `:variable`), and resolving them to their own binding sites
//     would invert an assertion `semantic-tokens.test.mjs` pins;
//   * an INCOMPLETE binding form (`set if to`, `for if in [1 2`) has no binding AST node, so the
//     name keeps its pre-#840 fallback class. Recovering a binder from half-typed source is
//     reader behaviour, not a token-class rule.
//
// Runs under `node --test` against the built `@openlogo/parser` package, exercising only its
// public `parse`/`highlight`/`semanticTokens` surface.

import assert from "node:assert/strict";
import { test } from "node:test";
import * as OL from "@openlogo/parser";

const doc = "binding.logo";
const QUOTE = String.fromCharCode(34);

/**
 * Every binding form of `spec/grammar.md:386` whose name is a bare `name` token, as a
 * `[prefix, suffix]` pair. Splitting rather than templating is what makes the name's column
 * knowable (`prefix.length + 1`) without searching for its spelling. The two `reduce` slots use
 * `zzz_acc`/`zzz_item` for the *other* slot so no template can collide with the word under test.
 *
 * The colon-form place (`:name = 1`), the heritage `make "name" 1` target, the destructuring
 * pattern, and procedure parameters are deliberately absent: their tokens are not bare names, and
 * each is pinned separately below.
 */
const BINDING_FORMS = [
  { label: "bare place (`set name to v`)", prefix: "set ", suffix: " to 1\n" },
  { label: "`local`", prefix: "local ", suffix: "\n" },
  {
    label: "`for … in` binder",
    prefix: "for ",
    suffix: " in [1 2] [ print 1 ]\n",
  },
  {
    label: "`for … from … to` binder",
    prefix: "for ",
    suffix: " from 1 to 3 [ print 1 ]\n",
  },
  {
    label: "`map` binder",
    prefix: "print map ",
    suffix: " in [1 2] [ 1 ]\n",
  },
  {
    label: "`filter` binder",
    prefix: "print filter ",
    suffix: " in [1 2] [ true ]\n",
  },
  {
    label: "`reduce` accumulator",
    prefix: "print reduce ",
    suffix: " zzz_item in [1 2] from 0 [ 1 ]\n",
  },
  {
    label: "`reduce` item binder",
    prefix: "print reduce zzz_acc ",
    suffix: " in [1 2] from 0 [ 1 ]\n",
  },
];

/** The 7 profile block-heads/commands (`spec/grammar.md:408`), from the registry. */
const PROFILE_WORDS = Object.values(OL.OL_PROFILE_KEYWORDS).flat();

/**
 * A primitive from each of the matrices a learner meets early. Sanity-asserted below against the
 * arity tables, so a name that stops being a primitive cannot quietly turn these rows vacuous.
 */
const PRIMITIVES = ["count", "forward", "print", "hint"];

/**
 * The token `form` puts at the binding slot — located by position, and only after the source is
 * confirmed to parse clean, because the whole classification is AST-driven: a source that fails
 * to parse would mark nothing and every assertion here would pass vacuously.
 */
function bindingToken(form, word) {
  const source = form.prefix + word + form.suffix;
  const { diagnostics } = OL.parse(source, doc);
  // Compared whole rather than projected to codes: an always-empty array never invokes a
  // `.map` callback, which Node 22's coverage counts as an uncovered function.
  assert.deepEqual(
    diagnostics,
    [],
    `${form.label} with \`${word}\` must parse clean: ${JSON.stringify(source)}`,
  );
  const column = form.prefix.length + 1;
  const token = OL.highlight(source, doc).find(
    (candidate) =>
      candidate.source_span.start[0] === 1 &&
      candidate.source_span.start[1] === column,
  );
  assert.ok(
    token !== undefined,
    `no token at line 1 column ${column} of ${JSON.stringify(source)}`,
  );
  assert.equal(
    token.text.toLowerCase(),
    word.toLowerCase(),
    `the token at line 1 column ${column} must be the binder itself`,
  );
  return token;
}

function assertBoundAsVariable(form, word) {
  const token = bindingToken(form, word);
  assert.equal(
    token.class,
    ":variable",
    `${form.label} must paint \`${word}\` as the learner's variable, not ${token.class} (spec/grammar.md:386)`,
  );
}

// --- AC1: any built-in name in a binding position is painted as a name -------------------------

test("the registries are populated — otherwise every sweep below is vacuous", () => {
  assert.ok(OL.OL_KEYWORDS.length >= 44, "keyword registry");
  assert.ok(OL.heritageAliasNames().length >= 13, "heritage alias registry");
  assert.ok(PROFILE_WORDS.length >= 7, "profile keyword registry");
  for (const name of PRIMITIVES) {
    assert.ok(
      OL.corePrimitiveArity(name) !== undefined ||
        OL.turtlePrimitiveArity(name) !== undefined ||
        OL.educationalPrimitiveArity(name) !== undefined,
      `${name} must still be a primitive for its row to mean anything`,
    );
  }
});

test("every binding form paints every KEYWORD as `:variable`, never `keyword`", () => {
  for (const form of BINDING_FORMS) {
    // The control: whatever this form does for an ordinary learner name, it must do for a
    // keyword. Without it, a form broken for unrelated reasons could pass the keyword rows.
    assertBoundAsVariable(form, "counter");
    for (const word of OL.OL_KEYWORDS) {
      assertBoundAsVariable(form, word);
    }
  }
});

test("every binding form paints every PRIMITIVE and heritage ALIAS as `:variable`, never `primitive`", () => {
  for (const form of BINDING_FORMS) {
    for (const word of [...PRIMITIVES, ...OL.heritageAliasNames()]) {
      assertBoundAsVariable(form, word);
    }
  }
});

test("every binding form paints every PROFILE word as `:variable` — the profile set cannot matter", () => {
  // `spec/grammar.md:408` makes profile words built-in unconditionally, and binding a built-in
  // name is free, so `ask`/`each`/`tell`/`when`/`every`/`on_key`/`on_click` bind like any name.
  for (const form of BINDING_FORMS) {
    for (const word of PROFILE_WORDS) {
      assertBoundAsVariable(form, word);
    }
  }
});

test("`( local a b )`: every name of a multi-name `local` is a binder, not just the first", () => {
  const tokens = OL.highlight("( local repeat forward )\n", doc);
  const bound = tokens.filter((token) => token.class === ":variable");
  assert.deepEqual(
    bound.map((token) => token.text),
    ["repeat", "forward"],
  );
});

test("case-insensitivity: an upper-case built-in name binds and paints the same way", () => {
  for (const word of ["REPEAT", "Forward", "FD"]) {
    assertBoundAsVariable({ ...BINDING_FORMS[1] }, word);
  }
});

// --- AC1: the rows that were already correct must stay correct ---------------------------------

test("non-regression: the two AC1 rows that already worked are untouched", () => {
  const colonPlace = OL.highlight(":if = 5\n", doc)[0];
  assert.equal(colonPlace.class, ":variable");
  assert.equal(colonPlace.text, ":if");

  const dictKey = OL.highlight(":d = { if: 1 }\n", doc).find(
    (token) => token.text === "if",
  );
  assert.equal(dictKey.class, "dict-key");
});

test("non-regression: the other non-bare-name binding forms keep their own classes", () => {
  // A struct field, a heritage `make` target, a destructuring pattern name, and a procedure
  // parameter are all binding positions too — but none of them is a bare `name` token, so this
  // rule must leave every one of them exactly where it was.
  assert.equal(
    OL.highlight("struct s [ if b ]\n", doc).find(
      (token) => token.text === "if",
    ).class,
    "field-name",
  );
  assert.equal(
    OL.highlight(`make ${QUOTE}count${QUOTE} 1\n`, doc).find((token) =>
      token.text.includes("count"),
    ).class,
    "word/string",
  );
  const destructured = OL.highlight(
    "for [ :repeat :b ] in [[1 2]] [ print 1 ]\n",
    doc,
  ).find((token) => token.text === ":repeat");
  assert.equal(destructured.class, ":variable");
  assert.equal(destructured.declaration, false);
  const parameter = OL.highlight("define f :if\n  print 1\nend\n", doc).find(
    (token) => token.text === ":if",
  );
  assert.equal(parameter.class, ":variable");
  assert.equal(parameter.declaration, true);
});

test("a malformed assignment target introduces no name, so nothing is repainted", () => {
  // `first :repeat = 5` and `3 = 5` parse to an Assign whose target is not a place at all; the
  // rule must not reach into them and repaint `first`, which really is a primitive call.
  assert.equal(
    OL.highlight("first :repeat = 5\n", doc).find(
      (token) => token.text === "first",
    ).class,
    "primitive",
  );
  assert.deepEqual(
    OL.highlight("3 = 5\n", doc).map((token) => token.class),
    ["number", "operator", "number"],
  );
});

test("a nested place: the bare head is the variable, the selector's key stays data", () => {
  const tokens = OL.highlight("set nums[repeat] to 5\n", doc);
  assert.equal(tokens[1].text, "nums");
  assert.equal(tokens[1].class, ":variable");
  // A write into an existing value is a reference, not a new binding (spec/grammar.md:404).
  assert.equal(tokens[1].declaration, false);
  assert.equal(
    tokens.find((token) => token.text === "repeat").class,
    "dict-key",
  );
});

// --- AC2: the rule is position-decidable, not lexically decidable ------------------------------

test("AC2: the same spelling is a variable in a binding position and structural everywhere else", () => {
  // A purely lexical "is it in the reserved-word list?" test cannot produce this table — which is
  // the point of `spec/tooling.md:18-21` ("the final classes below depend on grammatical
  // position") and of the `dict-key` precedent at `:41`.
  for (const [word, bindingSource, otherSource, otherClass] of [
    ["if", "local if\n", "if true [ print 1 ]\n", "keyword"],
    ["end", "for end from 1 to 3 [ print 1 ]\n", "define f\nend\n", "keyword"],
    ["repeat", "set repeat to 5\n", "repeat 4 [ print 1 ]\n", "keyword"],
    ["forward", "local forward\n", "forward 100\n", "primitive"],
    ["fd", "for fd in [1 2] [ print 1 ]\n", "fd 100\n", "primitive"],
    ["count", "set count to 5\n", "print count [1 2]\n", "primitive"],
  ]) {
    const bound = OL.highlight(bindingSource, doc).find(
      (token) => token.text === word,
    );
    assert.equal(
      bound.class,
      ":variable",
      `${word} in a binding position must be :variable`,
    );
    const other = OL.highlight(otherSource, doc).find(
      (token) => token.text === word,
    );
    assert.equal(
      other.class,
      otherClass,
      `${word} outside a binding position must stay ${otherClass}`,
    );
  }
});

// --- AC4: profile block-heads are classified unconditionally -----------------------------------

test("AC4: profile block-heads classify unconditionally — one class for every profile word", () => {
  // Rule 4 of #833: "a name that could be declared in one implementation but not in another would
  // be invisible and unpredictable to a learner" (`spec/grammar.md:408`). The highlighter is
  // profile-blind — `highlight()` takes only `(source, document)` — so the seven words cannot
  // vary with the profile set by construction.
  //
  // The class is pinned per word rather than as `keyword || primitive`: a disjunction would stay
  // green if a block-head silently flipped, which is the whole failure mode this row guards. All
  // seven are `primitive` today, matching what `sprites-tooling.test.mjs` and
  // `interaction-tooling.test.mjs` already pin and document as the profile-blind reading of
  // `spec/tooling.md:30-31` (issue #740 would revisit it; explicitly out of scope here).
  //
  // Deliberately NOT asserted via `highlight.length`: the second parameter already has a default,
  // so `.length` is 1 whether or not a third profile parameter exists — such a test would be
  // ineffective rather than protective.
  assert.ok(
    PROFILE_WORDS.length >= 7,
    "expected the profile keyword registry to be populated",
  );
  for (const word of PROFILE_WORDS) {
    const [token] = OL.highlight(`${word} 1\n`, doc);
    assert.equal(
      token.text.toLowerCase(),
      word,
      "the first token must be the word under test",
    );
    assert.equal(
      token.class,
      "primitive",
      `${word} in head position must stay structural and profile-independent`,
    );
  }
});

test("degradation boundary: an INCOMPLETE binding form keeps the old fallback class", () => {
  // Honest limit, pinned rather than hidden. Classification is AST-driven, so a mid-edit form
  // that produces no `Local`/`ForIn`/`Comprehension`/`Assign` node has no binding position to
  // recognize, and the name falls back to `keyword`/`primitive` exactly as it did before #840.
  // `highlight()` still never throws (`highlight.ts`'s never-throw contract), which is the part
  // that matters for an editor typing character by character. Recovering a binder from a
  // half-typed statement would be new reader behaviour, not a token-class change, so it is not
  // part of this slice.
  //
  // BOTH fallbacks are pinned, keyword and primitive: the primitive half is the one AC1's table
  // cared about most (`set count to 5`, `local forward`), so a row set that only ever spelled the
  // word `if` would leave the more important half of the boundary unasserted.
  //
  // Every row must DISCRIMINATE — the word has to be one that flips to `:variable` once the form
  // is completed. A block head such as `local` is `keyword` on both sides of the boundary, so a
  // row for it would assert nothing this test exists to pin (that the head never gets repainted
  // is pinned by the `( local a b )` test above, which admits exactly two `:variable` tokens).
  for (const [source, word, expected] of [
    ["set if to\n", "if", "keyword"],
    ["set if\n", "if", "keyword"],
    ["for if in\n", "if", "keyword"],
    ["for if in [1 2\n", "if", "keyword"],
    ["print map if in\n", "if", "keyword"],
    ["for if from 1 to\n", "if", "keyword"],
    ["set count to\n", "count", "primitive"],
    ["for fd in\n", "fd", "primitive"],
    ["print map hint in\n", "hint", "primitive"],
    ["set counter to\n", "counter", "primitive"],
  ]) {
    const { diagnostics } = OL.parse(source, doc);
    assert.ok(
      diagnostics.length > 0,
      `${JSON.stringify(source)} must really be incomplete, or this row proves nothing`,
    );
    const hits = OL.highlight(source, doc).filter(
      (candidate) => candidate.text === word,
    );
    // The text lookup below is only sound while the word appears once — assert that, rather
    // than trusting it, so a later row with a repeating template fails loudly instead of
    // silently asserting the wrong token.
    assert.equal(
      hits.length,
      1,
      `${JSON.stringify(source)} must contain \`${word}\` exactly once`,
    );
    assert.equal(
      hits[0].class,
      expected,
      `${JSON.stringify(source)} has no binding node, so the fallback still applies`,
    );
  }
});

// --- The semantic-token surface ---------------------------------------------------------------

test("semanticTokens: a binder is a `declaration` and loses the bogus `defaultLibrary`", () => {
  // The concrete learner-visible harm of the old `primitive` class: `local forward` claimed
  // standard-library membership (`spec/tooling.md:277-279`) for the learner's own variable.
  for (const [source, text] of [
    ["local forward\n", "forward"],
    ["for fd in [1 2] [ print 1 ]\n", "fd"],
    ["print map hint in [1 2] [ 1 ]\n", "hint"],
    ["print reduce total zzz_item in [1 2] from 0 [ 1 ]\n", "total"],
  ]) {
    const token = OL.semanticTokens(source, doc).find(
      (candidate) => candidate.text === text,
    );
    assert.equal(token.class, ":variable");
    assert.deepEqual(token.modifiers, ["declaration"], source);
  }
});

test("semanticTokens: the two spellings of one assignment agree exactly", () => {
  // `:count = 5` and `set count to 5` write the same place, so they must highlight the same way —
  // a `reference`, not a `declaration`, and never `defaultLibrary`.
  const colon = OL.semanticTokens(":count = 5\n", doc)[0];
  const bare = OL.semanticTokens("set count to 5\n", doc)[1];
  assert.equal(bare.text, "count");
  assert.equal(colon.class, bare.class);
  assert.deepEqual(colon.modifiers, ["reference"]);
  assert.deepEqual(bare.modifiers, ["reference"]);
});
