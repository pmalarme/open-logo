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
 * (`PrintPayload.values`) right after that statement's `instruction` event. Variables, control
 * flow, procedures, and comprehensions land one vertical slice at a time (issues #94-#105), each
 * adding its own statement handling and, where the spec calls for it, runtime `ol-*` diagnostics.
 */

import type {
  Diagnostic,
  OLValue,
  PrintPayload,
  TraceEvent,
} from "@openlogo/core";
import type { CallNode, ParenCallNode, StatementNode } from "@openlogo/parser";
import { parse } from "@openlogo/parser";
import {
  createEnvironment,
  evaluate,
  executeAssign,
  isSupportedExpression,
} from "./evaluate.js";
import { runtimeDiag } from "./errors.js";

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
  EvalResult,
  Environment,
  Frame,
} from "./evaluate.js";

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
 * Is `statement` a call to `print` — the single-value `print value` form or the parenthesized
 * variadic `(print a b …)` form (`spec/commands.md:142-158`)? Accepts both the plain infix
 * `Call` form (`print 1`) and the explicit-parentheses `ParenCall` form (`(print 1 2)`) — both
 * share the same callee/args shape (see `evaluate.ts`'s `ArithmeticCallNode`). Matches
 * regardless of argument count: a zero-argument `print`/`(print)` is handled separately in
 * {@link execute}, since `execute()` runs `parse()` only (not the semantic checker), so the
 * checker's static `ol-not-enough-inputs` rule never sees it here.
 */
function isPrintCall(
  statement: StatementNode,
): statement is CallNode | ParenCallNode {
  return (
    (statement.kind === "Call" || statement.kind === "ParenCall") &&
    statement.callee.name.toLowerCase() === "print"
  );
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
 *
 * An `Assign` statement (`:place = value`, `set place to value`) is executed via
 * {@link executeAssign}; it never emits its own event (there is no dedicated event kind for
 * assignment in the trace/event registry) but a failure — `ol-not-a-place` for a reporter/call
 * target, or a diagnostic propagated from evaluating the value/an intermediate postfix segment —
 * stops execution exactly like a print failure does. A `.field`-bearing target is Data-profile
 * and deferred: `executeAssign` leaves it silently un-executed rather than raising.
 *
 * A `print` statement (`print value` or the parenthesized variadic `(print a b …)`) additionally
 * evaluates every operand, left to right, and — once all of them evaluate cleanly — emits a
 * `print` event carrying every value, but only when {@link isSupportedExpression} says this
 * issue's evaluator gives *each* operand a value; otherwise the whole statement is left
 * un-evaluated for a future slice (e.g. `print :ages.tom` — dotted-field reads land with the
 * Data profile). A zero-argument `print`/`(print)` raises `ol-not-enough-inputs` (issue #98):
 * `execute()` runs `parse()` only, so the semantic checker's static arity rule — which cannot
 * itself catch an open-variadic parenthesized under-supply, `packages/parser/src/checker-arity.ts`
 * — never runs here, and this is the only guard against silently treating a callee-only `print`
 * as a no-op. If evaluating an operand raises a runtime diagnostic (`ol-div-zero`, `ol-neg-sqrt`,
 * `ol-type`, `ol-undefined-var`, `ol-range`), execution stops there: the events emitted so far are
 * kept and the diagnostic is returned, exactly as a parse-stage failure returns diagnostics
 * instead of a trace — later operands of that same `print` are never evaluated. Statement kinds
 * this issue does not give meaning to (e.g. a bare arithmetic expression, or any command other
 * than `print`) still emit their `instruction` event but do not evaluate — that is each statement
 * kind's own future slice to add.
 */
export function execute(source: string, document: string): ExecuteResult {
  const { ast: program, diagnostics } = parse(source, document);
  if (diagnostics.length > 0) {
    return { events: [], diagnostics };
  }

  const env = createEnvironment();
  const events: TraceEvent[] = [];
  for (const statement of program.body) {
    events.push({
      seq: events.length,
      kind: "instruction",
      source_span: statement.source_span,
      payload: { statement_kind: statement.kind } satisfies InstructionPayload,
    });

    if (statement.kind === "Assign") {
      const result = executeAssign(statement, env);
      if (!result.ok) {
        return { events, diagnostics: [result.diagnostic] };
      }
      continue;
    }

    if (isPrintCall(statement)) {
      if (statement.args.length === 0) {
        return {
          events,
          diagnostics: [
            runtimeDiag.notEnoughInputs(
              statement.callee.source_span,
              statement.callee.name,
              1,
              0,
            ),
          ],
        };
      }
      // Only evaluate a `print` whose every operand is an expression kind this issue's
      // evaluator gives meaning to (Core literals, arithmetic, variable/place reads).
      // `(print 1 :ages.tom)` and similar still emit their `instruction` event but are left
      // un-evaluated for the slice that implements the unsupported operand's expression kind.
      if (statement.args.every(isSupportedExpression)) {
        const values: OLValue[] = [];
        let failure: Diagnostic | undefined;
        for (const arg of statement.args) {
          const result = evaluate(arg, env);
          if (!result.ok) {
            failure = result.diagnostic;
            break;
          }
          values.push(result.value);
        }
        if (failure) {
          return { events, diagnostics: [failure] };
        }
        events.push({
          seq: events.length,
          kind: "print",
          source_span: statement.source_span,
          payload: { values } satisfies PrintPayload,
        });
      }
    }
  }

  return { events, diagnostics: [] };
}
