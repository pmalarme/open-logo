// Issue #933 — `spec/grammar.md:34`: "Within a single expression, list literal, dict literal, or
// parenthesized group, newlines are insignificant." The reader used to treat a newline as a
// statement terminator even while an expression was still incomplete, so `print 1 +` / `2` raised
// `ol-bad-token` and a parenthesized group cascaded phantom `ol-unmatched-paren` diagnostics on
// parentheses that were matched (five diagnostics for one nested group).
//
// The same sentence also says a newline DOES end a statement at the top level, so half of this
// file is the opposite direction: the cases a fix must not swallow. Both halves matter — accepting
// `print 1` / `print 2` as one statement would silently change the meaning of correct programs,
// which is worse than the defect being fixed.

import assert from "node:assert/strict";
import { test } from "node:test";
import * as OL from "@openlogo/parser";

const doc = "multiline-expressions.logo";

/** Parse `source`, assert it is diagnostic-free, and return its statements. */
function parseClean(source) {
  const { ast, diagnostics } = OL.parse(source, doc);
  assert.deepEqual(diagnostics, []);
  return ast.body;
}

/** The single argument of a one-statement `print …` program. */
function printedExpression(source) {
  const body = parseClean(source);
  assert.equal(body.length, 1);
  assert.equal(body[0].kind, "Call");
  assert.equal(body[0].callee.name, "print");
  return body[0].args[0];
}

/** The diagnostic codes `source` raises, in order. */
function codesOf(source) {
  return OL.parse(source, doc).diagnostics.map((diagnostic) => diagnostic.code);
}

/**
 * `source`'s AST with every `source_span` stripped. Spans are exactly what a newline is *allowed*
 * to change, so comparing two spellings means comparing the tree shape that survives that
 * difference.
 */
function shapeOf(source) {
  return JSON.stringify(OL.parse(source, doc).ast, (key, value) =>
    key === "source_span" ? undefined : value,
  );
}

/** Assert `node` is a binary `Call` to `operator` over two number literals. */
function assertBinary(node, operator, left, right) {
  assert.equal(node.kind, "Call");
  assert.equal(node.callee.name, operator);
  assert.equal(node.args[0].value, left);
  assert.equal(node.args[1].value, right);
}

// --- an operator left dangling at the end of a line takes its operand from the next line --------

test("a trailing `+` takes its right operand from the next line", () => {
  assertBinary(printedExpression("print 1 +\n  2"), "+", 1, 2);
});

test("a trailing operator spans a blank line, which is one separator", () => {
  assertBinary(printedExpression("print 1 +\n\n\n  2"), "+", 1, 2);
});

test("a trailing operator carries an assignment right-hand side onto the next line", () => {
  const body = parseClean(":x = 1 +\n  2");

  assert.equal(body.length, 1);
  assert.equal(body[0].kind, "Assign");
  assertBinary(body[0].value, "+", 1, 2);
});

test("the worded `mod` operator takes its right operand from the next line", () => {
  assertBinary(printedExpression("print 5 mod\n  3"), "mod", 5, 3);
});

test("a trailing comparison operator takes its right operand from the next line", () => {
  assertBinary(printedExpression("print 1 <\n  2"), "<", 1, 2);
});

test("a trailing `and` takes its right operand from the next line", () => {
  const expression = printedExpression("print 1 == 1 and\n  2 == 2");

  assert.equal(expression.kind, "Call");
  assert.equal(expression.callee.name, "and");
});

test("a trailing unary `not` takes its operand from the next line", () => {
  const expression = printedExpression("print not\n  true");

  assert.equal(expression.kind, "Call");
  assert.equal(expression.callee.name, "not");
  assert.equal(expression.args[0].value, true);
});

test("a trailing `is between …` keeps its bounds across newlines", () => {
  const expression = printedExpression("print 5 is between\n  1 and\n  9");

  assert.equal(expression.kind, "IsPredicate");
  assert.equal(expression.test.form, "between");
  assert.equal(expression.test.low.value, 1);
  assert.equal(expression.test.high.value, 9);
});

test("a trailing `is member of` keeps its collection across a newline", () => {
  const expression = printedExpression("print 1 is member of\n  [1 2]");

  assert.equal(expression.kind, "IsPredicate");
  assert.equal(expression.test.form, "member-of");
  assert.equal(expression.test.collection.kind, "ListLit");
});

// --- a symbolic operator opening a line continues the expression above it ------------------------

test("a leading `+` continues the expression on the line above", () => {
  assertBinary(printedExpression("print 1\n  + 2"), "+", 1, 2);
});

test("a leading `*` continues at multiplicative precedence", () => {
  assertBinary(printedExpression("print 3\n  * 4"), "*", 3, 4);
});

test("a leading comparison operator continues at comparison precedence", () => {
  assertBinary(printedExpression("print 1\n  < 2"), "<", 1, 2);
});

test("a leading `mod` continues the expression on the line above", () => {
  assertBinary(printedExpression("print 5\n  mod 3"), "mod", 5, 3);
});

test("a leading `and` continues the expression on the line above", () => {
  const expression = printedExpression("print true\n  and false");

  assert.equal(expression.callee.name, "and");
  assert.equal(expression.args[0].value, true);
  assert.equal(expression.args[1].value, false);
});

test("a leading `or` continues the expression on the line above", () => {
  const expression = printedExpression("print false\n  or true");

  assert.equal(expression.callee.name, "or");
});

test("a leading `is` continues the expression on the line above", () => {
  const expression = printedExpression("print [1 2]\n  is empty");

  assert.equal(expression.kind, "IsPredicate");
  assert.equal(expression.test.form, "empty");
});

// --- every slot of an unfinished `is` predicate tolerates a newline ------------------------------

test("`is` takes its predicate word from the next line", () => {
  const expression = printedExpression("print [1 2] is\n  empty");

  assert.equal(expression.kind, "IsPredicate");
  assert.equal(expression.test.form, "empty");
});

test("`is member` takes its `of` from the next line", () => {
  const expression = printedExpression("print 2 is member\n  of [1 2 3]");

  assert.equal(expression.kind, "IsPredicate");
  assert.equal(expression.test.form, "member-of");
});

test("`is a` takes its type word from the next line", () => {
  const expression = printedExpression('print 5 is a\n  "number"');

  assert.equal(expression.kind, "IsPredicate");
  assert.equal(expression.test.form, "a");
  assert.equal(expression.test.type.value, "number");
});

test("`is strictly` takes its `between` from the next line", () => {
  const expression = printedExpression(
    "print 5 is strictly\n  between 1 and 9",
  );

  assert.equal(expression.kind, "IsPredicate");
  assert.equal(expression.test.form, "between");
  assert.equal(expression.test.strict, true);
});

test("`is between` takes its `and` from the next line", () => {
  const expression = printedExpression("print 5 is between 1\n  and 9");

  assert.equal(expression.kind, "IsPredicate");
  assert.equal(expression.test.form, "between");
  assert.equal(expression.test.low.value, 1);
  assert.equal(expression.test.high.value, 9);
});

test("a leading operator continues across a blank line", () => {
  assertBinary(printedExpression("print 1\n\n\n  + 2"), "+", 1, 2);
});

test("a leading operator keeps precedence: `1 +` / `2 * 3` groups the product", () => {
  const sum = printedExpression("print 1\n  + 2 * 3");

  assert.equal(sum.callee.name, "+");
  assert.equal(sum.args[0].value, 1);
  assertBinary(sum.args[1], "*", 2, 3);
});

// --- parenthesized groups are newline-transparent at every depth --------------------------------

test("a parenthesized group survives a newline mid-expression", () => {
  assertBinary(printedExpression("print (1 +\n  2)"), "+", 1, 2);
});

test("a parenthesized group survives a newline after the opening paren", () => {
  assertBinary(printedExpression("print (\n  1 + 2\n)"), "+", 1, 2);
});

test("a nested parenthesized group raises no phantom `ol-unmatched-paren`", () => {
  const sum = printedExpression("print (1 + (2 *\n  3))");

  assert.equal(sum.callee.name, "+");
  assert.equal(sum.args[0].value, 1);
  assertBinary(sum.args[1], "*", 2, 3);
});

test("a parenthesized group nested inside a list literal survives a newline", () => {
  const list = printedExpression("print [ (1 +\n  2) ]");

  assert.equal(list.kind, "ListLit");
  assert.equal(list.elements.length, 1);
  assertBinary(list.elements[0], "+", 1, 2);
});

// --- a newline still ends a statement when no expression is pending -----------------------------

test("`print 1` / `print 2` stays two statements", () => {
  const body = parseClean("print 1\nprint 2");

  assert.equal(body.length, 2);
  assert.equal(body[0].args[0].value, 1);
  assert.equal(body[1].args[0].value, 2);
});

test("`forward 100` / `right 90` stays two statements", () => {
  const body = parseClean("forward 100\nright 90");

  assert.equal(body.length, 2);
  assert.equal(body[0].callee.name, "forward");
  assert.equal(body[1].callee.name, "right");
});

test("blank lines between statements are a single separator", () => {
  const body = parseClean("print 1\n\n\nprint 2");

  assert.equal(body.length, 2);
});

test("statements inside a bracketed block stay separate", () => {
  const body = parseClean("repeat 4 [\n  forward 100\n  right 90\n]");

  assert.equal(body.length, 1);
  assert.equal(body[0].body.body.length, 2);
});

test("statements inside a long `… end` block stay separate", () => {
  const body = parseClean("repeat 4\n  forward 100\n  right 90\nend");

  assert.equal(body.length, 1);
  assert.equal(body[0].body.body.length, 2);
});

// --- the negative-literal guard: a `-` glued to a numeral opens a statement, not a continuation --

test("a line opening with a glued negative literal stays its own statement", () => {
  const body = parseClean("print 1\n-2");

  assert.equal(body.length, 2);
  assert.equal(body[0].args[0].value, 1);
  assert.equal(body[1].kind, "NumberLit");
  assert.equal(body[1].value, -2);
});

test("a glued negative literal stays a separate list element across a newline", () => {
  const list = printedExpression("print [1\n-2]");

  assert.equal(list.kind, "ListLit");
  assert.deepEqual(
    list.elements.map((element) => element.value),
    [1, -2],
  );
});

test("a spaced `- 2` on the next line continues the expression, matching the one-line reading", () => {
  assertBinary(printedExpression("print 1\n- 2"), "-", 1, 2);
});

test("a word operator opening a line continues the expression, since none can begin a statement", () => {
  const expression = printedExpression("print 1 == 1\nand 2 == 2");

  assert.equal(expression.callee.name, "and");
});

test("no word operator this admits can begin a statement", () => {
  for (const source of [
    "and true false",
    "or true false",
    "mod 5 2",
    "is empty",
  ]) {
    const { diagnostics } = OL.parse(source, doc);

    assert.ok(
      diagnostics.some((diagnostic) => diagnostic.code === "ol-bad-token"),
      `${source} must be a parse error in statement position`,
    );
  }
});

// --- a word operator after a complete entry value: key, or continuation? -------------------------
//
// `and`, `or`, `mod` and `is` are legal key names, so after a complete entry value the word is
// genuinely ambiguous. `spec/grammar.md:314`'s **Entry lookahead** rule settles it by the token that
// follows, *"ignoring any line breaks between the two"* — which is what makes the one-line and
// multi-line spellings agree (issue #944, maintainer ruling option 4).
//
// The discriminator is the separator's LEXEME: a `colon` token opens the next entry, a `variable`
// token (`:two`, whose `:` is glued to its name) keeps the word an operator. Both readings parse
// cleanly, so getting it wrong changes the dictionary silently instead of raising a diagnostic —
// which is why these assert entry COUNTS and KEYS, never just the absence of diagnostics.

test("a word operator followed by a key separator opens the next entry", () => {
  // The `colon` spellings. Each is asserted on ONE line and across a newline, and the two must
  // agree: before the ruling the one-line form raised `ol-bad-token` while the multi-line form read
  // as two entries, which is exactly the asymmetry the rule removes.
  for (const entry of ["mod: 2", "and: 2", "or: 2", "is: 2", "mod : 2"]) {
    for (const source of [
      `print { a: 1 ${entry} }`,
      `print { a: 1\n${entry} }`,
    ]) {
      const dict = printedExpression(source);

      assert.equal(dict.kind, "DictLit", source);
      assert.equal(dict.entries.length, 2, source);
      assert.equal(dict.entries[0].key.value, "a", source);
    }
  }
});

test("a word operator followed by a variable read continues the value", () => {
  // The `variable` spellings — the regression a naive lookahead causes. `{ a: 1 mod :two }` is ONE
  // entry whose value is `1 mod :two`; reading `:two` as a separator would silently reparse a
  // currently-valid program into two entries with `two` as a bare word. Newlines are insignificant
  // here, so every spelling below must agree with the one-line one.
  for (const entry of ["mod :two", "mod:two", "mod\n:two", "mod\n\n:two"]) {
    const dict = printedExpression(`print { a: 1\n${entry} }`);

    assert.equal(dict.kind, "DictLit", entry);
    assert.equal(dict.entries.length, 1, entry);
    assert.equal(dict.entries[0].value.callee.name, "mod", entry);
  }
});

test("`is` before a variable read is an is-predicate, not a key", () => {
  // `is` belongs to the same group but cannot be shown as a clean single entry: read as an operator
  // it is an `is-predicate` missing its form word (`empty`/`a <type>`/`member of`), so it is a parse
  // error. That error IS the ruled reading — under #933's superseded rule `is :two` opened an entry
  // keyed `is` and parsed clean, which is why this is pinned rather than left to a fixture: it is
  // the one case in the family whose flip is visible as a diagnostic instead of as a tree.
  for (const source of ["print { a: 1 is :two }", "print { a: 1\nis :two }"]) {
    const { ast, diagnostics } = OL.parse(source, doc);

    assert.ok(
      diagnostics.some((diagnostic) => diagnostic.code === "ol-bad-token"),
      source,
    );
    assert.ok(
      ast.body[0].args[0].entries.every((entry) => entry.key.value !== "is"),
      `${source} must not open an entry keyed \`is\``,
    );
  }
});

test("the one-line and multi-line spellings of a dict entry agree", () => {
  // The ruling's acceptance criterion 4, asserted as AST equality rather than as a pair of
  // hand-written expectations: whatever each spelling means, both must mean the SAME thing.
  for (const entry of [
    "and: 2",
    "or: 2",
    "mod: 2",
    "is: 2",
    "mod : 2",
    "mod :two",
    "mod:two",
    "b: 2",
  ]) {
    assert.equal(
      shapeOf(`print { a: 1 ${entry} }`),
      shapeOf(`print { a: 1\n${entry} }`),
      entry,
    );
  }
});

test("the dict-key guard is scoped to the dictionary that owns the newline", () => {
  // Each case uses a `mod:` COLON shape, because that is the only shape that reaches the guard at
  // all. `isDictKeyAt` fires only when the token after the word is a raw `colon`; in `mod :two`,
  // `:two` lexes as a `variable`, so the guard returns false regardless of whether the enclosing
  // container cleared `inDictEntryValue`. An earlier version of this test used `mod :two` and was
  // therefore non-discriminating: it passed whether or not the flag leaked. It was written for
  // #933's rule, under which `isDictKeyAt` still had a `variable` arm; the #944 ruling removed that
  // arm and left the witness unable to witness. Review caught it.
  //
  // The invariant: `inDictEntryValue` belongs to the dictionary that owns the newline, so inside a
  // NESTED container a `mod:` is not an entry separator.
  //
  // WHAT EACH ASSERTION ACTUALLY DETECTS, measured against the leak mutation
  // (`inDictValue`: `inDictEntryValue = previous || active`) rather than asserted:
  //
  //   * the shape equality pins that the newline spelling reads as its one-line spelling. It does
  //     NOT detect the leak in ANY row -- a leaked flag moves both spellings together, so they
  //     still agree. 0 of 4.
  //   * the count detects the leak in the `paren` row ONLY, where it goes 3 -> 2. 1 of 4.
  //
  // So the leak is caught by exactly one row, and the other three pin agreement rather than
  // isolation. An earlier revision claimed "neither alone is sufficient and the mutation proves
  // it", which overstated the redundancy fourfold; the mutation proves shape-alone insufficient
  // and proves count-alone sufficient. Described accurately here rather than strengthened, because
  // a test that reads as broader than it is caused this comment to be rewritten three times.
  //
  // If the `paren` row's expected count ever changes, the only leak-detecting assertion in this
  // test goes with it. Re-run the mutation before touching it.
  const shapeOf = (source) =>
    JSON.stringify(OL.parse(source, doc).ast, (key, value) =>
      key === "source_span" ? undefined : value,
    );

  for (const [label, source, expected, detectsLeak] of [
    ["list", "print { a: [1\nmod: 2] }", 2, false],
    ["paren", "print { a: (1\nmod: 2) }", 3, true],
    ["paren call", "print { a: (sum 1\nmod: 2) }", 2, false],
    [
      "comprehension body",
      "print { a: map n in [1 2] [ :n\nmod: 2 ] }",
      2,
      false,
    ],
  ]) {
    // `replaceAll`, not `replace`: every row above happens to carry exactly one newline, so
    // `replace` would agree today and silently stop producing a one-line spelling the moment a
    // two-newline row is added — the comparison would then hold a multi-line source on both sides
    // and assert nothing. Flagged by CodeQL as incomplete escaping (PR #999); the defect it names
    // here is a latent test weakening, not a security exposure.
    const oneLine = source.replaceAll("\n", " ");
    const detail = detectsLeak
      ? "a leaked guard changes this count"
      : "pins agreement with the one-line spelling; does NOT detect a leak";

    assert.equal(
      shapeOf(source),
      shapeOf(oneLine),
      `${label}: the newline spelling must read exactly as the one-line spelling`,
    );
    for (const [spelling, text] of [
      ["split", source],
      ["one-line", oneLine],
    ]) {
      assert.deepEqual(
        codesOf(text),
        Array.from({ length: expected }, () => "ol-bad-token"),
        `${label} (${spelling}): ${detail}`,
      );
    }
  }

  // The control: in the dictionary itself the separator DOES open the next entry, both spellings.
  for (const source of ["print { a: 1 mod: 2 }", "print { a: 1\nmod: 2 }"]) {
    const dict = printedExpression(source);

    assert.equal(dict.entries.length, 2, source);
    assert.deepEqual(
      dict.entries.map((entry) => entry.key.value),
      ["a", "mod"],
      source,
    );
  }
});

test("a malformed dict key does not swallow the entry after it", () => {
  // The recovery path parses an expression too, so it needs the same dict-entry scope; without it
  // the `mod` key is consumed as `5 mod :two` and the entry disappears. Under the ruling `mod`
  // followed by the variable read `:two` is an OPERATOR, so the surviving entries are the malformed
  // one's successor `ok` alone — the point being that recovery still reaches it.
  const { ast, diagnostics } = OL.parse(
    "print { [1] : 5\nmod\n:two\nok: 3 }",
    doc,
  );

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.code),
    ["ol-bad-token"],
  );
  assert.deepEqual(
    ast.body[0].args[0].entries.map((entry) => entry.key.value),
    ["ok"],
  );
});

test("outside a dictionary a word operator still continues onto a `:variable`", () => {
  const expression = printedExpression("print :total\nmod :divisor");

  assert.equal(expression.kind, "Call");
  assert.equal(expression.callee.name, "mod");
  assert.equal(expression.args[0].name, "total");
  assert.equal(expression.args[1].name, "divisor");
});

test("a word operator with no dict separator still continues the value", () => {
  const dict = printedExpression("print { a: 1\nmod 2 }");

  assert.equal(dict.kind, "DictLit");
  assert.equal(dict.entries.length, 1);
  assertBinary(dict.entries[0].value, "mod", 1, 2);
});

// --- a genuinely missing operand is still reported ----------------------------------------------

test("a dangling `+` with nothing after it reports exactly one `ol-bad-token`", () => {
  const { diagnostics } = OL.parse("print 1 +\n", doc);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.code),
    ["ol-bad-token"],
  );
  assert.equal(diagnostics[0].params.text, "end of file");
});

test("`is member` with neither `of` nor a collection still reports exactly one `ol-bad-token`", () => {
  const { diagnostics } = OL.parse("print :x is member\n", doc);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.code),
    ["ol-bad-token"],
  );
});

// --- a genuinely unmatched paren is still reported, exactly once ---------------------------------

test("an unmatched `(` is reported exactly once on a single line", () => {
  const { diagnostics } = OL.parse("print (1 + 2", doc);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.code),
    ["ol-unmatched-paren"],
  );
});

test("an unmatched `(` around a multi-line expression is reported exactly once", () => {
  const { diagnostics } = OL.parse("print (1 +\n  2", doc);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.code),
    ["ol-unmatched-paren"],
  );
});

test("an unmatched nested `(` around a multi-line expression is reported exactly once", () => {
  const { diagnostics } = OL.parse("print (1 + (2 *\n  3)", doc);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.code),
    ["ol-unmatched-paren"],
  );
});

test("an unmatched `)` is still reported", () => {
  const { diagnostics } = OL.parse("print 1)", doc);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.code),
    ["ol-unmatched-paren"],
  );
});

// --- #944's ruled behaviour is not touched by this change -----------------------------------------
//
// The maintainer ruled #944 as "separator lookahead": a `name` followed by a key-colon opens a dict
// entry regardless of position, so the one-line and multi-line spellings will agree. Implementing
// that is a separate change. This one must neither anticipate it nor contradict it, and the shape
// most at risk is `{ a: 1 mod :two }` — a naive lookahead re-reads it as key `mod` plus bare word
// `two`, silently turning ONE entry into two. `:two` with no space is already a variable-reference
// lexeme, which is what the ruling leans on. Every reading below is byte-identical to the parser at
// base `536c7d5c`.

test("#944: `mod :two` inside a dict entry value stays one entry", () => {
  const dict = printedExpression("print { a: 1 mod :two }");

  assert.equal(dict.entries.length, 1);
  assert.equal(dict.entries[0].key.value, "a");
  assert.equal(dict.entries[0].value.callee.name, "mod");
});

test("#944: the dict separator is not adjacency-sensitive", () => {
  const dict = printedExpression("print { a : 1 }");

  assert.equal(dict.entries.length, 1);
  assert.equal(dict.entries[0].key.value, "a");
});

test("#944: ordinary one-line and multi-line entries are unaffected", () => {
  assert.equal(printedExpression("print { a: 1 b: 2 }").entries.length, 2);
  assert.equal(printedExpression("print { a: 1\nand: 2 }").entries.length, 2);
});

test("#944: the one-line word-key spellings now parse as two entries", () => {
  // This test was pinned as deliberately FAILING until #944's separator lookahead landed, with the
  // instruction to replace it with the positive form once it did. This is that replacement: each
  // spelling parses clean into TWO entries, and agrees with its multi-line twin.
  //
  // What it used to assert, and why the flip is the whole point: `{ a: 1 and: 2 }` raised three
  // `ol-bad-token` — one per token left before the `}` — while `{ a: 1`⏎`and: 2 }` read as two
  // entries, so a newline inside a dict literal was significant, against `spec/grammar.md:34`.
  for (const entry of ["and: 2", "or: 2", "mod: 2", "is: 2"]) {
    const source = `print { a: 1 ${entry} }`;
    const dict = printedExpression(source);

    assert.equal(dict.entries.length, 2, source);
    assert.deepEqual(
      dict.entries.map((dictEntry) => dictEntry.key.value),
      ["a", entry.slice(0, entry.indexOf(":"))],
      source,
    );
    assert.equal(shapeOf(source), shapeOf(`print { a: 1\n${entry} }`), source);
  }
});

// --- issue #709, finally closed by #1021 ---------------------------------------------------------
//
// `(pi == pi)` used to mis-read as a `parenthesized-call`: {@link parseParenthesized} committed to
// the call on the head token alone, so it gathered arguments until it met `==` in an argument slot
// and raised `ol-bad-token` — while the identical unparenthesized `pi == pi` read clean.
//
// This block was pinned as a deliberate NEGATIVE — "the defect still reports exactly the
// diagnostics it reported before, and is not silenced" — on the belief that `spec/grammar.md`
// defines `parenthesized-expression` and `parenthesized-call` "without saying how to disambiguate",
// making it a grammar ambiguity needing a `[spec]` ruling. **That premise was wrong, and #1021
// measured it.** The grammar is unambiguous here: `(pi == pi)` has no derivation as a
// `parenthesized-call` (`==` is not an `expression`, :215) and exactly one as a
// `parenthesized-expression` (:213). It was a reader defect all along, and needed no spec change.
//
// So this is the positive replacement, in the shape #944's flip above established. The controls
// that surrounded the defect are kept exactly as they were — they were clean before and must stay
// clean — and the traps a lookahead-based fix could break are pinned beside them.

test("#709/#1021: a group headed by a zero-arity reporter parses as an expression", () => {
  const { ast, diagnostics } = OL.parse("print (pi == pi)", doc);

  assert.deepEqual(diagnostics, []);
  assert.deepEqual(
    OL.check(ast, { profiles: OL.OL_CHECK_PROFILES }).diagnostics,
    [],
  );
});

test("#709/#1021: every binary operator is admitted, `-` included", () => {
  // All of `spec/grammar.md:181-190`'s infix operators: the ten symbolic ones plus the worded
  // `mod`, `and`, `or` and `is`. `-` is in the list on purpose: an earlier revision of #1021
  // declared it unresolvable without arity, which measurement disproved — spaced `- 1` continues
  // the expression while glued `-1` opens an argument, and the reader already tells those apart by
  // adjacency (`spec/grammar.md:60,230`).
  for (const operator of [
    "== pi",
    "!= pi",
    "+ 1",
    "- 1",
    "* 2",
    "/ 2",
    "> 1",
    "< 1",
    ">= 1",
    "<= 1",
    "mod 2",
    "and true",
    "or true",
    'is a "number"',
  ]) {
    const source = `print (pi ${operator})`;

    assert.deepEqual(codesOf(source), [], source);
  }
});

test("#709/#1021: the head need not be Core — a profile-blind reader sees no arity", () => {
  // `heading` is a *turtle* primitive, so `corePrimitiveArity("heading")` is `undefined` and this
  // reader — deliberately profile-blind (issue #878) — cannot know its arity. The lookahead needs
  // none: it reads the operator, not the callee.
  assert.deepEqual(codesOf("forward (heading + 90)"), []);
  assert.deepEqual(codesOf("forward (heading - 90)"), []);
});

test("#709/#1021: a user-declared zero-arity procedure works the same way", () => {
  assert.deepEqual(
    codesOf("define zero\n  return 0\nend\nprint (zero == 1)"),
    [],
  );
});

test("issue #709 reads a line-spanning group exactly as its one-line form", () => {
  // `spec/grammar.md:34` — newlines are insignificant inside one parenthesized group — so the
  // lookahead skips them and the operator binds across the break on either side of itself.
  assert.deepEqual(codesOf("print (pi ==\n  pi)"), []);
  assert.deepEqual(codesOf("print (pi\n  == pi)"), []);
  assert.equal(shapeOf("print (pi\n  == pi)"), shapeOf("print (pi == pi)"));
});

test("issue #709's controls still parse clean", () => {
  for (const source of ["print (1 == 1)", "print (pi)", "print pi == pi"]) {
    const { diagnostics } = OL.parse(source, doc);

    assert.deepEqual(diagnostics, [], source);
  }
});

test("#1021: the lookahead does not swallow a parenthesized call", () => {
  // The traps a naive "an operator follows, so it is an expression" fix breaks. Each parses clean
  // TODAY and must keep parsing clean, and each fails for a different reason if the rule is wrong:
  // `-1` is a negative *argument* (adjacency, not arity, tells it from `- 1`); `and`/`or` are the
  // variadic logic *heads* here, so the lookahead must look PAST the head; `)` is no operator; and
  // an ordinary call must be untouched.
  for (const source of [
    "print (round -1)",
    "print (max 1 -2)",
    "print (and true false)",
    "print (or true false)",
    "print (pi)",
    "print (round 1)",
    "print (max 1 2)",
    'print (word "a" "b")',
    'print (value of :d for key "a")',
  ]) {
    assert.deepEqual(codesOf(source), [], source);
  }
});

test("#1021: a glued negative argument stays an ARITY question, not a parse error", () => {
  // `( pi -1 )` is a call of `pi` on `-1`, so it parses clean and the CHECKER reports the arity
  // mistake. The reader deliberately does not second-guess arity — that is the checker's layer —
  // which is what keeps it profile-blind.
  const { ast, diagnostics } = OL.parse("print (pi -1)", doc);

  assert.deepEqual(diagnostics, []);
  assert.deepEqual(
    OL.check(ast, { profiles: OL.OL_CHECK_PROFILES }).diagnostics.map(
      (diagnostic) => diagnostic.code,
    ),
    ["ol-too-many-inputs"],
  );
});

test("#1021: a head short of an input keeps the branch's pre-existing recovery", () => {
  // The other direction of "no arity in the reader": `( round - 1 )` declines the call, and then
  // `round` runs the expression reader for its one input. A spaced `-` cannot begin a `primary`,
  // so `parsePrimary`'s default branch consumes it and reports the first `ol-bad-token`, and
  // `parseFixedCall` breaks with zero arguments. The trailing `1` and `)` are reported downstream
  // by the group's tail and the statement loop — three diagnostics from three sites.
  //
  // Pinned because the count CHANGED (it was one `ol-bad-token` while the call branch swallowed
  // these), and the point is that it changed INTO the one-per-stray-token shape this branch has
  // always had rather than into a new one: `( 1 2 )` and `( 1 2 3 )` already reported that way
  // before this fix and still do, unchanged.
  assert.deepEqual(codesOf("print (1 2)"), ["ol-bad-token", "ol-bad-token"]);
  assert.deepEqual(codesOf("print (1 2 3)"), [
    "ol-bad-token",
    "ol-bad-token",
    "ol-bad-token",
  ]);
  assert.deepEqual(codesOf("print (round - 1)"), [
    "ol-bad-token",
    "ol-bad-token",
    "ol-bad-token",
  ]);

  // `round` took NO argument — the claim above, asserted rather than described.
  const { ast } = OL.parse("print (round - 1)", doc);
  assert.equal(ast.body[0].args[0].callee.name, "round");
  assert.equal(ast.body[0].args[0].args.length, 0);

  // The control that proves the first diagnostic is NOT a grouping artifact: the same `round -`
  // with no parentheses at all reports the same single `ol-bad-token` on the same token. Without
  // this, "the group reported it" and "the argument reader reported it" look identical.
  assert.deepEqual(codesOf("round -"), ["ol-bad-token"]);

  // The stray tokens are reported by several different sites, not by one loop — pinned on the
  // MESSAGES, because the shared `ol-bad-token` code cannot distinguish them. `( 1 2 3 )`'s `3`
  // carries the statement loop's terminator wording while its `2` carries the bad-token wording,
  // so "one diagnostic per stray token" is a shape the paths share, not a path itself.
  const literalHead = OL.parse("print (1 2 3)", doc).diagnostics.map(
    (diagnostic) => diagnostic.message,
  );
  assert.match(literalHead[0], /don't know how to read 2/);
  assert.match(literalHead[1], /needs a new line of its own/);

  // `spec/error-model.md:165-172` is the MUST NOT that governs every recovery path: no
  // unmatched-delimiter diagnostic for a delimiter that is in fact matched. These parentheses are
  // matched, so no amount of wreckage inside them may produce `ol-unmatched-paren`.
  for (const source of ["print (round - 1)", "print (round == 1)"]) {
    assert.ok(
      !codesOf(source).includes("ol-unmatched-paren"),
      `${source} must not blame its matched parenthesis`,
    );
  }
});

test("#1021: the arity-short RECOVERY still reads the two spellings apart (saga #1017)", () => {
  // Two inherited consequences of routing arity-short heads into the expression branch, pinned so
  // they are documented choices rather than surprises. Both are confined to programs that are
  // invalid either way, and both are the parser-resynchronisation defect tracked by saga #1017
  // (Half B) — deliberately NOT special-cased here, because papering over a general defect in one
  // error path only hides it.
  //
  // 1. The trailing operand leaks out of the group as a top-level sibling statement.
  const oneLine = OL.parse("print (round - 1)", doc);
  assert.equal(oneLine.ast.body.length, 2);
  assert.equal(oneLine.ast.body[1].kind, "NumberLit");

  // 2. The one-line and multi-line spellings stop agreeing, because across the newline the `-` is
  //    reached through `continuesOnNextLine` rather than through a pending argument slot.
  const multiLine = OL.parse("print (round\n- 1)", doc);
  assert.deepEqual(multiLine.diagnostics, []);
  assert.equal(multiLine.ast.body.length, 1);
  assert.deepEqual(
    OL.check(multiLine.ast, { profiles: OL.OL_CHECK_PROFILES }).diagnostics.map(
      (diagnostic) => diagnostic.code,
    ),
    ["ol-not-enough-inputs"],
  );

  // The branch DECISION itself is newline-blind, which is what `spec/grammar.md:34` requires: an
  // arity-0 head reads identically either way. Only the already-failing recovery differs.
  assert.deepEqual(codesOf("print (pi - 1)"), []);
  assert.deepEqual(codesOf("print (pi\n- 1)"), []);
  assert.equal(shapeOf("print (pi\n- 1)"), shapeOf("print (pi - 1)"));
});

// --- a multi-line expression spans the source it actually covers ---------------------------------

test("a continued expression's span reaches the operand on the next line", () => {
  const sum = printedExpression("print 1 +\n  2");

  assert.deepEqual(sum.source_span.start, [1, 7]);
  assert.deepEqual(sum.source_span.end, [2, 4]);
});
