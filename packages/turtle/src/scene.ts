/**
 * The turtle-scene reducer: folds the normative trace/event stream (`@openlogo/core`'s
 * `TraceEvent`/`EventKind` registry) into the deterministic, render-agnostic **retained drawing
 * scene** — background color plus the ordered path segments, fills, and stamps produced by
 * program execution (`spec/rendering.md`'s "Drawing model" section: "Repainting a target MUST
 * be possible from retained scene data without re-running the program"). This module is
 * scene-only: per-turtle state (position, heading, pen, color, width, shape, visibility) is a
 * separate, sibling reducer (`state.ts`) so the two can be layered side by side without either
 * needing to know about the other's kinds.
 *
 * Deterministic in, deterministic out: identical event input always folds to identical scene,
 * with no timing, randomness, or rendering concerns here.
 */

import type {
  BackgroundChangePayload,
  DrawSegmentPayload,
  FillPayload,
  Point,
  StampPayload,
  TraceEvent,
} from "@openlogo/core";

/**
 * One retained path segment produced by a pen-down move. Captures the color and width in
 * effect when the segment was drawn (`spec/rendering.md`: "Each segment captures the pen color
 * and pen width active when the segment is created; later `set_color` or `set_width` calls do
 * not alter existing segments") — the values come straight from the `draw-segment` event
 * payload, never from live turtle state, so segments are immutable once added.
 */
export interface SceneSegment {
  readonly from: Point;
  readonly to: Point;
  readonly color: string;
  readonly width: number;
}

/** One retained fill, capturing the fill color used (`spec/rendering.md`'s "Fill" section). */
export interface SceneFill {
  readonly color: string;
}

/**
 * One retained stamp: the position, heading, shape, and pen color of the turtle avatar at the
 * moment `stamp` was invoked (`spec/rendering.md`'s "Turtle avatar and shapes" section).
 */
export interface SceneStamp {
  readonly position: Point;
  readonly heading: number;
  readonly shape: string;
  readonly color: string;
}

/**
 * One item in the retained scene, in the order it was added. A tagged union keeps segments,
 * fills, and stamps distinguishable while preserving a single ordered draw sequence, matching
 * `spec/rendering.md`'s "logical draw order is background first, then drawing items in
 * execution order".
 */
export type SceneItem =
  | { readonly kind: "segment"; readonly segment: SceneSegment }
  | { readonly kind: "fill"; readonly fill: SceneFill }
  | { readonly kind: "stamp"; readonly stamp: SceneStamp };

/**
 * The retained drawing scene: a scene-level background plus the ordered drawing items
 * (segments/fills/stamps). Deliberately excludes per-turtle state and overlays/turtle-avatar
 * presentation — those are the concern of the state reducer and later Canvas-epic slices.
 */
export interface TurtleScene {
  /** Scene background color, set by `set_background`; not a per-turtle or per-segment value. */
  readonly background: string;
  /** Drawing items (segments, fills, stamps) in execution order. */
  readonly items: readonly SceneItem[];
}

/**
 * The program-start scene defaults (`spec/rendering.md`: "The initial background is `"white"`")
 * with no drawing items yet.
 */
export const INITIAL_TURTLE_SCENE: TurtleScene = Object.freeze({
  background: "white",
  items: [] as readonly SceneItem[],
});

/**
 * Reduces one trace event into the next scene. Only the scene-bearing kinds change anything:
 * `draw-segment` appends a segment (captured verbatim from the event payload, so later
 * color/width changes never retroact onto it), `background-change` updates the scene
 * background, `fill` appends a fill, `stamp` appends a stamp, and `clear` — for **either**
 * `"clean"` or `"clear_screen"` mode — removes all drawing items identically
 * (`spec/rendering.md`'s clear-operations table: both modes clear drawing the same way; only
 * turtle state differs between them, which is the sibling state reducer's concern, not this
 * one's). Every other kind (turtle state, control-flow, diagnostic, …) leaves the scene
 * unchanged.
 */
export function reduceTurtleScene(
  scene: TurtleScene,
  event: TraceEvent,
): TurtleScene {
  switch (event.kind) {
    case "draw-segment": {
      const { from, to, color, width } = event.payload as DrawSegmentPayload;
      const segment: SceneItem = {
        kind: "segment",
        segment: { from, to, color, width },
      };
      return { ...scene, items: [...scene.items, segment] };
    }
    case "background-change": {
      const { color } = event.payload as BackgroundChangePayload;
      return { ...scene, background: color };
    }
    case "fill": {
      const { color } = event.payload as FillPayload;
      const fill: SceneItem = { kind: "fill", fill: { color } };
      return { ...scene, items: [...scene.items, fill] };
    }
    case "stamp": {
      const { position, heading, shape, color } = event.payload as StampPayload;
      const stamp: SceneItem = {
        kind: "stamp",
        stamp: { position, heading, shape, color },
      };
      return { ...scene, items: [...scene.items, stamp] };
    }
    case "clear": {
      // `ClearPayload.mode` distinguishes clean/clear_screen for the state reducer only; both
      // modes clear drawing identically here, so the mode itself is irrelevant to the scene.
      return { ...scene, items: [] };
    }
    default:
      return scene;
  }
}

/**
 * Folds an ordered list of trace events into the resulting scene, starting from `initial`
 * (defaulting to {@link INITIAL_TURTLE_SCENE}). Events MUST already be in increasing `seq`
 * order, per `spec/rendering.md`'s "Execution-event consumption" section — this reducer does
 * not sort or validate ordering, it only folds.
 */
export function reduceSceneEvents(
  events: readonly TraceEvent[],
  initial: TurtleScene = INITIAL_TURTLE_SCENE,
): TurtleScene {
  return events.reduce(reduceTurtleScene, initial);
}
