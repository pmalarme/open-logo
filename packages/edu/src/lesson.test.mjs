import assert from "node:assert/strict";
import { test } from "node:test";
import * as OL from "@openlogo/edu";

/** A minimal, valid Level 2 lesson used across the assertions below. */
const squareLesson = {
  id: "l2-square-repeat",
  title: "One side, repeated",
  level: "2",
  objective:
    "Turn a repeated side-and-turn pattern into one rule using repeat.",
  workedExamples: [
    {
      source: [
        "# why: a square is one side-and-turn idea repeated four times",
        "repeat 4",
        "  forward 80",
        "  right 90",
        "end repeat",
      ].join("\n"),
      explanation:
        "repeat runs the block four times; each time the turtle moves forward and turns right.",
    },
  ],
  exercisePrompt:
    "Change only the forward distance and predict the new square's size.",
};

test("LEARNER_LEVELS lists the 8 progressive levels with 7a/7b/7c and 8a/8b split out", () => {
  assert.deepEqual(OL.LEARNER_LEVELS, [
    "1",
    "2",
    "3",
    "4",
    "5",
    "6",
    "7a",
    "7b",
    "7c",
    "8a",
    "8b",
  ]);
});

test("isLearnerLevel accepts every normative level id and rejects unknown values", () => {
  for (const level of OL.LEARNER_LEVELS) {
    assert.equal(OL.isLearnerLevel(level), true);
  }
  assert.equal(OL.isLearnerLevel("7"), false);
  assert.equal(OL.isLearnerLevel("9"), false);
  assert.equal(OL.isLearnerLevel(""), false);
  assert.equal(OL.isLearnerLevel(2), false);
  assert.equal(OL.isLearnerLevel(null), false);
  assert.equal(OL.isLearnerLevel(undefined), false);
});

test("isWorkedExample accepts a well-shaped worked example and rejects malformed ones", () => {
  assert.equal(OL.isWorkedExample(squareLesson.workedExamples[0]), true);
  assert.equal(OL.isWorkedExample({ source: "forward 10" }), false);
  assert.equal(OL.isWorkedExample({ explanation: "moves forward" }), false);
  assert.equal(OL.isWorkedExample(null), false);
  assert.equal(OL.isWorkedExample("forward 10"), false);
  assert.equal(OL.isWorkedExample({ source: 1, explanation: "x" }), false);
});

test("isLesson accepts a well-shaped Lesson value", () => {
  assert.equal(OL.isLesson(squareLesson), true);
  assert.equal(squareLesson.level, "2");
  assert.equal(squareLesson.workedExamples.length, 1);
});

test("isLesson rejects values missing a required field", () => {
  assert.equal(OL.isLesson(null), false);
  assert.equal(OL.isLesson(undefined), false);
  assert.equal(OL.isLesson("not a lesson"), false);
  assert.equal(OL.isLesson({ ...squareLesson, id: undefined }), false);
  assert.equal(OL.isLesson({ ...squareLesson, title: 42 }), false);
  assert.equal(OL.isLesson({ ...squareLesson, level: "9" }), false);
  assert.equal(OL.isLesson({ ...squareLesson, objective: 42 }), false);
  assert.equal(OL.isLesson({ ...squareLesson, workedExamples: "nope" }), false);
  assert.equal(
    OL.isLesson({ ...squareLesson, workedExamples: [{ source: "x" }] }),
    false,
  );
  assert.equal(OL.isLesson({ ...squareLesson, exercisePrompt: 42 }), false);
});

test("isLesson accepts a lesson with more than one worked example", () => {
  const multiExampleLesson = {
    ...squareLesson,
    workedExamples: [
      squareLesson.workedExamples[0],
      {
        source: "repeat 6\n  forward 50\n  right 60\nend repeat",
        explanation: "Six equal turns also add up to one full turn.",
      },
    ],
  };
  assert.equal(OL.isLesson(multiExampleLesson), true);
});

test("isLesson rejects a lesson with zero worked examples", () => {
  assert.equal(OL.isLesson({ ...squareLesson, workedExamples: [] }), false);
});

test("isLesson rejects a sparse workedExamples array (holes are not worked examples)", () => {
  const sparse = new Array(1);
  assert.equal(OL.isLesson({ ...squareLesson, workedExamples: sparse }), false);
});

test("EDU_PACKAGE marker is still exported alongside the Lesson contract", () => {
  assert.equal(OL.EDU_PACKAGE, "@openlogo/edu");
});
