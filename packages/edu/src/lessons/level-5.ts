/**
 * Level 5 — functions and procedures (`spec/educational-model.md:156-203`, issue #327). The
 * learner question is "How can I teach OpenLogo a new idea?": `define … end` names a reusable
 * idea, parameters such as `:sides` and `:size` are variables scoped to that idea, `return` hands
 * a value back from a reporter, a command procedure may draw without returning a value, and
 * `local` names a variable that lives only inside the procedure. Heritage spellings `to … end`
 * and `output` are recognized but are taught second, after `define`/`return` (educational-model.md
 * :160) — this lesson only mentions them in prose, per the maintainer's scope-trim comment on
 * issue #327, which also moves any *recursive* exercise (the "tree"/"xmas tree" idea) out to
 * Level 6 (Geometry): this slice's payoff is procedure reuse, not recursion.
 *
 * Per the discovery guardrail (educational-model.md:541), `polygon` is always **built up** from
 * `repeat` here — it is never handed to the learner as an opaque primitive — and the
 * `triangle`/`house` composition reuses `spec/examples/06-geometry.logo`'s validated `house 70`
 * program verbatim, so the lesson never drifts from that normative example.
 */

import type { Lesson } from "../lesson.js";
import type { Exercise } from "./exercise.js";

/**
 * The single Level 5 lesson: `define … end` names a reusable procedure, parameters are variables
 * scoped to it, `return` hands back a reporter's value, and `local` keeps a scratch variable
 * inside the procedure. The first worked example reproduces `spec/educational-model.md:171-182`'s
 * `polygon` example verbatim — built up from `repeat`, never an opaque primitive — and the second
 * reproduces :186-191's `double` reporter verbatim, so neither worked example drifts from the
 * normative sample.
 */
export const level5Lessons: readonly Lesson[] = [
  {
    id: "l5-polygon-procedure",
    title: "define names a reusable idea; return hands back its answer",
    level: "5",
    objective:
      "See that define … end names a reusable procedure and that parameters such as :sides and :size are variables scoped to it, so calling the procedure again with different values reuses the same steps — the procedure reuse the exercises practice. return (a reporter handing a value back) and local (a procedure's own private variable) are supporting ideas the worked examples show. Learners build polygon from repeat; it is never introduced as a black-box drawing trick.",
    workedExamples: [
      {
        source: [
          "# why: polygon is the side-and-turn pattern with names for the parts",
          "define polygon :sides :size",
          "  repeat :sides",
          "    forward :size",
          "    right 360 / :sides",
          "  end repeat",
          "end",
          "",
          "# why: five sides need five equal turns that add to a full turn",
          "polygon 5 60",
        ].join("\n"),
        explanation:
          "define polygon :sides :size names the side-and-turn pattern the learner already knows from repeat, but now with :sides and :size as parameters — variables that only exist while polygon is running. Calling polygon 5 60 hands 5 and 60 in for :sides and :size, so the same repeat body draws a pentagon instead of needing a brand-new program; polygon is never an opaque primitive, it is built from the very repeat the learner already wrote.",
      },
      {
        source: [
          "# why: a reporter can answer a question for another instruction",
          "define double :n",
          "  return :n * 2",
          "end",
          "",
          "forward double 40",
        ].join("\n"),
        explanation:
          "double :n is a reporter: return :n * 2 hands a value back to whoever called double, instead of drawing anything itself. forward double 40 first calls double 40, which returns 80, and then forward moves the turtle forward by that answer — a procedure can report a value for another instruction to use, the same way + or * already do.",
      },
      {
        source: [
          "# why: local keeps a scratch variable inside the procedure, invisible outside",
          "define double :n",
          "  local doubled",
          "  :doubled = :n * 2",
          "  return :doubled",
          "end",
          "",
          "print double 21",
        ].join("\n"),
        explanation:
          "local doubled declares :doubled as a variable that lives only inside double's own call — no other procedure, and no code outside double, can see or change it. This double still returns the same answer as the shorter version above; local is for a procedure's own scratch work, not for reporting.",
      },
    ],
    exercisePrompt:
      "Change one detail of the polygon example at a time — the shape it draws, its size, or a new small procedure that calls polygon — before composing a house from polygon and calling it more than once.",
  },
];

/**
 * Graded Level 5 exercises for `l5-polygon-procedure`, ramping from a single-line change to the
 * lesson's own polygon call (guided), to defining a second, smaller procedure that calls
 * `polygon` — the procedure-reuse idea this level is about (practice) — to the composition step:
 * `spec/examples/06-geometry.logo`'s `polygon` → `triangle` → `house` chain, called **twice**,
 * stepping between the two calls with already-taught **relative** movement (`pen_up`, turns and
 * `forward` moves, `pen_down`) — never `set_xy` (which names a coordinate) or `set_heading`
 * (which sets an absolute heading), both a Level 6 concept (`spec/educational-model.md`'s
 * concept→level table) — to draw a small row of houses (challenge), per the maintainer's
 * scope-trim comment on issue #327
 * (compose-a-recognizable-object, `spec/educational-model.md:23`/issue #359 — procedure reuse,
 * not recursion). The guided exercise is a literal single-line diff of the lesson's first worked
 * example (see level-5.test.mjs's diff assertion): only the `polygon 5 60` call changes, to
 * `polygon 6 50`, leaving the `define polygon …` body untouched.
 */
export const level5Exercises: readonly Exercise[] = [
  {
    id: "l5-polygon-hexagon",
    lessonId: "l5-polygon-procedure",
    level: "5",
    difficulty: "guided",
    prompt:
      "The reference program defines polygon :sides :size and calls polygon 5 60 to draw a pentagon. Change only the call, from polygon 5 60 to polygon 6 50, leaving the define polygon … body untouched, and predict how many sides the new shape has before you run it.",
    referenceSolution: {
      source: [
        "# why: polygon is the side-and-turn pattern with names for the parts",
        "define polygon :sides :size",
        "  repeat :sides",
        "    forward :size",
        "    right 360 / :sides",
        "  end repeat",
        "end",
        "",
        "# why: five sides need five equal turns that add to a full turn",
        "polygon 6 50",
      ].join("\n"),
      explanation:
        "Swapping polygon 5 60 for polygon 6 50 is the only change from the lesson's reference program: the same define polygon :sides :size body now runs with :sides bound to 6 and :size bound to 50, so it draws a hexagon of side 50 instead of a pentagon of side 60 — the procedure did not change, only the values handed to its parameters did.",
    },
  },
  {
    id: "l5-triangle-calls-polygon",
    lessonId: "l5-polygon-procedure",
    level: "5",
    difficulty: "practice",
    prompt:
      "Define a second, smaller procedure, triangle :size, that draws a triangle by calling polygon 3 :size instead of repeating forward/right itself — a procedure reusing another procedure — then call triangle 70.",
    referenceSolution: {
      source: [
        "define polygon :sides :size",
        "  repeat :sides",
        "    forward :size",
        "    right 360 / :sides",
        "  end repeat",
        "end",
        "",
        "define triangle :size",
        "  polygon 3 :size",
        "end",
        "",
        "triangle 70",
      ].join("\n"),
      explanation:
        "triangle :size does not repeat forward/right on its own — it hands 3 and :size to the already-defined polygon, reusing the exact same side-and-turn pattern the first worked example built. This is the new idea practice adds: a procedure's body can call another procedure instead of repeating that procedure's own logic.",
    },
  },
  {
    id: "l5-street-of-houses",
    lessonId: "l5-polygon-procedure",
    level: "5",
    difficulty: "challenge",
    prompt:
      "This is the composition step (spec/educational-model.md's compose-a-recognizable-object rule, issue #359), not a single-line change: reuse spec/examples/06-geometry.logo's polygon → triangle → house chain (a square body plus a triangular roof, both of side :size) to define house :size, then call house 70 twice — stepping to the next plot between calls with the relative movement you already know (pen_up, then turns and forward moves, then pen_down) so the two houses sit side by side as a small street. Reposition using only turns and forward moves you already know. Reuse the already-defined house by calling it again; do not make house call itself.",
    referenceSolution: {
      source: [
        "# why: polygon is the side-and-turn pattern with names for the parts",
        "define polygon :sides :size",
        "  repeat :sides",
        "    forward :size",
        "    right 360 / :sides",
        "  end repeat",
        "end",
        "",
        "# why: a triangle is a polygon that reuses polygon instead of repeating it again",
        "define triangle :size",
        "  polygon 3 :size",
        "end",
        "",
        "# why: a house is a square body plus a triangular roof, both built from the same :size",
        "define house :size",
        "  polygon 4 :size",
        "  pen_up",
        "  forward :size",
        "  right 90",
        "  forward :size",
        "  right 180",
        "  pen_down",
        "  triangle :size",
        "end",
        "",
        "# why: reuse house by calling it again, not by making house call itself",
        "house 70",
        "",
        "# why: step to the next plot with relative moves only — turn to face across the",
        "# street, cross the gap, come back down to the ground, and face up again — so the",
        "# pen never draws while moving to the next plot",
        "pen_up",
        "right 180",
        "forward 70",
        "right 90",
        "forward 70",
        "right 180",
        "pen_down",
        "",
        "house 70",
      ].join("\n"),
      explanation:
        "house :size is defined once and reused: the first house 70 draws a square body and triangular roof, leaving the turtle at the top of the house facing left. pen_up lifts the pen, then relative moves only — right 180 to face across the street, forward 70 over the gap, right 90 then forward 70 down to the ground, right 180 to face up again — carry the turtle to the next plot without drawing, using only the turns and forward moves already taught. pen_down and a second house 70 call the very same procedure again, so two identical houses stand side by side — a small street built by reusing one procedure twice rather than defining it twice or having it call itself.",
    },
  },
];
