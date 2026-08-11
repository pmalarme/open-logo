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
 * so future timed handlers (`every <n>`) have a shared notion of "n ticks elapsed"; it is not
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
 */

import type {
  Diagnostic,
  PrimitivePayload,
  SourceSpan,
  TraceEvent,
} from "@openlogo/core";
import type { BlockNode, SpannedName, StatementNode } from "@openlogo/parser";
import { runtimeDiag } from "./errors.js";

/**
 * The Interaction & Events tick clock: a single mutable box holding the current logical tick
 * (`spec/interaction-events.md`, §Time, ticks, and handlers). A box — like the environment's
 * `instructionCount`/`turtle` — rather than a plain field reassigned on {@link Environment}, so a
 * tick advance made from anywhere in the program (including deep inside a procedure call or loop
 * body sharing the same environment) is observed by every later read in the same run. The clock is
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
 * Yield to the renderer and event loop at a single logical checkpoint. This is the dispatch seam
 * the rest of the Interaction & Events track (issues #682–#686) hangs handler delivery off: today
 * it is a deterministic no-op, but a later slice makes it deliver any `every`/`on_key`/`on_click`
 * handlers that came due at `clock`'s current tick, in the registration order
 * `spec/interaction-events.md` fixes.
 *
 * `wait` calls it **once per elapsed tick** (after each {@link advanceTickClock}) **and once for a
 * zero-tick pause** — so that `wait 0` still reaches this checkpoint. That matters because
 * `spec/interaction-events.md` (`wait <n>`) requires "`wait 0` yields to the renderer and event
 * loop without adding a visible delay": a zero-count pause is not a plain no-op, it is a yield with
 * no tick advance. Routing every `wait` — including `wait 0` — through this one function is what
 * lets #682–#686 make `wait 0` dispatch pending handlers without touching this slice's control
 * flow. It takes the clock (not just a callback) so that later dispatch has the tick it is
 * delivering handlers for; the parameter is deliberately unused in this baseline.
 */
export function yieldToEventLoop(_clock: TickClock): void {
  // Intentionally empty: the deterministic, headless baseline has no handlers to dispatch yet
  // (they arrive with #682–#686). Its call sites in runWait are the seam; see the file header.
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

/** The number `wait`'s single argument resolved to, or the diagnostic to halt on. */
type TickCountOrDiagnostic =
  | { readonly ok: true; readonly value: number }
  | { readonly ok: false; readonly diagnostic: Diagnostic };

/**
 * Validate `wait`'s tick count: it MUST be a non-negative whole number
 * (`spec/interaction-events.md`, `wait <n>`). A non-whole count raises `ol-type`
 * ({@link runtimeDiag.notWholeNumber}) and a negative count raises `ol-range`
 * ({@link runtimeDiag.negativeCount}) — TYPE then RANGE, the same ordering `repeat`'s count
 * validation uses (`spec/execution-model.md:367-369`). `wait 0` is valid and returns `0` (it
 * yields with no tick advance and no visible delay). Reuses the shared `repeat`/`every` count
 * diagnostics rather than inventing ad-hoc strings, with `operation: "wait"` so the message names
 * the primitive.
 */
export function validateTickCount(
  value: number,
  source_span: SourceSpan,
): TickCountOrDiagnostic {
  if (!Number.isInteger(value)) {
    return {
      ok: false,
      diagnostic: runtimeDiag.notWholeNumber(source_span, {
        actual: "number",
        value,
        operation: "wait",
      }),
    };
  }
  if (value < 0) {
    return {
      ok: false,
      diagnostic: runtimeDiag.negativeCount(source_span, {
        operation: "wait",
        value,
      }),
    };
  }
  return { ok: true, value };
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
  events.push({
    seq: events.length,
    kind: "primitive",
    source_span,
    payload: { name: "wait" } satisfies PrimitivePayload,
  });
}

/**
 * Run a validated `wait <n>` pause (`spec/interaction-events.md`, `wait <n>`): pause the current
 * top-level instruction stream for `count` ticks by advancing `tickClock` one tick at a time and
 * yielding to the event loop after each tick ({@link advanceTickClock} + {@link yieldToEventLoop} —
 * the seam #682–#686 deliver due handlers from, see the file header), then emit the `primitive`
 * event AFTER the pause completes onto `events`. `count` MUST already be a validated non-negative
 * whole number (via {@link validateTickCount}).
 *
 * `wait 0` advances the clock zero times but still {@link yieldToEventLoop}s exactly once — it
 * "yield[s] to the renderer and event loop without adding a visible delay" (a spec-mandated yield,
 * not a plain no-op), so a later slice can dispatch pending handlers on a `wait 0` too. The
 * primitive event is emitted exactly once, after the loop, regardless of `count`.
 */
export function runWait(
  tickClock: TickClock,
  events: TraceEvent[],
  count: number,
  source_span: SourceSpan,
): void {
  if (count === 0) {
    yieldToEventLoop(tickClock);
  }
  for (let elapsed = 0; elapsed < count; elapsed += 1) {
    advanceTickClock(tickClock);
    yieldToEventLoop(tickClock);
  }
  emitWaitPrimitive(events, source_span);
}

/**
 * The two standard named events `when` registers a handler for in OpenLogo v0.1
 * (`spec/interaction-events.md`'s `### when <event-word> <block>`): `"start"` — the start of the
 * interactive run — and `"stop"` — a requested stop notification before termination. An
 * implementation MAY additionally accept vendor events with a dotted prefix (e.g. `"acme.shake"`),
 * so this is a documentation aid, not a closed validation set: `when` accepts *any* word as an
 * event name (the type check only rejects a non-word, `ol-type`), and a handler for a word this
 * batch runtime never fires simply never runs — exactly as a handler for a vendor event an
 * implementation does not deliver would not.
 */
export const STANDARD_EVENT_WORDS = Object.freeze({
  start: "start",
  stop: "stop",
} as const);

/**
 * One registered `when` handler: the block to run when its event fires, plus the head-keyword
 * {@link SpannedName} whose span the handler-block's opening `instruction` event carries
 * (`spec/interaction-events.md`'s "Trace stream integration": "The start of a handler block emits
 * an `instruction` event for the block-head that caused the handler to run"). `fired` records that
 * a one-shot event (`"start"`/`"stop"`) already delivered this handler, so it is skipped if that
 * event is ever delivered again — the deterministic "a delivered handler must not fire again"
 * guarantee — without disturbing the registration order same-tick delivery (#686/I7) relies on.
 */
export interface WhenHandler {
  readonly event: string;
  readonly block: BlockNode;
  readonly keyword: SpannedName;
  fired: boolean;
}

/**
 * The Interaction & Events **event-handler registry** (issue #682, slice I3): every `when` handler
 * registered so far, in registration order. A single append-only list (rather than a map keyed by
 * event word) is deliberate — it preserves one total registration order across all events, which is
 * the stable order same-tick dispatch (#686/I7) needs and cannot reconstruct if handlers were
 * bucketed per event with no cross-event ordering. Dispatch filters by event word and delivery
 * state at delivery time ({@link pendingHandlersFor}).
 *
 * This is the structure the file header promised the rest of the track would hang off the tick
 * clock's {@link yieldToEventLoop} seam: `when` populates it, `"start"` fires from it immediately on
 * registration (the run has already started), and `"stop"` fires from it once before termination.
 * `every`/`on_key`/`on_click` (#683–#685) add their own handler kinds alongside it.
 */
export interface EventHandlerRegistry {
  readonly handlers: WhenHandler[];
}

/** A fresh, empty event-handler registry — the state at program start (no handlers registered). */
export function createEventHandlerRegistry(): EventHandlerRegistry {
  return { handlers: [] };
}

/**
 * Register a `when` handler for `event`, appending it to `registry` in registration order and
 * returning the created {@link WhenHandler}. Registration itself is side-effect-only on the
 * registry; the caller emits the `primitive` event `spec/interaction-events.md` requires "after the
 * handler is registered" and then decides whether the event is already live (so the handler fires
 * now) or deferred.
 */
export function registerWhenHandler(
  registry: EventHandlerRegistry,
  event: string,
  block: BlockNode,
  keyword: SpannedName,
): WhenHandler {
  const handler: WhenHandler = { event, block, keyword, fired: false };
  registry.handlers.push(handler);
  return handler;
}

/**
 * Every not-yet-fired handler registered for `event`, in registration order — the handlers to
 * invoke when `event` fires. Skips a handler already delivered for this one-shot event, so a
 * `"start"`/`"stop"` handler never fires twice. Returns a fresh snapshot array so a handler body
 * that registers further handlers for the same event mid-dispatch cannot mutate the sequence being
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
