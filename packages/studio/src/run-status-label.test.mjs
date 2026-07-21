import { test } from "node:test";
import assert from "node:assert/strict";
import * as OL from "@openlogo/studio";

const { mapRunStatusToLabel, RUN_STATUS_LABELS } = OL;

test("mapRunStatusToLabel maps 'idle' to 'Ready'", () => {
  assert.equal(mapRunStatusToLabel("idle"), "Ready");
});

test("mapRunStatusToLabel maps 'running' to 'Running'", () => {
  assert.equal(mapRunStatusToLabel("running"), "Running");
});

test("mapRunStatusToLabel maps 'done' to 'Complete'", () => {
  assert.equal(mapRunStatusToLabel("done"), "Complete");
});

test("mapRunStatusToLabel maps 'stopped' to 'Stopped'", () => {
  assert.equal(mapRunStatusToLabel("stopped"), "Stopped");
});

test("RUN_STATUS_LABELS covers exactly the four internal RunStatus values", () => {
  assert.deepEqual(Object.keys(RUN_STATUS_LABELS).sort(), [
    "done",
    "idle",
    "running",
    "stopped",
  ]);
});
