# Curriculum overview: Levels 1–5

> The first five of OpenLogo's [8 progressive learner levels](../spec/educational-model.md#the-8-progressive-levels)
> — movement through procedures — each teaching one new idea on top of the last, and each
> culminating in a challenge that composes a **recognizable object** (a house, a tree, a small
> street) rather than an abstract drill. Authored as validated `Lesson`/`Exercise` content in
> `@openlogo/edu` (`packages/edu/src/lessons/level-1.ts` … `level-5.ts`, aggregated by
> `packages/edu/src/lessons/registry.ts`). Levels 6–8 (geometry, data structures, algorithms) are
> out of scope for this milestone; see [`spec/educational-model.md`](../spec/educational-model.md)
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
drawn with every side typed out one at a time, since `repeat` does not exist yet.

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
triangle, to the open challenge: a **tree** — a trunk drawn with plain Level 1 moves, then
`repeat 3 [ ... ]` stacking three identical triangle tiers on top of it — followed by a "taller
tree" exercise that changes only the repeat count, the payoff moment for why `repeat` matters.

**Lesson content:** [`level-2.ts`](../packages/edu/src/lessons/level-2.ts) (lesson
`l2-square-repeat`).

## Level 3 — Variables

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

**Lesson content:** [`level-3.ts`](../packages/edu/src/lessons/level-3.ts) (lesson
`l3-size-square`).

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

**Objective:** See that `define … end` names a reusable procedure, that parameters such as
`:sides` and `:size` are variables scoped to it, that `return` hands a value back from a reporter,
that a command procedure may draw without returning a value, and that `local` names a variable
that lives only inside the procedure. `polygon` is always **built up** from `repeat` here — never
handed to the learner as an opaque primitive.

Heritage spellings `to … end` and `output` are recognized, but `define`/`return` are taught first.

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

The graded exercises ramp from a single-line change to the `polygon` call, to defining a second
procedure (`triangle`) that reuses `polygon` instead of repeating its logic, to the open challenge:
reusing `spec/examples/06-geometry.logo`'s validated `polygon` → `triangle` → `house` chain to
define `house :size`, then calling it twice to draw a small street of two houses side by side.

**Lesson content:** [`level-5.ts`](../packages/edu/src/lessons/level-5.ts) (lesson
`l5-polygon-procedure`).

## See also

- [`spec/educational-model.md`](../spec/educational-model.md) — the full 8-level model (Levels 6–8
  cover geometry, data structures, and algorithms), the discovery philosophy, and the
  compose-a-recognizable-object rule these lessons follow.
- [Educational commands reference](educational-commands.md) — `explain`/`why`/`hint`/`debug`,
  available throughout every level above.
- [`packages/edu/README.md`](../packages/edu/README.md) — the `@openlogo/edu` package overview,
  including the read-only `Lesson`/`Exercise` data contracts these lessons are authored against.
