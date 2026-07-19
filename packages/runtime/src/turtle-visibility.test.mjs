// Unit tests for `show_turtle`/`hide_turtle` (issue #207, spec/commands.md's `show_turtle`/
// `hide_turtle` entries, spec/rendering.md's "Turtle avatar and shapes" section). The turtle
// starts visible; `show_turtle`/`hide_turtle` toggle a display-only flag and emit a
// `visibility-change` event every time they're called, even when the turtle is already in the
// requested state. Visibility never gates `move`/`draw-segment` - a hidden turtle still moves,
// turns, and draws exactly as when visible. Both commands take zero arguments. (Reporters like
// `xcor`/`ycor`/`heading`/`pos` are not yet implemented in the runtime - out of this slice's
// scope - so this file only exercises the visibility-change events and the move/draw-segment
// pass-through.)

import assert from "node:assert/strict";
import { test } from "node:test";
import { execute } from "@openlogo/runtime";

test("execute hides the turtle, emitting a visibility-change event from true to false", () => {
  const result = execute("hide_turtle", "main.logo");
  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.events.length, 2);
  assert.equal(result.events[0].kind, "instruction");
  assert.deepEqual(result.events[1], {
    seq: 1,
    kind: "visibility-change",
    source_span: result.events[0].source_span,
    payload: { from: true, to: false },
  });
});

test("execute shows the turtle, emitting a visibility-change event from false to true", () => {
  const result = execute("hide_turtle\nshow_turtle", "main.logo");
  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.events.length, 4);
  assert.deepEqual(result.events[3], {
    seq: 3,
    kind: "visibility-change",
    source_span: result.events[2].source_span,
    payload: { from: false, to: true },
  });
});

test("execute emits a visibility-change event even when the turtle is already in the requested state", () => {
  // Calling `show_turtle` while already visible is not an error - the learner still gets a
  // confirming event (mirrors `turnTurtle`'s/`setPen`'s unconditional emit).
  const result = execute("show_turtle", "main.logo");
  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.events.length, 2);
  assert.deepEqual(result.events[1].payload, { from: true, to: true });
});

test("a hidden turtle still moves and draws exactly as when visible", () => {
  const result = execute("hide_turtle\nforward 50", "main.logo");
  assert.deepEqual(result.diagnostics, []);
  const kinds = result.events.map((event) => event.kind);
  assert.deepEqual(kinds, [
    "instruction",
    "visibility-change",
    "instruction",
    "move",
    "draw-segment",
  ]);
  assert.deepEqual(result.events[4].payload, {
    from: [0, 0],
    to: [0, 50],
    color: "black",
    width: 1,
  });
});

test("a hidden turtle still turns exactly as when visible", () => {
  const result = execute("hide_turtle\nright 90", "main.logo");
  assert.deepEqual(result.diagnostics, []);
  const kinds = result.events.map((event) => event.kind);
  assert.deepEqual(kinds, [
    "instruction",
    "visibility-change",
    "instruction",
    "turn",
  ]);
  assert.deepEqual(result.events[3].payload, { from: 0, to: 90 });
});

test("execute keeps the turtle visible by default, without any visibility command", () => {
  const result = execute("forward 50", "main.logo");
  assert.deepEqual(result.diagnostics, []);
  const kinds = result.events.map((event) => event.kind);
  assert.deepEqual(kinds, ["instruction", "move", "draw-segment"]);
});

test("execute accepts the parenthesized call form for a zero-argument hide_turtle", () => {
  const result = execute("(hide_turtle)", "main.logo");
  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.events.length, 2);
  assert.equal(result.events[1].kind, "visibility-change");
});

test("execute raises ol-too-many-inputs for a parenthesized show_turtle with an argument", () => {
  const result = execute("(show_turtle 1)", "main.logo");
  assert.equal(result.events.length, 1);
  assert.equal(result.diagnostics.length, 1);
  assert.deepEqual(result.diagnostics[0], {
    code: "ol-too-many-inputs",
    source_span: result.diagnostics[0].source_span,
    params: { callable: "show_turtle", expected: 0, actual: 1 },
    message: result.diagnostics[0].message,
    stage: "runtime",
    severity: "error",
  });
});

test("execute raises ol-too-many-inputs for a parenthesized hide_turtle with two arguments", () => {
  const result = execute("(hide_turtle 1 2)", "main.logo");
  assert.equal(result.events.length, 1);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-too-many-inputs");
  assert.deepEqual(result.diagnostics[0].params, {
    callable: "hide_turtle",
    expected: 0,
    actual: 2,
  });
});
