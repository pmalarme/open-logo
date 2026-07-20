import assert from "node:assert/strict";
import { test } from "node:test";
import * as Core from "@openlogo/core";
import * as OL from "@openlogo/turtle";

function makeSpan() {
  return Core.makeSpan("main.logo", [1, 1], [1, 1]);
}

let seq = 0;
function event(kind, payload, turtleId = 0) {
  seq += 1;
  return {
    seq,
    kind,
    source_span: makeSpan(),
    turtle_id: turtleId,
    payload,
  };
}

test("initial turtle state matches program-start defaults", () => {
  assert.deepEqual(OL.INITIAL_TURTLE_STATE, {
    position: [0, 0],
    heading: 0,
    penDown: true,
    color: "black",
    width: 1,
    shape: "turtle",
    visible: true,
  });
});

test("move updates position and heading", () => {
  const events = [event("move", { from: [0, 0], to: [0, 100], heading: 0 })];
  const state = OL.reduceTurtleEvents(events);
  assert.deepEqual(state.position, [0, 100]);
  assert.equal(state.heading, 0);
});

test("move records the heading in effect during the move (e.g. after a turn)", () => {
  const events = [
    event("turn", { from: 0, to: 90 }),
    event("move", { from: [0, 0], to: [100, 0], heading: 90 }),
  ];
  const state = OL.reduceTurtleEvents(events);
  assert.deepEqual(state.position, [100, 0]);
  assert.equal(state.heading, 90);
});

test("draw-segment updates position but does not carry a heading", () => {
  const events = [
    event("draw-segment", {
      from: [0, 0],
      to: [0, 50],
      color: "black",
      width: 1,
    }),
  ];
  const state = OL.reduceTurtleEvents(events);
  assert.deepEqual(state.position, [0, 50]);
  assert.equal(state.heading, 0);
});

test("turn updates heading only", () => {
  const events = [event("turn", { from: 0, to: 45 })];
  const state = OL.reduceTurtleEvents(events);
  assert.equal(state.heading, 45);
  assert.deepEqual(state.position, [0, 0]);
});

test("pen-change toggles penDown for pen_up and pen_down", () => {
  const up = OL.reduceTurtleEvents([
    event("pen-change", { from: "down", to: "up" }),
  ]);
  assert.equal(up.penDown, false);

  const down = OL.reduceTurtleEvents([
    event("pen-change", { from: "down", to: "up" }),
    event("pen-change", { from: "up", to: "down" }),
  ]);
  assert.equal(down.penDown, true);
});

test("color-change updates pen color", () => {
  const state = OL.reduceTurtleEvents([
    event("color-change", { from: "black", to: "red" }),
  ]);
  assert.equal(state.color, "red");
});

test("width-change updates pen width", () => {
  const state = OL.reduceTurtleEvents([
    event("width-change", { from: 1, to: 3 }),
  ]);
  assert.equal(state.width, 3);
});

test("shape-change updates the avatar shape word", () => {
  const state = OL.reduceTurtleEvents([
    event("shape-change", { from: "turtle", to: "arrow" }),
  ]);
  assert.equal(state.shape, "arrow");
});

test("visibility-change updates avatar visibility for show_turtle/hide_turtle", () => {
  const hidden = OL.reduceTurtleEvents([
    event("visibility-change", { from: true, to: false }),
  ]);
  assert.equal(hidden.visible, false);

  const shown = OL.reduceTurtleEvents([
    event("visibility-change", { from: true, to: false }),
    event("visibility-change", { from: false, to: true }),
  ]);
  assert.equal(shown.visible, true);
});

test("non-state-bearing events (e.g. background-change, print, a clean clear) leave state unchanged", () => {
  const events = [
    event("background-change", { color: "blue" }, undefined),
    event("print", { values: [] }, undefined),
    event("clear", { mode: "clean" }, undefined),
    event("instruction", {}, undefined),
  ];
  const state = OL.reduceTurtleEvents(events);
  assert.deepEqual(state, OL.INITIAL_TURTLE_STATE);
});

test("clear_screen homes position and heading but preserves pen, color, width, shape, visibility", () => {
  const moved = OL.reduceTurtleEvents([
    event("color-change", { from: "black", to: "red" }),
    event("width-change", { from: 1, to: 4 }),
    event("shape-change", { from: "turtle", to: "arrow" }),
    event("pen-change", { from: "down", to: "up" }),
    event("visibility-change", { from: true, to: false }),
    event("turn", { from: 0, to: 90 }),
    event("move", { from: [0, 0], to: [50, 50], heading: 90 }),
  ]);
  assert.deepEqual(moved.position, [50, 50]);
  assert.equal(moved.heading, 90);

  const cleared = OL.reduceTurtleState(
    moved,
    event("clear", { mode: "clear_screen" }),
  );
  assert.deepEqual(cleared.position, [0, 0]);
  assert.equal(cleared.heading, 0);
  assert.equal(cleared.penDown, false);
  assert.equal(cleared.color, "red");
  assert.equal(cleared.width, 4);
  assert.equal(cleared.shape, "arrow");
  assert.equal(cleared.visible, false);
});

test("reduceTurtleState folds a single event onto an explicit starting state", () => {
  const start = { ...OL.INITIAL_TURTLE_STATE, color: "green" };
  const next = OL.reduceTurtleState(
    start,
    event("width-change", { from: 1, to: 5 }),
  );
  assert.equal(next.width, 5);
  assert.equal(next.color, "green");
});

test("reduceTurtleEvents accepts an explicit initial state and folds in seq order", () => {
  const initial = { ...OL.INITIAL_TURTLE_STATE, position: [10, 10] };
  const events = [
    event("move", { from: [10, 10], to: [10, 60], heading: 0 }),
    event("turn", { from: 0, to: 180 }),
  ];
  const state = OL.reduceTurtleEvents(events, initial);
  assert.deepEqual(state.position, [10, 60]);
  assert.equal(state.heading, 180);
});

test("a full program's worth of events folds deterministically to the same final state", () => {
  const program = [
    event("color-change", { from: "black", to: "blue" }),
    event("width-change", { from: 1, to: 2 }),
    event("turn", { from: 0, to: 90 }),
    event("move", { from: [0, 0], to: [100, 0], heading: 90 }),
    event("draw-segment", {
      from: [0, 0],
      to: [100, 0],
      color: "blue",
      width: 2,
    }),
    event("pen-change", { from: "down", to: "up" }),
    event("turn", { from: 90, to: 0 }),
    event("move", { from: [100, 0], to: [100, 100], heading: 0 }),
    event("shape-change", { from: "turtle", to: "circle" }),
    event("visibility-change", { from: true, to: false }),
  ];

  const first = OL.reduceTurtleEvents(program);
  const second = OL.reduceTurtleEvents(program);
  assert.deepEqual(first, second);
  assert.deepEqual(first, {
    position: [100, 100],
    heading: 0,
    penDown: false,
    color: "blue",
    width: 2,
    shape: "circle",
    visible: false,
  });
});

test("tutor-output (Educational profile) is inert: default branch returns the same state reference unchanged", () => {
  const state = OL.reduceTurtleEvents([
    event("color-change", { from: "black", to: "red" }),
  ]);
  const next = OL.reduceTurtleState(
    state,
    event("tutor-output", {
      command: "hint",
      segments: ["Look at the turn after each side."],
      stage: "nudge",
    }),
  );
  assert.strictEqual(next, state);
});
