// Runtime tests for how the `list` constructor treats an argument that fails to evaluate
// (issue #1213).
//
// The conformance fixtures under tests/conformance/data/list-constructor/ cover the positive
// shapes — the bare empty `list`, the variadic `(list a b …)`, fresh instances, no flattening,
// structural equality. None of them hands the constructor an argument that *fails*, so its
// error-propagation path had no test at all.
//
// Two things are pinned here, and they are separate claims with different footing in the spec.
//
// First, the diagnostic a failing argument raises is passed back as the argument's own: same
// code, same params, same span, and no list reaches `print`. These tests compare every field
// `spec/error-model.md#diagnostic-shape` requires — five by value, and `message` by presence
// only, because that section defines it as "Localizable learner-facing prose generated from
// `code` and `params`" and adds that "tools MUST NOT parse English messages to understand a
// diagnostic". Asserting its English would be that forbidden coupling; asserting nothing at all
// would let the field vanish unnoticed.
//
// Second, evaluation stops **at** the failing argument. That is normative:
// `spec/error-model.md#severity` says of `severity: error` that "execution cannot continue
// normally at the offending construct", and these diagnostics carry `severity: "error"` and
// `stage: "runtime"` — both asserted below, so the tests establish the precondition the rule
// keys on. (`spec/commands.md#throw` corroborates it from the other direction, describing a
// thrown error as one that "stops the program like any other runtime error", but it presupposes
// the general rule rather than stating it, so `#severity` is the authority here.)
//
// What the spec does **not** fix anywhere is the evaluation order of an ordinary argument list:
// it is silent, rather than explicitly leaving it unspecified. So the two order tests below
// deliberately pin current runtime behaviour rather than a language requirement, and should not
// be read as making one. They are asserted observably, with a reporter that prints, because an
// argument like `reverse 5` fails without leaving a trace — it can show which diagnostic wins,
// but never whether the other argument ran.
//
// Spec: `spec/data-structures.md#mutating-list-operations` gives `(list a b …)` its signature —
// "returns a new mutable list containing the values".

import assert from "node:assert/strict";
import { test } from "node:test";
import { execute } from "@openlogo/runtime";

const doc = "acceptance.logo";

// A zero-argument reporter whose call is observable in the event stream: if `noisy` is evaluated
// it prints, so an absent print is evidence that an argument was never reached. Four lines, so
// spans in programs using it start at line 5.
const noisyReporter = 'define noisy\n  print "evaluated"\n  return 1\nend\n';

function printedValues(result) {
  return result.events
    .filter((event) => event.kind === "print")
    .map((event) => event.payload.values);
}

// Asserts every field `spec/error-model.md#diagnostic-shape` requires: code, params and span
// identify the diagnostic; `stage` and `severity` are checked so a reconstructed diagnostic that
// changed either would not pass for a propagated one; and `message` is checked for presence
// only, never for its text, since the spec makes it localizable prose.
function assertRuntimeError(diagnostic, expected) {
  assert.equal(diagnostic.code, expected.code);
  assert.deepEqual(diagnostic.params, expected.params);
  assert.deepEqual(diagnostic.source_span, expected.source_span);
  assert.equal(diagnostic.stage, "runtime");
  assert.equal(diagnostic.severity, "error");
  assert.equal(typeof diagnostic.message, "string");
  assert.ok(diagnostic.message.length > 0);
}

test("(list …) passes back a failing first argument's own diagnostic, and prints nothing", () => {
  const result = execute("print (list :missing 2)", doc);
  assert.equal(result.diagnostics.length, 1);
  assertRuntimeError(result.diagnostics[0], {
    code: "ol-undefined-var",
    params: { name: "missing" },
    // The span is `:missing`'s own, which is what shows the diagnostic was passed back rather
    // than re-raised against the enclosing `(list …)` call.
    source_span: { document: doc, start: [1, 13], end: [1, 21] },
  });
  assert.deepEqual(printedValues(result), []);
});

test("(list …) passes back a failing later argument's own diagnostic too, not only the first's", () => {
  const result = execute("print (list 1 2 :missing)", doc);
  assert.equal(result.diagnostics.length, 1);
  assertRuntimeError(result.diagnostics[0], {
    code: "ol-undefined-var",
    params: { name: "missing" },
    source_span: { document: doc, start: [1, 17], end: [1, 25] },
  });
  assert.deepEqual(printedValues(result), []);
});

test("(list …) propagates a failure of a different kind identically, with no ol-undefined-var special case", () => {
  const result = execute("print (list 1 (reverse 5))", doc);
  assert.equal(result.diagnostics.length, 1);
  assertRuntimeError(result.diagnostics[0], {
    code: "ol-type",
    params: {
      expected: "list",
      actual: "number",
      value: 5,
      operation: "reverse",
    },
    source_span: { document: doc, start: [1, 24], end: [1, 25] },
  });
  assert.deepEqual(printedValues(result), []);
});

test("(list …) does not evaluate arguments after the one that failed", () => {
  // `noisy` would print if it ran. It is the argument *after* the failing one, and nothing is
  // printed: the runtime error stopped the program at `:missing` rather than continuing through
  // the argument list. The stop is the normative part; which argument is reached first is not.
  const result = execute(`${noisyReporter}print (list :missing (noisy))`, doc);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-undefined-var");
  assert.deepEqual(printedValues(result), []);
});

test("(list …) evaluates arguments before the one that failed, so the stop is at the failure", () => {
  // The mirror of the previous test, and the half that makes it meaningful: with `noisy` moved
  // *before* the failing argument its print does appear, so the empty stream above is a program
  // that stopped at the failure, not a constructor that never evaluates anything.
  const result = execute(`${noisyReporter}print (list (noisy) :missing)`, doc);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-undefined-var");
  assert.deepEqual(result.diagnostics[0].source_span, {
    document: doc,
    start: [5, 21],
    end: [5, 29],
  });
  assert.deepEqual(printedValues(result), [["evaluated"]]);
});

test("(list …) builds the list when every argument evaluates cleanly", () => {
  // The control for all five failure tests: without it they could pass on a constructor that
  // refused every argument. `noisy` prints, then the built list prints.
  const result = execute(`${noisyReporter}print (list 1 (noisy))`, doc);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(printedValues(result), [["evaluated"], [[1, 1]]]);
});
