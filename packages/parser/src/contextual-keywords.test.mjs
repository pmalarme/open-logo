// Unit tests for the contextual keywords `empty`, `member`, `of`, and `a` in DECLARATION positions
// (issue #65), per spec/grammar.md:230,352-369. The existing corpus already proves these four words
// in their predicate-keyword role (is-predicate-forms/-contexts) and as a var read / call name /
// assignment target at the parse layer (is-predicate-contextual-keywords, is-predicates.test.mjs).
// This file targets what that leaves untested: the four words used where a RESERVED word would raise
// `ol-reserved-word` (issue #113) — as a `define` procedure name, a `for` binder, and a `local` name
// — proving the parser accepts them as ordinary names there (exact AST kinds/spans), plus the
// checker staying silent on those declarations, and the reader disambiguating the SAME word by
// grammatical position (variable vs. predicate keyword) within one program.
//
// Runs under `node --test` against the built `@openlogo/parser` package, exercising only its public
// `parse` and `check` surface. Asserts identity (AST kinds/names/spans, diagnostic codes) only.

import assert from "node:assert/strict";
import { test } from "node:test";
import * as OL from "@openlogo/parser";

const doc = "contextual-keywords.logo";
const span = (start, end) => ({ document: doc, start, end });
const core = { profiles: ["core-language"], source: "" };

test("a contextual keyword is a legal `define` procedure name (not ol-reserved-word)", () => {
  const src = "define empty :x\n  print :x\nend";
  const { ast, diagnostics } = OL.parse(src, doc);

  assert.deepEqual(diagnostics, []);
  const def = ast.body[0];
  assert.equal(def.kind, "ProcedureDef");
  assert.equal(def.name.name, "empty");
  assert.deepEqual(def.name.source_span, span([1, 8], [1, 13]));

  const { diagnostics: checked } = OL.check(ast, { ...core, source: src });
  assert.deepEqual(checked, []);
});

test("all four contextual keywords define and call cleanly through the checker", () => {
  const src =
    "define empty :x\n  print :x\nend\n" +
    "define member :x\n  print :x\nend\n" +
    "define of :x\n  print :x\nend\n" +
    "define a :x\n  print :x\nend\n" +
    "empty 1\nmember 2\nof 3\na 4";
  const { ast, diagnostics } = OL.parse(src, doc);

  assert.deepEqual(diagnostics, []);
  const definedNames = ast.body
    .filter((node) => node.kind === "ProcedureDef")
    .map((node) => node.name.name);
  assert.deepEqual(definedNames, ["empty", "member", "of", "a"]);

  const calledNames = ast.body
    .filter((node) => node.kind === "Call")
    .map((node) => node.callee.name);
  assert.deepEqual(calledNames, ["empty", "member", "of", "a"]);

  const { diagnostics: checked } = OL.check(ast, { ...core, source: src });
  assert.deepEqual(checked, []);
});

test("a contextual keyword is a legal `for ... in` binder", () => {
  const src = "for empty in [1 2 3] [ print :empty ]";
  const { ast, diagnostics } = OL.parse(src, doc);

  assert.deepEqual(diagnostics, []);
  const loop = ast.body[0];
  assert.equal(loop.kind, "ForIn");
  assert.equal(loop.binder.name, "empty");
  assert.deepEqual(loop.binder.source_span, span([1, 5], [1, 10]));
  assert.equal(loop.body.body[0].args[0].kind, "VarRef");
  assert.equal(loop.body.body[0].args[0].name, "empty");
});

test("a contextual keyword is a legal `for ... from ... to` counter variable", () => {
  const src = "for member from 1 to 3 [ print :member ]";
  const { ast, diagnostics } = OL.parse(src, doc);

  assert.deepEqual(diagnostics, []);
  const loop = ast.body[0];
  assert.equal(loop.kind, "ForRange");
  assert.equal(loop.variable.name, "member");
  assert.deepEqual(loop.variable.source_span, span([1, 5], [1, 11]));
});

test("a contextual keyword is a legal `local` name and resolves when read", () => {
  const src = "local of\n:of = 5\nprint :of";
  const { ast, diagnostics } = OL.parse(src, doc);

  assert.deepEqual(diagnostics, []);
  const local = ast.body[0];
  assert.equal(local.kind, "Local");
  assert.equal(local.names[0].name, "of");
  assert.deepEqual(local.names[0].source_span, span([1, 7], [1, 9]));

  const { diagnostics: checked } = OL.check(ast, { ...core, source: src });
  assert.deepEqual(checked, []);
});

test("the reader disambiguates the same word by position: `:empty` is a variable, `is empty` is the predicate", () => {
  const src = ":empty = [1 2 3]\nprint :empty is empty";
  const { ast, diagnostics } = OL.parse(src, doc);

  assert.deepEqual(diagnostics, []);
  const assignTarget = ast.body[0];
  assert.equal(assignTarget.kind, "Assign");
  assert.equal(assignTarget.place.base.name, "empty");

  const predicate = ast.body[1].args[0];
  assert.equal(predicate.kind, "IsPredicate");
  assert.equal(predicate.operand.kind, "VarRef");
  assert.equal(predicate.operand.name, "empty");
  assert.deepEqual(predicate.test, { form: "empty" });
});

test("`is member of :member` reads a variable named `member` as the collection", () => {
  const src = ":member = [4 5 6]\nprint 5 is member of :member";
  const { ast, diagnostics } = OL.parse(src, doc);

  assert.deepEqual(diagnostics, []);
  const predicate = ast.body[1].args[0];
  assert.equal(predicate.kind, "IsPredicate");
  assert.equal(predicate.test.form, "member-of");
  assert.equal(predicate.test.collection.kind, "VarRef");
  assert.equal(predicate.test.collection.name, "member");
});
