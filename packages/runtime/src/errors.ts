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
 * for a `repcount` reporter used outside any enclosing `repeat`. Issue #103 adds `for`'s own
 * diagnostics: `ol-type` for a `for ... in` iterable that is not a list
 * (`spec/execution-model.md:375-376` — Core `for ... in` is list-only), `ol-range` for a
 * `for ... from ... to ... by 0` step (`spec/execution-model.md:374-375`), a destructuring
 * pattern/element length mismatch (`spec/execution-model.md:438-439`), and `ol-duplicate-binder`
 * for a repeated name in a `for [:x :x] in ...` pattern — the runtime's own copy of the
 * semantic checker's rule of the same name (issue #114's `checker-control-flow.ts`), at
 * `stage: "runtime"` since `execute()` never runs `check()`.
 * Issue #97 adds procedure-call diagnostics: `ol-too-many-inputs` (a fixed-arity call —
 * including the parenthesized form of a user procedure — supplied too many inputs), reusing
 * `ol-not-enough-inputs`'s `{callable, expected, actual}` param shape so both share it with the
 * static checker's `checker-arity.ts` (issue #111); `ol-no-output` (a command procedure used
 * where a value is required, raised at the call site); `ol-user-error` (`throw <value>`); and
 * the runtime's own copies of the checker's `ol-return-outside-proc`/`ol-stop-outside-proc`
 * (issue #114's `checker-control-flow.ts`) for the same reason as `ol-not-a-place` above; and
 * `ol-limit` for a procedure call nested past a configured recursion-depth threshold
 * (`spec/execution-model.md:551-557`), so unbounded recursion raises a friendly diagnostic instead
 * of a raw host stack overflow. Issue #105 adds comprehension diagnostics: `ol-type` for a
 * `map`/`filter`/`reduce` iterable that is not a list; `ol-no-value` for a comprehension body
 * whose last statement produces no value; `ol-return-in-comprehension` for a `return`/`stop`
 * reached inside a comprehension body; and widens `duplicateBinder` to also cover a `reduce`
 * accumulator/item-binder name collision — the runtime's own copies of the semantic checker's
 * rules of the same names (issue #114's `checker-control-flow.ts`), at `stage: "runtime"` since
 * `execute()` never runs `check()`. Issue #99 adds the worded `is`-predicate/prefix `?`-predicate
 * diagnostics: `ol-type` for a wrong-typed `is empty`/`empty?`, `is member of`/`member?`, or
 * `is_a?` type-argument operand; and `ol-unknown-type` for an unrecognized type word in `is a
 * <type-word>`/`is_a?` — the runtime's own copy of the checker's `unknownTypeRule` (issue #112's
 * `checker-type-field.ts`), at `stage: "runtime"` for the same reason as the others above.
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

/**
 * Params for an `ol-type` raised by a `for ... in` iterable that is not a list
 * (`spec/execution-model.md:375-376` — Core `for ... in` is list-only; dict iteration is a later
 * profile).
 */
export interface ForInNotListParams {
  readonly actual: string;
  readonly value: OLValue;
}

/**
 * Params for an `ol-range` raised by a `for ... by 0` step
 * (`spec/execution-model.md:374-375` — a step of `0` never reaches `end`, so it is rejected
 * rather than silently looping forever).
 */
export interface ForStepZeroParams {
  readonly operation: "for";
  readonly value: 0;
}

/**
 * Params for an `ol-range` raised by a destructuring binder/element length mismatch
 * (`spec/execution-model.md:438-439` — "a short or long pattern mismatch raises `ol-range`"):
 * `length` is the pattern's own arity, `value` the element's actual length (`0` for a non-list
 * element, which can never match a non-empty pattern).
 */
export interface PatternLengthMismatchParams {
  readonly operation: "destructuring";
  readonly value: number;
  readonly length: number;
}

/**
 * Params for an `ol-type` raised by a comprehension (`map`/`filter`/`reduce`) iterable that is
 * not a list (`spec/execution-model.md:380-384` — every comprehension form ranges over a list).
 * Same shape as {@link ForInNotListParams} plus the comprehension's own `form`, since `ol-type`'s
 * `operation` names the offending construct.
 */
export interface ComprehensionNotListParams {
  readonly actual: string;
  readonly value: OLValue;
  readonly operation: "map" | "filter" | "reduce";
}

/**
 * Params for `ol-no-value`: a comprehension body's last statement does not produce a value
 * (`spec/execution-model.md:225` — the block-result rule). Same `{form}` shape as the parser's
 * `checker-control-flow.ts` semantic rule (issue #114) so both stages agree on identity.
 */
export interface NoValueParams {
  readonly form: "map" | "filter" | "reduce";
}

/**
 * Params for `ol-return-in-comprehension`: a `return`/`output`/`op`/`stop` reached inside a
 * comprehension body (`spec/execution-model.md:226-227`) — a comprehension reports its last
 * expression, never an explicit `return`/`stop`. Same `{keyword, form}` shape as the parser's
 * `checker-control-flow.ts` semantic rule (issue #114) so both stages agree on identity; `keyword`
 * is the literal string `"stop"` for a `Stop` node (which has no `keyword` field of its own),
 * matching the checker's own synthesis.
 */
export interface ReturnInComprehensionParams {
  readonly keyword: "return" | "output" | "op" | "stop";
  readonly form: "map" | "filter" | "reduce";
}

/**
 * Params for an `ol-type` raised by a worded `is`-predicate's or a prefix `?`-predicate's operand
 * (`spec/execution-model.md:158-166`): `is empty`/`empty?` accepts a list or word, `is member of`/
 * `member?` accepts a list as the collection, and the prefix `is_a? value type` form's dynamically
 * evaluated `type` argument must itself be a word. Same shape as {@link OrderingTypeErrorParams}/
 * {@link PlaceTypeErrorParams} — `operation` names the offending predicate for the message.
 */
export interface IsPredicateTypeErrorParams {
  readonly expected: "list or word" | "list" | "word";
  readonly actual: string;
  readonly value: OLValue;
  readonly operation: string;
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

  /**
   * `ol-type`: a `for ... in` iterable is not a list — Core's `for ... in` only iterates lists
   * (`spec/execution-model.md:375-376`); dict iteration is a later, profile-specific form.
   */
  forInNotList(
    source_span: SourceSpan,
    params: ForInNotListParams,
  ): Diagnostic {
    return runtimeError(
      "ol-type",
      source_span,
      { expected: "list", ...params, operation: "for" },
      `for ... in needs a list, but got a ${params.actual}.`,
    );
  },

  /**
   * `ol-type`: a `map`/`filter`/`reduce` iterable is not a list
   * (`spec/execution-model.md:380-384` — every comprehension form ranges over a list, same
   * restriction as `ForIn`). `params.operation` names the specific comprehension form.
   */
  comprehensionNotList(
    source_span: SourceSpan,
    params: ComprehensionNotListParams,
  ): Diagnostic {
    return runtimeError(
      "ol-type",
      source_span,
      { expected: "list", ...params },
      `${params.operation} needs a list, but got a ${params.actual}.`,
    );
  },

  /**
   * `ol-range`: `for ... from ... to ... by 0` — a step of `0` never reaches `end`
   * (`spec/execution-model.md:374-375`), unlike a step merely pointing away from `end` (which
   * simply runs the body zero times, no diagnostic).
   */
  forStepZero(source_span: SourceSpan): Diagnostic {
    return runtimeError(
      "ol-range",
      source_span,
      { operation: "for", value: 0 } satisfies ForStepZeroParams,
      "for ... by 0 never reaches the end — try a step other than 0.",
    );
  },

  /**
   * `ol-range`: a destructuring binder's pattern and an iterated element disagree on length
   * (`spec/execution-model.md:438-439`). `params.value` is the element's actual length (`0` for a
   * non-list element).
   */
  patternLengthMismatch(
    source_span: SourceSpan,
    params: PatternLengthMismatchParams,
  ): Diagnostic {
    return runtimeError(
      "ol-range",
      source_span,
      { ...params },
      `this pattern expects ${params.length} value${params.length === 1 ? "" : "s"}, but got ${params.value}.`,
    );
  },

  /**
   * `ol-duplicate-binder`: a repeated name in a `for [:x :x] in ...` destructuring pattern, or —
   * issue #105 — a comprehension whose accumulator/item-binder names collide (`form: "reduce"`)
   * or whose destructuring item binder repeats a name (`form: "destructuring"`, the default, kept
   * for `ForIn`'s pre-#105 2-arg call sites). Same `{ name, form }` params shape as the parser's
   * `checker-control-flow.ts` semantic rule (issue #114) so both stages agree on identity — this
   * copy exists because `execute()` runs `parse()` only, not `check()`.
   */
  duplicateBinder(
    source_span: SourceSpan,
    name: string,
    form: "reduce" | "destructuring" = "destructuring",
  ): Diagnostic {
    return runtimeError(
      "ol-duplicate-binder",
      source_span,
      { name, form },
      `the binder ${name} is used twice here. give each binder a different name.`,
    );
  },

  /**
   * `ol-too-many-inputs`: a fixed-arity call was given more inputs than it accepts
   * (`spec/error-model.md:98`). Same `{callable, expected, actual}` shape as
   * {@link runtimeDiag.notEnoughInputs} and the static checker's `checker-arity.ts` (issue #111)
   * so both stages agree on identity — `expected` is the callee's ceiling (its total parameter
   * count for a user procedure), not the floor {@link notEnoughInputs} reports.
   */
  tooManyInputs(
    source_span: SourceSpan,
    callable: string,
    expected: number,
    actual: number,
  ): Diagnostic {
    return runtimeError(
      "ol-too-many-inputs",
      source_span,
      { callable, expected, actual },
      `${callable} takes ${expected === 1 ? "one input" : `${expected} inputs`}, but got ${actual}.`,
    );
  },

  /**
   * `ol-no-output`: a procedure was called where a value is required, but the invocation reached
   * the end of its body (or `stop`) without ever executing `return`/`output`/`op`
   * (`spec/execution-model.md:346-349`, `spec/error-model.md:112`). Raised at the CALL site, not
   * inside the procedure's own body — the procedure itself ran to completion without error.
   */
  noOutput(source_span: SourceSpan, procedure: string): Diagnostic {
    return runtimeError(
      "ol-no-output",
      source_span,
      { procedure },
      `${procedure} doesn't report a value here — it never reaches return.`,
    );
  },

  /**
   * `ol-user-error`: `throw <value>` halted execution with a learner-facing message
   * (`spec/error-model.md:120`). `message` is the thrown word itself, or — when the thrown value
   * is not a word — its canonical printed form, exactly as `print` would show it.
   */
  userError(source_span: SourceSpan, message: string): Diagnostic {
    return runtimeError("ol-user-error", source_span, { message }, message);
  },

  /**
   * `ol-return-outside-proc`: `return`/`output`/`op` reached the top level with no enclosing
   * procedure to return from. Same `{keyword}` params shape as the parser's
   * `checker-control-flow.ts` semantic rule (issue #114) so both stages agree on identity — this
   * copy exists because `execute()` runs `parse()` only, not `check()`.
   */
  returnOutsideProc(
    source_span: SourceSpan,
    keyword: "return" | "output" | "op",
  ): Diagnostic {
    return runtimeError(
      "ol-return-outside-proc",
      source_span,
      { keyword },
      `${keyword} only reports a value from inside a procedure. put it between 'define' and 'end'.`,
    );
  },

  /**
   * `ol-stop-outside-proc`: `stop` reached the top level with no enclosing procedure to leave.
   * Same (empty) params shape as the parser's `checker-control-flow.ts` semantic rule (issue
   * #114) so both stages agree on identity — this copy exists because `execute()` runs `parse()`
   * only, not `check()`.
   */
  stopOutsideProc(source_span: SourceSpan): Diagnostic {
    return runtimeError(
      "ol-stop-outside-proc",
      source_span,
      {},
      "stop only leaves a procedure, so it belongs between 'define' and 'end'.",
    );
  },

  /**
   * `ol-limit`: a configurable safety limit was reached — here, the procedure-call recursion
   * depth (`spec/execution-model.md:551-557`, `spec/error-model.md:119`). Raised at the call site
   * that would have pushed one frame past `limit`, instead of letting the host's own call stack
   * overflow and expose a raw stack-trace crash. `params.limit` names which limit this is
   * (`"recursion-depth"`, matching the spec's example) and `params.value` is the configured
   * threshold, per `ol-limit`'s `{limit, optional value}` param shape.
   */
  recursionLimit(source_span: SourceSpan, value: number): Diagnostic {
    return runtimeError(
      "ol-limit",
      source_span,
      { limit: "recursion-depth", value },
      `this call is nested ${value} procedure calls deep, which is too deep — check for a recursive procedure that never stops calling itself.`,
    );
  },

  /**
   * `ol-limit`: the other configurable safety limit besides recursion depth — the instruction
   * execution budget (`spec/execution-model.md:551-557`, `spec/error-model.md:119`). Raised the
   * moment the running count of executed statements/loop passes would exceed `value`, so a
   * runaway `forever`/`while true [ ]` degrades to a friendly diagnostic instead of hanging the
   * host (issue #102: "`forever` is therefore safe only because it is cancellable and
   * budgeted."). `params.limit` is `"instruction-budget"` and `params.value` is the configured
   * threshold, matching `recursionLimit`'s `{limit, value}` shape above.
   */
  instructionLimit(source_span: SourceSpan, value: number): Diagnostic {
    return runtimeError(
      "ol-limit",
      source_span,
      { limit: "instruction-budget", value },
      `this program ran ${value} instructions without finishing, which is the configured safety limit — check for a loop that never ends, such as an unbounded 'forever' or 'while' whose condition never becomes false.`,
    );
  },

  /**
   * `ol-limit`: execution was cancelled from outside the program (`spec/execution-model.md:
   * 551-557` — "implementations must support cancellation"), e.g. a learner pressing Stop while
   * a program is still running. `params.limit` is `"cancelled"`; there is no numeric threshold,
   * so unlike `recursionLimit`/`instructionLimit` there is no `value` param.
   */
  cancelled(source_span: SourceSpan): Diagnostic {
    return runtimeError(
      "ol-limit",
      source_span,
      { limit: "cancelled" },
      "execution was cancelled before the program finished.",
    );
  },

  /**
   * `ol-no-value`: a `map`/`filter`/`reduce` body's last statement does not produce a value
   * (`spec/execution-model.md:225`, worked example `map num in :nums [ print :num ]`). Same
   * `{form}` params shape as the parser's `checker-control-flow.ts` semantic rule (issue #114) so
   * both stages agree on identity — this copy exists because `execute()` runs `parse()` only, not
   * `check()`.
   */
  noValue(
    source_span: SourceSpan,
    form: "map" | "filter" | "reduce",
  ): Diagnostic {
    return runtimeError(
      "ol-no-value",
      source_span,
      { form },
      `${form} needs the last instruction in its block to make a value.`,
    );
  },

  /**
   * `ol-return-in-comprehension`: `return`/`output`/`op`/`stop` reached inside a comprehension
   * body (`spec/execution-model.md:226-227`) — a comprehension reports its last expression, never
   * an explicit `return`/`stop`. Same `{keyword, form}` params shape as the parser's
   * `checker-control-flow.ts` semantic rule (issue #114) so both stages agree on identity — this
   * copy exists because `execute()` runs `parse()` only, not `check()`. Takes priority over
   * `ol-return-outside-proc`/`ol-stop-outside-proc` whenever the escape is lexically inside a
   * comprehension body, even when that comprehension is itself inside a procedure.
   */
  returnInComprehension(
    source_span: SourceSpan,
    keyword: "return" | "output" | "op" | "stop",
    form: "map" | "filter" | "reduce",
  ): Diagnostic {
    return runtimeError(
      "ol-return-in-comprehension",
      source_span,
      { keyword, form },
      `${keyword} doesn't belong in a ${form} — a ${form} reports its last expression instead.`,
    );
  },

  /**
   * `ol-type` for a worded `is`-predicate's/prefix `?`-predicate's wrong-typed operand
   * (`spec/execution-model.md:158-166`) — see {@link IsPredicateTypeErrorParams}.
   */
  isPredicateType(
    source_span: SourceSpan,
    params: IsPredicateTypeErrorParams,
  ): Diagnostic {
    return runtimeError(
      "ol-type",
      source_span,
      { ...params },
      `${params.operation} needs a ${params.expected}, but got a ${params.actual}.`,
    );
  },

  /**
   * `ol-unknown-type`: the runtime's own copy of the semantic checker's `unknownTypeRule`
   * (`packages/parser/src/checker-type-field.ts`, issue #112) for a type word in **type
   * position** — the worded `is a <type-word>` form's literal type word (grammar-checked, so at
   * runtime only an unknown name can occur, never `ol-type`) and the prefix `is_a? value type`
   * form's type argument once it is confirmed to be a word (`spec/execution-model.md:161-166`).
   * Same `{name}` params shape as the checker's rule so both stages agree on identity. The
   * registry's default stage for `ol-unknown-type` is `semantic`; raised here at
   * `stage: "runtime"` for the same reason as `ol-not-a-place`/`ol-return-outside-proc` above —
   * `execute()` runs `parse()` only, never `check()`, so there is no double-report.
   */
  unknownType(source_span: SourceSpan, name: string): Diagnostic {
    return runtimeError(
      "ol-unknown-type",
      source_span,
      { name },
      `i don't know a type called "${name}" — try number, word, list, or boolean.`,
    );
  },
} as const;
