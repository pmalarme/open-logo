import assert from "node:assert/strict";
import { test } from "node:test";
import * as OL from "@openlogo/parser";

/**
 * Unit tests for the Sound profile's `set_tempo`/`beep` primitives (issue #689, slice S1 of the
 * Sound epic #662; `spec/interaction-events.md`'s "Sound primitives" section). `set_tempo` is
 * arity 1 and `beep` arity 0, so the reader must gather exactly that many arguments regardless of
 * active profile (the reader has no profile concept — that is `check()`'s job,
 * `spec/tooling.md:175-176`), and `check()` must only recognize them as known callees when the
 * `sound` profile is active. Behavior is verified against the built `@openlogo/parser` entry point
 * per the shared black-box test convention.
 *
 * Also covers the reserved-word collision parity: `define`/`local`/`struct` registrations that
 * redefine `set_tempo`/`beep` must raise `ol-reserved-word` (`namespace: "primitive"`) when the
 * `sound` profile is active — the checker's static counterpart to the runtime's own
 * `isPrimitiveName()` collision guard (#403) — and must not raise when it is inactive.
 */

function parseClean(source) {
  const { ast, diagnostics } = OL.parse(source, "sound-arity.logo");
  assert.deepEqual(
    diagnostics,
    [],
    `expected a clean parse for ${JSON.stringify(source)}`,
  );
  return ast;
}

test("soundPrimitiveArity reports 1 for set_tempo and 0 for beep, case-insensitively, and undefined otherwise", () => {
  assert.equal(OL.soundPrimitiveArity("set_tempo"), 1);
  assert.equal(OL.soundPrimitiveArity("SET_TEMPO"), 1);
  assert.equal(OL.soundPrimitiveArity("beep"), 0);
  assert.equal(OL.soundPrimitiveArity("BEEP"), 0);
  assert.equal(OL.soundPrimitiveArity("forward"), undefined);
  assert.equal(OL.soundPrimitiveArity("note"), undefined);
});

test("the reader groups set_tempo's single argument and beep's zero arguments", () => {
  const [tempo] = parseClean("set_tempo 90").body;
  assert.equal(tempo.kind, "Call");
  assert.equal(tempo.callee.name, "set_tempo");
  assert.equal(tempo.args.length, 1);

  const [beep] = parseClean("beep").body;
  assert.equal(beep.kind, "Call");
  assert.equal(beep.callee.name, "beep");
  assert.equal(beep.args.length, 0);
});

test("a parenthesized call with extra arguments still parses cleanly at Layer 1 (arity is a Layer 2 concern)", () => {
  const [tempo] = parseClean("(set_tempo 90 100)").body;
  assert.equal(tempo.kind, "ParenCall");
  assert.equal(tempo.callee.name, "set_tempo");
  assert.equal(tempo.args.length, 2);

  const [beep] = parseClean("(beep 1)").body;
  assert.equal(beep.kind, "ParenCall");
  assert.equal(beep.callee.name, "beep");
  assert.equal(beep.args.length, 1);
});

test("with the sound profile active, set_tempo/beep are known callees", () => {
  for (const source of ["set_tempo 90", "beep"]) {
    const { ast, diagnostics: parseDiagnostics } = OL.parse(
      source,
      "sound-arity.logo",
    );
    assert.deepEqual(parseDiagnostics, []);
    const { diagnostics } = OL.check(ast, {
      profiles: ["core-language", "sound"],
    });
    assert.deepEqual(diagnostics, []);
  }
});

test("without the sound profile active, set_tempo/beep parse cleanly but are flagged ol-unknown-command", () => {
  for (const source of ["set_tempo 90", "beep"]) {
    const { ast, diagnostics: parseDiagnostics } = OL.parse(
      source,
      "sound-arity.logo",
    );
    assert.deepEqual(parseDiagnostics, []);
    const { diagnostics } = OL.check(ast, { profiles: ["core-language"] });
    assert.equal(diagnostics.length, 1);
    assert.equal(diagnostics[0].code, "ol-unknown-command");
    assert.equal(diagnostics[0].stage, "semantic");
  }
});

// --- reserved-word collisions --------------------------------------------------

test("a struct type name colliding with a Sound primitive raises ol-reserved-word (primitive wins)", () => {
  for (const name of ["set_tempo", "beep"]) {
    const ast = parseClean(`struct ${name} [ x ]`);
    const { diagnostics } = OL.check(ast, {
      profiles: ["core-language", "data", "sound"],
    });
    assert.equal(diagnostics.length, 1);
    assert.equal(diagnostics[0].code, "ol-reserved-word");
    assert.equal(diagnostics[0].params.namespace, "primitive");
    assert.equal(diagnostics[0].params.name, name);
  }
});

test("a define colliding with a Sound primitive raises ol-reserved-word", () => {
  for (const name of ["set_tempo", "beep"]) {
    const ast = parseClean(`define ${name}\nend`);
    const { diagnostics } = OL.check(ast, {
      profiles: ["core-language", "sound"],
    });
    assert.equal(diagnostics.length, 1);
    assert.equal(diagnostics[0].code, "ol-reserved-word");
    assert.equal(diagnostics[0].params.namespace, "primitive");
  }
});

test("a local colliding with a Sound primitive raises ol-reserved-word", () => {
  for (const name of ["set_tempo", "beep"]) {
    const ast = parseClean(`define greet\n  local ${name}\nend`);
    const { diagnostics } = OL.check(ast, {
      profiles: ["core-language", "sound"],
    });
    assert.equal(diagnostics.length, 1);
    assert.equal(diagnostics[0].code, "ol-reserved-word");
    assert.equal(diagnostics[0].params.namespace, "primitive");
  }
});

test("without the sound profile active, define/local/struct set_tempo/beep raise no reserved-word collision", () => {
  for (const name of ["set_tempo", "beep"]) {
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
