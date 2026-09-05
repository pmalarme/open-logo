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

// ---------------------------------------------------------------------------
// l3-where-a-name-is-born (issue #829) — saga #819's scoping ruling as a lesson.
// ---------------------------------------------------------------------------

/** Every printed value of `source`, in order, as a flat array of the numbers printed. */
function printedNumbers(source, label) {
  const result = execute(source, label);
  assert.deepEqual(
    result.diagnostics,
    [],
    `${label} raised diagnostics: ${JSON.stringify(result.diagnostics)}`,
  );
  return result.events
    .filter((event) => event.kind === "print")
    .flatMap((event) => event.payload.values);
}

/** The straight-line distance of every `move` event in `source`, in order. */
function sideLengths(source, label) {
  const result = execute(source, label);
  assert.deepEqual(
    result.diagnostics,
    [],
    `${label} raised diagnostics: ${JSON.stringify(result.diagnostics)}`,
  );
  return result.events
    .filter((event) => event.kind === "move")
    .map((event) => {
      const [fromX, fromY] = event.payload.from;
      const [toX, toY] = event.payload.to;
      return Math.round(Math.hypot(toX - fromX, toY - fromY) * 1e6) / 1e6;
    });
}

const bornLesson = level3Lessons.find(
  (lesson) => lesson.id === "l3-where-a-name-is-born",
);

test("the born-inside/born-outside worked examples really print 1 1 1 1 and 1 2 3 4", () => {
  assert.ok(bornLesson);
  assert.deepEqual(
    printedNumbers(bornLesson.workedExamples[0].source, "born-inside.logo"),
    [1, 1, 1, 1],
  );
  assert.deepEqual(
    printedNumbers(bornLesson.workedExamples[1].source, "born-outside.logo"),
    [1, 2, 3, 4],
  );
});

// The lesson's central claim is that the two programs differ by ONE MOVED LINE. Prose can say
// that and be wrong; this reconstructs the born-outside program from the born-inside one by
// moving `:x = 0` above the loop, and requires the result to be the shipped source exactly. If
// either example is edited so the bodies diverge, the contrast stops being a contrast and this
// fails rather than shipping two merely-similar programs.
test("the two worked examples differ only by where the :x = 0 line sits", () => {
  assert.ok(bornLesson);
  const insideLines = bornLesson.workedExamples[0].source.split("\n");
  const outsideLines = bornLesson.workedExamples[1].source.split("\n");

  const birthIndex = insideLines.findIndex((line) => line.trim() === ":x = 0");
  const repeatIndex = insideLines.findIndex((line) =>
    line.trim().startsWith("repeat"),
  );
  assert.ok(birthIndex > repeatIndex, "the first example must be born inside");

  const moved = [...insideLines];
  const [birthLine] = moved.splice(birthIndex, 1);
  moved.splice(repeatIndex, 0, birthLine.trim());
  // Only the `# why:` comment (line 0) is allowed to differ — the programs themselves must match.
  assert.deepEqual(moved.slice(1), outsideLines.slice(1));
});

// `spec/execution-model.md:367-369` says the `[ … ]` and long `… end` spellings are the same
// block scope, and `spec/execution-model.md:607-615` writes the normative contrast with
// brackets while the lesson uses the long form. That is a substitution the lesson depends on,
// so it is measured here rather than assumed: the spec's own two programs must print exactly
// what the lesson's two programs print.
test("the normative bracketed contrast prints the same as the lesson's long-form spelling", () => {
  assert.deepEqual(
    printedNumbers(
      "repeat 4 [ :x = 0   :x = :x + 1   print :x ]",
      "spec-born-inside.logo",
    ),
    [1, 1, 1, 1],
  );
  assert.deepEqual(
    printedNumbers(
      ":x = 0\nrepeat 4 [ :x = :x + 1   print :x ]",
      "spec-born-outside.logo",
    ),
    [1, 2, 3, 4],
  );
});

test("the third worked example grows its sides 20, 40, 60, 80 because :side outlives each turn", () => {
  assert.ok(bornLesson);
  assert.deepEqual(
    sideLengths(bornLesson.workedExamples[2].source, "growing-square.logo"),
    [20, 40, 60, 80],
  );
});

// The counterfactual that worked example states in prose: "Had :side = 20 been written inside
// the body … the turtle would have drawn a plain square." Built by editing the shipped source,
// so the claim tracks the program a learner is actually shown.
test("moving the third example's birth line inside the loop really does draw a plain square", () => {
  assert.ok(bornLesson);
  const source = bornLesson.workedExamples[2].source;
  assert.equal(source.includes("\n:side = 20\nrepeat 4\n"), true);
  const bornInside = source.replace(
    "\n:side = 20\nrepeat 4\n",
    "\nrepeat 4\n  :side = 20\n",
  );
  assert.deepEqual(
    sideLengths(bornInside, "plain-square.logo"),
    [20, 20, 20, 20],
  );
});

test("l3-born-outside-count-up counts 1 2 3 4 from one moved line", () => {
  const exercise = level3Exercises.find(
    (item) => item.id === "l3-born-outside-count-up",
  );
  assert.ok(exercise);
  assert.deepEqual(
    printedNumbers(exercise.referenceSolution.source, "count-up.logo"),
    [1, 2, 3, 4],
  );
});

test("l3-born-outside-growing-sides draws 30, 60, 90, 120", () => {
  const exercise = level3Exercises.find(
    (item) => item.id === "l3-born-outside-growing-sides",
  );
  assert.ok(exercise);
  assert.deepEqual(
    sideLengths(exercise.referenceSolution.source, "growing-sides.logo"),
    [30, 60, 90, 120],
  );
});

test("l3-snail-shell winds outward — twelve growing sides that never return to the start", () => {
  const exercise = level3Exercises.find((item) => item.id === "l3-snail-shell");
  assert.ok(exercise);
  const source = exercise.referenceSolution.source;
  const lengths = sideLengths(source, "snail-shell.logo");
  assert.deepEqual(
    lengths,
    [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120],
  );

  // "the path can never come back to where it started" — the shell claim, measured rather than
  // inferred from the lengths: no move ends where the very first one began.
  const result = execute(source, "snail-shell.logo");
  const moves = result.events.filter((event) => event.kind === "move");
  const [startX, startY] = moves[0].payload.from;
  for (const move of moves) {
    const [toX, toY] = move.payload.to;
    assert.ok(
      Math.hypot(toX - startX, toY - startY) > 1e-6,
      "the shell closed back onto its starting point",
    );
  }

  // And the stated counterfactual: born inside, the same twelve turns retrace one small square.
  assert.equal(source.includes("\n:side = 10\nrepeat 12\n"), true);
  const bornInside = source.replace(
    "\n:side = 10\nrepeat 12\n",
    "\nrepeat 12\n  :side = 10\n",
  );
  assert.deepEqual(
    sideLengths(bornInside, "retraced-square.logo"),
    [10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10],
  );
});
