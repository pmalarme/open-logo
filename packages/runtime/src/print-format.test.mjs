// Unit tests for the `print` trace event's canonical printed form (issue #98) —
// spec/execution-model.md:19 (number formatting) and spec/commands.md:142-158 (`print`
// signature, variadic `(print a b …)` form, and the worked `(print :nums "has" count :nums
// "items")` example whose shape this formatter must handle once lists/words/booleans reach it).
// `formatNumber` and `printedForm` are exercised directly against constructed `OLValue`s (not
// only through `execute()`'s trace events) so nested/edge shapes that are not yet reachable
// end to end through Core source — e.g. a list nested three deep — are still proven correct.

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CYCLIC_PLACEHOLDER,
  formatNumber,
  printedForm,
} from "@openlogo/runtime";
import { OLDict } from "@openlogo/core";

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

test("printedForm prints a dict as `{key: value …}` in insertion order (issue #322)", () => {
  const dict = new OLDict();
  dict.set("a", 1);
  dict.set("b", "two");
  assert.equal(printedForm(dict), "{a: 1 b: two}");
});

test("printedForm prints an empty dict as `{}`", () => {
  assert.equal(printedForm(new OLDict()), "{}");
});

test("printedForm prints a dict nested inside a list, and vice versa", () => {
  const dict = new OLDict();
  dict.set("x", [1, 2]);
  assert.equal(printedForm(dict), "{x: [1 2]}");
  assert.equal(printedForm([dict]), "[{x: [1 2]}]");
});

// Rendering must terminate on cyclic/shared structure via a whole-render identity memo
// (issue #495, `spec/execution-model.md`'s rendering-termination rule + `spec/error-model.md`'s
// `ol-limit` guardrail this is tied to): a self-referential list gets a bounded placeholder at
// the repeat occurrence, not infinite recursion or a host stack overflow.
test("printedForm terminates a self-referential list via CYCLIC_PLACEHOLDER, not infinite recursion", () => {
  const list = [1, 2];
  list.push(list);
  assert.equal(printedForm(list), "[1 2 ...]");
});

test("printedForm terminates a self-referential dict the same way", () => {
  const dict = new OLDict();
  dict.set("self", dict);
  assert.equal(printedForm(dict), "{self: ...}");
});

// A value can be perfectly acyclic yet nested far deeper than any host call stack can recurse
// into natively — cycle detection alone does not stop that from throwing a host
// `RangeError: Maximum call stack size exceeded`, which is exactly the uncontrolled failure
// `spec/error-model.md`'s `ol-limit` guardrail exists to avoid (issue #495 fixup). `printedForm`
// must walk arbitrarily deep acyclic structure without overflowing the native stack.
test("printedForm renders a very deeply nested (but acyclic) list without a host stack overflow", () => {
  let list = [0];
  for (let i = 0; i < 20000; i += 1) {
    list = [list];
  }
  const depth = 20001; // the initial `[0]` plus 20000 further wraps
  const printed = printedForm(list);
  assert.equal(printed.length, depth + "0".length + depth);
  assert.ok(printed.startsWith("[".repeat(depth)));
  assert.ok(printed.endsWith("]".repeat(depth)));
});

test("printedForm's optional `seen` parameter lets a caller share one whole-render memo across multiple top-level calls: a value already registered in a passed-in `seen` set renders as the cyclic placeholder even on its very first call", () => {
  const list = [1, 2];
  const seen = new Set([list]);
  assert.equal(printedForm(list, seen), CYCLIC_PLACEHOLDER);
});

// Per `spec/execution-model.md`'s rendering-termination rule, the printed-form memo is a
// *whole-render* identity memo, not just current-path cycle detection — so a repeated (but
// acyclic) shared reference is also bounded on its second occurrence, the same as a true cycle.
// (Contrast with the conformance-fixture `$id`/`$ref` convention, which asserts the underlying
// *value graph*'s reference identity, independent of how `printedForm` chooses to render it.)
test("printedForm bounds a repeated (acyclic-but-shared) reference on its second occurrence, per the whole-render memo rule", () => {
  const shared = [1, 2];
  assert.equal(printedForm([shared, shared]), "[[1 2] ...]");
});

test("printedForm renders two independent, non-aliased lists with equal contents in full at each occurrence", () => {
  assert.equal(
    printedForm([
      [1, 2],
      [1, 2],
    ]),
    "[[1 2] [1 2]]",
  );
});
