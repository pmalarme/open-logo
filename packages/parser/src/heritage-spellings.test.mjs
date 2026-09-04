// Unit tests for the Heritage assignment/procedure/return spellings — `make`, `to … end`, and
// `output`/`op` — slice H2 (issue #667) of the Heritage epic. Two concerns are proven here:
//
//   1. PARSING — `to … end` lowers to the same `ProcedureDef` node as `define … end` (discriminated
//      by `keyword: "to"`), and `output`/`op` lower to the same `Return` node as `return`
//      (discriminated by `keyword`). Heritage adds no new grammar shape, only alternate spellings
//      (spec/conformance.md#heritage, spec/grammar.md:147,151).
//
//   2. THE FORM-HEAD PROFILE GATE — the net-new checker rule (`checker-heritage-form.ts`) that
//      closes the silent-regression trap from issue #151: with the Heritage profile INACTIVE, each
//      of `make`/`to`/`output`/`op` is rejected with `ol-unknown-command`; with Heritage ACTIVE,
//      all four are accepted silently. `make` already parsed since #151 but nothing rejected it in
//      Core — this gate is what discharges that gap (M5 saga audit #696).
//
// Spans are half-open `[start, end)` with 1-based `[line, column]` positions, per @openlogo/core.

import assert from "node:assert/strict";
import { test } from "node:test";
import * as OL from "@openlogo/parser";

const doc = "heritage.logo";
const span = (start, end) => ({ document: doc, start, end });

// The profile set every "Heritage active" case uses: Heritage depends on Data
// (spec/conformance.md#heritage), and turtle-rendering makes `forward` visible so bodies that draw
// don't trip an unrelated ol-unknown-command.
const HERITAGE_ACTIVE = [
  "core-language",
  "turtle-rendering",
  "data",
  "heritage",
];
const CORE_ONLY = ["core-language", "turtle-rendering"];

function parseClean(source) {
  const { ast, diagnostics } = OL.parse(source, doc);
  assert.deepEqual(
    diagnostics,
    [],
    `expected a clean parse for ${JSON.stringify(source)}`,
  );
  return ast;
}

// ---------------------------------------------------------------------------
// Parsing: `to … end`
// ---------------------------------------------------------------------------

test("`to name … end` parses to a ProcedureDef with keyword 'to', identical shape to `define`", () => {
  const ast = parseClean("to greet\n  print 1\nend\n");
  const def = ast.body[0];
  assert.equal(def.kind, "ProcedureDef");
  assert.equal(def.keyword, "to");
  assert.equal(def.name.name, "greet");
  assert.deepEqual(def.params, []);
  assert.equal(def.body.kind, "Block");
  assert.equal(def.body.body[0].callee.name, "print");
});

test("`to name :param … end` registers a callable arity so a later bare call groups its args", () => {
  const ast = parseClean("to square :n\n  return :n\nend\nprint square 5\n");
  const def = ast.body[0];
  assert.equal(def.keyword, "to");
  assert.equal(def.params.length, 1);
  assert.equal(def.params[0].name.name, "n");
  // The trailing `print square 5` must read `square 5` as a one-arg call, not `square` (0-arg)
  // plus a stray `5` — proving `to` registered the arity exactly as `define` would.
  const printed = ast.body[1];
  assert.equal(printed.callee.name, "print");
  const call = printed.args[0];
  assert.equal(call.kind, "Call");
  assert.equal(call.callee.name, "square");
  assert.equal(call.args.length, 1);
  assert.equal(call.args[0].value, 5);
});

test("a `to` opener that begins an inline block body registers arity, matching nested `define`", () => {
  // Regression for the block-body statement start: a procedure opener directly after `[` (with no
  // intervening newline) is still statement-leading, so `to` must register its arity there exactly
  // as `define` does. Otherwise `dbl 5` inside the block would read `dbl` (0-arg) plus a stray `5`.
  const toBody = parseClean("repeat 1 [to dbl :n\n  return :n\nend\ndbl 5]\n")
    .body[0].body.body;
  const defBody = parseClean(
    "repeat 1 [define dbl :n\n  return :n\nend\ndbl 5]\n",
  ).body[0].body.body;
  for (const body of [toBody, defBody]) {
    const call = body[1];
    assert.equal(call.kind, "Call");
    assert.equal(call.callee.name, "dbl");
    assert.equal(call.args.length, 1);
    assert.equal(call.args[0].value, 5);
  }
});

test("a `to` procedure closes with `end` or `end define`, never `end to`", () => {
  // spec/grammar.md:150 — `define-end ::= "end" [ "define" ]` is shared by both spellings.
  parseClean("to greet\n  print 1\nend define\n");
  const { diagnostics } = OL.parse("to greet\n  print 1\nend to\n", doc);
  assert.ok(diagnostics.length > 0, "`end to` is not a valid procedure close");
});

// ---------------------------------------------------------------------------
// Parsing: `output` / `op`
// ---------------------------------------------------------------------------

test("`output value` parses to a Return node with keyword 'output'", () => {
  const ast = parseClean("define f\n  output 5\nend\n");
  const ret = ast.body[0].body.body[0];
  assert.equal(ret.kind, "Return");
  assert.equal(ret.keyword, "output");
  assert.equal(ret.value.value, 5);
});

test("`op value` parses to a Return node with keyword 'op'", () => {
  const ast = parseClean("define f\n  op 5\nend\n");
  const ret = ast.body[0].body.body[0];
  assert.equal(ret.kind, "Return");
  assert.equal(ret.keyword, "op");
  assert.equal(ret.value.value, 5);
});

test("`return value` still parses to a Return node with keyword 'return' (Core unchanged)", () => {
  const ast = parseClean("define f\n  return 5\nend\n");
  const ret = ast.body[0].body.body[0];
  assert.equal(ret.kind, "Return");
  assert.equal(ret.keyword, "return");
});

// ---------------------------------------------------------------------------
// `to` in its three non-Heritage roles must NOT become a ProcedureDef
// ---------------------------------------------------------------------------

test("`to` as the `for … from … to` bound is not a procedure opener", () => {
  const ast = parseClean("for i from 1 to 3\n  print :i\nend for\n");
  assert.equal(ast.body[0].kind, "ForRange");
});

test("`to` as the `set … to` preposition is not a procedure opener", () => {
  const ast = parseClean("local x\nset x to 5\nprint :x\n");
  assert.equal(ast.body[1].kind, "Assign");
});

test("`to` NOT followed by a name is not a procedure opener (error-recovery fall-through)", () => {
  // `set :x to 100` is invalid (`set` needs a bare place, not `:x`); after recovery rejects `:x`,
  // the reader reaches `to`. Because `to` is a contextual keyword, it opens a procedure ONLY when
  // a name follows — here `100` follows, so `to` must fall through to generic token handling and
  // NOT mis-enter procedure parsing (which would cascade a spurious diagnostic on `100`).
  const { diagnostics } = OL.parse("set :x to 100\n", doc);
  const badTokens = diagnostics.filter((d) => d.code === "ol-bad-token");
  assert.deepEqual(
    badTokens.map((d) => d.params.text),
    [":x", "to"],
  );
});

// ---------------------------------------------------------------------------
// The form-head profile gate (the silent-regression trap)
// ---------------------------------------------------------------------------

function checkSource(source, profiles) {
  const ast = parseClean(source);
  return OL.check(ast, { profiles }).diagnostics;
}

test("Core rejects `make` (the #151 silent-regression trap this slice closes)", () => {
  const [finding, ...rest] = checkSource('make "size" 120\n', CORE_ONLY);
  assert.deepEqual(rest, []);
  assert.equal(finding.code, "ol-unknown-command");
  assert.equal(finding.stage, "semantic");
  assert.equal(finding.severity, "error");
  assert.deepEqual(finding.params, { name: "make", suggestion: "set" });
  assert.equal(finding.message, "i don't know how to make. did you mean set?");
  assert.deepEqual(finding.source_span, span([1, 1], [1, 5]));
});

test("Core rejects `to` and points at `define`", () => {
  const [finding, ...rest] = checkSource(
    "to box\n  forward 10\nend\n",
    CORE_ONLY,
  );
  assert.deepEqual(rest, []);
  assert.equal(finding.code, "ol-unknown-command");
  assert.deepEqual(finding.params, { name: "to", suggestion: "define" });
  assert.deepEqual(finding.source_span, span([1, 1], [1, 3]));
});

test("Core rejects `output` and points at `return`", () => {
  const [finding, ...rest] = checkSource(
    "define f\n  output 5\nend\n",
    CORE_ONLY,
  );
  assert.deepEqual(rest, []);
  assert.deepEqual(finding.params, { name: "output", suggestion: "return" });
  assert.deepEqual(finding.source_span, span([2, 3], [2, 9]));
});

test("Core rejects `op` and points at `return`", () => {
  const [finding, ...rest] = checkSource("define f\n  op 5\nend\n", CORE_ONLY);
  assert.deepEqual(rest, []);
  assert.deepEqual(finding.params, { name: "op", suggestion: "return" });
  assert.deepEqual(finding.source_span, span([2, 3], [2, 5]));
});

test("Heritage active accepts `make` silently", () => {
  assert.deepEqual(checkSource('make "size" 120\n', HERITAGE_ACTIVE), []);
});

test("Heritage active accepts `to … end` silently", () => {
  assert.deepEqual(
    checkSource("to box\n  forward 10\nend\n", HERITAGE_ACTIVE),
    [],
  );
});

test("Heritage active accepts `output` and `op` silently", () => {
  assert.deepEqual(
    checkSource("define f\n  output 5\nend\n", HERITAGE_ACTIVE),
    [],
  );
  assert.deepEqual(checkSource("define f\n  op 5\nend\n", HERITAGE_ACTIVE), []);
});

test("the gate reports every Heritage head in a program, one diagnostic each", () => {
  const source = 'make "x" 1\nto f\n  op 5\nend\n';
  const codes = checkSource(source, CORE_ONLY).map((d) => d.params.name);
  assert.deepEqual(codes.sort(), ["make", "op", "to"]);
});

test("a Core-only program with the Core spellings is never flagged by the gate", () => {
  const source = "set size to 120\ndefine f\n  return 5\nend\n:x = 1\n";
  assert.deepEqual(checkSource(source, CORE_ONLY), []);
});
