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
// **Order matters, and this file is written to expose it.** A was fixed first and each phantom was
// confirmed to vanish *as a cascade*, with the diagnostic itself untouched; only what genuinely
// remained was B. Fixing B first would have removed #980's phantom parens while the expression
// still parsed to a tree that differs from its one-line spelling.
//
// **What the #980 defect actually did, measured at `0277d5ff` for `:d = { a: 7 b: "a" }`** — it
// differed by container, which is why one sentence about it would be wrong:
//
//   `print ( :d` ⏎ `.a )`      2× `ol-unmatched-paren`; the field SURVIVED. `parseParenthesized`
//                              skips newlines after its inner expression, so the `.` was already
//                              current — only the phantom diagnostics were wrong here.
//   `print [ :d` ⏎ `.a ]`      `ol-bad-token`; the field was DROPPED, `.a` became a separate call.
//   `print { x: :d` ⏎ `.a }`   2× `ol-bad-token`; dropped.
//   `print :d` ⏎ `.a`          `ol-bad-token`; dropped, and split into separate statements.
//
// So "the field was silently dropped" is true for three containers and false for the parenthesized
// one, and "no diagnostic" is false for all four. What is uniformly true is that the TREE differed
// from the one-line spelling — in three containers by being *smaller* rather than malformed, a
// shape no diagnostic describes. That is what these tests assert.

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
  // Names the #980 misreading rather than trusting the tree comparison to have covered it. The
  // container is chosen deliberately: in a LIST the defect dropped `.a` and left a bare read, which
  // is a *smaller* tree rather than a malformed one — the shape no diagnostic describes. (In a
  // parenthesized group the field survived and only the phantom parens were wrong; see the header.)
  const { ast } = OL.parse(`${PRELUDE}print [ :d\n.a ]\n`, doc);
  const printed = ast.body.at(-1).args[0];

  assert.equal(printed.kind, "ListLit");
  assert.equal(printed.elements.length, 1);
  assert.equal(printed.elements[0].kind, "Place");
  assert.equal(printed.elements[0].base.name, "d");
  assert.deepEqual(
    printed.elements[0].segments.map((segment) => segment.name.name),
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

test("an entry lookahead does not fire while the value is still owed an operand", () => {
  // `spec/grammar.md:314` gives an unfinished value precedence: *"where the value is not yet
  // complete — an operator or a call still owed an operand, say … the unfinished value's own
  // grammar position wins and no entry opens, so `{ a: 1 + b: 2 }` is a malformed entry rather than
  // two entries."* A call is owed an operand exactly as an operator is, so `{ a: sentence 1 mod: 2 }`
  // must be malformed too — not an entry keyed `mod` leaving `sentence` one argument short.
  //
  // Both directions are asserted, because they pull opposite ways and a fix for one breaks the
  // other: when the call is COMPLETE the key does open its entry, and clearing the lookahead for
  // the whole argument would swallow that `mod` as an operator and turn a valid two-entry
  // dictionary into a parse error.
  for (const word of ["mod", "and", "or", "is"]) {
    for (const source of [
      `print { a: sentence 1 ${word}: 2 }\n`,
      `print { a: sentence 1\n${word}: 2 }\n`,
    ]) {
      const { ast, diagnostics } = OL.parse(source, doc);

      assert.ok(
        diagnostics.some((diagnostic) => diagnostic.code === "ol-bad-token"),
        `${source} must be a malformed entry`,
      );
      assert.deepEqual(
        ast.body[0].args[0].entries.map((entry) => entry.key.value),
        ["a"],
        `${source} must not open an entry keyed \`${word}\``,
      );
    }
  }

  // The complete call: the key DOES open its entry, and the two spellings agree.
  const complete = "print { a: sentence 1 2 mod: 3 }\n";
  assert.deepEqual(codesOf(complete), []);
  assert.deepEqual(
    OL.parse(complete, doc).ast.body[0].args[0].entries.map(
      (entry) => entry.key.value,
    ),
    ["a", "mod"],
  );
  assert.equal(
    shapeOf(complete),
    shapeOf("print { a: sentence 1 2\nmod: 3 }\n"),
  );
});

test("a newline still terminates a statement", () => {
  const { ast, diagnostics } = OL.parse("print 1\nprint 2\n", doc);

  assert.deepEqual(diagnostics, []);
  assert.equal(ast.body.length, 2);
});

test("a pending call argument does not reach across a newline", () => {
  // The exact boundary the owed-operand branch must not cross. `print` is owed an argument, and a
  // newline still ends its statement — so this is TWO statements, and `print` is reported short by
  // the arity checker rather than silently joined to the next line. An unconditional newline skip
  // in `parseFixedCall` would make it one, which is the statement-delimitation question tracked by
  // **#983** and deliberately out of this slice's scope. The complete `print 1` above cannot catch
  // that mistake; only a pending call can.
  const { ast, diagnostics } = OL.parse("print\nabs 3\n", doc);

  assert.deepEqual(diagnostics, []);
  assert.deepEqual(
    ast.body.map((statement) => statement.kind),
    ["Call", "Call"],
  );
  assert.equal(ast.body[0].args.length, 0);
  assert.deepEqual(
    codesOf("print\nabs 3\n").filter((code) => code === "ol-not-enough-inputs"),
    ["ol-not-enough-inputs"],
  );
});

test("the entry lookahead's decision is visible to the highlighter", () => {
  // The lookahead decides a `dict-key`/`operator` split that the token classes must follow, and
  // the highlighter derives them from the AST — so a regression in the parser silently repaints
  // the program. Both readings are legal and clean, which is exactly why this needs pinning:
  // nothing else would notice the swap.
  const keyClasses = (source) =>
    OL.highlight(source, doc)
      .filter((token) => token.text?.toLowerCase() === "mod")
      .map((token) => token.class);

  assert.deepEqual(keyClasses("print { a: 1 mod: 2 }\n"), ["dict-key"]);
  assert.deepEqual(keyClasses("print { a: 1\nmod: 2 }\n"), ["dict-key"]);
  assert.deepEqual(keyClasses("print { a: 1 mod :two }\n"), ["operator"]);
});

test("a newline separates exactly like a space, for adjacency too", () => {
  // MAINTAINER RULING (issue #944's sibling question): *a newline separates exactly like a space —
  // always, everywhere.* Adjacency is whitespace-agnostic, and a newline is whitespace: it is
  // insignificant to the GRAMMAR, not invisible to the LEXER.
  //
  // This is a NARROWING, and the direction matters. A newline token's `end` IS the next line's
  // column 1, so once a group skipped it the following `[` tested as adjacent — a skipped newline
  // *manufactured* an adjacency the source never had, and `( :nums` ⏎ `[1] )` read `[1]` as a
  // selector while `( :nums [1] )` read a separate list. The two spellings now agree.
  //
  // The third assertion is what stops this test passing if adjacency stopped working altogether:
  // the truly adjacent spelling must still differ from both.
  const prelude = ":nums = [ 1 2 3 ]\n";

  for (const [label, container] of [
    ["parenthesized group", ["print ( :nums", "[1] )"]],
    ["list literal", ["print [ :nums", "[1] ]"]],
    ["dict entry value", ["print { k: :nums", "[1] }"]],
    ["top level", ["print :nums", "[1]"]],
  ]) {
    const [head, tail] = container;
    const newline = `${prelude}${head}\n${tail}\n`;
    const spaced = `${prelude}${head} ${tail}\n`;
    const glued = `${prelude}${head}${tail}\n`;

    assert.equal(
      shapeOf(newline),
      shapeOf(spaced),
      `${label}: newline ≠ space`,
    );
    assert.notEqual(
      shapeOf(newline),
      shapeOf(glued),
      `${label}: newline must not read as the glued selector`,
    );
    assert.deepEqual(
      codesOf(glued),
      [],
      `${label}: the glued spelling is a selector`,
    );
  }
});

test("the narrowing does not move a multi-line control or comprehension body", () => {
  // The regression this direction had to avoid, asserted rather than argued. A newline after a
  // control or procedure header selects the long `… end` body form (`spec/grammar.md:34`), so
  // `map n in :nums` ⏎ `[ … ]` is a body, not a selector — and it must stay that way. A narrowing
  // can only make the `[` *less* likely to bind, so these are strictly more protected than before.
  for (const source of [
    "print map n in :nums\n[ :n * 2 ]\n",
    "print filter n in :nums\n[ :n > 1 ]\n",
    "repeat 3\n[ print 1 ]\n",
  ]) {
    assert.ok(
      codesOf(source).includes("ol-missing-end"),
      `${source} must still select the long-body form`,
    );
  }
  assert.deepEqual(codesOf("print map n in [ 1 2 ] [ :n * 2 ]\n"), []);
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
  // The next two reach end-of-input branches that report WITHOUT the `isGenuinelyUnmatched` gate,
  // and nothing witnessed them until review measured which branch each row above actually reaches.
  // Neither is reachable by a shape already listed: `print ( 1 + 2` takes the *gated* paren path,
  // not the end-of-input one, so it left the paren-call branch uncovered despite looking like its
  // witness. Rows here are cheap; a report site with no witness is not.
  ["unclosed paren call", "print (sum 1 2", "ol-unmatched-paren"],
  ["unclosed block body", "repeat 2 [ print 1", "ol-unmatched-bracket"],
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
