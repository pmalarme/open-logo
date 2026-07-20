// Unit tests for issue #94: `:name` variable reads (sugar for `thing "name"`), the root
// Environment/lookup model, `=`/`set … to` assignment (mutate the nearest existing binding, or
// create a global when none exists), and Core-scope postfix list-index places (`:l[i]`, 1-based,
// read AND in-place write, `ol-range` on out-of-bounds, no auto-vivification on a nested chain).
// Most cases parse real source through @openlogo/parser and drive the public `evaluate`/
// `executeAssign` API through a shared `createEnvironment()` — exactly as `execute()` does. A
// couple of cases hand-build a minimal AST node to exercise evaluator-internal invariants (an
// unimplemented place-segment kind, an assignment target that is structurally neither a `Place`
// nor a `Call`/`ParenCall`) that the parser's grammar makes unreachable from real source.

import assert from "node:assert/strict";
import { test } from "node:test";
import { makeSpan } from "@openlogo/core";
import * as Parser from "@openlogo/parser";
import { createEnvironment, evaluate, executeAssign } from "@openlogo/runtime";

const doc = "acceptance.logo";

/** Parse `print <expr>` and return the un-evaluated `<expr>` AST node. */
function parseExpr(expr) {
  const { ast, diagnostics } = Parser.parse(`print ${expr}`, doc);
  assert.deepEqual(diagnostics, []);
  return ast.body[0].args[0];
}

/** Parse one `<expr>` as a standalone statement (e.g. an `Assign`) and return its AST node. */
function parseStatement(source) {
  const { ast, diagnostics } = Parser.parse(source, doc);
  assert.deepEqual(diagnostics, []);
  return ast.body[0];
}

/** A fresh environment with `name` already bound to `value` in its root frame. */
function envWith(name, value) {
  const env = createEnvironment();
  env.frames[env.frames.length - 1].set(name, value);
  return env;
}

// --- `:name` reads and `thing` --------------------------------------------------------------

test("reads a bound variable via `:name`", () => {
  const env = envWith("size", 50);
  assert.deepEqual(evaluate(parseExpr(":size"), env), { ok: true, value: 50 });
});

test("raises ol-undefined-var for an unbound `:name` read", () => {
  const result = evaluate(parseExpr(":missing"), createEnvironment());
  assert.equal(result.ok, false);
  assert.equal(result.diagnostic.code, "ol-undefined-var");
  assert.deepEqual(result.diagnostic.params, { name: "missing" });
  assert.equal(result.diagnostic.stage, "runtime");
  assert.equal(result.diagnostic.severity, "error");
});

test('`thing "name"` reads the same binding as `:name`', () => {
  const env = envWith("x", 7);
  assert.deepEqual(evaluate(parseExpr('thing "x"'), env), {
    ok: true,
    value: 7,
  });
});

test("thing raises ol-undefined-var for an unbound name", () => {
  const result = evaluate(parseExpr('thing "missing"'), createEnvironment());
  assert.equal(result.ok, false);
  assert.equal(result.diagnostic.code, "ol-undefined-var");
  assert.deepEqual(result.diagnostic.params, { name: "missing" });
});

test("thing raises ol-type when its argument is not a word", () => {
  const result = evaluate(parseExpr("thing 1"), createEnvironment());
  assert.equal(result.ok, false);
  assert.equal(result.diagnostic.code, "ol-type");
  assert.deepEqual(result.diagnostic.params, {
    expected: "word",
    actual: "number",
    value: 1,
    operation: "thing",
  });
});

test("thing propagates a failing argument expression before it evaluates the name", () => {
  const result = evaluate(parseExpr("thing (1 / 0)"), createEnvironment());
  assert.equal(result.ok, false);
  assert.equal(result.diagnostic.code, "ol-div-zero");
});

// --- Postfix index places: reads --------------------------------------------------------------

test("reads a list element with a 1-based literal index", () => {
  const env = envWith("nums", [10, 20, 30]);
  assert.deepEqual(evaluate(parseExpr(":nums[2]"), env), {
    ok: true,
    value: 20,
  });
});

test("reads a list element using a variable as the index key", () => {
  const env = envWith("nums", [10, 20, 30]);
  env.frames[env.frames.length - 1].set("i", 2);
  assert.deepEqual(evaluate(parseExpr(":nums[:i]"), env), {
    ok: true,
    value: 20,
  });
});

test("reads through a nested index chain", () => {
  const env = envWith("m", [
    [1, 2],
    [3, 4],
  ]);
  assert.deepEqual(evaluate(parseExpr(":m[2][1]"), env), {
    ok: true,
    value: 3,
  });
});

test("raises ol-undefined-var when the base of a place read is unbound", () => {
  const result = evaluate(parseExpr(":missing[1]"), createEnvironment());
  assert.equal(result.ok, false);
  assert.equal(result.diagnostic.code, "ol-undefined-var");
  assert.deepEqual(result.diagnostic.params, { name: "missing" });
});

test("raises ol-range for an out-of-bounds index", () => {
  const env = envWith("nums", [1, 2, 3]);
  const result = evaluate(parseExpr(":nums[5]"), env);
  assert.equal(result.ok, false);
  assert.equal(result.diagnostic.code, "ol-range");
  assert.deepEqual(result.diagnostic.params, {
    operation: "index",
    index: 5,
    length: 3,
  });
});

test("raises ol-range for a zero index and for a non-integer index", () => {
  const env = envWith("nums", [1, 2, 3]);
  const zero = evaluate(parseExpr(":nums[0]"), env);
  assert.equal(zero.ok, false);
  assert.equal(zero.diagnostic.code, "ol-range");
  const fractional = evaluate(parseExpr(":nums[1.5]"), env);
  assert.equal(fractional.ok, false);
  assert.equal(fractional.diagnostic.code, "ol-range");
});

test("raises ol-type when indexing a non-list value", () => {
  const env = envWith("x", 5);
  const result = evaluate(parseExpr(":x[1]"), env);
  assert.equal(result.ok, false);
  assert.equal(result.diagnostic.code, "ol-type");
  assert.deepEqual(result.diagnostic.params, {
    expected: "list",
    actual: "number",
    value: 5,
    operation: "index",
  });
});

test("raises ol-type when the index key is not a number", () => {
  const env = envWith("nums", [1, 2, 3]);
  env.frames[env.frames.length - 1].set("flag", true);
  const result = evaluate(parseExpr(":nums[:flag]"), env);
  assert.equal(result.ok, false);
  assert.equal(result.diagnostic.code, "ol-type");
  assert.deepEqual(result.diagnostic.params, {
    expected: "number",
    actual: "boolean",
    value: true,
    operation: "index",
  });
});

test("propagates a failing key expression before validating the container", () => {
  const env = envWith("nums", [1, 2, 3]);
  const result = evaluate(parseExpr(":nums[(:missing + 1)]"), env);
  assert.equal(result.ok, false);
  assert.equal(result.diagnostic.code, "ol-undefined-var");
  assert.deepEqual(result.diagnostic.params, { name: "missing" });
});

// --- Assignment: bare places (`=`, `set … to`) ------------------------------------------------

test("creates a global binding on first assignment via `:place = value`", () => {
  const env = createEnvironment();
  const result = executeAssign(parseStatement(":size = 50"), env);
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(evaluate(parseExpr(":size"), env), { ok: true, value: 50 });
});

test("creates a global binding on first assignment via `set place to value`", () => {
  const env = createEnvironment();
  const result = executeAssign(parseStatement("set count to 1"), env);
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(evaluate(parseExpr(":count"), env), { ok: true, value: 1 });
});

test("mutates the nearest existing binding rather than shadowing it", () => {
  const env = envWith("count", 1);
  const result = executeAssign(parseStatement("set count to :count + 1"), env);
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(evaluate(parseExpr(":count"), env), { ok: true, value: 2 });
});

test("propagates a failing value expression, leaving the binding unchanged", () => {
  const env = envWith("x", 1);
  const result = executeAssign(parseStatement(":x = 1 / 0"), env);
  assert.equal(result.ok, false);
  assert.equal(result.diagnostic.code, "ol-div-zero");
  assert.deepEqual(evaluate(parseExpr(":x"), env), { ok: true, value: 1 });
});

test("raises ol-not-a-place for a reporter call used as an assignment target", () => {
  const env = envWith("nums", [1, 2, 3]);
  const result = executeAssign(parseStatement("first :nums = 1"), env);
  assert.equal(result.ok, false);
  assert.equal(result.diagnostic.code, "ol-not-a-place");
  assert.deepEqual(result.diagnostic.params, { text: "first :nums" });
  assert.equal(result.diagnostic.stage, "runtime");
});

test("raises ol-not-a-place for a parenthesized reporter call target", () => {
  const env = envWith("nums", [1, 2, 3]);
  const result = executeAssign(parseStatement("(first :nums) = 1"), env);
  assert.equal(result.ok, false);
  assert.equal(result.diagnostic.code, "ol-not-a-place");
  assert.deepEqual(result.diagnostic.params, { text: "(first :nums)" });
});

test("ol-not-a-place is raised before the target is evaluated — an unbound operand does not matter", () => {
  const env = createEnvironment();
  const result = executeAssign(parseStatement("first :missing = 1"), env);
  assert.equal(result.ok, false);
  assert.equal(result.diagnostic.code, "ol-not-a-place");
  assert.deepEqual(result.diagnostic.params, { text: "first :missing" });
});

test("leaves a dotted `.field` assignment target silently un-executed (Data-profile, deferred)", () => {
  const env = createEnvironment();
  const result = executeAssign(parseStatement(":ages.tom = 5"), env);
  assert.deepEqual(result, { ok: true });
  assert.equal(env.frames[env.frames.length - 1].has("ages"), false);
});

test("leaves an assignment with a dotted `.field` value expression silently un-executed", () => {
  const env = envWith("ages", [1]);
  const result = executeAssign(parseStatement(":x = :ages.tom"), env);
  assert.deepEqual(result, { ok: true });
  assert.equal(env.frames[env.frames.length - 1].has("x"), false);
});

// --- Assignment: postfix index places ---------------------------------------------------------

test("writes a single-segment index place in place, preserving aliasing", () => {
  const env = createEnvironment();
  const list = [10, 20, 30];
  env.frames[env.frames.length - 1].set("nums", list);
  const result = executeAssign(parseStatement(":nums[2] = 99"), env);
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(evaluate(parseExpr(":nums"), env), {
    ok: true,
    value: [10, 99, 30],
  });
  // The same JS array reference observes the write — no new list was allocated.
  assert.deepEqual(list, [10, 99, 30]);
});

test("writes through a nested index chain without auto-vivification", () => {
  const env = createEnvironment();
  env.frames[env.frames.length - 1].set("m", [
    [1, 2],
    [3, 4],
  ]);
  const result = executeAssign(parseStatement(":m[1][2] = 9"), env);
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(evaluate(parseExpr(":m"), env), {
    ok: true,
    value: [
      [1, 9],
      [3, 4],
    ],
  });
});

test("raises ol-undefined-var for indexed assignment to an unbound base — it never creates one", () => {
  const env = createEnvironment();
  const result = executeAssign(parseStatement(":nums[1] = 1"), env);
  assert.equal(result.ok, false);
  assert.equal(result.diagnostic.code, "ol-undefined-var");
  assert.deepEqual(result.diagnostic.params, { name: "nums" });
  assert.equal(env.frames[env.frames.length - 1].has("nums"), false);
});

test("raises ol-range at the first invalid intermediate index in a nested write", () => {
  const env = createEnvironment();
  env.frames[env.frames.length - 1].set("m", [
    [1, 2],
    [3, 4],
  ]);
  const result = executeAssign(parseStatement(":m[9][1] = 5"), env);
  assert.equal(result.ok, false);
  assert.equal(result.diagnostic.code, "ol-range");
  assert.deepEqual(result.diagnostic.params, {
    operation: "index",
    index: 9,
    length: 2,
  });
});

test("raises ol-range for the final segment of an indexed write when it is out of bounds", () => {
  const env = createEnvironment();
  env.frames[env.frames.length - 1].set("nums", [1, 2, 3]);
  const result = executeAssign(parseStatement(":nums[9] = 1"), env);
  assert.equal(result.ok, false);
  assert.equal(result.diagnostic.code, "ol-range");
  assert.deepEqual(result.diagnostic.params, {
    operation: "index",
    index: 9,
    length: 3,
  });
});

// --- Hand-built AST invariants (unreachable from real source) ---------------------------------
//
// The remaining tests hand-build minimal AST nodes to exercise evaluator-internal invariants
// that the parser's grammar makes unreachable from real source: `isSupportedExpression` already
// filters a `.field`-bearing place out of anything `print`/`execute()` would evaluate, and the
// grammar only ever builds an `Assign` target as a `Place` or a `Call`/`ParenCall`.

const span = makeSpan(doc, [1, 1], [1, 1]);

test("readPlace throws for a place segment kind this issue does not implement yet", () => {
  const env = envWith("ages", [1, 2, 3]);
  const place = {
    kind: "Place",
    source_span: span,
    base: { name: "ages", source_span: span },
    segments: [
      {
        kind: "field",
        name: { name: "tom", source_span: span },
        source_span: span,
      },
    ],
  };
  assert.throws(() => evaluate(place, env), /field.*not implemented/);
});

test("executeAssign throws when the assignment target is neither a Place nor a Call", () => {
  const node = {
    kind: "Assign",
    source_span: span,
    place: { kind: "NumberLit", source_span: span, value: 1 },
    value: { kind: "NumberLit", source_span: span, value: 2 },
    form: "equals",
  };
  assert.throws(
    () => executeAssign(node, createEnvironment()),
    /NumberLit.*not a place/,
  );
});
