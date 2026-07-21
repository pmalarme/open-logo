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

test("the house's door and two windows sit inside the square body, on either side of the door, without overlapping", () => {
  const house = level1Exercises.find(
    (exercise) => exercise.id === "l1-house-square-and-triangle",
  );
  assert.ok(house);

  const houseResult = execute(house.referenceSolution.source, "house.logo");
  assert.deepEqual(houseResult.diagnostics, []);

  // Coordinates come straight from executing the source; a tolerance absorbs floating-point
  // noise (e.g. a computed 0 landing at -5.5e-14) without hiding a real geometric mistake.
  const EPSILON = 1e-6;
  const near = (actual, expected) => Math.abs(actual - expected) < EPSILON;
  const assertPoint = (point, [expectedX, expectedY], label) => {
    assert.ok(
      near(point[0], expectedX) && near(point[1], expectedY),
      `${label}: expected (${expectedX}, ${expectedY}), got (${point[0]}, ${point[1]})`,
    );
  };

  const moveEvents = houseResult.events.filter(
    (event) => event.kind === "move",
  );

  // Every pen-down move, in source order: square (4), roof (3), door (3), window one (4),
  // window two (4) -- pen-up repositioning moves are interleaved but are not "pen-change"
  // events themselves, so we instead pick out each shape's moves by their known index among
  // ALL move events (pen up and down alike), verified once against the full runtime trace.
  const doorMoves = moveEvents.slice(12, 15); // (30,0)->(30,30)->(50,30)->(50,0)
  const window1Moves = moveEvents.slice(17, 21); // the first enclosed window square
  const window2Moves = moveEvents.slice(22, 26); // the second enclosed window square

  // The door: three sides only (its open bottom edge is already the ground line), directly
  // beneath the roof's midpoint, well inside the square body's own [0, 80] x [0, 80] footprint.
  assertPoint(doorMoves[0].payload.from, [30, 0], "door bottom-left corner");
  assertPoint(doorMoves[0].payload.to, [30, 30], "door top-left corner");
  assertPoint(doorMoves[1].payload.to, [50, 30], "door top-right corner");
  assertPoint(doorMoves[2].payload.to, [50, 0], "door bottom-right corner");

  // The first window: an enclosed square strictly to the right of the door.
  assertPoint(
    window1Moves[0].payload.from,
    [55, 15],
    "first window bottom-left corner",
  );
  assertPoint(
    window1Moves[3].payload.to,
    [55, 15],
    "first window closes back to start",
  );
  const window1MaxX = Math.max(
    ...window1Moves.flatMap((move) => [
      move.payload.from[0],
      move.payload.to[0],
    ]),
  );
  assert.ok(near(window1MaxX, 70), "first window's right edge is at x=70");

  // The second window: an enclosed square strictly to the left of the door -- this is the
  // exact placement a prior review round questioned by hand-tracing the turn sequence; the
  // runtime trace confirms the turtle returns to its entering (north) heading after closing
  // the first window's square, so `left 90` turns it west, not south.
  assertPoint(
    window2Moves[0].payload.from,
    [5, 15],
    "second window bottom-left corner",
  );
  assertPoint(
    window2Moves[3].payload.to,
    [5, 15],
    "second window closes back to start",
  );
  const window2MaxX = Math.max(
    ...window2Moves.flatMap((move) => [
      move.payload.from[0],
      move.payload.to[0],
    ]),
  );
  assert.ok(near(window2MaxX, 20), "second window's right edge is at x=20");

  // Neither window overlaps the door, and the second window sits entirely to the left of the
  // first, with both fully inside the square body's [0, 80] x [0, 80] footprint.
  assert.ok(window2MaxX <= 30, "second window must not overlap the door");
  assert.ok(window1MaxX <= 80, "first window must stay inside the square body");
  assert.ok(55 >= 50, "first window must be right of the door");
});
