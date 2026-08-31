import assert from "node:assert/strict";
import { test } from "node:test";
import * as Core from "@openlogo/core";
import * as OL from "@openlogo/turtle";

function makeSpan() {
  return Core.makeSpan("main.logo", [1, 1], [1, 1]);
}

let seq = 0;
function event(kind, payload, turtleId = 0) {
  seq += 1;
  return {
    seq,
    kind,
    source_span: makeSpan(),
    turtle_id: turtleId,
    payload,
  };
}

/**
 * Builds the event stream for `spec/rendering.md`'s worked example:
 * ```logo
 * repeat 4
 *   forward 100
 *   right 90
 * end repeat
 * ```
 * Each source instruction gets its own `instruction` event, followed by the effect events it
 * causes: `forward 100` → `move` + `draw-segment`; `right 90` → `turn`. Four iterations of two
 * instructions each yields exactly 8 instruction-steps, matching the issue's acceptance
 * criteria.
 *
 * The movement follows the heading, so the four segments really do close a square. An earlier
 * version advanced `y` only and ignored `heading` entirely, emitting a straight line whose `move`
 * payloads contradicted its own `turn` payloads — the geometry below is only asserted for the first
 * step, so nothing caught it. Biome's `useConst` did: it fired precisely because `x` was dead, and
 * that deadness was the defect rather than a style nit.
 *
 * Headings are degrees clockwise from up (`spec/rendering.md`), so the four cardinal offsets are
 * exact integers and no floating-point rounding enters the fixture.
 */
const STEP = 100;
const OFFSET_BY_HEADING = new Map([
  [0, [0, STEP]],
  [90, [STEP, 0]],
  [180, [0, -STEP]],
  [270, [-STEP, 0]],
]);

function repeat4ForwardRightEvents() {
  const events = [];
  let x = 0;
  let y = 0;
  let heading = 0;
  for (let i = 0; i < 4; i++) {
    // forward 100 — along the current heading, not along a fixed axis.
    const from = [x, y];
    const [dx, dy] = OFFSET_BY_HEADING.get(heading);
    x += dx;
    y += dy;
    const to = [x, y];
    events.push(event("instruction", { text: "forward 100" }));
    events.push(event("move", { from, to, heading }));
    events.push(event("draw-segment", { from, to, color: "black", width: 1 }));

    // right 90
    const fromHeading = heading;
    heading = (heading + 90) % 360;
    events.push(event("instruction", { text: "right 90" }));
    events.push(event("turn", { from: fromHeading, to: heading }));
  }
  return events;
}

test("controller starts idle at cursor 0 with initial state/scene/overlay", () => {
  const controller = new OL.TurtleAnimationController(
    repeat4ForwardRightEvents(),
  );
  const snapshot = controller.getSnapshot();
  assert.equal(snapshot.cursor, 0);
  assert.equal(snapshot.status, "idle");
  assert.deepEqual(snapshot.state, OL.INITIAL_TURTLE_STATE);
  assert.deepEqual(snapshot.scene, OL.INITIAL_TURTLE_SCENE);
  assert.deepEqual(snapshot.overlay, OL.INITIAL_OVERLAY_STATE);
});

test("step once at the first `forward 100` consumes only that instruction's effects", () => {
  const events = repeat4ForwardRightEvents();
  const controller = new OL.TurtleAnimationController(events);
  controller.step();
  const snapshot = controller.getSnapshot();

  // Consumed exactly: instruction, move, draw-segment (3 events) — not the following
  // `right 90` instruction/turn pair.
  assert.equal(snapshot.cursor, 3);
  assert.equal(snapshot.status, "paused");
  assert.deepEqual(snapshot.state.position, [0, 100]);
  assert.equal(snapshot.state.heading, 0, "right 90 has not been consumed yet");
  assert.equal(snapshot.scene.items.length, 1);
  assert.equal(snapshot.scene.items[0].kind, "segment");
});

test("stepping through all 8 instruction-steps consumes the whole stream", () => {
  const events = repeat4ForwardRightEvents();
  const controller = new OL.TurtleAnimationController(events);
  let steps = 0;
  while (controller.getSnapshot().status !== "done") {
    controller.step();
    steps += 1;
  }
  assert.equal(steps, 8);
  const snapshot = controller.getSnapshot();
  assert.equal(snapshot.cursor, events.length);
  assert.equal(snapshot.status, "done");
});

test("step is a no-op once playback is done", () => {
  const events = repeat4ForwardRightEvents();
  const controller = new OL.TurtleAnimationController(events);
  controller.seekToEnd();
  const before = controller.getSnapshot();
  controller.step();
  const after = controller.getSnapshot();
  assert.deepEqual(after, before);
});

test("seekToEnd consumes everything synchronously and reaches done", () => {
  const events = repeat4ForwardRightEvents();
  const controller = new OL.TurtleAnimationController(events);
  controller.seekToEnd();
  const snapshot = controller.getSnapshot();
  assert.equal(snapshot.cursor, events.length);
  assert.equal(snapshot.status, "done");
});

test("seekToEnd cancels a pending scheduled step, then finishes synchronously", () => {
  const events = repeat4ForwardRightEvents();
  const pendingCallbacks = [];
  const scheduler = (callback) => {
    pendingCallbacks.push(callback);
    return () => {
      const index = pendingCallbacks.indexOf(callback);
      if (index >= 0) {
        pendingCallbacks.splice(index, 1);
      }
    };
  };
  const controller = new OL.TurtleAnimationController(events, { scheduler });
  controller.run();
  assert.equal(
    pendingCallbacks.length,
    1,
    "one step scheduled, awaiting the fake clock",
  );
  controller.seekToEnd();
  assert.equal(
    pendingCallbacks.length,
    0,
    "pending step cancelled by seekToEnd",
  );
  assert.equal(controller.getSnapshot().status, "done");
  assert.equal(controller.getSnapshot().cursor, events.length);
});

test("pause stops consumption after the current step; run resumes from that point", () => {
  const events = repeat4ForwardRightEvents();
  const pendingCallbacks = [];
  const scheduler = (callback) => {
    pendingCallbacks.push(callback);
    return () => {
      const index = pendingCallbacks.indexOf(callback);
      if (index >= 0) {
        pendingCallbacks.splice(index, 1);
      }
    };
  };
  const controller = new OL.TurtleAnimationController(events, { scheduler });

  controller.run();
  assert.equal(controller.getSnapshot().status, "running");
  assert.equal(
    pendingCallbacks.length,
    1,
    "one step scheduled, awaiting the fake clock",
  );

  // Fire the pending step manually (simulating the fake clock ticking once).
  pendingCallbacks.shift()();
  assert.equal(controller.getSnapshot().cursor, 3);
  assert.equal(
    pendingCallbacks.length,
    1,
    "next step scheduled after the first fires",
  );

  controller.pause();
  assert.equal(controller.getSnapshot().status, "paused");
  assert.equal(pendingCallbacks.length, 0, "pending step cancelled by pause");

  // Resuming continues from exactly where it paused, not from the start.
  controller.run();
  assert.equal(pendingCallbacks.length, 1);
  while (controller.getSnapshot().status === "running") {
    pendingCallbacks.shift()();
  }
  assert.equal(controller.getSnapshot().status, "done");
  assert.equal(controller.getSnapshot().cursor, events.length);
});

test("pause is a no-op when not running", () => {
  const controller = new OL.TurtleAnimationController(
    repeat4ForwardRightEvents(),
  );
  const before = controller.getSnapshot();
  controller.pause();
  assert.deepEqual(controller.getSnapshot(), before);

  controller.seekToEnd();
  const done = controller.getSnapshot();
  controller.pause();
  assert.deepEqual(controller.getSnapshot(), done);
});

test("run is a no-op once playback is done", () => {
  const controller = new OL.TurtleAnimationController(
    repeat4ForwardRightEvents(),
  );
  controller.seekToEnd();
  const before = controller.getSnapshot();
  controller.run();
  assert.deepEqual(controller.getSnapshot(), before);
});

test("run is a no-op while already running — no duplicate overlapping drive loop", () => {
  const events = repeat4ForwardRightEvents();
  const pendingCallbacks = [];
  const scheduler = (callback) => {
    pendingCallbacks.push(callback);
    return () => {
      const index = pendingCallbacks.indexOf(callback);
      if (index >= 0) {
        pendingCallbacks.splice(index, 1);
      }
    };
  };
  const controller = new OL.TurtleAnimationController(events, { scheduler });

  controller.run();
  assert.equal(pendingCallbacks.length, 1, "one step scheduled");

  // Calling run() again while already running must NOT schedule a second, overlapping tick —
  // otherwise pause() would only be able to cancel the newest one, leaving the first pending
  // forever and able to double-consume a step once it eventually fires.
  controller.run();
  assert.equal(
    pendingCallbacks.length,
    1,
    "still exactly one scheduled tick after a redundant run() call",
  );

  controller.pause();
  assert.equal(
    pendingCallbacks.length,
    0,
    "the single pending tick was cancelled by pause",
  );
  assert.equal(controller.getSnapshot().cursor, 0);
});

test("step cancels a pending run()-scheduled tick, so it cannot later double-consume", () => {
  const events = repeat4ForwardRightEvents();
  const pendingCallbacks = [];
  const scheduler = (callback) => {
    pendingCallbacks.push(callback);
    return () => {
      const index = pendingCallbacks.indexOf(callback);
      if (index >= 0) {
        pendingCallbacks.splice(index, 1);
      }
    };
  };
  const controller = new OL.TurtleAnimationController(events, { scheduler });

  controller.run();
  assert.equal(pendingCallbacks.length, 1);
  const staleCallback = pendingCallbacks[0];

  // A manual step takes over from the still-pending run() tick.
  controller.step();
  assert.equal(controller.getSnapshot().cursor, 3);
  assert.equal(controller.getSnapshot().status, "paused");
  assert.equal(
    pendingCallbacks.length,
    0,
    "step() cancelled the stale run()-scheduled tick",
  );

  // Even if something still held a reference to the (now-cancelled) stale callback and invoked
  // it directly, the controller's own status guard must refuse to consume — belt-and-braces
  // alongside the scheduler-level cancellation above.
  staleCallback();
  assert.equal(
    controller.getSnapshot().cursor,
    3,
    "no double-consumption from the stale tick",
  );
  assert.equal(controller.getSnapshot().status, "paused");
});

test("driveRun's callback ignores a stale invocation from a scheduler that ignores cancellation", () => {
  const events = repeat4ForwardRightEvents();
  let capturedCallback = null;
  const misbehavingScheduler = (callback) => {
    capturedCallback = callback;
    // Deliberately returns a cancel function that does nothing, unlike every well-behaved
    // scheduler used elsewhere in this file — simulates a host that ignores cancellation.
    return () => {};
  };
  const controller = new OL.TurtleAnimationController(events, {
    scheduler: misbehavingScheduler,
  });

  controller.run();
  assert.equal(controller.getSnapshot().status, "running");
  assert.equal(
    controller.getSnapshot().cursor,
    0,
    "the misbehaving scheduler hasn't fired yet",
  );

  controller.pause();
  assert.equal(controller.getSnapshot().status, "paused");

  // The scheduler ignored our cancel handle, so the captured callback still fires "late" — the
  // controller's own status guard (not the scheduler's cooperation) must be what prevents it
  // from consuming a step after pause.
  capturedCallback();
  assert.equal(controller.getSnapshot().cursor, 0);
  assert.equal(controller.getSnapshot().status, "paused");
});

test("reset clears runtime state and rewinds the cursor to the beginning", () => {
  const events = repeat4ForwardRightEvents();
  const controller = new OL.TurtleAnimationController(events);
  controller.step();
  controller.step();
  controller.reset();
  const snapshot = controller.getSnapshot();
  assert.equal(snapshot.cursor, 0);
  assert.equal(snapshot.status, "idle");
  assert.deepEqual(snapshot.state, OL.INITIAL_TURTLE_STATE);
  assert.deepEqual(snapshot.scene, OL.INITIAL_TURTLE_SCENE);
});

test("replay is an alias for reset and replays the retained stream from the beginning", () => {
  const events = repeat4ForwardRightEvents();
  const controller = new OL.TurtleAnimationController(events);
  controller.seekToEnd();
  controller.replay();
  const snapshot = controller.getSnapshot();
  assert.equal(snapshot.cursor, 0);
  assert.equal(snapshot.status, "idle");

  controller.seekToEnd();
  assert.equal(controller.getSnapshot().status, "done");
});

test("reset cancels a pending scheduled step", () => {
  const events = repeat4ForwardRightEvents();
  const pendingCallbacks = [];
  const scheduler = (callback) => {
    pendingCallbacks.push(callback);
    return () => {
      const index = pendingCallbacks.indexOf(callback);
      if (index >= 0) {
        pendingCallbacks.splice(index, 1);
      }
    };
  };
  const controller = new OL.TurtleAnimationController(events, { scheduler });
  controller.run();
  assert.equal(pendingCallbacks.length, 1);
  controller.reset();
  assert.equal(pendingCallbacks.length, 0, "pending step cancelled by reset");
  assert.equal(controller.getSnapshot().status, "idle");
});

test("speed changes pacing only — same steps, same order, same boundaries", () => {
  const events = repeat4ForwardRightEvents();
  const delays = [];
  const cancels = [];
  const scheduler = (callback, delayMs) => {
    delays.push(delayMs);
    callback();
    const cancel = () => {};
    cancels.push(cancel);
    return cancel;
  };
  const controller = new OL.TurtleAnimationController(events, {
    scheduler,
    stepsPerSecond: 2,
  });
  assert.equal(controller.getSpeed(), 2);
  controller.setSpeed(10);
  assert.equal(controller.getSpeed(), 10);
  controller.run();
  assert.equal(controller.getSnapshot().status, "done");
  assert.equal(controller.getSnapshot().cursor, events.length);
  // Every scheduled delay reflects the 10 steps/sec pacing (100ms), regardless of how many
  // steps were consumed — pacing changed, not the step count or their order.
  assert.ok(delays.length > 0);
  for (const delay of delays) {
    assert.equal(delay, 100);
  }
  // Each already-fired scheduled call's cancel handle is still callable (a harmless no-op),
  // matching a real scheduler's contract even after the callback already ran.
  for (const cancel of cancels) {
    assert.doesNotThrow(() => cancel());
  }
});

test("speed is clamped into a sane positive range instead of raising a diagnostic", () => {
  const controller = new OL.TurtleAnimationController(
    repeat4ForwardRightEvents(),
  );
  controller.setSpeed(-5);
  assert.ok(controller.getSpeed() > 0);
  controller.setSpeed(Number.POSITIVE_INFINITY);
  assert.ok(Number.isFinite(controller.getSpeed()));
  controller.setSpeed(Number.NaN);
  assert.ok(controller.getSpeed() > 0);
  controller.setSpeed(1_000_000);
  assert.ok(controller.getSpeed() <= 1000);
});

test("determinism invariant: instant, slow, and step-by-step all fold to an identical final scene", () => {
  const events = repeat4ForwardRightEvents();

  const direct = OL.reduceSceneEvents(events);

  const instant = new OL.TurtleAnimationController(events);
  instant.seekToEnd();

  // Also drive the default IMMEDIATE_SCHEDULER through run()/driveRun() directly (not just
  // seekToEnd's own loop), since running instantly is itself part of the spec's invariant.
  const instantViaRun = new OL.TurtleAnimationController(events);
  instantViaRun.run();
  assert.equal(instantViaRun.getSnapshot().status, "done");

  const stepwise = new OL.TurtleAnimationController(events);
  while (stepwise.getSnapshot().status !== "done") {
    stepwise.step();
  }

  const pendingCallbacks = [];
  const cancels = [];
  const slowScheduler = (callback) => {
    pendingCallbacks.push(callback);
    const cancel = () => {};
    cancels.push(cancel);
    return cancel;
  };
  const slow = new OL.TurtleAnimationController(events, {
    scheduler: slowScheduler,
    stepsPerSecond: 0.5,
  });
  slow.run();
  while (pendingCallbacks.length > 0) {
    pendingCallbacks.shift()();
  }
  for (const cancel of cancels) {
    assert.doesNotThrow(() => cancel());
  }

  assert.deepEqual(instant.getSnapshot().scene, direct);
  assert.deepEqual(instantViaRun.getSnapshot().scene, direct);
  assert.deepEqual(stepwise.getSnapshot().scene, direct);
  assert.deepEqual(slow.getSnapshot().scene, direct);
  assert.deepEqual(instant.getSnapshot().state, stepwise.getSnapshot().state);
  assert.deepEqual(instant.getSnapshot().state, slow.getSnapshot().state);
  assert.deepEqual(
    instant.getSnapshot().state,
    instantViaRun.getSnapshot().state,
  );
});

test("large repeat stress case consumes without recursion blowing the call stack", () => {
  const events = [];
  let y = 0;
  for (let i = 0; i < 10000; i++) {
    const from = [0, y];
    y += 1;
    const to = [0, y];
    events.push(event("instruction", { text: "forward 1" }));
    events.push(event("move", { from, to, heading: 0 }));
    events.push(event("draw-segment", { from, to, color: "black", width: 1 }));
  }
  const controller = new OL.TurtleAnimationController(events);
  controller.run();
  const snapshot = controller.getSnapshot();
  assert.equal(snapshot.status, "done");
  assert.equal(snapshot.cursor, events.length);
  assert.equal(snapshot.state.position[1], 10000);
  assert.equal(snapshot.scene.items.length, 10000);
  // Deliberately NOT an O(n) claim: `run()` is step-driven, and step-driven consumption is still
  // Θ(n²) because each step materialises one immutable snapshot of a growing scene (#977, and the
  // class doc block). What this pins is the trampoline — that a synchronous scheduler consumes the
  // stream iteratively rather than one recursive frame per step.
});

test("controller over an empty event stream is immediately done on run/step/seekToEnd", () => {
  const runController = new OL.TurtleAnimationController([]);
  runController.run();
  assert.equal(runController.getSnapshot().status, "done");

  const stepController = new OL.TurtleAnimationController([]);
  stepController.step();
  assert.equal(stepController.getSnapshot().status, "done");

  const seekController = new OL.TurtleAnimationController([]);
  seekController.seekToEnd();
  assert.equal(seekController.getSnapshot().status, "done");
});

test("a genuinely asynchronous scheduler resumes driveRun from its own callback", () => {
  const events = repeat4ForwardRightEvents();
  const scheduled = [];
  const cancels = [];
  // Simulates a real async host timer: the callback fires on a later microtask/macrotask turn,
  // never synchronously within the call to the scheduler itself.
  const asyncScheduler = (callback) => {
    const handle = setTimeout(callback, 0);
    scheduled.push(handle);
    const cancel = () => clearTimeout(handle);
    cancels.push(cancel);
    return cancel;
  };
  const controller = new OL.TurtleAnimationController(events, {
    scheduler: asyncScheduler,
  });
  controller.run();
  assert.equal(controller.getSnapshot().status, "running");

  return new Promise((resolve) => {
    const check = () => {
      if (controller.getSnapshot().status === "done") {
        assert.equal(controller.getSnapshot().cursor, events.length);
        // Calling an already-fired handle's cancel is a harmless no-op, matching a real
        // `clearTimeout`'s contract.
        for (const cancel of cancels) {
          assert.doesNotThrow(() => cancel());
        }
        resolve();
      } else {
        setTimeout(check, 0);
      }
    };
    check();
  });
});

test("custom initialState/initialScene/initialOverlay seed the controller", () => {
  const customState = { ...OL.INITIAL_TURTLE_STATE, color: "red" };
  const customScene = { ...OL.INITIAL_TURTLE_SCENE, background: "blue" };
  const customOverlay = { axes: true };
  const controller = new OL.TurtleAnimationController([], {
    initialState: customState,
    initialScene: customScene,
    initialOverlay: customOverlay,
  });
  const snapshot = controller.getSnapshot();
  assert.deepEqual(snapshot.state, customState);
  assert.deepEqual(snapshot.scene, customScene);
  assert.deepEqual(snapshot.overlay, customOverlay);

  controller.reset();
  const afterReset = controller.getSnapshot();
  assert.deepEqual(afterReset.state, customState);
  assert.deepEqual(afterReset.scene, customScene);
  assert.deepEqual(afterReset.overlay, customOverlay);
});

test("an overlay event folds into the snapshot's overlay state and survives a subsequent clear", () => {
  const events = [
    event("overlay", { overlay: "axes" }),
    event("overlay", { overlay: "grid", spacing: 20 }),
    event("clear", {}),
  ];
  const controller = new OL.TurtleAnimationController(events);
  controller.seekToEnd();
  const snapshot = controller.getSnapshot();
  assert.deepEqual(snapshot.overlay, { axes: true, grid: { spacing: 20 } });
  // The clear event resets the retained scene but leaves the overlay untouched.
  assert.deepEqual(snapshot.scene, OL.INITIAL_TURTLE_SCENE);
});

test("reset rewinds overlay state back to its initial value, not just state/scene", () => {
  const events = [event("overlay", { overlay: "axes" })];
  const controller = new OL.TurtleAnimationController(events);
  controller.seekToEnd();
  assert.deepEqual(controller.getSnapshot().overlay, { axes: true });
  controller.reset();
  assert.deepEqual(controller.getSnapshot().overlay, OL.INITIAL_OVERLAY_STATE);
});

test("IMMEDIATE_SCHEDULER invokes its callback synchronously and returns a callable no-op cancel", () => {
  let called = false;
  const cancel = OL.IMMEDIATE_SCHEDULER(() => {
    called = true;
  }, 100);
  assert.equal(called, true);
  assert.doesNotThrow(() => cancel());
});

// --- per-turtle world folding (#749) ----------------------------------------------------------

test("the controller folds a per-turtle world, so each sprite keeps its own state and the last-acted turtle is tracked", () => {
  // The #749 reproduction as a trace stream: two sprites move under `tell [ :a :b ]`, then `:b`
  // alone is hidden and turned blue. The merged single-turtle fold reported ":b's" blue+hidden on
  // whatever turtle the avatar was drawing; the world keeps them apart.
  const spawn = (id) =>
    event(
      "spawn-turtle",
      {
        turtle_id: id,
        position: [0, 0],
        heading: 0,
        pen: "down",
        color: "black",
        width: 1,
        visible: true,
        shape: "turtle",
      },
      id,
    );
  const events = [
    spawn(1),
    spawn(2),
    event("instruction", { text: "forward 10" }, undefined),
    event("move", { from: [0, 0], to: [0, 10], heading: 0 }, 1),
    event("move", { from: [0, 0], to: [0, 10], heading: 0 }, 2),
    event(
      "instruction",
      { text: 'ask :b [ hide_turtle set_color "blue" ]' },
      undefined,
    ),
    event("visibility-change", { from: true, to: false }, 2),
    event("color-change", { from: "black", to: "blue" }, 2),
  ];
  const controller = new OL.TurtleAnimationController(events);
  controller.seekToEnd();
  const { world, state } = controller.getSnapshot();

  assert.deepEqual([...world.turtles.keys()], [0, 1, 2]);
  assert.equal(world.turtles.get(1).visible, true);
  assert.equal(world.turtles.get(1).color, "black");
  assert.equal(world.turtles.get(2).visible, false);
  assert.equal(world.turtles.get(2).color, "blue");
  // The main turtle never acted, so it is untouched.
  assert.deepEqual(world.turtles.get(0), OL.INITIAL_TURTLE_STATE);
  // `state` is the LAST-ACTED turtle's own state, not every turtle merged into one.
  assert.equal(world.lastActedTurtleId, 2);
  assert.equal(state, world.turtles.get(2));
});

test("the controller's snapshot state matches a direct single-turtle fold for a single-turtle stream", () => {
  // The compatibility property: with no sprites, `getSnapshot().state` is exactly what
  // `reduceTurtleEvents` produces, so nothing about single-turtle playback changed.
  const events = repeat4ForwardRightEvents();
  const controller = new OL.TurtleAnimationController(events);
  controller.seekToEnd();
  assert.deepEqual(
    controller.getSnapshot().state,
    OL.reduceTurtleEvents(events),
  );
});

test("initialState seeds the main turtle of the controller's world", () => {
  const initialState = { ...OL.INITIAL_TURTLE_STATE, color: "purple" };
  const controller = new OL.TurtleAnimationController([], { initialState });
  const { world, state } = controller.getSnapshot();
  assert.equal(state, initialState);
  assert.equal(world.turtles.get(OL.MAIN_TURTLE_ID), initialState);
  assert.equal(world.lastActedTurtleId, OL.MAIN_TURTLE_ID);
});

test("reset() restores the controller's world to its seed", () => {
  const initialState = { ...OL.INITIAL_TURTLE_STATE, color: "purple" };
  const controller = new OL.TurtleAnimationController(
    repeat4ForwardRightEvents(),
    { initialState },
  );
  controller.seekToEnd();
  // The square closes, so at the end the turtle is back at its start position and heading — the
  // playback state deep-equals the seed by value. What must differ is identity: playback recomputes
  // a state object, and the scene has accumulated the four drawn sides. (An earlier version
  // asserted `notDeepEqual` here, which only held because the fixture drew a straight line to
  // y=400 instead of the square it documents.)
  assert.notEqual(controller.getSnapshot().state, initialState);
  assert.equal(controller.getSnapshot().scene.items.length, 4);

  controller.reset();
  const { world, state, scene } = controller.getSnapshot();
  assert.equal(state, initialState);
  assert.equal(scene.items.length, 0);
  assert.deepEqual([...world.turtles.keys()], [OL.MAIN_TURTLE_ID]);
});

/**
 * The studio's own resume rule (`run-controller.ts`, #769) as it stood before #977: step while the
 * step ending at `stepEnd` still ends at or before the already-drawn boundary. Kept here verbatim
 * as the ORACLE the seek is checked against — `seekToEventIndex` is only correct if it lands
 * exactly where this loop landed, so the loop has to survive somewhere to be compared with.
 *
 * **This oracle is relative, and that is a deliberate limit.** It drives the real
 * `controller.step()`, which reaches the scene through the same `applyRange`/`reduceSceneRange` the
 * seek does — subject compared with subject. So it catches *batching* and *step-boundary* defects
 * and nothing else: a reducer that mis-handles an event kind, or one that `applyRange` drops
 * entirely, is invisible to it (a mutation deleting the overlay fold passed this test). Per-event
 * semantics are pinned only by the concrete-value tests elsewhere in this file and in
 * `scene.test.mjs`/`overlay.test.mjs`, and by the wiring-oracle test below. **Do not delete
 * those on the assumption that this every-index loop subsumes them — it does not.**
 */
function fastForwardByStepping(events, alreadyDrawn) {
  const controller = new OL.TurtleAnimationController(events);
  const limit = Math.min(alreadyDrawn, events.length);
  let drawnCursor = 0;
  while (drawnCursor < limit) {
    let stepEnd = drawnCursor + 1;
    while (stepEnd < events.length && events[stepEnd]?.kind !== "instruction") {
      stepEnd += 1;
    }
    if (stepEnd > limit) {
      break;
    }
    controller.step();
    drawnCursor = stepEnd;
  }
  return controller;
}

/**
 * A deliberately scene-diverse stream for the every-index oracle below. `repeat4ForwardRightEvents`
 * emits only `instruction`/`move`/`turn`/`draw-segment`, so every `overlay`, `background-change`,
 * `fill`, `stamp` and `clear` comparison in that loop is initial-against-initial and asserts
 * nothing.
 *
 * **What this fixture does and does not buy.** It exercises step boundaries over richer kinds. It
 * does **not**, on its own, catch a reducer that `applyRange` drops entirely — a mutation deleting
 * the overlay fold still passes the every-index loop, because that oracle drives `step()`, which
 * reaches the reducers through the same `applyRange`. The wiring-oracle test below is what
 * catches that. Stated because the enrichment was added in response to exactly that mutation and it
 * would be easy to assume it closed it.
 *
 * Note the mid-stream `clear`: it is the one kind that discards the fold's buffer, which is where
 * copy-on-first-write has to be right at a non-zero offset — but it also **erases any
 * double-applied prefix**, so this fixture must not be used to test cursor-relative folding. See
 * `clearFreeSceneEvents`.
 */
function richSceneEvents() {
  const events = [];
  events.push(event("instruction", { text: 'set_background "navy"' }));
  events.push(event("background-change", { color: "navy" }));
  events.push(event("instruction", { text: "grid 20" }));
  events.push(event("overlay", { overlay: "grid", spacing: 20 }));
  events.push(event("instruction", { text: "forward 10" }));
  events.push(event("move", { from: [0, 0], to: [0, 10], heading: 0 }));
  events.push(
    event("draw-segment", {
      from: [0, 0],
      to: [0, 10],
      color: "black",
      width: 1,
    }),
  );
  events.push(event("instruction", { text: 'fill "gold"' }));
  events.push(event("fill", { color: "gold" }));
  events.push(event("instruction", { text: "stamp" }));
  events.push(
    event("stamp", {
      position: [0, 10],
      heading: 0,
      shape: "turtle",
      color: "black",
    }),
  );
  events.push(event("instruction", { text: "clean" }));
  events.push(event("clear", { mode: "clean" }));
  events.push(event("instruction", { text: "forward 5" }));
  events.push(event("move", { from: [0, 10], to: [0, 15], heading: 0 }));
  events.push(
    event("draw-segment", {
      from: [0, 10],
      to: [0, 15],
      color: "red",
      width: 3,
    }),
  );
  events.push(event("instruction", { text: "axes" }));
  events.push(event("overlay", { overlay: "axes" }));
  events.push(event("instruction", { text: "measure" }));
  events.push(
    event("overlay", { overlay: "measure", position: [0, 15], heading: 0 }),
  );
  return events;
}

/**
 * The same diversity **without a `clear`**, for anything testing cursor-relative folding. A `clear`
 * erases a double-applied prefix, and every other kind here is idempotent under re-application
 * (background set to one colour, an overlay re-enabled, absolute `move` payloads) — so a fold that
 * wrongly restarted from 0 would land on the identical scene and go unnoticed. Only the appending
 * kinds expose it, by doubling.
 */
function clearFreeSceneEvents() {
  const events = [];
  events.push(event("instruction", { text: 'set_background "navy"' }));
  events.push(event("background-change", { color: "navy" }));
  events.push(event("instruction", { text: "grid 20" }));
  events.push(event("overlay", { overlay: "grid", spacing: 20 }));
  events.push(event("instruction", { text: "forward 10" }));
  events.push(event("move", { from: [0, 0], to: [0, 10], heading: 0 }));
  events.push(
    event("draw-segment", {
      from: [0, 0],
      to: [0, 10],
      color: "black",
      width: 1,
    }),
  );
  events.push(event("instruction", { text: 'fill "gold"' }));
  events.push(event("fill", { color: "gold" }));
  events.push(event("instruction", { text: "stamp" }));
  events.push(
    event("stamp", {
      position: [0, 10],
      heading: 0,
      shape: "turtle",
      color: "black",
    }),
  );
  events.push(event("instruction", { text: "forward 5" }));
  events.push(event("move", { from: [0, 10], to: [0, 15], heading: 0 }));
  events.push(
    event("draw-segment", {
      from: [0, 10],
      to: [0, 15],
      color: "red",
      width: 3,
    }),
  );
  return events;
}

test("seekToEventIndex lands exactly where stepping lands, at EVERY index (#977 AC3)", () => {
  for (const [name, build] of [
    ["repeat4", repeat4ForwardRightEvents],
    ["rich", richSceneEvents],
  ]) {
    const events = build();
    // Past the end too, so the clamp is compared against the oracle rather than merely not throwing.
    for (let index = 0; index <= events.length + 3; index += 1) {
      const stepped = fastForwardByStepping(events, index).getSnapshot();
      const controller = new OL.TurtleAnimationController(events);
      controller.seekToEventIndex(index);
      const seeked = controller.getSnapshot();

      assert.equal(seeked.cursor, stepped.cursor, `${name} cursor at ${index}`);
      assert.equal(seeked.status, stepped.status, `${name} status at ${index}`);
      assert.deepEqual(
        seeked.state,
        stepped.state,
        `${name} state at ${index}`,
      );
      assert.deepEqual(
        seeked.scene,
        stepped.scene,
        `${name} scene at ${index}`,
      );
      assert.deepEqual(
        seeked.overlay,
        stepped.overlay,
        `${name} overlay at ${index}`,
      );
      assert.deepEqual(
        [...seeked.world.turtles.entries()],
        [...stepped.world.turtles.entries()],
        `${name} world at ${index}`,
      );
    }
  }
});

test("applyRange folds overlay and scene against reducers it does not route through (#977)", () => {
  // A WIRING oracle, not a semantic one. `reduceOverlayEvents` reaches `reduceOverlayState`
  // directly rather than through `applyRange`, so it catches a reducer `applyRange` drops
  // altogether — the mutation the every-index loop above cannot see. It is NOT independent of the
  // reducers themselves: `reduceSceneEvents` delegates to `reduceSceneRange`, the very function
  // `applyRange` calls, so per-event scene semantics are pinned by the concrete-value tests in
  // `scene.test.mjs`, not here.
  const events = richSceneEvents();
  const controller = new OL.TurtleAnimationController(events);
  controller.seekToEnd();
  const snapshot = controller.getSnapshot();
  assert.deepEqual(snapshot.overlay, OL.reduceOverlayEvents(events));
  assert.deepEqual(snapshot.scene, OL.reduceSceneEvents(events));
  assert.notDeepEqual(
    snapshot.overlay,
    OL.INITIAL_OVERLAY_STATE,
    "the fixture must actually move the overlay, or this oracle asserts nothing",
  );
});

test("seekToEnd folds from the CURSOR, not from zero (#977)", () => {
  // Deliberately a CLEAR-FREE fixture. With a mid-stream `clear`, a fold that restarted from 0
  // lands on the identical scene — the clear erases the doubled prefix — so this test passed
  // against the rich fixture while the mutation it exists for went undetected.
  //
  // The prefix must also have ACTUALLY DRAWN something: stepping past two non-appending
  // instructions leaves nothing to double, which is the second way this test silently degraded.
  // The assertion below pins that precondition rather than assuming it.
  const events = clearFreeSceneEvents();
  const controller = new OL.TurtleAnimationController(events);
  controller.step();
  controller.step();
  controller.step();
  controller.step();
  const drawnBefore = controller.getSnapshot().scene.items.length;
  assert.ok(
    drawnBefore > 0,
    "the stepped prefix must have drawn something, or a re-fold from zero doubles nothing",
  );

  controller.seekToEnd();
  const expected = OL.reduceSceneEvents(events);
  assert.equal(
    controller.getSnapshot().scene.items.length,
    expected.items.length,
    `a fold restarted from zero would double the ${drawnBefore} item(s) already drawn`,
  );
  assert.deepEqual(controller.getSnapshot().scene, expected);
  assert.deepEqual(
    controller.getSnapshot().overlay,
    OL.reduceOverlayEvents(events),
  );
});

test("seekToEventIndex over an empty stream leaves the controller idle (#977)", () => {
  // Deliberate and documented: a seek that consumes no step changes nothing, status included, and
  // over an empty stream that is every seek. `step()`/`seekToEnd()` report "done" here; this
  // control's equivalence is to the step loop it replaces, which would not have run either.
  for (const index of [0, 5, -3]) {
    const controller = new OL.TurtleAnimationController([]);
    controller.seekToEventIndex(index);
    assert.equal(controller.getSnapshot().status, "idle", `seek(${index})`);
    assert.equal(controller.getSnapshot().cursor, 0);
  }
});

test("a no-move seekToEventIndex while running leaves playback alive (#977)", () => {
  // The regression this pins: cancelling the scheduled step BEFORE discovering there is nothing to
  // fold left the controller `"running"` with nothing pending, and `run()` refuses to restart while
  // the status is already `"running"` — playback wedged with no way back except reset().
  const events = repeat4ForwardRightEvents();
  let pending = null;
  let cancelled = 0;
  const controller = new OL.TurtleAnimationController(events, {
    scheduler: (callback) => {
      pending = callback;
      return () => {
        cancelled += 1;
        pending = null;
      };
    },
  });
  controller.run();
  assert.equal(typeof pending, "function", "run() scheduled a step");
  assert.equal(controller.getSnapshot().status, "running");

  controller.seekToEventIndex(0);

  assert.equal(cancelled, 0, "a no-move seek must cancel nothing");
  assert.equal(typeof pending, "function", "the scheduled step must survive");
  assert.equal(controller.getSnapshot().status, "running");

  // And playback genuinely continues: firing the pending tick still advances the cursor.
  const resume = pending;
  resume();
  assert.ok(
    controller.getSnapshot().cursor > 0,
    "playback must still advance after a no-move seek",
  );

  // The contrast that makes the assertion above mean something: a seek that DOES move still
  // cancels, so `cancelled` staying 0 above is a property of the no-op path rather than of a
  // scheduler whose cancel handle was never wired up.
  assert.equal(
    typeof pending,
    "function",
    "playback rescheduled after resuming",
  );
  controller.seekToEventIndex(events.length);
  assert.equal(cancelled, 1, "a moving seek must cancel the scheduled step");
  assert.equal(pending, null);
  assert.equal(controller.getSnapshot().status, "done");
});

test("a zero-effect instruction is its own step (#977 — the stepEndFrom boundary)", () => {
  // `stepEndFrom` is new in this change and is documented as "the single definition of a step
  // boundary, shared by consumeOneStep and seekToEventIndex". Nothing pinned it: no other fixture
  // contains two ADJACENT `instruction` events, and the every-index seek≡step oracle structurally
  // cannot see a boundary defect because both sides route through `stepEndFrom` — subject compared
  // with subject. Mutating `cursor + 1` to `cursor + 2` swallowed a whole program (cursor 4,
  // status "done", one item drawn, on the first step) with the entire suite still green.
  //
  // `spec/rendering.md`: a step is one `instruction` plus every effect event up to the next
  // `instruction` or the end of the stream — so an instruction that produces no effects is a step
  // all by itself.
  const events = [
    event("instruction", { text: "pen_down" }),
    event("instruction", { text: "forward 10" }),
    event("move", { from: [0, 0], to: [0, 10], heading: 0 }),
    event("draw-segment", {
      from: [0, 0],
      to: [0, 10],
      color: "black",
      width: 1,
    }),
  ];
  const controller = new OL.TurtleAnimationController(events);

  controller.step();
  assert.equal(
    controller.getSnapshot().cursor,
    1,
    "the first step ends at the next instruction, consuming only the zero-effect one",
  );
  assert.equal(controller.getSnapshot().scene.items.length, 0);
  assert.equal(controller.getSnapshot().status, "paused");

  controller.step();
  assert.equal(controller.getSnapshot().cursor, 4);
  assert.equal(controller.getSnapshot().scene.items.length, 1);
  assert.equal(controller.getSnapshot().status, "done");
});

test("seekToEventIndex respects a zero-effect instruction's boundary too (#977)", () => {
  // The same boundary, reached through the seek rather than through `step()`, so a defect in the
  // shared `stepEndFrom` is caught on both of its callers rather than only one.
  const events = [
    event("instruction", { text: "pen_down" }),
    event("instruction", { text: "forward 10" }),
    event("move", { from: [0, 0], to: [0, 10], heading: 0 }),
    event("draw-segment", {
      from: [0, 0],
      to: [0, 10],
      color: "black",
      width: 1,
    }),
  ];
  const controller = new OL.TurtleAnimationController(events);
  controller.seekToEventIndex(1);
  assert.equal(controller.getSnapshot().cursor, 1);
  assert.equal(controller.getSnapshot().scene.items.length, 0);
});

test("seekToEventIndex never lands mid-step: the cursor is always a step boundary", () => {
  const events = repeat4ForwardRightEvents();
  for (let index = 0; index <= events.length; index += 1) {
    const controller = new OL.TurtleAnimationController(events);
    controller.seekToEventIndex(index);
    const { cursor } = controller.getSnapshot();
    if (cursor > 0 && cursor < events.length) {
      assert.equal(
        events[cursor].kind,
        "instruction",
        `cursor ${cursor} (seek ${index}) must sit on an instruction`,
      );
    }
    assert.ok(cursor <= index, "a seek never consumes past its own index");
  }
});

test("seekToEventIndex to the full length matches seekToEnd", () => {
  const events = repeat4ForwardRightEvents();
  const seeked = new OL.TurtleAnimationController(events);
  seeked.seekToEventIndex(events.length);
  const ended = new OL.TurtleAnimationController(events);
  ended.seekToEnd();
  assert.equal(seeked.getSnapshot().status, "done");
  assert.deepEqual(seeked.getSnapshot().scene, ended.getSnapshot().scene);
  assert.equal(seeked.getSnapshot().cursor, ended.getSnapshot().cursor);
});

test("seekToEventIndex advances from wherever the cursor already is, not from zero", () => {
  const events = repeat4ForwardRightEvents();
  const controller = new OL.TurtleAnimationController(events);
  controller.step();
  assert.equal(controller.getSnapshot().cursor, 3);
  controller.seekToEventIndex(events.length);
  const stepped = new OL.TurtleAnimationController(events);
  stepped.seekToEnd();
  assert.deepEqual(controller.getSnapshot().scene, stepped.getSnapshot().scene);
  assert.equal(controller.getSnapshot().cursor, events.length);
});

test("seekToEventIndex behind the cursor changes nothing, status included", () => {
  const events = repeat4ForwardRightEvents();
  const controller = new OL.TurtleAnimationController(events);
  controller.step();
  const before = controller.getSnapshot();
  controller.seekToEventIndex(1);
  const after = controller.getSnapshot();
  assert.equal(after.cursor, before.cursor);
  assert.equal(after.status, before.status);
  assert.equal(after.scene, before.scene, "the scene is not even re-derived");
});

test("seekToEventIndex(0) on a fresh controller leaves it idle, as the step loop would", () => {
  const events = repeat4ForwardRightEvents();
  const controller = new OL.TurtleAnimationController(events);
  controller.seekToEventIndex(0);
  assert.equal(controller.getSnapshot().status, "idle");
  assert.equal(controller.getSnapshot().cursor, 0);
});

test("seekToEventIndex is a no-op once playback is done", () => {
  const events = repeat4ForwardRightEvents();
  const controller = new OL.TurtleAnimationController(events);
  controller.seekToEnd();
  const before = controller.getSnapshot();
  controller.seekToEventIndex(events.length);
  const after = controller.getSnapshot();
  assert.equal(after.status, "done");
  assert.equal(after.cursor, before.cursor);
  assert.equal(after.scene, before.scene);
});

test("seekToEventIndex cancels a step scheduled by a prior run(), like step() does", () => {
  const events = repeat4ForwardRightEvents();
  let pending = null;
  let cancelled = 0;
  const controller = new OL.TurtleAnimationController(events, {
    scheduler: (callback) => {
      pending = callback;
      return () => {
        cancelled += 1;
        pending = null;
      };
    },
  });
  controller.run();
  assert.equal(typeof pending, "function", "run() scheduled a step");
  controller.seekToEventIndex(events.length);
  assert.equal(
    cancelled,
    1,
    "the scheduled step was cancelled, not left to fire",
  );
  assert.equal(controller.getSnapshot().status, "done");
});
