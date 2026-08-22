import assert from "node:assert/strict";
import { test } from "node:test";
import * as OL from "@openlogo/studio";

/**
 * `run-controller.ts`'s `input` attempt chain (#769) — the studio half of the blocking-read seam
 * #681 shipped in `@openlogo/runtime`.
 *
 * `ExecuteOptions.hostInput.read` is synchronous and `execute()` never yields, so a browser cannot
 * suspend inside the reader to await a real prompt. The run controller reconciles that by answering
 * each read from an accumulated FIFO and re-executing the captured source once the learner supplies
 * the next answer — see `run-controller.ts`'s "#769" doc section. These tests pin the behavior that
 * makes that replay indistinguishable from blocking, from the learner's side: output only grows,
 * the picture resumes rather than redrawing, a probe attempt never leaks a completed-run entry, and
 * Run/Stop/Reset stay coherent throughout.
 */

/** A `word`-answering program: prints, then asks, then prints the answer. */
const ASK_NAME_SOURCE = [
  'print "before"',
  ':name = input "what is your name?"',
  "print :name",
].join("\n");

/**
 * A test {@link OL.InputPromptHost}. With no `answer` it behaves like a real browser prompt —
 * `present()` returns immediately and the run stays blocked until the recorded responder is called.
 * With an `answer` callback it responds **synchronously from inside `present()`**, the re-entrant
 * shape the controller must also survive (and the shape a `window.prompt`-backed host would have).
 */
function createTestPromptHost(answer) {
  const host = {
    prompts: [],
    dismissCount: 0,
    respond: null,
    present(request, respond) {
      host.prompts.push(request.prompt);
      if (answer === undefined) {
        host.respond = respond;
        return;
      }
      respond(answer(request.prompt, host.prompts.length - 1));
    },
    dismiss() {
      host.dismissCount += 1;
      host.respond = null;
    },
  };
  return host;
}

/**
 * A hand-driven paced {@link OL.Scheduler}: every tick is queued rather than run, so a test can
 * observe the studio *between* animation steps — which is the only way to prove the question is put
 * to the learner at the read, not before the picture leading up to it has been drawn.
 */
function createManualScheduler() {
  const queue = [];
  return {
    queue,
    /**
     * Run queued ticks until the queue drains (bounded, so a bug cannot hang the suite), reporting
     * how many fired — the measure that tells a genuine resume apart from a replay of the whole
     * picture, since the two differ only in how much paced work the next attempt still has to do.
     */
    drain() {
      let drained = 0;
      while (queue.length > 0 && drained < 100) {
        const next = queue.shift();
        drained += 1;
        next();
      }
      return drained;
    },
    scheduler: (callback) => {
      queue.push(callback);
      return () => {
        queue.splice(queue.indexOf(callback), 1);
      };
    },
  };
}

test("run() presents the program's own prompt and holds the program at the read", () => {
  const store = OL.createStudioState({ source: ASK_NAME_SOURCE });
  const host = createTestPromptHost();
  const controller = OL.createRunController(store, { inputPrompt: host });

  controller.run();

  assert.deepEqual(host.prompts, ["what is your name?"]);
  assert.deepEqual(
    store.getState().output,
    ["before"],
    "the program must not appear to continue past an outstanding read",
  );
  assert.equal(
    store.getState().runStatus,
    "running",
    "the program IS running — blocked on a read",
  );
  assert.deepEqual(
    store.getState().diagnostics,
    [],
    "the probe's own forced cancellation is withheld while the question is open",
  );
});

test("answering the question completes the run from exactly where it stopped", () => {
  const store = OL.createStudioState({ source: ASK_NAME_SOURCE });
  const host = createTestPromptHost();
  const controller = OL.createRunController(store, { inputPrompt: host });

  controller.run();
  host.respond("tom");

  assert.deepEqual(store.getState().output, ["before", "tom"]);
  assert.deepEqual(store.getState().diagnostics, []);
  assert.equal(store.getState().runStatus, "done");
});

test("dismissing the question ends the read unanswered, cancelling the run (spec/interaction-events.md:110-111)", () => {
  const store = OL.createStudioState({ source: ASK_NAME_SOURCE });
  const host = createTestPromptHost();
  const controller = OL.createRunController(store, { inputPrompt: host });

  controller.run();
  host.respond(undefined);

  assert.equal(store.getState().runStatus, "stopped");
  assert.deepEqual(store.getState().output, ["before"]);
  const [diagnostic, ...rest] = store.getState().diagnostics;
  assert.deepEqual(rest, []);
  assert.equal(diagnostic.code, "ol-limit");
  assert.deepEqual(diagnostic.params, { limit: "cancelled" });
});

test("several reads are asked in order and each answer feeds its own read", () => {
  const store = OL.createStudioState({
    source: [
      ':first = input "first?"',
      ':second = input "second?"',
      "print :first",
      "print :second",
    ].join("\n"),
  });
  const answers = ["alpha", "beta"];
  const host = createTestPromptHost((_prompt, index) => answers[index]);
  const controller = OL.createRunController(store, { inputPrompt: host });

  controller.run();

  assert.deepEqual(host.prompts, ["first?", "second?"]);
  assert.deepEqual(store.getState().output, ["alpha", "beta"]);
  assert.equal(store.getState().runStatus, "done");
});

test("a host that answers synchronously from inside present() completes the chain (re-entrancy)", () => {
  const store = OL.createStudioState({ source: ASK_NAME_SOURCE });
  const host = createTestPromptHost(() => "tom");
  const controller = OL.createRunController(store, { inputPrompt: host });

  controller.run();

  assert.deepEqual(store.getState().output, ["before", "tom"]);
  assert.equal(store.getState().runStatus, "done");
});

test("a host that synchronously declines cancels the run, exactly like a dismissed prompt", () => {
  const store = OL.createStudioState({ source: ASK_NAME_SOURCE });
  const host = createTestPromptHost(() => undefined);
  const controller = OL.createRunController(store, { inputPrompt: host });

  controller.run();

  assert.equal(store.getState().runStatus, "stopped");
  assert.equal(store.getState().diagnostics[0].code, "ol-limit");
});

test("the replayed run draws the same picture a single, un-asked execution would", () => {
  const askingStore = OL.createStudioState({
    source: [
      "forward 50",
      ':distance = input "how far?"',
      "forward :distance",
    ].join("\n"),
  });
  const host = createTestPromptHost(() => "70");
  OL.createRunController(askingStore, { inputPrompt: host }).run();

  const literalStore = OL.createStudioState({
    source: "forward 50\nforward 70",
  });
  OL.createRunController(literalStore).run();

  assert.equal(askingStore.getState().runStatus, "done");
  assert.deepEqual(
    askingStore.getState().diagnostics,
    [],
    "a completed chain must not carry the probe's withheld cancellation",
  );
  assert.deepEqual(
    askingStore.getState().turtleScene,
    literalStore.getState().turtleScene,
  );
  assert.equal(
    askingStore.getState().turtleWorld.lastActedTurtleId,
    literalStore.getState().turtleWorld.lastActedTurtleId,
  );
  assert.deepEqual(
    askingStore
      .getState()
      .turtleWorld.turtles.get(
        askingStore.getState().turtleWorld.lastActedTurtleId,
      ),
    literalStore
      .getState()
      .turtleWorld.turtles.get(
        literalStore.getState().turtleWorld.lastActedTurtleId,
      ),
  );
});

test("stop() while a question is open withdraws it and commits the run as cancelled", () => {
  const store = OL.createStudioState({ source: ASK_NAME_SOURCE });
  const host = createTestPromptHost();
  const controller = OL.createRunController(store, { inputPrompt: host });

  controller.run();
  const lateResponder = host.respond;
  controller.stop();

  assert.equal(host.dismissCount, 1);
  assert.equal(store.getState().runStatus, "stopped");
  assert.deepEqual(store.getState().output, ["before"]);
  assert.equal(store.getState().diagnostics[0].code, "ol-limit");

  lateResponder("tom");

  assert.equal(
    store.getState().runStatus,
    "stopped",
    "an answer arriving after Stop must not resurrect the run",
  );
  assert.deepEqual(store.getState().output, ["before"]);
});

test("reset() while a question is open withdraws it and discards every answer given so far", () => {
  const store = OL.createStudioState({ source: ASK_NAME_SOURCE });
  const host = createTestPromptHost();
  const controller = OL.createRunController(store, { inputPrompt: host });

  controller.run();
  const lateResponder = host.respond;
  controller.reset();

  assert.equal(host.dismissCount, 1);
  assert.equal(store.getState().runStatus, "idle");
  assert.deepEqual(store.getState().output, []);
  assert.deepEqual(store.getState().diagnostics, []);
  assert.equal(store.getState().lastRunResult, null);

  lateResponder("tom");
  assert.equal(store.getState().runStatus, "idle");

  controller.run();
  assert.deepEqual(
    host.prompts,
    ["what is your name?", "what is your name?"],
    "a reset chain starts over at the first question",
  );
});

test("answers never leak from one run into the next", () => {
  const store = OL.createStudioState({ source: ASK_NAME_SOURCE });
  const host = createTestPromptHost();
  const controller = OL.createRunController(store, { inputPrompt: host });

  controller.run();
  host.respond("tom");
  controller.run();

  assert.deepEqual(host.prompts, ["what is your name?", "what is your name?"]);
  assert.equal(store.getState().runStatus, "running");
  host.respond("jerry");
  assert.deepEqual(store.getState().output, ["before", "jerry"]);
});

test("run() while a question is open is ignored, never a second overlapping chain (#314)", () => {
  const store = OL.createStudioState({ source: ASK_NAME_SOURCE });
  const host = createTestPromptHost();
  const controller = OL.createRunController(store, { inputPrompt: host });

  controller.run();
  controller.run();

  assert.deepEqual(host.prompts, ["what is your name?"]);
});

test("step() while a question is open is a no-op — the run is blocked on it", () => {
  const store = OL.createStudioState({ source: ASK_NAME_SOURCE });
  const host = createTestPromptHost();
  const controller = OL.createRunController(store, { inputPrompt: host });

  controller.run();
  const sceneBefore = store.getState().turtleScene;
  controller.step();

  assert.equal(store.getState().turtleScene, sceneBefore);
  assert.equal(store.getState().runStatus, "running");
  assert.deepEqual(host.prompts, ["what is your name?"]);
});

test("step()'s own lazy prepare() installs no prompt host — stepping never drives the prompt flow", () => {
  const store = OL.createStudioState({ source: ASK_NAME_SOURCE });
  const host = createTestPromptHost();
  const controller = OL.createRunController(store, { inputPrompt: host });

  controller.step();

  assert.deepEqual(host.prompts, []);
  assert.deepEqual(
    store.getState().diagnostics.map((d) => d.code),
    ["ol-limit"],
  );
});

test("with no prompt host at all, an `input` read cancels exactly as it did before #769", () => {
  const store = OL.createStudioState({ source: ASK_NAME_SOURCE });
  const controller = OL.createRunController(store);

  controller.run();

  assert.equal(store.getState().runStatus, "stopped");
  assert.deepEqual(store.getState().output, ["before"]);
  assert.equal(store.getState().diagnostics[0].code, "ol-limit");
});

test("the run log records ONE entry per answered chain, never one per attempt", () => {
  const store = OL.createStudioState({ source: ASK_NAME_SOURCE });
  const host = createTestPromptHost();
  const controller = OL.createRunController(store, { inputPrompt: host });
  const runLog = OL.createRunLogController(store);

  controller.run();
  host.respond("tom");

  const entries = runLog.getEntries();
  assert.equal(entries.length, 1);
  assert.equal(entries[0].runStatus, "done");
  assert.deepEqual(entries[0].output, ["before", "tom"]);
  assert.deepEqual(entries[0].diagnostics, []);
});

test("the run log records a dismissed chain once, with the read's real cancellation diagnostic", () => {
  const store = OL.createStudioState({ source: ASK_NAME_SOURCE });
  const host = createTestPromptHost();
  const controller = OL.createRunController(store, { inputPrompt: host });
  const runLog = OL.createRunLogController(store);

  controller.run();
  host.respond(undefined);

  const entries = runLog.getEntries();
  assert.equal(entries.length, 1);
  assert.equal(entries[0].runStatus, "stopped");
  assert.deepEqual(entries[0].output, ["before"]);
  assert.deepEqual(
    entries[0].diagnostics.map((diagnostic) => diagnostic.code),
    ["ol-limit"],
  );
});

test("tutor output emitted before a read is not duplicated by the replay", () => {
  const store = OL.createStudioState({
    source: [
      "forward 10",
      "explain",
      ':name = input "who?"',
      "print :name",
    ].join("\n"),
  });
  const host = createTestPromptHost();
  const controller = OL.createRunController(store, { inputPrompt: host });
  const tutorOutput = OL.createTutorOutputController(store);

  controller.run();
  assert.equal(store.getState().tutorOutput.length, 1);

  host.respond("tom");

  assert.equal(store.getState().tutorOutput.length, 1);
  assert.equal(tutorOutput.getEntries().length, 1);
});

test("editing the editor while a question is open cannot swap the program the answer applies to", () => {
  const store = OL.createStudioState({ source: ASK_NAME_SOURCE });
  const host = createTestPromptHost();
  const controller = OL.createRunController(store, { inputPrompt: host });

  controller.run();
  store.setSource('print "a totally different program"');
  host.respond("tom");

  assert.deepEqual(store.getState().output, ["before", "tom"]);
  assert.equal(store.getState().lastRunResult.source, ASK_NAME_SOURCE);
});

test("a paced scheduler asks the question only once the picture up to the read is drawn", () => {
  const paced = createManualScheduler();
  const store = OL.createStudioState({
    source: ["forward 10", "forward 10", ':name = input "who?"'].join("\n"),
  });
  const host = createTestPromptHost();
  const controller = OL.createRunController(store, {
    inputPrompt: host,
    scheduler: paced.scheduler,
  });

  controller.run();
  assert.deepEqual(
    host.prompts,
    [],
    "nothing has been drawn yet, so nothing may be asked yet",
  );

  paced.drain();

  assert.deepEqual(host.prompts, ["who?"]);
  assert.equal(store.getState().runStatus, "running");
});

test("stop() during a paced probe animation, before the question is even shown, still commits the cancellation", () => {
  const paced = createManualScheduler();
  const store = OL.createStudioState({
    source: ['print "before"', ':name = input "who?"'].join("\n"),
  });
  const host = createTestPromptHost();
  const controller = OL.createRunController(store, {
    inputPrompt: host,
    scheduler: paced.scheduler,
  });

  controller.run();
  assert.deepEqual(host.prompts, []);
  controller.stop();

  assert.equal(
    host.dismissCount,
    0,
    "there was no presented question to take down",
  );
  assert.equal(store.getState().runStatus, "stopped");
  assert.equal(store.getState().diagnostics[0].code, "ol-limit");
});

test("the resume animates the movement the learner's own answer produced — it never swallows it (a read INSIDE a drawing instruction)", () => {
  // Round 1, logic/spec reviewer, blocking finding 2. The prefix a previous attempt drew is
  // measured in EVENTS, but an animation advances in instruction-aligned STEPS, and the two do
  // not line up at the read: `forward input "how far?"` contributes only its own `instruction`
  // event to the probe, and the answer extends that SAME step with the move/draw-segment it
  // produces. Fast-forwarding merely "past the event count" consumed them, so the drawing the
  // answer just enabled was never animated.
  const paced = createManualScheduler();
  const store = OL.createStudioState({ source: 'forward input "how far?"' });
  const host = createTestPromptHost();
  const controller = OL.createRunController(store, {
    inputPrompt: host,
    scheduler: paced.scheduler,
  });

  controller.run();
  paced.drain();
  assert.deepEqual(host.prompts, ["how far?"]);
  assert.deepEqual(
    store.getState().turtleScene.items,
    [],
    "nothing is drawn yet — the instruction is still waiting on the read",
  );

  host.respond("60");
  assert.ok(
    paced.queue.length > 0,
    "the answered instruction's own move/draw-segment must still be queued for paced playback, " +
      "never consumed by the resume",
  );
  paced.drain();

  const literalStore = OL.createStudioState({ source: "forward 60" });
  OL.createRunController(literalStore).run();
  assert.deepEqual(
    store.getState().turtleScene,
    literalStore.getState().turtleScene,
  );
  assert.equal(store.getState().runStatus, "done");
});

test("the resume skips only the steps already drawn, so the canvas grows and never replays from blank", () => {
  const paced = createManualScheduler();
  const store = OL.createStudioState({
    source: [
      "forward 10",
      "right 90",
      "forward 10",
      ':name = input "who?"',
      "forward 10",
    ].join("\n"),
  });
  const host = createTestPromptHost();
  const controller = OL.createRunController(store, {
    inputPrompt: host,
    scheduler: paced.scheduler,
  });

  controller.run();
  paced.drain();
  const drawnAtPrompt = store.getState().turtleScene.items.length;
  assert.ok(drawnAtPrompt > 0, "the picture up to the read must be on screen");

  // Every scene published from here on must be at least as complete as the one the learner is
  // looking at while they answer — a replay that redrew from a blank canvas would dip below it.
  const itemCounts = [];
  store.subscribe((next) => {
    itemCounts.push(next.turtleScene.items.length);
  });
  host.respond("tom");
  paced.drain();

  assert.ok(itemCounts.length > 0, "the resumed run must publish scenes");
  assert.equal(
    itemCounts.filter((count) => count < drawnAtPrompt).length,
    0,
    `the picture must only ever grow; saw ${JSON.stringify(itemCounts)} against ${drawnAtPrompt}`,
  );
  assert.equal(store.getState().runStatus, "done");
});

test("answers are bound by position even when two reads ask the identical question", () => {
  const store = OL.createStudioState({
    source: [
      ':first = input "value?"',
      ':second = input "value?"',
      "print :first",
      "print :second",
    ].join("\n"),
  });
  const given = ["one", "two"];
  const host = createTestPromptHost((_prompt, index) => given[index]);
  const controller = OL.createRunController(store, { inputPrompt: host });

  controller.run();

  assert.deepEqual(host.prompts, ["value?", "value?"]);
  assert.deepEqual(store.getState().output, ["one", "two"]);
});

test("each answer is remembered with the question it answered, so a replay can only reuse it for that same question", () => {
  // Round 1, logic/spec reviewer, blocking finding 1 (the dangerous half). A replay re-executes
  // the whole program, and an unseeded `random` before a read can make the replayed prefix reach a
  // DIFFERENT question at the same position. Matching on prompt as well as position is what stops
  // an answer being silently applied to a question the learner never saw. Asserted deterministically
  // here on the ordinary (non-diverging) path: every read must receive the answer given for its own
  // prompt, and a question that is re-asked must be re-answered rather than served from the FIFO.
  const store = OL.createStudioState({
    source: [
      ':sides = input "how many sides?"',
      ':colour = input "what colour?"',
      "print :sides",
      "print :colour",
    ].join("\n"),
  });
  const answerFor = { "how many sides?": "5", "what colour?": "red" };
  const host = createTestPromptHost((prompt) => answerFor[prompt]);
  const controller = OL.createRunController(store, { inputPrompt: host });

  controller.run();

  assert.deepEqual(host.prompts, ["how many sides?", "what colour?"]);
  assert.deepEqual(
    store.getState().output,
    ["5", "red"],
    "each value must be the answer given for ITS OWN question",
  );
});

test("resuming costs only the ticks the previous attempt did NOT already draw (the resume is proven, not merely covered)", () => {
  // Round 1, @testing BLOCK-2. Terminal state is invariant under the resume — `step()` folds every
  // event either way — so a test that only checks the final scene passes even with the resume
  // deleted (`shownEventCount` forced to 0 is a surviving mutant). The observable difference is how
  // much PACED work the next attempt still has to do, which is what this measures.
  const paced = createManualScheduler();
  const store = OL.createStudioState({
    source: [
      "forward 10",
      "forward 10",
      "forward 10",
      ':distance = input "how far?"',
      "forward :distance",
    ].join("\n"),
  });
  const host = createTestPromptHost();
  const controller = OL.createRunController(store, {
    inputPrompt: host,
    scheduler: paced.scheduler,
  });

  controller.run();
  const ticksBeforeTheQuestion = paced.drain();
  assert.deepEqual(host.prompts, ["how far?"]);
  assert.ok(
    ticksBeforeTheQuestion >= 4,
    `expected the whole prefix to be paced, saw ${ticksBeforeTheQuestion} ticks`,
  );

  host.respond("30");
  const ticksAfterTheAnswer = paced.drain();

  assert.ok(
    ticksAfterTheAnswer < ticksBeforeTheQuestion,
    "the answered attempt must resume, not replay: it may only pace the steps the learner has " +
      `not already seen, but it paced ${ticksAfterTheAnswer} of ${ticksBeforeTheQuestion}`,
  );
  assert.ok(
    ticksAfterTheAnswer >= 1,
    "the instruction the answer unblocked must still be animated",
  );
  assert.equal(store.getState().runStatus, "done");
});

test("a read inside `repeat` draws from the same FIFO on every pass", () => {
  const store = OL.createStudioState({
    source: ['repeat 3 [ :value = input "value?" print :value ]'].join("\n"),
  });
  const given = ["a", "b", "c"];
  const host = createTestPromptHost((_prompt, index) => given[index]);
  const controller = OL.createRunController(store, { inputPrompt: host });

  controller.run();

  assert.deepEqual(host.prompts, ["value?", "value?", "value?"]);
  assert.deepEqual(store.getState().output, ["a", "b", "c"]);
  assert.equal(store.getState().runStatus, "done");
});

test("a read inside a procedure body draws from the same FIFO on every call", () => {
  const store = OL.createStudioState({
    source: [
      "define ask",
      '  :value = input "value?"',
      "  print :value",
      "end",
      "ask",
      "ask",
    ].join("\n"),
  });
  const given = ["x", "y"];
  const host = createTestPromptHost((_prompt, index) => given[index]);
  const controller = OL.createRunController(store, { inputPrompt: host });

  controller.run();

  assert.deepEqual(host.prompts, ["value?", "value?"]);
  assert.deepEqual(store.getState().output, ["x", "y"]);
  assert.equal(store.getState().runStatus, "done");
});

test("cancelling the SECOND question keeps the first answer's work and cancels from there", () => {
  const store = OL.createStudioState({
    source: [
      ':first = input "first?"',
      "print :first",
      ':second = input "second?"',
      "print :second",
    ].join("\n"),
  });
  const host = createTestPromptHost();
  const controller = OL.createRunController(store, { inputPrompt: host });

  controller.run();
  host.respond("alpha");
  assert.deepEqual(host.prompts, ["first?", "second?"]);
  assert.deepEqual(store.getState().output, ["alpha"]);
  assert.equal(store.getState().runStatus, "running");

  host.respond(undefined);

  assert.equal(store.getState().runStatus, "stopped");
  assert.deepEqual(
    store.getState().output,
    ["alpha"],
    "the work the first answer unblocked stays on screen",
  );
  assert.deepEqual(
    store.getState().diagnostics.map((diagnostic) => diagnostic.code),
    ["ol-limit"],
  );
});

test("an answer that reads as a number is reported as one (spec/interaction-events.md:136-137), unchanged by the replay", () => {
  const store = OL.createStudioState({
    source: [':count = input "how many?"', "print :count + 1"].join("\n"),
  });
  const host = createTestPromptHost(() => "41");
  const controller = OL.createRunController(store, { inputPrompt: host });

  controller.run();

  assert.deepEqual(
    store.getState().output,
    ["42"],
    "the studio never re-classifies the answer — the runtime does, and the replay must not alter it",
  );
  assert.deepEqual(store.getState().diagnostics, []);
});

test("a host that answers synchronously still produces exactly ONE run-log entry", () => {
  // Round 1, @testing N7. `settleAttempt`'s `pumpAgain` guard is what stops a probe committing a
  // terminal runStatus when the answer arrives from inside the very attempt that asked. The async
  // host can never exercise it, so the guard would otherwise be a surviving mutant.
  const store = OL.createStudioState({ source: ASK_NAME_SOURCE });
  const host = createTestPromptHost(() => "tom");
  const controller = OL.createRunController(store, { inputPrompt: host });
  const runLog = OL.createRunLogController(store);

  controller.run();

  const entries = runLog.getEntries();
  assert.equal(
    entries.length,
    1,
    "a probe attempt must never commit a terminal status of its own",
  );
  assert.equal(entries[0].runStatus, "done");
  assert.deepEqual(entries[0].output, ["before", "tom"]);
});

test("reduced motion paints the answered run instantly and still finishes the chain", () => {
  const store = OL.createStudioState({
    source: [
      "forward 50",
      ':distance = input "how far?"',
      "forward :distance",
    ].join("\n"),
  });
  const host = createTestPromptHost();
  const controller = OL.createRunController(store, {
    inputPrompt: host,
    reducedMotion: true,
  });

  controller.run();
  assert.deepEqual(host.prompts, ["how far?"]);
  host.respond("70");

  const literalStore = OL.createStudioState({
    source: "forward 50\nforward 70",
  });
  OL.createRunController(literalStore, { reducedMotion: true }).run();

  assert.equal(store.getState().runStatus, "done");
  assert.deepEqual(
    store.getState().turtleScene,
    literalStore.getState().turtleScene,
  );
});

test("a host that answers the same question twice is ignored the second time", () => {
  const store = OL.createStudioState({ source: ASK_NAME_SOURCE });
  const host = createTestPromptHost();
  const controller = OL.createRunController(store, { inputPrompt: host });

  controller.run();
  const respond = host.respond;
  respond("tom");
  respond("jerry");

  assert.deepEqual(store.getState().output, ["before", "tom"]);
  assert.equal(store.getState().runStatus, "done");
});

/**
 * `resolveRecordedAnswer` — round 2, @testing BLOCK-3. The prompt-binding mitigation was
 * behaviour-changing, learner-visible, and load-bearing for the ruling that shipped this slice, yet
 * reverting it to the round-1 positional reader killed no test: the divergence it guards can only
 * be provoked through the public API by unseeded `random`, so it cannot be reached deterministically
 * from a `run()`. Extracting the decision makes it directly provable — these are the assertions the
 * mitigation was missing.
 */

test("resolveRecordedAnswer: a read with no answer recorded for its position must be asked", () => {
  assert.deepEqual(OL.resolveRecordedAnswer([], 0, "who?"), {
    answer: undefined,
    retained: [],
  });
});

test("resolveRecordedAnswer: an answer recorded for THIS question is reused, and the chain keeps every answer", () => {
  const answers = [
    { prompt: "who?", answer: "tom" },
    { prompt: "how old?", answer: "9" },
  ];

  assert.deepEqual(OL.resolveRecordedAnswer(answers, 0, "who?"), {
    answer: "tom",
    retained: answers,
  });
  assert.deepEqual(OL.resolveRecordedAnswer(answers, 1, "how old?"), {
    answer: "9",
    retained: answers,
  });
});

test("resolveRecordedAnswer: an answer recorded for a DIFFERENT question is never reused — it is dropped and the question is asked", () => {
  // The whole point of the mitigation: `"5"` was given for "how many sides?", so a replay that
  // reaches "what colour?" at that position must NOT receive it.
  const answers = [
    { prompt: "how many sides?", answer: "5" },
    { prompt: "and then?", answer: "later" },
  ];

  assert.deepEqual(OL.resolveRecordedAnswer(answers, 0, "what colour?"), {
    answer: undefined,
    retained: [],
  });
});

test("resolveRecordedAnswer: a divergence drops the answers AFTER it too, never just the mismatching one", () => {
  // Everything past a divergence answers questions this attempt is not asking — keeping them would
  // reintroduce the same misattribution one position later.
  const answers = [
    { prompt: "first?", answer: "a" },
    { prompt: "second?", answer: "b" },
    { prompt: "third?", answer: "c" },
  ];

  assert.deepEqual(OL.resolveRecordedAnswer(answers, 1, "something else?"), {
    answer: undefined,
    retained: [{ prompt: "first?", answer: "a" }],
  });
});

test("resolveRecordedAnswer: identical prompt text at different positions is answered positionally", () => {
  // Since #881 pinned one random seed per chain, a read's FIFO position is stable across attempts,
  // so answering positionally IS answering by read identity — which is what lets two distinct
  // `input` sites asking the same question each receive their own answer.
  const answers = [
    { prompt: "value?", answer: "one" },
    { prompt: "value?", answer: "two" },
  ];

  assert.equal(OL.resolveRecordedAnswer(answers, 0, "value?").answer, "one");
  assert.equal(OL.resolveRecordedAnswer(answers, 1, "value?").answer, "two");
});

test("the run controller resolves every read through resolveRecordedAnswer, so a replay reuses answers only for their own question", () => {
  const store = OL.createStudioState({
    source: [
      ':sides = input "how many sides?"',
      ':colour = input "what colour?"',
      "print :sides",
      "print :colour",
    ].join("\n"),
  });
  const answerFor = { "how many sides?": "5", "what colour?": "red" };
  const host = createTestPromptHost((prompt) => answerFor[prompt]);

  OL.createRunController(store, { inputPrompt: host }).run();

  assert.deepEqual(host.prompts, ["how many sides?", "what colour?"]);
  assert.deepEqual(
    store.getState().output,
    ["5", "red"],
    "each value must be the answer given for ITS OWN question",
  );
});

test("issue #881: the scenario that used to make a replay diverge now completes as ONE run", () => {
  // This test's ancestor (round 3 of #769, logic/spec reviewer) pinned the OPPOSITE behaviour: it
  // patched `Date.now` so the runtime reseeded 1 → 7 → 7 across attempts, proving the learner was
  // re-asked when the replay reached a different question. That divergence is what #881 called a
  // conformance problem, and it is now impossible: `run()` pins ONE seed per chain, so the same
  // fixture — same program, same two branch-selecting seeds, now supplied through the public
  // `randomSeedSource` seam — asks exactly one question and finishes as the run the learner was
  // answering. The seed source deliberately yields a DIFFERENT seed on each call, so an
  // implementation that drew per attempt instead of per chain still diverges here.
  const store = OL.createStudioState({
    source: [
      'if (random 2) == 0 [ :answer = input "A?" ] else [ :answer = input "B?" ]',
      "print :answer",
    ].join("\n"),
  });
  const host = createTestPromptHost((prompt) => `answered-${prompt}`);

  OL.createRunController(store, {
    inputPrompt: host,
    randomSeedSource: createSeedQueue([1, 7, 7]),
  }).run();

  assert.deepEqual(
    host.prompts,
    ["B?"],
    "seed 1 selects the else branch, and the replay must reach that same question",
  );
  assert.deepEqual(
    store.getState().output,
    ["answered-B?"],
    "the program receives the answer given for the question it asked",
  );
  assert.equal(store.getState().runStatus, "done");
});

test("issue #881: an answer is still bound to its own question, by construction", () => {
  // `resolveRecordedAnswer`'s pairing is kept as defence in depth even though the chain can no
  // longer diverge, so the rule it enforces is still asserted directly: an answer recorded for one
  // question is never handed to a different one, and the rest of the FIFO is dropped with it.
  const answers = [{ prompt: "how many sides?", answer: "5" }];

  const diverged = OL.resolveRecordedAnswer(answers, 0, "what colour?");

  assert.equal(diverged.answer, undefined);
  assert.deepEqual(diverged.retained, []);
});

test("a legitimate program with many more reads than one attempt can answer still completes", () => {
  // Round 4, logic/spec reviewer. The first version of #769's retry cap counted TOTAL attempts, so
  // a valid program with N reads needed N+1 attempts and was cancelled after the learner's last
  // answer. #881 removed the cap entirely (see `run-controller.ts`'s doc comment), but the property
  // it protected is the one that matters and is asserted here directly: a chain answers one more
  // read every attempt, so a program asking many questions must simply finish.
  const reads = 70;
  const store = OL.createStudioState({
    source: [
      `repeat ${reads} [ :value = input "value?" ]`,
      'print "done"',
    ].join("\n"),
  });
  const host = createTestPromptHost(() => "ok");

  OL.createRunController(store, { inputPrompt: host }).run();

  assert.equal(host.prompts.length, reads);
  assert.deepEqual(store.getState().output, ["done"]);
  assert.deepEqual(store.getState().diagnostics, []);
  assert.equal(store.getState().runStatus, "done");
});

test("re-running the same input program many times keeps completing (per-chain state is reset)", () => {
  // Round 4, @testing BLOCK-5. Their MD4 mutant — deleting run()'s reset of the chain's own state —
  // survived all 130 studio tests, and the consequence they measured is worse than a spurious
  // cancel: a later run of the SAME program stops before executing anything, so
  // commitCancelledRead() republishes the PREVIOUS run's events under a "stopped" status. A
  // completed run's output showing beneath a cancelled one. The reset is still load-bearing after
  // #881 — `answers`, `chainSource`, `shownEventCount` and the chain's pinned seed all belong to
  // one chain, not to the session — so the loop stays.
  const store = OL.createStudioState({ source: ASK_NAME_SOURCE });
  const controller = OL.createRunController(store, {
    inputPrompt: createTestPromptHost(() => "tom"),
  });

  for (let run = 1; run <= 68; run += 1) {
    controller.run();
    assert.equal(
      store.getState().runStatus,
      "done",
      `run ${run} must still complete — chain state belongs to one chain, not the session`,
    );
    assert.deepEqual(store.getState().output, ["before", "tom"]);
    assert.deepEqual(store.getState().diagnostics, []);
  }
});

// --- issue #881: one pinned random seed per chain makes the replay a genuine continuation --------
//
// Every test below injects a seed source that hands out a DIFFERENT seed on every call. That is
// the mutation check baked into the fixture: an implementation that drew the seed per *attempt*
// instead of per *chain* diverges deterministically here, rather than only when the wall clock
// happens to disagree. The two seeds used throughout (1 and 7) genuinely pick opposite branches of
// `random 2`, and 11/22 genuinely print different numbers — verified directly, not assumed.

/** A seed source that yields `seeds` in order, then keeps returning the last one. */
function createSeedQueue(seeds) {
  const remaining = [...seeds];
  let last = seeds[seeds.length - 1];
  return () => {
    if (remaining.length > 0) {
      last = remaining.shift();
    }
    return last;
  };
}

/** Chooses WHICH question to ask from an unseeded `random` — issue #881's exact program class. */
const RANDOM_BRANCH_SOURCE = [
  'if (random 2) == 0 [ :answer = input "how many sides?" ] else [ :answer = input "what colour?" ]',
  "print :answer",
].join("\n");

test("issue #881: a random-chosen question is asked once and does not change under the replay", () => {
  const store = OL.createStudioState({ source: RANDOM_BRANCH_SOURCE });
  const host = createTestPromptHost();
  const controller = OL.createRunController(store, {
    inputPrompt: host,
    randomSeedSource: createSeedQueue([1, 7]),
  });

  controller.run();
  assert.deepEqual(host.prompts, ["what colour?"]);

  host.respond("red");

  assert.deepEqual(
    host.prompts,
    ["what colour?"],
    "the chain's pinned seed means the replay reaches the SAME question, so it is never re-asked",
  );
  assert.deepEqual(store.getState().output, ["red"]);
  assert.equal(store.getState().runStatus, "done");
  assert.deepEqual(store.getState().diagnostics, []);
});

test("issue #881: the pinned seed decides the branch — the other seed asks the other question", () => {
  const store = OL.createStudioState({ source: RANDOM_BRANCH_SOURCE });
  const host = createTestPromptHost();
  const controller = OL.createRunController(store, {
    inputPrompt: host,
    randomSeedSource: createSeedQueue([7, 1]),
  });

  controller.run();
  host.respond("5");

  assert.deepEqual(host.prompts, ["how many sides?"]);
  assert.deepEqual(store.getState().output, ["5"]);
  assert.equal(store.getState().runStatus, "done");
});

test("issue #881: output the learner already observed is never rewritten by a later attempt", () => {
  const store = OL.createStudioState({
    source: ["print random 1000000", ':a = input "next?"', "print :a"].join(
      "\n",
    ),
  });
  const host = createTestPromptHost();
  const controller = OL.createRunController(store, {
    inputPrompt: host,
    randomSeedSource: createSeedQueue([11, 22]),
  });

  controller.run();
  const observed = [...store.getState().output];
  assert.equal(
    observed.length,
    1,
    "the draw before the read is already on screen",
  );

  host.respond("7");

  assert.deepEqual(
    store.getState().output,
    [...observed, "7"],
    "the completed run EXTENDS what was observed rather than replacing it",
  );
});

test("issue #881: the drawing the learner already observed is never rewritten either", () => {
  const store = OL.createStudioState({
    source: [
      "forward random 100",
      ':a = input "how far next?"',
      "forward :a",
    ].join("\n"),
  });
  const host = createTestPromptHost();
  const controller = OL.createRunController(store, {
    inputPrompt: host,
    randomSeedSource: createSeedQueue([11, 22]),
  });

  controller.run();
  const observed = store
    .getState()
    .turtleScene.items.map((item) => JSON.stringify(item));
  assert.equal(observed.length, 1, "the move before the read is already drawn");

  host.respond("40");

  const finalItems = store
    .getState()
    .turtleScene.items.map((item) => JSON.stringify(item));
  assert.equal(finalItems.length, 2);
  assert.equal(
    finalItems[0],
    observed[0],
    "the segment already drawn must be identical, not merely present",
  );
});

test("issue #881: two input sites asking the identical prompt text each receive their own answer", () => {
  const store = OL.createStudioState({
    source: [
      "print random 1000000",
      ':a = input "value?"',
      ':b = input "value?"',
      "print :a",
      "print :b",
    ].join("\n"),
  });
  const host = createTestPromptHost();
  const controller = OL.createRunController(store, {
    inputPrompt: host,
    randomSeedSource: createSeedQueue([5, 6, 7]),
  });

  controller.run();
  host.respond("first");
  host.respond("second");

  assert.deepEqual(host.prompts, ["value?", "value?"]);
  const output = store.getState().output;
  assert.deepEqual(
    output.slice(1),
    ["first", "second"],
    "each read's own answer reaches its own source location, in order",
  );
  assert.equal(store.getState().runStatus, "done");
});

test("issue #881: the seed source is consulted exactly ONCE per chain, however many reads there are", () => {
  // The invariant every other #881 guarantee rests on, pinned directly rather than inferred from a
  // symptom. If a future change draws the seed per attempt instead of per chain, the replay can
  // diverge again — and the no-progress retry cap this slice removed (see `run-controller.ts`'s
  // doc comment) would become necessary again, silently. This test fails the moment that premise
  // moves, so the dependency is visible rather than remembered.
  let draws = 0;
  const store = OL.createStudioState({
    source: [
      "print random 1000000",
      ':a = input "one?"',
      ':b = input "two?"',
      ':c = input "three?"',
      "print :c",
    ].join("\n"),
  });
  const host = createTestPromptHost(() => "ok");

  OL.createRunController(store, {
    inputPrompt: host,
    randomSeedSource: () => {
      draws += 1;
      return 4242;
    },
  }).run();

  assert.equal(host.prompts.length, 3, "three reads, so four attempts");
  assert.equal(
    draws,
    1,
    "one chain draws one seed — four attempts must NOT draw four seeds",
  );
  assert.equal(store.getState().runStatus, "done");
});

test("issue #881: a second run() starts a new chain and therefore draws a new seed", () => {
  let draws = 0;
  const store = OL.createStudioState({ source: ASK_NAME_SOURCE });
  const controller = OL.createRunController(store, {
    inputPrompt: createTestPromptHost(() => "tom"),
    randomSeedSource: () => {
      draws += 1;
      return draws;
    },
  });

  controller.run();
  controller.run();

  assert.equal(
    draws,
    2,
    "the pin belongs to one chain, not to the controller's lifetime",
  );
});

test("issue #881: a run with no injected seed source still completes (the Date.now default)", () => {
  const store = OL.createStudioState({ source: ASK_NAME_SOURCE });
  const host = createTestPromptHost();
  const controller = OL.createRunController(store, { inputPrompt: host });

  controller.run();
  host.respond("tom");

  assert.deepEqual(store.getState().output, ["before", "tom"]);
  assert.equal(store.getState().runStatus, "done");
});

// --- a synchronous host that ends the chain from inside present() -------------------------------
// Round 2, logic/spec reviewer. A synchronous host may call `respond()` and THEN `stop()`/`reset()`
// before `present()` returns. The answer queues a replay (`pumpAgain`); the lifecycle call then
// unwinds into the pump loop, which used to run one more attempt over the top of the outcome
// Stop/Reset had already committed. Measured before the fix: `respond(); stop()` replaced the
// output the learner had just seen with `[]`, and `respond(); reset()` settled `"done"` with an
// empty `lastRunResult.source` instead of `"idle"`. Both are exactly the "already-observed state is
// never rewritten" guarantee #881 claims, so they are pinned here.

/**
 * A host whose `present()` hands the controller AND the responder to `act`, so a test can pin the
 * exact re-entrant order it cares about — answer then stop, answer then reset, or stop without
 * answering at all.
 */
function createEndingPromptHost(act) {
  const host = {
    prompts: [],
    dismissCount: 0,
    controller: null,
    present(request, respond) {
      host.prompts.push(request.prompt);
      act(host.controller, respond);
    },
    dismiss() {
      host.dismissCount += 1;
    },
  };
  return host;
}

const DRAW_ASK_PRINT_SOURCE = [
  "print random 1000000",
  ':a = input "next?"',
  "print :a",
].join("\n");

test("a host that answers and then stops, inside present(), keeps the output already shown", () => {
  const store = OL.createStudioState({ source: DRAW_ASK_PRINT_SOURCE });
  const host = createEndingPromptHost((controller, respond) => {
    respond("7");
    controller.stop();
  });
  const controller = OL.createRunController(store, {
    inputPrompt: host,
    randomSeedSource: createSeedQueue([11]),
  });
  host.controller = controller;

  controller.run();

  assert.equal(store.getState().runStatus, "stopped");
  assert.deepEqual(
    store.getState().output,
    ["511587"],
    "Stop must not let a queued replay erase what the learner already saw",
  );
});

test("a host that answers and then resets, inside present(), settles idle rather than running again", () => {
  const store = OL.createStudioState({ source: DRAW_ASK_PRINT_SOURCE });
  const host = createEndingPromptHost((controller, respond) => {
    respond("7");
    controller.reset();
  });
  const controller = OL.createRunController(store, {
    inputPrompt: host,
    randomSeedSource: createSeedQueue([11]),
  });
  host.controller = controller;

  controller.run();

  assert.equal(store.getState().runStatus, "idle");
  assert.deepEqual(store.getState().output, []);
  assert.equal(
    store.getState().lastRunResult,
    null,
    "a queued replay must not commit a run over the top of Reset — least of all one whose source Reset had already cleared",
  );
});

test("a host that stops from inside present() WITHOUT answering has its question withdrawn", () => {
  // The other order, and the one that reaches `dismiss()`: nothing was answered, so the read really
  // did end unanswered and Stop must withdraw the question rather than leave it on screen.
  const store = OL.createStudioState({ source: DRAW_ASK_PRINT_SOURCE });
  const host = createEndingPromptHost((controller) => {
    controller.stop();
  });
  const controller = OL.createRunController(store, {
    inputPrompt: host,
    randomSeedSource: createSeedQueue([11]),
  });
  host.controller = controller;

  controller.run();

  assert.equal(host.dismissCount, 1, "Stop must take the question down");
  assert.equal(store.getState().runStatus, "stopped");
  assert.deepEqual(
    store.getState().diagnostics.map((diagnostic) => diagnostic.code),
    ["ol-limit"],
    "the read ended unanswered, so the runtime's own cancellation is published",
  );
});
