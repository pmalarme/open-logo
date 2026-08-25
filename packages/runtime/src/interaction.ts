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
 * fixed, deterministic amount per `wait` tick, never by wall-clock time. The trace stream is
 * "deterministic and headless" and "carries no timing or frames" (`spec/execution-model.md`'s
 * trace-and-event registry), so this clock MUST NOT leak into any event payload — the `primitive`
 * event `wait` emits carries only the primitive name ({@link PrimitivePayload}), never a tick
 * count or elapsed time. The clock exists so that a program's event *sequence* is reproducible and
 * so timed handlers (`every <n>`) have a shared notion of "n ticks elapsed"; it is not
 * itself observable in the stream.
 *
 * ## Why `wait` is a per-tick loop, not a blocking sleep
 *
 * `spec/interaction-events.md`'s "Trace stream integration" is explicit: "Unlike `input`, `wait`
 * does not block the event system. While a `wait` pause elapses, the tick clock keeps advancing
 * and registered `every`, `on_key`, and `on_click` handlers still fire; only the top-level
 * instructions that follow the `wait` are deferred until the pause completes." Those handlers do
 * not exist yet (they arrive with #682–#686), and the acceptance criterion that they keep firing
 * during a `wait` pause was moved to #686 precisely because it is not provable in this slice — so
 * this file does **not** implement or stub handler dispatch.
 *
 * What it DOES do is shape the pause as an explicit per-tick advance ({@link advanceTickClock}
 * called once per tick inside {@link executeWaitCall}) rather than a single opaque
 * `tick += n`/blocking sleep. That per-tick step is the seam #682–#686 hang handler delivery off:
 * a later slice makes {@link advanceTickClock} (or a dispatch pass it calls) deliver any handlers
 * that came due on the tick it just advanced to, and every existing `wait` immediately gains the
 * "handlers keep firing while I pause" behavior with no change to this file's control flow. A
 * `wait` written as a blocking sleep would satisfy this slice's own tests and then have to be
 * thrown away.
 *
 * ## Why `input` has no event-loop checkpoint at all
 *
 * `input` (issue #681) is the exact mirror image. `spec/interaction-events.md:108-111`: "`input` is
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
 * read (a `runWait`-style loop until an answer arrives). That is precisely what `:110-111` forbids,
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
 * headless logical state and MUST NOT appear in any event payload (see the file header).
 */
export interface TickClock {
  tick: number;
}

/** A fresh tick clock at tick `0` — the state of the clock at program start. */
export function createTickClock(): TickClock {
  return { tick: 0 };
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
 * (`spec/interaction-events.md:105-106`: "primitives without a more specific kind emit
 * `primitive`"). Emitted **after** the answer is in hand, matching the after-effect discipline the
 * whole stream follows (`:103-106`) and `wait`'s own "after the pause completes" rule. Like
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
 */
export function runWait(
  tickClock: TickClock,
  events: TraceEvent[],
  count: number,
  source_span: SourceSpan,
  dispatch: TickDispatch,
): boolean {
  if (count === 0) {
    // `wait 0` yields to the event loop at the current tick without advancing it (a spec-mandated
    // yield, not a no-op — `spec/interaction-events.md`, `wait <n>`). No `every` handler can be due
    // here: a handler's next-due tick is always at least its interval (>= 1) past its registration
    // tick, so it is never due at a tick the clock has NOT just advanced to. But current-tick input
    // — a `hostInput` key/click/named event scheduled at tick 0 (#684/#685/#686) — CAN be pending
    // and its handler can halt (`return`/`stop`, a runtime error, or a cancelled/over-budget run),
    // so the dispatch verdict MUST be honored exactly as it is on the per-tick advance below:
    // abort before the primitive and report the interruption. (Ignoring it here swallowed a tick-0
    // handler's halt — the "`wait 0` treated as a no-op" failure mode.)
    if (yieldToEventLoop(tickClock, dispatch)) {
      return true;
    }
  }
  for (let elapsed = 0; elapsed < count; elapsed += 1) {
    advanceTickClock(tickClock);
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
 * (`spec/interaction-events.md:136-137`): "If the submitted text parses as an OpenLogo number
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
 * In a headless batch `execute()` run only `"start"` is actually *delivered*: the run has already
 * started, so a `when "start"` handler fires immediately on registration (spec: registering "does
 * not run its block immediately unless the triggering event is already being delivered"). `"stop"`
 * is "a requested stop notification" — a batch run receives no such request, so a `when "stop"`
 * handler is accepted and registered but never fires here (exactly as a vendor event an
 * implementation does not deliver would not). An interactive host (a later slice, once cancellation
 * plumbing exists) delivers `"stop"` when a stop is actually requested; this slice does not
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
 * handler to run"). `fired` records that a one-shot event (`"start"`) already delivered this handler,
 * so it is skipped if that event is ever delivered again — the deterministic "a delivered handler
 * must not fire again" guarantee — without disturbing the registration order same-tick delivery
 * (#686/I7) relies on.
 */
export interface WhenHandler {
  readonly event: string;
  readonly block: BlockNode;
  readonly keyword: SpannedName;
  readonly environment: Environment;
  fired: boolean;
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
 * registered, NOT `n` ticks after global tick 0) and advances by `interval` each time the handler is
 * delivered ({@link claimDueEveryHandlers}), so a handler registered mid-run and a `wait 0` that revisits
 * an already-delivered tick both behave correctly. Unlike `when`'s one-shot `fired`, an `every`
 * handler has no terminal fired flag: it recurs for the whole run.
 *
 * `running` guards the spec's queueing rule — "If a prior invocation is still running when the next
 * interval arrives, the implementation queues at most one pending invocation for that `every`
 * handler to prevent unbounded buildup." Handler invocations "run on the same OpenLogo execution
 * thread as ordinary instructions", so a handler only overlaps itself when a re-entrant `wait` inside
 * its body advances the clock past its own next interval. `running` marks the body as on the stack;
 * {@link claimDueEveryHandlers} still advances the `nextDueTick` of a `running` handler (so the interval
 * is consumed, not re-detected) but does NOT re-enter it — delivering **zero** overlapping
 * invocations, which satisfies the spec's "at most one pending invocation" upper bound while making
 * the unbounded buildup it forbids structurally impossible. (Delivering the coalesced one is a valid
 * alternative reading, but re-running a body whose own `wait` re-arms the interval risks a
 * non-terminating drain; the conservative zero-overlap reading is deterministic and safe.)
 */
export interface EveryHandler {
  readonly interval: number;
  readonly block: BlockNode;
  readonly keyword: SpannedName;
  readonly environment: Environment;
  nextDueTick: number;
  running: boolean;
  pending: boolean;
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
 * A key press is **host input**: in a headless batch `execute()` run there is no keyboard, so an
 * `on_key` handler registers but is never delivered — exactly like a `when "stop"` handler in a
 * headless run (locked by the `on-key-registered-not-delivered` fixture). Synthesizing a key press
 * is a host concern outside this slice, so this handler carries no delivery-state flag: it holds the
 * captured block and scope, ready for an interactive host slice to deliver it. It lives in its own
 * registration-ordered list so #686/I7 can impose the spec's same-tick delivery order
 * (`when`/`on_key`/`on_click` first, then due `every`) across handler kinds without reworking it.
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
 * A click is **host input**: in a headless batch `execute()` run there is no pointer device, so an
 * `on_click` handler registers but is never delivered — exactly like a `when "stop"` handler (I3) or
 * an `on_key` handler (I5) in a headless run (locked by the `on-click-registered-not-delivered`
 * fixture). Synthesizing a click is a host concern outside this slice, so this handler carries no
 * delivery-state flag: it holds the captured block and scope, ready for an interactive host slice to
 * deliver it. It lives in its own registration-ordered list so #686/I7 can impose the spec's
 * same-tick delivery order (`when`, then `on_key`, then `on_click`, then due `every`) across handler
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
 * (the future studio, `spec/interaction-events.md`'s "interactive host") would deliver — supplied up
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
 * bucketed per event with no cross-event ordering. Dispatch filters by event word and delivery
 * state at delivery time ({@link pendingHandlersFor}).
 *
 * This is the structure the file header promised the rest of the track would hang off the tick
 * clock's {@link yieldToEventLoop} seam: `when` populates it and `"start"` fires from it immediately
 * on registration (the run has already started). `every`/`on_key`/`on_click` (#683–#685) add their
 * own handler kinds alongside it (`every` in #683, `on_key` in #684), and an interactive host slice
 * later delivers `"stop"` and the timed/input events from it.
 *
 * `pendingEvents`/`pendingKeys`/`pendingClicks` (issue #686, slice I7) are the tick-scheduled
 * host-input queues {@link enqueueHostInput} fills from `ExecuteOptions.hostInput` and
 * {@link dispatchDueHandlers} drains, in the spec's same-tick order, at the tick seam. They are
 * distinct from the four handler lists — a named event, key press, or click is an *occurrence* to be
 * delivered to whichever handlers match, not a handler registration — and stay empty whenever no
 * host input was supplied (a normal headless run), so they never disturb the I5/I6 never-fires
 * behavior. Kept as separate queues (not merged into one) so the drain order is imposed purely here,
 * at the dispatch point, exactly as the four registration lists are kept separate.
 */
export interface EventHandlerRegistry {
  readonly handlers: WhenHandler[];
  readonly everyHandlers: EveryHandler[];
  readonly onKeyHandlers: OnKeyHandler[];
  readonly onClickHandlers: OnClickHandler[];
  readonly pendingEvents: string[];
  readonly pendingKeys: string[];
  readonly pendingClicks: { count: number };
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
    pendingClicks: { count: 0 },
  };
}

/**
 * Register a `when` handler for `event`, appending it to `registry` in registration order and
 * returning the created {@link WhenHandler}. `environment` is captured so the handler body later runs
 * in its registration-time lexical scope. Registration itself is side-effect-only on the registry;
 * the caller emits the `primitive` event `spec/interaction-events.md` requires "after the handler is
 * registered" and then decides whether the event is already live (so the handler fires now) or
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
    fired: false,
  };
  registry.handlers.push(handler);
  return handler;
}

/**
 * Every not-yet-fired handler registered for `event`, in registration order — the handlers to
 * invoke when `event` fires. Skips a handler already delivered for this one-shot event, so a
 * `"start"` handler never fires twice. Returns a fresh snapshot array so a handler body that
 * registers further handlers for the same event mid-dispatch cannot mutate the sequence being
 * iterated (any such newly-registered `"start"` handler is instead delivered by its own registration
 * path, since the run has already started). Firing an event with no registered handler yields an
 * empty list — a well-defined no-op, never an error, matching `spec/interaction-events.md`, which
 * defines no diagnostic for an event that has no handler.
 */
export function pendingHandlersFor(
  registry: EventHandlerRegistry,
  event: string,
): readonly WhenHandler[] {
  return registry.handlers.filter(
    (handler) => !handler.fired && handler.event === event,
  );
}

/**
 * Register an `every <n> <block>` handler (issue #683, slice I4), appending it to `registry` in
 * registration order and returning the created {@link EveryHandler}. `interval` MUST already be a
 * validated positive whole tick count; `registrationTick` is the tick clock's current value at
 * registration, so the handler's first firing is anchored `interval` ticks AFTER registration
 * (`nextDueTick = registrationTick + interval`) — "The first run occurs after `n` ticks have
 * elapsed" — rather than to global tick 0. `environment` is captured so the handler body later runs
 * in its registration-time lexical scope. A fresh handler is neither `running` nor `pending`.
 * Registration is side-effect-only on the registry; the caller emits the `primitive` event
 * `spec/interaction-events.md` requires "after the handler is registered". `every` handlers live in
 * their own list (never bucketed with `when`'s one-shot handlers) so the spec's same-tick delivery
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
    pending: false,
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
 * registered". `on_key` handlers live in their own list (never bucketed with `when`'s one-shot
 * handlers or `every`'s timed handlers) so the spec's same-tick delivery order — pending `when`,
 * then pending `on_key`, then `on_click`, then due `every` (#686/I7) — can filter each kind
 * independently while each kind preserves its own registration order. In a headless batch run no key
 * press is ever delivered, so this list is populated but never drained here.
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
 * one-shot handlers, `every`'s timed handlers, or `on_key`'s keyboard handlers) so the spec's
 * same-tick delivery order — pending `when`, then pending `on_key`, then pending `on_click`, then due
 * `every` (#686/I7) — can filter each kind independently while each kind preserves its own
 * registration order. In a headless batch run no click is ever delivered, so this list is populated
 * but never drained here.
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
 * The batch of `every` handlers to invoke on `tick` — the tick the clock has just advanced to — in
 * registration order, claimed atomically **before any handler body runs**. A handler is due when
 * `tick >= handler.nextDueTick`; because `runWait` calls the dispatch once per tick (monotonically,
 * never skipping a tick), the boundary is reached at exactly `nextDueTick`. Each claimed handler has
 * its `nextDueTick` advanced by `interval` (so it fires exactly once per interval boundary — a later
 * `wait 0` revisiting the same tick does NOT redeliver it, and a handler registered mid-run first
 * fires `interval` ticks after registration rather than snapping to a global multiple) and is marked
 * `pending`. Tick `0` is never due — a fresh handler's `nextDueTick` is always `>= interval > 0`.
 *
 * A handler that is already `running` (a re-entrant `wait` inside its own body advanced the clock
 * past its next interval) or already `pending` (claimed by an outer batch not yet fully delivered,
 * because a sibling handler's re-entrant `wait` is delivering intervening ticks) has its interval
 * consumed — its `nextDueTick` still advances so the boundary is not re-detected — but is NOT added
 * to a second, overlapping batch. `running` prevents a handler re-entering itself; `pending`
 * prevents a sibling's nested `wait` from re-claiming a handler an outer batch already owns for this
 * boundary (which would otherwise fire it twice, out of chronological order). Together they deliver
 * **zero** overlapping invocations, satisfying the spec's "at most one pending invocation" upper
 * bound while making the unbounded buildup it forbids structurally impossible. The caller
 * ({@link dispatchEveryHandlers}) invokes each returned handler via {@link invokeEveryHandler},
 * which clears `pending` and sets `running`. Returns a fresh array so a handler body that registers
 * a further `every` mid-dispatch does not extend the batch being delivered on this tick; a tick with
 * no due handler yields an empty array — a well-defined no-op, never an error.
 */
export function claimDueEveryHandlers(
  registry: EventHandlerRegistry,
  tick: number,
): readonly EveryHandler[] {
  const due: EveryHandler[] = [];
  for (const handler of registry.everyHandlers) {
    if (tick < handler.nextDueTick) {
      continue;
    }
    handler.nextDueTick += handler.interval;
    if (handler.running || handler.pending) {
      continue;
    }
    handler.pending = true;
    due.push(handler);
  }
  return due;
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
 */
export function enqueueHostInput(
  registry: EventHandlerRegistry,
  hostInput: readonly HostInputEvent[],
  tick: number,
  consumed: number,
): number {
  let cursor = consumed;
  for (const entry of hostInput.slice(consumed)) {
    if (entry.tick > tick) {
      break;
    }
    if (entry.kind === "key") {
      registry.pendingKeys.push(entry.key);
    } else if (entry.kind === "click") {
      registry.pendingClicks.count += 1;
    } else {
      registry.pendingEvents.push(entry.event);
    }
    cursor += 1;
  }
  return cursor;
}

/**
 * The not-yet-fired `when` handlers to invoke for the named events queued for this tick (issue #686,
 * slice I7), in the spec's same-tick order: **handler registration order is primary**
 * (`spec/interaction-events.md`, §Time, ticks, and handlers: "pending `when` events in registration
 * order") — the order the host happened to deliver events in MUST NOT reorder the handlers. Each
 * registered `when` handler is visited once in registration order and included if it is not yet
 * `fired` and its `event` is among the pending events. Because `when` is **one-shot** (its
 * {@link WhenHandler.fired} flag is set when it actually runs), a handler is included **at most once
 * per tick** even if its event is pending several times — collecting it more than once would make a
 * one-shot handler fire twice (the `fired` flag is only set at invocation, after this whole batch is
 * built, so it cannot self-dedupe here). Clears the `pendingEvents` queue (these occurrences are
 * being delivered now), returning the handler batch for {@link dispatchDueHandlers} to invoke. An
 * empty queue — the normal headless case, no host input — yields an empty batch, a well-defined
 * no-op.
 */
export function claimPendingEventHandlers(
  registry: EventHandlerRegistry,
): readonly WhenHandler[] {
  const events = registry.pendingEvents.splice(
    0,
    registry.pendingEvents.length,
  );
  const pending = new Set(events);
  const due: WhenHandler[] = [];
  for (const handler of registry.handlers) {
    if (!handler.fired && pending.has(handler.event)) {
      due.push(handler);
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
 * handlers have no one-shot `fired` flag — a key can be pressed any number of times. An empty queue
 * — the normal headless case — yields an empty batch.
 */
export function claimPendingKeyHandlers(
  registry: EventHandlerRegistry,
): readonly OnKeyHandler[] {
  const keys = registry.pendingKeys.splice(0, registry.pendingKeys.length);
  const due: OnKeyHandler[] = [];
  for (const handler of registry.onKeyHandlers) {
    for (const key of keys) {
      if (handler.key === key) {
        due.push(handler);
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
): readonly OnClickHandler[] {
  const clicks = registry.pendingClicks.count;
  registry.pendingClicks.count = 0;
  const due: OnClickHandler[] = [];
  for (let index = 0; index < clicks; index += 1) {
    for (const handler of registry.onClickHandlers) {
      due.push(handler);
    }
  }
  return due;
}
