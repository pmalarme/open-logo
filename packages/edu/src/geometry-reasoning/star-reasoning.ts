/**
 * Deterministic geometric reasoning for `star :points :size (:step 2)`
 * (`spec/geometry-module.md:75-133`). A star's exterior turn skips `:step` vertices instead of
 * one, so its turn total — and therefore its closure condition — is a genuinely different
 * computation from a plain polygon's, even though both end up testing "is this a multiple of
 * `360`?" at the end.
 */

import { isMultipleOf360 } from "./degree-math.js";

/** Structured reasoning about a star polygon's skip-turn and closure. */
export interface StarReasoning {
  readonly concept: "star-skip-turn";
  readonly points: number;
  readonly step: number;
  /** `360 * step / points` — the turn after every point (`spec/geometry-module.md:110-122`). */
  readonly exteriorTurn: number;
  /** `points * exteriorTurn` — the sum of every exterior turn around the whole star. This is
   * `360 * step`, a distinct quantity from a polygon's `turnTotal` (which is always exactly
   * `360`): a star only closes when `step` itself makes `360 * step` land back on a multiple of
   * `360`, which every whole `step` does, but the *reason* is different from a polygon's. */
  readonly turnTotal: number;
  /** Whether `turnTotal` is a whole multiple of `360`, so the turtle returns to its start
   * heading. */
  readonly closes: boolean;
}

/**
 * Reasons about a star polygon `{points/step}` (`spec/geometry-module.md:75-133`). `points` and
 * `step` are assumed already validated (whole numbers, `1 < step < points`, per the stdlib's own
 * guards) — this function only computes the geometry.
 */
export function reasonAboutStar(points: number, step = 2): StarReasoning {
  const exteriorTurn = (360 * step) / points;
  const turnTotal = points * exteriorTurn;
  return {
    concept: "star-skip-turn",
    points,
    step,
    exteriorTurn,
    turnTotal,
    closes: isMultipleOf360(turnTotal),
  };
}
