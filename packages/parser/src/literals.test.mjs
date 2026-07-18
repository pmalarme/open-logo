// Unit tests for Core literal parsing (issue #46): numbers (integer, decimal, exponent,
// negative variants), words (single-line escapes, multi-line normalization), and booleans.
// These exercise the public `@openlogo/parser` API only — the lexer is internal. Spans are
// half-open `[start, end)` with 1-based `[line, column]` positions, per @openlogo/core.
//
// Every case below uses `print <literal>` as the statement, so the argument always starts at
// column 7 (`"print "` is 6 characters) unless noted otherwise. This keeps the expected spans
// easy to verify by hand from the source string's own length.

import assert from "node:assert/strict";
import { test } from "node:test";
import * as OL from "@openlogo/parser";

const doc = "literals.logo";
const span = (start, end) => ({ document: doc, start, end });

function printArg(source) {
  const { ast, diagnostics } = OL.parse(source, doc);
  assert.deepEqual(diagnostics, []);
  assert.equal(ast.body.length, 1);
  assert.equal(ast.body[0].kind, "Call");
  assert.equal(ast.body[0].args.length, 1);
  return ast.body[0].args[0];
}

test("reads an integer literal", () => {
  const node = printArg("print 42");
  assert.equal(node.kind, "NumberLit");
  assert.equal(node.value, 42);
  assert.deepEqual(node.source_span, span([1, 7], [1, 9]));
});

test("reads a negative integer literal as one spanned node", () => {
  const node = printArg("print -7");
  assert.equal(node.kind, "NumberLit");
  assert.equal(node.value, -7);
  assert.deepEqual(node.source_span, span([1, 7], [1, 9]));
});

test("reads a decimal literal", () => {
  const node = printArg("print 3.14");
  assert.equal(node.kind, "NumberLit");
  assert.equal(node.value, 3.14);
  assert.deepEqual(node.source_span, span([1, 7], [1, 11]));
});

test("reads a negative decimal literal", () => {
  const node = printArg("print -0.5");
  assert.equal(node.kind, "NumberLit");
  assert.equal(node.value, -0.5);
  assert.deepEqual(node.source_span, span([1, 7], [1, 11]));
});

test("reads an unsigned exponent literal", () => {
  const node = printArg("print 2e3");
  assert.equal(node.kind, "NumberLit");
  assert.equal(node.value, 2000);
  assert.deepEqual(node.source_span, span([1, 7], [1, 10]));
});

test("reads a decimal literal with a signed exponent", () => {
  const node = printArg("print 1.5e-2");
  assert.equal(node.kind, "NumberLit");
  assert.equal(node.value, 0.015);
  assert.deepEqual(node.source_span, span([1, 7], [1, 13]));
});

test("reads a negative literal combined with an exponent", () => {
  const node = printArg("print -1e2");
  assert.equal(node.kind, "NumberLit");
  assert.equal(node.value, -100);
  assert.deepEqual(node.source_span, span([1, 7], [1, 11]));
});

test("reads a plain single-line word literal", () => {
  const node = printArg('print "red"');
  assert.equal(node.kind, "WordLit");
  assert.equal(node.value, "red");
  assert.deepEqual(node.source_span, span([1, 7], [1, 12]));
});

test('decodes \\" and \\\\ escapes in a single-line word literal', () => {
  const quoteNode = printArg('print "she said \\"hi\\" today"');
  assert.equal(quoteNode.kind, "WordLit");
  assert.equal(quoteNode.value, 'she said "hi" today');

  const backslashNode = printArg('print "back\\\\slash"');
  assert.equal(backslashNode.kind, "WordLit");
  assert.equal(backslashNode.value, "back\\slash");
});

test("reads true and false as boolean literals", () => {
  const trueNode = printArg("print true");
  assert.equal(trueNode.kind, "BooleanLit");
  assert.equal(trueNode.value, true);
  assert.deepEqual(trueNode.source_span, span([1, 7], [1, 11]));

  const falseNode = printArg("print false");
  assert.equal(falseNode.kind, "BooleanLit");
  assert.equal(falseNode.value, false);
  assert.deepEqual(falseNode.source_span, span([1, 7], [1, 12]));
});

test("normalizes a multi-line word literal exactly as spec/grammar.md's worked example", () => {
  // Mirrors spec/grammar.md:21-30: the newline after the opening """ and before the closing
  // """ are dropped, and the two spaces common to both content lines are stripped, so "Hello"
  // keeps its extra two-space indent while "World" does not.
  const source = ':poem = """\n    Hello\n  World\n"""\nprint :poem';
  const { ast, diagnostics } = OL.parse(source, doc);
  assert.deepEqual(diagnostics, []);

  const assign = ast.body[0];
  assert.equal(assign.kind, "Assign");
  const literal = assign.value;
  assert.equal(literal.kind, "WordLit");
  assert.equal(literal.value, "  Hello\nWorld");
  assert.deepEqual(literal.source_span, span([1, 9], [4, 4]));
});
