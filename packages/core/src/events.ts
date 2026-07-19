/**
 * The trace/event contract — the one normative, deterministic, headless event stream that
 * execution produces and that rendering, animation, stepping, `why`, `debug`, and playback
 * all consume. The envelope and `kind` registry are owned by `@openlogo/core`
 * ([`spec/execution-model.md`](../../../spec/execution-model.md)); `@openlogo/turtle`
 * reduces the stream into frames but does not own the registry. No timing or frames live in
 * the stream itself.
 */

import type { SourceSpan } from "./spans.js";
import type { OLValue } from "./values.js";

/** A 2-D point `[x, y]` in turtle space. */
export type Point = readonly [x: number, y: number];

/** Identity of a turtle/sprite; present only on turtle-specific events. */
export type TurtleId = number;

/**
 * The normative event `kind` registry from `spec/execution-model.md`. Start events precede
 * their effect; effect events follow the state change they describe. Kept as data
 * (`as const`) so {@link EventKind} derives from it.
 */
export const OL_EVENT_KINDS = [
  // Start events (emitted before their effect).
  "instruction",
  "procedure-enter",
  // Effect events (emitted immediately after the change they describe).
  "move",
  "turn",
  "pen-change",
  "width-change",
  "color-change",
  "background-change",
  "draw-segment",
  "fill",
  "stamp",
  "shape-change",
  "visibility-change",
  "clear",
  "overlay",
  "procedure-exit",
  "return",
  "print",
  "sound",
  "spawn-turtle",
  "primitive",
  "error",
] as const;

/** One registered trace-event kind. */
export type EventKind = (typeof OL_EVENT_KINDS)[number];

/** Payload for a `move` event. */
export interface MovePayload {
  readonly from: Point;
  readonly to: Point;
  readonly heading: number;
}

/** Payload for a `draw-segment` event. */
export interface DrawSegmentPayload {
  readonly from: Point;
  readonly to: Point;
  readonly color: string;
  readonly width: number;
}

/** Payload for a `turn` event (headings in degrees). */
export interface TurnPayload {
  readonly from: number;
  readonly to: number;
}

/** Payload for a `clear` event. */
export interface ClearPayload {
  readonly mode: "clear_screen" | "clean";
}

/** Whether the pen is up (not drawing) or down (drawing), per `spec/rendering.md`. */
export type PenState = "up" | "down";

/**
 * Payload for a `pen-change` event: the pen state before and after `pen_up`/`pen_down`
 * (`spec/rendering.md`'s "Line segments" section — a segment is drawn only while the pen is
 * down). Mirrors `turn`'s `{from, to}` shape.
 */
export interface PenChangePayload {
  readonly from: PenState;
  readonly to: PenState;
}

/**
 * Payload for a `width-change` event: the pen width before and after `set_width`, in the same
 * world units used for rendering (`spec/rendering.md`'s "Width" section). Mirrors `turn`'s
 * `{from, to}` shape.
 */
export interface WidthChangePayload {
  readonly from: number;
  readonly to: number;
}

/**
 * Payload for a `color-change` event: the pen color before and after `set_color`, each an
 * sRGB-normalizable color value as accepted by `set_color` (`spec/rendering.md`'s "Color"
 * section). Mirrors `turn`'s `{from, to}` shape.
 */
export interface ColorChangePayload {
  readonly from: string;
  readonly to: string;
}

/**
 * Payload for a `background-change` event: the new scene background color set by
 * `set_background` (`spec/rendering.md`'s "Background" section). The background is a scene
 * property, not turtle state, so there is no prior-value pairing to report here.
 */
export interface BackgroundChangePayload {
  readonly color: string;
}

/**
 * Payload for a `shape-change` event: the turtle avatar's shape word before and after
 * `set_shape` (`spec/rendering.md`'s "Turtle avatar and shapes" section). Mirrors `turn`'s
 * `{from, to}` shape.
 */
export interface ShapeChangePayload {
  readonly from: string;
  readonly to: string;
}

/**
 * Payload for a `visibility-change` event: the turtle avatar's visibility before and after
 * `show_turtle`/`hide_turtle` (`spec/rendering.md`'s "Turtle avatar and shapes" section).
 * Mirrors `turn`'s `{from, to}` shape.
 */
export interface VisibilityChangePayload {
  readonly from: boolean;
  readonly to: boolean;
}

/**
 * Payload for a `fill` event: the color used to fill the currently enclosed region of the
 * active turtle's drawn path (`spec/rendering.md`'s "Fill" section — the current pen color
 * unless a vendor extension exposes a separate fill color).
 */
export interface FillPayload {
  readonly color: string;
}

/**
 * Payload for a `stamp` event: the position, heading, and shape word of the turtle avatar
 * stamped into the retained scene (`spec/rendering.md`'s "Turtle avatar and shapes" section).
 */
export interface StampPayload {
  readonly position: Point;
  readonly heading: number;
  readonly shape: string;
}

/**
 * Payload for a `print` event: the evaluated {@link OLValue}s, in argument order — one element
 * for the single-value `print value` form, two or more for the parenthesized variadic
 * `(print a b …)` form (`spec/commands.md:142-158`). Values are carried raw, not pre-formatted
 * text, matching every other effect payload here (e.g. `move`'s raw coordinates): a consumer
 * renders learner-visible text from them via the shared canonical-printed-form rule
 * (`@openlogo/runtime`'s `printedForm`, `spec/execution-model.md:19`).
 */
export interface PrintPayload {
  readonly values: readonly OLValue[];
}

/**
 * Payload for a `procedure-enter` event: the callee's canonical name and its evaluated argument
 * values, in parameter order — required arguments as supplied, trailing optional ones with their
 * default applied when the caller omitted them (`spec/execution-model.md:606-648`'s worked
 * recursive-call trace, e.g. `{name:"countdown", args:[2]}`).
 */
export interface ProcedureEnterPayload {
  readonly name: string;
  readonly args: readonly OLValue[];
}

/**
 * Payload for a `procedure-exit` event: the callee's canonical name and its result
 * (`spec/execution-model.md:606-648`, e.g. `{name:"countdown", result:0}`). `result` is `null`
 * when the invocation is a command — it finished (or `stop`ped) without reaching `return`
 * (`spec/execution-model.md:346-349`) — rather than `0`/`false`/an empty list, which are
 * themselves ordinary result values.
 */
export interface ProcedureExitPayload {
  readonly name: string;
  readonly result: OLValue | null;
}

/**
 * Payload for a `return` event: the value supplied to `return`/`output`/`op`
 * (`spec/execution-model.md:606-648`, e.g. `{value:0}`). Emitted only when a procedure actually
 * reaches a `return`; a command invocation (falls through, or `stop`s) never emits one.
 */
export interface ReturnPayload {
  readonly value: OLValue;
}

/**
 * The trace-event envelope. `payload` is kind-specific typed data — the payload interfaces
 * above cover every Turtle & Rendering kind (`move`, `turn`, `pen-change`, `width-change`,
 * `color-change`, `background-change`, `draw-segment`, `fill`, `stamp`, `shape-change`,
 * `visibility-change`, `clear`) plus `print`/`procedure-enter`/`procedure-exit`/`return`; other
 * kinds (e.g. `overlay`, `sound`, `spawn-turtle`, `primitive`, `error`) refine their payload with
 * their feature slice.
 */
export interface TraceEvent<P = unknown> {
  /** Monotonic sequence number, ordering the stream. */
  readonly seq: number;
  /** One registered event kind. */
  readonly kind: EventKind;
  /** The source range that caused the event. */
  readonly source_span: SourceSpan;
  /** Turtle identity; present only when the event is turtle-specific. */
  readonly turtle_id?: TurtleId;
  /** Kind-specific typed data. */
  readonly payload: P;
}

/** Type guard: is `value` a registered trace-event kind? */
export function isEventKind(value: string): value is EventKind {
  return (OL_EVENT_KINDS as readonly string[]).includes(value);
}
