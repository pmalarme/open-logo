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

test("initial turtle scene matches program-start defaults", () => {
  assert.deepEqual(OL.INITIAL_TURTLE_SCENE, { background: "white", items: [] });
});

test("draw-segment appends a segment capturing the color/width from its own payload", () => {
  const events = [
    event("draw-segment", {
      from: [0, 0],
      to: [0, 100],
      color: "black",
      width: 1,
    }),
  ];
  const scene = OL.reduceSceneEvents(events);
  assert.equal(scene.items.length, 1);
  assert.deepEqual(scene.items[0], {
    kind: "segment",
    segment: { from: [0, 0], to: [0, 100], color: "black", width: 1 },
  });
});

test("a later color-change/width-change does not retroactively alter an already-added segment", () => {
  const events = [
    event("draw-segment", {
      from: [0, 0],
      to: [0, 100],
      color: "black",
      width: 1,
    }),
    event("color-change", { from: "black", to: "red" }),
    event("width-change", { from: 1, to: 5 }),
    event("draw-segment", {
      from: [0, 100],
      to: [100, 100],
      color: "red",
      width: 5,
    }),
  ];
  const scene = OL.reduceSceneEvents(events);
  assert.equal(scene.items.length, 2);
  assert.deepEqual(scene.items[0].segment, {
    from: [0, 0],
    to: [0, 100],
    color: "black",
    width: 1,
  });
  assert.deepEqual(scene.items[1].segment, {
    from: [0, 100],
    to: [100, 100],
    color: "red",
    width: 5,
  });
});

test("background-change updates the scene-level background, not a segment", () => {
  const events = [
    event(
      "draw-segment",
      { from: [0, 0], to: [0, 50], color: "black", width: 1 },
      undefined,
    ),
    event("background-change", { color: "blue" }, undefined),
  ];
  const scene = OL.reduceSceneEvents(events);
  assert.equal(scene.background, "blue");
  assert.equal(scene.items.length, 1);
  assert.equal(scene.items[0].kind, "segment");
});

test("fill appends a fill item retaining its fill color", () => {
  const events = [event("fill", { color: "blue" })];
  const scene = OL.reduceSceneEvents(events);
  assert.deepEqual(scene.items, [{ kind: "fill", fill: { color: "blue" } }]);
});

test("stamp appends a stamp item with position, heading, shape, and color", () => {
  const events = [
    event("stamp", {
      position: [10, 20],
      heading: 90,
      shape: "arrow",
      color: "green",
    }),
  ];
  const scene = OL.reduceSceneEvents(events);
  assert.deepEqual(scene.items, [
    {
      kind: "stamp",
      stamp: {
        position: [10, 20],
        heading: 90,
        shape: "arrow",
        color: "green",
      },
    },
  ]);
});

test("clear with mode clean removes all segments/fills/stamps", () => {
  const events = [
    event("draw-segment", {
      from: [0, 0],
      to: [0, 50],
      color: "black",
      width: 1,
    }),
    event("fill", { color: "black" }),
    event("stamp", {
      position: [0, 50],
      heading: 0,
      shape: "turtle",
      color: "black",
    }),
    event("clear", { mode: "clean" }),
  ];
  const scene = OL.reduceSceneEvents(events);
  assert.deepEqual(scene.items, []);
});

test("clear with mode clear_screen removes drawing items identically to clean", () => {
  const events = [
    event("draw-segment", {
      from: [0, 0],
      to: [0, 50],
      color: "black",
      width: 1,
    }),
    event("fill", { color: "black" }),
    event("stamp", {
      position: [0, 50],
      heading: 0,
      shape: "turtle",
      color: "black",
    }),
    event("clear", { mode: "clear_screen" }),
  ];
  const scene = OL.reduceSceneEvents(events);
  assert.deepEqual(scene.items, []);
});

test("tutor-output (Educational profile) is inert: default branch returns the same scene reference unchanged", () => {
  const scene = OL.reduceSceneEvents([
    event("draw-segment", {
      from: [0, 0],
      to: [0, 50],
      color: "black",
      width: 1,
    }),
  ]);
  const next = OL.reduceTurtleScene(
    scene,
    event("tutor-output", {
      command: "explain",
      segments: ["`repeat` runs the block four times."],
    }),
  );
  assert.strictEqual(next, scene);
});

test("clear does not reset the background — clean and clear_screen preserve it", () => {
  const events = [
    event("background-change", { color: "yellow" }, undefined),
    event("draw-segment", {
      from: [0, 0],
      to: [0, 50],
      color: "black",
      width: 1,
    }),
    event("clear", { mode: "clear_screen" }),
  ];
  const scene = OL.reduceSceneEvents(events);
  assert.equal(scene.background, "yellow");
  assert.deepEqual(scene.items, []);
});

test("non-scene-bearing events (turtle state, print, instruction) leave the scene unchanged", () => {
  const events = [
    event("move", { from: [0, 0], to: [0, 100], heading: 0 }),
    event("turn", { from: 0, to: 90 }),
    event("pen-change", { from: "down", to: "up" }),
    event("color-change", { from: "black", to: "red" }),
    event("width-change", { from: 1, to: 3 }),
    event("shape-change", { from: "turtle", to: "arrow" }),
    event("visibility-change", { from: true, to: false }),
    event("print", { values: [] }, undefined),
    event("instruction", {}, undefined),
  ];
  const scene = OL.reduceSceneEvents(events);
  assert.deepEqual(scene, OL.INITIAL_TURTLE_SCENE);
});

test("reduceTurtleScene folds a single event onto an explicit starting scene", () => {
  const start = { background: "green", items: [] };
  const next = OL.reduceTurtleScene(start, event("fill", { color: "orange" }));
  assert.equal(next.background, "green");
  assert.deepEqual(next.items, [{ kind: "fill", fill: { color: "orange" } }]);
});

test("reduceSceneEvents accepts an explicit initial scene and folds in seq order", () => {
  const initial = {
    background: "white",
    items: [{ kind: "fill", fill: { color: "black" } }],
  };
  const events = [event("fill", { color: "red" })];
  const scene = OL.reduceSceneEvents(events, initial);
  assert.deepEqual(scene.items, [
    { kind: "fill", fill: { color: "black" } },
    { kind: "fill", fill: { color: "red" } },
  ]);
});

test("a full program's worth of events folds deterministically to the same final scene", () => {
  const program = [
    event("background-change", { color: "white" }, undefined),
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
    event("turn", { from: 90, to: 180 }),
    event("move", { from: [100, 0], to: [100, -100], heading: 180 }),
    event("draw-segment", {
      from: [100, 0],
      to: [100, -100],
      color: "blue",
      width: 2,
    }),
    event("fill", { color: "blue" }),
    event("stamp", {
      position: [100, -100],
      heading: 180,
      shape: "turtle",
      color: "blue",
    }),
  ];

  const first = OL.reduceSceneEvents(program);
  const second = OL.reduceSceneEvents(program);
  assert.deepEqual(first, second);
  assert.deepEqual(first, {
    background: "white",
    items: [
      {
        kind: "segment",
        segment: { from: [0, 0], to: [100, 0], color: "blue", width: 2 },
      },
      {
        kind: "segment",
        segment: { from: [100, 0], to: [100, -100], color: "blue", width: 2 },
      },
      { kind: "fill", fill: { color: "blue" } },
      {
        kind: "stamp",
        stamp: {
          position: [100, -100],
          heading: 180,
          shape: "turtle",
          color: "blue",
        },
      },
    ],
  });
});
