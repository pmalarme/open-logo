/**
 * Small, pure degree-arithmetic helpers shared by every shape's geometric reasoning
 * (`spec/geometry-module.md`). Kept separate from the per-shape reasoning modules because every
 * one of them needs the same heading-normalization and turn-reconstruction math, and duplicating
 * it per shape would risk the closure test silently drifting between shapes.
 */

import type { TraceEvent, TurnPayload } from "@openlogo/core";

/** How close a turn total may sit to a multiple of `360` and still count as "closes" — absorbs
 * the floating-point rounding the spec calls out for every derived shape ("subject only to
 * numeric rounding", `spec/geometry-module.md:65,184`). */
const CLOSURE_TOLERANCE_DEGREES = 1e-6;

/** Normalizes `degrees` into `[0, 360)`, matching the turtle heading convention used throughout
 * `spec/rendering.md` and `spec/geometry-module.md` (heading `0` is up, `right` is clockwise). */
export function normalizeDegrees(degrees: number): number {
  // The extra `+ 360` then `% 360` (rather than a single `% 360` with a conditional `+ 360`)
  // also avoids returning a signed `-0` for exact negative multiples of 360 (e.g. `-360`), which
  // would otherwise fail a strict-equality comparison against `0`.
  return ((degrees % 360) + 360) % 360;
}

/** Converts an angle in degrees to radians, for use with `Math.sin`/`Math.cos` — the runtime's
 * own `sin`/`cos`/`tan` reporters take degrees (`spec/geometry-module.md:172-173`). */
export function degreesToRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/**
 * Whether `turnTotal` degrees is a whole multiple of `360` — the closure condition every derived
 * shape shares ("the turtle returns to its starting position and original heading", e.g.
 * `spec/geometry-module.md:65`), within {@link CLOSURE_TOLERANCE_DEGREES} of floating-point
 * rounding. Each shape computes its own `turnTotal` from its own formula; this is only the shared
 * final degree test, not a per-shape closure formula.
 */
export function isMultipleOf360(turnTotal: number): boolean {
  const remainder = normalizeDegrees(turnTotal);
  return (
    remainder < CLOSURE_TOLERANCE_DEGREES ||
    360 - remainder < CLOSURE_TOLERANCE_DEGREES
  );
}

/**
 * Reconstructs the clockwise (`right`) turn amount from a `turn` event's `{from, to}` headings
 * (both already normalized to `[0, 360)` by the runtime), as the smallest non-negative rotation
 * that carries `from` to `to`. This matches every geometry-stdlib shape — `polygon`, `star`, and
 * `circle` only ever turn `right` — and the documented non-closing misconception fixture
 * (`repeat 5 [ forward 100 right 80 ]`), which also only turns `right`. The `{from, to}` payload
 * alone cannot distinguish a `right` turn from an equivalent-looking `left` turn the long way
 * around; this reasoning module only needs the `right`-turn convention every shape it analyzes
 * actually uses.
 */
export function clockwiseTurnDelta(from: number, to: number): number {
  return normalizeDegrees(to - from);
}

/** Sums every `turn` event's reconstructed clockwise delta, in emission order (`seq`). */
export function sumClockwiseTurns(events: readonly TraceEvent[]): number {
  let total = 0;
  for (const event of events) {
    if (event.kind === "turn") {
      const { from, to } = event.payload as TurnPayload;
      total += clockwiseTurnDelta(from, to);
    }
  }
  return total;
}
