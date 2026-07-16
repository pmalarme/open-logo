> OpenLogo Specification v0.1.0 — Draft (Status: Informative)

# OpenLogo examples

[Back to the specification index](../README.md)

These runnable `.logo` files form a learning journey for OpenLogo (OL). Each step adds one idea, shows code, explains what happens, and names the reason the idea matters.

## 01 — Movement

File: [`01-movement.logo`](01-movement.logo)

```logo
forward 80
right 90
forward 80
```

The turtle moves and turns with the pen down. Why: learners see that a drawing is a history of small actions, not a hidden shape command.

## 02 — Repetition

File: [`02-repetition.logo`](02-repetition.logo)

```logo
repeat 4 [
  forward 80
  right 90
]
```

`repeat` runs an instruction block for its effects. Why: the square becomes a pattern the learner can vary.

## 03 — Variables

File: [`03-variables.logo`](03-variables.logo)

```logo
:side = 50
set gap to 20
forward :side
```

`:name` reads a variable, `:name = value` writes one, and `set name to value` is the worded assignment form. Why: names let learners change one idea and see many effects.

## 04 — Conditions

File: [`04-conditions.logo`](04-conditions.logo)

```logo
if :sides == 4 [
  print "square"
] else [
  print "not square"
]
```

Conditions require booleans, and equality is `==`, not `=`. Why: programs can make visible choices.

## 05 — Procedures

File: [`05-procedures.logo`](05-procedures.logo)

```logo
define double :n
  return :n * 2
end define
```

`define … end` packages a reusable idea, and `return` reports a value. Why: learners name their discoveries.

## 06 — Geometry

File: [`06-geometry.logo`](06-geometry.logo)

```logo
define polygon :sides :size
  repeat :sides [
    forward :size
    right 360 / :sides
  ]
end define
```

The file builds `polygon` from `repeat` before calling it. Why: geometry is discoverable source, not magic.

## 07 — Data structures

File: [`07-data-structures.logo`](07-data-structures.logo)

```logo
struct point [ x y ]
:path = list
add (point 0 0) to :path
print :path[1].x
```

Lists, dicts, and records share the same access idea: `:thing[index]` and `:thing.field`. Why: one mental model scales from simple paths to nested data.

## 08 — Algorithms

File: [`08-algorithms.logo`](08-algorithms.logo)

```logo
:squares = map num in :nums [ :num * :num ]
:total = reduce sum num in :nums from 0 [ :sum + :num ]
```

Recursion solves a problem by calling itself; comprehensions transform collections with expression bodies. Why: learners can describe patterns over data without lambdas.

## 09 — Sprites

File: [`09-sprites.logo`](09-sprites.logo)

```logo
:leader = new_turtle
ask :leader [
  set_color "blue"
  forward 60
]
```

Sprites add more turtles and addressed blocks. Why: learners can model teams, agents, and simulations.

## 10 — Game

File: [`10-game.logo`](10-game.logo)

```logo
on_key "left" [ left :turn_size ]
on_click [ :score = :score + 1 ]
```

Events connect keyboard, mouse, and time to turtle actions. Why: learners see programs respond to people.

## 11 — Music

File: [`11-music.logo`](11-music.logo)

```logo
set_tempo 120
for pitch in :melody [
  note :pitch 1
]
```

Sound commands make a list audible. Why: the same sequence idea used for drawing can become rhythm and melody.

## 12 — Fractal

File: [`12-fractal.logo`](12-fractal.logo)

```logo
define branch :length :depth
  if :depth == 0 [
    return :length
  ] else [
    forward :length
  ]
end define
```

The showcase combines recursion with `map`, `filter`, and `reduce`. Why: a small rule can create a rich structure.
