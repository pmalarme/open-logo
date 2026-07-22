/**
 * `circle :radius (:segments 36)` — the Geometry profile's circle-approximation packaged
 * command (`spec/geometry-module.md:135-193`, issue #338). Draws an inscribed regular
 * polygon of `:segments` sides (default `36`) whose side length is `2 * :radius * sin (180 /
 * :segments)`, teaching that curves are built from many tiny straight lines. Guards reject a
 * non-positive `:radius`, a `:segments` below `3`, and a non-integer `:segments`.
 */

/** The verbatim packaged-command source for `circle`, matching `spec/geometry-module.md:151-167`. */
export const CIRCLE_SOURCE = `define circle :radius (:segments 36)
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
end`;
