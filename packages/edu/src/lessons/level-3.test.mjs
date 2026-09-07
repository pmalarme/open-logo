// Unit tests for the Level 3 lesson + graded exercises (issue #325): shape validation via the
// `Lesson`/`Exercise` type guards, plus running every embedded OpenLogo source through
// `@openlogo/runtime` so a lesson can never drift from real execution behavior.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import * as OL from "@openlogo/edu";
import { execute } from "@openlogo/runtime";

// This test lives at packages/edu/src/lessons/, so the repo root is four levels up.
const repoRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "..",
);

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

// Issue #1124 stated the same contrast normatively, as a Level 3 core idea in
// `spec/educational-model.md`. That sentence is prose in a maintainer-owned document, so nothing
// read it — the same duplication-drift exposure that justified the Level 5 spec-surface gate in
// `level-5.test.mjs`, raised by @ai-tutor in round 2 as asymmetric protection for symmetric
// prose. This binds the document's claim to measured behavior: the bullet must name both sides of
// the contrast, and the runtime must actually produce it. The spec is READ, never written.
test("spec/educational-model.md's Level 3 lifetime bullet names both sides, and the runtime produces them", () => {
  const specText = readFileSync(
    join(repoRoot, "spec/educational-model.md"),
    "utf8",
  ).replace(/\r\n/g, "\n");
  // Fail on the real cause. `indexOf` returns -1 on a renamed heading and `slice(-1)` then yields
  // the document's last character, so every assertion below would report a missing bullet and send
  // the maintainer hunting for a deletion that never happened (@ai-tutor, round 7).
  const headingIndex = specText.indexOf("## Level 3 — variables");
  assert.notEqual(
    headingIndex,
    -1,
    "spec/educational-model.md no longer has a '## Level 3 — variables' heading; this gate locates the bullet by that heading",
  );
  const level3Section = specText.slice(headingIndex);
  // …and on the section-end anchor too, bounded by Level 3's OWN heading run. Two separate
  // failures hide here and only the second is obvious. Asserting `indexOf("```") !== -1` catches a
  // document with no fence at all, but `level3Section` runs to end-of-file, so deleting Level 3's
  // own fence makes `indexOf` succeed against **Level 4's** — the scan then bleeds into the next
  // level and still reports green (@curriculum and @ai-tutor, round 9; measured at 8 -> 14
  // bullets). Slicing at the next `## ` first makes the fence assertion mean what its message
  // says. A detector that silently widens its scope reports a clean corpus forever.
  const sectionEnd = level3Section.indexOf("\n## ", 1);
  assert.notEqual(
    sectionEnd,
    -1,
    "spec/educational-model.md's Level 3 section is no longer followed by another '## ' heading; this gate bounds the section by it",
  );
  const section = level3Section.slice(0, sectionEnd);
  const fenceIndex = section.indexOf("```");
  assert.notEqual(
    fenceIndex,
    -1,
    "spec/educational-model.md's Level 3 section no longer has a code fence; this gate reads the bullet run that ends at it",
  );
  const bullets = section
    .slice(0, fenceIndex)
    .split("\n")
    .filter((line) => line.startsWith("- "));
  const lifetimeBullets = bullets.filter((line) => /\bborn\b/.test(line));
  assert.equal(
    lifetimeBullets.length,
    1,
    `expected exactly one Level 3 name-lifetime bullet in spec/educational-model.md, found ${lifetimeBullets.length}`,
  );
  const bullet = lifetimeBullets[0];

  // Both sides of the contrast, each BOUND to its own claim. Presence-checking the four words
  // somewhere in the bullet is not enough: a contrast has an orientation, and all three round-3
  // reviewers independently showed that four independent existence checks pass on a bullet that
  // states the contrast BACKWARDS — the natural failure mode when someone later "tightens" a
  // sentence they misread. So the bullet is split at its contrast conjunction and each clause
  // must carry its own outcome, must NOT carry the other's, and must not be negated. The
  // mutual-exclusion and negation checks close the round-4 holes: clause-binding fixed *which
  // clause*, but "does not start fresh"/"never carries" and an inside clause claiming BOTH
  // outcomes both still asserted the opposite of the measured behavior below.
  //
  // What this DOES constrain about the wording, stated plainly because it is maintainer-owned
  // prose and a red CI message should not be a puzzle: the bullet must be a single two-clause
  // contrast joined by `while`, `whereas`, `but`, or `;`, and must not use those words in any
  // other sense. An em-dash contrast or a two-sentence phrasing will fail. That tightness is
  // deliberate — it is what stops the gate degrading back to presence-checking — but it is a
  // wording constraint, not purely a claim constraint, and the next author should know it.
  //
  // What it enforces, in addition to the two structural constraints above (exactly one Level 3
  // bullet may say "born", and it must be a single two-clause contrast): the measured construct
  // where it is written as a backticked name before the word "block" or "loop", outcome-to-side,
  // and mutual exclusion of the two outcomes.
  //
  // What it does NOT enforce is the meaning of the sentence. **Any paraphrase that keeps the
  // keywords in their clauses passes.** Polarity is the clearest case — the negation check
  // rejects three spellings (`not`, `never`, `-n't`), but English negation is open-class, so
  // "fails to start fresh", "no longer carries" or "rarely carries" invert the meaning and pass.
  // The same holds well beyond polarity: a changed quantity ("on the first turn only"), a changed
  // scope, an added condition ("only when the loop count is even"), the outcome attributed to the
  // block rather than to the name, or an outcome word belonging to a decoy noun in a parenthetical
  // ("…while a name born before the block — like the turtle's heading, which carries across — is
  // reset") all pass while stating something false. A construct named without backticks ("before
  // the for block"), or backticked but followed by a head noun outside "block"/"loop" ("before the
  // `for` statement", or bare "before the `for`"), is in the same family. Extending the checks to
  // chase these is a regress that never completes and widens the false-failure surface on
  // maintainer-owned prose, so this is deliberately a tripwire for the commonest structural drift,
  // not a proof. Green means the shape is intact, never that the sentence is right; a red result
  // is a prompt to re-read the sentence, not proof that the sentence is wrong.
  const clauses = bullet.split(/\bwhile\b|\bwhereas\b|\bbut\b|;/i);
  assert.equal(
    clauses.length,
    2,
    `the Level 3 lifetime bullet must be a single two-clause contrast joined by "while", "whereas", "but" or ";" — found ${clauses.length} clause(s) in: ${bullet}`,
  );
  const insideClause = clauses.find((clause) => /\binside\b/i.test(clause));
  const outerClause = clauses.find((clause) =>
    /\bbefore\b|\boutside\b/i.test(clause),
  );
  assert.ok(
    insideClause !== undefined && outerClause !== undefined,
    `the Level 3 lifetime bullet no longer contrasts a name born inside the block with one born before it: ${bullet}`,
  );
  assert.notEqual(
    insideClause,
    outerClause,
    `the Level 3 lifetime bullet puts both sides of the contrast in one clause: ${bullet}`,
  );

  const RESTART = /\bfresh\b|\brestarts?\b|\bstarts? over\b/i;
  const CARRY = /\bcarries\b|\bkeeps\b|\bacross\b/i;
  assert.match(
    insideClause,
    RESTART,
    `the born-inside clause does not claim the restart: ${insideClause}`,
  );
  assert.match(
    outerClause,
    CARRY,
    `the born-before clause does not claim the carry-over: ${outerClause}`,
  );
  assert.doesNotMatch(
    insideClause,
    CARRY,
    `the born-inside clause also claims the carry-over, so it states both outcomes: ${insideClause}`,
  );
  assert.doesNotMatch(
    outerClause,
    RESTART,
    `the born-before clause also claims the restart, so it states both outcomes: ${outerClause}`,
  );
  for (const clause of [insideClause, outerClause]) {
    assert.doesNotMatch(
      clause,
      /\bnot\b|\bnever\b|n't\b/i,
      `this gate cannot read polarity inside a negated clause, so both sides must be phrased positively: ${clause}`,
    );
  }

  // The construct the measured programs below exercise, asserted on the BORN-INSIDE clause rather
  // than anywhere in the bullet: a bullet naming `for` on the inside and `repeat` on the outside
  // satisfies a whole-bullet check while the evidence still runs `repeat` (rubber-duck, round 5).
  assert.match(
    insideClause,
    /`repeat`/,
    `the born-inside clause no longer names the construct these programs measure: ${insideClause}`,
  );

  // …and no OTHER block construct anywhere in the bullet. The assertion above binds the construct
  // to the measured side; this forbids the born-before clause naming a different one ("before the
  // `for` block"), which is the same defect on the unconstrained side (rubber-duck and
  // @curriculum, round 6). Unlike the open-class families disclosed above, the backticked names
  // in one sentence are finite and enumerable from the sentence itself, so a deep-equal is a
  // decision procedure rather than a denylist.
  //
  // Two round-7 corrections are baked into this pattern, pulling in opposite directions and both
  // satisfied by it. `[^`\r\n]+` rather than `\w+`, because a multi-word span such as
  // `` `if … else` `` slipped past a single-word pattern while the rest of the bullet still said
  // `` `repeat` `` (rubber-duck). And the `block`/`loop` lookahead, because matching *every*
  // backticked token false-failed legitimate prose — a clarifying "and `print` shows you which you
  // wrote", or "first given a value by `set`" — and told the author it had found a construct when
  // it had not (@curriculum, @ai-tutor). Position is what distinguishes a construct here, so the
  // check narrows by position rather than by a list of construct names. Be precise about what that
  // buys: `block`/`loop` is itself a smaller maintained list, of head nouns rather than construct
  // names, so this is a heuristic over an open class and NOT a decision procedure. A construct
  // introduced by any other noun — "before the `for` statement", or bare "before the `for`" —
  // escapes it, as does one written without backticks. Those stay disclosed above rather than
  // chased, because extending the head-noun list is the same regress, and it would re-open the
  // false-failure surface this lookahead just closed.
  const namedBlocks = [
    ...new Set(
      [...bullet.matchAll(/`[^`\r\n]+`(?=\s+(?:block|loop))/g)].map(
        (match) => match[0],
      ),
    ),
  ];
  assert.deepEqual(
    namedBlocks,
    ["`repeat`"],
    `the lifetime bullet names a block construct other than the one these programs measure: ${namedBlocks.join(", ")}`,
  );

  // …and the behavior the bullet describes, measured rather than asserted. These are the shapes
  // the bullet talks about (a name given its first value inside vs. before the `repeat`), not the
  // lesson's programs — the lesson's own copies are pinned separately above.
  const insideFirst = [
    "repeat 4",
    "  :x = 1",
    "  :x = :x + 1",
    "  print :x",
    "end repeat",
  ].join("\n");
  const beforeFirst = [
    ":x = 1",
    "repeat 4",
    "  :x = :x + 1",
    "  print :x",
    "end repeat",
  ].join("\n");
  assert.deepEqual(
    measure(insideFirst, "spec-l3-born-inside.logo").printed,
    [2, 2, 2, 2],
    "a name born inside the block must start fresh on every turn",
  );
  assert.deepEqual(
    measure(beforeFirst, "spec-l3-born-before.logo").printed,
    [2, 3, 4, 5],
    "a name born before the block must carry its value across the turns",
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
 * the earlier 9-side, 360-degree curls interlaced seven times. Crossing is a claim about the
 * picture that no length list or mirror check can make, so it is measured directly.
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

// Round 3 (@testing finding 2): the heart test asserts `segmentsCross` is false 49 times and true
// never, so nothing demonstrated the predicate can fail — forcing `return false` left all Level 3
// tests green. A detector with no positive control reports "no crossings" forever, which is the
// same shape as the corpus scan in scoping-audit.test.mjs, and that one has a control.
test("segmentsCross detects a real crossing and rejects near misses", () => {
  // A textbook X.
  assert.equal(
    segmentsCross(
      [
        [0, 0],
        [10, 10],
      ],
      [
        [0, 10],
        [10, 0],
      ],
    ),
    true,
  );
  // Parallel segments never cross.
  assert.equal(
    segmentsCross(
      [
        [0, 0],
        [10, 0],
      ],
      [
        [0, 5],
        [10, 5],
      ],
    ),
    false,
  );
  // A T-touch, where an endpoint lies on the other segment, is not a PROPER crossing — which
  // matters here because consecutive sides of a curl share endpoints by construction, and both
  // curls start from the same point.
  assert.equal(
    segmentsCross(
      [
        [0, 0],
        [10, 0],
      ],
      [
        [5, 0],
        [5, 10],
      ],
    ),
    false,
  );
});

test("l3-mirrored-heart draws two mirrored curls that taper toward each other without tangling, and only because :side is set back", () => {
  const exercise = level3Exercises.find(
    (item) => item.id === "l3-mirrored-heart",
  );
  assert.ok(exercise);
  const source = exercise.referenceSolution.source;
  const heart = measure(source, "mirrored-heart.logo");

  // Seven growing sides per curl, plus the undrawn `home` move between them.
  const sevenSides = [10, 16, 22, 28, 34, 40, 46];
  assert.equal(heart.drawnStrokes, 14);
  assert.deepEqual(heart.lengths.slice(0, 7), sevenSides);
  assert.deepEqual(heart.lengths.slice(8), sevenSides);

  // Round 3 (rubber-duck, blocking): the explanation's "turning 40 degrees each time" was
  // unmeasured — a reviewer changed both turns to 41, confirmed it reached `dist`, and every
  // assertion here still passed, because mirror symmetry, side lengths, distinct points and
  // crossing count are all invariant under a symmetric change of turn. Pinning the exact
  // vertices fixes the angle as well as the lengths: 41 degrees moves every point after the first.
  assert.deepEqual(heart.points.slice(0, 7), [
    [0, 10],
    [10.284602, 22.256711],
    [31.950372, 26.076971],
    [56.199084, 12.076971],
    [67.827769, -19.872578],
    [54.146963, -57.460283],
    [14.309794, -80.460283],
  ]);

  // "The two curls mirror each other exactly" — the composition claim, and the one a length
  // list cannot prove. The left curl's points are the right curl's reflected in x.
  const right = heart.points.slice(0, 7);
  const left = heart.points.slice(8);
  assert.equal(left.length, 7);
  for (let index = 0; index < 7; index += 1) {
    assert.ok(
      Math.abs(left[index][0] + right[index][0]) < 1e-6 &&
        Math.abs(left[index][1] - right[index][1]) < 1e-6,
      `curl point ${index} is not mirrored: ${JSON.stringify(left[index])} vs ${JSON.stringify(right[index])}`,
    );
  }
  // A curl, not a closed polygon: seven sides, seven distinct points per curl.
  assert.equal(distinctPoints(right), 7);

  // …and the two curls stay clear of each other, so the outline is a clean heart rather than a
  // tangle. At 9 sides they crossed seven times, which is why the challenge uses 7.
  const rightSegments = heart.strokes.slice(0, 7);
  const leftSegments = heart.strokes.slice(8);
  for (const rightSegment of rightSegments) {
    for (const leftSegment of leftSegments) {
      assert.equal(
        segmentsCross(rightSegment, leftSegment),
        false,
        `the curls cross: ${JSON.stringify(rightSegment)} vs ${JSON.stringify(leftSegment)}`,
      );
    }
  }

  // Round 4 (rubber-duck blocking / @ai-tutor N13): the explanation used to say the curls "meet
  // at the bottom in a point", and nothing compared their endpoints — the claim lived only in
  // prose and in this test's own title. They do NOT meet: the tips are 28.62 apart, level with
  // each other. That is the same defect class as calling the figure "horns" — text describing a
  // picture nobody measured — so the shape the drawing actually has is pinned here.
  const rightTip = right[6];
  const leftTip = left[6];
  assert.deepEqual(rightTip, [14.309794, -80.460283]);
  assert.deepEqual(leftTip, [-14.309794, -80.460283]);
  const tipGap = Math.hypot(rightTip[0] - leftTip[0], rightTip[1] - leftTip[1]);
  assert.ok(
    Math.abs(tipGap - 28.619588) < 1e-6,
    `the tips are ${tipGap} apart; the explanation says they taper toward each other without meeting`,
  );
  // …and the lobes really do share their first stroke, which is the crease the explanation names.
  assert.deepEqual(heart.strokes[0], heart.strokes[8]);

  // The stated counterfactual: drop the second `:side = 10` and the left curl carries on from
  // 52, so the heart comes out lopsided. Both halves are asserted — the wrong lengths, and the
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
  const broken = measure(withoutReset, "heart-no-reset.logo");
  assert.deepEqual(broken.lengths.slice(8), [52, 58, 64, 70, 76, 82, 88]);
  const brokenLeft = broken.points.slice(8);
  assert.ok(
    Math.abs(brokenLeft[0][0] + right[0][0]) > 1e-6 ||
      Math.abs(brokenLeft[0][1] - right[0][1]) > 1e-6,
    "without setting :side back the second curl must stop mirroring",
  );
});
