/**
 * The icon-based Run/Pause toggle button (#316) — presentation only, over the existing, unchanged
 * `run-controller.ts` (#126/#228). Studio previously showed separate "Run" and "Stop" buttons;
 * this module is the one tested place that collapses them into a single toggle, so `web/main.ts`
 * never branches on `runStatus` itself to decide the toggle's label/icon/accessible name/pressed
 * state, or which of `run()`/`stop()` a click should invoke (per this package's "thin, branch-free
 * wiring layer" rule).
 *
 * ## The mapping
 * {@link mapRunStatusToRunToggleViewModel} maps every internal `RunStatus`
 * (`state-model.ts`: `"idle" | "running" | "done" | "stopped"`) to a {@link RunToggleViewModel}:
 * - `"running"` shows the pause/stop affordance — label `"Pause"`, `icon: "pause"`,
 *   `ariaPressed: true`, and `action: "stop"` (clicking calls the existing `stop()`; this module
 *   adds no pause/resume semantics of its own — see the hard scope boundary below).
 * - every other status (`"idle"`, `"done"`, `"stopped"`) shows the play affordance — label
 *   `"Start"`, `icon: "play"`, `ariaPressed: false`, and `action: "run"` (clicking calls the
 *   existing `run()`).
 *
 * ## Scope boundary
 * This is presentation over the existing tested run-controller only. It does **not** add a
 * pause/resume method, does not change `run()`/`stop()`/`reset()` behavior, and does not touch the
 * event stream or conformance — the toggle's "pause" affordance is a learner-facing label for the
 * same `stop()` call the old Stop button already made. There is still no `step()`/"Next step" UI
 * here (deferred to Wave 1/#302, per `a11y.ts`'s doc comment).
 */

import type { RunStatus } from "./state-model.js";

/** Which existing `RunController` method a toggle click should invoke. */
export type RunToggleAction = "run" | "stop";

/** Which icon a toggle click should invoke. */
export type RunToggleIcon = "play" | "pause";

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
  /** The `aria-pressed` state a toggle button exposes to assistive technology. */
  readonly ariaPressed: boolean;
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
    ariaPressed: false,
  },
  running: {
    action: "stop",
    icon: "pause",
    label: "Pause",
    ariaLabel: "Pause run",
    ariaPressed: true,
  },
  done: {
    action: "run",
    icon: "play",
    label: "Start",
    ariaLabel: "Start run",
    ariaPressed: false,
  },
  stopped: {
    action: "run",
    icon: "play",
    label: "Start",
    ariaLabel: "Start run",
    ariaPressed: false,
  },
};

/**
 * Maps an internal {@link RunStatus} to the Start/Pause toggle button's fully-decided
 * presentation (#316) — a plain lookup, never a decision `web/main.ts` needs to make itself.
 */
export function mapRunStatusToRunToggleViewModel(
  runStatus: RunStatus,
): RunToggleViewModel {
  return RUN_TOGGLE_VIEW_MODELS[runStatus];
}
