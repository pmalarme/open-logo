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

/**
 * A test {@link OL.InputPromptHost}. `onPresent`, when given, runs from **inside** `present()` — the
 * re-entrant shape a synchronously-answering host has, and the one review finding 3 exploited.
 */
function createPromptHost(onPresent) {
  const host = {
    prompts: [],
    dismissCount: 0,
    respond: null,
    present(request, respond) {
      host.prompts.push(request.prompt);
      host.respond = respond;
      onPresent?.(host, respond);
    },
    dismiss() {
      host.dismissCount += 1;
      host.respond = null;
    },
  };
  return host;
}

/**
 * A host shaped like `worker-execution-host.ts`: it **suspends the read in place** (it exposes
 * `resolveRead`) rather than replaying, so the controller records no answers for it. Minimal by
 * design — it settles once with the program's question and once more when that question is
 * resolved, which is all the controller's resolve-in-place path reads.
 */
function createResolveInPlaceHost() {
  let settle = null;
  const host = {
    cancelCount: 0,
    execute(request, nextSettle) {
      settle = nextSettle;
      nextSettle({
        events: [],
        output: [],
        tutorOutput: [],
        diagnostics: [],
        pendingPrompt: "who?",
        retainedAnswers: request.answers,
      });
    },
    cancel() {
      host.cancelCount += 1;
    },
    resolveRead() {
      settle({
        events: [],
        output: [],
        tutorOutput: [],
        diagnostics: [],
        pendingPrompt: null,
        retainedAnswers: [],
      });
    },
  };
  return host;
}

/** A seed source that pins every chain to one value, so a replay is reproducible by construction. */
function pinnedSeed(seed) {
  return () => seed;
}

/**
 * A Worker-shaped host: it settles a turn LATER, the way `worker-execution-host.ts` does, so a
 * delivery can land while an execution is still in flight. Settlements are released by hand
 * (`settleNext`) so a test observes the window rather than racing it.
 */
function createDeferredHost() {
  const signal = { aborted: false };
  const inner = OL.createInProcessExecutionHost({ signal });
  const requests = [];
  const releases = [];
  return {
    requests,
    /** Release the oldest withheld settlement. Callers only call it when one is queued. */
    settleNext() {
      releases.shift()();
    },
    /** Release every withheld settlement, including any the release itself produces. */
    settleAll() {
      let released = 0;
      while (releases.length > 0 && released < 50) {
        released += 1;
        releases.shift()();
      }
      return released;
    },
    host: {
      execute(request, settle) {
        requests.push(request);
        inner.execute(request, (settlement) => {
          releases.push(() => {
            settle(settlement);
          });
        });
      },
      cancel() {
        inner.cancel();
        releases.length = 0;
      },
    },
  };
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

test("#985: the delivered schedule is tick-based and carries no wall clock — each input takes the tick the PROGRAM is at", () => {
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

  const schedules = recorder.requests.map((request) => request.hostInputEvents);
  assert.deepEqual(
    schedules.map((schedule) => schedule.length),
    [0, 1, 2, 3],
    "each delivery extends the schedule by exactly one entry",
  );
  assert.deepEqual(
    schedules.at(-1).map((entry) => entry.kind),
    ["key", "click", "key"],
    "in the order they were delivered",
  );

  // #985 — the tick is the program's, not a counter's. `10-game.logo` ends on a long `wait`, so a
  // delivery made after it has played out lands at the tick it actually reached: the SAME tick for
  // each, rather than 1, 2, 3. What must hold is that the ticks are non-decreasing (the runtime's
  // host-input cursor strands an entry scheduled behind an earlier one) and are a real tick of this
  // program rather than an ordinal.
  const ticks = schedules.at(-1).map((entry) => entry.tick);
  assert.deepEqual(
    ticks,
    [...ticks].sort((left, right) => left - right),
    "ticks must be non-decreasing",
  );
  assert.ok(
    ticks[0] > 3,
    `the tick must come from the program's clock, not from a 1,2,3… counter (got ${JSON.stringify(ticks)})`,
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
  assert.equal(
    recorder.requests.at(-1).hostInputEvents.length,
    1,
    "the new chain's schedule holds exactly the one click made since reset()",
  );
  assert.equal(recorder.requests.at(-1).hostInputEvents[0].kind, "click");
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
  const host = createPromptHost();
  const controller = OL.createRunController(store, {
    inputPrompt: host,
    randomSeedSource: pinnedSeed(7),
  });

  controller.run();
  assert.deepEqual(
    host.prompts,
    ["who?"],
    "the run is blocked on the question",
  );
  assert.equal(
    controller.deliverKey("left"),
    false,
    "no handler block may run until the read finishes",
  );

  controller.stop();
  assert.equal(host.dismissCount, 1, "Stop withdraws the question");
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

test("#985: a program stays responsive for as many presses as the learner makes — the old bound was the counter's, not the program's", () => {
  // Until #985 the n-th press was scheduled at tick n, so `wait 2` accepted exactly TWO presses and
  // went silent: the number of presses a learner could make equalled the program's tick count, which
  // is an artifact of the counter rather than anything the program or the spec says.
  //
  // `spec/interaction-events.md:381-384` names what stops delivery — "Cancellation stops future
  // handler delivery and sound scheduling" — and `:152-156` makes `"stop"` a *requested*
  // notification. Neither names tick exhaustion, so there is no normative exhaustion stop
  // condition to preserve. Scheduling against the real clock, each press lands at the tick the
  // program is actually at, and the run stays interactive until Stop or Reset closes it — exactly
  // what `chainAcceptsHostInput` has always encoded.
  const store = OL.createStudioState({
    source: ['on_key "left" [', '  print "turned"', "]", "wait 2"].join("\n"),
  });
  const controller = OL.createRunController(store, {
    randomSeedSource: pinnedSeed(7),
  });

  controller.run();
  const claimed = [
    controller.deliverKey("left"),
    controller.deliverKey("left"),
    controller.deliverKey("left"),
  ];

  assert.deepEqual(claimed, [true, true, true], "every press runs the handler");
  assert.deepEqual(
    store.getState().output,
    ["turned", "turned", "turned"],
    "and the program's own output agrees with what each press claimed",
  );

  // Stop is what ends responsiveness, and it still does.
  controller.stop();
  assert.equal(controller.deliverKey("left"), false);
});

test("#952 (review finding 2): the recorded schedule does NOT depend on how fast the host settles", () => {
  // Under a host that settles a turn later, a delivery lands while an execution is still in flight.
  // Refusing it there made the same two calls record two entries synchronously and one deferred —
  // a schedule shaped by host timing, and a key dropped where spec/interaction-events.md:91-93
  // requires the most recent key state to be preserved.
  const store = OL.createStudioState({ source: ON_KEY_SOURCE });
  const deferred = createDeferredHost();
  const controller = OL.createRunController(store, {
    executionHost: deferred.host,
    randomSeedSource: pinnedSeed(7),
  });

  controller.run();
  deferred.settleNext();

  // Round 7: under a host that settles later this is `false` for **every** press, because the
  // delivery has not run by the time the answer is needed — so such a host suppresses nothing at
  // all (#975). The earlier expectations here asserted `true` from history: first from the
  // declaration alone, then from an "ever responded" set. Both suppressed presses that ran nothing.
  assert.equal(
    controller.deliverKey("left"),
    false,
    "nothing has run yet under a deferred host, so nothing may be suppressed",
  );
  controller.deliverKey("left");
  deferred.settleAll();

  assert.equal(
    controller.deliverKey("left"),
    false,
    "and still false — a settled *earlier* press is history, not evidence about this one",
  );
  deferred.settleAll();

  assert.equal(
    deferred.requests.at(-1).hostInputEvents.length,
    3,
    "every press must reach the schedule — a press arriving while an execution is unsettled is " +
      "buffered, never dropped (spec/interaction-events.md:91-93 requires the most recent key " +
      "state to be preserved)",
  );
  assert.deepEqual(
    deferred.requests.at(-1).hostInputEvents.map((entry) => entry.key),
    ["left", "left", "left"],
  );
  assert.deepEqual(store.getState().output, ["turned", "turned", "turned"]);

  // Reset must abandon whatever the deferred host still holds, so a withheld settlement cannot
  // repaint the studio after the learner cleared it.
  controller.reset();
  assert.equal(
    deferred.settleAll(),
    0,
    "nothing is left to settle after Reset",
  );
  assert.deepEqual(store.getState().output, []);
  assert.equal(controller.deliverKey("left"), false);
});

test("#952 (review finding 2): a deferred host and a synchronous host record the identical schedule for the identical call sequence", () => {
  function scheduleUnder(hostFactory) {
    const store = OL.createStudioState({ source: ON_KEY_SOURCE });
    const harness = hostFactory();
    const controller = OL.createRunController(store, {
      executionHost: harness.host,
      randomSeedSource: pinnedSeed(7),
    });
    controller.run();
    harness.settleAll?.();
    controller.deliverKey("left");
    controller.deliverKey("up");
    controller.deliverKey("left");
    harness.settleAll?.();
    return harness.requests.at(-1).hostInputEvents;
  }

  assert.deepEqual(
    scheduleUnder(createDeferredHost),
    scheduleUnder(createRecordingHost),
    "settlement pacing must not be observable in the schedule",
  );
});

test("#976: a chain that has asked a question keeps accepting delivered input once the read finishes", () => {
  // #952 refused delivery for the rest of any chain that had asked a question. That was stricter
  // than `spec/interaction-events.md:108-111`, which blocks handlers only "until the read finishes
  // or the program is cancelled" — an "until", not a "forever". The refusal existed because a
  // delivery was scheduled at a synthetic tick that could land BEFORE the read, so the replay
  // reached an earlier point than the learner had observed: a question they never saw, output they
  // had already read erased, a prompt left open over a "done" status.
  //
  // #985's tick timeline removes that cause. A delivery is scheduled at the tick the learner is
  // actually looking at, which is never earlier than a read they have already answered, so the
  // permanent gate is DELETED rather than narrowed and `pendingRead === null` alone enforces
  // `:108-111`. What must be asserted is therefore both halves: the key is delivered, AND the
  // history the learner observed is not rewritten — the failure mode here produces no diagnostic.
  const source = [
    'on_key "left" [',
    '  print "turned"',
    "]",
    ':name = input "who?"',
    "print :name",
    "wait 5",
  ].join("\n");

  const store = OL.createStudioState({ source });
  const host = createPromptHost();
  const controller = OL.createRunController(store, {
    inputPrompt: host,
    randomSeedSource: pinnedSeed(7),
  });

  controller.run();
  assert.deepEqual(host.prompts, ["who?"]);
  assert.equal(
    controller.deliverKey("left"),
    false,
    "spec/interaction-events.md:108-111 — no handler block WHILE the read is outstanding",
  );

  host.respond("Ada");
  assert.deepEqual(store.getState().output, ["Ada"], "the answer was consumed");

  assert.equal(
    controller.deliverKey("left"),
    true,
    "the read has finished, so :108-111 permits handlers again",
  );
  assert.deepEqual(
    store.getState().output,
    ["Ada", "turned"],
    "the handler ran, and the output the learner had already read is EXTENDED, never rewritten",
  );
  assert.deepEqual(
    host.prompts,
    ["who?"],
    "and no question is re-asked — the replay reaches no earlier point than the learner observed",
  );
  assert.deepEqual(
    store.getState().diagnostics,
    [],
    "history rewriting produces no diagnostic, so the assertions above are the only witness",
  );

  // A chain that never asks anything is unaffected, even with a prompt host installed.
  const plainStore = OL.createStudioState({ source: ON_KEY_SOURCE });
  const plainController = OL.createRunController(plainStore, {
    inputPrompt: createPromptHost(),
    randomSeedSource: pinnedSeed(7),
  });
  plainController.run();
  assert.equal(plainController.deliverKey("left"), true);
  assert.deepEqual(plainStore.getState().output, ["turned"]);

  // Reset still ends the chain: it is Stop/Reset that close delivery, not having asked a question.
  const resetStore = OL.createStudioState({ source });
  const resetHost = createPromptHost();
  const resetController = OL.createRunController(resetStore, {
    inputPrompt: resetHost,
    randomSeedSource: pinnedSeed(7),
  });
  resetController.run();
  resetHost.respond("Ada");
  resetController.reset();
  assert.equal(
    resetController.deliverKey("left"),
    false,
    "Reset leaves no chain to deliver to",
  );

  // The other host shape: one that suspends the read IN PLACE rather than replaying (the Worker
  // shape). #952's gate applied to every host, so this one refused delivery too; #976 removes the
  // gate itself, so the rule is the same here — refuse WHILE the read is outstanding, accept once it
  // resolves. Asserted separately because "under every host" was the original claim, and a fix that
  // only reopened the replay host would leave the Worker deployment silently stricter.
  const inPlaceStore = OL.createStudioState({ source });
  const inPlaceHost = createPromptHost();
  const executionHost = createResolveInPlaceHost();
  const inPlaceController = OL.createRunController(inPlaceStore, {
    inputPrompt: inPlaceHost,
    executionHost,
    randomSeedSource: pinnedSeed(7),
  });

  inPlaceController.run();
  assert.deepEqual(inPlaceHost.prompts, ["who?"]);
  assert.equal(
    inPlaceController.deliverKey("left"),
    false,
    "a read is outstanding, so :108-111 forbids the handler block",
  );

  inPlaceHost.respond("Ada");
  assert.equal(
    inPlaceController.acceptsClick(),
    false,
    "this minimal host settles with no events, so it registered no on_click to accept",
  );

  inPlaceController.reset();
  assert.equal(
    executionHost.cancelCount,
    1,
    "Reset abandons the suspended run",
  );
  assert.equal(
    inPlaceController.deliverKey("left"),
    false,
    "and Reset leaves no chain to deliver to",
  );
});

test("#952 (review round 3): an on_key the run never REACHED does not make its key the program's to handle", () => {
  // The declaration alone over-reports: `if false [ on_key "up" … ] ]` names `up` and registers
  // nothing, and suppressing ArrowUp for it would swallow a key from a learner for a handler that
  // could never run. Pairing the declaration with the run's own registration event, by source
  // position, is what makes this exact.
  const store = OL.createStudioState({
    source: [
      'on_key "down" [',
      '  print "d"',
      "]",
      "if false [",
      '  on_key "up" [',
      '    print "u"',
      "  ]",
      "]",
      "wait 3",
    ].join("\n"),
  });
  const controller = OL.createRunController(store, {
    randomSeedSource: pinnedSeed(7),
  });

  controller.run();

  assert.equal(
    controller.deliverKey("up"),
    false,
    "declared but never registered — the key is not the program's to handle",
  );
  assert.deepEqual(store.getState().output, [], "and nothing fired");

  assert.equal(
    controller.deliverKey("down"),
    true,
    "this one really registered",
  );
  assert.deepEqual(store.getState().output, ["d"]);
});

test('#952 (review round 3): a `when "stop"` handler that asks a question leaves no live prompt over a stopped run', () => {
  // Measured on the pre-fix tree: `when "stop" [ :answer = input "save?" ]` left "save?" answerable
  // after Stop had committed `"stopped"`, and answering it then produced `ol-limit`.
  const store = OL.createStudioState({
    source: ['when "stop" [', '  :answer = input "save?"', "]", "wait 5"].join(
      "\n",
    ),
  });
  const host = createPromptHost();
  const controller = OL.createRunController(store, {
    inputPrompt: host,
    randomSeedSource: pinnedSeed(7),
  });

  controller.run();
  assert.deepEqual(host.prompts, [], "nothing is asked while the program runs");

  controller.stop();

  assert.equal(store.getState().runStatus, "stopped");
  // Round 6: the read is withdrawn in the settlement continuation, keyed to the notification
  // attempt, so it is taken down BEFORE `settleAttempt` can present it. The earlier expectation
  // (`prompts === ["save?"]`, one dismissal) encoded a present-then-instantly-dismiss flicker the
  // learner could see; not showing it at all is strictly better.
  assert.deepEqual(
    host.prompts,
    [],
    "a question belonging to a terminating run is never put to the learner",
  );
  assert.equal(host.respond, null, "and no responder is left live");
  assert.equal(
    host.dismissCount,
    0,
    "nothing was shown, so nothing was dismissed",
  );
});

test("#952 (review finding 3): a prompt host that answers synchronously cannot extend the pump with delivered input", () => {
  // Measured by review on the pre-fix tree: a host calling deliverKey() straight after respond()
  // was accepted, and each accepted delivery handed the chain one more read — the quadratic hang
  // #881's doc comment describes, reintroduced through the input schedule. The instruction budget
  // below bounds a regression to a fast failure instead of a hang; it is not what makes the test
  // pass.
  const store = OL.createStudioState({
    source: [
      'on_key "left" [',
      '  :answer = input "again?"',
      "  print :answer",
      "]",
      ':name = input "who?"',
      "wait 5",
    ].join("\n"),
  });
  let controller = null;
  const deliveriesAccepted = [];
  const host = createPromptHost((_host, respond) => {
    respond("x");
    deliveriesAccepted.push(controller.deliverKey("left"));
  });
  controller = OL.createRunController(store, {
    inputPrompt: host,
    instructionBudget: 500,
    randomSeedSource: pinnedSeed(7),
  });

  controller.run();

  assert.deepEqual(
    deliveriesAccepted,
    [false],
    "every delivery from inside the answer chain must be refused",
  );
  assert.deepEqual(
    host.prompts,
    ["who?"],
    "so the chain asks exactly the question the program contains, and terminates",
  );
});

test('#952 (QA finding 1): a `when "stop"` program whose clock never ticks receives nothing — only `wait` advances the tick clock', () => {
  // The notification is scheduled at a tick, and `spec/interaction-events.md`'s tick clock only
  // advances while a `wait` pause elapses. A program that never waits therefore never reaches the
  // tick the notification sits on, so Stop pays for one replay that delivers nothing. Bounded by
  // the instruction budget, and the whole point of pinning it here is that the prose above must not
  // claim `"stop"` is delivered unconditionally.
  const store = OL.createStudioState({
    source: [
      'when "stop" [',
      '  print "bye"',
      "]",
      "repeat 20 [ forward 1 ]",
    ].join("\n"),
  });
  const controller = OL.createRunController(store, {
    randomSeedSource: pinnedSeed(7),
  });

  controller.run();
  controller.stop();

  assert.deepEqual(
    store.getState().output,
    [],
    "no `wait`, so the clock stays at tick 0 and the notification never becomes due",
  );
  assert.equal(store.getState().runStatus, "stopped");
});

test("#985: the boolean answers whether THIS press ran a handler — false for a key nothing names, and when the clock never ticks", () => {
  const store = OL.createStudioState({
    source: ['on_key "left" [', '  print "turned"', "]", "wait 1"].join("\n"),
  });
  const recorder = createRecordingHost();
  const controller = OL.createRunController(store, {
    executionHost: recorder.host,
    randomSeedSource: pinnedSeed(7),
  });

  controller.run();
  const afterRun = recorder.requests.length;

  assert.equal(
    controller.deliverKey("left"),
    true,
    "tick 1 exists and the handler names this key, so this press genuinely fires",
  );
  assert.deepEqual(store.getState().output, ["turned"]);

  assert.equal(
    controller.deliverKey("right"),
    false,
    "no handler names this key, so it must keep its ordinary browser behavior",
  );

  // #985 — a repeat press is now scheduled at the tick the program is at rather than at tick n, so
  // it fires like the first. The old expectation here (`false`, because `wait 1` "never reaches
  // tick 2") was pinning the synthetic counter's exhaustion artifact; `:381-384` names cancellation
  // as what stops delivery, and nothing names tick exhaustion.
  assert.equal(
    controller.deliverKey("left"),
    true,
    "a further press lands at a tick the program does reach, so it runs the handler",
  );
  assert.deepEqual(store.getState().output, ["turned", "turned"]);

  assert.equal(
    recorder.requests.length,
    afterRun + 3,
    "each accepted delivery still costs one execution — the documented N+1 replay cost",
  );

  // A program whose clock never advances still runs no handler, and the boolean says so — the
  // direction that must NOT regress, since it is what keeps a key the program cannot use from being
  // silently swallowed. Note `wait 0` is NOT such a program: it yields at tick 0 without advancing
  // (spec/interaction-events.md's `wait <n>`), and that yield drains tick-0 input, so a delivery
  // there does fire. Only a program with no `wait` at all never reaches a dispatch checkpoint.
  const noTickStore = OL.createStudioState({
    source: ['on_key "left" [', '  print "turned"', "]"].join("\n"),
  });
  const noTickController = OL.createRunController(noTickStore, {
    randomSeedSource: pinnedSeed(7),
  });
  noTickController.run();
  assert.equal(
    noTickController.deliverKey("left"),
    false,
    "the clock never reaches a checkpoint, so this press ran nothing and must not be suppressed",
  );
  assert.deepEqual(noTickStore.getState().output, []);
});

test("#952 (review finding 2): a handler that RAISES still counts as this press having run one", () => {
  // The unsound proxy this replaced: a handler that raises SHORTENS the event stream, so measuring
  // growth reported "nothing responded" for a handler that genuinely ran. Measured by review at
  // 45 events down to 5 with ol-undefined-var.
  const store = OL.createStudioState({
    source: [
      'on_key "up" [',
      "  forward :never_set",
      "]",
      "wait 3",
      'print "one"',
      'print "two"',
    ].join("\n"),
  });
  const controller = OL.createRunController(store, {
    randomSeedSource: pinnedSeed(7),
  });

  controller.run();
  const before = store.getState().output.length;

  assert.equal(
    controller.deliverKey("up"),
    true,
    "the handler ran — that it raised must not turn into 'nothing responded'",
  );
  assert.ok(
    store
      .getState()
      .diagnostics.some((diagnostic) => diagnostic.code === "ol-undefined-var"),
    "the handler's own failure is surfaced",
  );
  assert.ok(
    store.getState().output.length < before,
    "…and it truncated the run, which is exactly why stream growth was an unsound proxy",
  );
});

test("#952: a non-literal on_key key word still DELIVERS, it just never suppresses — the safe direction", () => {
  // `collectDeclaredKeyWords` reports `null` when a key word is not a literal, because the set is
  // unknowable before the run. The press is still scheduled and the handler still fires; only the
  // browser-default suppression is withheld, so a key is never silently swallowed on a guess.
  const store = OL.createStudioState({
    source: [
      ':chosen = "left"',
      "on_key :chosen [",
      '  print "turned"',
      "]",
      "wait 5",
    ].join("\n"),
  });
  const controller = OL.createRunController(store, {
    randomSeedSource: pinnedSeed(7),
  });

  controller.run();
  assert.deepEqual(store.getState().diagnostics, []);

  assert.equal(
    controller.deliverKey("left"),
    false,
    "nothing is claimed about a key word that cannot be read from the source",
  );
  assert.deepEqual(
    store.getState().output,
    ["turned"],
    "…but the delivery genuinely happened and the handler ran",
  );
});

test('#952 (review round 4): the `when "stop"` read is withdrawn under a host that settles LATER too', () => {
  // Withdrawing right after `beginAttempt` returns only works for a host that settles synchronously.
  // Under a deferred host that read has not been created by the time `stop()` returns, so nothing
  // was withdrawn, and review measured "save?" arriving live, with a working responder, over an
  // already-`"stopped"` run.
  const store = OL.createStudioState({
    source: ['when "stop" [', '  :answer = input "save?"', "]", "wait 5"].join(
      "\n",
    ),
  });
  const host = createPromptHost();
  const deferred = createDeferredHost();
  const controller = OL.createRunController(store, {
    inputPrompt: host,
    executionHost: deferred.host,
    randomSeedSource: pinnedSeed(7),
  });

  controller.run();
  deferred.settleNext();
  assert.deepEqual(host.prompts, []);

  controller.stop();
  assert.equal(store.getState().runStatus, "stopped");
  deferred.settleAll();

  assert.deepEqual(
    host.prompts,
    [],
    "the notification's read is withdrawn in its own settlement, before it can be shown",
  );
  assert.equal(
    host.respond,
    null,
    "…so nothing is left answerable over an already-stopped run",
  );
  assert.equal(host.dismissCount, 0);
  assert.equal(store.getState().runStatus, "stopped");
});

test("#976: the activation control stays available after a question is answered, because delivery does too", () => {
  // #952's `acceptsClick()` excluded a chain that had asked a question, because delivery closed for
  // that chain permanently and a visible control would have been an inert tab stop. #976 removes the
  // permanent closure, so the control must stay — a program that asks a question and then expects
  // clicks is exactly the case the issue is about, and hiding its control would be the same defect
  // pointing the other way.
  const store = OL.createStudioState({
    source: [
      "on_click [",
      '  print "clicked"',
      "]",
      ':name = input "who?"',
      "wait 5",
    ].join("\n"),
  });
  const host = createPromptHost();
  const controller = OL.createRunController(store, {
    inputPrompt: host,
    randomSeedSource: pinnedSeed(7),
  });

  controller.run();
  assert.deepEqual(host.prompts, ["who?"]);
  assert.equal(
    controller.acceptsClick(),
    true,
    "the control stays put while the question is open — the blocker is transient, and a tab stop " +
      "must not flicker in and out under the learner",
  );

  host.respond("Ada");
  assert.equal(
    controller.deliverClick(),
    true,
    "the read has finished, so a click reaches the handler again",
  );
  assert.deepEqual(store.getState().output, ["clicked"]);
  assert.equal(
    controller.acceptsClick(),
    true,
    "…and the control it is reached through stays in the tab order",
  );

  // Stop is what makes the control inert, and it still hides it.
  controller.stop();
  assert.equal(controller.acceptsClick(), false);
});

test("#952 (QA round 5 finding 1): a Stop whose notification never settles does not withdraw a LATER chain's question", () => {
  // Regression introduced by round 5's fix and caught by the gate. `stopNotificationOutstanding`
  // was a bare boolean set by `stop()` and cleared by whichever attempt settled next — so a Stop
  // whose notification never settled left it armed, and the *next* chain's first question was
  // presented and instantly withdrawn. Under the blocking Worker host that parked the interpreter
  // in `Atomics.wait` for an answer that could never be given: a hung studio, no question on
  // screen, no diagnostic. It is now keyed to the notification attempt's own id.
  const store = OL.createStudioState({
    source: ['when "stop" [', '  print "bye"', "]", "wait 5"].join("\n"),
  });
  const host = createPromptHost();
  const deferred = createDeferredHost();
  const controller = OL.createRunController(store, {
    inputPrompt: host,
    executionHost: deferred.host,
    randomSeedSource: pinnedSeed(7),
  });

  controller.run();
  deferred.settleNext();
  controller.stop();
  // The notification attempt is abandoned rather than settled — exactly the case that armed the
  // flag with nothing to clear it.
  controller.reset();

  store.setSource(':name = input "who are you?"');
  controller.run();
  deferred.settleAll();

  assert.deepEqual(
    host.prompts,
    ["who are you?"],
    "the new chain's own question is asked",
  );
  assert.equal(
    host.dismissCount,
    0,
    "…and is NOT withdrawn by a stale flag from the previous chain",
  );
  assert.notEqual(
    host.respond,
    null,
    "the learner can still answer it — anything else hangs a Worker host",
  );
});

test("#952 (review round 6): the invocation count survives every aliasing case", () => {
  // The third mechanism for one question; the first two were unsound on monotonicity and on timing.
  // These are the aliasing cases — "one position, one meaning" is what the subtraction rests on.
  const seed = { randomSeedSource: pinnedSeed(7) };

  // 1. Re-registration at ONE position. `interaction-events.md` forbids collapsing duplicate
  //    registrations, so one press fires BOTH — the count says 2 and the program prints twice, an
  //    independent witness agreeing with the arithmetic.
  const repeated = OL.createStudioState({
    source: ['repeat 2 [ on_key "up" [ print "hit" ] ]', "wait 3"].join("\n"),
  });
  const repeatedController = OL.createRunController(repeated, seed);
  repeatedController.run();
  assert.deepEqual(repeated.getState().output, []);
  assert.equal(repeatedController.deliverKey("up"), true);
  assert.deepEqual(
    repeated.getState().output,
    ["hit", "hit"],
    "two registrations at one position, one press, two firings",
  );

  // 2. Nesting: the inner handler is registered at INVOCATION time, while the outer position's
  //    arithmetic must stay correct. Under the synchronous replay host the inner handler cannot be
  //    *reached* — see the `#985` limitation test below for the measurement and the mechanism — so
  //    what this case pins is the COUNT, which is what the aliasing check is about: the outer press
  //    is credited exactly once, and the inner registration does not disturb the outer position's
  //    `instructions − registrations` arithmetic.
  const nested = OL.createStudioState({
    source: [
      'on_key "up" [',
      '  on_key "down" [ print "inner" ]',
      "]",
      "wait 4",
    ].join("\n"),
  });
  const nestedController = OL.createRunController(nested, seed);
  nestedController.run();
  assert.equal(nestedController.deliverKey("up"), true, "the outer fired");
  assert.equal(
    nestedController.deliverKey("up"),
    true,
    "and is credited again for a second press, so the inner registration it performs each time " +
      "does not corrupt the outer position's arithmetic",
  );

  // 3. A handler that raises on its FIRST instruction. The load-bearing assumption is that the
  //    block-head marker is emitted before the handler can fail — measured, not reasoned.
  const raising = OL.createStudioState({
    source: ['on_key "up" [', "  forward :never_set", "]", "wait 3"].join("\n"),
  });
  const raisingController = OL.createRunController(raising, seed);
  raisingController.run();
  assert.equal(
    raisingController.deliverKey("up"),
    true,
    "the handler ran; that it raised must not read as 'nothing responded'",
  );
  assert.ok(
    raising.getState().diagnostics.some((d) => d.code === "ol-undefined-var"),
  );

  // 4. Invoked twice before the query — it is a count, read as a strict increase, never as a
  //    boolean over the whole run.
  const twice = OL.createStudioState({
    source: ['on_key "up" [ print "hit" ]', "wait 4"].join("\n"),
  });
  const twiceController = OL.createRunController(twice, seed);
  twiceController.run();
  assert.equal(twiceController.deliverKey("up"), true);
  assert.equal(twiceController.deliverKey("up"), true);
  assert.deepEqual(twice.getState().output, ["hit", "hit"]);
});

test("#985: a press after a delayed registration is DELIVERED — the F3 defect this slice fixes", () => {
  // #952 pinned the pre-fix behaviour here: with `wait 1` first, the press was scheduled at tick 1,
  // before the handler existed, so it ran nothing. That was correct to *report* (`false`, no
  // suppression) but the delivery itself was the defect — measured across leads 0/1/2/3/5, the
  // presses lost equalled the lead's tick count exactly. Scheduling against the program's own clock
  // (#985) means the press lands at a tick the handler is registered for.
  const store = OL.createStudioState({
    source: ["wait 1", 'on_key "up" [', '  print "hit"', "]", "wait 2"].join(
      "\n",
    ),
  });
  const controller = OL.createRunController(store, {
    randomSeedSource: pinnedSeed(7),
  });

  controller.run();

  assert.equal(
    controller.deliverKey("up"),
    true,
    "the FIRST press after a delayed registration must now fire",
  );
  assert.deepEqual(store.getState().output, ["hit"]);

  assert.equal(controller.deliverKey("up"), true, "and so must the next");
  assert.deepEqual(store.getState().output, ["hit", "hit"]);
});

test("#985: a press that runs nothing is still never suppressed — the direction that must not regress", () => {
  // The mirror of the test above, kept because the whole gate exists to prevent `preventDefault`
  // without delivery. A key no handler names runs nothing and must report `false`, so the browser
  // default stands.
  const store = OL.createStudioState({
    source: ["wait 1", 'on_key "up" [', '  print "hit"', "]", "wait 2"].join(
      "\n",
    ),
  });
  const controller = OL.createRunController(store, {
    randomSeedSource: pinnedSeed(7),
  });

  controller.run();
  assert.equal(
    controller.deliverKey("down"),
    false,
    "no handler names this key, so nothing ran and nothing may be suppressed",
  );
  assert.deepEqual(store.getState().output, []);
});

test("#952 (review round 7): a delivery that arrives re-entrantly is not credited to the press that was already in flight", () => {
  // Measured on the pre-fix tree: with `wait 1 / on_key "up" / wait 2`, a state subscriber
  // delivering tick 2 during tick 1's settlement made the OUTER tick-1 press report `true` and
  // suppress the key, while only the nested tick-2 press actually printed. An unbounded drain
  // consumed the re-entrant addition, so `after` counted a later press's invocation.
  //
  // #985 changes what the outer press does — it now genuinely fires — so the attribution question
  // is asked the other way round: each press must be credited with exactly ONE invocation, never
  // with the re-entrant one as well. Two presses, two prints, and the outer claims only its own.
  const store = OL.createStudioState({
    source: ["wait 1", 'on_key "up" [', '  print "hit"', "]", "wait 3"].join(
      "\n",
    ),
  });
  const controller = OL.createRunController(store, {
    randomSeedSource: pinnedSeed(7),
  });

  controller.run();

  let reentered = false;
  const unsubscribe = store.subscribe(() => {
    if (reentered) {
      return;
    }
    reentered = true;
    controller.deliverKey("up");
  });

  const outer = controller.deliverKey("up");
  unsubscribe();

  assert.equal(
    outer,
    true,
    "the outer press ran a handler of its own, so it reports true",
  );
  assert.deepEqual(
    store.getState().output,
    ["hit", "hit"],
    "both presses were delivered — neither is stranded, and neither is double-counted",
  );
});

test("#952 (review round 8): a re-entrant press is flushed on the non-literal path too", () => {
  // The `declared === null` early return sat before the remainder flush, so a press arriving
  // re-entrantly was stranded until some unrelated later delivery happened to drain it. Measured on
  // the pre-fix tree: two presses produced one invocation, and a third flushed both pending ticks.
  const store = OL.createStudioState({
    source: [
      ':chosen = "left"',
      "on_key :chosen [",
      '  print "turned"',
      "]",
      "wait 5",
    ].join("\n"),
  });
  const controller = OL.createRunController(store, {
    randomSeedSource: pinnedSeed(7),
  });

  controller.run();

  let reentered = false;
  const unsubscribe = store.subscribe(() => {
    if (reentered) {
      return;
    }
    reentered = true;
    controller.deliverKey("left");
  });

  assert.equal(
    controller.deliverKey("left"),
    false,
    "a non-literal key word claims nothing and suppresses nothing",
  );
  unsubscribe();

  assert.deepEqual(
    store.getState().output,
    ["turned", "turned"],
    "both presses are delivered — neither is stranded waiting for an unrelated one",
  );
});

test("#952: a delivery is refused for a program whose on_key was never reached", () => {
  const store = OL.createStudioState({
    source: [
      "if false [",
      '  on_key "left" [',
      '    print "turned"',
      "  ]",
      "]",
      "wait 5",
    ].join("\n"),
  });
  const recorder = createRecordingHost();
  const controller = OL.createRunController(store, {
    executionHost: recorder.host,
    randomSeedSource: pinnedSeed(7),
  });

  controller.run();
  const afterRun = recorder.requests.length;

  assert.equal(controller.deliverKey("left"), false);
  assert.equal(recorder.requests.length, afterRun);
});

/**
 * A click-registering program with an observable per-click witness: every invocation prints, so the
 * program's own output is an independent answer to "did this click run a handler" that owes nothing
 * to the invocation counting `deliverClick` uses.
 */
function clickProgram(leadWaitTicks, tailWaitTicks) {
  return [
    ...(leadWaitTicks > 0 ? [`wait ${leadWaitTicks}`] : []),
    ":score = 0",
    "on_click [",
    "  :score = :score + 1",
    "  print :score",
    "]",
    `wait ${tailWaitTicks}`,
  ].join("\n");
}

/**
 * Deliver `clicks` activations to `source`, reporting for each one what `deliverClick` claimed and
 * what the program's own output did — the two series a caller can then compare.
 */
function playClicks(source, clicks) {
  const store = OL.createStudioState({ source });
  const controller = OL.createRunController(store, {
    randomSeedSource: pinnedSeed(7),
  });
  controller.run();
  const claimed = [];
  const printed = [];
  for (let index = 0; index < clicks; index += 1) {
    const before = store.getState().output.length;
    claimed.push(controller.deliverClick());
    printed.push(store.getState().output.length > before);
  }
  return { claimed, printed, state: store.getState() };
}

test("#985: a click reports what it did, and a delayed registration no longer costs the first click", () => {
  // Two defects met on this one program. `deliverClick` used to return `true` as soon as its gate
  // passed, so the first click on `wait 1 / on_click [ … ] / wait 2` claimed `true` having run
  // nothing; and the click itself was scheduled at tick 1, before the handler existed, so it ran
  // nothing to claim. The count fixes the claim, and the tick timeline fixes the delivery — so both
  // the boolean and the program's output now say the same thing about the same click.
  const { claimed, printed, state } = playClicks(clickProgram(1, 2), 2);

  assert.deepEqual(
    claimed,
    [true, true],
    "the first click after a delayed registration must fire, not merely claim to",
  );
  assert.deepEqual(claimed, printed, "and the claim must match what ran");
  assert.deepEqual(state.output, ["1", "2"], "both clicks scored");
});

test("#985: deliverClick agrees with the program's own output on every delivery, across every click shape", () => {
  // Agreement rather than a hand-written expected matrix: a program shape nobody anticipated fails
  // the comparison instead of quietly matching a table that was only ever as complete as its author.
  const shapes = [
    ["registered before any wait", clickProgram(0, 5), 4],
    ["registered after a 1-tick lead", clickProgram(1, 2), 4],
    ["registered after a 3-tick lead", clickProgram(3, 6), 5],
    ["clicked past the program's final tick", clickProgram(0, 2), 4],
    [
      "two handlers at two positions",
      ['on_click [ print "a" ]', 'on_click [ print "b" ]', "wait 5"].join("\n"),
      3,
    ],
    [
      "one position registered twice",
      ["repeat 2 [", '  on_click [ print "c" ]', "]", "wait 5"].join("\n"),
      3,
    ],
  ];

  for (const [label, source, clicks] of shapes) {
    const { claimed, printed } = playClicks(source, clicks);
    assert.deepEqual(
      claimed,
      printed,
      `${label}: deliverClick must report exactly the deliveries that ran a handler`,
    );
  }
});

test("#985: a click that runs no handler still reports false — the mirror direction is preserved", () => {
  // The fix must not merely stop over-claiming; reporting `true` for a click that ran nothing would
  // be the same defect pointing the other way. A program that never reaches a dispatch checkpoint
  // (no `wait` at all) runs no handler for any click.
  const store = OL.createStudioState({
    source: ["on_click [", '  print "clicked"', "]"].join("\n"),
  });
  const controller = OL.createRunController(store, {
    randomSeedSource: pinnedSeed(7),
  });

  controller.run();
  assert.equal(
    controller.deliverClick(),
    false,
    "the clock never reaches a checkpoint, so no handler ran and none may be claimed",
  );
  assert.deepEqual(store.getState().output, []);
});

test("#985 (known limitation): under the synchronous replay host a handler registered BY a handler cannot be reached", () => {
  // Scheduling against the program's clock means a delivery lands at the tick the learner is looking
  // at. Under the default IMMEDIATE_SCHEDULER the animation is fully drawn the moment a replay
  // settles, so that is always the program's FINAL tick — every delivery lands on the same tick.
  // The runtime claims pending keys against the handlers that exist when a tick's dispatch begins,
  // so a handler created DURING that dispatch is not in the list.
  //
  // Measured across `wait 2`, `wait 4` and `wait 20`: outer `true`, inner `false`, both scheduled at
  // the final tick. It fails in the VISIBLE direction — the inner handler simply does not fire;
  // nothing is swallowed and no press is lost — and a PACED host does not exhibit it, because its
  // drawn tick genuinely advances between presses. `spec/interaction-events.md:79` is why there is
  // no later tick to use: "a handler does not extend the run's lifetime".
  //
  // The language-level contract is unaffected, which the conformance corpus proves independently:
  // `interaction-events/on_key/on-key-registering-every-stays-clean` schedules its press at an
  // explicit `{tick: 1}` and the nested `every` fires 3 times over the remaining 39 ticks. This is
  // a limitation of the replay host choosing the tick, not of the runtime's dispatch. See #977.
  const store = OL.createStudioState({
    source: [
      'on_key "up" [',
      '  on_key "down" [ print "inner" ]',
      "]",
      "wait 4",
    ].join("\n"),
  });
  const controller = OL.createRunController(store, {
    randomSeedSource: pinnedSeed(7),
  });

  controller.run();
  assert.equal(
    controller.deliverKey("up"),
    true,
    "the outer handler fires and registers the inner one",
  );
  assert.equal(
    controller.deliverKey("down"),
    false,
    "…but the inner cannot be reached, and reports so rather than claiming a firing",
  );
  assert.deepEqual(
    store.getState().output,
    [],
    "nothing is suppressed and nothing is silently dropped — the inner simply never runs",
  );
});

test("#985: a handler that raises still reports true — the block-head marker precedes the failure", () => {
  // This is the axis that broke the event-stream-length formulation: a raising handler SHORTENS the
  // stream, so a length proxy reports "nothing responded" for a handler that ran. Counting the
  // block-head marker `spec/interaction-events.md:102-103` mandates is monotonic on the error path.
  const store = OL.createStudioState({
    source: ["on_click [", "  print :nope", "]", "wait 5"].join("\n"),
  });
  const controller = OL.createRunController(store, {
    randomSeedSource: pinnedSeed(7),
  });

  controller.run();
  assert.equal(
    controller.deliverClick(),
    true,
    "the handler ran, even though it failed part-way through",
  );
  assert.deepEqual(store.getState().output, [], "so it printed nothing");
  assert.deepEqual(
    store.getState().diagnostics.map((diagnostic) => diagnostic.code),
    ["ol-undefined-var"],
    "and the failure it raised is what the learner sees",
  );
});

test("#985: one click fires every registration at a position, and the count agrees with the prints", () => {
  // `spec/interaction-events.md` forbids collapsing duplicate registrations, so `repeat 2` really is
  // two handlers. The print witness is independent of the arithmetic and must agree with it.
  const { claimed, state } = playClicks(
    ["repeat 2 [", '  on_click [ print "c" ]', "]", "wait 5"].join("\n"),
    3,
  );

  assert.deepEqual(claimed, [true, true, true]);
  assert.equal(
    state.output.length,
    6,
    "three clicks × two registrations at one position",
  );
});
