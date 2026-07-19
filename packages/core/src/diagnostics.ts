/**
 * The `ol-*` diagnostic contract — the normative shape every OpenLogo finding takes, plus
 * the stable code registry. Owned by `@openlogo/core`; parser and runtime emit these, and
 * studio, tests, and the tutor consume them. Never throw bare strings or invent an `ol-*`
 * code in implementation code — the namespace is reserved by
 * [`spec/error-model.md`](../../../spec/error-model.md); a genuinely new code is a
 * maintainer-owned spec change.
 */

import type { SourceSpan } from "./spans.js";

/**
 * The normative `ol-*` error/semantic/runtime code registry from `spec/error-model.md`.
 * Kept as data (`as const`) so tooling can enumerate it and {@link DiagnosticCode} derives
 * from it — one source of truth, no scattered string literals.
 */
export const OL_DIAGNOSTIC_CODES = [
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

/** A stable `ol-*` diagnostic code from the normative registry. */
export type DiagnosticCode = (typeof OL_DIAGNOSTIC_CODES)[number];

/**
 * Style-lint codes. These reuse the diagnostic shape with `severity: "warning"` and MUST
 * NOT change program meaning. `spec/tooling.md:237-251` registers 13 `ol-style-*` codes; issue
 * #115 slice 1 wired `ol-style-useless-value`, `ol-style-equality-confusion`, and
 * `ol-style-name-case`; #169 slice 2a added `ol-style-magic-number` and
 * `ol-style-predicate-name`; slice 2b (this one) adds the layout group —
 * `ol-style-one-command-per-line`, `ol-style-deep-nesting`, `ol-style-block-indentation`, and
 * `ol-style-prefer-block` — the remaining four (`ol-style-full-name`, `ol-style-procedure-name`,
 * `ol-style-comment-style`, `ol-style-hidden-abstraction`) are tracked in the #169 follow-up
 * issue.
 */
export const OL_STYLE_DIAGNOSTIC_CODES = [
  "ol-style-useless-value",
  "ol-style-equality-confusion",
  "ol-style-name-case",
  "ol-style-magic-number",
  "ol-style-predicate-name",
  "ol-style-one-command-per-line",
  "ol-style-deep-nesting",
  "ol-style-block-indentation",
  "ol-style-prefer-block",
] as const;

/** A stable `ol-style-*` linter code. */
export type StyleDiagnosticCode = (typeof OL_STYLE_DIAGNOSTIC_CODES)[number];

/** When the finding was discovered: reading structure, understanding it, or running it. */
export type DiagnosticStage = "parse" | "semantic" | "runtime";

/** Errors stop execution; style warnings never change meaning. There is no `info`. */
export type DiagnosticSeverity = "error" | "warning";

/** Optional extra detail for `debug`, developer tools, and advanced learners. */
export interface DiagnosticDebug {
  /** Innermost call first. */
  readonly procedure_stack?: readonly string[];
  /** Observable state after the error was reported. */
  readonly state_after_error?: unknown;
}

/**
 * A single diagnostic. `code` + `params` are the identity; `message` is localizable prose
 * derived from them — tools MUST NOT parse the English message.
 */
export interface Diagnostic {
  /** Stable identity from {@link OL_DIAGNOSTIC_CODES} or an `ol-style-*` code. */
  readonly code: DiagnosticCode | StyleDiagnosticCode;
  /** The source location that best explains the finding. */
  readonly source_span: SourceSpan;
  /** Structured data used for identity, repair, telemetry, and localization. */
  readonly params: Readonly<Record<string, unknown>>;
  /** Learner-facing prose generated from `code` and `params`. */
  readonly message: string;
  /** Parse, semantic, or runtime. */
  readonly stage: DiagnosticStage;
  /** Error or warning. */
  readonly severity: DiagnosticSeverity;
  /** Optional detail for tooling; off by default for learners. */
  readonly debug?: DiagnosticDebug;
}

/** Type guard: is `value` a registered `ol-*` diagnostic code? */
export function isDiagnosticCode(value: string): value is DiagnosticCode {
  return (OL_DIAGNOSTIC_CODES as readonly string[]).includes(value);
}
