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

/**
 * Runs `source`, asserting it is diagnostic-free, and returns the shapes the lesson's prose makes
 * claims about: what it printed, how long each stroke was, and the turtle's path.
 *
 * Round 1 of the review gate found the earlier version of these tests measuring **only** stroke
 * lengths, which is strictly weaker than the prose: a reviewer mutated `right 90` to `right 80`
 * in a lesson source, confirmed the change reached `dist`, and all 19 Level 3 tests still passed
 * — so "the turtle would have drawn a plain square" was an unchecked assertion sitting beside a
 * green suite. Turn angles and closure are therefore measured too.
 */
function measure(source, label) {
  const result = execute(source, label);
  assert.deepEqual(
    result.diagnostics,
    [],
    `${label} raised diagnostics: ${JSON.stringify(result.diagnostics)}`,
  );
  // `+ 0` normalises `-0` to `0`: floating-point turns can land a coordinate on negative zero,
  // which `deepStrictEqual` and a `${x},${y}` key both treat as different from `0`.
  const round = (value) => {
    const rounded = Math.round(value * 1e6) / 1e6;
    return rounded === 0 ? 0 : rounded;
  };
  const moves = result.events.filter((event) => event.kind === "move");
  const points = moves.map((move) => move.payload.to);
  return {
    printed: result.events
      .filter((event) => event.kind === "print")
      .flatMap((event) => event.payload.values),
    lengths: moves.map((move) => {
      const [fromX, fromY] = move.payload.from;
      const [toX, toY] = move.payload.to;
      return round(Math.hypot(toX - fromX, toY - fromY));
    }),
    drawnStrokes: result.events.filter((event) => event.kind === "draw-segment")
      .length,
    strokes: moves.map((move) => [
      move.payload.from.map(round),
      move.payload.to.map(round),
    ]),
    start: moves.length > 0 ? moves[0].payload.from : undefined,
    points: points.map(([x, y]) => [round(x), round(y)]),
  };
}

/** How many DISTINCT points a path visits, so a retraced figure can be told from a growing one. */
function distinctPoints(points) {
  return new Set(points.map(([x, y]) => `${x},${y}`)).size;
}

const bornLesson = level3Lessons.find(
  (lesson) => lesson.id === "l3-where-a-name-is-born",
);

test("the born-inside/born-outside worked examples really print 1 1 1 1 and 1 2 3 4", () => {
  assert.ok(bornLesson);
  assert.deepEqual(
    measure(bornLesson.workedExamples[0].source, "born-inside.logo").printed,
    [1, 1, 1, 1],
  );
  assert.deepEqual(
    measure(bornLesson.workedExamples[1].source, "born-outside.logo").printed,
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
    measure("repeat 4 [ :x = 0   :x = :x + 1   print :x ]", "spec-inside.logo")
      .printed,
    [1, 1, 1, 1],
  );
  assert.deepEqual(
    measure(":x = 0\nrepeat 4 [ :x = :x + 1   print :x ]", "spec-outside.logo")
      .printed,
    [1, 2, 3, 4],
  );
});

test("the third worked example grows its sides 20, 40, 60, 80 because :side outlives each turn", () => {
  assert.ok(bornLesson);
  const grown = measure(
    bornLesson.workedExamples[2].source,
    "growing-square.logo",
  );
  assert.deepEqual(grown.lengths, [20, 40, 60, 80]);
  // Four different lengths means four different corners: the path cannot close.
  assert.equal(distinctPoints(grown.points), 4);
  assert.ok(
    Math.hypot(
      grown.points[3][0] - grown.start[0],
      grown.points[3][1] - grown.start[1],
    ) > 1e-6,
    "a growing square must not return to its starting point",
  );
});

// The counterfactual worked example 3 states in prose: "Had :side = 20 been written inside the
// body … the turtle would have drawn a plain square." Built by editing the shipped source, and
// asserted as a SQUARE — four equal sides AND four right-angle corners AND a closed path — not
// merely as four equal lengths, which is what round 1's mutation probe slipped through.
test("moving the third example's birth line inside the loop really does draw a plain square", () => {
  assert.ok(bornLesson);
  const source = bornLesson.workedExamples[2].source;
  assert.equal(source.includes("\n:side = 20\nrepeat 4\n"), true);
  const bornInside = source.replace(
    "\n:side = 20\nrepeat 4\n",
    "\nrepeat 4\n  :side = 20\n",
  );
  assert.notEqual(bornInside, source, "the counterfactual edit did not apply");

  const square = measure(bornInside, "plain-square.logo");
  assert.deepEqual(square.lengths, [20, 20, 20, 20]);
  // A square, specifically: the four corners are the four points of a 20-unit box, and the
  // fourth side lands back on the start. A 20-unit rhombus (right 80) fails both.
  assert.equal(distinctPoints(square.points), 4);
  assert.deepEqual(square.points, [
    [0, 20],
    [20, 20],
    [20, 0],
    [0, 0],
  ]);
  assert.deepEqual(square.start, [0, 0]);
});

test("l3-born-outside-count-up counts 1 2 3 4 from one moved line", () => {
  const exercise = level3Exercises.find(
    (item) => item.id === "l3-born-outside-count-up",
  );
  assert.ok(exercise);
  const source = exercise.referenceSolution.source;
  assert.deepEqual(measure(source, "count-up.logo").printed, [1, 2, 3, 4]);

  // The prompt describes the program the learner STARTS from — born inside, printing 1 1 1 1 —
  // and asks for one line to be moved. Round 1 found that starting program unmeasured, so the
  // prompt was making two claims (its output, and "only one line moved") that nothing checked.
  assert.equal(source.includes("\n:count = 0\nrepeat 4\n"), true);
  const startingPoint = source.replace(
    "\n:count = 0\nrepeat 4\n",
    "\nrepeat 4\n  :count = 0\n",
  );
  assert.notEqual(startingPoint, source, "the prompt's edit did not apply");
  assert.deepEqual(
    measure(startingPoint, "count-up-before.logo").printed,
    [1, 1, 1, 1],
  );
  // "Move the single line … change nothing else": the two programs are the same multiset of
  // trimmed lines, so the diff really is a move rather than an edit.
  const trimmedLines = (text) =>
    text
      .split("\n")
      .map((line) => line.trim())
      .sort();
  assert.deepEqual(trimmedLines(startingPoint), trimmedLines(source));
});

test("l3-born-outside-growing-sides grows the drawing and totals the distance with two names", () => {
  const exercise = level3Exercises.find(
    (item) => item.id === "l3-born-outside-growing-sides",
  );
  assert.ok(exercise);
  const source = exercise.referenceSolution.source;
  const grown = measure(source, "growing-sides.logo");
  assert.deepEqual(grown.lengths, [30, 60, 90, 120]);
  assert.deepEqual(grown.printed, [300]);

  // Both counterfactuals the explanation states, each built from the shipped source. Born
  // inside, `:side` restarts so every side is 30…
  assert.equal(source.includes("\n:side = 30\n:total = 0\nrepeat 4\n"), true);
  const sideInside = source.replace(
    "\n:side = 30\n:total = 0\nrepeat 4\n",
    "\n:total = 0\nrepeat 4\n  :side = 30\n",
  );
  assert.notEqual(sideInside, source, "the :side edit did not apply");
  assert.deepEqual(
    measure(sideInside, "sides-equal.logo").lengths,
    [30, 30, 30, 30],
  );

  // …and born inside, `:total` does not merely restart — it is gone by the time `print` runs,
  // which is the block-lifetime half of the ruling (`spec/execution-model.md:603-605`) and a
  // sharper claim than "the number would be wrong". Measured, including the message.
  const totalInside = source.replace(
    "\n:side = 30\n:total = 0\nrepeat 4\n",
    "\n:side = 30\nrepeat 4\n  :total = 0\n",
  );
  assert.notEqual(totalInside, source, "the :total edit did not apply");
  const gone = execute(totalInside, "total-gone.logo");
  assert.deepEqual(
    gone.events.filter((event) => event.kind === "print"),
    [],
  );
  assert.equal(gone.diagnostics.length, 1);
  assert.equal(gone.diagnostics[0].code, "ol-undefined-var");
  assert.equal(gone.diagnostics[0].message.includes("has no value yet"), true);
});

/**
 * True when segments `[a, b]` and `[c, d]` properly cross. Round 2 (@ai-tutor N11) measured that
 * the earlier 9-side, 360-degree horns interlaced seven times — "a pair of curled horns" that
 * tangles is not the object the challenge names. Crossing is a claim about the picture that no
 * length list or mirror check can make, so it is measured directly.
 */
function segmentsCross([a, b], [c, d]) {
  const cross = (p, q, r) =>
    (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  return (
    ((d1 > 1e-9 && d2 < -1e-9) || (d1 < -1e-9 && d2 > 1e-9)) &&
    ((d3 > 1e-9 && d4 < -1e-9) || (d3 < -1e-9 && d4 > 1e-9))
  );
}

test("l3-curled-horns draws two mirrored curls that do not tangle, and only because :side is set back", () => {
  const exercise = level3Exercises.find(
    (item) => item.id === "l3-curled-horns",
  );
  assert.ok(exercise);
  const source = exercise.referenceSolution.source;
  const horns = measure(source, "curled-horns.logo");

  // Seven growing sides per horn, plus the undrawn `home` move between them.
  const sevenSides = [10, 16, 22, 28, 34, 40, 46];
  assert.equal(horns.drawnStrokes, 14);
  assert.deepEqual(horns.lengths.slice(0, 7), sevenSides);
  assert.deepEqual(horns.lengths.slice(8), sevenSides);

  // "The two horns mirror each other exactly" — the composition claim, and the one a length
  // list cannot prove. The left horn's points are the right horn's reflected in x.
  const right = horns.points.slice(0, 7);
  const left = horns.points.slice(8);
  assert.equal(left.length, 7);
  for (let index = 0; index < 7; index += 1) {
    assert.ok(
      Math.abs(left[index][0] + right[index][0]) < 1e-6 &&
        Math.abs(left[index][1] - right[index][1]) < 1e-6,
      `horn point ${index} is not mirrored: ${JSON.stringify(left[index])} vs ${JSON.stringify(right[index])}`,
    );
  }
  // A curl, not a closed polygon: seven sides, seven distinct points per horn.
  assert.equal(distinctPoints(right), 7);

  // …and the two curls stay clear of each other, so the drawing matches the name.
  const rightSegments = horns.strokes.slice(0, 7);
  const leftSegments = horns.strokes.slice(8);
  for (const rightSegment of rightSegments) {
    for (const leftSegment of leftSegments) {
      assert.equal(
        segmentsCross(rightSegment, leftSegment),
        false,
        `the horns cross: ${JSON.stringify(rightSegment)} vs ${JSON.stringify(leftSegment)}`,
      );
    }
  }

  // The stated counterfactual: drop the second `:side = 10` and the left horn carries on from
  // 52, so the pair stops mirroring. Both halves are asserted — the wrong lengths, and the
  // broken symmetry — because either alone would pass under a different defect.
  const withoutReset = source
    .split("\n")
    .filter((line, index, lines) => {
      const previous = lines[index - 1] ?? "";
      return !(
        line === ":side = 10" && previous.startsWith("# — leave this line out")
      );
    })
    .join("\n");
  assert.notEqual(
    withoutReset,
    source,
    "the counterfactual line was not removed",
  );
  const broken = measure(withoutReset, "horns-no-reset.logo");
  assert.deepEqual(broken.lengths.slice(8), [52, 58, 64, 70, 76, 82, 88]);
  const brokenLeft = broken.points.slice(8);
  assert.ok(
    Math.abs(brokenLeft[0][0] + right[0][0]) > 1e-6 ||
      Math.abs(brokenLeft[0][1] - right[0][1]) > 1e-6,
    "without setting :side back the second horn must stop mirroring",
  );
});
