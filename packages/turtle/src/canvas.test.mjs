import assert from "node:assert/strict";
import { test } from "node:test";
import * as OL from "@openlogo/turtle";

/**
 * A recording fake {@link RenderTarget}: logs every method call (name + args) and every
 * property write, so tests can assert the exact draw-call sequence without a real DOM canvas
 * or `node-canvas` dependency.
 */
function makeRecordingTarget() {
  const calls = [];
  const target = {
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
    rotate(angle) {
      calls.push(["rotate", angle]);
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
    fillRect(x, y, w, h) {
      calls.push(["fillRect", x, y, w, h]);
    },
    arc(x, y, r, start, end) {
      calls.push(["arc", x, y, r, start, end]);
    },
  };
  // Track fillStyle/strokeStyle/lineWidth writes as calls too, via property interception.
  Object.defineProperty(target, "fillStyle", {
    set: (value) => {
      calls.push(["set fillStyle", value]);
    },
  });
  Object.defineProperty(target, "strokeStyle", {
    set: (value) => {
      calls.push(["set strokeStyle", value]);
    },
  });
  Object.defineProperty(target, "lineWidth", {
    set: (value) => {
      calls.push(["set lineWidth", value]);
    },
  });
  return { target, calls };
}

const VIEWPORT = { width: 400, height: 300 };

test("worldToTarget maps origin to viewport center", () => {
  assert.deepEqual(OL.worldToTarget([0, 0], VIEWPORT), [200, 150]);
});

test("worldToTarget inverts the y-axis and applies scale", () => {
  assert.deepEqual(OL.worldToTarget([10, 20], VIEWPORT), [210, 130]);
  assert.deepEqual(OL.worldToTarget([-10, -20], VIEWPORT), [190, 170]);
});

test("worldToTarget honors an explicit scale", () => {
  const viewport = { width: 200, height: 200, scale: 2 };
  assert.deepEqual(OL.worldToTarget([10, 10], viewport), [120, 80]);
});

test("worldToTarget defaults scale to 1 when omitted", () => {
  assert.deepEqual(
    OL.worldToTarget([5, 5], { width: 100, height: 100 }),
    [55, 45],
  );
});

test("paintScene maps segment pen width through the viewport scale, same as coordinates", () => {
  const { target, calls } = makeRecordingTarget();
  const scaledViewport = { width: 400, height: 300, scale: 2 };
  const scene = {
    background: "white",
    items: [
      {
        kind: "segment",
        segment: { from: [0, 0], to: [0, 0], color: "red", width: 3 },
      },
    ],
  };
  OL.paintScene(target, scene, scaledViewport);
  const lineWidthWrite = calls.find((call) => call[0] === "set lineWidth");
  assert.deepEqual(lineWidthWrite, ["set lineWidth", 6]);
});

test("paintScene draws the background before any items", () => {
  const { target, calls } = makeRecordingTarget();
  const scene = { background: "yellow", items: [] };
  OL.paintScene(target, scene, VIEWPORT);
  assert.deepEqual(calls, [
    ["set fillStyle", "yellow"],
    ["fillRect", 0, 0, 400, 300],
  ]);
});

test("paintScene strokes a segment with its own captured color and width", () => {
  const { target, calls } = makeRecordingTarget();
  const scene = {
    background: "white",
    items: [
      {
        kind: "segment",
        segment: { from: [0, 0], to: [0, 100], color: "red", width: 3 },
      },
    ],
  };
  OL.paintScene(target, scene, VIEWPORT);
  assert.deepEqual(calls, [
    ["set fillStyle", "white"],
    ["fillRect", 0, 0, 400, 300],
    ["set strokeStyle", "red"],
    ["set lineWidth", 3],
    ["beginPath"],
    ["moveTo", 200, 150],
    ["lineTo", 200, 50],
    ["stroke"],
  ]);
});

test("paintScene draws multiple segments in execution order", () => {
  const { target, calls } = makeRecordingTarget();
  const scene = {
    background: "white",
    items: [
      {
        kind: "segment",
        segment: { from: [0, 0], to: [10, 0], color: "red", width: 1 },
      },
      {
        kind: "segment",
        segment: { from: [10, 0], to: [10, 10], color: "blue", width: 2 },
      },
    ],
  };
  OL.paintScene(target, scene, VIEWPORT);
  const strokeStyles = calls
    .filter((call) => call[0] === "set strokeStyle")
    .map((call) => call[1]);
  assert.deepEqual(strokeStyles, ["red", "blue"]);
});

test("paintScene fills the enclosed path formed by preceding contiguous segments", () => {
  const { target, calls } = makeRecordingTarget();
  // A closed square path: (0,0) -> (10,0) -> (10,10) -> (0,10) -> (0,0), then fill.
  const scene = {
    background: "white",
    items: [
      {
        kind: "segment",
        segment: { from: [0, 0], to: [10, 0], color: "black", width: 1 },
      },
      {
        kind: "segment",
        segment: { from: [10, 0], to: [10, 10], color: "black", width: 1 },
      },
      {
        kind: "segment",
        segment: { from: [10, 10], to: [0, 10], color: "black", width: 1 },
      },
      {
        kind: "segment",
        segment: { from: [0, 10], to: [0, 0], color: "black", width: 1 },
      },
      { kind: "fill", fill: { color: "green" } },
    ],
  };
  OL.paintScene(target, scene, VIEWPORT);
  const fillCalls = calls.filter((call) => call[0] === "fill");
  assert.equal(fillCalls.length, 1); // segments stroke only; the fill item is the sole fill() call
  const fillStyleWrites = calls
    .filter((call) => call[0] === "set fillStyle")
    .map((call) => call[1]);
  assert.deepEqual(fillStyleWrites, ["white", "green"]);
  assert.ok(calls.some((call) => call[0] === "closePath"));
});

test("fill with fewer than two contiguous preceding points draws nothing", () => {
  const { target, calls } = makeRecordingTarget();
  const scene = {
    background: "white",
    items: [{ kind: "fill", fill: { color: "green" } }],
  };
  OL.paintScene(target, scene, VIEWPORT);
  assert.deepEqual(calls, [
    ["set fillStyle", "white"],
    ["fillRect", 0, 0, 400, 300],
  ]);
});

test("fill chain stops at a discontinuous segment", () => {
  const { target, calls } = makeRecordingTarget();
  const scene = {
    background: "white",
    items: [
      {
        kind: "segment",
        segment: { from: [0, 0], to: [10, 0], color: "black", width: 1 },
      },
      // discontinuity: this segment's `from` does not match the previous segment's `to`
      {
        kind: "segment",
        segment: { from: [50, 50], to: [60, 60], color: "black", width: 1 },
      },
      { kind: "fill", fill: { color: "green" } },
    ],
  };
  OL.paintScene(target, scene, VIEWPORT);
  // Only the single immediately-preceding segment (50,50)->(60,60) contributes 2 points, which
  // is enough to draw a (degenerate) fill path.
  const fillCalls = calls.filter((call) => call[0] === "fill");
  assert.equal(fillCalls.length, 1);
});

test("fill chain stops at a non-segment item", () => {
  const { target, calls } = makeRecordingTarget();
  const scene = {
    background: "white",
    items: [
      {
        kind: "stamp",
        stamp: {
          position: [0, 0],
          heading: 0,
          shape: "turtle",
          color: "black",
        },
      },
      {
        kind: "segment",
        segment: { from: [0, 0], to: [10, 0], color: "black", width: 1 },
      },
      { kind: "fill", fill: { color: "green" } },
    ],
  };
  OL.paintScene(target, scene, VIEWPORT);
  const fillCalls = calls.filter((call) => call[0] === "fill");
  assert.equal(fillCalls.length, 2); // the stamp's own fill() plus the fill item's fill()
});

test("paintScene paints a stamp as a fixed avatar at its own recorded pose", () => {
  const { target, calls } = makeRecordingTarget();
  const scene = {
    background: "white",
    items: [
      {
        kind: "stamp",
        stamp: {
          position: [0, 0],
          heading: 90,
          shape: "circle",
          color: "purple",
        },
      },
    ],
  };
  OL.paintScene(target, scene, VIEWPORT);
  assert.deepEqual(calls, [
    ["set fillStyle", "white"],
    ["fillRect", 0, 0, 400, 300],
    ["save"],
    ["translate", 200, 150],
    ["rotate", Math.PI / 2],
    ["set fillStyle", "purple"],
    ["beginPath"],
    ["arc", 0, 0, 5, 0, 2 * Math.PI],
    ["fill"],
    ["restore"],
  ]);
});

test("paintTurtle draws the avatar above the scene when visible", () => {
  const { target, calls } = makeRecordingTarget();
  const scene = { background: "white", items: [] };
  const state = {
    position: [0, 0],
    heading: 0,
    penDown: true,
    color: "black",
    width: 1,
    shape: "turtle",
    visible: true,
  };
  OL.paintTurtle(target, scene, state, VIEWPORT);
  assert.deepEqual(calls, [
    ["set fillStyle", "white"],
    ["fillRect", 0, 0, 400, 300],
    ["save"],
    ["translate", 200, 150],
    ["rotate", 0],
    ["set fillStyle", "black"],
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
});

test("paintTurtle omits the avatar entirely when hidden, scene unaffected", () => {
  const { target, calls } = makeRecordingTarget();
  const scene = {
    background: "white",
    items: [
      {
        kind: "segment",
        segment: { from: [0, 0], to: [10, 0], color: "red", width: 1 },
      },
    ],
  };
  const state = {
    position: [0, 0],
    heading: 0,
    penDown: true,
    color: "black",
    width: 1,
    shape: "turtle",
    visible: false,
  };
  OL.paintTurtle(target, scene, state, VIEWPORT);
  assert.ok(!calls.some((call) => call[0] === "save"));
  assert.ok(calls.some((call) => call[0] === "stroke"));
});

test("avatar rotation follows heading in degrees converted to radians, clockwise", () => {
  const { target, calls } = makeRecordingTarget();
  const scene = { background: "white", items: [] };
  const state = {
    position: [0, 0],
    heading: 180,
    penDown: true,
    color: "black",
    width: 1,
    shape: "triangle",
    visible: true,
  };
  OL.paintTurtle(target, scene, state, VIEWPORT);
  const rotateCall = calls.find((call) => call[0] === "rotate");
  assert.equal(rotateCall[1], Math.PI);
});

test("unknown shape words fall back to the default turtle-style avatar", () => {
  const { target, calls } = makeRecordingTarget();
  const scene = { background: "white", items: [] };
  const state = {
    position: [0, 0],
    heading: 0,
    penDown: true,
    color: "black",
    width: 1,
    shape: "not-a-real-shape",
    visible: true,
  };
  OL.paintTurtle(target, scene, state, VIEWPORT);
  assert.ok(
    calls.some(
      (call) => call[0] === "moveTo" && call[1] === 0 && call[2] === -10,
    ),
  );
  const lineToCalls = calls.filter((call) => call[0] === "lineTo");
  assert.equal(
    lineToCalls.length,
    11,
    "the default 'turtle' glyph is a twelve-point silhouette (head/legs/tail), not the bare triangle",
  );
});

test("'turtle' and 'triangle' shapes render distinct outlines", () => {
  const baseState = {
    position: [0, 0],
    heading: 0,
    penDown: true,
    color: "black",
    width: 1,
    visible: true,
  };
  const scene = { background: "white", items: [] };

  const turtleRecording = makeRecordingTarget();
  OL.paintTurtle(
    turtleRecording.target,
    scene,
    { ...baseState, shape: "turtle" },
    VIEWPORT,
  );
  const triangleRecording = makeRecordingTarget();
  OL.paintTurtle(
    triangleRecording.target,
    scene,
    { ...baseState, shape: "triangle" },
    VIEWPORT,
  );

  const turtleLineTos = turtleRecording.calls.filter(
    (call) => call[0] === "lineTo",
  );
  const triangleLineTos = triangleRecording.calls.filter(
    (call) => call[0] === "lineTo",
  );
  assert.notDeepEqual(turtleLineTos, triangleLineTos);
});

test("arrow shape draws its four-point outline", () => {
  const { target, calls } = makeRecordingTarget();
  const scene = { background: "white", items: [] };
  const state = {
    position: [0, 0],
    heading: 0,
    penDown: true,
    color: "black",
    width: 1,
    shape: "arrow",
    visible: true,
  };
  OL.paintTurtle(target, scene, state, VIEWPORT);
  const lineToCalls = calls.filter((call) => call[0] === "lineTo");
  assert.equal(lineToCalls.length, 3);
  assert.ok(calls.some((call) => call[0] === "closePath"));
});

test("reduced-to-scene and repaint is deterministic across repeated calls", () => {
  const scene = {
    background: "blue",
    items: [
      {
        kind: "segment",
        segment: { from: [0, 0], to: [5, 5], color: "red", width: 2 },
      },
      { kind: "fill", fill: { color: "green" } },
    ],
  };
  const first = makeRecordingTarget();
  const second = makeRecordingTarget();
  OL.paintScene(first.target, scene, VIEWPORT);
  OL.paintScene(second.target, scene, VIEWPORT);
  assert.deepEqual(first.calls, second.calls);
});

/** A minimal fake {@link OL.ReducedMotionSource}/{@link OL.MotionPreferencePlayer}: reports a
 * fixed snapshot until `seekToEnd`/`run` is called, at which point it reports `finalSnapshot`
 * instead — enough to distinguish "painted before playback" from "painted after playback"
 * without a real animation controller. */
function makeFakeAnimationSource(initialSnapshot, finalSnapshot) {
  let drained = false;
  let seekToEndCalls = 0;
  let runCalls = 0;
  return {
    getSnapshot() {
      return drained ? finalSnapshot : initialSnapshot;
    },
    seekToEnd() {
      seekToEndCalls += 1;
      drained = true;
    },
    run() {
      runCalls += 1;
      drained = true;
    },
    get seekToEndCallCount() {
      return seekToEndCalls;
    },
    get runCallCount() {
      return runCalls;
    },
  };
}

test("renderFrame paints exactly the source's current snapshot, never advancing or draining it", () => {
  const initial = {
    cursor: 0,
    status: "paused",
    state: { ...OL.INITIAL_TURTLE_STATE, position: [10, 0] },
    scene: { background: "white", items: [] },
  };
  const final = {
    cursor: 4,
    status: "done",
    state: { ...OL.INITIAL_TURTLE_STATE, position: [100, 0] },
    scene: { background: "white", items: [] },
  };
  const source = makeFakeAnimationSource(initial, final);
  const { target, calls } = makeRecordingTarget();

  OL.renderFrame(target, source, VIEWPORT);

  // A paused source stays paused — renderFrame must never call seekToEnd/run itself.
  assert.equal(source.seekToEndCallCount, 0);
  assert.equal(source.runCallCount, 0);
  // Painted the *current* snapshot's avatar position, not some later one.
  const translateCall = calls.find((call) => call[0] === "translate");
  assert.deepEqual(translateCall, ["translate", 210, 150]);
});

test("renderFrame on an already-paused real controller repaints the paused frame without draining it to done", () => {
  const events = [
    {
      seq: 0,
      kind: "instruction",
      source_span: { document: "t", start: [1, 1], end: [1, 11] },
      payload: { text: "forward 100" },
    },
    {
      seq: 1,
      kind: "move",
      source_span: { document: "t", start: [1, 1], end: [1, 11] },
      payload: { to: [100, 0], heading: 0 },
    },
    {
      seq: 2,
      kind: "instruction",
      source_span: { document: "t", start: [2, 1], end: [2, 10] },
      payload: { text: "right 90" },
    },
    {
      seq: 3,
      kind: "turn",
      source_span: { document: "t", start: [2, 1], end: [2, 10] },
      payload: { heading: 90 },
    },
  ];
  const controller = new OL.TurtleAnimationController(events);
  controller.step(); // consumes only the first instruction-step; leaves "right 90" unconsumed.
  assert.equal(controller.getSnapshot().status, "paused");
  assert.equal(controller.getSnapshot().cursor, 2);

  const { target } = makeRecordingTarget();
  OL.renderFrame(target, controller, VIEWPORT);

  // Repainting the current (paused) frame must not advance the cursor or change status — step
  // and pause stay available exactly as the AC requires, regardless of how it was rendered.
  assert.equal(controller.getSnapshot().status, "paused");
  assert.equal(controller.getSnapshot().cursor, 2);
  assert.equal(controller.getSnapshot().state.heading, 0);
});

test("playWithMotionPreference with reducedMotion:false starts the player's own paced run", () => {
  const initial = {
    cursor: 0,
    status: "idle",
    state: OL.INITIAL_TURTLE_STATE,
    scene: { background: "white", items: [] },
  };
  const final = {
    cursor: 4,
    status: "done",
    state: { ...OL.INITIAL_TURTLE_STATE, position: [100, 0] },
    scene: { background: "white", items: [] },
  };
  const player = makeFakeAnimationSource(initial, final);

  OL.playWithMotionPreference(player, { reducedMotion: false });

  assert.equal(player.runCallCount, 1);
  assert.equal(player.seekToEndCallCount, 0);
  // getSnapshot() now reflects the post-run (drained) state, proving run() actually advanced it.
  assert.deepEqual(player.getSnapshot(), final);
});

test("playWithMotionPreference with reducedMotion:true drains the whole stream instantly instead of pacing", () => {
  const initial = {
    cursor: 0,
    status: "idle",
    state: OL.INITIAL_TURTLE_STATE,
    scene: { background: "white", items: [] },
  };
  const final = {
    cursor: 4,
    status: "done",
    state: { ...OL.INITIAL_TURTLE_STATE, position: [100, 0] },
    scene: { background: "white", items: [] },
  };
  const player = makeFakeAnimationSource(initial, final);

  OL.playWithMotionPreference(player, { reducedMotion: true });

  assert.equal(player.seekToEndCallCount, 1);
  assert.equal(player.runCallCount, 0);
});

test("reduced-motion playback never changes the final scene/state/export vs stepped or paced normal playback", () => {
  const events = [
    {
      seq: 0,
      kind: "instruction",
      source_span: { document: "t", start: [1, 1], end: [1, 11] },
      payload: { text: "forward 100" },
    },
    {
      seq: 1,
      kind: "move",
      source_span: { document: "t", start: [1, 1], end: [1, 11] },
      payload: { to: [100, 0], heading: 0 },
    },
    {
      seq: 2,
      kind: "draw-segment",
      source_span: { document: "t", start: [1, 1], end: [1, 11] },
      payload: {
        from: [0, 0],
        to: [100, 0],
        color: "black",
        width: 1,
      },
    },
    {
      seq: 3,
      kind: "instruction",
      source_span: { document: "t", start: [2, 1], end: [2, 10] },
      payload: { text: "right 90" },
    },
    {
      seq: 4,
      kind: "turn",
      source_span: { document: "t", start: [2, 1], end: [2, 10] },
      payload: { heading: 90 },
    },
  ];

  // Reduced motion: start playback via playWithMotionPreference({reducedMotion: true}).
  const reducedController = new OL.TurtleAnimationController(events);
  OL.playWithMotionPreference(reducedController, { reducedMotion: true });

  // Normal, paced playback: same events, driven step-by-step (not seekToEnd) to prove the
  // reduced-motion path doesn't diverge from genuinely stepped/paced consumption.
  const steppedController = new OL.TurtleAnimationController(events);
  while (steppedController.getSnapshot().status !== "done") {
    steppedController.step();
  }

  // Normal playback via run() with the default (synchronous) scheduler.
  const runController = new OL.TurtleAnimationController(events);
  OL.playWithMotionPreference(runController, { reducedMotion: false });

  const reducedSnapshot = reducedController.getSnapshot();
  const steppedSnapshot = steppedController.getSnapshot();
  const runSnapshot = runController.getSnapshot();

  assert.deepEqual(reducedSnapshot.scene, steppedSnapshot.scene);
  assert.deepEqual(reducedSnapshot.state, steppedSnapshot.state);
  assert.deepEqual(reducedSnapshot.scene, runSnapshot.scene);
  assert.deepEqual(reducedSnapshot.state, runSnapshot.state);

  // The original event array itself is untouched by any playback mode.
  assert.equal(events.length, 5);
  assert.equal(events[0].kind, "instruction");

  // Rendering each final snapshot produces byte-identical draw calls too — reduced motion
  // changes nothing about the retained scene an export or repaint would read.
  const reducedTarget = makeRecordingTarget();
  const steppedTarget = makeRecordingTarget();
  OL.renderFrame(reducedTarget.target, reducedController, VIEWPORT);
  OL.renderFrame(steppedTarget.target, steppedController, VIEWPORT);
  assert.deepEqual(reducedTarget.calls, steppedTarget.calls);
});

test("paintScene with no overlay argument paints no overlay calls", () => {
  const { target, calls } = makeRecordingTarget();
  const scene = { background: "white", items: [] };
  OL.paintScene(target, scene, VIEWPORT);
  // Only the background fill — no overlay save/restore bracket at all.
  assert.deepEqual(calls, [
    ["set fillStyle", "white"],
    ["fillRect", 0, 0, 400, 300],
  ]);
});

test("paintScene with an empty overlay (INITIAL_OVERLAY_STATE) paints the save/restore bracket but no guide lines/marker", () => {
  const { target, calls } = makeRecordingTarget();
  const scene = { background: "white", items: [] };
  OL.paintScene(target, scene, VIEWPORT, OL.INITIAL_OVERLAY_STATE);
  assert.deepEqual(calls, [
    ["set fillStyle", "white"],
    ["fillRect", 0, 0, 400, 300],
    ["save"],
    ["restore"],
  ]);
});

test("paintOverlay draws grid guide lines through every multiple of the spacing", () => {
  const { target, calls } = makeRecordingTarget();
  OL.paintOverlay(target, { axes: false, grid: { spacing: 100 } }, VIEWPORT);
  const lineToCalls = calls.filter((call) => call[0] === "lineTo");
  // VIEWPORT is 400x300 (center [200,150]): world x in [-200,200] has 5 multiples of 100
  // (-200,-100,0,100,200); world y in [-150,150] has 3 multiples of 100 (-100,0,100).
  // 8 lines total, one lineTo call each.
  assert.equal(lineToCalls.length, 8);
  assert.ok(calls.some((call) => call[0] === "set strokeStyle"));
});

test("paintOverlay's grid ignores a non-positive/non-finite spacing (no lines, no infinite loop)", () => {
  const { target, calls } = makeRecordingTarget();
  OL.paintOverlay(target, { axes: false, grid: { spacing: 0 } }, VIEWPORT);
  assert.equal(calls.filter((call) => call[0] === "lineTo").length, 0);
});

test("paintOverlay draws exactly two axes lines crossing at the origin", () => {
  const { target, calls } = makeRecordingTarget();
  OL.paintOverlay(target, { axes: true }, VIEWPORT);
  const moveToCalls = calls.filter((call) => call[0] === "moveTo");
  assert.deepEqual(moveToCalls, [
    ["moveTo", 0, 150],
    ["moveTo", 200, 0],
  ]);
});

test("paintOverlay draws the measure marker at the last-measured position with a heading tick", () => {
  const { target, calls } = makeRecordingTarget();
  OL.paintOverlay(
    target,
    { axes: false, measure: { position: [0, 0], heading: 0 } },
    VIEWPORT,
  );
  assert.ok(calls.some((call) => call[0] === "arc"));
  assert.ok(calls.some((call) => call[0] === "fill"));
  const lineToCall = calls.find((call) => call[0] === "lineTo");
  // Heading 0 points "up" (screen -y): tick x stays at center, y decreases.
  assert.ok(lineToCall[2] < 150);
});

test("paintOverlay draws grid, then axes, then measure, in that fixed order, wrapped in save/restore", () => {
  const { target, calls } = makeRecordingTarget();
  OL.paintOverlay(
    target,
    {
      axes: true,
      grid: { spacing: 100 },
      measure: { position: [0, 0], heading: 0 },
    },
    VIEWPORT,
  );
  assert.equal(calls[0][0], "save");
  assert.equal(calls[calls.length - 1][0], "restore");
  const firstArcIndex = calls.findIndex((call) => call[0] === "arc");
  const firstAxesMoveIndex = calls.findIndex(
    (call) => call[0] === "moveTo" && call[1] === 0 && call[2] === 150,
  );
  const firstGridLineIndex = calls.findIndex((call) => call[0] === "lineTo");
  assert.ok(firstGridLineIndex < firstAxesMoveIndex);
  assert.ok(firstAxesMoveIndex < firstArcIndex);
});

test("paintScene paints overlays after every drawing item but before returning", () => {
  const { target, calls } = makeRecordingTarget();
  const scene = {
    background: "white",
    items: [
      {
        kind: "segment",
        segment: { from: [0, 0], to: [10, 0], color: "black", width: 1 },
      },
    ],
  };
  OL.paintScene(target, scene, VIEWPORT, { axes: true });
  const segmentStrokeIndex = calls.findIndex(
    (call, index) =>
      call[0] === "stroke" &&
      calls.slice(0, index).some((prior) => prior[0] === "moveTo"),
  );
  const overlaySaveIndex = calls.findIndex((call) => call[0] === "save");
  assert.ok(segmentStrokeIndex < overlaySaveIndex);
});

test("paintTurtle paints overlays before the avatar, and threads overlay through to paintScene", () => {
  const { target, calls } = makeRecordingTarget();
  const scene = { background: "white", items: [] };
  const state = {
    position: [0, 0],
    heading: 0,
    penDown: true,
    color: "black",
    width: 1,
    shape: "arrow",
    visible: true,
  };
  OL.paintTurtle(target, scene, state, VIEWPORT, { axes: true });
  const overlaySaveIndex = calls.findIndex((call) => call[0] === "save");
  const avatarRestoreIndex = calls.findIndex((call) => call[0] === "restore");
  assert.ok(overlaySaveIndex >= 0);
  assert.ok(avatarRestoreIndex > overlaySaveIndex);
});

test("renderFrame threads the source's overlay snapshot through to paintTurtle", () => {
  const snapshot = {
    cursor: 0,
    status: "done",
    state: { ...OL.INITIAL_TURTLE_STATE, visible: false },
    scene: { background: "white", items: [] },
    overlay: { axes: true },
  };
  const source = { getSnapshot: () => snapshot };
  const { target, calls } = makeRecordingTarget();
  OL.renderFrame(target, source, VIEWPORT);
  assert.ok(calls.some((call) => call[0] === "save"));
  const moveToCalls = calls.filter((call) => call[0] === "moveTo");
  assert.equal(moveToCalls.length, 2);
});
