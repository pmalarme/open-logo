// Unit tests for procedure-call execution: scope, arity, return/stop/throw (issue #97,
// spec/execution-model.md:338-385,926-964). Conformance fixtures under
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

test("unbounded recursion raises a friendly ol-limit diagnostic instead of a host stack overflow (spec/execution-model.md#execution-safety)", () => {
  const result = execute(
    "define loop_forever\n  loop_forever\nend\nloop_forever",
    doc,
  );
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-limit");
  assert.deepEqual(result.diagnostics[0].params, {
    limit: "recursion-depth",
    value: 500,
  });
});

test("recursion within the depth limit still completes normally and returns the right value", () => {
  const result = execute(
    "define countdown :n\n  if :n == 0 [\n    return 0\n  ]\n  return countdown :n - 1\nend\nprint countdown 100",
    doc,
  );
  assert.deepEqual(result.diagnostics, []);
  const printed = result.events
    .filter((event) => event.kind === "print")
    .map((event) => event.payload.values[0]);
  assert.deepEqual(printed, [0]);
});

test("a later define of the same name is ol-duplicate-definition, not a silent override (issue #839)", () => {
  // Was: "a later define wins over an earlier one (matches the static checker)". It never matched
  // the checker — `check()` reported the collision while `execute()` ran the SECOND body and
  // printed `2`, the exact silent override `spec/execution-model.md:86-88` forbids. The two bodies
  // differ deliberately (`return 1` vs `return 2`): under the old rule this printed `2`, under a
  // first-wins rule it would print `1`, and only the ruling's rule prints nothing at all.
  const result = execute(
    "define f\n  return 1\nend\ndefine f\n  return 2\nend\nprint f",
    doc,
  );
  assert.equal(result.diagnostics.length, 1);
  const [diagnostic] = result.diagnostics;
  assert.equal(diagnostic.code, "ol-duplicate-definition");
  assert.deepEqual(diagnostic.params, {
    name: "f",
    original_span: { document: doc, start: [1, 8], end: [1, 9] },
  });
  assert.deepEqual(diagnostic.source_span, {
    document: doc,
    start: [4, 8],
    end: [4, 9],
  });
  assert.deepEqual(
    result.events,
    [],
    "neither body ran — asserted on the whole event stream, since filtering an empty one never calls its predicate",
  );
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

test("a statement-position procedure call with an unsupported argument (e.g. an unknown callee) is left un-evaluated, not thrown", () => {
  // A statement-position user-procedure call gates its own arguments, unlike an expression-position
  // one — so this is the path that has to reach the unresolvable callee and raise, rather than skip
  // the whole call. `runUnchecked` is the spec's opt-out (`spec/execution-model.md:687-694`) and is
  // what still exercises it: the check reports the same fault first, the run proceeds anyway, and
  // the two identical reports collapse to one (`spec/execution-model.md:741-748`).
  const result = execute(
    'define p :x\n  print "ran"\nend\np (nonexistent_builtin 1)',
    doc,
    { runUnchecked: true },
  );
  assert.deepEqual(
    result.diagnostics.map((diagnostic) => diagnostic.code),
    ["ol-unknown-command"],
  );
  assert.deepEqual(
    result.events.filter((event) => event.kind === "print"),
    [],
    "the procedure body never ran, so nothing was printed",
  );
});

test("a parenthesized statement-position procedure call with an unsupported argument is also left un-evaluated", () => {
  const result = execute(
    'define p :x :y\n  print "ran"\nend\n(p (nonexistent_builtin 1) 2)',
    doc,
    { runUnchecked: true },
  );
  // Issue #815: the unresolvable callee is now REPORTED, not silently skipped. It is reported by
  // the check before execution (`spec/execution-model.md:659-664`); `runUnchecked` — the spec's own
  // opt-out — makes the program run anyway, so the evaluator ALSO reaches the callee and raises,
  // and the two identical reports collapse to one (`spec/execution-model.md:741-748`). The effect
  // below still never happens, but now for a reason the learner is told.
  assert.deepEqual(
    result.diagnostics.map((diagnostic) => diagnostic.code),
    ["ol-unknown-command"],
  );
  const printed = result.events.filter((event) => event.kind === "print");
  assert.deepEqual(printed, []);
});

test("a procedure parameter binding folds case: a differently-cased :read in the body sees the argument (spec/grammar.md:13)", () => {
  const result = execute("define echo :X\n  return :x\nend\nprint echo 5", doc);
  assert.deepEqual(result.diagnostics, []);
  const printed = result.events
    .filter((event) => event.kind === "print")
    .map((event) => event.payload.values[0]);
  assert.deepEqual(printed, [5]);
});
