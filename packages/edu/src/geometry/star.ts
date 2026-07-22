/**
 * `star :points :size (:step 2)` — the Geometry profile's star-polygon packaged command
 * (`spec/geometry-module.md:75-133`, issue #338). A star is a polygon with a larger vertex
 * skip: instead of walking to the next vertex, the turtle walks `:step` vertices away, so the
 * exterior turn becomes `360 * :step / :points`. Three `ol-user-error` guards enforce that
 * `:points` and `:step` are whole numbers and that `1 < :step < :points`.
 */

/** The verbatim packaged-command source for `star`, matching `spec/geometry-module.md:88-103`. */
export const STAR_SOURCE = `define star :points :size (:step 2)
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
end`;
