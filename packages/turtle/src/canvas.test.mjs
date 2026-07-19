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
    ["lineTo", 6, 6],
    ["lineTo", -6, 6],
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

test("unknown shape words fall back to the default triangle-style avatar", () => {
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
