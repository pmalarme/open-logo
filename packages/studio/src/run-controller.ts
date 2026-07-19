/**
 * The Run/Stop/Reset/Step controller (#126) — wires the shared studio state model (#123) to
 * `@openlogo/runtime`'s {@link execute} and the execution-safety gates issue #102 added
 * (`ExecuteOptions.instructionBudget`/`recursionDepthLimit`/`signal`,
 * `spec/execution-model.md:551-557`). This module composes the runtime only: it never
 * re-implements evaluation, and every printed value it surfaces is already in the runtime's own
 * canonical form (`printedForm`), never re-formatted here.
 *
 * ## Run
 * `run()` executes the shared state model's current `source` via `execute()` and reduces the
 * returned trace-event stream (`@openlogo/core`'s `OL_EVENT_KINDS`) down to exactly what this
 * slice surfaces: every `print` event's payload becomes one learner-visible `output` line
 * (`state.setOutput`), and the run's diagnostics (parse or runtime) replace the shared
 * `diagnostics` list unchanged — the diagnostics pane (#125) renders them, this module never
 * invents its own diagnostic shape.
 *
 * ## Stop and the same-thread cancellation caveat
 * `@openlogo/runtime`'s {@link CancellationSignal} is checked before every statement/loop pass
 * *within* a single `execute()` call, so it is the correct mechanism to cancel a loop already in
 * progress — but `execute()` is synchronous and never yields, so a same-thread caller (this
 * module, running in a browser's main thread with no Worker) cannot itself invoke `stop()` while
 * a `run()` call is on the stack; nothing else runs until `execute()` returns
 * (`ExecuteOptions.signal`'s doc comment in `@openlogo/runtime` explains why cross-thread shared
 * state, e.g. a Web Worker + `SharedArrayBuffer`/`Atomics`, is what a truly interruptible Stop
 * needs). This controller is honest about that: it does not promise to preempt an in-flight
 * synchronous call. What it *does* provide, both reliably:
 * - The **instruction budget** (`ExecuteOptions.instructionBudget`, default
 *   {@link DEFAULT_INSTRUCTION_BUDGET} unless overridden via {@link RunControllerOptions}) halts
 *   any `forever`/`repeat 10000 [ forward 1 ]`-shape runaway program with `ol-limit` well before
 *   it could hang the session — this is the mechanism that actually keeps a same-thread studio
 *   responsive, budget bound rather than button-press bound.
 * - `stop()` flips a signal this controller owns for its whole lifetime. Once cancelled, that
 *   signal *stays* cancelled — `run()` deliberately does not clear it — so calling `run()` again
 *   after a `stop()` halts immediately with `ol-limit`/`cancelled` rather than silently
 *   discarding the stop request; only `reset()` re-arms the signal for the next `run()`. This
 *   also makes the wiring itself fully headless-testable: `stop()` then `run()` deterministically
 *   reproduces "cancellation takes effect", exactly as it would if a future async/Worker executor
 *   flipped the same signal mid-loop.
 *
 * ## Reset
 * `reset()` clears `output`/`diagnostics` back to empty, re-arms the cancellation signal, and
 * sets `runStatus` to `"idle"` — deterministic, ready-for-next-`run()` state, per the issue's
 * Given/When/Then.
 *
 * ## Step
 * `@openlogo/runtime`'s `execute()` (issue #102's actual surface, confirmed against
 * `packages/runtime/src/index.ts`/`execute-internal.ts`) exposes no per-instruction pause/resume
 * API: a single call runs the whole program synchronously to completion and returns the full
 * event stream at once. There is no supported point to "advance one step" from without the
 * runtime exposing one, so `step()` is a documented no-op for this slice rather than a step
 * simulated by re-slicing the already-complete event stream (which would not actually pause
 * execution and would misrepresent stepping the runtime doesn't support). A follow-up issue
 * should track real step-through once the runtime grows an incremental execution entry point.
 */

import { execute, printedForm } from "@openlogo/runtime";
import type { CancellationSignal, ExecuteOptions } from "@openlogo/runtime";
import type { PrintPayload, TraceEvent } from "@openlogo/core";
import type { AppShell } from "./app-shell.js";
import type { StudioStateStore } from "./state-model.js";

/** The document identifier passed to `execute()` when the caller doesn't supply one. */
export const DEFAULT_RUN_DOCUMENT = "studio-session";

/** Optional configuration for {@link createRunController}. */
export interface RunControllerOptions {
  /** The document identifier passed to `execute()`. Defaults to {@link DEFAULT_RUN_DOCUMENT}. */
  readonly document?: string;
  /** Overrides `ExecuteOptions.instructionBudget` for every `run()` call. */
  readonly instructionBudget?: number;
  /** Overrides `ExecuteOptions.recursionDepthLimit` for every `run()` call. */
  readonly recursionDepthLimit?: number;
}

/** A mutable {@link CancellationSignal} this controller owns and flips via `stop()`/`reset()`. */
interface MutableCancellationSignal extends CancellationSignal {
  aborted: boolean;
}

/** The headless Run/Stop/Reset/Step controller over the shared state model. */
export interface RunController {
  /** The single studio state model instance this controller reads/writes through. */
  readonly state: StudioStateStore;
  /** Execute the current `source` via `@openlogo/runtime` and surface its output/diagnostics. */
  run(): void;
  /**
   * Request cancellation. Flips the cancellation signal `run()` passes to `execute()` (honored
   * immediately by an already-cancelled signal on the *next* `run()`, per this module's
   * same-thread caveat) and sets `runStatus` to `"stopped"` so the UI reflects the request right
   * away.
   */
  stop(): void;
  /** Clear output/diagnostics, re-arm cancellation, and return `runStatus` to `"idle"`. */
  reset(): void;
  /** No-op: #102's `execute()` exposes no per-instruction pause/resume API. See module doc. */
  step(): void;
}

function isPrintEvent(
  event: TraceEvent,
): event is TraceEvent<PrintPayload> & { readonly kind: "print" } {
  return event.kind === "print";
}

/** Reduce a trace-event stream down to one learner-visible output line per `print` event. */
function collectOutput(events: readonly TraceEvent[]): string[] {
  const output: string[] = [];
  for (const event of events) {
    if (isPrintEvent(event)) {
      output.push(event.payload.values.map(printedForm).join(" "));
    }
  }
  return output;
}

/** Construct the Run/Stop/Reset/Step controller over an existing state model (never a copy). */
export function createRunController(
  state: StudioStateStore,
  options?: RunControllerOptions,
): RunController {
  const document = options?.document ?? DEFAULT_RUN_DOCUMENT;
  const signal: MutableCancellationSignal = { aborted: false };

  function run(): void {
    state.setRunStatus("running");

    const execOptions: ExecuteOptions = {
      signal,
      ...(options?.instructionBudget !== undefined
        ? { instructionBudget: options.instructionBudget }
        : {}),
      ...(options?.recursionDepthLimit !== undefined
        ? { recursionDepthLimit: options.recursionDepthLimit }
        : {}),
    };

    const result = execute(state.getState().source, document, execOptions);

    state.setOutput(collectOutput(result.events));
    state.setDiagnostics(result.diagnostics);
    state.setRunStatus(
      result.diagnostics.some((diagnostic) => diagnostic.code === "ol-limit")
        ? "stopped"
        : "idle",
    );
  }

  function stop(): void {
    signal.aborted = true;
    state.setRunStatus("stopped");
  }

  function reset(): void {
    signal.aborted = false;
    state.setOutput([]);
    state.setDiagnostics([]);
    state.setRunStatus("idle");
  }

  function step(): void {
    // Intentional no-op — see this module's doc comment ("## Step").
  }

  return { state, run, stop, reset, step };
}

/** Compose the run controller into the shell's `repl` region (the run/output surface). */
export function mountRunController(
  shell: AppShell,
  controller: RunController,
): void {
  shell.mount("repl", controller);
}
