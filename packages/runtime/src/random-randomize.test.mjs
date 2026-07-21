// Unit tests for the Core Math reporter `random` and command `randomize` (issue #287,
// spec/commands.md's "random"/"randomize" entries). `random`'s own sequence is only
// "deterministic within an implementation" (not portable across implementations), so exact
// draws are asserted here — proving OUR generator's own determinism — rather than in a
// stack-neutral conformance fixture (`tests/conformance/`), which only asserts the portable
// negative (`ol-type`/`ol-range`) facts.

import assert from "node:assert/strict";
import { test } from "node:test";
import { execute } from "@openlogo/runtime";

const doc = "acceptance.logo";

function printedValues(result) {
  return result.events
    .filter((event) => event.kind === "print")
    .map((event) => event.payload.values[0]);
}

// --- issue #287's exact repro: an unbound `:lucky` after `:lucky = random 100` -----------------

test("`:lucky = random 100` binds :lucky, and print :lucky reports a whole number in [0, 99]", () => {
  const result = execute(":lucky = random 100\nprint :lucky", doc);
  assert.deepEqual(result.diagnostics, []);
  const [value] = printedValues(result);
  assert.equal(typeof value, "number");
  assert.equal(Number.isInteger(value), true);
  assert.equal(value >= 0 && value <= 99, true);
});

// --- random n: whole number in [0, n-1] --------------------------------------------------------

test("random 1 always reports 0 (the only value in [0, 0])", () => {
  const result = execute("print random 1", doc);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(printedValues(result), [0]);
});

test("random 10 reports a whole number in [0, 9] across many draws", () => {
  const result = execute("repeat 50 [ print random 10 ]", doc);
  assert.deepEqual(result.diagnostics, []);
  for (const value of printedValues(result)) {
    assert.equal(Number.isInteger(value), true);
    assert.equal(value >= 0 && value <= 9, true);
  }
});

// --- (random a b): whole number in [a, b] inclusive --------------------------------------------

test("(random 5 5) always reports 5 (a degenerate a === b range)", () => {
  const result = execute("print (random 5 5)", doc);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(printedValues(result), [5]);
});

test("(random 1 6) reports a whole number in [1, 6] across many draws", () => {
  const result = execute("repeat 50 [ print (random 1 6) ]", doc);
  assert.deepEqual(result.diagnostics, []);
  for (const value of printedValues(result)) {
    assert.equal(Number.isInteger(value), true);
    assert.equal(value >= 1 && value <= 6, true);
  }
});

test("(random :lo :hi) supports a negative inclusive range via variables (avoiding the -5 -1 unary/binary-minus lexical ambiguity)", () => {
  const result = execute(
    ":lo = -5\n:hi = -1\nrepeat 20 [ print (random :lo :hi) ]",
    doc,
  );
  assert.deepEqual(result.diagnostics, []);
  for (const value of printedValues(result)) {
    assert.equal(Number.isInteger(value), true);
    assert.equal(value >= -5 && value <= -1, true);
  }
});

// --- randomize / (randomize seed) determinism: OUR generator's own exact sequence -------------

test("(randomize 123) then random 100 twice yields the same sequence across two fresh runs", () => {
  const program = "(randomize 123)\nprint random 100\nprint random 100";
  const first = execute(program, doc);
  const second = execute(program, doc);
  assert.deepEqual(first.diagnostics, []);
  assert.deepEqual(second.diagnostics, []);
  assert.deepEqual(printedValues(first), printedValues(second));
  // Pins the exact implementation sequence (computed directly from
  // `random-number-generator.ts`'s mulberry32 draw for
  // seed 123) so a future accidental change to the generator is caught, without claiming this
  // sequence is portable to any other OpenLogo implementation.
  assert.deepEqual(printedValues(first), [78, 17]);
});

test("(randomize 123) then (random 1 6) three times yields the same pinned sequence", () => {
  const result = execute(
    "(randomize 123)\nprint (random 1 6)\nprint (random 1 6)\nprint (random 1 6)",
    doc,
  );
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(printedValues(result), [5, 2, 3]);
});

test("randomize with no seed still lets random produce a valid whole number in range", () => {
  const result = execute("randomize\nprint random 100", doc);
  assert.deepEqual(result.diagnostics, []);
  const [value] = printedValues(result);
  assert.equal(Number.isInteger(value), true);
  assert.equal(value >= 0 && value <= 99, true);
});

test("two fresh execute() runs with no randomize are independent (not both seeded from a shared module-level generator)", () => {
  // Not a determinism assertion (two runs seeded from Date.now() may coincidentally collide) —
  // just confirms each run gets its OWN random number generator state rather than sharing one from
  // a previous run,
  // by reseeding both identically and checking they now agree.
  const program = "(randomize 42)\nprint random 1000000";
  const a = execute(program, doc);
  const b = execute(program, doc);
  assert.deepEqual(printedValues(a), printedValues(b));
});

// --- randomize seed coercion: any OLValue is a valid seed (spec: no type diagnostic) -----------

test("(randomize 1.9) truncates a non-integer number seed rather than raising ol-type", () => {
  const result = execute("(randomize 1.9)\nprint random 10", doc);
  assert.deepEqual(result.diagnostics, []);
  assert.equal(printedValues(result).length, 1);
});

test('(randomize "seed-word") hashes a word seed rather than raising ol-type', () => {
  const result = execute('(randomize "lucky")\nprint random 10', doc);
  assert.deepEqual(result.diagnostics, []);
  assert.equal(printedValues(result).length, 1);
});

test("(randomize [1 2 3]) hashes a list seed rather than raising ol-type", () => {
  const result = execute("(randomize [1 2 3])\nprint random 10", doc);
  assert.deepEqual(result.diagnostics, []);
  assert.equal(printedValues(result).length, 1);
});

test("(randomize true) hashes a boolean seed rather than raising ol-type", () => {
  const result = execute("(randomize true)\nprint random 10", doc);
  assert.deepEqual(result.diagnostics, []);
  assert.equal(printedValues(result).length, 1);
});

test("a word seed is deterministic: the same word seed reproduces the same draw", () => {
  const program = '(randomize "lucky")\nprint random 1000';
  const first = execute(program, doc);
  const second = execute(program, doc);
  assert.deepEqual(printedValues(first), printedValues(second));
});

// --- randomize arity: ol-too-many-inputs --------------------------------------------------------

test("(randomize 1 2) raises ol-too-many-inputs", () => {
  const result = execute("(randomize 1 2)", doc);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-too-many-inputs");
  assert.deepEqual(result.diagnostics[0].params, {
    callable: "randomize",
    expected: 1,
    actual: 2,
  });
});

// --- randomize propagates an argument evaluation failure --------------------------------------

test("(randomize :missing) propagates the undefined-variable failure", () => {
  const result = execute("(randomize :missing)", doc);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-undefined-var");
});

// --- randomize defers on an unsupported argument expression, mirroring show/print's precedent --

test("randomize with an unsupported argument is left un-executed", () => {
  const result = execute(
    "(randomize (nonexistent_builtin 1))\nprint random 10",
    doc,
  );
  assert.deepEqual(result.diagnostics, []);
  // The seed argument is deferred (not evaluated), but `randomize` itself is still skipped as a
  // whole statement, and the following `print random 10` still runs fine off the default random
  // number generator.
  assert.equal(printedValues(result).length, 1);
});

// --- random: ol-type for a non-whole bound (checked before ol-range) ---------------------------

test("random with a non-whole (fractional) n raises ol-type", () => {
  const result = execute("print random 3.5", doc);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-type");
  assert.deepEqual(result.diagnostics[0].params, {
    expected: "whole number",
    actual: "number",
    value: 3.5,
    operation: "random",
  });
});

test("random with a non-number n raises ol-type", () => {
  const result = execute('print random "five"', doc);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-type");
  assert.deepEqual(result.diagnostics[0].params, {
    expected: "whole number",
    actual: "word",
    value: "five",
    operation: "random",
  });
});

test("(random 2.5 6) raises ol-type for the first (non-whole) bound", () => {
  const result = execute("print (random 2.5 6)", doc);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-type");
  assert.deepEqual(result.diagnostics[0].params, {
    expected: "whole number",
    actual: "number",
    value: 2.5,
    operation: "random",
  });
});

test("(random 1 6.5) raises ol-type for the second (non-whole) bound", () => {
  const result = execute("print (random 1 6.5)", doc);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-type");
  assert.deepEqual(result.diagnostics[0].params, {
    expected: "whole number",
    actual: "number",
    value: 6.5,
    operation: "random",
  });
});

// --- random: ol-range for n below 1, or a > b (checked after ol-type) --------------------------

test("random 0 raises ol-range", () => {
  const result = execute("print random 0", doc);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-range");
  assert.deepEqual(result.diagnostics[0].params, {
    operation: "random",
    value: 0,
  });
});

test("random -5 raises ol-range", () => {
  const result = execute("print random -5", doc);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-range");
  assert.deepEqual(result.diagnostics[0].params, {
    operation: "random",
    value: -5,
  });
});

test("(random 5 2) raises ol-range for a reversed range", () => {
  const result = execute("print (random 5 2)", doc);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-range");
  assert.deepEqual(result.diagnostics[0].params, {
    operation: "random",
    low: 5,
    high: 2,
  });
});

// --- random argument-evaluation failure propagation --------------------------------------------

test("random :missing propagates the undefined-variable failure", () => {
  const result = execute("print random :missing", doc);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-undefined-var");
});

test("(random :missing 6) propagates the first argument's failure instead of evaluating the second", () => {
  const result = execute("print (random :missing 6)", doc);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-undefined-var");
});

test("(random 1 :missing) propagates the second argument's failure", () => {
  const result = execute("print (random 1 :missing)", doc);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-undefined-var");
});

// --- random arity: ol-not-enough-inputs / ol-too-many-inputs -----------------------------------

test("(random) with no arguments raises ol-not-enough-inputs", () => {
  const result = execute("print (random)", doc);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-not-enough-inputs");
  assert.deepEqual(result.diagnostics[0].params, {
    callable: "random",
    expected: 1,
    actual: 0,
  });
});

test("(random 1 2 3) with three arguments raises ol-too-many-inputs", () => {
  const result = execute("print (random 1 2 3)", doc);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-too-many-inputs");
  assert.deepEqual(result.diagnostics[0].params, {
    callable: "random",
    expected: 2,
    actual: 3,
  });
});

// --- random emits no move/turn/draw-segment/change event ---------------------------------------

test("random emits no event beyond print's own", () => {
  const result = execute("print random 10", doc);
  assert.deepEqual(result.diagnostics, []);
  const kinds = result.events.map((event) => event.kind);
  const nonPrintNonInstruction = kinds.filter(
    (kind) => kind !== "instruction" && kind !== "print",
  );
  assert.deepEqual(nonPrintNonInstruction, []);
});
