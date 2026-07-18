// Unit tests for Core arithmetic operators and precedence — `+ - * / mod`, per
// spec/grammar.md:185-187,216-226 (issue #50). These validate the already-merged parser; they
// do not change it. `parse.test.mjs` already covers "binds multiplication tighter than
// addition" and "reads a negative numeric literal", so this file covers only what that one
// doesn't: `-`/`/`/`mod` left-associativity, parenthesized grouping, a full precedence chain,
// and the negative-literal-vs-subtraction distinction from grammar.md:226.
//
// Spans are half-open `[start, end)` with 1-based `[line, column]` positions, per
// @openlogo/core, matching the conventions in parse.test.mjs.

import assert from "node:assert/strict";
import { test } from "node:test";
import * as OL from "@openlogo/parser";

const doc = "acceptance.logo";

test("left-associates repeated subtraction", () => {
  const { ast, diagnostics } = OL.parse("print 10 - 2 - 3", doc);

  assert.deepEqual(diagnostics, []);
  const outer = ast.body[0].args[0];
  assert.equal(outer.kind, "Call");
  assert.equal(outer.callee.name, "-");
  assert.equal(outer.args[1].value, 3);

  const inner = outer.args[0];
  assert.equal(inner.kind, "Call");
  assert.equal(inner.callee.name, "-");
  assert.equal(inner.args[0].value, 10);
  assert.equal(inner.args[1].value, 2);
});

test("left-associates repeated division", () => {
  const { ast, diagnostics } = OL.parse("print 20 / 4 / 5", doc);

  assert.deepEqual(diagnostics, []);
  const outer = ast.body[0].args[0];
  assert.equal(outer.kind, "Call");
  assert.equal(outer.callee.name, "/");
  assert.equal(outer.args[1].value, 5);

  const inner = outer.args[0];
  assert.equal(inner.kind, "Call");
  assert.equal(inner.callee.name, "/");
  assert.equal(inner.args[0].value, 20);
  assert.equal(inner.args[1].value, 4);
});

test("parses the worded `mod` operator as a Call at multiplicative precedence", () => {
  const { ast, diagnostics } = OL.parse("print 7 mod 3", doc);

  assert.deepEqual(diagnostics, []);
  const mod = ast.body[0].args[0];
  assert.equal(mod.kind, "Call");
  assert.equal(mod.callee.name, "mod");
  assert.equal(mod.args[0].value, 7);
  assert.equal(mod.args[1].value, 3);
});

test("parenthesized grouping overrides default precedence", () => {
  const { ast, diagnostics } = OL.parse("print (1 + 2) * 3", doc);

  assert.deepEqual(diagnostics, []);
  const product = ast.body[0].args[0];
  assert.equal(product.kind, "Call");
  assert.equal(product.callee.name, "*");
  assert.equal(product.args[1].value, 3);

  const sum = product.args[0];
  assert.equal(sum.kind, "Call");
  assert.equal(sum.callee.name, "+");
  assert.equal(sum.args[0].value, 1);
  assert.equal(sum.args[1].value, 2);
});

test("nests a full precedence chain correctly: * / mod bind tighter than + -, left-to-right", () => {
  // `2*3 + 4*5 - 6/2 mod 4` groups as `(2*3 + 4*5) - (6/2 mod 4)`, and `6/2 mod 4` itself
  // left-associates as `(6/2) mod 4` since `/` and `mod` share the multiplicative level.
  const { ast, diagnostics } = OL.parse(
    "print 2 * 3 + 4 * 5 - 6 / 2 mod 4",
    doc,
  );
  assert.deepEqual(diagnostics, []);

  const minus = ast.body[0].args[0];
  assert.equal(minus.kind, "Call");
  assert.equal(minus.callee.name, "-");

  const plus = minus.args[0];
  assert.equal(plus.kind, "Call");
  assert.equal(plus.callee.name, "+");

  const firstProduct = plus.args[0];
  assert.equal(firstProduct.callee.name, "*");
  assert.equal(firstProduct.args[0].value, 2);
  assert.equal(firstProduct.args[1].value, 3);

  const secondProduct = plus.args[1];
  assert.equal(secondProduct.callee.name, "*");
  assert.equal(secondProduct.args[0].value, 4);
  assert.equal(secondProduct.args[1].value, 5);

  const modExpr = minus.args[1];
  assert.equal(modExpr.kind, "Call");
  assert.equal(modExpr.callee.name, "mod");
  assert.equal(modExpr.args[1].value, 4);

  const division = modExpr.args[0];
  assert.equal(division.kind, "Call");
  assert.equal(division.callee.name, "/");
  assert.equal(division.args[0].value, 6);
  assert.equal(division.args[1].value, 2);
});

test("distinguishes a negative literal from subtraction, per grammar.md:226", () => {
  // `-7`: the `-` sits directly against the numeral, so it is a NumberLit, not a Call.
  const literal = OL.parse("print -7", doc).ast.body[0].args[0];
  assert.equal(literal.kind, "NumberLit");
  assert.equal(literal.value, -7);

  // `0 - :x`: negating a variable is written as an explicit subtraction — a Call, not a
  // NumberLit — since a leading `-` can only ever attach to a numeral.
  const { ast, diagnostics } = OL.parse(":x = 5\nprint 0 - :x", doc);
  assert.deepEqual(diagnostics, []);
  const subtraction = ast.body[1].args[0];
  assert.equal(subtraction.kind, "Call");
  assert.equal(subtraction.callee.name, "-");
  assert.equal(subtraction.args[0].kind, "NumberLit");
  assert.equal(subtraction.args[0].value, 0);
  assert.equal(subtraction.args[1].kind, "VarRef");
  assert.equal(subtraction.args[1].name, "x");
});

test("a `-` separated from its numeral by a gap is a stray token, not a negative literal", () => {
  // Per grammar.md:226, only a `-` written directly against a numeral is a negative literal.
  // `- 3` has a gap and no left operand for subtraction, so it is an unreadable stray token.
  const { diagnostics } = OL.parse("print - 3", doc);
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].code, "ol-bad-token");
  assert.equal(diagnostics[0].params.text, "-");
});
