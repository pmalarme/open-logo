/**
 * Level 3 — variables (`spec/educational-model.md:89-121`, issue #325). The learner question
 * is "How can one name control many places?": `:name` marks a variable everywhere, both when
 * reading and when writing a target; `=` assigns a value (`:size = 80`); the worded form
 * `set size to value` reads like a sentence and connects to Logo heritage; `==` compares while
 * `=` assigns. Only Level 1-3 vocabulary appears here — no `if`/comparison-as-condition
 * (Level 4) and no `define`/procedures (Level 5), per educational-model.md:37's discovery
 * guardrail.
 */

import type { Lesson } from "../lesson.js";
import type { Exercise } from "./exercise.js";

/**
 * The single Level 3 lesson: one name, `:size`, controlling every side of a square. The first
 * two worked examples reproduce `spec/educational-model.md:105-118`'s two `:size` blocks
 * verbatim — the symbol assignment form and the worded form — so the lesson never drifts from
 * the normative sample. The third worked example adds `:size = :size + 10` to show the same
 * name being read and written in one statement, per the issue's "one name controls many
 * places" objective.
 */
export const level3Lessons: readonly Lesson[] = [
  {
    id: "l3-size-square",
    title: "One name, many places",
    level: "3",
    objective:
      "See that storing a value in :size and reusing it lets one name control every side of a shape, whether the value is assigned with = or with the worded set ... to form.",
    workedExamples: [
      {
        source: [
          "# why: changing :size once changes every side",
          ":size = 80",
          "repeat 4",
          "  forward :size",
          "  right 90",
          "end repeat",
        ].join("\n"),
        explanation:
          ':size = 80 stores a value in :size, and forward :size reads it on every one of the repeat\'s four turns — say the colon as "the value of" here, and as "the variable named" on the write above.',
      },
      {
        source: [
          "# why: the worded form says the same idea in a sentence",
          "set size to 100",
          "repeat 4",
          "  forward :size",
          "  right 90",
          "end repeat",
        ].join("\n"),
        explanation:
          "set size to 100 assigns the same way as :size = 100, just worded as a sentence; forward :size still reads the one name that now controls every side.",
      },
      {
        source: [
          "# why: :size = :size + 10 reads the old value before writing the new one",
          ":size = 80",
          "repeat 4",
          "  forward :size",
          "  right 90",
          "end repeat",
          ":size = :size + 10",
          "repeat 4",
          "  forward :size",
          "  right 90",
          "end repeat",
        ].join("\n"),
        explanation:
          ":size = :size + 10 reads the value of :size on the right before writing the variable named :size on the left, so the second square is drawn 10 units bigger than the first — the same name still controls every side.",
      },
    ],
    exercisePrompt:
      "Take a square with a fixed side length, introduce :size in its place, and change :size's value once — do not add any new steps — so every side changes together.",
  },
];

/**
 * Graded Level 3 exercises for `l3-size-square`, ramping from introducing `:size` into a fixed
 * square, to resizing it once with the worded `set ... to` form, to reusing `:size` across a
 * resizable house's walls and roof together.
 */
export const level3Exercises: readonly Exercise[] = [
  {
    id: "l3-size-square-introduce",
    lessonId: "l3-size-square",
    level: "3",
    difficulty: "guided",
    prompt:
      "This square always draws a 60-step side: repeat 4 [ forward 60 right 90 ]. Introduce :size, set it to 60, and use it in place of the fixed number — the shape should look exactly the same as before.",
    referenceSolution: {
      source: [
        "# why: :size = 60 replaces the fixed number with a name that reads the same value",
        ":size = 60",
        "repeat 4",
        "  forward :size",
        "  right 90",
        "end repeat",
      ].join("\n"),
      explanation:
        "The shape is unchanged because :size holds the same 60 the fixed number held; the only difference is that forward now reads a name instead of a literal, so the value can be changed from one place.",
    },
  },
  {
    id: "l3-size-square-resize",
    lessonId: "l3-size-square",
    level: "3",
    difficulty: "practice",
    prompt:
      "Starting from the :size square, resize it by changing :size's value exactly once, using the worded set size to ... form, so every side of the square grows together.",
    referenceSolution: {
      source: [
        ":size = 60",
        "repeat 4",
        "  forward :size",
        "  right 90",
        "end repeat",
        "# why: one worded assignment changes every side of the next square",
        "set size to 120",
        "repeat 4",
        "  forward :size",
        "  right 90",
        "end repeat",
      ].join("\n"),
      explanation:
        "set size to 120 is the only change; because every side already reads :size, all four sides of the second square grow to 120 together, not just one of them.",
    },
  },
  {
    id: "l3-size-house",
    lessonId: "l3-size-square",
    level: "3",
    difficulty: "challenge",
    prompt:
      "Draw a house: a square body of side :size, then reposition the pen without drawing to the roof's starting corner, and draw a triangular roof that also uses :size. Change :size once and both the walls and the roof should resize together.",
    referenceSolution: {
      source: [
        "# why: the walls and the roof both read the same :size, so one change resizes both",
        ":size = 70",
        "repeat 4",
        "  forward :size",
        "  right 90",
        "end repeat",
        "pen_up",
        "forward :size",
        "right 90",
        "forward :size",
        "right 180",
        "pen_down",
        "repeat 3",
        "  forward :size",
        "  right 120",
        "end repeat",
      ].join("\n"),
      explanation:
        "The square walls and the triangular roof are two separate repeats, but both read the same :size, so changing its one value at the top resizes the walls and the roof together instead of needing a separate change for each shape.",
    },
  },
];
