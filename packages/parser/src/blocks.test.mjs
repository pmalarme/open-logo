// Unit tests for Core block structure, terminators, and statement separation —
// bracketed `[ ... ]` blocks (empty and non-empty, with and without newlines), long
// `... end` blocks, top-level statement separation (including consecutive/blank-line
// terminators and the optional final newline), and the bracket-block vs expression-block
// distinction — per spec/grammar.md:34,75,140-142,267,277,279. These validate the
// already-merged parser; they do not change it. Short bracketed CONTROL bodies for
// if/while/repeat/forever are already covered by control-short.test.mjs (issue #57) and
// are not re-tested here.
//
// Spans are half-open `[start, end)` with 1-based `[line, column]` positions, per
// @openlogo/core, matching the conventions in parse.test.mjs.

import assert from "node:assert/strict";
import { test } from "node:test";
import * as OL from "@openlogo/parser";

const doc = "acceptance.logo";
const span = (start, end) => ({ document: doc, start, end });

test("an empty bracketed block `[ ]` parses as a Block with zero statements", () => {
  const { ast, diagnostics } = OL.parse("repeat 4 [ ]", doc);

  assert.deepEqual(diagnostics, []);
  const repeatNode = ast.body[0];
  assert.equal(repeatNode.kind, "Repeat");
  assert.equal(repeatNode.body.kind, "Block");
  assert.deepEqual(repeatNode.body.source_span, span([1, 10], [1, 13]));
  assert.equal(repeatNode.body.body.length, 0);
});

test("a bracketed block holds multiple statements separated only by fixed arity, with no newlines", () => {
  const { ast, diagnostics } = OL.parse("repeat 4 [ :x = 1 :y = 2 ]", doc);

  assert.deepEqual(diagnostics, []);
  const block = ast.body[0].body;
  assert.equal(block.kind, "Block");
  assert.equal(block.body.length, 2);

  assert.equal(block.body[0].kind, "Assign");
  assert.equal(block.body[0].place.base.name, "x");
  assert.equal(block.body[0].value.value, 1);

  assert.equal(block.body[1].kind, "Assign");
  assert.equal(block.body[1].place.base.name, "y");
  assert.equal(block.body[1].value.value, 2);
});

test("top-level statements separated by runs of one and two blank lines parse as three statements", () => {
  const { ast, diagnostics } = OL.parse(
    "print 1\n\nprint 2\n\n\nprint 3\n",
    doc,
  );

  assert.deepEqual(diagnostics, []);
  assert.equal(ast.body.length, 3);
  assert.equal(ast.body[0].args[0].value, 1);
  assert.deepEqual(ast.body[0].source_span, span([1, 1], [1, 8]));
  assert.equal(ast.body[1].args[0].value, 2);
  assert.deepEqual(ast.body[1].source_span, span([3, 1], [3, 8]));
  assert.equal(ast.body[2].args[0].value, 3);
  assert.deepEqual(ast.body[2].source_span, span([6, 1], [6, 8]));
});

test("the newline after the final top-level statement is optional", () => {
  const { ast, diagnostics } = OL.parse("print 1\nprint 2", doc);

  assert.deepEqual(diagnostics, []);
  assert.equal(ast.body.length, 2);
  assert.deepEqual(ast.body[1].source_span, span([2, 1], [2, 8]));
});

test("a long `... end` block treats blank lines around and between its statements as insignificant separators", () => {
  const { ast, diagnostics } = OL.parse(
    "repeat 4\n\n  print 1\n\n  print 2\n\nend repeat",
    doc,
  );

  assert.deepEqual(diagnostics, []);
  const block = ast.body[0].body;
  assert.equal(block.kind, "Block");
  assert.equal(block.body.length, 2);
  assert.equal(block.body[0].args[0].value, 1);
  assert.equal(block.body[1].args[0].value, 2);
});

test("a comprehension expression-block and a control bracket-block are the same Block production", () => {
  const { ast, diagnostics } = OL.parse("map n in [1 2 3] [ :n * 2 ]", doc);

  assert.deepEqual(diagnostics, []);
  const mapNode = ast.body[0];
  assert.equal(mapNode.kind, "Comprehension");
  assert.equal(mapNode.form, "map");
  assert.equal(mapNode.body.kind, "Block");
  assert.equal(mapNode.body.body.length, 1);
  assert.equal(mapNode.body.body[0].kind, "Call");
  assert.equal(mapNode.body.body[0].callee.name, "*");
});

test("a comma between two instructions inside a bracketed block is an unexpected token, not a separator", () => {
  const { ast, diagnostics } = OL.parse("repeat 4 [ print 1, print 2 ]", doc);

  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].code, "ol-bad-token");
  assert.deepEqual(diagnostics[0].params, { text: "," });
  assert.deepEqual(diagnostics[0].source_span, span([1, 19], [1, 20]));

  const block = ast.body[0].body;
  assert.equal(block.body.length, 2);
  assert.equal(block.body[0].args[0].value, 1);
  assert.equal(block.body[1].args[0].value, 2);
});

test("OpenLogo has no comma argument separator: `print 1, 2` reports two bad-token diagnostics", () => {
  const { diagnostics } = OL.parse("print 1, 2", doc);

  assert.equal(diagnostics.length, 2);
  assert.equal(diagnostics[0].code, "ol-bad-token");
  assert.deepEqual(diagnostics[0].params, { text: "," });
  assert.deepEqual(diagnostics[0].source_span, span([1, 8], [1, 9]));

  assert.equal(diagnostics[1].code, "ol-bad-token");
  assert.deepEqual(diagnostics[1].params, { text: "2" });
  assert.deepEqual(diagnostics[1].source_span, span([1, 10], [1, 11]));
});
