/**
 * The turtle-state reducer: folds the normative trace/event stream (`@openlogo/core`'s
 * `TraceEvent`/`EventKind` registry) into deterministic, render-agnostic turtle **state** —
 * position, heading, pen, color, width, shape, and visibility (`spec/rendering.md`'s turtle
 * state model). This module is state-only: the retained drawing **scene** (background +
 * accumulated segments/fills/stamps) is a separate, sibling reducer so the two can be layered
 * side by side without coupling.
 *
 * Deterministic in, deterministic out: identical event input always folds to identical state,
 * with no timing, randomness, or rendering concerns here.
 */

import type {
  ColorChangePayload,
  DrawSegmentPayload,
  MovePayload,
  PenChangePayload,
  Point,
  ShapeChangePayload,
  TraceEvent,
  TurnPayload,
  VisibilityChangePayload,
  WidthChangePayload,
} from "@openlogo/core";

/**
 * Turtle state: `{ position, heading, penDown, color, width, shape, visible }`
 * (`spec/rendering.md`'s "Coordinate mapping and viewport" + "Turtle avatar and shapes"
 * sections). Deliberately excludes the retained scene and background — those are scene
 * properties, not per-turtle state.
 */
export interface TurtleState {
  /** World position `[x, y]`; origin `(0,0)` is the canvas center. */
  readonly position: Point;
  /** Heading in degrees, normalized into `[0,360)`; `0` points up, `right` turns clockwise. */
  readonly heading: number;
  /** Whether the pen is down (drawing) or up (moving without drawing). */
  readonly penDown: boolean;
  /** Pen color, as accepted by `set_color`. */
  readonly color: string;
  /** Pen width in world units. */
  readonly width: number;
  /** Avatar shape word, as accepted by `set_shape`. */
  readonly shape: string;
  /** Whether the turtle avatar is visible. */
  readonly visible: boolean;
}

/**
 * The program-start turtle defaults (`spec/rendering.md`: "At program start, the turtle is at
 * `(0,0)`, heading `0`, pen down, color `"black"`, width `1`, visible"). `"turtle"` is the
 * portable default shape word `spec/rendering.md` lists first among the supported set.
 */
export const INITIAL_TURTLE_STATE: TurtleState = Object.freeze({
  position: [0, 0] as Point,
  heading: 0,
  penDown: true,
  color: "black",
  width: 1,
  shape: "turtle",
  visible: true,
});

/**
 * Reduces one trace event into the next turtle state. Only the state-bearing kinds change
 * anything: `move`/`draw-segment` update position (and `move` also updates heading), `turn`
 * updates heading, `pen-change` updates pen down/up, `color-change`/`width-change`/
 * `shape-change`/`visibility-change` update the matching field. Every other kind (scene,
 * control-flow, diagnostic, …) leaves state unchanged, so a sibling scene reducer can fold the
 * same stream alongside this one without either needing to know about the other's kinds.
 */
export function reduceTurtleState(
  state: TurtleState,
  event: TraceEvent,
): TurtleState {
  switch (event.kind) {
    case "move": {
      const { to, heading } = event.payload as MovePayload;
      return { ...state, position: to, heading };
    }
    case "draw-segment": {
      const { to } = event.payload as DrawSegmentPayload;
      return { ...state, position: to };
    }
    case "turn": {
      const { to } = event.payload as TurnPayload;
      return { ...state, heading: to };
    }
    case "pen-change": {
      const { to } = event.payload as PenChangePayload;
      return { ...state, penDown: to === "down" };
    }
    case "color-change": {
      const { to } = event.payload as ColorChangePayload;
      return { ...state, color: to };
    }
    case "width-change": {
      const { to } = event.payload as WidthChangePayload;
      return { ...state, width: to };
    }
    case "shape-change": {
      const { to } = event.payload as ShapeChangePayload;
      return { ...state, shape: to };
    }
    case "visibility-change": {
      const { to } = event.payload as VisibilityChangePayload;
      return { ...state, visible: to };
    }
    default:
      return state;
  }
}

/**
 * Folds an ordered list of trace events into the resulting turtle state, starting from
 * `initial` (defaulting to {@link INITIAL_TURTLE_STATE}). Events MUST already be in increasing
 * `seq` order, per `spec/rendering.md`'s "Execution-event consumption" section — this reducer
 * does not sort or validate ordering, it only folds.
 */
export function reduceTurtleEvents(
  events: readonly TraceEvent[],
  initial: TurtleState = INITIAL_TURTLE_STATE,
): TurtleState {
  return events.reduce(reduceTurtleState, initial);
}
