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

// --- a word operator opening a line may still be a dictionary key --------------------------------
//
// `and`, `or`, `mod` and `is` are legal key names, so a following dict-entry `:` means the word
// opens the next entry rather than continuing the previous entry's value. The glued spelling
// (`mod:two`) matters most: both readings parse cleanly, so getting it wrong would change the
// dictionary silently instead of raising a diagnostic.

test("a word operator followed by a dict separator opens the next entry", () => {
  for (const entry of ["mod: 2", "and: 2", "or: 2", "is: 2", "mod : 2"]) {
    const dict = printedExpression(`print { a: 1\n${entry} }`);

    assert.equal(dict.kind, "DictLit");
    assert.equal(dict.entries.length, 2, entry);
    assert.equal(dict.entries[1].value.value, 2, entry);
  }
});

test("a word operator glued to its dict value opens the next entry", () => {
  const dict = printedExpression("print { a: 1\nmod:two }");

  assert.equal(dict.kind, "DictLit");
  assert.equal(dict.entries.length, 2);
  assert.equal(dict.entries[1].key.value, "mod");
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

// --- issue #709 is adjacent but untouched --------------------------------------------------------
//
// `(pi == pi)` mis-reads as a `parenthesized-call` because `spec/grammar.md` defines both
// `parenthesized-expression` and `parenthesized-call` without saying how to disambiguate a
// parenthesized expression that *begins* with a callable name. That is a grammar ambiguity needing
// a `[spec]` ruling, not something a newline fix may resolve — or silence. This fix touches the
// same parenthesized path, so both directions are pinned here: the defect still reports exactly the
// diagnostics it reported before, and the controls around it still parse clean.

test("issue #709 still reports the same diagnostics — not fixed and not silenced", () => {
  const { ast, diagnostics } = OL.parse("print (pi == pi)", doc);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.code),
    ["ol-bad-token"],
  );
  assert.deepEqual(
    OL.check(ast, { profiles: OL.OL_CHECK_PROFILES }).diagnostics.map(
      (diagnostic) => diagnostic.code,
    ),
    ["ol-too-many-inputs"],
  );
});

test("issue #709 reads a line-spanning group exactly as its one-line form", () => {
  const { diagnostics } = OL.parse("print (pi ==\n  pi)", doc);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.code),
    ["ol-bad-token"],
  );
});

test("issue #709's controls still parse clean", () => {
  for (const source of ["print (1 == 1)", "print (pi)", "print pi == pi"]) {
    const { diagnostics } = OL.parse(source, doc);

    assert.deepEqual(diagnostics, [], source);
  }
});

// --- a multi-line expression spans the source it actually covers ---------------------------------

test("a continued expression's span reaches the operand on the next line", () => {
  const sum = printedExpression("print 1 +\n  2");

  assert.deepEqual(sum.source_span.start, [1, 7]);
  assert.deepEqual(sum.source_span.end, [2, 4]);
});
