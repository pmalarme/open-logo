// Unit tests for Core comprehensions (`map`/`filter`/`reduce`) per spec/grammar.md:131-134,
// 338-348 — validating the ALREADY-MERGED parser (packages/parser/src/parser.ts,
// parseComprehension). These do not change the parser.
//
// coverage.test.mjs already asserts the base AST shape (form/binder/iterable/accumulator/initial)
// over a list-literal iterable, and the syntax-error diagnostics for malformed headers. This file
// adds the cases the corpus explicitly calls for and that are not yet covered there: a
// comprehension over a variable (not just a list literal), the map/filter/reduce forms used as a
// standalone top-level statement, a nested comprehension, and confirmation that the comprehension
// body is the exact same `Block` production used by control-form bodies (per issue #61 / #43).
//
// Spans are half-open `[start, end)` with 1-based `[line, column]` positions, matching the
// conventions in parse.test.mjs and blocks.test.mjs.

import assert from "node:assert/strict";
import { test } from "node:test";
import * as OL from "@openlogo/parser";

const doc = "acceptance.logo";

test("map over a variable iterable (not a list literal) parses clean and keeps the binder reference in the body", () => {
  const { ast, diagnostics } = OL.parse(
    ":nums = [1 2 3]\n:doubled = map n in :nums [ :n * 2 ]",
    doc,
  );

  assert.deepEqual(diagnostics, []);
  const comprehension = ast.body[1].value;
  assert.equal(comprehension.kind, "Comprehension");
  assert.equal(comprehension.form, "map");
  assert.equal(comprehension.binder.name, "n");
  assert.equal(comprehension.iterable.kind, "VarRef");
  assert.equal(comprehension.iterable.name, "nums");
  assert.equal(comprehension.accumulator, undefined);
  assert.equal(comprehension.initial, undefined);
  assert.equal(comprehension.body.kind, "Block");
  assert.equal(comprehension.body.body[0].callee.name, "*");
  assert.equal(comprehension.body.body[0].args[0].name, "n");
});

test("filter over a variable with a boolean comparison body parses clean", () => {
  const { ast, diagnostics } = OL.parse(
    ":nums = [1 2 3 4]\n:evens = filter n in :nums [ :n > 2 ]",
    doc,
  );

  assert.deepEqual(diagnostics, []);
  const comprehension = ast.body[1].value;
  assert.equal(comprehension.form, "filter");
  assert.equal(comprehension.iterable.kind, "VarRef");
  assert.equal(comprehension.body.body[0].callee.name, ">");
});

test("reduce carries a distinct accumulator and item binder alongside its `from` seed", () => {
  const { ast, diagnostics } = OL.parse(
    ":total = reduce sum n in [1 2 3] from 0 [ :sum + :n ]",
    doc,
  );

  assert.deepEqual(diagnostics, []);
  const comprehension = ast.body[0].value;
  assert.equal(comprehension.kind, "Comprehension");
  assert.equal(comprehension.form, "reduce");
  assert.equal(comprehension.accumulator.name, "sum");
  assert.equal(comprehension.binder.name, "n");
  assert.equal(comprehension.iterable.kind, "ListLit");
  assert.equal(comprehension.initial.kind, "NumberLit");
  assert.equal(comprehension.initial.value, 0);
  assert.equal(comprehension.body.body[0].callee.name, "+");
});

test("map/filter/reduce may each stand alone as a top-level statement, not just a value position", () => {
  for (const [src, form] of [
    ["map n in [1 2 3] [ :n * 2 ]", "map"],
    ["filter n in [1 2 3] [ :n > 1 ]", "filter"],
    ["reduce acc n in [1 2 3] from 0 [ :acc + :n ]", "reduce"],
  ]) {
    const { ast, diagnostics } = OL.parse(src, doc);
    assert.deepEqual(diagnostics, []);
    assert.equal(ast.body.length, 1);
    assert.equal(ast.body[0].kind, "Comprehension");
    assert.equal(ast.body[0].form, form);
  }
});

test("a comprehension may nest inside another comprehension's body", () => {
  const { ast, diagnostics } = OL.parse(
    "print map row in [1 2] [ map n in [1 2] [ :n ] ]",
    doc,
  );

  assert.deepEqual(diagnostics, []);
  const outer = ast.body[0].args[0];
  assert.equal(outer.kind, "Comprehension");
  assert.equal(outer.form, "map");
  assert.equal(outer.binder.name, "row");
  const inner = outer.body.body[0];
  assert.equal(inner.kind, "Comprehension");
  assert.equal(inner.form, "map");
  assert.equal(inner.binder.name, "n");
});

test("the comprehension body and a control-form bracket body produce the same Block node shape", () => {
  const mapResult = OL.parse("map n in [1 2 3] [ :n * 2 ]", doc);
  const repeatResult = OL.parse("repeat 3 [ :n * 2 ]", doc);

  assert.deepEqual(mapResult.diagnostics, []);
  assert.deepEqual(repeatResult.diagnostics, []);

  const mapBody = mapResult.ast.body[0].body;
  const repeatBody = repeatResult.ast.body[0].body;

  assert.equal(mapBody.kind, "Block");
  assert.equal(repeatBody.kind, "Block");
  assert.deepEqual(Object.keys(mapBody).sort(), Object.keys(repeatBody).sort());
  assert.equal(mapBody.body.length, repeatBody.body.length);
  assert.equal(mapBody.body[0].kind, repeatBody.body[0].kind);
});

test("filter used as a call argument keeps the comprehension node in expression position", () => {
  const { ast, diagnostics } = OL.parse(
    "print filter n in [1 2 3] [ :n > 1 ]",
    doc,
  );

  assert.deepEqual(diagnostics, []);
  const arg = ast.body[0].args[0];
  assert.equal(arg.kind, "Comprehension");
  assert.equal(arg.form, "filter");
});
