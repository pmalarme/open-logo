> OpenLogo Specification v0.1.0 — Draft (Status: Informative)

# OpenLogo Style Guide

Back to the [specification index](README.md).

This guide is about writing OpenLogo that a learner can read again tomorrow. The grammar accepts more than one spelling in a few places, but examples, lessons, and shared libraries should prefer the clearest form. Each rule below is keyed to a style linter check defined by [tooling](tooling.md), using the `ol-style-*` family of warnings.

## Quick checklist

| Style choice | Prefer | Avoid | Linter check |
|---|---|---|---|
| Identifier shape | `side_length` | `sideLength`, `side-length` | `ol-style-name-case` |
| Keyword spelling | `repeat`, `define`, `end` | `REPEAT`, `Define` | `ol-style-name-case` |
| Command name | `pen_down` | `pd` | `ol-style-full-name` |
| Line shape | one command per line | squeezed command chains | `ol-style-one-command-per-line` |
| Block body | `[ ]` inline, `… end` for multi-line | a sprawling multi-line `[ ]` block | `ol-style-prefer-block` |
| Predicate names | `empty?`, `is_square?` | `empty`, `check_square` | `ol-style-predicate-name` |
| Procedure names | `draw_star`, `is_inside?` | vague verbs like `do_it` | `ol-style-procedure-name` |
| Comments | `#` for normal notes | `//` everywhere | `ol-style-comment-style` |
| Values in effect blocks | commands for effects | unused final values | `ol-style-useless-value` |

## Names use `snake_case`

Use lowercase words joined with underscores for variables, procedures, struct types, fields, and binders. Names should describe the idea being taught, not the shortcut used to type it.

```logo
:side_length = 100
:turn_angle = 90

struct turtle_step [ distance angle ]
```

Prefer complete words when they help the reader. A short loop binder is fine when its role is local and obvious.

```logo
for i from 1 to 4 [ print :i ]
```

Linter check: `ol-style-name-case` warns on mixed case, hyphenated names, and built-in examples that are not lowercase snake_case.

## Keywords are lowercase

OpenLogo keywords are case-insensitive, but lowercase is the shared style. Lowercase makes copied examples look the same in every lesson and keeps localized aliases visibly separate from the canonical English form.

```logo
repeat 4
  forward 100
  right 90
end repeat
```

Linter check: `ol-style-name-case` warns when canonical keywords or primitive names are written with other casing.

## Prefer the full underscored command name

The full underscored name is primary. Use `pen_down`, `clear_screen`, `set_heading`, and `set_color` in teaching material and libraries. One-word aliases and short heritage aliases are useful when reading old Logo code, but they should not be the first spelling a learner sees.

```logo
pen_up
forward 40
pen_down
set_color "blue"
```

Avoid this in new examples:

```logo
pu
fd 40
pd
setcolor "blue"
```

Single-word primitives such as `forward`, `right`, `home`, and `print` are already the full name.

Linter check: `ol-style-full-name` suggests the primary spelling when a known alias such as `pd`, `fd`, or `setcolor` is used in style-checked code.

## Put one command on each line

One command per line matches the way the turtle acts: one visible idea, then the next. It also makes stepping, tracing, and friendly error messages easier to follow.

```logo
forward 100
right 90
forward 100
right 90
```

A short single-line block is acceptable when the whole idea truly fits on one line.

```logo
if :done [ print "finished" ]
```

Do not pack several effects onto one physical line just to save space. Inside a bracket block, packing parses but hides the individual steps:

```logo
repeat 2 [ forward 100 right 90 forward 100 right 90 ]
```

Prefer one command per line:

```logo
repeat 2 [
  forward 100
  right 90
]
```

At the top level this packing is not even legal: the grammar separates top-level statements with newlines, so `forward 100 right 90` on one physical line is a syntax error rather than a style problem.

Linter check: `ol-style-one-command-per-line` warns when multiple effectful commands appear on one physical line inside a block body, outside a deliberately short one-line block.

## Indent block bodies

Use two spaces inside every block. In the default `… end` form, align the closing `end` with the command that opened the block, and add the optional label when it makes nested code easier to scan.

```logo
define draw_square :size
  repeat 4
    forward :size
    right 90
  end repeat
end define
```

A short inline `[ ]` block keeps the same breathing room around its single line.

```logo
repeat 4 [ forward 100  right 90 ]
```

Linter checks: `ol-style-block-indentation` warns about inconsistent indentation, and `ol-style-deep-nesting` suggests labels such as `end repeat` or `end define` when nesting makes a plain `end` hard to match.

## Choose `[ ]` or `end` blocks

Every control body is delimited. Use a bracketed `[ ]` block for a short body that fits comfortably on a single line — this inline form is handy for a quick loop or a one-line `if`, and it is required even for a single instruction.

```logo
repeat 4 [ forward 100  right 90 ]
if :done [ print "finished" ]
repeat 4 [ move_and_turn ]
```

Use the `… end` block as the default whenever the body spans more than one line. It reads like a small story: one instruction per line, an aligned closing `end`, and an optional label such as `end repeat` or `end if` that makes nested code easy to match. A `[ ]` block may also span several lines, but prefer `… end` for readability.

```logo
repeat 4
  forward 100
  right 90
end repeat
```

Reach for the `end` form whenever the body has comments, nested control, or an `else`, so every part stays on its own labelled line.

```logo
if :side_length > 0
  repeat 4
    forward :side_length
    right 90
  end repeat
else
  print "choose a bigger size"
end if
```

Comprehensions always use a bracketed expression block, even across several lines, because `[ ]` is the only body form the block-result rule lets return a value.

```logo
:bigger = filter size in :sizes [ :size > 20 ]
```

Linter check: `ol-style-prefer-block` warns when a multi-line bracketed block would read more clearly as an `end` block.

## Name predicates with `?`

A predicate reports a boolean, so its name should end in `?`. This makes conditions read like questions.

```logo
define is_square? :width :height
  return :width == :height
end

if is_square? 100 100
  print "all sides match"
end if
```

Use `is_*?` for predicates that classify a value, and keep built-in predicate style such as `empty?`, `member?`, and `is_a?`.

Linter check: `ol-style-predicate-name` warns when a boolean-returning procedure lacks `?`, and when a non-boolean command uses a misleading `?` suffix.

## Name procedures by what they teach

Use `draw_*` for procedures that draw, `move_*` for turtle motion helpers, `make_*` for constructors or builders, and `is_*?` for boolean reporters. A good name tells the learner whether the procedure has an effect or reports a value.

```logo
define draw_triangle :size
  repeat 3
    forward :size
    right 120
  end repeat
end

define is_long_enough? :size
  return :size >= 50
end
```

Avoid names that hide the idea.

```logo
define do_it :x
  forward :x
end
```

Linter check: `ol-style-procedure-name` warns on vague teaching examples, non-snake-case procedure names, and predicate procedures that do not follow the `is_*?` or `*?` pattern.

## Use `#` comments first

Use `#` for normal comments. It is the clearest comment marker for lessons and should be the style used in examples. Use `//` only when showing compatibility with another environment, and use `/* */` only for a short block note that would be noisier as several line comments.

```logo
# turn once after each side
right 90
```

Keep comments close to the idea they explain. Prefer why-comments over comments that merely repeat the command.

```logo
# 72 degrees closes a five-sided polygon
right 72
```

Linter check: `ol-style-comment-style` suggests `#` for ordinary line comments and warns when comments restate code without adding learner value.

## Keep assignment and comparison visually distinct

Use `=` only to assign to a place. Use `==` and `!=` to ask a question. `=` is a statement on its own, never an operator inside an expression, so a condition always uses `==`:

```logo
:side_count = 4
if :side_count == 4
  print "square time"
end if
```

Writing `=` where a comparison belongs is a syntax error, not merely a style problem. Because `=` cannot appear inside an expression, the parser never finds a delimited body after the condition below and reports `ol-missing-end`:

```logo
if :side_count = 4        # syntax error: a condition needs ==, not =
  print "square time"
end if
```

The opposite slip still parses: a bare `:side_count == 4` on its own line computes a boolean and discards it, which usually means the learner meant to assign with `=`. Linter check: `ol-style-equality-confusion` flags such a discarded top-level comparison and suggests `=`.

## Anti-patterns

### Hiding the `repeat` behind a shortcut

Do not introduce a shape shortcut before the learner has seen the repeated turtle steps. A command like this is too magical as a first square lesson:

```logo
draw_square 100
```

Show the pattern first, then package it as a procedure.

```logo
repeat 4
  forward 100
  right 90
end repeat

define draw_square :size
  repeat 4
    forward :size
    right 90
  end repeat
end
```

Linter check: `ol-style-hidden-abstraction` warns in early-level teaching examples when a shape helper appears before the repeated construction it represents.

### Undelimited bodies

A control body is always delimited. A header followed by instructions with no `[ ]` block and no `end` is a parse error, even for a single instruction.

```logo
repeat 4
  forward 100
  right 90
```

Wrap the body in a `[ ]` block or close it with `end` instead.

```logo
repeat 4
  forward 100
  right 90
end repeat
```

This is `ol-missing-end`, a parse error rather than a style warning; the fix adds `[ ]` or `end`.

### Deep unlabeled nesting

Nested control can be useful, but too many plain `end` lines make code feel like a maze.

```logo
repeat 4
  if :ready
    repeat 3
      forward 30
      right 120
    end
  end
end
```

Prefer helper procedures or labeled ends.

```logo
define draw_corner_pattern
  repeat 3
    forward 30
    right 120
  end repeat
end define

repeat 4
  if :ready
    draw_corner_pattern
  end if
end repeat
```

Linter check: `ol-style-deep-nesting` suggests extracting a helper and using labels for nested long blocks.

### Magic numbers

A number is magic when the reader cannot tell what it means. Name important numbers, especially sizes, turns, counts, colors, and thresholds.

```logo
forward 37
right 117
```

Prefer named values and a comment when the number teaches geometry.

```logo
:side_length = 37
:outside_turn = 117

# outside turn chosen for a playful spiral
forward :side_length
right :outside_turn
```

Linter check: `ol-style-magic-number` warns on unexplained numeric literals outside small obvious values such as `0`, `1`, `2`, `4`, `90`, `120`, and `360`.

### Useless values in effect blocks

A control block runs for effects and discards any final value. If a value matters, print it, assign it, or return it from a procedure. If a comprehension needs a value, make the last expression intentional.

```logo
repeat 4
  forward 100
  :side_length
end repeat
```

Better:

```logo
repeat 4
  forward :side_length
end repeat
```

Linter check: `ol-style-useless-value` warns when a control block ends with a value-producing expression that will be ignored by the block-result rule.
