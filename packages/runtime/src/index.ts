/**
 * `@openlogo/runtime` — evaluator, scoping, procedures, control forms, comprehensions,
 * places/mutation, equality, and the cancellable execution budget. Depends on `@openlogo/core`
 * and `@openlogo/parser`.
 *
 * {@link execute} is the foundational execution entry point (issue #90): it parses a source
 * document and walks the program's top-level statements, emitting one `instruction` start event
 * per statement (`spec/execution-model.md:559-600` — the `instruction` event is the unit of
 * "one step"). Issue #93 gave Core literals and arithmetic (`+ - * / mod` plus
 * `abs sqrt int round power`) a runtime value via {@link evaluate} and added a minimal `print`
 * event. Issue #98 completes `print`: the single-value `print value` form and the parenthesized
 * variadic `(print a b …)` form (`spec/commands.md:142-158`) both evaluate every operand, in
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
 * Issue #102 adds the execution-safety gates `spec/execution-model.md:551-557` requires: a
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
import { runProgram } from "./execute-internal.js";
import type { CancellationSignal } from "./evaluate.js";
import type { HostInputEvent } from "./interaction.js";
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
  isLearnerText,
  isWaitCall,
  takeInputResponse,
  validateTickCount,
  yieldToEventLoop,
} from "./interaction.js";
export type { TickClock } from "./interaction.js";
export type { HostInputEvent } from "./interaction.js";
export type {
  TutorCommandMetadata,
  TutorContext,
  TutorLearnerLevel,
} from "./tutor-context.js";

/** Marker export so the M0 skeleton is a real ES module; kept alongside the real exports. */
export const RUNTIME_PACKAGE = "@openlogo/runtime";

/**
 * Payload for the generic `instruction` start event this M0 spine emits: the AST node kind of
 * the top-level statement about to run. Refined per-statement payload shapes (e.g. the callee
 * name for a `Call`) are added by the evaluator slice that gives that statement kind meaning.
 */
export interface InstructionPayload {
  readonly statement_kind: string;
}

/** The result of {@link execute}: the ordered trace/event stream plus any diagnostic. */
export interface ExecuteResult {
  readonly events: readonly TraceEvent[];
  readonly diagnostics: readonly Diagnostic[];
}

/**
 * Optional execution-safety configuration for {@link execute} (issue #102,
 * `spec/execution-model.md:551-557`, `spec/error-model.md:119`). Every field is optional and
 * independently defaulted — `execute(source, document)` with no third argument keeps behaving
 * exactly as before this issue, just now with a large-but-finite default budget/depth instead of
 * an implicit unlimited one for `forever` specifically.
 *
 * - `instructionBudget` — the maximum number of statements/loop passes the program may execute
 *   before halting with `ol-limit` (`limit: "instruction-budget"`). Defaults to
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
 * - `hostInput` (issue #686, slice I7 — `spec/interaction-events.md:91-93`) — a {@link HostInput}
 *   object whose `events` field is a tick-scheduled list of key presses, clicks, and named events a
 *   *host* (a studio, a terminal claim, a test) would have delivered to the running program, so
 *   `on_key`/`on_click`/`when` handlers can be proven to fire — and to fire in the normative
 *   same-tick order (`when` → `on_key` → `on_click` → due `every`, `spec/interaction-events.md:84-89`)
 *   — from a pure headless `execute()` call with no real input device. The spec (`:91-93`) requires
 *   an implementation to "preserve the most recent key and click state needed to deliver the next
 *   handler consistently"; this option is that preserved pending state, supplied up front. Each
 *   {@link HostInputEvent} names the `tick` at which it becomes pending; `dispatchDueHandlers` moves
 *   the ones scheduled at or before the current tick into the handler registry's pending queues at
 *   each `wait`/tick checkpoint and drains them in spec order. Entries may be supplied in any order —
 *   they are copied and sorted by non-decreasing `tick` once per run; same-tick entries keep caller
 *   order (a stable sort), which is the deterministic tie-break the same-tick order depends on. This
 *   is host-supplied execution *context*, exactly like `signal`: it is never observable in any
 *   trace-event payload (the event stream stays headless — no tick, coordinate, or key smuggled in).
 *   It deliberately does **NOT** model a TTY or pointer device, does **NOT** define any
 *   input-coalescing policy, and is **NOT** the blocking `input` reporter: that reporter's scripted
 *   answers are the sibling {@link HostInput.responses} field (issue #681, per the #657 ruling —
 *   see there). Like
 *   `signal`, it can only express a *static* schedule fixed before the run starts, not input that
 *   depends on what the program has done so far. Defaults to an empty schedule, so an ordinary
 *   headless run delivers no key/click/named event at all and the I5/I6 never-fires behavior holds
 *   because nothing was ever pending.
 */
export interface ExecuteOptions {
  readonly instructionBudget?: number;
  readonly recursionDepthLimit?: number;
  readonly signal?: CancellationSignal;
  readonly tutorTemplates?: TutorTemplateFn;
  readonly learnerLevel?: TutorLearnerLevel;
  readonly hostInput?: HostInput;
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
   * `spec/interaction-events.md:136-137` (text that parses as an OpenLogo number literal reports a
   * **number**, anything else reports a **word** preserving the entered text), so `["42", "tom"]`
   * scripts one numeric answer followed by one word answer.
   *
   * Like `events`, this is host-supplied execution *context*: it is never observable in any trace
   * event payload — a read emits only the ordinary catch-all `primitive` event naming `input`, never
   * the prompt or the submitted text. And like `events`, it can only express a *static* script fixed
   * before the run starts, not an answer that depends on what the program has done so far.
   *
   * Defaults to an empty queue. A read with no answer left can never finish, so it takes the only
   * other ending `spec/interaction-events.md:110-111` allows and the program is cancelled with
   * `ol-limit` — deliberately, rather than inventing an answer the learner never gave.
   */
  readonly responses?: readonly string[];
  /**
   * The host's live reader for `input` (issue #681, slice I2) — the *interactive* half of the seam
   * `responses` mocks. When supplied it is authoritative: each `input` read calls it with the
   * prompt, already rendered to the text a learner would see, and the read stays outstanding for
   * exactly the duration of that call. Returning a string finishes the read with that submitted
   * text (classified by `spec/interaction-events.md:136-137` exactly as a scripted answer is);
   * returning `undefined` means the host cannot or will not answer, which ends the read the only
   * other way `:110-111` allows — the program is cancelled.
   *
   * This is how a real host both **displays the prompt** (`:134`) and holds the read open: the
   * reader IS the outstanding read, so a caller can observe, from inside it, that no further
   * OpenLogo instruction and no event handler block has run — the normative MUST at `:108-111`,
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
 * A host's live `input` reader (issue #681). Called with the prompt as displayable text; reports
 * the text the learner submitted, or `undefined` to leave the read unanswered and cancel the run.
 * Synchronous by design: `spec/interaction-events.md:108-111` requires that no OpenLogo instruction
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
 * `spec/execution-model.md:551-557` requires: an instruction budget, a recursion-depth limit, and
 * external cancellation — see {@link ExecuteOptions}. Every `forever` loop is bounded by the
 * (possibly default) instruction budget even with no `options` at all, since "`forever` is
 * therefore safe only because it is cancellable and budgeted" (`spec/execution-model.md:556-557`)
 * is not conditional on the caller opting in.
 */
export function execute(
  source: string,
  document: string,
  options?: ExecuteOptions,
): ExecuteResult {
  return runProgram(source, document, undefined, options);
}
