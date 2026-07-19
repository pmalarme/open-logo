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
 */
function repeat4ForwardRightEvents() {
  const events = [];
  let x = 0;
  let y = 0;
  let heading = 0;
  for (let i = 0; i < 4; i++) {
    // forward 100
    const from = [x, y];
    y += 100;
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

test("controller starts idle at cursor 0 with initial state/scene", () => {
  const controller = new OL.TurtleAnimationController(
    repeat4ForwardRightEvents(),
  );
  const snapshot = controller.getSnapshot();
  assert.equal(snapshot.cursor, 0);
  assert.equal(snapshot.status, "idle");
  assert.deepEqual(snapshot.state, OL.INITIAL_TURTLE_STATE);
  assert.deepEqual(snapshot.scene, OL.INITIAL_TURTLE_SCENE);
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
  assert.deepEqual(stepwise.getSnapshot().scene, direct);
  assert.deepEqual(slow.getSnapshot().scene, direct);
  assert.deepEqual(instant.getSnapshot().state, stepwise.getSnapshot().state);
  assert.deepEqual(instant.getSnapshot().state, slow.getSnapshot().state);
});

test("large repeat stress case consumes in O(n) without recursion blowing the call stack", () => {
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

test("custom initialState/initialScene seed the controller", () => {
  const customState = { ...OL.INITIAL_TURTLE_STATE, color: "red" };
  const customScene = { ...OL.INITIAL_TURTLE_SCENE, background: "blue" };
  const controller = new OL.TurtleAnimationController([], {
    initialState: customState,
    initialScene: customScene,
  });
  const snapshot = controller.getSnapshot();
  assert.deepEqual(snapshot.state, customState);
  assert.deepEqual(snapshot.scene, customScene);

  controller.reset();
  const afterReset = controller.getSnapshot();
  assert.deepEqual(afterReset.state, customState);
  assert.deepEqual(afterReset.scene, customScene);
});

test("IMMEDIATE_SCHEDULER invokes its callback synchronously and returns a callable no-op cancel", () => {
  let called = false;
  const cancel = OL.IMMEDIATE_SCHEDULER(() => {
    called = true;
  }, 100);
  assert.equal(called, true);
  assert.doesNotThrow(() => cancel());
});
