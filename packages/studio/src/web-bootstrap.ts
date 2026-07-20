/**
 * Headless glue for the browser entry (`web/main.ts`, issue #277, extended by #278). Everything a
 * real DOM host needs beyond composing the published `@openlogo/studio` controllers verbatim lives
 * here, so it stays `node:test`-able and inside the 100% coverage gate — `web/main.ts` itself is a
 * thin, logic-free wiring layer that only touches `document`/`window` and is never imported by a
 * test (per this package's `tsconfig.json`, `web/**` is outside the `src` build graph and this
 * monorepo has no `lib.dom`), so any real logic must live here instead.
 */

import type { Diagnostic, DiagnosticSeverity, Position } from "@openlogo/core";
import type { Scheduler } from "@openlogo/turtle";
import { toDiagnosticsView } from "./diagnostics.js";

/**
 * The program the editor boots with — the canonical acceptance square from issue #277 and the
 * root README ("Try a program"). Kept as a named constant so both the browser entry and this
 * module's tests assert the exact same string.
 */
export const DEFAULT_RUN_PROGRAM = "repeat 4 [ forward 100 right 90 ]";

/** Fixed label shown in the diagnostics list (#278) when there is nothing to report. */
export const NO_DIAGNOSTICS_LABEL = "No diagnostics.";

/**
 * One diagnostic, fully formatted and ready for direct DOM rendering — `web/main.ts` (#278) only
 * assembles a `<li>` per item from these fields; it never builds the span/label text itself (the
 * "non-trivial DOM formatting stays in a tested helper" rule from issue #278).
 */
export interface DiagnosticListItem {
  /** Stable `ol-*`/`ol-style-*` identity, exposed for callers that want to key off it (e.g. CSS). */
  readonly code: string;
  /** `"error"` or `"warning"`, exposed for callers that want to badge/style by severity. */
  readonly severity: DiagnosticSeverity;
  /** The full, ready-to-display line: `"<line>:<column> <code> (<severity>): <message>"`. */
  readonly label: string;
}

/** Formats a 1-based `[line, column]` position as `"line:column"`. */
function formatPosition([line, column]: Position): string {
  return `${line}:${column}`;
}

/**
 * Project the shared state model's raw diagnostics into a ready-to-render list — one item per
 * diagnostic, in order, each already carrying its fully formatted `label` (source span, code,
 * severity, message). Keys every decision off {@link toDiagnosticsView}'s structured fields
 * (`code`/`severity`/`sourceSpan`), per `spec/error-model.md`'s diagnostic-identity rule —
 * `message` is prose for display only, appended verbatim, never parsed. `message` already bakes
 * in any did-you-mean suggestion the spec provides (e.g. `ol-unknown-command`'s
 * "did you mean forward?", per `spec/error-model.md`'s "Did-you-mean" section), so no separate
 * suggestion rendering is needed here.
 */
export function toDiagnosticListItems(
  diagnostics: readonly Diagnostic[],
): readonly DiagnosticListItem[] {
  return toDiagnosticsView(diagnostics).items.map((item) => ({
    code: item.code,
    severity: item.severity,
    label: `${formatPosition(item.sourceSpan.start)} ${item.code} (${item.severity}): ${item.message}`,
  }));
}

/**
 * The real timer primitives {@link createTimeoutScheduler} paces playback through. Declared
 * locally (rather than referencing the ambient `setTimeout`/`clearTimeout` globals directly) so
 * this module needs neither `lib.dom` nor `@types/node` to type-check — the browser entry
 * (`web/main.ts`, which has `lib: ["DOM"]` via `tsconfig.web.json`) supplies the real
 * `window.setTimeout`/`window.clearTimeout` as a one-line wiring call.
 */
export interface TimeoutSchedulerTimers<Handle = unknown> {
  /** Schedules `callback` after `delayMs` and returns an opaque handle. */
  readonly setTimeout: (callback: () => void, delayMs: number) => Handle;
  /** Cancels a handle previously returned by `setTimeout`, if it hasn't fired yet. */
  readonly clearTimeout: (handle: Handle) => void;
}

/**
 * Builds a real, paced `Scheduler` (`@openlogo/turtle`'s `Scheduler` type) for
 * `createRunController`'s `RunControllerOptions.scheduler`, so a run's turtle animation plays back
 * visibly instead of draining instantly like the default `IMMEDIATE_SCHEDULER` — `@openlogo/turtle`
 * stays timer-free by design, so studio owns the timer (`run-controller.ts`'s doc comment).
 *
 * Deliberately paces every step at the same fixed `delayMs`, ignoring the
 * `TurtleAnimationController`'s own per-step delay (its default speed of 1 step/second would make
 * even a short program take tens of seconds, and the studio doesn't expose a speed control yet —
 * that's a later slice). A single fixed pace is the simplest thing that makes every run visibly
 * animated without over-building a speed UI this slice doesn't need.
 */
export function createTimeoutScheduler<Handle = unknown>(
  delayMs: number,
  timers: TimeoutSchedulerTimers<Handle>,
): Scheduler {
  return (callback) => {
    const handle = timers.setTimeout(callback, delayMs);
    return () => {
      timers.clearTimeout(handle);
    };
  };
}
