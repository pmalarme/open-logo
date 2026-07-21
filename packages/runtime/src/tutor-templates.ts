/**
 * The injectable `tutor-output` template seam (M3-orchestrator ruling on issue #332): a template
 * function `(TutorContext) => TutorOutputPayload` decides pedagogy and which of A0's
 * discriminated {@link TutorOutputPayload} arms to emit — `@openlogo/runtime`'s dispatch
 * (`execute-internal.ts`'s `executeEducationalMetaCommand`) only ever builds the context and
 * faithfully emits whatever the resolved template returns; it never owns prose or arm choice.
 *
 * A caller supplies its own template via `ExecuteOptions.tutorTemplates` (e.g. `@openlogo/edu`'s
 * curriculum-quality A3/A4/A5 templates, wired in by a host like `@openlogo/studio`). When one is
 * not supplied — including every conformance-fixture run, which exercises the DEFAULT on
 * purpose — {@link defaultTutorTemplate} below is used instead: a genuinely minimal, deterministic,
 * structural template (statement kind / callee name / prior effect), never curriculum-quality
 * prose and never a full solution, satisfying the Educational profile's baseline contract
 * (`spec/conformance.md`) on its own.
 */

import type {
  Diagnostic,
  DiagnosticCode,
  TutorHintStage,
  TutorOutputPayload,
} from "@openlogo/core";
import type { TutorContext } from "./tutor-context.js";

/** The four `hint` stages in escalation order (`spec/execution-model.md:640-652`). */
const HINT_STAGE_ORDER: readonly TutorHintStage[] = [
  "nudge",
  "concept",
  "partial",
  "last-resort",
];

/**
 * The next `hint` stage after `previous` — `"nudge"` when there is no previous stage (the first
 * `hint` for a target), escalating one stage per repeated request, capping at `"last-resort"`
 * (which then repeats) rather than ever reaching past it toward a full solution.
 */
export function nextHintStage(
  previous: TutorHintStage | undefined,
): TutorHintStage {
  const previousIndex = previous ? HINT_STAGE_ORDER.indexOf(previous) : -1;
  const nextIndex = Math.min(previousIndex + 1, HINT_STAGE_ORDER.length - 1);
  // `nextIndex` is always a valid HINT_STAGE_ORDER index (clamped above), so the lookup below
  // never yields `undefined`.
  return HINT_STAGE_ORDER[nextIndex] as TutorHintStage;
}

/** The injectable `tutor-output` template function shape (`ExecuteOptions.tutorTemplates`). */
export type TutorTemplateFn = (context: TutorContext) => TutorOutputPayload;

/**
 * Picks the diagnostic a `why`/`debug` invocation's DIAGNOSTIC arm describes: the most recently
 * produced entry in `context.diagnostics` (last in encounter order), or `undefined` when none are
 * in scope — in which case the caller falls back to the non-diagnostic PROGRAM arm.
 *
 * A single `execute()` run halts terminally on its first runtime diagnostic, so a meta-command
 * can never observe a non-empty `context.diagnostics` from ITS OWN run in practice — this
 * function (and the diagnostic-arm construction below) is still exercised directly, via a
 * synthetic `TutorContext`, by `educational-meta-commands.test.mjs`'s dedicated unit tests, since
 * a host that re-invokes `why`/`debug` after a halted run (cross-run session persistence, a
 * studio/C2 concern) DOES reach this path in production.
 */
function mostRecentDiagnostic(
  diagnostics: readonly Diagnostic[],
): Diagnostic | undefined {
  return diagnostics.length > 0
    ? diagnostics[diagnostics.length - 1]
    : undefined;
}

/**
 * The built-in, minimal deterministic template used whenever `ExecuteOptions.tutorTemplates` is
 * not supplied. Produces valid, non-empty, non-solution-revealing `segments` from structural
 * facts alone (whether a target is selected, and — for `why`/`debug` — whether a diagnostic is in
 * scope): genuinely minimal boilerplate, not curriculum-quality prose. Writing actual
 * learner-facing curriculum text from the target's real semantics is `@openlogo/edu`'s job
 * (issues #333-#335, the A3/A4/A5 slices this template deliberately leaves untouched).
 */
export const defaultTutorTemplate: TutorTemplateFn = (context) => {
  const target = context.target;
  const targetSpan = target?.source_span;
  const scope =
    target === undefined ? "your program" : "the previous instruction";

  if (context.command === "why" || context.command === "debug") {
    const diagnostic = mostRecentDiagnostic(context.diagnostics);
    if (diagnostic !== undefined) {
      const code = diagnostic.code as DiagnosticCode;
      const segments: readonly [string, ...string[]] =
        context.command === "why"
          ? [`Here is why the ${code} diagnostic was raised.`]
          : [`Here is what to check about the ${code} diagnostic.`];
      return context.command === "why"
        ? {
            command: "why",
            segments,
            diagnostic_code: code,
            target_source_span: diagnostic.source_span,
          }
        : {
            command: "debug",
            segments,
            diagnostic_code: code,
            target_source_span: diagnostic.source_span,
          };
    }
  }

  switch (context.command) {
    case "explain":
      return targetSpan === undefined
        ? { command: "explain", segments: [`Here is what ${scope} does.`] }
        : {
            command: "explain",
            segments: [`Here is what ${scope} does.`],
            target_source_span: targetSpan,
          };
    case "why":
      return targetSpan === undefined
        ? {
            command: "why",
            segments: [`Here is why ${scope} behaves the way it does.`],
          }
        : {
            command: "why",
            segments: [`Here is why ${scope} behaves the way it does.`],
            target_source_span: targetSpan,
          };
    case "debug":
      return targetSpan === undefined
        ? {
            command: "debug",
            segments: [`Here is what to check about ${scope}.`],
          }
        : {
            command: "debug",
            segments: [`Here is what to check about ${scope}.`],
            target_source_span: targetSpan,
          };
    case "hint": {
      const stage = nextHintStage(context.priorHintStage);
      // `hint` MUST always carry a `target_source_span` — the whole-program span when no
      // narrower target is selected (`spec/execution-model.md#tutor-output-educational-profile`).
      const hintTargetSpan = targetSpan ?? context.program.source_span;
      let segments: readonly [string, ...string[]];
      switch (stage) {
        case "concept":
          segments = [`Think about the concept behind ${scope}.`];
          break;
        case "partial":
          segments = [`Here is a partial idea to move ${scope} forward.`];
          break;
        case "last-resort":
          segments = [
            `Here is a strong nudge for ${scope} — try it yourself first.`,
          ];
          break;
        default:
          segments = [`Here is a small nudge about ${scope}.`];
      }
      return {
        command: "hint",
        stage,
        target_source_span: hintTargetSpan,
        segments,
      };
    }
  }
};
