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
 * house — a square body plus a triangle roof, a door, and two windows — as the open challenge,
 * so the learner composes a real object from patterns already learned rather than an abstract
 * shape. A further "two houses" exercise then reuses that same house to make the learner feel
 * why `repeat` matters: drawing the whole house a second time by hand would mean retyping every
 * line, so wrapping the sequence in `repeat 2 [ ... ]` (with a walk to the next spot at the end
 * of the block) draws both houses side by side instead.
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
      "Draw a house: reuse the square as the body, lift the pen to walk to the top edge and draw a triangle roof on top of it, then add a door and two windows using only forward, right, left, pen_up, and pen_down.",
    referenceSolution: {
      source: [
        "# why: the square body and triangle roof draw exactly as in the earlier house",
        "repeat 4 [ forward 80 right 90 ]",
        "pen_up",
        "forward 80",
        "right 90",
        "forward 80",
        "right 180",
        "pen_down",
        "repeat 3 [ forward 80 right 120 ]",
        "pen_up",
        "forward 80",
        "left 90",
        "forward 80",
        "right 180",
        "# why: back at the house's starting corner, facing the same way it began, ready for the door",
        "right 90",
        "forward 30",
        "left 90",
        "pen_down",
        "forward 30",
        "right 90",
        "forward 20",
        "right 90",
        "forward 30",
        "right 90",
        "# why: the first window, an enclosed square to the right of the door",
        "pen_up",
        "right 180",
        "forward 5",
        "left 90",
        "forward 15",
        "pen_down",
        "forward 15",
        "right 90",
        "forward 15",
        "right 90",
        "forward 15",
        "right 90",
        "forward 15",
        "right 90",
        "# why: the second window, an enclosed square to the left of the door",
        "pen_up",
        "left 90",
        "forward 50",
        "right 90",
        "pen_down",
        "forward 15",
        "right 90",
        "forward 15",
        "right 90",
        "forward 15",
        "right 90",
        "forward 15",
        "right 90",
      ].join("\n"),
      explanation:
        "The square body and triangle roof draw exactly as before; pen_up then walks the turtle back to the house's starting corner. From there, short pen_up/pen_down walks place a three-sided door (its open bottom edge already drawn by the house's ground line) and two enclosed square windows, one on each side of the door, without drawing any connecting lines between them.",
    },
  },
  {
    id: "l2-two-houses-repeat",
    lessonId: "l2-square-repeat",
    level: "2",
    difficulty: "challenge",
    prompt:
      "Draw the whole house again, offset to one side, without retyping it: wrap the whole house pattern (square, roof, door, and both windows) in repeat 2 [ ... ], adding a walk to the next spot at the end of the block so each pass draws its own complete house.",
    referenceSolution: {
      source: [
        "# why: repeating the whole house pattern draws two complete houses without retyping any of it",
        "repeat 2 [",
        "  repeat 4 [",
        "    forward 80",
        "    right 90",
        "  ]",
        "  pen_up",
        "  forward 80",
        "  right 90",
        "  forward 80",
        "  right 180",
        "  pen_down",
        "  repeat 3 [",
        "    forward 80",
        "    right 120",
        "  ]",
        "  pen_up",
        "  forward 80",
        "  left 90",
        "  forward 80",
        "  right 180",
        "  right 90",
        "  forward 30",
        "  left 90",
        "  pen_down",
        "  forward 30",
        "  right 90",
        "  forward 20",
        "  right 90",
        "  forward 30",
        "  right 90",
        "  pen_up",
        "  right 180",
        "  forward 5",
        "  left 90",
        "  forward 15",
        "  pen_down",
        "  forward 15",
        "  right 90",
        "  forward 15",
        "  right 90",
        "  forward 15",
        "  right 90",
        "  forward 15",
        "  right 90",
        "  pen_up",
        "  left 90",
        "  forward 50",
        "  right 90",
        "  pen_down",
        "  forward 15",
        "  right 90",
        "  forward 15",
        "  right 90",
        "  forward 15",
        "  right 90",
        "  forward 15",
        "  right 90",
        "  # why: walk sideways to the next house's starting spot before repeating",
        "  pen_up",
        "  right 90",
        "  forward 145",
        "  right 90",
        "  forward 15",
        "  right 180",
        "  pen_down",
        "]",
      ].join("\n"),
      explanation:
        "Each pass of the outer repeat draws one whole house — square body, triangle roof, door, and both windows — then walks back over and down to where the next house's starting corner should be, so the second pass draws a second complete house next to the first without a single line of the pattern being retyped.",
    },
  },
];
