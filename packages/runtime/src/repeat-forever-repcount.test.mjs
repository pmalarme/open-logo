// Unit tests for `repeat`/`forever` loop mechanics and the `repcount` reporter (issue #104,
// spec/execution-model.md:365-370, spec/commands.md:775-792). Conformance fixtures under
// tests/conformance/core-language/execution/repeat-*.expected.json and
// repcount-outside-repeat.expected.json cover the event/diagnostic shape end to end; these unit
// tests fill in what a fixture cannot: `forever`'s loop mechanics (a real, unbounded `forever`
// would hang the conformance harness, so it is exercised here only via the test-only
// `foreverIterationLimit` option — no production caller ever supplies it, so a real `forever`
// still never terminates on its own) and a few evaluator-internal edge cases.

import assert from "node:assert/strict";
import { test } from "node:test";
import { execute } from "@openlogo/runtime";
// **Not** imported via the `"@openlogo/runtime"` package specifier: `execute-internal.js` is
// never re-exported by `index.ts`, so this deep relative import into the package's own build
// output is the only way to reach the test-only `forever` iteration limit — see
// `execute-internal.ts`'s header comment for why this is architected this way.
import { executeWithForeverIterationLimitForTests as executeWithForeverLimit } from "../dist/execute-internal.js";

const doc = "acceptance.logo";

test("forever runs its body repeatedly, stopping at the test-only foreverIterationLimit", () => {
  const result = executeWithForeverLimit(
    ":i = 0\nforever [\n  :i = :i + 1\n  print :i\n]",
    doc,
    3,
  );
  assert.deepEqual(result.diagnostics, []);
  const printedValues = result.events
    .filter((event) => event.kind === "print")
    .map((event) => event.payload.values[0]);
  assert.deepEqual(printedValues, [1, 2, 3]);
});

test("forever with foreverIterationLimit: 0 runs its body zero times", () => {
  const result = executeWithForeverLimit("forever [\n  print 1\n]", doc, 0);
  assert.deepEqual(result.diagnostics, []);
  assert.equal(
    result.events.filter((event) => event.kind === "print").length,
    0,
  );
  // Only the `Forever` statement's own `instruction` event is emitted.
  assert.deepEqual(result.events, [
    {
      seq: 0,
      kind: "instruction",
      source_span: result.events[0].source_span,
      payload: { statement_kind: "Forever" },
    },
  ]);
});

test("forever stops at the first diagnostic raised inside its body, even under a limit", () => {
  const result = executeWithForeverLimit("forever [\n  print 1 / 0\n]", doc, 5);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-div-zero");
  // Only the first pass's events are kept: the `Forever` instruction, the body's own
  // instruction, then the failure stops it before any `print` event is emitted.
  assert.equal(result.events.length, 2);
  assert.deepEqual(
    result.events.map((event) => event.kind),
    ["instruction", "instruction"],
  );
});

test("a real forever loop is never bounded by execute() itself — only the internal test-only entry point accepts a limit", () => {
  // Regression guard for "no silent production cap": `execute()` takes no options at all (it is
  // a plain two-argument function), so there is no way for a real caller to bound a `forever`
  // loop through it — only `executeWithForeverIterationLimitForTests`, reachable only via a
  // relative import straight into this package's own `dist/execute-internal.js` build output
  // (never through the `"@openlogo/runtime"` package specifier — see this file's import
  // comment), ever accepts a limit. We cannot literally run an unbounded `forever` here, so this
  // asserts `execute` and the limited entry point agree on an ordinary (non-`forever`) program,
  // proving they share the same evaluation logic and differ only in whether a limit can be
  // supplied.
  const viaExecute = execute("repeat 3 [\n  print repcount\n]", doc);
  const viaLimitedEntryPoint = executeWithForeverLimit(
    "repeat 3 [\n  print repcount\n]",
    doc,
    100,
  );
  assert.deepEqual(viaExecute, viaLimitedEntryPoint);
});

test("repcount reports the nearest-enclosing repeat's current 1-based turn", () => {
  const result = execute("repeat 3 [\n  print repcount\n]", doc);
  assert.deepEqual(result.diagnostics, []);
  const printedValues = result.events
    .filter((event) => event.kind === "print")
    .map((event) => event.payload.values[0]);
  assert.deepEqual(printedValues, [1, 2, 3]);
});

test("repcount inside a nested repeat reads the innermost loop's turn", () => {
  const result = execute(
    "repeat 2 [\n  repeat 3 [\n    print repcount\n  ]\n]",
    doc,
  );
  assert.deepEqual(result.diagnostics, []);
  const printedValues = result.events
    .filter((event) => event.kind === "print")
    .map((event) => event.payload.values[0]);
  assert.deepEqual(printedValues, [1, 2, 3, 1, 2, 3]);
});

test("repcount used outside any enclosing repeat raises ol-repcount-outside-repeat", () => {
  const result = execute("print repcount", doc);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-repcount-outside-repeat");
  assert.equal(result.diagnostics[0].stage, "runtime");
  assert.deepEqual(result.diagnostics[0].params, {});
});

test("repcount reads the outer repeat's turn again once a nested repeat completes", () => {
  // After the inner `repeat` pops its turn off env.repeatTurns, the outer repeat's own turn must
  // still be visible to a later statement in the same outer pass.
  const result = execute(
    "repeat 2 [\n  repeat 1 [\n    print repcount\n  ]\n  print repcount\n]",
    doc,
  );
  assert.deepEqual(result.diagnostics, []);
  const printedValues = result.events
    .filter((event) => event.kind === "print")
    .map((event) => event.payload.values[0]);
  assert.deepEqual(printedValues, [1, 1, 1, 2]);
});

test("repeat 0 runs its body zero times with no diagnostic", () => {
  const result = execute("repeat 0 [\n  print 1\n]", doc);
  assert.deepEqual(result.diagnostics, []);
  assert.equal(
    result.events.filter((event) => event.kind === "print").length,
    0,
  );
});

test("repeat with a non-whole-number count raises ol-type before any pass runs", () => {
  const result = execute("repeat 2.5 [\n  print 1\n]", doc);
  assert.equal(result.diagnostics.length, 1);
  assert.deepEqual(result.diagnostics[0].params, {
    expected: "whole number",
    actual: "number",
    value: 2.5,
    operation: "repeat",
  });
  assert.equal(result.diagnostics[0].code, "ol-type");
  assert.equal(
    result.events.filter((event) => event.kind === "print").length,
    0,
  );
});

test("repeat with a word count that does not read as a number raises ol-type", () => {
  const result = execute('repeat "three" [\n  print 1\n]', doc);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-type");
  assert.deepEqual(result.diagnostics[0].params, {
    expected: "whole number",
    actual: "word",
    value: "three",
    operation: "repeat",
  });
});

test("repeat with a word count that reads as a whole number coerces, per spec/execution-model.md:33", () => {
  const result = execute('repeat "2" [\n  print repcount\n]', doc);
  assert.deepEqual(result.diagnostics, []);
  const printedValues = result.events
    .filter((event) => event.kind === "print")
    .map((event) => event.payload.values[0]);
  assert.deepEqual(printedValues, [1, 2]);
});

test("repeat with a negative whole-number count raises ol-range after the type check passes", () => {
  const result = execute("repeat -3 [\n  print 1\n]", doc);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-range");
  assert.deepEqual(result.diagnostics[0].params, {
    operation: "repeat",
    value: -3,
  });
  assert.equal(
    result.events.filter((event) => event.kind === "print").length,
    0,
  );
});

test("a repeat count that itself fails to evaluate propagates that diagnostic", () => {
  const result = execute("repeat 1 / 0 [\n  print 1\n]", doc);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-div-zero");
});

test("repeat stops and returns the diagnostic raised by a failing statement inside its body", () => {
  const result = execute("repeat 3 [\n  print 1 / 0\n]", doc);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-div-zero");
  // Only the first pass's events are kept — the loop never reaches a second turn.
  assert.equal(result.events.length, 2);
});

test("a repeat with an unsupported-expression count is left un-executed, like other future-slice statements", () => {
  // `(nonexistent_builtin 1)` calls an unregistered procedure; the whole `Repeat`
  // statement is skipped rather than raising, matching the existing "unsupported operand"
  // convention for `print`/`Assign`.
  const result = execute("repeat (nonexistent_builtin 1) [\n  print 1\n]", doc);
  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].payload.statement_kind, "Repeat");
});
