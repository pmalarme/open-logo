// Unit tests for the Data-profile derived list reporters' runtime evaluation (issue #190,
// spec/data-structures.md:125-141 — the derived-reporters table and its ordering rule).
// Conformance fixtures under tests/conformance/data/execution/ cover the primary
// literal-observable positive/negative cases end to end. These unit tests fill in what a fixture
// cannot: every dynamically-reachable diagnostic path exercised directly (not via
// conformance-fixture subprocess spillover, per the #172/#173 lesson), the operand evaluation-
// failure propagation branches, the fresh-list (non-mutating) guarantee for `reverse`/`sort`, and
// `pick`'s determinism under the shared seeded generator (`randomize`, the same one `random`
// uses).

import assert from "node:assert/strict";
import { test } from "node:test";
import { execute } from "@openlogo/runtime";

const doc = "acceptance.logo";

function printedValues(result) {
  return result.events
    .filter((event) => event.kind === "print")
    .map((event) => event.payload.values[0]);
}

// --- reverse --------------------------------------------------------------------------------

test("reverse returns a fresh list with elements in reverse order", () => {
  const result = execute("print reverse [3 1 2]", doc);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(printedValues(result), [[2, 1, 3]]);
});

test("reverse never mutates its list argument", () => {
  const result = execute(
    ":nums = [3 1 2]\n" +
      ":back = reverse :nums\n" +
      "print :back\n" +
      "print :nums",
    doc,
  );
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(printedValues(result), [
    [2, 1, 3],
    [3, 1, 2],
  ]);
});

test("reverse on an empty list returns a fresh empty list", () => {
  const result = execute("print reverse []", doc);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(printedValues(result), [[]]);
});

test("reverse on a single-element list returns an equivalent fresh list", () => {
  const result = execute("print reverse [1]", doc);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(printedValues(result), [[1]]);
});

test("reverse on a non-list argument raises ol-type naming 'list'", () => {
  const result = execute("print reverse 5", doc);
  assert.equal(result.diagnostics.length, 1);
  assert.deepEqual(result.diagnostics[0].code, "ol-type");
  assert.deepEqual(result.diagnostics[0].params, {
    expected: "list",
    actual: "number",
    value: 5,
    operation: "reverse",
  });
});

test("reverse on a word argument raises ol-type", () => {
  const result = execute('print reverse "hi"', doc);
  assert.equal(result.diagnostics.length, 1);
  assert.deepEqual(result.diagnostics[0].params, {
    expected: "list",
    actual: "word",
    value: "hi",
    operation: "reverse",
  });
});

test("reverse propagates an operand evaluation failure instead of evaluating", () => {
  const result = execute("print reverse :missing", doc);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-undefined-var");
});

test("(reverse) with no input raises ol-not-enough-inputs", () => {
  const result = execute("print (reverse)", doc);
  assert.equal(result.diagnostics.length, 1);
  assert.deepEqual(result.diagnostics[0].code, "ol-not-enough-inputs");
  assert.deepEqual(result.diagnostics[0].params, {
    callable: "reverse",
    expected: 1,
    actual: 0,
  });
});

// --- pick -------------------------------------------------------------------------------------

test("pick returns a member of the list, deterministically under a seeded generator", () => {
  const result = execute("(randomize 42)\nprint pick [10 20 30]", doc);
  assert.deepEqual(result.diagnostics, []);
  const [picked] = printedValues(result);
  assert.ok([10, 20, 30].includes(picked));
});

test("pick draws the same element again given the same seed", () => {
  const source = "(randomize 7)\nprint pick [1 2 3 4 5]";
  const first = printedValues(execute(source, doc));
  const second = printedValues(execute(source, doc));
  assert.deepEqual(first, second);
});

test("pick on a single-element list always returns that element", () => {
  const result = execute("print pick [42]", doc);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(printedValues(result), [42]);
});

test("pick on an empty list raises ol-range", () => {
  const result = execute("print pick []", doc);
  assert.equal(result.diagnostics.length, 1);
  assert.deepEqual(result.diagnostics[0].code, "ol-range");
  assert.deepEqual(result.diagnostics[0].params, {
    operation: "pick",
    value: [],
  });
});

test("pick on a non-list argument raises ol-type naming 'list'", () => {
  const result = execute("print pick 5", doc);
  assert.equal(result.diagnostics.length, 1);
  assert.deepEqual(result.diagnostics[0].code, "ol-type");
  assert.deepEqual(result.diagnostics[0].params, {
    expected: "list",
    actual: "number",
    value: 5,
    operation: "pick",
  });
});

test("pick propagates an operand evaluation failure instead of evaluating", () => {
  const result = execute("print pick :missing", doc);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-undefined-var");
});

test("(pick) with no input raises ol-not-enough-inputs", () => {
  const result = execute("print (pick)", doc);
  assert.equal(result.diagnostics.length, 1);
  assert.deepEqual(result.diagnostics[0].code, "ol-not-enough-inputs");
  assert.deepEqual(result.diagnostics[0].params, {
    callable: "pick",
    expected: 1,
    actual: 0,
  });
});

// --- sort -------------------------------------------------------------------------------------

test("sort returns a fresh list of numbers in ascending order", () => {
  const result = execute("print sort [3 1 2]", doc);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(printedValues(result), [[1, 2, 3]]);
});

test("sort keeps equal numbers in a stable ascending order", () => {
  const result = execute("print sort [2 1 2 1]", doc);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(printedValues(result), [[1, 1, 2, 2]]);
});

test("sort returns a fresh list of words in lexicographic order", () => {
  const result = execute('print sort ["pear" "apple"]', doc);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(printedValues(result), [["apple", "pear"]]);
});

test("sort never mutates its list argument", () => {
  const result = execute(
    ":nums = [3 1 2]\n" +
      ":back = sort :nums\n" +
      "print :back\n" +
      "print :nums",
    doc,
  );
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(printedValues(result), [
    [1, 2, 3],
    [3, 1, 2],
  ]);
});

test("sort on an empty list returns a fresh empty list with no orderability check", () => {
  const result = execute("print sort []", doc);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(printedValues(result), [[]]);
});

test("sort on a single-element list returns an equivalent fresh list", () => {
  const result = execute('print sort ["only"]', doc);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(printedValues(result), [["only"]]);
});

test("sort on a list mixing numbers and words raises ol-type before any partial sort", () => {
  const result = execute('print sort [1 "a"]', doc);
  assert.equal(result.diagnostics.length, 1);
  assert.deepEqual(result.diagnostics[0].code, "ol-type");
  assert.deepEqual(result.diagnostics[0].params, {
    expected: "number",
    actual: "word",
    value: "a",
    operation: "sort",
  });
});

test("sort on a list with a word first and a mismatched number names 'word' as expected", () => {
  const result = execute('print sort ["a" 1]', doc);
  assert.equal(result.diagnostics.length, 1);
  assert.deepEqual(result.diagnostics[0].params, {
    expected: "word",
    actual: "number",
    value: 1,
    operation: "sort",
  });
});

test("sort on a list of booleans raises ol-type naming 'number or word'", () => {
  const result = execute("print sort [true false]", doc);
  assert.equal(result.diagnostics.length, 1);
  assert.deepEqual(result.diagnostics[0].params, {
    expected: "number or word",
    actual: "boolean",
    value: true,
    operation: "sort",
  });
});

test("sort on a list whose first element is a nested list raises ol-type", () => {
  const result = execute("print sort [[1] 2]", doc);
  assert.equal(result.diagnostics.length, 1);
  assert.deepEqual(result.diagnostics[0].params, {
    expected: "number or word",
    actual: "list",
    value: [1],
    operation: "sort",
  });
});

test("sort rejects a mixed list even when the mismatch is buried deep in the list", () => {
  const result = execute('print sort [1 2 3 4 "oops"]', doc);
  assert.equal(result.diagnostics.length, 1);
  assert.deepEqual(result.diagnostics[0].code, "ol-type");
});

test("sort on a non-list argument raises ol-type naming 'list'", () => {
  const result = execute("print sort 5", doc);
  assert.equal(result.diagnostics.length, 1);
  assert.deepEqual(result.diagnostics[0].code, "ol-type");
  assert.deepEqual(result.diagnostics[0].params, {
    expected: "list",
    actual: "number",
    value: 5,
    operation: "sort",
  });
});

test("sort propagates an operand evaluation failure instead of evaluating", () => {
  const result = execute("print sort :missing", doc);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-undefined-var");
});

test("(sort) with no input raises ol-not-enough-inputs", () => {
  const result = execute("print (sort)", doc);
  assert.equal(result.diagnostics.length, 1);
  assert.deepEqual(result.diagnostics[0].code, "ol-not-enough-inputs");
  assert.deepEqual(result.diagnostics[0].params, {
    callable: "sort",
    expected: 1,
    actual: 0,
  });
});
