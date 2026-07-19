/**
 * Shared statement-execution core for `index.ts`'s {@link execute} — and, separately, this
 * package's own tests exercising `forever` loop mechanics. **Not part of `@openlogo/runtime`'s
 * public API**: `package.json`'s `exports` map only ever resolves the bare `"@openlogo/runtime"`
 * specifier to `dist/index.js`, and `index.ts` never re-exports anything from this file, so no
 * external consumer can reach {@link executeWithForeverIterationLimitForTests} through the
 * package. Only a same-package relative import straight into `dist/execute-internal.js` (which
 * `repeat-forever-repcount.test.mjs` uses) can — this is deliberate: it keeps the test-only
 * `forever` iteration cap architecturally unreachable from `execute()` or any real caller, not
 * just unreachable by convention/naming.
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
  ForInNode,
  ParenCallNode,
  SpannedName,
  StatementNode,
} from "@openlogo/parser";
import { parse } from "@openlogo/parser";
import {
  createEnvironment,
  evaluate,
  executeAssign,
  isSupportedExpression,
  requireNumber,
  requireWholeNumber,
  type Environment,
  type Frame,
} from "./evaluate.js";
import { runtimeDiag } from "./errors.js";
import type { ExecuteResult, InstructionPayload } from "./index.js";

/**
 * `ForInNode.binder` (`spec/grammar.md:136-137`): a bare name, or a destructuring pattern. The
 * pattern node itself (`DestructuringBinderNode`) is not part of `@openlogo/parser`'s public
 * export list, so it is named here via `Extract` off the already-exported {@link ForInNode}
 * rather than importing it directly.
 */
type ForInBinder = ForInNode["binder"];
type DestructuringBinder = Extract<
  ForInBinder,
  { kind: "DestructuringBinder" }
>;

/**
 * Is `statement` a call to `print` — the single-value `print value` form or the parenthesized
 * variadic `(print a b …)` form (`spec/commands.md:142-158`)? Accepts both the plain infix
 * `Call` form (`print 1`) and the explicit-parentheses `ParenCall` form (`(print 1 2)`) — both
 * share the same callee/args shape (see `evaluate.ts`'s `ArithmeticCallNode`). Matches
 * regardless of argument count: a zero-argument `print`/`(print)` is handled separately in
 * {@link executeStatements}, since `execute()` runs `parse()` only (not the semantic checker), so
 * the checker's static `ol-not-enough-inputs` rule never sees it here.
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
 * Push a fresh body-local frame binding `bindings` (name → value) onto `env`, nearest-first, for
 * a `for` loop's own binder(s) — `spec/execution-model.md:435-437` ("body-local bindings that
 * shadow outer names only for the body"). Returns a *new* {@link Environment}; `env` itself is
 * never mutated, so once the caller stops using the returned value the binding is gone — there is
 * no explicit "pop" step, unlike `repeatTurns` (a plain mutable array shared by every recursive
 * call). `repeatTurns` is threaded through unchanged (same array reference) so a `for` nested
 * inside a `repeat` still sees the right `repcount`, and a `repeat`/`for` nested inside a `for`
 * still sees it too.
 */
function pushLoopFrame(
  env: Environment,
  bindings: ReadonlyMap<string, OLValue>,
): Environment {
  const frame: Frame = new Map(bindings);
  return { frames: [frame, ...env.frames], repeatTurns: env.repeatTurns };
}

/**
 * The first name in a destructuring pattern that repeats an earlier one in the same pattern
 * (case-insensitively), or `undefined` when every name is distinct. Mirrors the parser's
 * `checker-control-flow.ts` `patternDuplicateDiagnostics` exactly (same case-folding) so the
 * runtime's own `ol-duplicate-binder` guard agrees with the semantic checker's — this is a static
 * property of the pattern, checked once before iterating rather than per element.
 */
function findDuplicateBinderName(
  binder: DestructuringBinder,
): SpannedName | undefined {
  const seen = new Set<string>();
  for (const name of binder.names) {
    const key = name.name.toLowerCase();
    if (seen.has(key)) {
      return name;
    }
    seen.add(key);
  }
  return undefined;
}

/**
 * Bind one `for ... in` element against `binder`: a bare name binds the whole element, while a
 * destructuring pattern destructures it positionally (`spec/execution-model.md:435-439`). A
 * non-list element, or one whose length disagrees with the pattern's arity, raises `ol-range` — a
 * non-list element's length is treated as `0`, since it can never match a non-empty pattern.
 * `"kind" in binder` — not `binder.kind`, since a bare-name binder is a plain {@link SpannedName}
 * with no `kind` field at all (see `ast.ts`'s own `walk` for the same pattern) — distinguishes the
 * two without a false discriminated-union assumption.
 */
function bindForInElement(
  binder: ForInBinder,
  element: OLValue,
):
  | { readonly ok: true; readonly bindings: Map<string, OLValue> }
  | { readonly ok: false; readonly diagnostic: Diagnostic } {
  if (!("kind" in binder)) {
    return { ok: true, bindings: new Map([[binder.name, element]]) };
  }
  const values = Array.isArray(element) ? element : undefined;
  if (values === undefined || values.length !== binder.names.length) {
    return {
      ok: false,
      diagnostic: runtimeDiag.patternLengthMismatch(binder.source_span, {
        operation: "destructuring",
        value: values === undefined ? 0 : values.length,
        length: binder.names.length,
      }),
    };
  }
  const bindings = new Map<string, OLValue>();
  binder.names.forEach((name, index) => {
    bindings.set(name.name, values[index] as OLValue);
  });
  return { ok: true, bindings };
}

/**
 * Execute `statements` in order, mutating `events` in place with one `instruction` event per
 * statement plus whatever effect events that statement's kind produces, and returns the
 * diagnostic that stopped execution, or `undefined` on a clean run through every statement. This
 * is the shared statement-execution core for both the top-level program body ({@link
 * runProgram}) and a control form's block body (the `If`/`While`/`Repeat`/`Forever` handling
 * below) — a block is just another list of statements run against the same threaded
 * {@link Environment} (`spec/execution-model.md:316-327`), so nested control forms and
 * further-nested blocks recurse through this same function without their own copy of the dispatch
 * logic.
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
 * A `Repeat` statement (issue #104) evaluates `count`, then validates it TYPE then RANGE, in that
 * exact order (`spec/execution-model.md:367-369`): a non-whole-number count raises `ol-type`
 * ({@link requireWholeNumber}); otherwise a negative count raises `ol-range`
 * (`runtimeDiag.negativeCount`); `repeat 0` runs `body` zero times with no diagnostic. Each pass
 * pushes that pass's 1-based turn onto `env.repeatTurns` before running `body` and pops it after —
 * even on a diagnostic, the stack for `repcount` is only ever this scoped, so a nested `repeat`
 * inside `body` sees its own turn on top of the outer one, and `repcount` always reads the
 * innermost.
 *
 * A `Forever` statement (issue #104) repeats `body` without bound — cancellation and the
 * execution budget are a later, separate slice (#102) — up to `foreverIterationLimit` passes when
 * one is supplied. That limit is a **test-only** knob only reachable via
 * {@link executeWithForeverIterationLimitForTests}, never via `execute()`; no production caller
 * ever passes it, so every real `forever` genuinely never terminates, same as an always-`true`
 * `while`.
 *
 * A `ForIn` statement (issue #103) evaluates `iterable` — it must be a list, `ol-type` otherwise
 * (`spec/execution-model.md:375-376`; Core `for ... in` is list-only, dict iteration is a later
 * profile) — then runs `body` once per element, in order, binding `binder` fresh each pass via
 * {@link pushLoopFrame}. A bare-name binder binds the whole element; a destructuring binder
 * ({@link bindForInElement}) binds each of its names positionally from the element, which must
 * itself be a list of exactly that many items (`ol-range` otherwise —
 * `spec/execution-model.md:435-439`). A duplicate name within one destructuring pattern
 * (`for [:x :x] in ...`) raises `ol-duplicate-binder`, checked once up front via
 * {@link findDuplicateBinderName} since it is a static property of the pattern, not the data.
 *
 * A `ForRange` statement (issue #103) evaluates `from`/`to`/`by` (default step `1`) — each must be
 * a number, `ol-type` otherwise ({@link requireNumber}, which unlike `repeat`'s count is not
 * restricted to whole numbers) — then iterates `variable` from `from` to `to` inclusive, adding
 * `step` each pass: with a positive step the body runs while `variable` is at most `to`, with a
 * negative step while it is at least `to` (`spec/execution-model.md:370-375`). A step pointing
 * away from `to` (e.g. `from 1 to 5 by -1`) runs `body` zero times, no diagnostic; a step of `0`
 * raises `ol-range` (`runtimeDiag.forStepZero`) since it would otherwise never reach `to`.
 * `variable` is bound fresh each pass via {@link pushLoopFrame}, same as `ForIn`'s binder.
 *
 * Both loops' binders are fresh **body-local** bindings (`spec/execution-model.md:435-437`): each
 * pass runs `body` against a *new* {@link Environment} with one extra frame in front of `env`'s
 * own frames, so the binding is visible inside `body` but never leaks past the loop — `env` itself
 * is never mutated. `env.repeatTurns` (same array reference) and `foreverIterationLimit` are
 * threaded through unchanged, so a `repeat`'s `repcount` and a `forever`'s test-only iteration cap
 * both still work correctly across a nested `for`.
 *
 * Statement kinds this issue does not give meaning to (e.g. a bare arithmetic expression, or any
 * command other than `print`) still emit their `instruction` event but do not evaluate — that is
 * each statement kind's own future slice to add.
 */
function executeStatements(
  statements: readonly StatementNode[],
  env: Environment,
  events: TraceEvent[],
  foreverIterationLimit?: number,
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
      const diagnostic = executeStatements(
        branch,
        env,
        events,
        foreverIterationLimit,
      );
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
        const diagnostic = executeStatements(
          statement.body.body,
          env,
          events,
          foreverIterationLimit,
        );
        if (diagnostic) {
          return diagnostic;
        }
      }
      continue;
    }

    if (statement.kind === "Repeat") {
      if (!isSupportedExpression(statement.count)) {
        continue;
      }
      const countResult = evaluate(statement.count, env);
      if (!countResult.ok) {
        return countResult.diagnostic;
      }
      const whole = requireWholeNumber(
        countResult.value,
        statement.count.source_span,
        "repeat",
      );
      if (!whole.ok) {
        return whole.diagnostic;
      }
      if (whole.value < 0) {
        return runtimeDiag.negativeCount(statement.count.source_span, {
          operation: "repeat",
          value: whole.value,
        });
      }
      for (let turn = 1; turn <= whole.value; turn++) {
        env.repeatTurns.push(turn);
        const diagnostic = executeStatements(
          statement.body.body,
          env,
          events,
          foreverIterationLimit,
        );
        env.repeatTurns.pop();
        if (diagnostic) {
          return diagnostic;
        }
      }
      continue;
    }

    if (statement.kind === "Forever") {
      let turn = 1;
      while (
        foreverIterationLimit === undefined ||
        turn <= foreverIterationLimit
      ) {
        const diagnostic = executeStatements(
          statement.body.body,
          env,
          events,
          foreverIterationLimit,
        );
        if (diagnostic) {
          return diagnostic;
        }
        turn++;
      }
      continue;
    }

    if (statement.kind === "ForIn") {
      if ("kind" in statement.binder) {
        const duplicate = findDuplicateBinderName(statement.binder);
        if (duplicate !== undefined) {
          return runtimeDiag.duplicateBinder(
            duplicate.source_span,
            duplicate.name,
          );
        }
      }
      if (!isSupportedExpression(statement.iterable)) {
        continue;
      }
      const iterableResult = evaluate(statement.iterable, env);
      if (!iterableResult.ok) {
        return iterableResult.diagnostic;
      }
      if (!Array.isArray(iterableResult.value)) {
        return runtimeDiag.forInNotList(statement.iterable.source_span, {
          actual: typeNameOf(iterableResult.value),
          value: iterableResult.value,
        });
      }
      for (const element of iterableResult.value) {
        const bound = bindForInElement(statement.binder, element);
        if (!bound.ok) {
          return bound.diagnostic;
        }
        const diagnostic = executeStatements(
          statement.body.body,
          pushLoopFrame(env, bound.bindings),
          events,
          foreverIterationLimit,
        );
        if (diagnostic) {
          return diagnostic;
        }
      }
      continue;
    }

    if (statement.kind === "ForRange") {
      if (
        !isSupportedExpression(statement.from) ||
        !isSupportedExpression(statement.to) ||
        (statement.by !== undefined && !isSupportedExpression(statement.by))
      ) {
        continue;
      }
      const fromResult = evaluate(statement.from, env);
      if (!fromResult.ok) {
        return fromResult.diagnostic;
      }
      const from = requireNumber(
        fromResult.value,
        statement.from.source_span,
        "for",
      );
      if (!from.ok) {
        return from.diagnostic;
      }
      const toResult = evaluate(statement.to, env);
      if (!toResult.ok) {
        return toResult.diagnostic;
      }
      const to = requireNumber(toResult.value, statement.to.source_span, "for");
      if (!to.ok) {
        return to.diagnostic;
      }
      let step = 1;
      if (statement.by !== undefined) {
        const byResult = evaluate(statement.by, env);
        if (!byResult.ok) {
          return byResult.diagnostic;
        }
        const by = requireNumber(
          byResult.value,
          statement.by.source_span,
          "for",
        );
        if (!by.ok) {
          return by.diagnostic;
        }
        if (by.value === 0) {
          return runtimeDiag.forStepZero(statement.by.source_span);
        }
        step = by.value;
      }
      // Recompute each pass's value from `from` and the pass count (rather than repeatedly
      // adding `step` to a running total) so IEEE-754 rounding cannot drift the running value
      // away from its true multiple of `step` over many passes. A step whose exact decimal
      // value cannot be represented exactly in binary floating point (e.g. `0.1`) would
      // otherwise sometimes land a hair past `to` — silently dropping the inclusive endpoint
      // (`from 0 to 0.3 by 0.1` would stop at `0.2`, since the fourth running total is
      // `0.30000000000000004`, not `0.3`). The boundary comparison tolerates only a few ULPs of
      // `current`/`to` themselves (`Number.EPSILON` scaled to their own magnitude) — not a
      // fraction of `step` — so it absorbs that per-pass representation error without ALSO
      // admitting a pass that is genuinely beyond `to` (e.g. `from 0 to 0.9999999995 by 1` must
      // still run only once, at `0`).
      for (let turn = 0; ; turn += 1) {
        const current = from.value + turn * step;
        const epsilon =
          Number.EPSILON * Math.max(1, Math.abs(current), Math.abs(to.value));
        const withinBound =
          step > 0
            ? current <= to.value + epsilon
            : current >= to.value - epsilon;
        if (!withinBound) {
          break;
        }
        const diagnostic = executeStatements(
          statement.body.body,
          pushLoopFrame(env, new Map([[statement.variable.name, current]])),
          events,
          foreverIterationLimit,
        );
        if (diagnostic) {
          return diagnostic;
        }
      }
    }
  }

  return undefined;
}

/**
 * Parse `source` and run it, sharing {@link execute}'s and
 * {@link executeWithForeverIterationLimitForTests}'s logic. `foreverIterationLimit` is
 * `undefined` for every real `execute()` call — see `index.ts`'s `execute()` doc comment — so a
 * `forever` loop is genuinely unbounded there; only the test-only entry point below ever supplies
 * it.
 */
export function runProgram(
  source: string,
  document: string,
  foreverIterationLimit: number | undefined,
): ExecuteResult {
  const { ast: program, diagnostics } = parse(source, document);
  if (diagnostics.length > 0) {
    return { events: [], diagnostics };
  }

  const env = createEnvironment();
  const events: TraceEvent[] = [];
  const diagnostic = executeStatements(
    program.body,
    env,
    events,
    foreverIterationLimit,
  );
  return { events, diagnostics: diagnostic ? [diagnostic] : [] };
}

/**
 * **Test-only.** Identical to `execute()` except a `forever` loop in `source` stops on its own
 * (with no diagnostic) after `foreverIterationLimit` passes, so a unit test can exercise
 * `forever`'s loop mechanics without hanging the test process. Deliberately lives in this
 * module — never re-exported by `index.ts` — rather than as an optional parameter on `execute()`,
 * so the bound can never leak into a real caller's `execute()` invocation and is not reachable via
 * the `"@openlogo/runtime"` package specifier at all (see this file's header comment);
 * `forever` has no cancellation or execution-budget semantics in this issue's scope (that lands
 * with #102). Only this package's own tests, importing this file directly by relative path, ever
 * call it.
 */
export function executeWithForeverIterationLimitForTests(
  source: string,
  document: string,
  foreverIterationLimit: number,
): ExecuteResult {
  return runProgram(source, document, foreverIterationLimit);
}
