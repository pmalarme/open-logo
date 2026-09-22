// Runtime tests for how the `list` constructor treats an argument that fails to evaluate
// (issue #1213).
//
// The conformance fixtures under tests/conformance/data/list-constructor/ cover the positive
// shapes — the bare empty `list`, the variadic `(list a b …)`, fresh instances, no flattening,
// structural equality. None of them hands the constructor an argument that *fails*, so its
// error-propagation path had no test at all.
//
// Three things are pinned here — two on the failure path, one on the clean path — and they have
// different footing in the spec.
//
// First, the diagnostic a failing argument raises is passed back as the argument's own: same
// code, same params, same span, and no list reaches `print`. These tests compare every field
// `spec/error-model.md#diagnostic-shape` requires — five by value, and `message` by presence and
// non-blankness only, never by its text. That section calls it "Localizable learner-facing prose
// generated from `code` and `params`", and `spec/error-model.md#localization-boundary` is
// directly on point for a test: "Tests and editor tools SHOULD assert codes and params, not
// English text." Pinning the English would couple this test to localizable presentation against
// that guidance. Asserting nothing at all is the opposite failure — the field could vanish
// entirely and no test would notice, which was true here until a mutation that deleted it went
// unkilled.
//
// Second, evaluation stops at the failing argument, the arguments after it never run, and when
// two arguments fail it is the earlier one that is reported. **None of that is a language
// requirement**, and the header says so because the tests cannot. The spec fixes the evaluation
// order of an ordinary argument list nowhere — the only left-to-right rules it states are for
// postfix chains, `and`/`or`, and `reduce`. Nor does `spec/error-model.md#severity` supply the
// rest: it says of `severity: error` that "execution cannot continue normally at the offending
// construct", and an implementation that evaluates every argument and *then* reports the
// earliest failure satisfies that sentence, yet the test below rejects it. So these tests
// deliberately pin current runtime behaviour, not a contract. They are asserted
// observably, with a reporter that prints, because an argument like `reverse 5` fails without
// leaving a trace — it can show which diagnostic wins, but never whether the other argument ran.
// What they observe is confined to the failing construct: none places an instruction after the
// failing one, so whole-program termination is not measured here either.
//
// Third, the clean path builds the list in argument order. The `(list a b …)` signature in
// `spec/data-structures.md#mutating-list-operations` — "returns a new mutable list containing
// the values" — names the values but not their order, so the control test's `[2 1]` likewise
// pins current behaviour.

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

// Asserts every field `spec/error-model.md#diagnostic-shape` requires. Per
// `spec/error-model.md#localization-boundary`, "Diagnostic identity is `code` plus `params`" —
// the span is not identity, it locates the offending expression — and `stage`/`severity` are
// checked so a reconstructed diagnostic that changed either would not pass for a propagated one.
// `message` is checked for presence and non-blankness, never for its text, since the spec makes
// it localizable prose. Trimmed rather than raw length, so a whitespace-only message fails too;
// both that and an emptied message are load-bearing, each defeating the weaker check it replaced.
function assertRuntimeError(diagnostic, expected) {
  assert.equal(diagnostic.code, expected.code);
  assert.deepEqual(diagnostic.params, expected.params);
  assert.deepEqual(diagnostic.source_span, expected.source_span);
  assert.equal(diagnostic.stage, "runtime");
  assert.equal(diagnostic.severity, "error");
  assert.equal(typeof diagnostic.message, "string");
  assert.ok(diagnostic.message.trim().length > 0);
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
  // printed, so the constructor returned from argument evaluation at `:missing` rather than
  // working through the rest of the list.
  const result = execute(`${noisyReporter}print (list :missing (noisy))`, doc);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-undefined-var");
  assert.deepEqual(result.diagnostics[0].source_span, {
    document: doc,
    start: [5, 13],
    end: [5, 21],
  });
  assert.deepEqual(printedValues(result), []);
});

test("(list …) evaluates arguments before the one that failed", () => {
  // The mirror of the previous test, and the half that makes it meaningful: with `noisy` moved
  // *before* the failing argument its print does appear, so the empty stream above is a return
  // at the failure, not a constructor that never evaluates anything.
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

test("(list …) reports the earlier failure when two arguments both fail", () => {
  // Nothing in the tests above pins *which* failure wins: an implementation that kept scanning
  // past the first failure and returned the last one would pass them all, because `:beta` — a
  // bare variable read — leaves no trace the way `noisy` does. `alpha`, not `beta`, is what
  // makes the earlier-wins behaviour observable.
  const result = execute("print (list :alpha :beta)", doc);
  assert.equal(result.diagnostics.length, 1);
  assertRuntimeError(result.diagnostics[0], {
    code: "ol-undefined-var",
    params: { name: "alpha" },
    source_span: { document: doc, start: [1, 13], end: [1, 19] },
  });
  assert.deepEqual(printedValues(result), []);
});

test("(list …) builds the list when every argument evaluates cleanly", () => {
  // The control for the failure tests: without it they could pass on a constructor that refused
  // every argument. `noisy` prints, then the built list prints. The two elements differ so the
  // assertion pins their order too — `[2 1]`, not a constructor that prepends.
  const result = execute(`${noisyReporter}print (list 2 (noisy))`, doc);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(printedValues(result), [["evaluated"], [[2, 1]]]);
});
