import assert from "node:assert/strict";
import { test } from "node:test";
import * as OL from "@openlogo/parser";

/**
 * Unit tests for the Sprites profile's turtle-identity reporters — `new_turtle`/`who`/`turtles`
 * (issue #673, `spec/turtles-and-sprites.md`'s "Canonical forms" table: each is a Kind-R reporter,
 * arity 0). Like the Geometry overlay primitives, the reader must gather zero arguments for them
 * regardless of active profile (the reader has no profile concept — that is `check()`'s job,
 * `spec/tooling.md:175-176`). This slice only registers their arities in the reader's tables; the
 * checker's profile-gated visibility of these names is a later slice (#678), so these tests
 * deliberately assert only Layer-1 (reader/arity) behavior, never `check()` recognition.
 *
 * Behavior is verified against the built `@openlogo/parser` entry point per the shared black-box
 * test convention.
 */

function parseClean(source) {
  const { ast, diagnostics } = OL.parse(source, "sprites-arity.logo");
  assert.deepEqual(
    diagnostics,
    [],
    `expected a clean parse for ${JSON.stringify(source)}`,
  );
  return ast;
}

test("every sprites reporter gathers zero arguments as a bare call", () => {
  for (const name of ["new_turtle", "who", "turtles"]) {
    const [call] = parseClean(name).body;
    assert.equal(call.kind, "Call");
    assert.equal(call.callee.name, name);
    assert.equal(call.args.length, 0);
  }
});

test("spritesPrimitiveArity reports 0 for new_turtle/who/turtles, case-insensitively, and undefined otherwise", () => {
  for (const name of ["new_turtle", "who", "turtles"]) {
    assert.equal(OL.spritesPrimitiveArity(name), 0);
    assert.equal(OL.spritesPrimitiveArity(name.toUpperCase()), 0);
  }
  assert.equal(OL.spritesPrimitiveArity("forward"), undefined);
  assert.equal(OL.spritesPrimitiveArity("tell"), undefined);
});

test("a parenthesized sprites call with arguments still parses cleanly at Layer 1 (arity is a Layer 2 concern)", () => {
  for (const name of ["new_turtle", "who", "turtles"]) {
    const [call] = parseClean(`(${name} 1)`).body;
    assert.equal(call.kind, "ParenCall");
    assert.equal(call.callee.name, name);
    assert.equal(call.args.length, 1);
  }
});

test("every profile arity table in the reader's registry stays reachable (guards against a rebase dropping a table)", () => {
  // The reader consults PROFILE_PRIMITIVE_ARITY_TABLES in order; a resolution that silently
  // dropped or reordered a table would make that profile's primitives stop grouping their
  // arguments with no failure in the owning slice. Assert one representative lookup per profile
  // resolves through the public per-profile functions (each backed by a table in that array).
  assert.equal(OL.corePrimitiveArity("print"), 1);
  assert.equal(OL.turtlePrimitiveArity("forward"), 1);
  assert.equal(OL.dataPrimitiveArity("reverse"), 1);
  assert.equal(OL.educationalPrimitiveArity("explain"), 0);
  assert.equal(OL.geometryPrimitiveArity("grid"), 0);
  assert.equal(OL.interactionPrimitiveArity("wait"), 1);
  assert.equal(OL.soundPrimitiveArity("set_tempo"), 1);
  assert.equal(OL.spritesPrimitiveArity("new_turtle"), 0);
});

test("every profile's arity flows through the reader's array-driven lookup (guards a dropped PROFILE_PRIMITIVE_ARITY_TABLES entry)", () => {
  // The per-profile functions above are each backed by their own map directly, so they would
  // still pass if a table were dropped from the PROFILE_PRIMITIVE_ARITY_TABLES *array* the reader
  // actually iterates (`primitiveArity`, not re-exported). This end-to-end check parses a bare
  // call per profile so grouping goes through parser.ts -> arityOf -> primitiveArity -> that
  // array. A representative arity-1 primitive with one argument groups as `args: 1`; were its
  // table dropped, the name would become unknown, default to arity 0, and leave the argument as a
  // stray following statement (`args: 0`) instead — so this discriminates a dropped array entry.
  const arityOne = [
    "print 1", // core
    "forward 10", // turtle
    "reverse [1 2]", // data
    "wait 1", // interaction-events
    "set_tempo 120", // sound
  ];
  for (const source of arityOne) {
    const [call] = parseClean(source).body;
    assert.equal(
      call.kind,
      "Call",
      `expected a grouped Call for ${JSON.stringify(source)}`,
    );
    assert.equal(
      call.args.length,
      1,
      `${JSON.stringify(source)} must group its single argument via the array-driven reader lookup`,
    );
  }
  // educational/geometry representative primitives are arity 0, and the sprites reporters are too;
  // a bare call with no argument groups as `args: 0` through the same array path.
  for (const source of ["explain", "grid", "new_turtle", "who", "turtles"]) {
    const [call] = parseClean(source).body;
    assert.equal(
      call.kind,
      "Call",
      `expected a Call for ${JSON.stringify(source)}`,
    );
    assert.equal(
      call.args.length,
      0,
      `${JSON.stringify(source)} must group as zero-arity`,
    );
  }
});
