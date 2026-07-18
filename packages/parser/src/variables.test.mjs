// Unit tests for variable reads and places (issue #48). These target AST shapes NOT already
// asserted by parse.test.mjs: the VarRef-vs-Place distinction for a bare `:name` read, dotted
// colon-place segments on both a read and a `=` assignment, and bare places after `set … to`
// (simple and dotted) — per spec/grammar.md:103-108,244 assignment always goes through a
// colon-place, while a bare place only ever appears between `set` and `to`.
//
// Runs under `node --test` against the built `@openlogo/parser` package, exercising only its
// public `parse` surface.

import assert from "node:assert/strict";
import { test } from "node:test";
import * as OL from "@openlogo/parser";

const doc = "variables.logo";
const span = (start, end) => ({ document: doc, start, end });

test("a bare :x read stays a VarRef, not a Place", () => {
  const { ast, diagnostics } = OL.parse("print :x", doc);

  assert.deepEqual(diagnostics, []);
  const arg = ast.body[0].args[0];
  assert.equal(arg.kind, "VarRef");
  assert.equal(arg.name, "x");
  assert.deepEqual(arg.source_span, span([1, 7], [1, 9]));
});

test("a dotted colon read :people.tom.age grows into a Place with two field segments", () => {
  const { ast, diagnostics } = OL.parse("print :people.tom.age", doc);

  assert.deepEqual(diagnostics, []);
  const place = ast.body[0].args[0];
  assert.equal(place.kind, "Place");
  assert.equal(place.base.name, "people");
  assert.deepEqual(place.base.source_span, span([1, 7], [1, 14]));
  assert.equal(place.segments.length, 2);

  const [tom, age] = place.segments;
  assert.equal(tom.kind, "field");
  assert.equal(tom.name.name, "tom");
  assert.deepEqual(tom.name.source_span, span([1, 15], [1, 18]));
  assert.equal(age.kind, "field");
  assert.equal(age.name.name, "age");
  assert.deepEqual(age.name.source_span, span([1, 19], [1, 22]));
  assert.deepEqual(place.source_span, span([1, 7], [1, 22]));
});

test("a dotted colon assignment :people.tom.age = 9 carries the same segments on an equals-form Assign", () => {
  const { ast, diagnostics } = OL.parse(":people.tom.age = 9", doc);

  assert.deepEqual(diagnostics, []);
  const assign = ast.body[0];
  assert.equal(assign.kind, "Assign");
  assert.equal(assign.form, "equals");
  assert.equal(assign.place.kind, "Place");
  assert.equal(assign.place.base.name, "people");
  assert.equal(assign.place.segments.length, 2);
  assert.equal(assign.place.segments[0].name.name, "tom");
  assert.equal(assign.place.segments[1].name.name, "age");
  assert.equal(assign.value.value, 9);
});

test("a bare place after set ... to parses as a set-form Assign with no segments", () => {
  const { ast, diagnostics } = OL.parse("set x to 100", doc);

  assert.deepEqual(diagnostics, []);
  const assign = ast.body[0];
  assert.equal(assign.kind, "Assign");
  assert.equal(assign.form, "set");
  assert.equal(assign.place.kind, "Place");
  assert.equal(assign.place.base.name, "x");
  assert.deepEqual(assign.place.segments, []);
  assert.equal(assign.value.value, 100);
});

test("a dotted bare place after set ... to shares field-segment parsing with the colon form", () => {
  const { ast, diagnostics } = OL.parse("set people.tom.age to 9", doc);

  assert.deepEqual(diagnostics, []);
  const assign = ast.body[0];
  assert.equal(assign.kind, "Assign");
  assert.equal(assign.form, "set");
  assert.equal(assign.place.base.name, "people");
  assert.equal(assign.place.segments.length, 2);
  assert.equal(assign.place.segments[0].name.name, "tom");
  assert.equal(assign.place.segments[1].name.name, "age");
  assert.equal(assign.value.value, 9);
});
