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

test("the question is put to the learner over the picture the program has already drawn", () => {
  // The regression this slice had to avoid. A Worker parked inside the reader is called with the
  // prompt and nothing else, so without `ExecuteOptions.observedEvents` (#876) it could not report
  // what had been drawn, and the question would appear over a BLANK canvas — worse than #769, which
  // draws the square and then asks. `spec/interaction-events.md:108-110` permits exactly this
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
  // diagnostic the learner sees is the runtime's — `spec/interaction-events.md:110-111`'s other
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
