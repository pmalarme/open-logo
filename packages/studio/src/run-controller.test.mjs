import assert from "node:assert/strict";
import { test } from "node:test";
import * as OL from "@openlogo/studio";

test("run() executes the shared source via @openlogo/runtime and surfaces print output", () => {
  const store = OL.createStudioState({ source: '(print "hi" 2 3)' });
  const controller = OL.createRunController(store);

  controller.run();

  assert.deepEqual(store.getState().output, ["hi 2 3"]);
  assert.deepEqual(store.getState().diagnostics, []);
  assert.equal(store.getState().runStatus, "done");
});

test("run() captures an immutable lastRunResult snapshot alongside the live output/diagnostics (#432 finding 2)", () => {
  const source = "flibbertigibbet 5";
  const store = OL.createStudioState({ source });
  const controller = OL.createRunController(store);

  controller.run();

  const { output, diagnostics, lastRunResult } = store.getState();
  assert.ok(lastRunResult);
  assert.equal(lastRunResult.source, source);
  assert.deepEqual(lastRunResult.output, output);
  assert.deepEqual(lastRunResult.diagnostics, diagnostics);
});

test("run() snapshots the source it actually executed, not a later live edit (#432 finding 2)", () => {
  const originalSource = "print 1\nflibbertigibbet 5";
  const store = OL.createStudioState({ source: originalSource });
  const controller = OL.createRunController(store);

  controller.run();
  // Simulate the learner editing the editor after the (synchronous) run has already completed —
  // `lastRunResult.source` must still reflect what `execute()` actually ran, not this later edit.
  store.setSource("print 1");

  const { lastRunResult } = store.getState();
  assert.equal(lastRunResult.source, originalSource);
  assert.notEqual(store.getState().source, lastRunResult.source);
});

test("reset() clears lastRunResult back to null, mirroring output/diagnostics (#432 finding 2)", () => {
  const store = OL.createStudioState({ source: "print 1" });
  const controller = OL.createRunController(store);

  controller.run();
  assert.notEqual(store.getState().lastRunResult, null);

  controller.reset();
  assert.equal(store.getState().lastRunResult, null);
});

test("run() surfaces one output line per print event, in order", () => {
  const store = OL.createStudioState({
    source: "print 1\nprint 2\nprint 3",
  });
  const controller = OL.createRunController(store);

  controller.run();

  assert.deepEqual(store.getState().output, ["1", "2", "3"]);
  assert.equal(store.getState().runStatus, "done");
});

test("run() surfaces parse/runtime diagnostics unchanged and leaves output empty", () => {
  const store = OL.createStudioState({ source: "flibbertigibbet 5" });
  const controller = OL.createRunController(store);

  controller.run();

  const { output, diagnostics, runStatus } = store.getState();
  assert.deepEqual(output, []);
  assert.ok(diagnostics.length > 0);
  assert.equal(runStatus, "done");
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
  assert.equal(store.getState().runStatus, "done");
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

test("step() before any run() lazily prepares: executes the CURRENT source and advances exactly one instruction-step", () => {
  const store = OL.createStudioState({
    source: "forward 100\nright 90\nforward 100",
  });
  const controller = OL.createRunController(store);

  controller.step(); // consumes "forward 100" — the first instruction.

  const { output, diagnostics, runStatus, turtleState } = store.getState();
  assert.deepEqual(output, []);
  assert.deepEqual(diagnostics, []);
  assert.equal(runStatus, "running");
  assert.deepEqual(turtleState.position, [0, 100]);
  assert.equal(turtleState.heading, 0);
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
  assert.equal(runStatus, "done");
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

test("run() ignores a second call while a paced animation is still running (#314) — it never overlaps a run mid-animation", () => {
  const store = OL.createStudioState({
    source: "forward 100\nright 90\nforward 100",
  });
  const manual = createManualScheduler();
  const controller = OL.createRunController(store, {
    scheduler: manual.scheduler,
  });

  controller.run();
  manual.fire(); // consume the first step; the run is still "running", one tick still pending.
  const outputAfterFirstRun = store.getState().output;
  const turtleStateMidRun = store.getState().turtleState;
  assert.equal(store.getState().runStatus, "running");
  assert.ok(manual.hasPending());

  // Change the source and press Run again while the first run is still animating.
  store.setSource("print 1");
  controller.run();

  // The second call was ignored: output/diagnostics are still the FIRST run's, and the animation
  // in flight is untouched (same pending tick, same turtle state) rather than restarted.
  assert.equal(store.getState().output, outputAfterFirstRun);
  assert.equal(store.getState().turtleState, turtleStateMidRun);
  assert.ok(manual.hasPending());

  // Draining the original run's ticks still completes normally afterward.
  while (manual.fire()) {
    // keep firing until the original run's animation is fully drained
  }
  assert.equal(store.getState().runStatus, "done");
});

test("editing the source mid-paced-run keeps the current-instruction span cleared, even once the next already-scheduled tick fires (#410)", () => {
  const store = OL.createStudioState({
    source: "forward 100\nright 90\nforward 100",
  });
  const manual = createManualScheduler();
  const controller = OL.createRunController(store, {
    scheduler: manual.scheduler,
  });

  controller.run();
  manual.fire(); // consume the first step, scheduling the next tick and publishing a real span.
  assert.notEqual(store.getState().currentInstructionSourceSpan, null);
  assert.ok(manual.hasPending());

  // The learner edits the source while the run is still animating (setSource() itself clears
  // the span synchronously — this reproduces the deeper bug: does a later, already-in-flight
  // tick silently republish a stale one looked up against the OLD source's event stream?).
  store.setSource("print 1");
  assert.equal(store.getState().currentInstructionSourceSpan, null);

  manual.fire(); // fire the tick that was scheduled before the edit.

  assert.equal(
    store.getState().currentInstructionSourceSpan,
    null,
    "a tick scheduled for a run over stale source must not resurrect a current-instruction span " +
      "once the editor has moved on — it must keep omitting the clause, not reintroduce garbage " +
      "or empty-but-present text for a source that's no longer on screen",
  );
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

test("step() before any run() lazily prepares even with a canvasView supplied, repainting the first step", () => {
  const store = OL.createStudioState({ source: "forward 100\nright 90" });
  const fake = createFakeCanvasView();
  const controller = OL.createRunController(store, { canvasView: fake.view });

  controller.step();

  assert.ok(fake.repaintCount() > 0);
  assert.deepEqual(store.getState().turtleState.position, [0, 100]);
});

test("repeated step() from idle advances incrementally and settles to 'done' once the animation is exhausted", () => {
  const store = OL.createStudioState({
    source: "forward 100\nright 90",
  });
  const controller = OL.createRunController(store);

  controller.step(); // "forward 100"
  assert.equal(store.getState().runStatus, "running");
  assert.deepEqual(store.getState().turtleState.position, [0, 100]);
  assert.equal(store.getState().turtleState.heading, 0);

  controller.step(); // "right 90" — the last instruction, animation reaches "done".
  assert.equal(store.getState().turtleState.heading, 90);
  assert.equal(store.getState().runStatus, "done");

  controller.step(); // exhausted: a no-op, must not throw or change state.
  assert.equal(store.getState().runStatus, "done");
  assert.equal(store.getState().turtleState.heading, 90);
});

test("step() from idle on a program with a diagnostic surfaces that diagnostic exactly as run() would", () => {
  const store = OL.createStudioState({ source: "flibbertigibbet 5" });
  const controller = OL.createRunController(store);

  controller.step();

  const { output, diagnostics } = store.getState();
  assert.deepEqual(output, []);
  assert.ok(diagnostics.length > 0);
});

test("stop() then step()ping to exhaustion never reverts runStatus away from 'stopped', even when step() itself had to lazily prepare", () => {
  const store = OL.createStudioState({ source: "forward 100\nright 90" });
  const controller = OL.createRunController(store);

  controller.stop();
  assert.equal(store.getState().runStatus, "stopped");

  // animation is still null here (no run() ever happened) — step() must lazily prepare it, but
  // the prior stop() request must still be honored: the cancellation signal stays armed, so the
  // freshly-prepared run halts immediately with ol-limit/cancelled, exactly as run() would.
  controller.step();

  const { output, diagnostics, runStatus } = store.getState();
  assert.deepEqual(output, []);
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].code, "ol-limit");
  assert.equal(diagnostics[0].params?.limit, "cancelled");
  assert.equal(runStatus, "stopped");
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
  assert.equal(store.getState().runStatus, "done");
});

// ---------------------------------------------------------------------------------------------
// #310 — the turtle-speed slider actually paces (or instantly bypasses) the animation.
// ---------------------------------------------------------------------------------------------

/**
 * Like {@link createManualScheduler}, but also records the `delayMs` argument of every scheduled
 * call, so a test can assert the exact per-tick delay `prepare()` derived from `speedSliderValue`
 * (via `turtle-speed.ts`'s `mapSpeedSliderValueToTickDelayMs`) without needing a real clock. These
 * speed tests only need the recorded delay, never firing/cancelling a tick, so unlike
 * `createManualScheduler` its returned cancel function is a no-op rather than tracked state.
 */
function createRecordingScheduler() {
  const delays = [];
  const scheduler = (_callback, delayMs) => {
    delays.push(delayMs);
    return () => {};
  };
  return { scheduler, delays };
}

test("run() paces the turtle animation at the tick delay speedSliderValue maps to", () => {
  const store = OL.createStudioState({
    source: "forward 100\nright 90",
    speedSliderValue: OL.SPEED_SLIDER_MIN,
  });
  const manual = createRecordingScheduler();
  const controller = OL.createRunController(store, {
    scheduler: manual.scheduler,
  });

  controller.run();

  assert.ok(manual.delays.length > 0);
  for (const delay of manual.delays) {
    assert.equal(delay, OL.SLOWEST_TICK_DELAY_MS);
  }
  // Exercises the scheduler's own cancel function too (stop() cancels the pending tick).
  controller.stop();
});

test("run() paces the fastest paced slider position at FASTEST_PACED_TICK_DELAY_MS", () => {
  const store = OL.createStudioState({
    source: "forward 100\nright 90",
    speedSliderValue: OL.SPEED_SLIDER_MAX - 1,
  });
  const manual = createRecordingScheduler();
  const controller = OL.createRunController(store, {
    scheduler: manual.scheduler,
  });

  controller.run();

  assert.ok(manual.delays.length > 0);
  for (const delay of manual.delays) {
    assert.equal(delay, OL.FASTEST_PACED_TICK_DELAY_MS);
  }
  controller.stop();
});

test("run() drains instantly (bypassing the scheduler entirely) when speedSliderValue is at the dedicated instant position", () => {
  const store = OL.createStudioState({
    source: "forward 100\nright 90",
    speedSliderValue: OL.SPEED_SLIDER_MAX,
  });
  const manual = createManualScheduler();
  const controller = OL.createRunController(store, {
    scheduler: manual.scheduler,
  });

  controller.run();

  assert.equal(manual.hasPending(), false);
  assert.equal(store.getState().turtleState.heading, 90);
  assert.equal(store.getState().runStatus, "done");
});

test("run() with reducedMotion:true still paints instantly even when the slider is at a paced (non-instant) position — OS preference is honored regardless of the slider", () => {
  const store = OL.createStudioState({
    source: "forward 100\nright 90",
    speedSliderValue: OL.SPEED_SLIDER_MIN,
  });
  const manual = createManualScheduler();
  const controller = OL.createRunController(store, {
    scheduler: manual.scheduler,
    reducedMotion: true,
  });

  controller.run();

  assert.equal(manual.hasPending(), false);
  assert.equal(store.getState().turtleState.heading, 90);
});

test("run() with reducedMotion:false still paints instantly when the slider is at the instant position — the slider complements, never replaces, reducedMotion", () => {
  const store = OL.createStudioState({
    source: "forward 100\nright 90",
    speedSliderValue: OL.SPEED_SLIDER_MAX,
  });
  const manual = createManualScheduler();
  const controller = OL.createRunController(store, {
    scheduler: manual.scheduler,
    reducedMotion: false,
  });

  controller.run();

  assert.equal(manual.hasPending(), false);
  assert.equal(store.getState().turtleState.heading, 90);
});
