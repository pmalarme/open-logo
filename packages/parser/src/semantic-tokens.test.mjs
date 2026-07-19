// Unit tests for `semanticTokens()` (issue #121): the LSP `textDocument/semanticTokens`-shaped
// contract layered over `highlight()`'s token-class + delimiter-role output
// (`spec/tooling.md:272-278`). Coverage mirrors that section's exact modifier vocabulary —
// `declaration`, `reference`, `readonly`, `defaultLibrary`, `listRole`, `blockRole`,
// `selectorRole` — plus one end-to-end corpus fixture exercising every one of `highlight()`'s 15
// token classes and 5 bracket delimiter roles at once (integrating issues #119 and #120).

import assert from "node:assert/strict";
import { test } from "node:test";
import * as OL from "@openlogo/parser";

const doc = "semantic-tokens.logo";

/** The token whose `text` first equals `text`, or `undefined`. */
function find(tokens, text) {
  return tokens.find((token) => token.text === text);
}

test("modifiers field: every token carries a modifiers array, even when empty", () => {
  const tokens = OL.semanticTokens("print 42", doc);
  assert.ok(tokens.every((token) => Array.isArray(token.modifiers)));
  // `print` is a Core primitive: defaultLibrary only. `42` is a plain number literal: no
  // declaration/reference/role modifier applies to a literal.
  assert.deepEqual(find(tokens, "print").modifiers, ["defaultLibrary"]);
  assert.deepEqual(find(tokens, "42").modifiers, []);
});

test("declaration: a `define` target at its declaration site gets declaration, not reference", () => {
  const tokens = OL.semanticTokens("define go\nend", doc);
  const name = find(tokens, "go");
  assert.equal(name.class, "procedure-name");
  assert.deepEqual(name.modifiers, ["declaration"]);
});

test("reference: a resolved procedure call site gets reference, not declaration", () => {
  const tokens = OL.semanticTokens("define go\nend\ngo", doc);
  const call = tokens.filter((token) => token.text === "go").at(-1);
  assert.equal(call.class, "procedure-name");
  assert.deepEqual(call.modifiers, ["reference"]);
});

test("declaration/reference: a struct type name is declaration at `struct`, reference at a constructor call", () => {
  const tokens = OL.semanticTokens("struct point [ x y ]\npoint 1 2", doc);
  const typeTokens = tokens.filter((token) => token.text === "point");
  assert.deepEqual(
    typeTokens.map((token) => token.modifiers),
    [["declaration"], ["reference"]],
  );
});

test("declaration/reference: a struct field name is declaration in the field list, reference at `.field` access", () => {
  const tokens = OL.semanticTokens(
    "struct point [ x y ]\ndefine move_to_point :p\n  set_xy :p.x :p.y\nend",
    doc,
  );
  const xTokens = tokens.filter((token) => token.text === "x");
  assert.equal(xTokens.length, 2);
  assert.deepEqual(xTokens[0].modifiers, ["declaration"]);
  assert.deepEqual(xTokens[1].modifiers, ["reference"]);
});

test("declaration/reference: a procedure's own `:param` is declaration at the header, reference in the body", () => {
  const tokens = OL.semanticTokens(
    "define go :speed\n  forward :speed\nend",
    doc,
  );
  const paramTokens = tokens.filter((token) => token.text === ":speed");
  assert.equal(paramTokens.length, 2);
  assert.equal(paramTokens[0].class, ":variable");
  assert.deepEqual(paramTokens[0].modifiers, ["declaration"]);
  assert.deepEqual(paramTokens[1].modifiers, ["reference"]);
});

test("reference: a plain `:variable` read with no resolvable binding site is reference, not declaration", () => {
  const tokens = OL.semanticTokens("print :count", doc);
  const variable = find(tokens, ":count");
  assert.deepEqual(variable.modifiers, ["reference"]);
});

test("readonly: a `map` binder read inside its own body is readonly (and still reference)", () => {
  const tokens = OL.semanticTokens(
    ":doubled = map num in :nums [ :num * 2 ]",
    doc,
  );
  const read = find(tokens, ":num");
  assert.equal(read.class, ":variable");
  assert.deepEqual(read.modifiers, ["reference", "readonly"]);
});

test("readonly: a `reduce` accumulator read inside its own body is readonly", () => {
  const tokens = OL.semanticTokens(
    ":total = reduce sum num in :nums from 0 [ :sum + :num ]",
    doc,
  );
  assert.deepEqual(find(tokens, ":sum").modifiers, ["reference", "readonly"]);
  assert.deepEqual(find(tokens, ":num").modifiers, ["reference", "readonly"]);
});

test("readonly: every name in a `map` destructuring `[:x :y]` binder read inside its own body is readonly (issue #72)", () => {
  const tokens = OL.semanticTokens(
    ":sums = map [:x :y] in :pairs [ :x + :y ]",
    doc,
  );
  // Each name appears twice: once inside the `[:x :y]` binder pattern itself (not a body read,
  // so no `readonly`), and once as a read inside the comprehension's own body.
  const xTokens = tokens.filter((token) => token.text === ":x");
  const yTokens = tokens.filter((token) => token.text === ":y");
  assert.deepEqual(xTokens[0].modifiers, ["reference"]);
  assert.deepEqual(xTokens[1].modifiers, ["reference", "readonly"]);
  assert.deepEqual(yTokens[0].modifiers, ["reference"]);
  assert.deepEqual(yTokens[1].modifiers, ["reference", "readonly"]);
});

test("readonly: a binder read through a place (`.field`/`[index]`) is also readonly, not just a bare `:name` read", () => {
  const tokens = OL.semanticTokens(
    "struct point [ x y ]\n:xs = map p in :points [ :p.x ]",
    doc,
  );
  const base = tokens.find(
    (token) => token.text === ":p" && token.class === ":variable",
  );
  assert.deepEqual(base.modifiers, ["reference", "readonly"]);
});

test("readonly: a `:variable` read outside any comprehension body is never marked readonly, even with the same spelling", () => {
  const tokens = OL.semanticTokens(
    "print :num\n:total = reduce sum num in :nums from 0 [ :sum + :num ]",
    doc,
  );
  const reads = tokens.filter((token) => token.text === ":num");
  // The plain read outside the comprehension is a reference only; the comprehension binder
  // read (same spelling) is reference + readonly.
  assert.deepEqual(reads[0].modifiers, ["reference"]);
  assert.deepEqual(reads[1].modifiers, ["reference", "readonly"]);
});

test("defaultLibrary: a Core primitive call gets defaultLibrary", () => {
  const tokens = OL.semanticTokens("forward 100", doc);
  assert.deepEqual(find(tokens, "forward").modifiers, ["defaultLibrary"]);
});

test("defaultLibrary: a Heritage alias primitive also gets defaultLibrary", () => {
  const tokens = OL.semanticTokens("fd 100", doc);
  assert.deepEqual(find(tokens, "fd").modifiers, ["defaultLibrary"]);
});

test("listRole: a list literal's brackets get listRole", () => {
  const tokens = OL.semanticTokens(":nums = [1 2 3]", doc);
  const brackets = tokens.filter(
    (token) => token.text === "[" || token.text === "]",
  );
  assert.deepEqual(
    brackets.map((token) => token.modifiers),
    [["listRole"], ["listRole"]],
  );
});

test("blockRole: an instruction block's brackets get blockRole", () => {
  const tokens = OL.semanticTokens("repeat 4 [ forward 10 ]", doc);
  const brackets = tokens.filter(
    (token) => token.text === "[" || token.text === "]",
  );
  assert.deepEqual(
    brackets.map((token) => token.modifiers),
    [["blockRole"], ["blockRole"]],
  );
});

test("selectorRole: a selector's brackets classify index/dot and get selectorRole", () => {
  const tokens = OL.semanticTokens("print :nums[1]", doc);
  const brackets = tokens.filter(
    (token) => token.text === "[" || token.text === "]",
  );
  for (const bracket of brackets) {
    assert.equal(bracket.class, "index/dot");
    assert.deepEqual(bracket.modifiers, ["selectorRole"]);
  }
});

test("no role modifier: pattern and field-list brackets get no listRole/blockRole/selectorRole modifier", () => {
  const patternTokens = OL.semanticTokens(
    "for [:x :y] in :pairs\n  print :x\nend",
    doc,
  );
  const patternBrackets = patternTokens.filter(
    (token) => token.text === "[" || token.text === "]",
  );
  assert.deepEqual(
    patternBrackets.map((token) => token.modifiers),
    [[], []],
  );

  const fieldListTokens = OL.semanticTokens("struct point [ x y ]", doc);
  const fieldListBrackets = fieldListTokens.filter(
    (token) => token.text === "[" || token.text === "]",
  );
  assert.deepEqual(
    fieldListBrackets.map((token) => token.modifiers),
    [[], []],
  );
});

test("no declaration/reference modifier: literal, delimiter, and operator classes never get one", () => {
  const tokens = OL.semanticTokens('if :x == 1 [ print "hi" ] # note', doc);
  const nonDeclarable = tokens.filter(
    (token) =>
      !["procedure-name", "type-name", "field-name", ":variable"].includes(
        token.class,
      ),
  );
  for (const token of nonDeclarable) {
    assert.ok(!token.modifiers.includes("declaration"));
    assert.ok(!token.modifiers.includes("reference"));
  }
});

test("never throws on malformed input, matching highlight()'s own never-throw contract", () => {
  assert.doesNotThrow(() => OL.semanticTokens("struct\ndefine\n[", doc));
});

test("corpus: one source exercises all 15 token classes and all 5 bracket delimiter roles end to end", () => {
  const source = [
    "struct point [ x y ]",
    "",
    "define move_to_point :p",
    "  # move the turtle onto a known point",
    "  set_xy :p.x :p.y",
    "end",
    "",
    ":nums = [1 2 3]",
    ":total = reduce sum num in :nums from 0 [ :sum + :num ]",
    "",
    "if :total > 0 and not :total is empty [",
    "  forward :total",
    '  (print "done")',
    "]",
    "",
    "print :nums[repeat]",
    "move_to_point point 1 2",
    "",
    "for [:a :b] in :nums",
    "  print :a",
    "end",
    "",
    "print { note: 1 }",
  ].join("\n");

  const tokens = OL.semanticTokens(source, doc);
  const classesSeen = new Set(tokens.map((token) => token.class));
  for (const tokenClass of OL.OL_TOKEN_CLASSES) {
    assert.ok(
      classesSeen.has(tokenClass),
      `expected corpus to exercise token class "${tokenClass}"`,
    );
  }

  const rolesSeen = new Set(
    tokens.map((token) => token.role).filter((role) => role !== undefined),
  );
  for (const role of OL.OL_BRACKET_ROLES) {
    assert.ok(
      rolesSeen.has(role),
      `expected corpus to exercise role "${role}"`,
    );
  }

  // Spot-check a representative modifier from each category on this single corpus.
  assert.deepEqual(find(tokens, "point").modifiers, ["declaration"]);
  assert.deepEqual(find(tokens, "forward").modifiers, ["defaultLibrary"]);
  assert.deepEqual(find(tokens, ":sum").modifiers, ["reference", "readonly"]);
});
