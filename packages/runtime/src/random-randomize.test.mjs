// Unit tests for the Core Math reporter `random` and command `randomize` (issue #287,
// spec/commands.md's "random"/"randomize" entries). `random`'s own sequence is only
// "deterministic within an implementation" (not portable across implementations), so exact
// draws are asserted here — proving OUR generator's own determinism — rather than in a
// stack-neutral conformance fixture (`tests/conformance/`), which only asserts the portable
// negative (`ol-type`/`ol-range`) facts.

import assert from "node:assert/strict";
import { test } from "node:test";
import { execute } from "@openlogo/runtime";
// `drawImplementationSeed` is module-internal (deliberately not part of `@openlogo/runtime`'s
// public surface), so it is reached through this package's own `dist/` build — the same deep
// relative import `execution-budget.test.mjs` and `not-a-place-text.test.mjs` already use for
// internals. Testing it directly is what lets the no-short-cycle property below be proven in
// milliseconds instead of through hundreds of thousands of `execute()` statements.
import { drawImplementationSeed } from "../dist/random-number-generator.js";

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
  // Issue #815: the unresolvable callee is now REPORTED, not silently skipped. The check before
  // execution refuses the program (`spec/execution-model.md:659-664`), so the effect below never
  // happens — but for a reason the learner is told, which is the whole point of the slice.
  assert.deepEqual(
    result.diagnostics.map((diagnostic) => diagnostic.code),
    ["ol-unknown-command"],
  );
  // Nothing runs at all now, so the following `print random 10` never reports either — the
  // program is refused as a whole rather than partly executed around an unreadable statement.
  assert.deepEqual(printedValues(result), []);
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

// --- issue #865: ExecuteOptions.randomSeed pins a run's randomness -----------------------------
// The generator's Date.now() fallback is this package's only AMBIENT entropy source (nothing else
// reads a wall clock or Math.random(), and the tick clock is a pure counter), so a pinned seed
// reproduces a run exactly — given host collaborators that are deterministic too, which the tests
// below are because they supply none. Every determinism assertion is paired with its inverse, and
// the two covering a bare `randomize` pin EXACT sequences rather than merely comparing two runs:
// two clock-seeded runs inside one millisecond also agree, so an equality-only assertion passes
// against an implementation that ignores the seed entirely.

const eightDraws = "repeat 8 [ print random 1000000 ]";

test("issue #865: the same randomSeed reproduces the identical sequence across two fresh runs", () => {
  const first = execute(eightDraws, doc, { randomSeed: 20260822 });
  const second = execute(eightDraws, doc, { randomSeed: 20260822 });
  assert.deepEqual(first.diagnostics, []);
  assert.deepEqual(second.diagnostics, []);
  assert.deepEqual(printedValues(first), printedValues(second));
});

test("issue #865: a DIFFERENT randomSeed draws a different sequence (the seed is really consulted)", () => {
  const first = printedValues(execute(eightDraws, doc, { randomSeed: 1 }));
  const second = printedValues(execute(eightDraws, doc, { randomSeed: 2 }));
  assert.equal(first.length, 8);
  assert.notDeepEqual(first, second);
});

test("issue #865: randomSeed reproduces the WHOLE event stream, not just the printed values", () => {
  const program = "repeat 8 [ forward random 100 right random 360 ]";
  const first = execute(program, doc, { randomSeed: 7 });
  const second = execute(program, doc, { randomSeed: 7 });
  assert.deepEqual(first.diagnostics, []);
  assert.deepEqual(first.events, second.events);
  const other = execute(program, doc, { randomSeed: 8 });
  assert.notDeepEqual(first.events, other.events);
});

test("issue #865: randomSeed changes which branch a random-controlled program takes", () => {
  // The #881 shape: nondeterminism that decides WHICH question is asked. Pinning the seed pins
  // the branch, and the two seeds below genuinely disagree — so this fails if the seed is dropped.
  const program = 'if (random 2) == 0 [ print "heads" ] else [ print "tails" ]';
  const tails = execute(program, doc, { randomSeed: 1 });
  assert.deepEqual(tails.diagnostics, []);
  assert.deepEqual(printedValues(tails), ["tails"]);
  assert.deepEqual(printedValues(execute(program, doc, { randomSeed: 1 })), [
    "tails",
  ]);
  const heads = execute(program, doc, { randomSeed: 7 });
  assert.deepEqual(heads.diagnostics, []);
  assert.deepEqual(printedValues(heads), ["heads"]);
});

test("issue #865: randomSeed is a host DEFAULT — an explicit (randomize seed) still overrides it", () => {
  const program = "(randomize 123)\nprint random 100\nprint random 100";
  const seeded = execute(program, doc, { randomSeed: 999 });
  assert.deepEqual(seeded.diagnostics, []);
  // The exact sequence the existing "(randomize 123)" test pins, unchanged by the host seed.
  assert.deepEqual(printedValues(seeded), [78, 17]);
});

test("issue #865: a no-argument randomize keeps a seeded run deterministic (it no longer reads the clock)", () => {
  const program = `randomize\n${eightDraws}`;
  // EXACT values, not just "the two runs agree". Two clock-seeded runs inside one millisecond also
  // agree, so an equality-only assertion passes ~3% of the time against an implementation that
  // reverted to `Date.now()` here — measured by @testing, who observed a whole file run go green
  // under exactly that mutant. A clock-derived seed reproduces this pinned sequence with
  // probability ~2^-32.
  const expected = [
    591681, 232006, 586643, 320322, 425916, 342336, 910498, 26572,
  ];
  assert.deepEqual(
    printedValues(execute(program, doc, { randomSeed: 555 })),
    expected,
  );
  assert.deepEqual(
    printedValues(execute(program, doc, { randomSeed: 555 })),
    expected,
  );
  // ...and the derived seed really descends from the pinned one, so a different pin diverges.
  assert.deepEqual(
    printedValues(execute(program, doc, { randomSeed: 556 })),
    [737296, 671487, 74112, 401733, 623432, 871019, 727490, 320218],
  );
});

test("issue #865: two no-argument randomize calls in one run no longer collapse to the same state", () => {
  // Before #865 both reseeded from Date.now(), so two calls landing in the same millisecond
  // produced the IDENTICAL sequence twice. Pinned to exact values for the reason above: a
  // "the two halves differ" assertion alone passes whenever a millisecond boundary happens to fall
  // between the two `randomize` calls.
  const values = printedValues(
    execute(
      "randomize\nprint random 1000000\nprint random 1000000\nrandomize\nprint random 1000000\nprint random 1000000",
      doc,
      { randomSeed: 31337 },
    ),
  );
  assert.deepEqual(values, [570348, 701841, 29899, 755230]);
  assert.notDeepEqual([values[0], values[1]], [values[2], values[3]]);
});

test("issue #865: repeated no-argument randomize never collapses into a short cycle", () => {
  // The reseed must not feed a DRAWN value back in as the generator's state: that mapping is not
  // injective, so iterating it walks a rho and settles into a short cycle — measured at period
  // 8,398 from seed 42 and 42,379 from seed 0 on an earlier revision of this slice, which would
  // quietly degrade `random` for a program that reseeds in a loop. Advancing the state by an odd
  // stride is a bijection, so every reseed reaches a state not seen before.
  const generator = { state: 0 };
  const seen = new Set();
  for (let index = 0; index < 200000; index += 1) {
    assert.equal(
      seen.has(generator.state),
      false,
      `state ${generator.state} repeated after ${index} reseeds`,
    );
    seen.add(generator.state);
    generator.state = drawImplementationSeed(generator);
  }
  assert.equal(seen.size, 200000);
});

test("issue #865: randomSeed 0 is honoured, not treated as 'no seed' (the falsy boundary)", () => {
  const draws = "repeat 5 [ print random 100 ]";
  assert.deepEqual(
    printedValues(execute(draws, doc, { randomSeed: 0 })),
    [26, 0, 22, 14, 46],
  );
  assert.deepEqual(
    printedValues(execute(draws, doc, { randomSeed: 0 })),
    [26, 0, 22, 14, 46],
  );
});

test("issue #865: a host randomSeed and the program's own (randomize seed) agree for the same seed", () => {
  // The host default IS the same seeding path the program-level command uses, so pinning 123 from
  // outside must reproduce the sequence this file already pins for `(randomize 123)`.
  assert.deepEqual(
    printedValues(
      execute("print random 100\nprint random 100", doc, { randomSeed: 123 }),
    ),
    [78, 17],
  );
});

test("issue #865: omitting randomSeed falls back to the host clock", () => {
  // Pins the fallback itself rather than just "a number in range": with `Date.now` stubbed, an
  // omitted seed must reproduce exactly what passing that same value explicitly produces.
  const realDateNow = Date.now;
  Date.now = () => 123;
  try {
    assert.deepEqual(
      printedValues(execute("print random 100\nprint random 100", doc)),
      [78, 17],
    );
  } finally {
    Date.now = realDateNow;
  }
});

test("issue #865: omitting randomSeed leaves an ordinary run seeded from the clock and still in range", () => {
  const result = execute("print random 100", doc, { instructionBudget: 500 });
  assert.deepEqual(result.diagnostics, []);
  const [value] = printedValues(result);
  assert.equal(Number.isInteger(value), true);
  assert.equal(value >= 0 && value <= 99, true);
});
