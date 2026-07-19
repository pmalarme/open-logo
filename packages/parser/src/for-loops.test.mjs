// Unit tests for issue #59 — the `for` loop / binder surface not already exercised by
// control-long.test.mjs (#58) or #91's own tests: exact binder `source_span`s (bare name,
// `ForRange` variable, `DestructuringBinderNode`, and each destructured name), the `by` step's
// own span and its absence when omitted, and destructuring-binder read resolution via `check()`
// (spec/grammar.md:127,136-137,142-143). These validate the already-merged parser; they do not
// change it.
//
// Spans are half-open `[start, end)` with 1-based `[line, column]` positions, per
// @openlogo/core, matching the conventions in control-long.test.mjs and parse.test.mjs.

import assert from "node:assert/strict";
import { test } from "node:test";
import * as OL from "@openlogo/parser";

const doc = "acceptance.logo";
const span = (start, end) => ({ document: doc, start, end });

test("a bare `for <name> in <expr>` binder's own source_span covers exactly the name token, distinct from the `ForIn` node's own span", () => {
  const source = "for item in :items\n  print :item\nend for\n";
  const { ast, diagnostics } = OL.parse(source, doc);

  assert.deepEqual(diagnostics, []);
  const forNode = ast.body[0];
  assert.equal(forNode.kind, "ForIn");
  assert.deepEqual(forNode.source_span, span([1, 1], [3, 8]));
  assert.equal(forNode.binder.kind, undefined);
  assert.equal(forNode.binder.name, "item");
  assert.deepEqual(forNode.binder.source_span, span([1, 5], [1, 9]));
});

test("a `for <name> from <expr> to <expr>` variable's own source_span covers exactly the name token, and `by` is undefined when omitted", () => {
  const source = "for i from 1 to 10\n  print :i\nend for\n";
  const { ast, diagnostics } = OL.parse(source, doc);

  assert.deepEqual(diagnostics, []);
  const forNode = ast.body[0];
  assert.equal(forNode.kind, "ForRange");
  assert.deepEqual(forNode.variable.source_span, span([1, 5], [1, 6]));
  assert.equal(forNode.by, undefined);
});

test("a `for <name> from <expr> to <expr> by <expr>` step expression carries its own exact source_span, distinct from the variable's span", () => {
  const source = "for i from 1 to 10 by 2\n  print :i\nend for\n";
  const { ast, diagnostics } = OL.parse(source, doc);

  assert.deepEqual(diagnostics, []);
  const forNode = ast.body[0];
  assert.equal(forNode.kind, "ForRange");
  assert.deepEqual(forNode.variable.source_span, span([1, 5], [1, 6]));
  assert.equal(forNode.from.value, 1);
  assert.deepEqual(forNode.from.source_span, span([1, 12], [1, 13]));
  assert.equal(forNode.to.value, 10);
  assert.deepEqual(forNode.to.source_span, span([1, 17], [1, 19]));
  assert.equal(forNode.by.value, 2);
  assert.deepEqual(forNode.by.source_span, span([1, 23], [1, 24]));
});

test("a `[:x :y]` destructuring binder's own source_span covers the full bracketed pattern, and each destructured name's span covers only its own `:name` token", () => {
  const source = "for [:x :y] in :points\n  print :x\nend for\n";
  const { ast, diagnostics } = OL.parse(source, doc);

  assert.deepEqual(diagnostics, []);
  const forNode = ast.body[0];
  assert.equal(forNode.kind, "ForIn");
  assert.equal(forNode.binder.kind, "DestructuringBinder");
  assert.deepEqual(forNode.binder.source_span, span([1, 5], [1, 12]));

  const [x, y] = forNode.binder.names;
  assert.equal(x.name, "x");
  assert.deepEqual(x.source_span, span([1, 6], [1, 8]));
  assert.equal(y.name, "y");
  assert.deepEqual(y.source_span, span([1, 9], [1, 11]));
});

test("a three-element destructuring binder `[:a :b :c]` gives each name its own non-overlapping, correctly-ordered span", () => {
  const source = "for [:a :b :c] in :triples\n  print :a\nend for\n";
  const { ast, diagnostics } = OL.parse(source, doc);

  assert.deepEqual(diagnostics, []);
  const forNode = ast.body[0];
  assert.deepEqual(forNode.binder.source_span, span([1, 5], [1, 15]));

  const [a, b, c] = forNode.binder.names;
  assert.deepEqual(
    [a, b, c].map((n) => [n.name, n.source_span]),
    [
      ["a", span([1, 6], [1, 8])],
      ["b", span([1, 9], [1, 11])],
      ["c", span([1, 12], [1, 14])],
    ],
  );
});

test("a destructuring binder's names resolve as reads inside the loop body with zero diagnostics from `check()`", () => {
  const source =
    "for [:x :y] in [[1 2] [3 4]]\n  print :x\n  print :y\nend for\n";
  const { ast, diagnostics: parseDiagnostics } = OL.parse(source, doc);

  assert.deepEqual(parseDiagnostics, []);
  const { diagnostics } = OL.check(ast, {
    profiles: ["core-language"],
    source,
  });
  assert.deepEqual(diagnostics, []);
});
