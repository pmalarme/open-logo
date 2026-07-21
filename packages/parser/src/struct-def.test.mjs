// Unit tests for the Data-profile struct declaration grammar (issue #321):
// `spec/grammar.md:155-156`'s `struct-declaration ::= "struct" type-name field-list` and
// `field-list ::= "[" identifier { identifier } "]"` (`spec/data-structures.md:252-266`). This
// slice is parse/AST only — the constructor call and field access/mutation are a later
// Data-profile slice. A `struct` declaration parses into its own `StructDef` statement node (never
// a `Call`), the type name and field names are carried as spanned metadata, and a malformed
// declaration (missing type name, missing/empty/unclosed field list, a non-identifier field)
// reports a syntax diagnostic instead of silently falling through to a call.

import assert from "node:assert/strict";
import { test } from "node:test";
import * as OL from "@openlogo/parser";

const doc = "struct-def.logo";
const parse = (src) => OL.parse(src, doc);
const codesOf = (src) => parse(src).diagnostics.map((d) => d.code);
/** The first parsed statement node of `src`. */
const first = (src) => parse(src).ast.body[0];
/** Does any top-level statement of `src` parse into a StructDef node? */
const hasStructDef = (src) =>
  parse(src).ast.body.some((node) => node.kind === "StructDef");

// --- clean declarations ----------------------------------------------------

test("`struct point [ x y ]` parses into a StructDef node, not a Call", () => {
  const node = first("struct point [ x y ]");
  assert.equal(node.kind, "StructDef");
  assert.equal(node.name.name, "point");
  assert.equal(node.fields.length, 2);
  assert.deepEqual(
    node.fields.map((f) => f.name),
    ["x", "y"],
  );
  assert.deepEqual(codesOf("struct point [ x y ]"), []);
});

test("a StructDef carries spans for the type name and each field", () => {
  const node = first("struct point [ x y ]");
  assert.deepEqual(node.name.source_span.start, [1, 8]);
  assert.deepEqual(node.name.source_span.end, [1, 13]);
  assert.deepEqual(node.fields[0].source_span.start, [1, 16]);
  assert.deepEqual(node.fields[0].source_span.end, [1, 17]);
  assert.deepEqual(node.fields[1].source_span.start, [1, 18]);
  assert.deepEqual(node.fields[1].source_span.end, [1, 19]);
});

test("a StructDef's span covers the whole declaration, from `struct` to `]`", () => {
  const node = first("struct point [ x y ]");
  assert.deepEqual(node.source_span.start, [1, 1]);
  assert.deepEqual(node.source_span.end, [1, 21]);
});

test("`struct color [ r ]` accepts a single-field record", () => {
  const node = first("struct color [ r ]");
  assert.equal(node.kind, "StructDef");
  assert.equal(node.fields.length, 1);
  assert.equal(node.fields[0].name, "r");
  assert.deepEqual(codesOf("struct color [ r ]"), []);
});

test("two struct declarations on their own lines both parse cleanly", () => {
  const program = parse("struct a [ x ]\nstruct b [ y z ]").ast;
  assert.equal(program.body.length, 2);
  assert.equal(program.body[0].kind, "StructDef");
  assert.equal(program.body[0].name.name, "a");
  assert.equal(program.body[1].kind, "StructDef");
  assert.deepEqual(
    program.body[1].fields.map((f) => f.name),
    ["y", "z"],
  );
  assert.deepEqual(codesOf("struct a [ x ]\nstruct b [ y z ]"), []);
});

// --- malformed declarations ------------------------------------------------

test("`struct [ x ]` (missing type name) reports ol-bad-token and no StructDef", () => {
  assert.ok(codesOf("struct [ x ]").includes("ol-bad-token"));
  assert.equal(hasStructDef("struct [ x ]"), false);
});

test("`struct point` (missing field list) reports ol-bad-token", () => {
  assert.ok(codesOf("struct point").includes("ol-bad-token"));
  assert.equal(hasStructDef("struct point"), false);
});

test("`struct point [ ]` (empty field list) reports ol-unmatched-bracket, once", () => {
  assert.deepEqual(codesOf("struct point [ ]"), ["ol-unmatched-bracket"]);
  assert.equal(hasStructDef("struct point [ ]"), false);
});

test("`struct point [ x y` (unclosed field list) reports ol-unmatched-bracket", () => {
  assert.ok(codesOf("struct point [ x y").includes("ol-unmatched-bracket"));
  assert.equal(hasStructDef("struct point [ x y"), false);
});

test("`struct point [ x\\nprint 1` closes the unclosed list at the line break", () => {
  const { ast, diagnostics } = parse("struct point [ x\nprint 1");
  assert.deepEqual(
    diagnostics.map((d) => d.code),
    ["ol-unmatched-bracket"],
  );
  // The unclosed struct yields no node; the next line still parses as its own statement.
  assert.equal(
    ast.body.some((node) => node.kind === "StructDef"),
    false,
  );
  assert.equal(ast.body.at(-1).kind, "Call");
});

test("a non-identifier field reports ol-bad-token and recovers through the `]`", () => {
  // `3` is not an identifier, so it interrupts the field list; the stray token is flagged and
  // the parser consumes up to the matching `]`, leaving no phantom statement behind it.
  assert.deepEqual(codesOf("struct point [ x 3 ]"), ["ol-bad-token"]);
  assert.equal(hasStructDef("struct point [ x 3 ]"), false);
});

test("a bad first field reports ol-bad-token and recovers through the `]`", () => {
  assert.deepEqual(codesOf("struct point [ 3 ]"), ["ol-bad-token"]);
  assert.equal(hasStructDef("struct point [ 3 ]"), false);
});

test("a bad field with no closing `]` reports ol-bad-token, once, at end of input", () => {
  assert.deepEqual(codesOf("struct point [ x 3"), ["ol-bad-token"]);
  assert.equal(hasStructDef("struct point [ x 3"), false);
});

test("a bad field before a line break recovers without swallowing the next line", () => {
  const { ast, diagnostics } = parse("struct point [ x 3\nprint 1");
  assert.deepEqual(
    diagnostics.map((d) => d.code),
    ["ol-bad-token"],
  );
  assert.equal(
    ast.body.some((node) => node.kind === "StructDef"),
    false,
  );
  assert.equal(ast.body.at(-1).kind, "Call");
});

// --- walk / childrenOf -----------------------------------------------------

test("walk visits the StructDef node but descends into no field metadata", () => {
  const kinds = [];
  OL.walk(parse("struct point [ x y ]").ast, (node) => {
    kinds.push(node.kind);
  });
  // Program + StructDef only: the field names are spanned metadata, not walkable nodes.
  assert.deepEqual(kinds, ["Program", "StructDef"]);
});

test("the semantic checker accepts a well-formed struct declaration cleanly", () => {
  const { diagnostics } = OL.check(parse("struct point [ x y ]").ast, {
    profiles: ["core-language", "data"],
  });
  assert.deepEqual(diagnostics, []);
});

// --- factory ---------------------------------------------------------------

test("ast.structDef builds an immutable spanned node", () => {
  const span = { document: doc, start: [1, 1], end: [1, 21] };
  const nameSpan = { document: doc, start: [1, 8], end: [1, 13] };
  const fieldSpan = { document: doc, start: [1, 16], end: [1, 17] };
  const node = OL.ast.structDef(
    { name: "point", source_span: nameSpan },
    [{ name: "x", source_span: fieldSpan }],
    span,
  );
  assert.equal(node.kind, "StructDef");
  assert.equal(node.name.name, "point");
  assert.equal(node.fields[0].name, "x");
  assert.deepEqual(node.source_span, span);
  assert.ok(OL.OL_NODE_KINDS.includes(node.kind));
});
