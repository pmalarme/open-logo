// Unit tests for the Level 1 lesson + graded exercises (issue #328): shape validation via the
// `Lesson`/`Exercise` type guards, plus running every embedded OpenLogo source through
// `@openlogo/runtime` so a lesson can never drift from real execution behavior.
import assert from "node:assert/strict";
import { test } from "node:test";
import * as OL from "@openlogo/edu";
import { execute } from "@openlogo/runtime";

const level1Lessons = OL.getLessonsByLevel("1");
const level1Exercises = OL.getExercisesByLevel("1");

test("getLessonsByLevel('1') contains only valid, Level 1 Lessons", () => {
  assert.equal(level1Lessons.length > 0, true);
  for (const lesson of level1Lessons) {
    assert.equal(OL.isLesson(lesson), true);
    assert.equal(lesson.level, "1");
  }
});

test("getExercisesByLevel('1') contains only valid, Level 1 Exercises tied to a known lesson", () => {
  assert.equal(level1Exercises.length > 0, true);
  const lessonIds = new Set(level1Lessons.map((lesson) => lesson.id));
  for (const exercise of level1Exercises) {
    assert.equal(OL.isExercise(exercise), true);
    assert.equal(exercise.level, "1");
    assert.equal(lessonIds.has(exercise.lessonId), true);
  }
});

test("level1Exercises ramps through every difficulty exactly once per lesson", () => {
  const byLesson = new Map();
  for (const exercise of level1Exercises) {
    const difficulties = byLesson.get(exercise.lessonId) ?? [];
    difficulties.push(exercise.difficulty);
    byLesson.set(exercise.lessonId, difficulties);
  }
  for (const difficulties of byLesson.values()) {
    assert.deepEqual([...difficulties].sort(), [
      "challenge",
      "guided",
      "practice",
    ]);
  }
});

test("every Level 1 worked example parses and runs with no diagnostics", () => {
  for (const lesson of level1Lessons) {
    for (const example of lesson.workedExamples) {
      const result = execute(example.source, `${lesson.id}.logo`);
      assert.deepEqual(
        result.diagnostics,
        [],
        `${lesson.id} worked example raised diagnostics: ${JSON.stringify(result.diagnostics)}`,
      );
    }
  }
});

test("every Level 1 exercise reference solution parses and runs with no diagnostics", () => {
  for (const exercise of level1Exercises) {
    const result = execute(
      exercise.referenceSolution.source,
      `${exercise.id}.logo`,
    );
    assert.deepEqual(
      result.diagnostics,
      [],
      `${exercise.id} reference solution raised diagnostics: ${JSON.stringify(result.diagnostics)}`,
    );
  }
});

test("the house reference solution draws the square body one side at a time, the triangle roof one side at a time, then a door and two windows, all with the pen up between shapes", () => {
  const house = level1Exercises.find(
    (exercise) => exercise.id === "l1-house-square-and-triangle",
  );
  assert.ok(house);

  const houseResult = execute(house.referenceSolution.source, "house.logo");
  assert.deepEqual(houseResult.diagnostics, []);

  // Four shapes are drawn with the pen down (body, roof, door, window, window), each preceded
  // by a pen_up walk to reposition -- except the very first, which starts with the pen already
  // down -- so the pen alternates down/up/down/up/down/up/down/up: 8 changes in total.
  const penChanges = houseResult.events.filter(
    (event) => event.kind === "pen-change",
  );
  assert.deepEqual(
    penChanges.map((event) => event.payload),
    [
      { from: "down", to: "up" },
      { from: "up", to: "down" },
      { from: "down", to: "up" },
      { from: "up", to: "down" },
      { from: "down", to: "up" },
      { from: "up", to: "down" },
      { from: "down", to: "up" },
      { from: "up", to: "down" },
    ],
  );

  const turnEvents = houseResult.events.filter(
    (event) => event.kind === "turn",
  );
  const totalTurn = turnEvents.reduce(
    (sum, event) => sum + ((event.payload.to - event.payload.from + 360) % 360),
    0,
  );
  assert.equal(totalTurn, 3600);
});
