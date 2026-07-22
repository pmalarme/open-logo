/**
 * `area :shape` — the Geometry profile's shape-spec area reporter
 * (`spec/geometry-module.md:325-368`, issue #338). Takes a shape-spec list (`["polygon" 5
 * 100]` or `["circle" 50]`) and reports its area without moving the turtle, drawing, or
 * inspecting turtle state (`spec/geometry-module.md:415`). Formulas: a regular polygon is
 * `n * s^2 / (4 * tan (180 / n))`; a circle is `pi * r^2`. An unsupported shape word raises
 * `ol-user-error`.
 */

/** The verbatim packaged-command source for `area`, matching `spec/geometry-module.md:330-355`. */
export const AREA_SOURCE = `define area :shape
  if :shape[1] == "polygon"
    local sides
    local size
    :sides = :shape[2]
    :size = :shape[3]
    if :sides < 3 or not (:sides == int :sides)
      throw "area needs a polygon with a whole number of sides, at least 3"
    end if
    if :size <= 0
      throw "area needs a polygon with a positive side length"
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
end`;
