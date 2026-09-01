// The Worker side of the blocking execution host (#876): the code that runs `execute()` off the
// main thread and **parks inside the `input` reader** until an answer arrives in shared memory.
//
// No real threads and no real timing appear below. `Atomics.wait` is injected, so a "park" is a
// plain function call these tests script — which is what lets the branch that only a genuinely
// blocked interpreter can reach be covered deterministically (issue #897).

import assert from "node:assert/strict";
import { test } from "node:test";
import * as OL from "@openlogo/studio";

/** Build the command a real main thread would post, over ordinary (non-shared) memory. */
function makeCommand(source, overrides = {}, capacity = 64) {
  const channel = OL.createBlockingInputChannel(
    new ArrayBuffer(OL.blockingInputBufferByteLength(capacity)),
  );
  return {
    channel,
    command: {
      type: "run",
      runId: 1,
      request: {
        source,
        document: "worker.logo",
        randomSeed: 5,
        cancellationRequested: false,
        acceptsReads: true,
        answers: [],
        ...overrides,
      },
      buffer: channel.control.buffer,
    },
  };
}

const SILENT_NOTIFY = () => 0;

/**
 * Run one command, letting `onRead` play the main thread's part for each question. Reports are
 * collected in order, so a test can assert what the learner would have been shown and when.
 *
 * `onPark` plays the part of a main thread that answers only once the interpreter has genuinely
 * parked — the real ordering, and the one that proves the read blocks rather than merely returning.
 */
function runWorker(command, channel, onRead, options = {}) {
  const { onPark, ...runnerOptions } = options;
  const reports = [];
  const parkIntervals = [];
  OL.runExecutionWorkerCommand(command, {
    post(report) {
      reports.push(report);
      if (report.type === "read") {
        onRead?.(report, channel, reports.length);
      }
    },
    wait(_control, _index, _expected, timeoutMs) {
      parkIntervals.push(timeoutMs);
      onPark?.(channel, parkIntervals.length);
      return "ok";
    },
    ...runnerOptions,
  });
  return { reports, parkIntervals };
}

/** Answer every question with `answer`, as a learner clicking through would. */
function answerWith(answer) {
  return (_report, channel) => {
    OL.deliverBlockingAnswer(channel, answer, SILENT_NOTIFY);
  };
}

test("a read is reported with everything already drawn — never over a blank canvas", () => {
  // This is the regression guard the `ExecuteOptions.observedEvents` seam (#876, `@openlogo/runtime`)
  // exists for. The reader is called with the prompt and NOTHING else, so without that seam a
  // parked Worker could not tell the main thread what the program had drawn, and the question would
  // appear over an empty canvas — a straight regression against #769, which draws the square and
  // *then* asks. `spec/interaction-events.md:108-110` explicitly permits continuing to render
  // already-emitted trace events while `input` waits.
  const { command, channel } = makeCommand(
    'forward 100\nprint "before"\n:distance = input "how far?"\nforward :distance',
  );

  const { reports } = runWorker(command, channel, answerWith("40"));

  const [read] = reports;
  assert.equal(read.type, "read");
  assert.equal(read.prompt, "how far?");
  assert.deepEqual(read.output, ["before"], "the print is already visible");
  assert.deepEqual(
    read.events.map((event) => event.kind),
    [
      "instruction",
      "move",
      "draw-segment",
      "instruction",
      "print",
      "instruction",
    ],
    "the whole prefix up to the waiting statement is reported",
  );
});

test("one execution answers every question — there is no replay to bound", () => {
  // #881 deleted the replay chain's no-progress retry cap, and its reviewers carried the consequence
  // here: with the cap gone, a reintroduction of divergence would be an unbounded loop. A Worker
  // host answers that structurally rather than with another counter — it never replays, so there is
  // no attempt sequence to diverge and nothing to count. This pins the invariant directly.
  const { command, channel } = makeCommand(
    ':a = input "first?"\n:b = input "second?"\n:c = input "third?"\n(print :a :b :c)',
  );

  const { reports } = runWorker(command, channel, answerWith("x"));

  const reads = reports.filter((report) => report.type === "read");
  const done = reports.filter((report) => report.type === "done");
  assert.equal(reads.length, 3);
  assert.equal(done.length, 1, "three questions, still one execution");
  assert.deepEqual(done[0].output, ["x x x"]);
  assert.deepEqual(done[0].diagnostics, []);
});

test("each report only ever extends the previous one — output never rewinds", () => {
  const { command, channel } = makeCommand(
    'print "one"\n:a = input "?"\nprint "two"\n:b = input "?"\nprint "three"',
  );

  const { reports } = runWorker(command, channel, answerWith("ok"));

  assert.deepEqual(
    reports.map((report) => report.output),
    [["one"], ["one", "two"], ["one", "two", "three"]],
  );
  for (let index = 1; index < reports.length; index += 1) {
    const previous = reports[index - 1].events;
    const current = reports[index].events;
    assert.deepEqual(
      current.slice(0, previous.length).map((event) => event.kind),
      previous.map((event) => event.kind),
    );
  }
});

test("two questions with identical prompt text each receive their own answer", () => {
  const { command, channel } = makeCommand(
    ':a = input "value?"\n:b = input "value?"\n(print :a :b)',
  );
  let served = 0;

  const { reports } = runWorker(command, channel, (_report, channel_) => {
    served += 1;
    OL.deliverBlockingAnswer(channel_, `answer-${served}`, SILENT_NOTIFY);
  });

  const done = reports.at(-1);
  assert.equal(done.type, "done");
  assert.deepEqual(done.output, ["answer-1 answer-2"]);
});

test("the interpreter genuinely parks when the answer has not arrived yet", () => {
  const { command, channel } = makeCommand(':a = input "?"\nprint :a');

  // Deliver only once the interpreter has actually parked, which is the real ordering.
  const { reports, parkIntervals } = runWorker(command, channel, undefined, {
    onPark(parkedChannel) {
      OL.deliverBlockingAnswer(parkedChannel, "parked", SILENT_NOTIFY);
    },
    pollIntervalMs: 7,
  });

  assert.deepEqual(reports.at(-1).output, ["parked"]);
  assert.deepEqual(
    parkIntervals,
    [7],
    "it parked exactly once, for the interval it was told to",
  );
});

test("a read that is answered before the interpreter looks never parks at all", () => {
  const { command, channel } = makeCommand(':a = input "?"\nprint :a');

  const { parkIntervals } = runWorker(command, channel, answerWith("early"));

  assert.deepEqual(parkIntervals, []);
});

test("a dismissed question ends the read unanswered, cancelling the run", () => {
  // `spec/interaction-events.md:110-111`'s only other ending for a read.
  const { command, channel } = makeCommand(
    'print "before"\n:a = input "?"\nprint "after"',
  );

  const { reports } = runWorker(command, channel, (_report, channel_) => {
    OL.dismissBlockingRead(channel_, SILENT_NOTIFY);
  });

  const done = reports.at(-1);
  assert.equal(done.type, "done");
  assert.deepEqual(done.output, ["before"], "'after' never ran");
  assert.equal(done.diagnostics.length > 0, true);
});

test("Stop preempts a loop the interpreter is in the middle of — the second want #876 names", () => {
  // A same-thread studio could never do this: `execute()` never yields, so nothing could flip the
  // signal while it was on the stack (`run-controller.ts` has recorded that since #126). Here the
  // cancellation flag lives in shared memory and the runtime reads it before every statement, so a
  // 100,000-iteration loop stops on the iteration it happens to be running.
  const { command, channel } = makeCommand(
    'repeat 100000 [ forward 1 :answer = input "?" ]',
  );

  const { reports } = runWorker(command, channel, (_report, channel_) => {
    OL.requestBlockingCancellation(channel_, SILENT_NOTIFY);
  });

  const done = reports.at(-1);
  assert.equal(done.type, "done");
  assert.equal(
    done.events.filter((event) => event.kind === "move").length,
    1,
    "it stopped in the middle of the loop, not at the instruction budget",
  );
  assert.deepEqual(
    done.diagnostics.map((diagnostic) => diagnostic.code),
    ["ol-limit"],
  );
});

test("a cancellation already requested stops the run before it draws anything", () => {
  const { command, channel } = makeCommand("repeat 100000 [ forward 1 ]");
  OL.requestBlockingCancellation(channel, SILENT_NOTIFY);

  const { reports } = runWorker(command, channel, answerWith("x"));

  const done = reports.at(-1);
  assert.deepEqual(
    done.diagnostics.map((diagnostic) => diagnostic.code),
    ["ol-limit"],
  );
  // Asserted as an empty stream rather than by filtering for `move`: a predicate over an empty
  // array is never called, so it would assert nothing at all.
  assert.deepEqual(done.events, []);
});

test("acceptsReads false installs no reader, so a read cancels instead of parking", () => {
  const { command, channel } = makeCommand(':a = input "?"', {
    acceptsReads: false,
  });

  const { reports } = runWorker(command, channel, answerWith("never"));

  assert.deepEqual(
    reports.map((report) => report.type),
    ["done"],
    "no question was ever put",
  );
  assert.equal(reports[0].diagnostics.length > 0, true);
});

test("a program that fails to parse reports its diagnostics and no events", () => {
  const { command, channel } = makeCommand("forward [");

  const { reports } = runWorker(command, channel, answerWith("x"));

  assert.deepEqual(
    reports[0].diagnostics.map((diagnostic) => diagnostic.code),
    ["ol-unmatched-bracket"],
  );
  assert.deepEqual(reports[0].events, []);
  assert.deepEqual(reports[0].output, []);
});

test("the run's safety limits and pinned seed cross the boundary intact", () => {
  const { command, channel } = makeCommand("repeat 1000 [ forward 1 ]", {
    instructionBudget: 9,
    recursionDepthLimit: 4,
  });

  const { reports } = runWorker(command, channel, answerWith("x"));

  assert.deepEqual(
    reports[0].diagnostics.map((diagnostic) => diagnostic.code),
    ["ol-limit"],
  );
});

test("a pinned random seed makes the whole Worker run reproducible", () => {
  const program = "repeat 3 [ forward random 100 ]";
  const first = makeCommand(program, { randomSeed: 4242 });
  const second = makeCommand(program, { randomSeed: 4242 });
  const third = makeCommand(program, { randomSeed: 99 });

  const runOnce = ({ command, channel }) =>
    JSON.stringify(
      runWorker(command, channel, answerWith("x"))
        .reports.at(-1)
        .events.filter((event) => event.kind === "move"),
    );

  assert.equal(runOnce(first), runOnce(second));
  assert.notEqual(runOnce(first), runOnce(third));
});

test("tutor output is reduced in the Worker, alongside print output", () => {
  const { command, channel } = makeCommand("forward 100\nexplain");

  const { reports } = runWorker(command, channel, answerWith("x"));

  assert.equal(reports[0].tutorOutput.length > 0, true);
});

test("#976: a question the chain has already answered is consumed, not re-asked", () => {
  // The defect #976 AC3 names. This runner ALWAYS parked, whatever the request carried, because
  // until #976 a chain that had asked a question refused host input for the rest of its life — so a
  // Worker chain never re-ran past a read and there was nothing to consume. #976 deletes that
  // refusal (`spec/interaction-events.md:108-111` blocks handlers only "until the read finishes"),
  // so a key press replays the chain, and a reader that always parked would put every answered
  // question back on the learner's screen, one modal per press.
  //
  // Reverting the reader to its pre-#976 form fails this test on the FIRST assertion: it posts a
  // `"read"` report for a question the chain answered.
  const { command, channel } = makeCommand(
    ':name = input "who?"\nprint :name',
    { answers: [{ prompt: "who?", answer: "ada" }] },
  );

  // No onRead: a read report would fail the assertions below, and an unreachable callback is a
  // coverage hole rather than a stronger check.
  const { reports, parkIntervals } = runWorker(command, channel);

  assert.deepEqual(
    reports.map((report) => report.type),
    ["done"],
    "no read report: the answer came from the chain's FIFO",
  );
  assert.deepEqual(parkIntervals, [], "and the interpreter never parked");
  assert.deepEqual(
    reports[0].output,
    ["ada"],
    "the program received the learner's own answer",
  );
});

test("#976: the CONTROL — with no recorded answer that same program DOES park and ask", () => {
  // Pairs with the test above: without it, "no read report" would also be satisfied by a runner that
  // never asks at all, and the assertion would prove nothing.
  //
  // The answer is delivered from `onPark` rather than from the read report, so it arrives only once
  // the interpreter has genuinely blocked — the real ordering, and what makes "parked" a measurement
  // rather than a word. (Answering from the report instead satisfies `awaitBlockingRead` before it
  // ever calls `wait`, so the park is real but unobservable.)
  const { command, channel } = makeCommand(':name = input "who?"\nprint :name');

  const { reports, parkIntervals } = runWorker(command, channel, undefined, {
    onPark(parked) {
      OL.deliverBlockingAnswer(parked, "ada", SILENT_NOTIFY);
    },
  });

  assert.deepEqual(
    reports.map((report) => report.type),
    ["read", "done"],
    "an unanswered question is still put to the learner",
  );
  assert.equal(parkIntervals.length, 1, "and the interpreter genuinely parked");
  assert.deepEqual(reports[1].output, ["ada"]);
});

test("#976: an answer recorded for a DIFFERENT question is never handed to this one", () => {
  // The pairing `resolveRecordedAnswer` exists for, now that this host consults it too. A FIFO entry
  // is used only when it was given for this same question at this position — otherwise the read
  // parks, because handing a learner's answer to something they never saw is a silent corruption
  // and the one failure mode with no visible symptom.
  const { command, channel } = makeCommand(
    ':name = input "who?"\nprint :name',
    {
      answers: [{ prompt: "how far?", answer: "40" }],
    },
  );

  const { reports } = runWorker(command, channel, answerWith("ada"));

  assert.deepEqual(
    reports.map((report) => report.type),
    ["read", "done"],
    "the mismatched answer is refused and the question is asked",
  );
  assert.equal(reports[0].prompt, "who?");
  assert.deepEqual(
    reports[1].output,
    ["ada"],
    "…and the learner's own answer is what the program got",
  );
});

test("#976: a chain's answers are consumed in order across two different questions", () => {
  // Position matters as much as prompt text: the FIFO is a queue, and a run that asks two questions
  // must take them in ask order rather than matching by text alone.
  const { command, channel } = makeCommand(
    ':first = input "one?"\n:second = input "two?"\nprint :first\nprint :second',
    {
      answers: [
        { prompt: "one?", answer: "a" },
        { prompt: "two?", answer: "b" },
      ],
    },
  );

  const { reports, parkIntervals } = runWorker(command, channel);

  assert.deepEqual(parkIntervals, []);
  assert.deepEqual(reports[0].output, ["a", "b"]);
});

test("#976: the runner REPORTS its truncated answers, so the host has a truncation to adopt", () => {
  // The producing half of fix D. The consuming half (`worker-execution-host.ts`'s
  // `reportedAnswers ?? active.answers`) is pinned in `worker-execution-host.test.mjs`, and its
  // death gave the appearance that fix D was guarded. Only half of it was: deleting
  // `retainedAnswers = resolution.retained;` here left the whole suite green, because every existing
  // use of `retainedAnswers` exercises the plumbing rather than the truncation.
  //
  // `resolveRecordedAnswer` drops every entry from the position a replay reached a different
  // question. The report must carry that SHORTER list — if it carries the request's own, the host
  // has nothing to adopt, the stale entry is restored, and the replacement question is re-asked on
  // every delivery forever.
  const { command, channel } = makeCommand(
    ':first = input "who?"\n:second = input "changed?"\nprint :second',
    {
      answers: [
        { prompt: "who?", answer: "ada" },
        { prompt: "colour?", answer: "red" },
      ],
    },
  );

  const { reports } = runWorker(command, channel, answerWith("blue"));

  const read = reports.find((report) => report.type === "read");
  assert.ok(read, "the diverged second question is put to the learner");
  assert.equal(read.prompt, "changed?");
  assert.ok(
    read.retainedAnswers.length < command.request.answers.length,
    `the report must carry the TRUNCATED list, got ${JSON.stringify(read.retainedAnswers)}`,
  );
  assert.deepEqual(
    read.retainedAnswers,
    [{ prompt: "who?", answer: "ada" }],
    "everything from the divergence on is dropped; the matched prefix is kept",
  );
});

test("#976: the CONTROL — with no divergence the runner reports the chain unchanged", () => {
  // Without this, "reports a shorter list" would also be satisfied by a runner that truncated
  // unconditionally, and the assertion above would prove nothing.
  const { command, channel } = makeCommand(
    ':first = input "who?"\n:second = input "colour?"\nprint :second',
    {
      answers: [
        { prompt: "who?", answer: "ada" },
        { prompt: "colour?", answer: "red" },
      ],
    },
  );

  const { reports, parkIntervals } = runWorker(command, channel);

  assert.deepEqual(parkIntervals, [], "both questions came from the FIFO");
  assert.deepEqual(
    reports.at(-1).retainedAnswers,
    command.request.answers,
    "an undiverged chain is carried through whole",
  );
});
