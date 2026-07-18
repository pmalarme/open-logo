import assert from "node:assert/strict";
import { test } from "node:test";
import * as OL from "@openlogo/parser";

test("parser AST factory builds spanned, immutable nodes and walks them", () => {
  const span = { document: "main.logo", start: [1, 1], end: [1, 12] };

  // Construct one AST node (with span) and read it back.
  const distance = OL.ast.numberLit(100, span);
  assert.equal(distance.kind, "NumberLit");
  assert.equal(distance.value, 100);
  assert.deepEqual(distance.source_span.end, [1, 12]);

  const program = OL.ast.program(
    [OL.ast.call({ name: "forward", source_span: span }, [distance], span)],
    span,
  );
  assert.ok(OL.OL_NODE_KINDS.includes(program.kind));

  // The walker visits every node pre-order, in source order.
  const kinds = [];
  OL.walk(program, (node) => {
    kinds.push(node.kind);
  });
  assert.deepEqual(kinds, ["Program", "Call", "NumberLit"]);
});

test("parser AST factory builds all node types", () => {
  const span = { document: "test.logo", start: [1, 1], end: [1, 10] };

  // Test wordLit
  const word = OL.ast.wordLit("red", span);
  assert.equal(word.kind, "WordLit");
  assert.equal(word.value, "red");
  assert.deepEqual(word.source_span, span);

  // Test booleanLit
  const bool = OL.ast.booleanLit(true, span);
  assert.equal(bool.kind, "BooleanLit");
  assert.equal(bool.value, true);
  assert.deepEqual(bool.source_span, span);

  // Test listLit
  const num = OL.ast.numberLit(42, span);
  const list = OL.ast.listLit([num, word], span);
  assert.equal(list.kind, "ListLit");
  assert.equal(list.elements.length, 2);
  assert.deepEqual(list.source_span, span);

  // Test varRef
  const varRef = OL.ast.varRef("x", span);
  assert.equal(varRef.kind, "VarRef");
  assert.equal(varRef.name, "x");
  assert.deepEqual(varRef.source_span, span);

  // Test block
  const call = OL.ast.call("forward", [num], span);
  const block = OL.ast.block([call], span);
  assert.equal(block.kind, "Block");
  assert.equal(block.body.length, 1);
  assert.deepEqual(block.source_span, span);
});

test("parser walk visits all node types", () => {
  const span = { document: "test.logo", start: [1, 1], end: [1, 10] };

  // Build a tree with all node types
  const num = OL.ast.numberLit(5, span);
  const word = OL.ast.wordLit("test", span);
  const bool = OL.ast.booleanLit(false, span);
  const varRef = OL.ast.varRef("y", span);
  const list = OL.ast.listLit([num, word], span);
  const call = OL.ast.call("print", [bool, varRef, list], span);
  const block = OL.ast.block([call], span);
  const program = OL.ast.program([block], span);

  // Walk should visit all nodes
  const kinds = [];
  OL.walk(program, (node) => {
    kinds.push(node.kind);
  });

  assert.deepEqual(kinds, [
    "Program",
    "Block",
    "Call",
    "BooleanLit",
    "VarRef",
    "ListLit",
    "NumberLit",
    "WordLit",
  ]);
});

test("parser exposes the 15 normative token classes", () => {
  assert.equal(OL.OL_TOKEN_CLASSES.length, 15);
  assert.ok(OL.OL_TOKEN_CLASSES.includes(":variable"));
  assert.ok(OL.OL_TOKEN_CLASSES.includes("word/string"));

  const token = {
    class: "primitive",
    text: "forward",
    source_span: { document: "main.logo", start: [1, 1], end: [1, 8] },
  };
  assert.ok(OL.OL_TOKEN_CLASSES.includes(token.class));
});
