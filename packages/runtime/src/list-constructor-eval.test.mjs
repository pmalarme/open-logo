// Unit tests for how the `list` constructor evaluates its arguments when one of them fails
// (issue #1213).
//
// The conformance fixtures under tests/conformance/data/list-constructor/ cover the positive
// shapes — the bare empty `list`, the variadic `(list a b …)`, fresh instances, no flattening,
// structural equality. None of them gives the constructor an argument that *fails* to evaluate,
// so its error-propagation branch was executed zero times by the whole suite. That was measured,
// not inferred: a file-append probe placed on the branch recorded no hits across a full 5,072-test
// run, and single-process coverage of the one test that drives the constructor hardest
// (snapshot-value.test.mjs, 20,000 nested wraps) reported those two lines uncovered. The
// whole-suite coverage report nevertheless showed the file at 100%, so the gap was invisible.
//
// Spec: `spec/data-structures.md#mutating-list-operations` gives `(list a b …)` its signature, and
// `spec/execution-model.md#precedence-and-evaluation-order` gives the left-to-right evaluation
// order that the first-failure-wins tests below pin down.

import assert from "node:assert/strict";
import { test } from "node:test";
import { execute } from "@openlogo/runtime";

const doc = "acceptance.logo";

function printEvents(result) {
  return result.events.filter((event) => event.kind === "print");
}

test("(list …) propagates a failing first argument's diagnostic and builds no list", () => {
  const result = execute("print (list :missing 2)", doc);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-undefined-var");
  assert.deepEqual(result.diagnostics[0].params, { name: "missing" });
  // The span is the argument's own, so the diagnostic is handed back unwrapped rather than
  // re-reported against the enclosing `(list …)` call.
  assert.deepEqual(result.diagnostics[0].source_span, {
    document: doc,
    start: [1, 13],
    end: [1, 21],
  });
  assert.deepEqual(printEvents(result), []);
});

test("(list …) propagates a failure from a later argument, not only from the first", () => {
  const result = execute("print (list 1 2 :missing)", doc);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-undefined-var");
  assert.deepEqual(result.diagnostics[0].source_span, {
    document: doc,
    start: [1, 17],
    end: [1, 25],
  });
  assert.deepEqual(printEvents(result), []);
});

test("(list …) stops at the first failing argument and never reaches a later failing one", () => {
  // `reverse 5` raises ol-type on its own, so reporting ol-undefined-var here is what shows the
  // constructor returned at `:missing` instead of evaluating the rest of its arguments.
  const result = execute("print (list :missing (reverse 5))", doc);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-undefined-var");
  assert.deepEqual(printEvents(result), []);
});

test("(list …) reports whichever argument fails first, independently of the kind of failure", () => {
  // The mirror of the previous case: the ol-type failure now comes first and wins, which rules
  // out a constructor that simply prefers one diagnostic code over another.
  const result = execute("print (list 1 (reverse 5) :missing)", doc);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-type");
  assert.deepEqual(result.diagnostics[0].params, {
    expected: "list",
    actual: "number",
    value: 5,
    operation: "reverse",
  });
  assert.deepEqual(printEvents(result), []);
});

test("(list …) still builds the list when every argument evaluates cleanly", () => {
  // The control for the four failure tests above: without it they could all pass vacuously on a
  // constructor that refused every argument.
  const result = execute("print (list 1 2)", doc);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(
    printEvents(result).map((event) => event.payload.values),
    [[[1, 2]]],
  );
});
