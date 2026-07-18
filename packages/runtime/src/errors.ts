/**
 * Builders for the runtime-stage `ol-*` diagnostics the evaluator raises — `ol-div-zero`,
 * `ol-neg-sqrt`, and `ol-type` for arithmetic (per
 * [`spec/error-model.md`](../../../spec/error-model.md) and
 * [`spec/execution-model.md`](../../../spec/execution-model.md)'s "Numbers and math" section) —
 * plus `ol-not-enough-inputs` for the runtime-only arity gap `execute()` must guard itself
 * (issue #98): a parenthesized open-variadic primitive call supplied zero arguments. Issue #94
 * adds `ol-undefined-var` (an unbound `:name`/`thing` read), `ol-not-a-place` (a reporter/command
 * call used as an assignment target — the runtime's own copy of the semantic checker's rule of
 * the same name from issue #113, at `stage: "runtime"` since `execute()` never runs `check()`),
 * `ol-range` (a list index outside `1..length`), and a reuse of `ol-type` for a non-list base or
 * non-number key on a postfix index selector (`spec/error-model.md:99` calls out "list indexing
 * with a non-number key" as `ol-type`, not `ol-range`).
 * Mirrors the parser's `errors.ts` pattern: every finding is a stable code from the
 * `@openlogo/core` registry with structured `params` (the diagnostic identity) plus warm,
 * lowercase learner prose derived from them — prose is presentation only.
 */

import type { Diagnostic, OLValue, SourceSpan } from "@openlogo/core";

function runtimeError(
  code: Diagnostic["code"],
  source_span: SourceSpan,
  params: Readonly<Record<string, unknown>>,
  message: string,
): Diagnostic {
  return {
    code,
    source_span,
    params,
    message,
    stage: "runtime",
    severity: "error",
  };
}

/** Params for an `ol-type` diagnostic raised by an arithmetic operator or math builtin. */
export interface ArithmeticTypeErrorParams {
  readonly expected: "number";
  readonly actual: string;
  readonly value: OLValue;
  readonly operation: string;
}

/**
 * Params for an `ol-type` raised by an ordering comparison (`< > <= >=`). Same shape as
 * {@link ArithmeticTypeErrorParams}, but `expected` widens to the ordering concepts: a mismatched
 * operand names the other operand's concept (`"number"`/`"word"`), and a wholly non-orderable
 * operand (boolean/list) names `"number or word"` — the two categories ordering is defined for
 * (`spec/execution-model.md:508-510`).
 */
export interface OrderingTypeErrorParams {
  readonly expected: "number" | "word" | "number or word";
  readonly actual: string;
  readonly value: OLValue;
  readonly operation: string;
}

/**
 * Params for an `ol-type` raised while resolving a postfix place — a non-list value indexed with
 * `[ … ]`, a non-number index key, or a non-word argument to `thing`
 * (`spec/error-model.md:99` — list indexing with a non-number key is `ol-type`, not `ol-range`).
 */
export interface PlaceTypeErrorParams {
  readonly expected: "list" | "number" | "word";
  readonly actual: string;
  readonly value: OLValue;
  readonly operation: string;
}

/** Params for an `ol-range` raised by an out-of-bounds 1-based list index. */
export interface IndexRangeParams {
  readonly index: OLValue;
  readonly length: number;
}

/** Runtime-stage diagnostics, one builder per `ol-*` code the evaluator can raise. */
export const runtimeDiag = {
  /**
   * `ol-not-enough-inputs` for the one arity gap the static checker's `arityRule` cannot itself
   * catch: a parenthesized open-variadic primitive (`(print)`, whose arity ceiling is `Infinity`)
   * supplied zero arguments. `execute()` runs `parse()` only, not the semantic checker, so this
   * is also the sole guard against a bare zero-argument call (`print`) reaching evaluation.
   * Scoped to `print`'s current minimum of one argument — the only case this issue's evaluator
   * needs — rather than a general arity-message builder no caller yet uses.
   */
  notEnoughInputs(source_span: SourceSpan, callable: string): Diagnostic {
    return runtimeError(
      "ol-not-enough-inputs",
      source_span,
      { callable, expected: 1, actual: 0 },
      `${callable} needs one input.`,
    );
  },

  divZero(source_span: SourceSpan, operation: "/" | "mod"): Diagnostic {
    return runtimeError(
      "ol-div-zero",
      source_span,
      { operation },
      `dividing by zero with ${operation} has no answer — try a number other than 0.`,
    );
  },

  negSqrt(source_span: SourceSpan, value: number): Diagnostic {
    return runtimeError(
      "ol-neg-sqrt",
      source_span,
      { value },
      `sqrt needs a number that is 0 or greater, but got ${value}.`,
    );
  },

  typeMismatch(
    source_span: SourceSpan,
    params: ArithmeticTypeErrorParams,
  ): Diagnostic {
    return runtimeError(
      "ol-type",
      source_span,
      { ...params },
      `${params.operation} needs a ${params.expected}, but got a ${params.actual}.`,
    );
  },

  orderingType(
    source_span: SourceSpan,
    params: OrderingTypeErrorParams,
  ): Diagnostic {
    return runtimeError(
      "ol-type",
      source_span,
      { ...params },
      `${params.operation} needs a ${params.expected}, but got a ${params.actual}.`,
    );
  },

  /**
   * `ol-undefined-var`: reading `:name` (or `thing "name"`) found no binding in any visible
   * frame. Distinct from the semantic-stage rule of the same code the checker will raise for
   * source it can prove unbound ahead of time (issue #113) — this is the runtime's own guard for
   * the same defect, since `execute()` never runs `check()`.
   */
  undefinedVar(source_span: SourceSpan, name: string): Diagnostic {
    return runtimeError(
      "ol-undefined-var",
      source_span,
      { name },
      `:${name} has no value yet — try assigning it with :${name} = ... first.`,
    );
  },

  /**
   * `ol-not-a-place`: the target of `=` or `set … to` is a reporter/command call (`first :x = 5`)
   * rather than an assignable place. Same `{ text }` params shape as the parser's
   * `checker-not-a-place.ts` semantic rule (issue #79/#113) so both stages agree on identity —
   * this copy exists because `execute()` runs `parse()` only, not `check()`.
   */
  notAPlace(source_span: SourceSpan, text: string): Diagnostic {
    return runtimeError(
      "ol-not-a-place",
      source_span,
      { text },
      `${text} reports a value, it isn't a place you can assign to.`,
    );
  },

  /** `ol-range`: a 1-based list index outside `1..length`. */
  indexRange(source_span: SourceSpan, params: IndexRangeParams): Diagnostic {
    return runtimeError(
      "ol-range",
      source_span,
      { operation: "index", index: params.index, length: params.length },
      `index ${String(params.index)} is out of range for a list of ${params.length}.`,
    );
  },

  /**
   * `ol-type` reused for postfix-place resolution: a non-list base indexed with `[ … ]`, a
   * non-number index key, or a non-word argument to `thing`.
   */
  placeType(source_span: SourceSpan, params: PlaceTypeErrorParams): Diagnostic {
    return runtimeError(
      "ol-type",
      source_span,
      { ...params },
      `${params.operation} needs a ${params.expected}, but got a ${params.actual}.`,
    );
  },
} as const;
