import assert from "node:assert/strict";
import { test } from "node:test";
import * as OL from "@openlogo/studio";

/**
 * `input-prompt.ts` (#769) — the headless learner-facing prompt for the blocking `input` reporter.
 * Every test here drives the controller directly, with no DOM: the module owns the question, the
 * view a renderer paints, and the two ways a read can end (answer / dismiss), and nothing else.
 */

/**
 * A responder plus the answers it was called with. One helper for the whole file so every test
 * asserts the *same* recorder — including the tests whose point is that the responder is never
 * called, which would otherwise pass a throwaway no-op whose silence proves nothing.
 */
function createResponderRecorder() {
  const answers = [];
  return {
    answers,
    respond: (answer) => {
      answers.push(answer);
    },
  };
}

/** Records every view the controller publishes, so ordering can be asserted. */
function recordViews(controller) {
  const views = [];
  const unsubscribe = controller.subscribeView((view) => {
    views.push(view);
  });
  return { views, unsubscribe };
}

test("a fresh controller has nothing outstanding: hidden, no prompt text, but every label ready", () => {
  const controller = OL.createInputPromptController();

  assert.deepEqual(controller.getView(), {
    isVisible: false,
    prompt: "",
    fieldLabel: OL.INPUT_PROMPT_FIELD_LABEL,
    submitLabel: OL.INPUT_PROMPT_SUBMIT_LABEL,
    cancelLabel: OL.INPUT_PROMPT_CANCEL_LABEL,
  });
});

test("present() shows the program's own prompt verbatim and notifies subscribers, without finishing the read", () => {
  const controller = OL.createInputPromptController();
  const { views } = recordViews(controller);
  const recorder = createResponderRecorder();

  controller.present({ prompt: "what is your name?" }, recorder.respond);

  assert.equal(controller.getView().isVisible, true);
  assert.equal(controller.getView().prompt, "what is your name?");
  assert.equal(views.length, 1);
  assert.deepEqual(views[0], controller.getView());
  assert.deepEqual(
    recorder.answers,
    [],
    "merely presenting a question must not finish the read",
  );
});

test("submit() finishes the read with the learner's answer and takes the question down", () => {
  const controller = OL.createInputPromptController();
  const recorder = createResponderRecorder();
  controller.present({ prompt: "who?" }, recorder.respond);

  controller.submit("tom");

  assert.deepEqual(recorder.answers, ["tom"]);
  assert.equal(controller.getView().isVisible, false);
  assert.equal(controller.getView().prompt, "");
});

test("cancel() ends the read unanswered — the runtime reader's own `undefined` (spec/interaction-events.md:110-111)", () => {
  const controller = OL.createInputPromptController();
  const recorder = createResponderRecorder();
  controller.present({ prompt: "who?" }, recorder.respond);

  controller.cancel();

  assert.deepEqual(recorder.answers, [undefined]);
  assert.equal(controller.getView().isVisible, false);
});

test("dismiss() withdraws the question WITHOUT answering it — the caller already decided the outcome", () => {
  const controller = OL.createInputPromptController();
  const recorder = createResponderRecorder();

  controller.present({ prompt: "who?" }, recorder.respond);
  controller.dismiss();

  assert.deepEqual(
    recorder.answers,
    [],
    "a withdrawn question must never call its responder",
  );
  assert.equal(controller.getView().isVisible, false);

  // The same recorder on a question that IS answered, so the empty array above can only mean
  // "never called" — never "the recorder itself was broken".
  controller.present({ prompt: "again?" }, recorder.respond);
  controller.submit("tom");
  assert.deepEqual(recorder.answers, ["tom"]);
});

test("a responder is used exactly once: a second submit() after the question closed is a no-op", () => {
  const controller = OL.createInputPromptController();
  const recorder = createResponderRecorder();
  controller.present({ prompt: "who?" }, recorder.respond);

  controller.submit("tom");
  controller.submit("jerry");
  controller.cancel();

  assert.deepEqual(recorder.answers, ["tom"]);
});

test("submit()/cancel() with nothing outstanding are no-ops, never a crash", () => {
  const controller = OL.createInputPromptController();

  controller.submit("tom");
  controller.cancel();

  assert.equal(controller.getView().isVisible, false);
});

test("subscribeView's unsubscribe stops further notifications, but never the read itself", () => {
  const controller = OL.createInputPromptController();
  const { views, unsubscribe } = recordViews(controller);
  const recorder = createResponderRecorder();

  controller.present({ prompt: "first?" }, recorder.respond);
  unsubscribe();
  controller.submit("tom");
  controller.present({ prompt: "second?" }, recorder.respond);

  assert.equal(views.length, 1);
  assert.equal(views[0].prompt, "first?");
  assert.deepEqual(recorder.answers, ["tom"]);
});

test("mapInputPromptRequestToView is the one place the visible/hidden decision is made", () => {
  assert.deepEqual(OL.mapInputPromptRequestToView(null), {
    isVisible: false,
    prompt: "",
    fieldLabel: OL.INPUT_PROMPT_FIELD_LABEL,
    submitLabel: OL.INPUT_PROMPT_SUBMIT_LABEL,
    cancelLabel: OL.INPUT_PROMPT_CANCEL_LABEL,
  });
  assert.deepEqual(OL.mapInputPromptRequestToView({ prompt: "how old?" }), {
    isVisible: true,
    prompt: "how old?",
    fieldLabel: OL.INPUT_PROMPT_FIELD_LABEL,
    submitLabel: OL.INPUT_PROMPT_SUBMIT_LABEL,
    cancelLabel: OL.INPUT_PROMPT_CANCEL_LABEL,
  });
});

test("the prompt's focus scope is answer field → Answer → Cancel, all labeled, all in the repl region", () => {
  assert.deepEqual(
    OL.INPUT_PROMPT_FOCUS_ORDER.map((stop) => stop.id),
    ["input-prompt-field", "input-prompt-submit", "input-prompt-cancel"],
  );
  for (const stop of OL.INPUT_PROMPT_FOCUS_ORDER) {
    assert.equal(stop.region, "repl");
    assert.ok(
      stop.label.length > 0,
      `${stop.id} must have an accessible label`,
    );
  }
  assert.deepEqual(
    OL.INPUT_PROMPT_FOCUS_ORDER.map((stop) => stop.label),
    [
      OL.INPUT_PROMPT_FIELD_LABEL,
      OL.INPUT_PROMPT_SUBMIT_LABEL,
      OL.INPUT_PROMPT_CANCEL_LABEL,
    ],
  );
});

test("the prompt's focus scope cycles both ways with no keyboard trap (a11y.ts's own tested helpers)", () => {
  const ids = OL.INPUT_PROMPT_FOCUS_ORDER.map((stop) => stop.id);

  for (const id of ids) {
    const forward = new Set();
    let cursor = id;
    for (let visited = 0; visited < ids.length; visited += 1) {
      cursor = OL.nextFocusStop(OL.INPUT_PROMPT_FOCUS_ORDER, cursor).id;
      forward.add(cursor);
    }
    assert.deepEqual([...forward].sort(), [...ids].sort());

    const backward = new Set();
    cursor = id;
    for (let visited = 0; visited < ids.length; visited += 1) {
      cursor = OL.previousFocusStop(OL.INPUT_PROMPT_FOCUS_ORDER, cursor).id;
      backward.add(cursor);
    }
    assert.deepEqual([...backward].sort(), [...ids].sort());
  }
});

test("the prompt's stops are deliberately NOT part of REPL_FOCUS_ORDER — a dialog owns its own scope", () => {
  const replIds = new Set(OL.REPL_FOCUS_ORDER.map((stop) => stop.id));
  for (const stop of OL.INPUT_PROMPT_FOCUS_ORDER) {
    assert.equal(
      replIds.has(stop.id),
      false,
      `${stop.id} belongs to the dialog's own focus scope, not the page's`,
    );
  }
});
