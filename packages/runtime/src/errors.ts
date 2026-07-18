/**
 * Builders for the runtime-stage `ol-*` diagnostics the evaluator raises — `ol-div-zero`,
 * `ol-neg-sqrt`, and `ol-type` for arithmetic (per
 * [`spec/error-model.md`](../../../spec/error-model.md) and
 * [`spec/execution-model.md`](../../../spec/execution-model.md)'s "Numbers and math" section).
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

/** Runtime-stage diagnostics, one builder per `ol-*` code the evaluator can raise. */
export const runtimeDiag = {
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
} as const;
