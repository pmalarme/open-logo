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
 * Graded Level 2 exercises for `l2-square-repeat`, ramping from changing one number in the
 * square to drawing a different regular polygon by matching the repeat count to the turn.
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
    id: "l2-hexagon-two-colors",
    lessonId: "l2-square-repeat",
    level: "2",
    difficulty: "challenge",
    prompt:
      "Draw a hexagon as two repeats of three sides each, switching to a different pen color halfway through, using only ideas you already know.",
    referenceSolution: {
      source: [
        "# why: two repeats of three sides each still close the hexagon",
        'set_color "blue"',
        "repeat 3",
        "  forward 50",
        "  right 60",
        "end repeat",
        'set_color "red"',
        "repeat 3",
        "  forward 50",
        "  right 60",
        "end repeat",
      ].join("\n"),
      explanation:
        "The hexagon reuses the square's repeat idiom with a matching 60-degree turn; set_color (already introduced at Level 1) marks the halfway point between the two repeats.",
    },
  },
];
