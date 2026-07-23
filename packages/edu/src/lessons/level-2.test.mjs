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

test("the tree reference solution draws the trunk with plain moves and turns, then repeat 3 stacks three identical up-pointing triangles that overlap into layered fir branches", () => {
  const tree = level2Exercises.find(
    (exercise) => exercise.id === "l2-tree-trunk-and-tiers",
  );
  assert.ok(tree);

  const result = execute(tree.referenceSolution.source, "tree.logo");
  assert.deepEqual(result.diagnostics, []);

  // The trunk is drawn once with the pen already down, then one pen_up/pen_down pair steps to the
  // first branch, and each of the 3 repeat passes adds one more pen_up/pen_down pair (walking up
  // to the next branch): 1 step pair + 3 branch pairs = 8 changes.
  const penChanges = result.events.filter(
    (event) => event.kind === "pen-change",
  );
  assert.equal(penChanges.length, 8);

  // Every turn is a closed figure, so the turtle ends facing exactly where it started: the sum of
  // all turns is a whole number of full circles.
  const turnEvents = result.events.filter((event) => event.kind === "turn");
  const totalTurn = turnEvents.reduce(
    (sum, event) => sum + ((event.payload.to - event.payload.from + 360) % 360),
    0,
  );
  assert.equal(totalTurn % 360, 0);

  // Move events run: 4 trunk sides (index 0-3), 2 one-time pen-up steps to the first branch's base
  // (index 4-5), then per branch 3 triangle sides plus 1 walk-up-to-the-next-branch move -- so
  // branch N's 3 sides sit at indexes 6 + 4*N, 7 + 4*N, 8 + 4*N.
  const moves = result.events.filter((event) => event.kind === "move");
  const branchStartIndexes = [6, 10, 14];
  const branchMoves = branchStartIndexes.map((start) =>
    moves.slice(start, start + 3),
  );

  // Every branch is drawn by the exact same repeat body, so the three side vectors of each branch
  // are identical from one branch to the next -- the tree is one rule repeated, not three shapes.
  const sideVectors = (tierMoves) =>
    tierMoves.map((move) => [
      Math.round(move.payload.to[0] - move.payload.from[0]),
      Math.round(move.payload.to[1] - move.payload.from[1]),
    ]);
  for (let i = 1; i < branchMoves.length; i += 1) {
    assert.deepEqual(sideVectors(branchMoves[i]), sideVectors(branchMoves[0]));
  }

  // Every branch must be an UP-POINTING equilateral triangle -- the fix's whole point: the old
  // design pointed sideways/right and merely closed, which these vectors-only checks would also
  // accept, so pin the actual silhouette. For each branch, take its three corners (each side's
  // start, since the third side closes back to the first), and assert (a) it closes, (b) all three
  // sides are the same length, and (c) it points up: exactly one corner (the apex) sits strictly
  // above the other two, and those other two (the base) share a y, so the base is horizontal below
  // the apex. A downward- or sideways-pointing triangle fails (c).
  for (const tierMoves of branchMoves) {
    const [sideA, sideB, sideC] = tierMoves;
    assert.deepEqual(
      sideC.payload.to.map((value) => Math.round(value)),
      sideA.payload.from.map((value) => Math.round(value)),
      "each branch triangle must close back to its first corner",
    );
    const sideLength = (move) =>
      Math.round(
        Math.hypot(
          move.payload.to[0] - move.payload.from[0],
          move.payload.to[1] - move.payload.from[1],
        ),
      );
    assert.equal(sideLength(sideA), sideLength(sideB));
    assert.equal(sideLength(sideB), sideLength(sideC));

    const corners = [
      sideA.payload.from,
      sideB.payload.from,
      sideC.payload.from,
    ];
    const cornerYs = corners.map((corner) => corner[1]);
    const apexY = Math.max(...cornerYs);
    const baseYs = cornerYs.filter((y) => apexY - y > 1e-6);
    assert.equal(
      baseYs.length,
      2,
      "an up-pointing triangle has exactly two corners below its apex",
    );
    assert.ok(
      Math.abs(baseYs[0] - baseYs[1]) < 1e-6,
      "the two base corners must share a y, so the base is horizontal below the apex",
    );
  }

  // Each branch starts part of the way up the branch below, so consecutive branches OVERLAP in
  // vertical space (unlike a stack of separate triangles): the layered overlap is what makes the
  // slanted edges read as fir branches rather than a column of triangles. Use a real interval
  // intersection so the overlap is genuine, not just "the next branch starts before the previous
  // one ends".
  const branchRanges = branchMoves.map((tierMoves) => {
    const ys = tierMoves.flatMap((move) => [
      move.payload.from[1],
      move.payload.to[1],
    ]);
    return { min: Math.min(...ys), max: Math.max(...ys) };
  });
  for (let i = 1; i < branchRanges.length; i += 1) {
    const previous = branchRanges[i - 1];
    const current = branchRanges[i];
    assert.ok(
      Math.max(previous.min, current.min) <
        Math.min(previous.max, current.max) - 1e-6,
      `branch ${i} must overlap branch ${i - 1}: branch ${i - 1} spans [${previous.min}, ${previous.max}], branch ${i} spans [${current.min}, ${current.max}]`,
    );
  }

  // The trunk and every branch share the same center line, so the tree grows straight up: the last
  // move lands at the branches' common left edge (-30), 40 above the trunk top (40) plus 3 walks of
  // 40 between branches -- 40 + 3*40 = 160.
  const lastMove = moves[moves.length - 1];
  assert.equal(Math.round(lastMove.payload.to[0]), -30);
  assert.equal(Math.round(lastMove.payload.to[1]), 160);
});

test("the taller-tree reference solution's source is identical to the tree's, except the repeat count", () => {
  const tree = level2Exercises.find(
    (exercise) => exercise.id === "l2-tree-trunk-and-tiers",
  );
  const tallerTree = level2Exercises.find(
    (exercise) => exercise.id === "l2-taller-tree-repeat",
  );
  assert.ok(tree);
  assert.ok(tallerTree);

  // Swapping "repeat 3 [" for "repeat 6 [" in the tree's source must produce exactly the
  // taller-tree's source -- proving the only change between the two exercises is the number
  // passed to repeat, with no other line (including comments) rewritten.
  assert.equal(
    tree.referenceSolution.source.replace("repeat 3 [", "repeat 6 ["),
    tallerTree.referenceSolution.source,
  );
});

test("the taller-tree reference solution only changes the repeat count, growing the same tree with twice as many branches", () => {
  const tallerTree = level2Exercises.find(
    (exercise) => exercise.id === "l2-taller-tree-repeat",
  );
  assert.ok(tallerTree);

  const result = execute(
    tallerTree.referenceSolution.source,
    "taller-tree.logo",
  );
  assert.deepEqual(result.diagnostics, []);

  // 1 step pair plus one more pair per branch: 1 + 6 = 7 pairs = 14 changes.
  const penChanges = result.events.filter(
    (event) => event.kind === "pen-change",
  );
  assert.equal(penChanges.length, 14);

  // Still a set of closed figures, so the turtle ends facing where it started.
  const turnEvents = result.events.filter((event) => event.kind === "turn");
  const totalTurn = turnEvents.reduce(
    (sum, event) => sum + ((event.payload.to - event.payload.from + 360) % 360),
    0,
  );
  assert.equal(totalTurn % 360, 0);

  // Same trunk top (40) plus 6 walks of 40 between branches: 40 + 6*40 = 280 -- taller than the
  // 3-branch tree's 160, purely from the bigger repeat count.
  const moves = result.events.filter((event) => event.kind === "move");
  const lastMove = moves[moves.length - 1];
  assert.equal(Math.round(lastMove.payload.to[0]), -30);
  assert.equal(Math.round(lastMove.payload.to[1]), 280);
});
