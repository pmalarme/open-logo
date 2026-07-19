// Unit tests for `pen_up`/`pen_down` (issue #206, spec/commands.md's `pen_up`/`pen_down` entries,
// spec/execution-model.md#turtle-and-canvas-state, spec/rendering.md#line-segments). The pen
// defaults to down (issue #200); `pen_up` suppresses `draw-segment` on subsequent movement while
// still emitting `move`, and `pen_down` resumes it. Both take zero arguments.

import assert from "node:assert/strict";
import { test } from "node:test";
import { execute } from "@openlogo/runtime";

test("execute raises the pen up, emitting a pen-change event from down to up", () => {
  const result = execute("pen_up", "main.logo");
  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.events.length, 2);
  assert.equal(result.events[0].kind, "instruction");
  assert.deepEqual(result.events[1], {
    seq: 1,
    kind: "pen-change",
    source_span: result.events[0].source_span,
    payload: { from: "down", to: "up" },
  });
});

test("execute lowers the pen, emitting a pen-change event from up to down", () => {
  const result = execute("pen_up\npen_down", "main.logo");
  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.events.length, 4);
  assert.deepEqual(result.events[3], {
    seq: 3,
    kind: "pen-change",
    source_span: result.events[2].source_span,
    payload: { from: "up", to: "down" },
  });
});

test("execute emits a pen-change event even when the pen is already in the requested state", () => {
  // Calling `pen_down` while already down is not an error - the learner still gets a confirming
  // event (mirrors `turnTurtle`'s unconditional emit).
  const result = execute("pen_down", "main.logo");
  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.events.length, 2);
  assert.deepEqual(result.events[1].payload, { from: "down", to: "down" });
});

test("execute moves without drawing while the pen is up: a move event fires but no draw-segment", () => {
  const result = execute("pen_up\nforward 50", "main.logo");
  assert.deepEqual(result.diagnostics, []);
  const kinds = result.events.map((event) => event.kind);
  assert.deepEqual(kinds, ["instruction", "pen-change", "instruction", "move"]);
  assert.deepEqual(result.events[3].payload, {
    from: [0, 0],
    to: [0, 50],
    heading: 0,
  });
});

test("execute resumes drawing once the pen is back down: draw-segment fires again", () => {
  const result = execute("pen_up\npen_down\nforward 50", "main.logo");
  assert.deepEqual(result.diagnostics, []);
  const kinds = result.events.map((event) => event.kind);
  assert.deepEqual(kinds, [
    "instruction",
    "pen-change",
    "instruction",
    "pen-change",
    "instruction",
    "move",
    "draw-segment",
  ]);
  assert.deepEqual(result.events[6].payload, {
    from: [0, 0],
    to: [0, 50],
    color: "black",
    width: 1,
  });
});

test("execute keeps emitting draw-segment by default, without any pen command", () => {
  const result = execute("forward 50", "main.logo");
  assert.deepEqual(result.diagnostics, []);
  const kinds = result.events.map((event) => event.kind);
  assert.deepEqual(kinds, ["instruction", "move", "draw-segment"]);
});

test("execute accepts the parenthesized call form for a zero-argument pen_up", () => {
  const result = execute("(pen_up)", "main.logo");
  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.events.length, 2);
  assert.equal(result.events[1].kind, "pen-change");
});

test("execute raises ol-too-many-inputs for a parenthesized pen_up with an argument", () => {
  const result = execute("(pen_up 1)", "main.logo");
  assert.equal(result.events.length, 1);
  assert.equal(result.diagnostics.length, 1);
  assert.deepEqual(result.diagnostics[0], {
    code: "ol-too-many-inputs",
    source_span: result.diagnostics[0].source_span,
    params: { callable: "pen_up", expected: 0, actual: 1 },
    message: result.diagnostics[0].message,
    stage: "runtime",
    severity: "error",
  });
});

test("execute raises ol-too-many-inputs for a parenthesized pen_down with two arguments", () => {
  const result = execute("(pen_down 1 2)", "main.logo");
  assert.equal(result.events.length, 1);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-too-many-inputs");
  assert.deepEqual(result.diagnostics[0].params, {
    callable: "pen_down",
    expected: 0,
    actual: 2,
  });
});
