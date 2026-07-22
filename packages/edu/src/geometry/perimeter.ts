/**
 * `perimeter :shape` — the Geometry profile's shape-spec perimeter reporter
 * (`spec/geometry-module.md:370-415`, issue #338). Takes a shape-spec list (`["polygon" 5
 * 100]` or `["circle" 50]`) and reports its perimeter without moving the turtle, drawing, or
 * inspecting turtle state (`spec/geometry-module.md:415`). Formulas: a regular polygon is
 * `n * s`; a circle is `2 * pi * r`. An unsupported shape word raises `ol-user-error`.
 */

/** The verbatim packaged-command source for `perimeter`, matching `spec/geometry-module.md:375-400`. */
export const PERIMETER_SOURCE = `define perimeter :shape
  if :shape[1] == "polygon"
    local sides
    local size
    :sides = :shape[2]
    :size = :shape[3]
    if :sides < 3 or not (:sides == int :sides)
      throw "perimeter needs a polygon with a whole number of sides, at least 3"
    end if
    if :size <= 0
      throw "perimeter needs a polygon with a positive side length"
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
end`;
