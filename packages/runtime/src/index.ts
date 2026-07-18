/**
 * `@openlogo/runtime` — evaluator, scoping, procedures, control forms, comprehensions,
 * places/mutation, equality, and the cancellable execution budget. Depends on `@openlogo/core`
 * and `@openlogo/parser`.
 *
 * {@link execute} is the foundational execution entry point (issue #90): it parses a source
 * document and walks the program's top-level statements, emitting one `instruction` start event
 * per statement (`spec/execution-model.md:559-600` — the `instruction` event is the unit of
 * "one step"). Issue #93 gives Core literals and arithmetic (`+ - * / mod` plus
 * `abs sqrt int round power`) a runtime value via {@link evaluate} and adds the minimal `print`
 * event: when a `print value` statement's argument evaluates cleanly, its value is carried on a
 * `print` event emitted right after that statement's `instruction` event. Full `print` semantics
 * (multiple operands, formatting, newlines) is issue #98, extending the handler below. Variables,
 * control flow, procedures, and comprehensions land one vertical slice at a time (issues
 * #94-#105), each adding its own statement handling and, where the spec calls for it, runtime
 * `ol-*` diagnostics.
 */

import type { Diagnostic, PrintPayload, TraceEvent } from "@openlogo/core";
import type {
  CallNode,
  ExpressionNode,
  ParenCallNode,
  StatementNode,
} from "@openlogo/parser";
import { parse } from "@openlogo/parser";
import { evaluate, isSupportedExpression } from "./evaluate.js";

export { evaluate, isSupportedExpression, valuesEqual } from "./evaluate.js";
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
 * Is `statement` a single-argument `print value` call (the multi-value form is issue #98)?
 * Accepts both the plain infix `Call` form (`print 1`) and the explicit-parentheses `ParenCall`
 * form (`(print 1)`) — both share the same callee/args shape (see `evaluate.ts`'s
 * `ArithmeticCallNode`).
 */
function isPrintCall(
  statement: StatementNode,
): statement is CallNode | ParenCallNode {
  return (
    (statement.kind === "Call" || statement.kind === "ParenCall") &&
    statement.callee.name.toLowerCase() === "print" &&
    statement.args.length === 1
  );
}

/**
 * Parse `source` and execute its top-level statements, emitting one `instruction` event per
 * statement with a monotonic `seq` starting at 0. If parsing produced any diagnostic the
 * program is not execution-valid, so no events are emitted and the parse diagnostics are
 * returned unchanged.
 *
 * A `print value` statement additionally evaluates `value` and, if that succeeds, emits a
 * `print` event carrying the result — but only when {@link isSupportedExpression} says this
 * issue's evaluator gives `value` a value; otherwise the argument is left un-evaluated for its
 * own future slice. If evaluation raises a runtime diagnostic (`ol-div-zero`, `ol-neg-sqrt`,
 * `ol-type`), execution stops there: the events emitted so far are kept and the diagnostic is
 * returned, exactly as a parse-stage failure returns diagnostics instead of a trace. Statement
 * kinds this issue does not give meaning to (e.g. a bare arithmetic expression, or any command
 * other than `print`) still emit their `instruction` event but do not evaluate — that is each
 * statement kind's own future slice to add.
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
      // `isPrintCall` already checked `args.length === 1`, so this index is always present —
      // a non-null assertion here (rather than a defensive branch) avoids an untestable
      // unreachable-code path under the 100%-coverage gate.
      const value = statement.args[0] as ExpressionNode;
      // Only evaluate arguments this issue's evaluator gives meaning to (Core literals and
      // arithmetic). `print :x`, `print (:a == :b)`, and similar still emit their `instruction`
      // event but are left un-evaluated for the slice that implements that expression kind.
      if (isSupportedExpression(value)) {
        const result = evaluate(value);
        if (!result.ok) {
          return { events, diagnostics: [result.diagnostic] };
        }
        events.push({
          seq: events.length,
          kind: "print",
          source_span: statement.source_span,
          payload: { value: result.value } satisfies PrintPayload,
        });
      }
    }
  }

  return { events, diagnostics: [] };
}
