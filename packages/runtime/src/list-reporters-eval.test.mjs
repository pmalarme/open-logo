// Unit tests for the Core list reporters' runtime evaluation (issue #101, spec/commands.md
// "Words and lists", spec/execution-model.md:447-482). Conformance fixtures under
// tests/conformance/core-language/execution/list-reporter-*.expected.json cover the primary
// literal-observable positive/negative cases end to end. These unit tests fill in what a fixture
// cannot: every dynamically-reachable diagnostic path exercised directly (not via
// conformance-fixture subprocess spillover, per the #172/#173 lesson), the operand evaluation-
// failure propagation branches, and the fresh-list (non-mutating) guarantee for `fput`/`lput`/
// `sentence`.
//
// `reverse`/`pick`/`sort` are Data-profile derived reporters (spec/data-structures.md:125-129),
// not Core, so they are intentionally out of scope here — see the PR description.

import assert from "node:assert/strict";
import { test } from "node:test";
import { execute } from "@openlogo/runtime";

const doc = "acceptance.logo";

function printedValues(result) {
  return result.events
    .filter((event) => event.kind === "print")
    .map((event) => event.payload.values[0]);
}

// --- first / last --------------------------------------------------------------------------

test("first returns the first element of a list", () => {
  const result = execute("print first [1 2 3]", doc);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(printedValues(result), [1]);
});

test("last returns the last element of a list", () => {
  const result = execute("print last [1 2 3]", doc);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(printedValues(result), [3]);
});

test("first returns the first character of a word", () => {
  const result = execute('print first "hello"', doc);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(printedValues(result), ["h"]);
});

test("last returns the last character of a word", () => {
  const result = execute('print last "hello"', doc);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(printedValues(result), ["o"]);
});

test("first on an empty list raises ol-range", () => {
  const result = execute("print first []", doc);
  assert.equal(result.diagnostics.length, 1);
  assert.deepEqual(result.diagnostics[0].code, "ol-range");
  assert.deepEqual(result.diagnostics[0].params, {
    operation: "first",
    value: [],
  });
});

test("last on an empty word raises ol-range", () => {
  const result = execute('print last ""', doc);
  assert.equal(result.diagnostics.length, 1);
  assert.deepEqual(result.diagnostics[0].code, "ol-range");
  assert.deepEqual(result.diagnostics[0].params, {
    operation: "last",
    value: "",
  });
});

test("first on a number raises ol-type naming 'word or list'", () => {
  const result = execute("print first 5", doc);
  assert.equal(result.diagnostics.length, 1);
  assert.deepEqual(result.diagnostics[0].code, "ol-type");
  assert.deepEqual(result.diagnostics[0].params, {
    expected: "word or list",
    actual: "number",
    value: 5,
    operation: "first",
  });
});

test("last on a boolean raises ol-type", () => {
  const result = execute("print last true", doc);
  assert.equal(result.diagnostics.length, 1);
  assert.deepEqual(result.diagnostics[0].params, {
    expected: "word or list",
    actual: "boolean",
    value: true,
    operation: "last",
  });
});

test("first propagates an operand evaluation failure instead of evaluating", () => {
  const result = execute("print first :missing", doc);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-undefined-var");
});

// --- butfirst / butlast ----------------------------------------------------------------------

test("butfirst returns every element but the first, as a fresh list", () => {
  const result = execute("print butfirst [1 2 3]", doc);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(printedValues(result), [[2, 3]]);
});

test("butlast returns every element but the last, as a fresh list", () => {
  const result = execute("print butlast [1 2 3]", doc);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(printedValues(result), [[1, 2]]);
});

test("butfirst on a word returns the remaining characters as a word", () => {
  const result = execute('print butfirst "hello"', doc);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(printedValues(result), ["ello"]);
});

test("butlast on a word returns the remaining characters as a word", () => {
  const result = execute('print butlast "hello"', doc);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(printedValues(result), ["hell"]);
});

test("butfirst on an empty list raises ol-range", () => {
  const result = execute("print butfirst []", doc);
  assert.equal(result.diagnostics.length, 1);
  assert.deepEqual(result.diagnostics[0].params, {
    operation: "butfirst",
    value: [],
  });
});

test("butlast on an empty word raises ol-range", () => {
  const result = execute('print butlast ""', doc);
  assert.equal(result.diagnostics.length, 1);
  assert.deepEqual(result.diagnostics[0].code, "ol-range");
  assert.deepEqual(result.diagnostics[0].params, {
    operation: "butlast",
    value: "",
  });
});

test("butfirst on a number raises ol-type", () => {
  const result = execute("print butfirst 5", doc);
  assert.equal(result.diagnostics.length, 1);
  assert.deepEqual(result.diagnostics[0].params, {
    expected: "word or list",
    actual: "number",
    value: 5,
    operation: "butfirst",
  });
});

test("butlast propagates an operand evaluation failure instead of evaluating", () => {
  const result = execute("print butlast :missing", doc);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-undefined-var");
});

test("butfirst never mutates its list argument", () => {
  const result = execute(
    ":mylist = [1 2 3]\n" + ":throwaway = butfirst :mylist\n" + "print :mylist",
    doc,
  );
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(printedValues(result), [[1, 2, 3]]);
});

// --- fput / lput ------------------------------------------------------------------------------

test("fput prepends a value to a fresh list", () => {
  const result = execute("print fput 0 [1 2 3]", doc);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(printedValues(result), [[0, 1, 2, 3]]);
});

test("lput appends a value to a fresh list", () => {
  const result = execute("print lput 4 [1 2 3]", doc);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(printedValues(result), [[1, 2, 3, 4]]);
});

test("fput never mutates its list argument", () => {
  const result = execute(
    ":mylist = [1 2 3]\n" + ":throwaway = fput 0 :mylist\n" + "print :mylist",
    doc,
  );
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(printedValues(result), [[1, 2, 3]]);
});

test("fput on a non-list second argument raises ol-type naming 'list'", () => {
  const result = execute('print fput 1 "hi"', doc);
  assert.equal(result.diagnostics.length, 1);
  assert.deepEqual(result.diagnostics[0].code, "ol-type");
  assert.deepEqual(result.diagnostics[0].params, {
    expected: "list",
    actual: "word",
    value: "hi",
    operation: "fput",
  });
});

test("lput on a non-list second argument raises ol-type", () => {
  const result = execute("print lput 1 5", doc);
  assert.equal(result.diagnostics.length, 1);
  assert.deepEqual(result.diagnostics[0].params, {
    expected: "list",
    actual: "number",
    value: 5,
    operation: "lput",
  });
});

test("fput propagates a value-evaluation failure before checking the list", () => {
  const result = execute("print fput :missing [1]", doc);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-undefined-var");
});

test("lput propagates a list-evaluation failure", () => {
  const result = execute("print lput 1 :missing", doc);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-undefined-var");
});

// --- sentence -----------------------------------------------------------------------------

test("sentence combines two words into a fresh list", () => {
  const result = execute('print sentence "hello" "world"', doc);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(printedValues(result), [["hello", "world"]]);
});

test("sentence flattens a list argument's items one level", () => {
  const result = execute('print sentence [1 2] "3"', doc);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(printedValues(result), [[1, 2, "3"]]);
});

test("sentence accepts more than two arguments in parenthesized form", () => {
  const result = execute("print (sentence 1 [2 3] 4 [5])", doc);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(printedValues(result), [[1, 2, 3, 4, 5]]);
});

test("sentence never mutates a list argument", () => {
  const result = execute(
    ":mylist = [1 2]\n" +
      ":throwaway = sentence :mylist [3]\n" +
      "print :mylist",
    doc,
  );
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(printedValues(result), [[1, 2]]);
});

test("sentence propagates an argument evaluation failure", () => {
  const result = execute("print sentence :missing [1]", doc);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-undefined-var");
});

// --- count ----------------------------------------------------------------------------------

test("count returns a list's length", () => {
  const result = execute("print count [1 2 3]", doc);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(printedValues(result), [3]);
});

test("count returns a word's length", () => {
  const result = execute('print count "hello"', doc);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(printedValues(result), [5]);
});

test("count of an empty list is 0", () => {
  const result = execute("print count []", doc);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(printedValues(result), [0]);
});

test("count on a number raises ol-type", () => {
  const result = execute("print count 5", doc);
  assert.equal(result.diagnostics.length, 1);
  assert.deepEqual(result.diagnostics[0].code, "ol-type");
  assert.deepEqual(result.diagnostics[0].params, {
    expected: "word or list",
    actual: "number",
    value: 5,
    operation: "count",
  });
});

test("count on a boolean raises ol-type", () => {
  const result = execute("print count false", doc);
  assert.equal(result.diagnostics.length, 1);
  assert.deepEqual(result.diagnostics[0].params, {
    expected: "word or list",
    actual: "boolean",
    value: false,
    operation: "count",
  });
});

test("count propagates an operand evaluation failure instead of evaluating", () => {
  const result = execute("print count :missing", doc);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-undefined-var");
});
