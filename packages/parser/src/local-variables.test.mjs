// Unit tests for the `local` declaration statement (issue #56). Confirms the merged parser's
// exact AST shape for both local-statement forms defined by spec/grammar.md:153
// (`local-statement ::= "local" name | "(" "local" name { name } ")"`) — a `Local` node whose
// `names` are `SpannedName`s, not colon-places or `VarRef`s — plus documents, as known-gap unit
// tests (not conformance fixtures, since the M1 harness is parse-only and the merged parser has
// no semantic checker), that: (a) an initializer form `local x = 1` is not supported — the
// parser stops after the bare name and reports `ol-bad-token` at `=`; and (b) using the reserved
// word `local` as an ordinary identifier (procedure name, variable read) is accepted with zero
// diagnostics at the parse stage even though spec/grammar.md:367 reserves it, because
// `ol-reserved-word` is a semantic-stage diagnostic (spec/error-model.md) not yet emitted by any
// merged checker.
//
// Runs under `node --test` against the built `@openlogo/parser` package, exercising only its
// public `parse` surface.

import assert from "node:assert/strict";
import { test } from "node:test";
import * as OL from "@openlogo/parser";

const doc = "local-variables.logo";
const span = (start, end) => ({ document: doc, start, end });

test("local x declares a single local variable as a Local node with one SpannedName", () => {
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

test("(local x y z) declares several local variables in one Local node", () => {
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

test("local declares in a procedure body and the same name is usable as a colon-place afterward", () => {
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

test("known gap: local has no initializer form — local x = 1 parses only the bare declaration, then reports ol-bad-token at '='", () => {
  const { ast, diagnostics } = OL.parse("local x = 1", doc);

  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].code, "ol-bad-token");
  assert.deepEqual(diagnostics[0].params, { text: "=" });
  assert.deepEqual(diagnostics[0].source_span, span([1, 9], [1, 10]));

  // The declaration itself still parses as a valid, single-name Local node.
  const local = ast.body[0];
  assert.equal(local.kind, "Local");
  assert.equal(local.names.length, 1);
  assert.equal(local.names[0].name, "x");
  // The stray "= 1" is resynced as an unrelated NumberLit expression statement, confirming the
  // parser does not fold it into the Local node.
  assert.equal(ast.body[1].kind, "NumberLit");
  assert.equal(ast.body[1].value, 1);
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

test("known gap: local is a reserved word per spec/grammar.md:356,367 but the merged parser has no semantic checker, so using it as an ordinary identifier is accepted with zero diagnostics at the parse stage", () => {
  const asVarRead = OL.parse("print :local", doc);
  assert.deepEqual(asVarRead.diagnostics, []);
  assert.equal(asVarRead.ast.body[0].args[0].kind, "VarRef");
  assert.equal(asVarRead.ast.body[0].args[0].name, "local");

  const asProcName = OL.parse("define local\nend", doc);
  assert.deepEqual(asProcName.diagnostics, []);
  assert.equal(asProcName.ast.body[0].kind, "ProcedureDef");
  assert.equal(asProcName.ast.body[0].name.name, "local");
  // ol-reserved-word (spec/error-model.md) is a semantic-stage diagnostic; no checker is merged
  // yet, so this collision is not flagged. Tracked as expected M1 scope, not a new bug — see
  // AGENTS.md's Core-Language build order and the harness note in scripts/harness/index.mjs that
  // produce() only calls parse().
});
