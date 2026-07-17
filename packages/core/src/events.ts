/**
 * The trace/event contract — the one normative, deterministic, headless event stream that
 * execution produces and that rendering, animation, stepping, `why`, `debug`, and playback
 * all consume. The envelope and `kind` registry are owned by `@openlogo/core`
 * ([`spec/execution-model.md`](../../../spec/execution-model.md)); `@openlogo/turtle`
 * reduces the stream into frames but does not own the registry. No timing or frames live in
 * the stream itself.
 */

import type { SourceSpan } from "./spans.js";

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

/**
 * The trace-event envelope. `payload` is kind-specific typed data — the payload interfaces
 * above cover the rendering-relevant kinds the spec calls out; other kinds refine their
 * payload with their feature slice.
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
