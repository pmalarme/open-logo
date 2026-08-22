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
    /** Run queued ticks until the queue drains (bounded, so a bug cannot hang the suite). */
    drain() {
      let drained = 0;
      while (queue.length > 0 && drained < 100) {
        const next = queue.shift();
        drained += 1;
        next();
      }
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

  assert.deepEqual(
    askingStore.getState().turtleScene,
    literalStore.getState().turtleScene,
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
