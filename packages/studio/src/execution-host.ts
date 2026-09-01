/**
 * The **execution host** seam (#876) — the one decision about *where* a studio run's `execute()`
 * happens, and therefore about how an `input` read is reconciled with a browser prompt.
 *
 * `run-controller.ts` composes a host rather than calling `@openlogo/runtime`'s `execute()` itself.
 * Everything the controller does around a run — reducing output, driving the turtle animation,
 * committing `runStatus`, presenting the question — reaches the same **eventual** state whichever
 * host is installed, because a host's whole contract is "settle with an
 * {@link ExecutionSettlement}". What differs is *when*: the in-process host settles synchronously,
 * so a run ends within the call that started it, while a Worker host settles across event-loop
 * turns — so the studio is still `"running"` at moments the in-process host would already have
 * committed a terminal status. Dismissing a question is the clearest case: identical outcome, but
 * one is immediate and the other waits for the abandoned run's own ending to arrive.
 *
 * ## The two hosts, and why both exist
 * - {@link createInProcessExecutionHost} is the default and carries **#769's replay** unchanged: the
 *   runtime reader is synchronous, so a read with no recorded answer returns `undefined` (cancelling
 *   that attempt at the waiting `input`), and the controller re-executes the captured source with
 *   the new answer appended. N reads cost N+1 executions.
 * - `worker-execution-host.ts` runs the interpreter in a Worker and **genuinely blocks** inside the
 *   read on `Atomics.wait`. One execution, however many questions.
 *
 * The replay is the **degraded mode, not dead code**: `SharedArrayBuffer` requires COOP/COEP
 * cross-origin isolation, which is a deployment posture not every host has. `web/main.ts`
 * feature-detects it and picks; see `docs/adr/0023-worker-execution-host.md`.
 *
 * ## Where the bound lives
 * #881 deleted the replay chain's no-progress retry cap, having proved the situation it guarded
 * unreachable. Its reviewers carried forward the consequence: with the cap gone, a reintroduction of
 * replay divergence would be an unbounded loop rather than a bounded test failure. A Worker host
 * answers that structurally rather than with another counter — **it never replays to answer a
 * read**, so there is no attempt sequence to diverge and nothing for a cap to count. (Since #952 it
 * does replay to deliver *input*, which is a separate chain driven by learner keystrokes; a chain
 * that has asked a question accepts none, so the two never interleave.) That invariant is pinned
 * directly
 * (`worker-execution-host.test.mjs` asserts one run command for a program with several reads), and
 * the wait itself is separately bounded in `blocking-input-channel.ts`.
 *
 * ## Why a settlement carries reduced output rather than only events
 * Trace events cross a Worker boundary by structured clone, which **drops class prototypes**: an
 * `OLDict` arrives as a plain object and `@openlogo/runtime`'s `printedForm` then throws
 * (`TypeError: record.fields is not a function`, measured on `print { a: 1 b: 2 }`). So the
 * reduction to learner-visible text happens on whichever thread produced the values, and a
 * settlement carries the finished `output`/`tutorOutput` alongside the events. The events
 * themselves are consumed only by `@openlogo/turtle`'s animation and by the instruction-span
 * lookup, both of which read plain data — but keeping the reduction with the values is what makes
 * that a rule rather than a coincidence.
 */

import { execute, printedForm } from "@openlogo/runtime";
import type {
  CancellationSignal,
  ExecuteOptions,
  HandlerDelivery,
  HostInput,
  HostInputEvent,
  TickBoundary,
} from "@openlogo/runtime";
import type {
  Diagnostic,
  PrintPayload,
  TraceEvent,
  TutorOutputPayload,
} from "@openlogo/core";
import { eduTutorTemplate } from "./tutor-output-pane.js";

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
 * — the one tested place that owns this decision, extracted from the in-process host's reader so it
 * can be proven directly rather than only through a replay whose divergence needs nondeterminism to
 * provoke.
 *
 * An answer is used **only** when the entry at this position was given for this same `prompt`.
 * "This same question" means **this prompt text at this FIFO position**. Otherwise the read cannot
 * be answered: the chain has no answer for this position yet, or — the case this pairing exists to
 * make impossible — a replay reached a different question here than the learner was shown. In that
 * second case every remaining answer is dropped as well, since handing one to the wrong question
 * would silently apply a learner's answer to something they never saw.
 *
 * Since **#881** pinned one `ExecuteOptions.randomSeed` per chain (see `run-controller.ts`'s doc
 * comment), a replay the run controller itself drives is bit-identical up to the newest read, so the
 * divergence arm is unreachable through `run()`: position is now a stable read identity, which is
 * exactly what lets **two distinct `input` sites asking the identical prompt text** each receive
 * their own answer. This function is nonetheless kept, exported, and directly tested — it is what
 * makes "an answer never reaches a question it did not answer" hold **by construction** rather than
 * by trusting that determinism argument, and it costs one comparison per read.
 *
 * A Worker host (#876) never consults it at all, because it never replays to answer a read — and a
 * chain that has asked a question delivers no host input either (#952), so its #952 replay cannot
 * reach a read at all.
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

/**
 * One attempt to run a program, as a host receives it. Every field is plain data so the whole
 * request can cross a Worker boundary by structured clone — in particular there is no
 * `CancellationSignal` here, because an object's mutation is invisible across threads: a Worker host
 * cancels through shared memory instead (`blocking-input-channel.ts`), and the in-process host is
 * handed the controller's own signal at construction.
 */
export interface ExecutionRequest {
  /** The program text — captured once per chain, so a mid-question edit cannot swap it. */
  readonly source: string;
  /** The document identifier `execute()` stamps diagnostics with. */
  readonly document: string;
  /** The chain's pinned `ExecuteOptions.randomSeed` (#865/#881). */
  readonly randomSeed: number;
  /**
   * Whether the controller's cancellation is **already latched** when this attempt starts (#876).
   *
   * `stop()` latches its signal and only `reset()` re-arms it, so a `run()` after a Stop is meant to
   * halt immediately with `ol-limit`. The in-process host holds that very signal object and honours
   * it for free; a Worker host cannot see an object's mutation across threads, so it needs the state
   * as **data** and raises the flag on the new run's shared channel before the interpreter starts.
   * Without it the two hosts disagreed on a rule this controller documents.
   */
  readonly cancellationRequested: boolean;
  /** Overrides `ExecuteOptions.instructionBudget` when set. */
  readonly instructionBudget?: number;
  /** Overrides `ExecuteOptions.recursionDepthLimit` when set. */
  readonly recursionDepthLimit?: number;
  /**
   * Whether an `input` read may be put to the learner at all. `false` installs no
   * `ExecuteOptions.hostInput` — exactly what `step()`'s lazy preparation wants, since stepping is a
   * scrubber over an already-produced stream with no execution for a read to block.
   */
  readonly acceptsReads: boolean;
  /**
   * The chain's accumulated answers, oldest first. Only a replaying host consults these; a Worker
   * host resumes the suspended read in place and never re-reads the FIFO.
   */
  readonly answers: readonly RecordedAnswer[];
  /**
   * The tick-scheduled key presses, clicks, and named events this attempt delivers (#952) — the
   * other half of the `hostInput` seam, beside {@link acceptsReads}'s reader. Installed as
   * `ExecuteOptions.hostInput.events`, which is what makes a program's `on_key`, `on_click`, and
   * `when` handlers actually **fire** in the studio rather than merely register.
   *
   * Plain data, like every other field here, so it crosses a Worker boundary by structured clone
   * unchanged; `execution-worker-runner.ts` reaches it through the same {@link toExecuteOptions},
   * so the two hosts cannot drift on what a run is configured with.
   *
   * Omitted (or empty) means "no key, click, or named event was delivered to this attempt", which
   * is the behavior every run had before #952 and which `step()`'s scrubber preparation still
   * wants. `run-controller.ts` owns how a real browser keystroke becomes an entry here — see its
   * doc comment ("#952"), in particular why each delivery takes its own studio-assigned **tick**
   * rather than a wall-clock instant.
   */
  readonly hostInputEvents?: readonly HostInputEvent[];
}

/**
 * One settled view of a run: everything `run-controller.ts` needs to surface it, whether the run has
 * finished or is suspended on a question.
 *
 * A host may settle **more than once** for a single {@link ExecutionHost.execute} call — a Worker
 * host settles once per outstanding read (a prefix, with the question) and once at completion.
 * Successive settlements only ever **extend** the previous one's `events`, which is what lets the
 * controller replace output and re-drive the canvas wholesale without the learner seeing a rewind.
 */
export interface ExecutionSettlement {
  /** The trace events emitted so far, in order. */
  readonly events: readonly TraceEvent[];
  /** One learner-visible line per `print` event, already in `printedForm` — never re-formatted. */
  readonly output: readonly string[];
  /** Every `explain`/`why`/`hint`/`debug` payload emitted so far, in order. */
  readonly tutorOutput: readonly TutorOutputPayload[];
  /** The run's diagnostics. Empty while a question is outstanding — the run has not failed. */
  readonly diagnostics: readonly Diagnostic[];
  /** The question the run is suspended on, or `null` when this settlement is a finished run. */
  readonly pendingPrompt: string | null;
  /** The answers the chain keeps — see {@link RecordedAnswerResolution.retained}. */
  readonly retainedAnswers: readonly RecordedAnswer[];
  /**
   * This run's **tick timeline** (#985) — one {@link TickBoundary} per elapsed tick, from
   * `@openlogo/runtime`'s `ExecuteOptions.tickTimeline`. Paired with `tickAtEventIndex` it answers
   * "which tick was the program at when it emitted event *i*", which is how the controller
   * schedules a delivery against the program's own clock instead of a counter of its own.
   *
   * Optional so a host that predates the seam still type-checks; absent, the controller degrades to
   * the pre-#985 behaviour rather than guessing a tick. It crosses a Worker boundary as plain data
   * (numbers only), so it survives structured clone unchanged — unlike the values in a `print`
   * event, which is why this can be carried while `output` cannot.
   */
  readonly tickTimeline?: readonly TickBoundary[];
  /**
   * This run's **delivery report** (#976) — one `@openlogo/runtime` `HandlerDelivery` per host-input
   * occurrence the run actually delivered, in delivery order, each counting the handler bodies that
   * occurrence entered. It is how `run-controller.ts` answers "did **this** press or click run a
   * handler" from the runtime's own count rather than by differencing the event stream.
   *
   * Each entry's `input` is **the very object** the controller put in
   * {@link ExecutionRequest.hostInputEvents}, so a delivery is matched by identity rather than by
   * index arithmetic over a schedule the runtime sorted (`HandlerDelivery`'s own contract).
   *
   * **A Worker host cannot carry this, by construction.** An `ExecutionRequest` crosses that
   * boundary by structured clone, so the occurrence objects a Worker run reports are copies and no
   * identity survives to match. Absent, the controller confirms nothing and suppresses nothing —
   * which is the conservative direction `canvas-interaction.ts` already documents for that host, not
   * a new gap. Do not "fix" it by pairing on schedule index: that is exactly the reconstruction
   * issue #975 exists to delete.
   */
  readonly handlerDeliveries?: readonly HandlerDelivery[];
}

/** How a host reports a settled view of the run it was given. */
export type ExecutionSettle = (settlement: ExecutionSettlement) => void;

/** Where a studio run's `execute()` happens — see this module's doc comment. */
export interface ExecutionHost {
  /**
   * Run `request`, settling once (in-process) or once per read plus once at completion (Worker).
   * The same `settle` is used for every settlement of that run.
   */
  execute(request: ExecutionRequest, settle: ExecutionSettle): void;
  /**
   * Abandon the current run: Stop or Reset. A host must **not** settle again afterwards — the
   * controller has already decided the run's outcome.
   */
  cancel(): void;
  /**
   * End the outstanding read in place, with the learner's answer or `undefined` for a dismissal.
   *
   * **Present only on a host that genuinely suspends a read.** Its absence is what tells
   * `run-controller.ts` that this host replays instead: the controller then records the answer in
   * the chain's FIFO and asks for another attempt, exactly as it has since #769. Modelling the
   * difference as a missing method rather than a boolean keeps a replaying host from carrying a
   * no-op it can never honour.
   */
  readonly resolveRead?: (answer: string | undefined) => void;
}

function isPrintEvent(
  event: TraceEvent,
): event is TraceEvent<PrintPayload> & { readonly kind: "print" } {
  return event.kind === "print";
}

/**
 * Reduce a trace-event stream down to one learner-visible output line per `print` event. Runs on
 * whichever thread produced the values — see this module's doc comment for why that matters.
 */
export function collectOutput(events: readonly TraceEvent[]): string[] {
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
export function collectTutorOutput(
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
 * Assemble the `ExecuteOptions` a request describes — the single place that turns the plain,
 * cloneable {@link ExecutionRequest} back into the runtime's own option shape, so the in-process
 * host and the Worker-side runner cannot drift apart on what a run is configured with.
 *
 * `tutorTemplates` is always `@openlogo/edu`'s real curriculum prose (#334): studio composes the
 * host's template into every run, it never chooses that pedagogy itself.
 *
 * #952 — `hostInput` now carries **both** halves of the runtime's seam: the live `read` for the
 * blocking `input` reporter (#769) and the tick-scheduled `events` a learner's keyboard and pointer
 * produced ({@link ExecutionRequest.hostInputEvents}). Before this, only `read` was ever installed,
 * so `on_key`/`on_click`/`when` handlers registered and could never fire. Neither half is installed
 * when it is absent, and `hostInput` itself is omitted entirely when both are — so a run with no
 * reader and no delivered input passes exactly the options it always did.
 */
export function toExecuteOptions(
  request: ExecutionRequest,
  signal: CancellationSignal,
  read: ((prompt: string) => string | undefined) | undefined,
  tickTimeline?: TickBoundary[],
  handlerDeliveries?: HandlerDelivery[],
): ExecuteOptions {
  const hostInputEvents = request.hostInputEvents ?? [];
  const hostInput: HostInput = {
    ...(read === undefined ? {} : { read }),
    ...(hostInputEvents.length === 0 ? {} : { events: hostInputEvents }),
  };
  return {
    signal,
    tutorTemplates: eduTutorTemplate,
    randomSeed: request.randomSeed,
    // #985 — the tick-timeline sink, when the caller wants one. Every host composes it here for the
    // same reason each already composes `tutorTemplates` here: one place decides, so the two hosts
    // cannot drift on what a run is given.
    ...(tickTimeline === undefined ? {} : { tickTimeline }),
    // #976 — the delivery-report sink, likewise. `hostInput.events` is installed above **by
    // reference**, so each report's `input` is the caller's own occurrence object and a host matches
    // its delivery by identity.
    ...(handlerDeliveries === undefined ? {} : { handlerDeliveries }),
    ...(read === undefined && hostInputEvents.length === 0
      ? {}
      : { hostInput }),
    ...(request.instructionBudget !== undefined
      ? { instructionBudget: request.instructionBudget }
      : {}),
    ...(request.recursionDepthLimit !== undefined
      ? { recursionDepthLimit: request.recursionDepthLimit }
      : {}),
  };
}

/** Construction options for {@link createInProcessExecutionHost}. */
export interface InProcessExecutionHostOptions {
  /**
   * The cancellation signal `run-controller.ts` owns and flips through `stop()`/`reset()`. It is
   * checked before every statement *within* one `execute()` call, so it cancels a loop already in
   * progress — but `execute()` is synchronous and never yields, so a same-thread caller cannot flip
   * it mid-run. That limitation is exactly what a Worker host removes.
   */
  readonly signal: CancellationSignal;
}

/**
 * The default host: `execute()` on the calling thread, with #769's replay reader. Settles exactly
 * once, **synchronously**, before `execute()` returns — which is why installing this seam changed
 * no existing behaviour and no existing test.
 *
 * It exposes no `resolveRead`, so `run-controller.ts` keeps driving the attempt chain: see
 * {@link ExecutionHost.resolveRead}.
 */
export function createInProcessExecutionHost(
  options: InProcessExecutionHostOptions,
): ExecutionHost {
  return {
    execute(request, settle) {
      // `request.cancellationRequested` needs no handling here: this host was constructed with the
      // very `CancellationSignal` object the controller latches, so `execute()` already sees it.
      // It exists for a host that cannot observe an object's mutation — see the field's own docs.
      // One cursor per attempt over the chain's accumulated answers. A read is answered from the
      // FIFO only when the recorded answer at this position was given for **this same question**.
      let answerCursor = 0;
      let retainedAnswers = request.answers;
      let pendingPrompt: string | null = null;

      const read = request.acceptsReads
        ? (prompt: string): string | undefined => {
            const resolution = resolveRecordedAnswer(
              retainedAnswers,
              answerCursor,
              prompt,
            );
            retainedAnswers = resolution.retained;
            if (resolution.answer !== undefined) {
              answerCursor += 1;
              return resolution.answer;
            }
            pendingPrompt = prompt;
            return undefined;
          }
        : undefined;

      const tickTimeline: TickBoundary[] = [];
      const handlerDeliveries: HandlerDelivery[] = [];
      const result = execute(
        request.source,
        request.document,
        toExecuteOptions(
          request,
          options.signal,
          read,
          tickTimeline,
          handlerDeliveries,
        ),
      );

      settle({
        events: result.events,
        output: collectOutput(result.events),
        tutorOutput: collectTutorOutput(result.events),
        diagnostics: result.diagnostics,
        pendingPrompt,
        retainedAnswers,
        tickTimeline,
        handlerDeliveries,
      });
    },
    cancel() {
      // Nothing to abandon: `execute()` has already returned by the time any caller can reach this,
      // and the signal this host was constructed with is the controller's own — `stop()` flips it
      // directly, and only `reset()` re-arms it.
    },
  };
}
