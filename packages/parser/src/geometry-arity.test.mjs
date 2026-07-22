import assert from "node:assert/strict";
import { test } from "node:test";
import * as OL from "@openlogo/parser";

/**
 * Unit tests for the Geometry profile's renderer-backed overlay primitives — `grid`/`axes`/
 * `measure` (issue #341, `spec/geometry-module.md`'s `## grid`, `## axes`, and `## measure`
 * sections). All three are Kind C, arity 0, so the reader must gather zero arguments regardless of
 * active profile (the reader has no profile concept — that's `check()`'s job), and `check()` must
 * only recognize them as known callees when the `geometry` profile is active. Behavior is verified
 * against the built `@openlogo/parser` entry point per the shared black-box test convention.
 *
 * Also covers issue #427 (M4 audit): `define`/`local`/`struct` registrations that redefine
 * `grid`/`axes`/`measure` must raise `ol-reserved-word` (`namespace: "primitive"`) when the
 * `geometry` profile is active — the checker's static parity counterpart to the runtime's own
 * `isPrimitiveName()` collision guard (#403) — and must not raise when it is inactive.
 */

function parseClean(source) {
  const { ast, diagnostics } = OL.parse(source, "geometry-arity.logo");
  assert.deepEqual(
    diagnostics,
    [],
    `expected a clean parse for ${JSON.stringify(source)}`,
  );
  return ast;
}

test("every geometry overlay primitive gathers zero arguments", () => {
  for (const name of ["grid", "axes", "measure"]) {
    const [call] = parseClean(name).body;
    assert.equal(call.kind, "Call");
    assert.equal(call.callee.name, name);
    assert.equal(call.args.length, 0);
  }
});

test("geometryPrimitiveArity reports 0 for grid/axes/measure, case-insensitively, and undefined otherwise", () => {
  for (const name of ["grid", "axes", "measure"]) {
    assert.equal(OL.geometryPrimitiveArity(name), 0);
    assert.equal(OL.geometryPrimitiveArity(name.toUpperCase()), 0);
  }
  assert.equal(OL.geometryPrimitiveArity("forward"), undefined);
  assert.equal(OL.geometryPrimitiveArity("polygon"), undefined);
});

test("a parenthesized call with arguments still parses cleanly at Layer 1 (arity is a Layer 2 concern)", () => {
  for (const name of ["grid", "axes", "measure"]) {
    const [call] = parseClean(`(${name} 1)`).body;
    assert.equal(call.kind, "ParenCall");
    assert.equal(call.callee.name, name);
    assert.equal(call.args.length, 1);
  }
});

test("with the geometry profile active, grid/axes/measure are known callees", () => {
  for (const name of ["grid", "axes", "measure"]) {
    const { ast, diagnostics: parseDiagnostics } = OL.parse(
      name,
      "geometry-arity.logo",
    );
    assert.deepEqual(parseDiagnostics, []);
    const { diagnostics } = OL.check(ast, {
      profiles: ["core-language", "geometry"],
    });
    assert.deepEqual(diagnostics, []);
  }
});

test("without the geometry profile active, grid/axes/measure parse cleanly but are flagged ol-unknown-command", () => {
  for (const name of ["grid", "axes", "measure"]) {
    const { ast, diagnostics: parseDiagnostics } = OL.parse(
      name,
      "geometry-arity.logo",
    );
    assert.deepEqual(parseDiagnostics, []);
    const { diagnostics } = OL.check(ast, { profiles: ["core-language"] });
    assert.equal(diagnostics.length, 1);
    assert.equal(diagnostics[0].code, "ol-unknown-command");
    assert.equal(diagnostics[0].stage, "semantic");
  }
});

// --- reserved-word collisions (issue #427, M4 audit) ---------------------------

test("a struct type name colliding with a Geometry primitive raises ol-reserved-word (primitive wins)", () => {
  for (const name of ["grid", "axes", "measure"]) {
    const ast = parseClean(`struct ${name} [ x ]`);
    const { diagnostics } = OL.check(ast, {
      profiles: ["core-language", "data", "geometry"],
    });
    assert.equal(diagnostics.length, 1);
    assert.equal(diagnostics[0].code, "ol-reserved-word");
    assert.equal(diagnostics[0].params.namespace, "primitive");
    assert.equal(diagnostics[0].params.name, name);
  }
});

test("a define colliding with a Geometry primitive raises ol-reserved-word", () => {
  for (const name of ["grid", "axes", "measure"]) {
    const ast = parseClean(`define ${name}\nend`);
    const { diagnostics } = OL.check(ast, {
      profiles: ["core-language", "geometry"],
    });
    assert.equal(diagnostics.length, 1);
    assert.equal(diagnostics[0].code, "ol-reserved-word");
    assert.equal(diagnostics[0].params.namespace, "primitive");
  }
});

test("a local colliding with a Geometry primitive raises ol-reserved-word", () => {
  for (const name of ["grid", "axes", "measure"]) {
    const ast = parseClean(`define greet\n  local ${name}\nend`);
    const { diagnostics } = OL.check(ast, {
      profiles: ["core-language", "geometry"],
    });
    assert.equal(diagnostics.length, 1);
    assert.equal(diagnostics[0].code, "ol-reserved-word");
    assert.equal(diagnostics[0].params.namespace, "primitive");
  }
});

test("without the geometry profile active, define/local/struct grid/axes/measure raise no reserved-word collision", () => {
  for (const name of ["grid", "axes", "measure"]) {
    const defineOnly = parseClean(`define ${name}\nend`);
    assert.deepEqual(
      OL.check(defineOnly, { profiles: ["core-language"] }).diagnostics,
      [],
    );

    const localOnly = parseClean(`define greet\n  local ${name}\nend`);
    assert.deepEqual(
      OL.check(localOnly, { profiles: ["core-language"] }).diagnostics,
      [],
    );

    const structOnly = parseClean(`struct ${name} [ x ]`);
    assert.deepEqual(
      OL.check(structOnly, { profiles: ["core-language", "data"] }).diagnostics,
      [],
    );
  }
});
