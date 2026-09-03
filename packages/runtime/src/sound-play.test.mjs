// Unit tests for the Sound profile's `play <melody-list>` primitive (issue #691, slice S3 of the
// Sound epic #662; spec/interaction-events.md's `play` section). `play` takes one list of
// pitch/duration pairs in sequence: the list length MUST be even (odd -> `ol-range`), a non-list
// argument raises `ol-type` (expected:list), each pitch MUST be a scientific-pitch-notation word or
// the literal word `"rest"` (bad -> `ol-type`, reusing `note`'s expected:word/expected:pitch
// identities), and each duration MUST be a positive finite number (non-positive/non-finite ->
// `ol-range`). On success `play` resolves the melody into an ordered `{ pitch, duration }` array
// (durations in beats, carried verbatim, never converted here) and
// emits EXACTLY ONE `sound` event carrying that whole melody, after the instruction event and
// unconditionally even when audio is muted, so deterministic replay never depends on the speaker.

import assert from "node:assert/strict";
import { test } from "node:test";
import { execute } from "@openlogo/runtime";

test("play emits one sound event carrying the whole resolved melody, after the instruction event", () => {
  const result = execute(
    'play ["c4" 1 "e4" 1 "g4" 2 "rest" 1 "g4" 1]',
    "main.logo",
  );
  assert.deepEqual(result.diagnostics, []);
  const kinds = result.events.map((event) => event.kind);
  assert.deepEqual(kinds, ["instruction", "sound"]);
  assert.deepEqual(result.events[1].payload, {
    command: "play",
    melody: [
      { pitch: "c4", duration: 1 },
      { pitch: "e4", duration: 1 },
      { pitch: "g4", duration: 2 },
      { pitch: "rest", duration: 1 },
      { pitch: "g4", duration: 1 },
    ],
  });
});

test("play sequences steps in order (the melody is resolved, not merely validated)", () => {
  const result = execute('play ["e4" 1 "c4" 2]', "main.logo");
  assert.deepEqual(result.diagnostics, []);
  const sound = result.events.find((event) => event.kind === "sound");
  assert.deepEqual(sound.payload.melody, [
    { pitch: "e4", duration: 1 },
    { pitch: "c4", duration: 2 },
  ]);
});

test("play accepts sharp and flat pitch spellings and the literal rest pitch", () => {
  const result = execute('play ["fs4" 1 "bb3" 1 "rest" 1]', "main.logo");
  assert.deepEqual(result.diagnostics, []);
  const sound = result.events.find((event) => event.kind === "sound");
  assert.deepEqual(sound.payload.melody, [
    { pitch: "fs4", duration: 1 },
    { pitch: "bb3", duration: 1 },
    { pitch: "rest", duration: 1 },
  ]);
});

test("play accepts fractional and numeric-word durations", () => {
  const result = execute('play ["c4" 0.5 "c4" "2"]', "main.logo");
  assert.deepEqual(result.diagnostics, []);
  const sound = result.events.find((event) => event.kind === "sound");
  assert.deepEqual(sound.payload.melody, [
    { pitch: "c4", duration: 0.5 },
    { pitch: "c4", duration: 2 },
  ]);
});

test("play accepts an empty melody list (even length 0) and emits one sound event", () => {
  const result = execute("play []", "main.logo");
  assert.deepEqual(result.diagnostics, []);
  const sound = result.events.find((event) => event.kind === "sound");
  assert.deepEqual(sound.payload, { command: "play", melody: [] });
});

test("play is scheduled after an earlier set_tempo (headless: tempo state, not payload timing)", () => {
  const result = execute('set_tempo 60\nplay ["c4" 1]', "main.logo");
  assert.deepEqual(result.diagnostics, []);
  const payloads = result.events
    .filter((event) => event.kind === "sound")
    .map((event) => event.payload);
  assert.deepEqual(payloads, [
    { command: "set_tempo", beats_per_minute: 60 },
    { command: "play", melody: [{ pitch: "c4", duration: 1 }] },
  ]);
});

test("play emits its sound event deterministically with no audio device (muted replay)", () => {
  // The runtime never touches an audio device, so `play`'s event is emitted the same way whether or
  // not sound can be played — two runs of the same source produce byte-identical melody payloads.
  const first = execute('play ["c4" 1]', "main.logo");
  const second = execute('play ["c4" 1]', "main.logo");
  const soundOf = (result) =>
    result.events
      .filter((event) => event.kind === "sound")
      .map((e) => e.payload);
  assert.deepEqual(soundOf(first), [
    { command: "play", melody: [{ pitch: "c4", duration: 1 }] },
  ]);
  assert.deepEqual(soundOf(first), soundOf(second));
});

test("play raises ol-type (expected:list) for a non-list argument and emits no sound event", () => {
  const result = execute('play "c4"', "main.logo");
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-type");
  assert.deepEqual(result.diagnostics[0].params, {
    expected: "list",
    actual: "word",
    value: "c4",
    operation: "play",
  });
  assert.ok(!result.events.some((event) => event.kind === "sound"));
});

test("play raises ol-range for an odd-length melody list and emits no sound event", () => {
  const result = execute('play ["c4" 1 "e4"]', "main.logo");
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-range");
  assert.deepEqual(result.diagnostics[0].params, {
    operation: "play",
    value: 3,
    length: 3,
  });
  assert.ok(!result.events.some((event) => event.kind === "sound"));
});

test("play reports an earlier bad duration before the odd-length structural error", () => {
  // `["c4" 0 "e4"]` is odd-length AND has a non-positive duration in the first pair. Left-to-right
  // validation means the earlier `0` duration wins over the trailing unmatched pitch (rubber-duck).
  const result = execute('play ["c4" 0 "e4"]', "main.logo");
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-range");
  assert.deepEqual(result.diagnostics[0].params, {
    operation: "play",
    value: "0",
  });
});

test("play reports a bad pitch before the odd-length structural error", () => {
  // Single-element list: the pitch "h9" is both malformed AND leaves the list odd. The leftmost
  // offending element (the bad pitch) wins.
  const result = execute('play ["h9"]', "main.logo");
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-type");
  assert.equal(result.diagnostics[0].params.expected, "pitch");
});

test("play reports a well-formed trailing pitch with no duration as odd-length", () => {
  // A single VALID pitch with no partner: no earlier element error, so the odd-length rule fires.
  const result = execute('play ["c4"]', "main.logo");
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-range");
  assert.deepEqual(result.diagnostics[0].params, {
    operation: "play",
    value: 1,
    length: 1,
  });
});

test("play raises ol-type (expected:word) for a non-word pitch element", () => {
  const result = execute("play [4 1]", "main.logo");
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-type");
  assert.deepEqual(result.diagnostics[0].params, {
    expected: "word",
    actual: "number",
    value: 4,
    operation: "play",
  });
  assert.ok(!result.events.some((event) => event.kind === "sound"));
});

test("play raises ol-type (expected:pitch) for a malformed pitch element", () => {
  const result = execute('play ["h9" 1]', "main.logo");
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-type");
  assert.deepEqual(result.diagnostics[0].params, {
    expected: "pitch",
    actual: "word",
    value: "h9",
    operation: "play",
  });
  assert.ok(!result.events.some((event) => event.kind === "sound"));
});

test("play rejects an uppercase pitch element (canonical spelling is lowercase)", () => {
  const result = execute('play ["C4" 1]', "main.logo");
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-type");
  assert.equal(result.diagnostics[0].params.expected, "pitch");
});

test("play does not treat rest as a valid pitch outside the exact literal spelling", () => {
  const result = execute('play ["rests" 1]', "main.logo");
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].params.expected, "pitch");
});

test("play raises ol-range for a non-positive duration element and emits no sound event", () => {
  const result = execute('play ["c4" 0]', "main.logo");
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-range");
  assert.deepEqual(result.diagnostics[0].params, {
    operation: "play",
    value: "0",
  });
  assert.ok(!result.events.some((event) => event.kind === "sound"));
});

test("play raises ol-range for an infinite duration element", () => {
  const result = execute('play ["c4" 1e400]', "main.logo");
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-range");
  assert.equal(result.diagnostics[0].params.operation, "play");
  assert.equal(result.diagnostics[0].params.value, "Infinity");
});

test("play raises ol-type for a non-number duration element", () => {
  const result = execute('play ["c4" "loud"]', "main.logo");
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-type");
  assert.equal(result.diagnostics[0].params.operation, "play");
});

test("play validates elements left to right: the earliest error wins", () => {
  // First pair is fine, second pair has a bad pitch AND a bad duration -> the pitch error is
  // reported (one diagnostic), proving order and short-circuit.
  const result = execute('play ["c4" 1 "nope" 0]', "main.logo");
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].params.expected, "pitch");
});

test("play with no argument raises ol-not-enough-inputs", () => {
  const result = execute("play", "main.logo");
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-not-enough-inputs");
  assert.deepEqual(result.diagnostics[0].params, {
    callable: "play",
    expected: 1,
    actual: 0,
  });
});

test("parenthesized play with two arguments raises ol-too-many-inputs", () => {
  const result = execute('(play ["c4" 1] ["e4" 1])', "main.logo");
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-too-many-inputs");
  assert.deepEqual(result.diagnostics[0].params, {
    callable: "play",
    expected: 1,
    actual: 2,
  });
});

test("play propagates a runtime error from evaluating the melody expression", () => {
  const result = execute("play (1 / 0)", "main.logo");
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-div-zero");
  assert.ok(!result.events.some((event) => event.kind === "sound"));
});

test("play leaves an unsupported argument expression un-evaluated (no event, no error)", () => {
  const result = execute("play forward", "main.logo");
  assert.deepEqual(result.diagnostics, []);
  assert.ok(!result.events.some((event) => event.kind === "sound"));
});
