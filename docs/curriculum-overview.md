# Curriculum overview: Levels 1–5

> The first five of OpenLogo's [8 progressive learner levels](../spec/educational-model.md#the-8-progressive-levels)
> — movement through procedures — each teaching one new idea on top of the last, and each
> culminating in a challenge that composes a **recognizable object** (a house, a tree, a small
> street, a heart, a staircase) rather than an abstract drill. Levels 3 and 5 carry
> two lessons each: the second in both cases teaches saga
> [#819](https://github.com/pmalarme/open-logo/issues/819)'s variable-scoping ruling at the point
> a learner first meets it ([#829](https://github.com/pmalarme/open-logo/issues/829)). Authored as
> validated `Lesson`/`Exercise` content in `@openlogo/edu`
> (`packages/edu/src/lessons/level-1.ts` … `level-5.ts`, aggregated by
> `packages/edu/src/lessons/registry.ts`). Levels 6–8 (geometry, data structures, algorithms) are
> out of scope for this saga; see [`spec/educational-model.md`](../spec/educational-model.md)
> for the full 8-level model.

Every worked example and reference solution below is executed against `@openlogo/runtime` in the
package's own tests, so none of this content can drift from real execution behavior. The four
[Educational meta-commands](educational-commands.md) (`explain`/`why`/`hint`/`debug`) are available
at every level below — they are not gated by level.

## Level 1 — Movement and drawing

**Objective:** See that a program is an ordered list of instructions, and that the turtle draws
only while the pen is down.

The turtle has a position, heading, pen, color, and width. `forward`/`back` move, `right`/`left`
turn in degrees, `pen_up`/`pen_down` decide whether movement draws, and `clear_screen`/`home` reset
the drawing/turtle. No variables, procedures, or control forms appear yet.

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

The graded exercises ramp from two joined lines, to a mark with a visible gap, to the open
challenge: a **house** — a square body and a triangle roof, each with a door and two windows —
drawn with every side typed out one at a time, since `repeat` is not introduced until Level 2.

**Lesson content:** [`level-1.ts`](../packages/edu/src/lessons/level-1.ts) (lesson
`l1-first-marks`).

## Level 2 — Patterns and repetition

**Objective:** Turn a repeated side-and-turn pattern into one rule using `repeat`, and use
`repcount` to see which turn is running.

`repeat` runs a bracketed block for its effects and keeps no value; a count says how many times
the block runs; `repcount` reports the current pass of the nearest enclosing `repeat`. Only Level 1
vocabulary plus `repeat`/`repcount` appears here.

```logo
# why: a square is one side-and-turn idea repeated four times
repeat 4
  forward 80
  right 90
end repeat
```

The graded exercises ramp from changing the repeat count, to matching the turn angle to a
triangle, to the open challenge: a **fir tree** — a trunk drawn with plain Level 1 moves, then
`repeat 3 [ ... ]` stacking three identical up-pointing triangles, each started only part way up
the one below so the branches overlap into layered fir sides — followed by a "taller tree" exercise
that changes only the repeat count, the payoff moment for why `repeat` matters.

**Lesson content:** [`level-2.ts`](../packages/edu/src/lessons/level-2.ts) (lesson
`l2-square-repeat`).

## Level 3 — Variables

### One name, many places

**Objective:** See that storing a value in `:size` and reusing it lets one name control every side
of a shape, whether the value is assigned with `=` or with the worded `set … to` form.

`:name` marks a variable everywhere, both when reading and when writing a target. `=` assigns a
value; the worded form `set name to value` reads like a sentence. `==` compares while `=` assigns.
Only Level 1–3 vocabulary appears here — no conditions (Level 4) and no procedures (Level 5).

```logo
# why: changing :size once changes every side
:size = 80
repeat 4
  forward :size
  right 90
end repeat
```

The graded exercises ramp from introducing `:size` into a fixed square, to resizing it once with
the worded `set … to` form, to the open challenge: a resizable **house** whose walls and roof both
reuse the one `:size` name, so a single change resizes the whole shape.

### Where a name is born decides how long it lives

**Objective:** See that a name is born where it is first given a value, and that a name born
inside a `repeat`'s body starts over on every turn while a name born before the loop is one
variable every turn keeps changing.

This is saga [#819](https://github.com/pmalarme/open-logo/issues/819)'s variable-scoping ruling at
the first point a learner can feel it. A name is born where it is first assigned and lives until
that scope ends, so a name born inside a block goes out of scope at the `end` of that block
([`spec/execution-model.md`](../spec/execution-model.md#blocks-update-what-they-can-see)). Two
programs with a word-for-word identical loop body therefore do completely different things
depending only on which side of the `repeat` the first assignment sits:

```logo
# why: :x is born inside the loop, so every turn starts it over at 0
repeat 4
  :x = 0
  :x = :x + 1
  print :x
end repeat
```

That prints `1 1 1 1`. Move the one line above the loop and the same body counts up:

```logo
# why: :x is born before the loop, so all four turns change one variable
:x = 0
repeat 4
  :x = :x + 1
  print :x
end repeat
```

That prints `1 2 3 4`. Being born outside is what makes the accumulator idiom possible at all —
`:side` surviving from turn to turn is how a loop grows a drawing rather than repeating it.

The graded exercises ramp from moving that single line so the same loop counts up, to carrying two
names across the turns at once (one growing the drawing, one totalling the distance), to the open
challenge: a **heart** made of two mirrored curls — where the second curl matches the
first only because the growing name is set back, since a name that outlives a loop remembers what
the last loop left in it.

**Lesson content:** [`level-3.ts`](../packages/edu/src/lessons/level-3.ts) (lessons
`l3-size-square`, `l3-where-a-name-is-born`).

## Level 4 — Conditions

**Objective:** See that a condition must already be `true` or `false` — OpenLogo never guesses a
boolean from a number, word, or list. Comparisons such as `==`, `!=`, `<`, `>`, `<=`, and `>=` build
that boolean, and `if … else` uses it to choose between two blocks.

`and`/`or`/`not` combine booleans, and worded predicates such as `is between` read like English
while still producing a strict boolean. Only Level 1–4 vocabulary appears here — no procedures
(Level 5).

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

The graded exercises ramp from flipping `==` to `!=`, to flipping `!=` to `>=` on the same value,
to the open challenge: a **house** (reusing Level 3's house shape) whose color is chosen by one
condition — green if `:size >= 80`, purple otherwise.

**Lesson content:** [`level-4.ts`](../packages/edu/src/lessons/level-4.ts) (lesson
`l4-shape-color-condition`).

## Level 5 — Functions and procedures

### `define` names a reusable idea; `return` hands back its answer

**Objective:** See that `define … end` names a reusable procedure, that parameters such as
`:sides` and `:size` are variables that belong to it, that `return` hands a value back from a reporter,
that a command procedure may draw without returning a value, and that a procedure's own names are
private **automatically**. `polygon` is always **built up** from `repeat` here — never handed to
the learner as an opaque primitive.

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

A procedure is a boundary in both directions, and nothing has to be declared to get it. The names
a procedure sets are its own — so the two `:answer` lines below are two different variables, and
this prints `42` then `5`:

```logo
# why: the names a procedure sets are its own, even when the name is already in use
:answer = 5
define show_double :n
  :answer = :n * 2
  print :answer
end

show_double 21
print :answer
```

A procedure can read three kinds of name: the ones it was **handed**, the ones it **set itself**,
and ones deliberately **shared** with it. Nothing else. Setting a name it does not already have
makes a new one that belongs to it, which is why `:answer = :n * 2` is fine — it only writes.
Change it to `:answer = :answer + 1` and the program stops, because that has to read `:answer`
first. That asymmetry is what the next lesson's one word repairs.

The other half is that inputs are yours: change them freely, the caller never sees it.

The graded exercises ramp from a single-line change to the `polygon` call, to defining a second
procedure (`triangle`) that reuses `polygon` instead of repeating its logic, to the open challenge:
reusing `spec/examples/06-geometry.logo`'s validated `polygon` → `triangle` → `house` chain to
define `house :size`, then calling it twice to draw a small street of two houses side by side.

### `global` shares one value across your procedures

**Objective:** See that a procedure cannot reach a name it was never handed — it sees only its own
inputs, the names it sets itself, and names declared `global` — and that `global` is shared, which
is what makes it writable from inside.

`global` is the one way through the boundary above, and it is the first time a learner meets
deliberate shared state. The name is written **bare**, without a colon, and a starting value is
required ([`spec/execution-model.md`](../spec/execution-model.md#global)):

```logo
# why: global is shared — that's what makes it writable from inside
global count = 0
define bump
  :count = :count + 1
end

bump
bump
print :count
```

That prints `2`. Written as a plain `:count = 0` the program prints nothing at all and stops on the
first call, because `:count = :count + 1` has to read `:count` before it can change it and `bump`
was never handed one. OpenLogo reports `ol-var-not-visible`, and its message names the procedure,
the rule, and the fix:

```text
:count is not defined inside bump. a procedure only sees its own inputs, the names it sets
itself, and names declared global. the fix is one word at the top level: write global count =
(its starting value).
```

Note where that message reaches the learner today: the studio's diagnostics pane does not yet run
the semantic checker while a learner types
([#814](https://github.com/pmalarme/open-logo/issues/814)), so they meet it by pressing **Run** and
reading the runtime's copy, not by seeing it appear as they write. The lesson teaches the boundary
and the one-word fix, not an IDE experience that is not wired up yet. Once declared, the name is
shared with every procedure in this program — `import` shares procedures and alias declarations,
never variables, so a `global` never reaches beyond the document that declares it.

The graded exercises ramp from that one-word fix, to a procedure given an input *as well as* a
shared total — so the two kinds of name are contrasted rather than described — to the open
challenge: a **staircase** whose steps grow although every call is written identically, because the
rise is shared and the tread is handed in.

Under saga [#819](https://github.com/pmalarme/open-logo/issues/819)'s ruling, `local` is no longer
taught at this level. It used to be what *made* a procedure's variable private; now privacy is the
default and `local` survives as a way to deliberately **shadow** a name that is already visible
([`spec/execution-model.md`](../spec/execution-model.md#local)) — which only means something once
a learner has met `global`, making it a later and narrower idea than Level 5.

**Lesson content:** [`level-5.ts`](../packages/edu/src/lessons/level-5.ts) (lessons
`l5-polygon-procedure`, `l5-global-shared-value`).

## See also

- [`spec/educational-model.md`](../spec/educational-model.md) — the full 8-level model (Levels 6–8
  cover geometry, data structures, and algorithms), the discovery philosophy, and the
  compose-a-recognizable-object rule these lessons follow.
- [Educational commands reference](educational-commands.md) — `explain`/`why`/`hint`/`debug`,
  available throughout every level above.
- [`packages/edu/README.md`](../packages/edu/README.md) — the `@openlogo/edu` package overview,
  including the read-only `Lesson`/`Exercise` data contracts these lessons are authored against.
