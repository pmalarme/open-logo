// Unit tests for the logical operators `and`/`or`/`not` (issue #54): the infix binary forms
// (`:a and :b`, `:a or :b`), the parenthesized variadic forms (`(and :a :b :c)`, `(or :a :b)`),
// and unary `not`. coverage.test.mjs already exercises the basic callee names, left-folding, the
// missing-operand diagnostic, and the paren-variadic callee/arg-count/span for `and`/`or`; this
// file targets what that leaves untested: full node spans for the infix desugaring, the
// interaction of the whole precedence ladder (`not` > comparison > `and` > `or`, per
// spec/grammar.md:218-226) in one expression, `not`'s right-associative nesting, and the parser's
// current (permissive) behavior for degenerate paren-variadic arities `(and)`/`(and :a)` — the
// arity floor for these variadic logic forms is a semantic-stage concern (no checker is merged
// yet at M1), so the parser accepts them with no diagnostic; this is documented behavior, not a
// bug to fix here.
//
// Runs under `node --test` against the built `@openlogo/parser` package, exercising only its
// public `parse` surface.

import assert from "node:assert/strict";
import { test } from "node:test";
import * as OL from "@openlogo/parser";

const doc = "logical-operators.logo";
const span = (start, end) => ({ document: doc, start, end });

test('infix `:a and :b` is a Call with callee "and", its own span, and the operand spans', () => {
  const { ast, diagnostics } = OL.parse(":a and :b", doc);

  assert.deepEqual(diagnostics, []);
  const call = ast.body[0];
  assert.equal(call.kind, "Call");
  assert.equal(call.callee.name, "and");
  assert.deepEqual(call.callee.source_span, span([1, 4], [1, 7]));
  assert.deepEqual(call.source_span, span([1, 1], [1, 10]));
  assert.equal(call.args[0].name, "a");
  assert.equal(call.args[1].name, "b");
});

test('infix `:a or :b` is a Call with callee "or" and its own span', () => {
  const { ast, diagnostics } = OL.parse(":a or :b", doc);

  assert.deepEqual(diagnostics, []);
  const call = ast.body[0];
  assert.equal(call.kind, "Call");
  assert.equal(call.callee.name, "or");
  assert.deepEqual(call.callee.source_span, span([1, 4], [1, 6]));
  assert.deepEqual(call.source_span, span([1, 1], [1, 9]));
});

test("a three-term `or` chain nests left: `:a or :b or :c` groups as (:a or :b) or :c", () => {
  const { ast, diagnostics } = OL.parse(":a or :b or :c", doc);

  assert.deepEqual(diagnostics, []);
  const outer = ast.body[0];
  assert.equal(outer.kind, "Call");
  assert.equal(outer.callee.name, "or");
  assert.equal(outer.args[1].name, "c");

  const inner = outer.args[0];
  assert.equal(inner.kind, "Call");
  assert.equal(inner.callee.name, "or");
  assert.equal(inner.args[0].name, "a");
  assert.equal(inner.args[1].name, "b");

  // The nested Call keeps its own tight span (just `:a or :b`); the outer Call's span covers
  // the whole chain.
  assert.deepEqual(inner.source_span, span([1, 1], [1, 9]));
  assert.deepEqual(outer.source_span, span([1, 1], [1, 15]));
});

test("a three-term `and` chain nests left the same way as `or`", () => {
  const { ast, diagnostics } = OL.parse(":a and :b and :c", doc);

  assert.deepEqual(diagnostics, []);
  const outer = ast.body[0];
  assert.equal(outer.callee.name, "and");
  const inner = outer.args[0];
  assert.equal(inner.kind, "Call");
  assert.equal(inner.callee.name, "and");
  assert.equal(inner.args[0].name, "a");
  assert.equal(inner.args[1].name, "b");
  assert.equal(outer.args[1].name, "c");
});

test("the full ladder mixes cleanly: `:a == :b and :c or not :d` groups as ((:a == :b) and :c) or (not :d)", () => {
  const { ast, diagnostics } = OL.parse(":a == :b and :c or not :d", doc);

  assert.deepEqual(diagnostics, []);
  const orCall = ast.body[0];
  assert.equal(orCall.kind, "Call");
  assert.equal(orCall.callee.name, "or");

  const andCall = orCall.args[0];
  assert.equal(andCall.kind, "Call");
  assert.equal(andCall.callee.name, "and");

  const eqCall = andCall.args[0];
  assert.equal(eqCall.kind, "Call");
  assert.equal(eqCall.callee.name, "==");
  assert.equal(eqCall.args[0].name, "a");
  assert.equal(eqCall.args[1].name, "b");
  assert.equal(andCall.args[1].name, "c");

  const notCall = orCall.args[1];
  assert.equal(notCall.kind, "Call");
  assert.equal(notCall.callee.name, "not");
  assert.equal(notCall.args[0].name, "d");
});

test("`not` binds tighter than comparison: `not :a == :b` groups as (not :a) == :b, not not(:a == :b)", () => {
  const { ast, diagnostics } = OL.parse("print not :a == :b", doc);

  assert.deepEqual(diagnostics, []);
  const eqCall = ast.body[0].args[0];
  assert.equal(eqCall.kind, "Call");
  assert.equal(eqCall.callee.name, "==");

  const notCall = eqCall.args[0];
  assert.equal(notCall.kind, "Call");
  assert.equal(notCall.callee.name, "not");
  assert.equal(notCall.args[0].name, "a");
  assert.equal(eqCall.args[1].name, "b");
});

test("`not` is right-associative and nests: `not not :a` is not(not(:a))", () => {
  const { ast, diagnostics } = OL.parse("not not :a", doc);

  assert.deepEqual(diagnostics, []);
  const outer = ast.body[0];
  assert.equal(outer.kind, "Call");
  assert.equal(outer.callee.name, "not");
  assert.deepEqual(outer.callee.source_span, span([1, 1], [1, 4]));
  assert.deepEqual(outer.source_span, span([1, 1], [1, 11]));

  const inner = outer.args[0];
  assert.equal(inner.kind, "Call");
  assert.equal(inner.callee.name, "not");
  assert.deepEqual(inner.callee.source_span, span([1, 5], [1, 8]));
  assert.equal(inner.args[0].name, "a");
});

test("a parenthesized single operand `(not :a)` stays a plain group, not a ParenCall", () => {
  const { ast, diagnostics } = OL.parse("(not :a)", doc);

  assert.deepEqual(diagnostics, []);
  const node = ast.body[0];
  // `not` is not one of the paren-variadic heads (only `and`/`or` are), so the parenthesized
  // reader falls back to an ordinary group and returns the inner `not` Call unwrapped.
  assert.equal(node.kind, "Call");
  assert.equal(node.callee.name, "not");
  assert.equal(node.args[0].name, "a");
});

test("the parenthesized variadic `(and ...)`/`(or ...)` gather every operand up to `)`", () => {
  const conj = OL.parse("print (and :a :b :c)", doc).ast.body[0].args[0];
  assert.equal(conj.kind, "ParenCall");
  assert.equal(conj.callee.name, "and");
  assert.deepEqual(
    conj.args.map((a) => a.name),
    ["a", "b", "c"],
  );

  const disj = OL.parse("print (or :a :b)", doc).ast.body[0].args[0];
  assert.equal(disj.kind, "ParenCall");
  assert.equal(disj.callee.name, "or");
  assert.deepEqual(
    disj.args.map((a) => a.name),
    ["a", "b"],
  );
});

test("known gap: the paren-variadic `(and ...)`/`(or ...)` accept degenerate arities (0 or 1 operand) with no diagnostic at parse time", () => {
  // The M1 harness is parse-only (no semantic checker is merged yet), so an arity floor for
  // these variadic logic forms — if the language ever wants one — is not enforced here. This
  // test documents today's permissive parse behavior rather than asserting a diagnostic that
  // does not exist.
  const zeroArg = OL.parse("(and)", doc);
  assert.deepEqual(zeroArg.diagnostics, []);
  assert.equal(zeroArg.ast.body[0].kind, "ParenCall");
  assert.deepEqual(zeroArg.ast.body[0].args, []);

  const oneArg = OL.parse("(or :a)", doc);
  assert.deepEqual(oneArg.diagnostics, []);
  assert.equal(oneArg.ast.body[0].kind, "ParenCall");
  assert.equal(oneArg.ast.body[0].args.length, 1);
});

test("an infix `and`/`or` with no right-hand operand reports ol-bad-token instead of throwing", () => {
  for (const src of [":a and", ":a or", "not"]) {
    const { diagnostics } = OL.parse(src, doc);
    assert.equal(diagnostics.length, 1);
    assert.equal(diagnostics[0].code, "ol-bad-token");
    assert.equal(diagnostics[0].stage, "parse");
    assert.equal(diagnostics[0].severity, "error");
  }
});

test("an unclosed paren-variadic `(and :a :b` reports ol-unmatched-paren", () => {
  const { diagnostics } = OL.parse("(and :a :b", doc);
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].code, "ol-unmatched-paren");
  assert.equal(diagnostics[0].params.delimiter, "(");
});
