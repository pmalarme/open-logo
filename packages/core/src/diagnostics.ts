/**
 * Diagnostics — the normative `ol-*` diagnostic contract (C10).
 *
 * Every OpenLogo finding a learner or tool sees uses this one shape and a stable
 * code from the registry below; implementations never emit ad-hoc error strings.
 * The registry is owned by `@openlogo/core`; `@openlogo/parser` and
 * `@openlogo/runtime` produce diagnostics, studio/tests/tutor consume them.
 *
 * Codes are transcribed verbatim from `spec/error-model.md` (parse/semantic/
 * runtime errors) and `spec/tooling.md` (`ol-style-*` style lints). The `ol-*`
 * namespace is reserved by the spec: a genuinely new code is a spec change, not
 * an implementation choice.
 *
 * This module is types + registry data only — no behavior. Message rendering,
 * did-you-mean, and telemetry land with the slices that raise each code.
 */

import type { SourceSpan } from "./span.js";

/**
 * The normative parse/semantic/runtime error codes from
 * `spec/error-model.md`. Order follows the spec's registry table.
 */
export const OL_ERROR_CODES = [
  "ol-unknown-command",
  "ol-not-enough-inputs",
  "ol-too-many-inputs",
  "ol-type",
  "ol-range",
  "ol-undefined-var",
  "ol-unmatched-bracket",
  "ol-unmatched-brace",
  "ol-unmatched-paren",
  "ol-missing-end",
  "ol-mismatched-end",
  "ol-unclosed-comment",
  "ol-unclosed-string",
  "ol-bad-token",
  "ol-div-zero",
  "ol-neg-sqrt",
  "ol-no-output",
  "ol-no-value",
  "ol-return-outside-proc",
  "ol-return-in-comprehension",
  "ol-duplicate-binder",
  "ol-stop-outside-proc",
  "ol-repcount-outside-repeat",
  "ol-limit",
  "ol-user-error",
  "ol-not-boolean",
  "ol-bad-color",
  "ol-reserved-word",
  "ol-unknown-type",
  "ol-unknown-field",
  "ol-unknown-key",
  "ol-not-a-place",
] as const;

/**
 * The normative style-lint codes from `spec/tooling.md` (Layer 3). Style
 * findings reuse the diagnostic shape with `severity: "warning"` and must never
 * change program meaning.
 */
export const OL_STYLE_CODES = [
  "ol-style-useless-value",
  "ol-style-name-case",
  "ol-style-full-name",
  "ol-style-one-command-per-line",
  "ol-style-block-indentation",
  "ol-style-prefer-block",
  "ol-style-predicate-name",
  "ol-style-procedure-name",
  "ol-style-comment-style",
  "ol-style-magic-number",
  "ol-style-equality-confusion",
  "ol-style-deep-nesting",
  "ol-style-hidden-abstraction",
] as const;

/** An `ol-*` parse/semantic/runtime error code. */
export type OlErrorCode = (typeof OL_ERROR_CODES)[number];

/** An `ol-style-*` style-lint code. */
export type OlStyleCode = (typeof OL_STYLE_CODES)[number];

/** Any stable diagnostic code — an error code or a style-lint code. */
export type DiagnosticCode = OlErrorCode | OlStyleCode;

/** Every diagnostic code in the registry: error codes then style codes. */
export const DIAGNOSTIC_CODES: readonly DiagnosticCode[] = [...OL_ERROR_CODES, ...OL_STYLE_CODES];

/**
 * When a diagnostic was found. The same `code` keeps its identity across stages;
 * `stage` only records where detection happened (`spec/error-model.md`).
 */
export type DiagnosticStage = "parse" | "semantic" | "runtime";

/** Diagnostic severity. There is no `info`; style lints are `warning`. */
export type DiagnosticSeverity = "error" | "warning";

/**
 * Structured data that is part of a diagnostic's identity and drives message
 * rendering, repair, telemetry, and localization. Empty object is allowed. Each
 * code documents its required params in the spec registry.
 */
export type DiagnosticParams = Readonly<Record<string, unknown>>;

/**
 * Optional extra detail for `debug`, developer tools, and advanced learners
 * (e.g. `procedure_stack`, `state_after_error`). Off by default for learners.
 */
export type DiagnosticDebug = Readonly<Record<string, unknown>>;

/**
 * The C10 diagnostic shape. Identity is `code` + `params`; `message` is
 * presentation and must be derived from them, never parsed by tools.
 */
export interface Diagnostic {
  /** Stable identity from the registry (`spec/error-model.md`). */
  readonly code: DiagnosticCode;
  /** The source location that best explains the finding. */
  readonly sourceSpan: SourceSpan;
  /** Structured identity/repair/localization data (empty object allowed). */
  readonly params: DiagnosticParams;
  /** Localizable learner-facing prose generated from `code` + `params`. */
  readonly message: string;
  /** Where the finding was detected. */
  readonly stage: DiagnosticStage;
  /** `error` or `warning`. */
  readonly severity: DiagnosticSeverity;
  /** Optional advanced/tooling detail. */
  readonly debug?: DiagnosticDebug;
}
