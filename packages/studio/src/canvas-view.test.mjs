import assert from "node:assert/strict";
import { test } from "node:test";
import * as OL from "@openlogo/studio";
import { MAIN_TURTLE_ID } from "@openlogo/turtle";

/** A `TurtleWorldState` holding just the main turtle at `state`, active — what a single-turtle
 * (Turtle & Rendering) program's event stream folds to. */
function singleTurtleWorld(state) {
  return {
    turtles: new Map([[MAIN_TURTLE_ID, state]]),
    activeTurtleId: MAIN_TURTLE_ID,
  };
}

/** A minimal recording fake satisfying {@link OL.Canvas2DContext}, with no DOM at all. */
function createRecordingContext() {
  const calls = [];
  const fillRectStyles = [];
  return {
    calls,
    fillRectStyles,
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    save() {
      calls.push(["save"]);
    },
    restore() {
      calls.push(["restore"]);
    },
    translate(x, y) {
      calls.push(["translate", x, y]);
    },
    rotate(angleRadians) {
      calls.push(["rotate", angleRadians]);
    },
    beginPath() {
      calls.push(["beginPath"]);
    },
    closePath() {
      calls.push(["closePath"]);
    },
    moveTo(x, y) {
      calls.push(["moveTo", x, y]);
    },
    lineTo(x, y) {
      calls.push(["lineTo", x, y]);
    },
    stroke() {
      calls.push(["stroke"]);
    },
    fill() {
      calls.push(["fill"]);
    },
    fillRect(x, y, width, height) {
      // Capture the fill color in effect at call time (`this.fillStyle` is a mutable property
      // `paintScene` sets immediately before calling `fillRect`), since `calls` alone can't
      // observe property writes.
      fillRectStyles.push(this.fillStyle);
      calls.push(["fillRect", x, y, width, height]);
    },
    arc(x, y, radius, startAngle, endAngle) {
      calls.push(["arc", x, y, radius, startAngle, endAngle]);
    },
  };
}

const VIEWPORT = { width: 400, height: 400 };

test("createCanvasRenderTarget forwards fillStyle/strokeStyle/lineWidth reads and writes to the underlying context", () => {
  const context = createRecordingContext();
  const target = OL.createCanvasRenderTarget(context);

  assert.notEqual(
    target,
    context,
    "the adapter must be a real wrapper, not an identity pass-through",
  );

  target.fillStyle = "red";
  assert.equal(context.fillStyle, "red");
  assert.equal(target.fillStyle, "red");

  target.strokeStyle = "blue";
  assert.equal(context.strokeStyle, "blue");
  assert.equal(target.strokeStyle, "blue");

  target.lineWidth = 3;
  assert.equal(context.lineWidth, 3);
  assert.equal(target.lineWidth, 3);
});

test("createCanvasRenderTarget delegates every draw call to the underlying context", () => {
  const context = createRecordingContext();
  const target = OL.createCanvasRenderTarget(context);

  target.save();
  target.translate(1, 2);
  target.rotate(0.5);
  target.beginPath();
  target.moveTo(3, 4);
  target.lineTo(5, 6);
  target.closePath();
  target.stroke();
  target.fill();
  target.fillRect(0, 0, 10, 10);
  target.arc(1, 1, 2, 0, Math.PI);
  target.restore();

  assert.deepEqual(context.calls, [
    ["save"],
    ["translate", 1, 2],
    ["rotate", 0.5],
    ["beginPath"],
    ["moveTo", 3, 4],
    ["lineTo", 5, 6],
    ["closePath"],
    ["stroke"],
    ["fill"],
    ["fillRect", 0, 0, 10, 10],
    ["arc", 1, 1, 2, 0, Math.PI],
    ["restore"],
  ]);
});

test("createCanvasViewController.repaint() paints the state model's default turtle state/scene, exact call sequence", () => {
  const state = OL.createStudioState();
  const context = createRecordingContext();
  const controller = OL.createCanvasViewController(state, {
    target: context,
    viewport: VIEWPORT,
  });

  assert.deepEqual(controller.viewport, VIEWPORT);
  assert.deepEqual(
    context.calls,
    [],
    "must not paint before repaint() is called",
  );

  controller.repaint();

  // Background fill (default "white"), then the visible default-shape ("turtle") avatar's full
  // save/translate/rotate/beginPath/moveTo/(eleven lineTo)/closePath/fill/restore bracket at the
  // origin, heading 0 — the exact sequence `paintScene`/`paintTurtle` produce for the program-start
  // defaults, with no drawing items in the scene. The eleven `lineTo` calls trace the real turtle
  // glyph's head/leg/tail silhouette (`canvas.ts`'s `TURTLE_OUTLINE_POINTS`), not a bare triangle.
  assert.deepEqual(context.calls, [
    ["fillRect", 0, 0, 400, 400],
    ["save"],
    ["translate", 200, 200],
    ["rotate", 0],
    ["beginPath"],
    ["moveTo", 0, -10],
    ["lineTo", 4, -6],
    ["lineTo", 7, -6],
    ["lineTo", 4, -3],
    ["lineTo", 7, 3],
    ["lineTo", 4, 6],
    ["lineTo", 0, 9],
    ["lineTo", -4, 6],
    ["lineTo", -7, 3],
    ["lineTo", -4, -3],
    ["lineTo", -7, -6],
    ["lineTo", -4, -6],
    ["closePath"],
    ["fill"],
    ["restore"],
  ]);
  assert.equal(context.fillRectStyles[0], "white");
});

test("createCanvasViewController.repaint() reflects the state model's current turtleScene, not a snapshot taken at construction", () => {
  const state = OL.createStudioState();
  const context = createRecordingContext();
  const controller = OL.createCanvasViewController(state, {
    target: context,
    viewport: VIEWPORT,
  });

  state.setTurtleScene({ background: "yellow", items: [] });
  controller.repaint();

  assert.deepEqual(context.calls[0], ["fillRect", 0, 0, 400, 400]);
  assert.equal(
    context.fillRectStyles[0],
    "yellow",
    "repaint() must read the state model's current turtleScene, never a snapshot taken at construction",
  );
});

test("createCanvasViewController.repaint() reflects the state model's current turtle world, not a snapshot taken at construction", () => {
  const state = OL.createStudioState();
  const context = createRecordingContext();
  const controller = OL.createCanvasViewController(state, {
    target: context,
    viewport: VIEWPORT,
  });

  const { turtleState } = state.getState();
  state.setTurtleWorld(
    singleTurtleWorld({ ...turtleState, position: [50, 0], heading: 90 }),
  );
  controller.repaint();

  const saveIndex = context.calls.findIndex((call) => call[0] === "save");
  assert.ok(saveIndex > 0, "avatar paints after the background");
  assert.deepEqual(
    context.calls[saveIndex + 1],
    ["translate", 250, 200],
    "must translate to the turtle's current (updated) world position, not the position at construction",
  );
  assert.deepEqual(
    context.calls[saveIndex + 2],
    ["rotate", Math.PI / 2],
    "must rotate by the turtle's current (updated) heading, not the heading at construction",
  );
});

test("createCanvasViewController.repaint() omits the avatar when the turtle is hidden", () => {
  const state = OL.createStudioState();
  const context = createRecordingContext();
  const controller = OL.createCanvasViewController(state, {
    target: context,
    viewport: VIEWPORT,
  });

  const { turtleState } = state.getState();
  state.setTurtleWorld(singleTurtleWorld({ ...turtleState, visible: false }));
  controller.repaint();

  assert.equal(
    context.calls.some((call) => call[0] === "save"),
    false,
    "a hidden turtle must not paint an avatar",
  );
});

test("createCanvasViewController.repaint() paints one avatar per visible turtle in the world (#749)", () => {
  // The studio-side half of #749: a Sprites program's Canvas pane must show every live turtle,
  // each with its own visibility — not one avatar wearing the last event's attributes.
  const state = OL.createStudioState();
  const context = createRecordingContext();
  const controller = OL.createCanvasViewController(state, {
    target: context,
    viewport: VIEWPORT,
  });

  const { turtleState } = state.getState();
  state.setTurtleWorld({
    turtles: new Map([
      [0, { ...turtleState, position: [0, 0] }],
      [1, { ...turtleState, position: [50, 0] }],
      [2, { ...turtleState, position: [-50, 0], visible: false }],
    ]),
    activeTurtleId: 1,
  });
  controller.repaint();

  assert.deepEqual(
    context.calls.filter((call) => call[0] === "translate"),
    [
      ["translate", 200, 200],
      ["translate", 250, 200],
    ],
    "the two visible turtles each get their own avatar; the hidden one gets none",
  );
});

test("mountCanvasView composes the controller into the shell's turtle region and paints immediately", () => {
  const state = OL.createStudioState();
  const shell = OL.createAppShell(state);
  const context = createRecordingContext();
  const controller = OL.createCanvasViewController(state, {
    target: context,
    viewport: VIEWPORT,
  });

  assert.equal(shell.getRegion("turtle").content, null);

  OL.mountCanvasView(shell, controller);

  assert.equal(shell.getRegion("turtle").content, controller);
  assert.ok(
    context.calls.length > 0,
    "mounting must paint the initial default state immediately",
  );
});

test("the state model defaults turtleWorld/turtleState/turtleScene to @openlogo/turtle's program-start defaults", () => {
  const state = OL.createStudioState();
  const { turtleWorld, turtleState, turtleScene } = state.getState();

  assert.deepEqual(turtleState, {
    position: [0, 0],
    heading: 0,
    penDown: true,
    color: "black",
    width: 1,
    shape: "turtle",
    visible: true,
  });
  assert.deepEqual([...turtleWorld.turtles.keys()], [MAIN_TURTLE_ID]);
  assert.equal(turtleWorld.activeTurtleId, MAIN_TURTLE_ID);
  assert.deepEqual(turtleScene, { background: "white", items: [] });
});

test("setTurtleWorld/setTurtleScene replace the shared snapshot, observed by every consumer", () => {
  const state = OL.createStudioState();
  const before = state.getState();

  const nextTurtleState = { ...before.turtleState, heading: 90 };
  const nextTurtleWorld = singleTurtleWorld(nextTurtleState);
  state.setTurtleWorld(nextTurtleWorld);
  assert.equal(state.getState().turtleWorld, nextTurtleWorld);
  assert.equal(
    state.getState().turtleState,
    nextTurtleState,
    "turtleState is derived from the world's active turtle in the same commit",
  );
  assert.notEqual(
    state.getState(),
    before,
    "a new snapshot replaces the old one",
  );

  const nextTurtleScene = { background: "blue", items: [] };
  state.setTurtleScene(nextTurtleScene);
  assert.equal(state.getState().turtleScene, nextTurtleScene);
});

test("setTurtleWorld derives turtleState from the ACTIVE turtle, not the first or last one (#749)", () => {
  const state = OL.createStudioState();
  const base = state.getState().turtleState;
  const activeState = { ...base, color: "blue", visible: false };
  state.setTurtleWorld({
    turtles: new Map([
      [0, base],
      [1, { ...base, color: "green" }],
      [2, activeState],
      [3, { ...base, color: "orange" }],
    ]),
    activeTurtleId: 2,
  });
  assert.equal(state.getState().turtleState, activeState);
});

test("setViewport adopts a new viewport that the next repaint() paints through (#474 DPR resize)", () => {
  const state = OL.createStudioState();
  const context = createRecordingContext();
  const controller = OL.createCanvasViewController(state, {
    target: context,
    viewport: VIEWPORT,
  });

  // A DPR-aware resize: 400x400 backing at scale 1 grows to an 1800x1800 backing at scale 3.6.
  const enlarged = { width: 1800, height: 1800, scale: 3.6 };
  controller.setViewport(enlarged);
  assert.deepEqual(
    controller.viewport,
    enlarged,
    "the controller must expose the viewport most recently set",
  );

  controller.repaint();

  // The background fill spans the NEW backing size, and the avatar sits at the new center, proving
  // repaint() paints through the updated viewport rather than the one captured at construction.
  assert.deepEqual(context.calls[0], ["fillRect", 0, 0, 1800, 1800]);
  const saveIndex = context.calls.findIndex((call) => call[0] === "save");
  assert.deepEqual(
    context.calls[saveIndex + 1],
    ["translate", 900, 900],
    "the avatar must translate to the enlarged viewport's center",
  );
});
