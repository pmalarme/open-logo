/**
 * Deterministic geometric reasoning for `polygon :sides :size` (`spec/geometry-module.md:29-73`).
 * Computed purely from `:sides` — the same math the stdlib source itself performs
 * (`right 360 / :sides`) — so a caller can reason about a polygon before or after it draws.
 */

import { isMultipleOf360 } from "./degree-math.js";

/** Structured reasoning about a regular polygon's exterior/interior angle and closure. */
export interface PolygonReasoning {
  readonly concept: "polygon-exterior-angle";
  readonly sides: number;
  /** `360 / sides` — the turn after every side (`spec/geometry-module.md:59-65`). */
  readonly exteriorAngle: number;
  /** `180 - exteriorAngle` — the interior angle at each vertex. */
  readonly interiorAngle: number;
  /** `sides * exteriorAngle` — the sum of every exterior turn around the whole shape. */
  readonly turnTotal: number;
  /** Whether `turnTotal` is a whole multiple of `360`, so the turtle returns to its start
   * heading. */
  readonly closes: boolean;
}

/**
 * Reasons about a regular polygon with `sides` equal sides (`spec/geometry-module.md:29-73`).
 * `sides` is assumed already validated (a whole number `>= 3`, per the stdlib's own guards) —
 * this function only computes the geometry, it does not repeat `polygon`'s input validation.
 */
export function reasonAboutPolygon(sides: number): PolygonReasoning {
  const exteriorAngle = 360 / sides;
  const interiorAngle = 180 - exteriorAngle;
  const turnTotal = sides * exteriorAngle;
  return {
    concept: "polygon-exterior-angle",
    sides,
    exteriorAngle,
    interiorAngle,
    turnTotal,
    closes: isMultipleOf360(turnTotal),
  };
}
