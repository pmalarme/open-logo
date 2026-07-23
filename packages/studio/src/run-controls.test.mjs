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
  });
});

test("mapRunStatusToRunToggleViewModel maps 'running' to the honest Stop affordance (#410)", () => {
  assert.deepEqual(mapRunStatusToRunToggleViewModel("running"), {
    action: "stop",
    icon: "stop",
    label: "Stop",
    ariaLabel: "Stop run",
  });
});

test("mapRunStatusToRunToggleViewModel maps 'done' back to the play/Start affordance", () => {
  assert.deepEqual(mapRunStatusToRunToggleViewModel("done"), {
    action: "run",
    icon: "play",
    label: "Start",
    ariaLabel: "Start run",
  });
});

test("mapRunStatusToRunToggleViewModel maps 'stopped' to the play/Start affordance, but a restart action (#432 finding 1)", () => {
  assert.deepEqual(mapRunStatusToRunToggleViewModel("stopped"), {
    action: "restart",
    icon: "play",
    label: "Start",
    ariaLabel: "Start run",
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

test("'running' invokes stop(); 'idle'/'done' invoke run(); 'stopped' invokes restart (#432 finding 1)", () => {
  for (const runStatus of ["idle", "done"]) {
    assert.equal(mapRunStatusToRunToggleViewModel(runStatus).action, "run");
  }
  assert.equal(mapRunStatusToRunToggleViewModel("running").action, "stop");
  assert.equal(mapRunStatusToRunToggleViewModel("stopped").action, "restart");
});

test("no view model declares an ariaPressed field — a plain Stop must not claim toggle semantics (#410)", () => {
  for (const runStatus of ["idle", "running", "done", "stopped"]) {
    assert.equal(
      "ariaPressed" in mapRunStatusToRunToggleViewModel(runStatus),
      false,
      `${runStatus} view model must not have an ariaPressed field — even "false" would tell ` +
        "assistive technology this is a resumable toggle button, which #410 explicitly disavows",
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

// -------------------------------------------------------------------------------------------
// #432 finding 1 — createRunToggleActionHandlers: the toggle's "restart" action must compose
// reset() + run(), and a Stop -> Start press (through this same handler wiring, never by calling
// run() directly) must produce a genuine fresh run.
// -------------------------------------------------------------------------------------------

test("createRunToggleActionHandlers wires 'run'/'stop' directly to the controller's own methods", () => {
  const calls = [];
  const fakeController = {
    run: () => calls.push("run"),
    stop: () => calls.push("stop"),
  };
  const handlers = OL.createRunToggleActionHandlers(fakeController);

  handlers.run();
  handlers.stop();
  assert.deepEqual(calls, ["run", "stop"]);
});

test("createRunToggleActionHandlers wires 'restart' to reset() immediately followed by run() (#432 finding 1)", () => {
  const calls = [];
  const fakeController = {
    run: () => calls.push("run"),
    reset: () => calls.push("reset"),
  };
  const handlers = OL.createRunToggleActionHandlers(fakeController);

  handlers.restart();
  assert.deepEqual(calls, ["reset", "run"]);
});

/**
 * The Stop -> Start lifecycle integration test (#432 finding 1's AC): pressing the toggle in the
 * `stopped` state, through the SAME wiring `web/main.ts` uses (view-model lookup ->
 * `createRunToggleActionHandlers`'s handler map), must produce a genuine fresh run with no
 * immediate `ol-limit`/`cancelled` halt — never by calling `runController.run()` directly, which
 * is exactly the direct-call path `run-controller.test.mjs` already proves still halts (the
 * no-auto-rearm contract this fix must NOT disturb).
 */
function pressRunToggle(store, handlers) {
  const { action } = mapRunStatusToRunToggleViewModel(
    store.getState().runStatus,
  );
  handlers[action]();
}

test("Stop -> Start lifecycle: pressing the toggle after Stop (through the real handler wiring) starts a genuine fresh run, never re-halting (#432 finding 1)", () => {
  const store = OL.createStudioState({ source: "print 1" });
  const controller = OL.createRunController(store);
  const handlers = OL.createRunToggleActionHandlers(controller);

  pressRunToggle(store, handlers); // idle -> action "run"
  assert.equal(store.getState().runStatus, "done");
  assert.deepEqual(store.getState().output, ["1"]);

  controller.stop();
  assert.equal(store.getState().runStatus, "stopped");

  pressRunToggle(store, handlers); // stopped -> action "restart": reset() then run()
  assert.equal(
    store.getState().runStatus,
    "done",
    "a genuine fresh run must complete normally, not instantly re-halt at 'stopped'",
  );
  assert.deepEqual(store.getState().output, ["1"]);
  assert.deepEqual(
    store.getState().diagnostics,
    [],
    "a genuine fresh run must carry NO ol-limit/cancelled diagnostic",
  );
});

test("Stop -> Start lifecycle: a DIRECT stop() then run() call (bypassing the toggle) still halts deterministically — the no-auto-rearm contract is unchanged (#432 finding 1)", () => {
  const store = OL.createStudioState({ source: "print 1" });
  const controller = OL.createRunController(store);

  // Calling stop() then run() directly (never through the toggle/restart wiring) must still
  // re-trigger the deliberate no-auto-rearm halt — only reset() (or the toggle's "restart" action,
  // which composes reset() first) re-arms cancellation. This mirrors run-controller.test.mjs's own
  // "stop() sets runStatus immediately and the run controller's signal is honored on the next
  // run()" test exactly, proving the toggle-level fix in this module didn't erode that contract.
  controller.stop();
  assert.equal(store.getState().runStatus, "stopped");

  controller.run();

  const { output, diagnostics, runStatus } = store.getState();
  assert.deepEqual(output, []);
  assert.deepEqual(diagnostics.length, 1);
  assert.equal(diagnostics[0].code, "ol-limit");
  assert.equal(diagnostics[0].params?.limit, "cancelled");
  assert.equal(runStatus, "stopped");
});
