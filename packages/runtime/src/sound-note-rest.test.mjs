// Unit tests for the Sound profile's `note` and `rest` primitives (issue #690, slice S2 of the
// Sound epic #662; spec/interaction-events.md's "Sound primitives" section). `note <pitch> <dur>`
// takes a scientific-pitch-notation word (lowercase canonical spelling: `"c4"`, `"fs4"` sharp,
// `"bb3"` flat) and a positive number of beats; a non-word pitch raises `ol-type` (expected:word), a
// malformed pitch raises `ol-type` (expected:pitch), and a non-positive/non-finite duration raises
// `ol-range`. `rest <dur>` takes a positive number of beats. Both emit their duration in beats and
// emit a `sound` event AFTER scheduling — unconditionally, even when audio
// is unavailable/muted, so deterministic replay never depends on the speaker ("Implementations that
// cannot play audio ... MUST still emit `sound` events"). `rest` emits its event "so replay tools
// can show the silent interval".

import assert from "node:assert/strict";
import { test } from "node:test";
import { execute } from "@openlogo/runtime";

test("note emits one sound event carrying pitch and duration, after the instruction event", () => {
  const result = execute('note "c4" 1', "main.logo");
  assert.deepEqual(result.diagnostics, []);
  const kinds = result.events.map((event) => event.kind);
  assert.deepEqual(kinds, ["instruction", "sound"]);
  assert.deepEqual(result.events[1].payload, {
    command: "note",
    pitch: "c4",
    duration: 1,
  });
});

test("note accepts sharp and flat pitch spellings", () => {
  const result = execute('note "fs4" 2\nnote "bb3" 1', "main.logo");
  assert.deepEqual(result.diagnostics, []);
  const payloads = result.events
    .filter((event) => event.kind === "sound")
    .map((event) => event.payload);
  assert.deepEqual(payloads, [
    { command: "note", pitch: "fs4", duration: 2 },
    { command: "note", pitch: "bb3", duration: 1 },
  ]);
});

test("note accepts a fractional positive duration and a numeric-word duration", () => {
  const result = execute('note "c4" 0.5\nnote "c4" "2"', "main.logo");
  assert.deepEqual(result.diagnostics, []);
  const durations = result.events
    .filter((event) => event.kind === "sound")
    .map((event) => event.payload.duration);
  assert.deepEqual(durations, [0.5, 2]);
});

test("note and rest emit beat durations, with the tempo carried by its own event", () => {
  // The runtime is headless: the `note` carries its duration in beats and the tempo travels as its
  // own earlier `sound` event. The note/rest payloads below are therefore the same whatever tempo
  // precedes them, and the run raises no diagnostic.
  const result = execute(
    'set_tempo 60\nnote "c4" 1\nrest 1\nnote "c4" 1',
    "main.logo",
  );
  assert.deepEqual(result.diagnostics, []);
  const payloads = result.events
    .filter((event) => event.kind === "sound")
    .map((event) => event.payload);
  assert.deepEqual(payloads, [
    { command: "set_tempo", beats_per_minute: 60 },
    { command: "note", pitch: "c4", duration: 1 },
    { command: "rest", duration: 1 },
    { command: "note", pitch: "c4", duration: 1 },
  ]);
});

test("note raises ol-type for a non-word pitch and emits no sound event", () => {
  const result = execute("note 4 1", "main.logo");
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-type");
  assert.deepEqual(result.diagnostics[0].params, {
    expected: "word",
    actual: "number",
    value: 4,
    operation: "note",
  });
  assert.ok(!result.events.some((event) => event.kind === "sound"));
});

test("note raises ol-type (expected:pitch) for a malformed pitch word", () => {
  const result = execute('note "h9" 1', "main.logo");
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-type");
  assert.deepEqual(result.diagnostics[0].params, {
    expected: "pitch",
    actual: "word",
    value: "h9",
    operation: "note",
  });
  assert.ok(!result.events.some((event) => event.kind === "sound"));
});

test("note rejects an uppercase pitch word (canonical spelling is lowercase)", () => {
  const result = execute('note "C4" 1', "main.logo");
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-type");
  assert.equal(result.diagnostics[0].params.expected, "pitch");
});

test("note raises ol-range for a non-positive duration and emits no sound event", () => {
  const result = execute('note "c4" 0', "main.logo");
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-range");
  assert.deepEqual(result.diagnostics[0].params, {
    operation: "note",
    value: "0",
  });
  assert.ok(!result.events.some((event) => event.kind === "sound"));
});

test("note raises ol-range for an infinite duration", () => {
  const result = execute('note "c4" 1e400', "main.logo");
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-range");
  assert.equal(result.diagnostics[0].params.operation, "note");
  assert.equal(result.diagnostics[0].params.value, "Infinity");
});

test("note validates the pitch before the duration", () => {
  // A bad pitch AND a bad duration: the pitch error is reported first, so exactly one diagnostic.
  const result = execute('note "nope" 0', "main.logo");
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].params.expected, "pitch");
});

test("note propagates a runtime error from evaluating the pitch expression", () => {
  const result = execute("note (1 / 0) 1", "main.logo");
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-div-zero");
  assert.ok(!result.events.some((event) => event.kind === "sound"));
});

test("note propagates a runtime error from evaluating the duration expression", () => {
  const result = execute('note "c4" (1 / 0)', "main.logo");
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-div-zero");
  assert.ok(!result.events.some((event) => event.kind === "sound"));
});

test("note raises ol-type when the duration is a list", () => {
  const result = execute('note "c4" [1 2]', "main.logo");
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-type");
  assert.equal(result.diagnostics[0].params.operation, "note");
});

test("note leaves an unsupported argument expression un-evaluated (no event, no error)", () => {
  // `forward` is a command, not a reporter, so it is not a supported argument expression — the
  // handler returns without scheduling, mirroring every other primitive's argument-gating.
  const result = execute('note "c4" forward', "main.logo");
  assert.deepEqual(result.diagnostics, []);
  assert.ok(!result.events.some((event) => event.kind === "sound"));
});

test("note leaves an unsupported pitch expression un-evaluated (no event, no error)", () => {
  // The pitch operand is gated first (issue #690 review): an unsupported *pitch* expression
  // (a parenthesized command, not a reporter) returns before the duration is ever inspected —
  // no event, no diagnostic.
  const result = execute("note (forward) 1", "main.logo");
  assert.deepEqual(result.diagnostics, []);
  assert.ok(!result.events.some((event) => event.kind === "sound"));
});

test("note reports the invalid-pitch error before inspecting the duration argument", () => {
  // Pitch is validated fully before the duration is preflighted, so a bad pitch wins even when
  // the duration expression is itself unsupported (`forward`) — otherwise the pitch error would
  // be silently swallowed (rubber-duck finding, issue #690).
  const result = execute('note "bad" forward', "main.logo");
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-type");
  assert.ok(!result.events.some((event) => event.kind === "sound"));
});

test("note raises ol-not-enough-inputs when given one argument", () => {
  const result = execute('note "c4"', "main.logo");
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-not-enough-inputs");
});

test("note raises ol-too-many-inputs when given three arguments", () => {
  const result = execute('(note "c4" 1 2)', "main.logo");
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-too-many-inputs");
});

test("rest emits one sound event carrying its duration, after the instruction event", () => {
  const result = execute("rest 1", "main.logo");
  assert.deepEqual(result.diagnostics, []);
  const kinds = result.events.map((event) => event.kind);
  assert.deepEqual(kinds, ["instruction", "sound"]);
  assert.deepEqual(result.events[1].payload, {
    command: "rest",
    duration: 1,
  });
});

test("rest accepts a fractional duration and a numeric-word duration", () => {
  const result = execute('rest 0.25\nrest "3"', "main.logo");
  assert.deepEqual(result.diagnostics, []);
  const durations = result.events
    .filter((event) => event.kind === "sound")
    .map((event) => event.payload.duration);
  assert.deepEqual(durations, [0.25, 3]);
});

test("rest raises ol-type for a non-number duration and emits no sound event", () => {
  const result = execute('rest "soon"', "main.logo");
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-type");
  assert.equal(result.diagnostics[0].params.operation, "rest");
  assert.ok(!result.events.some((event) => event.kind === "sound"));
});

test("rest raises ol-range for a non-positive duration", () => {
  const result = execute("rest -1", "main.logo");
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-range");
  assert.deepEqual(result.diagnostics[0].params, {
    operation: "rest",
    value: "-1",
  });
});

test("rest propagates a runtime error from evaluating the duration expression", () => {
  const result = execute("rest (1 / 0)", "main.logo");
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-div-zero");
  assert.ok(!result.events.some((event) => event.kind === "sound"));
});

test("rest leaves an unsupported argument expression un-evaluated (no event, no error)", () => {
  const result = execute("rest forward", "main.logo");
  assert.deepEqual(result.diagnostics, []);
  assert.ok(!result.events.some((event) => event.kind === "sound"));
});

test("rest raises ol-not-enough-inputs when given no argument", () => {
  const result = execute("rest", "main.logo");
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-not-enough-inputs");
});

test("rest raises ol-too-many-inputs when given two arguments", () => {
  const result = execute("(rest 1 2)", "main.logo");
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-too-many-inputs");
});
