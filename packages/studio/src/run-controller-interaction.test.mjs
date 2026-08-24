import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import * as OL from "@openlogo/studio";

/**
 * `run-controller.ts`'s host-input delivery (#952) — the studio half of the `hostInput.events` seam
 * `@openlogo/runtime` shipped in #686.
 *
 * Before this slice the studio installed only `hostInput.read`, so `on_key`, `on_click`, and
 * `when "stop"` **registered and never fired**: `spec/examples/10-game.logo` produced 131 events,
 * zero prints, and no diagnostic at all. Every test here therefore asserts a handler's own
 * **effect** — the line it printed, the heading it turned the turtle to — because asserting that a
 * handler *registers* is exactly what passed on the broken tree.
 */

const TEN_GAME_SOURCE = readFileSync(
  fileURLToPath(
    new URL("../../../spec/examples/10-game.logo", import.meta.url),
  ),
  "utf8",
);

/** A minimal `on_key` program: the handler's only effect is a line a test can read back. */
const ON_KEY_SOURCE = [
  'on_key "left" [',
  '  print "turned"',
  "]",
  "wait 5",
].join("\n");

/** A minimal `on_click` program, shaped like `10-game.logo`'s scoring handler. */
const ON_CLICK_SOURCE = [
  ":score = 0",
  "on_click [",
  "  :score = :score + 1",
  "  print :score",
  "]",
  "wait 5",
].join("\n");

/** A `when "stop"` program — the notification `spec/interaction-events.md:152-156` defines. */
const WHEN_STOP_SOURCE = ['when "stop" [', '  print "bye"', "]", "wait 5"].join(
  "\n",
);

/**
 * Wraps the real in-process host so a test can read every {@link OL.ExecutionRequest} the controller
 * built and every settlement it received — the only way to prove *what schedule* was delivered and
 * that two identical input sequences produce byte-identical event streams.
 */
function createRecordingHost() {
  const signal = { aborted: false };
  const inner = OL.createInProcessExecutionHost({ signal });
  const requests = [];
  const settlements = [];
  return {
    signal,
    requests,
    settlements,
    host: {
      execute(request, settle) {
        requests.push(request);
        inner.execute(request, (settlement) => {
          settlements.push(settlement);
          settle(settlement);
        });
      },
      cancel() {
        inner.cancel();
      },
    },
  };
}

/** A seed source that pins every chain to one value, so a replay is reproducible by construction. */
function pinnedSeed(seed) {
  return () => seed;
}

test("#952: an on_key handler FIRES through the studio host seam — deliverKey produces the handler's own output", () => {
  const store = OL.createStudioState({ source: ON_KEY_SOURCE });
  const controller = OL.createRunController(store, {
    randomSeedSource: pinnedSeed(7),
  });

  controller.run();
  assert.deepEqual(
    store.getState().output,
    [],
    "the handler must not fire before any key is delivered",
  );
  assert.deepEqual(store.getState().diagnostics, []);

  assert.equal(
    controller.deliverKey("left"),
    true,
    "a key the running program listens for must be reported as delivered",
  );
  assert.deepEqual(
    store.getState().output,
    ["turned"],
    "the on_key handler block must have run",
  );
  assert.equal(store.getState().runStatus, "done");
  assert.deepEqual(store.getState().diagnostics, []);
});

test("#952: each further key press fires the handler again, once per press", () => {
  const store = OL.createStudioState({ source: ON_KEY_SOURCE });
  const controller = OL.createRunController(store, {
    randomSeedSource: pinnedSeed(7),
  });

  controller.run();
  controller.deliverKey("left");
  controller.deliverKey("left");
  controller.deliverKey("left");

  assert.deepEqual(store.getState().output, ["turned", "turned", "turned"]);
});

test("#952: an on_click handler fires for a click and for the accessible activation alike — both are deliverClick", () => {
  const store = OL.createStudioState({ source: ON_CLICK_SOURCE });
  const controller = OL.createRunController(store, {
    randomSeedSource: pinnedSeed(7),
  });

  controller.run();
  assert.deepEqual(store.getState().output, []);

  assert.equal(controller.deliverClick(), true);
  assert.deepEqual(store.getState().output, ["1"]);
  assert.equal(controller.deliverClick(), true);
  assert.deepEqual(
    store.getState().output,
    ["1", "2"],
    "the score must accumulate across deliveries, exactly as a single run would",
  );
});

test("#952: only the key word the program registered fires it — an unlistened key is delivered and simply matches nothing", () => {
  const store = OL.createStudioState({ source: ON_KEY_SOURCE });
  const controller = OL.createRunController(store, {
    randomSeedSource: pinnedSeed(7),
  });

  controller.run();
  controller.deliverKey("right");

  assert.deepEqual(
    store.getState().output,
    [],
    'on_key "left" must not fire for a "right" press',
  );

  controller.deliverKey("left");
  assert.deepEqual(store.getState().output, ["turned"]);
});

test("#952: spec/examples/10-game.logo is playable — its clicks print the running score, and its keys turn and move the turtle", () => {
  const store = OL.createStudioState({ source: TEN_GAME_SOURCE });
  const controller = OL.createRunController(store, {
    randomSeedSource: pinnedSeed(7),
  });

  controller.run();
  assert.deepEqual(
    store.getState().diagnostics,
    [],
    "the flagship interaction example must run clean",
  );
  assert.deepEqual(
    store.getState().output,
    [],
    "no input delivered yet, so nothing has been scored",
  );
  const restingHeading = store.getState().turtleState.heading;

  controller.deliverKey("left");
  assert.notEqual(
    store.getState().turtleState.heading,
    restingHeading,
    'on_key "left" must actually turn the turtle',
  );

  controller.deliverClick();
  controller.deliverClick();
  assert.deepEqual(
    store.getState().output,
    ["1", "2"],
    "10-game.logo:41 — each click prints the updated :score",
  );
});

test("#952: the delivered schedule is tick-based and carries no wall clock — the n-th input takes tick n", () => {
  const store = OL.createStudioState({ source: TEN_GAME_SOURCE });
  const recorder = createRecordingHost();
  const controller = OL.createRunController(store, {
    executionHost: recorder.host,
    randomSeedSource: pinnedSeed(7),
  });

  controller.run();
  controller.deliverKey("left");
  controller.deliverClick();
  controller.deliverKey("up");

  assert.deepEqual(
    recorder.requests.map((request) => request.hostInputEvents),
    [
      [],
      [{ tick: 1, kind: "key", key: "left" }],
      [
        { tick: 1, kind: "key", key: "left" },
        { tick: 2, kind: "click" },
      ],
      [
        { tick: 1, kind: "key", key: "left" },
        { tick: 2, kind: "click" },
        { tick: 3, kind: "key", key: "up" },
      ],
    ],
    "each delivery must extend the schedule by exactly one entry at the next tick",
  );
});

test("#952: a delivery replays the SAME chain — one pinned seed and one captured source across every attempt", () => {
  const store = OL.createStudioState({ source: TEN_GAME_SOURCE });
  const recorder = createRecordingHost();
  const controller = OL.createRunController(store, {
    executionHost: recorder.host,
    randomSeedSource: pinnedSeed(4242),
  });

  controller.run();
  controller.deliverKey("left");
  controller.deliverClick();

  assert.equal(recorder.requests.length, 3);
  for (const request of recorder.requests) {
    assert.equal(request.randomSeed, 4242);
    assert.equal(request.source, TEN_GAME_SOURCE);
  }
});

test("#952: same seed + same input sequence gives a byte-identical event stream", () => {
  function play() {
    const store = OL.createStudioState({ source: TEN_GAME_SOURCE });
    const recorder = createRecordingHost();
    const controller = OL.createRunController(store, {
      executionHost: recorder.host,
      randomSeedSource: pinnedSeed(99),
    });
    controller.run();
    controller.deliverKey("left");
    controller.deliverClick();
    controller.deliverKey("up");
    controller.deliverClick();
    return recorder.settlements.at(-1).events;
  }

  const first = play();
  const second = play();
  assert.equal(
    JSON.stringify(second),
    JSON.stringify(first),
    "the studio maps input onto ticks, never onto the wall clock, so a replay is bit-identical",
  );
});

test('#952: Stop delivers the when "stop" notification before termination', () => {
  const store = OL.createStudioState({ source: WHEN_STOP_SOURCE });
  const controller = OL.createRunController(store, {
    randomSeedSource: pinnedSeed(7),
  });

  controller.run();
  assert.deepEqual(
    store.getState().output,
    [],
    '"stop" is a stop NOTIFICATION — it must not fire on its own',
  );

  controller.stop();
  assert.deepEqual(
    store.getState().output,
    ["bye"],
    'spec/interaction-events.md:152-156 — "stop" notifies the program before termination',
  );
  assert.equal(store.getState().runStatus, "stopped");
});

test('#952: Stop still latches cancellation after delivering "stop" — a run() after it halts with ol-limit', () => {
  const store = OL.createStudioState({ source: WHEN_STOP_SOURCE });
  const controller = OL.createRunController(store, {
    randomSeedSource: pinnedSeed(7),
  });

  controller.run();
  controller.stop();
  controller.run();

  assert.ok(
    store
      .getState()
      .diagnostics.some((diagnostic) => diagnostic.code === "ol-limit"),
    "only reset() re-arms the signal — see run-controller.ts's doc comment (#126)",
  );
});

test("#952: Stop runs no extra execution for a program that registered no `when` handler", () => {
  const store = OL.createStudioState({ source: ON_KEY_SOURCE });
  const recorder = createRecordingHost();
  const controller = OL.createRunController(store, {
    executionHost: recorder.host,
    randomSeedSource: pinnedSeed(7),
  });

  controller.run();
  const afterRun = recorder.requests.length;
  controller.stop();

  assert.equal(
    recorder.requests.length,
    afterRun,
    "a Stop on a program with nothing to notify must be byte-for-byte the Stop it always was",
  );
  assert.equal(store.getState().runStatus, "stopped");
});

test("#952: delivery is refused — with no execution at all — before run(), after stop(), and after reset()", () => {
  const store = OL.createStudioState({ source: ON_KEY_SOURCE });
  const recorder = createRecordingHost();
  const controller = OL.createRunController(store, {
    executionHost: recorder.host,
    randomSeedSource: pinnedSeed(7),
  });

  assert.equal(
    controller.deliverKey("left"),
    false,
    "no chain has been started",
  );
  assert.equal(controller.deliverClick(), false);
  assert.equal(recorder.requests.length, 0);

  controller.run();
  controller.stop();
  assert.equal(controller.deliverKey("left"), false, "Stop closed the window");

  controller.reset();
  assert.equal(controller.deliverKey("left"), false, "Reset closed the window");
});

test("#952: delivery to a program that registered no such handler runs nothing", () => {
  const store = OL.createStudioState({ source: 'print "hello"' });
  const recorder = createRecordingHost();
  const controller = OL.createRunController(store, {
    executionHost: recorder.host,
    randomSeedSource: pinnedSeed(7),
  });

  controller.run();
  const afterRun = recorder.requests.length;

  assert.equal(controller.deliverKey("left"), false);
  assert.equal(controller.deliverClick(), false);
  assert.equal(
    recorder.requests.length,
    afterRun,
    "a non-interactive program must not be re-executed by a stray keystroke",
  );
  assert.deepEqual(store.getState().output, ["hello"]);
});

test("#952: reset() discards the schedule, so the next run starts a genuinely fresh chain", () => {
  const store = OL.createStudioState({ source: ON_CLICK_SOURCE });
  const recorder = createRecordingHost();
  const controller = OL.createRunController(store, {
    executionHost: recorder.host,
    randomSeedSource: pinnedSeed(7),
  });

  controller.run();
  controller.deliverClick();
  assert.deepEqual(store.getState().output, ["1"]);

  controller.reset();
  controller.run();
  assert.deepEqual(store.getState().output, []);
  controller.deliverClick();
  assert.deepEqual(
    store.getState().output,
    ["1"],
    "the score restarts because the new chain carries none of the old chain's input",
  );
  assert.deepEqual(recorder.requests.at(-1).hostInputEvents, [
    { tick: 1, kind: "click" },
  ]);
});

test("#952: a delivery is refused while an input question is outstanding (spec/interaction-events.md:108-111)", () => {
  const store = OL.createStudioState({
    source: [
      'on_key "left" [',
      '  print "turned"',
      "]",
      'when "stop" [',
      '  print "bye"',
      "]",
      ':name = input "who?"',
      "wait 5",
    ].join("\n"),
  });
  const prompts = [];
  let dismissCount = 0;
  const host = {
    present(request) {
      prompts.push(request.prompt);
    },
    dismiss() {
      dismissCount += 1;
    },
  };
  const controller = OL.createRunController(store, {
    inputPrompt: host,
    randomSeedSource: pinnedSeed(7),
  });

  controller.run();
  assert.deepEqual(prompts, ["who?"], "the run is blocked on the question");
  assert.equal(
    controller.deliverKey("left"),
    false,
    "no handler block may run until the read finishes",
  );

  controller.stop();
  assert.equal(dismissCount, 1, "Stop withdraws the question");
  assert.deepEqual(
    store.getState().output,
    [],
    'a read that ended unanswered runs no handler block either — not even "stop"',
  );
  assert.equal(store.getState().runStatus, "stopped");
});

test("#952: a delivered run is the SAME run — it files no extra run-log entry per keystroke", () => {
  const store = OL.createStudioState({ source: ON_KEY_SOURCE });
  const controller = OL.createRunController(store, {
    randomSeedSource: pinnedSeed(7),
  });
  const runLog = OL.createRunLogController(store, { now: () => 0 });

  controller.run();
  assert.equal(runLog.getEntries().length, 1);

  controller.deliverKey("left");
  controller.deliverKey("left");
  controller.deliverKey("left");

  assert.equal(
    runLog.getEntries().length,
    1,
    "three keystrokes must not look like three completed runs",
  );
  assert.deepEqual(runLog.getEntries()[0].output, []);
  assert.deepEqual(store.getState().lastRunResult.output, [
    "turned",
    "turned",
    "turned",
  ]);
});

test("#952: the program's own tick budget bounds delivery — input past its last tick reaches nothing", () => {
  const store = OL.createStudioState({
    source: ['on_key "left" [', '  print "turned"', "]", "wait 2"].join("\n"),
  });
  const controller = OL.createRunController(store, {
    randomSeedSource: pinnedSeed(7),
  });

  controller.run();
  controller.deliverKey("left");
  controller.deliverKey("left");
  controller.deliverKey("left");

  assert.deepEqual(
    store.getState().output,
    ["turned", "turned"],
    "`wait 2` visits ticks 1 and 2, so the third delivery has no tick left to fire on",
  );
});
