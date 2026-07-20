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

/**
 * Builds the event stream exactly as `@openlogo/runtime` actually emits it for
 * `repeat 4 [ forward 100 right 90 ]` (issue #295): a control form emits its own zero-effect
 * `instruction` start event *first* (the `repeat` container), then the body's first real
 * instruction (`forward 100`) follows immediately with its `move`/`draw-segment` effects. Unlike
 * {@link repeat4ForwardRightEvents} — which starts straight at `forward 100` — this fixture LEADS
 * with the container instruction, so it reproduces the bug where the first "Next step" consumed
 * only the invisible container and the turtle did not move until the second step.
 */
function repeatWithLeadingContainerEvents() {
  const events = [event("instruction", { statement_kind: "Repeat" })];
  let x = 0;
  let y = 0;
  let heading = 0;
  for (let i = 0; i < 4; i++) {
    const from = [x, y];
    y += 100;
    const to = [x, y];
    events.push(event("instruction", { statement_kind: "Call" }));
    events.push(event("move", { from, to, heading }));
    events.push(event("draw-segment", { from, to, color: "black", width: 1 }));

    const fromHeading = heading;
    heading = (heading + 90) % 360;
    events.push(event("instruction", { statement_kind: "Call" }));
    events.push(event("turn", { from: fromHeading, to: heading }));
  }
  return events;
}

test("issue #295: first step from idle skips the leading `repeat` container and moves the turtle", () => {
  const events = repeatWithLeadingContainerEvents();
  const controller = new OL.TurtleAnimationController(events);
  controller.step();
  const snapshot = controller.getSnapshot();

  // The leading zero-effect `Repeat` instruction is coalesced with the first `forward 100`
  // step, so a single step consumes: instruction(Repeat) + instruction(forward) + move +
  // draw-segment (4 events) and the turtle visibly advances to (0,100) — NOT a no-op.
  assert.equal(snapshot.cursor, 4);
  assert.equal(snapshot.status, "paused");
  assert.deepEqual(
    snapshot.state.position,
    [0, 100],
    "first step must move the turtle, not just consume the container",
  );
  assert.equal(
    snapshot.state.heading,
    0,
    "right 90 is still a separate later step",
  );
  assert.equal(snapshot.scene.items.length, 1);
  assert.equal(snapshot.scene.items[0].kind, "segment");
});

test("issue #295: reset then step reproduces the first observable move", () => {
  const events = repeatWithLeadingContainerEvents();
  const controller = new OL.TurtleAnimationController(events);
  controller.seekToEnd();
  controller.reset();
  assert.equal(controller.getSnapshot().cursor, 0);
  assert.equal(controller.getSnapshot().status, "idle");

  controller.step();
  const snapshot = controller.getSnapshot();
  assert.equal(snapshot.cursor, 4, "reset→step behaves like a fresh idle→step");
  assert.deepEqual(snapshot.state.position, [0, 100]);
  assert.equal(snapshot.scene.items.length, 1);
});

test("issue #295: the container-led stream still yields 8 visible steps, then done", () => {
  const events = repeatWithLeadingContainerEvents();
  const controller = new OL.TurtleAnimationController(events);
  let steps = 0;
  while (controller.getSnapshot().status !== "done") {
    controller.step();
    steps += 1;
  }
  // The invisible container adds no extra step: coalesced into the first forward, so the visible
  // step count matches spec/rendering.md's worked example (4 forwards + 4 rights), not 9.
  assert.equal(steps, 8);
  const snapshot = controller.getSnapshot();
  assert.equal(snapshot.cursor, events.length);
  assert.equal(snapshot.status, "done");
  assert.deepEqual(snapshot.scene, OL.reduceSceneEvents(events));
});

test("issue #295: a trailing zero-effect container is consumed as the final step, reaching done", () => {
  // `... forward 100  repeat 0 [ ... ]` — the last thing emitted is a lone container instruction
  // with no effects and nothing after it. The final step must consume it and finish, never loop.
  const events = [
    event("instruction", { statement_kind: "Call" }),
    event("move", { from: [0, 0], to: [0, 100], heading: 0 }),
    event("draw-segment", {
      from: [0, 0],
      to: [0, 100],
      color: "black",
      width: 1,
    }),
    event("instruction", { statement_kind: "Repeat" }),
  ];
  const controller = new OL.TurtleAnimationController(events);
  controller.step();
  assert.equal(
    controller.getSnapshot().cursor,
    3,
    "first step: the forward move",
  );
  assert.equal(controller.getSnapshot().status, "paused");

  controller.step();
  const snapshot = controller.getSnapshot();
  assert.equal(snapshot.cursor, events.length, "trailing container consumed");
  assert.equal(snapshot.status, "done");
});

test("issue #295: consecutive leading containers (nested loops) all coalesce into the first move", () => {
  // `repeat 2 [ repeat 2 [ forward 10 ] ]` leads with TWO container instructions back to back.
  const events = [
    event("instruction", { statement_kind: "Repeat" }),
    event("instruction", { statement_kind: "Repeat" }),
    event("instruction", { statement_kind: "Call" }),
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
  const snapshot = controller.getSnapshot();
  assert.equal(
    snapshot.cursor,
    events.length,
    "both containers + the forward consumed",
  );
  assert.deepEqual(snapshot.state.position, [0, 10]);
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
