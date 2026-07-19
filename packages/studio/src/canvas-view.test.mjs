import assert from "node:assert/strict";
import { test } from "node:test";
import * as OL from "@openlogo/studio";

/** A minimal recording fake satisfying {@link OL.Canvas2DContextLike}, with no DOM at all. */
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

test("createCanvasRenderTarget adapts a Canvas2DContextLike into a RenderTarget pass-through", () => {
  const context = createRecordingContext();
  const target = OL.createCanvasRenderTarget(context);
  assert.equal(target, context);
});

test("createCanvasViewController.repaint() paints the state model's default turtle state/scene", () => {
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

  // Background fill first, at full target size, using the default "white" background.
  assert.equal(context.calls[0]?.[0], "fillRect");
  assert.deepEqual(context.calls[0], ["fillRect", 0, 0, 400, 400]);
  assert.equal(context.fillRectStyles[0], "white");

  // No drawing items in the default scene, so the only other work is the visible avatar's
  // save/translate/rotate/…/restore bracket at the origin, heading 0.
  const saveIndex = context.calls.findIndex((call) => call[0] === "save");
  assert.ok(saveIndex > 0, "avatar paints after the background");
  assert.deepEqual(context.calls[saveIndex + 1], ["translate", 200, 200]);
  assert.deepEqual(context.calls[saveIndex + 2], ["rotate", 0]);
  assert.equal(context.calls.at(-1)?.[0], "restore");
});

test("createCanvasViewController.repaint() reflects the state model's turtle scene, not a private copy", () => {
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

test("createCanvasViewController.repaint() omits the avatar when the turtle is hidden", () => {
  const state = OL.createStudioState();
  const context = createRecordingContext();
  const controller = OL.createCanvasViewController(state, {
    target: context,
    viewport: VIEWPORT,
  });

  const { turtleState } = state.getState();
  state.setTurtleState({ ...turtleState, visible: false });
  controller.repaint();

  assert.equal(
    context.calls.some((call) => call[0] === "save"),
    false,
    "a hidden turtle must not paint an avatar",
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

test("the state model defaults turtleState/turtleScene to @openlogo/turtle's program-start defaults", () => {
  const state = OL.createStudioState();
  const { turtleState, turtleScene } = state.getState();

  assert.deepEqual(turtleState, {
    position: [0, 0],
    heading: 0,
    penDown: true,
    color: "black",
    width: 1,
    shape: "turtle",
    visible: true,
  });
  assert.deepEqual(turtleScene, { background: "white", items: [] });
});

test("setTurtleState/setTurtleScene replace the shared snapshot, observed by every consumer", () => {
  const state = OL.createStudioState();
  const before = state.getState();

  const nextTurtleState = { ...before.turtleState, heading: 90 };
  state.setTurtleState(nextTurtleState);
  assert.equal(state.getState().turtleState, nextTurtleState);
  assert.notEqual(
    state.getState(),
    before,
    "a new snapshot replaces the old one",
  );

  const nextTurtleScene = { background: "blue", items: [] };
  state.setTurtleScene(nextTurtleScene);
  assert.equal(state.getState().turtleScene, nextTurtleScene);
});
