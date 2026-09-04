// Guard tests for issue #878 — an `ol-bad-token` raised for a **misplaced Core keyword** must say
// more than the token's name.
//
// `spec/error-model.md:110` states the requirement on the message: an `ol-bad-token` *"message
// SHOULD point at the unexpected text and mention the closest legal form when clear."* The reader
// did the first half only, so the issue's own repro — `repeat value [ ]` — said `i don't know how
// to read value here.` and stopped, leaving the six words #853 had just stopped silently accepting
// (`value`, `key`, `add`, `remove`, `insert`, `clear`) routed through a message that named the
// problem and not the concept behind it.
//
// **This delivers the ownership half only, and the omission is deliberate and measured.** The
// message says `<word> is already part of OpenLogo.` and stops — `spec/error-model.md:125`'s
// prescribed opening for the sibling code that answers the same learner question, minus its `choose
// another name.` second clause, which would be bad advice here because `spec/grammar.md:390` makes
// binding a keyword legal. It names no form and claims no cause. Three measurements force that:
//
//   1. The reader is **profile-blind by design** (`reserved-word-value-position.test.mjs`, and it is
//      why #864 needed a semantic checker), yet **every one of the six words the issue names is an
//      optional-profile word**. `spec/conformance.md:102-104` assigns `add`/`remove`/`clear`/
//      `insert`, dictionaries and structs to **Data**; `spec/grammar.md:394` says a bare `value`
//      heads the heritage reader *"where Heritage is present, and nothing at all where it is not"*.
//      A form quoted at parse time could therefore be one the learner's profile set cannot run.
//   2. A context-free did-you-mean repairs only **3 of 6** positions, pinned below. Getting it right
//      needs the grammar slot, which the shared builder never sees; threading it through
//      `parser.ts`'s recovery paths is issue **#879**'s territory and deliberately untouched.
//   3. Ownership is the *cause* of the rejection at only **4 of 6** positions — an ordinary name is
//      rejected at `struct point wibble` and `remove 1 wibble :sizes` too — so a causal tail such as
//      *"so it cannot be read as a name here"* would be false often enough to matter. An earlier
//      revision carried exactly that tail; review measured it out.
//
// That 3-of-6 figure was **2 of 6** until review measured it. One probe, `define f (:x :set)`, was an
// **incomplete program**: its only diagnostic is `ol-missing-end`, and the control `define f (:x :y)`
// produces the identical one, so it measured the missing body and nothing about the substitution.
// Completed with a body and an `end`, `:set` parses clean — as `spec/grammar.md:390` requires, since
// it names **procedure parameters** among the binding forms that MUST accept any name. The assertion
// that let it through checked only that *some* diagnostic remained, never that the diagnostic was
// *about* the substituted token; the loop below now guards every row with an ordinary-name control,
// which is the control this header demands two paragraphs down and did not itself have.
//
// So `spec/error-model.md:110`'s *"when clear"* condition is not met, and the message names the
// owner instead of guessing a repair. The sweeps below pin that boundary in both directions, so a
// later slice that *does* have position information can move it deliberately rather than by
// accident.
//
// **Every assertion here is paired.** A test that only checked "the message got longer" cannot
// separate a working feature from a probe whose input never arrived, so each sweep asserts a
// non-zero control beside the property under test: keywords gain the clause, non-keywords provably
// do not, and the code/params/span/stage stay exactly as they were.
//
// **Scope.** The change is in the shared `parseDiag.badToken` builder, which has 17 call sites
// (`parser.ts` ×16, `tokens.ts` ×1) — not one path. The sweeps below probe several of them rather
// than reasoning about reach. `parseDiag.missingTerminator` shares the `ol-bad-token` code for
// run-ons (`forward set`) and already names its legal form — "each instruction needs a new line of
// its own" — so it is deliberately unchanged, and proven so below. The unmatched-delimiter paths of
// issue #879 are untouched, and pinned here as well as in
// `newline-continuations-and-delimiters.test.mjs`.

import assert from "node:assert/strict";
import { test } from "node:test";
import { check, isKeyword, OL_KEYWORDS, parse } from "@openlogo/parser";
// The subject under audit. It is intra-package (`index.ts` exports the diagnostics through `parse`,
// not this list), so it is imported from the package's own build output rather than promoted to the
// public surface for a test's benefit — the same reason `child-edges.test.mjs` imports
// `../dist/ast.js`. Node resolves this to the module instance the package entry already loaded.
import { KEYWORDS_WITH_NO_READER_PRODUCTION } from "../dist/errors.js";

const document = "misplaced-keyword-message.logo";

/** The single `ol-bad-token` naming `text`, asserted to exist exactly once. */
function badTokenFor(source, text) {
  const matches = parse(source, document).diagnostics.filter(
    (diagnostic) =>
      diagnostic.code === "ol-bad-token" && diagnostic.params.text === text,
  );
  assert.equal(
    matches.length,
    1,
    `expected exactly one ol-bad-token naming ${text} for ${JSON.stringify(source)}`,
  );
  return matches[0];
}

/**
 * Every diagnostic `source` produces under Core Language alone, as `stage:code` strings — both
 * stages, unconditionally. Reporting the union rather than short-circuiting on parse errors keeps a
 * caller from reading one stage's silence as the whole answer.
 */
function coreDiagnostics(source) {
  const parsed = parse(source, document);
  return [
    ...parsed.diagnostics.map((d) => `parse:${d.code}`),
    ...check(parsed.ast, {
      profiles: ["core-language"],
      source,
    }).diagnostics.map((d) => `semantic:${d.code}`),
  ];
}

/** The six words issue #853 found silently accepted and #878 found under-explained. */
const REGRESSION_WORDS = ["value", "key", "add", "remove", "insert", "clear"];

/**
 * The `ol-reserved-word` message the sibling checker emits for `word`, read from a real diagnostic
 * rather than a literal. `builtInMessage` is module-private, so this asks the checker itself — which
 * is the point: the pin then tracks what `checker-reserved-word.ts` actually says.
 */
function reservedWordMessage(word) {
  const parsed = parse(`define ${word}\n  print 1\nend`, document);
  assert.deepEqual(parsed.diagnostics, [], "the probe must parse clean");
  const found = check(parsed.ast, {
    profiles: ["core-language"],
  }).diagnostics.filter((d) => d.code === "ol-reserved-word");
  assert.equal(found.length, 1, `expected one ol-reserved-word for ${word}`);
  return found[0].message;
}

/** The sentence a misplaced Core keyword now earns. */
const ownershipSentence = (word) => `${word} is already part of OpenLogo.`;

/**
 * The six probe positions, as `[withKeyword, withVariable, withOrdinaryName]`. Every program is
 * **complete** — the `define` rows carry a body and an `end` — because an incomplete one measures
 * its own missing body instead of the substitution, which is exactly how an earlier revision of this
 * file reported 2 of 6 where the truth is 3.
 */
const PROBES = [
  ["repeat @ [ ]", "repeat"],
  ["print 1 + @", "plus"],
  ["print ( @ 1 )", "paren"],
  ["struct point @", "struct-field-list"],
  ["remove 1 @ :sizes", "remove-from"],
  ["define f (:x @)\n  print 1\nend", "optional-parameter"],
].map(([shape, name]) => ({
  name,
  withKeyword: shape.replace("@", "set"),
  withVariable: shape.replace("@", ":set"),
  withOrdinaryName: shape.replace("@", "wibble"),
}));

test("the issue's repro now names the owner", () => {
  const diagnostic = badTokenFor("repeat value [ ]", "value");

  assert.equal(
    diagnostic.message,
    `i don't know how to read value here. ${ownershipSentence("value")}`,
  );
  // The half that already worked, kept: the token is still named, and named first.
  assert.match(diagnostic.message, /^i don't know how to read value here\./u);
});

test("the sentence matches ol-reserved-word's prescribed opening, capital and all", () => {
  // `spec/error-model.md:125` prescribes `{name} is already part of OpenLogo. choose another name.`
  // for the sibling code that answers the same learner question. This pins both halves of how that
  // prose is reused: the opening is taken **verbatim**, and the second clause is **not**.
  //
  // Review caught an earlier revision shipping lowercase `openlogo`, which broke the "one voice"
  // claim on the one word carrying it. Two checks, deliberately different in kind, because either
  // alone would be weaker than it looks:
  //
  //   1. the sibling's **emitted** message (read from a real `ol-reserved-word`, not a literal) still
  //      matches the spec's prescribed casing — so a restyle of `checker-reserved-word.ts` fails here
  //      rather than silently moving the target this file measures against; and
  //   2. the `ol-bad-token` clause ends with that emitted opening verbatim — so the two codes cannot
  //      drift apart whichever of them changes.
  const message = badTokenFor("repeat value [ ]", "value").message;
  const siblingOpening = reservedWordMessage("value").split(". ")[0];

  assert.equal(siblingOpening, "value is already part of OpenLogo");
  assert.ok(
    message.endsWith(`${siblingOpening}.`),
    `the clause must reuse the sibling's opening verbatim, got ${JSON.stringify(message)}`,
  );

  // ...and the prescribed second clause stays out, because binding a keyword is legal
  // (`spec/grammar.md:390`) so renaming is not the repair. A mutant restoring it must fail here.
  assert.doesNotMatch(message, /choose another name/u);
  assert.match(reservedWordMessage("value"), /choose another name\./u);
});

test("the code, params, stage, severity, and span are untouched — only prose changed", () => {
  const diagnostic = badTokenFor("repeat value [ ]", "value");

  assert.equal(diagnostic.code, "ol-bad-token");
  assert.deepEqual(diagnostic.params, { text: "value" });
  assert.equal(diagnostic.stage, "parse");
  assert.equal(diagnostic.severity, "error");
  // The span still points at `value` alone — five characters starting at column 8.
  assert.deepEqual(diagnostic.source_span.start, [1, 8]);
  assert.deepEqual(diagnostic.source_span.end, [1, 13]);
});

test("all six of #853's words now name the owner", () => {
  for (const word of REGRESSION_WORDS) {
    const diagnostic = badTokenFor(`repeat ${word} [ ]`, word);

    assert.equal(
      diagnostic.message,
      `i don't know how to read ${word} here. ${ownershipSentence(word)}`,
    );
    assert.deepEqual(diagnostic.params, { text: word });
  }
});

/**
 * Positions where an ordinary name parses clean, so the keyword really is why the reader stopped —
 * and where a rejection of `:set` is therefore attributable to the substitution rather than to
 * something else wrong with the program. The two positions outside this set reject `wibble` too.
 */
const ORDINARY_NAME_IS_FINE = new Set([
  "repeat",
  "plus",
  "paren",
  "optional-parameter",
]);

/** Positions where `:word` repairs the program outright. */
const REPAIRED_BY_VARIABLE = new Set(["repeat", "plus", "optional-parameter"]);

test("a misplaced keyword is met the same way in every position that rejects it", () => {
  // Six unrelated grammar positions, one message. Uniformity is what the shared builder can honestly
  // offer — see the next two tests for what it costs, measured rather than assumed.
  for (const probe of PROBES) {
    assert.equal(
      badTokenFor(probe.withKeyword, "set").message,
      `i don't know how to read set here. ${ownershipSentence("set")}`,
      probe.name,
    );
  }
});

test("no repair is prescribed, because `:word` repairs only three of the six positions", () => {
  // The measurement that decides the design. Pinned so a later slice cannot add a context-free
  // did-you-mean without this failing, and so a slice that gains position information can move the
  // line knowingly.
  //
  // **Each row is guarded by the ordinary-name control**, because a row where *any* name is rejected
  // cannot show whether `:set` is at fault — though it still shows the hint would not have helped,
  // which is why such rows stay in the denominator of six. Attribution and efficacy are different
  // questions and the guard scopes them differently: `explained` below counts only attributable
  // rows, while `repaired` is out of all six, because a learner who follows "did you mean :set?" at
  // `struct point set` is still stuck whatever the reason.
  //
  // The guard is what stops a row passing for the wrong reason: `optional-parameter` was once
  // counted as unrepaired when its only finding was `ol-missing-end` for a body it never had, and
  // `paren` would otherwise be indistinguishable from the two slot-shaped rows.
  //
  // "Clean" here means **parse**-clean, which is the right stage for a parse-stage message. Some
  // controls are deliberately not semantically clean — `define f (:x wibble)` + body reports
  // `ol-undefined-var`, since the second element of an optional parameter is a default-value
  // expression rather than a second name — and that is irrelevant to what these rows measure.
  let repaired = 0;
  for (const probe of PROBES) {
    assert.notEqual(
      parse(probe.withKeyword, document).diagnostics.length,
      0,
      `${probe.name}: the bare keyword must be rejected`,
    );

    const withVariable = parse(probe.withVariable, document).diagnostics;
    const withOrdinaryName = parse(
      probe.withOrdinaryName,
      document,
    ).diagnostics;

    if (!ORDINARY_NAME_IS_FINE.has(probe.name)) {
      // The slot rejects `wibble` as well, so this row cannot attribute anything to `:set` — but it
      // still counts as a position the hint would not have repaired.
      assert.notEqual(withOrdinaryName.length, 0, probe.name);
      assert.notEqual(withVariable.length, 0, probe.name);
      continue;
    }

    // The slot accepts a plain name, so whatever happens to `:set` is about `:set`.
    assert.deepEqual(
      withOrdinaryName,
      [],
      `${probe.name}: control must be parse-clean`,
    );
    if (REPAIRED_BY_VARIABLE.has(probe.name)) {
      assert.deepEqual(withVariable, [], probe.name);
      repaired += 1;
    } else {
      assert.notEqual(withVariable.length, 0, probe.name);
    }
  }
  assert.equal(repaired, 3);
  assert.equal(PROBES.length - repaired, 3);

  // And no message offers one.
  for (const probe of PROBES) {
    assert.doesNotMatch(
      badTokenFor(probe.withKeyword, "set").message,
      /did you mean|write |instead/u,
    );
  }
});

test("ownership is stated, and no cause is claimed — because it is the cause in only four of six", () => {
  // Why the sentence stops at `<word> is already part of OpenLogo.` with no causal tail. Measured
  // with an ordinary-name control: where `wibble` parses clean, the keyword really is why the reader
  // stopped. Where `wibble` is rejected too, the slot wanted something else — `[` after a struct
  // name, `from` in a remove — so a tail like "so it cannot be read as a name here" would blame
  // ownership for a rejection a rename would not fix. `spec/grammar.md:394` guarantees only the
  // weaker proposition, so the weaker proposition is all the message asserts.
  let explained = 0;
  for (const probe of PROBES) {
    const ordinary = parse(probe.withOrdinaryName, document).diagnostics;
    if (ORDINARY_NAME_IS_FINE.has(probe.name)) {
      assert.deepEqual(
        ordinary,
        [],
        `${probe.name}: an ordinary name is fine here`,
      );
      explained += 1;
      continue;
    }
    assert.ok(
      ordinary.some(
        (d) => d.code === "ol-bad-token" && d.params.text === "wibble",
      ),
      `${probe.name}: an ordinary name must be rejected too, or this row proves nothing`,
    );
  }
  assert.equal(explained, 4);
  assert.equal(PROBES.length - explained, 2);

  // The message therefore carries no causal tail at all — this is what makes the 4-of-6 residue
  // harmless rather than merely documented.
  assert.doesNotMatch(
    badTokenFor("struct point set", "set").message,
    /so it|because|cannot be read/u,
  );
});

test("the six words the issue names are all optional-profile, which is why no form is quoted", () => {
  // The second half of the reason, measured. Each word's own form belongs to Data or Heritage
  // (`spec/conformance.md:102-104`, `spec/grammar.md:394`), while the reader is profile-blind — so a
  // form quoted at parse time could be one the learner's profile set cannot run. `value` is the
  // sharpest: its only production is the heritage reader, which Core rejects outright.
  //
  // NOTE for whoever fixes the `check()` profile gate: these two `deepEqual`s depend on a live
  // defect. `check()` does **not** currently profile-gate the Data structural forms — `:ages = {
  // tom: 8 }` and `struct point [ x y ]` both check clean under `["core-language"]` despite
  // `spec/conformance.md:102-104`. When that is fixed the dict literal will add a diagnostic here
  // and these assertions will need the Data profile added, or the dict operand replaced. The claim
  // under test is only that the *heritage head* is rejected, so widening them is safe.
  assert.deepEqual(
    coreDiagnostics(':ages = { tom: 8 }\nprint value of :ages for key "tom"'),
    ["semantic:ol-unknown-command"],
  );
  assert.deepEqual(coreDiagnostics('make "size" 10'), [
    "semantic:ol-unknown-command",
  ]);
  // Paired control: a Core form of the same shape checks clean, so the assertions above are about
  // the profile and not about my harness.
  assert.deepEqual(coreDiagnostics("set size to 10"), []);
});

test("naming a variable after a keyword stays legal, as the prose implies", () => {
  // `spec/grammar.md:390`: every binding form MUST accept any name. The sentence says openlogo owns
  // the word, never that nothing may be named it — this pins the difference.
  for (const source of [
    "local set",
    "set set to 10",
    "for set in [ 1 2 3 ] [ print :set ]",
    "local value",
  ]) {
    assert.deepEqual(coreDiagnostics(source), [], source);
  }
});

test("the learner's own spelling is quoted back, while the match ignores case", () => {
  const diagnostic = badTokenFor("repeat Value [ ]", "Value");

  assert.equal(
    diagnostic.message,
    `i don't know how to read Value here. ${ownershipSentence("Value")}`,
  );
  assert.equal(isKeyword("VaLuE"), true);
});

test("a token that is not a keyword keeps the bare message", () => {
  // The paired control: `)` and a stray number are the common `ol-bad-token` texts, and neither may
  // grow a clause. Without this, "the message is longer" could not be distinguished from "every
  // ol-bad-token got a clause".
  for (const [source, text] of [
    ["print ( set 1 )", ")"],
    ["struct point [ 1 ]", "1"],
    ["print ( set 1 )", "1"],
  ]) {
    assert.equal(
      badTokenFor(source, text).message,
      `i don't know how to read ${text} here.`,
    );
  }
});

test("the run-on path keeps its own message, which already names a legal form", () => {
  // `forward set` is `missingTerminator`, not `unexpected` — a different defect (two instructions on
  // one line) that already tells the learner the legal form. Deliberately out of #878's scope.
  assert.equal(
    badTokenFor("forward set", "set").message,
    "each instruction needs a new line of its own. i didn't expect set to keep going on this line.",
  );
});

test("the three words with no reader production keep the bare message", () => {
  // `spec/grammar.md:162-164` gives all three a real production, so for them the sentence's
  // *causality* would be false: the grammar permits the word exactly where it stands and this
  // implementation is behind. Blaming openlogo's ownership would teach something untrue.
  const correctForms = {
    alias: "alias forward fd",
    export: "export square",
    import: 'import "shapes"',
  };
  assert.deepEqual(
    Object.keys(correctForms).sort(),
    [...KEYWORDS_WITH_NO_READER_PRODUCTION].sort(),
  );

  for (const [word, source] of Object.entries(correctForms)) {
    // Measured, not assumed: each is a Core keyword that the reader nonetheless rejects at parse
    // stage when written exactly as the grammar says.
    assert.equal(isKeyword(word), true, word);
    assert.equal(coreDiagnostics(source)[0], "parse:ol-bad-token", source);
    assert.equal(
      badTokenFor(source, word).message,
      `i don't know how to read ${word} here.`,
      word,
    );

    // The exclusion arm is case-normalized too, and this pins it. Review found that dropping the
    // `.toLowerCase()` on the exclusion lookup survived the whole suite: a capitalized spelling
    // would then gain the ownership sentence, which is the false causality this exclusion exists to
    // prevent. Only the positive arm had a case probe before.
    const capitalized = word[0].toUpperCase() + word.slice(1);
    const capitalizedSource = source.replace(word, capitalized);
    assert.equal(
      badTokenFor(capitalizedSource, capitalized).message,
      `i don't know how to read ${capitalized} here.`,
      capitalized,
    );
  }
});

/**
 * The keywords the `expression` grammar genuinely admits, so the reader never rejects them in a
 * value position and the sentence is unreachable for them: `true`/`false` are the `boolean-literal`
 * production (`spec/grammar.md:208`), `map`/`filter`/`reduce` open a `comprehension`
 * (`spec/grammar.md:134-137`), `not` is the prefix operator of `unary` (`spec/grammar.md:193`), and
 * `thing` is matched as a `callable-name` because the C3 primitive matrix gives it a callable form —
 * `spec/grammar.md:394` names it outright, *"as it does for the `thing` reporter and for the variadic
 * `( and … )` and `( or … )` forms"*. That same sentence predicts why `and` and `or` sit **outside**
 * this set: only their parenthesized spellings are callable, so they are still rejected elsewhere.
 *
 * The first six are `reserved-word-value-position.test.mjs`'s own `EXPRESSION_INITIAL` set, restated
 * here rather than shared: neither file exports it, and the `asserted === 34` pin below fails on any
 * behavioural drift, so a copy cannot rot silently.
 */
const NEVER_REJECTED_IN_A_VALUE_POSITION = new Set([
  "true",
  "false",
  "map",
  "filter",
  "reduce",
  "thing",
  "not",
]);

test("every Core keyword the reader rejects earns the sentence, and nothing else does", () => {
  // The registry sweep: membership comes from `keywords.ts`, so a keyword added there is covered
  // here with no second edit — and one added without a decision fails loudly rather than defaulting.
  const earned = OL_KEYWORDS.filter(
    (word) => !KEYWORDS_WITH_NO_READER_PRODUCTION.has(word),
  );
  assert.equal(earned.length, OL_KEYWORDS.length - 3);

  let asserted = 0;
  for (const word of earned) {
    const rejections = [
      `print 1 + ${word}`,
      `repeat ${word} [ ]`,
      `print ( ${word} 1 )`,
    ].flatMap((source) =>
      parse(source, document).diagnostics.filter(
        (d) => d.code === "ol-bad-token" && d.params.text === word,
      ),
    );

    if (rejections.length === 0) {
      // Not a gap: the grammar admits this word as an expression, so there is nothing to explain.
      assert.ok(
        NEVER_REJECTED_IN_A_VALUE_POSITION.has(word),
        `${word} is rejected in no probed position but is not an expression-initial keyword`,
      );
      continue;
    }
    for (const diagnostic of rejections) {
      assert.equal(
        diagnostic.message,
        `i don't know how to read ${word} here. ${ownershipSentence(word)}`,
        word,
      );
    }
    asserted += 1;
  }

  // The non-zero control, pinned exactly: an inert build, or one that quietly stopped rejecting
  // keywords, cannot reach this number by skipping every word.
  assert.equal(
    asserted,
    earned.length - NEVER_REJECTED_IN_A_VALUE_POSITION.size,
  );
  assert.equal(asserted, 34);

  // Paired negative control: ordinary names and lexical garbage never gain the sentence.
  for (const text of ["forward", "]", "end of file", "fowad"]) {
    assert.equal(isKeyword(text), false, text);
  }
});

test("#879's pinned shape is untouched: no delimiter can reach the clause", () => {
  // A delimiter is never a keyword, so the unmatched-delimiter paths cannot gain a clause. Measured
  // here rather than argued, because `newline-continuations-and-delimiters.test.mjs` pins these
  // programs at exactly one `ol-unmatched-bracket` and both a fix and a regression fail it.
  for (const source of [
    "repeat 2 [ repeat :x\n]",
    "repeat 2 [ if 1 == 1\n]",
    "repeat 2 [ define f\n]",
  ]) {
    const diagnostics = parse(source, document).diagnostics;
    assert.equal(
      diagnostics.filter((d) => d.code === "ol-unmatched-bracket").length,
      1,
      source,
    );
    assert.equal(
      badTokenFor(source, "]").message,
      "i don't know how to read ] here.",
      source,
    );
  }
});
