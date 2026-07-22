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
 * `getHostMetadata` exposes feature-detection metadata (spec version, supported profiles,
 * extensions, rendering targets) per `spec/conformance.md:266-291`.
 */
export { OPENLOGO_VERSION } from "./version.js";

export {
  getHostMetadata,
  SUPPORTED_EXTENSIONS,
  SUPPORTED_PROFILES,
  SUPPORTED_RENDERING_TARGETS,
} from "./host-metadata.js";
export type {
  HostMetadata,
  RenderingTarget,
  SupportedProfile,
} from "./host-metadata.js";

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
  AxesOverlayPayload,
  BackgroundChangePayload,
  ClearPayload,
  ColorChangePayload,
  DrawSegmentPayload,
  EventKind,
  FillPayload,
  GridOverlayPayload,
  MeasureOverlayPayload,
  MovePayload,
  OverlayPayload,
  PenChangePayload,
  PenState,
  Point,
  PrintPayload,
  ProcedureEnterPayload,
  ProcedureExitPayload,
  ReturnPayload,
  ShapeChangePayload,
  StampPayload,
  TraceEvent,
  TurnPayload,
  TurtleId,
  VisibilityChangePayload,
  WidthChangePayload,
  TutorCommand,
  TutorHintStage,
  TutorOutputPayload,
  ExplainTutorOutputPayload,
  WhyTutorOutputPayload,
  HintTutorOutputPayload,
  DebugTutorOutputPayload,
  TutorOutputSegments,
  WhyDiagnosticTutorOutputPayload,
  WhyProgramTutorOutputPayload,
  DebugDiagnosticTutorOutputPayload,
  DebugProgramTutorOutputPayload,
} from "./events.js";

export { OLDict, OLRecord, typeNameOf } from "./values.js";
export type { OLDictKey, OLTypeName, OLValue } from "./values.js";
