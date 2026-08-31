/**
 * The animation / execution-control layer: a deterministic **cursor over the same normative
 * trace/event stream** the state (`state.ts`) and scene (`scene.ts`) reducers fold —
 * `spec/rendering.md`'s "Animation and execution control" section: "Animation is a presentation
 * of the event stream; it is not a different execution semantics." This module never re-derives
 * or reshapes events; it only decides *how much* of the already-produced stream has been
 * consumed and *how fast* to consume more of it. Running a deterministic program instantly,
 * slowly, or step-by-step MUST fold to the identical final retained scene — that invariant is
 * why this layer reuses {@link reduceTurtleWorldState}/{@link reduceSceneRange} incrementally
 * (folding only the newly consumed events each step) rather than re-reducing any prefix, and why
 * it never skips, coalesces, or reorders events regardless of speed.
 *
 * Kept dependency- and timer-free: real-time pacing is an injected {@link Scheduler} function
 * rather than a `setTimeout`/`requestAnimationFrame` call, so the package stays headless and
 * deterministic (100% coverage doesn't need a real clock) — wiring a real DOM/host timer is
 * `@openlogo/studio`'s job, not this package's.
 */

import {
  INITIAL_OVERLAY_STATE,
  reduceOverlayState,
  type OverlayState,
} from "./overlay.js";
import {
  INITIAL_TURTLE_SCENE,
  reduceSceneRange,
  type TurtleScene,
} from "./scene.js";
import { INITIAL_TURTLE_STATE, type TurtleState } from "./state.js";
import {
  MAIN_TURTLE_ID,
  type TurtleWorldState,
  lastActedTurtleState,
  reduceTurtleWorldState,
} from "./world-state.js";

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
  /**
   * Turtle state to start the **main turtle** from; defaults to {@link INITIAL_TURTLE_STATE}. It
   * seeds the world's {@link MAIN_TURTLE_ID} entry, which is also the initially last-acted turtle, so
   * a single-turtle caller's `initialState` still is exactly what `getSnapshot().state` reports
   * before any event is consumed.
   */
  readonly initialState?: TurtleState;
  /** Retained scene to start from; defaults to {@link INITIAL_TURTLE_SCENE}. */
  readonly initialScene?: TurtleScene;
  /** Overlay state to start from; defaults to {@link INITIAL_OVERLAY_STATE}. */
  readonly initialOverlay?: OverlayState;
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
  /**
   * The **last-acted** turtle's state as of every event consumed so far — the turtle whose
   * position/heading/pen the non-visual state description reports. With a single turtle that is
   * simply the main turtle's
   * folded state, unchanged from before per-turtle folding existed; under Sprites it is the turtle
   * the most recent per-turtle command drove, rather than every turtle's attributes merged
   * into one record. Which turtles are *addressed* is a separate question, answered by
   * {@link AnimationSnapshot.world}'s `addressedTurtleIds` (which the state description also names
   * whenever it is not simply this turtle).
   */
  readonly state: TurtleState;
  /** Every live turtle's own state, plus the addressed turtle set and the last-acted turtle, folded
   * from every event consumed so far. This is what a renderer paints avatars from. */
  readonly world: TurtleWorldState;
  /** Retained scene folded from every event consumed so far. */
  readonly scene: TurtleScene;
  /** Overlay state folded from every event consumed so far. */
  readonly overlay: OverlayState;
}

/**
 * A deterministic pacing/cursor player over a fixed, already-produced `TraceEvent` array.
 *
 * This is **not** a second reduction: {@link TurtleWorldState} and {@link TurtleScene} are always
 * derived by folding the same `reduceTurtleWorldState`/`reduceSceneRange` functions the sibling
 * reducers export, incrementally over just the newly consumed events (never re-reducing an
 * already-folded prefix), and can never diverge from what a direct
 * `reduceTurtleWorldEvents`/`reduceSceneEvents` call over the same events would produce.
 *
 * **What is linear and what is not** (#977 — stated narrowly, because this paragraph previously
 * claimed a blanket O(n) the code did not deliver, and two corrections over-claimed again).
 * The **scene** fold is linear over any range: {@link seekToEnd} and {@link seekToEventIndex}
 * consume a span with one copy of the item array rather than one per event. `scene.test.mjs`
 * *guards* that against the copy mechanisms the original defect used — it counts copying through
 * the array iterator, `slice` and `concat`, and its doc block enumerates the several ways a
 * quadratic fold could still evade it. Read that as a regression guard, not as a proof of
 * linearity.
 *
 * Two things are **not** covered by it, both measured rather than assumed:
 * - **Step-driven consumption is O(n²)** — {@link step}, and therefore {@link run} at *every* speed
 *   **including {@link IMMEDIATE_SCHEDULER} instant playback** — because each step materialises one
 *   immutable snapshot of a growing scene. Tight only for a drawing-heavy stream: a run that emits
 *   no scene-bearing events is linear, because the fold returns the scene by reference. Measured on
 *   one machine at n=40 000 (200 001 events): `seekToEnd()` 47 ms, `run()` 6 825 ms; a pen-up stream
 *   of the same length stays flat. This is a residual, not a regression — before #977 `run()` paid
 *   at least one copy per step too — and cheapening it needs the controller to keep the fold open
 *   across consecutive steps and materialise a `TurtleScene` only in {@link getSnapshot}, which
 *   changes no shared contract and was left out purely on scope.
 * - **The world fold copies the turtle map on `spawn-turtle` and on any event that changes a
 *   turtle's own state** (`world-state.ts`) — `instruction`, `print`, `clear`, control-flow, and
 *   the scene-only per-turtle kinds `fill`/`stamp` all reuse the map — so the cost is the **sum of
 *   the live map's size over those events**: roughly `O(spawns² + state-bearing effects × live
 *   turtles)`. A **Sprites** stream is therefore quadratic in two independent ways, a spawn-only
 *   stream included. Measured at a fixed 4 000 state-bearing effect events, the effect term
 *   outweighs the spawn term ~20×, so it is not primarily a spawn-time cost. Not addressed here
 *   and not claimed to be.
 *
 * So `run()` under a synchronous scheduler and `seekToEnd()` reach the same final scene by
 * different costs. {@link AnimationSnapshot.state} is read out of that same world
 * ({@link lastActedTurtleState}) rather than folded a second time, so the avatar, the state text, and
 * the per-turtle world can never disagree about the turtle a command last drove — and the addressed set
 * the state text also names comes from that one world too, so it cannot drift from the avatars
 * either.
 *
 * Step boundaries follow `spec/rendering.md`/`spec/execution-model.md` exactly: one step is an
 * `instruction` event plus every effect event up to (but not including) the next `instruction`
 * event or the end of the stream. Speed changes only how {@link run} paces those same steps —
 * it never skips an event or changes where a step boundary falls.
 */
export class TurtleAnimationController {
  private readonly events: readonly TraceEvent[];
  private readonly initialWorld: TurtleWorldState;
  private readonly initialScene: TurtleScene;
  private readonly initialOverlay: OverlayState;
  private readonly scheduler: Scheduler;
  private speed: number;
  private cursor = 0;
  private world: TurtleWorldState;
  private scene: TurtleScene;
  private overlay: OverlayState;
  private status: PlaybackStatus = "idle";
  private cancelPending: (() => void) | null = null;

  constructor(
    events: readonly TraceEvent[],
    options: TurtleAnimationOptions = {},
  ) {
    this.events = events;
    this.initialWorld = {
      turtles: new Map([
        [MAIN_TURTLE_ID, options.initialState ?? INITIAL_TURTLE_STATE],
      ]),
      lastActedTurtleId: MAIN_TURTLE_ID,
      // Program-start addressing: the single default turtle is the addressed set
      // (`spec/turtles-and-sprites.md`'s "Addressing model"), exactly as
      // `INITIAL_TURTLE_WORLD_STATE` seeds it — the world differs only in the main turtle's own
      // (optionally re-seeded) state.
      addressedTurtleIds: [MAIN_TURTLE_ID],
      currentTurtleId: MAIN_TURTLE_ID,
    };
    this.initialScene = options.initialScene ?? INITIAL_TURTLE_SCENE;
    this.initialOverlay = options.initialOverlay ?? INITIAL_OVERLAY_STATE;
    this.scheduler = options.scheduler ?? IMMEDIATE_SCHEDULER;
    this.speed = clampSpeed(options.stepsPerSecond ?? DEFAULT_STEPS_PER_SECOND);
    this.world = this.initialWorld;
    this.scene = this.initialScene;
    this.overlay = this.initialOverlay;
  }

  /** Reads the current cursor, status, and folded world/state/scene/overlay without changing
   * anything. */
  getSnapshot(): AnimationSnapshot {
    return {
      cursor: this.cursor,
      status: this.status,
      state: lastActedTurtleState(this.world),
      world: this.world,
      scene: this.scene,
      overlay: this.overlay,
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
    const end = this.stepEndFrom(this.cursor);
    this.applyRange(this.cursor, end);
    this.cursor = end;
    return this.cursor >= this.events.length;
  }

  /**
   * The exclusive end index of the step that starts at `cursor`: that event plus every following
   * event up to (but not including) the next `instruction` event, or the end of the stream. The
   * **single definition of a step boundary**, shared by {@link consumeOneStep} and
   * {@link seekToEventIndex} so seeking can never land somewhere stepping would not have. Always
   * reports at least `cursor + 1`, which is what makes both of its callers' loops terminate.
   */
  private stepEndFrom(cursor: number): number {
    let end = cursor + 1;
    while (
      end < this.events.length &&
      this.events[end]?.kind !== "instruction"
    ) {
      end += 1;
    }
    return end;
  }

  /**
   * Fast-forwards to the last step boundary at or before `eventIndex`, folding everything from
   * the cursor to there **in one pass**. Exactly equivalent to calling {@link step} until the
   * next step would reach past `eventIndex` — same cursor, same world, same scene, same overlay,
   * same resulting status — and that equivalence is asserted directly in `animation.test.mjs`
   * rather than merely assumed.
   *
   * Stops on a step *boundary* rather than at `eventIndex` itself because a step is
   * instruction-aligned while an arbitrary index is not: landing mid-step would show half an
   * instruction's effects, which `spec/rendering.md`'s worked `repeat 4 [ forward 100 right 90 ]`
   * example is precisely about not doing. `eventIndex` is clamped to the stream, so seeking past
   * the end is the same as seeking to it, and seeking to an index already behind the cursor does
   * nothing (this control only moves forward — {@link reset} is how a caller goes back).
   *
   * **A seek that consumes no step changes nothing at all, status included.** Over an empty stream
   * that is *every* seek, so an empty controller stays `"idle"` here where {@link step} and
   * {@link seekToEnd} report `"done"` — deliberate, because this control's equivalence is to the
   * step loop it replaces, which would not have run either.
   *
   * ## Why this exists (issue #977)
   * A host resuming a picture it has already drawn — `@openlogo/studio`'s replay — used to step
   * one instruction at a time to get there, which folded the scene one event at a time and cost
   * Θ(n²): on one machine, 25.5 s to resume a 60 000-iteration program at `09b6fc11`. Seeking is
   * the same fold done once. A no-op once playback is `"done"`, like {@link step}.
   */
  seekToEventIndex(eventIndex: number): void {
    if (this.status === "done") {
      return;
    }
    const limit = Math.min(eventIndex, this.events.length);
    let target = this.cursor;
    while (target < limit) {
      const next = this.stepEndFrom(target);
      if (next > limit) {
        break;
      }
      target = next;
    }
    if (target === this.cursor) {
      // Nothing to fold — and therefore nothing to disturb. The target is computed BEFORE any
      // mutation precisely so this path has no side effect at all: cancelling a scheduled step
      // here would leave a `"running"` controller with nothing pending, and `run()` refuses to
      // restart while the status is already `"running"`, so playback would wedge permanently. The
      // step loop this replaces never called into the controller when it took zero steps, and this
      // is what makes that equivalence true rather than merely claimed.
      return;
    }
    this.cancelScheduledStep();
    this.applyRange(this.cursor, target);
    this.cursor = target;
    this.status = this.cursor >= this.events.length ? "done" : "paused";
  }

  /**
   * Starts (or resumes) continuous playback: consumes steps at the current {@link setSpeed}
   * pacing until paused, cancelled, or the stream is exhausted. A no-op once playback is
   * already `"running"` or `"done"` — calling `run` again while already running must never
   * schedule a second, overlapping drive loop (which would leak an uncancellable pending step
   * once {@link pause} only has a handle to the newest one). With the default
   * {@link IMMEDIATE_SCHEDULER} this drains the whole remaining stream synchronously in one
   * call — reaching the same final retained scene as {@link seekToEnd}, though by a different cost:
   * this path is step-driven and stays O(n²) for a drawing-heavy stream where `seekToEnd` is linear
   * (see this class's doc block). The two are **not** interchangeable in every state either —
   * `run()` is a no-op while already `"running"` or `"done"`, `seekToEnd()` is not — so "same final
   * scene for a full synchronous drain" is the exact claim, matching the spec's "running
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
    this.world = this.initialWorld;
    this.scene = this.initialScene;
    this.overlay = this.initialOverlay;
    this.status = "idle";
  }

  /** Alias for {@link reset} — the spec names this control "reset/replay" as one control. */
  replay(): void {
    this.reset();
  }

  /**
   * Consumes every remaining step synchronously, ignoring pacing, until the stream is
   * exhausted. Produces the same final state/scene as stepping one-by-one or running at any
   * speed, for a deterministic program. Folds the remainder in one pass rather than one step at
   * a time, for the reason {@link seekToEventIndex} records (#977); the last step boundary at or
   * before the end of the stream is the end of the stream, so there is no boundary to compute.
   */
  seekToEnd(): void {
    this.cancelScheduledStep();
    this.applyRange(this.cursor, this.events.length);
    this.cursor = this.events.length;
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

  /** Folds `events[start..end)` into the running world/scene/overlay, in order.
   *
   * World and overlay fold per event; the scene folds as one range ({@link reduceSceneRange}),
   * because appending immutably costs a full array copy and doing that once per event is what
   * made a long resume quadratic (#977). The three reducers each read only their own state, so
   * folding one of them separately over the same events in the same order is the same
   * computation — not an approximation of it. */
  private applyRange(start: number, end: number): void {
    // Sliced once and shared: world/overlay iterate the window and the scene folds the same window,
    // so the hot path allocates one transient array rather than two.
    const window = this.events.slice(start, end);
    for (const event of window) {
      this.world = reduceTurtleWorldState(this.world, event);
      this.overlay = reduceOverlayState(this.overlay, event);
    }
    this.scene = reduceSceneRange(this.scene, window, 0, window.length);
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
