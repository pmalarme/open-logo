/**
 * `polygon :sides :size` — the Geometry profile's regular-polygon packaged command
 * (`spec/geometry-module.md:29-73`, issue #338). Shipped verbatim as discoverable OpenLogo
 * `.logo` source, not a hidden primitive: a regular polygon is a loop plus a turn angle
 * (`360 / :sides` degrees per side), guarded by two `ol-user-error` checks (`:sides` must be a
 * whole number of at least `3`).
 */

/** The verbatim packaged-command source for `polygon`, matching `spec/geometry-module.md:42-54`. */
export const POLYGON_SOURCE = `define polygon :sides :size
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
end`;
