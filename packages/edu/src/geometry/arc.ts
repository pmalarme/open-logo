/**
 * `arc :angle :radius` — the Geometry profile's stepped-arc packaged command
 * (`spec/geometry-module.md:195-266`, issue #338). Draws a curve as a controlled sequence of
 * tiny straight moves and tiny turns: it splits `:angle` into `(int (:angle / 5)) + 1` steps,
 * turns left by half a step, repeats small `forward`/`left` movements, then turns right by half
 * a step so the final heading matches the ideal arc. Guards reject a negative `:angle` and a
 * non-positive `:radius`.
 */

/** The verbatim packaged-command source for `arc`, matching `spec/geometry-module.md:218-238`. */
export const ARC_SOURCE = `define arc :angle :radius
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
end`;
