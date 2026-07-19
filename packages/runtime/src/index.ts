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

export {
  createEnvironment,
  evaluate,
  executeAssign,
  formatNumber,
  isSupportedExpression,
  printedForm,
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
  DEFAULT_RECURSION_DEPTH_LIMIT,
} from "./execute-internal.js";

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
 *   `ol-limit` (`limit: "recursion-depth"`). Defaults to {@link DEFAULT_RECURSION_DEPTH_LIMIT} —
 *   the same value this package always enforced, now configurable rather than hardcoded, with the
 *   same non-finite/non-positive fallback as `instructionBudget`.
 * - `signal` — a {@link CancellationSignal} a caller can flip to `aborted` to cancel a
 *   still-running program. Checked before every statement/loop pass; once aborted, no further
 *   trace events are emitted and execution halts with `ol-limit` (`limit: "cancelled"`) —
 *   already-emitted events are returned unchanged. See {@link CancellationSignal}'s doc comment
 *   for why this only meaningfully cancels a run already in progress when backed by cross-thread
 *   shared state (e.g. a Web Worker + `SharedArrayBuffer`/`Atomics`) — `execute()` is synchronous
 *   and never yields, so a same-thread `AbortController` cannot interrupt a call already underway.
 */
export interface ExecuteOptions {
  readonly instructionBudget?: number;
  readonly recursionDepthLimit?: number;
  readonly signal?: CancellationSignal;
}

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
