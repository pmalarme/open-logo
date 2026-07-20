/**
 * Level 2 — patterns and repetition (`spec/educational-model.md:64-85`, issue #328). The
 * learner question is "Why type the same thing again and again?": `repeat` runs a bracketed
 * block for its effects and keeps no value, a count says how many times the block runs, and
 * `repcount` lets a learner see which turn of the repeat they are on. Only Level 1 vocabulary
 * (movement, turning, pen, color, width) plus `repeat`/`repcount` appears here — no variables,
 * conditions, or procedures (educational-model.md:35's discovery guardrail).
 */

import type { Lesson } from "../lesson.js";
import type { Exercise } from "./exercise.js";

/**
 * The single Level 2 lesson: turning a repeated side-and-turn pattern into one `repeat` rule,
 * then using `repcount` to see which turn is running. The first worked example reproduces
 * `spec/educational-model.md:77-83`'s square verbatim so the lesson never drifts from the
 * normative sample.
 */
export const level2Lessons: readonly Lesson[] = [
  {
    id: "l2-square-repeat",
    title: "One side, repeated",
    level: "2",
    objective:
      "Turn a repeated side-and-turn pattern into one rule using repeat, and use repcount to see which turn is running.",
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
          "repeat runs its block four times; each time the turtle moves forward 80 and turns right 90, so the fourth turn brings it back to where it started.",
      },
      {
        source: [
          "# why: repcount changes on every turn, so the growing side shows which turn is running",
          "repeat 4 [ forward repcount right 90 ]",
        ].join("\n"),
        explanation:
          "repcount reports the current pass of the nearest enclosing repeat — 1, then 2, then 3, then 4 — so using it directly as the forward distance makes each side a little longer than the last.",
      },
    ],
    exercisePrompt:
      "Change only one number at a time — the distance, the turn, or the repeat count — and predict the new shape before running it.",
  },
];

/**
 * Graded Level 2 exercises for `l2-square-repeat`. Follows a recognizable-goal ramp (issue
 * #354): guided change to the square, then the triangle pattern as a practice exercise, then a
 * house — a square body plus a triangle roof — as the open challenge, so the learner composes a
 * real object from patterns already learned rather than an abstract shape.
 */
export const level2Exercises: readonly Exercise[] = [
  {
    id: "l2-square-repeat-count",
    lessonId: "l2-square-repeat",
    level: "2",
    difficulty: "guided",
    prompt:
      "Change only the repeat count in the square example from 4 to 3 and predict what shape appears before you run it.",
    referenceSolution: {
      source: "repeat 3 [ forward 80 right 90 ]",
      explanation:
        "Changing only the count to 3 no longer matches the 90-degree turn to a triangle, so the turtle does not return exactly to its start — the point is to predict this before running it.",
    },
  },
  {
    id: "l2-triangle-matching-turn",
    lessonId: "l2-square-repeat",
    level: "2",
    difficulty: "practice",
    prompt:
      "Draw a triangle: use repeat 3 and choose the turn angle so the turtle returns exactly to where it started.",
    referenceSolution: {
      source: "repeat 3 [ forward 80 right 120 ]",
      explanation:
        "Three equal turns must add up to one full turn around, so an evenly split turn of 120 degrees brings the turtle back to where it started.",
    },
  },
  {
    id: "l2-house-square-and-triangle",
    lessonId: "l2-square-repeat",
    level: "2",
    difficulty: "challenge",
    prompt:
      "Draw a house: reuse the square as the body, then lift the pen to walk to the top edge and draw a triangle roof on top of it, using only the square and triangle patterns you already know.",
    referenceSolution: {
      source: [
        "# why: a house is just the square and triangle patterns, one drawn on top of the other",
        "repeat 4 [ forward 80 right 90 ]",
        "pen_up",
        "forward 80",
        "right 90",
        "forward 80",
        "right 180",
        "pen_down",
        "repeat 3 [ forward 80 right 120 ]",
      ].join("\n"),
      explanation:
        "The square body closes back at the start facing the same way it began; pen_up walks along the top edge to the far corner without drawing, right 180 turns the turtle back to face across that edge, and the triangle pattern then draws a roof sitting exactly on top of it.",
    },
  },
];
