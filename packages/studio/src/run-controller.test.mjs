import assert from "node:assert/strict";
import { test } from "node:test";
import * as OL from "@openlogo/studio";

test("run() executes the shared source via @openlogo/runtime and surfaces print output", () => {
  const store = OL.createStudioState({ source: '(print "hi" 2 3)' });
  const controller = OL.createRunController(store);

  controller.run();

  assert.deepEqual(store.getState().output, ["hi 2 3"]);
  assert.deepEqual(store.getState().diagnostics, []);
  assert.equal(store.getState().runStatus, "idle");
});

test("run() surfaces one output line per print event, in order", () => {
  const store = OL.createStudioState({
    source: "print 1\nprint 2\nprint 3",
  });
  const controller = OL.createRunController(store);

  controller.run();

  assert.deepEqual(store.getState().output, ["1", "2", "3"]);
  assert.equal(store.getState().runStatus, "idle");
});

test("run() surfaces parse/runtime diagnostics unchanged and leaves output empty", () => {
  const store = OL.createStudioState({ source: "flibbertigibbet 5" });
  const controller = OL.createRunController(store);

  controller.run();

  const { output, diagnostics, runStatus } = store.getState();
  assert.deepEqual(output, []);
  assert.ok(diagnostics.length > 0);
  assert.equal(runStatus, "idle");
});

test("run() reads the store's CURRENT source at call time, never a private copy", () => {
  const store = OL.createStudioState({ source: "print 1" });
  const controller = OL.createRunController(store);

  store.setSource("print 2");
  controller.run();

  assert.deepEqual(store.getState().output, ["2"]);
});

test("a runaway forever loop halts via the instruction budget, keeping the call bounded", () => {
  const store = OL.createStudioState({ source: "forever [ print 1 ]" });
  const controller = OL.createRunController(store, { instructionBudget: 5 });

  controller.run();

  const { diagnostics, runStatus } = store.getState();
  assert.ok(diagnostics.some((diagnostic) => diagnostic.code === "ol-limit"));
  assert.ok(
    diagnostics.some(
      (diagnostic) => diagnostic.params?.limit === "instruction-budget",
    ),
  );
  assert.equal(runStatus, "stopped");
});

test("stop() sets runStatus immediately and the run controller's signal is honored on the next run()", () => {
  const store = OL.createStudioState({ source: "print 1" });
  const controller = OL.createRunController(store);

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

test("reset() re-arms cancellation, clears output/diagnostics, and returns runStatus to idle", () => {
  const store = OL.createStudioState({ source: "print 1" });
  const controller = OL.createRunController(store);

  controller.stop();
  controller.run(); // halts immediately: cancellation is still armed.
  assert.deepEqual(store.getState().output, []);

  controller.reset();

  assert.deepEqual(store.getState().output, []);
  assert.deepEqual(store.getState().diagnostics, []);
  assert.equal(store.getState().runStatus, "idle");

  // The signal was re-armed, so a normal run() now completes instead of halting again.
  controller.run();
  assert.deepEqual(store.getState().output, ["1"]);
  assert.equal(store.getState().runStatus, "idle");
});

test("reset() is deterministic even with no prior run()", () => {
  const store = OL.createStudioState({
    source: "print 1",
    output: ["stale"],
    diagnostics: [
      { code: "ol-limit", message: "stale", source_span: undefined },
    ],
  });
  const controller = OL.createRunController(store);

  controller.reset();

  assert.deepEqual(store.getState().output, []);
  assert.deepEqual(store.getState().diagnostics, []);
  assert.equal(store.getState().runStatus, "idle");
});

test("step() is a documented no-op: it never touches state", () => {
  const store = OL.createStudioState({ source: "print 1" });
  const controller = OL.createRunController(store);
  const before = store.getState();

  controller.step();

  assert.equal(store.getState(), before);
});

test("two consumers holding the same store observe the same run output — no forked copy", () => {
  const store = OL.createStudioState({ source: "print 42" });
  const controller = OL.createRunController(store);
  const otherConsumer = store;

  controller.run();

  assert.deepEqual(otherConsumer.getState().output, ["42"]);
  assert.equal(otherConsumer.getState(), controller.state.getState());
});

test("mountRunController composes the controller into the shell's repl region", () => {
  const store = OL.createStudioState();
  const shell = OL.createAppShell(store);
  const controller = OL.createRunController(store);

  assert.equal(shell.getRegion("repl").content, null);

  OL.mountRunController(shell, controller);

  assert.equal(shell.getRegion("repl").content, controller);
});

test("createRunController accepts a custom document identifier and recursionDepthLimit", () => {
  const store = OL.createStudioState({ source: "print 1" });
  const controller = OL.createRunController(store, {
    document: "custom-doc",
    recursionDepthLimit: 10,
  });

  controller.run();

  assert.deepEqual(store.getState().output, ["1"]);
});
