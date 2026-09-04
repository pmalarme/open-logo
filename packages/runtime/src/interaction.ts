/**
 * The Interaction & Events profile's **tick clock** and the `wait <n>` command (issue #680, slice
 * I1 — `spec/interaction-events.md`'s "Time, ticks, and handlers", the `wait <n>` primitive, and
 * "Trace stream integration"). This is the foundation the rest of the Interaction & Events track
 * (`when`/`every`/`on_key`/`on_click`, issues #682–#685, and dispatch order + cancellation, #686)
 * builds on: they hang handler dispatch off the same tick clock this file establishes.
 *
 * ## The tick clock is execution state, not wall-clock
 *
 * Interaction time is measured in **ticks** — "an implementation-defined logical frame used by
 * rendering, animation, and event dispatch" (`spec/interaction-events.md`, §Time, ticks, and
 * handlers). Here a tick is a purely logical counter on the {@link Environment}: it advances by a
 * fixed, deterministic amount per `wait` tick, never by wall-clock time. No **trace**-event payload
 * carries a tick: the `primitive` event `wait` emits carries only the primitive name.
 * (`HostInputEvent` below carries a `tick`, but it is host *input*, not a trace event.)
 * The clock exists so that a program's event *sequence* is reproducible and
 * so timed handlers (`every <n>`) have a shared notion of "n ticks elapsed"; it is not
 * itself observable in the trace stream.
 *
 * ## Why `wait` is a per-tick loop, not a blocking sleep
 *
 * `spec/interaction-events.md`'s "Trace stream integration" is explicit: "Unlike `input`, `wait`
 * does not block the event system. While a `wait` pause elapses, the tick clock keeps advancing
 * and registered `every`, `on_key`, and `on_click` handlers still fire; only the top-level
 * instructions that follow the `wait` are deferred until the pause completes."
 *
 * That is why the pause is an explicit per-tick advance ({@link advanceTickClock}
 * called once per tick inside {@link runWait}) rather than a single opaque
 * `tick += n`/blocking sleep: the per-tick step is the seam handler delivery hangs off.
 * `execute-internal.ts` passes a per-tick callback that calls `dispatchDueHandlers` at each tick
 * the clock advances to — and once at the current tick for `wait 0`, which advances to none — so a
 * `wait` keeps firing due handlers while it pauses. A
 * `wait` written as a blocking sleep could not do that.
 *
 * ## Why a `wait` tick costs an instruction
 *
 * That same per-tick step is also the seam the **execution budget** hangs off (issue #953, licensed
 * by #1034: "Each tick a `wait` advances costs one instruction against the execution budget…").
 * Because the pause is a loop over learner-supplied `n`, it is unbounded work by construction — the
 * shape `spec/execution-model.md`'s
 * [Execution safety](../../../spec/execution-model.md#execution-safety) says is "safe only because
 * it is cancellable **and** budgeted". Cancellation was built (the per-tick `signal.aborted` poll in
 * `dispatchDueHandlers`); the budget was not, so the whole pause was one charged statement
 * regardless of `n` and `wait` was the one form in the language that had only half the pair.
 * {@link runWait} therefore charges one instruction per tick it is about to advance to, through
 * {@link TickCharge}. See that type for the full rationale, including why the charge creates no
 * additional step or `instruction` event.
 *
 * ## Why `input` has no event-loop checkpoint at all
 *
 * `input` (issue #681) is the exact mirror image. `spec/interaction-events.md:154-157`: "`input` is
 * the only blocking read in OpenLogo v0.1. While `input` is waiting, the implementation MAY continue
 * rendering already-emitted trace events, but it MUST NOT run new OpenLogo instructions or event
 * handler blocks until the read finishes or the program is cancelled."
 *
 * That MUST NOT is implemented here as an **absence**: the read ({@link takeInputResponse} →
 * {@link interpretSubmittedText} → {@link emitInputPrimitive}) never calls
 * {@link yieldToEventLoop}, never calls {@link advanceTickClock}, and never reaches
 * `dispatchDueHandlers`. Handler delivery in this runtime happens *only* at a `wait`'s per-tick
 * checkpoint, so a read that reaches no checkpoint runs no handler block, and a clock that does not
 * advance can bring no `every` handler due. Rendering is unaffected — already-emitted events are
 * still in `environment.events`, which is what the spec permits a host to keep rendering.
 *
 * The tempting wrong implementation is to "let the host answer" by pumping the event loop during the
 * read (a `runWait`-style loop until an answer arrives). That is precisely what `:156-157` forbids,
 * and it is what `interaction-input-blocking.test.mjs` exists to catch: it schedules host input that
 * a `wait` in the same position provably *does* deliver and asserts an `input` in that position
 * delivers nothing.
 */

import type { PrimitivePayload, SourceSpan, TraceEvent } from "@openlogo/core";
import type { BlockNode, SpannedName, StatementNode } from "@openlogo/parser";
import { parse } from "@openlogo/parser";
import { runtimeDiag } from "./errors.js";
import type { Environment } from "./evaluate.js";

/**
 * The Interaction & Events tick clock: a single mutable box holding the current logical tick
 * (`spec/interaction-events.md`, §Time, ticks, and handlers). A box — like the environment's
 * `instructionCount`/`addressing` — rather than a plain field reassigned on {@link Environment}, so a
 * tick advance made from anywhere in the program (including deep inside a procedure call or loop
 * body) is observed by every later read in the same run. The clock is
 * headless logical state and appears in no trace-event payload (see the file header).
 */
export interface TickClock {
  tick: number;
}

/** A fresh tick clock at tick `0` — the state of the clock at program start. */
export function createTickClock(): TickClock {
  return { tick: 0 };
}

/**
 * One entry of the **tick timeline** (issue #985): at the moment the clock advanced to `tick`,
 * `eventCount` trace events had been emitted. A host reads the pair to answer "which tick was the
 * program at when it emitted event *i*" — the tick of the last boundary whose `eventCount` is at
 * most *i*, and tick `0` before the first boundary.
 *
 * ## Why this is out of band, and must stay so
 * `spec/interaction-events.md:69-73` makes the tick "an implementation-defined logical frame used by
 * rendering, animation, and event dispatch", and this file's header records the consequence: **no
 * trace-event payload carries a tick**, which is what keeps the stream headless and a run's events
 * reproducible from source + seed + input schedule alone. This timeline is therefore a **separate,
 * caller-supplied sink** exactly like {@link ExecuteOptions.observedEvents} — never a new payload
 * field. Do not "simplify" it later by widening `PrimitivePayload` to carry a tick: that would smuggle
 * host-facing timing into the normative stream and break the determinism `input` replay depends on.
 *
 * ## Why boundaries rather than one entry per event
 * The clock advances in exactly one place ({@link runWait}'s per-tick loop), while trace events are
 * emitted from ~40 sites. Recording the boundary where the *clock* moves is one hook that yields the
 * same information as a per-event array, at a fraction of the size — a run that never waits records
 * nothing at all.
 */
export interface TickBoundary {
  readonly tick: number;
  readonly eventCount: number;
}

/**
 * The tick at which `events[eventIndex]` was emitted, per `timeline` (issue #985). Events emitted
 * before the first tick advance belong to tick `0`, which is the program's own starting tick — so a
 * run that never waits reports `0` for every event, correctly rather than by fallback.
 *
 * Lives here, beside the producer, so a host never re-derives the lookup and cannot disagree with the
 * runtime about what a boundary means.
 */
export function tickAtEventIndex(
  timeline: readonly TickBoundary[],
  eventIndex: number,
): number {
  let tick = 0;
  for (const boundary of timeline) {
    if (boundary.eventCount > eventIndex) {
      break;
    }
    tick = boundary.tick;
  }
  return tick;
}

/**
 * Advance `clock` by exactly one tick. Pair this with {@link yieldToEventLoop}: `wait` advances the
 * clock one tick at a time and yields to the event loop after each advance, so the two together are
 * the seam the rest of the Interaction & Events track (issues #682–#686) hangs handler dispatch
 * off. Keep the advance one tick at a time (never `tick += n`) so that per-tick seam stays intact.
 */
export function advanceTickClock(clock: TickClock): void {
  clock.tick += 1;
}

/**
 * The per-tick dispatch callback {@link runWait} invokes at each event-loop checkpoint. Given the
 * tick the clock has just advanced to (or `0` for a `wait 0` yield), it delivers any handlers due on
 * that tick and returns `true` if delivery was interrupted — a handler halted, returned, stopped, or
 * the execution budget was cancelled — so the `wait` MUST abort its remaining ticks and let that
 * outcome propagate. `false` means "keep pausing". Modelled as a plain `boolean` (not the runtime's
 * `ExecSignal`) so `interaction.ts` stays free of the evaluator's control-flow types; the caller in
 * `execute-internal.ts` stashes the real signal and reads it back after {@link runWait} returns.
 */
export type TickDispatch = (tick: number) => boolean;

/**
 * The per-tick **budget** callback {@link runWait} invokes before it advances the clock (issue
 * #953). Charges the tick about to elapse one instruction against the run's execution budget and
 * returns `true` when the run may not afford it — the same "check before you run another pass"
 * protocol {@link TickDispatch} uses for a halting handler, so the `wait` MUST abort its remaining
 * ticks and let that outcome propagate.
 *
 * ## Why a `wait` tick is a charged instruction
 *
 * Because `spec/interaction-events.md`'s `### wait <n>` now says so, normatively (issue #1034):
 * "Each tick a `wait` advances costs one instruction against the execution budget
 * ([execution safety](../../../spec/execution-model.md#execution-safety)), so a long enough `wait`
 * exhausts the budget and raises `ol-limit`, exactly as `forever` does, **even when no handler is
 * registered**. Charging a tick does not create an additional step or `instruction` event."
 * `ol-limit` is on `wait`'s own **Errors** list accordingly.
 *
 * That sentence is the licence; the reasoning that earned it is recorded here because it is what a
 * future reader needs in order to change any of this safely. `spec/execution-model.md`'s
 * [Execution safety](../../../spec/execution-model.md#execution-safety) is the whole safety argument
 * for every unbounded form the language has: "`forever` is therefore safe only because it is
 * cancellable and budgeted." A `wait` tick is unbounded work by exactly the same construction —
 * `wait <n>` takes an arbitrary learner-supplied `n`, and each of those ticks advances the clock,
 * polls cancellation, enqueues host input, and claims all four handler buckets
 * (`execute-internal.ts`'s `dispatchDueHandlers`). That is the same per-pass work a `forever` pass
 * does, so it earns the same answer: **one tick costs one instruction.** Before #953 the entire
 * pause was a single charged statement no matter how many ticks it ran, which made `wait` the one
 * form in the language that was cancellable but *not* budgeted — half of the pair the spec says
 * safety comes from. Measured on the saga tip before the fix, at the default budget of 1,000,000:
 * `wait 999999999` blocked the execution thread for 413 seconds and raised no diagnostic at all.
 *
 * The handler rule at `spec/interaction-events.md`'s "Time, ticks, and handlers" reasons in the same
 * shape — "Each handler invocation is itself an instruction and counts against the same execution
 * budget as any other instruction … While the program holds the run open — with `forever`, or a
 * long enough `wait` — the accumulating invocations exhaust the budget and raise `ol-limit`" — but
 * it is **not** the licence for this, and reading it as one was the review-gate finding that sent
 * #953 for a maintainer ruling. Its subject is the *accumulating invocations*: it catches a long
 * `wait` only by way of handler charging, which was already true before #953, and says nothing
 * about the handler-free case. The handler-free case is precisely the one that froze the tab, which
 * is why #1034's "even when no handler is registered" is the clause that closes it.
 *
 * The second half of that sentence — no additional step or `instruction` event — is pinned by
 * `tests/conformance/interaction-events/wait/wait-emits-no-per-tick-instruction` at one tick count
 * and by `interaction-wait.test.mjs` out to n = 200,000. The fixture states the rule; the test
 * supplies the reach, and that division is structural rather than stylistic — the largest `wait`
 * literal in the whole conformance corpus is that fixture's own 300, so no fixture can catch an
 * implementation that emits per-tick only past a larger threshold. It is load-bearing for the
 * learner, not merely for the trace: a step is "the span from one `instruction` event to the next"
 * (`spec/execution-model.md`'s trace-and-event registry), so a per-tick `instruction` would have
 * made a single **Next step** press on `spec/examples/10-game.logo`'s `wait 300` cost 301 —
 * measured under that mutation, not estimated.
 *
 * Modelled as a plain `boolean`, like {@link TickDispatch}, so this module stays free of the
 * evaluator's control-flow types; the caller in `execute-internal.ts` stashes the real `ExecSignal`
 * and reads it back after {@link runWait} returns. **Required, not optional** — a defaulted "free"
 * charge would silently reopen the hole for any future caller, the same reason
 * `resolvePositiveFiniteLimit` refuses to let a caller disable the budget.
 */
export type TickCharge = () => boolean;

/**
 * Yield to the renderer and event loop at a single logical checkpoint, delivering any handlers due
 * on `clock`'s current tick through `dispatch` (issues #682–#686). This is the dispatch seam the
 * Interaction & Events track hangs handler delivery off: I1 (#680) left it a no-op; I4 (#683) makes
 * it deliver due `every` handlers via `dispatch`, and #684/#685 add `on_key`/`on_click` the same
 * way, all in the registration order `spec/interaction-events.md` fixes.
 *
 * `wait` calls it **once per elapsed tick** (after each {@link advanceTickClock}) **and once for a
 * zero-tick pause** — so that `wait 0` still reaches this checkpoint. That matters because
 * `spec/interaction-events.md` (`wait <n>`) requires "`wait 0` yields to the renderer and event
 * loop without adding a visible delay": a zero-count pause is not a plain no-op, it is a yield with
 * no tick advance. `dispatch` is handed the clock's current tick so it delivers handlers for exactly
 * the tick just reached; it returns `true` when delivery was interrupted, which this function
 * forwards so the pause can abort.
 */
export function yieldToEventLoop(
  clock: TickClock,
  dispatch: TickDispatch,
): boolean {
  return dispatch(clock.tick);
}

/**
 * Is `statement` a call to `wait` (issue #680)? `wait` is an ordinary call, not a block-head or a
 * reserved word (`spec/interaction-events.md`: "`input` and `wait` are ordinary calls and take no
 * block"), so it is matched by callee name here rather than by a dedicated AST node. Accepts both
 * the plain infix `Call` form (`wait 2`) and the explicit-parentheses `ParenCall` form
 * (`(wait 2)`), and is a plain `boolean` rather than a type predicate to match the surrounding
 * turtle-command dispatch convention in `execute-internal.ts`.
 */
export function isWaitCall(statement: StatementNode): boolean {
  if (statement.kind !== "Call" && statement.kind !== "ParenCall") {
    return false;
  }
  return statement.callee.name.toLowerCase() === "wait";
}

/**
 * Emit the `primitive` event `spec/interaction-events.md` requires `wait` to emit **after** the
 * pause completes ("`wait` emits a `primitive` event after the pause completes"). The catch-all
 * `primitive` kind is already registered in `@openlogo/core` (C5, #694) and its
 * {@link PrimitivePayload} carries only the primitive `name` — never the tick count or any timing,
 * keeping the stream headless. Pushed onto the shared event sink with the next monotonic `seq`.
 */
export function emitWaitPrimitive(
  events: TraceEvent[],
  source_span: SourceSpan,
): void {
  emitInteractionPrimitive(events, source_span, "wait");
}

/**
 * Emit the `primitive` event `input` produces once its read has finished
 * (`spec/interaction-events.md:151-152`: "primitives without a more specific kind emit
 * `primitive`"). Emitted **after** the answer is in hand, matching the after-effect discipline the
 * whole stream follows (`:149-152`) and `wait`'s own "after the pause completes" rule. Like
 * {@link emitWaitPrimitive} the payload carries only the primitive `name` — never the prompt, the
 * submitted text, or anything else the learner typed, so the stream stays headless and a replayed
 * trace leaks nothing. No new event kind: #657's maintainer ruling keeps the trace/event registry in
 * `spec/execution-model.md` unchanged, so `input` is observable exactly as any other primitive is.
 */
export function emitInputPrimitive(
  events: TraceEvent[],
  source_span: SourceSpan,
): void {
  emitInteractionPrimitive(events, source_span, "input");
}

/** Push one catch-all `primitive` event naming `name` onto `events` with the next monotonic `seq`.
 * Shared by {@link emitWaitPrimitive} and {@link emitInputPrimitive} so the envelope both profile
 * primitives emit — no `turtle_id` (neither concerns a turtle), payload of exactly `{ name }` — is
 * written once. */
function emitInteractionPrimitive(
  events: TraceEvent[],
  source_span: SourceSpan,
  name: string,
): void {
  events.push({
    seq: events.length,
    kind: "primitive",
    source_span,
    payload: { name } satisfies PrimitivePayload,
  });
}

/**
 * Run a validated `wait <n>` pause (`spec/interaction-events.md`, `wait <n>`): pause the current
 * top-level instruction stream for `count` ticks by advancing `tickClock` one tick at a time and
 * yielding to the event loop after each tick ({@link advanceTickClock} + {@link yieldToEventLoop} —
 * the seam #682–#686 deliver due handlers from, see the file header), delivering any due handlers
 * through `dispatch` on each tick. If `dispatch` reports an interruption (a handler halted/returned/
 * stopped, or the budget was cancelled) the pause aborts immediately: {@link runWait} returns `true`
 * and does **not** emit the trailing `primitive` event, because the pause did not complete. On a
 * clean pause it emits the `primitive` event AFTER the pause completes onto `events` and returns
 * `false`. `count` MUST already be a validated non-negative whole number — `executeWaitCall`'s
 * `requireWholeNumber` (TYPE) then its non-negativity guard (RANGE), the same two-step
 * `executeEveryStatement` applies to an `every` interval.
 *
 * `wait 0` advances the clock zero times but still {@link yieldToEventLoop}s exactly once — it
 * "yield[s] to the renderer and event loop without adding a visible delay" (a spec-mandated yield,
 * not a plain no-op), so a `wait 0` can dispatch pending handlers too (and, if one of them halts,
 * abort before the primitive). The primitive event is emitted exactly once, after the loop, on any
 * clean pause regardless of `count`.
 *
 * Each tick the pause is *about to* advance through is first charged one instruction against the
 * run's execution budget through `charge` (issue #953, {@link TickCharge}) — so the number of ticks
 * a program can advance is bounded by the budget exactly as a `forever`'s passes are, and a
 * `wait 999999999` raises `ol-limit` instead of occupying the thread. The charge is taken **before**
 * {@link advanceTickClock}, so an unaffordable tick never advances the clock and never records a
 * timeline boundary: the clock, the timeline, and the trace all stop together at the last tick the
 * run could actually pay for, and the partial trace up to that cutoff is preserved rather than
 * discarded (the established `ol-limit` behavior — see
 * `tests/conformance/core-language/execution/forever-instruction-budget-limit.expected.json`).
 * `wait 0` advances no tick and so takes no charge beyond the one its own statement already paid.
 */
export function runWait(
  tickClock: TickClock,
  events: TraceEvent[],
  count: number,
  source_span: SourceSpan,
  dispatch: TickDispatch,
  charge: TickCharge,
  tickTimeline?: TickBoundary[],
): boolean {
  if (count === 0) {
    // `wait 0` yields to the event loop at the current tick without advancing it (a spec-mandated
    // yield, not a no-op — `spec/interaction-events.md`, `wait <n>`). No `every` handler can newly
    // come DUE here: a handler's next-due tick is always at least its interval (>= 1) past its
    // registration tick, so an interval is never reached at a tick the clock has NOT just advanced
    // to. Two other things can still run, and both can halt, so the dispatch verdict MUST be
    // honored exactly as it is on the per-tick advance below: current-tick input — a `hostInput`
    // key/click/named event scheduled at tick 0 (#684/#685/#686) — CAN be pending, and an `every`
    // occurrence already sitting in its one-slot queue is drained at any checkpoint where its
    // handler is free (ruling #984), including this one. (Ignoring the verdict here swallowed a
    // tick-0 handler's halt — the "`wait 0` treated as a no-op" failure mode.)
    if (yieldToEventLoop(tickClock, dispatch)) {
      return true;
    }
  }
  for (let elapsed = 0; elapsed < count; elapsed += 1) {
    // #953 — charge the tick BEFORE advancing to it, mirroring every other looping form's
    // "check before you run another pass". A tick the run cannot afford is never advanced to, so
    // the clock, the `tickTimeline` and the trace all stop together at the last affordable tick.
    if (charge()) {
      return true;
    }
    advanceTickClock(tickClock);
    // #985 — the one place the clock moves is the one place the timeline is recorded. Written
    // BEFORE dispatch, so a handler firing on this tick is attributed to the tick it ran on rather
    // than to the previous one; the events that handler emits land past this boundary's
    // `eventCount` and therefore read back as this tick.
    tickTimeline?.push({ tick: tickClock.tick, eventCount: events.length });
    if (yieldToEventLoop(tickClock, dispatch)) {
      return true;
    }
  }
  emitWaitPrimitive(events, source_span);
  return false;
}

/**
 * The document name the submitted answer is parsed under by {@link interpretSubmittedText}. Never
 * learner-visible: the parse is a classification, and any diagnostic it produces is discarded rather
 * than reported (a submission that does not parse is simply not a number literal — it is a word).
 */
const SUBMITTED_ANSWER_DOCUMENT = "<input>";

/**
 * Turn the text a learner submitted into the value `input` reports
 * (`spec/interaction-events.md:182-183`): "If the submitted text parses as an OpenLogo number
 * literal, the reporter returns a number. Otherwise it returns a word preserving the entered text."
 *
 * "Parses as an OpenLogo number literal" is decided by **the grammar itself** — `parse()` — rather
 * than a hand-written numeric pattern, so the two can never drift: `42`, `3.5`, `1e3`, and the
 * negative literal `-5` (`spec/grammar.md:17`: "A leading `-` directly before a numeral, when there
 * is no left operand, is part of a negative numeric literal") are numbers because the reader says
 * they are, and they stay numbers if the numeral grammar ever grows. A submission qualifies only
 * when it parses **cleanly** (no diagnostic) to **exactly one** statement that is a number literal,
 * so `.5` (which parses to `5` *plus* an `ol-bad-token`), `1 + 1` (an arithmetic call, not a
 * literal), `true` (a boolean literal), and `42 tom` all fall through to the word branch.
 *
 * Everything else reports "a word preserving the entered text" — returned verbatim, with no
 * trimming, case-folding, or escape processing, so `"  tom  "` reports those exact characters.
 */
export function interpretSubmittedText(text: string): number | string {
  const { ast, diagnostics } = parse(text, SUBMITTED_ANSWER_DOCUMENT);
  const [only, ...rest] = ast.body;
  if (
    diagnostics.length === 0 &&
    rest.length === 0 &&
    only !== undefined &&
    only.kind === "NumberLit"
  ) {
    return only.value;
  }
  return text;
}

/**
 * Take the next scripted answer for an `input` read, or `undefined` when none is left
 * (issue #681, the #657 ruling: `input` is tested by **mocking the answer** through
 * `ExecuteOptions.hostInput.responses`, with no new event kind).
 *
 * `responses` is a **FIFO queue consumed in order by each `input` call** — the first `input` takes
 * `responses[0]`, the second `responses[1]`, and so on — so a program with several reads is scripted
 * by listing its answers in program order. `consumed` is a mutable forward cursor shared through the
 * {@link Environment} (exactly like `hostInputConsumed`), so reads made anywhere in the run —
 * including inside a procedure, a loop body, or an event handler block — draw from the one queue and
 * no answer is ever handed out twice.
 *
 * `undefined` means the host has no answer to give; the caller turns that into the read's other
 * spec-sanctioned ending, cancellation ({@link runtimeDiag.cancelled}).
 */
export function takeInputResponse(
  responses: readonly string[],
  consumed: { count: number },
): string | undefined {
  if (consumed.count >= responses.length) {
    return undefined;
  }
  const answer = responses[consumed.count] as string;
  consumed.count += 1;
  return answer;
}

/**
 * The two standard named events `when` may register a handler for in OpenLogo v0.1
 * (`spec/interaction-events.md`'s `### when <event-word> <block>`): `"start"` — the start of the
 * interactive run — and `"stop"` — a requested stop notification before termination. An
 * implementation MAY additionally accept vendor events with a dotted prefix (e.g. `"acme.shake"`),
 * so this is a documentation aid, not a closed validation set: `when` accepts *any* word as an
 * event name (the type check only rejects a non-word, `ol-type`), and a handler for a word this
 * runtime never delivers simply never runs.
 *
 * In a headless batch `execute()` run with no host input, only `"start"` is *delivered*: the run has already
 * started, so a `when "start"` handler fires immediately on registration (spec: registering "does
 * not run its block immediately unless the triggering event is already being delivered"). `"stop"`
 * is "a requested stop notification" — the caller supplies no such request through
 * `ExecuteOptions.hostInput`, so a `when "stop"`
 * handler is accepted and registered but never fires there (exactly as a vendor event an
 * implementation does not deliver would not). A host that schedules `"stop"` through
 * `ExecuteOptions.hostInput` does fire it (#686/I7); this slice does not
 * synthesize one on natural completion, which the spec does not define as a stop request.
 */
export const STANDARD_EVENT_WORDS = Object.freeze({
  start: "start",
  stop: "stop",
} as const);

/**
 * One registered `when` handler: the block to run when its event fires, the {@link Environment}
 * captured at registration time so the body runs in its **registration-time lexical scope** (a
 * handler registered inside `define setup :x` sees `:x` when it runs, matching "A handler block is a
 * normal OpenLogo block"), plus the head-keyword {@link SpannedName} whose span the handler-block's
 * opening `instruction` event carries (`spec/interaction-events.md`'s "Trace stream integration":
 * "The start of a handler block emits an `instruction` event for the block-head that caused the
 * handler to run").
 *
 * A `when` registration carries **no delivery-state flag at all**, because it is **persistent**:
 * `spec/interaction-events.md:204-209` — "A `when` registration is **persistent**, exactly like
 * `every`, `on_key`, and `on_click`: its block runs **each time** the named event occurs, once per
 * occurrence. An implementation MUST NOT retire a handler after its first invocation." Maintainer
 * ruling #984 settled this; the earlier one-shot `fired` flag is gone. Both standard v0.1 event
 * words (`"start"`/`"stop"`) occur once per run, so the rule is observable only for the
 * vendor-prefixed events `:201-202` permits.
 */
export interface WhenHandler {
  readonly event: string;
  readonly block: BlockNode;
  readonly keyword: SpannedName;
  readonly environment: Environment;
}

/**
 * One registered `every <n> <block>` handler (issue #683, slice I4 —
 * `spec/interaction-events.md`'s `### every <n> <block>`): a **repeated** timed action that runs its
 * `block` every `interval` ticks. Like {@link WhenHandler} it captures the {@link Environment} at
 * registration time so the body runs in its **registration-time lexical scope** ("A handler block is
 * a normal OpenLogo block"), and the head-keyword {@link SpannedName} whose span the handler-block's
 * opening `instruction` event carries ("The start of a handler block emits an `instruction` event
 * for the block-head that caused the handler to run").
 *
 * `interval` is the validated positive whole tick count. `nextDueTick` is the next tick at which
 * the handler should fire, anchored to **registration time**: it starts at `registrationTick +
 * interval` ("The first run occurs after `n` ticks have elapsed" — `n` ticks after the handler was
 * registered, NOT `n` ticks after global tick 0) and advances by `interval` each time an interval
 * arrives ({@link claimDueEveryHandlers}), so a handler registered mid-run and a `wait 0` that revisits
 * an already-delivered tick both behave correctly. `every` carries no terminal delivery flag: it
 * recurs for the whole run.
 *
 * That `+= interval` — measured from the previous interval, never from the moment an invocation
 * finished — is the spec's **fixed rate** rule (`spec/interaction-events.md:229-233`, maintainer
 * ruling #984): "each successive interval arrives `n` ticks after the previous interval, on that
 * original schedule. The period is never re-measured from the moment an invocation happens to
 * finish, so a late invocation does not push the following interval back."
 *
 * The three flags implement the spec's queueing rule (`spec/interaction-events.md:235-242`): "If a
 * prior invocation is still running when the next interval arrives, the implementation MUST queue
 * that occurrence and run it once the handler is free. … The queue holds **at most one** pending
 * invocation for that `every` handler". Handler invocations "run on the same OpenLogo execution
 * thread as ordinary instructions", so a handler only overlaps itself when a re-entrant `wait` inside
 * its body advances the clock past its own next interval.
 *
 * - `running` marks the body as on the stack, so an interval arriving inside it cannot re-enter it.
 * - `claimed` marks an owed invocation already collected into a dispatch batch but not yet run, so a
 *   sibling handler's nested `wait` cannot claim it a second time and fire it twice out of
 *   chronological order.
 * - `queued` is the spec's at-most-one queue itself: an interval that arrives while the handler is
 *   `running` or `claimed` sets it, and further intervals **coalesce** into the same slot rather than
 *   accumulating. The next point at which the handler is free drains it — the end of the tick's
 *   dispatch batch, or the main line's next statement boundary ({@link claimQueuedEveryHandlers}) —
 *   so the drain never waits for a fresh event-loop checkpoint the program may never supply.
 */
export interface EveryHandler {
  readonly interval: number;
  readonly block: BlockNode;
  readonly keyword: SpannedName;
  readonly environment: Environment;
  nextDueTick: number;
  running: boolean;
  claimed: boolean;
  queued: boolean;
}

/**
 * One registered `on_key <key-word> <block>` handler (issue #684, slice I5 —
 * `spec/interaction-events.md`'s `### on_key <key-word> <block>`): a keyboard handler that runs its
 * `block` when the named `key` is pressed. Like {@link WhenHandler} it captures the
 * {@link Environment} at registration time so the body runs in its **registration-time lexical
 * scope** ("A handler block is a normal OpenLogo block"), and the head-keyword {@link SpannedName}
 * whose span the handler-block's opening `instruction` event carries ("The start of a handler block
 * emits an `instruction` event for the block-head that caused the handler to run").
 *
 * `key` is the validated key word (`"space"`, `"enter"`, `"a"`, …), stored verbatim: word values are
 * case-significant in OpenLogo (unlike case-insensitive identifiers), and the spec mandates no
 * folding, so the exact spelling the learner wrote is preserved. The runtime never validates it
 * against a closed set — `spec/interaction-events.md` only says implementations SHOULD document their
 * supported key words, so any word is accepted and a handler for a key this host never delivers
 * simply never runs.
 *
 * A key press is **host input**: with no host input supplied, an
 * `on_key` handler registers but never fires — exactly like a `when "stop"` handler in the
 * same situation (locked by the `on-key-registered-not-delivered` fixture). Synthesizing a key press
 * is a host concern outside this slice, so this handler carries no delivery-state flag: it holds the
 * captured block and scope for an interactive host to deliver. It lives in its own
 * registration-ordered list so the same-tick delivery order (#686/I7)
 * (`when`/`on_key`/`on_click` first, then due `every`) holds across handler kinds without reworking it.
 */
export interface OnKeyHandler {
  readonly key: string;
  readonly block: BlockNode;
  readonly keyword: SpannedName;
  readonly environment: Environment;
}

/**
 * One registered `on_click <block>` handler (issue #685, slice I6 —
 * `spec/interaction-events.md`'s `### on_click <block>`): a pointer handler that runs its `block`
 * when the drawing surface is clicked or activated by an equivalent accessible action. Unlike
 * {@link WhenHandler}/{@link OnKeyHandler}/{@link EveryHandler} it carries **no argument** — `on_click`
 * is the only Interaction & Events block-head that takes just a block ("`on_click` takes none",
 * §Profile grammar) — so there is no event word, key word, or interval to hold: only the captured
 * `block`, the head-keyword {@link SpannedName} whose span the handler-block's opening `instruction`
 * event carries, and the {@link Environment} captured at registration time so the body later runs in
 * its **registration-time lexical scope** ("A handler block is a normal OpenLogo block").
 *
 * A click is **host input**: with no host input supplied, an
 * `on_click` handler registers but never fires — exactly like a `when "stop"` handler (I3) or
 * an `on_key` handler (I5) in the same situation (locked by the `on-click-registered-not-delivered`
 * fixture). Synthesizing a click is a host concern outside this slice, so this handler carries no
 * delivery-state flag: it holds the captured block and scope for an interactive host to
 * deliver. It lives in its own registration-ordered list so the same-tick delivery order (#686/I7)
 * (`when`, then `on_key`, then `on_click`, then due `every`) holds across handler
 * kinds without reworking it.
 */
export interface OnClickHandler {
  readonly block: BlockNode;
  readonly keyword: SpannedName;
  readonly environment: Environment;
}

/**
 * One host-supplied input delivery scheduled for a specific tick (issue #686, slice I7). This is the
 * headless, deterministic stand-in for the live keyboard/pointer/named events an interactive host
 * (the studio, `spec/interaction-events.md`'s "interactive host") delivers — supplied up
 * front through `ExecuteOptions.hostInput` (see `index.ts`), exactly analogous to the pre-aborted
 * {@link CancellationSignal} a caller already supplies through `ExecuteOptions.signal`. It carries
 * **no** coordinates, timing, or device detail — only the `tick` it is delivered on plus the minimum
 * needed to select handlers: a key word (`on_key`), nothing (`on_click`), or an event word (`when`).
 * `spec/interaction-events.md`'s "Time, ticks, and handlers" (l.91-93) mandates that an
 * implementation "MUST preserve the most recent key and click state needed to deliver the next
 * handler consistently", so representing pending key/click state is spec-required, not speculative.
 *
 * This is deliberately **not** a live device abstraction, an event loop, or an `input` read (that is
 * `input`, #681): it is the tick-scheduled dispatch *input* the same-tick ordering (#686/I7) is
 * proven against. In a normal headless run `hostInput` is absent, so every pending queue below stays
 * empty and no key/click/named event ever fires — exactly the I5/I6 "registered but not delivered"
 * behavior, now reached because nothing was pending rather than because delivery was impossible.
 */
export type HostInputEvent =
  | { readonly tick: number; readonly kind: "key"; readonly key: string }
  | { readonly tick: number; readonly kind: "click" }
  | { readonly tick: number; readonly kind: "event"; readonly event: string };

/**
 * The Interaction & Events **event-handler registry** (issue #682, slice I3): every `when` handler
 * registered so far, in registration order. A single append-only list (rather than a map keyed by
 * event word) is deliberate — it preserves one total registration order across all events, which is
 * the stable order same-tick dispatch (#686/I7) needs and cannot reconstruct if handlers were
 * bucketed per event with no cross-event ordering. Dispatch filters by event word at delivery time
 * ({@link claimPendingEventHandlers}); there is no per-handler delivery state to filter on, because
 * a `when` registration is persistent (`spec/interaction-events.md:204-209`).
 *
 * This is the structure the file header promised the rest of the track would hang off the tick
 * clock's {@link yieldToEventLoop} seam: `when` populates it and `"start"` fires from it immediately
 * on registration (the run has already started). `every`/`on_key`/`on_click` (#683–#685) add their
 * own handler kinds alongside it (`every` in #683, `on_key` in #684), and an interactive host
 * delivers `"stop"` and the timed/input events from it.
 *
 * `pendingEvents`/`pendingKeys`/`pendingClicks` (issue #686, slice I7) are the tick-scheduled
 * host-input queues {@link enqueueHostInput} fills from `ExecuteOptions.hostInput` and
 * {@link dispatchDueHandlers} drains, in the spec's same-tick order, at the tick seam. They are
 * distinct from the four handler lists — a named event, key press, or click is an *occurrence* to be
 * delivered to whichever handlers match, not a handler registration — and stay empty whenever no
 * host input was supplied (a normal headless run), so they never disturb the I5/I6 never-fires
 * behavior. Kept as separate queues (not merged into one) so the drain order is imposed purely here,
 * at the dispatch point, exactly as the four registration lists are kept separate.
 *
 * Each queued occurrence carries the {@link HandlerDelivery} record of the host input that created
 * it (issue #975), so an invocation can be credited back to the occurrence that caused it. The tag
 * is attached **here, at enqueue time**, and kept uniform across all three queues. For keys and
 * named events that is load-bearing rather than merely tidy: those two claim functions flatten
 * handler-major/occurrence-minor, so after the fact an invocation's occurrence is **not** recoverable
 * by position, and re-deriving it is exactly the reconstruction #975 exists to delete. Clicks flatten
 * the other way round — occurrence-major/handler-minor, since `on_click` takes no argument and every
 * registered handler answers every click — so position alone would suffice there; the tag is carried
 * anyway so one mechanism covers all three and no future reordering of the click loop can quietly
 * break attribution. `pendingClicks` is a list of those tags rather than a bare count for the same
 * reason: the delivery record is the only thing distinguishing one pending click from another. The
 * tag is `undefined` when the caller supplied no delivery sink, which is every ordinary run.
 */
export interface EventHandlerRegistry {
  readonly handlers: WhenHandler[];
  readonly everyHandlers: EveryHandler[];
  readonly onKeyHandlers: OnKeyHandler[];
  readonly onClickHandlers: OnClickHandler[];
  readonly pendingEvents: PendingOccurrence[];
  readonly pendingKeys: PendingOccurrence[];
  readonly pendingClicks: (HandlerDelivery | undefined)[];
}

/** A fresh, empty event-handler registry — the state at program start (no handlers registered). */
export function createEventHandlerRegistry(): EventHandlerRegistry {
  return {
    handlers: [],
    everyHandlers: [],
    onKeyHandlers: [],
    onClickHandlers: [],
    pendingEvents: [],
    pendingKeys: [],
    pendingClicks: [],
  };
}

/**
 * Register a `when` handler for `event`, appending it to `registry` in registration order and
 * returning the created {@link WhenHandler}. `environment` is captured so the handler body later runs
 * in its registration-time lexical scope. Registration itself is side-effect-only on the registry;
 * the caller emits the `primitive` event `spec/interaction-events.md` requires "after the handler is
 * registered" and then decides whether the event is already live (so **this** handler fires now) or
 * deferred.
 */
export function registerWhenHandler(
  registry: EventHandlerRegistry,
  event: string,
  block: BlockNode,
  keyword: SpannedName,
  environment: Environment,
): WhenHandler {
  const handler: WhenHandler = {
    event,
    block,
    keyword,
    environment,
  };
  registry.handlers.push(handler);
  return handler;
}

/**
 * Register an `every <n> <block>` handler (issue #683, slice I4), appending it to `registry` in
 * registration order and returning the created {@link EveryHandler}. `interval` MUST already be a
 * validated positive whole tick count; `registrationTick` is the tick clock's current value at
 * registration, so the handler's first firing is anchored `interval` ticks AFTER registration
 * (`nextDueTick = registrationTick + interval`) — "The first run occurs after `n` ticks have
 * elapsed" — rather than to global tick 0. `environment` is captured so the handler body later runs
 * in its registration-time lexical scope. A fresh handler is `running`, `claimed`, and `queued`-free.
 * Registration is side-effect-only on the registry; the caller emits the `primitive` event
 * `spec/interaction-events.md` requires "after the handler is registered". `every` handlers live in
 * their own list (never bucketed with `when`'s named-event handlers) so the spec's same-tick delivery
 * order — `when`/`on_key`/`on_click` first, then "due `every` events in registration order" (#686/I7)
 * — can filter each kind independently while each kind preserves its own registration order.
 */
export function registerEveryHandler(
  registry: EventHandlerRegistry,
  interval: number,
  block: BlockNode,
  keyword: SpannedName,
  environment: Environment,
  registrationTick: number,
): EveryHandler {
  const handler: EveryHandler = {
    interval,
    block,
    keyword,
    environment,
    nextDueTick: registrationTick + interval,
    running: false,
    claimed: false,
    queued: false,
  };
  registry.everyHandlers.push(handler);
  return handler;
}

/**
 * Register an `on_key <key-word> <block>` handler (issue #684, slice I5,
 * `spec/interaction-events.md`'s `### on_key <key-word> <block>`), appending it to `registry` in
 * registration order and returning the created {@link OnKeyHandler}. `key` MUST already be the
 * validated key word (a `word` value, stored verbatim — case-significant, never folded); `environment` is captured so the handler body later runs in its
 * registration-time lexical scope. Registration is side-effect-only on the registry; the caller
 * emits the `primitive` event `spec/interaction-events.md` requires "after the handler is
 * registered". `on_key` handlers live in their own list (never bucketed with `when`'s named-event
 * handlers or `every`'s timed handlers) so the spec's same-tick delivery order — pending `when`,
 * then pending `on_key`, then `on_click`, then due `every` (#686/I7) — can filter each kind
 * independently while each kind preserves its own registration order. Handlers stay registered here;
 * it is {@link EventHandlerRegistry.pendingKeys} that a drain consumes, and with no host input
 * supplied nothing is ever pending.
 */
export function registerOnKeyHandler(
  registry: EventHandlerRegistry,
  key: string,
  block: BlockNode,
  keyword: SpannedName,
  environment: Environment,
): OnKeyHandler {
  const handler: OnKeyHandler = {
    key,
    block,
    keyword,
    environment,
  };
  registry.onKeyHandlers.push(handler);
  return handler;
}

/**
 * Register an `on_click <block>` handler (issue #685, slice I6,
 * `spec/interaction-events.md`'s `### on_click <block>`), appending it to `registry` in registration
 * order and returning the created {@link OnClickHandler}. `on_click` takes no argument — only the
 * `block`, the head {@link SpannedName} `keyword`, and the `environment` captured so the handler body
 * later runs in its registration-time lexical scope. Registration is side-effect-only on the
 * registry; the caller emits the `primitive` event `spec/interaction-events.md` requires "after the
 * handler is registered". `on_click` handlers live in their own list (never bucketed with `when`'s
 * named-event handlers, `every`'s timed handlers, or `on_key`'s keyboard handlers) so the spec's
 * same-tick delivery order — pending `when`, then pending `on_key`, then pending `on_click`, then due
 * `every` (#686/I7) — can filter each kind independently while each kind preserves its own
 * registration order. Handlers stay registered here; it is
 * {@link EventHandlerRegistry.pendingClicks} that a drain consumes, and with no host input supplied
 * nothing is ever pending.
 */
export function registerOnClickHandler(
  registry: EventHandlerRegistry,
  block: BlockNode,
  keyword: SpannedName,
  environment: Environment,
): OnClickHandler {
  const handler: OnClickHandler = {
    block,
    keyword,
    environment,
  };
  registry.onClickHandlers.push(handler);
  return handler;
}

/**
 * The batch of `every` invocations to run at the {@link yieldToEventLoop} checkpoint for `tick` — the
 * tick the clock has just advanced to — in registration order, claimed atomically **before any
 * handler body runs**.
 *
 * Two things happen per handler, in order.
 *
 * **Arrival (fixed rate).** An interval has arrived when `tick >= handler.nextDueTick`; because
 * `runWait` calls the dispatch once per tick (monotonically, never skipping a tick), the boundary is
 * reached at exactly `nextDueTick`. `nextDueTick` then advances by `interval` — measured from the
 * previous interval, never re-measured from an invocation's completion, which is the spec's fixed-rate
 * clock (`spec/interaction-events.md:229-233`). The arriving occurrence is put in the handler's
 * one-slot queue (`queued`); a second arrival while that slot is full **coalesces** into it, so the
 * queue never exceeds the spec's "at most one pending invocation" (`:235-242`). Tick `0` is never an
 * arrival — a fresh handler's `nextDueTick` is always `>= interval > 0`.
 *
 * **Claim.** A queued occurrence is claimed for delivery as soon as the handler is free: not
 * `running` (its body is not on the stack) and not already `claimed` into an outer batch. Draining is
 * therefore NOT conditional on an interval arriving on this very tick — an occupied handler's missed
 * occurrence runs at the first checkpoint after it becomes free, which is what makes queueing
 * observable rather than decorative. `running` prevents a handler re-entering itself; `claimed`
 * prevents a sibling's nested `wait` from re-claiming an occurrence an outer batch already owns
 * (which would otherwise fire it twice, out of chronological order).
 *
 * The caller ({@link dispatchDueHandlers}) invokes each returned handler via
 * {@link invokeEveryHandler}, which clears `claimed` and sets `running`. Returns a fresh array so a
 * handler body that registers a further `every` mid-dispatch does not extend the batch being
 * delivered on this tick; a tick with nothing to run yields an empty array — a well-defined no-op,
 * never an error.
 */
export function claimDueEveryHandlers(
  registry: EventHandlerRegistry,
  tick: number,
): readonly EveryHandler[] {
  const due: EveryHandler[] = [];
  for (const handler of registry.everyHandlers) {
    if (tick >= handler.nextDueTick) {
      handler.nextDueTick += handler.interval;
      handler.queued = true;
    }
    if (handler.queued && !handler.running && !handler.claimed) {
      handler.queued = false;
      handler.claimed = true;
      due.push(handler);
    }
  }
  return due;
}

/**
 * The queued `every` occurrences that are runnable **right now**, in registration order — a handler
 * whose one-slot queue is full and which is neither `running` nor already `claimed` into a batch.
 * Unlike {@link claimDueEveryHandlers} this consults no tick: it is the drain half of the spec's
 * queueing rule, "the implementation MUST queue that occurrence and **run it once the handler is
 * free**" (`spec/interaction-events.md:235-242`, maintainer ruling #984).
 *
 * A handler becomes free the moment its body returns, so the drain must not wait for a fresh
 * event-loop checkpoint. Requiring one is not a slower drain, it is a **lost** invocation: a program
 * whose `wait`s are exhausted supplies no further checkpoint, so the queued occurrence would never
 * run at all — observationally identical to the "drop the missed occurrence" reading the ruling
 * rejects. There are therefore three callers, each draining **once**: {@link dispatchDueHandlers}
 * after its tick batch, `executeStatements` before each statement of the main line (which reaches
 * procedure and control-form bodies through the shared `mainLineBoundary` box, but never a handler
 * body), and `evaluate.ts`'s comprehension loops at each iteration, since a comprehension body is an
 * expression that never reaches `executeStatements`.
 *
 * Neither loops until the queue is empty, and that is ruling 4 (`spec/interaction-events.md:244-250`):
 * a handler does not extend the run's lifetime. A drained invocation whose own body overruns
 * re-queues, so looping would run that occurrence and the next, manufacturing ticks the main line
 * never asked for until the budget raised `ol-limit`. Draining once per real boundary instead gives
 * an overrunning handler exactly one invocation per statement the main line still has — it
 * "degrade[s] to running back to back" (`:239-241`) for as long as the program stays open, and
 * whatever is still queued but unstarted when the main line finishes is discarded. Under an explicit
 * `forever` that back-to-back running is bounded by the ordinary instruction budget, since each
 * firing is a charged instruction (`spec/interaction-events.md:79`).
 */
export function claimQueuedEveryHandlers(
  registry: EventHandlerRegistry,
): readonly EveryHandler[] {
  const drained: EveryHandler[] = [];
  for (const handler of registry.everyHandlers) {
    if (handler.queued && !handler.running && !handler.claimed) {
      handler.queued = false;
      handler.claimed = true;
      drained.push(handler);
    }
  }
  return drained;
}

/**
 * Emit the `primitive` event `spec/interaction-events.md` requires a `when` registration to emit
 * **after** the handler is registered ("Event registration forms emit `primitive` events after the
 * handler is registered"). Like {@link emitWaitPrimitive}, the {@link PrimitivePayload} carries only
 * the primitive `name` — never the event word, tick, or any timing — keeping the stream headless.
 * Pushed onto the shared event sink with the next monotonic `seq`.
 */
export function emitWhenPrimitive(
  events: TraceEvent[],
  source_span: SourceSpan,
): void {
  events.push({
    seq: events.length,
    kind: "primitive",
    source_span,
    payload: { name: "when" } satisfies PrimitivePayload,
  });
}

/**
 * Emit the `primitive` event `spec/interaction-events.md` requires an `every` registration to emit
 * **after** the handler is registered ("Event registration forms emit `primitive` events after the
 * handler is registered"). Like {@link emitWhenPrimitive}, the {@link PrimitivePayload} carries only
 * the primitive `name` — never the tick count, interval, or any timing — keeping the stream headless
 * (`spec/execution-model.md`'s trace-and-event registry). Pushed onto the shared event sink with the
 * next monotonic `seq`.
 */
export function emitEveryPrimitive(
  events: TraceEvent[],
  source_span: SourceSpan,
): void {
  events.push({
    seq: events.length,
    kind: "primitive",
    source_span,
    payload: { name: "every" } satisfies PrimitivePayload,
  });
}

/**
 * Emit the `primitive` event `spec/interaction-events.md` requires an `on_key` registration to emit
 * **after** the handler is registered ("Event registration forms emit `primitive` events after the
 * handler is registered", issue #684). Like {@link emitWhenPrimitive}, the {@link PrimitivePayload}
 * carries only the primitive `name` — never the key word, tick, or any timing — keeping the stream
 * headless (`spec/execution-model.md`'s trace-and-event registry). Pushed onto the shared event sink
 * with the next monotonic `seq`.
 */
export function emitOnKeyPrimitive(
  events: TraceEvent[],
  source_span: SourceSpan,
): void {
  events.push({
    seq: events.length,
    kind: "primitive",
    source_span,
    payload: { name: "on_key" } satisfies PrimitivePayload,
  });
}

/**
 * Emit the `primitive` event `spec/interaction-events.md` requires an `on_click` registration to emit
 * **after** the handler is registered ("Event registration forms emit `primitive` events after the
 * handler is registered", issue #685). Like {@link emitWhenPrimitive}, the {@link PrimitivePayload}
 * carries only the primitive `name` — never a tick or any timing — keeping the stream headless
 * (`spec/execution-model.md`'s trace-and-event registry). Pushed onto the shared event sink with the
 * next monotonic `seq`.
 */
export function emitOnClickPrimitive(
  events: TraceEvent[],
  source_span: SourceSpan,
): void {
  events.push({
    seq: events.length,
    kind: "primitive",
    source_span,
    payload: { name: "on_click" } satisfies PrimitivePayload,
  });
}

/**
 * One entry of the **handler-registration log** (issue #975), appended once per handler registration
 * in registration order to the caller-supplied `ExecuteOptions.handlerRegistrations` sink.
 *
 * ## The question it answers
 *
 * An interactive host must decide **synchronously, inside a browser `keydown` handler**, whether a
 * key belongs to the running program — that decision drives `preventDefault`, and it fails in both
 * directions: too eager and the ~90% of programs with no interaction lose page scrolling, too lazy
 * and a game scrolls the studio away while the learner plays it. Answering it needs one fact the
 * runtime had and dropped: **which key words currently have handlers.** The registration `primitive`
 * event carries only the primitive's *name* (`spec/interaction-events.md:166-168` — "Event
 * registration forms emit `primitive` events after the handler is registered"), never its key word,
 * so before this a host had to re-derive the set by parsing the source and pairing declarations with
 * registration events by source position. This log is the runtime handing over what it already knew.
 *
 * The log is **append-only and never pruned, and that is exactly correct**: a registration is
 * permanent for the run — "Each registration creates a distinct handler: implementations MUST NOT
 * collapse, deduplicate, or replace registrations" and a handler is never retired after its first
 * invocation (`spec/interaction-events.md`, §Time, ticks, and handlers and `### when`). So the log
 * *is* the current registration set, and `on_key` entries' `key` values are the answer to "does
 * anything listen for `left`?".
 *
 * ## The limit of "currently", stated rather than smoothed over
 *
 * A registration does not exist until its statement executes, so **no implementation can answer
 * before the run** — `on_key :chosen_key [ … ]` inside a conditional is not knowable until it runs.
 * What this delivers is "which handlers are registered **now**", appended as each registration
 * executes. For an in-process host that is enough: `execute()` is synchronous, so the log is
 * complete and readable the instant the call returns — inside the same `keydown` turn, before the
 * next press. A host that runs the program across event-loop turns gets a log that grows as the run
 * proceeds and must accept the same partial knowledge the program itself has.
 *
 * `source_span` is the registration site — the span the block-head statement's own `instruction` and
 * `primitive` events carry. It is what makes two `on_key "space"` registrations distinguishable, and
 * it is what lets a host stop pairing declarations to registrations by source position at all.
 */
export type HandlerRegistration =
  | {
      readonly kind: "when";
      readonly event: string;
      readonly source_span: SourceSpan;
    }
  | {
      readonly kind: "every";
      readonly interval: number;
      readonly source_span: SourceSpan;
    }
  | {
      readonly kind: "on_key";
      readonly key: string;
      readonly source_span: SourceSpan;
    }
  | { readonly kind: "on_click"; readonly source_span: SourceSpan };

/**
 * One entry of the **delivery report** (issue #975), appended to the caller-supplied
 * `ExecuteOptions.handlerDeliveries` sink once per host-input occurrence the run actually delivers,
 * in delivery order.
 *
 * ## The question it answers
 *
 * "Was this delivered input **handled**?" — the second fact a host needs and could not get. Two
 * host-side proxies for it were built and both measured unsound, and their failures define what this
 * record must be:
 *
 * - **Event-stream growth is not monotonic in the thing it proxies.** A handler that *raises*
 *   *shortens* the stream (measured 45 events → 5 with `ol-undefined-var`), so the proxy reported
 *   "nothing responded" for a handler that ran and threw.
 * - **Asking after the run settles answers too late.** A Worker host settles a turn later, after the
 *   `keydown` has already scrolled the page. The answer arrives correct and useless.
 *
 * So `invocations` counts **handler bodies entered**, not bodies that completed: a handler that runs
 * and raises counts `1`, which is the axis that broke the stream-length formulation. `handled` is
 * simply `invocations > 0`; the count is reported rather than the boolean because the count is not
 * recoverable from the boolean and a consumer already asserts on it (two handlers at two positions
 * across two clicks count `2` then `4`).
 *
 * ## Precisely what `invocations` counts
 *
 * It is incremented at exactly the point the handler-block `instruction` event is emitted — the
 * event that carries issue #954's {@link HandlerFiring} discriminator. The outbound and inbound
 * halves of this contract are therefore **two views of one fact**, and cannot drift: `invocations`
 * equals the number of firing `instruction` events attributable to this delivery. An occurrence
 * whose handlers were never reached — the run halted, the budget ran out, or cancellation stopped
 * further delivery before it — truthfully reports `0` rather than the count it would have had.
 *
 * `input` is the schedule entry itself, the same object the caller supplied in
 * `ExecuteOptions.hostInput.events`, so a host matches a report to its own delivery by identity
 * rather than by index arithmetic over a schedule the runtime sorted. `invocations` is **mutable and
 * grows as the run proceeds**; it is final once `execute()` returns.
 */
export interface HandlerDelivery {
  readonly input: HostInputEvent;
  invocations: number;
}

/**
 * One claimed handler invocation: the handler to run, paired with the {@link HandlerDelivery} record
 * of the host-input occurrence that caused it (issue #975), or `undefined` when the caller supplied
 * no delivery sink. Pairing them **at claim time** is what makes the count observed rather than
 * derived. For the key and named-event queues that is the only sound option, because those claim
 * functions flatten handler-major/occurrence-minor and an invocation therefore cannot be attributed
 * back to its occurrence by position afterwards — precisely the kind of reconstruction issue #975
 * exists to delete. The click queue flattens occurrence-major instead, where position would suffice;
 * it is paired the same way so attribution has exactly one mechanism.
 *
 * Internal to this package: the three `claimPending*` functions that produce it are not part of
 * `@openlogo/runtime`'s public surface, so this type is not exported from `index.ts` either.
 */
export interface ClaimedInvocation<H> {
  readonly handler: H;
  readonly delivery: HandlerDelivery | undefined;
}

/**
 * One key press or named event sitting in a pending queue, tagged with the delivery it came from so
 * {@link ClaimedInvocation} can carry that tag through to the invocation.
 */
interface PendingOccurrence {
  readonly word: string;
  readonly delivery: HandlerDelivery | undefined;
}

/**
 * Move every {@link HostInputEvent} scheduled at or before `tick` from `hostInput` into `registry`'s
 * tick-scheduled pending queues (issue #686, slice I7), in the order they were supplied. This is the
 * headless stand-in for a host delivering keyboard/pointer/named events as the tick clock reaches
 * their scheduled tick: `wait` advances the clock one tick at a time and, at each tick's
 * {@link yieldToEventLoop} checkpoint, this fills the pending queues that {@link dispatchDueHandlers}
 * then drains in the spec's same-tick order. `consumed` counts how many entries of `hostInput` have
 * already been enqueued by earlier ticks, so each entry is enqueued exactly once even though the
 * checkpoint is revisited every tick; it is advanced past every entry whose `tick <= tick` and
 * returned so the caller can thread it forward.
 *
 * `hostInput` MUST be sorted by non-decreasing `tick` (the caller — `execute()` via
 * `ExecuteOptions.hostInput` — guarantees this by sorting once up front), so a single forward cursor
 * suffices and an entry is never stranded behind a later-tick one. An entry whose `tick` is `0` is
 * enqueued at the very first checkpoint (`wait 0`'s yield, or the first advanced tick), matching the
 * clock's initial value. Enqueuing only appends to the pending queues; it never runs a handler, so
 * it cannot itself be interrupted.
 *
 * When `deliveries` is supplied (issue #975), each entry moved into a pending queue also gets one
 * {@link HandlerDelivery} record appended — **at the moment it is delivered, with `invocations: 0`**,
 * so an occurrence that goes on to run nothing still appears in the report and reads as unhandled
 * rather than being silently absent. Because entries are enqueued in schedule order and each exactly
 * once, `deliveries[i]` describes the run's `i`-th *delivered* occurrence; an entry the run never
 * reached has no record at all.
 */
export function enqueueHostInput(
  registry: EventHandlerRegistry,
  hostInput: readonly HostInputEvent[],
  tick: number,
  consumed: number,
  deliveries?: HandlerDelivery[],
): number {
  let cursor = consumed;
  for (const entry of hostInput.slice(consumed)) {
    if (entry.tick > tick) {
      break;
    }
    let delivery: HandlerDelivery | undefined;
    if (deliveries) {
      delivery = { input: entry, invocations: 0 };
      deliveries.push(delivery);
    }
    if (entry.kind === "key") {
      registry.pendingKeys.push({ word: entry.key, delivery });
    } else if (entry.kind === "click") {
      registry.pendingClicks.push(delivery);
    } else {
      registry.pendingEvents.push({ word: entry.event, delivery });
    }
    cursor += 1;
  }
  return cursor;
}

/**
 * The `when` handlers to invoke for the named events queued for this tick (issue #686, slice I7;
 * delivery multiplicity settled by maintainer ruling #984), in the spec's same-tick order:
 * **handler registration order is primary** (`spec/interaction-events.md`, §Time, ticks, and
 * handlers: "pending `when` events in registration order") — the order the host happened to deliver
 * events in MUST NOT reorder the handlers.
 *
 * Each registered `when` handler is visited once in registration order; for each, it fires **once
 * per pending occurrence of its event**, preserving multiplicity exactly as
 * {@link claimPendingKeyHandlers} does for a key pressed twice. That is the persistence rule: a
 * `when` block "runs **each time** the named event occurs, once per occurrence"
 * (`spec/interaction-events.md:204-209`), so an event delivered twice in one tick fires its handler
 * twice. Clears the `pendingEvents` queue (these occurrences are being delivered now), returning the
 * flattened handler batch for {@link dispatchDueHandlers} to invoke. An empty queue — the normal
 * headless case, no host input — yields an empty batch, a well-defined no-op.
 */
export function claimPendingEventHandlers(
  registry: EventHandlerRegistry,
): readonly ClaimedInvocation<WhenHandler>[] {
  const events = registry.pendingEvents.splice(
    0,
    registry.pendingEvents.length,
  );
  const due: ClaimedInvocation<WhenHandler>[] = [];
  for (const handler of registry.handlers) {
    for (const event of events) {
      if (handler.event === event.word) {
        due.push({ handler, delivery: event.delivery });
      }
    }
  }
  return due;
}

/**
 * The `on_key` handlers to invoke for every pending key press queued for this tick (issue #686,
 * slice I7), in the spec's same-tick order: **handler registration order is primary**
 * (`spec/interaction-events.md`, §Time, ticks, and handlers: "pending `on_key` events in
 * registration order") — the delivery order the host happened to supply keys in MUST NOT reorder
 * the handlers, so a run is deterministic in the program's own registration order rather than in
 * host-input order. Each registered `on_key` handler is visited once in registration order; for
 * each, it fires once per pending key that matches its `key` word (matched verbatim — word values
 * are case-significant, never folded), preserving multiplicity (a key pressed twice fires its
 * handler twice). Clears the `pendingKeys` queue (these presses are being delivered now), returning
 * the flattened handler batch for {@link dispatchDueHandlers} to invoke. Unlike `when`, `on_key`
 * handlers carry no delivery-state flag — a key can be pressed any number of times, exactly as a
 * named event can occur any number of times ({@link claimPendingEventHandlers}). An empty queue
 * — the normal headless case — yields an empty batch.
 */
export function claimPendingKeyHandlers(
  registry: EventHandlerRegistry,
): readonly ClaimedInvocation<OnKeyHandler>[] {
  const keys = registry.pendingKeys.splice(0, registry.pendingKeys.length);
  const due: ClaimedInvocation<OnKeyHandler>[] = [];
  for (const handler of registry.onKeyHandlers) {
    for (const key of keys) {
      if (handler.key === key.word) {
        due.push({ handler, delivery: key.delivery });
      }
    }
  }
  return due;
}

/**
 * The `on_click` handlers to invoke for every pending click queued for this tick (issue #686, slice
 * I7), in the spec's same-tick order: one full pass over every registered `on_click` handler in
 * registration order per pending click (`spec/interaction-events.md`, §Time, ticks, and handlers:
 * "pending `on_click` events in registration order"). `on_click` takes no argument, so a click
 * delivers to *every* registered handler rather than a key/event-matched subset. Clears the pending
 * click count (these clicks are being delivered now), returning the flattened handler batch for
 * {@link dispatchDueHandlers} to invoke. An empty count — the normal headless case, no host input —
 * yields an empty batch, so a `wait` never fires an `on_click` handler unless a click was actually
 * pending.
 */
export function claimPendingClickHandlers(
  registry: EventHandlerRegistry,
): readonly ClaimedInvocation<OnClickHandler>[] {
  const clicks = registry.pendingClicks.splice(
    0,
    registry.pendingClicks.length,
  );
  const due: ClaimedInvocation<OnClickHandler>[] = [];
  for (const delivery of clicks) {
    for (const handler of registry.onClickHandlers) {
      due.push({ handler, delivery });
    }
  }
  return due;
}
