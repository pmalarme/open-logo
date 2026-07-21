/**
 * Level 4 — conditions (`spec/educational-model.md:123-154`, issue #326). The learner question
 * is "How can the program choose?": a condition must already be `true` or `false` — OpenLogo
 * never guesses a boolean from a number, word, or list. `if … else` chooses between blocks;
 * `==`/`!=`/`<`/`>`/`<=`/`>=` are the comparisons that build a boolean; `and`/`or`/`not` combine
 * booleans; worded predicates such as `is between` read like English and still make a strict
 * boolean. Only Level 1-4 vocabulary appears here — no `define`/procedures (Level 5), per
 * educational-model.md:37's discovery guardrail.
 */

import type { Lesson } from "../lesson.js";
import type { Exercise } from "./exercise.js";

/**
 * The single Level 4 lesson: a condition must already be a strict boolean before `if … else` can
 * choose between two blocks. The first worked example reproduces `spec/educational-model.md:139-152`'s
 * `:sides == 4` color-choice program verbatim, so the lesson never drifts from the normative
 * sample. The remaining worked examples stay on the same `:sides`/`:size` vocabulary while
 * introducing the rest of Level 4's comparisons, `and`/`or`/`not`, and a worded predicate.
 */
export const level4Lessons: readonly Lesson[] = [
  {
    id: "l4-shape-color-condition",
    title: "A condition must already be true or false",
    level: "4",
    objective:
      "See that a condition must already be true or false; OpenLogo does not guess. Comparisons such as ==, !=, <, >, <=, and >= build that boolean, and if … else uses it to choose between two blocks.",
    workedExamples: [
      {
        source: [
          "# why: the turtle chooses a turn from a boolean comparison",
          ":sides = 4",
          "",
          "if :sides == 4",
          '  set_color "green"',
          "else",
          '  set_color "purple"',
          "end if",
          "",
          "repeat :sides",
          "  forward 70",
          "  right 360 / :sides",
          "end repeat",
        ].join("\n"),
        explanation:
          ':sides == 4 is a strict boolean — it is already true or false before if ever looks at it — so if chooses set_color "green" when :sides is 4 and set_color "purple" otherwise; OpenLogo never guesses a boolean from :sides itself, which is a number, not a condition. A learner who writes if :sides [ ... ] instead is trying to hand if that number directly: :sides is a number and the condition needs a boolean.',
      },
      {
        source: [
          "# why: != asks are these different, and <, >, <=, and >= compare order",
          ":sides = 6",
          "",
          "if :sides != 4",
          '  print "not a square"',
          "else",
          '  print "a square"',
          "end if",
          "",
          "if :sides >= 5",
          '  print "many sides"',
          "else",
          '  print "few sides"',
          "end if",
        ].join("\n"),
        explanation:
          "!= asks whether two values are different, the mirror of ==; <, >, <=, and >= ask how two values are ordered. Each comparison already produces a strict true or false before if reads it, exactly like == did in the first example.",
      },
      {
        source: [
          "# why: and, or, and not combine booleans without ever guessing from a number",
          ":sides = 4",
          ":size = 70",
          ":is_big_square = :sides == 4 and :size > 50",
          ":is_unusual_size = :size < 50 or :size > 90",
          "",
          "if :is_big_square",
          '  set_color "green"',
          "else",
          '  set_color "purple"',
          "end if",
          "",
          "if not (:sides == 4)",
          '  print "not a square"',
          "end if",
          "",
          "if :is_unusual_size",
          '  print "an unusual size"',
          "end if",
        ].join("\n"),
        explanation:
          ":is_big_square is only true when both :sides == 4 and :size > 50 are true, so and combines two strict booleans into one; :is_unusual_size is true when either :size < 50 or :size > 90 is true, so or is true as soon as one side holds; not (:sides == 4) flips a boolean rather than guessing from the number :sides directly — every value if ever sees is already true or false.",
      },
      {
        source: [
          "# why: a worded predicate reads like English and still makes a strict boolean",
          ":sides = 4",
          "if :sides is between 3 and 6",
          '  print "a friendly number of sides"',
          "end if",
        ].join("\n"),
        explanation:
          "is between reads like a sentence, but it still reports a strict true or false, the same as ==, !=, or a comparison — a worded predicate is just another way to build the boolean a condition needs.",
      },
    ],
    exercisePrompt:
      "Extend the shape-color program by changing exactly one comparison or branch at a time — every condition must stay a strict boolean (no truthiness), and do not add a define/procedure yet.",
  },
];

/**
 * Graded Level 4 exercises for `l4-shape-color-condition`, ramping from a single comparison-
 * operator change, to a second single comparison-operator change on the same shape and value, to
 * composing the concept into a recognizable house (reusing Level 3's house shape) whose color is
 * chosen by a condition — per the compose-a-recognizable-object rule (`spec/educational-model.md:23`,
 * issue #359). The guided and practice exercises are literal single-line diffs of one another
 * (see level-4.test.mjs's diff assertions): guided changes only `==` to `!=` from the lesson's
 * first worked example, and practice changes only `!=` to `>=` from guided — `:sides = 4` and
 * every branch body stay untouched across both, so only the comparison operator itself changes
 * each time. The challenge is intentionally exempt from that line-diff rule — it is the
 * composition step the guardrail rule asks for, not another single-line variation — but it still
 * uses exactly one comparison choosing between exactly one pair of branches, the same pattern
 * every earlier exercise used.
 */
export const level4Exercises: readonly Exercise[] = [
  {
    id: "l4-shape-color-flip-comparison",
    lessonId: "l4-shape-color-condition",
    level: "4",
    difficulty: "guided",
    prompt:
      "The reference program colors a square (:sides = 4) green when :sides == 4, and purple otherwise. Change only the comparison operator, from == to !=, leaving every other line untouched, and predict which color the square gets before you run it.",
    referenceSolution: {
      source: [
        "# why: the turtle chooses a turn from a boolean comparison",
        ":sides = 4",
        "",
        "if :sides != 4",
        '  set_color "green"',
        "else",
        '  set_color "purple"',
        "end if",
        "",
        "repeat :sides",
        "  forward 70",
        "  right 360 / :sides",
        "end repeat",
      ].join("\n"),
      explanation:
        "Swapping == for != is the only change from the lesson's reference program: :sides != 4 is now false for a square, so the else branch runs and the square is colored purple instead of green — the comparison changed, but it still produces a strict boolean before if reads it.",
    },
  },
  {
    id: "l4-shape-color-many-sides",
    lessonId: "l4-shape-color-condition",
    level: "4",
    difficulty: "practice",
    prompt:
      "Starting from the exercise above, change only the comparison operator again, from != to >=, leaving :sides = 4 and every other line untouched, and predict the square's color before you run it.",
    referenceSolution: {
      source: [
        "# why: the turtle chooses a turn from a boolean comparison",
        ":sides = 4",
        "",
        "if :sides >= 4",
        '  set_color "green"',
        "else",
        '  set_color "purple"',
        "end if",
        "",
        "repeat :sides",
        "  forward 70",
        "  right 360 / :sides",
        "end repeat",
      ].join("\n"),
      explanation:
        "Changing != to >= is the only change from the guided exercise: :sides >= 4 is true for the same square (:sides is still 4), so the green branch runs this time — a different comparison operator reaches a different verdict on the very same value, without touching :sides or either branch's body.",
    },
  },
  {
    id: "l4-house-color-by-size",
    lessonId: "l4-shape-color-condition",
    level: "4",
    difficulty: "challenge",
    prompt:
      "This is the composition step (spec/educational-model.md's compose-a-recognizable-object rule, issue #359), not a single-line change: draw a house — a square of side :size and a triangular roof of side :size, exactly as in the Level 3 house — and choose its color with one condition and one branch, the same shape the earlier exercises used: green if :size >= 80 (a big house), purple otherwise (a small house).",
    referenceSolution: {
      source: [
        ":size = 90",
        "",
        "if :size >= 80",
        '  set_color "green"',
        "else",
        '  set_color "purple"',
        "end if",
        "",
        "repeat 4",
        "  forward :size",
        "  right 90",
        "end repeat",
        "",
        "pen_up",
        "forward :size",
        "right 90",
        "forward :size",
        "right 180",
        "pen_down",
        "",
        "repeat 3",
        "  forward :size",
        "  right 120",
        "end repeat",
      ].join("\n"),
      explanation:
        ":size >= 80 is a strict boolean decided once, before either shape is drawn, so the whole house — walls and roof together — is colored green because :size is 90; a smaller house would take the else branch and be colored purple instead. The condition is still exactly one comparison choosing between exactly one pair of branches, the same pattern as the earlier exercises, now composed with Level 3's house instead of a bare polygon.",
    },
  },
];
