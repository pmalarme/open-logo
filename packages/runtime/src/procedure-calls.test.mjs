// Unit tests for procedure-call execution: scope, arity, return/stop/throw (issue #97,
// spec/execution-model.md:316-364, 606-648). Conformance fixtures under
// tests/conformance/core-language/execution/procedure-*.expected.json cover the primary
// event/diagnostic shapes end to end (basic call+return, optional-param defaults in both call
// forms, both arity diagnostics, stop escaping a nested loop, return/stop outside any procedure,
// ol-no-output at the call site, throw, the spec's worked recursion trace, and lexical-frame
// isolation). These unit tests fill in what a fixture cannot: reporter calls nested inside
// expressions, a reporter call as an argument to another user procedure, redefinition-wins
// registration (hoisting), zero-arg/zero-param edge cases (the empty-array coverage trap this
// repo has hit before — see `.every()`/`.some()` on an empty args/params array), a default
// parameter's expression referencing an earlier parameter, `(paren-call)` reporter position, and
// `throw` coercing a non-word value via the same rendering `print` uses.

import assert from "node:assert/strict";
import { test } from "node:test";
import * as Parser from "@openlogo/parser";
import { createEnvironment, evaluate, execute } from "@openlogo/runtime";

const doc = "acceptance.logo";

test("a procedure is callable before its textual definition (whole-program hoisting)", () => {
  const result = execute('print greet\ndefine greet\n  return "hi"\nend', doc);
  assert.deepEqual(result.diagnostics, []);
  const printed = result.events
    .filter((event) => event.kind === "print")
    .map((event) => event.payload.values[0]);
  assert.deepEqual(printed, ["hi"]);
});

test("a later define of the same name wins over an earlier one (redefinition, matches the static checker)", () => {
  const result = execute(
    "define f\n  return 1\nend\ndefine f\n  return 2\nend\nprint f",
    doc,
  );
  assert.deepEqual(result.diagnostics, []);
  const printed = result.events
    .filter((event) => event.kind === "print")
    .map((event) => event.payload.values[0]);
  assert.deepEqual(printed, [2]);
});

test("a zero-param, zero-arg procedure call binds no parameters (empty-array binder loop)", () => {
  const result = execute("define noop\n  return 42\nend\nprint noop", doc);
  assert.deepEqual(result.diagnostics, []);
  const printed = result.events
    .filter((event) => event.kind === "print")
    .map((event) => event.payload.values[0]);
  assert.deepEqual(printed, [42]);
});

test("a reporter call nested inside an arithmetic expression evaluates correctly", () => {
  const result = execute(
    "define double :n\n  return :n * 2\nend\nprint double 3 + 1",
    doc,
  );
  assert.deepEqual(result.diagnostics, []);
  // Bare `double` gathers exactly its one required argument via a full expression parse (the
  // reader's fixed-arity gathering calls the same `parseExpression` used everywhere else), so the
  // argument consumed is the whole `3 + 1` (= 4), not just `3` — `double`'s result is 8.
  const printed = result.events
    .filter((event) => event.kind === "print")
    .map((event) => event.payload.values[0]);
  assert.deepEqual(printed, [8]);
});

test("a reporter call can be passed as an argument to another user procedure", () => {
  const result = execute(
    "define inc :n\n  return :n + 1\nend\ndefine twice :n\n  return :n * 2\nend\nprint twice inc 4",
    doc,
  );
  assert.deepEqual(result.diagnostics, []);
  const printed = result.events
    .filter((event) => event.kind === "print")
    .map((event) => event.payload.values[0]);
  assert.deepEqual(printed, [10]);
});

test("a later optional parameter's default expression can reference an earlier parameter", () => {
  const result = execute(
    "define pair (:a 10) (:b :a + 1)\n  print :a\n  print :b\nend\n(pair)",
    doc,
  );
  assert.deepEqual(result.diagnostics, []);
  const printed = result.events
    .filter((event) => event.kind === "print")
    .map((event) => event.payload.values[0]);
  assert.deepEqual(printed, [10, 11]);
});

test("a parenthesized reporter call in expression position resolves the same as a bare call", () => {
  const result = execute(
    "define square :n\n  return :n * :n\nend\nprint (square 4)",
    doc,
  );
  assert.deepEqual(result.diagnostics, []);
  const printed = result.events
    .filter((event) => event.kind === "print")
    .map((event) => event.payload.values[0]);
  assert.deepEqual(printed, [16]);
});

test("throw coerces a non-word value the same way print renders it", () => {
  const result = execute("define fail\n  throw 42\nend\nfail", doc);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-user-error");
  assert.deepEqual(result.diagnostics[0].params, { message: "42" });
});

test("throw with a boolean value coerces via the same rendering print uses", () => {
  const result = execute("define fail\n  throw true\nend\nfail", doc);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-user-error");
  assert.deepEqual(result.diagnostics[0].params, { message: "true" });
});

test("return with the bare-form long call site still passes arguments to the callee", () => {
  const result = execute("define f :n\n  print :n\nend\nf 5", doc);
  assert.deepEqual(result.diagnostics, []);
  const printed = result.events
    .filter((event) => event.kind === "print")
    .map((event) => event.payload.values[0]);
  assert.deepEqual(printed, [5]);
});

test("a diagnostic raised evaluating an argument expression halts before the callee is entered", () => {
  const result = execute("define f :n\n  print :n\nend\nf 1 / 0", doc);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-div-zero");
  assert.deepEqual(
    result.events.filter((event) => event.kind === "procedure-enter"),
    [],
  );
});

test("a diagnostic raised evaluating an optional parameter's default halts the call", () => {
  const result = execute("define f (:n 1 / 0)\n  print :n\nend\nf", doc);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-div-zero");
  assert.deepEqual(
    result.events.filter((event) => event.kind === "procedure-exit"),
    [],
  );
});

test("stop inside a procedure called from inside another procedure only exits the inner one", () => {
  const result = execute(
    'define inner\n  stop\n  print "unreachable"\nend\ndefine outer\n  inner\n  print "after inner"\nend\nouter',
    doc,
  );
  assert.deepEqual(result.diagnostics, []);
  const printed = result.events
    .filter((event) => event.kind === "print")
    .map((event) => event.payload.values[0]);
  assert.deepEqual(printed, ["after inner"]);
});

test("a callee's frame cannot see a caller procedure's own parameter (only the shared global frame and passed params flow in)", () => {
  const result = execute(
    "define caller :x\n  callee\nend\ndefine callee\n  print :x\nend\ncaller 5",
    doc,
  );
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-undefined-var");
});

test("createEnvironment()'s callProcedure stub is unreachable in practice (its procedures map is always empty), but throws defensively if ever invoked", () => {
  const env = createEnvironment();
  const { ast, diagnostics } = Parser.parse("greet", doc);
  assert.deepEqual(diagnostics, []);
  const callNode = ast.body[0];
  // Force the otherwise-empty registry to report this one name as known, the only way to drive
  // `evaluateCall` into the `env.callProcedure(...)` branch outside of `execute-internal.ts`'s
  // real wiring (`createExecutionEnvironment`), which always supplies a working implementation.
  env.procedures.set("greet", {});
  assert.throws(() => evaluate(callNode, env), /callProcedure is unreachable/);
});

test("ol-too-many-inputs' message pluralizes the expected count singularly for a one-parameter procedure", () => {
  const result = execute(
    "define single :a\n  return :a\nend\nprint (single 1 2)",
    doc,
  );
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-too-many-inputs");
  assert.deepEqual(result.diagnostics[0].params, {
    callable: "single",
    expected: 1,
    actual: 2,
  });
});
