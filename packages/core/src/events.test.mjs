import assert from "node:assert/strict";
import { test } from "node:test";
import * as OL from "@openlogo/core";

function makeSpan() {
  return OL.makeSpan("main.logo", [1, 1], [1, 1]);
}

test("pen-change payload carries pen state before and after (up vs down)", () => {
  const event = {
    seq: 1,
    kind: "pen-change",
    source_span: makeSpan(),
    turtle_id: 0,
    payload: { from: "down", to: "up" },
  };
  assert.ok(OL.isEventKind(event.kind));
  assert.equal(event.payload.from, "down");
  assert.equal(event.payload.to, "up");
});

test("visibility-change payload carries visibility before and after", () => {
  const event = {
    seq: 2,
    kind: "visibility-change",
    source_span: makeSpan(),
    turtle_id: 0,
    payload: { from: true, to: false },
  };
  assert.ok(OL.isEventKind(event.kind));
  assert.equal(event.payload.from, true);
  assert.equal(event.payload.to, false);
});

test("color-change payload carries the new pen color and the previous one", () => {
  const event = {
    seq: 3,
    kind: "color-change",
    source_span: makeSpan(),
    turtle_id: 0,
    payload: { from: "black", to: "red" },
  };
  assert.ok(OL.isEventKind(event.kind));
  assert.equal(event.payload.from, "black");
  assert.equal(event.payload.to, "red");
});

test("background-change payload carries the new background color", () => {
  const event = {
    seq: 4,
    kind: "background-change",
    source_span: makeSpan(),
    payload: { color: "blue" },
  };
  assert.ok(OL.isEventKind(event.kind));
  assert.equal(event.payload.color, "blue");
});

test("width-change payload carries the new pen width and the previous one", () => {
  const event = {
    seq: 5,
    kind: "width-change",
    source_span: makeSpan(),
    turtle_id: 0,
    payload: { from: 1, to: 3 },
  };
  assert.ok(OL.isEventKind(event.kind));
  assert.equal(event.payload.from, 1);
  assert.equal(event.payload.to, 3);
});

test("shape-change payload carries the new shape word and the previous one", () => {
  const event = {
    seq: 6,
    kind: "shape-change",
    source_span: makeSpan(),
    turtle_id: 0,
    payload: { from: "turtle", to: "arrow" },
  };
  assert.ok(OL.isEventKind(event.kind));
  assert.equal(event.payload.from, "turtle");
  assert.equal(event.payload.to, "arrow");
});

test("fill payload carries the fill color used", () => {
  const event = {
    seq: 7,
    kind: "fill",
    source_span: makeSpan(),
    turtle_id: 0,
    payload: { color: "green" },
  };
  assert.ok(OL.isEventKind(event.kind));
  assert.equal(event.payload.color, "green");
});

test("tutor-output payload (explain) carries command, segments, and target span", () => {
  const event = {
    seq: 9,
    kind: "tutor-output",
    source_span: makeSpan(),
    payload: {
      command: "explain",
      segments: ["`repeat` runs the block four times."],
      target_source_span: makeSpan(),
    },
  };
  assert.ok(OL.isEventKind(event.kind));
  assert.equal(event.payload.command, "explain");
  assert.deepEqual(event.payload.segments, [
    "`repeat` runs the block four times.",
  ]);
  assert.equal(event.payload.stage, undefined);
  assert.equal(event.payload.diagnostic_code, undefined);
});

test("tutor-output payload (hint) carries a progressive stage", () => {
  const event = {
    seq: 10,
    kind: "tutor-output",
    source_span: makeSpan(),
    payload: {
      command: "hint",
      segments: ["Look at the turn after each side."],
      stage: "nudge",
      target_source_span: makeSpan(),
    },
  };
  assert.ok(OL.isEventKind(event.kind));
  assert.equal(event.payload.command, "hint");
  assert.equal(event.payload.stage, "nudge");
});

test("tutor-output payload (why) may carry a diagnostic-code", () => {
  const event = {
    seq: 11,
    kind: "tutor-output",
    source_span: makeSpan(),
    payload: {
      command: "why",
      segments: ["forward needs a number, but :size is a word."],
      target_source_span: makeSpan(),
      diagnostic_code: "ol-type",
    },
  };
  assert.ok(OL.isEventKind(event.kind));
  assert.ok(OL.isDiagnosticCode(event.payload.diagnostic_code));
});

test("stamp payload carries position, heading, shape, and color stamped", () => {
  const event = {
    seq: 8,
    kind: "stamp",
    source_span: makeSpan(),
    turtle_id: 0,
    payload: {
      position: [10, 20],
      heading: 90,
      shape: "triangle",
      color: "red",
    },
  };
  assert.ok(OL.isEventKind(event.kind));
  assert.deepEqual(event.payload.position, [10, 20]);
  assert.equal(event.payload.heading, 90);
  assert.equal(event.payload.shape, "triangle");
  assert.equal(event.payload.color, "red");
});

test("primitive payload carries the canonical primitive name (wait)", () => {
  const event = {
    seq: 12,
    kind: "primitive",
    source_span: makeSpan(),
    payload: { name: "wait" },
  };
  assert.ok(OL.isEventKind(event.kind));
  assert.equal(event.payload.name, "wait");
});

test("primitive payload names each event-registration form", () => {
  for (const name of ["when", "every", "on_key", "on_click"]) {
    const event = {
      seq: 13,
      kind: "primitive",
      source_span: makeSpan(),
      payload: { name },
    };
    assert.ok(OL.isEventKind(event.kind));
    assert.equal(event.payload.name, name);
  }
});

test("sound payload (set_tempo) carries beats per minute", () => {
  const event = {
    seq: 14,
    kind: "sound",
    source_span: makeSpan(),
    payload: { command: "set_tempo", beats_per_minute: 90 },
  };
  assert.ok(OL.isEventKind(event.kind));
  assert.equal(event.payload.command, "set_tempo");
  assert.equal(event.payload.beats_per_minute, 90);
});

test("sound payload (note) carries pitch and duration in beats", () => {
  const event = {
    seq: 15,
    kind: "sound",
    source_span: makeSpan(),
    payload: { command: "note", pitch: "c4", duration: 1 },
  };
  assert.ok(OL.isEventKind(event.kind));
  assert.equal(event.payload.command, "note");
  assert.equal(event.payload.pitch, "c4");
  assert.equal(event.payload.duration, 1);
});

test("sound payload (play) carries the resolved melody as pitch/duration steps", () => {
  const event = {
    seq: 16,
    kind: "sound",
    source_span: makeSpan(),
    payload: {
      command: "play",
      melody: [
        { pitch: "c4", duration: 1 },
        { pitch: "rest", duration: 1 },
        { pitch: "g4", duration: 2 },
      ],
    },
  };
  assert.ok(OL.isEventKind(event.kind));
  assert.equal(event.payload.command, "play");
  assert.equal(event.payload.melody.length, 3);
  assert.deepEqual(event.payload.melody[1], { pitch: "rest", duration: 1 });
});

test("sound payload (beep) is fully described by its command discriminant", () => {
  const event = {
    seq: 17,
    kind: "sound",
    source_span: makeSpan(),
    payload: { command: "beep" },
  };
  assert.ok(OL.isEventKind(event.kind));
  assert.equal(event.payload.command, "beep");
});

test("sound payload (rest) carries the silent duration in beats", () => {
  const event = {
    seq: 18,
    kind: "sound",
    source_span: makeSpan(),
    payload: { command: "rest", duration: 1 },
  };
  assert.ok(OL.isEventKind(event.kind));
  assert.equal(event.payload.command, "rest");
  assert.equal(event.payload.duration, 1);
});

test("spawn-turtle payload identifies the new turtle and its initial visible state", () => {
  const event = {
    seq: 19,
    kind: "spawn-turtle",
    source_span: makeSpan(),
    turtle_id: 1,
    payload: {
      turtle_id: 1,
      position: [0, 0],
      heading: 0,
      pen: "down",
      color: "black",
      width: 1,
      visible: true,
      shape: "turtle",
    },
  };
  assert.ok(OL.isEventKind(event.kind));
  assert.equal(event.payload.turtle_id, 1);
  assert.deepEqual(event.payload.position, [0, 0]);
  assert.equal(event.payload.heading, 0);
  assert.equal(event.payload.pen, "down");
  assert.equal(event.payload.color, "black");
  assert.equal(event.payload.width, 1);
  assert.equal(event.payload.visible, true);
  assert.equal(event.payload.shape, "turtle");
});
