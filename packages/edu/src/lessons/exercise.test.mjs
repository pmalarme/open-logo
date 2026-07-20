// Unit tests for the graded-exercise contract (issue #328): `EXERCISE_DIFFICULTIES`,
// `isExerciseDifficulty`, and `isExercise`.
import assert from "node:assert/strict";
import { test } from "node:test";
import * as OL from "@openlogo/edu";

/** A minimal, valid exercise used across the assertions below. */
const sampleExercise = {
  id: "l1-sample",
  lessonId: "l1-first-marks",
  level: "1",
  difficulty: "guided",
  prompt: "Draw a line 50 steps long.",
  referenceSolution: {
    source: "forward 50",
    explanation: "forward moves the turtle and draws while the pen is down.",
  },
};

test("EXERCISE_DIFFICULTIES lists the guided-to-open ramp", () => {
  assert.deepEqual(OL.EXERCISE_DIFFICULTIES, [
    "guided",
    "practice",
    "challenge",
  ]);
});

test("isExerciseDifficulty accepts every normative difficulty and rejects unknown values", () => {
  for (const difficulty of OL.EXERCISE_DIFFICULTIES) {
    assert.equal(OL.isExerciseDifficulty(difficulty), true);
  }
  assert.equal(OL.isExerciseDifficulty("easy"), false);
  assert.equal(OL.isExerciseDifficulty(""), false);
  assert.equal(OL.isExerciseDifficulty(1), false);
  assert.equal(OL.isExerciseDifficulty(null), false);
  assert.equal(OL.isExerciseDifficulty(undefined), false);
});

test("isExercise accepts a well-shaped exercise", () => {
  assert.equal(OL.isExercise(sampleExercise), true);
});

test("isExercise rejects values missing or misshaping a required field", () => {
  assert.equal(OL.isExercise(null), false);
  assert.equal(OL.isExercise(undefined), false);
  assert.equal(OL.isExercise("not an exercise"), false);
  assert.equal(OL.isExercise({ ...sampleExercise, id: undefined }), false);
  assert.equal(OL.isExercise({ ...sampleExercise, lessonId: 42 }), false);
  assert.equal(OL.isExercise({ ...sampleExercise, level: "9" }), false);
  assert.equal(
    OL.isExercise({ ...sampleExercise, difficulty: "impossible" }),
    false,
  );
  assert.equal(OL.isExercise({ ...sampleExercise, prompt: 42 }), false);
  assert.equal(
    OL.isExercise({ ...sampleExercise, referenceSolution: { source: "x" } }),
    false,
  );
});
