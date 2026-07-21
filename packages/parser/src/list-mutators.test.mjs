// Unit tests for the Data-profile list-mutator statement grammar (issue #187):
// `spec/grammar.md:113-117`'s `add-statement`, `remove-statement`, `remove-key-statement`,
// `insert-statement`, and `clear-statement`. This slice is parse/AST only — no runtime evaluation
// (that is a separate Data-profile slice). Each mutator parses into its own statement node, never a
// `Call`, and a malformed mutator (a missing `to`/`from`/`in`/`at` separator, or a missing operand)
// reports a syntax diagnostic instead of silently falling through to a call.

import assert from "node:assert/strict";
import { test } from "node:test";
import * as OL from "@openlogo/parser";

const doc = "list-mutators.logo";
const parse = (src) => OL.parse(src, doc);
const codesOf = (src) => parse(src).diagnostics.map((d) => d.code);
/** The first parsed statement node of `src`. */
const first = (src) => parse(src).ast.body[0];
/** The `ol-*` codes `check()` reports for `src` (Data profile active). */
const checkCodesOf = (src) =>
  OL.check(parse(src).ast).diagnostics.map((d) => d.code);

// --- add -------------------------------------------------------------------

test("`add 4 to :nums` parses into an Add node (value then target), not a Call", () => {
  const node = first("add 4 to :nums");
  assert.equal(node.kind, "Add");
  assert.equal(node.value.kind, "NumberLit");
  assert.equal(node.value.value, 4);
  assert.equal(node.target.kind, "VarRef");
  assert.equal(node.target.name, "nums");
  assert.deepEqual(codesOf("add 4 to :nums"), []);
});

test("an Add node's span covers the whole statement, from `add` to its target", () => {
  const node = first("add 4 to :nums");
  assert.deepEqual(node.source_span.start, [1, 1]);
  assert.deepEqual(node.source_span.end, [1, 15]);
});

test("`add` accepts a compound value expression before `to`", () => {
  const node = first("add first :queue to :nums");
  assert.equal(node.kind, "Add");
  assert.equal(node.value.kind, "Call");
  assert.equal(node.value.callee.name, "first");
  assert.equal(node.target.name, "nums");
});

test("`add 4 :nums` (missing `to`) reports ol-bad-token and never becomes an Add or a call", () => {
  const codes = codesOf("add 4 :nums");
  assert.ok(codes.includes("ol-bad-token"));
  for (const node of parse("add 4 :nums").ast.body) {
    assert.notEqual(node.kind, "Add");
    assert.notEqual(node.kind, "Call");
  }
});

test("`add` with no value reports ol-bad-token", () => {
  assert.deepEqual(codesOf("add"), ["ol-bad-token"]);
});

test("`add 4 to` with no target reports ol-bad-token", () => {
  assert.deepEqual(codesOf("add 4 to"), ["ol-bad-token"]);
});

// --- remove (by value) -----------------------------------------------------

test("`remove 2 from :nums` parses into a Remove node", () => {
  const node = first("remove 2 from :nums");
  assert.equal(node.kind, "Remove");
  assert.equal(node.value.kind, "NumberLit");
  assert.equal(node.value.value, 2);
  assert.equal(node.target.kind, "VarRef");
  assert.equal(node.target.name, "nums");
  assert.deepEqual(codesOf("remove 2 from :nums"), []);
});

test("`remove` with no value reports ol-bad-token", () => {
  assert.deepEqual(codesOf("remove"), ["ol-bad-token"]);
});

test("`remove 2 :nums` (missing `from`) reports ol-bad-token", () => {
  assert.ok(codesOf("remove 2 :nums").includes("ol-bad-token"));
});

test("`remove 2 from` with no target reports ol-bad-token", () => {
  assert.deepEqual(codesOf("remove 2 from"), ["ol-bad-token"]);
});

// --- remove key (by key) ---------------------------------------------------

test("`remove key sophie from :ages` parses into a distinct RemoveKey node", () => {
  const node = first("remove key sophie from :ages");
  assert.equal(node.kind, "RemoveKey");
  // A bare identifier key-term is a literal word, not a variable read.
  assert.equal(node.key.kind, "WordLit");
  assert.equal(node.key.value, "sophie");
  assert.equal(node.target.kind, "VarRef");
  assert.equal(node.target.name, "ages");
  assert.deepEqual(codesOf("remove key sophie from :ages"), []);
});

test("`remove key` accepts a `:name` key-term read", () => {
  const node = first("remove key :who from :ages");
  assert.equal(node.kind, "RemoveKey");
  assert.equal(node.key.kind, "VarRef");
  assert.equal(node.key.name, "who");
});

test("`remove key` with no key-term reports ol-bad-token", () => {
  assert.deepEqual(codesOf("remove key"), ["ol-bad-token"]);
});

test("`remove key sophie :ages` (missing `from`) reports ol-bad-token", () => {
  assert.ok(codesOf("remove key sophie :ages").includes("ol-bad-token"));
});

test("`remove key sophie from` with no target reports ol-bad-token", () => {
  assert.deepEqual(codesOf("remove key sophie from"), ["ol-bad-token"]);
});

// --- insert ----------------------------------------------------------------

test("`insert 9 in :nums at 2` parses into an Insert node (value, target, index)", () => {
  const node = first("insert 9 in :nums at 2");
  assert.equal(node.kind, "Insert");
  assert.equal(node.value.kind, "NumberLit");
  assert.equal(node.value.value, 9);
  assert.equal(node.target.kind, "VarRef");
  assert.equal(node.target.name, "nums");
  assert.equal(node.index.kind, "NumberLit");
  assert.equal(node.index.value, 2);
  assert.deepEqual(codesOf("insert 9 in :nums at 2"), []);
});

test("`insert` with no value reports ol-bad-token", () => {
  assert.deepEqual(codesOf("insert"), ["ol-bad-token"]);
});

test("`insert 9 :nums at 2` (missing `in`) reports ol-bad-token", () => {
  assert.ok(codesOf("insert 9 :nums at 2").includes("ol-bad-token"));
});

test("`insert 9 in` with no target reports ol-bad-token", () => {
  assert.deepEqual(codesOf("insert 9 in"), ["ol-bad-token"]);
});

test("`insert 9 in :nums 2` (missing `at`) reports ol-bad-token", () => {
  assert.ok(codesOf("insert 9 in :nums 2").includes("ol-bad-token"));
});

test("`insert 9 in :nums at` with no index reports ol-bad-token", () => {
  assert.deepEqual(codesOf("insert 9 in :nums at"), ["ol-bad-token"]);
});

// --- clear -----------------------------------------------------------------

test("`clear :nums` parses into a Clear node", () => {
  const node = first("clear :nums");
  assert.equal(node.kind, "Clear");
  assert.equal(node.target.kind, "VarRef");
  assert.equal(node.target.name, "nums");
  assert.deepEqual(codesOf("clear :nums"), []);
});

test("`clear` with no target reports ol-bad-token", () => {
  assert.deepEqual(codesOf("clear"), ["ol-bad-token"]);
});

// --- walk / childrenOf -----------------------------------------------------

test("walk visits each mutator node and descends into its operand expressions", () => {
  const source = [
    "add :a to :b",
    "remove :c from :d",
    "remove key :e from :f",
    "insert :g in :h at :i",
    "clear :j",
  ].join("\n");
  const kinds = [];
  const varNames = [];
  OL.walk(parse(source).ast, (node) => {
    kinds.push(node.kind);
    if (node.kind === "VarRef") {
      varNames.push(node.name);
    }
  });
  for (const kind of ["Add", "Remove", "RemoveKey", "Insert", "Clear"]) {
    assert.ok(kinds.includes(kind), `walk should visit a ${kind} node`);
  }
  // Every operand VarRef, in source order, is reached — proving childrenOf lists them all.
  assert.deepEqual(varNames, [
    "a",
    "b",
    "c",
    "d",
    "e",
    "f",
    "g",
    "h",
    "i",
    "j",
  ]);
});

test("the semantic checker descends into mutator operands and flags undefined reads", () => {
  // Each operand is an undefined variable read, so `ol-undefined-var` fires once per operand —
  // proving `check()` walks every child of every mutator node.
  assert.deepEqual(checkCodesOf("add :a to :b"), [
    "ol-undefined-var",
    "ol-undefined-var",
  ]);
  assert.deepEqual(checkCodesOf("insert :g in :h at :i"), [
    "ol-undefined-var",
    "ol-undefined-var",
    "ol-undefined-var",
  ]);
});

test("a mutator over a defined list raises no semantic diagnostics", () => {
  const source = [":nums = [ 1 2 3 ]", "add 4 to :nums"].join("\n");
  // The list is defined first, so a well-formed mutator over it is clean — the walk descends into
  // `:nums` and resolves it, and no rule false-positives on the mutator node itself.
  assert.deepEqual(checkCodesOf(source), []);
});
