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
 * Also covers issue #427 (M4 audit): `define`/`struct` registrations that redefine
 * `grid`/`axes`/`measure` must raise `ol-reserved-word` when the
 * `geometry` profile is active — the checker's static parity counterpart to the runtime's own
 * `isPrimitiveName()` collision guard (#403) — and must not raise when it is inactive. (Issue #838
 * removed that diagnostic's `namespace` param; `local` became a binding form under ruling #833.)
 *
 * And issue #844: the Layer-2 arity gate for these three, so `check()` agrees with the runtime's
 * call-time arity check on `(grid 50)` instead of staying silent where `execute()` raises
 * `ol-too-many-inputs`.
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

// --- Layer-2 arity, agreeing with the runtime (issue #844) ---------------------
//
// The reader caps a bare call at the registered arity (0), so `grid 10` leaves `10` as a stray
// statement the parser reports as `ol-bad-token`; the parenthesized form is the only way to
// over-supply. The runtime has always raised `ol-too-many-inputs` there, but the checker used to
// stay silent — so the two stages disagreed about the very same call.

test("with the geometry profile active, over-supplying an overlay primitive raises ol-too-many-inputs", () => {
  for (const name of ["grid", "axes", "measure"]) {
    const ast = parseClean(`(${name} 50)`);
    const { diagnostics } = OL.check(ast, {
      profiles: ["core-language", "geometry"],
    });
    assert.equal(diagnostics.length, 1);
    assert.equal(diagnostics[0].code, "ol-too-many-inputs");
    assert.equal(diagnostics[0].stage, "semantic");
    assert.deepEqual(diagnostics[0].params, {
      callable: name,
      expected: 0,
      actual: 1,
    });
    // the diagnostic points at the callee, not the whole parenthesized call
    assert.deepEqual(diagnostics[0].source_span.start, [1, 2]);
    assert.deepEqual(diagnostics[0].source_span.end, [1, 2 + name.length]);
  }
});

test("an exactly-zero-argument overlay call is clean in either call form", () => {
  for (const name of ["grid", "axes", "measure"]) {
    for (const source of [name, `(${name})`]) {
      const ast = parseClean(source);
      assert.deepEqual(
        OL.check(ast, { profiles: ["core-language", "geometry"] }).diagnostics,
        [],
        `expected a clean check for ${JSON.stringify(source)}`,
      );
    }
  }
});

test("without the geometry profile active, over-supplying reports only ol-unknown-command, never arity", () => {
  for (const name of ["grid", "axes", "measure"]) {
    const ast = parseClean(`(${name} 50)`);
    const { diagnostics } = OL.check(ast, { profiles: ["core-language"] });
    assert.equal(diagnostics.length, 1);
    assert.equal(diagnostics[0].code, "ol-unknown-command");
  }
});

test("the geometry arity gate leaves a non-geometry callee to the profile that owns it", () => {
  // `print` is a Core variadic: it must pass straight through the geometry gate (whose range
  // lookup returns undefined for it) and stay clean, rather than being captured or flagged.
  const ast = parseClean("(print 1 2)");
  assert.deepEqual(
    OL.check(ast, { profiles: ["core-language", "geometry"] }).diagnostics,
    [],
  );
});

test("a user procedure named like an overlay primitive keeps its own arity", () => {
  // The procedure table is consulted before every profile gate, so a learner's own `define`
  // wins the arity check even though the name collides (the collision itself is
  // `ol-reserved-word`'s job, asserted separately below).
  const ast = parseClean("define grid :spacing\nend\n(grid)");
  const codes = OL.check(ast, { profiles: ["core-language", "geometry"] })
    .diagnostics.map((diagnostic) => diagnostic.code)
    .sort();
  assert.deepEqual(codes, ["ol-not-enough-inputs", "ol-reserved-word"]);
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

test("a struct type name colliding with a Geometry primitive raises ol-reserved-word", () => {
  for (const name of ["grid", "axes", "measure"]) {
    const ast = parseClean(`struct ${name} [ x ]`);
    const { diagnostics } = OL.check(ast, {
      profiles: ["core-language", "data", "geometry"],
    });
    assert.equal(diagnostics.length, 1);
    assert.equal(diagnostics[0].code, "ol-reserved-word");
    // `params: { name }` only since issue #838 (`spec/error-model.md:125`).
    assert.deepEqual(diagnostics[0].params, { name });
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
    assert.deepEqual(diagnostics[0].params, { name });
  }
});

test("a local naming a Geometry primitive is a binding, so it raises nothing", () => {
  // Reversed by maintainer ruling #833 (issue #837): `local` is a binding form, not a declaration
  // slot, and `spec/grammar.md:386` makes accepting the name a MUST. The `define`/`struct` rows
  // above are the declaration slots and keep their collision assertions.
  for (const name of ["grid", "axes", "measure"]) {
    const ast = parseClean(`define greet\n  local ${name}\nend`);
    const { diagnostics } = OL.check(ast, {
      profiles: ["core-language", "geometry"],
    });
    assert.deepEqual(diagnostics, []);
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
