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
 * the condition holds. Variables, procedures, and comprehensions land one vertical slice at a
 * time (issues #94-#105), each adding its own statement handling and, where the spec calls for
 * it, runtime `ol-*` diagnostics.
 */

import type {
  Diagnostic,
  OLValue,
  PrintPayload,
  TraceEvent,
} from "@openlogo/core";
import { typeNameOf } from "@openlogo/core";
import type {
  CallNode,
  ExpressionNode,
  ParenCallNode,
  StatementNode,
} from "@openlogo/parser";
import { parse } from "@openlogo/parser";
import {
  createEnvironment,
  evaluate,
  executeAssign,
  isSupportedExpression,
  type Environment,
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
 * Evaluate an `if`/`while` condition and require it to be a boolean — there is no truthiness
 * (`spec/execution-model.md:365-369`, `spec/error-model.md:121`). `operation` names the leading
 * form (`"if"`/`"while"`) for the `ol-not-boolean` diagnostic's `params.operation`, reusing the
 * `runtimeDiag.notBoolean` builder issue #95 added for `and`/`or`/`not` rather than duplicating it.
 * Returns the propagated evaluation failure, the `ol-not-boolean` diagnostic, or the boolean.
 */
function evaluateCondition(
  condition: ExpressionNode,
  env: Environment,
  operation: "if" | "while",
):
  | { readonly ok: true; readonly value: boolean }
  | { readonly ok: false; readonly diagnostic: Diagnostic } {
  const result = evaluate(condition, env);
  if (!result.ok) {
    return result;
  }
  if (typeof result.value !== "boolean") {
    return {
      ok: false,
      diagnostic: runtimeDiag.notBoolean(condition.source_span, {
        actual: typeNameOf(result.value),
        operation,
      }),
    };
  }
  return { ok: true, value: result.value };
}

/**
 * Execute `statements` in order, mutating `events` in place with one `instruction` event per
 * statement plus whatever effect events that statement's kind produces, and returns the
 * diagnostic that stopped execution, or `undefined` on a clean run through every statement. This
 * is the shared statement-execution core for both the top-level program body ({@link execute})
 * and a control form's block body ({@link execute}'s `If`/`While` handling below) — a block is
 * just another list of statements run against the same threaded {@link Environment}
 * (`spec/execution-model.md:316-327`), so nested control forms and further-nested blocks recurse
 * through this same function without their own copy of the dispatch logic.
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
 * instead of a trace — later operands of that same `print` are never evaluated.
 *
 * An `If` statement (issue #100) evaluates `condition` — requiring a boolean, `ol-not-boolean`
 * otherwise (`spec/execution-model.md:365-369`) — and runs exactly one branch: `thenBody` when
 * `condition` is `true`, `elseBody` when it is `false` and present, or neither (no further events)
 * when it is `false` and there is no `else`. Both the bracketed and long-form `… end` bodies parse
 * to the identical `BlockNode` shape, so they execute identically — there is nothing here that
 * distinguishes them. Per the block-result rule (`spec/execution-model.md:214-227`), a bracketed
 * `if`/`while` body runs for effect only: a trailing bare-value expression's value is silently
 * discarded (no value-producing event, no diagnostic) — which already falls out of this function,
 * since a statement kind this issue does not evaluate (a bare arithmetic expression, a call to
 * anything other than `print`) still emits its `instruction` event but never reaches a branch that
 * evaluates or emits a value for it.
 *
 * A `While` statement (issue #100) re-evaluates `condition` before every pass — including the
 * first — running `body` each time it holds and stopping the moment it is `false`
 * (`spec/execution-model.md:365-369`); a condition that never becomes `false` runs forever, same
 * as any other unbounded loop in this issue's scope (the cancellable execution budget is a later,
 * separate slice).
 *
 * Statement kinds this issue does not give meaning to (e.g. a bare arithmetic expression, or any
 * command other than `print`) still emit their `instruction` event but do not evaluate — that is
 * each statement kind's own future slice to add.
 */
function executeStatements(
  statements: readonly StatementNode[],
  env: Environment,
  events: TraceEvent[],
): Diagnostic | undefined {
  for (const statement of statements) {
    events.push({
      seq: events.length,
      kind: "instruction",
      source_span: statement.source_span,
      payload: { statement_kind: statement.kind } satisfies InstructionPayload,
    });

    if (statement.kind === "Assign") {
      const result = executeAssign(statement, env);
      if (!result.ok) {
        return result.diagnostic;
      }
      continue;
    }

    if (isPrintCall(statement)) {
      if (statement.args.length === 0) {
        return runtimeDiag.notEnoughInputs(
          statement.callee.source_span,
          statement.callee.name,
          1,
          0,
        );
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
          return failure;
        }
        events.push({
          seq: events.length,
          kind: "print",
          source_span: statement.source_span,
          payload: { values } satisfies PrintPayload,
        });
      }
      continue;
    }

    if (statement.kind === "If") {
      if (!isSupportedExpression(statement.condition)) {
        continue;
      }
      const condition = evaluateCondition(statement.condition, env, "if");
      if (!condition.ok) {
        return condition.diagnostic;
      }
      const branch = condition.value
        ? statement.thenBody.body
        : (statement.elseBody?.body ?? []);
      const diagnostic = executeStatements(branch, env, events);
      if (diagnostic) {
        return diagnostic;
      }
      continue;
    }

    if (statement.kind === "While") {
      if (!isSupportedExpression(statement.condition)) {
        continue;
      }
      for (;;) {
        const condition = evaluateCondition(statement.condition, env, "while");
        if (!condition.ok) {
          return condition.diagnostic;
        }
        if (!condition.value) {
          break;
        }
        const diagnostic = executeStatements(statement.body.body, env, events);
        if (diagnostic) {
          return diagnostic;
        }
      }
    }
  }

  return undefined;
}

/**
 * Parse `source` and execute its top-level statements, emitting one `instruction` event per
 * statement with a monotonic `seq` starting at 0. If parsing produced any diagnostic the
 * program is not execution-valid, so no events are emitted and the parse diagnostics are
 * returned unchanged.
 *
 * A single root {@link Environment} (issue #94) is created once per `execute()` call and threaded
 * through every statement, so an assignment in one statement is visible to every later read in
 * the same program (`spec/execution-model.md:316-327`) — procedure call frames land with #97. The
 * actual per-statement dispatch (including recursing into `if`/`while` block bodies) lives in
 * {@link executeStatements}.
 */
export function execute(source: string, document: string): ExecuteResult {
  const { ast: program, diagnostics } = parse(source, document);
  if (diagnostics.length > 0) {
    return { events: [], diagnostics };
  }

  const env = createEnvironment();
  const events: TraceEvent[] = [];
  const diagnostic = executeStatements(program.body, env, events);
  return { events, diagnostics: diagnostic ? [diagnostic] : [] };
}
