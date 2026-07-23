/**
 * The icon-based Run/Stop toggle button (#316, relabeled honestly by #410) — presentation only,
 * over the existing, unchanged `run-controller.ts` (#126/#228). Studio previously showed separate
 * "Run" and "Stop" buttons; this module is the one tested place that collapses them into a single
 * toggle, so `web/main.ts` never branches on `runStatus` itself to decide the toggle's
 * label/icon/accessible name, or which of `run()`/`stop()` a click should invoke (per this
 * package's "thin, branch-free wiring layer" rule).
 *
 * ## The mapping
 * {@link mapRunStatusToRunToggleViewModel} maps every internal `RunStatus`
 * (`state-model.ts`: `"idle" | "running" | "done" | "stopped"`) to a {@link RunToggleViewModel}:
 * - `"running"` shows the Stop affordance — label `"Stop"`, `icon: "stop"`, and `action: "stop"`
 *   (clicking calls the existing `stop()`; this module adds no pause/resume semantics of its own —
 *   see the hard scope boundary below).
 * - every other status (`"idle"`, `"done"`, `"stopped"`) shows the play affordance — label
 *   `"Start"`, `icon: "play"`, and `action: "run"` (clicking calls the existing `run()`).
 *
 * ## #410 — "Pause" was dishonest; this is Stop, not resumable pause
 * The button's `action` has always been `stop()`, which latches `signal.aborted` and
 * `userStopped` **irreversibly** — only `reset()` re-arms them (see `run-controller.ts`'s "Stop
 * and the same-thread cancellation caveat" doc comment). `spec/rendering.md` defines "pause" as a
 * *resumable* control ("stop consuming new events after the current step boundary"), distinct
 * from cancellation — so labeling this affordance "Pause" (icon `⏸`, `aria-pressed="true"` as a
 * held-down toggle) promised a resume that never existed: there is no `resume()`, and a learner
 * pressing what looks like "Pause" and expecting to continue instead finds the run permanently
 * halted. This slice renames it to the honest "Stop" (icon `⏹`) and **removes `aria-pressed`
 * entirely** rather than merely setting it to `false`: `aria-pressed` (at any value, including
 * `"false"`) tells assistive technology this is a *toggle* button with two states it switches
 * between — exactly the resumable-pause semantics being disavowed. A plain one-shot action button
 * (no `aria-pressed` at all) is the only honest ARIA role for a control that cancels and can never
 * be "un-pressed" back to a running state.
 *
 * ## Scope boundary
 * This is presentation over the existing tested run-controller only. It does **not** add a
 * pause/resume method, does not change `run()`/`stop()`/`reset()` behavior, and does not touch the
 * event stream or conformance — the toggle's "Stop" affordance is a learner-facing label for the
 * same `stop()` call the old Stop button already made. There is still no `step()`/"Next step" UI
 * here, and no genuine resumable pause — both are deliberately deferred to the Studio stepper Wave
 * 1 milestone (#12/#302), not poached by this bug-fix slice (per `a11y.ts`'s doc comment).
 */

import type { RunStatus } from "./state-model.js";

/** Which existing `RunController` method a toggle click should invoke. */
export type RunToggleAction = "run" | "stop";

/** Which icon a toggle click should invoke. */
export type RunToggleIcon = "play" | "stop";

/** The toggle button's fully-decided presentation for one `RunStatus` value. */
export interface RunToggleViewModel {
  /** The existing `RunController` method a click should invoke. */
  readonly action: RunToggleAction;
  /** The icon shown on the button. */
  readonly icon: RunToggleIcon;
  /** The visible text label. */
  readonly label: string;
  /** The accessible name (`aria-label`) — present even though the icon is decorative. */
  readonly ariaLabel: string;
}

/** The toggle's view model for every internal {@link RunStatus} value. */
export const RUN_TOGGLE_VIEW_MODELS: Readonly<
  Record<RunStatus, RunToggleViewModel>
> = {
  idle: {
    action: "run",
    icon: "play",
    label: "Start",
    ariaLabel: "Start run",
  },
  running: {
    action: "stop",
    icon: "stop",
    label: "Stop",
    ariaLabel: "Stop run",
  },
  done: {
    action: "run",
    icon: "play",
    label: "Start",
    ariaLabel: "Start run",
  },
  stopped: {
    action: "run",
    icon: "play",
    label: "Start",
    ariaLabel: "Start run",
  },
};

/**
 * Maps an internal {@link RunStatus} to the Start/Stop toggle button's fully-decided presentation
 * (#316, relabeled by #410) — a plain lookup, never a decision `web/main.ts` needs to make itself.
 */
export function mapRunStatusToRunToggleViewModel(
  runStatus: RunStatus,
): RunToggleViewModel {
  return RUN_TOGGLE_VIEW_MODELS[runStatus];
}
