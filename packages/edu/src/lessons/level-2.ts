/**
 * Level 2 — patterns and repetition (`spec/educational-model.md:66-87`, issue #328). The
 * learner question is "Why type the same thing again and again?": `repeat` runs a bracketed
 * block for its effects and keeps no value, a count says how many times the block runs, and
 * `repcount` lets a learner see which turn of the repeat they are on. Only Level 1 vocabulary
 * (movement, turning, pen, color, width) plus `repeat`/`repcount` appears here — no variables,
 * conditions, or procedures (educational-model.md:37's discovery guardrail).
 */

import type { Lesson } from "../lesson.js";
import type { Exercise } from "./exercise.js";

/**
 * The single Level 2 lesson: turning a repeated side-and-turn pattern into one `repeat` rule,
 * then using `repcount` to see which turn is running. The first worked example reproduces
 * `spec/educational-model.md:79-85`'s square verbatim so the lesson never drifts from the
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
 * Builds the tree reference solution source with the given repeat count. Both tree exercises
 * below call this with only the count changed, so their sources are guaranteed to differ in
 * exactly one place -- the number passed to repeat.
 */
function treeSource(repeatCount: number): string {
  return [
    "# why: the trunk is a one-off shape, so it is drawn with plain Level 1 moves and turns",
    "forward 40",
    "right 90",
    "forward 20",
    "right 90",
    "forward 40",
    "right 90",
    "forward 20",
    "right 90",
    "pen_up",
    "forward 40",
    "pen_down",
    "# why: the same repeat body draws a triangle tier, then walks up to where the next tier starts",
    `repeat ${repeatCount} [`,
    "  forward 80",
    "  right 120",
    "  forward 80",
    "  right 120",
    "  forward 80",
    "  right 120",
    "  pen_up",
    "  forward 25",
    "  pen_down",
    "]",
  ].join("\n");
}

/**
 * Graded Level 2 exercises for `l2-square-repeat`. Follows the compose-a-recognizable-object
 * rule (`spec/educational-model.md`, `.github/skills/curriculum/author-a-lesson/SKILL.md`):
 * guided change to the square, then the triangle pattern as a practice exercise, then a tree —
 * a trunk plus repeated triangle tiers — as the open challenge, so the learner composes a real
 * object out of `repeat` rather than an abstract shape. Each tier is drawn by the exact same
 * repeat body (a fixed-size triangle, then a fixed-size walk upward), so the tiers stack purely
 * from repeating one rule — no variables or arithmetic needed. A further "taller tree" exercise
 * then changes only the repeat count to make the learner feel why `repeat` matters: growing the
 * tree by hand would mean retyping every tier, but here one bigger number grows it instead.
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
        "Three equal turns bring the turtle all the way around its starting point, so a turn of 120 degrees brings it back to exactly where it started.",
    },
  },
  {
    id: "l2-tree-trunk-and-tiers",
    lessonId: "l2-square-repeat",
    level: "2",
    difficulty: "challenge",
    prompt:
      "Draw a tree: a trunk made from Level 1 moves and turns, then repeat 3 [ ... ] to stack three identical triangle tiers on top of it, each tier followed by a walk further up before the next tier starts.",
    referenceSolution: {
      source: treeSource(3),
      explanation:
        "The trunk only happens once, so it is four plain forward/right pairs like any Level 1 rectangle. Repeat then runs one rule three times: draw a triangle tier (three forward/right pairs that close back to where they started), then walk 25 further up before the next tier begins -- so the trunk plus three stacked tiers become a tree without ever typing a tier's three sides more than once.",
    },
  },
  {
    id: "l2-taller-tree-repeat",
    lessonId: "l2-square-repeat",
    level: "2",
    difficulty: "challenge",
    prompt:
      "Make the tree taller without retyping any tier: change only the repeat count in the tree exercise from 3 to 6 and predict how much taller the tree grows before you run it.",
    referenceSolution: {
      source: treeSource(6),
      explanation:
        "Changing the repeat count from 3 to 6 is the only change, and the tree grows six tiers tall instead of three -- this is exactly why repeat matters: growing the tree by hand would mean retyping three more tiers, but here a single bigger number grows it instead.",
    },
  },
];
