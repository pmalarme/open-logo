// Unit tests for the Core control-form SHORT (bracketed) body syntax —
// `if <cond> [ … ]`, `while <cond> [ … ]`, `repeat <n> [ … ]`, `forever [ … ]` —
// per spec/grammar.md:119-129,139 (`control-body ::= bracket-block | long-control-block`).
// These validate the already-merged parser; they do not change it. The corresponding
// LONG (`… end`) bodies are a separate slice (issue #58) and are out of scope here.
//
// Spans are half-open `[start, end)` with 1-based `[line, column]` positions, per
// @openlogo/core, matching the conventions in parse.test.mjs.

import assert from "node:assert/strict";
import { test } from "node:test";
import * as OL from "@openlogo/parser";

const doc = "acceptance.logo";
const span = (start, end) => ({ document: doc, start, end });

test("parses `if <cond> [ … ]` with only a bracketed then-body", () => {
  const { ast, diagnostics } = OL.parse("if :x > 0 [ print :x ]", doc);

  assert.deepEqual(diagnostics, []);
  assert.equal(ast.body.length, 1);

  const ifNode = ast.body[0];
  assert.equal(ifNode.kind, "If");
  assert.deepEqual(ifNode.source_span, span([1, 1], [1, 23]));

  assert.equal(ifNode.condition.kind, "Call");
  assert.equal(ifNode.condition.callee.name, ">");
  assert.equal(ifNode.condition.args[0].name, "x");
  assert.equal(ifNode.condition.args[1].value, 0);

  assert.equal(ifNode.thenBody.kind, "Block");
  assert.deepEqual(ifNode.thenBody.source_span, span([1, 11], [1, 23]));
  assert.equal(ifNode.thenBody.body.length, 1);
  assert.equal(ifNode.thenBody.body[0].callee.name, "print");
  assert.equal(ifNode.thenBody.body[0].args[0].name, "x");

  assert.equal(ifNode.elseBody, undefined);
});

test("parses `if <cond> [ … ] else [ … ]` with both bodies bracketed", () => {
  const { ast, diagnostics } = OL.parse(
    "if :x > 0 [ print 1 ] else [ print 2 ]",
    doc,
  );

  assert.deepEqual(diagnostics, []);
  const ifNode = ast.body[0];
  assert.equal(ifNode.kind, "If");
  assert.deepEqual(ifNode.source_span, span([1, 1], [1, 39]));

  assert.equal(ifNode.thenBody.kind, "Block");
  assert.deepEqual(ifNode.thenBody.source_span, span([1, 11], [1, 22]));
  assert.equal(ifNode.thenBody.body.length, 1);
  assert.equal(ifNode.thenBody.body[0].args[0].value, 1);

  assert.equal(ifNode.elseBody.kind, "Block");
  assert.deepEqual(ifNode.elseBody.source_span, span([1, 28], [1, 39]));
  assert.equal(ifNode.elseBody.body.length, 1);
  assert.equal(ifNode.elseBody.body[0].args[0].value, 2);
});

test("parses `while <cond> [ … ]` with a bracketed body", () => {
  const { ast, diagnostics } = OL.parse(
    "while :x < 10 [ set x to :x + 1 ]",
    doc,
  );

  assert.deepEqual(diagnostics, []);
  const whileNode = ast.body[0];
  assert.equal(whileNode.kind, "While");
  assert.deepEqual(whileNode.source_span, span([1, 1], [1, 34]));

  assert.equal(whileNode.condition.kind, "Call");
  assert.equal(whileNode.condition.callee.name, "<");
  assert.equal(whileNode.condition.args[0].name, "x");
  assert.equal(whileNode.condition.args[1].value, 10);

  assert.equal(whileNode.body.kind, "Block");
  assert.deepEqual(whileNode.body.source_span, span([1, 15], [1, 34]));
  assert.equal(whileNode.body.body.length, 1);
  const assign = whileNode.body.body[0];
  assert.equal(assign.kind, "Assign");
  assert.equal(assign.form, "set");
  assert.equal(assign.place.base.name, "x");
  assert.equal(assign.value.callee.name, "+");
});

test("parses `repeat <n> [ … ]` with a bracketed body of multiple statements", () => {
  const { ast, diagnostics } = OL.parse("repeat 4 [ print 1 print 2 ]", doc);

  assert.deepEqual(diagnostics, []);
  const repeatNode = ast.body[0];
  assert.equal(repeatNode.kind, "Repeat");
  assert.deepEqual(repeatNode.source_span, span([1, 1], [1, 29]));

  assert.equal(repeatNode.count.kind, "NumberLit");
  assert.equal(repeatNode.count.value, 4);

  assert.equal(repeatNode.body.kind, "Block");
  assert.deepEqual(repeatNode.body.source_span, span([1, 10], [1, 29]));
  assert.equal(repeatNode.body.body.length, 2);
  assert.equal(repeatNode.body.body[0].args[0].value, 1);
  assert.equal(repeatNode.body.body[1].args[0].value, 2);
});

test("parses `forever [ … ]` with a bracketed body", () => {
  const { ast, diagnostics } = OL.parse("forever [ stop ]", doc);

  assert.deepEqual(diagnostics, []);
  const foreverNode = ast.body[0];
  assert.equal(foreverNode.kind, "Forever");
  assert.deepEqual(foreverNode.source_span, span([1, 1], [1, 17]));

  assert.equal(foreverNode.body.kind, "Block");
  assert.deepEqual(foreverNode.body.source_span, span([1, 9], [1, 17]));
  assert.equal(foreverNode.body.body.length, 1);
  assert.equal(foreverNode.body.body[0].kind, "Stop");
});
