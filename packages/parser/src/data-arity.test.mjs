import assert from "node:assert/strict";
import { test } from "node:test";
import * as OL from "@openlogo/parser";

/**
 * Unit tests for the Data profile's semantic-checker registration (issue #405, M4 audit finding
 * F3, `spec/tooling.md:172-185`). `dict`/`keys`/`values`/`type_of`/`reverse`/`pick`/`sort` and a
 * `struct`'s constructor call must be recognized by `check()` — visibility (no
 * `ol-unknown-command`), exact arity (`ol-not-enough-inputs`/`ol-too-many-inputs`), and reserved-word
 * collision (`ol-reserved-word`) — only when the `data` profile is active; without it they are
 * unknown callees like any other undeclared name.
 */

function parseClean(source) {
  const { ast, diagnostics } = OL.parse(source, "data-arity.logo");
  assert.deepEqual(
    diagnostics,
    [],
    `expected a clean parse for ${JSON.stringify(source)}`,
  );
  return ast;
}

const DATA_PRIMITIVES = [
  ["dict", 0],
  ["keys", 1],
  ["values", 1],
  ["type_of", 1],
  ["reverse", 1],
  ["pick", 1],
  ["sort", 1],
];

test("dataPrimitiveArity reports each Data primitive's fixed arity, case-insensitively, and undefined otherwise", () => {
  for (const [name, arity] of DATA_PRIMITIVES) {
    assert.equal(OL.dataPrimitiveArity(name), arity);
    assert.equal(OL.dataPrimitiveArity(name.toUpperCase()), arity);
  }
  assert.equal(OL.dataPrimitiveArity("forward"), undefined);
  assert.equal(OL.dataPrimitiveArity("point"), undefined);
});

test("with the data profile active, every Data primitive fully applied is a clean, known callee", () => {
  for (const [name, arity] of DATA_PRIMITIVES) {
    const args = Array.from({ length: arity }, () => "1").join(" ");
    const source = args.length > 0 ? `${name} ${args}` : name;
    const ast = parseClean(source);
    const { diagnostics } = OL.check(ast, {
      profiles: ["core-language", "data"],
    });
    assert.deepEqual(diagnostics, [], `expected ${source} to check cleanly`);
  }
});

test("without the data profile active, a Data primitive parses cleanly but is flagged ol-unknown-command", () => {
  const ast = parseClean("dict");
  const { diagnostics } = OL.check(ast, { profiles: ["core-language"] });
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].code, "ol-unknown-command");
  assert.equal(diagnostics[0].stage, "semantic");
});

test("a Data primitive called with too few inputs raises ol-not-enough-inputs", () => {
  const ast = parseClean("keys");
  const { diagnostics } = OL.check(ast, {
    profiles: ["core-language", "data"],
  });
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].code, "ol-not-enough-inputs");
  assert.equal(diagnostics[0].params.callable, "keys");
});

test("a Data primitive called (parenthesized) with too many inputs raises ol-too-many-inputs", () => {
  const ast = parseClean("(type_of 1 2)");
  const { diagnostics } = OL.check(ast, {
    profiles: ["core-language", "data"],
  });
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].code, "ol-too-many-inputs");
  assert.equal(diagnostics[0].params.callable, "type_of");
});

// --- struct constructor calls ------------------------------------------------

test("with the data profile active, a struct's constructor call is a clean, known callee at its declared arity", () => {
  const ast = parseClean("struct point [ x y ]\npoint 3 4");
  const { diagnostics } = OL.check(ast, {
    profiles: ["core-language", "data"],
  });
  assert.deepEqual(diagnostics, []);
});

test("without the data profile active, a struct declaration is not walked and its constructor is unknown", () => {
  const ast = parseClean("struct point [ x y ]\npoint 3 4");
  const { diagnostics } = OL.check(ast, { profiles: ["core-language"] });
  assert.equal(
    diagnostics.filter((d) => d.code === "ol-unknown-command").length,
    1,
  );
});

test("a struct constructor called with too few inputs raises ol-not-enough-inputs", () => {
  const ast = parseClean("struct point [ x y ]\npoint 3");
  const { diagnostics } = OL.check(ast, {
    profiles: ["core-language", "data"],
  });
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].code, "ol-not-enough-inputs");
  assert.equal(diagnostics[0].params.callable, "point");
});

test("a struct constructor called (parenthesized) with too many inputs raises ol-too-many-inputs", () => {
  const ast = parseClean("struct point [ x y ]\n(point 3 4 5)");
  const { diagnostics } = OL.check(ast, {
    profiles: ["core-language", "data"],
  });
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].code, "ol-too-many-inputs");
  assert.equal(diagnostics[0].params.callable, "point");
});

// --- reserved-word collisions -------------------------------------------------

test("a struct type name colliding with a Data primitive raises ol-reserved-word (primitive wins)", () => {
  const ast = parseClean("struct dict [ x ]");
  const { diagnostics } = OL.check(ast, {
    profiles: ["core-language", "data"],
  });
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].code, "ol-reserved-word");
  assert.equal(diagnostics[0].params.namespace, "primitive");
});

test("a struct type name colliding with a define'd procedure raises ol-reserved-word", () => {
  const ast = parseClean("define point\nend\nstruct point [ x ]");
  const { diagnostics } = OL.check(ast, {
    profiles: ["core-language", "data"],
  });
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].code, "ol-reserved-word");
  assert.equal(diagnostics[0].params.namespace, "procedure");
});

test("a define colliding with an earlier struct type name raises ol-reserved-word", () => {
  const ast = parseClean("struct point [ x ]\ndefine point\nend");
  const { diagnostics } = OL.check(ast, {
    profiles: ["core-language", "data"],
  });
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].code, "ol-reserved-word");
  assert.equal(diagnostics[0].params.namespace, "struct");
});

test("two struct declarations sharing a name are checked in source order: the first is clean", () => {
  const ast = parseClean("struct point [ x ]\nstruct point [ y ]");
  const { diagnostics } = OL.check(ast, {
    profiles: ["core-language", "data"],
  });
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].code, "ol-reserved-word");
  assert.equal(diagnostics[0].params.namespace, "struct");
  assert.deepEqual(diagnostics[0].source_span.start, [2, 8]);
});

test("without the data profile active, a struct name is not registered so no collision is reported", () => {
  const ast = parseClean("struct dict [ x ]");
  const { diagnostics } = OL.check(ast, { profiles: ["core-language"] });
  assert.deepEqual(diagnostics, []);
});
