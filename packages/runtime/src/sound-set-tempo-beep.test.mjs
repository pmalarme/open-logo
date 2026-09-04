// Unit tests for the Sound profile's `set_tempo` and `beep` primitives (issue #689, slice S1 of the
// Sound epic #662; spec/interaction-events.md's "Sound primitives" section). `set_tempo` takes one
// positive number (the beats-per-minute), validated by `requireNumber` (a non-number raises
// `ol-type`) then a positive-and-finite guard (`0`, a negative, or a non-finite value raises
// `ol-range`) before updating the shared tempo state and emitting a `sound` event
// (`{command:"set_tempo", beats_per_minute}`). `beep` takes no arguments and emits a `sound` event
// (`{command:"beep"}`) unconditionally — the runtime models sound as scheduling + event emission,
// never a real audio device, so the event is emitted even in a muted environment, keeping replay
// deterministic. The `sound` event follows the state change ("Sound commands emit `sound` events
// after sound state has been scheduled").

import assert from "node:assert/strict";
import { test } from "node:test";
import { execute } from "@openlogo/runtime";

test("set_tempo emits one sound event carrying the beats-per-minute, after the instruction event", () => {
  const result = execute("set_tempo 90", "main.logo");
  assert.deepEqual(result.diagnostics, []);
  const kinds = result.events.map((event) => event.kind);
  assert.deepEqual(kinds, ["instruction", "sound"]);
  assert.deepEqual(result.events[1].payload, {
    command: "set_tempo",
    beats_per_minute: 90,
  });
});

test("set_tempo accepts a fractional positive tempo", () => {
  const result = execute("set_tempo 90.5", "main.logo");
  assert.deepEqual(result.diagnostics, []);
  const sound = result.events.find((event) => event.kind === "sound");
  assert.deepEqual(sound.payload, {
    command: "set_tempo",
    beats_per_minute: 90.5,
  });
});

test("set_tempo reads as a number from a numeric word argument", () => {
  const result = execute('set_tempo "72"', "main.logo");
  assert.deepEqual(result.diagnostics, []);
  const sound = result.events.find((event) => event.kind === "sound");
  assert.deepEqual(sound.payload, {
    command: "set_tempo",
    beats_per_minute: 72,
  });
});

test("a set_tempo made inside a procedure is shared with the rest of the run", () => {
  // The tempo state is a shared mutable box, so a `set_tempo` deep in a call still schedules its
  // event and updates the run's one tempo state. Both sound
  // events are emitted, in order, with no diagnostics.
  const result = execute(
    "define go\n  set_tempo 60\nend\ngo\nset_tempo 200\n",
    "main.logo",
  );
  assert.deepEqual(result.diagnostics, []);
  const tempos = result.events
    .filter((event) => event.kind === "sound")
    .map((event) => event.payload.beats_per_minute);
  assert.deepEqual(tempos, [60, 200]);
});

test("set_tempo raises ol-type for a non-number tempo and emits no sound event", () => {
  const result = execute('set_tempo "fast"', "main.logo");
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-type");
  assert.deepEqual(result.diagnostics[0].params, {
    expected: "number",
    actual: "word",
    value: "fast",
    operation: "set_tempo",
  });
  assert.equal(
    result.events.some((event) => event.kind === "sound"),
    false,
  );
});

test("set_tempo raises ol-range for a zero tempo", () => {
  const result = execute("set_tempo 0", "main.logo");
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-range");
  assert.deepEqual(result.diagnostics[0].params, {
    operation: "set_tempo",
    value: "0",
  });
  assert.equal(
    result.events.some((event) => event.kind === "sound"),
    false,
  );
});

test("set_tempo raises ol-range for a negative tempo", () => {
  const result = execute("set_tempo -30", "main.logo");
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-range");
  assert.deepEqual(result.diagnostics[0].params, {
    operation: "set_tempo",
    value: "-30",
  });
});

test("set_tempo raises ol-range for a non-finite tempo (Infinity via overflow)", () => {
  const result = execute("set_tempo power 10 1000", "main.logo");
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-range");
  assert.deepEqual(result.diagnostics[0].params, {
    operation: "set_tempo",
    value: "Infinity",
  });
});

test("set_tempo with no argument raises ol-not-enough-inputs", () => {
  // Issue #815: `execute()` now runs the semantic check first, and this arity fault is one the
  // checker decides statically — so the program is refused before Phase 2 and the runtime guard
  // below would never be reached. `runUnchecked` is the spec’s own opt-out
  // (`spec/execution-model.md:687-694`), and is what keeps the runtime guard exercised: it runs,
  // raises the identical fault, and `spec/execution-model.md:746-748` collapses the second report
  // into the first — which is why the surviving diagnostic reads `stage: "semantic"`.
  const result = execute("set_tempo", "main.logo", { runUnchecked: true });
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-not-enough-inputs");
  assert.deepEqual(result.diagnostics[0].params, {
    callable: "set_tempo",
    expected: 1,
    actual: 0,
  });
});

test("parenthesized set_tempo with two arguments raises ol-too-many-inputs", () => {
  // Issue #815: `execute()` now runs the semantic check first, and this arity fault is one the
  // checker decides statically — so the program is refused before Phase 2 and the runtime guard
  // below would never be reached. `runUnchecked` is the spec’s own opt-out
  // (`spec/execution-model.md:687-694`), and is what keeps the runtime guard exercised: it runs,
  // raises the identical fault, and `spec/execution-model.md:746-748` collapses the second report
  // into the first — which is why the surviving diagnostic reads `stage: "semantic"`.
  const result = execute("(set_tempo 90 100)", "main.logo", {
    runUnchecked: true,
  });
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-too-many-inputs");
  assert.deepEqual(result.diagnostics[0].params, {
    callable: "set_tempo",
    expected: 1,
    actual: 2,
  });
});

test("set_tempo reports the unresolvable unsupported argument expression instead of skipping the call", () => {
  // A parenthesized call to an unknown callable is an argument expression this slice's evaluator
  // does not give a value to; mirroring `set_width`, the statement is left un-evaluated rather than
  // throwing.
  const result = execute("set_tempo (nonexistent_builtin 1)", "main.logo", {
    runUnchecked: true,
  });
  // Issue #815: the unresolvable callee is now REPORTED, not silently skipped. It is reported by
  // the check before execution (`spec/execution-model.md:659-664`); `runUnchecked` — the spec's own
  // opt-out — makes the program run anyway, so the evaluator ALSO reaches the callee and raises,
  // and the two identical reports collapse to one (`spec/execution-model.md:741-748`). The effect
  // below still never happens, but now for a reason the learner is told.
  assert.deepEqual(
    result.diagnostics.map((diagnostic) => diagnostic.code),
    ["ol-unknown-command"],
  );
  assert.equal(
    result.events.some((event) => event.kind === "sound"),
    false,
  );
});

test("set_tempo propagates a diagnostic raised while evaluating its argument", () => {
  const result = execute('set_tempo power "a" 1', "main.logo");
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-type");
  assert.equal(result.diagnostics[0].params.operation, "power");
  assert.equal(
    result.events.some((event) => event.kind === "sound"),
    false,
  );
});

test("beep emits one sound event with a beep payload, after the instruction event", () => {
  const result = execute("beep", "main.logo");
  assert.deepEqual(result.diagnostics, []);
  const kinds = result.events.map((event) => event.kind);
  assert.deepEqual(kinds, ["instruction", "sound"]);
  assert.deepEqual(result.events[1].payload, { command: "beep" });
});

test("beep emits its sound event deterministically even with no audio device (muted replay)", () => {
  // The runtime never touches an audio device, so `beep`'s event is emitted the same way whether or
  // not sound can be played — two runs of the same source produce byte-identical sound payloads.
  const first = execute("beep", "main.logo");
  const second = execute("beep", "main.logo");
  const soundOf = (result) =>
    result.events
      .filter((event) => event.kind === "sound")
      .map((e) => e.payload);
  assert.deepEqual(soundOf(first), [{ command: "beep" }]);
  assert.deepEqual(soundOf(first), soundOf(second));
});

test("parenthesized beep with an argument raises ol-too-many-inputs", () => {
  // Issue #815: `execute()` now runs the semantic check first, and this arity fault is one the
  // checker decides statically — so the program is refused before Phase 2 and the runtime guard
  // below would never be reached. `runUnchecked` is the spec’s own opt-out
  // (`spec/execution-model.md:687-694`), and is what keeps the runtime guard exercised: it runs,
  // raises the identical fault, and `spec/execution-model.md:746-748` collapses the second report
  // into the first — which is why the surviving diagnostic reads `stage: "semantic"`.
  const result = execute("(beep 1)", "main.logo", { runUnchecked: true });
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-too-many-inputs");
  assert.deepEqual(result.diagnostics[0].params, {
    callable: "beep",
    expected: 0,
    actual: 1,
  });
});

test("set_tempo then beep emit their sound events in program order", () => {
  const result = execute("set_tempo 90\nbeep", "main.logo");
  assert.deepEqual(result.diagnostics, []);
  const payloads = result.events
    .filter((event) => event.kind === "sound")
    .map((event) => event.payload);
  assert.deepEqual(payloads, [
    { command: "set_tempo", beats_per_minute: 90 },
    { command: "beep" },
  ]);
});
