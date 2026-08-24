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

test("a word operator opening a line does not continue the expression above it", () => {
  const { diagnostics } = OL.parse("print 1 == 1\nand 2 == 2", doc);

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.code),
    ["ol-bad-token"],
  );
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

// --- a multi-line expression spans the source it actually covers ---------------------------------

test("a continued expression's span reaches the operand on the next line", () => {
  const sum = printedExpression("print 1 +\n  2");

  assert.deepEqual(sum.source_span.start, [1, 7]);
  assert.deepEqual(sum.source_span.end, [2, 4]);
});
