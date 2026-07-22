// Unit tests for #315's AST-derived code-folding ranges (packages/studio/src/fold-ranges.ts).
//
// These exist specifically to prove the rubber-duck review's core concern is addressed: naive
// text-based `[ … ]` bracket matching would wrongly fold list literals, comprehension binder
// patterns, and selector-index brackets (none of which are instruction blocks), and would also
// misfire on brackets written inside a comment. computeFoldRanges must fold ONLY real
// instruction-block bodies (If/While/Repeat/Forever/ForIn/ForRange/Comprehension/ProcedureDef),
// using the AST rather than the source text, for both `[ … ]` and `… end` spellings alike.

import assert from "node:assert/strict";
import { test } from "node:test";
import * as OL from "@openlogo/studio";

const { computeFoldRanges } = OL;

test("a bracketed `repeat` block folds its body span, not including the `repeat 4` header", () => {
  const source = "repeat 4 [\n  forward 10\n  right 90\n]";
  const ranges = computeFoldRanges(source);

  assert.equal(ranges.length, 1);
  const { start, end } = ranges[0];
  assert.equal(source.slice(start, end), "[\n  forward 10\n  right 90\n]");
});

test("a long `… end` `if` block folds from the end of its header line through `end`", () => {
  const source = "if :x > 0\n  print 1\nend\n";
  const ranges = computeFoldRanges(source);

  assert.equal(ranges.length, 1);
  const { start, end } = ranges[0];
  assert.equal(source.slice(0, start), "if :x > 0");
  assert.equal(source.slice(start, end), "\n  print 1\nend");
});

test("`while`, `forever`, `for … in`, and `for … from … to` each fold their one body", () => {
  const cases = [
    "while :x < 10\n  print 1\nend\n",
    "forever\n  print 1\nend\n",
    "for item in :items\n  print 1\nend\n",
    "for i from 1 to 5\n  print :i\nend\n",
  ];
  for (const source of cases) {
    const ranges = computeFoldRanges(source);
    assert.equal(
      ranges.length,
      1,
      `expected exactly one fold range for: ${source}`,
    );
  }
});

test("an `if` with an `else` branch folds both the then-body and the else-body separately", () => {
  const source = "if :x > 0\n  print 1\nelse\n  print 2\nend\n";
  const ranges = computeFoldRanges(source);

  assert.equal(ranges.length, 2);
  assert.ok(source.slice(ranges[0].start, ranges[0].end).includes("print 1"));
  assert.ok(source.slice(ranges[1].start, ranges[1].end).includes("print 2"));
});

test("a `define … end` procedure body folds", () => {
  const source = "define f :n\n  return :n\nend\n";
  const ranges = computeFoldRanges(source);

  assert.equal(ranges.length, 1);
  assert.ok(source.slice(ranges[0].start, ranges[0].end).includes("return :n"));
});

test("a `map` comprehension body folds, matching the same Block production as control forms", () => {
  const source = ":nums = [1 2 3]\n:doubled = map n in :nums [\n  :n * 2\n]";
  const ranges = computeFoldRanges(source);

  assert.equal(ranges.length, 1);
  assert.ok(source.slice(ranges[0].start, ranges[0].end).includes(":n * 2"));
});

test("nested blocks each produce their own fold range", () => {
  const source = "repeat 2 [\n  if :x > 0 [\n    print 1\n  ]\n]";
  const ranges = computeFoldRanges(source);

  assert.equal(ranges.length, 2);
});

test("a list literal's brackets are never folded, even though they use the same delimiter", () => {
  const source = ":nums = [1 2 3]";
  assert.deepEqual(computeFoldRanges(source), []);
});

test("a selector-index bracket (`:nums[1]`) is never folded", () => {
  const source = ":nums = [1 2 3]\n:first = :nums[1]";
  assert.deepEqual(computeFoldRanges(source), []);
});

test("brackets written inside a `#` comment are never folded", () => {
  const source = "# repeat 4 [\n#   forward 10\n# ]\nprint 1";
  assert.deepEqual(computeFoldRanges(source), []);
});

test("an empty bracketed block `[ ]` (single line, no newline) is not folded", () => {
  const source = "repeat 4 [ ]";
  assert.deepEqual(computeFoldRanges(source), []);
});

test("a single-line body with no newline inside it is not folded", () => {
  const source = "repeat 4 [ forward 10 ]";
  assert.deepEqual(computeFoldRanges(source), []);
});

test("malformed/incomplete source never throws and never guesses a fold from an error-recovered span", () => {
  // An unterminated `[` recovers to a `Repeat` whose body span runs to end-of-source — folding it
  // would collapse past the point the block actually (mal)ends, so this must yield no folds.
  assert.doesNotThrow(() => computeFoldRanges("repeat 4 [\n  forward 10\n"));
  assert.deepEqual(computeFoldRanges("repeat 4 [\n  forward 10\n"), []);

  // Same for an incomplete expression that stops error recovery before any block closes.
  assert.doesNotThrow(() => computeFoldRanges("if :x >\n"));
  assert.deepEqual(computeFoldRanges("if :x >\n"), []);

  assert.doesNotThrow(() => computeFoldRanges(""));
  assert.deepEqual(computeFoldRanges(""), []);
});

test("a well-formed block elsewhere in the document is still not folded if another part of the source has a parse error", () => {
  const source = "repeat 4 [\n  forward 10\n]\nrepeat 2 [\n  back 5\n";
  assert.deepEqual(computeFoldRanges(source), []);
});

test("Unicode identifiers and content inside a folded block do not corrupt the computed offsets", () => {
  const source = 'repeat 4 [\n  print "café🐢"\n]';
  const ranges = computeFoldRanges(source);

  assert.equal(ranges.length, 1);
  assert.ok(source.slice(ranges[0].start, ranges[0].end).includes("café🐢"));
});
