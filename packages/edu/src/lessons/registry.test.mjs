// Unit tests for the lesson/exercise registry (issue #328): the flat `LESSONS`/`EXERCISES`
// aggregation plus the `getLessonsByLevel`/`getExercisesByLevel`/`getExercisesByLesson`/
// `findLessonById`/`findExerciseById` helpers every later level's slice (B2/B3/B4) will reuse.
import assert from "node:assert/strict";
import { test } from "node:test";
import * as OL from "@openlogo/edu";

const AUTHORED_LEVELS = new Set(["1", "2", "3", "4", "5"]);

test("LESSONS and EXERCISES aggregate every authored Level 1-5 item", () => {
  assert.equal(
    OL.LESSONS.every((lesson) => AUTHORED_LEVELS.has(lesson.level)),
    true,
  );
  assert.equal(
    OL.EXERCISES.every((exercise) => AUTHORED_LEVELS.has(exercise.level)),
    true,
  );
  assert.equal(OL.LESSONS.length >= 4, true);
  assert.equal(OL.EXERCISES.length >= 12, true);
});

test("every lesson id across the registry is unique", () => {
  const ids = OL.LESSONS.map((lesson) => lesson.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("every exercise id across the registry is unique", () => {
  const ids = OL.EXERCISES.map((exercise) => exercise.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("getLessonsByLevel returns only lessons for the requested level, empty for an unauthored one", () => {
  const level1 = OL.getLessonsByLevel("1");
  assert.equal(level1.length > 0, true);
  assert.equal(
    level1.every((lesson) => lesson.level === "1"),
    true,
  );
  assert.deepEqual(OL.getLessonsByLevel("6"), []);
});

test("getExercisesByLevel returns only exercises for the requested level, empty for an unauthored one", () => {
  const level2 = OL.getExercisesByLevel("2");
  assert.equal(level2.length > 0, true);
  assert.equal(
    level2.every((exercise) => exercise.level === "2"),
    true,
  );
  assert.deepEqual(OL.getExercisesByLevel("6"), []);
});

test("getExercisesByLesson returns only exercises for the requested lesson, empty for an unknown one", () => {
  const exercises = OL.getExercisesByLesson("l2-square-repeat");
  assert.equal(exercises.length > 0, true);
  assert.equal(
    exercises.every((exercise) => exercise.lessonId === "l2-square-repeat"),
    true,
  );
  assert.deepEqual(OL.getExercisesByLesson("does-not-exist"), []);
});

test("findLessonById finds a registered lesson and returns undefined for an unknown id", () => {
  const lesson = OL.findLessonById("l1-first-marks");
  assert.ok(lesson);
  assert.equal(lesson.id, "l1-first-marks");
  assert.equal(OL.findLessonById("does-not-exist"), undefined);
});

test("findExerciseById finds a registered exercise and returns undefined for an unknown id", () => {
  const exercise = OL.findExerciseById("l2-square-repeat-count");
  assert.ok(exercise);
  assert.equal(exercise.id, "l2-square-repeat-count");
  assert.equal(OL.findExerciseById("does-not-exist"), undefined);
});

test("every exercise's lessonId resolves to a registered lesson", () => {
  for (const exercise of OL.EXERCISES) {
    assert.ok(
      OL.findLessonById(exercise.lessonId),
      `${exercise.id} references unknown lesson ${exercise.lessonId}`,
    );
  }
});

test("the exported registries and their nested entries are deep-frozen", () => {
  assert.equal(Object.isFrozen(OL.LESSONS), true);
  assert.equal(Object.isFrozen(OL.EXERCISES), true);

  for (const lesson of OL.LESSONS) {
    assert.equal(Object.isFrozen(lesson), true, `${lesson.id} is not frozen`);
    assert.equal(
      Object.isFrozen(lesson.workedExamples),
      true,
      `${lesson.id} workedExamples array is not frozen`,
    );
    for (const example of lesson.workedExamples) {
      assert.equal(
        Object.isFrozen(example),
        true,
        `${lesson.id} worked example is not frozen`,
      );
    }
  }

  for (const exercise of OL.EXERCISES) {
    assert.equal(
      Object.isFrozen(exercise),
      true,
      `${exercise.id} is not frozen`,
    );
    assert.equal(
      Object.isFrozen(exercise.referenceSolution),
      true,
      `${exercise.id} referenceSolution is not frozen`,
    );
  }
});

test("mutating a frozen registry entry throws and does not take effect", () => {
  const lesson = OL.LESSONS[0];
  const originalTitle = lesson.title;
  assert.throws(() => {
    lesson.title = "mutated";
  }, TypeError);
  assert.equal(lesson.title, originalTitle);

  const originalLength = OL.LESSONS.length;
  assert.throws(() => {
    OL.LESSONS.push(lesson);
  }, TypeError);
  assert.equal(OL.LESSONS.length, originalLength);

  const exercise = OL.EXERCISES[0];
  const originalPrompt = exercise.prompt;
  assert.throws(() => {
    exercise.prompt = "mutated";
  }, TypeError);
  assert.equal(exercise.prompt, originalPrompt);

  const originalSource = exercise.referenceSolution.source;
  assert.throws(() => {
    exercise.referenceSolution.source = "mutated";
  }, TypeError);
  assert.equal(exercise.referenceSolution.source, originalSource);
});
