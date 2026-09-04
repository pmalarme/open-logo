// The main-thread half of the blocking execution host (#876): the `ExecutionHost` that runs every
// program in a Worker and answers its `input` reads through shared memory.
//
// The port, the buffer allocator and `Atomics.notify` are all injected (this package's rule that
// browser globals are supplied by `web/main.ts`, never referenced in `src/`), so these tests drive
// the whole protocol with plain objects — including, at the end, a port that runs the real
// Worker-side runner, which exercises both halves against each other with no threads involved.

import assert from "node:assert/strict";
import { test } from "node:test";
import * as OL from "@openlogo/studio";

/** A port that records commands and lets a test push reports back. */
function makeFakePort() {
  const commands = [];
  let listener = null;
  return {
    commands,
    report(message) {
      listener?.(message);
    },
    port: {
      postMessage(command) {
        commands.push(command);
      },
      onReport(next) {
        listener = next;
      },
    },
  };
}

function makeHost(overrides = {}) {
  // Each test starts from a clean recorder: the shared one below exists so a settle callback is
  // never merely handed over and left uncalled, not so state leaks between cases.
  recordedSettlements.length = 0;
  parkIntervals.length = 0;
  const fake = makeFakePort();
  const notified = [];
  const host = OL.createWorkerExecutionHost({
    port: fake.port,
    allocateBuffer: (byteLength) => new ArrayBuffer(byteLength),
    notify: (_control, index) => {
      notified.push(index);
      return 1;
    },
    ...overrides,
  });
  return { fake, host, notified };
}

function makeRequest(overrides = {}) {
  return {
    source: ':a = input "who?"',
    document: "worker.logo",
    randomSeed: 3,
    cancellationRequested: false,
    acceptsReads: true,
    answers: [],
    ...overrides,
  };
}

/**
 * Every settlement any host below produces, in order. One shared recorder rather than a fresh
 * closure per test: a callback that is only *handed over* and never invoked proves nothing, and
 * would sit uncovered in a suite whose whole point is that nothing goes unmeasured.
 */
const recordedSettlements = [];

function recordSettlement(settlement) {
  recordedSettlements.push(settlement);
}

/** Drain what the recorder has seen since the last drain. */
function takeSettlements() {
  return recordedSettlements.splice(0, recordedSettlements.length);
}

/**
 * Stands in for `Atomics.wait`; a call means the interpreter genuinely parked. Most call sites
 * below have already delivered an answer before it is reached, which is why `parkIntervals` is
 * usually empty — the one test that leaves the read open is what proves it is really used.
 */
const parkIntervals = [];

function recordPark(_control, _index, _expected, timeoutMs) {
  parkIntervals.push(timeoutMs);
  return "ok";
}

/** Read back whatever the main thread wrote into the command's shared buffer. */
function readDelivered(command) {
  return OL.awaitBlockingRead(
    OL.createBlockingInputChannel(command.buffer),
    recordPark,
    1,
  );
}

const READ_REPORT = {
  type: "read",
  runId: 1,
  prompt: "who?",
  events: [],
  output: ["before"],
  tutorOutput: [],
  // #985's field, on the shared fixture so every test that spreads it produces a valid report.
  // `retainedAnswers` is deliberately NOT here: the read-report test below relies on its absence to
  // exercise the host's `reportedAnswers ?? active.answers` fallback, and the two tests that care
  // about adoption supply it explicitly.
  tickTimeline: [],
};

test("execute posts one run command carrying the request and a shared buffer", () => {
  const { fake, host } = makeHost();
  const request = makeRequest();

  host.execute(request, recordSettlement);

  assert.equal(fake.commands.length, 1);
  assert.equal(fake.commands[0].type, "run");
  assert.equal(fake.commands[0].request, request);
  assert.equal(
    fake.commands[0].buffer.byteLength,
    OL.blockingInputBufferByteLength(),
  );
  assert.deepEqual(takeSettlements(), [], "nothing has settled yet");
});

test("a read stays outstanding until the main thread answers it", () => {
  const { fake, host } = makeHost();
  host.execute(makeRequest(), recordSettlement);
  const channel = OL.createBlockingInputChannel(fake.commands[0].buffer);
  OL.armBlockingRead(channel);

  assert.equal(OL.isBlockingReadOutstanding(channel), true);
  const outcome = OL.awaitBlockingRead(
    channel,
    (control, index, expected, timeoutMs) => {
      const result = recordPark(control, index, expected, timeoutMs);
      host.resolveRead("answered while parked");
      return result;
    },
    3,
  );

  assert.deepEqual(outcome, {
    kind: "answered",
    answer: "answered while parked",
  });
  assert.deepEqual(parkIntervals.splice(0, parkIntervals.length), [3]);
  takeSettlements();
});

test("a custom answer capacity sizes the shared buffer", () => {
  const { fake, host } = makeHost({ answerCapacity: 4 });

  host.execute(makeRequest(), recordSettlement);

  assert.equal(
    fake.commands[0].buffer.byteLength,
    OL.blockingInputBufferByteLength(4),
  );
});

test("a read report settles with the question and no diagnostics", () => {
  // A suspended run has not failed: `spec/interaction-events.md:154-157` is waiting, not cancelling.
  const { fake, host } = makeHost();
  const answers = [{ prompt: "earlier?", answer: "yes" }];

  host.execute(makeRequest({ answers }), recordSettlement);
  fake.report(READ_REPORT);

  const settlements = takeSettlements();
  assert.equal(settlements.length, 1);
  assert.equal(settlements[0].pendingPrompt, "who?");
  assert.deepEqual(settlements[0].diagnostics, []);
  assert.deepEqual(settlements[0].output, ["before"]);
  assert.deepEqual(settlements[0].retainedAnswers, answers);
});

test("a done report settles the run's real outcome and ends it", () => {
  const { fake, host } = makeHost();
  host.execute(makeRequest(), recordSettlement);

  fake.report({
    type: "done",
    runId: 1,
    events: [],
    output: ["all done"],
    tutorOutput: [],
    diagnostics: [{ code: "ol-limit" }],
  });
  // Anything arriving afterwards belongs to a run the controller has already committed.
  fake.report(READ_REPORT);

  const settlements = takeSettlements();
  assert.equal(settlements.length, 1);
  assert.equal(settlements[0].pendingPrompt, null);
  assert.deepEqual(settlements[0].output, ["all done"]);
  assert.deepEqual(
    settlements[0].diagnostics.map((diagnostic) => diagnostic.code),
    ["ol-limit"],
  );
});

test("a report arriving before any run has started is ignored", () => {
  const { fake } = makeHost();

  assert.doesNotThrow(() => {
    fake.report(READ_REPORT);
  });
});

test("resolveRead delivers the learner's answer into shared memory and wakes the Worker", () => {
  const { fake, host, notified } = makeHost();
  host.execute(makeRequest(), recordSettlement);
  fake.report(READ_REPORT);

  host.resolveRead("Ada");

  assert.deepEqual(readDelivered(fake.commands[0]), {
    kind: "answered",
    answer: "Ada",
  });
  assert.deepEqual(notified, [0]);
});

test("resolveRead with no answer dismisses the read, which cancels the run", () => {
  const { fake, host, notified } = makeHost();
  host.execute(makeRequest(), recordSettlement);

  host.resolveRead(undefined);

  assert.deepEqual(readDelivered(fake.commands[0]), { kind: "dismissed" });
  assert.deepEqual(notified, [0]);
});

test("an answer too large for the shared region is refused, never truncated", () => {
  // Handing the program text the learner did not type would be a silent corruption, and a buffer a
  // blocked Worker is already holding cannot grow. The read ends unanswered instead, so the run
  // cancels with the runtime's own diagnostic — visible and recoverable, rather than wrong.
  const { fake, host } = makeHost({ answerCapacity: 3 });
  host.execute(makeRequest(), recordSettlement);
  fake.report(READ_REPORT);

  host.resolveRead("far too long to fit");

  assert.deepEqual(readDelivered(fake.commands[0]), { kind: "dismissed" });
});

test("an answer exactly filling the shared region is still delivered", () => {
  const { fake, host } = makeHost({ answerCapacity: 3 });
  host.execute(makeRequest(), recordSettlement);

  host.resolveRead("abc");

  assert.deepEqual(readDelivered(fake.commands[0]), {
    kind: "answered",
    answer: "abc",
  });
});

test("resolveRead before any run has started is a no-op", () => {
  const { host } = makeHost();

  assert.doesNotThrow(() => {
    host.resolveRead("nobody is listening");
  });
});

test("cancel raises the shared cancellation flag and abandons the run", () => {
  const { fake, host, notified } = makeHost();
  host.execute(makeRequest(), recordSettlement);

  host.cancel();
  // The Worker will still finish and report; the controller has already decided this run's
  // outcome, so re-settling it would overwrite what the learner sees.
  fake.report({
    type: "done",
    runId: 1,
    events: [],
    output: [],
    tutorOutput: [],
    diagnostics: [],
  });

  const channel = OL.createBlockingInputChannel(fake.commands[0].buffer);
  assert.equal(OL.isBlockingCancellationRequested(channel), true);
  assert.deepEqual(notified, [0], "a parked Worker is woken, not left hanging");
  assert.deepEqual(takeSettlements(), []);
});

test("a request that arrives already cancelled starts its run cancelled", () => {
  // `stop()` latches the controller's signal and only `reset()` re-arms it, so a Run after a Stop
  // must halt immediately. A fresh shared buffer starts clean, so the latch has to be re-raised
  // here or the Worker host would run to completion where the in-process host halts.
  const { fake, host } = makeHost();

  host.execute(makeRequest({ cancellationRequested: true }), recordSettlement);

  assert.equal(
    OL.isBlockingCancellationRequested(
      OL.createBlockingInputChannel(fake.commands[0].buffer),
    ),
    true,
  );
});

test("starting a run while one is still in flight cancels the older one", () => {
  // Defence in depth behind the controller's own guard: the host owns a single cancellation
  // channel, so two live interpreters would leave Stop reaching only the newer of them.
  const { fake, host } = makeHost();
  host.execute(makeRequest(), recordSettlement);

  host.execute(makeRequest(), recordSettlement);

  assert.equal(
    OL.isBlockingCancellationRequested(
      OL.createBlockingInputChannel(fake.commands[0].buffer),
    ),
    true,
  );
  assert.equal(
    OL.isBlockingCancellationRequested(
      OL.createBlockingInputChannel(fake.commands[1].buffer),
    ),
    false,
  );
});

test("cancel before any run has started is a no-op", () => {
  const { host } = makeHost();

  assert.doesNotThrow(() => {
    host.cancel();
  });
});

test("a report from a run Stop abandoned never settles the run that replaced it", () => {
  // A Worker processes messages serially and a cancelled run still finishes, so run 1's ending
  // genuinely arrives *after* `execute()` has installed run 2's callback. Clearing `settle` alone
  // does not cover this — the new run reinstalls it — which is why every report carries its run.
  const { fake, host } = makeHost();
  host.execute(makeRequest(), recordSettlement);
  host.cancel();
  host.execute(makeRequest(), recordSettlement);

  fake.report({
    type: "done",
    runId: 1,
    events: [],
    output: ["from the run the learner stopped"],
    tutorOutput: [],
    diagnostics: [],
  });

  assert.deepEqual(takeSettlements(), []);

  fake.report({
    type: "done",
    runId: 2,
    events: [],
    output: ["from the run the learner started"],
    tutorOutput: [],
    diagnostics: [],
  });

  const settlements = takeSettlements();
  assert.equal(settlements.length, 1);
  assert.deepEqual(settlements[0].output, ["from the run the learner started"]);
});

test("each run gets a fresh buffer, so a previous Stop cannot leak into it", () => {
  // This is what re-arms cancellation: `reset()` needs no counterpart here, because the flag a
  // previous Stop set lives in memory the next run never looks at.
  const { fake, host } = makeHost();
  host.execute(makeRequest(), recordSettlement);
  host.cancel();

  host.execute(makeRequest(), recordSettlement);

  assert.equal(fake.commands.length, 2);
  assert.notEqual(fake.commands[0].buffer, fake.commands[1].buffer);
  assert.equal(
    OL.isBlockingCancellationRequested(
      OL.createBlockingInputChannel(fake.commands[1].buffer),
    ),
    false,
  );
});

test("both halves together: three questions, one execution, answers threaded through", () => {
  // The fake port runs the REAL Worker-side runner, so this exercises the whole mechanism — command
  // out, read report back, answer into shared memory, interpreter resumes — with no threads. In a
  // browser each hop is asynchronous; the protocol is identical either way, which is precisely why
  // it can be proven here.
  const answers = ["10", "20", "30"];
  let served = 0;
  let listener = null;
  const host = OL.createWorkerExecutionHost({
    allocateBuffer: (byteLength) => new ArrayBuffer(byteLength),
    notify: () => 1,
    port: {
      postMessage(command) {
        OL.runExecutionWorkerCommand(command, {
          wait: recordPark,
          post: (report) => listener?.(report),
        });
      },
      onReport(next) {
        listener = next;
      },
    },
  });

  const settlements = [];
  host.execute(
    makeRequest({
      source: [
        ':a = input "first?"',
        'print "asked once"',
        ':b = input "second?"',
        ':c = input "third?"',
        "(print :a :b :c)",
      ].join("\n"),
    }),
    (settlement) => {
      settlements.push(settlement);
      if (settlement.pendingPrompt !== null) {
        host.resolveRead(answers[served]);
        served += 1;
      }
    },
  );

  assert.deepEqual(
    settlements.map((settlement) => settlement.pendingPrompt),
    ["first?", "second?", "third?", null],
  );
  assert.deepEqual(settlements.at(-1).output, ["asked once", "10 20 30"]);
  assert.deepEqual(settlements.at(-1).diagnostics, []);
  // `print "asked once"` ran exactly once, which is the whole difference from a replay: N reads
  // used to cost N+1 executions, and every earlier attempt re-ran everything before its read.
  assert.equal(
    settlements.at(-1).events.filter((event) => event.kind === "print").length,
    2,
  );
  // #976 — and the chain now KEEPS those three answers. Before this slice the host echoed back the
  // request's own (empty) list, so a chain that resolved its reads in place ended with no record
  // that anything had been answered. That was invisible while a chain which had asked a question
  // refused host input for the rest of its life; #976 deletes that refusal, so the next delivery
  // replay would have re-asked all three.
  assert.deepEqual(
    settlements.at(-1).retainedAnswers,
    [
      { prompt: "first?", answer: "10" },
      { prompt: "second?", answer: "20" },
      { prompt: "third?", answer: "30" },
    ],
    "each answer is retained against the question it was given for",
  );
});

test("#976: an answer the shared region refuses is not retained — it never reached the program", () => {
  // The control for the retention above, on the axis that matters: `retainedAnswers` must record
  // what the program actually CONSUMED, not what the learner typed. An over-long answer is refused
  // and the read dismissed, so retaining it would seed a later replay with an answer no run ever
  // received — and `resolveRecordedAnswer` would then hand it to that question in good faith.
  let listener = null;
  const host = OL.createWorkerExecutionHost({
    allocateBuffer: (byteLength) => new ArrayBuffer(byteLength),
    notify: () => 1,
    answerCapacity: 4,
    port: {
      postMessage(command) {
        OL.runExecutionWorkerCommand(command, {
          wait: recordPark,
          post: (report) => listener?.(report),
        });
      },
      onReport(next) {
        listener = next;
      },
    },
  });

  const settlements = [];
  host.execute(
    makeRequest({ source: ':a = input "first?"\nprint :a' }),
    (settlement) => {
      settlements.push(settlement);
      if (settlement.pendingPrompt !== null) {
        host.resolveRead("far too long for four bytes");
      }
    },
  );

  assert.deepEqual(
    settlements.at(-1).retainedAnswers,
    [],
    "a refused answer is not part of the chain's history",
  );
});

test("#976: a dismissed question is not retained either", () => {
  // The other non-delivered ending. A dismissal is the learner declining to answer
  // (`spec/interaction-events.md:156-157`'s unanswered read), so there is no answer to keep.
  let listener = null;
  const host = OL.createWorkerExecutionHost({
    allocateBuffer: (byteLength) => new ArrayBuffer(byteLength),
    notify: () => 1,
    port: {
      postMessage(command) {
        OL.runExecutionWorkerCommand(command, {
          wait: recordPark,
          post: (report) => listener?.(report),
        });
      },
      onReport(next) {
        listener = next;
      },
    },
  });

  const settlements = [];
  host.execute(
    makeRequest({ source: ':a = input "first?"\nprint :a' }),
    (settlement) => {
      settlements.push(settlement);
      if (settlement.pendingPrompt !== null) {
        host.resolveRead(undefined);
      }
    },
  );

  assert.deepEqual(settlements.at(-1).retainedAnswers, []);
});

test("both halves together: Stop while a question is open ends the run", () => {
  let listener = null;
  const host = OL.createWorkerExecutionHost({
    allocateBuffer: (byteLength) => new ArrayBuffer(byteLength),
    notify: () => 1,
    port: {
      postMessage(command) {
        OL.runExecutionWorkerCommand(command, {
          wait: recordPark,
          post: (report) => listener?.(report),
        });
      },
      onReport(next) {
        listener = next;
      },
    },
  });

  const settlements = [];
  host.execute(
    makeRequest({ source: 'print "before"\n:a = input "?"\nprint "after"' }),
    (settlement) => {
      settlements.push(settlement);
      if (settlement.pendingPrompt !== null) {
        host.cancel();
      }
    },
  );

  // Only the read settlement reaches the controller: the run's own cancelled ending is dropped,
  // because Stop has already decided the outcome.
  assert.deepEqual(
    settlements.map((settlement) => settlement.pendingPrompt),
    ["?"],
  );
  assert.deepEqual(settlements[0].output, ["before"]);
});

test("#976: the host ADOPTS the runner's truncated answers, so a diverged prompt is not re-asked forever", () => {
  // `worker-execution-host.ts`'s `reportedAnswers ?? active.answers`. Review measured that reverting
  // it to `active.answers` — the pre-fix form — survives all 4750 tests: line coverage was satisfied
  // (`retainedAnswers` appears in four test files) while every one of them exercised the *plumbing*,
  // and none constructed the only case the line changes.
  //
  // That case: `request.answers` is non-empty AND the runner truncated it. The runner drops every
  // entry from the position a replay reached a different question (`resolveRecordedAnswer`), because
  // an answer given for a question the learner is no longer being asked must never reach its
  // replacement. If the host restores the request's own list instead, the next replay diverges at
  // the same position again — so the replacement question is re-asked on **every** delivery, forever.
  const { fake, host } = makeHost();
  const request = makeRequest({
    answers: [
      { prompt: "who?", answer: "ada" },
      { prompt: "colour?", answer: "red" },
    ],
  });

  host.execute(request, recordSettlement);
  // The runner reached "who?" again but a DIFFERENT second question, so it kept only the first entry.
  fake.report({
    ...READ_REPORT,
    retainedAnswers: [{ prompt: "who?", answer: "ada" }],
  });

  const settlement = takeSettlements().at(-1);
  assert.deepEqual(
    settlement.retainedAnswers,
    [{ prompt: "who?", answer: "ada" }],
    "the truncation must survive into the chain — restoring the request's own two-entry list is the forever-re-ask bug",
  );
});

test("#976: with no truncation the host still reports the chain's own answers — the control", () => {
  // Pairs with the test above. Without it, "adopts the reported list" would also be satisfied by a
  // host that dropped answers unconditionally, and the assertion would prove nothing.
  const { fake, host } = makeHost();
  const answers = [
    { prompt: "who?", answer: "ada" },
    { prompt: "colour?", answer: "red" },
  ];

  host.execute(makeRequest({ answers }), recordSettlement);
  fake.report({ ...READ_REPORT, retainedAnswers: answers });

  assert.deepEqual(
    takeSettlements().at(-1).retainedAnswers,
    answers,
    "an untruncated report carries the whole chain through unchanged",
  );
});
