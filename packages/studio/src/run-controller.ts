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
 * ## #334 — injecting `@openlogo/edu`'s tutor templates + surfacing `tutor-output`
 * `prepare()` passes `tutor-output-pane.ts`'s {@link eduTutorTemplate} as
 * `ExecuteOptions.tutorTemplates` (A2, #332's injectable seam) so `explain`/`why`/`hint`/`debug`
 * emit `@openlogo/edu`'s real curriculum-quality prose instead of the runtime's minimal built-in
 * `defaultTutorTemplate` fallback — this module still never chooses that pedagogy itself, it only
 * composes the HOST's template into the runtime call, exactly as it already composes
 * `instructionBudget`/`recursionDepthLimit`/`signal`. Every `tutor-output` event the run emits is
 * then reduced (mirroring `collectOutput`'s `print`-event reduction) into the shared state model's
 * `tutorOutput` field (`state.setTutorOutput`) — `tutor-output-pane.ts`'s controller is what
 * accumulates these across runs into the pane's growing, learner-visible history.
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
 * ## #228 — driving the turtle Canvas view (#218) in lockstep
 * `execute()` still runs the whole program atomically in one synchronous call and returns the
 * *complete* trace-event stream at once — that hasn't changed, and this module still never
 * re-implements evaluation. What #228 adds is a **replay** of that already-complete stream through
 * `@openlogo/turtle`'s published `TurtleAnimationController` (#216), so the same one event stream
 * that already drives `output`/`diagnostics` also drives the Canvas pane, in lockstep:
 * - `run()` builds a `TurtleAnimationController` over the run's `result.events` and starts it via
 *   `@openlogo/turtle`'s `playWithMotionPreference` (honoring {@link RunControllerOptions.reducedMotion}).
 *   Every consumed tick pushes the controller's folded `state`/`scene` into the shared state model
 *   via `setTurtleState`/`setTurtleScene` (#218) and, if a {@link RunControllerOptions.canvasView}
 *   was supplied, calls its `repaint()` immediately — the same composition seam #218 published,
 *   invoked directly rather than duplicated.
 * - `step()` is no longer a no-op: it now realizes what its old doc comment deferred, by advancing
 *   the **animation** one instruction-step over the already-complete stream (never the runtime,
 *   which exposes no per-instruction pause/resume API) and pushing the resulting snapshot.
 * - `stop()` additionally pauses the animation (`TurtleAnimationController.pause()`), so a
 *   still-advancing Canvas view halts at exactly the same point the cancellation signal takes
 *   over the underlying `execute()` call — see `TurtleAnimationController`'s own doc comment for
 *   why a stale scheduled tick can never fire after `pause()` and double-advance the picture.
 * - `reset()` additionally resets the animation and restores `turtleState`/`turtleScene` to
 *   `@openlogo/turtle`'s program-start defaults, repainting a blank Canvas alongside the rest of
 *   the studio state clearing.
 * - The default {@link RunControllerOptions.scheduler} is `@openlogo/turtle`'s
 *   `IMMEDIATE_SCHEDULER`, which drains the whole animation synchronously within `run()` —
 *   preserving #126's existing "run() returns already complete" behavior for this headless slice
 *   and every existing test. A real browser entry point injects a `setTimeout`-backed
 *   {@link Scheduler} for actual paced playback; `@openlogo/turtle` stays timer-free (studio owns
 *   the DOM/timer side, the same boundary #218 drew for the canvas context).
 * - `runStatus` still reflects `execute()`'s own completion (`"done"`/`"stopped"`, from the run's
 *   diagnostics — #311 renamed the non-`stop()` completion value from `"idle"` to a distinct
 *   `"done"`, see `state-model.ts`'s `RunStatus` doc comment) exactly as #126 established — but
 *   with a real paced scheduler that flip is deferred until the *animation* itself actually
 *   reaches its own (unrelated, `@openlogo/turtle`-owned) `"done"` status (or `stop()` fires, which
 *   sets `"stopped"` immediately), so a paced Canvas view mid-animation is not reported as already
 *   finished. With the default synchronous scheduler this happens within the same `run()` call,
 *   matching every pre-#228 test unchanged. `output`/`diagnostics` are still set synchronously and
 *   in full the moment `execute()` returns (unchanged from #126) — they were never paced to begin
 *   with, so there is nothing for them to desync from while the Canvas animation continues to play
 *   out the same already-computed stream.
 *
 * ## #310 — a configurable turtle-speed slider
 * Before this slice, `TurtleAnimationController`'s own pacing (`stepsPerSecond`/`setSpeed`) was
 * never wired from studio's side — every run played back at whatever pace the injected
 * `Scheduler` happened to use. `prepare()` now reads the shared state model's `speedSliderValue`
 * and maps it (`turtle-speed.ts`'s {@link mapSpeedSliderValueToTickDelayMs}, the one tested place
 * that owns this decision) to a per-tick delay, remembering whether that delay counts as
 * "instant" ({@link isInstantTickDelay}) for `run()` to use. A **paced** delay becomes the
 * `TurtleAnimationController`'s `stepsPerSecond` option (via
 * {@link tickDelayMsToStepsPerSecond}); an **instant** delay is never passed as `stepsPerSecond`
 * at all (that would require an infinite/zero value the controller's own speed-clamping cannot
 * represent) — instead `run()` combines it into the existing `reducedMotion` flag it already
 * passes to `playWithMotionPreference` (`instant || (options?.reducedMotion ?? false)`), which
 * already knows how to paint a finished scene instantly via `seekToEnd()`. This makes the
 * slider's "instant / no animation" end **complement**, not replace, the OS-level
 * `prefers-reduced-motion` path: either one alone is enough to force instant playback, and
 * neither overrides the other's own reasoning for wanting it.
 *
 * ## #289 — `step()` from the initial idle state (before any `run()`)
 * `run()`'s body was always two halves: *prepare* (execute the source, surface output/diagnostics,
 * build a fresh `TurtleAnimationController` over the run's event stream) and *play* (start that
 * controller animating via `playWithMotionPreference`). `step()` used to only ever operate on an
 * animation `run()` had already prepared, so pressing "Next step" before the first `run()` was a
 * silent no-op — confusing from a blank studio. The *prepare* half is now its own private
 * `prepare()` helper, shared by both: `run()` still calls `prepare()` then immediately plays the
 * result, unchanged; `step()` now calls `prepare()` itself, lazily, whenever no animation exists
 * yet (i.e. `animation` is still `null`, exactly the state `reset()`/program-start leave it in),
 * then steps the (freshly prepared or already-running) animation by one instruction. This makes
 * `step()` a genuine "run one instruction" affordance from a blank studio, not just a scrubber over
 * an animation `run()` must have already started.
 *
 * ## #314 — `run()` never overlaps a still-animating run
 * With a real paced `Scheduler` (the browser's `setTimeout`-backed one; the default
 * {@link IMMEDIATE_SCHEDULER} never leaves this window open), `runStatus` stays `"running"` for the
 * whole animation, across many event-loop turns — during which a learner could press **Run** again.
 * Before this guard, a second `run()` call would silently `prepare()` a brand-new run mid-animation:
 * `output`/`diagnostics` would jump straight to the *second* run's results while the first run's
 * animation was still playing, and the first `TurtleAnimationController` would be orphaned (its
 * already-scheduled ticks still fire, racing the new one). The run log (`run-log.ts`) depends on
 * observing exactly one `"running"` → terminal transition per completed run — an overlapping second
 * `run()` would silently absorb the first run into the second's entry, losing it entirely, which
 * directly contradicts the "keeps the earlier run" acceptance criterion. `run()` now simply ignores
 * a call while `runStatus` is already `"running"`, so a run always finishes (or is `stop()`ped)
 * before another can start — the same "Stop is the only way to interrupt" contract the instruction
 * budget already gives a runaway program, now also guaranteed against a same-thread double-click.
 */

import { execute, printedForm } from "@openlogo/runtime";
import type { CancellationSignal, ExecuteOptions } from "@openlogo/runtime";
import type {
  PrintPayload,
  TraceEvent,
  TutorOutputPayload,
} from "@openlogo/core";
import {
  IMMEDIATE_SCHEDULER,
  INITIAL_TURTLE_SCENE,
  INITIAL_TURTLE_STATE,
  playWithMotionPreference,
  TurtleAnimationController,
} from "@openlogo/turtle";
import type { Scheduler } from "@openlogo/turtle";
import type { AppShell } from "./app-shell.js";
import type { CanvasViewController } from "./canvas-view.js";
import type { RunStatus, StudioStateStore } from "./state-model.js";
import { eduTutorTemplate } from "./tutor-output-pane.js";
import {
  isInstantTickDelay,
  mapSpeedSliderValueToTickDelayMs,
  tickDelayMsToStepsPerSecond,
} from "./turtle-speed.js";

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
  /**
   * Paces the turtle Canvas view (#228) alongside the run's output/diagnostics. Defaults to
   * `@openlogo/turtle`'s `IMMEDIATE_SCHEDULER`, which drains the whole animation synchronously
   * within `run()` (preserving #126's existing run-completes-synchronously behavior for this
   * headless slice). Inject a real `setTimeout`/`requestAnimationFrame`-backed `Scheduler` for
   * genuine paced playback in a browser; `@openlogo/turtle` itself stays timer-free.
   */
  readonly scheduler?: Scheduler;
  /**
   * When `true`, `run()` paints the final turtle scene instantly instead of pacing per-step ticks
   * (`@openlogo/turtle`'s `playWithMotionPreference`) — wire this to the browser's
   * `prefers-reduced-motion` media query (#227). Defaults to `false`. Combined with (never
   * replaced by) the shared state model's `speedSliderValue` (#310): a run paints instantly when
   * *either* this option is `true` *or* the slider is at its dedicated "instant" position — see
   * this module's doc comment ("#310").
   */
  readonly reducedMotion?: boolean;
  /**
   * The Canvas view controller (#218) to keep in lockstep with the run. When supplied,
   * `run()`/`step()`/`reset()` call `canvasView.repaint()` immediately after updating the shared
   * state model's `turtleState`/`turtleScene`, so the pane never shows a stale frame. Optional —
   * omit in tests that only assert the state model's turtle fields directly.
   */
  readonly canvasView?: CanvasViewController;
}

/** A mutable {@link CancellationSignal} this controller owns and flips via `stop()`/`reset()`. */
interface MutableCancellationSignal extends CancellationSignal {
  aborted: boolean;
}

/** The headless Run/Stop/Reset/Step controller over the shared state model. */
export interface RunController {
  /** The single studio state model instance this controller reads/writes through. */
  readonly state: StudioStateStore;
  /**
   * Execute the current `source` via `@openlogo/runtime` and surface its output/diagnostics, then
   * (#228) replay the same trace-event stream through a `TurtleAnimationController` so the Canvas
   * pane animates in lockstep — see this module's doc comment ("#228").
   */
  run(): void;
  /**
   * Request cancellation. Flips the cancellation signal `run()` passes to `execute()` (honored
   * immediately by an already-cancelled signal on the *next* `run()`, per this module's
   * same-thread caveat), pauses the in-progress turtle animation (#228) so the Canvas view halts
   * at the same point, and sets `runStatus` to `"stopped"` so the UI reflects the request right
   * away.
   */
  stop(): void;
  /**
   * Clear output/diagnostics, re-arm cancellation, reset the turtle animation and restore
   * `turtleState`/`turtleScene` to `@openlogo/turtle`'s program-start defaults (repainting the
   * Canvas view if one was supplied), and return `runStatus` to `"idle"`.
   */
  reset(): void;
  /**
   * Advance the turtle animation (#228) by exactly one instruction-step and push the resulting
   * snapshot, repainting the Canvas view if one was supplied. Once the animation is exhausted this
   * is a no-op (`TurtleAnimationController.step()`'s own guard) — see this module's doc comment
   * ("#228") for why this replays the already-complete event stream rather than stepping the
   * runtime, which exposes no per-instruction pause/resume API. `runStatus` stays `"stopped"` if
   * the learner already called `stop()`, even once stepping exhausts the animation — `step()`
   * never silently reverts an explicit stop back to a completed-run status.
   *
   * #289 — called before the first `run()` (i.e. from the initial idle state), `step()` no longer
   * no-ops: it first lazily runs `prepare()` (everything `run()` does short of actually starting
   * playback — executing the source, surfacing output/diagnostics, and building a fresh
   * `TurtleAnimationController` over the resulting event stream) and then steps that
   * freshly-prepared animation by one instruction, so pressing "Next step" from a blank studio
   * animates the very first instruction instead of doing nothing.
   */
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

function isTutorOutputEvent(
  event: TraceEvent,
): event is TraceEvent<TutorOutputPayload> & { readonly kind: "tutor-output" } {
  return event.kind === "tutor-output";
}

/**
 * Reduce a trace-event stream down to the ordered `tutor-output` payloads it carries (#334) —
 * every `explain`/`why`/`hint`/`debug` invocation's result, in emission order. Mirrors
 * {@link collectOutput}'s reduction pattern for `print` events above.
 */
function collectTutorOutput(
  events: readonly TraceEvent[],
): TutorOutputPayload[] {
  const tutorOutput: TutorOutputPayload[] = [];
  for (const event of events) {
    if (isTutorOutputEvent(event)) {
      tutorOutput.push(event.payload);
    }
  }
  return tutorOutput;
}

/** Construct the Run/Stop/Reset/Step controller over an existing state model (never a copy). */
export function createRunController(
  state: StudioStateStore,
  options?: RunControllerOptions,
): RunController {
  const document = options?.document ?? DEFAULT_RUN_DOCUMENT;
  const signal: MutableCancellationSignal = { aborted: false };

  // The current turtle animation player (#228), rebuilt fresh on every prepare() (called by
  // run(), and by step() lazily when nothing has started yet — #289) over that run's own
  // trace-event stream; null before the first run()/step() and after reset(). `finalRunStatus` is
  // the runStatus run() would already have committed pre-#228 (derived from the run's
  // diagnostics — #311 renamed the non-`stop()` outcome from `"idle"` to a distinct `"done"`, see
  // `state-model.ts`'s `RunStatus` doc comment), deferred here until the animation actually
  // finishes so a still-paced Canvas view is never reported as done/stopped early (see this
  // module's doc comment, "#228"). `userStopped` latches once `stop()` is called and is only
  // cleared by `run()`/`reset()`/a lazy `prepare()` from `step()` — it prevents a later `step()`
  // from silently overwriting an explicit stop back to `finalRunStatus` once the learner finishes
  // manually stepping through the rest of an already-stopped animation. `currentIsInstant` (#310)
  // is prepare()'s verdict on whether the current speedSliderValue maps to the dedicated "instant"
  // tick delay — run() reads it to OR-combine with RunControllerOptions.reducedMotion (see this
  // module's doc comment, "#310").
  let animation: TurtleAnimationController | null = null;
  let finalRunStatus: RunStatus = "idle";
  let userStopped = false;
  let currentIsInstant = false;

  /** Push `current`'s folded state/scene into the shared store and repaint (never called with a
   * null animation — callers only invoke this once `animation` has been assigned). */
  function pushTurtleSnapshot(current: TurtleAnimationController): void {
    const snapshot = current.getSnapshot();
    state.setTurtleState(snapshot.state);
    state.setTurtleScene(snapshot.scene);
    options?.canvasView?.repaint();
  }

  /**
   * Commit `finalRunStatus` once `current` has actually reached `"done"` — unless the learner
   * already called `stop()`, in which case `runStatus` stays `"stopped"` even if a subsequent
   * manual `step()` exhausts the animation (see `userStopped`'s doc comment above).
   */
  function maybeSettleRunStatus(current: TurtleAnimationController): void {
    if (!userStopped && current.getSnapshot().status === "done") {
      state.setRunStatus(finalRunStatus);
    }
  }

  function prepare(): TurtleAnimationController {
    state.setRunStatus("running");
    userStopped = false;

    const execOptions: ExecuteOptions = {
      signal,
      tutorTemplates: eduTutorTemplate,
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
    state.setTutorOutput(collectTutorOutput(result.events));
    finalRunStatus = result.diagnostics.some(
      (diagnostic) => diagnostic.code === "ol-limit",
    )
      ? "stopped"
      : "done";

    const baseScheduler = options?.scheduler ?? IMMEDIATE_SCHEDULER;
    let current: TurtleAnimationController;
    const scheduler: Scheduler = (callback, delayMs) =>
      baseScheduler(() => {
        callback();
        pushTurtleSnapshot(current);
        maybeSettleRunStatus(current);
      }, delayMs);

    const tickDelayMs = mapSpeedSliderValueToTickDelayMs(
      state.getState().speedSliderValue,
    );
    currentIsInstant = isInstantTickDelay(tickDelayMs);

    current = new TurtleAnimationController(result.events, {
      scheduler,
      // Only set stepsPerSecond for a genuinely paced speed — an "instant" tick delay has no
      // finite steps-per-second equivalent (see turtle-speed.ts's tickDelayMsToStepsPerSecond doc
      // comment) and is instead handled entirely through run()'s reducedMotion OR-combination.
      ...(currentIsInstant
        ? {}
        : { stepsPerSecond: tickDelayMsToStepsPerSecond(tickDelayMs) }),
    });
    animation = current;
    return current;
  }

  function run(): void {
    if (state.getState().runStatus === "running") {
      // #314 — a run is already in progress (only reachable with a real paced scheduler, where
      // runStatus stays "running" across many event-loop turns): ignore the extra call rather than
      // silently starting a second run mid-animation. See this module's doc comment, "#314".
      return;
    }
    const current = prepare();
    playWithMotionPreference(current, {
      reducedMotion: (options?.reducedMotion ?? false) || currentIsInstant,
    });
    pushTurtleSnapshot(current);
    maybeSettleRunStatus(current);
  }

  function stop(): void {
    signal.aborted = true;
    userStopped = true;
    animation?.pause();
    state.setRunStatus("stopped");
  }

  function reset(): void {
    signal.aborted = false;
    userStopped = false;
    state.setOutput([]);
    state.setDiagnostics([]);
    state.setTutorOutput([]);
    animation?.reset();
    animation = null;
    state.setTurtleState(INITIAL_TURTLE_STATE);
    state.setTurtleScene(INITIAL_TURTLE_SCENE);
    options?.canvasView?.repaint();
    state.setRunStatus("idle");
  }

  function step(): void {
    // #289 — from the initial idle state (before any run()), no animation exists yet: prepare()
    // lazily builds one (executing the CURRENT source exactly as run() would) so stepping from a
    // blank studio animates the first instruction instead of silently doing nothing. Once an
    // animation already exists (mid-run, paused, or exhausted), this is exactly the pre-#289
    // behavior: step the existing one, never rebuilding it from a possibly-changed source.
    const current = animation ?? prepare();
    current.step();
    pushTurtleSnapshot(current);
    maybeSettleRunStatus(current);
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
