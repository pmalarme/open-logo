/**
 * Deterministic geometric reasoning for `circle :radius (:segments 36)`
 * (`spec/geometry-module.md:135-193`). A `circle` is normatively an *inscribed regular polygon
 * approximation* — never a "real" curve — so this reasoning reports it as such rather than
 * claiming exact circle geometry.
 */

import { degreesToRadians, isMultipleOf360 } from "./degree-math.js";

/** Structured reasoning about the inscribed-polygon approximation `circle` draws. */
export interface CircleReasoning {
  readonly concept: "circle-inscribed-polygon-approximation";
  readonly radius: number;
  readonly segments: number;
  /** `360 / segments` — the turn after every segment (`spec/geometry-module.md:176-180`). */
  readonly exteriorTurnPerSegment: number;
  /** `2 * radius * sin(180 / segments)` — the inscribed-polygon side length
   * (`spec/geometry-module.md:170-174`), in degrees per the runtime's `sin` reporter. */
  readonly sideLength: number;
  /** `segments * exteriorTurnPerSegment` — the sum of every exterior turn around the whole
   * shape. */
  readonly turnTotal: number;
  /** Whether `turnTotal` is a whole multiple of `360`, so the turtle returns to its start
   * heading. */
  readonly closes: boolean;
  /** Always `true`: a reminder that this is an inscribed-polygon approximation of a circle, not
   * a mathematically exact curve (`spec/geometry-module.md:170,184`). */
  readonly isApproximation: true;
}

/**
 * Reasons about the inscribed regular polygon `circle` draws (`spec/geometry-module.md:135-193`).
 * `radius` and `segments` are assumed already validated (a positive radius, a whole number of
 * segments `>= 3`, per the stdlib's own guards) — this function only computes the geometry.
 */
export function reasonAboutCircle(
  radius: number,
  segments = 36,
): CircleReasoning {
  const exteriorTurnPerSegment = 360 / segments;
  const sideLength = 2 * radius * Math.sin(degreesToRadians(180 / segments));
  const turnTotal = segments * exteriorTurnPerSegment;
  return {
    concept: "circle-inscribed-polygon-approximation",
    radius,
    segments,
    exteriorTurnPerSegment,
    sideLength,
    turnTotal,
    closes: isMultipleOf360(turnTotal),
    isApproximation: true,
  };
}
