/**
 * The turtle-overlay reducer: folds the normative trace/event stream (`@openlogo/core`'s
 * `TraceEvent`/`EventKind` registry) into deterministic, render-agnostic **overlay** state — the
 * Geometry profile's `grid`/`axes`/`measure` renderer-backed primitives
 * (`spec/geometry-module.md:268-308`, `spec/rendering.md:129-139`). This module is overlay-only:
 * per-turtle state (`state.ts`) and the retained drawing scene (`scene.ts`) are separate, sibling
 * reducers so all three can be layered side by side without any of them needing to know about
 * the other's kinds.
 *
 * Deliberately has **no** `"clear"` case: `spec/rendering.md`'s clear-operations table says both
 * `clean` and `clear_screen` leave overlays unchanged ("Renderer overlays are not drawing and
 * persist across `clean`", `spec/rendering.md:78`) — rather than the overlay code special-casing
 * itself into the clear path, the clear event simply isn't one of the kinds this reducer reacts
 * to, so overlay state can never be reset by it.
 *
 * Deterministic in, deterministic out: identical event input always folds to identical overlay
 * state, with no timing, randomness, or rendering concerns here.
 */

import type { OverlayPayload, Point, TraceEvent } from "@openlogo/core";

/** The `grid` overlay's state once enabled: guide-line spacing in world units. */
export interface GridOverlay {
  readonly spacing: number;
}

/** The `measure` overlay's state once enabled: the turtle position/heading snapshot it last
 * annotated (`spec/geometry-module.md:298-300`). */
export interface MeasureOverlay {
  readonly position: Point;
  readonly heading: number;
}

/**
 * The Geometry profile's renderer overlay state: `grid` (`undefined` when never enabled),
 * `axes` (a plain boolean — the axes overlay carries no extra data), and `measure` (`undefined`
 * when never enabled). Each overlay is independently toggled/refreshed by its own primitive
 * (`spec/rendering.md`: "Implementations SHOULD allow overlays to be toggled independently").
 */
export interface OverlayState {
  readonly grid?: GridOverlay;
  readonly axes: boolean;
  readonly measure?: MeasureOverlay;
}

/** The program-start overlay defaults: no overlay is enabled until its primitive is called. */
export const INITIAL_OVERLAY_STATE: OverlayState = Object.freeze({
  axes: false,
});

/**
 * Reduces one trace event into the next overlay state. Only `overlay` events change anything,
 * and each `overlay` event's `payload.overlay` discriminant selects which overlay it
 * creates/refreshes — `grid` sets/updates the grid spacing, `axes` turns the axes overlay on,
 * and `measure` records the latest position/heading snapshot. Every other kind (turtle state,
 * scene, control-flow, diagnostic, `clear`, …) leaves overlay state unchanged — see the module
 * doc comment for why `clear` in particular is deliberately absent here.
 */
export function reduceOverlayState(
  overlay: OverlayState,
  event: TraceEvent,
): OverlayState {
  if (event.kind !== "overlay") {
    return overlay;
  }
  const payload = event.payload as OverlayPayload;
  switch (payload.overlay) {
    case "grid":
      return { ...overlay, grid: { spacing: payload.spacing } };
    case "axes":
      return { ...overlay, axes: true };
    case "measure":
      return {
        ...overlay,
        measure: { position: payload.position, heading: payload.heading },
      };
    default:
      return overlay;
  }
}

/**
 * Folds an ordered list of trace events into the resulting overlay state, starting from
 * `initial` (defaulting to {@link INITIAL_OVERLAY_STATE}). Events MUST already be in increasing
 * `seq` order, per `spec/rendering.md`'s "Execution-event consumption" section — this reducer
 * does not sort or validate ordering, it only folds.
 */
export function reduceOverlayEvents(
  events: readonly TraceEvent[],
  initial: OverlayState = INITIAL_OVERLAY_STATE,
): OverlayState {
  return events.reduce(reduceOverlayState, initial);
}
