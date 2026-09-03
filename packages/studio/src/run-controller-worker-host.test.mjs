// The run controller driving the **blocking** execution host (#876) — the studio as a learner
// experiences it once a Worker, rather than a replay, is answering `input`.
//
// The controller composes an `ExecutionHost` instead of calling `execute()` itself, so these tests
// install `worker-execution-host.ts` over a port that runs the real Worker-side runner. Every seam
// is genuine — the shared-memory protocol, the reader that parks, the reports that come back — and
// only the thread is not, which is what keeps the whole path deterministic (issue #897). In a
// browser each hop is asynchronous; the controller tolerates both because a host settles through a
// callback either way, never a return value.
//
// The contrast to keep in mind throughout: the same programs under the default in-process host go
// through #769's replay, where N reads cost N+1 executions. Nothing here re-litigates whether that
// replay is *correct* — #881 settled that by pinning one random seed per chain. This is about the
// mechanism: one execution, a read that genuinely blocks, and a Stop that can preempt.

import assert from "node:assert/strict";
import { test } from "node:test";
import * as OL from "@openlogo/studio";
import { INITIAL_TURTLE_WORLD_STATE } from "@openlogo/turtle";

/** A prompt host that either holds the question open or answers it synchronously. */
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
 * A blocking host wired to the real Worker-side runner. `runCommandCount` is what proves the
 * mechanism: however many questions a program asks, the interpreter is started exactly once.
 *
 * A real Worker parked on `Atomics.wait` keeps its stack and resumes when the answer lands. Nothing
 * synchronous can do that, so when a question is left **unanswered** this harness unwinds the runner
 * instead of spinning — which is indistinguishable from the controller's side precisely because a
 * question that is never answered is never resumed from either. Answering from inside `present()`
 * (the shape most tests below use) needs none of that: the answer is already in shared memory before
 * `awaitBlockingRead` is reached, so the runner carries straight on, exactly as a woken Worker does.
 */
const PARKED = Symbol("the Worker is parked on Atomics.wait");

function createBlockingHost() {
  let listener = null;
  const state = { runCommandCount: 0 };
  const host = OL.createWorkerExecutionHost({
    allocateBuffer: (byteLength) => new ArrayBuffer(byteLength),
    notify: () => 1,
    port: {
      postMessage(command) {
        state.runCommandCount += 1;
        try {
          OL.runExecutionWorkerCommand(command, {
            wait: () => {
              throw PARKED;
            },
            post: (report) => listener?.(report),
          });
        } catch (error) {
          if (error !== PARKED) {
            throw error;
          }
        }
      },
      onReport(next) {
        listener = next;
      },
    },
  });
  return { host, state };
}

const ASK_NAME_SOURCE = [
  'print "before"',
  ':name = input "what is your name?"',
  "print :name",
].join("\n");

const DRAW_THEN_ASK_SOURCE = [
  "repeat 4 [ forward 100 right 90 ]",
  ':distance = input "how far now?"',
  "forward :distance",
].join("\n");

/**
 * A host that records what the controller asked of it and settles **only when a test says so** —
 * the shape a real Worker has, where every report crosses an event-loop turn. The synchronous
 * harness above cannot model Stop and Reset at all, because its runner has already unwound by the
 * time either is called: cancellation's whole job is to reach the thing that harness has deleted.
 * Review measured the cost of that blind spot — both `executionHost.cancel()` calls could be
 * removed with the entire suite green — so these are pinned directly.
 */
function createDeferredHost() {
  const calls = { runs: [], cancels: 0, resolved: [] };
  let settle = null;
  return {
    calls,
    /** Settle the run the controller is waiting on, as a Worker's report would. */
    report(settlement) {
      settle?.({
        events: [],
        output: [],
        tutorOutput: [],
        diagnostics: [],
        retainedAnswers: [],
        pendingPrompt: null,
        ...settlement,
      });
    },
    host: {
      execute(request, nextSettle) {
        calls.runs.push(request);
        settle = nextSettle;
      },
      cancel() {
        calls.cancels += 1;
        settle = null;
      },
      resolveRead(answer) {
        calls.resolved.push(answer);
      },
    },
  };
}

/**
 * A real settlement for `source`, produced by the in-process host — so the deferred tests below
 * carry genuine trace events, output and tutor payloads rather than hand-built stand-ins. A read
 * settlement with an **empty** event list is what let the first round of these tests miss that a
 * finished *prefix* animation could commit the whole run as done.
 */
function settlementFor(source) {
  const host = OL.createInProcessExecutionHost({ signal: { aborted: false } });
  let captured = null;
  host.execute(
    {
      source,
      document: "deferred.logo",
      randomSeed: 1,
      cancellationRequested: false,
      acceptsReads: false,
      answers: [],
    },
    (settlement) => {
      captured = settlement;
    },
  );
  return captured;
}

test("answering a suspended read does NOT commit the run as finished", () => {
  // The prefix animation has already reached "done" — it only ever held the events up to the
  // question — so without an in-flight guard the run is reported finished the moment the learner
  // answers: `runStatus` "done" over partial output, Run offered instead of Stop, and a live
  // Worker behind a UI that says the program ended.
  const prefix = settlementFor('print "before"\nforward 100');
  const store = OL.createStudioState({ source: ASK_NAME_SOURCE });
  const deferred = createDeferredHost();
  const prompt = createTestPromptHost(() => "Ada");
  const controller = OL.createRunController(store, {
    inputPrompt: prompt,
    executionHost: deferred.host,
  });
  controller.run();

  deferred.report({
    events: prefix.events,
    output: prefix.output,
    pendingPrompt: "what is your name?",
  });

  assert.deepEqual(deferred.calls.resolved, ["Ada"]);
  assert.equal(
    store.getState().runStatus,
    "running",
    "the interpreter is still executing — only its own ending may commit the run",
  );

  const whole = settlementFor('print "before"\nforward 100\nprint "Ada"');
  deferred.report({ events: whole.events, output: whole.output });

  assert.equal(store.getState().runStatus, "done");
  assert.deepEqual(store.getState().output, ["before", "Ada"]);
});

test("stepping while a resumed run is still executing cannot commit it either", () => {
  // Same defect reached through `step()` rather than through playback's trailing settle.
  const prefix = settlementFor('print "before"\nforward 100');
  const store = OL.createStudioState({ source: ASK_NAME_SOURCE });
  const deferred = createDeferredHost();
  const prompt = createTestPromptHost();
  const controller = OL.createRunController(store, {
    inputPrompt: prompt,
    executionHost: deferred.host,
  });
  controller.run();
  deferred.report({
    events: prefix.events,
    output: prefix.output,
    pendingPrompt: "what is your name?",
  });

  prompt.respond("Ada");
  controller.step();

  assert.equal(store.getState().runStatus, "running");
  assert.deepEqual(store.getState().output, ["before"]);
});

test("a new Run clears the tutor pane's per-run output, so an early Stop cannot duplicate it", () => {
  // `tutor-output-pane.ts` accumulates history from the store's `tutorOutput` field. Leaving the
  // previous run's payloads there meant an abandoned run appended them to the pane a second time.
  const explained = settlementFor("forward 100\nexplain");
  assert.equal(explained.tutorOutput.length > 0, true);
  const store = OL.createStudioState({ source: "forward 100\nexplain" });
  const deferred = createDeferredHost();
  const controller = OL.createRunController(store, {
    executionHost: deferred.host,
  });
  const pane = OL.createTutorOutputController(store);
  controller.run();
  deferred.report({
    events: explained.events,
    output: explained.output,
    tutorOutput: explained.tutorOutput,
  });
  const afterFirstRun = pane.getEntries().length;

  controller.run();
  controller.stop();

  assert.equal(pane.getEntries().length, afterFirstRun);
});

test("a new Run clears every field the previous run owned, so an early Stop leaves nothing behind", () => {
  // Deliberately fixtured with a program that produces a drawing **and** tutor output **and** a
  // diagnostic **and** an instruction span. The earlier version of this test used
  // `repeat 4 [ forward 100 right 90 ]`, which produces neither tutor output nor diagnostics — so
  // its `deepEqual(…, [])` assertions compared `[]` to `[]` and held whether or not the clears ran.
  // Coverage cannot see that: the lines execute either way, so the file still reported 100%.
  //
  // The second `run()` deliberately does NOT call `setSource()` first, because `setSource()`
  // already nulls `currentInstructionSourceSpan` — which would hide whether the chain-start clear
  // does. Measured consequence of leaving it: the editor keeps highlighting a line as "currently
  // executing" for a run that never executed it, permanently, because a cancelled run never settles.
  const source = "repeat 4 [ forward 100 right 90 ]\nexplain\nprint :nope";
  const settled = settlementFor(source);
  assert.equal(
    settled.diagnostics.length > 0,
    true,
    "fixture must produce a diagnostic",
  );
  assert.equal(
    settled.tutorOutput.length > 0,
    true,
    "fixture must produce tutor output",
  );

  const store = OL.createStudioState({ source });
  const deferred = createDeferredHost();
  const repaints = { count: 0 };
  const controller = OL.createRunController(store, {
    executionHost: deferred.host,
    canvasView: {
      repaint() {
        repaints.count += 1;
      },
    },
  });
  controller.run();
  deferred.report({
    events: settled.events,
    output: settled.output,
    tutorOutput: settled.tutorOutput,
    diagnostics: settled.diagnostics,
  });

  assert.equal(store.getState().turtleScene.items.length, 4);
  assert.equal(store.getState().tutorOutput.length > 0, true);
  assert.equal(store.getState().diagnostics.length > 0, true);
  assert.notEqual(store.getState().currentInstructionSourceSpan, null);
  // The one precondition with no sibling assertion until now. A run replaces the world with the
  // animation's own folded snapshot, so the identity check below only means something while this
  // holds — and if the fold were ever optimised to return the canonical object when nothing moved,
  // that check would silently become trivially true with nothing to flag it.
  assert.notEqual(store.getState().turtleWorld, INITIAL_TURTLE_WORLD_STATE);
  const repaintsBefore = repaints.count;

  controller.run();

  // Asserted BEFORE `stop()`: the point of this fix is that the clears happen at **chain start**,
  // so a Stop landing before the first settlement finds nothing of the previous run left. Clears
  // performed at Stop-time instead would satisfy every assertion below and leave the real property
  // guarded only incidentally, by an unrelated pre-existing animation test.
  assert.equal(store.getState().turtleScene.items.length, 0);
  assert.deepEqual(store.getState().tutorOutput, []);
  assert.deepEqual(store.getState().diagnostics, []);
  assert.equal(store.getState().currentInstructionSourceSpan, null);
  assert.equal(store.getState().turtleWorld, INITIAL_TURTLE_WORLD_STATE);
  assert.equal(
    repaints.count > repaintsBefore,
    true,
    "starting a run must repaint, or the pixels keep showing the run before it",
  );

  controller.stop();

  // …and still clear once the run is actually abandoned.
  assert.equal(store.getState().turtleScene.items.length, 0);
  assert.deepEqual(store.getState().tutorOutput, []);
  assert.deepEqual(store.getState().diagnostics, []);
  assert.equal(store.getState().currentInstructionSourceSpan, null);
  // The world is restored to `@openlogo/turtle`'s canonical program-start object, not merely to
  // something that looks like it — see the `notEqual` precondition above.
  assert.equal(store.getState().turtleWorld, INITIAL_TURTLE_WORLD_STATE);
});

test("Reset releases the in-flight guard too, so a later step is not wedged forever", () => {
  // The sibling of the `stop()` case below. Without it, Step is permanently dead after a Reset
  // during an in-flight Worker run: measured `runCommands 1 → 1`, `status idle`, step a no-op.
  const store = OL.createStudioState({ source: "forward 1" });
  const deferred = createDeferredHost();
  const controller = OL.createRunController(store, {
    executionHost: deferred.host,
  });
  controller.run();
  controller.reset();

  controller.step();

  assert.equal(deferred.calls.runs.length, 2);
});

test("under an asynchronous host, answering routes back into the SAME suspended run", () => {
  // The behaviour that makes this a blocking read rather than a replay, asserted at the seam the
  // controller actually uses: the answer goes to `resolveRead`, and no second execution is started.
  // The synchronous harness below proves the end-to-end effect; this proves the routing, across
  // event-loop turns, which is where a real Worker lives.
  const store = OL.createStudioState({ source: ASK_NAME_SOURCE });
  const deferred = createDeferredHost();
  const prompt = createTestPromptHost(() => "Ada");
  const controller = OL.createRunController(store, {
    inputPrompt: prompt,
    executionHost: deferred.host,
  });
  controller.run();

  deferred.report({
    events: settlementFor('print "before"').events,
    output: ["before"],
    pendingPrompt: "what is your name?",
  });

  assert.deepEqual(prompt.prompts, ["what is your name?"]);
  assert.deepEqual(deferred.calls.resolved, ["Ada"]);
  assert.equal(
    deferred.calls.runs.length,
    1,
    "answering continues the suspended run — it does not start another",
  );
  assert.equal(store.getState().runStatus, "running");
});

test("under an asynchronous host, dismissing also routes back into the suspended run", () => {
  // Both endings are the same operation once a read genuinely blocks: hand the outcome back and let
  // the run report what happened next. `undefined` is the runtime reader's own "cannot answer".
  const store = OL.createStudioState({ source: ASK_NAME_SOURCE });
  const deferred = createDeferredHost();
  const prompt = createTestPromptHost(() => undefined);
  const controller = OL.createRunController(store, {
    inputPrompt: prompt,
    executionHost: deferred.host,
  });
  controller.run();

  deferred.report({
    events: settlementFor('print "before"').events,
    output: ["before"],
    pendingPrompt: "what is your name?",
  });

  assert.deepEqual(deferred.calls.resolved, [undefined]);
  assert.equal(deferred.calls.runs.length, 1);
});

test("Stop reaches the host, so a Worker's running interpreter is actually cancelled", () => {
  // The single link the whole "Stop preempts a running loop" claim rests on. Without it a Stop does
  // not stop, a Worker parked on a question is never woken, and the abandoned run repaints the
  // canvas the learner just cleared.
  const store = OL.createStudioState({ source: "forward 1" });
  const deferred = createDeferredHost();
  const controller = OL.createRunController(store, {
    executionHost: deferred.host,
  });
  controller.run();

  controller.stop();

  assert.equal(deferred.calls.cancels, 1);
  assert.equal(store.getState().runStatus, "stopped");
});

test("Reset reaches the host too, so an abandoned run cannot repaint what was cleared", () => {
  const store = OL.createStudioState({ source: "forward 1" });
  const deferred = createDeferredHost();
  const controller = OL.createRunController(store, {
    executionHost: deferred.host,
  });
  controller.run();

  controller.reset();

  assert.equal(deferred.calls.cancels, 1);
  assert.equal(store.getState().runStatus, "idle");
});

test("Stop before the first settlement records THIS run, not the one before it", () => {
  // With a host that settles later, the previous run's output and `lastRunResult` would otherwise
  // still be in place when Stop lands — and `run-log.ts`, which snapshots `lastRunResult` on the
  // "running" → terminal transition, would record that earlier run a second time.
  const store = OL.createStudioState({ source: 'print "old"' });
  const deferred = createDeferredHost();
  const controller = OL.createRunController(store, {
    executionHost: deferred.host,
  });
  const log = OL.createRunLogController(store);
  controller.run();
  deferred.report({
    events: settlementFor('print "old"').events,
    output: ["old"],
  });
  assert.deepEqual(store.getState().output, ["old"]);

  store.setSource("forever [ forward 1 ]");
  controller.run();
  controller.stop();

  assert.deepEqual(store.getState().output, []);
  assert.deepEqual(store.getState().lastRunResult?.output, []);
  assert.deepEqual(
    log.getEntries().map((entry) => entry.output),
    [["old"], []],
    "the second entry is the stopped run's own empty result, not a duplicate of the first",
  );
});

test("a Run after Stop without Reset stays cancelled, exactly as the in-process host does", () => {
  // `stop()` latches the controller's signal and only `reset()` re-arms it. A Worker cannot see an
  // object's mutation, so the state travels as data on the request; without it the two hosts
  // disagreed — the in-process one halting with `ol-limit`, the Worker one running to completion.
  const store = OL.createStudioState({ source: "forward 1" });
  const deferred = createDeferredHost();
  const controller = OL.createRunController(store, {
    executionHost: deferred.host,
  });
  controller.run();
  controller.stop();

  controller.run();

  assert.deepEqual(
    deferred.calls.runs.map((request) => request.cancellationRequested),
    [false, true],
  );

  controller.reset();
  controller.run();
  assert.equal(deferred.calls.runs.at(-1).cancellationRequested, false);
});

test("step() never starts a second execution over one still in flight", () => {
  // The host owns a single cancellation channel, so two live runs would leave Stop reaching only
  // the newer of them — a Stop that does not stop the run the learner is watching.
  const store = OL.createStudioState({ source: "forward 1" });
  const deferred = createDeferredHost();
  const controller = OL.createRunController(store, {
    executionHost: deferred.host,
  });

  controller.step();
  controller.step();

  assert.equal(deferred.calls.runs.length, 1);
});

test("a settled attempt releases the in-flight guard, so stepping still works afterwards", () => {
  const store = OL.createStudioState({ source: "forward 1\nforward 1" });
  const deferred = createDeferredHost();
  const controller = OL.createRunController(store, {
    executionHost: deferred.host,
  });
  controller.step();
  deferred.report({ events: settlementFor("forward 1").events });

  controller.step();

  assert.equal(
    deferred.calls.runs.length,
    1,
    "the animation now exists, so stepping scrubs it rather than executing again",
  );
});

test("Stop releases the in-flight guard, so a later step is not wedged forever", () => {
  const store = OL.createStudioState({ source: "forward 1" });
  const deferred = createDeferredHost();
  const controller = OL.createRunController(store, {
    executionHost: deferred.host,
  });
  controller.run();
  controller.stop();

  controller.step();

  assert.equal(deferred.calls.runs.length, 2);
});

test("the question is put to the learner over the picture the program has already drawn", () => {
  // The regression this slice had to avoid. A Worker parked inside the reader is called with the
  // prompt and nothing else, so without `ExecuteOptions.observedEvents` (#876) it could not report
  // what had been drawn, and the question would appear over a BLANK canvas — worse than #769, which
  // draws the square and then asks. `spec/interaction-events.md:130-132` permits exactly this
  // ("the implementation MAY continue rendering already-emitted trace events").
  const store = OL.createStudioState({ source: DRAW_THEN_ASK_SOURCE });
  const { host } = createBlockingHost();
  const prompt = createTestPromptHost();
  const controller = OL.createRunController(store, {
    inputPrompt: prompt,
    executionHost: host,
  });

  controller.run();

  assert.deepEqual(prompt.prompts, ["how far now?"]);
  assert.equal(
    store.getState().turtleScene.items.length,
    4,
    "the whole square is on the canvas before the question is asked",
  );
  assert.equal(store.getState().runStatus, "running");
});

test("answering continues the SAME run — one execution, however many questions", () => {
  const store = OL.createStudioState({
    source: [
      ':a = input "first?"',
      'print "between"',
      ':b = input "second?"',
      "(print :a :b)",
    ].join("\n"),
  });
  const { host, state } = createBlockingHost();
  const prompt = createTestPromptHost((_text, index) => String(index + 1));
  const controller = OL.createRunController(store, {
    inputPrompt: prompt,
    executionHost: host,
  });

  controller.run();

  assert.deepEqual(prompt.prompts, ["first?", "second?"]);
  assert.deepEqual(store.getState().output, ["between", "1 2"]);
  assert.equal(store.getState().runStatus, "done");
  assert.equal(
    state.runCommandCount,
    1,
    "two questions cost one execution — the replay would have cost three",
  );
});

test("the output the learner has already seen is never rewritten by what comes after", () => {
  const store = OL.createStudioState({ source: ASK_NAME_SOURCE });
  const { host } = createBlockingHost();
  const observed = [];
  const prompt = createTestPromptHost(() => {
    observed.push([...store.getState().output]);
    return "Ada";
  });
  const controller = OL.createRunController(store, {
    inputPrompt: prompt,
    executionHost: host,
  });

  controller.run();

  assert.deepEqual(observed, [["before"]]);
  assert.deepEqual(store.getState().output, ["before", "Ada"]);
});

test("an error thrown while presenting a question is not swallowed by the run loop", () => {
  // A prompt host that throws would otherwise vanish inside the Worker boundary. Nothing here
  // catches it, so a real defect in a host surfaces as a real failure.
  const store = OL.createStudioState({ source: ASK_NAME_SOURCE });
  const { host } = createBlockingHost();
  const prompt = createTestPromptHost(() => {
    throw new Error("the prompt host is broken");
  });
  const controller = OL.createRunController(store, {
    inputPrompt: prompt,
    executionHost: host,
  });

  assert.throws(() => {
    controller.run();
  }, /the prompt host is broken/);
});

test("dismissing the question publishes the run's own cancellation, not an invented one", () => {
  // Under a Worker host the read really does end unanswered inside a live execution, so the
  // diagnostic the learner sees is the runtime's — `spec/interaction-events.md:132-133`'s other
  // ending for a read — rather than anything this module made up.
  const store = OL.createStudioState({ source: ASK_NAME_SOURCE });
  const { host } = createBlockingHost();
  const prompt = createTestPromptHost(() => undefined);
  const controller = OL.createRunController(store, {
    inputPrompt: prompt,
    executionHost: host,
  });

  controller.run();

  assert.equal(store.getState().runStatus, "stopped");
  assert.deepEqual(store.getState().output, ["before"]);
  assert.deepEqual(
    store.getState().diagnostics.map((diagnostic) => diagnostic.code),
    ["ol-limit"],
  );
});

test("Stop while a question is open withdraws it and commits the run as stopped", () => {
  const store = OL.createStudioState({ source: ASK_NAME_SOURCE });
  const { host } = createBlockingHost();
  const prompt = createTestPromptHost();
  const controller = OL.createRunController(store, {
    inputPrompt: prompt,
    executionHost: host,
  });
  controller.run();
  // Captured while the question was still open: `dismiss()` drops the responder, so reaching for
  // `prompt.respond` afterwards would short-circuit and assert nothing.
  const lateResponder = prompt.respond;

  controller.stop();

  assert.equal(prompt.dismissCount, 1);
  assert.equal(store.getState().runStatus, "stopped");
  assert.deepEqual(store.getState().output, ["before"]);
  // A host that ignored `dismiss()` and answered anyway must not revive the run — that is what the
  // controller's generation counter is for.
  lateResponder("Ada");
  assert.equal(store.getState().runStatus, "stopped");
  assert.deepEqual(store.getState().output, ["before"]);
});

test("Reset while a question is open clears the studio and cannot be settled over afterwards", () => {
  const store = OL.createStudioState({ source: DRAW_THEN_ASK_SOURCE });
  const { host } = createBlockingHost();
  const prompt = createTestPromptHost();
  const controller = OL.createRunController(store, {
    inputPrompt: prompt,
    executionHost: host,
  });
  controller.run();

  controller.reset();

  assert.equal(prompt.dismissCount, 1);
  assert.equal(store.getState().runStatus, "idle");
  assert.deepEqual(store.getState().output, []);
  assert.deepEqual(store.getState().diagnostics, []);
  assert.equal(store.getState().turtleScene.items.length, 0);
});

test("a program with no question runs to completion through the blocking host unchanged", () => {
  const store = OL.createStudioState({
    source: 'repeat 4 [ forward 100 right 90 ]\nprint "square"',
  });
  const { host, state } = createBlockingHost();
  const controller = OL.createRunController(store, { executionHost: host });

  controller.run();

  assert.deepEqual(store.getState().output, ["square"]);
  assert.equal(store.getState().runStatus, "done");
  assert.equal(store.getState().turtleScene.items.length, 4);
  assert.equal(state.runCommandCount, 1);
});

test("a runtime diagnostic still reaches the diagnostics pane through the host", () => {
  const store = OL.createStudioState({ source: "forward 100\nprint :nope" });
  const { host } = createBlockingHost();
  const controller = OL.createRunController(store, { executionHost: host });

  controller.run();

  assert.deepEqual(
    store.getState().diagnostics.map((diagnostic) => diagnostic.code),
    ["ol-undefined-var"],
  );
  assert.equal(store.getState().runStatus, "done");
  assert.equal(store.getState().turtleScene.items.length, 1);
});

test("step() from a blank studio still animates the first instruction", () => {
  // Stepping is a scrubber over an already-produced stream, so it installs no prompt host at all —
  // behaviour unchanged from #289, whichever host is running the program.
  const store = OL.createStudioState({
    source: "forward 100\nright 90\nforward 100",
  });
  const { host } = createBlockingHost();
  const controller = OL.createRunController(store, { executionHost: host });

  controller.step();

  assert.equal(store.getState().turtleScene.items.length, 1);
});

test("Run is ignored while a question is outstanding, so a chain cannot be doubled", () => {
  const store = OL.createStudioState({ source: ASK_NAME_SOURCE });
  const { host, state } = createBlockingHost();
  const prompt = createTestPromptHost();
  const controller = OL.createRunController(store, {
    inputPrompt: prompt,
    executionHost: host,
  });
  controller.run();

  controller.run();

  assert.equal(state.runCommandCount, 1);
  assert.deepEqual(prompt.prompts, ["what is your name?"]);
});

test("a fresh Run after Stop starts a genuinely new execution", () => {
  const store = OL.createStudioState({ source: ASK_NAME_SOURCE });
  const { host, state } = createBlockingHost();
  const prompt = createTestPromptHost();
  const controller = OL.createRunController(store, {
    inputPrompt: prompt,
    executionHost: host,
  });
  controller.run();
  controller.stop();
  controller.reset();

  controller.run();

  assert.equal(state.runCommandCount, 2);
  assert.deepEqual(prompt.prompts, [
    "what is your name?",
    "what is your name?",
  ]);
});

/**
 * A program that asks a question and THEN expects key presses — the shape #976 exists for. Before
 * this slice the studio refused every press after the question, permanently, which is stricter than
 * `spec/interaction-events.md:130-133` ("until the read finishes").
 */
const ASK_THEN_ON_KEY_SOURCE = [
  ':name = input "who?"',
  "print :name",
  'on_key "left" [',
  '  print "turned"',
  "]",
  "wait 5",
].join("\n");

test("#976: under the Worker host a key press after an answered question does NOT re-ask it", () => {
  // AC3, end to end through the real host and the real Worker-side runner.
  //
  // The two halves this needs are both new. The host now reports the answers it resolved in place
  // (it used to echo the request's own empty list, so the chain ended with no record that anything
  // had been answered), and the runner now consumes `ExecutionRequest.answers` before parking (it
  // used to present a live read unconditionally). Revert either and this test fails on the prompt
  // count: the delivery replay puts "who?" back on the learner's screen.
  //
  // This was unreachable until #976 removed the permanent refusal — a chain that had asked a
  // question delivered no input at all, so no replay ever crossed a read.
  const { host, state } = createBlockingHost();
  const prompt = createTestPromptHost(() => "ada");
  const store = OL.createStudioState({ source: ASK_THEN_ON_KEY_SOURCE });
  const controller = OL.createRunController(store, {
    executionHost: host,
    inputPrompt: prompt,
  });

  controller.run();
  assert.deepEqual(prompt.prompts, ["who?"], "asked once by the run itself");
  assert.deepEqual(store.getState().output, ["ada"]);

  const runsBeforePress = state.runCommandCount;
  controller.deliverKey("left");

  assert.ok(
    state.runCommandCount > runsBeforePress,
    "the press genuinely replayed the chain — otherwise this proves nothing",
  );
  assert.deepEqual(
    prompt.prompts,
    ["who?"],
    "…and the replay consumed the recorded answer instead of re-asking",
  );
  assert.deepEqual(
    store.getState().output,
    ["ada", "turned"],
    "the question's answer survives the replay AND the handler ran",
  );
});

test("#976: the question is not re-asked across several presses either", () => {
  // One press could pass by luck if the FIFO were consumed destructively somewhere. Three presses
  // over the same chain pin that the chain's answers survive every replay.
  const { host } = createBlockingHost();
  const prompt = createTestPromptHost(() => "ada");
  const store = OL.createStudioState({ source: ASK_THEN_ON_KEY_SOURCE });
  const controller = OL.createRunController(store, {
    executionHost: host,
    inputPrompt: prompt,
  });

  controller.run();
  controller.deliverKey("left");
  controller.deliverKey("left");
  controller.deliverKey("left");

  assert.deepEqual(prompt.prompts, ["who?"], "asked exactly once, ever");
  assert.deepEqual(store.getState().output, [
    "ada",
    "turned",
    "turned",
    "turned",
  ]);
});

/**
 * The shape the round-1 Worker tests missed: a `wait` runs BEFORE the read, so the read completes at
 * a non-zero tick and a wrongly-scheduled delivery can land in front of it. `ASK_THEN_ON_KEY_SOURCE`
 * asks first, which puts the read at tick 0 where no schedulable tick can precede it.
 */
function waitThenAskThenOnKeySource(lead) {
  return [
    'on_key "a" [',
    '  print "HANDLER"',
    "]",
    `wait ${lead}`,
    ':who = input "who?"',
    "print :who",
    "wait 3",
  ].join("\n");
}

test("#985/#976: the Worker host schedules against the program's tick clock, not tick 0", () => {
  // Round 1 shipped this broken and all ten gates passed. `execution-worker-runner.ts` called
  // `toExecuteOptions(request, signal, read)` with three arguments while the tick-timeline sink was
  // the fourth, so `settlement.tickTimeline` was `undefined` on this host, `tickAtEventIndex([], …)`
  // returned 0 unconditionally, and EVERY Worker delivery landed at tick 0.
  //
  // That is worse than the counter #985 replaced, not a graceful degradation: four presses used to
  // land at [1,2,3,4] and collapsed onto [0,0,0,0]. `web/main.ts` selects this host whenever the
  // page is cross-origin isolated, so it is a production path.
  const { host } = createBlockingHost();
  const prompt = createTestPromptHost(() => "tom");
  const store = OL.createStudioState({
    source: waitThenAskThenOnKeySource(3),
  });
  const controller = OL.createRunController(store, {
    executionHost: host,
    inputPrompt: prompt,
  });

  controller.run();
  const observed = store.getState().output;
  assert.deepEqual(observed, ["tom"], "the learner has read the answer");

  controller.deliverKey("a");
  const after = store.getState().output;

  assert.deepEqual(
    after.slice(0, observed.length),
    observed,
    "what the learner already read survives as a PREFIX — at tick 0 the handler's line was inserted BEFORE it",
  );
  assert.deepEqual(after, ["tom", "HANDLER"]);
  assert.deepEqual(prompt.prompts, ["who?"], "and nothing was re-asked");
});

test("#985: the Worker host and the in-process host schedule a delivery IDENTICALLY", () => {
  // The claim that was false. `execution-host.ts` said "every host composes it here … so the two
  // hosts cannot drift on what a run is given" while the Worker passed three arguments to a
  // four-parameter `toExecuteOptions` and got no timeline at all — so it scheduled every delivery
  // at tick 0 while the in-process host used the program's clock. All ten gates passed.
  //
  // Asserting the two schedules are equal is the direct form of that claim, and it is what a
  // one-host test cannot say however carefully it is written. Reverting the runner's 4th argument
  // makes this fail with `[0,0,0,0]` against `[30,30,30,30]`.
  //
  // The two hosts still differ in what they CONFIRM — a Worker carries no delivery report, because
  // structured clone destroys the occurrence identity a report is matched on — so this asserts the
  // schedule, which both can carry, and states the confirmation difference rather than hiding it.
  const source = ['on_key "a" [', "  forward 10", "]", "wait 30"].join("\n");

  function scheduleUnder(executionHost) {
    const requests = [];
    const recording = {
      execute(request, settle) {
        requests.push(request);
        executionHost.execute(request, settle);
      },
      cancel: () => executionHost.cancel(),
    };
    const store = OL.createStudioState({ source });
    const controller = OL.createRunController(store, {
      executionHost: recording,
    });
    controller.run();
    const confirmed = [];
    for (let press = 0; press < 4; press += 1) {
      confirmed.push(controller.deliverKey("a"));
    }
    const scheduled = requests.at(-1).hostInputEvents;
    assert.ok(scheduled, "the replay carried a schedule");
    // Reset so each host's run is closed before the next is measured, and so the recording
    // wrapper's `cancel` is reached rather than merely declared.
    controller.reset();
    return {
      ticks: scheduled.map((entry) => entry.tick),
      confirmed,
    };
  }

  const inProcess = scheduleUnder(
    OL.createInProcessExecutionHost({ signal: { aborted: false } }),
  );
  const worker = scheduleUnder(createBlockingHost().host);

  assert.deepEqual(
    worker.ticks,
    inProcess.ticks,
    "the two hosts must schedule the same program's presses at the same ticks",
  );
  assert.ok(
    worker.ticks.length === 4 && worker.ticks.every((tick) => tick > 0),
    `and at the program's own clock, not tick 0 — got ${JSON.stringify(worker.ticks)}`,
  );
  assert.deepEqual(
    inProcess.confirmed,
    [true, true, true, true],
    "the in-process host confirms every press",
  );
  assert.deepEqual(
    worker.confirmed,
    [false, false, false, false],
    "the Worker confirms none — the documented, conservative limitation, stated rather than hidden",
  );
});

test("#976: a delivery arriving between resolveRead() and the run's own report does not corrupt the chain", () => {
  // The race rubber-duck found. `resolveRead()` hands the answer to a run that is still in flight;
  // the host only transfers that answer onto a *settlement*. A delivery landing in that window used
  // to start a SECOND execution whose `ExecutionRequest.answers` did not yet carry it.
  //
  // Measured on the real Worker host + real runner, before the fix:
  //   prompts ["who?","who?"]           the answered question put to the learner again
  //   output  ["HANDLER","BEFORE"]      the handler's line inserted BEFORE the line already read,
  //                                     and the learner's own answer lost entirely
  //
  // The fix is to honour what `drainDeliveredInput`'s doc comment already claimed: while an attempt
  // is in flight the delivery stays SCHEDULED and is replayed when that attempt settles. The
  // settlement path now resumes the drain, so it is deferred rather than dropped.
  const { host } = createBlockingHost();
  // The question must be HELD, not answered from inside `present()` — answering synchronously
  // resolves the read before `run()` returns and there is no window to land in.
  const prompt = createTestPromptHost();
  const store = OL.createStudioState({
    source: [
      'on_key "a" [',
      '  print "HANDLER"',
      "]",
      "wait 1",
      'print "BEFORE"',
      ':who = input "who?"',
      "print :who",
      "wait 5",
    ].join("\n"),
  });
  const controller = OL.createRunController(store, {
    executionHost: host,
    inputPrompt: prompt,
  });

  controller.run();
  const observed = store.getState().output;
  assert.deepEqual(observed, ["BEFORE"], "the learner has read this much");
  assert.deepEqual(prompt.prompts, ["who?"]);

  // Answer it, then deliver before the resumed run has reported: the window itself.
  prompt.respond("Ada");
  controller.deliverKey("a");
  const after = store.getState().output;

  assert.deepEqual(
    after.slice(0, observed.length),
    observed,
    "what the learner already read survives as a PREFIX — the race inserted the handler's line in front of it",
  );
  assert.deepEqual(
    prompt.prompts,
    ["who?"],
    "and the answered question is not put to them a second time",
  );
});

/**
 * A **scripted** Worker port: it records the run commands the host posts and lets a test emit
 * `read` and `done` reports by hand. `createBlockingHost()` cannot do this — it drives the real
 * runner, which unwinds at `PARKED` and can therefore never emit the later `"done"` a resumed run
 * produces. That is why the race test built on it could only ever prove "no immediate corruption".
 *
 * **Every field it emits must be a shape the real runner can produce.** Review found two that were
 * not: a hard-coded `tickTimeline: []` on `read`, and a fabricated `[{ tick: 1, eventCount: 0 }]` on
 * `done` — unproducible for *any* program, because a boundary is pushed as
 * `{ tick, eventCount: events.length }` only after the `wait` instruction is emitted, so the floor is
 * 1 even at minimum. Both were measured harmless today, but a harness that emits shapes the Worker
 * cannot is one assertion away from proving nothing. The timelines now come from `settlementFor()`,
 * i.e. from the real runtime, and `retainedAnswers` is always present because
 * `worker-execution-host.ts` declares it required.
 *
 * **Per FIELD, not per report.** Review was right to narrow this: `settlementFor()` is run with
 * `acceptsReads: false` and no answers, so the events and timeline it yields are the *read-prefix*
 * artifacts, and the test then pairs them with `done` outputs containing `"Ada"` and `"HANDLER"`. No
 * single real `done` report has that combination. Every field is individually of a producible shape;
 * the composite is still assembled. Closing that would mean teaching `settlementFor` to take answers
 * and host input and deriving three distinct real settlements — worth doing when something asserts on
 * delivery *tick* here, which nothing does today.
 */
function createScriptedPort() {
  const commands = [];
  let listener = null;
  const port = {
    postMessage(command) {
      commands.push(command);
    },
    onReport(next) {
      listener = next;
    },
  };
  return {
    commands,
    port,
    read(prompt, output, events, tickTimeline) {
      listener({
        type: "read",
        runId: commands.at(-1).runId,
        prompt,
        events,
        output,
        tutorOutput: [],
        tickTimeline,
        retainedAnswers: [],
      });
    },
    done(output, tickTimeline, retainedAnswers, events) {
      listener({
        type: "done",
        runId: commands.at(-1).runId,
        events,
        output,
        tutorOutput: [],
        diagnostics: [],
        tickTimeline,
        retainedAnswers,
      });
    },
  };
}

const RACE_SOURCE = [
  'on_key "a" [',
  '  print "HANDLER"',
  "]",
  "wait 1",
  'print "BEFORE"',
  ':who = input "who?"',
  "print :who",
  "wait 3",
].join("\n");

test("#976: a delivery racing resolveRead is EVENTUALLY replayed, with the answer retained", () => {
  // duck's round-4 BLOCKING 3. The previous test asserted only that nothing was corrupted at the
  // moment of delivery; every outcome that matters happens *after* the resumed run reports, and
  // `createBlockingHost()` structurally cannot get there. This scripts the port instead, so the
  // load-bearing outcomes are asserted rather than assumed: a SECOND run command, carrying the
  // retained answer and the scheduled key, and the handler's output arriving after the line the
  // learner had already read.
  // Real events, so the registration gate (hasRegisteredHandler) sees the on_key the program
  // actually registers — a scripted report carrying vents: [] would be refused before scheduling,
  // and the test would pass for the wrong reason.
  // Real events, so the registration gate (hasRegisteredHandler) sees the on_key the program
  // actually registers — a scripted report carrying events: [] would be refused before scheduling,
  // and the test would pass for the wrong reason. The tick timeline now comes from the same real
  // settlement, for the same reason: review measured the fabricated one unproducible by any program.
  const realSettlement = settlementFor(RACE_SOURCE);
  const realEvents = realSettlement.events;
  const realTicks = realSettlement.tickTimeline;
  assert.ok(
    realTicks.length > 0 &&
      realTicks.every((boundary) => boundary.eventCount > 0),
    `control: the real timeline must be non-empty with positive eventCounts, else it could not detect the fabricated one (got ${JSON.stringify(realTicks)})`,
  );
  const scripted = createScriptedPort();
  const host = OL.createWorkerExecutionHost({
    allocateBuffer: (byteLength) => new ArrayBuffer(byteLength),
    notify: () => 1,
    port: scripted.port,
  });
  const prompt = createTestPromptHost();
  const store = OL.createStudioState({ source: RACE_SOURCE });
  const controller = OL.createRunController(store, {
    executionHost: host,
    inputPrompt: prompt,
  });

  controller.run();
  assert.equal(scripted.commands.length, 1, "one run command so far");
  scripted.read("who?", ["BEFORE"], realEvents, realTicks);
  assert.deepEqual(prompt.prompts, ["who?"]);

  // Answer, then deliver before the resumed run has reported: the race window itself.
  prompt.respond("Ada");
  const observed = store.getState().output;
  controller.deliverKey("a");

  // The resumed run finishes and reports, carrying the answer it consumed.
  // The runner's OWN view of the FIFO: this run started with no recorded answers and parked, so it
  // truncated nothing and reports an empty list. The host adds the answer it resolved in place.
  scripted.done(["BEFORE", "Ada"], realTicks, [], realEvents);

  assert.equal(
    scripted.commands.length,
    2,
    "the deferred delivery is REPLAYED once the racing attempt settles — not stranded",
  );
  const replay = scripted.commands.at(-1).request;
  assert.deepEqual(
    replay.answers,
    [{ prompt: "who?", answer: "Ada" }],
    "…and the replay carries the answer the racing attempt consumed, so nothing is re-asked",
  );
  assert.ok(
    replay.hostInputEvents?.some((entry) => entry.kind === "key"),
    "…and the scheduled key is actually in the replay's schedule",
  );

  // The replay reports the handler having run, after the line already read.
  scripted.done(
    ["BEFORE", "Ada", "HANDLER"],
    realTicks,
    [{ prompt: "who?", answer: "Ada" }],
    realEvents,
  );

  const after = store.getState().output;
  assert.deepEqual(
    after.slice(0, observed.length),
    observed,
    "what the learner already read survives as a prefix",
  );
  assert.deepEqual(after, ["BEFORE", "Ada", "HANDLER"]);
  assert.deepEqual(prompt.prompts, ["who?"], "asked exactly once, ever");
  assert.equal(store.getState().runStatus, "done");
});
