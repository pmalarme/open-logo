/**
 * The tutor-output pane (#334) — surfaces the `tutor-output` trace event (A0/A2, #324/#332) that
 * `explain`/`why`/`hint`/`debug` emit, in an accessible surface alongside the studio's other panes.
 * This slice does not change meta-command behavior — the runtime's dispatch, the four baseline
 * templates, and the `TutorOutputPayload` shape are all untouched; this module only injects
 * `@openlogo/edu`'s real templates into `execute()` (via `run-controller.ts`) and renders whatever
 * payload comes back.
 *
 * ## The injection seam ({@link eduTutorTemplate})
 * `@openlogo/runtime`'s `ExecuteOptions.tutorTemplates` (A2, #332) is a single
 * `(TutorContext) => TutorOutputPayload` function — the runtime's dispatch builds the context and
 * faithfully emits whichever payload that one function returns, never choosing pedagogy itself.
 * `@openlogo/edu` ships FOUR separate pure functions instead — one per command (`explain`, `why`,
 * `hint`, `debug`, from A3/A4/A5) — so {@link eduTutorTemplate} is the thin adapter that picks the
 * right one by `context.command` and calls it. `run-controller.ts` (the HOST) passes this adapter
 * as `tutorTemplates`, so a learner sees `@openlogo/edu`'s curriculum-quality prose instead of
 * `@openlogo/runtime`'s genuinely minimal `defaultTutorTemplate` fallback.
 *
 * ## Accumulating across runs ({@link createTutorOutputController})
 * `run-controller.ts` collects the current run's `tutor-output` events into the shared state
 * model's `tutorOutput` field (`state-model.ts`), replaced wholesale every run — exactly like
 * `output`/`diagnostics`. This module's controller mirrors `run-log.ts`'s pattern: it watches the
 * shared store for a completed run (`"running"` → `"done"`/`"stopped"`, the same transition
 * `run-log.ts` watches) and APPENDS that run's `tutorOutput` events, in order, onto its own
 * growing history — never replacing or dropping an earlier entry. This is what makes repeated
 * `hint` invocations visible as a sequence of progressive stages rather than just the latest one:
 * whether the learner writes several `hint` statements in one program (progressing within a
 * single `execute()` call, per `spec/execution-model.md:640-652`) or re-runs the program multiple
 * times, every stage the learner has seen stays in the pane's history.
 *
 * ## Absent until a meta-command runs ({@link TutorOutputPaneView.isVisible})
 * Mirrors `lesson-pane.ts`'s `isVisible`/`NO_LESSON_VIEW` convention: the pane's view is `{
 * isVisible: false, items: [] }` until at least one `tutor-output` event has ever been recorded,
 * so a renderer never has to show (or reserve layout for) an empty tutor pane, and the editor/
 * diagnostics panes are never blocked or displaced by it.
 *
 * ## DOM/mount integration contract (for `web/main.ts`)
 * Like `run-log.ts`/`lesson-pane.ts`: `web/main.ts` looks up the pane's DOM element, calls
 * {@link mountTutorOutputPane}, and on every new entry ({@link TutorOutputController.subscribeEntries})
 * rebuilds the element's content from {@link toTutorOutputListItems} and toggles `hidden` from
 * {@link TutorOutputController.getView}'s `isVisible` — the same "always fully-formed, never a
 * renderer decision" convention `run-log.ts`/`lesson-pane.ts` already established.
 */

import type { TutorOutputPayload } from "@openlogo/core";
import type { TutorContext, TutorTemplateFn } from "@openlogo/runtime";
import { debug, explain, hint, why } from "@openlogo/edu";
import type {
  RunStatus,
  StudioStateStore,
  Unsubscribe,
} from "./state-model.js";
import type { AppShell } from "./app-shell.js";

/**
 * The injectable `ExecuteOptions.tutorTemplates` adapter a host (this package) supplies to
 * `@openlogo/runtime`'s `execute()` (A2, #332): dispatches to `@openlogo/edu`'s real per-command
 * template (A3/A4/A5) by `context.command`, so the studio surfaces curriculum-quality prose
 * instead of the runtime's minimal built-in `defaultTutorTemplate` fallback. A pure function —
 * `@openlogo/edu`'s templates are themselves pure over `TutorContext` (see each one's own doc
 * comment) — never chosen or overridden here beyond the command dispatch itself.
 */
export const eduTutorTemplate: TutorTemplateFn = (context: TutorContext) => {
  switch (context.command) {
    case "explain":
      return explain(context);
    case "why":
      return why(context);
    case "hint":
      return hint(context);
    case "debug":
      return debug(context);
  }
};

/** Narrows a {@link RunStatus} to the two terminal values a completed run can commit. */
function isTerminalRunStatus(
  runStatus: RunStatus,
): runStatus is Extract<RunStatus, "done" | "stopped"> {
  return runStatus === "done" || runStatus === "stopped";
}

/** One recorded `tutor-output` event, tagged with a stable id and when it was recorded. */
export interface TutorOutputEntry {
  /** A stable, monotonically increasing identity, unique within one {@link TutorOutputController}. */
  readonly id: number;
  /** When this entry was recorded, per the controller's clock ({@link TutorOutputControllerOptions.now}). */
  readonly recordedAt: number;
  /** The `tutor-output` event payload itself, unchanged from `@openlogo/core`. */
  readonly payload: TutorOutputPayload;
}

/** Notified with each newly appended {@link TutorOutputEntry}, in recording order. */
export type TutorOutputEntryListener = (entry: TutorOutputEntry) => void;

/** Optional configuration for {@link createTutorOutputController}. */
export interface TutorOutputControllerOptions {
  /** Injectable clock for {@link TutorOutputEntry.recordedAt}. Defaults to `Date.now`. */
  readonly now?: () => number;
}

/** A short, learner-facing label for one `tutor-output` payload's command (+ hint stage). */
function describeCommand(payload: TutorOutputPayload): string {
  if (payload.command === "hint") {
    return `hint — ${payload.stage}`;
  }
  return payload.command;
}

/** One tutor-output entry, fully formatted and ready for direct DOM rendering. */
export interface TutorOutputViewItem {
  /** {@link TutorOutputEntry.id}. */
  readonly id: number;
  /** e.g. `"explain"`, `"why"`, `"debug"`, or `"hint — nudge"`/`"hint — concept"`/etc. */
  readonly heading: string;
  /** This entry's learner-facing message segments, in order — never a full solution. */
  readonly segments: readonly string[];
}

/**
 * The tutor-output pane's rendering model — always fully formed, never requiring a renderer to
 * branch before reading a field, mirroring `lesson-pane.ts`'s `LessonPaneView` convention.
 * `isVisible` is the single decision a renderer needs: whether to show the pane at all (`false`
 * until at least one `tutor-output` event has ever been recorded).
 */
export interface TutorOutputPaneView {
  /** Whether any `tutor-output` event has ever been recorded; `false` means the pane stays hidden. */
  readonly isVisible: boolean;
  /** Every recorded entry so far, oldest first; `[]` when `isVisible` is `false`. */
  readonly items: readonly TutorOutputViewItem[];
}

/** Project recorded entries into a ready-to-render list, oldest first. */
export function toTutorOutputListItems(
  entries: readonly TutorOutputEntry[],
): readonly TutorOutputViewItem[] {
  return entries.map((entry) => ({
    id: entry.id,
    heading: describeCommand(entry.payload),
    segments: entry.payload.segments,
  }));
}

/** The headless tutor-output pane controller over the shared studio state model. */
export interface TutorOutputController {
  /** The single studio state model instance this controller reads through (never a copy). */
  readonly state: StudioStateStore;
  /** Every recorded `tutor-output` event so far, oldest first — grows only, never replaced. */
  getEntries(): readonly TutorOutputEntry[];
  /** The current rendering model, derived from {@link getEntries}. */
  getView(): TutorOutputPaneView;
  /** Register a listener notified with each newly appended entry, as it is recorded. */
  subscribeEntries(listener: TutorOutputEntryListener): Unsubscribe;
}

/**
 * Construct the tutor-output pane controller bound to the shared studio state model (never a
 * copy). Appends one {@link TutorOutputEntry} per event in `tutorOutput`, in order, every time
 * `runStatus` transitions from `"running"` into `"done"` or `"stopped"` — the same completed-run
 * transition `run-log.ts` watches (see this module's doc comment for why).
 */
export function createTutorOutputController(
  state: StudioStateStore,
  options: TutorOutputControllerOptions = {},
): TutorOutputController {
  const now = options.now ?? Date.now;
  let entries: readonly TutorOutputEntry[] = [];
  let nextId = 1;
  let previousRunStatus = state.getState().runStatus;
  const listeners = new Set<TutorOutputEntryListener>();

  state.subscribe((next) => {
    const isCompletedRun =
      previousRunStatus === "running" && isTerminalRunStatus(next.runStatus);
    previousRunStatus = next.runStatus;
    if (!isCompletedRun) {
      return;
    }
    for (const payload of next.tutorOutput) {
      const entry: TutorOutputEntry = {
        id: nextId,
        recordedAt: now(),
        payload,
      };
      nextId += 1;
      entries = [...entries, entry];
      for (const listener of listeners) {
        listener(entry);
      }
    }
  });

  return {
    state,
    getEntries: () => entries,
    getView: () => ({
      isVisible: entries.length > 0,
      items: toTutorOutputListItems(entries),
    }),
    subscribeEntries(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** Compose the tutor-output pane controller into the app shell's `tutor` region. */
export function mountTutorOutputPane(
  shell: AppShell,
  controller: TutorOutputController,
): void {
  shell.mount("tutor", controller);
}
