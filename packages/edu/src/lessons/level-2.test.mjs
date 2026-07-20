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

test("the tree reference solution draws the trunk with plain moves and turns, then repeat 3 stacks three identical triangle tiers straight up with no diagnostics", () => {
  const tree = level2Exercises.find(
    (exercise) => exercise.id === "l2-tree-trunk-and-tiers",
  );
  assert.ok(tree);

  const result = execute(tree.referenceSolution.source, "tree.logo");
  assert.deepEqual(result.diagnostics, []);

  // The trunk is drawn once with the pen already down, then pen_up/pen_down brackets it from
  // the first tier; each of the 3 repeat passes adds one more pen_up/pen_down pair (walking up
  // to the next tier): 1 initial pair + 3 pairs = 8 changes.
  const penChanges = result.events.filter(
    (event) => event.kind === "pen-change",
  );
  assert.equal(penChanges.length, 8);

  // The trunk closes for 360 degrees of turning (4 right-90 turns), and each of the 3 tiers
  // closes its own triangle for 360 degrees (3 right-120 turns): 360 + 3*360 = 1440.
  const turnEvents = result.events.filter((event) => event.kind === "turn");
  const totalTurn = turnEvents.reduce(
    (sum, event) => sum + ((event.payload.to - event.payload.from + 360) % 360),
    0,
  );
  assert.equal(totalTurn, 1440);

  // Every tier closes back to the same x as the trunk, so the tree grows straight up: the last
  // move lands directly above the start, at the trunk height (40) plus 3 walks of 25 between
  // tiers (40 + 3*25 = 115).
  const moves = result.events.filter((event) => event.kind === "move");
  const lastMove = moves[moves.length - 1];
  assert.equal(Math.round(lastMove.payload.to[0]), 0);
  assert.equal(Math.round(lastMove.payload.to[1]), 115);
});

test("the taller-tree reference solution only changes the repeat count, growing the same tree with twice as many tiers", () => {
  const tallerTree = level2Exercises.find(
    (exercise) => exercise.id === "l2-taller-tree-repeat",
  );
  assert.ok(tallerTree);

  const result = execute(
    tallerTree.referenceSolution.source,
    "taller-tree.logo",
  );
  assert.deepEqual(result.diagnostics, []);

  // 1 initial pen_up/pen_down pair plus one more pair per tier: 1 + 6 = 7 pairs = 14 changes.
  const penChanges = result.events.filter(
    (event) => event.kind === "pen-change",
  );
  assert.equal(penChanges.length, 14);

  // Trunk (360) plus 6 tiers of 360 each: 360 + 6*360 = 2520.
  const turnEvents = result.events.filter((event) => event.kind === "turn");
  const totalTurn = turnEvents.reduce(
    (sum, event) => sum + ((event.payload.to - event.payload.from + 360) % 360),
    0,
  );
  assert.equal(totalTurn, 2520);

  // Same trunk height (40) plus 6 walks of 25 between tiers: 40 + 6*25 = 190 -- taller than the
  // 3-tier tree's 115, purely from the bigger repeat count.
  const moves = result.events.filter((event) => event.kind === "move");
  const lastMove = moves[moves.length - 1];
  assert.equal(Math.round(lastMove.payload.to[0]), 0);
  assert.equal(Math.round(lastMove.payload.to[1]), 190);
});
