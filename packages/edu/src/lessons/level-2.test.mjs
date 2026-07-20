// Unit tests for the Level 2 lesson + graded exercises (issue #328): shape validation via the
// `Lesson`/`Exercise` type guards, plus running every embedded OpenLogo source through
// `@openlogo/runtime` so a lesson can never drift from real execution behavior.
import assert from "node:assert/strict";
import { test } from "node:test";
import * as OL from "@openlogo/edu";
import { execute } from "@openlogo/runtime";

const level2Lessons = OL.getLessonsByLevel("2");
const level2Exercises = OL.getExercisesByLevel("2");

test("getLessonsByLevel('2') contains only valid, Level 2 Lessons", () => {
  assert.equal(level2Lessons.length > 0, true);
  for (const lesson of level2Lessons) {
    assert.equal(OL.isLesson(lesson), true);
    assert.equal(lesson.level, "2");
  }
});

test("getExercisesByLevel('2') contains only valid, Level 2 Exercises tied to a known lesson", () => {
  assert.equal(level2Exercises.length > 0, true);
  const lessonIds = new Set(level2Lessons.map((lesson) => lesson.id));
  for (const exercise of level2Exercises) {
    assert.equal(OL.isExercise(exercise), true);
    assert.equal(exercise.level, "2");
    assert.equal(lessonIds.has(exercise.lessonId), true);
  }
});

test("level2Exercises ramps through every difficulty exactly once per lesson", () => {
  const byLesson = new Map();
  for (const exercise of level2Exercises) {
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

test("the square worked example matches spec/educational-model.md's repeat sample", () => {
  const squareLesson = level2Lessons.find(
    (lesson) => lesson.id === "l2-square-repeat",
  );
  assert.ok(squareLesson);
  assert.equal(
    squareLesson.workedExamples[0].source,
    [
      "# why: a square is one side-and-turn idea repeated four times",
      "repeat 4",
      "  forward 80",
      "  right 90",
      "end repeat",
    ].join("\n"),
  );
});

test("every Level 2 worked example parses and runs with no diagnostics", () => {
  for (const lesson of level2Lessons) {
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

test("every Level 2 exercise reference solution parses and runs with no diagnostics", () => {
  for (const exercise of level2Exercises) {
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

test("the triangle reference solution turns the turtle back to its starting heading", () => {
  const triangle = level2Exercises.find(
    (exercise) => exercise.id === "l2-triangle-matching-turn",
  );
  assert.ok(triangle);

  const triangleResult = execute(
    triangle.referenceSolution.source,
    "triangle.logo",
  );
  const turnEvents = triangleResult.events.filter(
    (event) => event.kind === "turn",
  );
  const totalTurn = turnEvents.reduce(
    (sum, event) => sum + ((event.payload.to - event.payload.from + 360) % 360),
    0,
  );
  assert.equal(totalTurn, 360);
});

test("the house reference solution draws the square body with the pen down, walks to the roof without drawing, then draws the triangle roof with the pen down again", () => {
  const house = level2Exercises.find(
    (exercise) => exercise.id === "l2-house-square-and-triangle",
  );
  assert.ok(house);

  const houseResult = execute(house.referenceSolution.source, "house.logo");
  assert.deepEqual(houseResult.diagnostics, []);

  const penChanges = houseResult.events.filter(
    (event) => event.kind === "pen-change",
  );
  assert.deepEqual(
    penChanges.map((event) => event.payload),
    [
      { from: "down", to: "up" },
      { from: "up", to: "down" },
    ],
  );

  // The square body's four 90-degree turns and the triangle roof's three 120-degree turns
  // each close their own shape, plus the two repositioning turns (90, then 180) that walk
  // the pen from the square's top-left corner to its top-right corner while facing back
  // across the top edge: 4*90 + 90 + 180 + 3*120 = 990 degrees in total.
  const turnEvents = houseResult.events.filter(
    (event) => event.kind === "turn",
  );
  const totalTurn = turnEvents.reduce(
    (sum, event) => sum + ((event.payload.to - event.payload.from + 360) % 360),
    0,
  );
  assert.equal(totalTurn, 990);
});
