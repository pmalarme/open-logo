import assert from "node:assert/strict";
import { test } from "node:test";
import * as Core from "@openlogo/core";
import * as OL from "@openlogo/turtle";

function makeSpan() {
  return Core.makeSpan("main.logo", [1, 1], [1, 1]);
}

let seq = 0;
function event(kind, payload) {
  seq += 1;
  return {
    seq,
    kind,
    source_span: makeSpan(),
    payload,
  };
}

test("initial overlay state has no grid/measure and axes off", () => {
  assert.deepEqual(OL.INITIAL_OVERLAY_STATE, { axes: false });
});

test("a grid event sets the grid overlay's spacing", () => {
  const overlay = OL.reduceOverlayEvents([
    event("overlay", { overlay: "grid", spacing: 20 }),
  ]);
  assert.deepEqual(overlay, { axes: false, grid: { spacing: 20 } });
});

test("a later grid event refreshes the spacing rather than accumulating", () => {
  const overlay = OL.reduceOverlayEvents([
    event("overlay", { overlay: "grid", spacing: 20 }),
    event("overlay", { overlay: "grid", spacing: 50 }),
  ]);
  assert.deepEqual(overlay, { axes: false, grid: { spacing: 50 } });
});

test("an axes event turns the axes overlay on", () => {
  const overlay = OL.reduceOverlayEvents([
    event("overlay", { overlay: "axes" }),
  ]);
  assert.deepEqual(overlay, { axes: true });
});

test("a measure event records the position/heading snapshot", () => {
  const overlay = OL.reduceOverlayEvents([
    event("overlay", { overlay: "measure", position: [10, 20], heading: 90 }),
  ]);
  assert.deepEqual(overlay, {
    axes: false,
    measure: { position: [10, 20], heading: 90 },
  });
});

test("a later measure event refreshes the snapshot rather than accumulating", () => {
  const overlay = OL.reduceOverlayEvents([
    event("overlay", { overlay: "measure", position: [10, 20], heading: 90 }),
    event("overlay", { overlay: "measure", position: [0, 0], heading: 0 }),
  ]);
  assert.deepEqual(overlay, {
    axes: false,
    measure: { position: [0, 0], heading: 0 },
  });
});

test("grid, axes, and measure each toggle independently of the others", () => {
  const overlay = OL.reduceOverlayEvents([
    event("overlay", { overlay: "grid", spacing: 20 }),
    event("overlay", { overlay: "axes" }),
    event("overlay", { overlay: "measure", position: [1, 2], heading: 45 }),
  ]);
  assert.deepEqual(overlay, {
    axes: true,
    grid: { spacing: 20 },
    measure: { position: [1, 2], heading: 45 },
  });
});

test("a clear event leaves overlay state unchanged (overlays survive clean/clear_screen)", () => {
  const overlay = OL.reduceOverlayEvents([
    event("overlay", { overlay: "grid", spacing: 20 }),
    event("overlay", { overlay: "axes" }),
    event("clear", {}),
  ]);
  assert.deepEqual(overlay, { axes: true, grid: { spacing: 20 } });
});

test("non-overlay events (turtle state, scene) leave overlay state unchanged", () => {
  const overlay = OL.reduceOverlayEvents([
    event("overlay", { overlay: "axes" }),
    event("move", { from: [0, 0], to: [10, 0], pen_down: true }),
    event("draw-segment", {
      from: [0, 0],
      to: [10, 0],
      color: "black",
      width: 1,
    }),
  ]);
  assert.deepEqual(overlay, { axes: true });
});

test("an unrecognized overlay discriminant leaves overlay state unchanged", () => {
  const overlay = OL.reduceOverlayState(OL.INITIAL_OVERLAY_STATE, {
    seq: 0,
    kind: "overlay",
    source_span: makeSpan(),
    payload: { overlay: "not-a-real-overlay" },
  });
  assert.deepEqual(overlay, OL.INITIAL_OVERLAY_STATE);
});

test("reduceOverlayEvents defaults to INITIAL_OVERLAY_STATE when no initial state is given", () => {
  assert.deepEqual(OL.reduceOverlayEvents([]), OL.INITIAL_OVERLAY_STATE);
});

test("reduceOverlayEvents folds from a custom initial state when one is given", () => {
  const initial = { axes: true, grid: { spacing: 10 } };
  const overlay = OL.reduceOverlayEvents(
    [event("overlay", { overlay: "measure", position: [5, 5], heading: 180 })],
    initial,
  );
  assert.deepEqual(overlay, {
    axes: true,
    grid: { spacing: 10 },
    measure: { position: [5, 5], heading: 180 },
  });
});
