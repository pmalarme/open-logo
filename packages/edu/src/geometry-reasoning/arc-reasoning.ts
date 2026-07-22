/**
 * Deterministic geometric reasoning for `arc :angle :radius` (`spec/geometry-module.md:195-266`).
 * Unlike `polygon`/`star`/`circle`, an `arc` never closes a shape — its geometric fact is the
 * resulting heading after a curved turn, computed directly from the spec's formula
 * (`spec/geometry-module.md:249`) rather than folded from the stepped trace events the stdlib
 * source happens to use internally.
 */

import { normalizeDegrees } from "./degree-math.js";

/** Structured reasoning about an arc's resulting heading. */
export interface ArcReasoning {
  readonly concept: "arc-heading-position";
  readonly angle: number;
  readonly radius: number;
  readonly startHeading: number;
  /** `startHeading - angle`, normalized to `[0, 360)` (`spec/geometry-module.md:249`: "the final
   * heading is `:h - :angle` normalized to `[0 360)`"). */
  readonly finalHeading: number;
}

/**
 * Reasons about the heading change of `arc :angle :radius` starting at `startHeading`
 * (`spec/geometry-module.md:195-266`). `angle` and `radius` are assumed already validated (a
 * non-negative angle, a positive radius, per the stdlib's own guards) — this function only
 * computes the resulting heading.
 */
export function reasonAboutArc(
  angle: number,
  radius: number,
  startHeading: number,
): ArcReasoning {
  return {
    concept: "arc-heading-position",
    angle,
    radius,
    startHeading,
    finalHeading: normalizeDegrees(startHeading - angle),
  };
}
