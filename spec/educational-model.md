> OpenLogo Specification v0.1.0 — Draft (Status: Informative)

# Educational Model

[Back to the specification index.](README.md)

OpenLogo is taught as a journey of discovery: learners do not receive magic commands that hide the idea. They meet a small turtle, try something visible, name the pattern they found, and only then package the pattern for reuse. This document describes the recommended learning path, not a conformance profile. Conformance profiles are owned by [conformance.md](conformance.md); primitive syntax and exact signatures follow the C3 matrix in [commands.md](commands.md).

This model is learner-facing. It is meant to help authors, teachers, tool builders, and families explain why each new command exists.

## Discovery philosophy

OpenLogo follows a constructionist rhythm:

1. **See it** — a movement, turn, mark, value, or error becomes visible.
2. **Name it** — the learner gives a discovered pattern a clear procedure or variable name.
3. **Change it** — one number changes and the drawing changes with it.
4. **Generalize it** — a repeated idea becomes a procedure, list, record, or algorithm.
5. **Share it** — the learner can explain the idea in their own words.

The guiding rule is: **build the concept before naming the shortcut**. A learner draws four sides with `repeat` before meeting `polygon`. A learner changes a number by hand before storing it in `:size`. A learner grows a path list before using `map` to transform it.

A companion rule shapes each lesson's culminating challenge: once a concept has been built and named, the learner composes it into a **recognizable, motivating object** rather than an abstract geometry drill — so learners apply the concept by reproducing something they recognize. This pattern repeats as new concepts are introduced, with each challenge building on ideas the learner has already met. For example, after learners use Level 1 movement and turns to build basic shapes, a challenge can be a **house** — a square or rectangle body, a triangle roof, and a door and windows; after Level 2's `repeat`, another can be a **tree**: a trunk with repeated triangle tiers. Each lesson teaches the parts first, then invites the learner to combine them into the whole.

Examples should always answer “why?” in plain language:

```logo
# why: four equal moves and turns bring the turtle back to the start
repeat 4
  forward 80
  right 90
end repeat
```

## The 8 progressive LEVELS

The levels are recommendations for pacing. A curriculum may pause, remix, or revisit them, but should not hide later concepts inside earlier lessons. In particular, examples for an early level should use only concepts already introduced at that level.

## Level 1 — movement and drawing

**Learner question:** “How can I make the turtle leave a mark?”

Level 1 starts with cause and effect. The turtle moves, turns, lifts the pen, lowers the pen, changes color, and clears the screen. The learner sees that a program is a list of instructions that happen in order.

Core ideas:

- A turtle has a position, heading, pen, color, and width.
- `forward` and `back` move; `right` and `left` turn in degrees.
- `pen_up` and `pen_down` decide whether movement draws.
- `clear_screen` starts again, and `home` returns the turtle to the center.

```logo
# why: the turtle draws only while the pen is down
set_color "blue"
set_width 3
forward 70
right 90
pen_up
forward 30
pen_down
forward 70
```

The learner should be encouraged to predict the turtle’s next position before running the program.

## Level 2 — patterns and repetition

**Learner question:** “Why type the same thing again and again?”

Level 2 introduces `repeat` as a way to make a discovered pattern shorter and safer. A block is a list of instructions; with `repeat`, OpenLogo runs that block for its effects and keeps no value.

Core ideas:

- Repetition turns a pattern into a rule.
- The bracketed `[ ]` block can hold more than one instruction.
- A count says how many times the block runs.
- `repcount` can help learners see “which turn am I on?”

```logo
# why: a square is one side-and-turn idea repeated four times
repeat 4
  forward 80
  right 90
end repeat
```

A good Level 2 lesson asks learners to change only one number at a time: the distance, the turn, or the repeat count.

## Level 3 — variables

**Learner question:** “How can one name control many places?”

Level 3 teaches the OpenLogo variable idiom: `:name` marks a variable everywhere, both when reading and when writing a target. `=` assigns a value. The worded form `set name to value` is kept because it reads like a sentence and connects to Logo heritage.

Core ideas:

- `:size = 80` stores a value in `:size`.
- `forward :size` reads the value.
- `:size = :size + 10` changes the value.
- `set size to 80` is the worded assignment form.
- `==` compares; `=` assigns.
- `random 100` reports a whole number for variety, and arithmetic such as `+`, `-`, `*`, and `/` combines values.
- `print` shows a value so the learner can check it.

```logo
# why: changing :size once changes every side
:size = 80
repeat 4
  forward :size
  right 90
end repeat

# why: the worded form says the same idea in a sentence
set size to 100
repeat 4
  forward :size
  right 90
end repeat
```

Teachers should say the colon out loud as “the value of” on reads and “the variable named” on write targets.

## Level 4 — conditions

**Learner question:** “How can the program choose?”

Level 4 introduces strict booleans. A condition must already be `true` or `false`; OpenLogo does not guess from numbers, words, or lists. Comparisons such as `==`, `!=`, `<`, `>`, `<=`, and `>=` create booleans.

Core ideas:

- `if … else` chooses between blocks.
- `==` asks “are these equal?”
- `!=` asks “are these different?”
- `and`, `or`, and `not` combine booleans.
- Worded predicates read like English and also make booleans, such as `:n is [ strictly ] between 3 and 6` and `:list is empty`.
- Conditions use strict booleans; there is no truthiness.

```logo
# why: the turtle chooses a turn from a boolean comparison
:sides = 4

if :sides == 4
  set_color "green"
else
  set_color "purple"
end if

repeat :sides
  forward 70
  right 360 / :sides
end repeat
```

Error messages should help here. If a learner writes `if :sides [ … ]`, the response should explain that `:sides` is a number and the condition needs a boolean. See [error-model.md](error-model.md).

## Level 5 — functions and procedures

**Learner question:** “How can I teach OpenLogo a new idea?”

Level 5 introduces `define … end` for procedures and `return` for procedures that report a value. Heritage spellings `to … end` and `output` are recognized, but teaching should present `define` and `return` first.

Core ideas:

- A procedure names a reusable idea.
- Parameters are variables such as `:sides` and `:size`.
- `return` hands a value back from a reporter.
- A command procedure may draw without returning a value.
- `local` names a variable that lives only inside the procedure.
- Learners build `polygon` from `repeat`; it is never introduced as a black-box drawing trick.

```logo
# why: polygon is the side-and-turn pattern with names for the parts
define polygon :sides :size
  repeat :sides
    forward :size
    right 360 / :sides
  end repeat
end

# why: five sides need five equal turns that add to a full turn
polygon 5 60
```

```logo
# why: a reporter can answer a question for another instruction
define double :n
  return :n * 2
end

forward double 40
```

The heritage form may appear as a comparison exercise after learners are comfortable:

```logo
# why: this heritage spelling means the same shape-building idea
to triangle :size
  repeat 3
    forward :size
    right 120
  end repeat
end
```

## Level 6 — geometry and mathematics

**Learner question:** “What math is the turtle discovering?”

Level 6 connects turtle motion to angles, distance, symmetry, approximation, and measurement. Geometry commands are part of a derived standard library whose source is visible in [geometry-module.md](geometry-module.md). The educational path still starts from `repeat`, then packages the idea.

Core ideas:

- A full turn is `360` degrees.
- A regular polygon turns by `360 / :sides`.
- A circle can be approximated by many small polygon sides.
- `sin`, `cos`, `tan`, `sqrt`, `power`, and `pi` are tools for explaining motion and shape.
- `mod` and `abs` help with remainders and distances.
- `set_xy` places the turtle at a coordinate, and `stamp` leaves a copy of its shape.
- `grid`, `axes`, and `measure` are overlays that help learners see relationships.

```logo
# why: 360 divided by 6 makes six equal outside turns
define polygon :sides :size
  repeat :sides
    forward :size
    right 360 / :sides
  end repeat
end

polygon 6 50
```

At this level, learners should be asked to estimate before calculating: “If six turns make a full turn, what should one turn be?”

## Level 7 — data structures

**Learner question:** “How can a program remember a collection of things?”

Level 7 is split into three parts. The access idiom stays consistent: read with `:thing[index]`, `:thing.field`, or `:thing.key`; write with a colon place such as `:thing.key = value` or the worded form `set thing.key to value`.

## Level 7a — lists

Lists are ordered mutable sequences. They use `[ ]` in value position and are indexed from `1`.

Core ideas:

- `[ ]` can make a list, and `list` makes one that starts empty.
- `:l[i]` reads or writes a list item.
- `add … to` grows a list in place.
- `remove … from` removes the first matching item.
- `count`, `first`, and `last` help inspect a list.

```logo
# why: the path remembers each distance in drawing order
:steps = [30 50 70]
add 90 to :steps

for step in :steps
  forward :step
  right 90
end for

# why: changing the first item changes the first move next time
:steps[1] = 40
```

## Level 7b — dictionaries

Dictionaries, or dicts, connect keys to values. A dict literal uses `{ key: value }` with bare keys and no commas. Reading a missing key is an error, but writing a missing final key adds it.

Core ideas:

- `{ }` makes a dict.
- `:d.k` reads a literal key.
- `:d[k]` reads a literal key in brackets.
- `:d[:who]` reads the key stored in `:who`.
- Writing `:d.new_key = value` upserts the key.

```logo
# why: names help the learner remember what each value means
:ages = {
  sophie: 6
  tom: 8
}

print :ages.tom
:ages.max = 9

:who = "sophie"
print :ages[:who]
```

## Level 7c — records

Records are typed structures with fixed fields. `struct` declares the fields, and the type name becomes the constructor. Records are useful when each item has the same shape.

Core ideas:

- `struct point [ x y ]` declares a record type.
- `point 10 20` constructs a point.
- `:p.x` reads or writes a field.
- Unknown fields are errors because fields are fixed.
- Nested chains such as `:people.tom.age` mix dicts and records.

```logo
# why: a point keeps x and y together as one idea
struct point [ x y ]

:p = point 10 20
print :p.x
:p.y = 30
```

```logo
# why: nested chains let one place describe a path through data
struct person [ name age ]

:people = {
  tom: person "tom" 8
}

print :people.tom.age
:people.tom.age = 9
```

## Level 8 — algorithms

**Learner question:** “How can a small rule solve a bigger problem?”

Level 8 introduces algorithms as named strategies. It is split into recursion and comprehensions so learners can meet one big idea at a time.

## Level 8a — recursion

Recursion is a procedure calling itself with a smaller problem. It is powerful for fractals because a fractal is a shape that contains smaller versions of itself.

Core ideas:

- A recursive procedure needs a stopping condition.
- Each call should make the problem smaller.
- `return` can stop a reporter; `stop` can exit a command early.
- Execution limits protect learners from accidental forever programs.

```logo
# why: each branch draws two smaller branches until the size is tiny
define branch :size
  if :size < 5
    stop
  end if

  forward :size
  left 30
  branch :size * 0.7
  right 60
  branch :size * 0.7
  left 30
  back :size
end

branch 60
```

The teaching moment is not “recursion is hard.” It is “the same instruction can solve the next smaller version.”

## Level 8b — comprehensions and destructuring

Comprehensions transform, choose, or combine data without introducing lambdas or first-class procedure values. `map`, `filter`, and `reduce` use an expression body in `[ ]`; the last expression is the value. Do not use `return`, `output`, `op`, or `stop` inside a comprehension body.

Destructuring `for` lets a learner take apart list items or records by position.

Core ideas:

- `map item in :list [ expression ]` creates a fresh list.
- `filter item in :list [ boolean_expression ]` keeps matching items.
- `reduce acc item in :list from :start [ expression ]` combines items.
- `for [:x :y] in :points [ … ]` binds parts of each item.
- These forms are for data flow, not hidden functions.

```logo
# why: map says how each number changes
:nums = [1 2 3 4]
:doubled = map num in :nums [ :num * 2 ]

# why: filter keeps only numbers that answer true
:big = filter num in :nums [ :num > 2 ]

# why: reduce carries a running total
:total = reduce sum num in :nums from 0 [ :sum + :num ]
```

```logo
# why: each point gives names to its two parts before drawing
:points = [[0 0] [50 0] [50 50] [0 50]]

for [:x :y] in :points
  set_xy :x :y
  stamp
end for
```

## Concept to command map

| Learner concept | Primary OpenLogo forms | First level | Why it appears there |
|---|---|---:|---|
| Movement with visible feedback | `forward`, `back`, `right`, `left`, `pen_up`, `pen_down`, `set_color`, `set_width`, `home` | 1 | The learner can immediately see cause and effect. |
| Ordered instructions | one instruction per line, `[ ]` blocks later | 1 | A program begins as a readable list of actions. |
| Repetition | `repeat`, `repcount` | 2 | A visible pattern becomes one named rule. |
| Variable naming | `:name = value`, `set name to value`, `:name` reads | 3 | One value can control many instructions. |
| Showing values | `print` | 3 | Learners can read a value, not only see a drawing. |
| Comparison and choice | `if … else`, `==`, `!=`, `<`, `>`, `<=`, `>=`, worded `is` predicates, `true`, `false`, `and`, `or`, `not` | 4 | Programs can choose only from explicit booleans. |
| Procedures | `define … end`, `local`, procedure calls | 5 | Learners teach OpenLogo a discovered pattern. |
| Reporters | `return`, heritage `output` and `op` | 5 | A procedure can answer a question with a value. |
| Derived geometry | learner-built `polygon`, then `star`, `circle`, `arc`, `grid`, `axes`, `measure` | 6 | Shapes are visible math, not hidden primitives. |
| Turtle placement and marking | `set_xy`, `stamp` | 6 | Coordinates and stamps support diagrams and games. |
| Number tools | `mod`, `abs`, `int`, `round` | 6 | Arithmetic helpers measure and adjust motion. |
| Lists | `[ ]`, `list`, `:l[i]`, `add … to`, `remove … from`, `count`, `member?` / worded `… is member of` | 7a | Ordered memory supports paths, scores, and steps. |
| Dictionaries | `{ key: value }`, `:d.k`, `:d[k]`, `:d[:var]`, upsert on write | 7b | Named memory supports meaningful lookup. |
| Records | `struct`, type-name constructor, `:p.f`, nested chains | 7c | Fixed fields keep related facts together. |
| Recursion | `define`, `if`, self-call, `stop` | 8a | A rule can solve a smaller version of itself. |
| Comprehensions | `map`, `filter`, `reduce` | 8b | Data can be transformed without lambdas. |
| Destructuring | `for [:x :y] in :points` | 8b | Learners can name the parts of each item directly. |

## Baseline meta-commands

The [Educational profile in conformance.md](conformance.md#educational) makes four baseline meta-commands a normative requirement — `explain`, `why`, `hint`, and `debug` — and specifies their canonical signatures normatively there. This document owns their educational behavior. Their signatures are, for reference:

| Name | Kind | Default arity | Result |
|---|---:|---:|---|
| `explain` | C | 0 | none (tutor output) |
| `why` | C | 0 | none (tutor output) |
| `hint` | C | 0 | none (tutor output) |
| `debug` | C | 0 | none (tutor output) |

Each is a Command invoked as a bare word with no inputs; the AI-enhanced `challenge` command has the same shape, is required by the Tutor profile with a signature that is normative in [conformance.md](conformance.md#tutor-ai), and its behavior is specified in [ai-tutor.md](ai-tutor.md). Their educational behavior is owned here.

Baseline means **no AI is required**. These commands are deterministic and template-based. They use the parsed program, source spans, trace events, diagnostics, and known command metadata to produce predictable help. AI-enhanced behavior is optional and is specified in [ai-tutor.md](ai-tutor.md).

Each invocation emits a normative `tutor-output` event, as specified in
[execution-model.md](execution-model.md#tutor-output-educational-profile), immediately after the
command produces its result. The event's `segments` payload carries the learner-facing message
described in this section; its `target-source-span` identifies the instruction, statement range, or
short program the message is about (when one is selected), and its optional `diagnostic-code` names
the `ol-*` code when `why` or `debug` is explaining a diagnostic. For `hint`, the event's `stage`
field identifies which of the four progressive stages below the message belongs to.

## `explain`

`explain` describes what a selected instruction or short program does in learner language.

Baseline behavior:

- Name the command or special form.
- Say what inputs it uses.
- Say what visible or stored effect it has.
- Link the idea to the current level.
- Avoid rewriting the learner’s whole program.

Example template:

```logo
# why: explain should name the idea without solving the next challenge
repeat 4
  forward 80
  right 90
end repeat
```

Possible response: “`repeat` runs the block four times. Each time, the turtle moves forward and turns right. The repeated side-and-turn pattern makes a square.”

## `why`

`why` uses the execution trace to answer why something happened. It should point to the instruction, state, or comparison that caused the result.

Baseline behavior:

- Identify the source instruction.
- Use the turtle state or variable value at that moment.
- Explain the cause in one or two steps.
- When an error happened, link to the diagnostic shape in [error-model.md](error-model.md).

```logo
# why: the color changes because the comparison is true
:sides = 4
if :sides == 4
  set_color "green"
else
  set_color "purple"
end if
```

Possible response: “The turtle became green because `:sides == 4` was `true`, so OpenLogo ran the first block.”

## `hint`

`hint` is progressive and never reveals a full solution: the same request moves through stages only when the learner asks again or the environment records that earlier hints were already shown. The [Educational profile in conformance.md](conformance.md#educational) makes this progressive, no-full-solution behavior normative. Each stage below is emitted as the `stage` field of the `tutor-output` event specified in [execution-model.md](execution-model.md#tutor-output-educational-profile); progression is keyed by the event's `target-source-span` — the first hint for a given target is `nudge`, each repeated request for the same target escalates one stage, and requests after `last-resort` repeat `last-resort` rather than reveal the solution — so a conformance fixture can assert the stage progression and the no-full-solution guardrail per stage.

Progression:

1. **Nudge** — point attention to the relevant place.
2. **Concept** — name the concept that may help.
3. **Partial** — show a small pattern with different names or numbers.
4. **Last-resort** — describe the next step, still without giving the complete answer.

For a challenge to draw a pentagon, a compliant progression could be:

- Nudge: “Look at the turn after each side. How many equal turns make a full turn?”
- Concept: “A full turn is `360` degrees, and a regular polygon divides that by the number of sides.”
- Partial: “For a shape with `:sides`, the turn can use `360 / :sides`.”
- Last-resort: “Try using `repeat 5` with one `forward` and one `right 360 / 5` inside the block.”

Even the last-resort hint avoids presenting the whole final program.

## `debug`

`debug` helps learners inspect what happened without exposing implementation stack traces. It should use the same diagnostic codes and `source_span` model as [error-model.md](error-model.md).

Baseline behavior:

- Show the current instruction.
- Show relevant variable values.
- Show turtle state when useful: position, heading, pen, color, width.
- For procedures, show a friendly call path.
- For errors, include the stable `ol-*` code and a learner message.
- Suggest one next investigation step, not a full fix.

```logo
# why: debug can show that :size is a word when forward needs a number
:size = "big"
forward :size
```

Possible response: “`forward` needs a number to tell it how far to go. Here `:size` is the word `"big"`. Diagnostic: `ol-type`.”

## Educational conformance notes

The [Educational profile in conformance.md](conformance.md#educational) normatively requires deterministic baseline `explain`, `why`, `hint`, and `debug` behavior even when offline and without AI services, and requires any AI Tutor layer to degrade gracefully to that baseline. This section explains the pedagogy those requirements protect.

To protect discovery:

- Do not reveal full challenge solutions through `hint`.
- Do not introduce commands from a later level as shortcuts for an earlier idea.
- Do not hide `polygon` behind an opaque primitive before the learner has built it from `repeat`.
- Do not use truthiness; explain booleans directly.
- Do not use arrays or lambdas; lists and comprehensions are the OpenLogo path.
- Prefer full command names in teaching material, with short aliases saved for heritage notes.

Good educational tools make the learner feel: “I can see what happened, I can name why it happened, and I know one next thing to try.”
