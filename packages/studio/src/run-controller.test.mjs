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

test("step() before any run() is a no-op: it never touches state", () => {
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

// ---------------------------------------------------------------------------------------------
// #228 — Run/Stop/Reset/Step driving the turtle Canvas view in lockstep.
// ---------------------------------------------------------------------------------------------

/**
 * A `@openlogo/turtle` `Scheduler` a test fully controls: `schedule` records the pending tick
 * without invoking it (simulating a real, not-yet-elapsed `setTimeout`), and the test decides
 * when to `fire()` it — modeling genuine asynchronous pacing deterministically, with no real
 * clock. Mirrors `TurtleAnimationController`'s own doc comment on real vs. synchronous schedulers.
 */
function createManualScheduler() {
  let pending = null;
  const scheduler = (callback) => {
    let live = true;
    pending = () => {
      if (live) {
        callback();
      }
    };
    return () => {
      live = false;
      pending = null;
    };
  };
  return {
    scheduler,
    /** Fires the pending tick, if any, returning whether one was pending. */
    fire() {
      const tick = pending;
      if (!tick) {
        return false;
      }
      pending = null;
      tick();
      return true;
    },
    hasPending: () => pending !== null,
  };
}

function createFakeCanvasView() {
  const calls = [];
  return {
    view: {
      viewport: { width: 100, height: 100, scale: 1 },
      repaint() {
        calls.push(calls.length);
      },
    },
    repaintCount: () => calls.length,
  };
}

test("createManualScheduler.fire() returns false and is a no-op when nothing is pending", () => {
  const manual = createManualScheduler();

  assert.equal(manual.hasPending(), false);
  assert.equal(manual.fire(), false);
});

test("run() with the default (immediate) scheduler drives the turtle state/scene to the program's final frame synchronously", () => {
  const store = OL.createStudioState({ source: "forward 100\nright 90" });
  const controller = OL.createRunController(store);

  controller.run();

  const { turtleState, turtleScene, runStatus } = store.getState();
  assert.notDeepEqual(
    turtleState,
    OL.createStudioState().getState().turtleState,
  );
  assert.equal(turtleState.heading, 90);
  assert.ok(turtleScene.items.length > 0);
  assert.equal(runStatus, "idle");
});

test("run() repaints a supplied canvasView as the animation advances", () => {
  const store = OL.createStudioState({ source: "forward 100\nright 90" });
  const fake = createFakeCanvasView();
  const controller = OL.createRunController(store, { canvasView: fake.view });

  controller.run();

  assert.ok(fake.repaintCount() > 0);
});

test("run() paces the turtle animation over an injected scheduler, one tick at a time — output/diagnostics are already final, but the canvas advances only as ticks fire", () => {
  const store = OL.createStudioState({ source: "forward 100\nright 90" });
  const manual = createManualScheduler();
  const controller = OL.createRunController(store, {
    scheduler: manual.scheduler,
  });
  const initialTurtleState = store.getState().turtleState;

  controller.run();

  // output/diagnostics were already computed synchronously by execute() — unaffected by pacing.
  assert.deepEqual(store.getState().output, []);
  // But the canvas hasn't advanced yet: only the first tick is scheduled, not fired.
  assert.equal(store.getState().turtleState, initialTurtleState);
  assert.equal(store.getState().runStatus, "running");
  assert.ok(manual.hasPending());

  manual.fire();
  assert.notEqual(store.getState().turtleState, initialTurtleState);
});

test("stop() pauses the turtle animation: a stale, already-scheduled tick can never fire afterward and advance it further", () => {
  const store = OL.createStudioState({
    source: "forward 100\nright 90\nforward 100",
  });
  const manual = createManualScheduler();
  const controller = OL.createRunController(store, {
    scheduler: manual.scheduler,
  });

  controller.run();
  manual.fire(); // consume the first step, scheduling the next.
  const stateAfterFirstStep = store.getState().turtleState;
  assert.ok(manual.hasPending());

  controller.stop();
  assert.equal(store.getState().runStatus, "stopped");

  // The stale tick scheduled before stop() must not fire and advance the picture further.
  assert.equal(manual.hasPending(), false);
  assert.equal(store.getState().turtleState, stateAfterFirstStep);
});

test("step() advances the paused turtle animation by exactly one instruction-step and repaints", () => {
  const store = OL.createStudioState({
    source: "forward 100\nright 90\nforward 100",
  });
  const manual = createManualScheduler();
  const fake = createFakeCanvasView();
  const controller = OL.createRunController(store, {
    scheduler: manual.scheduler,
    canvasView: fake.view,
  });

  controller.run();
  controller.stop();
  const repaintsBeforeStep = fake.repaintCount();
  const stateBeforeStep = store.getState().turtleState;

  controller.step(); // consumes "forward 100" — the first instruction.

  assert.ok(fake.repaintCount() > repaintsBeforeStep);
  assert.notEqual(store.getState().turtleState, stateBeforeStep);
  assert.deepEqual(store.getState().turtleState.position, [0, 100]);
  assert.equal(store.getState().turtleState.heading, 0);

  controller.step(); // consumes "right 90" — the second instruction.

  assert.equal(store.getState().turtleState.heading, 90);
});

test("step() before any run() remains a documented no-op even with a canvasView supplied", () => {
  const store = OL.createStudioState({ source: "print 1" });
  const fake = createFakeCanvasView();
  const controller = OL.createRunController(store, { canvasView: fake.view });

  controller.step();

  assert.equal(fake.repaintCount(), 0);
});

test("step()ping through the rest of the animation after stop() never reverts runStatus away from 'stopped'", () => {
  const store = OL.createStudioState({
    source: "forward 100\nright 90",
  });
  const manual = createManualScheduler();
  const controller = OL.createRunController(store, {
    scheduler: manual.scheduler,
  });

  controller.run();
  controller.stop();
  assert.equal(store.getState().runStatus, "stopped");

  // Manually stepping through to exhaustion must not silently report the stopped run as "idle".
  controller.step();
  controller.step();
  controller.step();

  assert.equal(store.getState().runStatus, "stopped");
});

test("reset() clears the turtle state/scene back to program-start defaults and repaints", () => {
  const store = OL.createStudioState({ source: "forward 100\nright 90" });
  const fake = createFakeCanvasView();
  const controller = OL.createRunController(store, { canvasView: fake.view });
  const defaults = OL.createStudioState().getState();

  controller.run();
  assert.notDeepEqual(store.getState().turtleState, defaults.turtleState);
  const repaintsBeforeReset = fake.repaintCount();

  controller.reset();

  assert.deepEqual(store.getState().turtleState, defaults.turtleState);
  assert.deepEqual(store.getState().turtleScene, defaults.turtleScene);
  assert.equal(store.getState().runStatus, "idle");
  assert.ok(fake.repaintCount() > repaintsBeforeReset);
});

test("reset() clears the turtle state/scene to defaults even with no prior run()", () => {
  const store = OL.createStudioState({ source: "print 1" });
  const controller = OL.createRunController(store);
  const defaults = OL.createStudioState().getState();

  controller.reset();

  assert.deepEqual(store.getState().turtleState, defaults.turtleState);
  assert.deepEqual(store.getState().turtleScene, defaults.turtleScene);
});

test("a subsequent run() rebuilds the turtle animation fresh from program-start defaults, never leaking the previous run's turtle position", () => {
  const store = OL.createStudioState({ source: "forward 100\nright 90" });
  const controller = OL.createRunController(store);

  controller.run();
  const afterFirstRun = store.getState().turtleState;

  store.setSource("print 1");
  controller.run();

  const defaults = OL.createStudioState().getState().turtleState;
  assert.deepEqual(store.getState().turtleState, defaults);
  assert.notDeepEqual(store.getState().turtleState, afterFirstRun);
});

test("a runaway forever loop still surfaces ol-limit and drives the (truncated) turtle animation over exactly the truncated stream", () => {
  const store = OL.createStudioState({ source: "forever [ forward 1 ]" });
  const controller = OL.createRunController(store, { instructionBudget: 20 });

  controller.run();

  const { diagnostics, runStatus, turtleState } = store.getState();
  assert.ok(diagnostics.some((diagnostic) => diagnostic.code === "ol-limit"));
  assert.equal(runStatus, "stopped");
  // The turtle actually moved (the truncated stream still folds real move events), never blocked
  // at the program-start default despite the run being cut short.
  assert.notDeepEqual(
    turtleState,
    OL.createStudioState().getState().turtleState,
  );
});

test("run() with reducedMotion:true paints the final scene instantly rather than pacing per-step ticks", () => {
  const store = OL.createStudioState({ source: "forward 100\nright 90" });
  const manual = createManualScheduler();
  const controller = OL.createRunController(store, {
    scheduler: manual.scheduler,
    reducedMotion: true,
  });

  controller.run();

  // seekToEnd() bypasses the scheduler entirely — nothing pending, already at the final frame.
  assert.equal(manual.hasPending(), false);
  assert.equal(store.getState().turtleState.heading, 90);
  assert.equal(store.getState().runStatus, "idle");
});
