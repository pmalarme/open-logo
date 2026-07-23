/**
 * The run log pane (#314) — a history/timeline of every completed run, not just the latest. Prior
 * to this slice, `web/main.ts` wired the shared state model's `output` field straight into the
 * `#output` `<pre>` (`formatOutput`, #278) — a single slot a fresh `run()` silently overwrites, so
 * a learner who runs two programs in a row can never see what the FIRST one printed once the
 * SECOND finishes. This module adds a second, additive surface: an append-only history of every
 * run's outcome, timestamped and ordered, that the learner can scroll back through. `#output`/
 * `formatOutput` (#278) are unchanged and still show the latest run's raw output for a learner who
 * just wants to glance at what happened most recently.
 *
 * ## What counts as "a run"
 * `run-controller.ts`'s `RunStatus` state machine transitions `"idle"`/`"done"`/`"stopped"` →
 * `"running"` at the very start of every `run()` (`prepare()`'s first line), then, once that run's
 * `output`/`diagnostics` are already fully populated (`execute()` runs the WHOLE program
 * synchronously and atomically — only the turtle-Canvas replay is paced, never the evaluation
 * itself), commits exactly one of `"done"` (finished on its own) or `"stopped"` (`stop()` called,
 * or an `ol-limit` runaway-program halt), once. {@link createRunLogController} watches for exactly
 * that `"running"` → `"done"`/`"stopped"` transition — never `"idle"` → anything, which is what
 * `reset()` does, and must never create a log entry, since `reset()` clears the CURRENT run's
 * fields rather than completing a run — and appends one immutable {@link RunLogEntry} snapshotting
 * `state.lastRunResult` (#432 finding 2 — an immutable per-run `source`/`output`/`diagnostics`
 * triple `run-controller.ts`'s `prepare()` captures at run start, falling back to the live
 * `output`/`diagnostics` fields only when no such snapshot exists, e.g. a test driving the store
 * directly). `RunLogEntry` itself still only carries `output`/`diagnostics` (#314's original
 * acceptance criteria never asked the log to display the source), but the snapshot's `source` is
 * what makes it verifiably "this run's own" result rather than a coincidentally-matching one.
 * Reading `lastRunResult` rather than the live fields matters because a paced (non-instant) run
 * leaves `runStatus` at `"running"` across many event-loop turns while the editor stays fully
 * live: `diagnostics.ts`'s parse-as-you-type re-checking keeps replacing the live `diagnostics`
 * field with the CURRENT source's parse result on every edit, so a learner who edits mid-run
 * (e.g. removing the bug that caused the run's own `ol-*` runtime error) could otherwise have that
 * error silently vanish from the completed run's own log entry by the time this subscriber reads
 * it — the immutable snapshot means the logged entry always captures the full run — including any
 * `ol-*` diagnostic, parse- or runtime-stage, per the issue's "prints and then errors" scenario —
 * whether the run finished on its own or was stopped mid-animation, and regardless of what the
 * learner does to the editor in the meantime.
 *
 * ## Append, never replace
 * `entries` only ever grows via `[...entries, entry]`: a later run's entry is appended after every
 * earlier one, which are never mutated or dropped — satisfying the acceptance criteria's "keeps
 * the earlier run and appends the new one (history/timeline)".
 *
 * ## Rendering
 * {@link toRunLogListItems} is the pure projection `web/main.ts` renders from — one
 * {@link RunLogEntryViewItem} per entry, each already carrying a formatted heading (run number +
 * ISO timestamp, deterministic across machines/locales unlike `toLocaleTimeString`), its output
 * text (reusing #278's `formatOutput`), and its diagnostic lines (reusing #278's
 * `toDiagnosticListItems`, so the run log renders every `ol-*` diagnostic with the exact same
 * source-span/code/severity/message formatting the diagnostics pane already uses — no second
 * formatting path). `web/main.ts` only loops over already-computed items to build DOM nodes
 * (unavoidable, since this repository's `node:test` suite has no DOM); every actual decision —
 * what counts as a completed run, how to format a heading, which diagnostics belong to which run,
 * what to show when there is no history yet — lives here, fully covered by `run-log.test.mjs`.
 */

import type { Diagnostic } from "@openlogo/core";
import type {
  RunStatus,
  StudioStateStore,
  Unsubscribe,
} from "./state-model.js";
import { formatOutput, toDiagnosticListItems } from "./web-bootstrap.js";

/** A completed run's outcome — one entry per `"running"` → `"done"`/`"stopped"` transition. */
export interface RunLogEntry {
  /** A stable, monotonically increasing identity, unique within one {@link RunLogController}. */
  readonly id: number;
  /** When this run completed, per the controller's clock ({@link RunLogControllerOptions.now}). */
  readonly completedAt: number;
  /** The terminal `RunStatus` this run committed — always `"done"` or `"stopped"`, never `"idle"`/`"running"`. */
  readonly runStatus: Extract<RunStatus, "done" | "stopped">;
  /**
   * This run's learner-visible output, one entry per `print` event — already in
   * `@openlogo/runtime`'s canonical `printedForm` (see `formatOutput`), never reformatted here.
   */
  readonly output: readonly string[];
  /** This run's `ol-*` diagnostics (parse or runtime stage), unchanged from the shared state model. */
  readonly diagnostics: readonly Diagnostic[];
}

/** Notified with each newly appended {@link RunLogEntry}, in completion order. */
export type RunLogEntryListener = (entry: RunLogEntry) => void;

/** Optional configuration for {@link createRunLogController}. */
export interface RunLogControllerOptions {
  /** Injectable clock for {@link RunLogEntry.completedAt}. Defaults to `Date.now`. */
  readonly now?: () => number;
}

/** The headless run log controller over the shared studio state model. */
export interface RunLogController {
  /** The single studio state model instance this controller reads through (never a copy). */
  readonly state: StudioStateStore;
  /** Every completed run so far, oldest first — grows only, never replaced or reordered. */
  getEntries(): readonly RunLogEntry[];
  /** Register a listener notified with each newly appended entry, as it completes. */
  subscribeEntries(listener: RunLogEntryListener): Unsubscribe;
}

/** Narrows a {@link RunStatus} to the two terminal values a completed run can commit. */
function isTerminalRunStatus(
  runStatus: RunStatus,
): runStatus is Extract<RunStatus, "done" | "stopped"> {
  return runStatus === "done" || runStatus === "stopped";
}

/**
 * Construct the run log controller bound to the shared studio state model (never a copy). Appends
 * one {@link RunLogEntry} every time `runStatus` transitions from `"running"` into `"done"` or
 * `"stopped"` — see this module's doc comment for why that transition, and only that transition,
 * marks a completed run.
 */
export function createRunLogController(
  state: StudioStateStore,
  options: RunLogControllerOptions = {},
): RunLogController {
  const now = options.now ?? Date.now;
  let entries: readonly RunLogEntry[] = [];
  let nextId = 1;
  let previousRunStatus = state.getState().runStatus;
  const listeners = new Set<RunLogEntryListener>();

  state.subscribe((next) => {
    const isCompletedRun =
      previousRunStatus === "running" && isTerminalRunStatus(next.runStatus);
    previousRunStatus = next.runStatus;
    if (!isCompletedRun) {
      return;
    }
    const entry: RunLogEntry = {
      id: nextId,
      completedAt: now(),
      runStatus: next.runStatus,
      // #432 finding 2 — prefer the immutable per-run snapshot `run-controller.ts`'s `prepare()`
      // captures (`state.lastRunResult`) over the live `output`/`diagnostics` fields. A paced
      // (non-instant) run leaves `runStatus` at `"running"` across many event-loop turns, during
      // which the editor stays fully live; `diagnostics.ts`'s parse-as-you-type re-checking keeps
      // overwriting the live `diagnostics` field on every source edit, so reading it here — AFTER
      // the run has already finished and the learner may have already started editing again —
      // could log the edited source's diagnostics instead of the run's own. Falls back to the live
      // fields when no snapshot exists, so callers that drive `runStatus`/`output`/`diagnostics`
      // directly (without a real `RunController`) — as most of this module's own tests do — keep
      // working unchanged.
      output: next.lastRunResult?.output ?? next.output,
      diagnostics: next.lastRunResult?.diagnostics ?? next.diagnostics,
    };
    nextId += 1;
    entries = [...entries, entry];
    for (const listener of listeners) {
      listener(entry);
    }
  });

  return {
    state,
    getEntries: () => entries,
    subscribeEntries(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** Fixed placeholder shown when the run log has no entries yet (no run has completed). */
export const NO_RUN_LOG_ENTRIES_LABEL = "No runs yet.";

/** Fixed placeholder shown for a run entry whose output was empty. */
export const NO_RUN_OUTPUT_LABEL = "(no output)";

/** One run log entry, fully formatted and ready for direct DOM rendering. */
export interface RunLogEntryViewItem {
  /** {@link RunLogEntry.id}, or `0` for the synthetic empty-state item (see {@link toRunLogListItems}). */
  readonly id: number;
  /** e.g. `"Run 1 — 2026-07-20T20:47:31.491Z"`, or `""` for the synthetic empty-state item. */
  readonly heading: string;
  /** This run's formatted output, or {@link NO_RUN_OUTPUT_LABEL} if it printed nothing. */
  readonly outputText: string;
  /**
   * This run's diagnostics, each already formatted exactly as the diagnostics pane renders them
   * (source span + code + severity + message); always non-empty (a fixed "No diagnostics." label
   * when there were none — see `web-bootstrap.ts`'s `toDiagnosticListItems`/`NO_DIAGNOSTICS_LABEL`).
   */
  readonly diagnosticLabels: readonly string[];
  /** Whether any of this run's diagnostics was an `"error"` (vs. only warnings or none) — for styling. */
  readonly hasErrors: boolean;
}

/**
 * Project the run log's entries into a ready-to-render list, oldest first — one item per entry,
 * each carrying its formatted heading/output/diagnostics (never leaving `web/main.ts` a decision
 * to branch on). Always returns a **non-empty** list: when there are no entries yet, the single
 * result item is the synthetic {@link NO_RUN_LOG_ENTRIES_LABEL} placeholder — mirroring #278's
 * `toDiagnosticListItems` empty-state convention, so `web/main.ts` only ever loops over the
 * returned items unconditionally.
 */
export function toRunLogListItems(
  entries: readonly RunLogEntry[],
): readonly RunLogEntryViewItem[] {
  if (entries.length === 0) {
    return [
      {
        id: 0,
        heading: "",
        outputText: NO_RUN_LOG_ENTRIES_LABEL,
        diagnosticLabels: [],
        hasErrors: false,
      },
    ];
  }
  return entries.map((entry, index) => ({
    id: entry.id,
    heading: `Run ${index + 1} — ${new Date(entry.completedAt).toISOString()}`,
    outputText:
      entry.output.length === 0
        ? NO_RUN_OUTPUT_LABEL
        : formatOutput(entry.output),
    diagnosticLabels: toDiagnosticListItems(entry.diagnostics).map(
      (item) => item.label,
    ),
    hasErrors: entry.diagnostics.some(
      (diagnostic) => diagnostic.severity === "error",
    ),
  }));
}
