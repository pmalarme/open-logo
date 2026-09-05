/**
 * Level 3 — variables (`spec/educational-model.md:89-121`, issue #325). The learner question
 * is "How can one name control many places?": `:name` marks a variable everywhere, both when
 * reading and when writing a target; `=` assigns a value (`:size = 80`); the worded form
 * `set size to value` reads like a sentence and connects to Logo heritage; `==` compares while
 * `=` assigns. Only Level 1-3 vocabulary appears here — no `if`/comparison-as-condition
 * (Level 4) and no `define`/procedures (Level 5), per educational-model.md:37's discovery
 * guardrail.
 *
 * Issue #829 adds a second lesson here, `l3-where-a-name-is-born`, once saga #819's
 * variable-scoping ruling landed: a name is born where it is first assigned, and a name born
 * inside a block goes out of scope at the end of that block
 * (`spec/execution-model.md:351-352`, `:603-605`). That turns one moved line into two opposite
 * results from the same loop body, which is the earliest point in the curriculum where *where*
 * a name is written visibly changes what a program does — so it belongs beside `repeat` and
 * variables rather than waiting for procedures. The normative contrast at
 * `spec/execution-model.md:607-615` is written with `[ … ]` blocks; the lesson uses the long
 * `… end repeat` spelling every other Level 2/3 lesson uses, which
 * `spec/execution-model.md:367-369` makes the same block scope — and `level-3.test.mjs` pins
 * both spellings to the same printed numbers rather than assuming it.
 */

import type { Lesson } from "../lesson.js";
import type { Exercise } from "./exercise.js";

/**
 * The Level 3 lessons. `l3-size-square` teaches one name, `:size`, controlling every side of a
 * square: the first two worked examples reproduce `spec/educational-model.md:105-118`'s two
 * `:size` blocks verbatim — the symbol assignment form and the worded form — so the lesson never
 * drifts from the normative sample, and the third adds `:size = :size + 10` to show the same
 * name being read and written in one statement, per the issue's "one name controls many places"
 * objective. `l3-where-a-name-is-born` (issue #829) then teaches *where* a name is written: its
 * first two worked examples are `spec/execution-model.md:607-615`'s normative born-inside /
 * born-outside contrast in the long block spelling, and the third shows the accumulator that
 * contrast makes possible.
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
  {
    id: "l3-where-a-name-is-born",
    title: "Where a name is born decides how long it lives",
    level: "3",
    objective:
      "See that a name is born where it is first given a value, and that a name born inside a repeat's body starts over on every turn while a name born before the loop is one variable every turn keeps changing — the same loop body, one line moved, two completely different results.",
    workedExamples: [
      {
        source: [
          "# why: :x is born inside the loop, so every turn starts it over at 0",
          "repeat 4",
          "  :x = 0",
          "  :x = :x + 1",
          "  print :x",
          "end repeat",
        ].join("\n"),
        explanation:
          "This prints 1 1 1 1. :x is first given a value inside the repeat's body, so it is born there — and a name born inside the body only lives until that turn of the loop ends. The next turn starts over with a brand-new :x set back to 0, adds 1 again, and prints 1 again, four times over.",
      },
      {
        source: [
          "# why: :x is born before the loop, so all four turns change one variable",
          ":x = 0",
          "repeat 4",
          "  :x = :x + 1",
          "  print :x",
          "end repeat",
        ].join("\n"),
        explanation:
          "This prints 1 2 3 4. The loop body is word for word the same as above except that :x = 0 has moved above the repeat, so :x is born outside the loop and lives on past the end of each turn. Now every turn adds 1 to the one :x that is already there, and the printed number climbs. One line moved, and the same body counts up instead of standing still.",
      },
      {
        source: [
          "# why: a name born before the loop can grow the drawing turn by turn",
          ":side = 20",
          "repeat 4",
          "  forward :side",
          "  right 90",
          "  :side = :side + 20",
          "end repeat",
        ].join("\n"),
        explanation:
          "Being born outside the loop is what makes this useful rather than just interesting: :side survives from one turn to the next, so the four sides come out 20, 40, 60, and 80 steps long instead of four equal sides. Had :side = 20 been written inside the body, every turn would have started it back at 20 and the turtle would have drawn a plain square.",
      },
    ],
    exercisePrompt:
      "Move the line that first gives a name its value — from inside the loop to above it, and back again — and say out loud what the four printed numbers will be before you run each version.",
  },
];

/**
 * Graded Level 3 exercises. `l3-size-square` ramps from introducing `:size` into a fixed square,
 * to resizing it once with the worded `set ... to` form, to reusing `:size` across a resizable
 * house's walls and roof together. `l3-where-a-name-is-born` (issue #829) ramps from moving one
 * line so the same loop body counts up instead of standing still, to using a name born outside
 * the loop to grow four sides, to the composed object: a snail's shell that only winds outward
 * because the growing name outlives each turn.
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
  {
    id: "l3-born-outside-count-up",
    lessonId: "l3-where-a-name-is-born",
    level: "3",
    difficulty: "guided",
    prompt:
      "This loop prints 1 1 1 1: repeat 4, then :count = 0, then :count = :count + 1, then print :count. Move the single line :count = 0 out of the loop to above the repeat — change nothing else — and predict the four numbers before you run it.",
    referenceSolution: {
      source: [
        "# why: moving the first value above the loop makes all four turns share one name",
        ":count = 0",
        "repeat 4",
        "  :count = :count + 1",
        "  print :count",
        "end repeat",
      ].join("\n"),
      explanation:
        "Moving :count = 0 above the repeat is the only change, and it prints 1 2 3 4 instead of 1 1 1 1. :count is now born outside the loop, so it is not started over on every turn: each turn adds 1 to the value the previous turn left behind.",
    },
  },
  {
    id: "l3-born-outside-growing-sides",
    lessonId: "l3-where-a-name-is-born",
    level: "3",
    difficulty: "practice",
    prompt:
      "Draw four sides that each come out longer than the one before, by giving :side its first value above the repeat and adding to it inside the body. Turn right 90 after each side.",
    referenceSolution: {
      source: [
        "# why: :side is born before the loop, so each turn draws a longer side",
        ":side = 30",
        "repeat 4",
        "  forward :side",
        "  right 90",
        "  :side = :side + 30",
        "end repeat",
      ].join("\n"),
      explanation:
        "The four sides are 30, 60, 90, and 120 steps long. :side is born above the repeat, so the :side = :side + 30 inside the body changes the one name that the next turn will read — if :side = 30 were written inside the body instead, every turn would start it back at 30 and all four sides would be the same length.",
    },
  },
  {
    id: "l3-snail-shell",
    lessonId: "l3-where-a-name-is-born",
    level: "3",
    difficulty: "challenge",
    prompt:
      "Draw a snail's shell: keep making the same quarter turn every time, but make every side a little longer than the last, so the path winds outward instead of closing up. Give the growing name its first value in the one place that lets it survive from turn to turn, and use enough turns for the shell to be recognizable.",
    referenceSolution: {
      source: [
        "# why: one :side born before the loop grows on every turn, so the same",
        "# side-and-quarter-turn pattern winds outward into a shell instead of closing",
        ":side = 10",
        "repeat 12",
        "  forward :side",
        "  right 90",
        "  :side = :side + 10",
        "end repeat",
      ].join("\n"),
      explanation:
        "The turn is the same quarter turn every time, exactly as in a square — the shell comes entirely from :side being born before the loop, so the twelve sides come out 10, 20, 30, and on up to 120 steps long and the path can never come back to where it started. Writing :side = 10 inside the body instead would start it over at 10 on every turn: twelve identical 10-step sides, and the turtle would just retrace one small square three times.",
    },
  },
];
