// Unit tests for the `print` trace event's canonical printed form (issue #98) —
// spec/execution-model.md:19 (number formatting) and spec/commands.md:142-158 (`print`
// signature, variadic `(print a b …)` form, and the worked `(print :nums "has" count :nums
// "items")` example whose shape this formatter must handle once lists/words/booleans reach it).
// `formatNumber` and `printedForm` are exercised directly against constructed `OLValue`s (not
// only through `execute()`'s trace events) so nested/edge shapes that are not yet reachable
// end to end through Core source — e.g. a list nested three deep — are still proven correct.

import assert from "node:assert/strict";
import { test } from "node:test";
import { formatNumber, printedForm } from "@openlogo/runtime";

test("formatNumber prints a whole value without a decimal", () => {
  assert.equal(formatNumber(5), "5");
  assert.equal(formatNumber(0), "0");
  assert.equal(formatNumber(-7), "-7");
  assert.equal(formatNumber(12345), "12345");
});

test("formatNumber trims a non-whole value to at most 10 significant digits", () => {
  assert.equal(formatNumber(0.3333333333), "0.3333333333"); // exactly 10 sig digits
  assert.equal(formatNumber(0.33333333331), "0.3333333333"); // 11 digits -> trimmed
  assert.equal(formatNumber(1.234567890123), "1.23456789");
});

test("printedForm prints a number via formatNumber", () => {
  assert.equal(printedForm(5), "5");
  assert.equal(printedForm(1.234567890123), "1.23456789");
});

test("printedForm prints a word verbatim, with no surrounding quotes", () => {
  assert.equal(printedForm("hello"), "hello");
  assert.equal(printedForm(""), "");
});

test("printedForm prints a boolean as true/false", () => {
  assert.equal(printedForm(true), "true");
  assert.equal(printedForm(false), "false");
});

test("printedForm prints a list space-separated and bracketed", () => {
  assert.equal(printedForm([1, 2, 3]), "[1 2 3]");
  assert.equal(printedForm([]), "[]");
});

test("printedForm prints a nested list recursively", () => {
  assert.equal(printedForm([1, [2, 3]]), "[1 [2 3]]");
  assert.equal(printedForm([[1, [2, 3]], 4]), "[[1 [2 3]] 4]");
});

test("printedForm prints a mixed-type list, each element in its own canonical form", () => {
  assert.equal(printedForm([1, "two", true, [3]]), "[1 two true [3]]");
});
