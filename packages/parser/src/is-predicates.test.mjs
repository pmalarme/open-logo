// Unit tests for worded is-predicates (issue #53), per spec/grammar.md:181-184,230 and
// spec/execution-model.md:148-152. `coverage.test.mjs` already exercises the four predicate forms'
// happy paths and their per-form syntax-error recovery; this file targets what that leaves
// untested: exact source spans for every form (operand-inclusive span, `test.type`/`low`/`high`
// sub-spans), the predicate used as an `if` condition and as an assignment value (not just a bare
// `print` argument), the contextual keywords (`empty`, `member`, `of`, `a`) staying usable as
// ordinary names outside an `is`-predicate per spec/grammar.md:230, precedence against `and`/`or`
// (the predicate binds at the comparison level, tighter than both), and a known parser gap this
// slice discovered (duplicate `ol-bad-token` for `is member` with no `of` and no valid collection).
//
// Runs under `node --test` against the built `@openlogo/parser` package, exercising only its
// public `parse` surface.

import assert from "node:assert/strict";
import { test } from "node:test";
import * as OL from "@openlogo/parser";

const doc = "is-predicates.logo";
const span = (start, end) => ({ document: doc, start, end });

test("`:x is empty` is an IsPredicate whose span covers operand through the last predicate word", () => {
  const src = "print :x is empty";
  const { ast, diagnostics } = OL.parse(src, doc);

  assert.deepEqual(diagnostics, []);
  const pred = ast.body[0].args[0];
  assert.equal(pred.kind, "IsPredicate");
  assert.deepEqual(pred.source_span, span([1, 7], [1, 18]));
  assert.equal(pred.operand.kind, "VarRef");
  assert.equal(pred.operand.name, "x");
  assert.deepEqual(pred.test, { form: "empty" });
});

test("`:x is member of <collection>` records the collection expression and its own span", () => {
  const src = "print :x is member of [1 2 3]";
  const { ast, diagnostics } = OL.parse(src, doc);

  assert.deepEqual(diagnostics, []);
  const pred = ast.body[0].args[0];
  assert.equal(pred.kind, "IsPredicate");
  assert.equal(pred.test.form, "member-of");
  assert.equal(pred.test.collection.kind, "ListLit");
  assert.deepEqual(pred.test.collection.source_span, span([1, 23], [1, 30]));
  assert.deepEqual(
    pred.test.collection.elements.map((e) => e.value),
    [1, 2, 3],
  );
});

test("`:x is a <type-word>` stores the type as a WordLit, not a bare identifier", () => {
  const src = 'print :x is a "number"';
  const { ast, diagnostics } = OL.parse(src, doc);

  assert.deepEqual(diagnostics, []);
  const pred = ast.body[0].args[0];
  assert.equal(pred.test.form, "a");
  assert.equal(pred.test.type.kind, "WordLit");
  assert.equal(pred.test.type.value, "number");
  assert.deepEqual(pred.test.type.source_span, span([1, 15], [1, 23]));
});

test("`:x is between low and high` sets strict false with low/high sub-spans", () => {
  const src = "print :x is between 1 and 10";
  const { ast, diagnostics } = OL.parse(src, doc);

  assert.deepEqual(diagnostics, []);
  const pred = ast.body[0].args[0];
  assert.equal(pred.test.form, "between");
  assert.equal(pred.test.strict, false);
  assert.equal(pred.test.low.value, 1);
  assert.deepEqual(pred.test.low.source_span, span([1, 21], [1, 22]));
  assert.equal(pred.test.high.value, 10);
  assert.deepEqual(pred.test.high.source_span, span([1, 27], [1, 29]));
});

test("`:x is strictly between low and high` sets strict true", () => {
  const src = "print :x is strictly between 1 and 10";
  const { ast, diagnostics } = OL.parse(src, doc);

  assert.deepEqual(diagnostics, []);
  const pred = ast.body[0].args[0];
  assert.equal(pred.test.form, "between");
  assert.equal(pred.test.strict, true);
  assert.equal(pred.test.low.value, 1);
  assert.equal(pred.test.high.value, 10);
});

test("an is-predicate parses as an `if` condition, not only as a print argument", () => {
  const src = 'if :x is empty [ print "yes" ]';
  const { ast, diagnostics } = OL.parse(src, doc);

  assert.deepEqual(diagnostics, []);
  assert.equal(ast.body[0].kind, "If");
  const cond = ast.body[0].condition;
  assert.equal(cond.kind, "IsPredicate");
  assert.equal(cond.test.form, "empty");
});

test("an is-predicate parses as the value of a `:place = value` assignment", () => {
  const src = ":result = :x is member of [1 2 3]";
  const { ast, diagnostics } = OL.parse(src, doc);

  assert.deepEqual(diagnostics, []);
  assert.equal(ast.body[0].kind, "Assign");
  assert.equal(ast.body[0].place.base.name, "result");
  const value = ast.body[0].value;
  assert.equal(value.kind, "IsPredicate");
  assert.equal(value.test.form, "member-of");
});

test("is-predicates bind tighter than `and`/`or`: parenthesized predicates combine via `and`", () => {
  const src = 'print (5 is between 1 and 10) and (5 is a "number")';
  const { ast, diagnostics } = OL.parse(src, doc);

  assert.deepEqual(diagnostics, []);
  const call = ast.body[0].args[0];
  assert.equal(call.kind, "Call");
  assert.equal(call.callee.name, "and");
  assert.equal(call.args[0].kind, "IsPredicate");
  assert.equal(call.args[0].test.form, "between");
  assert.equal(call.args[1].kind, "IsPredicate");
  assert.equal(call.args[1].test.form, "a");
});

test("the contextual keywords `empty`, `member`, `of`, and `a` remain ordinary names outside `is` (spec/grammar.md:230)", () => {
  // None of these four are in OL_RESERVED_WORDS (only `is`, `between`, `strictly` are), so they
  // parse as plain call/variable names when not immediately following `is`.
  let { ast, diagnostics } = OL.parse("print :empty", doc);
  assert.deepEqual(diagnostics, []);
  assert.equal(ast.body[0].args[0].kind, "VarRef");
  assert.equal(ast.body[0].args[0].name, "empty");

  ({ ast, diagnostics } = OL.parse("print member", doc));
  assert.deepEqual(diagnostics, []);
  assert.equal(ast.body[0].args[0].kind, "Call");
  assert.equal(ast.body[0].args[0].callee.name, "member");

  ({ ast, diagnostics } = OL.parse("print of", doc));
  assert.deepEqual(diagnostics, []);
  assert.equal(ast.body[0].args[0].callee.name, "of");

  ({ ast, diagnostics } = OL.parse(":a = 5", doc));
  assert.deepEqual(diagnostics, []);
  assert.equal(ast.body[0].kind, "Assign");
  assert.equal(ast.body[0].place.base.name, "a");
});

test("`is` immediately followed by an unrecognized word reports ol-bad-token once and recovery keeps the operand as-is", () => {
  const src = "print :x is wibble";
  const { ast, diagnostics } = OL.parse(src, doc);

  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].code, "ol-bad-token");
  assert.equal(diagnostics[0].params.text, "wibble");
  // Recovery returns the bare operand for the first statement; `wibble` starts a fresh statement.
  assert.equal(ast.body[0].args[0].kind, "VarRef");
  assert.equal(ast.body[0].args[0].name, "x");
  assert.equal(ast.body[1].kind, "Call");
  assert.equal(ast.body[1].callee.name, "wibble");
});

// Fixed by #106/#148's end-of-parse() dedup pass: when `member` is not followed by `of` AND the
// following token also fails to start a valid collection expression (e.g. end-of-file or a
// reserved word), `parseIsPredicate`'s `member` branch still pushes an `ol-bad-token` for the
// missing `of` and then unconditionally falls into a failed collection parse that independently
// pushes a second, byte-identical `ol-bad-token` for the same token. `parse()` now collapses that
// duplicate (same code/span/params) before returning, so callers see exactly one diagnostic.
test("`is member` with no `of` and no parseable collection reports a single ol-bad-token (duplicate collapsed)", () => {
  const { diagnostics } = OL.parse("print :x is member", doc);

  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].code, "ol-bad-token");
  assert.equal(diagnostics[0].params.text, "end of file");

  // Reproduces with a reserved word in place of end-of-file too.
  const { diagnostics: diagnostics2 } = OL.parse(
    "print :x is member and 1",
    doc,
  );
  assert.equal(diagnostics2.length, 1);
  assert.equal(diagnostics2[0].params.text, "and");
});

test("`is member of` with a missing collection at end-of-file reports a single ol-bad-token (no duplication, `of` was consumed)", () => {
  const { diagnostics } = OL.parse("print :x is member of", doc);

  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].code, "ol-bad-token");
  assert.equal(diagnostics[0].params.text, "end of file");
});
