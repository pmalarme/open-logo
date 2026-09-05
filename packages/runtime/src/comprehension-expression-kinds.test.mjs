// The RUNTIME's expression classification must agree with the checker's — and it is the only one
// left when no checker runs.
//
// `execute({ runUnchecked: true })` and a bare `createEnvironment()` both reach the comprehension
// body evaluator with nothing in front of them, so `asExpressionStatement` and
// `isValueProducingStatement` decide alone. Issue #815's round-11 review found them enumerated and
// four kinds short: a leading `[10][1]` halted with `ol-not-implemented` naming a form this
// evaluator runs perfectly well, and a final `{a: 1}` or `[] is empty` reported `ol-no-value` for a
// statement that plainly produces one. Both are the WRONG diagnostic rather than a missing one,
// which is the failure a slice about honest diagnosis can least afford.
//
// Both halves now read `isExpressionKind`, which is exhaustiveness-checked against the
// `ExpressionNode` union itself. These tests pin the agreement across the seam: the same programs
// are asserted here unchecked and in `packages/parser/src/expression-kinds-derived.test.mjs`
// checked, so the two packages cannot drift apart silently.

import assert from "node:assert/strict";
import test from "node:test";

import { execute } from "@openlogo/runtime";

const PROFILES = ["core-language", "turtle-rendering", "data"];

/** Run `source` with the check gate switched OFF, so the runtime classifiers answer alone. */
function runUnchecked(source) {
  const result = execute(source, "d.logo", {
    profiles: PROFILES,
    runUnchecked: true,
  });
  return {
    codes: result.diagnostics.map((d) => d.code),
    printed: result.events
      .filter((event) => event.kind === "print")
      .map((event) => event.payload.values),
  };
}

test("a value-producing expression in final position is the body's result", () => {
  for (const source of [
    "print map i in [1] [ [10 20][1] ]",
    "print map i in [1] [ [] is empty ]",
    "print map i in [1] [ {a: :i} ]",
    "print map i in [1] [ 1 < 2 < 3 ]",
  ]) {
    const { codes, printed } = runUnchecked(source);
    assert.deepEqual(codes, [], `${source} must run without a diagnostic`);
    assert.equal(printed.length, 1, `${source} must print its list`);
  }
});

test("a value-producing expression in leading position runs for effect, not ol-not-implemented", () => {
  const { codes, printed } = runUnchecked(
    "print map i in [1] [ [10 20][1] :i ]",
  );
  assert.deepEqual(
    codes,
    [],
    "a postfix index is an expression this evaluator runs; naming it in ol-not-implemented blamed the learner for nothing",
  );
  assert.deepEqual(printed, [[[1]]]);
});

test("a statement-only form in a comprehension body still halts with ol-not-implemented", () => {
  // The widening must not swallow the terminal rule: `if` genuinely has no branch in this narrow
  // body evaluator, so it is reported rather than skipped.
  const { codes } = runUnchecked("print map i in [1] [ if true [ ] :i ]");
  assert.deepEqual(codes, ["ol-not-implemented"]);
});

test("a body ending in a built-in command still reports ol-no-value", () => {
  const { codes } = runUnchecked("print map i in [1] [ forward 1 ]");
  assert.deepEqual(
    codes,
    ["ol-no-value"],
    "widening what counts as an expression must not turn ol-no-value off",
  );
});

test("the unchecked runtime and the checker agree on every sampled body", () => {
  // The seam this pins: before the fix the two packages disagreed on four kinds, and nothing
  // compared them. A program the checker admits must be one the runtime runs, and vice versa.
  const clean = [
    "print map i in [1] [ [10 20][1] ]",
    "print map i in [1] [ [] is empty ]",
    "print map i in [1] [ {a: :i} ]",
    "print map i in [1] [ :i ]",
  ];
  for (const source of clean) {
    assert.deepEqual(runUnchecked(source).codes, []);
    assert.deepEqual(
      execute(source, "d.logo", { profiles: PROFILES }).diagnostics,
      [],
      `${source} must behave the same with the check gate on`,
    );
  }
});
