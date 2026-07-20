// Unit tests for the expression evaluator — Core literals and arithmetic (`+ - * / mod` plus
// `abs sqrt int round power`) per spec/execution-model.md and spec/commands.md (issue #93).
// `isSupportedExpression`'s gate is extended for `:name` reads and index-only places by issue
// #94; see variables-places.test.mjs for the dedicated variable/place/assignment test suite.
// Most cases parse real source through @openlogo/parser and evaluate the resulting AST node,
// exercising evaluate() exactly as @openlogo/runtime's execute() does. A handful of cases hand-
// build a minimal AST node to exercise evaluator-internal invariants (an unimplemented node
// kind, an unimplemented callee, or a missing argument) that a real parse can never produce
// given the parser's grammar and fixed-arity table — these are safety nets, not user-reachable
// paths.

import assert from "node:assert/strict";
import { test } from "node:test";
import { makeSpan } from "@openlogo/core";
import * as Parser from "@openlogo/parser";
import { evaluate, isSupportedExpression } from "@openlogo/runtime";

const doc = "acceptance.logo";

/** Parse `print <expr>` and return the evaluated result of `<expr>`. */
function evalExpr(expr) {
  const { ast, diagnostics } = Parser.parse(`print ${expr}`, doc);
  assert.deepEqual(diagnostics, []);
  return evaluate(ast.body[0].args[0]);
}

/** Parse `print <expr>` and return the un-evaluated `<expr>` AST node. */
function parseExpr(expr) {
  const { ast, diagnostics } = Parser.parse(`print ${expr}`, doc);
  assert.deepEqual(diagnostics, []);
  return ast.body[0].args[0];
}

test("evaluates each Core literal to its runtime value", () => {
  assert.deepEqual(evalExpr("42"), { ok: true, value: 42 });
  assert.deepEqual(evalExpr("-7"), { ok: true, value: -7 });
  assert.deepEqual(evalExpr('"red"'), { ok: true, value: "red" });
  assert.deepEqual(evalExpr("true"), { ok: true, value: true });
  assert.deepEqual(evalExpr("false"), { ok: true, value: false });
  assert.deepEqual(evalExpr("[1 2 3]"), { ok: true, value: [1, 2, 3] });
  assert.deepEqual(evalExpr("[]"), { ok: true, value: [] });
});

test("propagates a failing element out of a list literal", () => {
  const result = evalExpr("[1 1 / 0]");
  assert.equal(result.ok, false);
  assert.equal(result.diagnostic.code, "ol-div-zero");
});

test("adds, subtracts, multiplies, and left-associates", () => {
  assert.deepEqual(evalExpr("2 + 3"), { ok: true, value: 5 });
  assert.deepEqual(evalExpr("10 - 4"), { ok: true, value: 6 });
  assert.deepEqual(evalExpr("6 * 7"), { ok: true, value: 42 });
  assert.deepEqual(evalExpr("10 - 2 - 3"), { ok: true, value: 5 });
  assert.deepEqual(evalExpr("20 / 4 / 5"), { ok: true, value: 1 });
});

test("divides and reports the full precedence chain", () => {
  assert.deepEqual(evalExpr("12 / 3"), { ok: true, value: 4 });
  assert.deepEqual(evalExpr("2 * 3 + 4 * 5 - 6 / 2 mod 4"), {
    ok: true,
    value: 23,
  });
});

test("reports the remainder with `mod`", () => {
  assert.deepEqual(evalExpr("17 mod 5"), { ok: true, value: 2 });
});

test("raises ol-div-zero for division by zero, never Infinity/NaN", () => {
  const result = evalExpr("5 / 0");
  assert.equal(result.ok, false);
  assert.equal(result.diagnostic.code, "ol-div-zero");
  assert.deepEqual(result.diagnostic.params, { operation: "/" });
  assert.equal(result.diagnostic.stage, "runtime");
  assert.equal(result.diagnostic.severity, "error");
});

test("raises ol-div-zero for `mod` by zero", () => {
  const result = evalExpr("5 mod 0");
  assert.equal(result.ok, false);
  assert.equal(result.diagnostic.code, "ol-div-zero");
  assert.deepEqual(result.diagnostic.params, { operation: "mod" });
});

test("raises ol-type when an arithmetic operand is not a number", () => {
  const left = evalExpr("true + 1");
  assert.equal(left.ok, false);
  assert.equal(left.diagnostic.code, "ol-type");
  assert.deepEqual(left.diagnostic.params, {
    expected: "number",
    actual: "boolean",
    value: true,
    operation: "+",
  });

  const right = evalExpr("1 + true");
  assert.equal(right.ok, false);
  assert.equal(right.diagnostic.code, "ol-type");
  assert.equal(right.diagnostic.params.actual, "boolean");
});

test("propagates a failing left or right operand before checking types", () => {
  const leftFails = evalExpr("(1 / 0) + 1");
  assert.equal(leftFails.ok, false);
  assert.equal(leftFails.diagnostic.code, "ol-div-zero");

  const rightFails = evalExpr("1 + (1 / 0)");
  assert.equal(rightFails.ok, false);
  assert.equal(rightFails.diagnostic.code, "ol-div-zero");
});

test("accepts a word that reads as a number, per execution-model.md:33", () => {
  assert.deepEqual(evalExpr('"5" + 1'), { ok: true, value: 6 });
});

test("rejects a word that does not read as a number", () => {
  const result = evalExpr('"abc" + 1');
  assert.equal(result.ok, false);
  assert.equal(result.diagnostic.code, "ol-type");
  assert.equal(result.diagnostic.params.actual, "word");
});

test("distinguishes a negative literal from subtraction", () => {
  assert.deepEqual(evalExpr("-7"), { ok: true, value: -7 });
  assert.deepEqual(evalExpr("0 - 7"), { ok: true, value: -7 });
});

test("abs reports the distance of a number from zero", () => {
  assert.deepEqual(evalExpr("abs -5"), { ok: true, value: 5 });
  assert.deepEqual(evalExpr("abs 5"), { ok: true, value: 5 });
});

test("sqrt reports the square root of a non-negative number", () => {
  assert.deepEqual(evalExpr("sqrt 81"), { ok: true, value: 9 });
});

test("raises ol-neg-sqrt for a negative sqrt input", () => {
  const result = evalExpr("sqrt -4");
  assert.equal(result.ok, false);
  assert.equal(result.diagnostic.code, "ol-neg-sqrt");
  assert.deepEqual(result.diagnostic.params, { value: -4 });
});

test("int truncates toward zero", () => {
  assert.deepEqual(evalExpr("int 3.8"), { ok: true, value: 3 });
  assert.deepEqual(evalExpr("int -3.8"), { ok: true, value: -3 });
});

test("round rounds ties toward positive infinity", () => {
  assert.deepEqual(evalExpr("round 3.5"), { ok: true, value: 4 });
  assert.deepEqual(evalExpr("round -3.5"), { ok: true, value: -3 });
  assert.deepEqual(evalExpr("round 3.8"), { ok: true, value: 4 });
});

test("propagates a failing operand into a unary math builtin", () => {
  const result = evalExpr("sqrt (1 / 0)");
  assert.equal(result.ok, false);
  assert.equal(result.diagnostic.code, "ol-div-zero");
});

test("raises ol-type when a unary math builtin's operand is not a number", () => {
  const result = evalExpr("sqrt true");
  assert.equal(result.ok, false);
  assert.equal(result.diagnostic.code, "ol-type");
  assert.equal(result.diagnostic.params.operation, "sqrt");
});

test("power raises the first number to the second as an exponent", () => {
  assert.deepEqual(evalExpr("power 2 8"), { ok: true, value: 256 });
});

test("propagates a failing base or exponent into power", () => {
  const baseFails = evalExpr("power (1 / 0) 2");
  assert.equal(baseFails.ok, false);
  assert.equal(baseFails.diagnostic.code, "ol-div-zero");

  const exponentFails = evalExpr("power 2 (1 / 0)");
  assert.equal(exponentFails.ok, false);
  assert.equal(exponentFails.diagnostic.code, "ol-div-zero");
});

test("raises ol-type when power's base or exponent is not a number", () => {
  const badBase = evalExpr("power true 2");
  assert.equal(badBase.ok, false);
  assert.equal(badBase.diagnostic.code, "ol-type");
  assert.equal(badBase.diagnostic.params.operation, "power");

  const badExponent = evalExpr("power 2 true");
  assert.equal(badExponent.ok, false);
  assert.equal(badExponent.diagnostic.code, "ol-type");
});

// `sin`/`cos`/`tan`/`pi` (issue #323, `spec/commands.md`'s "Math" section): the Core Math
// reporters this issue adds. Before this issue, `sin`/`cos`/`tan`/`pi` were already registered in
// the parser's fixed-arity table and so parsed with zero diagnostics, but reached no evaluator
// branch and no `isSupportedExpression` entry, so `print sin 90` silently emitted no `print`
// event and no diagnostic at all — an uncontrolled silent failure this issue fixes.

test("sin/cos report the sine/cosine of an angle in degrees", () => {
  assert.deepEqual(evalExpr("sin 90"), { ok: true, value: 1 });
  assert.deepEqual(evalExpr("sin 0"), { ok: true, value: 0 });
  assert.deepEqual(evalExpr("sin -90"), { ok: true, value: -1 });
  assert.deepEqual(evalExpr("cos 0"), { ok: true, value: 1 });
  assert.deepEqual(evalExpr("cos 180"), { ok: true, value: -1 });
});

test("tan reports the tangent of an angle in degrees", () => {
  assert.deepEqual(evalExpr("tan 0"), { ok: true, value: 0 });
  // `tan 45` is `0.9999999999999999`, not exactly `1`, per IEEE-754 double rounding of `π/4` —
  // `print`'s canonical 10-significant-digit rendering (`formatNumber`) is what makes
  // `print tan 45` display `1`, matching `spec/commands.md`'s worked example; the raw evaluated
  // value is not itself rounded.
  assert.deepEqual(evalExpr("tan 45"), {
    ok: true,
    value: 0.9999999999999999,
  });
});

test("raises ol-div-zero for tan at a pole, never a huge finite value, NaN, or Infinity", () => {
  for (const degrees of [90, -90, 270, 450]) {
    const result = evalExpr(`tan ${degrees}`);
    assert.equal(result.ok, false);
    assert.equal(result.diagnostic.code, "ol-div-zero");
    assert.deepEqual(result.diagnostic.params, {
      operation: "tan",
      value: degrees,
    });
  }
});

test("evaluates tan normally for angles adjacent to a pole, never a false-positive diagnostic", () => {
  // Regression for a pole-detection bug caught in review: normalizing the remainder into
  // `[0, 180)` by adding `180` before the second `%` is lossy for doubles one ULP away from `90`
  // (`89.99999999999999`, `90.00000000000001`) — the addition rounds the sum to exactly `270`,
  // which then falsely normalizes back to `90`, misclassifying a defined, finite `tan` input as
  // undefined. Comparing `degrees % 180` directly against `90`/`-90` (no addition, so no
  // precision loss) avoids this false positive.
  for (const degrees of [89.99999999999999, 90.00000000000001]) {
    const result = evalExpr(`tan ${degrees}`);
    assert.equal(result.ok, true);
    assert.equal(Number.isFinite(result.value), true);
  }
});

test("pi reports the mathematical constant", () => {
  assert.deepEqual(evalExpr("pi"), { ok: true, value: Math.PI });
});

test("propagates a failing operand into sin/cos/tan", () => {
  for (const builtin of ["sin", "cos", "tan"]) {
    const result = evalExpr(`${builtin} (1 / 0)`);
    assert.equal(result.ok, false);
    assert.equal(result.diagnostic.code, "ol-div-zero");
  }
});

test("raises ol-type when sin/cos/tan's operand is not a number", () => {
  for (const builtin of ["sin", "cos", "tan"]) {
    const result = evalExpr(`${builtin} true`);
    assert.equal(result.ok, false);
    assert.equal(result.diagnostic.code, "ol-type");
    assert.equal(result.diagnostic.params.operation, builtin);
  }
});

// The remaining tests hand-build minimal AST nodes to exercise evaluator-internal invariants
// that the parser's grammar and fixed-arity table make unreachable from real source.

const span = makeSpan(doc, [1, 1], [1, 1]);

test("isSupportedExpression accepts every literal, arithmetic, and place-read shape this issue implements", () => {
  assert.equal(isSupportedExpression(parseExpr("42")), true);
  assert.equal(isSupportedExpression(parseExpr('"red"')), true);
  assert.equal(isSupportedExpression(parseExpr("true")), true);
  assert.equal(isSupportedExpression(parseExpr("[1 2 3]")), true);
  assert.equal(isSupportedExpression(parseExpr("2 + 3 * 4")), true);
  assert.equal(isSupportedExpression(parseExpr("sqrt (power 2 3)")), true);
  assert.equal(isSupportedExpression(parseExpr("sin 90")), true);
  assert.equal(isSupportedExpression(parseExpr("cos 0")), true);
  assert.equal(isSupportedExpression(parseExpr("tan 45")), true);
  assert.equal(isSupportedExpression(parseExpr("pi")), true);
  assert.equal(isSupportedExpression(parseExpr(":x")), true);
  assert.equal(isSupportedExpression(parseExpr('thing "x"')), true);
  assert.equal(isSupportedExpression(parseExpr(":nums[1]")), true);
  assert.equal(isSupportedExpression(parseExpr(":nums[:i]")), true);
});

test("isSupportedExpression rejects expression kinds and callees this issue does not implement", () => {
  // A dotted `.field` place segment is Data/record-profile and deferred (issue #94 covers only
  // the `index` selector); a bare variable read (`:x`) and an `index`-only place are supported.
  assert.equal(isSupportedExpression(parseExpr(":ages.tom")), false);
  assert.equal(isSupportedExpression(parseExpr("(forward 100)")), false);
  // A list containing an unsupported element is itself unsupported.
  assert.equal(isSupportedExpression(parseExpr("[1 :ages.tom]")), false);
  // An arithmetic call with an unsupported operand is itself unsupported.
  assert.equal(isSupportedExpression(parseExpr("1 + :ages.tom")), false);
  // An is-predicate whose operand is itself unsupported is unsupported (issue #99).
  assert.equal(isSupportedExpression(parseExpr("(:ages.tom is empty)")), false);
  // An is-predicate whose form-specific sub-expression is unsupported is unsupported too.
  assert.equal(
    isSupportedExpression(parseExpr("(2 is member of :ages.tom)")),
    false,
  );
  assert.equal(
    isSupportedExpression(parseExpr("(5 is between :ages.tom and 5)")),
    false,
  );
  assert.equal(
    isSupportedExpression(parseExpr("(5 is between 1 and :ages.tom)")),
    false,
  );
});

test("throws for a call to a callee this issue does not implement yet", () => {
  const call = {
    kind: "Call",
    source_span: span,
    callee: { name: "forward", source_span: span },
    args: [{ kind: "NumberLit", source_span: span, value: 100 }],
  };
  assert.throws(() => evaluate(call), /forward.*not implemented/);
});

test("throws when a call is missing an argument the operator requires", () => {
  const call = {
    kind: "Call",
    source_span: span,
    callee: { name: "+", source_span: span },
    args: [{ kind: "NumberLit", source_span: span, value: 1 }],
  };
  assert.throws(() => evaluate(call), /no argument at position 1/);
});
