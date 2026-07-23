/**
 * The icon-based Run/Stop toggle button (#316, relabeled honestly by #410, restart-wired by #432
 * finding 1) — presentation only, over the existing, unchanged `run-controller.ts` (#126/#228).
 * Studio previously showed separate "Run" and "Stop" buttons; this module is the one tested place
 * that collapses them into a single toggle, so `web/main.ts` never branches on `runStatus` itself
 * to decide the toggle's label/icon/accessible name, or which `RunController` method(s) a click
 * should invoke (per this package's "thin, branch-free wiring layer" rule).
 *
 * ## The mapping
 * {@link mapRunStatusToRunToggleViewModel} maps every internal `RunStatus`
 * (`state-model.ts`: `"idle" | "running" | "done" | "stopped"`) to a {@link RunToggleViewModel}:
 * - `"running"` shows the Stop affordance — label `"Stop"`, `icon: "stop"`, and `action: "stop"`
 *   (clicking calls the existing `stop()`; this module adds no pause/resume semantics of its own —
 *   see the hard scope boundary below).
 * - `"idle"`/`"done"` show the play affordance — label `"Start"`, `icon: "play"`, and
 *   `action: "run"` (clicking calls the existing `run()`, a genuine first/next run — there is
 *   nothing to discard first).
 * - `"stopped"` ALSO shows the play affordance and the identical `"Start"` label/`"play"` icon/
 *   `"Start run"` aria-label — but a DIFFERENT `action: "restart"` (#432 finding 1, see below).
 *
 * ## #432 finding 1 — "Start" after Stop must actually start, not instantly re-halt
 * Before this fix, `stopped` mapped to the same `action: "run"` as `idle`/`"done"`, so a learner
 * who pressed Stop and then pressed the now-"Start"-labeled button again invoked `run()` directly.
 * But `run()` deliberately never re-arms `signal.aborted` itself — only `reset()` does (see
 * `run-controller.ts`'s "Stop and the same-thread cancellation caveat" doc comment, an intentional
 * contract this fix preserves byte-for-byte: a DIRECT `stop()` then `run()` call must still halt
 * deterministically with an immediate `ol-limit`/`cancelled` diagnostic, exactly as
 * `run-controller.test.mjs` already asserts). The result was a button honestly labeled "Start"
 * that, when pressed, instantly re-cancelled and left the studio stuck at `"stopped"` again — the
 * accessible name promised a fresh run and delivered the opposite. The fix routes the `stopped`
 * toggle to a NEW `"restart"` action instead: {@link createRunToggleActionHandlers} maps it to
 * `reset()` immediately followed by `run()`, so a press from `"stopped"` re-arms cancellation
 * first and then genuinely starts over — no immediate halt, matching what "Start" has always
 * promised. `"done"`'s mapping to plain `run()` is unchanged (there is nothing stale to discard:
 * `run()` from `"done"` already runs fresh, since nothing set `signal.aborted`).
 *
 * ## #410 — "Pause" was dishonest; this is Stop, not resumable pause
 * The button's `"running"`-state `action` has always been `stop()`, which latches
 * `signal.aborted` and `userStopped` **irreversibly** — only `reset()` re-arms them. `spec/
 * rendering.md` defines "pause" as a *resumable* control ("stop consuming new events after the
 * current step boundary"), distinct from cancellation — so labeling this affordance "Pause" (icon
 * `⏸`, `aria-pressed="true"` as a held-down toggle) promised a resume that never existed: there is
 * no `resume()`, and a learner pressing what looks like "Pause" and expecting to continue instead
 * finds the run permanently halted. This slice renamed it to the honest "Stop" (icon `⏹`) and
 * **removes `aria-pressed` entirely** rather than merely setting it to `false`: `aria-pressed` (at
 * any value, including `"false"`) tells assistive technology this is a *toggle* button with two
 * states it switches between — exactly the resumable-pause semantics being disavowed. A plain
 * one-shot action button (no `aria-pressed` at all) is the only honest ARIA role for a control that
 * cancels and can never be "un-pressed" back to a running state.
 *
 * ## Scope boundary
 * This is presentation over the existing tested run-controller only. It does **not** add a
 * pause/resume method, does not change `run()`/`stop()`/`reset()`'s own behavior (the `"restart"`
 * action above composes those two existing methods, unchanged, in sequence — it adds no new
 * control-flow to `run-controller.ts` itself), and does not touch the event stream or conformance.
 * There is still no `step()`/"Next step" UI here, and no genuine resumable pause — both are
 * deliberately deferred to the Studio stepper Wave 1 milestone (#12/#302), not poached by this
 * bug-fix slice (per `a11y.ts`'s doc comment).
 */

import type { RunController } from "./run-controller.js";
import type { RunStatus } from "./state-model.js";

/** Which existing `RunController` method (or composed sequence) a toggle click should invoke. */
export type RunToggleAction = "run" | "stop" | "restart";

/** Which icon a toggle click should invoke. */
export type RunToggleIcon = "play" | "stop";

/** The toggle button's fully-decided presentation for one `RunStatus` value. */
export interface RunToggleViewModel {
  /** The existing `RunController` method (or composed sequence) a click should invoke. */
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
    // #432 finding 1 — same honest "Start" label/icon/aria-label as idle/done, but a distinct
    // action: pressing Start after a Stop must genuinely start over, which requires re-arming
    // cancellation (reset()) before running — see this module's doc comment.
    action: "restart",
    icon: "play",
    label: "Start",
    ariaLabel: "Start run",
  },
};

/**
 * Maps an internal {@link RunStatus} to the Start/Stop toggle button's fully-decided presentation
 * (#316, relabeled by #410, restart-wired by #432 finding 1) — a plain lookup, never a decision
 * `web/main.ts` needs to make itself.
 */
export function mapRunStatusToRunToggleViewModel(
  runStatus: RunStatus,
): RunToggleViewModel {
  return RUN_TOGGLE_VIEW_MODELS[runStatus];
}

/**
 * Build the click handler for every {@link RunToggleAction}, bound to one `RunController` (#432
 * finding 1). This is the ONE place `"restart"` is composed into `reset()` then `run()` — moved
 * out of `web/main.ts`'s DOM-glue (untested by this repository's `node:test` suite, since there is
 * no jsdom) and into this already fully headless-tested module, so the actual wiring decision is
 * verifiable without a browser: a Stop→Start press must genuinely start a fresh run, never
 * re-trigger `run()`'s deliberate no-auto-rearm halt. `web/main.ts` only looks up
 * `mapRunStatusToRunToggleViewModel(...).action` and invokes
 * `handlers[action]()` — it makes no decision of its own.
 */
export function createRunToggleActionHandlers(
  runController: Pick<RunController, "run" | "stop" | "reset">,
): Readonly<Record<RunToggleAction, () => void>> {
  return {
    run: () => runController.run(),
    stop: () => runController.stop(),
    restart: () => {
      runController.reset();
      runController.run();
    },
  };
}
