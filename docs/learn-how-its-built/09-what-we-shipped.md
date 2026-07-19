# 09 · What we shipped

Every other page in this series shows you one *machine* — the lexer, the tree, the interpreter, the
checker. This page zooms out: forget how it works — **what does OpenLogo actually have, right now,
that you could run?** Think school report card: not "how did you study," but "what did you learn."

## Two checkpoints so far

OpenLogo's roadmap is cut into **milestones** — checkpoints where a whole group of features is
proven to work *together*. We've reached two of them:

```mermaid
flowchart LR
  M0["🏗️ M0 · Foundation<br/>the workshop gets built"] --> M1["🧠 M1 · Core Language<br/>the language comes alive"]
  M1 -.->|"next up"| M2["🐢 M2 · Turtle & Rendering<br/>drawing on screen"]
```

M0 and M1 are both real, merged into shared code today. The dashed arrow to M2 means "planned
next" — the dashed-line-means-optional convention from page 01's diagram.

## M0 · Foundation — building the workshop

Before you build a language, you need a workshop. M0 built one:

- **The monorepo** — every OpenLogo package (lexer, tree-builder, interpreter, turtle, the app you
  type into) lives in one shared project, like every tool in a woodshop on the same shelves. It's
  built with a **toolchain** — the tools (TypeScript 7) turning source code into a runnable program,
  like lumber into finished boards.
- **CI** ("continuous integration") — a robot checking every proposed change instantly, enforcing our
  **Definition of Done**: building, type-checking, style, and tests must pass before a change joins
  the shared code, like an inspector who won't let an unchecked part onto the line.
- **The conformance harness** — runs **conformance fixtures**: tiny examples saying "run *this*
  program, see *exactly* these results" — an answer key checked automatically, forever, instead of
  once by a teacher.
- **Four shared contracts** — a **contract** is a shape everyone agrees to use, like every outlet in
  a country sharing one plug shape. OpenLogo has four: the **AST** (the tree shape a parsed program
  takes — page 04), the **event stream** (a play-by-play of what happened while your program ran,
  like a sportscaster's call), the **`ol-*` diagnostics** (every error/warning, with its own stable
  code, like a doctor's diagnosis codes), and the **token classes** (categories a highlighter sorts
  words into — page 06). Agreeing on these first let separate teams build the lexer, the turtle
  engine, and the highlighter **at the same time** without colliding — like crews agreeing on
  measurements before framing four walls.

## M1 · Core Language — the language wakes up

M1 turned the empty workshop into a language you can run — just not one that draws pictures yet
(M2's job). It was built as a **walking skeleton**: the smallest version of *every* layer, wired end
to end, before any layer got fancy — like sketching a stick figure before adding muscle and skin.

- **Reading and running your code** — the lexer, reader, AST (pages 03–04), interpreter, and runtime
  (page 05) cover the whole Core grammar, including `define … end` procedures: teach OpenLogo a
  recipe once (`define square :size … end`) and call it by name afterward.
- **Deciding and repeating** — the **control forms** `if`/`while`/`repeat`/`forever`/`for` (deciding
  *whether* or *how many times* other instructions run), plus **comprehensions** — `map`, `filter`,
  `reduce` — transforming a whole list in one line: `map [ :x * 2 ] [ 1 2 3 ]` doubles every number
  without writing the loop yourself.
- **Words, lists, and math** — Core **reporters** (an instruction handing back an answer instead of
  doing something): `word`/`sentence`/`first`/`last`/`butfirst`/`butlast`/`fput`/`lput`/`count`/
  `uppercase`/`lowercase`, plus math (`abs`/`sqrt`/`round`/`power`/`random`) and predicates
  (`empty?`/`member?`). `print`/`show` let your program talk back.
- **Errors, colors, and a place to try it** — `ol-*` diagnostics became real error messages, the
  checker (page 07) learned every Core word (`prnt` really suggests `print`), the highlighter
  (page 06) learned every Core token class, and `@openlogo/studio`'s REPL (type a line, see what
  happens — read-evaluate-print-loop) already runs non-graphical Core: variables, procedures, loops,
  printing, everything but the turtle.

Every piece is backed by real conformance fixtures under `tests/conformance/core-language/` —
folders for `procedures/`, `control/`, `comprehensions/`, `lists/`, `variables/`, `diagnostics/`, and
more. This checkpoint has its own name: **`0.1.0-core`**.

## ✅ / ℹ️ What's real today

✅ **The full Core language runs, end to end** — lexing, the tree, the interpreter, `define … end`
procedures, every control form, both comprehensions, and the full Core reporter set, proven by real
fixtures. You can type and run these in the studio REPL — no turtle required.

ℹ️ **No turtle movement yet** — `forward`/`right` aren't Core; they belong to the **Turtle &
Rendering** milestone (M2), next on the roadmap. Everything above runs without a turtle moving.

## Try it yourself

Open `tests/conformance/core-language/` in the OpenLogo repository and count the folders — each is a
different piece of Core. Open a `.logo` file next to its `.expected.json` match to see a real proof.

**Next up →** check the [series map](README.md) for the full list.
