import { test } from "node:test";
import assert from "node:assert/strict";
import * as OL from "@openlogo/studio";

const { mapRunStatusToRunToggleViewModel, RUN_TOGGLE_VIEW_MODELS } = OL;

test("mapRunStatusToRunToggleViewModel maps 'idle' to the play/Start affordance", () => {
  assert.deepEqual(mapRunStatusToRunToggleViewModel("idle"), {
    action: "run",
    icon: "play",
    label: "Start",
    ariaLabel: "Start run",
    ariaPressed: false,
  });
});

test("mapRunStatusToRunToggleViewModel maps 'running' to the honest Stop affordance (#410)", () => {
  assert.deepEqual(mapRunStatusToRunToggleViewModel("running"), {
    action: "stop",
    icon: "stop",
    label: "Stop",
    ariaLabel: "Stop run",
    ariaPressed: false,
  });
});

test("mapRunStatusToRunToggleViewModel maps 'done' back to the play/Start affordance", () => {
  assert.deepEqual(mapRunStatusToRunToggleViewModel("done"), {
    action: "run",
    icon: "play",
    label: "Start",
    ariaLabel: "Start run",
    ariaPressed: false,
  });
});

test("mapRunStatusToRunToggleViewModel maps 'stopped' back to the play/Start affordance", () => {
  assert.deepEqual(mapRunStatusToRunToggleViewModel("stopped"), {
    action: "run",
    icon: "play",
    label: "Start",
    ariaLabel: "Start run",
    ariaPressed: false,
  });
});

test("RUN_TOGGLE_VIEW_MODELS covers exactly the four internal RunStatus values", () => {
  assert.deepEqual(Object.keys(RUN_TOGGLE_VIEW_MODELS).sort(), [
    "done",
    "idle",
    "running",
    "stopped",
  ]);
});

test("only 'running' invokes stop(); every other status invokes run()", () => {
  for (const runStatus of ["idle", "done", "stopped"]) {
    assert.equal(mapRunStatusToRunToggleViewModel(runStatus).action, "run");
  }
  assert.equal(mapRunStatusToRunToggleViewModel("running").action, "stop");
});

test("no status reports ariaPressed true — a plain Stop is not a resumable toggle (#410)", () => {
  for (const runStatus of ["idle", "running", "done", "stopped"]) {
    assert.equal(
      mapRunStatusToRunToggleViewModel(runStatus).ariaPressed,
      false,
    );
  }
});

test("every view model has a non-empty accessible name distinct from the icon alone", () => {
  for (const runStatus of ["idle", "running", "done", "stopped"]) {
    const viewModel = mapRunStatusToRunToggleViewModel(runStatus);
    assert.ok(viewModel.ariaLabel.length > 0);
    assert.ok(viewModel.label.length > 0);
  }
});
