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
import type { StatementNode } from "@openlogo/parser";
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
 * Advance `clock` by exactly one tick. This is the single seam the rest of the Interaction &
 * Events track (issues #682–#686) hangs handler dispatch off: today it only increments the logical
 * tick, but a later slice makes it (or a dispatch pass called from it) deliver any `every`/
 * `on_key`/`on_click` handlers that came due on the tick just advanced to, in the registration
 * order `spec/interaction-events.md` fixes — at which point every existing `wait` already advances
 * the clock one tick at a time and so gains the "handlers keep firing during a pause" behavior for
 * free. Keep the advance one tick at a time (never `tick += n`) so that seam stays per-tick.
 */
export function advanceTickClock(clock: TickClock): void {
  clock.tick += 1;
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
 * top-level instruction stream for `count` ticks by advancing `tickClock` one tick at a time (each
 * advance is the seam #682–#686 deliver due handlers from — see the file header), then emit the
 * `primitive` event AFTER the pause completes onto `events`. `count` MUST already be a validated
 * non-negative whole number (via {@link validateTickCount}); `wait 0` advances the clock zero
 * times and emits the event immediately, "yield[ing] to the renderer and event loop without adding
 * a visible delay". The primitive event is emitted exactly once, after the loop, regardless of
 * `count`.
 */
export function runWait(
  tickClock: TickClock,
  events: TraceEvent[],
  count: number,
  source_span: SourceSpan,
): void {
  for (let elapsed = 0; elapsed < count; elapsed += 1) {
    advanceTickClock(tickClock);
  }
  emitWaitPrimitive(events, source_span);
}
