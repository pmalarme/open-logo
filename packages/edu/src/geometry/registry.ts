/**
 * The Geometry standard-library registry (`spec/geometry-module.md`, issue #338): the four
 * drawing commands (`polygon`, `star`, `circle`, `arc`) and two shape-spec reporters (`area`,
 * `perimeter`), shipped as plain OpenLogo `.logo` source strings rather than opaque
 * primitives (team agreement §6). Each command resolves as an ordinary user procedure via
 * `define` through normal procedure lookup — none of these is a registered primitive, so
 * nothing here touches the parser's arity tables or the runtime's dispatch surface.
 *
 * This module ships a name -> source-string map (plus an ordered list) rather than wiring the
 * source into `execute()` directly, because there is no stdlib/prelude injection hook yet — a
 * caller (a lesson, a fixture, a future M6 Modules auto-import) must textually include the
 * source it needs before calling the procedure. Shipping it as a registry now, rather than
 * hand-inlining strings at each call site, means the eventual M6 Modules loader can wrap this
 * same map with zero rework.
 */

import { AREA_SOURCE } from "./area.js";
import { ARC_SOURCE } from "./arc.js";
import { CIRCLE_SOURCE } from "./circle.js";
import { PERIMETER_SOURCE } from "./perimeter.js";
import { POLYGON_SOURCE } from "./polygon.js";
import { STAR_SOURCE } from "./star.js";

export { AREA_SOURCE } from "./area.js";
export { ARC_SOURCE } from "./arc.js";
export { CIRCLE_SOURCE } from "./circle.js";
export { PERIMETER_SOURCE } from "./perimeter.js";
export { POLYGON_SOURCE } from "./polygon.js";
export { STAR_SOURCE } from "./star.js";

/** One Geometry stdlib entry's stable name, matching `spec/geometry-module.md`'s C3 row. */
export const GEOMETRY_STDLIB_NAMES = [
  "polygon",
  "star",
  "circle",
  "arc",
  "area",
  "perimeter",
] as const;

/** A registered Geometry stdlib entry's name. */
export type GeometryStdlibName = (typeof GEOMETRY_STDLIB_NAMES)[number];

/**
 * The Geometry standard library: name -> verbatim `.logo` source string, in the declaration
 * order of `spec/geometry-module.md`. Every value is the exact packaged-command text from the
 * spec, including its `ol-user-error` guard clauses and formulas.
 */
export const GEOMETRY_STDLIB: Readonly<Record<GeometryStdlibName, string>> = {
  polygon: POLYGON_SOURCE,
  star: STAR_SOURCE,
  circle: CIRCLE_SOURCE,
  arc: ARC_SOURCE,
  area: AREA_SOURCE,
  perimeter: PERIMETER_SOURCE,
};

/** Reports whether `value` is a registered {@link GeometryStdlibName}. */
export function isGeometryStdlibName(
  value: unknown,
): value is GeometryStdlibName {
  return (
    typeof value === "string" &&
    (GEOMETRY_STDLIB_NAMES as readonly string[]).includes(value)
  );
}
