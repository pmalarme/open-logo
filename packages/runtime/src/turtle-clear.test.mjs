// Unit tests for `clear_screen`/`clean` (issue #204, spec/commands.md's `clear_screen`/`clean`
// entries, spec/rendering.md's "Clear operations" section). Both take zero arguments and emit
// exactly one `clear` event: `clear_screen` also silently homes position/heading (no separate
// `move`/`turn` event - the turtle/scene reducer folds the homing itself), `clean` leaves
// position/heading untouched. Pen state and visibility are unchanged by either (color/width are
// not yet implemented in the runtime as of this slice - issues #208/#209 - so this file doesn't
// exercise them).

import assert from "node:assert/strict";
import { test } from "node:test";
import { execute } from "@openlogo/runtime";

test("execute clears the screen and homes the turtle, emitting a single clear event", () => {
  const result = execute("forward 30\nright 90\nclear_screen", "main.logo");
  assert.deepEqual(result.diagnostics, []);
  const kinds = result.events.map((event) => event.kind);
  assert.deepEqual(kinds, [
    "instruction",
    "move",
    "draw-segment",
    "instruction",
    "turn",
    "instruction",
    "clear",
  ]);
  assert.deepEqual(result.events[6], {
    seq: 6,
    kind: "clear",
    source_span: result.events[5].source_span,
    payload: { mode: "clear_screen" },
  });
});

test("clear_screen homes the turtle internally: a following forward draws from the origin", () => {
  const result = execute(
    "forward 30\nright 90\nclear_screen\nforward 50",
    "main.logo",
  );
  assert.deepEqual(result.diagnostics, []);
  const moveEvents = result.events.filter((event) => event.kind === "move");
  assert.equal(moveEvents.length, 2);
  assert.deepEqual(moveEvents[1].payload, {
    from: [0, 0],
    to: [0, 50],
    heading: 0,
  });
});

test("execute cleans the drawing only, emitting a single clear event and leaving position/heading unchanged", () => {
  const result = execute("forward 30\nright 90\nclean", "main.logo");
  assert.deepEqual(result.diagnostics, []);
  const kinds = result.events.map((event) => event.kind);
  assert.deepEqual(kinds, [
    "instruction",
    "move",
    "draw-segment",
    "instruction",
    "turn",
    "instruction",
    "clear",
  ]);
  assert.deepEqual(result.events[6], {
    seq: 6,
    kind: "clear",
    source_span: result.events[5].source_span,
    payload: { mode: "clean" },
  });
});

test("clean does not home the turtle: a following forward continues from where it was", () => {
  const result = execute("forward 30\nclean\nforward 50", "main.logo");
  assert.deepEqual(result.diagnostics, []);
  const moveEvents = result.events.filter((event) => event.kind === "move");
  assert.equal(moveEvents.length, 2);
  assert.deepEqual(moveEvents[1].payload, {
    from: [0, 30],
    to: [0, 80],
    heading: 0,
  });
});

test("clean does not reset the heading: a following right turn continues from where it was", () => {
  const result = execute("right 90\nclean\nright 10", "main.logo");
  assert.deepEqual(result.diagnostics, []);
  const turnEvents = result.events.filter((event) => event.kind === "turn");
  assert.equal(turnEvents.length, 2);
  assert.deepEqual(turnEvents[1].payload, { from: 90, to: 100 });
});

test("clear_screen preserves pen state and visibility", () => {
  const result = execute(
    "pen_up\nhide_turtle\nclear_screen\nforward 10",
    "main.logo",
  );
  assert.deepEqual(result.diagnostics, []);
  // The pen stayed up across clear_screen, so the subsequent forward emits move but no
  // draw-segment - proving pen state survived the clear.
  const kinds = result.events.map((event) => event.kind);
  assert.equal(kinds.includes("draw-segment"), false);
  const moveEvents = result.events.filter((event) => event.kind === "move");
  assert.equal(moveEvents.length, 1);
});

test("execute keeps the drawing intact by default, without any clear command", () => {
  const result = execute("forward 50", "main.logo");
  assert.deepEqual(result.diagnostics, []);
  const kinds = result.events.map((event) => event.kind);
  assert.deepEqual(kinds, ["instruction", "move", "draw-segment"]);
});

test("execute accepts the parenthesized call form for a zero-argument clean", () => {
  const result = execute("(clean)", "main.logo");
  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.events.length, 2);
  assert.equal(result.events[1].kind, "clear");
});

test("execute raises ol-too-many-inputs for a parenthesized clear_screen with an argument", () => {
  const result = execute("(clear_screen 1)", "main.logo");
  assert.equal(result.events.length, 1);
  assert.equal(result.diagnostics.length, 1);
  assert.deepEqual(result.diagnostics[0], {
    code: "ol-too-many-inputs",
    source_span: result.diagnostics[0].source_span,
    params: { callable: "clear_screen", expected: 0, actual: 1 },
    message: result.diagnostics[0].message,
    stage: "runtime",
    severity: "error",
  });
});

test("execute raises ol-too-many-inputs for a parenthesized clean with two arguments", () => {
  const result = execute("(clean 1 2)", "main.logo");
  assert.equal(result.events.length, 1);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-too-many-inputs");
  assert.deepEqual(result.diagnostics[0].params, {
    callable: "clean",
    expected: 0,
    actual: 2,
  });
});
