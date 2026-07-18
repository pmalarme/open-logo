// Unit tests for nested places and postfix chains (issue #49). These target AST shapes NOT
// already asserted by parse.test.mjs or the merged variables.test.mjs (issue #48): a deeply
// (3+ level) dotted field chain, a dotted place used inside expression positions where postfix
// precedence over comparison/other operators matters (spec/grammar.md:107-111,188,216-230), and
// the actual (verified against the built parser) diagnostic behavior for a malformed postfix
// (a trailing dot with no following field name).
//
// IMPORTANT — genuine spec-vs-parser gap found while authoring this slice: spec/grammar.md:109-111
// defines a postfix as `selector | "." identifier` where `selector ::= "[" key-term "]"`, but the
// merged parser (packages/parser/src/parser.ts collectFieldSegments/parsePostfix) only recognizes
// the `.identifier` field form — it never looks at `[`. Filed as a bug (see PR body); the cases
// below intentionally cover only the dotted-field postfix, which is what the shipped parser
// actually implements.
//
// Runs under `node --test` against the built `@openlogo/parser` package, exercising only its
// public `parse` surface.

import assert from "node:assert/strict";
import { test } from "node:test";
import * as OL from "@openlogo/parser";

const doc = "places.logo";
const span = (start, end) => ({ document: doc, start, end });

test("a 3-level dotted colon read :a.b.c.d carries all three field segments in source order", () => {
  const { ast, diagnostics } = OL.parse("print :a.b.c.d", doc);

  assert.deepEqual(diagnostics, []);
  const place = ast.body[0].args[0];
  assert.equal(place.kind, "Place");
  assert.equal(place.base.name, "a");
  assert.deepEqual(place.base.source_span, span([1, 7], [1, 9]));
  assert.equal(place.segments.length, 3);

  const [b, c, d] = place.segments;
  assert.equal(b.kind, "field");
  assert.equal(b.name.name, "b");
  assert.equal(c.kind, "field");
  assert.equal(c.name.name, "c");
  assert.equal(d.kind, "field");
  assert.equal(d.name.name, "d");
  assert.deepEqual(d.name.source_span, span([1, 14], [1, 15]));
  assert.deepEqual(place.source_span, span([1, 7], [1, 15]));
});

test("a 3-level dotted colon assignment :a.b.c.d = 1 carries the same three segments", () => {
  const { ast, diagnostics } = OL.parse(":a.b.c.d = 1", doc);

  assert.deepEqual(diagnostics, []);
  const assign = ast.body[0];
  assert.equal(assign.kind, "Assign");
  assert.equal(assign.form, "equals");
  assert.equal(assign.place.segments.length, 3);
  assert.deepEqual(
    assign.place.segments.map((s) => s.name.name),
    ["b", "c", "d"],
  );
  assert.equal(assign.value.value, 1);
});

test("a 3-level dotted bare place after set ... to shares the same segment parsing", () => {
  const { ast, diagnostics } = OL.parse("set x.y.z to 2", doc);

  assert.deepEqual(diagnostics, []);
  const assign = ast.body[0];
  assert.equal(assign.kind, "Assign");
  assert.equal(assign.form, "set");
  assert.equal(assign.place.base.name, "x");
  assert.deepEqual(
    assign.place.segments.map((s) => s.name.name),
    ["y", "z"],
  );
  assert.equal(assign.value.value, 2);
});

test("a dotted place binds tighter than comparison: :a.b.c == 1 compares the whole place, not just :a", () => {
  const { ast, diagnostics } = OL.parse("if :a.b.c == 1 [ print 1 ]", doc);

  assert.deepEqual(diagnostics, []);
  const ifStmt = ast.body[0];
  assert.equal(ifStmt.kind, "If");
  const condition = ifStmt.condition;
  assert.equal(condition.kind, "Call");
  assert.equal(condition.callee.name, "==");
  const [lhs] = condition.args;
  assert.equal(lhs.kind, "Place");
  assert.equal(lhs.base.name, "a");
  assert.deepEqual(
    lhs.segments.map((s) => s.name.name),
    ["b", "c"],
  );
});

test("two dotted places inside a list literal each keep their own base and segments", () => {
  const { ast, diagnostics } = OL.parse("print [ :a.b.c :d.e ]", doc);

  assert.deepEqual(diagnostics, []);
  const list = ast.body[0].args[0];
  assert.equal(list.kind, "ListLit");
  assert.equal(list.elements.length, 2);

  const [first, second] = list.elements;
  assert.equal(first.kind, "Place");
  assert.equal(first.base.name, "a");
  assert.deepEqual(
    first.segments.map((s) => s.name.name),
    ["b", "c"],
  );
  assert.equal(second.kind, "Place");
  assert.equal(second.base.name, "d");
  assert.deepEqual(
    second.segments.map((s) => s.name.name),
    ["e"],
  );
});

test("a trailing dot with no following field name (:a.) reports ol-bad-token at the dot and leaves :a a plain VarRef", () => {
  const { ast, diagnostics } = OL.parse("print :a.", doc);

  const arg = ast.body[0].args[0];
  assert.equal(arg.kind, "VarRef");
  assert.equal(arg.name, "a");

  assert.equal(diagnostics.length, 1);
  const [diag] = diagnostics;
  assert.equal(diag.code, "ol-bad-token");
  assert.equal(diag.stage, "parse");
  assert.equal(diag.severity, "error");
  assert.deepEqual(diag.params, { text: "." });
  assert.deepEqual(diag.source_span, span([1, 9], [1, 10]));
});
