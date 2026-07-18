// Unit tests for the bracketed `[ key-term ]` postfix selector (issue #79), the sibling of the
// dotted `.identifier` postfix covered in place-selectors.test.mjs (issue #49). These exercise the
// parser's public `parse` surface and the semantic `check` surface against the built
// `@openlogo/parser` package, covering:
//   * every key-term form (spec/grammar.md:111): number, word literal, `:name` read, a bare
//     identifier as a *literal word key* (reserved words included), and a parenthesized expression;
//   * selectors interleaved with dotted fields in source order (`:a.b[1].c`);
//   * selector assignment targets, both `:place = value` and `set bare to value`;
//   * lexical adjacency disambiguation — a spaced `[ … ]` is NOT a selector; and
//   * the `ol-not-a-place` semantic diagnostic for a reporter/call used as an assignment target.
//
// Spans are asserted where they pin the selector's own `source_span` (spec/grammar.md:111).

import assert from "node:assert/strict";
import { test } from "node:test";
import * as OL from "@openlogo/parser";

const doc = "selectors.logo";
const span = (start, end) => ({ document: doc, start, end });

// Shared, named predicate for the ol-not-a-place code. Reused by the positive check below (where the
// diagnostics array is non-empty, so this is invoked) and the well-formed negative assertion (where
// the array is empty). Naming it keeps the negative assertion callback-free at the call site while
// still exercising the predicate exactly once, so function coverage stays at 100% on Node 22.
const isNotAPlace = (d) => d.code === "ol-not-a-place";

function firstArg(src) {
  const { ast, diagnostics } = OL.parse(src, doc);
  assert.deepEqual(diagnostics, []);
  return ast.body[0].args[0];
}

test("a numeric selector :nums[1] grows the variable into a place with one index segment", () => {
  const place = firstArg("print :nums[1]");
  assert.equal(place.kind, "Place");
  assert.equal(place.base.name, "nums");
  assert.equal(place.segments.length, 1);
  const [seg] = place.segments;
  assert.equal(seg.kind, "index");
  assert.equal(seg.key.kind, "NumberLit");
  assert.equal(seg.key.value, 1);
  assert.deepEqual(seg.source_span, span([1, 12], [1, 15]));
  assert.deepEqual(place.source_span, span([1, 7], [1, 15]));
});

test("a bare identifier key :ages[tom] is a literal word key, not a variable read or call", () => {
  const place = firstArg("print :ages[tom]");
  const [seg] = place.segments;
  assert.equal(seg.kind, "index");
  assert.equal(seg.key.kind, "WordLit");
  assert.equal(seg.key.value, "tom");
});

test("a reserved word is a valid literal word key :ages[repeat]", () => {
  const place = firstArg("print :ages[repeat]");
  const [seg] = place.segments;
  assert.equal(seg.key.kind, "WordLit");
  assert.equal(seg.key.value, "repeat");
});

test("a colon key :ages[:who] reads the variable", () => {
  const place = firstArg("print :ages[:who]");
  const [seg] = place.segments;
  assert.equal(seg.key.kind, "VarRef");
  assert.equal(seg.key.name, "who");
});

test('a word-literal key :ages["tom"] carries the word value', () => {
  const place = firstArg('print :ages["tom"]');
  const [seg] = place.segments;
  assert.equal(seg.key.kind, "WordLit");
  assert.equal(seg.key.value, "tom");
});

test("a parenthesized key :nums[(:i + 1)] evaluates the expression", () => {
  const place = firstArg("print :nums[(:i + 1)]");
  const [seg] = place.segments;
  assert.equal(seg.kind, "index");
  assert.equal(seg.key.kind, "Call");
  assert.equal(seg.key.callee.name, "+");
});

test("a negative numeric key :nums[-1] is a single negative NumberLit", () => {
  const place = firstArg("print :nums[-1]");
  const [seg] = place.segments;
  assert.equal(seg.kind, "index");
  assert.equal(seg.key.kind, "NumberLit");
  assert.equal(seg.key.value, -1);
});

test("a negative numeric key is assignable: :nums[-1] = 9 targets the place", () => {
  const { ast, diagnostics } = OL.parse(":nums[-1] = 9", doc);
  assert.deepEqual(diagnostics, []);
  const assign = ast.body[0];
  assert.equal(assign.kind, "Assign");
  assert.equal(assign.place.segments[0].key.value, -1);
});

test("a gapped minus inside a selector :nums[- 1] is not a negative literal and is rejected", () => {
  const { diagnostics } = OL.parse("print :nums[- 1]", doc);
  assert.ok(diagnostics.some((d) => d.code === "ol-bad-token"));
});

test("a block-comment gap between minus and numeral is not adjacency (line, not just column)", () => {
  // The `-` ends line 1 and `1` starts line 2 at the same column; adjacency must compare the line
  // too, so this is a stray minus, not the negative key `-1`.
  const { diagnostics } = OL.parse("print :nums[-/*\n           */1]", doc);
  assert.ok(diagnostics.some((d) => d.code === "ol-bad-token"));
});

test("selectors and dotted fields interleave in source order for :a.b[1].c", () => {
  const place = firstArg("print :a.b[1].c");
  assert.equal(place.kind, "Place");
  assert.equal(place.base.name, "a");
  assert.deepEqual(
    place.segments.map((s) => s.kind),
    ["field", "index", "field"],
  );
  assert.equal(place.segments[0].name.name, "b");
  assert.equal(place.segments[1].key.value, 1);
  assert.equal(place.segments[2].name.name, "c");
});

test("consecutive selectors :grid[1][2] each become their own index segment", () => {
  const place = firstArg("print :grid[1][2]");
  assert.deepEqual(
    place.segments.map((s) => s.kind),
    ["index", "index"],
  );
  assert.deepEqual(
    place.segments.map((s) => s.key.value),
    [1, 2],
  );
});

test("a colon selector assignment :nums[1] = 9 is an Assign whose target is the full place", () => {
  const { ast, diagnostics } = OL.parse(":nums[1] = 9", doc);
  assert.deepEqual(diagnostics, []);
  const assign = ast.body[0];
  assert.equal(assign.kind, "Assign");
  assert.equal(assign.form, "equals");
  assert.equal(assign.place.kind, "Place");
  assert.deepEqual(
    assign.place.segments.map((s) => s.kind),
    ["index"],
  );
  assert.equal(assign.value.value, 9);
});

test("a parenthesized-key assignment target :nums[(:i + 1)] = 9 parses cleanly", () => {
  const { ast, diagnostics } = OL.parse(":nums[(:i + 1)] = 9", doc);
  assert.deepEqual(diagnostics, []);
  const assign = ast.body[0];
  assert.equal(assign.kind, "Assign");
  assert.equal(assign.place.segments[0].key.kind, "Call");
});

test("nested paren/bracket selectors in a colon assignment target are depth-balanced", () => {
  const { ast, diagnostics } = OL.parse(":grid[1][2] = 0", doc);
  assert.deepEqual(diagnostics, []);
  const assign = ast.body[0];
  assert.equal(assign.kind, "Assign");
  assert.deepEqual(
    assign.place.segments.map((s) => s.kind),
    ["index", "index"],
  );
});

test("a bare-place selector after set ... to shares the same selector parsing", () => {
  const { ast, diagnostics } = OL.parse("set nums[1] to 9", doc);
  assert.deepEqual(diagnostics, []);
  const assign = ast.body[0];
  assert.equal(assign.kind, "Assign");
  assert.equal(assign.form, "set");
  assert.equal(assign.place.base.name, "nums");
  assert.deepEqual(
    assign.place.segments.map((s) => s.kind),
    ["index"],
  );
  assert.equal(assign.value.value, 9);
});

test("a spaced [ … ] is NOT a selector: :nums stays a plain VarRef and the bracket is separate", () => {
  const { ast } = OL.parse("print :nums [ 1 ]", doc);
  const call = ast.body[0];
  assert.equal(call.kind, "Call");
  assert.equal(call.args[0].kind, "VarRef");
  assert.equal(call.args[0].name, "nums");
});

test("a spaced comprehension body is never treated as a selector on the collection", () => {
  const { ast, diagnostics } = OL.parse("map n in :nums [ :n * 2 ]", doc);
  assert.deepEqual(diagnostics, []);
  assert.equal(ast.body[0].kind, "Comprehension");
});

test("an empty selector :nums[] reports an unmatched bracket at the missing key", () => {
  const { diagnostics } = OL.parse("print :nums[]", doc);
  assert.ok(diagnostics.some((d) => d.code === "ol-unmatched-bracket"));
});

test("an unterminated selector :nums[1 reports an unmatched bracket", () => {
  const { ast, diagnostics } = OL.parse(":nums[1", doc);
  assert.equal(ast.body[0].kind, "Place");
  assert.ok(diagnostics.some((d) => d.code === "ol-unmatched-bracket"));
});

test("a selector missing its close :nums[1 2] reports an unmatched bracket", () => {
  const { diagnostics } = OL.parse("print :nums[1 2]", doc);
  assert.ok(diagnostics.some((d) => d.code === "ol-unmatched-bracket"));
});

test("check() walks selector key expressions in a mixed chain without diagnostics", () => {
  const { ast } = OL.parse(":a = 0\n:a.b[1].c", doc);
  const { diagnostics } = OL.check(ast);
  assert.deepEqual(diagnostics, []);
});

// ── Scope B: ol-not-a-place ───────────────────────────────────────────────────────────────────

test("a reporter used as an assignment target first :x = 5 parses as an Assign with a Call target", () => {
  const { ast } = OL.parse("first :x = 5", doc);
  const assign = ast.body[0];
  assert.equal(assign.kind, "Assign");
  assert.equal(assign.place.kind, "Call");
  assert.equal(assign.place.callee.name, "first");
});

test("check() flags first :x = 5 with ol-not-a-place at stage semantic", () => {
  const { ast } = OL.parse("first :x = 5", doc);
  const { diagnostics } = OL.check(ast);
  const notAPlace = diagnostics.filter(isNotAPlace);
  assert.equal(notAPlace.length, 1);
  const [diag] = notAPlace;
  assert.equal(diag.stage, "semantic");
  assert.equal(diag.severity, "error");
  assert.deepEqual(diag.params, { text: "first :x" });
});

test("a parenthesized reporter target (first :x) = 5 is flagged ol-not-a-place too", () => {
  const { ast } = OL.parse("(first :x) = 5", doc);
  const assign = ast.body[0];
  assert.equal(assign.kind, "Assign");
  assert.equal(assign.place.kind, "ParenCall");
  const { diagnostics } = OL.check(ast);
  assert.ok(diagnostics.some(isNotAPlace));
});

test("a reporter target with no value first :x = reports a parse diagnostic and keeps the call", () => {
  const { ast, diagnostics } = OL.parse("first :x =", doc);
  assert.equal(ast.body[0].kind, "Call");
  assert.ok(diagnostics.length > 0);
});

test("a reporter call without = stays a plain call statement, not an assignment", () => {
  const { ast, diagnostics } = OL.parse("first :x", doc);
  assert.deepEqual(diagnostics, []);
  assert.equal(ast.body[0].kind, "Call");
});

test("a well-formed selector assignment is not flagged ol-not-a-place", () => {
  const { ast } = OL.parse(":nums[1] = 9", doc);
  const { diagnostics } = OL.check(ast);
  assert.ok(!diagnostics.some(isNotAPlace));
});

test("a bare numeric statement is neither an assignment nor a place", () => {
  const { ast, diagnostics } = OL.parse("5", doc);
  assert.deepEqual(diagnostics, []);
  assert.equal(ast.body[0].kind, "NumberLit");
});

test("a stray operator statement produces a diagnostic and no statement node", () => {
  const { ast, diagnostics } = OL.parse("*", doc);
  assert.equal(ast.body.length, 0);
  assert.ok(diagnostics.length > 0);
});

test("a spaced selector before = is not read as a colon-place assignment target", () => {
  const { ast } = OL.parse(":nums [1]", doc);
  // `:nums` stays a bare VarRef read; the spaced `[1]` is a separate list literal statement.
  assert.equal(ast.body[0].kind, "VarRef");
});
