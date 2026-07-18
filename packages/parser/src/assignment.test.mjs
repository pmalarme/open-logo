// Unit tests for assignment (issue #55) — the two Core assignment forms and the value-kind
// matrix they accept. These target shapes NOT already asserted by variables.test.mjs (field-only
// places on both forms, issue #48) or postfix-selectors.test.mjs (selector-only places on both
// forms, issue #79):
//   * every Core value kind on the right-hand side of both forms — number, word, list, boolean,
//     and a reporter-call expression — per spec/grammar.md:103-104 (assignment ::= colon-place "="
//     expression; set-assignment ::= "set" bare-place "to" expression);
//   * a place chain that MIXES a dotted field, a bracketed selector, and another dotted field
//     (`:a.b[1].c`) as an assignment target on both forms;
//   * the CRITICAL form/place asymmetry: `=` requires a colon-place (a bare place is not a place
//     at all — `check()` rejects it with `ol-not-a-place`), while `set ... to` requires a
//     bare-place (a colon-place after `set` is rejected at the parse stage with `ol-bad-token`).
//
// Runs under `node --test` against the built `@openlogo/parser` package, exercising only its
// public `parse`/`check` surface.

import assert from "node:assert/strict";
import { test } from "node:test";
import * as OL from "@openlogo/parser";

const doc = "assignment.logo";
const span = (start, end) => ({ document: doc, start, end });

function parseClean(source) {
  const { ast, diagnostics } = OL.parse(source, doc);
  assert.deepEqual(
    diagnostics,
    [],
    `expected a clean parse for ${JSON.stringify(source)}`,
  );
  return ast.body[0];
}

// ── Colon-place form (`:place = value`), one Core value kind at a time ─────────────────────────

test("a colon-place assignment with a number value :x = 100", () => {
  const assign = parseClean(":x = 100");
  assert.equal(assign.kind, "Assign");
  assert.equal(assign.form, "equals");
  assert.equal(assign.place.kind, "Place");
  assert.equal(assign.place.base.name, "x");
  assert.deepEqual(assign.place.segments, []);
  assert.equal(assign.value.kind, "NumberLit");
  assert.equal(assign.value.value, 100);
  assert.deepEqual(assign.source_span, span([1, 1], [1, 9]));
});

test('a colon-place assignment with a word value :color = "red"', () => {
  const assign = parseClean(':color = "red"');
  assert.equal(assign.form, "equals");
  assert.equal(assign.value.kind, "WordLit");
  assert.equal(assign.value.value, "red");
});

test("a colon-place assignment with a list value :nums = [ 1 2 3 ]", () => {
  const assign = parseClean(":nums = [ 1 2 3 ]");
  assert.equal(assign.value.kind, "ListLit");
  assert.deepEqual(
    assign.value.elements.map((el) => el.value),
    [1, 2, 3],
  );
});

test("a colon-place assignment with each boolean value :flag = true / :other = false", () => {
  const { ast, diagnostics } = OL.parse(":flag = true\n:other = false", doc);
  assert.deepEqual(diagnostics, []);
  const [first, second] = ast.body;
  assert.equal(first.value.kind, "BooleanLit");
  assert.equal(first.value.value, true);
  assert.equal(second.value.kind, "BooleanLit");
  assert.equal(second.value.value, false);
});

test("a colon-place assignment whose value is a reporter call :first_item = first :xs", () => {
  const assign = parseClean(":first_item = first :xs");
  assert.equal(assign.place.base.name, "first_item");
  assert.equal(assign.value.kind, "Call");
  assert.equal(assign.value.callee.name, "first");
  assert.equal(assign.value.args[0].kind, "VarRef");
  assert.equal(assign.value.args[0].name, "xs");
});

// ── Bare-place `set ... to` form, the same value-kind matrix ────────────────────────────────────

test("a set ... to assignment with a number value set x to 100", () => {
  const assign = parseClean("set x to 100");
  assert.equal(assign.kind, "Assign");
  assert.equal(assign.form, "set");
  assert.equal(assign.place.base.name, "x");
  assert.deepEqual(assign.place.segments, []);
  assert.equal(assign.value.kind, "NumberLit");
  assert.equal(assign.value.value, 100);
});

test('a set ... to assignment with a word value set color to "red"', () => {
  const assign = parseClean('set color to "red"');
  assert.equal(assign.form, "set");
  assert.equal(assign.value.kind, "WordLit");
  assert.equal(assign.value.value, "red");
});

test("a set ... to assignment with a list value set nums to [ 1 2 3 ]", () => {
  const assign = parseClean("set nums to [ 1 2 3 ]");
  assert.equal(assign.value.kind, "ListLit");
  assert.deepEqual(
    assign.value.elements.map((el) => el.value),
    [1, 2, 3],
  );
});

test("a set ... to assignment with a boolean value set flag to true", () => {
  const assign = parseClean("set flag to true");
  assert.equal(assign.value.kind, "BooleanLit");
  assert.equal(assign.value.value, true);
});

test("a set ... to assignment whose value is a reporter call set first_item to first :xs", () => {
  const assign = parseClean("set first_item to first :xs");
  assert.equal(assign.form, "set");
  assert.equal(assign.place.base.name, "first_item");
  assert.equal(assign.value.kind, "Call");
  assert.equal(assign.value.callee.name, "first");
  assert.equal(assign.value.args[0].name, "xs");
});

// ── Mixed field/selector/field place chains as assignment targets, both forms ──────────────────

test("a mixed field/selector/field colon place :a.b[1].c = 9 carries all three segments in order", () => {
  const assign = parseClean(":a.b[1].c = 9");
  assert.equal(assign.form, "equals");
  assert.equal(assign.place.base.name, "a");
  assert.deepEqual(
    assign.place.segments.map((s) => s.kind),
    ["field", "index", "field"],
  );
  assert.equal(assign.place.segments[0].name.name, "b");
  assert.equal(assign.place.segments[1].key.value, 1);
  assert.equal(assign.place.segments[2].name.name, "c");
  assert.equal(assign.value.value, 9);
});

test("a mixed field/selector/field bare place set a.b[1].c to 9 shares the same segment parsing", () => {
  const assign = parseClean("set a.b[1].c to 9");
  assert.equal(assign.form, "set");
  assert.equal(assign.place.base.name, "a");
  assert.deepEqual(
    assign.place.segments.map((s) => s.kind),
    ["field", "index", "field"],
  );
  assert.equal(assign.place.segments[0].name.name, "b");
  assert.equal(assign.place.segments[1].key.value, 1);
  assert.equal(assign.place.segments[2].name.name, "c");
  assert.equal(assign.value.value, 9);
});

// ── The CRITICAL form/place asymmetry (spec/grammar.md:103-104) ────────────────────────────────

// Named predicate reused below so the negative assertion (empty diagnostics array) stays
// callback-free at its call site while this predicate is still invoked at least once elsewhere,
// keeping function coverage at 100% on Node 22 (the corpus's coverage trap).
const isNotAPlace = (d) => d.code === "ol-not-a-place";

test("a bare place is not valid on the left of `=`: repcount = 100 parses as an Assign with a Call target", () => {
  const { ast, diagnostics } = OL.parse("repcount = 100", doc);
  assert.deepEqual(diagnostics, []);
  const assign = ast.body[0];
  assert.equal(assign.kind, "Assign");
  assert.equal(assign.form, "equals");
  assert.equal(assign.place.kind, "Call");
  assert.equal(assign.place.callee.name, "repcount");
});

test("check() flags repcount = 100 with ol-not-a-place: `=` requires a colon-place", () => {
  const { ast } = OL.parse("repcount = 100", doc);
  const { diagnostics } = OL.check(ast, { profiles: ["core-language"] });
  const notAPlace = diagnostics.filter(isNotAPlace);
  assert.equal(notAPlace.length, 1);
  const [diag] = notAPlace;
  assert.equal(diag.stage, "semantic");
  assert.equal(diag.severity, "error");
  assert.deepEqual(diag.params, { text: "repcount" });
});

test("a well-formed colon-place assignment is never flagged ol-not-a-place", () => {
  const { ast } = OL.parse(":x = 100", doc);
  const { diagnostics } = OL.check(ast, { profiles: ["core-language"] });
  assert.deepEqual(diagnostics, []);
});

test("a colon-place is not valid after `set ... to`: set :x to 100 rejects :x at the parse stage", () => {
  const { ast, diagnostics } = OL.parse("set :x to 100", doc);
  assert.ok(diagnostics.length > 0);
  const [first] = diagnostics;
  assert.equal(first.code, "ol-bad-token");
  assert.equal(first.stage, "parse");
  assert.equal(first.severity, "error");
  assert.deepEqual(first.params, { text: ":x" });
  assert.deepEqual(first.source_span, span([1, 5], [1, 7]));
  // Recovery re-parses the untouched `:x` as its own VarRef statement; `set` itself never
  // produces an Assign node here.
  assert.equal(ast.body[0].kind, "VarRef");
  assert.equal(ast.body[0].name, "x");
});
