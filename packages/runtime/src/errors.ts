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
 * with a non-number key" as `ol-type`, not `ol-range`). Issue #95 adds `ol-not-boolean` for a
 * `not`/`and`/`or` operand that is not `true`/`false` — there is no truthiness. Issue #104 adds
 * `ol-type`/`ol-range` for `repeat`'s non-whole/negative count and `ol-repcount-outside-repeat`
 * for a `repcount` reporter used outside any enclosing `repeat`.
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

/**
 * Params for `ol-not-boolean`: a `not`/`and`/`or` operand (or any other boolean-only condition)
 * was not `true`/`false` (`spec/error-model.md:121`). There is no truthiness — a number, word, or
 * list operand is never coerced, regardless of how "truthy" it might look.
 */
export interface NotBooleanErrorParams {
  readonly actual: string;
  readonly operation: string;
}

/**
 * Params for an `ol-type` raised by `repeat`'s count when it is not a whole number
 * (`spec/execution-model.md:367-369` — TYPE is checked before RANGE).
 */
export interface WholeNumberTypeErrorParams {
  readonly actual: string;
  readonly value: OLValue;
  readonly operation: string;
}

/** Params for an `ol-range` raised by a negative `repeat` count. */
export interface NegativeCountParams {
  readonly operation: string;
  readonly value: number;
}

/** Runtime-stage diagnostics, one builder per `ol-*` code the evaluator can raise. */
export const runtimeDiag = {
  /**
   * `ol-not-enough-inputs` for the arity gaps the static checker's `arityRule` cannot itself
   * catch: a parenthesized open-variadic primitive (`(print)`, whose arity ceiling is `Infinity`)
   * or a parenthesized `and`/`or` (`(and)`, `(and :a)`) supplied fewer than its required minimum
   * (`checker-arity.ts` never arity-checks a grammar operator callee, since bare `and`/`or` can
   * only ever have exactly two operands from the grammar itself — only the parenthesized form
   * can under-supply). `execute()` runs `parse()` only, not the semantic checker, so this is also
   * the sole guard against a too-few call reaching evaluation at all.
   */
  notEnoughInputs(
    source_span: SourceSpan,
    callable: string,
    expected: number,
    actual: number,
  ): Diagnostic {
    return runtimeError(
      "ol-not-enough-inputs",
      source_span,
      { callable, expected, actual },
      `${callable} needs ${expected === 1 ? "one input" : `${expected} inputs`}, but got ${actual}.`,
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

  /**
   * `ol-not-boolean`: a `not`/`and`/`or` operand was not `true`/`false`. There is no truthiness
   * (`spec/error-model.md:121`) — a number, word, or list operand never coerces.
   */
  notBoolean(
    source_span: SourceSpan,
    params: NotBooleanErrorParams,
  ): Diagnostic {
    return runtimeError(
      "ol-not-boolean",
      source_span,
      { ...params },
      `${params.operation} needs a boolean (true or false), but got a ${params.actual}.`,
    );
  },

  /**
   * `ol-type`: `repeat`'s count is not a whole number (`spec/execution-model.md:367-369`) — the
   * TYPE half of count validation, checked before the RANGE half {@link negativeCount} raises.
   * `expected` is fixed to `"whole number"` (rather than the generic `"number"`
   * {@link typeMismatch} uses) so the message names the concept precisely.
   */
  notWholeNumber(
    source_span: SourceSpan,
    params: WholeNumberTypeErrorParams,
  ): Diagnostic {
    return runtimeError(
      "ol-type",
      source_span,
      { expected: "whole number", ...params },
      `${params.operation} needs a whole number, but got a ${params.actual}.`,
    );
  },

  /**
   * `ol-range`: `repeat`'s count is a whole number but negative
   * (`spec/execution-model.md:367-369`, `spec/error-model.md:100` — "a negative whole-number
   * `repeat` count"). Only reached once {@link notWholeNumber} has already confirmed the value is
   * a whole number.
   */
  negativeCount(
    source_span: SourceSpan,
    params: NegativeCountParams,
  ): Diagnostic {
    return runtimeError(
      "ol-range",
      source_span,
      { ...params },
      `${params.operation} needs a count of 0 or greater, but got ${params.value}.`,
    );
  },

  /**
   * `ol-repcount-outside-repeat`: `repcount` was used outside any enclosing `repeat`
   * (`spec/commands.md:792`). Registry stage is `semantic`, but raised here at `stage: "runtime"`
   * — same convention as `ol-not-a-place`/`ol-undefined-var` — since `execute()` never runs
   * `check()`. Params are `none` per the registry.
   */
  repcountOutsideRepeat(source_span: SourceSpan): Diagnostic {
    return runtimeError(
      "ol-repcount-outside-repeat",
      source_span,
      {},
      "repcount only reports a turn number inside a repeat loop — there is no enclosing repeat here.",
    );
  },
} as const;
