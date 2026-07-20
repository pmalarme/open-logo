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
 * combination of every Level 1 idea (position/heading, pen, color, width, clear_screen/home).
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
    id: "l1-first-marks-colors-and-home",
    lessonId: "l1-first-marks",
    level: "1",
    difficulty: "challenge",
    prompt:
      "Draw at least two marks in different colors with a pen-up gap between them, then return the turtle to the center with home.",
    referenceSolution: {
      source: [
        "# why: combine color, pen state, and home using only Level 1 ideas",
        'set_color "red"',
        "forward 50",
        "pen_up",
        "right 90",
        "forward 20",
        "pen_down",
        'set_color "blue"',
        "forward 50",
        "home",
      ].join("\n"),
      explanation:
        "Each idea from Level 1 is reused, not replaced: color and width still just describe the pen, and home resets both position and heading in one step.",
    },
  },
];
