// Unit tests for `not`/`and`/`or` (issue #95) — the boolean-only, short-circuit logic operators
// at precedence levels 2/6/7 (spec/execution-model.md:133,137-144). Every case parses real source
// through @openlogo/parser and evaluates the resulting AST node, exercising `evaluate()` exactly
// as `@openlogo/runtime`'s `execute()` does — including the parenthesized variadic form
// (`(and a b c)`), which the parser lowers to the same callee/args shape as the nested-binary
// infix form. There is no truthiness (spec/error-model.md:121): a non-boolean operand raises
// `ol-not-boolean` rather than coercing.

import assert from "node:assert/strict";
import { test } from "node:test";
import * as Parser from "@openlogo/parser";
import {
  createEnvironment,
  evaluate,
  isSupportedExpression,
} from "@openlogo/runtime";

const doc = "acceptance.logo";

/** Parse `print <expr>` and return the un-evaluated `<expr>` AST node. */
function parseExpr(expr) {
  const { ast, diagnostics } = Parser.parse(`print ${expr}`, doc);
  assert.deepEqual(diagnostics, []);
  return ast.body[0].args[0];
}

/** Parse `print <expr>` and evaluate it in a fresh environment. */
function evalExpr(expr, env = createEnvironment()) {
  return evaluate(parseExpr(expr), env);
}

// --- `not` -------------------------------------------------------------------------------------

test("not negates a boolean operand", () => {
  assert.deepEqual(evalExpr("not true"), { ok: true, value: false });
  assert.deepEqual(evalExpr("not false"), { ok: true, value: true });
  // Double negation, and `not` nested inside arithmetic-adjacent comparison context.
  assert.deepEqual(evalExpr("not not true"), { ok: true, value: true });
});

test("not raises ol-not-boolean for a non-boolean operand — there is no truthiness", () => {
  const result = evalExpr("not 5");
  assert.equal(result.ok, false);
  assert.equal(result.diagnostic.code, "ol-not-boolean");
  assert.deepEqual(result.diagnostic.params, {
    actual: "number",
    operation: "not",
  });
  assert.equal(result.diagnostic.stage, "runtime");
  assert.equal(result.diagnostic.severity, "error");
});

test("not propagates a failing operand", () => {
  const result = evalExpr("not (1 / 0)");
  assert.equal(result.ok, false);
  assert.equal(result.diagnostic.code, "ol-div-zero");
});

// --- `and` -------------------------------------------------------------------------------------

test("and is true only when every operand is true", () => {
  assert.deepEqual(evalExpr("true and true"), { ok: true, value: true });
  assert.deepEqual(evalExpr("true and false"), { ok: true, value: false });
  assert.deepEqual(evalExpr("false and true"), { ok: true, value: false });
  assert.deepEqual(evalExpr("false and false"), { ok: true, value: false });
});

test("and left-associates over three or more operands", () => {
  assert.deepEqual(evalExpr("true and true and true"), {
    ok: true,
    value: true,
  });
  assert.deepEqual(evalExpr("true and false and true"), {
    ok: true,
    value: false,
  });
});

test("and short-circuits at the first false — the right operand is never evaluated", () => {
  // `:missing` would raise `ol-undefined-var` if evaluated; `and` never reaches it once the
  // left operand is `false` (spec/execution-model.md:141).
  const result = evalExpr("false and :missing");
  assert.deepEqual(result, { ok: true, value: false });
});

test("and evaluates the right operand when the left is true, surfacing its diagnostic", () => {
  const result = evalExpr("true and :missing");
  assert.equal(result.ok, false);
  assert.equal(result.diagnostic.code, "ol-undefined-var");
});

test("and raises ol-not-boolean for a non-boolean left operand", () => {
  const result = evalExpr("1 and true");
  assert.equal(result.ok, false);
  assert.equal(result.diagnostic.code, "ol-not-boolean");
  assert.deepEqual(result.diagnostic.params, {
    actual: "number",
    operation: "and",
  });
});

test("and raises ol-not-boolean for a non-boolean right operand", () => {
  const result = evalExpr("true and 1");
  assert.equal(result.ok, false);
  assert.equal(result.diagnostic.code, "ol-not-boolean");
  assert.deepEqual(result.diagnostic.params, {
    actual: "number",
    operation: "and",
  });
});

test("(and a b c) — the parenthesized variadic form — left-associates and short-circuits", () => {
  assert.deepEqual(evalExpr("(and true true true)"), {
    ok: true,
    value: true,
  });
  // The third operand (`:missing`) is never reached once the second is `false`.
  assert.deepEqual(evalExpr("(and true false :missing)"), {
    ok: true,
    value: false,
  });
});

// --- `or` --------------------------------------------------------------------------------------

test("or is true when any operand is true", () => {
  assert.deepEqual(evalExpr("true or true"), { ok: true, value: true });
  assert.deepEqual(evalExpr("true or false"), { ok: true, value: true });
  assert.deepEqual(evalExpr("false or true"), { ok: true, value: true });
  assert.deepEqual(evalExpr("false or false"), { ok: true, value: false });
});

test("or left-associates over three or more operands", () => {
  assert.deepEqual(evalExpr("false or false or true"), {
    ok: true,
    value: true,
  });
  assert.deepEqual(evalExpr("false or false or false"), {
    ok: true,
    value: false,
  });
});

test("or short-circuits at the first true — the right operand is never evaluated", () => {
  const result = evalExpr("true or :missing");
  assert.deepEqual(result, { ok: true, value: true });
});

test("or evaluates the right operand when the left is false, surfacing its diagnostic", () => {
  const result = evalExpr("false or :missing");
  assert.equal(result.ok, false);
  assert.equal(result.diagnostic.code, "ol-undefined-var");
});

test("or raises ol-not-boolean for a non-boolean operand", () => {
  const left = evalExpr('"red" or true');
  assert.equal(left.ok, false);
  assert.equal(left.diagnostic.code, "ol-not-boolean");
  assert.deepEqual(left.diagnostic.params, {
    actual: "word",
    operation: "or",
  });

  const right = evalExpr('false or "red"');
  assert.equal(right.ok, false);
  assert.equal(right.diagnostic.code, "ol-not-boolean");
  assert.deepEqual(right.diagnostic.params, {
    actual: "word",
    operation: "or",
  });
});

test("(or a b c) — the parenthesized variadic form — left-associates and short-circuits", () => {
  assert.deepEqual(evalExpr("(or false false true)"), {
    ok: true,
    value: true,
  });
  // The third operand (`:missing`) is never reached once the second is `true`.
  assert.deepEqual(evalExpr("(or false true :missing)"), {
    ok: true,
    value: true,
  });
});

// --- Arity: `and`/`or` need at least two operands ----------------------------------------------
//
// The bare infix form always supplies exactly two (the grammar guarantees it), but the
// parenthesized form's operand count is bounded only by the closing `)` — `(and)`/`(and :a)`
// parse clean since the static checker never arity-checks a grammar operator callee
// (`checker-arity.ts`). Without a runtime guard these would silently report the identity value
// (`true`/`false`) instead of raising, since `execute()` never runs the semantic checker.

test("(and) with zero operands raises ol-not-enough-inputs rather than silently reporting true", () => {
  const result = evalExpr("(and)");
  assert.equal(result.ok, false);
  assert.equal(result.diagnostic.code, "ol-not-enough-inputs");
  assert.deepEqual(result.diagnostic.params, {
    callable: "and",
    expected: 2,
    actual: 0,
  });
});

test("(and :a) with one operand raises ol-not-enough-inputs rather than reporting that operand", () => {
  const result = evalExpr("(and :a)");
  assert.equal(result.ok, false);
  assert.equal(result.diagnostic.code, "ol-not-enough-inputs");
  assert.deepEqual(result.diagnostic.params, {
    callable: "and",
    expected: 2,
    actual: 1,
  });
});

test("(or) with zero operands raises ol-not-enough-inputs rather than silently reporting false", () => {
  const result = evalExpr("(or)");
  assert.equal(result.ok, false);
  assert.equal(result.diagnostic.code, "ol-not-enough-inputs");
  assert.deepEqual(result.diagnostic.params, {
    callable: "or",
    expected: 2,
    actual: 0,
  });
});

test("(or :a) with one operand raises ol-not-enough-inputs", () => {
  const result = evalExpr("(or :a)");
  assert.equal(result.ok, false);
  assert.equal(result.diagnostic.code, "ol-not-enough-inputs");
  assert.deepEqual(result.diagnostic.params, {
    callable: "or",
    expected: 2,
    actual: 1,
  });
});

// --- Combined precedence + isSupportedExpression --------------------------------------------

test("and binds tighter than or, matching precedence levels 6/7", () => {
  // `false and true or true` is `(false and true) or true` = `false or true` = `true`.
  assert.deepEqual(evalExpr("false and true or true"), {
    ok: true,
    value: true,
  });
});

test("not binds tighter than a comparison built from its operand", () => {
  // `not true and false` is `(not true) and false` = `false and false` = `false`.
  assert.deepEqual(evalExpr("not true and false"), {
    ok: true,
    value: false,
  });
});

test("isSupportedExpression accepts not/and/or calls, recursing into every operand", () => {
  assert.equal(isSupportedExpression(parseExpr("not true")), true);
  assert.equal(isSupportedExpression(parseExpr("true and false")), true);
  assert.equal(isSupportedExpression(parseExpr("true or false")), true);
  assert.equal(isSupportedExpression(parseExpr("(and true false true)")), true);
  // A short-circuited operand's *shape* is still checked — `:missing` is a supported `VarRef`
  // even though evaluating it would raise `ol-undefined-var`.
  assert.equal(isSupportedExpression(parseExpr("false and :missing")), true);
});

test("isSupportedExpression rejects a not/and/or call with an unsupported operand", () => {
  assert.equal(isSupportedExpression(parseExpr("not :ages.tom")), false);
  assert.equal(isSupportedExpression(parseExpr("true and :ages.tom")), false);
});
