/**
 * `@openlogo/core` — the value/type model, `ol-*` diagnostics, the trace/event
 * registry, and profile/feature-detection metadata. This module is the package's
 * only public entry point; import it as the OpenLogo (`OL`) namespace:
 *
 * ```ts
 * import * as OL from "@openlogo/core";
 * ```
 *
 * `@openlogo/core` depends on nothing, so the source-span, diagnostic, and event
 * contracts it owns can be shared across every package without a cycle
 * (`docs/architecture.md` §4). The value/type model and profile metadata land
 * with their own slices; the cross-cutting contract stubs (source spans,
 * diagnostics, trace events) land here.
 */

export type { Position, SourceSpan } from "./span.js";

export { OL_ERROR_CODES, OL_STYLE_CODES, DIAGNOSTIC_CODES } from "./diagnostics.js";
export type {
  OlErrorCode,
  OlStyleCode,
  DiagnosticCode,
  DiagnosticStage,
  DiagnosticSeverity,
  DiagnosticParams,
  DiagnosticDebug,
  Diagnostic,
} from "./diagnostics.js";

export { EVENT_KINDS } from "./events.js";
export type { EventKind, TurtleId, EventPayload, TraceEvent } from "./events.js";

/**
 * The OpenLogo language/feature-detection version. The `@openlogo/*` tuple
 * versions in lockstep (`docs/adr/0003-versioning-and-release.md`).
 */
export const version = "0.1.0";
