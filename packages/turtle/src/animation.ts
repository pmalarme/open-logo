/**
 * The animation / execution-control layer: a deterministic **cursor over the same normative
 * trace/event stream** the state (`state.ts`) and scene (`scene.ts`) reducers fold —
 * `spec/rendering.md`'s "Animation and execution control" section: "Animation is a presentation
 * of the event stream; it is not a different execution semantics." This module never re-derives
 * or reshapes events; it only decides *how much* of the already-produced stream has been
 * consumed and *how fast* to consume more of it. Running a deterministic program instantly,
 * slowly, or step-by-step MUST fold to the identical final retained scene — that invariant is
 * why this layer reuses {@link reduceTurtleState}/{@link reduceTurtleScene} incrementally
 * (folding only the newly consumed events each step) rather than re-reducing any prefix, and why
 * it never skips, coalesces, or reorders events regardless of speed.
 *
 * Kept dependency- and timer-free: real-time pacing is an injected {@link Scheduler} function
 * rather than a `setTimeout`/`requestAnimationFrame` call, so the package stays headless and
 * deterministic (100% coverage doesn't need a real clock) — wiring a real DOM/host timer is
 * `@openlogo/studio`'s job, not this package's.
 */

import {
  INITIAL_TURTLE_SCENE,
  reduceTurtleScene,
  type TurtleScene,
} from "./scene.js";
import {
  INITIAL_TURTLE_STATE,
  reduceTurtleState,
  type TurtleState,
} from "./state.js";

import type { TraceEvent } from "@openlogo/core";

/**
 * Schedules `callback` to run after `delayMs` and returns a function that cancels it if it
 * hasn't fired yet. Real hosts inject a `setTimeout`/`requestAnimationFrame`-backed scheduler;
 * {@link IMMEDIATE_SCHEDULER} (the default) invokes `callback` synchronously so unit tests and
 * "run instantly" playback need no real clock.
 */
export type Scheduler = (callback: () => void, delayMs: number) => () => void;

/**
 * The default {@link Scheduler}: invokes `callback` synchronously and returns a no-op cancel
 * function. Running with this scheduler consumes the whole remaining stream in one call — the
 * same outcome as {@link TurtleAnimationController.seekToEnd}, matching the spec's "running
 * instantly … MUST produce the same final retained scene" requirement.
 */
export const IMMEDIATE_SCHEDULER: Scheduler = (callback) => {
  callback();
  return () => {
    // Already fired synchronously; nothing pending to cancel.
  };
};

/** Playback status of a {@link TurtleAnimationController}. */
export type PlaybackStatus = "idle" | "running" | "paused" | "done";

const MIN_STEPS_PER_SECOND = 0.001;
const MAX_STEPS_PER_SECOND = 1000;
const DEFAULT_STEPS_PER_SECOND = 1;

/**
 * Clamps `stepsPerSecond` into a sane positive range instead of raising a diagnostic — speed is
 * presentation pacing, not a source-level input, so an out-of-range value is corrected rather
 * than treated as a learner error (no `ol-*` code applies here).
 */
function clampSpeed(stepsPerSecond: number): number {
  if (!Number.isFinite(stepsPerSecond) || stepsPerSecond <= 0) {
    return MIN_STEPS_PER_SECOND;
  }
  return Math.min(
    MAX_STEPS_PER_SECOND,
    Math.max(MIN_STEPS_PER_SECOND, stepsPerSecond),
  );
}

/** Options for constructing a {@link TurtleAnimationController}. */
export interface TurtleAnimationOptions {
  /** Turtle state to start from; defaults to {@link INITIAL_TURTLE_STATE}. */
  readonly initialState?: TurtleState;
  /** Retained scene to start from; defaults to {@link INITIAL_TURTLE_SCENE}. */
  readonly initialScene?: TurtleScene;
  /** Pacing scheduler; defaults to {@link IMMEDIATE_SCHEDULER}. */
  readonly scheduler?: Scheduler;
  /** Initial speed in steps per second; clamped into range, defaults to `1`. */
  readonly stepsPerSecond?: number;
}

/** A point-in-time read of a {@link TurtleAnimationController}'s playback and folded state. */
export interface AnimationSnapshot {
  /** Number of events consumed so far (an index into the controller's event array). */
  readonly cursor: number;
  /** Current playback status. */
  readonly status: PlaybackStatus;
  /** Turtle state folded from every event consumed so far. */
  readonly state: TurtleState;
  /** Retained scene folded from every event consumed so far. */
  readonly scene: TurtleScene;
}

/**
 * A deterministic pacing/cursor player over a fixed, already-produced `TraceEvent` array.
 *
 * This is **not** a second reduction: {@link TurtleState} and {@link TurtleScene} are always
 * derived by folding the same `reduceTurtleState`/`reduceTurtleScene` functions the sibling
 * reducers export, incrementally over just the newly consumed events on each step — so the
 * controller stays O(n) total across a full run (never re-reducing an already-folded prefix)
 * and can never diverge from what a direct `reduceTurtleEvents`/`reduceSceneEvents` call over
 * the same events would produce.
 *
 * Step boundaries follow `spec/rendering.md`/`spec/execution-model.md` exactly: one step is an
 * `instruction` event plus every effect event up to (but not including) the next `instruction`
 * event or the end of the stream. Speed changes only how {@link run} paces those same steps —
 * it never skips an event or changes where a step boundary falls.
 */
export class TurtleAnimationController {
  private readonly events: readonly TraceEvent[];
  private readonly initialState: TurtleState;
  private readonly initialScene: TurtleScene;
  private readonly scheduler: Scheduler;
  private speed: number;
  private cursor = 0;
  private state: TurtleState;
  private scene: TurtleScene;
  private status: PlaybackStatus = "idle";
  private cancelPending: (() => void) | null = null;

  constructor(
    events: readonly TraceEvent[],
    options: TurtleAnimationOptions = {},
  ) {
    this.events = events;
    this.initialState = options.initialState ?? INITIAL_TURTLE_STATE;
    this.initialScene = options.initialScene ?? INITIAL_TURTLE_SCENE;
    this.scheduler = options.scheduler ?? IMMEDIATE_SCHEDULER;
    this.speed = clampSpeed(options.stepsPerSecond ?? DEFAULT_STEPS_PER_SECOND);
    this.state = this.initialState;
    this.scene = this.initialScene;
  }

  /** Reads the current cursor, status, and folded state/scene without changing anything. */
  getSnapshot(): AnimationSnapshot {
    return {
      cursor: this.cursor,
      status: this.status,
      state: this.state,
      scene: this.scene,
    };
  }

  /** Sets the pacing speed (steps per second), clamped into a sane positive range. */
  setSpeed(stepsPerSecond: number): void {
    this.speed = clampSpeed(stepsPerSecond);
  }

  /** Reads the current pacing speed (steps per second), after clamping. */
  getSpeed(): number {
    return this.speed;
  }

  /**
   * Consumes exactly one step: the event at the cursor plus every following event up to (but
   * not including) the next `instruction` event or the end of the stream — matching
   * `spec/rendering.md`'s worked `repeat 4 [ forward 100 right 90 ]` example, where stepping
   * once at `forward 100` consumes only that instruction's `move`/`draw-segment` effects and
   * leaves `right 90` as a separate, not-yet-consumed step. A no-op once playback is `"done"`.
   * Cancels any step scheduled by a prior {@link run} first, so a manual step can never race
   * with — and be double-consumed by — a stale scheduled tick. After a manual step call,
   * playback holds at `"paused"` (or `"done"` if that step exhausted the stream) — see
   * {@link consumeOneStep}, which {@link run} also drives without forcing `"paused"` in
   * between automated steps.
   */
  step(): void {
    if (this.status === "done") {
      return;
    }
    this.cancelScheduledStep();
    const exhausted = this.consumeOneStep();
    this.status = exhausted ? "done" : "paused";
  }

  /**
   * The actual step-consumption logic, shared by {@link step} and {@link driveRun}. Advances
   * the cursor across one instruction-step (see {@link step}'s doc comment for the exact
   * boundary rule) and folds the newly consumed events into the running state/scene. Returns
   * whether the stream is now exhausted. Deliberately does **not** touch {@link status} itself
   * — {@link step} sets `"paused"`/`"done"` for a single manual step, while {@link driveRun}
   * keeps `"running"` across every automated step until the stream is exhausted or `pause`/
   * `reset` intervenes, so continuous playback doesn't stall after its first tick.
   */
  private consumeOneStep(): boolean {
    if (this.cursor >= this.events.length) {
      return true;
    }
    let end = this.cursor + 1;
    while (
      end < this.events.length &&
      this.events[end]?.kind !== "instruction"
    ) {
      end++;
    }
    this.applyRange(this.cursor, end);
    this.cursor = end;
    return this.cursor >= this.events.length;
  }

  /**
   * Starts (or resumes) continuous playback: consumes steps at the current {@link setSpeed}
   * pacing until paused, cancelled, or the stream is exhausted. A no-op once playback is
   * already `"running"` or `"done"` — calling `run` again while already running must never
   * schedule a second, overlapping drive loop (which would leak an uncancellable pending step
   * once {@link pause} only has a handle to the newest one). With the default
   * {@link IMMEDIATE_SCHEDULER} this drains the whole remaining stream synchronously in one
   * call — behaviorally identical to {@link seekToEnd} — matching the spec's "running
   * instantly … MUST produce the same final retained scene" requirement.
   */
  run(): void {
    if (this.status === "running" || this.status === "done") {
      return;
    }
    this.status = "running";
    this.driveRun();
  }

  /**
   * Stops consuming new events after the current event or step boundary; resuming with
   * {@link run} continues from exactly that point (the cursor is untouched). A no-op unless
   * playback is currently `"running"`.
   */
  pause(): void {
    if (this.status !== "running") {
      return;
    }
    this.status = "paused";
    this.cancelScheduledStep();
  }

  /**
   * Clears renderer runtime state and rewinds the cursor to the beginning, so the retained
   * event stream can be replayed from scratch. Also known as "replay" in
   * `spec/rendering.md`'s vocabulary — see {@link replay}.
   */
  reset(): void {
    this.cancelScheduledStep();
    this.cursor = 0;
    this.state = this.initialState;
    this.scene = this.initialScene;
    this.status = "idle";
  }

  /** Alias for {@link reset} — the spec names this control "reset/replay" as one control. */
  replay(): void {
    this.reset();
  }

  /**
   * Consumes every remaining step synchronously, ignoring pacing, until the stream is
   * exhausted. Produces the same final state/scene as stepping one-by-one or running at any
   * speed, for a deterministic program.
   */
  seekToEnd(): void {
    this.cancelScheduledStep();
    while (this.cursor < this.events.length) {
      this.step();
    }
    this.status = "done";
  }

  /**
   * Cancels a scheduled-but-not-yet-fired step, if any, and forgets its cancel handle. Shared
   * by every control ({@link step}, {@link pause}, {@link reset}, {@link seekToEnd}) that must
   * take over the cursor from a `run()` in progress, so a stale scheduled tick from before the
   * takeover can never fire and double-consume a step afterwards.
   */
  private cancelScheduledStep(): void {
    if (this.cancelPending) {
      this.cancelPending();
      this.cancelPending = null;
    }
  }

  /** Folds `events[start..end)` into the running state/scene, in order, one event at a time. */
  private applyRange(start: number, end: number): void {
    for (const event of this.events.slice(start, end)) {
      this.state = reduceTurtleState(this.state, event);
      this.scene = reduceTurtleScene(this.scene, event);
    }
  }

  /** Milliseconds to wait between steps at the current speed. */
  private delayMs(): number {
    return 1000 / this.speed;
  }

  /**
   * Drives continuous playback via the injected {@link Scheduler}, one step per scheduled
   * callback. Implemented as a trampoline rather than direct recursion: a scheduler that
   * invokes its callback synchronously (like {@link IMMEDIATE_SCHEDULER}) is detected via the
   * `firedSynchronously` flag and looped over directly, so a fully synchronous run consumes
   * `repeat 10000 [ forward 1 ]` in one call stack frame instead of one recursive frame per
   * step. A genuinely asynchronous scheduler instead returns after scheduling, and its callback
   * re-enters {@link driveRun} when it eventually fires.
   */
  private driveRun(): void {
    for (;;) {
      if (this.status !== "running") {
        return;
      }
      if (this.cursor >= this.events.length) {
        this.status = "done";
        return;
      }
      let firedSynchronously = false;
      let scheduledSynchronously = true;
      this.cancelPending = this.scheduler(() => {
        this.cancelPending = null;
        if (this.status !== "running") {
          // Superseded by pause/reset/step/seekToEnd since this tick was scheduled (or a
          // misbehaving scheduler ignored its own cancel handle) — do nothing rather than
          // double-consume a step that manual control already took over.
          return;
        }
        const exhausted = this.consumeOneStep();
        if (exhausted) {
          this.status = "done";
        }
        if (scheduledSynchronously) {
          firedSynchronously = true;
        } else {
          this.driveRun();
        }
      }, this.delayMs());
      scheduledSynchronously = false;
      if (!firedSynchronously) {
        return;
      }
    }
  }
}
