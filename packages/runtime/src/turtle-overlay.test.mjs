// Unit tests for issue #341: executing the Geometry profile's renderer-backed overlay primitives
// `grid`/`axes`/`measure` — each Kind C, arity 0, emitting exactly one `overlay` trace event and
// never mutating turtle state (`spec/geometry-module.md:268-308`).

import assert from "node:assert/strict";
import { test } from "node:test";
import { execute } from "@openlogo/runtime";

const doc = "acceptance.logo";

function overlayEvents(result) {
  return result.events.filter((event) => event.kind === "overlay");
}

// --- grid ---------------------------------------------------------------------------------

test("bare `grid` emits exactly one overlay event with the default spacing", () => {
  const result = execute("grid", doc);
  assert.deepEqual(result.diagnostics, []);
  const events = overlayEvents(result);
  assert.equal(events.length, 1);
  assert.equal(events[0].payload.overlay, "grid");
  assert.equal(events[0].payload.spacing, 20);
});

test("`(grid 50)` is rejected with ol-too-many-inputs, not executed", () => {
  const result = execute("(grid 50)", doc);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-too-many-inputs");
  assert.equal(overlayEvents(result).length, 0);
});

// --- axes ---------------------------------------------------------------------------------

test("bare `axes` emits exactly one overlay event with no extra data", () => {
  const result = execute("axes", doc);
  assert.deepEqual(result.diagnostics, []);
  const events = overlayEvents(result);
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].payload, { overlay: "axes" });
});

test("`(axes 1)` is rejected with ol-too-many-inputs, not executed", () => {
  const result = execute("(axes 1)", doc);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-too-many-inputs");
  assert.equal(overlayEvents(result).length, 0);
});

// --- measure --------------------------------------------------------------------------------

test("bare `measure` emits exactly one overlay event snapshotting the turtle's home position/heading", () => {
  const result = execute("measure", doc);
  assert.deepEqual(result.diagnostics, []);
  const events = overlayEvents(result);
  assert.equal(events.length, 1);
  assert.equal(events[0].payload.overlay, "measure");
  assert.deepEqual(events[0].payload.position, [0, 0]);
  assert.equal(events[0].payload.heading, 0);
});

test("`measure` after moving/turning snapshots the CURRENT position and heading, not home", () => {
  const result = execute("forward 100\nright 90\nmeasure", doc);
  assert.deepEqual(result.diagnostics, []);
  const [event] = overlayEvents(result);
  assert.deepEqual(event.payload.position, [0, 100]);
  assert.equal(event.payload.heading, 90);
});

test("`(measure 1)` is rejected with ol-too-many-inputs, not executed", () => {
  const result = execute("(measure 1)", doc);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-too-many-inputs");
  assert.equal(overlayEvents(result).length, 0);
});

// --- no turtle-state mutation ----------------------------------------------------------------

test("grid/axes/measure never move, turn, or otherwise change turtle state", () => {
  const result = execute("grid\naxes\nmeasure", doc);
  assert.deepEqual(result.diagnostics, []);
  const mutatingKinds = new Set([
    "move",
    "turn",
    "pen-change",
    "color-change",
    "background-change",
    "width-change",
    "visibility-change",
    "shape-change",
    "clear",
  ]);
  const mutatingEvents = result.events.filter((event) =>
    mutatingKinds.has(event.kind),
  );
  assert.deepEqual(mutatingEvents, []);
  assert.equal(overlayEvents(result).length, 3);
});

// --- overlays survive a subsequent `clean` ----------------------------------------------------

test("grid/axes/measure overlay events are not undone or followed by any clear-related event", () => {
  const result = execute("grid\naxes\nmeasure\nclean", doc);
  assert.deepEqual(result.diagnostics, []);
  assert.equal(overlayEvents(result).length, 3);
  const clearEvents = result.events.filter((event) => event.kind === "clear");
  assert.equal(clearEvents.length, 1);
  // The clear event carries no reference to, or cancellation of, the overlay events — the
  // renderer-side reducer (`@openlogo/turtle`'s `overlay.ts`) is what actually proves survival by
  // having no `"clear"` case; here we only prove the runtime emits both independently, in order,
  // one `overlay` event per statement followed by the `clean` statement's `clear` event.
  const nonInstructionKinds = result.events
    .filter((event) => event.kind !== "instruction")
    .map((event) => event.kind);
  assert.deepEqual(nonInstructionKinds, [
    "overlay",
    "overlay",
    "overlay",
    "clear",
  ]);
});
