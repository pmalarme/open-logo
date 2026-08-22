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
 *   Every consumed tick pushes the controller's folded `world`/`scene` into the shared state model
 *   via `setTurtleWorld`/`setTurtleScene` (#218) and, if a {@link RunControllerOptions.canvasView}
 *   was supplied, calls its `repaint()` immediately — the same composition seam #218 published,
 *   invoked directly rather than duplicated.
 * - `step()` is no longer a no-op: it now realizes what its old doc comment deferred, by advancing
 *   the **animation** one instruction-step over the already-complete stream (never the runtime,
 *   which exposes no per-instruction pause/resume API) and pushing the resulting snapshot.
 * - `stop()` additionally pauses the animation (`TurtleAnimationController.pause()`), so a
 *   still-advancing Canvas view halts at exactly the same point the cancellation signal takes
 *   over the underlying `execute()` call — see `TurtleAnimationController`'s own doc comment for
 *   why a stale scheduled tick can never fire after `pause()` and double-advance the picture.
 * - `reset()` additionally resets the animation and restores `turtleWorld`/`turtleScene` to
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
 *
 * ## #769 — the `input` prompt and the synchronous reader
 * `@openlogo/runtime`'s host reader (#681,
 * `ExecuteOptions.hostInput.read?: (prompt: string) => string | undefined`) is **synchronous**:
 * `spec/interaction-events.md:108-111` requires that no OpenLogo instruction and no handler block
 * runs until a read finishes, and a synchronous call is that guarantee by construction. `execute()`
 * itself never yields either (see the Stop caveat above), so a same-thread browser host cannot
 * suspend inside `read` to await a styled, keyboard-operable, screen-reader-announced prompt. That
 * constraint is real, and this module does **not** work around it by changing runtime semantics —
 * the seam is used exactly as specified.
 *
 * What it does instead is an **attempt chain**. When a {@link RunControllerOptions.inputPrompt} host
 * is supplied, `prepare()` installs a reader that answers each read from an accumulated FIFO of the
 * answers the learner has already given. The first read with no answer left records its prompt and
 * returns `undefined` — the reader's documented "cannot answer" ending, which cancels that
 * execution with `ol-limit`/`cancelled` at the waiting `input`. Such an attempt is a **probe**, not
 * a finished run: once its animation has drawn everything up to the read, the prompt is presented,
 * and when the learner answers, that answer joins the FIFO and the **same captured source** is
 * executed again from the top. N reads cost N+1 executions.
 *
 * **Why a replay honors "the program must not appear to continue".** The learner never observes the
 * cancel-and-re-run, because this module already reduces the *whole* event stream wholesale on
 * every attempt (`collectOutput` → `setOutput`, `setDiagnostics`, `setTutorOutput`, and a fresh
 * `TurtleAnimationController` over the run's events). Attempt *k+1*'s stream begins with attempt
 * *k*'s, so each wholesale replacement can only *extend* what is on screen: output grows
 * monotonically, the canvas resumes rather than blanking (the new animation is fast-forwarded past
 * the events already drawn — see `prepare()`), and no consumer double-counts, because
 * `run-log.ts`/`tutor-output-pane.ts` accumulate only on the `"running"` → terminal transition a
 * probe never reaches. From the learner's side the program stops at the question and continues from
 * exactly there, which is what `:108-111` asks a host to show.
 *
 * ## #881 — why "attempt *k+1* begins with attempt *k*" is now unconditional
 * Before #881 that claim carried a qualifier: it held only "for a program whose prefix is
 * deterministic". A program drawing unseeded randomness before a read re-randomized on every
 * attempt, so the replay could reach a **different question** than the learner was shown, and
 * already-drawn output could change underneath them.
 *
 * `run()` now pins **one `ExecuteOptions.randomSeed` (#865) per chain**, drawn from
 * {@link RunControllerOptions.randomSeedSource} (`Date.now` by default — the very seed the runtime
 * would otherwise have chosen for itself, so an ordinary run is no more predictable than before).
 * That closes it completely, because `@openlogo/runtime`'s clock fallback was its **only** source
 * of nondeterminism: nothing else there reads a wall clock or `Math.random()`, the tick clock is a
 * pure counter, and since #865 even a no-argument `randomize` derives its implementation-chosen
 * seed from the generator instead of the clock. With the seed fixed, `execute()` is a pure function
 * of source, document, and options — so every attempt of a chain is *bit-identical* up to the read
 * the newest answer extends. Concretely, for the whole program class #881 named:
 * - the branch a `random` chose does not change under the covers, and the question is not re-asked;
 * - the output and drawing the learner has already observed are never rewritten by a later attempt;
 * - two distinct `input` sites asking the identical prompt text each receive their own answer,
 *   because a read's FIFO position is now stable across attempts and therefore identifies the site.
 *
 * The seed is drawn **per chain, not per attempt** — that distinction is the whole fix, and
 * `run-controller-input.test.mjs` pins it with a seed source that hands out a different seed on
 * every call, so drawing per attempt diverges deterministically rather than by luck.
 *
 * What remains is not a correctness gap but a mechanism one: the read is still *reconciled* rather
 * than genuinely blocking, and N reads still cost N+1 executions. Issue **#876** (a Worker +
 * `Atomics.wait` execution host) is that mechanism; the replay stays as the degraded mode for any
 * deployment that is not cross-origin isolated.
 *
 * {@link resolveRecordedAnswer}'s prompt pairing is kept as defence in depth rather than deleted:
 * it is what makes "an answer can never reach a question the learner was not shown" true **by
 * construction** instead of by trusting the determinism argument above, and it costs one comparison
 * per read.
 *
 * The chain's **no-progress retry cap** (`MAX_INPUT_REPLAY_RETRIES`, removed by #881) went the
 * other way, because #881 makes the situation it guarded provably unreachable rather than merely
 * unlikely. The cap ended a chain whose replay kept diverging and therefore kept answering nothing
 * new. But a read at FIFO position *i* takes its prompt from the source, the chain's pinned seed,
 * and answers *0…i-1* — all frozen for the life of the chain, since an answer is recorded once and
 * never revised. So position *i*'s prompt is **invariant across attempts**; the FIFO grows by
 * exactly one entry per attempt, and a chain can never fail to make progress. Keeping a counter for
 * a branch no program can reach would have been untestable code guarding an impossible state.
 * (What the cap never covered, before or after, is a chain with genuinely *unbounded* reads such as
 * `forever [ input "?" ]` under a synchronous host: every attempt there answers one more read, so
 * it always counted as progress. That remains bounded only by the instruction budget.)
 *
 * A probe's own diagnostics are deliberately withheld while its question is outstanding, because the
 * only diagnostic a probe can carry is the reader's own forced cancellation: parse diagnostics stop
 * the program before any read can happen, and a runtime error halts execution at the failure —
 * which, for a probe, *is* that read. Publishing it would tell a learner the run was cancelled while
 * they are still being asked to answer. They are published unchanged the moment the learner
 * genuinely dismisses the prompt, because then the cancellation really did happen.
 *
 * `runStatus` stays `"running"` for the whole chain — the program *is* running, blocked on a read —
 * which also means `run()`'s #314 guard already ignores a second Run while a question is open, and
 * the Start/Stop toggle (`run-controls.ts`) already offers Stop. **Stop** withdraws the question and
 * commits the probe as the cancelled run it is (`"stopped"`); **Reset** withdraws it and clears
 * everything (`"idle"`); a late answer arriving after either is ignored via a generation counter.
 * `step()` deliberately does **not** drive this flow: it is a scrubber over an already-produced
 * event stream (see "#228" above), so there is no execution in progress for a read to block, and its
 * lazy `prepare()` therefore installs no reader at all — behavior unchanged from before #769.
 */

import { execute, printedForm } from "@openlogo/runtime";
import type { CancellationSignal, ExecuteOptions } from "@openlogo/runtime";
import type {
  Diagnostic,
  PrintPayload,
  SourceSpan,
  TraceEvent,
  TutorOutputPayload,
} from "@openlogo/core";
import {
  IMMEDIATE_SCHEDULER,
  INITIAL_TURTLE_SCENE,
  INITIAL_TURTLE_WORLD_STATE,
  playWithMotionPreference,
  TurtleAnimationController,
} from "@openlogo/turtle";
import type { Scheduler } from "@openlogo/turtle";
import type { AppShell } from "./app-shell.js";
import type { CanvasViewController } from "./canvas-view.js";
import type { InputPromptHost } from "./input-prompt.js";
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
   * state model's `turtleWorld`/`turtleScene`, so the pane never shows a stale frame. Optional —
   * omit in tests that only assert the state model's turtle fields directly.
   */
  readonly canvasView?: CanvasViewController;
  /**
   * The learner-facing prompt host for the blocking `input` reporter (#769) — see
   * `input-prompt.ts`, and this module's doc comment ("#769") for how a synchronous runtime reader
   * is reconciled with an asynchronous browser prompt.
   *
   * **Omit it and nothing changes**: no `ExecuteOptions.hostInput` is passed at all, so `input`
   * falls back to `@openlogo/runtime`'s scripted `responses` queue (empty for a studio run), and an
   * `input` read cancels the program exactly as it did before this option existed.
   */
  readonly inputPrompt?: InputPromptHost;
  /**
   * Draws the `ExecuteOptions.randomSeed` (#865) each `run()` pins its whole `input` attempt chain
   * to (#881) — see this module's doc comment ("#881"). Defaults to `Date.now`, the same
   * implementation-chosen seed `@openlogo/runtime` falls back to on its own, so an ordinary studio
   * run is as unpredictable as it has always been.
   *
   * Inject a counter here to make a run **exactly** reproducible — a test that needs to prove a
   * replay cannot diverge injects a source that returns a *different* seed on every call, so an
   * implementation that drew per attempt instead of per chain diverges deterministically rather
   * than by luck.
   */
  readonly randomSeedSource?: () => number;
}

/**
 * One attempt's outstanding, unanswered `input` read (#769): the prompt to show, plus the host to
 * show it through. Carrying the host here — rather than re-reading `options.inputPrompt` at
 * presentation time — is what makes "a probe can only exist when a host was supplied" true by
 * construction rather than by a runtime check.
 */
interface PendingRead {
  readonly prompt: string;
  readonly host: InputPromptHost;
}

/**
 * One answer the learner has already given during the current chain (#769), remembered **with the
 * question it answered**. Binding answers by position alone would, if a replay ever reached a
 * different question at the same position, hand an answer to a question the learner was never
 * shown. Pairing each answer with its prompt is what makes that impossible; see
 * {@link resolveRecordedAnswer}.
 */
export interface RecordedAnswer {
  /** The question, exactly as the learner was shown it. */
  readonly prompt: string;
  /** The text they submitted for it. */
  readonly answer: string;
}

/** {@link resolveRecordedAnswer}'s verdict for a single read. */
export interface RecordedAnswerResolution {
  /**
   * The learner's own answer to **this exact question**, or `undefined` when there is none and the
   * question must be put to them.
   */
  readonly answer: string | undefined;
  /**
   * The answers the chain keeps. The same list, except when the replay diverged: then every entry
   * from `cursor` on is dropped, because those answer questions this attempt is not asking.
   */
  readonly retained: readonly RecordedAnswer[];
}

/**
 * Decide how the read at position `cursor` is answered from the chain's accumulated answers (#769)
 * — the one tested place that owns this decision, extracted from `prepare()`'s reader so it can be
 * proven directly rather than only through a replay whose divergence needs nondeterminism to
 * provoke.
 *
 * An answer is used **only** when the entry at this position was given for this same `prompt`.
 * "This same question" means **this prompt text at this FIFO position**. Otherwise the read cannot
 * be answered: the chain has no answer for this position yet, or — the case this pairing exists to
 * make impossible — a replay reached a different question here than the learner was shown. In that
 * second case every remaining answer is dropped as well, since handing one to the wrong question
 * would silently apply a learner's answer to something they never saw.
 *
 * Since **#881** pinned one `ExecuteOptions.randomSeed` per chain (see this module's doc comment),
 * a replay the run controller itself drives is bit-identical up to the newest read, so the
 * divergence arm is unreachable through `run()`: position is now a stable read identity, which is
 * exactly what lets **two distinct `input` sites asking the identical prompt text** each receive
 * their own answer. This function is nonetheless kept, exported, and directly tested — it is what
 * makes "an answer never reaches a question it did not answer" hold **by construction** rather than
 * by trusting that determinism argument, and it costs one comparison per read. The remaining gap is
 * a mechanism one, not a correctness one: the read is reconciled rather than genuinely blocking,
 * which is issue **#876**.
 */
export function resolveRecordedAnswer(
  answers: readonly RecordedAnswer[],
  cursor: number,
  prompt: string,
): RecordedAnswerResolution {
  const recorded = answers[cursor];
  if (recorded?.prompt === prompt) {
    return { answer: recorded.answer, retained: answers };
  }
  return { answer: undefined, retained: answers.slice(0, cursor) };
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
   * away. #769 — if an `input` question was outstanding it is withdrawn and the run is committed
   * as the cancelled run it is, with the diagnostics the waiting attempt already produced.
   */
  stop(): void;
  /**
   * Clear output/diagnostics, re-arm cancellation, reset the turtle animation and restore
   * `turtleWorld`/`turtleScene` to `@openlogo/turtle`'s program-start defaults (repainting the
   * Canvas view if one was supplied), and return `runStatus` to `"idle"`. #769 — also withdraws an
   * outstanding `input` question and discards every answer given during the current run, so the
   * next `run()` starts a genuinely fresh chain.
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
   *
   * #769 — a no-op while an `input` question is outstanding (the run is blocked on it), and its
   * lazy `prepare()` never installs a prompt host: stepping is a scrubber over an already-produced
   * event stream, so there is no execution in progress for a read to block. See this module's doc
   * comment ("#769").
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
      output.push(
        event.payload.values.map((value) => printedForm(value)).join(" "),
      );
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

/**
 * Finds the `source_span` of the most recently consumed `"instruction"` event as of `cursor`
 * (`TurtleAnimationController.getSnapshot().cursor`, the index of the *next* unconsumed event in
 * `events`) — this is #410's "current source instruction", surfaced non-visually by
 * `a11y.ts`'s turtle-state region (`spec/rendering.md`'s Non-visual state descriptions minimum).
 * `events` already carries one `"instruction"` event per executed statement
 * (`execute-internal.ts`'s `executeStatements`), each stamped with that statement's own
 * `source_span` — this never re-derives a span, only looks one up in the already-complete stream.
 * Returns `null` before any instruction has been consumed (cursor at or before the first one), so
 * the turtle-state text can omit the clause entirely rather than show a placeholder.
 */
function findCurrentInstructionSourceSpan(
  events: readonly TraceEvent[],
  cursor: number,
): SourceSpan | null {
  for (
    let index = Math.min(cursor, events.length) - 1;
    index >= 0;
    index -= 1
  ) {
    const event = events[index];
    if (event !== undefined && event.kind === "instruction") {
      return event.source_span;
    }
  }
  return null;
}

/**
 * The exclusive end index of the animation step that starts at `cursor`: that event plus every
 * following event up to (but not including) the next `"instruction"` event — exactly
 * `TurtleAnimationController.step()`'s own boundary rule (`spec/rendering.md`'s worked
 * `repeat 4 [ forward 100 right 90 ]` example). Purely a measurement: it never folds or reduces
 * anything. #769's resume needs it because a step is instruction-aligned while the events a
 * previous attempt actually drew are not — see `prepare()`'s resume loop.
 */
function stepEndIndex(events: readonly TraceEvent[], cursor: number): number {
  let end = cursor + 1;
  while (end < events.length && events[end]?.kind !== "instruction") {
    end += 1;
  }
  return end;
}

/** Construct the Run/Stop/Reset/Step controller over an existing state model (never a copy). */
export function createRunController(
  state: StudioStateStore,
  options?: RunControllerOptions,
): RunController {
  const document = options?.document ?? DEFAULT_RUN_DOCUMENT;
  const signal: MutableCancellationSignal = { aborted: false };
  // #881 — where each chain's pinned `ExecuteOptions.randomSeed` (#865) comes from. `Date.now` is
  // exactly what `@openlogo/runtime` would have chosen for itself, so an unpinned studio run is
  // no more predictable than before; what changes is that the choice is now made ONCE per chain
  // instead of once per `execute()` call.
  const drawRandomSeed = options?.randomSeedSource ?? Date.now;

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
  // The most recent prepare()'s complete trace-event stream (#410) — kept alongside `animation`
  // so pushTurtleSnapshot() can look up the current instruction's source_span against the same
  // stream the animation is replaying, without re-executing or re-deriving anything. Cleared back
  // to empty by reset(), exactly like `animation` itself.
  let currentEvents: readonly TraceEvent[] = [];
  // The exact source text prepare() executed to produce `currentEvents` (#410). A paced run's
  // scheduler callback can fire pushTurtleSnapshot() well after prepare() ran — if the learner
  // edited the editor in between (state-model.ts's setSource()/setSourceAndSelection() already
  // clear currentInstructionSourceSpan on that edit), this run's *next* animation tick would
  // otherwise republish a span looked up against the now-stale `currentEvents`, reintroducing the
  // exact bug that clearing was meant to prevent. Comparing against the live store source lets
  // pushTurtleSnapshot omit the clause instead of re-publishing a span for text that's no longer
  // on screen. Cleared back to "" by reset(), exactly like `currentEvents` itself.
  let preparedSource = "";
  // #769 — the `input` attempt chain. `answers` is the FIFO the installed reader draws from, one
  // entry per question the learner has already answered in the CURRENT chain; `chainSource` is the
  // source text every attempt of that chain executes (captured once at `run()`, so editing the
  // editor while a question is open cannot swap the program the answers were given for).
  // `pendingRead` is non-null exactly while the latest attempt ended on an unanswered read, and
  // `attemptDiagnostics` holds that attempt's real (withheld) diagnostics until the learner either
  // answers — in which case a later attempt replaces them — or dismisses, in which case they are
  // published. `shownEventCount` is how many events the previous attempt already drew, so the next
  // attempt's animation resumes there instead of replaying the picture from a blank canvas.
  // `promptOutstanding` guards the present-once rule (the settle hook runs on every animation tick
  // AND once more after playback), and `promptGeneration` invalidates a responder that arrives
  // after Stop/Reset already decided the run's outcome.
  let answers: readonly RecordedAnswer[] = [];
  let chainSource = "";
  let pendingRead: PendingRead | null = null;
  let attemptDiagnostics: readonly Diagnostic[] = [];
  let shownEventCount = 0;
  let promptOutstanding = false;
  let promptGeneration = 0;
  // The attempt pump's re-entrancy guard. A host may answer synchronously from inside `present()`
  // — i.e. from inside the very attempt that asked — so `pump()` is a loop with a "go again" flag
  // rather than recursion: a synchronous answer marks `pumpAgain` and unwinds, and the running loop
  // picks up the next attempt. `pumpAgain` is also what tells the settle hook that the attempt it
  // is settling has already been superseded.
  let pumping = false;
  let pumpAgain = false;
  // #881 — the one random seed every attempt of the current chain executes with. Drawn once by
  // `run()` (and once per lazy `step()` preparation, which is its own single-attempt chain), so
  // attempt k+1 reproduces attempt k exactly up to the read the new answer extends.
  let chainRandomSeed = 0;

  /** Push `current`'s folded per-turtle world/scene into the shared store and repaint (never
   * called with a null animation — callers only invoke this once `animation` has been
   * assigned). */
  function pushTurtleSnapshot(current: TurtleAnimationController): void {
    const snapshot = current.getSnapshot();
    state.setTurtleWorld(snapshot.world);
    state.setTurtleScene(snapshot.scene);
    // #410 — only trust `currentEvents`' spans while the editor still holds the exact source they
    // were derived from; a mid-run edit means the store's own currentInstructionSourceSpan was
    // already cleared to null by setSource()/setSourceAndSelection(), and republishing a lookup
    // against the old stream here would silently undo that.
    state.setCurrentInstructionSourceSpan(
      state.getState().source === preparedSource
        ? findCurrentInstructionSourceSpan(currentEvents, snapshot.cursor)
        : null,
    );
    options?.canvasView?.repaint();
  }

  /**
   * Called after every animation tick and once more when playback returns. Commits
   * {@link finalRunStatus} once `current` has actually reached `"done"` — unless the learner already
   * called `stop()`, in which case `runStatus` stays `"stopped"` even if a subsequent manual
   * `step()` exhausts the animation (see `userStopped`'s doc comment above).
   *
   * #769 adds the two attempt-chain outcomes ahead of that. `pumpAgain` means a host already
   * answered this attempt's question synchronously, so the *next* attempt supersedes this one and
   * its (probe) outcome must not be committed. Otherwise, an attempt that ended on an unanswered
   * read has now drawn everything up to that read, which is exactly when the question is put to the
   * learner.
   */
  function settleAttempt(current: TurtleAnimationController): void {
    if (current.getSnapshot().status !== "done") {
      return;
    }
    if (pumpAgain) {
      return;
    }
    if (pendingRead !== null) {
      presentPendingRead(pendingRead);
      return;
    }
    if (!userStopped) {
      state.setRunStatus(finalRunStatus);
    }
  }

  /**
   * Put the outstanding question to the learner (#769). Idempotent: the settle hook above fires both
   * on the animation's final tick and once more when playback returns, and a question must be
   * presented exactly once.
   */
  function presentPendingRead(read: PendingRead): void {
    if (promptOutstanding) {
      return;
    }
    promptOutstanding = true;
    // Everything up to the read is now on the canvas, so the next attempt resumes from here.
    shownEventCount = currentEvents.length;
    const generation = promptGeneration;
    read.host.present({ prompt: read.prompt }, (answer) => {
      if (generation !== promptGeneration) {
        // Stop/Reset already withdrew this question and decided the run's outcome.
        return;
      }
      promptGeneration += 1;
      promptOutstanding = false;
      pendingRead = null;
      if (answer === undefined) {
        // The learner dismissed the question, so the read really did end unanswered — which is the
        // one other ending `spec/interaction-events.md:110-111` allows. Publish the cancellation
        // this attempt already produced.
        commitCancelledRead();
        state.setRunStatus("stopped");
        return;
      }
      answers = [...answers, { prompt: read.prompt, answer }];
      pump();
    });
  }

  /**
   * Commit the latest attempt as the cancelled run it is (#769) — the learner dismissed the
   * question, or pressed Stop while it was open. Publishes the diagnostics `prepare()` withheld
   * (see this module's doc comment) alongside the output the attempt did produce, so the run log
   * records the full, real outcome. `signal.aborted` is deliberately NOT set here: the execution
   * already ended, so there is nothing left to cancel, and only an explicit `stop()` should latch
   * the signal (`reset()` is what re-arms it).
   */
  function commitCancelledRead(): void {
    userStopped = true;
    const output = collectOutput(currentEvents);
    state.setOutput(output);
    state.setDiagnostics(attemptDiagnostics);
    state.setLastRunResult({
      source: preparedSource,
      output,
      diagnostics: attemptDiagnostics,
    });
  }

  /**
   * Take down an outstanding question without answering it (#769, Stop/Reset), invalidating any
   * responder still holding it. Reports whether there was a read to withdraw, so the caller knows
   * whether a cancelled attempt needs committing.
   */
  function withdrawPendingRead(): boolean {
    const read = pendingRead;
    if (read === null) {
      return false;
    }
    pendingRead = null;
    promptGeneration += 1;
    if (promptOutstanding) {
      promptOutstanding = false;
      read.host.dismiss();
    }
    return true;
  }

  function prepare(
    sourceText: string,
    host: InputPromptHost | undefined,
  ): TurtleAnimationController {
    state.setRunStatus("running");
    userStopped = false;
    pendingRead = null;

    // #769 — one cursor per attempt over the chain's accumulated answers. A read is answered from
    // the FIFO only when the recorded answer at this position was given for **this same question**;
    // `host` is captured into `pendingRead` so a probe can only ever exist when a host was supplied.
    let answerCursor = 0;
    const execOptions: ExecuteOptions = {
      signal,
      tutorTemplates: eduTutorTemplate,
      // #881 — the chain's pinned seed (#865). This is what makes the replay a genuine
      // continuation rather than a fresh roll of the dice: `@openlogo/runtime`'s clock fallback
      // was its only source of nondeterminism, so with the seed fixed every attempt of this chain
      // reproduces the previous one exactly up to the read.
      randomSeed: chainRandomSeed,
      ...(host === undefined
        ? {}
        : {
            hostInput: {
              read: (prompt: string): string | undefined => {
                const resolution = resolveRecordedAnswer(
                  answers,
                  answerCursor,
                  prompt,
                );
                answers = resolution.retained;
                if (resolution.answer !== undefined) {
                  answerCursor += 1;
                  return resolution.answer;
                }
                pendingRead = { prompt, host };
                return undefined;
              },
            },
          }),
      ...(options?.instructionBudget !== undefined
        ? { instructionBudget: options.instructionBudget }
        : {}),
      ...(options?.recursionDepthLimit !== undefined
        ? { recursionDepthLimit: options.recursionDepthLimit }
        : {}),
    };

    const result = execute(sourceText, document, execOptions);
    currentEvents = result.events;
    preparedSource = sourceText;

    // #769 — a probe (an attempt that ended on an unanswered read) withholds its diagnostics until
    // the learner actually dismisses the question; see this module's doc comment for why the only
    // diagnostic it can carry is the reader's own forced cancellation.
    attemptDiagnostics = result.diagnostics;
    const diagnostics: readonly Diagnostic[] =
      pendingRead === null ? result.diagnostics : [];

    const output = collectOutput(result.events);
    state.setOutput(output);
    state.setDiagnostics(diagnostics);
    // #432 finding 2 — snapshot this run's output/diagnostics immutably, separate from the live
    // `output`/`diagnostics` fields above. Those live fields get overwritten by
    // `diagnostics.ts`'s parse-as-you-type re-checking on every subsequent source edit — including
    // mid-run, since a paced (non-instant) run leaves `runStatus` at `"running"` across many
    // event-loop turns while the editor stays fully live. `run-log.ts` reads this snapshot instead
    // of the live fields at the terminal transition, so an entry always reflects the run that
    // produced it, never a later edit's parse result.
    state.setLastRunResult({
      source: preparedSource,
      output,
      diagnostics,
    });
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
        settleAttempt(current);
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
    // #769 — resume the picture instead of redrawing it. A later attempt in the same chain replays
    // the whole program, so its stream starts with everything the previous attempt already drew.
    // Consume that prefix silently (no snapshot is pushed until playback proper begins, so the
    // canvas never blanks) and let paced playback carry on from the read.
    //
    // The prefix is measured in EVENTS but consumed in STEPS, and those do not align at the read:
    // the statement that was waiting on it contributed only its own `instruction` event to the
    // probe, and the learner's answer has now extended that same step with the effects it
    // produces. `forward input "how far?"` is the whole hazard in one line — stepping merely
    // "past the event count" would consume that step's brand-new `move`/`draw-segment` too,
    // silently skipping the very movement the answer just produced. So a step is only fast-
    // forwarded when it ends at or before the already-drawn boundary; the first step that reaches
    // past it is left for playback to animate. Clamping to the new stream's own length also makes
    // this loop provably terminating — `stepEndIndex` always reports at least `cursor + 1`.
    const alreadyDrawn = Math.min(shownEventCount, result.events.length);
    let drawnCursor = 0;
    while (drawnCursor < alreadyDrawn) {
      const stepEnd = stepEndIndex(result.events, drawnCursor);
      if (stepEnd > alreadyDrawn) {
        break;
      }
      current.step();
      drawnCursor = stepEnd;
    }
    return current;
  }

  /** Start (or resume) playback of the attempt `prepare()` just built, then settle its outcome. */
  function playCurrentAttempt(current: TurtleAnimationController): void {
    playWithMotionPreference(current, {
      reducedMotion: (options?.reducedMotion ?? false) || currentIsInstant,
    });
    pushTurtleSnapshot(current);
    settleAttempt(current);
  }

  /**
   * Drive attempts of the current chain (#769) until one finishes without an unanswered read, or
   * until a question is left outstanding for the learner. Re-entrant by design: a host that answers
   * synchronously calls back into `pump()` from inside the attempt that asked, which only marks
   * `pumpAgain` so the already-running loop takes the next attempt — never a nested call stack that
   * would grow with the number of questions.
   *
   * #881 — each iteration strictly consumes one more read than the last: the chain's source, seed,
   * and every already-recorded answer are frozen, so a read's prompt at a given FIFO position is
   * the same on every attempt and the newest answer always advances the chain. That is what makes
   * this loop terminate for any program with a bounded number of reads, and it is why the
   * no-progress retry cap this loop used to carry is gone — see this module's doc comment ("#881").
   */
  function pump(): void {
    if (pumping) {
      pumpAgain = true;
      return;
    }
    pumping = true;
    try {
      do {
        pumpAgain = false;
        playCurrentAttempt(prepare(chainSource, options?.inputPrompt));
      } while (pumpAgain);
    } finally {
      pumping = false;
    }
  }

  function run(): void {
    if (state.getState().runStatus === "running") {
      // #314 — a run is already in progress (only reachable with a real paced scheduler, where
      // runStatus stays "running" across many event-loop turns, or #769's outstanding `input`
      // question): ignore the extra call rather than silently starting a second run mid-animation.
      // See this module's doc comment, "#314".
      return;
    }
    // #769 — a fresh chain: no answers carried over, nothing drawn yet, and the program text pinned
    // for every attempt this chain makes. #881 pins the chain's randomness the same way and for the
    // same reason: every attempt must be the SAME run, not merely the same program.
    answers = [];
    shownEventCount = 0;
    promptGeneration += 1;
    promptOutstanding = false;
    chainSource = state.getState().source;
    chainRandomSeed = drawRandomSeed();
    pump();
  }

  function stop(): void {
    signal.aborted = true;
    userStopped = true;
    animation?.pause();
    if (withdrawPendingRead()) {
      // #769 — Stop while an `input` question was open: the read ended unanswered, so publish the
      // cancellation the attempt already produced rather than leaving it withheld.
      commitCancelledRead();
    }
    state.setRunStatus("stopped");
  }

  function reset(): void {
    withdrawPendingRead();
    answers = [];
    chainSource = "";
    attemptDiagnostics = [];
    shownEventCount = 0;
    signal.aborted = false;
    userStopped = false;
    state.setOutput([]);
    state.setDiagnostics([]);
    state.setTutorOutput([]);
    state.setLastRunResult(null);
    animation?.reset();
    animation = null;
    currentEvents = [];
    preparedSource = "";
    state.setCurrentInstructionSourceSpan(null);
    state.setTurtleWorld(INITIAL_TURTLE_WORLD_STATE);
    state.setTurtleScene(INITIAL_TURTLE_SCENE);
    options?.canvasView?.repaint();
    state.setRunStatus("idle");
  }

  function step(): void {
    if (pendingRead !== null) {
      // #769 — the run is blocked on an `input` question: there is nothing to step until it is
      // answered or dismissed. See this module's doc comment for why stepping never drives the
      // prompt flow itself.
      return;
    }
    // #289 — from the initial idle state (before any run()), no animation exists yet: prepare()
    // lazily builds one (executing the CURRENT source exactly as run() would) so stepping from a
    // blank studio animates the first instruction instead of silently doing nothing. Once an
    // animation already exists (mid-run, paused, or exhausted), this is exactly the pre-#289
    // behavior: step the existing one, never rebuilding it from a possibly-changed source. No
    // prompt host is installed (#769) — see this module's doc comment. #881: a lazy preparation is
    // its own one-attempt chain, so it draws its own seed rather than reusing a finished run's.
    if (animation === null) {
      chainRandomSeed = drawRandomSeed();
    }
    const current = animation ?? prepare(state.getState().source, undefined);
    current.step();
    pushTurtleSnapshot(current);
    settleAttempt(current);
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
