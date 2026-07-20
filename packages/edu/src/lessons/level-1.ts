/**
 * Level 1 — movement and drawing (`spec/educational-model.md:37-58`, issue #328). The
 * learner question is "How can I make the turtle leave a mark?": a turtle has a position,
 * heading, pen, color, and width; `forward`/`back` move, `right`/`left` turn in degrees,
 * `pen_up`/`pen_down` decide whether movement draws, and `clear_screen`/`home` reset the
 * drawing/turtle. No variables, procedures, or control forms beyond straight-line sequencing
 * appear here — those are later levels (educational-model.md:35's discovery guardrail).
 */

import type { Lesson } from "../lesson.js";
import type { Exercise } from "./exercise.js";

/**
 * The single Level 1 lesson: leaving a mark, then lifting the pen to leave a gap. The worked
 * example reproduces `spec/educational-model.md:50-60` verbatim so the lesson never drifts
 * from the normative sample.
 */
export const level1Lessons: readonly Lesson[] = [
  {
    id: "l1-first-marks",
    title: "Leaving a mark",
    level: "1",
    objective:
      "See that a program is an ordered list of instructions, and that the turtle draws only while the pen is down.",
    workedExamples: [
      {
        source: [
          "# why: the turtle draws only while the pen is down",
          'set_color "blue"',
          "set_width 3",
          "forward 70",
          "right 90",
          "pen_up",
          "forward 30",
          "pen_down",
          "forward 70",
        ].join("\n"),
        explanation:
          "Each instruction runs in order: the turtle draws a blue line, turns right, then " +
          "pen_up hides the next move as a gap before pen_down starts drawing again.",
      },
    ],
    exercisePrompt:
      "Before running the program, predict where the turtle will end up and which parts of the path will be drawn.",
  },
];

/**
 * Graded Level 1 exercises for `l1-first-marks`, ramping from a guided change to an open
 * challenge. The challenge composes a recognizable object rather than an abstract drill (the
 * compose-a-recognizable-object rule from `spec/educational-model.md` and
 * `.github/skills/curriculum/author-a-lesson/SKILL.md`): a house -- a square body and a
 * triangle roof, each with a door and two windows -- built entirely from Level 1 primitives,
 * with every side of the square and roof typed out one at a time since `repeat` does not exist
 * yet at this level.
 */
export const level1Exercises: readonly Exercise[] = [
  {
    id: "l1-first-marks-two-lines",
    lessonId: "l1-first-marks",
    level: "1",
    difficulty: "guided",
    prompt:
      "Draw a line 100 steps long, turn right 90 degrees, then draw a second line 60 steps long.",
    referenceSolution: {
      source: [
        "# why: two lines joined by one turn, in the order they happen",
        "forward 100",
        "right 90",
        "forward 60",
      ].join("\n"),
      explanation:
        "forward 100 draws the first line, right 90 turns the heading, and forward 60 draws the second line from the new heading.",
    },
  },
  {
    id: "l1-first-marks-gap",
    lessonId: "l1-first-marks",
    level: "1",
    difficulty: "practice",
    prompt:
      "Draw a mark, lift the pen to leave a visible gap, then put the pen down and draw a second, separate mark.",
    referenceSolution: {
      source: [
        "# why: pen_up hides the move so the gap is visible between two marks",
        "forward 40",
        "pen_up",
        "forward 40",
        "pen_down",
        "forward 40",
      ].join("\n"),
      explanation:
        "The first forward draws while the pen is down, the middle forward moves without drawing, and the last forward draws again after pen_down.",
    },
  },
  {
    id: "l1-house-square-and-triangle",
    lessonId: "l1-first-marks",
    level: "1",
    difficulty: "challenge",
    prompt:
      "Draw a house: a square body and a triangle roof, each side drawn one at a time, then a door and two windows using only forward, right, left, pen_up, and pen_down.",
    referenceSolution: {
      source: [
        "# why: each side of the square body is typed out one at a time",
        "forward 80",
        "right 90",
        "forward 80",
        "right 90",
        "forward 80",
        "right 90",
        "forward 80",
        "right 90",
        "pen_up",
        "forward 80",
        "right 90",
        "forward 80",
        "right 180",
        "pen_down",
        "# why: each side of the triangle roof is typed out the same way",
        "forward 80",
        "right 120",
        "forward 80",
        "right 120",
        "forward 80",
        "right 120",
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
        "Every side of the square and the triangle is typed out one at a time, so the square takes four forward/right pairs and the roof takes three. From the roof, short pen_up/pen_down walks place a three-sided door (its open bottom edge already drawn by the house's ground line) and two enclosed square windows, one on each side of the door, without drawing any connecting lines between them.",
    },
  },
];
