// Unit tests for simple (non-chained) comparison operators (issue #51). parse.test.mjs already
// covers `1 < 2` staying a plain Call and the multi-operator ComparisonChain case (issue #52); this
// file targets what that leaves untested: the other five compare-ops (==, !=, >, <=, >=) per
// spec/grammar.md:180, each with its callee span; that comparison binds looser than
// additive/multiplicative but tighter than `and`/`or` (spec/grammar.md:177-180,185-186); and that
// `=` assignment and `==` comparison stay distinct on the same variable (spec/grammar.md:103,180).
//
// Runs under `node --test` against the built `@openlogo/parser` package, exercising only its
// public `parse` surface.

import assert from "node:assert/strict";
import { test } from "node:test";
import * as OL from "@openlogo/parser";

const doc = "comparison.logo";
const span = (start, end) => ({ document: doc, start, end });

for (const op of ["==", "!=", ">", "<=", ">="]) {
  test(`a lone \`1 ${op} 2\` comparison parses as a Call with callee "${op}" and its own span`, () => {
    const src = `print 1 ${op} 2`;
    const { ast, diagnostics } = OL.parse(src, doc);

    assert.deepEqual(diagnostics, []);
    const cmp = ast.body[0].args[0];
    assert.equal(cmp.kind, "Call");
    assert.equal(cmp.callee.name, op);
    assert.equal(cmp.args[0].value, 1);
    assert.equal(cmp.args[1].value, 2);

    const opStart = src.indexOf(op) + 1;
    assert.deepEqual(
      cmp.callee.source_span,
      span([1, opStart], [1, opStart + op.length]),
    );
    assert.deepEqual(cmp.source_span, span([1, 7], [1, src.length + 1]));
  });
}

test("comparison binds looser than additive and multiplicative: `1 + 2 < 3 * 4` groups as (1 + 2) < (3 * 4)", () => {
  const { ast, diagnostics } = OL.parse("print 1 + 2 < 3 * 4", doc);

  assert.deepEqual(diagnostics, []);
  const cmp = ast.body[0].args[0];
  assert.equal(cmp.kind, "Call");
  assert.equal(cmp.callee.name, "<");

  const [left, right] = cmp.args;
  assert.equal(left.kind, "Call");
  assert.equal(left.callee.name, "+");
  assert.equal(left.args[0].value, 1);
  assert.equal(left.args[1].value, 2);

  assert.equal(right.kind, "Call");
  assert.equal(right.callee.name, "*");
  assert.equal(right.args[0].value, 3);
  assert.equal(right.args[1].value, 4);
});

test("comparison binds tighter than and/or: `:a == :b and :c < :d` groups as (:a == :b) and (:c < :d)", () => {
  const { ast, diagnostics } = OL.parse("print :a == :b and :c < :d", doc);

  assert.deepEqual(diagnostics, []);
  const andCall = ast.body[0].args[0];
  assert.equal(andCall.kind, "Call");
  assert.equal(andCall.callee.name, "and");

  const [left, right] = andCall.args;
  assert.equal(left.kind, "Call");
  assert.equal(left.callee.name, "==");
  assert.equal(left.args[0].name, "a");
  assert.equal(left.args[1].name, "b");

  assert.equal(right.kind, "Call");
  assert.equal(right.callee.name, "<");
  assert.equal(right.args[0].name, "c");
  assert.equal(right.args[1].name, "d");
});

test("`=` assignment and `==` comparison stay distinct forms on the same variable", () => {
  const { ast, diagnostics } = OL.parse(":x = 1\nprint :x == 1", doc);

  assert.deepEqual(diagnostics, []);
  assert.equal(ast.body.length, 2);

  const assign = ast.body[0];
  assert.equal(assign.kind, "Assign");
  assert.equal(assign.form, "equals");
  assert.equal(assign.place.base.name, "x");
  assert.equal(assign.value.value, 1);

  const cmp = ast.body[1].args[0];
  assert.equal(cmp.kind, "Call");
  assert.equal(cmp.callee.name, "==");
  assert.equal(cmp.args[0].kind, "VarRef");
  assert.equal(cmp.args[0].name, "x");
  assert.equal(cmp.args[1].value, 1);
});

test("a comparison with no right-hand operand reports a diagnostic instead of throwing", () => {
  const { diagnostics } = OL.parse("print 1 <", doc);

  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].code, "ol-bad-token");
  assert.equal(diagnostics[0].stage, "parse");
  assert.equal(diagnostics[0].severity, "error");
});
