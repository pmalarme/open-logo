// Unit tests for the Level 4 lesson + graded exercises (issue #326): shape validation via the
// `Lesson`/`Exercise` type guards, plus running every embedded OpenLogo source through
// `@openlogo/runtime` so a lesson can never drift from real execution behavior.
import assert from "node:assert/strict";
import { test } from "node:test";
import * as OL from "@openlogo/edu";
import { execute } from "@openlogo/runtime";

const level4Lessons = OL.getLessonsByLevel("4");
const level4Exercises = OL.getExercisesByLevel("4");

test("getLessonsByLevel('4') contains only valid, Level 4 Lessons", () => {
  assert.equal(level4Lessons.length > 0, true);
  for (const lesson of level4Lessons) {
    assert.equal(OL.isLesson(lesson), true);
    assert.equal(lesson.level, "4");
  }
});

test("getExercisesByLevel('4') contains only valid, Level 4 Exercises tied to a known lesson", () => {
  assert.equal(level4Exercises.length > 0, true);
  const lessonIds = new Set(level4Lessons.map((lesson) => lesson.id));
  for (const exercise of level4Exercises) {
    assert.equal(OL.isExercise(exercise), true);
    assert.equal(exercise.level, "4");
    assert.equal(lessonIds.has(exercise.lessonId), true);
  }
});

test("level4Exercises ramps through every difficulty exactly once per lesson", () => {
  const byLesson = new Map();
  for (const exercise of level4Exercises) {
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

test("the objective states the spec's strict-boolean rule verbatim", () => {
  const lesson = level4Lessons.find(
    (item) => item.id === "l4-shape-color-condition",
  );
  assert.ok(lesson);
  assert.equal(
    lesson.objective.includes(
      "a condition must already be true or false; OpenLogo does not guess",
    ),
    true,
  );
});

test("the first worked example matches spec/educational-model.md's :sides == 4 color-choice program", () => {
  const lesson = level4Lessons.find(
    (item) => item.id === "l4-shape-color-condition",
  );
  assert.ok(lesson);
  assert.equal(
    lesson.workedExamples[0].source,
    [
      "# why: the turtle chooses a turn from a boolean comparison",
      ":sides = 4",
      "",
      "if :sides == 4",
      '  set_color "green"',
      "else",
      '  set_color "purple"',
      "end if",
      "",
      "repeat :sides",
      "  forward 70",
      "  right 360 / :sides",
      "end repeat",
    ].join("\n"),
  );
});

test("the lesson's guardrail for `if :sides [ ... ]` matches the spec's stated error expectation verbatim", () => {
  const lesson = level4Lessons.find(
    (item) => item.id === "l4-shape-color-condition",
  );
  assert.ok(lesson);
  const guardrailText = ":sides is a number and the condition needs a boolean";
  const found = lesson.workedExamples.some((example) =>
    example.explanation.includes(guardrailText),
  );
  assert.equal(
    found,
    true,
    "expected a worked-example explanation to contain the spec's exact guardrail phrasing",
  );
});

test("no Level 4 content uses a Level 5+ concept (define, end define, or a to ... procedure header)", () => {
  const forbidden = [/\bdefine\b/, /\bend define\b/, /^\s*to\s+[a-z_]/im];
  const sources = [
    ...level4Lessons.flatMap((lesson) =>
      lesson.workedExamples.map((example) => example.source),
    ),
    ...level4Exercises.map((exercise) => exercise.referenceSolution.source),
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

test("the and/or/not worked example demonstrates or as a runnable strict boolean, not just in prose", () => {
  const lesson = level4Lessons.find(
    (item) => item.id === "l4-shape-color-condition",
  );
  assert.ok(lesson);
  const andOrNotExample = lesson.workedExamples[2];
  assert.equal(/\bor\b/.test(andOrNotExample.source), true);
  assert.equal(/\band\b/.test(andOrNotExample.source), true);
  assert.equal(/\bnot\b/.test(andOrNotExample.source), true);
});

test("the guided exercise changes exactly one line (== to !=) from the lesson's first worked example", () => {
  const lesson = level4Lessons.find(
    (item) => item.id === "l4-shape-color-condition",
  );
  const guided = level4Exercises.find(
    (item) => item.id === "l4-shape-color-flip-comparison",
  );
  assert.ok(lesson);
  assert.ok(guided);
  const baseLines = lesson.workedExamples[0].source.split("\n");
  const guidedLines = guided.referenceSolution.source.split("\n");
  assert.equal(baseLines.length, guidedLines.length);
  const changedLines = baseLines
    .map((line, index) => [line, guidedLines[index]])
    .filter(([before, after]) => before !== after);
  assert.equal(changedLines.length, 1);
  assert.deepEqual(changedLines[0], ["if :sides == 4", "if :sides != 4"]);
});

test("the practice exercise changes exactly one line (:sides 4 to 6) from the guided exercise", () => {
  const guided = level4Exercises.find(
    (item) => item.id === "l4-shape-color-flip-comparison",
  );
  const practice = level4Exercises.find(
    (item) => item.id === "l4-shape-color-many-sides",
  );
  assert.ok(guided);
  assert.ok(practice);
  const guidedLines = guided.referenceSolution.source.split("\n");
  const practiceLines = practice.referenceSolution.source.split("\n");
  assert.equal(guidedLines.length, practiceLines.length);
  const changedLines = guidedLines
    .map((line, index) => [line, practiceLines[index]])
    .filter(([before, after]) => before !== after);
  assert.equal(changedLines.length, 1);
  assert.deepEqual(changedLines[0], [":sides = 4", ":sides = 6"]);
});

test("the challenge exercise still uses exactly one comparison choosing between exactly one branch pair", () => {
  const challenge = level4Exercises.find(
    (item) => item.id === "l4-house-color-by-size",
  );
  assert.ok(challenge);
  const source = challenge.referenceSolution.source;
  const comparisonMatches = source.match(/==|!=|<=|>=|(?<![<>=!])[<>](?!=)/g);
  assert.ok(comparisonMatches);
  assert.equal(comparisonMatches.length, 1);
  const ifMatches = source.match(/^if\b/gm);
  assert.ok(ifMatches);
  assert.equal(ifMatches.length, 1);
  const elseMatches = source.match(/\belse\b/g);
  assert.ok(elseMatches);
  assert.equal(elseMatches.length, 1);
});

test("every Level 4 worked example parses and runs with no diagnostics", () => {
  for (const lesson of level4Lessons) {
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

test("every Level 4 exercise reference solution parses and runs with no diagnostics", () => {
  for (const exercise of level4Exercises) {
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

test("l4-shape-color-flip-comparison colors the square purple after flipping == to !=", () => {
  const exercise = level4Exercises.find(
    (item) => item.id === "l4-shape-color-flip-comparison",
  );
  assert.ok(exercise);
  const result = execute(
    exercise.referenceSolution.source,
    "flip-comparison.logo",
  );
  const colorChanges = result.events.filter(
    (event) => event.kind === "color-change",
  );
  assert.equal(colorChanges.length, 1);
  assert.equal(colorChanges[0].payload.to, "purple");
});

test("l4-shape-color-many-sides colors the hexagon green under the != 4 comparison", () => {
  const exercise = level4Exercises.find(
    (item) => item.id === "l4-shape-color-many-sides",
  );
  assert.ok(exercise);
  const result = execute(exercise.referenceSolution.source, "many-sides.logo");
  const colorChanges = result.events.filter(
    (event) => event.kind === "color-change",
  );
  assert.equal(colorChanges.length, 1);
  assert.equal(colorChanges[0].payload.to, "green");
  const moves = result.events.filter((event) => event.kind === "move");
  assert.equal(moves.length, 6);
});

test("l4-house-color-by-size colors the whole house green when :size >= 80", () => {
  const exercise = level4Exercises.find(
    (item) => item.id === "l4-house-color-by-size",
  );
  assert.ok(exercise);
  const result = execute(exercise.referenceSolution.source, "house-color.logo");
  const colorChanges = result.events.filter(
    (event) => event.kind === "color-change",
  );
  assert.equal(colorChanges.length, 1);
  assert.equal(colorChanges[0].payload.to, "green");
  const moves = result.events.filter((event) => event.kind === "move");
  // 4 wall sides + 2 repositioning moves (pen up) + 3 roof sides = 9 moves.
  assert.equal(moves.length, 9);
});
