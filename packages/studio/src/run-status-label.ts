/**
 * Maps the studio's internal run-status state machine (`state-model.ts`'s {@link RunStatus}:
 * `"idle"` / `"running"` / `"done"` / `"stopped"`) to the friendlier, learner-facing labels the
 * run-status region (`index.html`'s `#run-status`) displays — issue #311.
 *
 * The internal state-machine names are unchanged and keep their existing meaning everywhere else
 * (`run-controller.ts`, `a11y.ts`'s screen-reader announcements); this module is the **one**
 * tested place that decides the *presentation* label a learner actually reads, so `web/main.ts`
 * never branches on `runStatus` itself and stays a thin, branch-free wiring layer.
 *
 * | Internal `RunStatus` | Learner-facing label |
 * | --------------------- | --------------------- |
 * | `"idle"`               | `"Ready"`              |
 * | `"running"`            | `"Running"`            |
 * | `"done"`               | `"Complete"`           |
 * | `"stopped"`            | `"Stopped"`            |
 */

import type { RunStatus } from "./state-model.js";

/** The learner-facing label for every internal {@link RunStatus} value. */
export const RUN_STATUS_LABELS: Readonly<Record<RunStatus, string>> = {
  idle: "Ready",
  running: "Running",
  done: "Complete",
  stopped: "Stopped",
};

/**
 * Maps an internal {@link RunStatus} to its learner-facing label (issue #311) — a plain lookup,
 * never a decision `web/main.ts` needs to make itself.
 */
export function mapRunStatusToLabel(runStatus: RunStatus): string {
  return RUN_STATUS_LABELS[runStatus];
}
