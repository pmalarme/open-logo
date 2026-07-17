/**
 * `@openlogo/core` — value/type model, `ol-*` diagnostics, the trace/event registry, and
 * feature-detection/profile metadata. Everything depends on core; core depends on nothing.
 *
 * ```ts
 * import * as OL from "@openlogo/core";
 * ```
 *
 * The version constant keeps the `@openlogo/*` tuple in lockstep; the cross-cutting
 * contracts below (source spans, `ol-*` diagnostics, and the trace/event registry) are the
 * seams every other package builds against. See `docs/adr/0006-cross-cutting-contracts.md`.
 */
export const OPENLOGO_VERSION = "0.1.0";

export { makeSpan } from "./spans.js";
export type { Position, SourceSpan } from "./spans.js";

export {
  isDiagnosticCode,
  OL_DIAGNOSTIC_CODES,
  OL_STYLE_DIAGNOSTIC_CODES,
} from "./diagnostics.js";
export type {
  Diagnostic,
  DiagnosticCode,
  DiagnosticDebug,
  DiagnosticSeverity,
  DiagnosticStage,
  StyleDiagnosticCode,
} from "./diagnostics.js";

export { isEventKind, OL_EVENT_KINDS } from "./events.js";
export type {
  ClearPayload,
  DrawSegmentPayload,
  EventKind,
  MovePayload,
  Point,
  TraceEvent,
  TurnPayload,
  TurtleId,
} from "./events.js";
