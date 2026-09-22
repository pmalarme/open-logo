// Runtime tests for how the `list` constructor treats an argument that fails to evaluate
// (issue #1213).
//
// The conformance fixtures under tests/conformance/data/list-constructor/ cover the positive
// shapes — the bare empty `list`, the variadic `(list a b …)`, fresh instances, no flattening,
// structural equality. None of them hands the constructor an argument that *fails*, so its
// error-propagation path had no test at all.
//
// Two things are pinned here, and they are separate claims. First, the diagnostic a failing
// argument raises is handed back **unwrapped** — same code, same params, same span as the
// argument's own — and no list reaches `print`. Second, evaluation stops **at** that argument:
// proven observably, with a reporter that prints, rather than asserted by a test name. An
// argument like `reverse 5` fails without leaving a trace, so it can show which diagnostic wins
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

test("(list …) hands back a failing first argument's diagnostic unwrapped, and prints nothing", () => {
  const result = execute("print (list :missing 2)", doc);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-undefined-var");
  assert.deepEqual(result.diagnostics[0].params, { name: "missing" });
  // The span is `:missing`'s own, which is what shows the diagnostic was propagated rather than
  // re-raised against the enclosing `(list …)` call.
  assert.deepEqual(result.diagnostics[0].source_span, {
    document: doc,
    start: [1, 13],
    end: [1, 21],
  });
  assert.deepEqual(printedValues(result), []);
});

test("(list …) hands back a failing later argument's diagnostic unwrapped too, not only the first's", () => {
  const result = execute("print (list 1 2 :missing)", doc);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-undefined-var");
  assert.deepEqual(result.diagnostics[0].params, { name: "missing" });
  assert.deepEqual(result.diagnostics[0].source_span, {
    document: doc,
    start: [1, 17],
    end: [1, 25],
  });
  assert.deepEqual(printedValues(result), []);
});

test("(list …) propagates a failure of a different kind identically, with no ol-undefined-var special case", () => {
  const result = execute("print (list 1 (reverse 5))", doc);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-type");
  assert.deepEqual(result.diagnostics[0].params, {
    expected: "list",
    actual: "number",
    value: 5,
    operation: "reverse",
  });
  assert.deepEqual(result.diagnostics[0].source_span, {
    document: doc,
    start: [1, 24],
    end: [1, 25],
  });
  assert.deepEqual(printedValues(result), []);
});

test("(list …) does not evaluate arguments after the one that failed", () => {
  // `noisy` would print if it ran. It is the argument *after* the failing one, and nothing is
  // printed, so evaluation stopped at `:missing` instead of continuing through the argument list.
  const result = execute(`${noisyReporter}print (list :missing (noisy))`, doc);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-undefined-var");
  assert.deepEqual(printedValues(result), []);
});

test("(list …) does evaluate arguments before the one that failed, so it works left to right", () => {
  // The mirror of the previous test, and the half that makes it meaningful: with `noisy` moved
  // *before* the failing argument its print does appear, so the empty stream above is a stop at
  // the failure and not a constructor that never evaluates anything.
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
