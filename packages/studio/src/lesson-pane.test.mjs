import assert from "node:assert/strict";
import { test } from "node:test";
import * as OL from "@openlogo/studio";

/** A minimal `Lesson` fixture — only the fields this module's controller/projections read,
 * matching the real `@openlogo/edu` `Lesson` shape (#189) exactly. */
function makeLesson(overrides = {}) {
  return {
    id: "l1-square",
    title: "Draw a square",
    level: "1",
    objective: "Move the turtle forward and turn to draw a square.",
    workedExamples: [
      {
        source: "repeat 4 [ forward 100 right 90 ]",
        explanation: "Repeats moving forward and turning right four times.",
      },
    ],
    exercisePrompt: "Change 100 to 50 and see what happens.",
    ...overrides,
  };
}

test("createLessonPaneController starts with no lesson selected", () => {
  const store = OL.createStudioState();
  const lessonPane = OL.createLessonPaneController(store, { lessons: [] });

  assert.equal(lessonPane.state, store);
  assert.deepEqual(lessonPane.getLessons(), []);
  assert.equal(lessonPane.getSelectedLesson(), undefined);
  assert.deepEqual(store.getState().lesson, { lessonId: null, title: null });
});

test("createLessonPaneController defaults to @openlogo/edu's published LESSONS registry", () => {
  const store = OL.createStudioState();
  const lessonPane = OL.createLessonPaneController(store);

  assert.ok(lessonPane.getLessons().length > 0);
});

test("selectLesson(id) sets the shared lesson context and getSelectedLesson returns the lesson", () => {
  const store = OL.createStudioState();
  const square = makeLesson();
  const triangle = makeLesson({ id: "l1-triangle", title: "Draw a triangle" });
  const lessonPane = OL.createLessonPaneController(store, {
    lessons: [square, triangle],
  });

  lessonPane.selectLesson("l1-triangle");

  assert.deepEqual(store.getState().lesson, {
    lessonId: "l1-triangle",
    title: "Draw a triangle",
  });
  assert.equal(lessonPane.getSelectedLesson(), triangle);
});

test("selectLesson(null) clears the selection", () => {
  const store = OL.createStudioState();
  const square = makeLesson();
  const lessonPane = OL.createLessonPaneController(store, {
    lessons: [square],
  });

  lessonPane.selectLesson("l1-square");
  assert.equal(lessonPane.getSelectedLesson(), square);

  lessonPane.selectLesson(null);
  assert.deepEqual(store.getState().lesson, { lessonId: null, title: null });
  assert.equal(lessonPane.getSelectedLesson(), undefined);
});

test("selectLesson(id) with an unknown id records the id but no title, and getSelectedLesson returns undefined", () => {
  const store = OL.createStudioState();
  const lessonPane = OL.createLessonPaneController(store, { lessons: [] });

  lessonPane.selectLesson("does-not-exist");

  assert.deepEqual(store.getState().lesson, {
    lessonId: "does-not-exist",
    title: null,
  });
  assert.equal(lessonPane.getSelectedLesson(), undefined);
});

test("getSelectedLesson returns undefined when the store's lessonId is not among this controller's lessons", () => {
  const store = OL.createStudioState({
    lesson: { lessonId: "not-here", title: "Stale title" },
  });
  const lessonPane = OL.createLessonPaneController(store, {
    lessons: [makeLesson()],
  });

  assert.equal(lessonPane.getSelectedLesson(), undefined);
});

test("mountLessonPane composes the controller into the app shell's lesson region", () => {
  const store = OL.createStudioState();
  const shell = OL.createAppShell(store);
  const lessonPane = OL.createLessonPaneController(store, { lessons: [] });

  OL.mountLessonPane(shell, lessonPane);

  assert.equal(shell.getRegion("lesson").content, lessonPane);
});

test("toLessonNavItems projects every lesson in order, flagging the selected one", () => {
  const square = makeLesson();
  const triangle = makeLesson({ id: "l1-triangle", title: "Draw a triangle" });

  const items = OL.toLessonNavItems([square, triangle], "l1-triangle");

  assert.deepEqual(items, [
    { id: "l1-square", title: "Draw a square", level: "1", isSelected: false },
    {
      id: "l1-triangle",
      title: "Draw a triangle",
      level: "1",
      isSelected: true,
    },
  ]);
});

test("toLessonNavItems marks no item selected when selectedLessonId is null", () => {
  const items = OL.toLessonNavItems([makeLesson()], null);

  assert.equal(items.length, 1);
  assert.equal(items[0].isSelected, false);
});

test("toLessonNavItems returns an empty list for an empty lesson list", () => {
  assert.deepEqual(OL.toLessonNavItems([], null), []);
});

test("toLessonDetailViewItem returns the empty state when no lesson is selected", () => {
  const item = OL.toLessonDetailViewItem(undefined);

  assert.deepEqual(item, {
    hasLesson: false,
    id: "",
    title: "",
    level: "",
    objective: "",
    workedExamples: [],
    exercisePrompt: "",
    emptyStateLabel: OL.NO_LESSON_SELECTED_LABEL,
  });
});

test("toLessonDetailViewItem projects a selected lesson's full content verbatim", () => {
  const lesson = makeLesson({
    workedExamples: [
      { source: "forward 50", explanation: "Moves forward 50 steps." },
      { source: "right 90", explanation: "Turns right a quarter turn." },
    ],
  });

  const item = OL.toLessonDetailViewItem(lesson);

  assert.deepEqual(item, {
    hasLesson: true,
    id: "l1-square",
    title: "Draw a square",
    level: "1",
    objective: "Move the turtle forward and turn to draw a square.",
    workedExamples: [
      { source: "forward 50", explanation: "Moves forward 50 steps." },
      { source: "right 90", explanation: "Turns right a quarter turn." },
    ],
    exercisePrompt: "Change 100 to 50 and see what happens.",
    emptyStateLabel: "",
  });
});

test("toLessonDetailViewItem handles a lesson with multiple worked examples in order", () => {
  const lesson = makeLesson({
    workedExamples: [
      { source: "forward 10", explanation: "first" },
      { source: "forward 20", explanation: "second" },
      { source: "forward 30", explanation: "third" },
    ],
  });

  const item = OL.toLessonDetailViewItem(lesson);

  assert.equal(item.workedExamples.length, 3);
  assert.deepEqual(
    item.workedExamples.map((example) => example.explanation),
    ["first", "second", "third"],
  );
});

test("end-to-end: selecting a lesson through the controller flows into both projections", () => {
  const store = OL.createStudioState();
  const square = makeLesson();
  const lessonPane = OL.createLessonPaneController(store, {
    lessons: [square],
  });

  let navItems = OL.toLessonNavItems(
    lessonPane.getLessons(),
    store.getState().lesson.lessonId,
  );
  assert.equal(navItems[0].isSelected, false);
  assert.equal(
    OL.toLessonDetailViewItem(lessonPane.getSelectedLesson()).hasLesson,
    false,
  );

  lessonPane.selectLesson("l1-square");

  navItems = OL.toLessonNavItems(
    lessonPane.getLessons(),
    store.getState().lesson.lessonId,
  );
  assert.equal(navItems[0].isSelected, true);
  const detail = OL.toLessonDetailViewItem(lessonPane.getSelectedLesson());
  assert.equal(detail.hasLesson, true);
  assert.equal(detail.title, "Draw a square");
});
