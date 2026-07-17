> OpenLogo Specification v0.1.0 — Draft (Status: Normative)

# Geometry Module

Back to the [specification index](README.md).

This document is the normative owner for the Geometry profile. Most of geometry is a derived standard library written in OpenLogo, not a hidden set of opaque primitives; the `grid`, `axes`, and `measure` overlays are the exception — they are renderer-backed primitives specified behaviorally rather than as OpenLogo source. Signatures, kinds, and default arities are the Geometry rows of the [C3 canonical primitive matrix](commands.md). For the derived shapes the teaching order is always: first show the `repeat` construction and the turtle math, then name it as a packaged command.

Geometry examples use the locked OpenLogo surface: variable reads are written as `:name`, assignment uses `=`, equality uses `==`, blocks use `[ ]` or `end`, optional trailing parameters use parenthesized defaults on `define` lines, and word values use closed quotes such as `"polygon"`.

## Profile and source contract

The Geometry profile adds these derived commands and reporters:

| Name | Kind | Signature | Result |
|---|---:|---|---|
| `polygon` | C | `polygon :sides :size` | draws |
| `star` | C | `star :points :size (:step 2)` | draws |
| `circle` | C | `circle :radius (:segments 36)` | draws |
| `arc` | C | `arc :angle :radius` | draws |
| `grid` | C | `grid` | overlay |
| `axes` | C | `axes` | overlay |
| `measure` | C | `measure` | annotation overlay |
| `area` | R | `area :shape` | number |
| `perimeter` | R | `perimeter :shape` | number |

Drawing commands use the current turtle state defined by the turtle model: origin at the canvas center, heading `0` upward, `right` clockwise, `left` counter-clockwise, degrees, and pen-down drawing by default. Unless otherwise stated, geometry commands preserve the current pen state and use ordinary turtle movement. The `area` and `perimeter` reporters read their shape-spec list by index (`:shape[2]`), so they additionally require the **Data** profile's list indexing.

## `polygon :sides :size`

Source first:

```logo
repeat :sides
  forward :size
  right 360 / :sides
end repeat
```

Packaged command:

```logo
define polygon :sides :size
  if :sides < 3
    throw "a polygon needs at least 3 sides"
  end if
  if not (:sides == int :sides)
    throw "a polygon needs a whole number of sides"
  end if
  repeat :sides
    forward :size
    right 360 / :sides
  end repeat
end
```

`polygon` draws a regular polygon with `:sides` equal sides, each of length `:size`. `:sides` MUST be a whole number at least `3`, and `:size` MUST be a number. A `:sides` value below `3`, or one that is not a whole number, is rejected by the guards above with `ol-user-error`; non-numeric inputs raise `ol-type` from the comparison and arithmetic they reach.

The math: a full turn is `360` degrees. A regular polygon splits that turn evenly across all sides, so each exterior turn is `360 / :sides`. For a pentagon:

```logo
print 360 / 5
```

The answer is `72`, so each side is followed by a `right 72` turn. After exactly `:sides` equal moves and equal exterior turns, the turtle returns to its starting position and original heading, subject only to numeric rounding.

Example:

```logo
polygon 5 100
```

Concept taught: regular shapes are loops plus a turn angle, not magic commands.

## `star :points :size (:step 2)`

Source first:

```logo
repeat :points
  forward :size
  right 360 * :step / :points
end repeat
```

Packaged command:

```logo
define star :points :size (:step 2)
  if not (:points == int :points)
    throw "a star needs a whole number of points"
  end if
  if not (:step is strictly between 1 and :points)
    throw "a star step must be a whole number between 2 and one less than the number of points"
  end if
  if not (:step == int :step)
    throw "a star step must be a whole number"
  end if
  repeat :points
    forward :size
    right 360 * :step / :points
  end repeat
end
```

`star` draws the star polygon `{p/k}` where `p` is `:points` and `k` is `:step`. The default `:step` is `2`, which makes the familiar pentagram when `:points` is `5`.

Validation is normative: `:points` and `:step` MUST be numbers, `:points` and `:step` MUST both be whole numbers, and `:step` MUST satisfy `1 < :step < :points`. `:points` SHOULD be at least `5` for the default to teach a recognizable star. A non-numeric input raises `ol-type` from the arithmetic it reaches; a non-integer `:points`, or a non-integer or out-of-range `:step`, is rejected by the `throw`s shown above, which raise `ol-user-error` with a learner-facing message.

The math: instead of walking to the next polygon vertex, a star walks to the vertex `:step` positions away. The exterior turn is therefore:

```logo
360 * :step / :points
```

For a pentagram `{5/2}`:

```logo
print 360 * 2 / 5
```

The answer is `144`, so the turtle draws one side and then turns `right 144`. Repeating that five times draws the five-point star.

Examples:

```logo
star 5 100
(star 7 80 3)
```

The second call supplies the optional trailing `:step`, so it uses the parenthesized call form.

Concept taught: a star is a polygon with a larger skip, so a new shape grows from changing one number in the loop.

## `circle :radius (:segments 36)`

Source first:

```logo
local side
:side = 2 * :radius * sin (180 / :segments)
repeat :segments
  forward :side
  right 360 / :segments
end repeat
```

Packaged command:

```logo
define circle :radius (:segments 36)
  local side
  if :radius <= 0
    throw "a circle needs a positive radius"
  end if
  if :segments < 3
    throw "a circle needs at least 3 segments"
  end if
  if not (:segments == int :segments)
    throw "a circle needs a whole number of segments"
  end if
  :side = 2 * :radius * sin (180 / :segments)
  repeat :segments
    forward :side
    right 360 / :segments
  end repeat
end
```

Normatively, `circle` draws an inscribed regular polygon approximation. The default is a 36-segment regular polygon. Its side length is:

```logo
2 * :radius * sin (180 / 36)
```

and each exterior turn is:

```logo
360 / 36
```

More generally, the side length is `2·r·sin(180/n)` where `r` is `:radius` and `n` is `:segments`. The `sin` reporter uses degrees. `:radius` MUST be a positive number, and `:segments` MUST be a whole number at least `3`. A non-positive `:radius`, a `:segments` value below `3`, or a `:segments` value that is not a whole number is rejected by the guards above with `ol-user-error`; non-numeric inputs raise `ol-type`.

Because this is an approximation, the path is a many-sided polygon whose vertices lie on the mathematical circle. With the default 36 segments, the approximation is close enough for learners while still making the loop visible. After exactly `:segments` moves and turns, the turtle returns to its starting position and original heading, subject only to numeric rounding.

Examples:

```logo
circle 50
(circle 50 72)
```

Concept taught: curves can be built from many tiny straight lines.

## `arc :angle :radius`

Source first:

```logo
local segments
local step_angle
local step_length
:segments = (int (:angle / 5)) + 1
:step_angle = :angle / :segments
:step_length = 2 * :radius * sin (:step_angle / 2)

left :step_angle / 2
repeat :segments
  forward :step_length
  left :step_angle
end repeat
right :step_angle / 2
```

Packaged command:

```logo
define arc :angle :radius
  local segments
  local step_angle
  local step_length
  if :angle < 0
    throw "an arc needs an angle of 0 or more"
  end if
  if :radius <= 0
    throw "an arc needs a positive radius"
  end if
  :segments = (int (:angle / 5)) + 1
  :step_angle = :angle / :segments
  :step_length = 2 * :radius * sin (:step_angle / 2)

  left :step_angle / 2
  repeat :segments
    forward :step_length
    left :step_angle
  end repeat
  right :step_angle / 2
end
```

`arc` draws with the pen in its current state. For a positive `:angle`, the center of the circle is exactly `:radius` units to the turtle's left at the start of the command. The turtle curves left, counter-clockwise around that center, through `:angle` degrees. Its heading rotates left by `:angle`.

If the start position is `[:x :y]` and the start heading is `:h`, the circle center is:

```logo
[(:x - :radius * (cos :h)) (:y + :radius * (sin :h))]
```

After a positive arc of `:angle` degrees, the final heading is `:h - :angle` normalized to `[0 360)`. The final position is the point on that same circle reached by rotating the start radius counter-clockwise by `:angle`. In mathematical notation this is:

```logo
[(:x - :radius * (cos :h) + :radius * (cos (:angle - :h)))
 (:y + :radius * (sin :h) + :radius * (sin (:angle - :h)))]
```

The stepped construction uses small chords. It turns left by half a step, repeats small `forward` and `left` movements, then turns right by half a step so the final heading matches the ideal arc. Implementations MAY use a finer internal step, but MUST preserve the direction, center, final position, and final heading within documented numeric tolerance.

`:angle` MUST be a non-negative number and `:radius` MUST be a positive number. A negative `:angle` or a non-positive `:radius` is rejected by the guards above with `ol-user-error`; non-numeric inputs raise `ol-type`.

Example:

```logo
arc 90 50
```

Concept taught: a curve is a controlled sequence of tiny straight moves and tiny turns.

## `grid`

`grid` creates or refreshes a persistent renderer overlay. It is not turtle drawing and it does not change turtle position, heading, pen, color, or width. The overlay survives `clean`.

Default grid spacing is `20` canvas units. Grid lines are parallel to the canvas axes and pass through every multiple of the spacing. The grid is an educational aid for estimating distance and coordinates.

Packaged command:

```logo
grid
```

Concept taught: coordinate space can be seen without becoming part of the learner's drawing.

## `axes`

`axes` creates or refreshes a persistent renderer overlay for the coordinate axes. It is not turtle drawing and it survives `clean`.

The horizontal axis is the line `y == 0`. The vertical axis is the line `x == 0`. They cross at the origin, which is the turtle's `home` position.

Packaged command:

```logo
axes
```

Concept taught: the origin and axes explain position, heading, and symmetry.

## `measure`

`measure` creates or refreshes an educational annotation overlay. It is not a data reporter. It returns no value and does not change the turtle state.

An implementation MAY annotate segment lengths, turn angles, current position, heading, or radius guides. These annotations are overlays for learning and inspection; they are not part of exported drawing geometry unless an export format explicitly includes overlays.

Packaged command:

```logo
measure
```

Concept taught: visible labels can explain the math without hiding it.

## Shape-spec lists for `area` and `perimeter`

`area` and `perimeter` compute values without drawing. Each takes one shape-spec list. A shape-spec list is a list literal whose first element is a quoted shape-name word followed by numeric arguments.

Supported v0.1 shape specs are:

```logo
["polygon" 5 100]
["circle" 50]
```

The first means a regular polygon with `5` sides of length `100`. The second means a circle with radius `50`. The quoted word is required; `polygon` without quotes would be a procedure call, not a word value.

### `area :shape`

Source sketch:

```logo
define area :shape
  if :shape[1] == "polygon"
    local sides
    local size
    :sides = :shape[2]
    :size = :shape[3]
    if :sides < 3 or not (:sides == int :sides)
      throw "area needs a polygon with a whole number of sides, at least 3"
    end if
    return :sides * (power :size 2) / (4 * tan (180 / :sides))
  end if

  if :shape[1] == "circle"
    local radius
    :radius = :shape[2]
    if :radius <= 0
      throw "area needs a circle with a positive radius"
    end if
    return pi * power :radius 2
  end if

  throw "area knows only the polygon and circle shapes"
end
```

Formulas:

- Regular polygon: `n * s² / (4 * tan (180 / n))`
- Circle: `pi * r²`

Examples:

```logo
print area ["polygon" 5 100]
print area ["circle" 50]
```

### `perimeter :shape`

Source sketch:

```logo
define perimeter :shape
  if :shape[1] == "polygon"
    local sides
    local size
    :sides = :shape[2]
    :size = :shape[3]
    if :sides < 3 or not (:sides == int :sides)
      throw "perimeter needs a polygon with a whole number of sides, at least 3"
    end if
    return :sides * :size
  end if

  if :shape[1] == "circle"
    local radius
    :radius = :shape[2]
    if :radius <= 0
      throw "perimeter needs a circle with a positive radius"
    end if
    return 2 * pi * :radius
  end if

  throw "perimeter knows only the polygon and circle shapes"
end
```

Formulas:

- Regular polygon: `n * s`
- Circle: `2 * pi * r`

Examples:

```logo
print perimeter ["polygon" 5 100]
print perimeter ["circle" 50]
```

For both reporters, an unsupported shape word is rejected by the `throw` in each reporter, raising `ol-user-error` with a learner-facing message; a shape-spec list with missing numeric arguments raises `ol-range` or `ol-type` from the list access and arithmetic it reaches. These reporters MUST NOT move the turtle, draw lines, emit drawing events, or inspect the current turtle state.

## Notes for implementers

The learner-visible source is part of the contract: documentation and teaching tools SHOULD display the OpenLogo definitions before presenting the packaged command names. Renderers SHOULD emit ordinary turtle movement and turn events for `polygon`, `star`, `circle`, and `arc`, and overlay events for `grid`, `axes`, and `measure`, consistent with the execution event stream.
