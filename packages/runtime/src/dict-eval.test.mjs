// Unit tests for the dict-value reporters (issue #322, spec/data-structures.md:150,236-237): the
// `dict` empty-constructor reporter, `keys`/`values`, and the dict half of the `is empty`/`empty?`
// and `is member of`/`member?` predicates (list halves are covered by is-predicate-eval.test.mjs).
// Conformance fixtures under tests/conformance/data/dict-runtime/ cover the primary literal-
// observable end-to-end shapes; these unit tests fill in every dynamically-reachable diagnostic
// path exercised directly (arity, propagated operand-evaluation failures, and non-dict type
// errors) that a fixture cannot reach in isolation.

import assert from "node:assert/strict";
import { test } from "node:test";
import { execute } from "@openlogo/runtime";

const doc = "acceptance.logo";

function printedValues(result) {
  return result.events
    .filter((event) => event.kind === "print")
    .map((event) => event.payload.values[0]);
}

// --- `dict` (empty-constructor reporter) -----------------------------------------------------

test("`dict` reports a fresh, empty dict", () => {
  const result = execute("print dict", doc);
  assert.deepEqual(result.diagnostics, []);
  const [value] = printedValues(result);
  assert.equal(value.keys().length, 0);
});

test("`dict` yields a fresh, independent instance on every call", () => {
  const result = execute(
    ":a = dict\n:b = dict\n:a.x = 1\nprint :a\nprint :b",
    doc,
  );
  assert.deepEqual(result.diagnostics, []);
  const [a, b] = printedValues(result);
  assert.deepEqual(a.keys(), ["x"]);
  assert.deepEqual(b.keys(), []);
});

test("`(dict 1)` with an argument raises ol-too-many-inputs", () => {
  const result = execute("print (dict 1)", doc);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-too-many-inputs");
  assert.equal(result.diagnostics[0].params.callable, "dict");
});

// --- `keys` -----------------------------------------------------------------------------------

test("`keys` reports a fresh list of a dict's keys, in insertion order", () => {
  const result = execute(":x = { b: 2 a: 1 }\nprint keys :x", doc);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(printedValues(result), [["b", "a"]]);
});

test("`(keys)` with no arguments raises ol-not-enough-inputs", () => {
  const result = execute("print (keys)", doc);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-not-enough-inputs");
  assert.equal(result.diagnostics[0].params.callable, "keys");
});

test("`keys` on a non-dict argument raises ol-type", () => {
  const result = execute("print keys 5", doc);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-type");
  assert.deepEqual(result.diagnostics[0].params, {
    expected: "dict",
    actual: "number",
    value: 5,
    operation: "keys",
  });
});

test("`keys` propagates a failing argument expression's diagnostic", () => {
  const result = execute("print keys (1 / 0)", doc);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-div-zero");
});

// --- `values` ---------------------------------------------------------------------------------

test("`values` reports a fresh list of a dict's values, in the same order as `keys`", () => {
  const result = execute(":x = { b: 2 a: 1 }\nprint values :x", doc);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(printedValues(result), [[2, 1]]);
});

test("`(values)` with no arguments raises ol-not-enough-inputs", () => {
  const result = execute("print (values)", doc);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-not-enough-inputs");
  assert.equal(result.diagnostics[0].params.callable, "values");
});

test("`values` on a non-dict argument raises ol-type", () => {
  const result = execute("print values 5", doc);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-type");
  assert.deepEqual(result.diagnostics[0].params, {
    expected: "dict",
    actual: "number",
    value: 5,
    operation: "values",
  });
});

test("`values` propagates a failing argument expression's diagnostic", () => {
  const result = execute("print values (1 / 0)", doc);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-div-zero");
});

// --- `is empty` / `empty?` on a dict --------------------------------------------------------

test("`is empty` is true for an empty dict", () => {
  const result = execute("print dict is empty", doc);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(printedValues(result), [true]);
});

test("`empty?` prefix form is false for a non-empty dict", () => {
  const result = execute("print empty? { a: 1 }", doc);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(printedValues(result), [false]);
});

// --- `is member of` / `member?` on a dict (key membership, not value search) ------------------

test("`is member of` is true when the dict has a matching key", () => {
  const result = execute('print ("a" is member of { a: 1 })', doc);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(printedValues(result), [true]);
});

test("`is member of` is false when the dict has no matching key (a matching value does not count)", () => {
  const result = execute("print (1 is member of { a: 1 })", doc);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(printedValues(result), [false]);
});

test("`member?` prefix form checks dict key membership too", () => {
  const result = execute('print member? "a" { a: 1 }', doc);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(printedValues(result), [true]);
});
