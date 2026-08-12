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

test("soundPrimitiveArity reports the fixed arity of each Sound primitive, case-insensitively, and undefined otherwise", () => {
  assert.equal(OL.soundPrimitiveArity("set_tempo"), 1);
  assert.equal(OL.soundPrimitiveArity("SET_TEMPO"), 1);
  assert.equal(OL.soundPrimitiveArity("beep"), 0);
  assert.equal(OL.soundPrimitiveArity("BEEP"), 0);
  assert.equal(OL.soundPrimitiveArity("note"), 2);
  assert.equal(OL.soundPrimitiveArity("NOTE"), 2);
  assert.equal(OL.soundPrimitiveArity("rest"), 1);
  assert.equal(OL.soundPrimitiveArity("REST"), 1);
  assert.equal(OL.soundPrimitiveArity("forward"), undefined);
  assert.equal(OL.soundPrimitiveArity("play"), undefined);
});

test("with the sound profile active, check() flags a known Sound command given the wrong number of inputs", () => {
  // The parenthesized form is the escape hatch the reader lets through, so arity for it is a
  // Layer-2 (checker) concern; both Sound primitives are strictly fixed-arity (max === min).
  const tooMany = (source) => {
    const { ast, diagnostics: parseDiagnostics } = OL.parse(
      source,
      "sound-arity.logo",
    );
    assert.deepEqual(parseDiagnostics, []);
    return OL.check(ast, { profiles: ["core-language", "sound"] }).diagnostics;
  };

  const overTempo = tooMany("(set_tempo 1 2)");
  assert.equal(overTempo.length, 1);
  assert.equal(overTempo[0].code, "ol-too-many-inputs");
  assert.deepEqual(overTempo[0].params, {
    callable: "set_tempo",
    expected: 1,
    actual: 2,
  });

  const overBeep = tooMany("(beep 1)");
  assert.equal(overBeep.length, 1);
  assert.equal(overBeep[0].code, "ol-too-many-inputs");
  assert.deepEqual(overBeep[0].params, {
    callable: "beep",
    expected: 0,
    actual: 1,
  });

  const underTempo = tooMany("(set_tempo)");
  assert.equal(underTempo.length, 1);
  assert.equal(underTempo[0].code, "ol-not-enough-inputs");
  assert.deepEqual(underTempo[0].params, {
    callable: "set_tempo",
    expected: 1,
    actual: 0,
  });

  const overNote = tooMany('(note "c4" 1 2)');
  assert.equal(overNote.length, 1);
  assert.equal(overNote[0].code, "ol-too-many-inputs");
  assert.deepEqual(overNote[0].params, {
    callable: "note",
    expected: 2,
    actual: 3,
  });

  const underNote = tooMany('(note "c4")');
  assert.equal(underNote.length, 1);
  assert.equal(underNote[0].code, "ol-not-enough-inputs");
  assert.deepEqual(underNote[0].params, {
    callable: "note",
    expected: 2,
    actual: 1,
  });

  const overRest = tooMany("(rest 1 2)");
  assert.equal(overRest.length, 1);
  assert.equal(overRest[0].code, "ol-too-many-inputs");
  assert.deepEqual(overRest[0].params, {
    callable: "rest",
    expected: 1,
    actual: 2,
  });
});

test("with the sound profile active, check() accepts a correctly-supplied Sound command", () => {
  for (const source of ["set_tempo 90", "beep", 'note "c4" 1', "rest 1"]) {
    const { ast, diagnostics: parseDiagnostics } = OL.parse(
      source,
      "sound-arity.logo",
    );
    assert.deepEqual(parseDiagnostics, []);
    assert.deepEqual(
      OL.check(ast, { profiles: ["core-language", "sound"] }).diagnostics,
      [],
    );
  }
});

test("with the sound profile active, a non-Sound callee falls through to the Core arity check", () => {
  // Exercises soundPrimitiveArityRange's undefined branch: a Core primitive is unknown to the Sound
  // table, so the arity rule falls through to Core handling and still flags its wrong arity.
  const { ast, diagnostics: parseDiagnostics } = OL.parse(
    "(first)",
    "sound-arity.logo",
  );
  assert.deepEqual(parseDiagnostics, []);
  const { diagnostics } = OL.check(ast, {
    profiles: ["core-language", "sound"],
  });
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].code, "ol-not-enough-inputs");
  assert.equal(diagnostics[0].params.callable, "first");
});

test("without the sound profile active, a wrong-arity Sound call is ol-unknown-command, not an arity error", () => {
  // Legality gating stays the checker's job (spec/tooling.md:175-176): with no `sound` profile the
  // callee is simply unknown, so the arity rule leaves it to `ol-unknown-command`.
  const { ast, diagnostics: parseDiagnostics } = OL.parse(
    "(set_tempo 1 2)",
    "sound-arity.logo",
  );
  assert.deepEqual(parseDiagnostics, []);
  const { diagnostics } = OL.check(ast, { profiles: ["core-language"] });
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].code, "ol-unknown-command");
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

  const [note] = parseClean('note "c4" 1').body;
  assert.equal(note.kind, "Call");
  assert.equal(note.callee.name, "note");
  assert.equal(note.args.length, 2);

  const [rest] = parseClean("rest 1").body;
  assert.equal(rest.kind, "Call");
  assert.equal(rest.callee.name, "rest");
  assert.equal(rest.args.length, 1);
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
  for (const name of ["set_tempo", "beep", "note", "rest"]) {
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
  for (const name of ["set_tempo", "beep", "note", "rest"]) {
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
  for (const name of ["set_tempo", "beep", "note", "rest"]) {
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
  for (const name of ["set_tempo", "beep", "note", "rest"]) {
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
