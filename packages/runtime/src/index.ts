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
import { evaluate, isSupportedExpression } from "./evaluate.js";

export {
  evaluate,
  formatNumber,
  isSupportedExpression,
  printedForm,
  valuesEqual,
} from "./evaluate.js";
export type { EvalResult } from "./evaluate.js";

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
 * Is `statement` a `print` call — the single-value `print value` form or the parenthesized
 * variadic `(print a b …)` form (`spec/commands.md:142-158`, at least one argument either way;
 * the reader/checker already reject a zero-argument `print`)? Accepts both the plain infix
 * `Call` form (`print 1`) and the explicit-parentheses `ParenCall` form (`(print 1 2)`) — both
 * share the same callee/args shape (see `evaluate.ts`'s `ArithmeticCallNode`).
 */
function isPrintCall(
  statement: StatementNode,
): statement is CallNode | ParenCallNode {
  return (
    (statement.kind === "Call" || statement.kind === "ParenCall") &&
    statement.callee.name.toLowerCase() === "print" &&
    statement.args.length >= 1
  );
}

/**
 * Parse `source` and execute its top-level statements, emitting one `instruction` event per
 * statement with a monotonic `seq` starting at 0. If parsing produced any diagnostic the
 * program is not execution-valid, so no events are emitted and the parse diagnostics are
 * returned unchanged.
 *
 * A `print` statement (`print value` or the parenthesized variadic `(print a b …)`) additionally
 * evaluates every operand, left to right, and — once all of them evaluate cleanly — emits a
 * `print` event carrying every value, but only when {@link isSupportedExpression} says this
 * issue's evaluator gives *each* operand a value; otherwise the whole statement is left
 * un-evaluated for a future slice (e.g. `print :x` — variable reads land with issue #94). If
 * evaluating an operand raises a runtime diagnostic (`ol-div-zero`, `ol-neg-sqrt`, `ol-type`),
 * execution stops there: the events emitted so far are kept and the diagnostic is returned,
 * exactly as a parse-stage failure returns diagnostics instead of a trace — later operands of
 * that same `print` are never evaluated. Statement kinds this issue does not give meaning to
 * (e.g. a bare arithmetic expression, or any command other than `print`) still emit their
 * `instruction` event but do not evaluate — that is each statement kind's own future slice to
 * add.
 */
export function execute(source: string, document: string): ExecuteResult {
  const { ast: program, diagnostics } = parse(source, document);
  if (diagnostics.length > 0) {
    return { events: [], diagnostics };
  }

  const events: TraceEvent[] = [];
  for (const statement of program.body) {
    events.push({
      seq: events.length,
      kind: "instruction",
      source_span: statement.source_span,
      payload: { statement_kind: statement.kind } satisfies InstructionPayload,
    });

    if (isPrintCall(statement)) {
      // Only evaluate a `print` whose every operand is an expression kind this issue's
      // evaluator gives meaning to (Core literals and arithmetic). `print :x`,
      // `(print 1 :a)`, and similar still emit their `instruction` event but are left
      // un-evaluated for the slice that implements the unsupported operand's expression kind.
      if (statement.args.every(isSupportedExpression)) {
        const values: OLValue[] = [];
        let failure: Diagnostic | undefined;
        for (const arg of statement.args) {
          const result = evaluate(arg);
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
