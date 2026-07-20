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

test("level2Exercises includes every rung of the difficulty ramp at least once per lesson", () => {
  const byLesson = new Map();
  for (const exercise of level2Exercises) {
    const difficulties = byLesson.get(exercise.lessonId) ?? new Set();
    difficulties.add(exercise.difficulty);
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

test("the house reference solution draws the square body, walks to the roof, draws it, then places a door and two windows all with the pen up between shapes", () => {
  const house = level2Exercises.find(
    (exercise) => exercise.id === "l2-house-square-and-triangle",
  );
  assert.ok(house);

  const houseResult = execute(house.referenceSolution.source, "house.logo");
  assert.deepEqual(houseResult.diagnostics, []);

  // Four shapes are drawn with the pen down (body, roof, door, window, window), each preceded
  // by a pen_up walk to reposition — except the very first, which starts with the pen already
  // down — so the pen alternates down/up/down/up/down/up/down/up: 8 changes in total.
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

test("the two-houses reference solution repeats the whole house pattern twice, drawing two houses with no diagnostics", () => {
  const twoHouses = level2Exercises.find(
    (exercise) => exercise.id === "l2-two-houses-repeat",
  );
  assert.ok(twoHouses);

  const result = execute(twoHouses.referenceSolution.source, "two-houses.logo");
  assert.deepEqual(result.diagnostics, []);

  // Each pass of the outer repeat draws one house (square body + triangle roof only, without
  // the door/windows), alternating pen down/up/down/up four times per pass: 8 changes in total
  // across the two passes.
  const penChanges = result.events.filter(
    (event) => event.kind === "pen-change",
  );
  assert.equal(penChanges.length, 8);

  // The final move of the second pass ends 300 units over from the first house's start corner —
  // 150 units per house — confirming the second house was drawn beside the first, not on top of
  // it.
  const moves = result.events.filter((event) => event.kind === "move");
  const lastMove = moves[moves.length - 1];
  assert.equal(Math.round(lastMove.payload.to[0]), 300);
});
