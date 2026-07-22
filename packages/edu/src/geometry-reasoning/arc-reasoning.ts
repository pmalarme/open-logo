/**
 * Deterministic geometric reasoning for `arc :angle :radius` (`spec/geometry-module.md:195-266`).
 * Unlike `polygon`/`star`/`circle`, an `arc` never closes a shape — its geometric facts are the
 * circle center, the final position, and the resulting heading after a curved turn, computed
 * directly from the spec's closed-form formulas (`spec/geometry-module.md:243-254`) rather than
 * folded from the stepped trace events the stdlib source happens to use internally.
 */

import type { Point } from "@openlogo/core";
import { degreesToRadians, normalizeDegrees } from "./degree-math.js";

/** Structured reasoning about an arc's start/center/final position and resulting heading. */
export interface ArcReasoning {
  readonly concept: "arc-heading-position";
  readonly angle: number;
  readonly radius: number;
  readonly startPosition: Point;
  readonly startHeading: number;
  /** The circle center, exactly `radius` units to the turtle's left at the start of the arc
   * (`spec/geometry-module.md:243-247`): `[x - radius * cos(h), y + radius * sin(h)]`. */
  readonly center: Point;
  /** The point on the arc's circle reached by rotating the start radius counter-clockwise by
   * `angle` degrees (`spec/geometry-module.md:249-254`). */
  readonly finalPosition: Point;
  /** `startHeading - angle`, normalized to `[0, 360)` (`spec/geometry-module.md:249`: "the final
   * heading is `:h - :angle` normalized to `[0 360)`"). */
  readonly finalHeading: number;
}

/**
 * Reasons about `arc :angle :radius` starting at `startPosition`/`startHeading`
 * (`spec/geometry-module.md:195-266`). `angle` and `radius` are assumed already validated (a
 * non-negative angle, a positive radius, per the stdlib's own guards) — this function only
 * computes the closed-form geometry, not the stepped-chord approximation the stdlib source uses
 * to draw it.
 */
export function reasonAboutArc(
  angle: number,
  radius: number,
  startPosition: Point,
  startHeading: number,
): ArcReasoning {
  const [x, y] = startPosition;
  const headingRadians = degreesToRadians(startHeading);
  const sweepRadians = degreesToRadians(angle - startHeading);
  const center: Point = [
    x - radius * Math.cos(headingRadians),
    y + radius * Math.sin(headingRadians),
  ];
  const finalPosition: Point = [
    x - radius * Math.cos(headingRadians) + radius * Math.cos(sweepRadians),
    y + radius * Math.sin(headingRadians) + radius * Math.sin(sweepRadians),
  ];
  return {
    concept: "arc-heading-position",
    angle,
    radius,
    startPosition,
    startHeading,
    center,
    finalPosition,
    finalHeading: normalizeDegrees(startHeading - angle),
  };
}
