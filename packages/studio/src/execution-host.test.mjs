// The in-process execution host and the settlement shape every host settles with (#876).
//
// `run-controller.ts` composes a host rather than calling `@openlogo/runtime`'s `execute()` itself,
// so that *where* a run happens — this thread, or a Worker that can genuinely block inside `input` —
// is one decision in one place. The default host below carries #769's replay unchanged, which is
// why installing the seam changed no existing studio behaviour and no existing test.

import assert from "node:assert/strict";
import { test } from "node:test";
import * as OL from "@openlogo/studio";

const NEVER_CANCELLED = { aborted: false };

/** A request with the fields every test shares; callers override what they care about. */
function makeRequest(overrides = {}) {
  return {
    source: 'print "hello"',
    document: "host.logo",
    randomSeed: 7,
    cancellationRequested: false,
    acceptsReads: false,
    answers: [],
    ...overrides,
  };
}

/** Run one request through the in-process host and hand back every settlement it produced. */
function settleAll(request, options = { signal: NEVER_CANCELLED }) {
  const host = OL.createInProcessExecutionHost(options);
  const settlements = [];
  host.execute(request, (settlement) => {
    settlements.push(settlement);
  });
  return { host, settlements };
}

test("the in-process host settles exactly once, synchronously, inside execute()", () => {
  // The property every pre-#876 test depends on: `run()` still completes within one turn.
  const host = OL.createInProcessExecutionHost({ signal: NEVER_CANCELLED });
  let settledDuringCall = false;
  let settlementCount = 0;

  host.execute(makeRequest(), () => {
    settledDuringCall = true;
    settlementCount += 1;
  });

  assert.equal(settledDuringCall, true);
  assert.equal(settlementCount, 1);
});

test("a settlement carries reduced output alongside the raw events", () => {
  const { settlements } = settleAll(
    makeRequest({ source: 'print "one"\nprint 2' }),
  );
  const [settled] = settlements;

  assert.deepEqual(settled.output, ["one", "2"]);
  assert.deepEqual(settled.diagnostics, []);
  assert.equal(settled.pendingPrompt, null);
  assert.equal(
    settled.events.filter((event) => event.kind === "print").length,
    2,
  );
});

test("collectOutput reduces print events in the runtime's own printed form", () => {
  // The parenthesised call form is how `print` takes more than one argument — a bare
  // `print "red" 3` is `ol-bad-token`, since every instruction needs its own line.
  const { settlements } = settleAll(
    makeRequest({ source: 'print [ 1 2 ]\n(print "red" 3)' }),
  );
  const [settled] = settlements;

  assert.deepEqual(settled.diagnostics, []);
  // Reducing on the thread that produced the values is the rule (#876): structured clone drops
  // class prototypes, so `printedForm` must never be handed a value that has crossed a boundary.
  assert.deepEqual(OL.collectOutput(settled.events), ["[1 2]", "red 3"]);
});

test("collectTutorOutput reduces tutor-output events in emission order", () => {
  const { settlements } = settleAll(
    makeRequest({ source: "forward 100\nexplain\nwhy" }),
  );
  const [settled] = settlements;

  const reduced = OL.collectTutorOutput(settled.events);
  assert.equal(reduced.length > 0, true);
  assert.deepEqual(reduced, settled.tutorOutput);
});

test("a run's diagnostics reach the settlement unchanged", () => {
  const { settlements } = settleAll(
    makeRequest({ source: "forward 100\nprint :nope" }),
  );
  const [settled] = settlements;

  assert.deepEqual(
    settled.diagnostics.map((diagnostic) => diagnostic.code),
    ["ol-undefined-var"],
  );
  // Everything emitted before the failure is still surfaced, so the learner keeps their picture.
  assert.equal(
    settled.events.some((event) => event.kind === "draw-segment"),
    true,
  );
});

test("acceptsReads false installs no reader at all, so an input cancels the run", () => {
  // Exactly what `step()`'s lazy preparation wants: stepping is a scrubber over an already-produced
  // stream, with no execution in progress for a read to block.
  const { settlements } = settleAll(
    makeRequest({ source: ':name = input "who?"', acceptsReads: false }),
  );
  const [settled] = settlements;

  assert.equal(settled.pendingPrompt, null);
  assert.equal(settled.diagnostics.length > 0, true);
});

test("an unanswered read reports its prompt rather than answering it", () => {
  const { settlements } = settleAll(
    makeRequest({
      source: 'print "before"\n:name = input "who?"\nprint :name',
      acceptsReads: true,
    }),
  );
  const [settled] = settlements;

  assert.equal(settled.pendingPrompt, "who?");
  assert.deepEqual(settled.output, ["before"]);
  assert.deepEqual(settled.retainedAnswers, []);
});

test("a recorded answer is consumed and the replay reaches the next question", () => {
  const { settlements } = settleAll(
    makeRequest({
      source: ':a = input "first?"\n:b = input "second?"\nprint :a\nprint :b',
      acceptsReads: true,
      answers: [{ prompt: "first?", answer: "1" }],
    }),
  );
  const [settled] = settlements;

  assert.equal(settled.pendingPrompt, "second?");
  assert.deepEqual(settled.retainedAnswers, [
    { prompt: "first?", answer: "1" },
  ]);
});

test("every answer recorded means the run finishes with no question outstanding", () => {
  const { settlements } = settleAll(
    makeRequest({
      source: ':a = input "first?"\n:b = input "second?"\nprint :a\nprint :b',
      acceptsReads: true,
      answers: [
        { prompt: "first?", answer: "1" },
        { prompt: "second?", answer: "2" },
      ],
    }),
  );
  const [settled] = settlements;

  assert.equal(settled.pendingPrompt, null);
  assert.deepEqual(settled.output, ["1", "2"]);
  assert.deepEqual(settled.diagnostics, []);
});

test("an answer recorded for a different question is dropped, along with every later one", () => {
  // Defence in depth: #881's pinned seed makes a replay bit-identical, so this arm is unreachable
  // through `run()` — but it is what makes "an answer never reaches a question it did not answer"
  // true by construction rather than by trusting that argument.
  const { settlements } = settleAll(
    makeRequest({
      source: ':a = input "who?"',
      acceptsReads: true,
      answers: [
        { prompt: "a different question", answer: "1" },
        { prompt: "who?", answer: "2" },
      ],
    }),
  );
  const [settled] = settlements;

  assert.equal(settled.pendingPrompt, "who?");
  assert.deepEqual(settled.retainedAnswers, []);
});

test("resolveRecordedAnswer is the one tested place that owns the pairing rule", () => {
  const answers = [
    { prompt: "who?", answer: "Ada" },
    { prompt: "how far?", answer: "100" },
  ];

  assert.deepEqual(OL.resolveRecordedAnswer(answers, 0, "who?"), {
    answer: "Ada",
    retained: answers,
  });
  assert.deepEqual(OL.resolveRecordedAnswer(answers, 2, "next?"), {
    answer: undefined,
    retained: answers,
  });
  assert.deepEqual(OL.resolveRecordedAnswer(answers, 1, "changed?"), {
    answer: undefined,
    retained: [answers[0]],
  });
});

test("the host honours the caller's cancellation signal", () => {
  const { settlements } = settleAll(
    makeRequest({ source: "repeat 100 [ forward 1 ]" }),
    { signal: { aborted: true } },
  );
  const [settled] = settlements;

  assert.deepEqual(
    settled.diagnostics.map((diagnostic) => diagnostic.code),
    ["ol-limit"],
  );
});

test("the in-process host exposes no resolveRead, which is how the controller knows it replays", () => {
  const host = OL.createInProcessExecutionHost({ signal: NEVER_CANCELLED });

  assert.equal(host.resolveRead, undefined);
  // `cancel()` is a no-op here: `execute()` has already returned by the time anything can call it.
  assert.doesNotThrow(() => {
    host.cancel();
  });
});

test("toExecuteOptions always composes studio's own tutor templates", () => {
  const options = OL.toExecuteOptions(
    makeRequest({ randomSeed: 99 }),
    NEVER_CANCELLED,
    undefined,
  );

  assert.equal(options.randomSeed, 99);
  assert.equal(options.signal, NEVER_CANCELLED);
  assert.equal(typeof options.tutorTemplates, "function");
  assert.equal("hostInput" in options, false);
  assert.equal("instructionBudget" in options, false);
  assert.equal("recursionDepthLimit" in options, false);
});

test("toExecuteOptions forwards a reader and the safety limits only when they were asked for", () => {
  const read = () => "answer";
  const options = OL.toExecuteOptions(
    makeRequest({ instructionBudget: 11, recursionDepthLimit: 3 }),
    NEVER_CANCELLED,
    read,
  );

  assert.equal(options.hostInput?.read, read);
  // Forwarded as the runtime will actually call it — a reader that is only *referenced* proves
  // nothing about the shape `ExecuteOptions.hostInput` expects.
  assert.equal(options.hostInput?.read("who?"), "answer");
  assert.equal(options.instructionBudget, 11);
  assert.equal(options.recursionDepthLimit, 3);
});

test("#952: toExecuteOptions installs hostInput.events, so a delivered key actually fires its handler", () => {
  const options = OL.toExecuteOptions(
    makeRequest({
      hostInputEvents: [{ tick: 1, kind: "key", key: "left" }],
    }),
    NEVER_CANCELLED,
    undefined,
  );

  assert.deepEqual(options.hostInput?.events, [
    { tick: 1, kind: "key", key: "left" },
  ]);
  assert.equal(
    options.hostInput?.read,
    undefined,
    "the two halves of the seam are independent",
  );

  // Forwarded as the runtime will actually consume it: a schedule that is only *referenced* proves
  // nothing, which is exactly how `on_key` shipped registering-but-never-firing.
  const { settlements } = settleAll(
    makeRequest({
      source: ['on_key "left" [', '  print "turned"', "]", "wait 3"].join("\n"),
      hostInputEvents: [{ tick: 1, kind: "key", key: "left" }],
    }),
  );
  assert.deepEqual(settlements[0].output, ["turned"]);
});

test("#952: toExecuteOptions carries the reader and the delivered schedule together", () => {
  const read = () => "answer";
  const options = OL.toExecuteOptions(
    makeRequest({ hostInputEvents: [{ tick: 2, kind: "click" }] }),
    NEVER_CANCELLED,
    read,
  );

  assert.equal(options.hostInput?.read, read);
  assert.equal(
    options.hostInput?.read("who?"),
    "answer",
    "forwarded as the runtime will actually call it",
  );
  assert.deepEqual(options.hostInput?.events, [{ tick: 2, kind: "click" }]);
});

test("#952: a request with neither a reader nor delivered input installs no hostInput at all", () => {
  assert.equal(
    OL.toExecuteOptions(makeRequest(), NEVER_CANCELLED, undefined).hostInput,
    undefined,
    "exactly the options every run passed before this slice",
  );
  assert.equal(
    OL.toExecuteOptions(
      makeRequest({ hostInputEvents: [] }),
      NEVER_CANCELLED,
      undefined,
    ).hostInput,
    undefined,
    "an empty schedule is not a schedule",
  );
});

test("an instruction budget from the request actually bounds the run", () => {
  const { settlements } = settleAll(
    makeRequest({ source: "repeat 1000 [ forward 1 ]", instructionBudget: 12 }),
  );

  assert.deepEqual(
    settlements[0].diagnostics.map((diagnostic) => diagnostic.code),
    ["ol-limit"],
  );
});
