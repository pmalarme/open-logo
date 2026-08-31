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
 * The in-progress scene of a fold: the background so far, the items so far, and whether either
 * has actually been touched. Deliberately mutable and never escapes this module — every public
 * entry point below turns it back into an immutable {@link TurtleScene} before returning.
 *
 * `owned` records whether `items` is a buffer this fold allocated (safe to push into) or is still
 * the caller's `readonly` array (which MUST NOT be written through). Copying only on the first
 * append is what lets a fold of *n* events cost one copy instead of *n* — see
 * {@link reduceSceneRange}.
 */
interface SceneFold {
  background: string;
  items: readonly SceneItem[];
  owned: boolean;
  changed: boolean;
}

/**
 * The fold's own items buffer, copying the caller's array on first write and reusing it after.
 * Every mutation below goes through this, so nothing can ever write through a shared array.
 */
function ownedItems(fold: SceneFold): SceneItem[] {
  if (!fold.owned) {
    fold.items = [...fold.items];
    fold.owned = true;
  }
  return fold.items as SceneItem[];
}

/**
 * Applies one trace event to an in-progress fold — **the single definition of what each event
 * kind does to a scene**, shared by {@link reduceTurtleScene} and {@link reduceSceneRange} so a
 * one-event fold and an *n*-event fold can never disagree about a kind.
 *
 * Only the scene-bearing kinds change anything: `draw-segment` appends a segment (captured
 * verbatim from the event payload, so later color/width changes never retroact onto it),
 * `background-change` updates the scene background, `fill` appends a fill, `stamp` appends a
 * stamp, and `clear` — for **either** `"clean"` or `"clear_screen"` mode — removes all drawing
 * items identically (`spec/rendering.md`'s clear-operations table: both modes clear drawing the
 * same way; only turtle state differs between them, which is the sibling state reducer's
 * concern, not this one's). Every other kind (turtle state, control-flow, diagnostic, …) leaves
 * the fold untouched, which is what preserves scene identity for a caller that folds one.
 */
function applySceneEvent(fold: SceneFold, event: TraceEvent): void {
  switch (event.kind) {
    case "draw-segment": {
      const { from, to, color, width } = event.payload as DrawSegmentPayload;
      ownedItems(fold).push({
        kind: "segment",
        segment: { from, to, color, width },
      });
      fold.changed = true;
      return;
    }
    case "background-change": {
      const { color } = event.payload as BackgroundChangePayload;
      fold.background = color;
      fold.changed = true;
      return;
    }
    case "fill": {
      const { color } = event.payload as FillPayload;
      ownedItems(fold).push({ kind: "fill", fill: { color } });
      fold.changed = true;
      return;
    }
    case "stamp": {
      const { position, heading, shape, color } = event.payload as StampPayload;
      ownedItems(fold).push({
        kind: "stamp",
        stamp: { position, heading, shape, color },
      });
      fold.changed = true;
      return;
    }
    case "clear": {
      // `ClearPayload.mode` distinguishes clean/clear_screen for the state reducer only; both
      // modes clear drawing identically here, so the mode itself is irrelevant to the scene.
      // A fresh buffer rather than truncating the caller's array — `owned` may still be false.
      fold.items = [];
      fold.owned = true;
      fold.changed = true;
      return;
    }
    default:
      return;
  }
}

/** Seed a fold from an existing scene, sharing its items until something appends. */
function startFold(scene: TurtleScene): SceneFold {
  return {
    background: scene.background,
    items: scene.items,
    owned: false,
    changed: false,
  };
}

/**
 * Settle a fold back into an immutable scene — returning `scene` itself, by reference, when
 * nothing scene-bearing occurred, so that a caller *can* compare scenes by reference to decide
 * whether a repaint is needed. That is a supported property rather than a satisfied dependency:
 * nothing in `@openlogo/turtle` or `@openlogo/studio` compares scenes by reference today, but
 * `scene.test.mjs` pins the identity directly so a consumer may rely on it.
 */
function finishFold(fold: SceneFold, scene: TurtleScene): TurtleScene {
  return fold.changed
    ? { background: fold.background, items: fold.items }
    : scene;
}

/**
 * Reduces one trace event into the next scene. See {@link applySceneEvent} for what each kind
 * does; every other kind returns `scene` unchanged, by reference.
 */
export function reduceTurtleScene(
  scene: TurtleScene,
  event: TraceEvent,
): TurtleScene {
  const fold = startFold(scene);
  applySceneEvent(fold, event);
  return finishFold(fold, scene);
}

/**
 * Reduces `events[start..end)` into the next scene **in a single fold**, clamping both bounds to
 * the array. Identical in result to calling {@link reduceTurtleScene} once per event in the same
 * order — this is the batching form of exactly that loop, not a different reduction.
 *
 * ## Why this exists (issue #977)
 * Appending immutably costs a full array copy, so folding one event at a time makes an *n*-event
 * range cost Θ(n²): on one machine, replaying a 60 000-iteration program's 300 001 events measured
 * **25.5 s** at `09b6fc11`, against ~150 ms for the interpreter that produced them. The absolute
 * numbers are that machine's; the **growth** is the claim, and it was ~4× per doubling of *n*.
 * Copying **once per range** instead of once per event makes the same fold linear. Nothing about
 * the result changes — same items, same order, same background — only how many intermediate arrays
 * are discarded on the way.
 *
 * Prefer this over a `reduceTurtleScene` loop whenever the number of events is unbounded (a whole
 * stream, a resume prefix, a seek); a genuinely single-event fold should still use the singular
 * form, which this one does not replace.
 */
export function reduceSceneRange(
  scene: TurtleScene,
  events: readonly TraceEvent[],
  start: number,
  end: number,
): TurtleScene {
  const from = Math.max(start, 0);
  // Both bounds clamped into [0, events.length] BEFORE slicing, because `Array.prototype.slice`
  // reads a negative index as an offset from the end: `slice(0, -1)` drops the last element rather
  // than yielding nothing, so an unclamped negative `end` would fold almost the whole stream where
  // this function promises an empty range.
  const to = Math.min(Math.max(end, 0), events.length);
  const fold = startFold(scene);
  for (const event of events.slice(from, to)) {
    applySceneEvent(fold, event);
  }
  return finishFold(fold, scene);
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
  return reduceSceneRange(initial, events, 0, events.length);
}
