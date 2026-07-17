/**
 * Trace / event stream — the normative execution event contract.
 *
 * Execution (`@openlogo/runtime`) produces one deterministic, ordered, headless
 * event stream; `@openlogo/turtle` (rendering), `@openlogo/studio` (stepping),
 * and the conformance tests consume it. The registry lives in `@openlogo/core`;
 * kinds are transcribed from `spec/execution-model.md` ("Trace and event
 * registry"). There is no timing or frame data in the stream — animation is a
 * rendering concern.
 *
 * This module is types + registry data only. Per-kind payload shapes are refined
 * by the slice that emits each event; the stub carries a generic payload bag.
 */

import type { SourceSpan } from "./span.js";

/**
 * The normative event kinds. Kind spellings are kebab-case exactly as the spec
 * registers them. Two timing classes exist: **start** events (`instruction`,
 * `procedure-enter`) are emitted before their effect; every other kind is an
 * **effect** event emitted immediately after the state change it describes.
 */
export const EVENT_KINDS = [
  // Start
  "instruction",
  "procedure-enter",
  // Effect
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
export type EventKind = (typeof EVENT_KINDS)[number];

/**
 * Turtle identity, present only on turtle-specific events. Refined by
 * `@openlogo/turtle`, which owns turtle identity; core fixes only its shape so
 * the envelope can carry it.
 */
export type TurtleId = number;

/**
 * Kind-specific typed data. The stub is a generic bag; each slice refines the
 * payload for the kinds it emits (e.g. `move` → `{ from, to, heading }`).
 */
export type EventPayload = Readonly<Record<string, unknown>>;

/**
 * The trace-event envelope (`spec/execution-model.md`). Events are ordered by a
 * monotonic `seq`; a step spans one `instruction` event to the next.
 */
export interface TraceEvent {
  /** Monotonic integer sequence number. */
  readonly seq: number;
  /** One registered event kind. */
  readonly kind: EventKind;
  /** The source range that caused the event. */
  readonly sourceSpan: SourceSpan;
  /** Turtle identity — present only when the event is turtle-specific. */
  readonly turtleId?: TurtleId;
  /** Kind-specific typed data. */
  readonly payload: EventPayload;
}
