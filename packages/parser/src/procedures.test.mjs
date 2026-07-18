// Unit tests for Core procedure definitions — `define name { :param } … end` — plus the
// `return`/`stop` statements that appear inside a procedure body, per spec/grammar.md:145-151
// (`define-statement`, `required-parameter`, `optional-parameter`, `return-statement`,
// `stop-statement`) and spec/execution-model.md's block-result rule (procedures return a value
// only through `return`/`output`/`op`). These validate the already-merged parser; they do not
// change it.
//
// Spans are half-open `[start, end)` with 1-based `[line, column]` positions, per @openlogo/core,
// matching the conventions in parse.test.mjs and control-short.test.mjs.

import assert from "node:assert/strict";
import { test } from "node:test";
import * as OL from "@openlogo/parser";

const doc = "acceptance.logo";
const span = (start, end) => ({ document: doc, start, end });

test("parses `define name … end` with zero parameters and a no-argument call", () => {
  const { ast, diagnostics } = OL.parse(
    'define greet\n  print "hello"\nend\ngreet\n',
    doc,
  );

  assert.deepEqual(diagnostics, []);
  assert.equal(ast.body.length, 2);

  const def = ast.body[0];
  assert.equal(def.kind, "ProcedureDef");
  assert.deepEqual(def.source_span, span([1, 1], [3, 4]));
  assert.equal(def.name.name, "greet");
  assert.deepEqual(def.name.source_span, span([1, 8], [1, 13]));
  assert.deepEqual(def.params, []);

  assert.equal(def.body.kind, "Block");
  assert.equal(def.body.body.length, 1);
  assert.equal(def.body.body[0].kind, "Call");
  assert.equal(def.body.body[0].callee.name, "print");
  assert.equal(def.body.body[0].args[0].value, "hello");

  const call = ast.body[1];
  assert.equal(call.kind, "Call");
  assert.equal(call.callee.name, "greet");
  assert.deepEqual(call.args, []);
});

test("parses `define name :param … end` with one required parameter and a `return` expression", () => {
  const { ast, diagnostics } = OL.parse(
    "define square :n\n  return :n * :n\nend\nprint square 5\n",
    doc,
  );

  assert.deepEqual(diagnostics, []);
  const def = ast.body[0];
  assert.equal(def.kind, "ProcedureDef");
  assert.equal(def.name.name, "square");
  assert.equal(def.params.length, 1);
  assert.equal(def.params[0].name.name, "n");
  assert.deepEqual(def.params[0].name.source_span, span([1, 15], [1, 17]));
  assert.equal(def.params[0].defaultValue, undefined);

  assert.equal(def.body.body.length, 1);
  const returnNode = def.body.body[0];
  assert.equal(returnNode.kind, "Return");
  assert.equal(returnNode.keyword, "return");
  assert.deepEqual(returnNode.source_span, span([2, 3], [2, 17]));
  assert.equal(returnNode.value.kind, "Call");
  assert.equal(returnNode.value.callee.name, "*");
  assert.equal(returnNode.value.args[0].name, "n");
  assert.equal(returnNode.value.args[1].name, "n");

  const call = ast.body[1];
  assert.equal(call.kind, "Call");
  assert.equal(call.callee.name, "print");
  const nested = call.args[0];
  assert.equal(nested.kind, "Call");
  assert.equal(nested.callee.name, "square");
  assert.equal(nested.args[0].value, 5);
});

test("parses `define name :a :b :c … end` with multiple parameters, a multi-statement body, and nested calls", () => {
  const { ast, diagnostics } = OL.parse(
    "define add3 :a :b :c\n  print :a\n  return :a + :b + :c\nend\nprint add3 1 2 3\n",
    doc,
  );

  assert.deepEqual(diagnostics, []);
  const def = ast.body[0];
  assert.equal(def.kind, "ProcedureDef");
  assert.equal(def.name.name, "add3");
  assert.deepEqual(
    def.params.map((p) => p.name.name),
    ["a", "b", "c"],
  );

  assert.equal(def.body.body.length, 2);
  assert.equal(def.body.body[0].kind, "Call");
  assert.equal(def.body.body[0].callee.name, "print");
  assert.equal(def.body.body[0].args[0].name, "a");

  const returnNode = def.body.body[1];
  assert.equal(returnNode.kind, "Return");
  assert.equal(returnNode.value.kind, "Call");
  assert.equal(returnNode.value.callee.name, "+");
  // `:a + :b + :c` is left-associative: `(:a + :b) + :c`.
  assert.equal(returnNode.value.args[0].kind, "Call");
  assert.equal(returnNode.value.args[0].callee.name, "+");
  assert.equal(returnNode.value.args[0].args[0].name, "a");
  assert.equal(returnNode.value.args[0].args[1].name, "b");
  assert.equal(returnNode.value.args[1].name, "c");

  const call = ast.body[1];
  assert.equal(call.args[0].kind, "Call");
  assert.equal(call.args[0].callee.name, "add3");
  assert.deepEqual(
    call.args[0].args.map((a) => a.value),
    [1, 2, 3],
  );
});

test("parses a bare `stop` nested inside an `if` short body within a procedure", () => {
  const { ast, diagnostics } = OL.parse(
    'define maybe_stop :flag\n  if :flag [ stop ]\n  print "after"\nend\nmaybe_stop true\n',
    doc,
  );

  assert.deepEqual(diagnostics, []);
  const def = ast.body[0];
  assert.equal(def.kind, "ProcedureDef");
  assert.equal(def.body.body.length, 2);

  const ifNode = def.body.body[0];
  assert.equal(ifNode.kind, "If");
  assert.equal(ifNode.thenBody.body.length, 1);
  const stopNode = ifNode.thenBody.body[0];
  assert.equal(stopNode.kind, "Stop");
  assert.deepEqual(Object.keys(stopNode).sort(), ["kind", "source_span"]);

  assert.equal(def.body.body[1].kind, "Call");
  assert.equal(def.body.body[1].callee.name, "print");
});

test("parses `define name ( :param default ) … end` with an optional parameter", () => {
  const { ast, diagnostics } = OL.parse(
    'define greet2 (:name "world")\n  print :name\nend\n',
    doc,
  );

  assert.deepEqual(diagnostics, []);
  const def = ast.body[0];
  assert.equal(def.params.length, 1);
  assert.equal(def.params[0].name.name, "name");
  assert.equal(def.params[0].defaultValue.kind, "WordLit");
  assert.equal(def.params[0].defaultValue.value, "world");
});

test("`return` requires a value expression — Core has no bare `return` (spec/grammar.md:150)", () => {
  const { ast, diagnostics } = OL.parse("define f\n  return\nend\n", doc);

  // The parser recovers: the procedure def still parses, but with an empty body and a
  // diagnostic for the dangling `return` keyword.
  const def = ast.body[0];
  assert.equal(def.kind, "ProcedureDef");
  assert.deepEqual(def.body.body, []);

  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].code, "ol-bad-token");
  assert.equal(diagnostics[0].stage, "parse");
  assert.equal(diagnostics[0].severity, "error");
});

test("a `define` body never closed by `end` (or `[ ]`) reports ol-missing-end", () => {
  const { ast, diagnostics } = OL.parse("define f :n\n  return :n\n", doc);

  assert.equal(ast.body.length, 1);
  assert.equal(ast.body[0].kind, "ProcedureDef");

  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].code, "ol-missing-end");
  assert.deepEqual(diagnostics[0].params, {
    opener: "define",
    hint: "wrap the body in [ ] or close it with end.",
  });
  assert.equal(diagnostics[0].stage, "parse");
  assert.equal(diagnostics[0].severity, "error");
});
