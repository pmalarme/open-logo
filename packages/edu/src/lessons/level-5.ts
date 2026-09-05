/**
 * Level 5 — functions and procedures (`spec/educational-model.md:156-203`, issue #327). The
 * learner question is "How can I teach OpenLogo a new idea?": `define … end` names a reusable
 * idea, parameters such as `:sides` and `:size` are variables scoped to that idea, `return` hands
 * a value back from a reporter, and a command procedure may draw without returning a value.
 * Heritage spellings `to … end` and `output` are recognized but are taught second, after
 * `define`/`return` (educational-model.md:160) — this lesson only mentions them in prose, per the
 * maintainer's scope-trim comment on issue #327, which also moves any *recursive* exercise (the
 * "tree"/"xmas tree" idea) out to Level 6 (Geometry): this slice's payoff is procedure reuse, not
 * recursion.
 *
 * **Issue #829 re-sequenced what this level says about privacy.** Before saga #819's
 * variable-scoping ruling, `local` was the thing that *made* a procedure's variable private, so
 * it was a Level 5 headline. Under the ruling privacy is the default: a procedure sees only its
 * own parameters, the names its body has already created, and names declared `global`, and
 * everything else is invisible rather than merely unwritable
 * (`spec/execution-model.md:389-394`). So `l5-polygon-procedure` now demonstrates that automatic
 * privacy and the "an input is yours" half of it (`spec/execution-model.md:471-474`) instead of
 * `local`, `l5-global-shared-value` teaches the deliberate sharing that `global` exists for
 * (`spec/execution-model.md:545-569`), and `local` — which survives the ruling as a way to
 * *shadow* a name that is already visible (`spec/execution-model.md:501-506`) — is no longer
 * taught here at all: shadowing is only a meaningful idea once a learner has met `global`, so it
 * is a later, narrower concept than this level.
 *
 * `spec/educational-model.md` is maintainer-owned, so its Level 5 `local` bullet (`:168`) and its
 * concept-to-command map row (`:410`) still name `local` and still have no row for `global`. The
 * matching normative edits are proposed for maintainer review in issue #1124; this module
 * deliberately leads the document rather than waiting for it, because the *behaviour* it teaches
 * is already merged and shipping a lesson that contradicts the runtime would be worse than
 * shipping one that leads the prose.
 *
 * **What these lessons may not promise.** The studio's diagnostics pane does not yet run the
 * semantic checker while a learner types (issue #814), so `ol-var-not-visible` reaches a learner
 * only after they press Run, as the runtime's copy of the message — not as they write. The
 * `global` lesson therefore teaches the boundary and the one-word fix, and never an editor
 * experience. For the same reason nothing here says a shared value *looks* different: the
 * `global` semantic-token modifier exists (#1115) but the studio drops modifiers when mapping
 * tokens to CSS (issue #1106).
 *
 * Per the discovery guardrail (educational-model.md:541), `polygon` is always **built up** from
 * `repeat` here — it is never handed to the learner as an opaque primitive — and the
 * `triangle`/`house` composition reuses `spec/examples/06-geometry.logo`'s validated `house 70`
 * program verbatim, so the lesson never drifts from that normative example.
 */

import type { Lesson } from "../lesson.js";
import type { Exercise } from "./exercise.js";

/**
 * The Level 5 lessons. `l5-polygon-procedure` teaches `define … end` naming a reusable
 * procedure, parameters as variables scoped to it, `return` handing back a reporter's value, and
 * the boundary that makes a procedure's own names private automatically. Its first worked
 * example reproduces `spec/educational-model.md:171-182`'s `polygon` example verbatim — built up
 * from `repeat`, never an opaque primitive — and the second reproduces :186-191's `double`
 * reporter verbatim, so neither drifts from the normative sample; the third and fourth show the
 * two halves of the boundary, measured in `level-5.test.mjs` rather than asserted in prose.
 * `l5-global-shared-value` (issue #829) then teaches the one way through that boundary:
 * `global name = value`.
 */
export const level5Lessons: readonly Lesson[] = [
  {
    id: "l5-polygon-procedure",
    title: "define names a reusable idea; return hands back its answer",
    level: "5",
    objective:
      "See that define … end names a reusable procedure and that parameters such as :sides and :size are variables scoped to it, so calling the procedure again with different values reuses the same steps — the procedure reuse the exercises practice. return (a reporter handing a value back) and the boundary around a procedure (the names it sets are its own, and an input is yours to change) are supporting ideas the worked examples show. Learners build polygon from repeat; it is never introduced as a black-box drawing trick.",
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
          "# why: the names a procedure sets are its own, even when the name is already in use",
          ":answer = 5",
          "define double :n",
          "  :answer = :n * 2",
          "  print :answer",
          "end",
          "",
          "double 21",
          "print :answer",
        ].join("\n"),
        explanation:
          "This prints 42 and then 5. Both :answer lines are spelled the same, but they are two different variables: the one inside double is born inside double, so it belongs to that call and nothing outside can see it. Nothing had to be declared to make that happen — a procedure's own names are private automatically, which is what makes a procedure safe to call without reading its body first.",
      },
      {
        source: [
          "# why: an input is yours to change — the caller never sees it",
          ":start = 7",
          "define show_bigger :n",
          "  :n = :n + 100",
          "  print :n",
          "end",
          "",
          "show_bigger :start",
          "print :start",
        ].join("\n"),
        explanation:
          "This prints 107 and then 7. show_bigger changes :n freely, and :start is untouched afterwards, because :n is show_bigger's own name for the value it was handed, not another way of saying :start. So an input is yours: change it as much as the procedure needs, and the program that called you keeps what it had.",
      },
    ],
    exercisePrompt:
      "Change one detail of the polygon example at a time — the shape it draws, its size, or a new small procedure that calls polygon — before composing a house from polygon and calling it more than once.",
  },
  {
    id: "l5-global-shared-value",
    title: "global shares one value with every procedure",
    level: "5",
    objective:
      "See that a procedure cannot reach a name it was never handed — it sees only its own inputs, the names it sets itself, and names declared global — and that global name = value is how a program deliberately shares one value, so several calls can add to the same running count or total.",
    workedExamples: [
      {
        source: [
          "# why: global says out loud that this one value is shared with every procedure",
          "global count = 0",
          "define bump",
          "  :count = :count + 1",
          "end",
          "",
          "bump",
          "bump",
          "print :count",
        ].join("\n"),
        explanation:
          "This prints 2. Written as a plain :count = 0 the program would stop instead, because bump cannot see a name that was never handed to it — OpenLogo would say that :count is not defined inside bump. The word global on that first line is the whole fix: it says the value is shared, and from then on bump reads and changes it with no further ceremony. Note the shape of the declaration — the name is written bare, without a colon, and a starting value is required.",
      },
      {
        source: [
          "# why: each call leaves the shared :side longer, so the next call draws further",
          "global side = 20",
          "define step",
          "  forward :side",
          "  right 90",
          "  :side = :side + 10",
          "end",
          "",
          "repeat 6",
          "  step",
          "end repeat",
        ].join("\n"),
        explanation:
          "The six sides come out 20, 30, 40, 50, 60, and 70 steps long. Every call to step draws with the shared :side and then leaves it bigger, so the next call inherits the change — this is Level 3's grow-a-name-each-turn idea, except the growing now happens inside a procedure, which is exactly what a procedure could not do without global.",
      },
    ],
    exercisePrompt:
      "Start from a program whose procedure cannot see a top-level name, share that name with one word, and then give the procedure an input as well — so you can feel which values a procedure should be handed and which it should share.",
  },
];

/**
 * Graded Level 5 exercises. `l5-polygon-procedure` ramps from a single-line change to the
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
 *
 * `l5-global-shared-value` (issue #829) ramps the same way over the sharing idea: a one-word fix
 * turning a top-level name into a `global` one (guided), then the same procedure given an input
 * *as well as* a shared total, so the two kinds of name are contrasted rather than described
 * (practice), then the composed object — a staircase whose steps are drawn from their inputs and
 * whose total climb is accumulated into the shared name (challenge).
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
  {
    id: "l5-global-share-a-count",
    lessonId: "l5-global-shared-value",
    level: "5",
    difficulty: "guided",
    prompt:
      "This program draws four sides and wants to count them, but its first line is a plain :drawn = 0, so draw_side stops with :drawn is not defined inside draw_side. Change that one line — and only that line — so the count is shared with the procedure, then predict the printed number.",
    referenceSolution: {
      source: [
        "# why: one word on the first line shares the count with the procedure",
        "global drawn = 0",
        "define draw_side",
        "  forward 60",
        "  right 90",
        "  :drawn = :drawn + 1",
        "end",
        "",
        "draw_side",
        "draw_side",
        "draw_side",
        "draw_side",
        "print :drawn",
      ].join("\n"),
      explanation:
        "The only change is the first line, from :drawn = 0 to global drawn = 0, and it prints 4. Nothing inside draw_side had to change: once a name is declared global, a procedure reads and writes it exactly the way the top level does. The four sides and four right-angle turns also close the square, so the drawing is unchanged — the fix is about what the procedure can see, not about what it draws.",
    },
  },
  {
    id: "l5-global-total-of-inputs",
    lessonId: "l5-global-shared-value",
    level: "5",
    difficulty: "practice",
    prompt:
      "Now give the procedure an input as well: draw_side :length should draw a side of the length it is handed, turn right 90, and add that length to a shared running total. Call it four times with different lengths and print the total.",
    referenceSolution: {
      source: [
        "# why: the length is handed in for one call; the total is shared across all of them",
        "global total = 0",
        "define draw_side :length",
        "  forward :length",
        "  right 90",
        "  :total = :total + :length",
        "end",
        "",
        "draw_side 30",
        "draw_side 50",
        "draw_side 70",
        "draw_side 90",
        "print :total",
      ].join("\n"),
      explanation:
        "This prints 240, the four lengths added up. The two kinds of name are doing different jobs on purpose: :length is an input, so each call gets its own and the calls cannot disturb each other, while :total is shared, so each call adds to what the last one left. That is the question worth asking every time — does this value belong to one call, or to the whole program?",
    },
  },
  {
    id: "l5-global-staircase",
    lessonId: "l5-global-shared-value",
    level: "5",
    difficulty: "challenge",
    prompt:
      "Build a staircase: define stair :rise so that one call draws a single step — up by :rise, then across by a fixed tread — and leaves the turtle facing up again, ready for the next step. Call it four times with rises that grow, and have the staircase report how far it climbed in total, using a shared name the procedure adds to.",
    referenceSolution: {
      source: [
        "# why: one call draws one step and returns the turtle to facing up, so calls stack",
        "global climbed = 0",
        "define stair :rise",
        "  forward :rise",
        "  right 90",
        "  forward 40",
        "  left 90",
        "  :climbed = :climbed + :rise",
        "end",
        "",
        "# why: four steps, each taller than the last, climbing to the right",
        "stair 20",
        "stair 30",
        "stair 40",
        "stair 50",
        "print :climbed",
      ].join("\n"),
      explanation:
        "The four calls draw eight lines — a rise and a 40-step tread each — that stack into a staircase climbing to the right, and the program prints 140, which is 20 + 30 + 40 + 50. The staircase is drawn by the inputs and reported by the shared name: :rise is different on every call and belongs to that call alone, while :climbed is the one thing the whole program is keeping track of, so it is the one thing declared global. Ending each call with left 90 is what makes the steps stack, because it hands the next call a turtle facing the way the first one started.",
    },
  },
];
