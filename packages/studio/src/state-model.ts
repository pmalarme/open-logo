/**
 * The single studio state model — the sole source of truth for the learner's document text,
 * cursor/selection, run status, diagnostics list, and lesson context. Every pane (#124 editor,
 * #125 diagnostics, #126 run/stop, #127 lesson, #128 persistence, #129 a11y) reads from and
 * updates through **one** {@link StudioStateStore} instance; nothing forks or copies the state
 * independently, so two panes can never desync.
 *
 * ## Shape
 * - `source` — the current document text.
 * - `selection` — the cursor/selection range, expressed as {@link Position} anchor/head pairs
 *   (reusing `@openlogo/core`'s 1-based `[line, column]` positions — the same primitive
 *   diagnostics and the AST use, so panes never invent a second coordinate system).
 * - `runStatus` — `"idle" | "running" | "done" | "stopped"`, driven by the run controller (#126)
 *   over the runtime's execution budget. `"idle"` is the initial/`reset()` state (nothing has run
 *   yet); `"done"` (#311) is a *distinct* value the controller commits once a run finishes
 *   *on its own* (no `stop()`, no `ol-limit`), so a learner-facing renderer can tell "never run"
 *   (`"idle"`) apart from "just finished" (`"done"`) — see `run-status-label.ts` for the
 *   learner-facing label each value maps to.
 * - `diagnostics` — the current `ol-*` {@link Diagnostic} list from `@openlogo/core`, as produced
 *   by `@openlogo/parser`/`@openlogo/runtime`. Studio never invents its own diagnostic shape.
 * - `output` — the learner-visible text produced by the most recent run, one entry per `print`
 *   trace event (#126). Studio never formats values itself; each entry is already in the
 *   runtime's canonical printed form (`@openlogo/runtime`'s `printedForm`).
 * - `lesson` — the active lesson context (id + title) for the lesson pane (#127); content itself
 *   is pulled from `@openlogo/edu`, never authored here.
 * - `notice` — a non-fatal, learner-visible status (e.g. "your work could not be saved"), set by
 *   #128 persistence when a storage operation degrades gracefully instead of crashing or silently
 *   losing data. `null` means there is nothing to show.
 * - `turtleState`/`turtleScene` — the turtle avatar state and retained drawing scene the Canvas
 *   view (#218) paints, reusing `@openlogo/turtle`'s own {@link TurtleState}/{@link TurtleScene}
 *   types verbatim (never a studio-invented fork). Both start at `@openlogo/turtle`'s program-start
 *   defaults (`INITIAL_TURTLE_STATE`/`INITIAL_TURTLE_SCENE`) and are replaced wholesale by
 *   `@openlogo/turtle`'s own reducers — studio never re-derives turtle coordinates or scene items
 *   itself. This slice (#218) only composes the *initial* defaults; wiring a run's trace-event
 *   stream through `reduceTurtleState`/`reduceTurtleScene` to keep them live is #228.
 * - `speedSliderValue` (#310) — the learner-facing turtle-speed slider position, a plain number
 *   in `turtle-speed.ts`'s `[SPEED_SLIDER_MIN, SPEED_SLIDER_MAX]` range (the top value being the
 *   dedicated "instant / no animation" end). Defaults to `turtle-speed.ts`'s
 *   `DEFAULT_SPEED_SLIDER_VALUE`. `run-controller.ts` reads it at `run()`/`step()`-prepare time and
 *   maps it (via `mapSpeedSliderValueToTickDelayMs`) to the `TurtleAnimationController` pacing it
 *   drives the Canvas animation through — this store only holds the raw slider position, never the
 *   derived delay, so there is exactly one place (`turtle-speed.ts`) that owns the mapping.
 * - `tutorOutput` (#334) — the current run's `tutor-output` trace events (`@openlogo/core`'s
 *   `TutorOutputPayload`), one entry per `explain`/`why`/`hint`/`debug` invocation, in the order
 *   they were emitted. Replaced wholesale by `run-controller.ts` every run, exactly like `output`/
 *   `diagnostics` above — never invented or reformatted here. `tutor-output-pane.ts`'s controller
 *   is what accumulates these across runs into a growing history (mirroring `run-log.ts`'s
 *   pattern), so this field only ever needs to hold the latest run's own events.
 * - `currentInstructionSourceSpan` (#410) — the `source_span` of the most recently consumed
 *   `"instruction"` trace event, or `null` before any instruction has been consumed (program-start/
 *   `reset()`, or before the first `run()`/`step()`). `run-controller.ts` derives this from the
 *   same already-complete event stream it replays through the turtle animation (never a second
 *   execution) and updates it in lockstep with `turtleState`/`turtleScene` on every pushed
 *   snapshot. `a11y.ts`'s turtle-state region reads it to append the current source instruction's
 *   own text to the non-visual state description (`spec/rendering.md`'s Non-visual state
 *   descriptions minimum) — omitted entirely, never a placeholder, while `null`.
 *
 * ## Update contract
 * - State changes **only** through the store's `set*` methods below; the object returned by
 *   {@link StudioStateStore.getState} is the current snapshot and MUST NOT be mutated in place.
 * - `getState()` returns the **same object reference** until the next `set*` call, so any two
 *   consumers holding the same store instance always observe the same values — there is no
 *   per-pane copy to fall out of sync.
 * - After any `set*` call every listener registered via {@link StudioStateStore.subscribe} is
 *   notified synchronously with the new snapshot; `subscribe` returns an unsubscribe function.
 */

import type {
  Diagnostic,
  Position,
  SourceSpan,
  TutorOutputPayload,
} from "@openlogo/core";
import type { TurtleScene, TurtleState } from "@openlogo/turtle";
import { INITIAL_TURTLE_SCENE, INITIAL_TURTLE_STATE } from "@openlogo/turtle";
import { DEFAULT_SPEED_SLIDER_VALUE } from "./turtle-speed.js";

/**
 * The learner's run state, driven by the run controller (#126) over the runtime budget. `"done"`
 * (#311) is committed only when a run finishes on its own (never on `stop()`/`ol-limit`, which
 * commit `"stopped"`, and never at program-start/`reset()`, which commit `"idle"`).
 */
export type RunStatus = "idle" | "running" | "done" | "stopped";

/** A cursor/selection range using `@openlogo/core`'s 1-based `[line, column]` positions. */
export interface Selection {
  readonly anchor: Position;
  readonly head: Position;
}

/** The active lesson context for the lesson pane (#127); content is pulled from `@openlogo/edu`. */
export interface LessonContext {
  readonly lessonId: string | null;
  readonly title: string | null;
}

/**
 * A non-fatal, learner-visible status. Set when something degrades gracefully (e.g. persistence
 * failing to save/restore) rather than crashing or silently losing the learner's work.
 */
export interface Notice {
  readonly level: "info" | "warning";
  readonly message: string;
}

/** The single source-of-truth snapshot every studio pane renders from. */
export interface StudioState {
  readonly source: string;
  readonly selection: Selection;
  readonly runStatus: RunStatus;
  readonly diagnostics: readonly Diagnostic[];
  readonly output: readonly string[];
  readonly lesson: LessonContext;
  readonly notice: Notice | null;
  readonly turtleState: TurtleState;
  readonly turtleScene: TurtleScene;
  readonly speedSliderValue: number;
  readonly tutorOutput: readonly TutorOutputPayload[];
  readonly currentInstructionSourceSpan: SourceSpan | null;
}

/** A subscriber notified with the new snapshot after every state change. */
export type StudioStateListener = (state: StudioState) => void;

/** Unsubscribe function returned by {@link StudioStateStore.subscribe}. */
export type Unsubscribe = () => void;

/**
 * The single state model store. Construct exactly one instance per studio session
 * ({@link createStudioState}) and share that instance across every pane.
 */
export interface StudioStateStore {
  /** The current snapshot; stable by reference between state changes. */
  getState(): StudioState;
  /** Register a listener notified synchronously after every state change. */
  subscribe(listener: StudioStateListener): Unsubscribe;
  /** Replace the document text. */
  setSource(source: string): void;
  /** Replace the cursor/selection. */
  setSelection(selection: Selection): void;
  /**
   * Replace the document text and cursor/selection together in one notification (#315). A real
   * editor widget's own edit commits both at once (e.g. typing a character replaces the doc *and*
   * advances the cursor); calling {@link setSource} then {@link setSelection} separately would
   * notify every listener twice per keystroke — once with the new text at the *old* selection,
   * which for a growing document can be a temporarily out-of-range position — and would cost
   * twice the render work for no benefit. Prefer this over the two separate calls whenever both
   * are changing together.
   */
  setSourceAndSelection(source: string, selection: Selection): void;
  /** Replace the run status. */
  setRunStatus(runStatus: RunStatus): void;
  /** Replace the diagnostics list. */
  setDiagnostics(diagnostics: readonly Diagnostic[]): void;
  /** Replace the learner-visible output (one entry per `print` trace event). */
  setOutput(output: readonly string[]): void;
  /** Replace the lesson context. */
  setLesson(lesson: LessonContext): void;
  /** Replace the visible notice; pass `null` to clear it. */
  setNotice(notice: Notice | null): void;
  /** Replace the turtle avatar state the Canvas view (#218) paints. */
  setTurtleState(turtleState: TurtleState): void;
  /** Replace the retained turtle drawing scene the Canvas view (#218) paints. */
  setTurtleScene(turtleScene: TurtleScene): void;
  /**
   * Replace the turtle-speed slider position (#310) — a plain number in `turtle-speed.ts`'s
   * `[SPEED_SLIDER_MIN, SPEED_SLIDER_MAX]` range. `run-controller.ts` reads it via `getState()` at
   * the start of every `run()`/lazily-prepared `step()`, so a change only takes effect on the
   * *next* run, matching how `RunControllerOptions.reducedMotion` itself already only applies at
   * `run()`-call time.
   */
  setSpeedSliderValue(speedSliderValue: number): void;
  /**
   * Replace the current run's `tutor-output` events (#334) — the ordered `TutorOutputPayload`s
   * `explain`/`why`/`hint`/`debug` emitted during the most recent run. `run-controller.ts` calls
   * this once per `run()`, exactly like `setOutput`/`setDiagnostics`; `tutor-output-pane.ts`'s
   * controller accumulates these across runs into its own growing history.
   */
  setTutorOutput(tutorOutput: readonly TutorOutputPayload[]): void;
  /**
   * Replace the current instruction's `source_span` (#410), or `null` when none is available
   * (program-start/`reset()`, or before the first `run()`/`step()`). `run-controller.ts` calls
   * this in lockstep with `setTurtleState`/`setTurtleScene` on every pushed animation snapshot.
   */
  setCurrentInstructionSourceSpan(
    currentInstructionSourceSpan: SourceSpan | null,
  ): void;
}

const INITIAL_POSITION: Position = [1, 1];
const INITIAL_SELECTION: Selection = {
  anchor: INITIAL_POSITION,
  head: INITIAL_POSITION,
};
const INITIAL_LESSON: LessonContext = { lessonId: null, title: null };

/** Construct the single {@link StudioStateStore} for a studio session. */
export function createStudioState(
  initial?: Partial<StudioState>,
): StudioStateStore {
  let state: StudioState = {
    source: initial?.source ?? "",
    selection: initial?.selection ?? INITIAL_SELECTION,
    runStatus: initial?.runStatus ?? "idle",
    diagnostics: initial?.diagnostics ?? [],
    output: initial?.output ?? [],
    lesson: initial?.lesson ?? INITIAL_LESSON,
    notice: initial?.notice ?? null,
    turtleState: initial?.turtleState ?? INITIAL_TURTLE_STATE,
    turtleScene: initial?.turtleScene ?? INITIAL_TURTLE_SCENE,
    speedSliderValue: initial?.speedSliderValue ?? DEFAULT_SPEED_SLIDER_VALUE,
    tutorOutput: initial?.tutorOutput ?? [],
    currentInstructionSourceSpan: initial?.currentInstructionSourceSpan ?? null,
  };

  const listeners = new Set<StudioStateListener>();

  function commit(patch: Partial<StudioState>): void {
    state = { ...state, ...patch };
    for (const listener of listeners) {
      listener(state);
    }
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setSource(source) {
      commit({ source });
    },
    setSelection(selection) {
      commit({ selection });
    },
    setSourceAndSelection(source, selection) {
      commit({ source, selection });
    },
    setRunStatus(runStatus) {
      commit({ runStatus });
    },
    setDiagnostics(diagnostics) {
      commit({ diagnostics });
    },
    setOutput(output) {
      commit({ output });
    },
    setLesson(lesson) {
      commit({ lesson });
    },
    setNotice(notice) {
      commit({ notice });
    },
    setTurtleState(turtleState) {
      commit({ turtleState });
    },
    setTurtleScene(turtleScene) {
      commit({ turtleScene });
    },
    setSpeedSliderValue(speedSliderValue) {
      commit({ speedSliderValue });
    },
    setTutorOutput(tutorOutput) {
      commit({ tutorOutput });
    },
    setCurrentInstructionSourceSpan(currentInstructionSourceSpan) {
      commit({ currentInstructionSourceSpan });
    },
  };
}
