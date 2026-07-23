// Unit tests for `for ... in`/`for ... from ... to ... by` loop mechanics and binder scoping
// (issue #103, spec/execution-model.md:365-378,435-439,688-704). Conformance fixtures under
// tests/conformance/core-language/execution/for-*.expected.json cover the event/diagnostic shape
// end to end for the Given/When/Then scenarios; these unit tests fill in what a fixture cannot:
// runtime-only edge cases (loop-variable scoping ending at runtime, nested repeat/for repcount
// interaction, empty-iterable zero-pass runs, and the "unsupported expression" skip branches that
// this issue's evaluator does not yet give meaning to — mirroring the same pattern
// `repeat-forever-repcount.test.mjs` uses for `Repeat`'s own skip branch).

import assert from "node:assert/strict";
import { test } from "node:test";
import { execute } from "@openlogo/runtime";

const doc = "acceptance.logo";

test("for ... in binds the bare-name binder body-local: it does not leak past the loop", () => {
  const result = execute("for n in [1 2 3] [\n  print :n\n]\nprint :n", doc);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-undefined-var");
  // The loop itself ran to completion first: three prints from inside the body.
  const printedInsideLoop = result.events
    .filter((event) => event.kind === "print")
    .map((event) => event.payload.values[0]);
  assert.deepEqual(printedInsideLoop, [1, 2, 3]);
});

test("for ... from ... to binds the range variable body-local: it does not leak past the loop", () => {
  const result = execute("for i from 1 to 3 [\n  print :i\n]\nprint :i", doc);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-undefined-var");
  const printedInsideLoop = result.events
    .filter((event) => event.kind === "print")
    .map((event) => event.payload.values[0]);
  assert.deepEqual(printedInsideLoop, [1, 2, 3]);
});

test("for ... in binder shadows an outer variable of the same name only for the body", () => {
  const result = execute(
    ":n = 100\nfor n in [1 2] [\n  print :n\n]\nprint :n",
    doc,
  );
  assert.deepEqual(result.diagnostics, []);
  const printedValues = result.events
    .filter((event) => event.kind === "print")
    .map((event) => event.payload.values[0]);
  // Inside the loop the binder shadows the outer `:n` (1, then 2); once the loop ends, the
  // outer `:n = 100` is unaffected — the loop's own binding never mutated it.
  assert.deepEqual(printedValues, [1, 2, 100]);
});

test("a `repeat` nested inside a `for ... in` still resolves `repcount` to its own inner turn", () => {
  const result = execute(
    "for n in [1 2] [\n  repeat 2 [\n    print repcount\n  ]\n]",
    doc,
  );
  assert.deepEqual(result.diagnostics, []);
  const printedValues = result.events
    .filter((event) => event.kind === "print")
    .map((event) => event.payload.values[0]);
  assert.deepEqual(printedValues, [1, 2, 1, 2]);
});

test("a `for ... in` nested inside a `repeat` still lets the outer `repcount` resolve correctly", () => {
  const result = execute(
    "repeat 2 [\n  for n in [1] [\n    print repcount\n  ]\n]",
    doc,
  );
  assert.deepEqual(result.diagnostics, []);
  const printedValues = result.events
    .filter((event) => event.kind === "print")
    .map((event) => event.payload.values[0]);
  assert.deepEqual(printedValues, [1, 2]);
});

test("for ... in over an empty list runs its body zero times, no diagnostic", () => {
  const result = execute("for n in [] [\n  print :n\n]", doc);
  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].payload.statement_kind, "ForIn");
});

test("for ... from ... to where from already exceeds to (default step 1) runs zero times", () => {
  const result = execute("for i from 5 to 1 [\n  print :i\n]", doc);
  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].payload.statement_kind, "ForRange");
});

test("destructuring a non-list element raises ol-range with length 0 (never matches a non-empty pattern)", () => {
  const result = execute("for [:x :y] in [1] [\n  print :x\n]", doc);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-range");
  assert.deepEqual(result.diagnostics[0].params, {
    operation: "destructuring",
    value: 0,
    length: 2,
  });
});

test("for ... in whose iterable is an expression kind this evaluator does not give meaning to is skipped, not raised", () => {
  // `(nonexistent_builtin 1)` is a call to a name this evaluator does not know; the whole `ForIn`
  // statement is skipped rather than raising, matching the existing "unsupported operand"
  // convention for `print`/`Assign`/`Repeat`.
  const result = execute(
    "for n in (nonexistent_builtin 1) [\n  print 1\n]",
    doc,
  );
  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].payload.statement_kind, "ForIn");
});

test("for ... from whose `from` is an unsupported expression is skipped, not raised", () => {
  const result = execute(
    "for i from (nonexistent_builtin 1) to 5 [\n  print 1\n]",
    doc,
  );
  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].payload.statement_kind, "ForRange");
});

test("for ... to whose `to` is an unsupported expression is skipped, not raised", () => {
  const result = execute(
    "for i from 1 to (nonexistent_builtin 1) [\n  print 1\n]",
    doc,
  );
  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].payload.statement_kind, "ForRange");
});

test("for ... by whose step is an unsupported expression is skipped, not raised", () => {
  const result = execute(
    "for i from 1 to 5 by (nonexistent_builtin 1) [\n  print 1\n]",
    doc,
  );
  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].payload.statement_kind, "ForRange");
});

test("for ... from a non-number raises ol-type", () => {
  const result = execute('for i from "x" to 5 [\n  print 1\n]', doc);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-type");
});

test("for ... to a non-number raises ol-type", () => {
  const result = execute('for i from 1 to "x" [\n  print 1\n]', doc);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-type");
});

test("for ... by a non-number raises ol-type", () => {
  const result = execute('for i from 1 to 5 by "x" [\n  print 1\n]', doc);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-type");
});

test("for ... from whose expression itself fails to evaluate (not merely wrong type) halts with that diagnostic", () => {
  const result = execute("for i from 1 / 0 to 5 [\n  print 1\n]", doc);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-div-zero");
});

test("for ... to whose expression itself fails to evaluate halts with that diagnostic", () => {
  const result = execute("for i from 1 to 1 / 0 [\n  print 1\n]", doc);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-div-zero");
});

test("for ... by whose expression itself fails to evaluate halts with that diagnostic", () => {
  const result = execute("for i from 1 to 5 by 1 / 0 [\n  print 1\n]", doc);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-div-zero");
});

test("a diagnostic raised inside a for ... from ... to body halts the loop and propagates up", () => {
  const result = execute("for i from 1 to 3 [\n  print 1 / 0\n]", doc);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-div-zero");
  // The loop stopped after its first pass raised — no `print` event for turns 2 or 3.
  assert.equal(
    result.events.filter((event) => event.kind === "print").length,
    0,
  );
});

test("a single-name destructuring pattern length mismatch uses the singular 'value' wording", () => {
  const result = execute("for [:x] in [[1 2]] [\n  print :x\n]", doc);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-range");
  assert.deepEqual(result.diagnostics[0].params, {
    operation: "destructuring",
    value: 2,
    length: 1,
  });
});

test("for ... from ... to accepts a fractional step (not restricted to whole numbers, unlike repeat)", () => {
  const result = execute("for i from 1 to 2 by 0.5 [\n  print :i\n]", doc);
  assert.deepEqual(result.diagnostics, []);
  const printedValues = result.events
    .filter((event) => event.kind === "print")
    .map((event) => event.payload.values[0]);
  assert.deepEqual(printedValues, [1, 1.5, 2]);
});

test("a fractional step whose running total would drift past a floating-point-inexact end (0.1 * 3 !== 0.3) still reaches the inclusive endpoint", () => {
  const result = execute("for i from 0 to 0.3 by 0.1 [\n  print :i\n]", doc);
  assert.deepEqual(result.diagnostics, []);
  const printedValues = result.events
    .filter((event) => event.kind === "print")
    .map((event) => event.payload.values[0]);
  assert.equal(printedValues.length, 4);
  // The reported value is `from + turn * step`, so the fourth turn is the same
  // floating-point-inexact `0.30000000000000004` a naive running total would also produce —
  // this test asserts the LOOP still runs that fourth turn (the endpoint is not dropped), not
  // that the printed number is the exact decimal `0.3`.
  assert.ok(Math.abs(printedValues[3] - 0.3) < 1e-9);
});

test("the boundary tolerance does not admit a pass genuinely beyond a fractional end", () => {
  // `to` is a hair short of `1` — the boundary tolerance (scaled to `current`/`to`'s own ULPs)
  // must not be so generous that it treats a whole step past `to` as still in range: only the
  // `0` pass should run, never `1`.
  const result = execute(
    "for i from 0 to 0.9999999995 by 1 [\n  print :i\n]",
    doc,
  );
  assert.deepEqual(result.diagnostics, []);
  const printedValues = result.events
    .filter((event) => event.kind === "print")
    .map((event) => event.payload.values[0]);
  assert.deepEqual(printedValues, [0]);
});

test("for ... in folds the bare-name binder: a differently-cased :read sees the binding (spec/grammar.md:13)", () => {
  const result = execute("for N in [1 2 3] [\n  print :n\n]", doc);
  assert.deepEqual(result.diagnostics, []);
  const printed = result.events
    .filter((event) => event.kind === "print")
    .map((event) => event.payload.values[0]);
  assert.deepEqual(printed, [1, 2, 3]);
});

test("for ... from ... to folds the range binder: a differently-cased :read sees the binding (spec/grammar.md:13)", () => {
  const result = execute("for I from 1 to 3 [\n  print :i\n]", doc);
  assert.deepEqual(result.diagnostics, []);
  const printed = result.events
    .filter((event) => event.kind === "print")
    .map((event) => event.payload.values[0]);
  assert.deepEqual(printed, [1, 2, 3]);
});

test("for ... in folds destructuring binders: differently-cased reads see each binding (spec/grammar.md:13)", () => {
  const result = execute(
    "for [:A :B] in [[1 2]] [\n  print :a\n  print :b\n]",
    doc,
  );
  assert.deepEqual(result.diagnostics, []);
  const printed = result.events
    .filter((event) => event.kind === "print")
    .map((event) => event.payload.values[0]);
  assert.deepEqual(printed, [1, 2]);
});
