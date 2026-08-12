// Tests for the per-turtle world-state reducer (`world-state.ts`, issue #677, slice SP5): under the
// Sprites profile many turtles draw at once and each per-turtle event carries the acting turtle's
// `turtle_id`, so a renderer needs each sprite's own shape/visibility/position — not the single
// collapsed state `reduceTurtleEvents` folds. These exercise the routing: `spawn-turtle`
// registration, per-turtle attribution keyed on `turtle_id`, the implicit main turtle (no
// `turtle_id`) folding into id 0, isolation between turtles, and the render-following obligation
// from `spec/turtles-and-sprites.md`'s "Per-turtle state and Turtle commands" section.
import assert from "node:assert/strict";
import { test } from "node:test";
import * as Core from "@openlogo/core";
import * as OL from "@openlogo/turtle";

function makeSpan() {
  return Core.makeSpan("main.logo", [1, 1], [1, 1]);
}

let seq = 0;
// Build an event; pass `turtleId = undefined` to model an un-stamped Core/main-turtle event.
function event(kind, payload, turtleId) {
  seq += 1;
  const envelope = { seq, kind, source_span: makeSpan(), payload };
  if (turtleId !== undefined) {
    envelope.turtle_id = turtleId;
  }
  return envelope;
}

function spawn(turtleId, overrides = {}) {
  return event(
    "spawn-turtle",
    {
      turtle_id: turtleId,
      position: [0, 0],
      heading: 0,
      pen: "down",
      color: "black",
      width: 1,
      visible: true,
      shape: "turtle",
      ...overrides,
    },
    turtleId,
  );
}

test("initial world holds just the main turtle at the program-start defaults", () => {
  assert.deepEqual(
    [...OL.INITIAL_TURTLE_WORLD_STATE.keys()],
    [OL.MAIN_TURTLE_ID],
  );
  assert.deepEqual(
    OL.INITIAL_TURTLE_WORLD_STATE.get(OL.MAIN_TURTLE_ID),
    OL.INITIAL_TURTLE_STATE,
  );
});

test("MAIN_TURTLE_ID is 0, matching the runtime allocator's reserved main-turtle id", () => {
  assert.equal(OL.MAIN_TURTLE_ID, 0);
});

test("spawn-turtle registers a new turtle from its payload's initial state", () => {
  const world = OL.reduceTurtleWorldEvents([
    spawn(1, { shape: "bee", visible: false, color: "yellow", width: 3 }),
  ]);
  assert.deepEqual([...world.keys()], [0, 1]);
  assert.deepEqual(world.get(1), {
    position: [0, 0],
    heading: 0,
    penDown: true,
    color: "yellow",
    width: 3,
    shape: "bee",
    visible: false,
  });
});

test("shape-change routes to the addressed turtle, leaving the main turtle unchanged", () => {
  const world = OL.reduceTurtleWorldEvents([
    spawn(1),
    event("shape-change", { from: "turtle", to: "triangle" }, 1),
  ]);
  assert.equal(world.get(1).shape, "triangle");
  assert.equal(world.get(0).shape, "turtle");
});

test("visibility-change routes to the addressed turtle only", () => {
  const world = OL.reduceTurtleWorldEvents([
    spawn(1),
    spawn(2),
    event("visibility-change", { from: true, to: false }, 1),
  ]);
  assert.equal(world.get(1).visible, false);
  assert.equal(world.get(2).visible, true);
  assert.equal(world.get(0).visible, true);
});

test("two turtles keep independent shape and visibility", () => {
  const world = OL.reduceTurtleWorldEvents([
    spawn(1),
    spawn(2),
    event("shape-change", { from: "turtle", to: "arrow" }, 1),
    event("shape-change", { from: "turtle", to: "circle" }, 2),
    event("visibility-change", { from: true, to: false }, 2),
  ]);
  assert.equal(world.get(1).shape, "arrow");
  assert.equal(world.get(1).visible, true);
  assert.equal(world.get(2).shape, "circle");
  assert.equal(world.get(2).visible, false);
});

test("un-stamped events (no turtle_id) fold into the main turtle", () => {
  const world = OL.reduceTurtleWorldEvents([
    event("shape-change", { from: "turtle", to: "triangle" }, undefined),
    event("visibility-change", { from: true, to: false }, undefined),
  ]);
  assert.equal(world.get(0).shape, "triangle");
  assert.equal(world.get(0).visible, false);
  assert.deepEqual([...world.keys()], [0]);
});

test("a turtle_id: 0 stamped event and an un-stamped event fold into the same main turtle", () => {
  const world = OL.reduceTurtleWorldEvents([
    event("shape-change", { from: "turtle", to: "triangle" }, 0),
    event("visibility-change", { from: true, to: false }, undefined),
  ]);
  assert.equal(world.get(0).shape, "triangle");
  assert.equal(world.get(0).visible, false);
});

test("move routes per turtle so each sprite tracks its own position and heading", () => {
  const world = OL.reduceTurtleWorldEvents([
    spawn(1),
    spawn(2),
    event("move", { from: [0, 0], to: [0, 50], heading: 0 }, 1),
    event("move", { from: [0, 0], to: [30, 0], heading: 90 }, 2),
  ]);
  assert.deepEqual(world.get(1).position, [0, 50]);
  assert.equal(world.get(1).heading, 0);
  assert.deepEqual(world.get(2).position, [30, 0]);
  assert.equal(world.get(2).heading, 90);
});

test("an event naming an unspawned turtle is ignored rather than inventing a turtle", () => {
  const world = OL.reduceTurtleWorldEvents([
    event("shape-change", { from: "turtle", to: "triangle" }, 7),
  ]);
  assert.deepEqual([...world.keys()], [0]);
  assert.equal(world.get(0).shape, "turtle");
});

test("a non-state event (print) leaves the world referentially unchanged", () => {
  const before = OL.INITIAL_TURTLE_WORLD_STATE;
  const after = OL.reduceTurtleWorldState(
    before,
    event("print", { values: [] }, undefined),
  );
  assert.equal(after, before);
});

test("a clean clear leaves per-turtle state untouched", () => {
  const world = OL.reduceTurtleWorldEvents([
    spawn(1),
    event("move", { from: [0, 0], to: [0, 50], heading: 0 }, 1),
    event("clear", { mode: "clean" }, 1),
  ]);
  assert.deepEqual(world.get(1).position, [0, 50]);
});

test("a stamped clear_screen clear homes only the turtle it names", () => {
  // The runtime stamps a `clear_screen`'s single `clear` event with the homed turtle's `turtle_id`
  // under explicit addressing (`tell`/`ask`/`each`), so the reducer homes exactly that turtle and
  // leaves every other turtle's state untouched (`clearScreen`'s doc comment in the runtime).
  const world = OL.reduceTurtleWorldEvents([
    spawn(1),
    event("move", { from: [0, 0], to: [0, 50], heading: 90 }, 1),
    event("move", { from: [0, 0], to: [10, 0], heading: 45 }, 0),
    event("clear", { mode: "clear_screen" }, 1),
  ]);
  assert.deepEqual(world.get(1).position, [0, 0]);
  assert.equal(world.get(1).heading, 0);
  assert.deepEqual(world.get(0).position, [10, 0]);
  assert.equal(world.get(0).heading, 45);
});

test("an un-stamped clear_screen clear homes the main turtle", () => {
  // Before any `tell` the runtime emits `clear` with no `turtle_id`; it homes the main turtle (id
  // 0), matching the pre-slice single-turtle reducer and Turtle & Rendering `clear` fixtures.
  const world = OL.reduceTurtleWorldEvents([
    event("move", { from: [0, 0], to: [7, 0], heading: 90 }, undefined),
    event("clear", { mode: "clear_screen" }, undefined),
  ]);
  assert.deepEqual(world.get(0).position, [0, 0]);
  assert.equal(world.get(0).heading, 0);
});

test("reduceTurtleWorldEvents defaults its seed to the initial world", () => {
  const world = OL.reduceTurtleWorldEvents([spawn(1)]);
  assert.deepEqual([...world.keys()], [0, 1]);
});

test("reducing no events returns the seed unchanged", () => {
  const world = OL.reduceTurtleWorldEvents([]);
  assert.equal(world, OL.INITIAL_TURTLE_WORLD_STATE);
});
