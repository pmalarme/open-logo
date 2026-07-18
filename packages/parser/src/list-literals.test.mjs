// Unit tests for Core list literals `[ ... ]` in expression position and parenthesized
// expressions `( expr )` as a primary, per spec/grammar.md:188-209 (issue #47). These validate
// the already-merged parser; they do not change it.
//
// `blocks.test.mjs` already covers bracketed control/comprehension BLOCK bodies (`repeat n [ ]`,
// `map n in [...] [ ... ]`) and the comma-is-not-a-separator diagnostic inside brackets;
// `arithmetic.test.mjs` already covers `(1 + 2) * 3` grouping overriding precedence. This file
// adds only what those don't: the `ListLit` AST shape itself (element order, nesting, mixed
// value types, variable/place elements), the bracketed-LIST-in-expression-position vs
// bracketed-BLOCK-body distinction, and parens as a primary (simple grouping, nested parens,
// and a parenthesized expression used as a fixed call's argument).
//
// Spans are half-open `[start, end)` with 1-based `[line, column]` positions, per @openlogo/core.

import assert from "node:assert/strict";
import { test } from "node:test";
import * as OL from "@openlogo/parser";

const doc = "acceptance.logo";
const span = (start, end) => ({ document: doc, start, end });

function printArg(source) {
  const { ast, diagnostics } = OL.parse(source, doc);
  assert.deepEqual(diagnostics, []);
  assert.equal(ast.body.length, 1);
  assert.equal(ast.body[0].kind, "Call");
  return ast.body[0].args[0];
}

test("parses an empty list literal `[]` with zero elements", () => {
  const node = printArg("print []");
  assert.equal(node.kind, "ListLit");
  assert.deepEqual(node.elements, []);
  assert.deepEqual(node.source_span, span([1, 7], [1, 9]));
});

test("parses a single-element list literal", () => {
  const node = printArg("print [1]");
  assert.equal(node.kind, "ListLit");
  assert.equal(node.elements.length, 1);
  assert.equal(node.elements[0].kind, "NumberLit");
  assert.equal(node.elements[0].value, 1);
  assert.deepEqual(node.source_span, span([1, 7], [1, 10]));
});

test("parses a multi-element, space-separated list literal preserving element order", () => {
  const node = printArg("print [1 2 3]");
  assert.equal(node.kind, "ListLit");
  assert.equal(node.elements.length, 3);
  assert.deepEqual(
    node.elements.map((e) => e.value),
    [1, 2, 3],
  );
  assert.deepEqual(node.source_span, span([1, 7], [1, 14]));
});

test("parses a list literal with mixed value types: number, word, boolean", () => {
  const node = printArg('print [1 "red" true]');
  assert.equal(node.elements.length, 3);
  assert.equal(node.elements[0].kind, "NumberLit");
  assert.equal(node.elements[0].value, 1);
  assert.equal(node.elements[1].kind, "WordLit");
  assert.equal(node.elements[1].value, "red");
  assert.equal(node.elements[2].kind, "BooleanLit");
  assert.equal(node.elements[2].value, true);
});

test("parses nested list literals, each with its own ListLit node and span", () => {
  const node = printArg("print [[1 2] [3 4]]");
  assert.equal(node.kind, "ListLit");
  assert.equal(node.elements.length, 2);

  const first = node.elements[0];
  assert.equal(first.kind, "ListLit");
  assert.deepEqual(
    first.elements.map((e) => e.value),
    [1, 2],
  );
  assert.deepEqual(first.source_span, span([1, 8], [1, 13]));

  const second = node.elements[1];
  assert.equal(second.kind, "ListLit");
  assert.deepEqual(
    second.elements.map((e) => e.value),
    [3, 4],
  );
  assert.deepEqual(second.source_span, span([1, 14], [1, 19]));
});

test("parses a list literal containing a bare variable-read element", () => {
  const { ast, diagnostics } = OL.parse(":x = 5\nprint [:x 1]", doc);
  assert.deepEqual(diagnostics, []);
  const list = ast.body[1].args[0];
  assert.equal(list.kind, "ListLit");
  assert.equal(list.elements.length, 2);
  assert.equal(list.elements[0].kind, "VarRef");
  assert.equal(list.elements[0].name, "x");
  assert.equal(list.elements[1].kind, "NumberLit");
  assert.equal(list.elements[1].value, 1);
});

test("parses a list literal containing a dotted-place element", () => {
  const { ast, diagnostics } = OL.parse(
    ":people.tom.age = 5\nprint [:people.tom.age 1]",
    doc,
  );
  assert.deepEqual(diagnostics, []);
  const list = ast.body[1].args[0];
  assert.equal(list.kind, "ListLit");
  assert.equal(list.elements.length, 2);
  const place = list.elements[0];
  assert.equal(place.kind, "Place");
  assert.equal(place.base.name, "people");
  assert.deepEqual(
    place.segments.map((s) => s.name.name),
    ["tom", "age"],
  );
});

test("an empty list literal is a valid assignment value", () => {
  const { ast, diagnostics } = OL.parse(":x = []", doc);
  assert.deepEqual(diagnostics, []);
  const assign = ast.body[0];
  assert.equal(assign.kind, "Assign");
  assert.equal(assign.value.kind, "ListLit");
  assert.deepEqual(assign.value.elements, []);
});

test("a bracketed LIST literal in expression position is a ListLit, not a Block", () => {
  const node = printArg("print [1 2 3]");
  assert.equal(node.kind, "ListLit");
});

test("a bracketed control BLOCK body is a Block, not a ListLit, even though it reuses `[ ]`", () => {
  const { ast, diagnostics } = OL.parse("repeat 3 [ print 1 ]", doc);
  assert.deepEqual(diagnostics, []);
  const repeatNode = ast.body[0];
  assert.equal(repeatNode.kind, "Repeat");
  assert.equal(repeatNode.body.kind, "Block");
  assert.equal(repeatNode.body.body.length, 1);
  assert.equal(repeatNode.body.body[0].kind, "Call");
});

test("a parenthesized simple expression parses as the inner primary, not a wrapper node", () => {
  const node = printArg("print (1)");
  // Per grammar.md:209, parenthesized-expression has no dedicated AST node — grouping is
  // resolved during parsing and the inner expression's own span (not including the parens)
  // is what the primary production yields.
  assert.equal(node.kind, "NumberLit");
  assert.equal(node.value, 1);
  assert.deepEqual(node.source_span, span([1, 8], [1, 9]));
});

test("nested parentheses `((1))` collapse to the same inner primary", () => {
  const node = printArg("print ((1))");
  assert.equal(node.kind, "NumberLit");
  assert.equal(node.value, 1);
  assert.deepEqual(node.source_span, span([1, 9], [1, 10]));
});

test("a parenthesized expression is usable as a fixed call's argument", () => {
  // `power` is a Core fixed-arity reporter of arity 2; its first argument here is the
  // parenthesized sum `(1 + 2)`, grouped as a single Call primary before the second argument.
  const { ast, diagnostics } = OL.parse("print power (1 + 2) 3", doc);
  assert.deepEqual(diagnostics, []);
  const powerCall = ast.body[0].args[0];
  assert.equal(powerCall.kind, "Call");
  assert.equal(powerCall.callee.name, "power");
  assert.equal(powerCall.args.length, 2);

  const sum = powerCall.args[0];
  assert.equal(sum.kind, "Call");
  assert.equal(sum.callee.name, "+");
  assert.equal(sum.args[0].value, 1);
  assert.equal(sum.args[1].value, 2);

  assert.equal(powerCall.args[1].kind, "NumberLit");
  assert.equal(powerCall.args[1].value, 3);
});

test("a parenthesized expression is usable as a unary fixed call's sole argument", () => {
  const { ast, diagnostics } = OL.parse("print abs (1 + 2)", doc);
  assert.deepEqual(diagnostics, []);
  const absCall = ast.body[0].args[0];
  assert.equal(absCall.kind, "Call");
  assert.equal(absCall.callee.name, "abs");
  assert.equal(absCall.args.length, 1);
  assert.equal(absCall.args[0].kind, "Call");
  assert.equal(absCall.args[0].callee.name, "+");
});
