// Unit tests for worded `is`-predicate and prefix `?`-predicate evaluation (issue #99,
// spec/execution-model.md:146-166, spec/commands.md:655-705). Conformance fixtures under
// tests/conformance/core-language/execution/{is-*,prefix-*}.expected.json cover the primary
// literal-observable positive/negative cases end to end. These unit tests fill in what a fixture
// cannot: every dynamically-reachable diagnostic path exercised directly (not via
// conformance-fixture subprocess spillover, per the #172/#173 lesson), including the operand/
// collection/bound evaluation-failure propagation branches, both `strictly`/inclusive `between`
// boundaries for numbers AND words, and every prefix-form error route (`empty?`/`member?`/
// `is_a?`).

import assert from "node:assert/strict";
import { test } from "node:test";
import { execute } from "@openlogo/runtime";

const doc = "acceptance.logo";

function printedValues(result) {
  return result.events
    .filter((event) => event.kind === "print")
    .map((event) => event.payload.values[0]);
}

// --- `is empty` / `empty?` ----------------------------------------------------------------

test("`is empty` is true for an empty list", () => {
  const result = execute("print [] is empty", doc);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(printedValues(result), [true]);
});

test("`is empty` is false for a non-empty list", () => {
  const result = execute("print [1] is empty", doc);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(printedValues(result), [false]);
});

test("`is empty` is true for an empty word", () => {
  const result = execute('print "" is empty', doc);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(printedValues(result), [true]);
});

test("`is empty` is false for a non-empty word", () => {
  const result = execute('print "hi" is empty', doc);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(printedValues(result), [false]);
});

test("`is empty` on a number raises ol-type naming 'list or word'", () => {
  const result = execute("print 5 is empty", doc);
  assert.equal(result.diagnostics.length, 1);
  assert.deepEqual(result.diagnostics[0].code, "ol-type");
  assert.deepEqual(result.diagnostics[0].params, {
    expected: "list or word",
    actual: "number",
    value: 5,
    operation: "is empty",
  });
});

test("`is empty` propagates an undefined-operand diagnostic instead of evaluating", () => {
  const result = execute("print :missing is empty", doc);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-undefined-var");
});

test("`empty?` prefix form matches the worded form for a truthy case", () => {
  const result = execute("print empty? []", doc);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(printedValues(result), [true]);
});

test("`empty?` prefix form is false for a non-empty word", () => {
  const result = execute('print empty? "hi"', doc);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(printedValues(result), [false]);
});

test("`empty?` prefix form raises ol-type with operation 'empty?'", () => {
  const result = execute("print empty? 5", doc);
  assert.equal(result.diagnostics.length, 1);
  assert.deepEqual(result.diagnostics[0].params, {
    expected: "list or word",
    actual: "number",
    value: 5,
    operation: "empty?",
  });
});

test("`empty?` prefix form propagates an operand evaluation failure", () => {
  const result = execute("print empty? :missing", doc);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-undefined-var");
});

// --- `is member of` / `member?` -----------------------------------------------------------

test("`is member of` is true when the collection contains an equal element", () => {
  const result = execute("print (2 is member of [1 2 3])", doc);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(printedValues(result), [true]);
});

test("`is member of` is false when the collection has no equal element", () => {
  const result = execute("print (9 is member of [1 2 3])", doc);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(printedValues(result), [false]);
});

test("`is member of` on a non-list collection raises ol-type naming 'list'", () => {
  const result = execute("print (2 is member of 5)", doc);
  assert.equal(result.diagnostics.length, 1);
  assert.deepEqual(result.diagnostics[0].params, {
    expected: "list",
    actual: "number",
    value: 5,
    operation: "is member of",
  });
});

test("`is member of` propagates a collection-expression evaluation failure", () => {
  const result = execute("print (2 is member of :missing)", doc);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-undefined-var");
});

test("`member?` prefix form matches the worded form for a truthy case", () => {
  const result = execute("print member? 2 [1 2 3]", doc);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(printedValues(result), [true]);
});

test("`member?` prefix form is false when there is no equal element", () => {
  const result = execute("print member? 9 [1 2 3]", doc);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(printedValues(result), [false]);
});

test("`member?` prefix form raises ol-type with operation 'member?'", () => {
  const result = execute("print member? 2 5", doc);
  assert.equal(result.diagnostics.length, 1);
  assert.deepEqual(result.diagnostics[0].params, {
    expected: "list",
    actual: "number",
    value: 5,
    operation: "member?",
  });
});

test("`member?` prefix form propagates a value-argument evaluation failure", () => {
  const result = execute("print member? :missing [1 2 3]", doc);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-undefined-var");
});

test("`member?` prefix form propagates a collection-argument evaluation failure", () => {
  const result = execute("print member? 2 :missing", doc);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-undefined-var");
});

// --- `is a <type-word>` / `is_a?` -----------------------------------------------------------

test("`is a` is true when the value's runtime type matches", () => {
  const result = execute('print (5 is a "number")', doc);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(printedValues(result), [true]);
});

test("`is a` is false when the value's runtime type does not match", () => {
  const result = execute('print (5 is a "word")', doc);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(printedValues(result), [false]);
});

test("`is a` recognizes list and boolean type words too", () => {
  const listResult = execute('print ([1 2] is a "list")', doc);
  assert.deepEqual(listResult.diagnostics, []);
  assert.deepEqual(printedValues(listResult), [true]);

  const boolResult = execute('print (true is a "boolean")', doc);
  assert.deepEqual(boolResult.diagnostics, []);
  assert.deepEqual(printedValues(boolResult), [true]);
});

test("`is a` with an unrecognized type word raises ol-unknown-type at stage=runtime", () => {
  const result = execute('print (5 is a "banana")', doc);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-unknown-type");
  assert.deepEqual(result.diagnostics[0].params, { name: "banana" });
  assert.equal(result.diagnostics[0].stage, "runtime");
});

test("`is a` is case-sensitive, matching the checker's own CORE_TYPE_WORDS", () => {
  const result = execute('print (5 is a "Number")', doc);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-unknown-type");
  assert.deepEqual(result.diagnostics[0].params, { name: "Number" });
});

test("`is a` propagates an undefined-operand diagnostic instead of evaluating", () => {
  const result = execute('print (:missing is a "number")', doc);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-undefined-var");
});

test("`is_a?` prefix form is true when the value's runtime type matches", () => {
  const result = execute('print is_a? 5 "number"', doc);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(printedValues(result), [true]);
});

test("`is_a?` prefix form is false when the value's runtime type does not match", () => {
  const result = execute('print is_a? 5 "word"', doc);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(printedValues(result), [false]);
});

test("`is_a?` prefix form raises ol-type when the type argument is not a word", () => {
  const result = execute("print is_a? 5 6", doc);
  assert.equal(result.diagnostics.length, 1);
  assert.deepEqual(result.diagnostics[0].code, "ol-type");
  assert.deepEqual(result.diagnostics[0].params, {
    expected: "word",
    actual: "number",
    value: 6,
    operation: "is_a?",
  });
});

test("`is_a?` prefix form raises ol-unknown-type when the type argument is an unrecognized word", () => {
  const result = execute('print is_a? 5 "banana"', doc);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-unknown-type");
  assert.deepEqual(result.diagnostics[0].params, { name: "banana" });
});

test("`is_a?` prefix form propagates a value-argument evaluation failure", () => {
  const result = execute('print is_a? :missing "number"', doc);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-undefined-var");
});

test("`is_a?` prefix form propagates a type-argument evaluation failure", () => {
  const result = execute("print is_a? 5 :missing", doc);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-undefined-var");
});

// --- `[ strictly ] between` ------------------------------------------------------------------

test("`between` (inclusive) is true at the lower bound", () => {
  const result = execute("print (1 is between 1 and 5)", doc);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(printedValues(result), [true]);
});

test("`between` (inclusive) is true at the upper bound", () => {
  const result = execute("print (5 is between 1 and 5)", doc);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(printedValues(result), [true]);
});

test("`between` (inclusive) is false below the lower bound", () => {
  const result = execute("print (0 is between 1 and 5)", doc);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(printedValues(result), [false]);
});

test("`between` (inclusive) is false above the upper bound", () => {
  const result = execute("print (6 is between 1 and 5)", doc);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(printedValues(result), [false]);
});

test("`strictly between` excludes the lower bound", () => {
  const result = execute("print (1 is strictly between 1 and 5)", doc);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(printedValues(result), [false]);
});

test("`strictly between` excludes the upper bound", () => {
  const result = execute("print (5 is strictly between 1 and 5)", doc);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(printedValues(result), [false]);
});

test("`strictly between` is true strictly inside the bounds", () => {
  const result = execute("print (3 is strictly between 1 and 5)", doc);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(printedValues(result), [true]);
});

test("`between` also orders words lexicographically, inclusive", () => {
  const atBound = execute('print ("a" is between "a" and "c")', doc);
  assert.deepEqual(atBound.diagnostics, []);
  assert.deepEqual(printedValues(atBound), [true]);

  const inside = execute('print ("b" is between "a" and "c")', doc);
  assert.deepEqual(inside.diagnostics, []);
  assert.deepEqual(printedValues(inside), [true]);

  const outside = execute('print ("z" is between "a" and "c")', doc);
  assert.deepEqual(outside.diagnostics, []);
  assert.deepEqual(printedValues(outside), [false]);
});

test("`strictly between` excludes a word bound too", () => {
  const result = execute('print ("a" is strictly between "a" and "c")', doc);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(printedValues(result), [false]);
});

test("`strictly between` is true for a word strictly inside both word bounds", () => {
  // Exercises the strict (`<`) comparison against the high bound once the strict
  // low-bound comparison has already passed — distinct from the inclusive-word and
  // at-the-low-bound-strict cases above, which never reach the high-bound check.
  const result = execute('print ("b" is strictly between "a" and "c")', doc);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(printedValues(result), [true]);
});

test("`between` on a boolean value raises ol-type naming 'number or word'", () => {
  const result = execute("print (true is between 1 and 5)", doc);
  assert.equal(result.diagnostics.length, 1);
  assert.deepEqual(result.diagnostics[0].code, "ol-type");
  assert.deepEqual(result.diagnostics[0].params, {
    expected: "number or word",
    actual: "boolean",
    value: true,
    operation: "between",
  });
});

test("`between` with a mismatched (word) low bound against a number value raises ol-type naming 'number'", () => {
  const result = execute('print (5 is between "a" and 5)', doc);
  assert.equal(result.diagnostics.length, 1);
  assert.deepEqual(result.diagnostics[0].params, {
    expected: "number",
    actual: "word",
    value: "a",
    operation: "between",
  });
});

test("`between` with a mismatched (number) high bound against a number value raises ol-type naming 'number'", () => {
  const result = execute('print (5 is between 1 and "z")', doc);
  assert.equal(result.diagnostics.length, 1);
  assert.deepEqual(result.diagnostics[0].params, {
    expected: "number",
    actual: "word",
    value: "z",
    operation: "between",
  });
});

test("`between` with a mismatched (number) low bound against a word value raises ol-type naming 'word'", () => {
  const result = execute('print ("b" is between 1 and "c")', doc);
  assert.equal(result.diagnostics.length, 1);
  assert.deepEqual(result.diagnostics[0].params, {
    expected: "word",
    actual: "number",
    value: 1,
    operation: "between",
  });
});

test("`between` with a mismatched (number) high bound against a word value raises ol-type naming 'word'", () => {
  const result = execute('print ("b" is between "a" and 5)', doc);
  assert.equal(result.diagnostics.length, 1);
  assert.deepEqual(result.diagnostics[0].params, {
    expected: "word",
    actual: "number",
    value: 5,
    operation: "between",
  });
});

test("`between` propagates an undefined low-bound evaluation failure", () => {
  const result = execute("print (5 is between :missing and 5)", doc);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-undefined-var");
});

test("`between` propagates an undefined high-bound evaluation failure", () => {
  const result = execute("print (5 is between 1 and :missing)", doc);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-undefined-var");
});

// --- return/stop/throw are untouched by is-predicates (sanity: predicates are pure expressions) -

test("an is-predicate used as an if-condition drives control flow normally", () => {
  const result = execute(
    'if [] is empty [ print "yes" ] else [ print "no" ]',
    doc,
  );
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(printedValues(result), ["yes"]);
});
