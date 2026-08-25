// Guard tests for the two mechanisms behind issues #944, #947, #979, #980 and #879.
//
// The five were dispatched as one slice on the framing "a newline breaks a continuation, and/or a
// phantom unmatched-delimiter appears on balanced delimiters". Measurement at `ca653709` split that
// into **two mechanisms**, and the distinction is what this file pins:
//
// **A — a newline breaks a continuation.** `spec/grammar.md:34` says newlines are insignificant
// within one expression, and three readers did not honour it: the dict entry separator (#944), the
// `value`/`of` interception in `parseNamePrimary` (#979), and `parsePostfix`'s `.field` lookahead
// (#980). Each is the shape #962 fixed for the `value of … for key …` tail.
//
// **B — the recovery path reports a matched delimiter as unmatched.** `parseParenthesized` reported
// its `(` unmatched whenever the inner expression failed, without ever checking whether the `)` was
// present, and `unexpected()` mapped *any* stray closer to an unmatched-delimiter diagnostic. Both
// violate `spec/error-model.md:165-169`, which is delimiter-agnostic: *"on any recovery path, for
// any malformed input, a parser MUST NOT raise any unmatched-delimiter diagnostic … for a delimiter
// that is, in fact, correctly matched in the source."*
//
// **#879 shares B's emission site but not A's root**, which is why it is here: `( set 1 )` is a
// single line with no continuation to fix. That measurement is pinned below, because it is the
// reason the slice needed both halves rather than one.
//
// **Order matters, and this file is written to expose it.** Fixing B first would have silenced
// #980's phantom while `( :d`⏎`.a )` still parsed into the wrong tree — `:d` alone, `.a` dropped,
// no diagnostic. So A was fixed first and each phantom was confirmed to vanish *as a cascade*, with
// the diagnostic itself untouched; only what genuinely remained was B. Every test here therefore
// asserts the TREE where a tree is at stake, and the diagnostic only where the diagnostic is the
// subject.

import assert from "node:assert/strict";
import { test } from "node:test";
import * as OL from "@openlogo/parser";

const doc = "newline-continuations-and-delimiters.logo";

/** A dict to read from, a key, and a nested dict — enough for every shape below. */
const PRELUDE = ':d = { a: 7 b: "a" }\n:k = "a"\n';

/** Parse diagnostics plus the semantic ones `check()` finds under Core + Data + Heritage. */
function allDiagnostics(source) {
  const { ast, diagnostics } = OL.parse(source, doc);
  const checked = OL.check(ast, {
    profiles: ["core-language", "data", "heritage"],
    source,
  });
  return [...diagnostics, ...checked.diagnostics];
}

/** The `ol-*` codes `source` produces, in order. */
function codesOf(source) {
  return allDiagnostics(source).map((diagnostic) => diagnostic.code);
}

/**
 * `source`'s AST with every `source_span` stripped. Spans are exactly what a newline is *allowed*
 * to change — a two-line spelling genuinely does span two lines — so comparing two spellings means
 * comparing the tree shape that survives that difference.
 */
function shapeOf(source) {
  return JSON.stringify(OL.parse(source, doc).ast, (key, value) =>
    key === "source_span" ? undefined : value,
  );
}

// --- Mechanism A: a newline must not break a continuation ----------------------------------------

/**
 * `[label, one-line spelling, newline spelling]`. The one-line member is both the CONTROL and the
 * expected reading of its partner, so one table drives cleanliness and meaning together.
 *
 * The axes are varied deliberately, because #962 was survived by PR #916 for want of exactly this:
 * the container (bare, paren, list, dict), the newline's position, the dict key's spelling (a
 * `:variable` key, since a literal key hides the dict defect), and keyword CASE.
 */
const SPELLINGS = [
  // #979 — the `value`/`of` interception site.
  [
    "value/of, bare",
    "print value of :d for key :k",
    "print value\nof :d for key :k",
  ],
  [
    "value/of, parenthesized",
    "print (value of :d for key :k)",
    "print (value\nof :d for key :k)",
  ],
  [
    "value/of, in a dict entry value",
    "print { a: value of :d for key :k }",
    "print { a: value\nof :d for key :k }",
  ],
  [
    "value/of, UPPERCASE",
    "print VALUE OF :d FOR KEY :k",
    "print VALUE\nOF :d FOR KEY :k",
  ],
  [
    "value/of, newline at every slot",
    "print value of :d for key :k",
    "print value\nof\n:d\nfor\nkey\n:k",
  ],
  // #980 — the `.field` postfix.
  ["postfix, parenthesized", "print ( :d .a )", "print ( :d\n.a )"],
  ["postfix, list element", "print [ :d .a ]", "print [ :d\n.a ]"],
  ["postfix, dict entry value", "print { x: :d .a }", "print { x: :d\n.a }"],
  [
    "postfix, chained across two newlines",
    "print ( :nested .inner .x )",
    "print ( :nested\n.inner\n.x )",
  ],
  // #944 — the dict entry separator, both lexemes.
  ["dict key separator", "print { a: 1 mod: 2 }", "print { a: 1\nmod: 2 }"],
  [
    "dict variable read stays an operator",
    "print { a: 1 mod :two }",
    "print { a: 1\nmod :two }",
  ],
];

const NESTED = ":nested = { inner: { x: 9 } }\n:two = 2\n";

test("a newline inside an expression is diagnosed neither at parse nor at check", () => {
  for (const [label, , split] of SPELLINGS) {
    assert.deepEqual(
      allDiagnostics(`${PRELUDE}${NESTED}${split}\n`),
      [],
      `${label}: the newline spelling was diagnosed`,
    );
  }
});

test("the one-line spellings stay clean", () => {
  for (const [label, oneLine] of SPELLINGS) {
    assert.deepEqual(
      allDiagnostics(`${PRELUDE}${NESTED}${oneLine}\n`),
      [],
      `${label}: the one-line control was diagnosed`,
    );
  }
});

test("a newline inside an expression produces the AST of its one-line spelling", () => {
  // The load-bearing assertion. `dict variable read stays an operator` and the dict rows are why:
  // their broken readings parse CLEAN into a different tree, so a diagnostics-only assertion walks
  // straight past them.
  for (const [label, oneLine, split] of SPELLINGS) {
    assert.equal(
      shapeOf(`${PRELUDE}${NESTED}${split}\n`),
      shapeOf(`${PRELUDE}${NESTED}${oneLine}\n`),
      `${label}: the newline spelling parsed to a different tree`,
    );
  }
});

test("a postfix read across a newline reaches the field, not just the base", () => {
  // Names the #980 misreading rather than trusting the tree comparison to have covered it: the
  // defect dropped `.a` entirely and left a bare `VarRef`, which is a *smaller* tree, not a
  // malformed one.
  const { ast } = OL.parse(`${PRELUDE}print ( :d\n.a )\n`, doc);
  const printed = ast.body.at(-1).args[0];

  assert.equal(printed.kind, "Place");
  assert.equal(printed.base.name, "d");
  assert.deepEqual(
    printed.segments.map((segment) => segment.name.name),
    ["a"],
  );
});

test("`of` stays a keyword when the reader is split across a newline", () => {
  // #785's rule: `of` is the contextual preposition of this reader and takes the `keyword` token
  // class, never `primitive` (`spec/tooling.md:97-99`). The highlighter marks it positionally from
  // `value`, so a newline between the two is exactly the shape that could desynchronise it.
  for (const source of [
    "print value of :d for key :k",
    "print value\nof :d for key :k",
    "print value\n\nof :d for key :k",
  ]) {
    const tokens = OL.highlight(`${PRELUDE}${source}\n`, doc);
    const of = tokens.find(
      (token) => token.text !== undefined && token.text.toLowerCase() === "of",
    );

    assert.notEqual(of, undefined, source);
    assert.equal(of.class, "keyword", source);
  }
});

// --- Mechanism A must not reach too far ----------------------------------------------------------

test("a newline still terminates a statement", () => {
  const { ast, diagnostics } = OL.parse("print 1\nprint 2\n", doc);

  assert.deepEqual(diagnostics, []);
  assert.equal(ast.body.length, 2);
});

test("a selector `[` deliberately does NOT cross a newline", () => {
  // `spec/grammar.md:34` gives a newline a competing job here — *"immediately after a control or
  // procedure header, a newline selects the long `... end` body form"* — so `map n in :nums` ⏎
  // `[ … ]` is a long-form body, not a selector on `:nums`. Adjacency, which a newline breaks by
  // construction, is what keeps those apart, and widening the `.field` fix to `[` would swallow
  // every multi-line comprehension body. Pinned so a later slice does not "finish the job".
  const { diagnostics } = OL.parse("print map n in :nums\n[ :n * 2 ]\n", doc);

  assert.ok(diagnostics.some((d) => d.code === "ol-missing-end"));
});

test("the selector `[` case is left exactly as it was found, minus the phantom", () => {
  // **An open spec question, escalated rather than decided.** `spec/grammar.md:34` says newlines
  // are insignificant inside a parenthesized group, but a selector `[` binds only when *adjacent*,
  // and a newline token's end IS the next line's column 1 — so after the group skips it the `[`
  // tests as adjacent. The result is that these two spellings of the same source disagree:
  //
  //   `( :nums` ⏎ `[1] )`  reads `[1]` as a SELECTOR on `:nums`
  //   `( :nums [1] )`      reads `:nums`, then a separate list literal
  //
  // Measured at `ca653709`, **this disagreement is pre-existing** — identical trees there, differing
  // in the same way. This slice changes only the diagnostics: the two phantom `ol-unmatched-paren`
  // that both spellings used to raise on balanced parens are gone. Deciding which reading is right
  // widens or narrows the grammar, so it is a maintainer `[spec]` call and is reported, not taken.
  //
  // This test pins the boundary of what was changed: no unmatched-delimiter diagnostic survives on
  // these balanced parens, and the trees are left as found.
  const prelude = ":nums = [ 1 2 3 ]\n";
  const split = `${prelude}print ( :nums\n[1] )\n`;
  const oneLine = `${prelude}print ( :nums [1] )\n`;

  for (const source of [split, oneLine]) {
    assert.deepEqual(
      codesOf(source).filter((code) => code.startsWith("ol-unmatched-")),
      [],
    );
  }
  // The pre-existing disagreement itself, pinned so a future ruling has a witness to change.
  assert.notEqual(shapeOf(split), shapeOf(oneLine));
  // The glued spelling is a selector in every position and is not in question.
  assert.deepEqual(codesOf(`${prelude}print :nums[1]\n`), []);
});

test("an incomplete reader does not swallow the statement on the next line", () => {
  const { ast } = OL.parse(`${PRELUDE}print value of :d\nprint 2\n`, doc);

  assert.deepEqual(
    ast.body.map((statement) => statement.kind),
    ["Assign", "Assign", "Call", "Call"],
  );
});

// --- Mechanism B: a matched delimiter is never reported as unmatched ------------------------------

/** Sources whose delimiters are all correctly matched, but whose contents are malformed. */
const MATCHED_BUT_MALFORMED = [
  ["#879 reserved word as callee", "print ( set 1 )", "set"],
  ["#879 `if`", "print ( if 1 )", "if"],
  ["#879 `import`", "print ( import 1 )", "import"],
  ["#879 `in`", "print ( in 1 )", "in"],
  ["#879 `struct`", "print ( struct 1 )", "struct"],
  ["#879 `add`", "print ( add 1 )", "add"],
  ["#879 `clear`", "print ( clear :nums )", "clear"],
  ["#879 bare `value`", "print ( value )", "value"],
  ["paren, missing operand", "print ( 1 + )", ")"],
  ["bracket, missing operand", "print [ 1 + ]", "]"],
  ["brace, missing operand", "print { a: 1 + }", "}"],
  ["selector, empty key", "print :nums[]", "]"],
  ["nested, bracket inside paren", "print ( [ 1 + ] )", "]"],
];

test("no unmatched-delimiter diagnostic is raised on delimiters that are matched", () => {
  // The delimiter-agnostic MUST NOT, asserted by CODE across all three delimiters so the test keeps
  // failing for the right reason if some unrelated diagnostic appears on the same source.
  for (const [label, source] of MATCHED_BUT_MALFORMED) {
    const offending = codesOf(source).filter((code) =>
      code.startsWith("ol-unmatched-"),
    );

    assert.deepEqual(offending, [], `${label}: ${source}`);
  }
});

test("the offending token is named instead", () => {
  // Substituting a report, rather than staying silent, is the load-bearing half: every caller
  // reports and then abandons its construct, so returning nothing would hand the caller a silent
  // success and the abandoned tokens would be re-read as statements — one honest error becoming a
  // cascade of invented ones.
  for (const [label, source, named] of MATCHED_BUT_MALFORMED) {
    const first = allDiagnostics(source).find(
      (diagnostic) => diagnostic.code === "ol-bad-token",
    );

    assert.notEqual(first, undefined, `${label}: nothing named the defect`);
    assert.equal(first.params.text, named, `${label}: ${source}`);
  }
});

/** Sources where a delimiter genuinely has no partner — the diagnostic must survive. */
const GENUINELY_UNMATCHED = [
  ["unclosed paren", "print ( 1 + 2", "ol-unmatched-paren"],
  ["unclosed bracket", "print [ 1 2", "ol-unmatched-bracket"],
  ["unclosed brace", "print { a: 1", "ol-unmatched-brace"],
  ["unclosed selector", "print :nums[1", "ol-unmatched-bracket"],
  ["stray closing paren", "print 1 )", "ol-unmatched-paren"],
  ["stray closing bracket", "print 1 ]", "ol-unmatched-bracket"],
  ["stray closing brace", "print 1 }", "ol-unmatched-brace"],
  [
    "unclosed destructuring binder",
    "for [:x :y in [1] [ print 1 ]",
    "ol-unmatched-bracket",
  ],
];

test("a genuinely unmatched delimiter is still reported, exactly once", () => {
  // The other direction, and the reason the two tests above are not a suppression: a fix that
  // simply stopped emitting the class would satisfy them and destroy real error reporting.
  for (const [label, source, expected] of GENUINELY_UNMATCHED) {
    assert.deepEqual(
      codesOf(source).filter((code) => code === expected),
      [expected],
      `${label}: expected exactly one ${expected} for \`${source}\``,
    );
  }
});

test("#879 is a mechanism-B defect, not a newline defect", () => {
  // The measurement that separated the two mechanisms, kept as a test because it is the reason the
  // slice needed both halves. Every #879 shape is a SINGLE LINE: there is no continuation to fix,
  // so mechanism A leaves it untouched and only B closes it.
  for (const [label, source] of MATCHED_BUT_MALFORMED) {
    assert.ok(!source.includes("\n"), `${label} must be single-line`);
  }
});
