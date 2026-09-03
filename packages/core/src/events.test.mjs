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

test("primitive payload accepts a non-interaction primitive name (generic catch-all)", () => {
  // `primitive` is the profile-neutral generic catch-all (spec/execution-model.md:720), so its
  // `name` is open-ended: a future primitive from any profile must be representable without
  // re-opening the contract. This guards against the type silently narrowing back to a closed set.
  const event = {
    seq: 20,
    kind: "primitive",
    source_span: makeSpan(),
    payload: { name: "some_future_primitive" },
  };
  assert.ok(OL.isEventKind(event.kind));
  assert.equal(event.payload.name, "some_future_primitive");
});

test("the registry marks exactly the per-turtle effect kinds as turtle-specific (issue #764)", () => {
  // spec/execution-model.md:655 — the envelope's `turtle-id` is "present only when the event is
  // turtle-specific, otherwise absent". This partition is what lets a producer stamp envelopes and a
  // consumer validate them from one list instead of each hard-coding its own. It answers "may this
  // kind carry an id at all", NOT "may a producer label it with whichever turtle is acting" — the
  // narrower producer policy lives in @openlogo/runtime and excludes `spawn-turtle` and `clear`.
  const turtleSpecific = [
    "move",
    "turn",
    "pen-change",
    "width-change",
    "color-change",
    "draw-segment",
    "fill",
    "stamp",
    "shape-change",
    "visibility-change",
    // `spawn-turtle`'s envelope names the turtle just created (spec/turtles-and-sprites.md:34), so
    // it is turtle-specific even though it carries that id authoritatively rather than by stamping.
    "spawn-turtle",
  ];
  // Program/scene kinds are not turtle-specific — including `primitive`, whose addressing payload
  // describes a SET of turtles, and `clear`, which describes the shared drawing surface: one
  // `clear_screen` homes EVERY addressed turtle, so no single identity on the canvas event could
  // name them, and spec/turtles-and-sprites.md:113 says so outright — "A `clear` event describes the
  // shared surface rather than any turtle, so it is not turtle-specific and carries no turtle
  // identity" (issue #738). The homing is carried by the per-turtle `move`/`turn` events instead.
  const notTurtleSpecific = [
    "instruction",
    "procedure-enter",
    "procedure-exit",
    "return",
    "print",
    "sound",
    "overlay",
    "background-change",
    "clear",
    "error",
    "tutor-output",
    "primitive",
  ];
  for (const kind of turtleSpecific) {
    assert.ok(OL.isTurtleSpecificEventKind(kind), `${kind} is turtle-specific`);
    assert.ok(OL.OL_TURTLE_SPECIFIC_EVENT_KINDS.has(kind));
  }
  for (const kind of notTurtleSpecific) {
    assert.equal(
      OL.isTurtleSpecificEventKind(kind),
      false,
      `${kind} is not turtle-specific`,
    );
  }
  // Every entry is itself a registered kind — the partition can never drift off the registry.
  for (const kind of OL.OL_TURTLE_SPECIFIC_EVENT_KINDS) {
    assert.ok(OL.isEventKind(kind));
  }
  // ...and the converse: every registered kind is classified by exactly one of the two lists above.
  // Without this, a newly registered kind would be silently unclassified — defaulting to "not
  // turtle-specific", so a genuine per-turtle effect would ship with no `turtle_id` and fold into the
  // main turtle in a consumer's reducer, mis-attributed with no test failing anywhere.
  for (const kind of OL.OL_EVENT_KINDS) {
    assert.ok(
      turtleSpecific.includes(kind) !== notTurtleSpecific.includes(kind),
      `${kind} must be classified by exactly one of the two lists`,
    );
  }
  assert.equal(OL.isTurtleSpecificEventKind("not-a-kind"), false);
});

test("primitive payload carries the addressed turtle set for tell/ask/each (issue #766)", () => {
  // The Sprites addressing primitives are the only `primitive` emitters that carry an
  // `addressing` snapshot: the whole addressed set plus the current turtle, which is what makes
  // spec/rendering.md:193 ("MUST identify the active turtle or addressed turtle set") reachable
  // from the stream. The snapshot is absolute, so a consumer folds it by assignment.
  for (const name of ["tell", "ask", "each"]) {
    const event = {
      seq: 21,
      kind: "primitive",
      source_span: makeSpan(),
      payload: {
        name,
        addressing: { addressed_turtle_ids: [1, 2], current_turtle_id: 1 },
      },
    };
    assert.ok(OL.isEventKind(event.kind));
    assert.equal(event.payload.name, name);
    assert.deepEqual(event.payload.addressing.addressed_turtle_ids, [1, 2]);
    assert.equal(event.payload.addressing.current_turtle_id, 1);
    // An addressing event describes a SET, so it is never turtle-specific: the envelope's
    // `turtle_id` is "present only when the event is turtle-specific"
    // (spec/execution-model.md:655) and the current turtle travels in the payload instead.
    assert.equal(event.turtle_id, undefined);
  }
});

test("an addressed set may be empty, and then no current turtle is claimed", () => {
  // `tell [ ]` addresses no turtle. The spec defines no current turtle for an empty addressed set
  // (what `who` reports there is implementation-defined), so the snapshot reports `null` rather than
  // making one implementation's fallback binding on every implementation through a fixture.
  const event = {
    seq: 22,
    kind: "primitive",
    source_span: makeSpan(),
    payload: {
      name: "tell",
      addressing: { addressed_turtle_ids: [], current_turtle_id: null },
    },
  };
  assert.ok(OL.isEventKind(event.kind));
  assert.deepEqual(event.payload.addressing.addressed_turtle_ids, []);
  assert.equal(event.payload.addressing.current_turtle_id, null);
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
