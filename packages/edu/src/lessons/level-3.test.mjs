// Unit tests for the Level 3 lesson + graded exercises (issue #325): shape validation via the
// `Lesson`/`Exercise` type guards, plus running every embedded OpenLogo source through
// `@openlogo/runtime` so a lesson can never drift from real execution behavior.
import assert from "node:assert/strict";
import { test } from "node:test";
import * as OL from "@openlogo/edu";
import { execute } from "@openlogo/runtime";

const level3Lessons = OL.getLessonsByLevel("3");
const level3Exercises = OL.getExercisesByLevel("3");

test("getLessonsByLevel('3') contains only valid, Level 3 Lessons", () => {
  assert.equal(level3Lessons.length > 0, true);
  for (const lesson of level3Lessons) {
    assert.equal(OL.isLesson(lesson), true);
    assert.equal(lesson.level, "3");
  }
});

test("getExercisesByLevel('3') contains only valid, Level 3 Exercises tied to a known lesson", () => {
  assert.equal(level3Exercises.length > 0, true);
  const lessonIds = new Set(level3Lessons.map((lesson) => lesson.id));
  for (const exercise of level3Exercises) {
    assert.equal(OL.isExercise(exercise), true);
    assert.equal(exercise.level, "3");
    assert.equal(lessonIds.has(exercise.lessonId), true);
  }
});

test("level3Exercises ramps through every difficulty exactly once per lesson", () => {
  const byLesson = new Map();
  for (const exercise of level3Exercises) {
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

test("the :size square worked examples match spec/educational-model.md's two variable samples", () => {
  const sizeLesson = level3Lessons.find(
    (lesson) => lesson.id === "l3-size-square",
  );
  assert.ok(sizeLesson);
  assert.equal(
    sizeLesson.workedExamples[0].source,
    [
      "# why: changing :size once changes every side",
      ":size = 80",
      "repeat 4",
      "  forward :size",
      "  right 90",
      "end repeat",
    ].join("\n"),
  );
  assert.equal(
    sizeLesson.workedExamples[1].source,
    [
      "# why: the worded form says the same idea in a sentence",
      "set size to 100",
      "repeat 4",
      "  forward :size",
      "  right 90",
      "end repeat",
    ].join("\n"),
  );
});

test("the third worked example both reads and writes :size in one statement", () => {
  const sizeLesson = level3Lessons.find(
    (lesson) => lesson.id === "l3-size-square",
  );
  assert.ok(sizeLesson);
  assert.equal(
    sizeLesson.workedExamples[2].source.includes(":size = :size + 10"),
    true,
  );
});

test("no Level 3 content uses a Level 4+ concept (if, comparisons, or define)", () => {
  const forbidden = [/\bif\b/, /\bdefine\b/, /==/, /!=/];
  const sources = [
    ...level3Lessons.flatMap((lesson) =>
      lesson.workedExamples.map((example) => example.source),
    ),
    ...level3Exercises.map((exercise) => exercise.referenceSolution.source),
  ];
  for (const source of sources) {
    for (const pattern of forbidden) {
      assert.equal(
        pattern.test(source),
        false,
        `found forbidden pattern ${pattern} in: ${source}`,
      );
    }
  }
});

test("every Level 3 worked example parses and runs with no diagnostics", () => {
  for (const lesson of level3Lessons) {
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

test("every Level 3 exercise reference solution parses and runs with no diagnostics", () => {
  for (const exercise of level3Exercises) {
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

test("l3-size-square-introduce draws every side at the same :size length", () => {
  const exercise = level3Exercises.find(
    (item) => item.id === "l3-size-square-introduce",
  );
  assert.ok(exercise);
  const result = execute(exercise.referenceSolution.source, "introduce.logo");
  const moves = result.events.filter((event) => event.kind === "move");
  assert.equal(moves.length, 4);
  for (const move of moves) {
    const [fromX, fromY] = move.payload.from;
    const [toX, toY] = move.payload.to;
    const distance = Math.hypot(toX - fromX, toY - fromY);
    assert.ok(Math.abs(distance - 60) < 1e-6);
  }
});

test("l3-size-square-resize grows every side of the second square together after one change", () => {
  const exercise = level3Exercises.find(
    (item) => item.id === "l3-size-square-resize",
  );
  assert.ok(exercise);
  const result = execute(exercise.referenceSolution.source, "resize.logo");
  const moves = result.events.filter((event) => event.kind === "move");
  assert.equal(moves.length, 8);
  const firstSquare = moves.slice(0, 4);
  const secondSquare = moves.slice(4, 8);
  const distanceOf = (move) => {
    const [fromX, fromY] = move.payload.from;
    const [toX, toY] = move.payload.to;
    return Math.hypot(toX - fromX, toY - fromY);
  };
  for (const move of firstSquare) {
    assert.ok(Math.abs(distanceOf(move) - 60) < 1e-6);
  }
  for (const move of secondSquare) {
    assert.ok(Math.abs(distanceOf(move) - 120) < 1e-6);
  }
});

test("l3-size-house resizes the walls and the roof together from one :size", () => {
  const exercise = level3Exercises.find((item) => item.id === "l3-size-house");
  assert.ok(exercise);
  const result = execute(exercise.referenceSolution.source, "house.logo");
  const moves = result.events.filter((event) => event.kind === "move");
  // 4 wall sides + 2 repositioning moves (pen up) + 3 roof sides = 9 moves.
  assert.equal(moves.length, 9);
  const distanceOf = (move) => {
    const [fromX, fromY] = move.payload.from;
    const [toX, toY] = move.payload.to;
    return Math.hypot(toX - fromX, toY - fromY);
  };
  for (const move of moves) {
    assert.ok(Math.abs(distanceOf(move) - 70) < 1e-6);
  }
});
