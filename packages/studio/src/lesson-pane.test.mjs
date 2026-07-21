import assert from "node:assert/strict";
import { test } from "node:test";
import * as OL from "@openlogo/studio";

const {
  createLessonPaneController,
  createAppShell,
  createStudioState,
  NO_LESSON_VIEW,
} = OL;

/** A minimal, arbitrary Lesson-shaped fixture for testing the controller in isolation from
 * `@openlogo/edu`'s real curriculum registry. */
function fakeLesson(overrides = {}) {
  return {
    id: "l1-fixture",
    title: "Moving the turtle",
    level: "1",
    objective: "Move the turtle forward and turn it.",
    workedExamples: [
      {
        source: "forward 100\nright 90",
        explanation: "Moves forward 100 steps, then turns right 90 degrees.",
      },
    ],
    exercisePrompt: "Change the distance and predict the new shape.",
    ...overrides,
  };
}

test("getView() returns NO_LESSON_VIEW when no lesson is loaded (sandbox/freeform default)", () => {
  const state = createStudioState();
  const controller = createLessonPaneController(state);

  assert.deepEqual(controller.getView(), NO_LESSON_VIEW);
  assert.equal(controller.getView().isVisible, false);
});

test("getView() resolves a loaded lessonId through the injected lookup into a visible view", () => {
  const state = createStudioState();
  state.setLesson({ lessonId: "l1-fixture", title: "Moving the turtle" });
  const lesson = fakeLesson();
  const controller = createLessonPaneController(state, {
    lookup: (lessonId) => {
      assert.equal(lessonId, "l1-fixture");
      return lesson;
    },
  });

  assert.deepEqual(controller.getView(), {
    isVisible: true,
    title: "Moving the turtle",
    objective: "Move the turtle forward and turn it.",
    workedExamples: [
      {
        source: "forward 100\nright 90",
        explanation: "Moves forward 100 steps, then turns right 90 degrees.",
      },
    ],
    exercisePrompt: "Change the distance and predict the new shape.",
  });
});

test("getView() copies every worked example, in order, for a lesson with more than one", () => {
  const state = createStudioState();
  state.setLesson({ lessonId: "l2-fixture", title: "Repeating a pattern" });
  const lesson = fakeLesson({
    id: "l2-fixture",
    workedExamples: [
      { source: "repeat 4 [ forward 10 ]", explanation: "First example." },
      { source: "repeat 6 [ forward 20 ]", explanation: "Second example." },
    ],
  });
  const controller = createLessonPaneController(state, {
    lookup: () => lesson,
  });

  assert.deepEqual(controller.getView().workedExamples, [
    { source: "repeat 4 [ forward 10 ]", explanation: "First example." },
    { source: "repeat 6 [ forward 20 ]", explanation: "Second example." },
  ]);
});

test("getView() degrades to NO_LESSON_VIEW when lessonId no longer resolves (stale/unknown id)", () => {
  const state = createStudioState();
  state.setLesson({ lessonId: "unknown-lesson", title: "Ghost" });
  const controller = createLessonPaneController(state, {
    lookup: () => undefined,
  });

  assert.deepEqual(controller.getView(), NO_LESSON_VIEW);
});

test("getView() defaults its lookup to the real @openlogo/edu registry when none is supplied", () => {
  const state = createStudioState();
  // No lookup override: this exercises the default `findLessonById` from @openlogo/edu. An
  // unregistered id must still degrade to NO_LESSON_VIEW rather than throwing.
  state.setLesson({ lessonId: "not-a-real-lesson-id", title: "Ghost" });
  const controller = createLessonPaneController(state);

  assert.deepEqual(controller.getView(), NO_LESSON_VIEW);
});

test("getView() re-reads the live state on every call rather than caching a stale snapshot", () => {
  const state = createStudioState();
  const lesson = fakeLesson();
  const controller = createLessonPaneController(state, {
    lookup: (lessonId) => {
      assert.equal(lessonId, lesson.id);
      return lesson;
    },
  });

  assert.equal(controller.getView().isVisible, false);
  state.setLesson({ lessonId: lesson.id, title: lesson.title });
  assert.equal(controller.getView().isVisible, true);
  state.setLesson({ lessonId: null, title: null });
  assert.equal(controller.getView().isVisible, false);
});

test("controller.state is the exact same store instance passed in, not a copy", () => {
  const state = createStudioState();
  const controller = createLessonPaneController(state);
  assert.equal(controller.state, state);
});

test("mountLessonPane composes the controller into the app shell's lesson region, not any other region", () => {
  const state = createStudioState();
  const shell = createAppShell(state);
  const controller = createLessonPaneController(state);

  OL.mountLessonPane(shell, controller);

  assert.equal(shell.getRegion("lesson").content, controller);
  assert.equal(shell.getRegion("editor").content, null);
});
