// Unit tests for the `local` binding statement (issue #56). `local` is a BINDING form, not one of
// the grammar's four declaration slots (spec/grammar.md:384,390 — maintainer ruling #833), so it
// registers nothing callable and never raises `ol-reserved-word`; `keyword-binding-forms.test.mjs`
// pins that. This file confirms the merged parser's exact AST shape for both local-statement forms
// defined by spec/grammar.md:156
// (`local-statement ::= "local" name [ "=" expression ] | "(" "local" name { name } ")"`) — a
// `Local` node whose `names` are `SpannedName`s, not colon-places or `VarRef`s, carrying the
// single-name form's optional initializer as `value` (issue #823) — plus documents, as known-gap
// unit tests (not conformance fixtures, since the M1 harness is parse-only), that using the
// keyword `local` as an ordinary identifier (procedure
// name, variable read) is accepted with zero diagnostics at the parse stage, which
// spec/grammar.md:394 states normatively: the declaration slots "admit them too — `define end` and
// `struct if` **parse**, and are then rejected by the rule above; that is precisely why
// `ol-reserved-word` is a semantic diagnostic".
//
// Runs under `node --test` against the built `@openlogo/parser` package, exercising only its
// public `parse` surface.

import assert from "node:assert/strict";
import { test } from "node:test";
import * as OL from "@openlogo/parser";

const doc = "local-variables.logo";
const span = (start, end) => ({ document: doc, start, end });

test("local x binds a single local variable as a Local node with one SpannedName", () => {
  const { ast, diagnostics } = OL.parse("local x", doc);

  assert.deepEqual(diagnostics, []);
  assert.equal(ast.body.length, 1);
  const local = ast.body[0];
  assert.equal(local.kind, "Local");
  assert.deepEqual(local.source_span, span([1, 1], [1, 8]));
  assert.equal(local.names.length, 1);
  assert.equal(local.names[0].name, "x");
  assert.deepEqual(local.names[0].source_span, span([1, 7], [1, 8]));
});

test("(local x y z) binds several local variables in one Local node", () => {
  const { ast, diagnostics } = OL.parse("(local x y z)", doc);

  assert.deepEqual(diagnostics, []);
  const local = ast.body[0];
  assert.equal(local.kind, "Local");
  assert.deepEqual(local.source_span, span([1, 1], [1, 14]));
  assert.deepEqual(
    local.names.map((n) => n.name),
    ["x", "y", "z"],
  );
  assert.deepEqual(local.names[0].source_span, span([1, 8], [1, 9]));
  assert.deepEqual(local.names[1].source_span, span([1, 10], [1, 11]));
  assert.deepEqual(local.names[2].source_span, span([1, 12], [1, 13]));
});

test("a single local x inside (local x) still produces a Local node with one name", () => {
  const { ast, diagnostics } = OL.parse("(local x)", doc);

  assert.deepEqual(diagnostics, []);
  const local = ast.body[0];
  assert.equal(local.kind, "Local");
  assert.equal(local.names.length, 1);
  assert.equal(local.names[0].name, "x");
});

test("local binds in a procedure body and the same name is usable as a colon-place afterward", () => {
  const source = "define compute\n  local x\n  :x = 1\n  return :x\nend";
  const { ast, diagnostics } = OL.parse(source, doc);

  assert.deepEqual(diagnostics, []);
  const body = ast.body[0].body.body;
  assert.equal(body[0].kind, "Local");
  assert.equal(body[0].names[0].name, "x");
  assert.equal(body[1].kind, "Assign");
  assert.equal(body[1].place.base.name, "x");
  assert.equal(body[2].kind, "Return");
  assert.equal(body[2].value.name, "x");
});

test("local x = 1 parses the initializer form: one Local node carrying the expression as `value`", () => {
  const { ast, diagnostics } = OL.parse("local x = 1", doc);

  assert.deepEqual(diagnostics, []);
  assert.equal(ast.body.length, 1);
  const local = ast.body[0];
  assert.equal(local.kind, "Local");
  assert.equal(local.names.length, 1);
  assert.equal(local.names[0].name, "x");
  // The node's span runs from `local` to the end of the initializer, not to the end of the name.
  assert.deepEqual(local.source_span, span([1, 1], [1, 12]));
  assert.equal(local.value.kind, "NumberLit");
  assert.equal(local.value.value, 1);
});

test("the initializer is a full expression, and its reads resolve like any other", () => {
  const source = "define grow :n\n  local total = :n + 1\n  return :total\nend";
  const { ast, diagnostics } = OL.parse(source, doc);

  assert.deepEqual(diagnostics, []);
  const local = ast.body[0].body.body[0];
  assert.equal(local.kind, "Local");
  assert.equal(local.value.kind, "Call");
  assert.equal(local.value.callee.name, "+");
  assert.deepEqual(OL.check(ast, { source }).diagnostics, []);
});

test("`local x` on its own line stays a complete statement — a following line's `=` is not folded into it", () => {
  // The initializer's `=` must be the very next token. Reading one across the newline would
  // silently join two instructions into one.
  const { ast, diagnostics } = OL.parse("local x\n= 1", doc);

  assert.equal(ast.body[0].kind, "Local");
  assert.equal(ast.body[0].value, undefined);
  assert.ok(diagnostics.some((d) => d.code === "ol-bad-token"));
});

test("local x = with no initializer expression reports ol-bad-token and builds no Local node", () => {
  const { ast, diagnostics } = OL.parse("local x =", doc);

  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].code, "ol-bad-token");
  assert.deepEqual(ast.body, []);
});

test("the parenthesized multi-name form takes no initializer (spec/grammar.md:156)", () => {
  const { diagnostics } = OL.parse("(local a = 1)", doc);

  assert.ok(diagnostics.length > 0);
  assert.ok(diagnostics.every((d) => d.code === "ol-bad-token"));
});

test("known gap: local :x is not the colon-place form spec/grammar.md expects only a bare name, so the colon-name token is rejected with ol-bad-token", () => {
  const { ast, diagnostics } = OL.parse("local :x", doc);

  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].code, "ol-bad-token");
  assert.deepEqual(diagnostics[0].params, { text: ":x" });
  assert.deepEqual(diagnostics[0].source_span, span([1, 7], [1, 9]));

  // parseLocal aborts without consuming ":x", so no Local node is produced; the top-level
  // statement loop resyncs and reads ":x" as a plain variable-read expression statement instead.
  assert.equal(ast.body.length, 1);
  assert.equal(ast.body[0].kind, "VarRef");
  assert.equal(ast.body[0].name, "x");
});

test("known gap: (local) with zero names reports ol-bad-token at the closing paren instead of rejecting the empty binder list up front", () => {
  const { ast, diagnostics } = OL.parse("(local)", doc);

  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].code, "ol-bad-token");
  assert.deepEqual(diagnostics[0].params, { text: ")" });

  const local = ast.body[0];
  assert.equal(local.kind, "Local");
  assert.deepEqual(local.names, []);
});

test("local is a keyword per spec/grammar.md:371, and the reader still admits it as an identifier — the rejection is semantic, not lexical", () => {
  const asVarRead = OL.parse("print :local", doc);
  assert.deepEqual(asVarRead.diagnostics, []);
  assert.equal(asVarRead.ast.body[0].args[0].kind, "VarRef");
  assert.equal(asVarRead.ast.body[0].args[0].name, "local");

  const asProcName = OL.parse("define local\nend", doc);
  assert.deepEqual(asProcName.diagnostics, []);
  assert.equal(asProcName.ast.body[0].kind, "ProcedureDef");
  assert.equal(asProcName.ast.body[0].name.name, "local");
  // The two halves diverge only at the semantic stage, and for different reasons. `print :local` is
  // a variable READ, so what the checker says about it depends on whether `local` is bound — an
  // unbound read raises `ol-undefined-var` (`spec/error-model.md`), exactly as any other unbound
  // name would; the keyword spelling changes nothing either way. `define local` is a DECLARATION
  // slot and raises `ol-reserved-word` from `checker-reserved-word.ts` regardless of any binding.
  // That both spellings still *parse* is what `declared-callable-name` expanding to plain
  // `identifier` buys (spec/grammar.md:167,394). Binding positions proper — `local local`,
  // `:local = 1` — are pinned in `keyword-binding-forms.test.mjs`.
});
