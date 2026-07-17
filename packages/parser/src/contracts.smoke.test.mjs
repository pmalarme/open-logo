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
    [OL.ast.call("forward", [distance], span)],
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
