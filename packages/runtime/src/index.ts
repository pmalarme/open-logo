/**
 * `@openlogo/runtime` — evaluator, scoping, procedures, control forms, comprehensions,
 * places/mutation, equality, and the cancellable execution budget. Depends on `@openlogo/core`
 * and `@openlogo/parser`.
 *
 * {@link execute} is the foundational execution entry point (issue #90): it parses a source
 * document and walks the program's top-level statements, emitting one `instruction` start event
 * per statement (`spec/execution-model.md:900-941` — the `instruction` event is the unit of
 * "one step"). Issue #93 gave Core literals and arithmetic (`+ - * / mod` plus
 * `abs sqrt int round power`) a runtime value via {@link evaluate} and added a minimal `print`
 * event. Issue #98 completes `print`: the single-value `print value` form and the parenthesized
 * variadic `(print a b …)` form (`spec/commands.md:163-179`) both evaluate every operand, in
 * order, and — once all of them evaluate cleanly — emit one `print` event carrying every value
 * (`PrintPayload.values`) right after that statement's `instruction` event. Issue #100 gives `if`
 * (with an optional `else`) and `while` their runtime meaning (`spec/execution-model.md:365-369`):
 * both require a boolean condition (`ol-not-boolean` otherwise, reusing the builder issue #95
 * added for `and`/`or`/`not`), `if` runs exactly one branch (or none, with no `else`), and `while`
 * re-evaluates its condition before every pass — including the first — running the body each time
 * the condition holds. Issue #104 gives `repeat`/`forever` their runtime meaning: `repeat`
 * validates its count TYPE then RANGE, in that order (`spec/execution-model.md:365-369`) —
 * `ol-type` for a non-whole-number count, `ol-range` for a negative one, zero passes for `repeat
 * 0` — then runs its body that many times; `forever` repeats its body until cancelled or the
 * instruction budget is reached (issue #102 — see {@link ExecuteOptions}). Both thread the active
 * `repeat` turn onto {@link Environment.repeatTurns} so the `repcount` reporter (`evaluate.ts`)
 * can read the nearest enclosing `repeat`'s current 1-based turn. Variables, procedures, and
 * comprehensions land one vertical slice at a time (issues #94-#105), each adding its own
 * statement handling and, where the spec calls for it, runtime `ol-*` diagnostics. Issue #103
 * gives `for ... in` and `for ... from ... to ... by` their runtime meaning: both bind their loop
 * variable(s) in a fresh body-local frame each pass (never leaking past the loop) and thread
 * `repeatTurns` unchanged, so a `repeat`'s `repcount` still works correctly inside a nested `for`.
 * Issue #102 adds the execution-safety gates `spec/execution-model.md#execution-safety` requires: a
 * configurable instruction budget, a configurable recursion-depth limit (promoting the
 * previously hardcoded procedure-call ceiling to a configurable one), and external cancellation
 * via a {@link CancellationSignal} — all surfaced through {@link ExecuteOptions} and all raising
 * `ol-limit`. See {@link CancellationSignal}'s doc comment for why real cross-thread cancellation
 * (not just a same-thread `AbortController`) is what actually stops a run in progress.
 *
 * The actual per-statement dispatch (including recursing into `if`/`while`/`repeat`/`forever`
 * block bodies) lives in `execute-internal.ts`'s `executeStatements`, not in this file — see that
 * module's header comment for why: it is also how this package's own tests exercise `forever`'s
 * loop mechanics without hanging, via a test-only entry point that is deliberately unreachable
 * through this package's public surface.
 */

import type { Diagnostic, TraceEvent } from "@openlogo/core";
import type { TickBoundary } from "./interaction.js";
import { runProgram } from "./execute-internal.js";
import type { CancellationSignal } from "./evaluate.js";
import type { HostInputEvent } from "./interaction.js";
import type { HandlerDelivery, HandlerRegistration } from "./interaction.js";
import { defaultTutorTemplate } from "./tutor-templates.js";
import type { TutorTemplateFn } from "./tutor-templates.js";
import type { TutorLearnerLevel } from "./tutor-context.js";

export {
  CYCLIC_PLACEHOLDER,
  createEnvironment,
  currentTurtleState,
  evaluate,
  executeAdd,
  executeAssign,
  executeClear,
  executeInsert,
  executeRemove,
  formatNumber,
  isSupportedExpression,
  printedForm,
  snapshotValue,
  turtleStateFor,
  valuesEqual,
} from "./evaluate.js";
export type {
  AssignResult,
  CancellationSignal,
  EvalResult,
  Environment,
  Frame,
  TurtleState,
} from "./evaluate.js";
export {
  DEFAULT_INSTRUCTION_BUDGET,
  DEFAULT_LEARNER_LEVEL,
  DEFAULT_RECURSION_DEPTH_LIMIT,
  HOST_SAFE_RECURSION_DEPTH,
  resolveEffectiveRecursionDepthLimit,
} from "./execute-internal.js";
export { defaultTutorTemplate, nextHintStage } from "./tutor-templates.js";
export type { TutorTemplateFn } from "./tutor-templates.js";
export {
  advanceTickClock,
  createTickClock,
  interpretSubmittedText,
  isWaitCall,
  takeInputResponse,
  yieldToEventLoop,
} from "./interaction.js";
export type { TickClock } from "./interaction.js";
export type { TickBoundary } from "./interaction.js";
export { tickAtEventIndex } from "./interaction.js";
export type { HostInputEvent } from "./interaction.js";
export type { HandlerDelivery, HandlerRegistration } from "./interaction.js";
export type {
  TutorCommandMetadata,
  TutorContext,
  TutorLearnerLevel,
} from "./tutor-context.js";

/** Marker export so the M0 skeleton is a real ES module; kept alongside the real exports. */
export const RUNTIME_PACKAGE = "@openlogo/runtime";

/**
 * Payload for the generic `instruction` start event, re-exported unchanged from `@openlogo/core`.
 *
 * It was declared **here** until issue #954, the only `*Payload` type in the monorepo living outside
 * `@openlogo/core` — which owns the trace/event contract while this package merely produces it. It
 * now lives beside every other payload type in `packages/core/src/events.ts`, where #954's handler
 * discriminator ({@link HandlerFiring}) was added to it. The re-export is kept so
 * `@openlogo/runtime`'s public surface is unchanged for anything that already imported the name from
 * here.
 */
export type {
  HandlerFiring,
  HandlerKind,
  InstructionPayload,
} from "@openlogo/core";

/** The result of {@link execute}: the ordered trace/event stream plus any diagnostic. */
export interface ExecuteResult {
  readonly events: readonly TraceEvent[];
  readonly diagnostics: readonly Diagnostic[];
}

/**
 * Optional execution-safety configuration for {@link execute} (issue #102,
 * `spec/execution-model.md#execution-safety`, `spec/error-model.md:119`). Every field is optional and
 * independently defaulted — `execute(source, document)` with no third argument keeps behaving
 * exactly as before this issue, just now with a large-but-finite default budget/depth instead of
 * an implicit unlimited one for `forever` specifically.
 *
 * - `instructionBudget` — the maximum number of instructions the program may execute
 *   before halting with `ol-limit` (`limit: "instruction-budget"`). An instruction is a statement,
 *   a loop pass, a handler firing (issue #828), or one tick of a `wait` pause (issue #953) — so
 *   `wait <n>` costs `n` on top of its own statement, and holding a run open with a long `wait`
 *   is budgeted exactly as `forever` is. Defaults to
 *   {@link DEFAULT_INSTRUCTION_BUDGET}; a non-finite, non-positive, or omitted value falls back
 *   to that default rather than disabling the gate (`execute-internal.ts`'s
 *   `resolvePositiveFiniteLimit`).
 * - `recursionDepthLimit` — the maximum procedure-call nesting depth before halting with
 *   `ol-limit` (`limit: "recursion-depth"`). Defaults to {@link DEFAULT_RECURSION_DEPTH_LIMIT},
 *   now configurable rather than hardcoded, with the same non-finite/non-positive fallback as
 *   `instructionBudget`. Issue #726: whatever a caller configures is additionally **clamped** to
 *   {@link HOST_SAFE_RECURSION_DEPTH} — the interpreter never promises a depth the host call stack
 *   cannot survive, so a raised budget cannot push execution past the point where V8's native
 *   stack overflows with a raw `RangeError`. The `ol-limit` diagnostic reports the depth actually
 *   enforced (the clamped value). **This removes the ability to configure recursion deeper than
 *   {@link HOST_SAFE_RECURSION_DEPTH}**: requesting `1000` yields an effective `500`. The clamp is
 *   observable — call {@link resolveEffectiveRecursionDepthLimit} to read the ceiling a given
 *   request resolves to before running.
 * - `signal` — a {@link CancellationSignal} a caller can flip to `aborted` to cancel a
 *   still-running program. Checked before every statement/loop pass; once aborted, no further
 *   trace events are emitted and execution halts with `ol-limit` (`limit: "cancelled"`) —
 *   already-emitted events are returned unchanged. See {@link CancellationSignal}'s doc comment
 *   for why this only meaningfully cancels a run already in progress when backed by cross-thread
 *   shared state (e.g. a Web Worker + `SharedArrayBuffer`/`Atomics`) — `execute()` is synchronous
 *   and never yields, so a same-thread `AbortController` cannot interrupt a call already underway.
 * - `tutorTemplates` (issue #332, the M3-orchestrator's injectable-template ruling) — a
 *   `(TutorContext) => TutorOutputPayload` function the four Educational baseline meta-commands
 *   (`explain`/`why`/`hint`/`debug`) call to produce the `tutor-output` event payload they emit.
 *   This package's dispatch (`execute-internal.ts`'s `executeEducationalMetaCommand`) builds the
 *   {@link TutorContext} and faithfully emits whichever payload arm the template returns — it
 *   never chooses pedagogy or the diagnostic-vs-program arm itself. Defaults to
 *   {@link defaultTutorTemplate}: a genuinely minimal, deterministic, structural template (not
 *   curriculum-quality prose) — what a bare Educational-profile runtime, and this package's own
 *   conformance fixtures, emit. `@openlogo/edu`'s richer A3/A4/A5 templates (or a host like
 *   `@openlogo/studio`) supply their own function here instead.
 * - `learnerLevel` (issue #332) — the learner's active curriculum level
 *   ({@link TutorLearnerLevel}), threaded onto every `TutorContext.level` this run builds.
 *   Defaults to {@link DEFAULT_LEARNER_LEVEL} (`"1"`, the first/movement level,
 *   `spec/educational-model.md`'s level table) — the least-prior-knowledge assumption when a
 *   caller does not track curriculum progression itself.
 * - `hostInput` (issue #686, slice I7 — `spec/interaction-events.md:143-145`) — a {@link HostInput}
 *   object whose `events` field is a tick-scheduled list of key presses, clicks, and named events a
 *   *host* (a studio, a terminal claim, a test) would have delivered to the running program, so
 *   `on_key`/`on_click`/`when` handlers can be proven to fire — and to fire in the normative
 *   same-tick order (`when` → `on_key` → `on_click` → due `every`, `spec/interaction-events.md:136-141`)
 *   — from a pure headless `execute()` call with no real input device. The spec (`:143-145`) requires
 *   an implementation to "preserve the most recent key and click state needed to deliver the next
 *   handler consistently"; this option is that preserved pending state, supplied up front. Each
 *   {@link HostInputEvent} names the `tick` at which it becomes pending; `dispatchDueHandlers` moves
 *   the ones scheduled at or before the current tick into the handler registry's pending queues at
 *   each `wait`/tick checkpoint and drains them in spec order. Entries may be supplied in any order —
 *   they are copied and sorted by non-decreasing `tick` once per run; same-tick entries keep caller
 *   order (a stable sort), which is the deterministic tie-break the same-tick order depends on. This
 *   is host-supplied execution *context*, exactly like `signal`: no *host* fact is smuggled into the
 *   trace stream — no tick, no coordinate, and no delivery timing appears in any payload, which is
 *   what keeps the stream headless. Since issue #954 an `on_key` firing's `instruction` payload does
 *   carry a **key word**, but that is the word the *program* registered (`InstructionPayload.handler`
 *   in `@openlogo/core`), reported because a delivered key only ever matches a handler whose own
 *   registered key equals it — never the host's raw device input, and never a key no handler named.
 *   It deliberately does **NOT** model a TTY or pointer device, does **NOT** define any
 *   input-coalescing policy, and is **NOT** the blocking `input` reporter: that reporter's scripted
 *   answers are the sibling {@link HostInput.responses} field (issue #681, per the #657 ruling —
 *   see there). Like
 *   `signal`, it can only express a *static* schedule fixed before the run starts, not input that
 *   depends on what the program has done so far. Defaults to an empty schedule, so an ordinary
 *   headless run delivers no key/click/named event at all and the I5/I6 never-fires behavior holds
 *   because nothing was ever pending.
 * - `randomSeed` (issue #865) — the seed this run's shared `random`/`randomize` generator starts
 *   from, so a **host can pin a run's randomness**. Omitted, the generator falls back to the host
 *   clock, which is the implementation's own choice of seed (`spec/commands.md`'s `randomize`
 *   entry: "with no seed the implementation chooses a seed") and retains exactly the clock-seeded
 *   behavior runs had before this option existed. That is a weaker property than it may sound:
 *   two runs starting in the same millisecond receive the *same* seed, and `Date.now() >>> 0`
 *   repeats about every 49.7 days. No unpredictability is claimed or needed — `spec/commands.md`
 *   promises "controlled unpredictability", not a cryptographic guarantee.
 *
 *   That clock fallback is `@openlogo/runtime`'s **only ambient entropy source** — no other code
 *   in this package reads a wall clock or `Math.random()`, and the tick clock is a pure counter —
 *   so supplying a seed makes `execute()` reproducible for a given `source`, `document`, and these
 *   options. Two caveats, both the caller's own doing rather than the runtime's: `hostInput.read`
 *   and `tutorTemplates` are caller-supplied **functions**, so a stateful one can still make two
 *   otherwise identical runs differ, and `signal` is caller-mutable. With deterministic
 *   collaborators — or none — a pinned seed reproduces the event stream exactly.
 *
 *   That is the whole point: before it, the only way to reproduce a run was to edit the
 *   learner's own program to call `randomize`, which is not a contract a host can offer. A host
 *   that needs a *replayable* run (`@openlogo/studio`'s `input` prompt, a visual-regression test,
 *   a conformance case that wants "this program, with this randomness") pins one seed and gets
 *   the identical event stream every time.
 *
 *   It is a **host default, not an override**: an explicit `(randomize 42)` in the program still
 *   reseeds over it, per the program's own instructions. A no-argument `randomize` also keeps
 *   choosing an implementation seed — but since #865 it derives that seed by advancing the
 *   generator's own state rather than reading the clock
 *   (`random-number-generator.ts`'s `drawImplementationSeed`), so it cannot silently re-enter
 *   entropy and undo a pinned seed mid-run.
 * - `observedEvents` (issue #876) — a caller-supplied array this run **appends every trace event to
 *   as it is emitted**, rather than only handing the stream back when `execute()` returns.
 *
 *   For any program that actually starts executing it is the *same* array
 *   {@link ExecuteResult.events} reports, so supplying it only makes that stream readable
 *   *earlier*. Rely on its **contents**, though, not on identity: a call that returns before an
 *   execution environment exists at all — a program that fails to parse, for instance — never
 *   reaches the sink, and reports its own separate empty `events` array. Nothing is appended on
 *   those paths, so a host still cannot read a stale or partial prefix; only `result.events ===
 *   observedEvents` may be `false`.
 *
 *   It exists for exactly one caller: a host suspended inside {@link HostInput.read}. The reader is
 *   called with the prompt and nothing else, so without this a host that blocks there — a Worker
 *   using `Atomics.wait`, say — cannot see what the program has drawn or printed so far, and must
 *   show the learner a question over a blank canvas. `spec/interaction-events.md:160-162` explicitly
 *   permits the opposite ("While `input` is waiting, the implementation **MAY** continue rendering
 *   already-emitted trace events"), and this is the seam that makes that allowance reachable.
 *
 *   Pass a **fresh empty array** per run: the events are appended, never cleared, so reusing one
 *   across runs concatenates them. Reading it while a run is in progress is only meaningful from
 *   inside a `read` call, since `execute()` never yields anywhere else.
 * - `tickTimeline` (issue #985) — a caller-supplied array this run appends one {@link TickBoundary}
 *   to per **elapsed tick**, recording the trace-event count at the moment the clock advanced. It is
 *   the seam an interactive host needs to schedule input against the program's *logical* clock
 *   rather than a synthetic counter of its own: pair it with {@link tickAtEventIndex} to ask "which
 *   tick was the program at when it emitted event *i*".
 *
 *   It exists because the tick is deliberately **absent from the trace stream** — no event payload
 *   carries one (`spec/interaction-events.md:69-73` makes a tick implementation-defined, and
 *   `interaction.ts`'s header records that keeping it out of payloads is what leaves the stream
 *   headless). Without this sink a host can count how many `wait` primitives a run emitted but never
 *   how many *ticks* they cost, so `@openlogo/studio` scheduled every delivery at a counter of its
 *   own and lost the first key press after any delayed registration.
 *
 *   Like `observedEvents` this is **out of band, and must stay so**: do not later satisfy the same
 *   need by widening a payload to carry a tick, which would smuggle host-facing timing into the
 *   normative stream. Determinism is unaffected either way — the timeline is a pure function of the
 *   same inputs the event stream is, and supplying it changes no event, diagnostic, or ordering.
 *   Defaults to omitted, in which case nothing is recorded at all. Pass a **fresh empty array** per
 *   run, for the same reason `observedEvents` requires one.
 * - `handlerRegistrations` (issue #975) — a caller-supplied array this run appends one
 *   {@link HandlerRegistration} to per handler registration, in registration order. It answers the
 *   first of the two questions an interactive host could not previously ask the runtime: **which key
 *   words currently have handlers.**
 *
 *   A host must decide *synchronously, inside a browser `keydown` handler*, whether a key belongs to
 *   the running program, because that decision drives `preventDefault` and is wrong in both
 *   directions — too eager steals the editor's keys and the page's scrolling from the ~90% of
 *   programs with no interaction, too lazy scrolls the studio away while a learner plays a game. The
 *   registration `primitive` event carries only the primitive's *name*
 *   (`spec/interaction-events.md:172-174`), never its key word, so answering it previously meant
 *   parsing the source and pairing declarations to registration events **by source position**. This
 *   sink is the runtime handing over the key word it already had.
 *
 *   Read the honest limit on {@link HandlerRegistration}: a registration does not exist until its
 *   statement executes, so no implementation can answer *before* a run — what this gives is "which
 *   handlers are registered **now**". For an in-process host that is sufficient, because `execute()`
 *   is synchronous: the log is complete the instant the call returns, inside the same `keydown` turn.
 * - `handlerDeliveries` (issue #975) — a caller-supplied array this run appends one
 *   {@link HandlerDelivery} to per host-input occurrence it actually delivers, in delivery order,
 *   each counting how many handler bodies that occurrence ran. It answers the second question:
 *   **was this delivered input handled** (`handled === invocations > 0`).
 *
 *   Both host-side proxies for this were measured unsound, and {@link HandlerDelivery} records why:
 *   event-stream growth is not monotonic in the thing it proxies (a handler that *raises* shortens
 *   the stream), and asking after the run settles answers a turn too late to suppress anything.
 *
 *   Like `observedEvents` and `tickTimeline` these are **out-of-band sinks, not trace payload
 *   fields**, and they change no event, diagnostic, or ordering — a run with and without them emits
 *   byte-identical `events` and `diagnostics`. Both default to omitted, in which case nothing is
 *   recorded and no record is allocated. Pass a **fresh empty array** per run, for the same reason
 *   `observedEvents` requires one.
 */
export interface ExecuteOptions {
  readonly instructionBudget?: number;
  readonly recursionDepthLimit?: number;
  readonly signal?: CancellationSignal;
  readonly tutorTemplates?: TutorTemplateFn;
  readonly learnerLevel?: TutorLearnerLevel;
  readonly hostInput?: HostInput;
  readonly randomSeed?: number;
  readonly observedEvents?: TraceEvent[];
  readonly handlerRegistrations?: HandlerRegistration[];
  readonly handlerDeliveries?: HandlerDelivery[];
  readonly tickTimeline?: TickBoundary[];
}

/**
 * Host-supplied input for a single `execute()` run (issue #686, slice I7). An *object* — rather than
 * `hostInput` being the bare `events` array — precisely so the blocking `input` reporter (issue #681)
 * can add its scripted answers beside the tick-scheduled deliveries without reshaping this seam or
 * migrating any fixture that already writes `{ "events": [...] }`, per the maintainer's #657 ruling
 * (`input` is mocked through this same `executeOptions.hostInput` seam, with no new event kind).
 */
export interface HostInput {
  /**
   * The tick-scheduled key presses, clicks, and named events this run delivers (issue #686). See the
   * `hostInput` bullet on {@link ExecuteOptions} for the delivery semantics and same-tick ordering.
   */
  readonly events?: readonly HostInputEvent[];
  /**
   * The scripted answers this run's `input` reads consume, in order (issue #681, slice I2 — the
   * maintainer's #657 ruling: `input` is tested by **mocking the answer** through this same
   * `hostInput` seam, with **no new event kind**, so the trace/event registry in
   * `spec/execution-model.md` is unchanged).
   *
   * A **FIFO queue consumed in order by each `input` call**: the first `input` the run evaluates
   * takes entry 0, the second entry 1, and so on, wherever those reads occur — top level, a
   * procedure body, a loop, or an event handler block all draw from this one queue. Each entry is
   * the raw text a learner would have typed; `input` then reports it per
   * `spec/interaction-events.md:188-189` (text that parses as an OpenLogo number literal reports a
   * **number**, anything else reports a **word** preserving the entered text), so `["42", "tom"]`
   * scripts one numeric answer followed by one word answer.
   *
   * Like `events`, this is host-supplied execution *context*: it is never observable in any trace
   * event payload — a read emits only the ordinary catch-all `primitive` event naming `input`, never
   * the prompt or the submitted text. And like `events`, it can only express a *static* script fixed
   * before the run starts, not an answer that depends on what the program has done so far.
   *
   * Defaults to an empty queue. A read with no answer left can never finish, so it takes the only
   * other ending `spec/interaction-events.md:162-163` allows and the program is cancelled with
   * `ol-limit` — deliberately, rather than inventing an answer the learner never gave.
   */
  readonly responses?: readonly string[];
  /**
   * The host's live reader for `input` (issue #681, slice I2) — the *interactive* half of the seam
   * `responses` mocks. When supplied it is authoritative: each `input` read calls it with the
   * prompt word, which since the #768 ruling IS the text a learner sees (a word prints verbatim, so
   * nothing is rendered on the way out), and the read stays outstanding for exactly the duration of
   * that call. Returning a string finishes the read with that submitted
   * text (classified by `spec/interaction-events.md:188-189` exactly as a scripted answer is);
   * returning `undefined` means the host cannot or will not answer, which ends the read the only
   * other way `:162-163` allows — the program is cancelled.
   *
   * This is how a real host both **displays the prompt** (`:186`) and holds the read open: the
   * reader IS the outstanding read, so a caller can observe, from inside it, that no further
   * OpenLogo instruction and no event handler block has run — the normative MUST at `:160-163`,
   * which is why `interaction-input-blocking.test.mjs` probes the window through this seam. Wiring
   * it to a browser prompt in `@openlogo/studio` is issue **#769**.
   *
   * It is a **function**, so — like {@link ExecuteOptions.tutorTemplates} — no JSON fixture can
   * supply it, and the conformance harness rejects it by name. That is deliberate: it keeps ONE
   * fixture convention (`responses`) per the #657 ruling while giving hosts and unit tests the
   * reactive seam a static list cannot express. Omit it and reads fall back to `responses`.
   */
  readonly read?: HostInputReader;
}

/**
 * A host's live `input` reader (issue #681). Called with the prompt word — the text to show the
 * learner (`spec/interaction-events.md:181`: the prompt MUST be a `word`) — and reports
 * the text the learner submitted, or `undefined` to leave the read unanswered and cancel the run.
 * Synchronous by design: `spec/interaction-events.md:160-163` requires that no OpenLogo instruction
 * and no handler block run until the read finishes, and a synchronous call is that guarantee by
 * construction — there is no suspension point at which anything else could be scheduled.
 */
export type HostInputReader = (prompt: string) => string | undefined;

/**
 * Parse `source` and execute its top-level statements, emitting one `instruction` event per
 * statement with a monotonic `seq` starting at 0. If parsing produced any diagnostic the
 * program is not execution-valid, so no events are emitted and the parse diagnostics are
 * returned unchanged.
 *
 * A single root {@link Environment} (issue #94) is created once per `execute()` call and threaded
 * through every statement, so an assignment in one statement is visible to every later read in
 * the same program (`spec/execution-model.md:316-327`) — procedure call frames land with #97.
 * `options` (issue #102) configures the three execution-safety gates
 * `spec/execution-model.md#execution-safety` requires: an instruction budget, a recursion-depth limit, and
 * external cancellation — see {@link ExecuteOptions}. Every `forever` loop is bounded by the
 * (possibly default) instruction budget even with no `options` at all, since "`forever` is
 * therefore safe only because it is cancellable and budgeted" (`spec/execution-model.md#execution-safety`)
 * is not conditional on the caller opting in.
 */
export function execute(
  source: string,
  document: string,
  options?: ExecuteOptions,
): ExecuteResult {
  return runProgram(source, document, undefined, options);
}
