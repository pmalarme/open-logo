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
 * (`spec/execution-model.md:764-765` — Core `for ... in` is list-only), `ol-range` for a
 * `for ... from ... to ... by 0` step (`spec/execution-model.md:763-764`), a destructuring
 * pattern/element length mismatch (`spec/execution-model.md:827-828`), and `ol-duplicate-binder`
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
 * (`spec/execution-model.md#execution-safety`), so unbounded recursion raises a friendly diagnostic instead
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
 * Issue #101 adds the Core list reporters' diagnostics: `ol-type` for a wrong-typed
 * `first`/`last`/`butfirst`/`butlast`/`count`/`fput`/`lput` argument, and `ol-range` for
 * `first`/`last`/`butfirst`/`butlast` given an empty word or list (`spec/error-model.md:100`).
 * Issue #208 adds `ol-bad-color` for a `set_color`/`set_background` (or `setcolor`/`setbg`)
 * argument that is not one of the three accepted color forms (`spec/error-model.md:122`).
 * Issue #209 adds a reuse of `ol-range` for a `set_width`/`setwidth` argument that is a number but
 * not positive and finite (`spec/commands.md`'s `set_width` entry) — the ordinary non-number case
 * reuses `requireNumber`'s existing `ol-type`, so no new type-error builder is needed here.
 * Issue #287 adds `random`'s two `ol-range` cases — `n` below the minimum of `1`, and `(random a
 * b)` with `a` greater than `b` — reusing `requireWholeNumber`'s existing `ol-type` for a
 * non-whole bound, checked first (`spec/commands.md`'s `random` entry).
 * Issue #190 adds the Data-profile derived list reporters' diagnostics
 * (`spec/data-structures.md:125-141`): a reuse of `ol-type` (via `listReporterType`) for
 * `reverse`/`pick`/`sort`'s non-list argument, `ol-range` (via the new `emptyList`) for `pick` on
 * an empty list — narrower than `emptyInput`'s "word or list" wording since `pick` is list-only —
 * and a reuse of `ol-type` (via `orderingType`) for `sort` given elements that are not mutually
 * orderable (a mix of numbers and words, or any other type), following the exact ordering rule
 * `<`/`>`/`<=`/`>=` already use (`spec/data-structures.md:141`).
 * Issue #323 adds the dedicated `ol-tan-undefined` for `tan` at a pole (`90` degrees plus any
 * multiple of `180`, where cosine is `0`) — spec PR #392 ratified a per-domain educational code
 * (mirroring `ol-neg-sqrt`) rather than widening `ol-div-zero`, since `tan`'s pole is a distinct
 * concept from an explicit `/`/`mod` by zero (see {@link TanUndefinedParams}). `sin`/`cos`/`pi`
 * raise no diagnostic of their own beyond the shared `ol-type` a non-number `sin`/`cos` operand
 * already gets from {@link ArithmeticTypeErrorParams}.
 * Mirrors the parser's `errors.ts` pattern: every finding is a stable code from the
 * `@openlogo/core` registry with structured `params` (the diagnostic identity) plus warm,
 * lowercase learner prose derived from them — prose is presentation only.
 */

import type {
  Diagnostic,
  OLTypeName,
  OLValue,
  SourceSpan,
} from "@openlogo/core";
import { builtInNameMessage } from "@openlogo/core";
import type { ComprehensionNode, ReturnNode } from "@openlogo/parser";
import { canonicalOfHeritageFormHead } from "@openlogo/parser";

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

/**
 * A small, self-contained learner-message rendering of a dict key for `ol-unknown-key`'s message
 * text (a number prints bare, a word is quoted so it reads as the key it is). Cannot reuse
 * `evaluate.ts`'s `printedForm`/`formatNumber` — `evaluate.ts` imports diagnostics *from* this
 * module, so the reverse import would be a cycle; the key is always a word or number by the time
 * a caller reaches here, so this only needs to cover those two shapes.
 */
function formatKeyForMessage(key: OLValue): string {
  return typeof key === "number" ? String(key) : `"${String(key)}"`;
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
 * (`spec/execution-model.md:875-877`).
 */
export interface OrderingTypeErrorParams {
  readonly expected: "number" | "word" | "number or word";
  readonly actual: string;
  readonly value: OLValue;
  readonly operation: string;
}

/**
 * Params for an `ol-type` raised while resolving a postfix place — a non-list/non-dict value
 * indexed with `[ … ]`/`.field`, a non-number list-index key, a non-word/non-number dict key, or
 * a non-word argument to `thing` (`spec/error-model.md:99` — list indexing with a non-number key
 * is `ol-type`, not `ol-range`; issue #322 extends the same postfix-resolution guard to dicts,
 * `spec/data-structures.md:183-203`).
 */
export interface PlaceTypeErrorParams {
  readonly expected:
    "list" | "number" | "word" | "dict" | "word or number" | "list or dict";
  readonly actual: string;
  readonly value: OLValue;
  readonly operation: string;
}

/** Params for an `ol-type` raised by `set_shape` given a word that names no recognized shape. */
export interface ShapeTypeErrorParams {
  readonly value: string;
  readonly operation: string;
}

/**
 * Params for an `ol-type` raised by `tell` or `ask` (Sprites profile,
 * `spec/turtles-and-sprites.md:176-177`) when its input is not a turtle, or is a list containing a
 * non-turtle value. `expected` is fixed to `"turtle"` (the concept both forms address), `actual`
 * names the offending value's type ({@link typeNameOf}), `value` snapshots it for the diagnostic,
 * and `operation` is the head keyword (`"tell"` or `"ask"`) so the message names the form the
 * learner wrote. Same `{expected, actual, value, operation}` shape every other `ol-type` builder
 * uses.
 */
export interface TellNotATurtleParams {
  readonly expected: "turtle";
  readonly actual: string;
  readonly value: OLValue;
  readonly operation: "tell" | "ask";
}

/** Params for an `ol-range` raised by an out-of-bounds 1-based list index. */
export interface IndexRangeParams {
  readonly index: OLValue;
  readonly length: number;
}

/**
 * Params for `ol-unknown-key` (`spec/error-model.md:126`): a required dictionary key is absent on
 * read, or an intermediate dictionary key is absent in a nested access chain
 * (`spec/data-structures.md:191,203`). Writing a missing *final* key upserts instead of raising
 * this. `key` is the offending key exactly as the learner wrote it (a word or number).
 */
export interface UnknownKeyParams {
  readonly key: OLValue;
}

/**
 * Params for an `ol-type` raised by a list-mutator statement (`add`/`remove`/`insert`/`clear`,
 * `spec/data-structures.md:73-93`, `spec/execution-model.md:814-849`) whose target is not a list,
 * or by `insert`'s position argument that is not a number. Issue #322 widens this for the dict
 * half of `clear` (target may be a list or dict) and for `remove key … from`, whose target must
 * be a dict specifically (`spec/data-structures.md:221-234`). Same `{expected, actual, value,
 * operation}` shape as the other `ol-type` param builders so every stage agrees on identity;
 * `operation` names the mutator verb for the message.
 */
export interface ListMutatorTypeErrorParams {
  readonly expected: "list" | "number" | "dict" | "list or dict";
  readonly actual: string;
  readonly value: OLValue;
  readonly operation: "add" | "remove" | "insert" | "clear" | "remove key";
}

/**
 * Params for an `ol-range` raised by `insert value in list at position` when the 1-based
 * `position` is a number but not a whole number in `1..length + 1`
 * (`spec/data-structures.md:81` — "inserts before the 1-based position"; a position of
 * `length + 1` appends). Sibling of {@link IndexRangeParams} but its own interface/builder because
 * `insert`'s valid ceiling is `length + 1`, not `length`, and its message names "insert position"
 * rather than "index". `index` is the offending position exactly as the learner wrote it.
 */
export interface InsertPositionRangeParams {
  readonly index: OLValue;
  readonly length: number;
}

/**
 * Params for `ol-not-boolean`: a `not`/`and`/`or` operand (or any other boolean-only condition)
 * was not `true`/`false` (`spec/error-model.md:123`). There is no truthiness — a number, word, or
 * list operand is never coerced, regardless of how "truthy" it might look.
 */
export interface NotBooleanErrorParams {
  readonly actual: string;
  readonly operation: string;
}

/**
 * Params for an `ol-type` raised when a value that must be a whole number is not one
 * (`spec/execution-model.md:756-758` fixes the TYPE-before-RANGE order for `repeat`, one of the
 * callers). `operation` names the primitive that raised it.
 */
export interface WholeNumberTypeErrorParams {
  readonly actual: string;
  readonly value: OLValue;
  readonly operation: string;
}

/** Params for an `ol-range` raised by a negative count; `operation` names the primitive. */
export interface NegativeCountParams {
  readonly operation: string;
  readonly value: number;
}

/**
 * Params for an `ol-range` raised by a `forward`/`back` distance that is not finite
 * (`Infinity`/`-Infinity`, reachable via arithmetic overflow — e.g. `power 10 1000` —
 * `spec/execution-model.md:884` — "OpenLogo never exposes NaN or Infinity as learner-facing
 * results"). Movement math (`x + d·sin h`) would otherwise silently corrupt the turtle's
 * position with a non-finite or `NaN` coordinate (`0 · Infinity` is `NaN` in IEEE 754) instead of
 * raising a diagnostic.
 */
export interface NonFiniteDistanceParams {
  readonly operation: "forward" | "back";
  /**
   * `Infinity`/`-Infinity`/`NaN` rendered as its `String(value)` spelling (e.g. `"Infinity"`).
   * `params` is a diagnostic-identity payload that MUST survive a JSON round-trip
   * (`spec/error-model.md:34` — "used for identity, repair, telemetry, and localization"), but
   * `JSON.stringify` silently turns a non-finite `number` into `null`; a string keeps the value
   * legible and stable across API and serialized consumers.
   */
  readonly value: string;
}

/**
 * Params for an `ol-range` raised by a `left`/`right` turn angle that is not finite. Sibling of
 * {@link NonFiniteDistanceParams} (same rationale, same `String(value)` JSON-safety reasoning) —
 * kept as a separate interface/builder rather than generalizing the two into one, so this slice
 * does not have to re-touch #200's already-reviewed `forward`/`back` diagnostic shape.
 */
export interface NonFiniteAngleParams {
  readonly operation: "left" | "right";
  readonly value: string;
}

/**
 * Params for an `ol-range` raised by a `set_heading` angle that is not finite. Sibling of
 * {@link NonFiniteAngleParams} (same `Infinity % 360 === NaN` rationale — `set_heading` normalizes
 * its argument to `[0,360)` the same way `left`/`right` do), kept as its own interface/builder
 * rather than widening `NonFiniteAngleParams.operation`'s union, so this slice does not have to
 * re-touch #201's already-reviewed `left`/`right` diagnostic shape.
 */
export interface NonFiniteHeadingParams {
  readonly operation: "set_heading" | "seth";
  readonly value: string;
}

/**
 * Params for an `ol-range` raised by a `set_xy` `x`/`y` argument that is not finite
 * (`Infinity`/`-Infinity`, reachable via arithmetic overflow). Unlike {@link NonFiniteDistanceParams}
 * (where a finite distance can still corrupt movement math via `0 · Infinity === NaN`), a
 * non-finite `set_xy` coordinate is set directly onto the turtle's position with no arithmetic in
 * between — but `spec/execution-model.md:884` ("OpenLogo never exposes NaN or Infinity as
 * learner-facing results") still forbids handing the turtle an infinite position outright, so the
 * guard is the same. `axis` names which argument was non-finite for the diagnostic's `params`.
 */
export interface NonFiniteCoordinateParams {
  readonly operation: "set_xy" | "setxy";
  readonly axis: "x" | "y";
  readonly value: string;
}

/**
 * Params for an `ol-type` raised by a `for ... in` iterable that is not a list
 * (`spec/execution-model.md:764-765` — Core `for ... in` is list-only; dict iteration is a later
 * profile).
 */
export interface ForInNotListParams {
  readonly actual: string;
  readonly value: OLValue;
}

/**
 * Params for an `ol-range` raised by a `for ... by 0` step
 * (`spec/execution-model.md:763-764` — a step of `0` never reaches `end`, so it is rejected
 * rather than silently looping forever).
 */
export interface ForStepZeroParams {
  readonly operation: "for";
  readonly value: 0;
}

/**
 * Params for an `ol-range` raised by a destructuring binder/element length mismatch
 * (`spec/execution-model.md:827-828` — "a short or long pattern mismatch raises `ol-range`"):
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
 * not a list (`spec/execution-model.md:785-789` — every comprehension form ranges over a list).
 * Same shape as {@link ForInNotListParams} plus the comprehension's own `form`, since `ol-type`'s
 * `operation` names the offending construct.
 */
export interface ComprehensionNotListParams {
  readonly actual: string;
  readonly value: OLValue;
  readonly operation: "map" | "filter" | "reduce";
}

/**
 * The three comprehension forms — the `form` param value the comprehension-scoped codes carry.
 * Read off {@link ComprehensionNode} rather than restated as a literal union, so the runtime's
 * `form` param cannot drift from the AST the parser hands it (the parser's own
 * `checker-control-flow.ts` derives its `ComprehensionForm` the same way).
 */
type ComprehensionForm = ComprehensionNode["form"];

/**
 * Every surface spelling a `return` can be written with — Core `return` plus the **Heritage**
 * spellings `output`/`op`, which the reader lowers onto the same {@link ReturnNode}. Read off the
 * AST node so it cannot drift from the grammar. Prose only: see {@link CanonicalEscapeKeyword}.
 */
type SurfaceReturnKeyword = ReturnNode["keyword"];

/**
 * Every surface spelling an escape can be written with — {@link SurfaceReturnKeyword} plus `stop`,
 * which has no Heritage spelling. Prose only: see {@link CanonicalEscapeKeyword}.
 */
type SurfaceEscapeKeyword = SurfaceReturnKeyword | "stop";

/**
 * The **canonical Core** control word an escape's `params.keyword` is reported under. Deliberately
 * narrower than {@link SurfaceEscapeKeyword}: the Heritage spellings are excluded *by type*, so a
 * params object that declares this type cannot be handed a surface spelling — reintroducing
 * `{ keyword: <the learner's word> }` stops compiling. That is the structural guard for these two
 * rules (issue #741), and it deliberately mirrors the parser's `checker-control-flow.ts` type of
 * the same name (issue #737), because the runtime keeps its own copies of both diagnostics.
 *
 * Its reach is exactly the params interfaces below, because `Diagnostic.params` is
 * `Readonly<Record<string, unknown>>` and cannot be typed per code: a NEW diagnostic site that
 * built its params inline would still compile. The complete guard for the class is therefore the
 * registry-driven `heritage-canonical-diagnostic-params.test.mjs` in this package, which executes
 * every Heritage spelling the parser knows and compares the emitted params against its Core twin's;
 * this type is what stops the two known sites from silently regressing.
 */
type CanonicalEscapeKeyword = "return" | "stop";

/**
 * The canonical Core control word for a `return` escape, resolved through the parser's Heritage
 * registry ({@link canonicalOfHeritageFormHead}) rather than a local literal: `output`/`op` resolve
 * to `return`, and `return` is already canonical. Reported as the literal `"return"` — the only
 * value this site can ever carry — so a params object that declares it cannot be handed anything
 * else.
 *
 * Diagnostic identity is `code` plus structured `params`, and the same condition MUST keep the same
 * params (`spec/error-model.md:256-261`). Heritage is "alternate spellings only, no new semantics"
 * (`spec/conformance.md#heritage`), so an executed `output 5` and an executed `return 5` at top
 * level are ONE condition and must carry one machine-readable identity — the surface spelling
 * belongs in the prose, never in the params. Shares the parser's registry precisely so the two
 * stages cannot answer "what Core spelling is this an alternate of" differently.
 */
function canonicalReturnKeyword(surface: SurfaceReturnKeyword): "return" {
  return surface === "return" ? "return" : canonicalOfHeritageFormHead(surface);
}

/**
 * The canonical Core control word for any escape — {@link canonicalReturnKeyword} widened to admit
 * `stop`, which is already canonical and has no Heritage spelling. Only the comprehension-scoped
 * code needs this: `stop` at the top level is the separate `ol-stop-outside-proc`
 * (`spec/error-model.md:118`), which carries no `keyword` at all.
 */
function canonicalEscapeKeyword(
  surface: SurfaceEscapeKeyword,
): CanonicalEscapeKeyword {
  return surface === "stop" ? "stop" : canonicalReturnKeyword(surface);
}

/**
 * Params for `ol-no-value`: a comprehension body's last statement does not produce a value
 * (`spec/execution-model.md:225` — the block-result rule). Same `{form}` shape as the parser's
 * `checker-control-flow.ts` semantic rule (issue #114) so both stages agree on identity.
 */
export interface NoValueParams {
  readonly form: ComprehensionForm;
}

/**
 * Params for `ol-return-outside-proc`: a `return`/`output`/`op` reached the top level with no
 * enclosing procedure to return from. Same `{keyword}` shape as the parser's
 * `checker-control-flow.ts` semantic rule (issue #114) so both stages agree on identity — and, since
 * issue #741, the same canonical *value* too: the surface spelling the learner wrote cannot reach
 * `params`.
 *
 * `keyword` is typed as the literal `"return"` rather than {@link CanonicalEscapeKeyword}, because
 * that is the only word this code can ever carry: a `stop` outside a procedure is the separate
 * `ol-stop-outside-proc` (`spec/error-model.md:118`). The parser's counterpart states the same
 * constraint in prose (`checker-control-flow.ts`: "here always `return`"); stating it in the type
 * leaves the guard no slack.
 */
export interface ReturnOutsideProcParams {
  readonly keyword: "return";
}

/**
 * Params for `ol-return-in-comprehension`: a `return`/`output`/`op`/`stop` reached inside a
 * comprehension body (`spec/execution-model.md:226-227`) — a comprehension reports its last
 * expression, never an explicit `return`/`stop`. Same `{keyword, form}` shape as the parser's
 * `checker-control-flow.ts` semantic rule (issue #114) so both stages agree on identity, with the
 * same canonical `keyword` rule as {@link ReturnOutsideProcParams} — widened to
 * {@link CanonicalEscapeKeyword} because this is the one `keyword`-carrying code a `stop` can also
 * raise. Declared independently rather than extending its sibling: the two are different codes that
 * happen to share a field, not a specialization, so neither should silently inherit the other's
 * future params. A `Stop` node has no `keyword` field of its own and reports the canonical
 * `"stop"`, matching the checker's own synthesis.
 */
export interface ReturnInComprehensionParams {
  readonly keyword: CanonicalEscapeKeyword;
  readonly form: ComprehensionForm;
}

/**
 * Params for an `ol-type` raised by a worded `is`-predicate's or a prefix `?`-predicate's operand
 * (`spec/execution-model.md:158-166`): `is empty`/`empty?` accepts a list, dict, or word
 * (`spec/commands.md:692`), `is member of`/`member?` accepts a list or dict as the collection
 * (`spec/commands.md:710`), and the prefix `is_a? value type` form's dynamically evaluated `type`
 * argument must itself be a word. Same shape as {@link OrderingTypeErrorParams}/
 * {@link PlaceTypeErrorParams} — `operation` names the offending predicate for the message.
 */
export interface IsPredicateTypeErrorParams {
  readonly expected: "list, dict, or word" | "list or dict" | "list" | "word";
  readonly actual: string;
  readonly value: OLValue;
  readonly operation: string;
}

/**
 * Params for an `ol-type` raised by a Core list reporter's wrong-typed argument
 * (`spec/commands.md` — `first`/`last`/`butfirst`/`butlast` accept a word or list; `count` accepts
 * a word, list, or dict (`spec/commands.md:1162`, issue #322); `fput`/`lput` require their second
 * argument to be a list; `word` requires every argument to be a word, issue #234) or a
 * Data-profile derived list reporter's wrong-typed argument (`spec/data-structures.md:125-141` —
 * `reverse`/`pick`/`sort` each require a `list`, issue #190). Same `{expected, actual, value,
 * operation}` shape as {@link IsPredicateTypeErrorParams}/{@link OrderingTypeErrorParams} —
 * `operation` names the offending reporter for the message.
 */
export interface ListReporterTypeErrorParams {
  readonly expected:
    "word or list" | "word, list, or dict" | "list" | "word" | "dict";
  readonly actual: string;
  readonly value: OLValue;
  readonly operation: string;
}

/**
 * Params for an `ol-range` raised by `first`/`last`/`butfirst`/`butlast` on an empty word or list
 * (`spec/error-model.md:100` — "an empty `first` or `last`"; `spec/commands.md` extends the same
 * rule to `butfirst`/`butlast`). `value` is the empty word/list itself, matching how
 * {@link NegativeCountParams} carries the offending `value` rather than just its type name.
 */
export interface EmptyInputRangeParams {
  readonly operation: "first" | "last" | "butfirst" | "butlast";
  readonly value: OLValue;
}

/**
 * Params for an `ol-range` raised by `pick` on an empty list (issue #190,
 * `spec/error-model.md`'s `ol-range` row: "`pick` from an empty list"). Sibling of
 * {@link EmptyInputRangeParams} but kept as its own interface/builder rather than widening that
 * one's `operation` union: `pick`'s sole input type is `list` (`spec/data-structures.md:127`),
 * unlike `first`/`last`/`butfirst`/`butlast`'s word-or-list, so the message names "list" rather
 * than "word or list".
 */
export interface EmptyListParams {
  readonly operation: "pick";
  readonly value: OLValue;
}

/**
 * Params for an `ol-bad-color` raised by `set_color`/`set_background` (and their `setcolor`/
 * `setbg` aliases, issue #208) when the argument is not one of the three accepted color forms
 * (`spec/error-model.md:122`, `spec/commands.md`'s "Colors" section). `value` is the offending
 * argument itself (matching {@link EmptyInputRangeParams}'s convention of carrying the offending
 * value rather than just its type name); `operation` names the invoked alias for identity, same
 * convention as {@link ListReporterTypeErrorParams}.
 */
export interface BadColorParams {
  readonly value: OLValue;
  readonly operation: "set_color" | "setcolor" | "set_background" | "setbg";
}

/**
 * Params for an `ol-range` raised by `set_width`/`setwidth` (issue #209) when the argument is a
 * number that is not a positive finite value — `spec/commands.md`'s `set_width` entry: "The width
 * MUST be a positive number." `0`/negative widths fail that requirement directly; `Infinity`
 * technically satisfies "positive" but would hand `@openlogo/turtle`'s reducer/renderer an
 * infinite stroke width for every subsequent `draw-segment` (`spec/execution-model.md:884` —
 * "OpenLogo never exposes NaN or Infinity as learner-facing results"), so it is folded into the
 * same `ol-range` guard rather than treated as valid. Only reached once {@link requireNumber} has
 * already confirmed the argument is a number at all (a non-number raises `ol-type` first, per
 * {@link executeTurtleWidthCall}). `value` is rendered as `String(value)` for the same JSON-safety
 * reason as {@link NonFiniteDistanceParams}.
 */
export interface NonPositiveWidthParams {
  readonly operation: "set_width" | "setwidth";
  readonly value: string;
}

/**
 * Params for an `ol-range` raised by `set_tempo` (issue #689) when its argument is a number but not
 * positive and finite (`spec/interaction-events.md:350` — "one positive number"; the default tempo
 * is `120`). Only reached once {@link requireNumber} has already confirmed the argument is a number
 * at all (a non-number raises `ol-type` first, mirroring {@link NonPositiveWidthParams}'s
 * `set_width` order). `value` is rendered as `String(value)` for the same JSON-safety reason as
 * {@link NonFiniteDistanceParams} — folding `Infinity` into the same guard as `0`/negative so a
 * learner never sees an infinite tempo.
 */
export interface NonPositiveTempoParams {
  readonly value: string;
}

/**
 * Params for an `ol-range` raised by `note`/`rest` (issue #690) when the duration argument is a
 * number but not positive and finite (`spec/interaction-events.md`'s `note`/`rest` entries:
 * "Duration MUST be positive and is interpreted in beats"). Only reached once
 * {@link requireNumber} has already confirmed the value is a number. `operation` is the command
 * name (`"note"` or `"rest"`), so the two share one `ol-range` builder while keeping distinct
 * diagnostic identities (`error-model.md` treats `params` as part of a diagnostic's identity).
 */
export interface NonPositiveDurationParams {
  readonly operation: "note" | "rest" | "play";
  readonly value: string;
}

/**
 * Params for an `ol-type` raised by `note` (issue #690) when the pitch argument is a word but not a
 * well-formed scientific-pitch-notation pitch (`packages/runtime/src/pitch.ts`'s
 * {@link import("./pitch.js").isValidPitch}). Mirrors {@link ShapeTypeErrorParams}: an unrecognized
 * pitch word is `ol-type` with `expected: "pitch"`, a diagnostic identity distinct from a non-word
 * argument's `expected: "word"`.
 */
export interface PitchTypeErrorParams {
  readonly value: string;
  readonly operation: string;
}

/**
 * Params for an `ol-range` raised by `play` (issue #691) when the melody list has an odd number of
 * elements. `play`'s list is pitch/duration pairs, so "The list length MUST be even"
 * (`spec/interaction-events.md`'s `play` entry). `length` is the offending element count.
 */
export interface OddMelodyLengthParams {
  readonly length: number;
}

/**
 * Params for an `ol-range` raised by `random n` (issue #287) when `n` is a whole number below the
 * minimum of `1` (`spec/commands.md`'s `random` entry: "`n` MUST be a whole number of at least
 * `1`"). Only reached once {@link requireWholeNumber} has already confirmed `n` is a whole number
 * — type is checked before range, per the same entry: "Inputs are checked in order: a non-whole
 * bound raises `ol-type`; then `n` below `1` … raises `ol-range`."
 */
export interface RandomBelowMinimumParams {
  readonly value: number;
}

/**
 * Params for an `ol-range` raised by `(random a b)` (issue #287) when `a` is greater than `b`
 * (`spec/commands.md`'s `random` entry: "`a` and `b` MUST be whole numbers with `a <= b`"). Only
 * reached once {@link requireWholeNumber} has already confirmed both bounds are whole numbers.
 */
export interface RandomRangeReversedParams {
  readonly low: number;
  readonly high: number;
}

/**
 * Params for the dedicated `ol-tan-undefined` raised by `tan` (issue #323) at a pole — `90`
 * degrees plus any multiple of `180`, where cosine is mathematically `0`. Spec PR #392 ratified a
 * per-domain educational code (`spec/error-model.md`'s registry row: `ol-tan-undefined | runtime |
 * value | ...`), mirroring `ol-neg-sqrt`'s single-field shape, rather than widening `ol-div-zero`
 * to a domain it was never scoped to (`/`/`mod` only).
 */
export interface TanUndefinedParams {
  readonly value: number;
}

/**
 * Params for an `ol-range` raised by `every`'s tick count (issue #683, slice I4) when it is a whole
 * number but not positive — zero or negative (`spec/interaction-events.md`'s `### every <n> <block>`:
 * "`n` MUST be a positive whole number: … a zero or negative count raises `ol-range`"). Only reached
 * once {@link requireWholeNumber} has already confirmed the value is a whole number — type is checked
 * before range, mirroring `random`/`repeat`. Carries the offending whole-number `value` for the
 * message, like {@link RandomBelowMinimumParams}.
 */
export interface EveryNonPositiveParams {
  readonly value: number;
}

/**
 * Params for the `ol-type` raised by `when` when its event argument is not a word
 * (`spec/interaction-events.md`'s `### when <event-word> <block>`: "Errors: `ol-type` if the event
 * is not a word", issue #682). `actual` is the argument's runtime type name
 * (`@openlogo/core`'s `typeNameOf`) so the diagnostic identity records what was supplied; `expected`
 * is fixed at `"word"`. Mirrors the `{ operation, expected, actual }` shape of the other Core/Data
 * `ol-type` param builders so every stage agrees on identity.
 */
export interface WhenEventNotWordParams {
  readonly actual: OLTypeName;
}

/**
 * Params for the `ol-type` raised by `on_key` when its key argument is not a word
 * (`spec/interaction-events.md`'s `### on_key <key-word> <block>`: "Errors: `ol-type`", issue #684).
 * `on_key` registers a block for a *named* key, so the name must be a word; a number, list, or
 * boolean cannot name a key. `actual` is the argument's runtime type name (`@openlogo/core`'s
 * `typeNameOf`) so the diagnostic identity records what was supplied; `expected` is the fixed
 * `"word"`. Mirrors {@link WhenEventNotWordParams} — the two event-registration heads validate their
 * word argument identically.
 */
export interface OnKeyKeyNotWordParams {
  readonly actual: OLTypeName;
}

/**
 * Params for the `ol-type` raised by `input` when its prompt is not a word
 * (`spec/interaction-events.md`'s `### input <prompt>`: "**Args:** one prompt, which MUST be a
 * `word`" and "**Errors:** `ol-type` if the prompt is not a `word`"). `actual` is the argument's
 * runtime type name (`@openlogo/core`'s `typeNameOf`) so the diagnostic identity records what was
 * supplied; `expected` is the fixed `"word"`. Mirrors {@link WhenEventNotWordParams} and
 * {@link OnKeyKeyNotWordParams} — the profile's three word-typed arguments validate identically.
 *
 * **This narrowed under the maintainer's ruling on issue #768.** #681 shipped a wider,
 * implementation-defined reading — the scalars `word`, `number`, and `boolean` — while the clause
 * still read "`ol-type` if the prompt cannot be displayed as learner text", and recorded here that a
 * *widening* ruling should relax it. The ruling went the other way: the prompt MUST be a `word`, so
 * `number` and `boolean` are rejected too, and `expected` moved from the one-off `"text"` to
 * `"word"`. The reason is that `word` — the reporter whose whole job is building text — already
 * refuses non-words (`print word "Question" 3` raises `ol-type` with `expected: "word"`), so
 * word-ness is the language's existing standard for "this argument must be text", and the
 * scalar/compound split #681 invented appears nowhere else in OpenLogo.
 *
 * The spec now states the rule outright, so this is a transcription of a normative clause rather
 * than a reading of one, and it **is** bound by conformance fixtures — see
 * `tests/conformance/interaction-events/input/`, whose `input-prompt-*` fixtures pin both halves of
 * the boundary (a numeric *word* prompt is still accepted; the number it prints as is not).
 */
export interface InputPromptNotWordParams {
  readonly actual: OLTypeName;
}

/**
 * Params for `ol-var-not-visible` (`spec/error-model.md:132`): the name whose read failed, and the
 * procedure whose sealed boundary is the reason it failed. `procedure` is what distinguishes this
 * code from `ol-undefined-var`, so it is part of the identity, not decoration — a message that did
 * not name the boundary would leave a learner staring at a variable that is plainly right there.
 */
export interface VariableNotVisibleParams {
  readonly name: string;
  readonly procedure: string;
}

/**
 * Params for `ol-global-outside-root` (`spec/error-model.md:131`): the declared name, in the source
 * spelling the declaration used. Identical in shape to the checker's rule of the same name
 * (`checker-global-placement.ts`) so the two stages report one identity for one defect.
 */
export interface GlobalOutsideRootParams {
  readonly name: string;
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

  /**
   * `tan` at a pole (issue #323): `90` degrees plus any multiple of `180`, where `tan θ = sin θ /
   * cos θ` is mathematically undefined. Raises the dedicated `ol-tan-undefined` (spec PR #392),
   * not `ol-div-zero` — the maintainer's ratified Path B, mirroring the per-domain precedent
   * `ol-neg-sqrt` sets for `sqrt` of a negative.
   */
  tanUndefined(source_span: SourceSpan, value: number): Diagnostic {
    return runtimeError(
      "ol-tan-undefined",
      source_span,
      { value },
      `tan has no answer at ${value} degrees — the cosine there is 0, so the tangent is undefined. try an angle other than 90 plus a multiple of 180.`,
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

  /**
   * `ol-type` for `tell` given a non-turtle input, or a list containing a non-turtle
   * (`spec/turtles-and-sprites.md:176-177`). Same `{expected, actual, value, operation}` shape and
   * message voice as {@link typeMismatch}, but its own builder so `expected` stays `"turtle"`.
   */
  tellNotATurtle(
    source_span: SourceSpan,
    params: TellNotATurtleParams,
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
   *
   * Variable resolution is case-insensitive (`lookupVar` folds the name to lowercase before
   * probing every frame), so `:SomeVar` and `:somevar` name the *same* absent binding — one
   * condition. The diagnostic's identity must reflect that single condition: `spec/error-model.md`
   * makes a diagnostic's identity its `code` **plus `params`**, and both the checker's
   * `ol-undefined-var` (issue #113) and this runtime guard must agree on it whatever the source
   * casing. The checker keys `params.name` on the *folded* name (the resolution identity); this
   * folds identically so the two stages report one name for one condition (issue #1005). The
   * learner message uses the same folded spelling so message and param never disagree.
   */
  undefinedVar(source_span: SourceSpan, name: string): Diagnostic {
    const resolvedName = name.toLowerCase();
    return runtimeError(
      "ol-undefined-var",
      source_span,
      { name: resolvedName },
      `:${resolvedName} has no value yet — try assigning it with :${resolvedName} = ... first.`,
    );
  },

  /**
   * `ol-var-not-visible`: a procedure body read a name that the root scope binds but the **sealed
   * procedure boundary** hides — not one of the procedure's parameters, not a binding its body has
   * already made, and not a `global` (`spec/execution-model.md:389-394`,
   * `spec/error-model.md:132`).
   *
   * `spec/error-model.md:132` makes two requirements of the prose that a generic "undefined
   * variable" message would not meet, and both are load-bearing for a learner who can see the name
   * right there at the top level: the message MUST **name the boundary** — `:{name} is not defined
   * inside {procedure}` — and the suggestion MUST **name the fix**, `global {name} = …`. That fix is
   * one word at the top level, and saying so is the whole point of giving this defect its own code
   * rather than folding it into `ol-undefined-var`.
   *
   * `name` is case-folded for the same reason {@link undefinedVar}'s is (resolution is
   * case-insensitive, so `:Count` and `:count` are one condition), while `procedure` carries the
   * **definition's declared spelling** — the identity every other procedure-naming diagnostic and
   * the `procedure-enter`/`exit` events already use, never the call site's spelling.
   *
   * Registry stage is `semantic` (the checker decides it lexically, issue #825), but raised here at
   * `stage: "runtime"` for the same reason as `ol-not-a-place`/`ol-repcount-outside-repeat`:
   * `execute()` never runs `check()`, so the runtime needs its own guard for the same defect and
   * must report it under the same code and params.
   *
   * The prose is **byte-identical** to the checker's `varNotVisibleMessage`
   * (`packages/parser/src/checker-undefined-var.ts`), which is where the reasoning behind each of
   * its three sentences is recorded, and which
   * `packages/runtime/src/checker-runtime-agreement.test.mjs` asserts. Change one and you must
   * change the other; the agreement test is what stops them drifting.
   */
  varNotVisible(
    source_span: SourceSpan,
    params: VariableNotVisibleParams,
  ): Diagnostic {
    const resolvedName = params.name.toLowerCase();
    return runtimeError(
      "ol-var-not-visible",
      source_span,
      { name: resolvedName, procedure: params.procedure },
      `:${resolvedName} is not defined inside ${params.procedure}. a procedure only sees its own inputs, the names it sets itself, and names declared global. the fix is one word at the top level: write global ${resolvedName} = (its starting value).`,
    );
  },

  /**
   * `ol-global-outside-root`: a `global name = value` declaration ran somewhere other than the root
   * scope — inside a procedure body, a control-form body, a handler block, or a comprehension body
   * (`spec/execution-model.md:561-563`, `spec/commands.md:143`). Registry stage is `semantic` and
   * `checker-global-placement.ts` decides it lexically; this is the runtime's own guard for the same
   * defect, at `stage: "runtime"` since `execute()` never runs `check()`, carrying the same `name`
   * param and the same prose so the two stages report one identity.
   */
  globalOutsideRoot(
    source_span: SourceSpan,
    params: GlobalOutsideRootParams,
  ): Diagnostic {
    return runtimeError(
      "ol-global-outside-root",
      source_span,
      { name: params.name },
      `global ${params.name} belongs at the top level of your program. to make a private name here, write local ${params.name} = ...`,
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

  /**
   * `ol-unknown-key`: a required dictionary key is absent on read, or an intermediate dictionary
   * key is absent in a nested access chain (`spec/error-model.md:126`,
   * `spec/data-structures.md:191,203`). Never raised for a missing *final* write key (that
   * upserts instead).
   */
  unknownKey(source_span: SourceSpan, params: UnknownKeyParams): Diagnostic {
    return runtimeError(
      "ol-unknown-key",
      source_span,
      { ...params },
      `this dict has no key ${formatKeyForMessage(params.key)}.`,
    );
  },

  /**
   * `ol-unknown-field`: a `:record.field` read or write named a field the record's struct type
   * does not declare (`spec/data-structures.md:266,309`, `spec/error-model.md:124`). Records have
   * a fixed field set and never grow new fields, so an unknown field is an error on both read and
   * write. Same `{ type, field }` params (plus `write: true` for a write) and message templates as
   * the parser's `resolveRecordField` (`checker-type-field.ts`, issue #112) so the static and
   * runtime halves agree on identity; raised here at `stage: "runtime"` because `execute()` runs
   * `parse()` only, never `check()`, and because a variable's struct type is generally only known
   * dynamically (issue #329).
   *
   * Field names are identifiers, so field access folds case (`spec/grammar.md:13`,
   * `values.ts`'s case-folded slot map): `.X`, `.x`, and `.x` all address one field, so a missing
   * `.Missing` and `.MISSING` name the *same* absent field — one condition. As with
   * `ol-undefined-var` (issue #1005), the diagnostic identity (`code` + `params`,
   * `spec/error-model.md:256-261`) must reflect that single condition, so `field` is folded to its
   * case-insensitive resolution identity here and in `resolveRecordField`, and the message uses the
   * same folded spelling so message and param never disagree. `type` is not folded: a record's
   * `type` is always the single declared struct-name spelling (`values.ts` stores the declared
   * form, never the constructor call's casing), so it is already canonical.
   */
  unknownField(
    source_span: SourceSpan,
    params: { type: string; field: string; write?: boolean },
  ): Diagnostic {
    const field = params.field.toLowerCase();
    const outParams: Record<string, unknown> = params.write
      ? { type: params.type, field, write: true }
      : { type: params.type, field };
    return runtimeError(
      "ol-unknown-field",
      source_span,
      outParams,
      params.write
        ? `${params.type} has no field ${field}, and records can't grow new fields.`
        : `${params.type} has no field ${field}. check the spelling.`,
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
   * `ol-type` for `type_of` given a non-record argument (issue #329). `type_of` reports a
   * record's struct type name, so its sole input must be a record
   * (`spec/data-structures.md:286`); any other value is a type error. A dedicated builder because
   * {@link PlaceTypeErrorParams}'s `expected` union does not include `"record"`. Same
   * `{ operation, expected, actual }` shape and message voice as the other Core/Data `ol-type`
   * builders so the diagnostics read uniformly.
   */
  typeOfType(source_span: SourceSpan, actual: string): Diagnostic {
    return runtimeError(
      "ol-type",
      source_span,
      { operation: "type_of", expected: "record", actual },
      `type_of needs a record, but got a ${actual}.`,
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
   * `ol-type` for a list-mutator statement's non-list target or `insert`'s non-number position
   * (issue #188, `spec/data-structures.md:73-93`) — see {@link ListMutatorTypeErrorParams}.
   */
  listMutatorType(
    source_span: SourceSpan,
    params: ListMutatorTypeErrorParams,
  ): Diagnostic {
    return runtimeError(
      "ol-type",
      source_span,
      { ...params },
      `${params.operation} needs a ${params.expected}, but got a ${params.actual}.`,
    );
  },

  /**
   * `ol-range` for `insert`'s out-of-range 1-based position (issue #188) — see
   * {@link InsertPositionRangeParams}. Valid positions are `1..length + 1`; a position of
   * `length + 1` appends.
   */
  insertPositionRange(
    source_span: SourceSpan,
    params: InsertPositionRangeParams,
  ): Diagnostic {
    return runtimeError(
      "ol-range",
      source_span,
      { operation: "insert", index: params.index, length: params.length },
      `insert position ${String(params.index)} is out of range for a list of ${params.length}.`,
    );
  },

  /**
   * `ol-not-boolean`: a `not`/`and`/`or` operand was not `true`/`false`. There is no truthiness
   * (`spec/error-model.md:123`) — a number, word, or list operand never coerces.
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
   * `ol-type`: a value that must be a whole number is not one. Raised only through
   * {@link requireWholeNumber}, whose `operation` argument names the primitive, so this diagnostic
   * is not scoped to any one caller — `spec/execution-model.md:756-758` fixes the TYPE-before-RANGE
   * order for `repeat`, one of those callers. `expected` is fixed to `"whole number"` (rather than
   * the generic `"number"` {@link typeMismatch} uses) so the message names the concept precisely.
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
   * `ol-range`: a count is a whole number but negative (`spec/execution-model.md:756-758` fixes the
   * TYPE-before-RANGE order for `repeat`, one of the two callers; `spec/error-model.md:101` lists
   * "a negative whole-number `repeat` count" as one instance of `ol-range`). `operation` names the
   * primitive that raised it. Only reached once
   * {@link requireWholeNumber} has already confirmed the value is a whole number.
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
   * `ol-range`: a `forward`/`back` distance is `Infinity`/`-Infinity` (reachable via arithmetic
   * overflow, e.g. `forward power 10 1000` — `spec/execution-model.md:884`). Only reached once
   * {@link requireNumber} has already confirmed the value is a number; a finite `distance` never
   * reaches this check.
   */
  nonFiniteDistance(
    source_span: SourceSpan,
    params: NonFiniteDistanceParams,
  ): Diagnostic {
    return runtimeError(
      "ol-range",
      source_span,
      { ...params },
      `${params.operation} needs a finite distance, but got ${params.value}.`,
    );
  },

  /**
   * `ol-range`: a `left`/`right` turn angle is `Infinity`/`-Infinity` (reachable via arithmetic
   * overflow, e.g. `right power 10 1000` — `spec/execution-model.md:884`, same rationale as
   * {@link nonFiniteDistance}: `Infinity % 360` is `NaN`, which would otherwise corrupt the
   * turtle's heading instead of raising a diagnostic). Only reached once {@link requireNumber} has
   * already confirmed the value is a number; a finite `angle` never reaches this check.
   */
  nonFiniteAngle(
    source_span: SourceSpan,
    params: NonFiniteAngleParams,
  ): Diagnostic {
    return runtimeError(
      "ol-range",
      source_span,
      { ...params },
      `${params.operation} needs a finite angle, but got ${params.value}.`,
    );
  },

  /**
   * `ol-range`: a `set_heading` angle is `Infinity`/`-Infinity` (reachable via arithmetic
   * overflow, e.g. `set_heading power 10 1000` — `spec/execution-model.md:884`, same rationale as
   * {@link nonFiniteAngle}: `Infinity % 360` is `NaN`, which would otherwise corrupt the turtle's
   * heading instead of raising a diagnostic). Only reached once {@link requireNumber} has already
   * confirmed the value is a number; a finite `angle` never reaches this check.
   */
  nonFiniteHeading(
    source_span: SourceSpan,
    params: NonFiniteHeadingParams,
  ): Diagnostic {
    return runtimeError(
      "ol-range",
      source_span,
      { ...params },
      `${params.operation} needs a finite angle, but got ${params.value}.`,
    );
  },

  /**
   * `ol-range`: a `set_xy` `x`/`y` argument is `Infinity`/`-Infinity` (reachable via arithmetic
   * overflow, e.g. `set_xy power 10 1000 0`). Unlike {@link nonFiniteDistance}, no arithmetic
   * turns this into `NaN` — the coordinate is set directly — but `spec/execution-model.md:884`
   * still forbids an infinite learner-facing position. Only reached once {@link requireNumber}
   * has already confirmed the value is a number; a finite coordinate never reaches this check.
   */
  nonFiniteCoordinate(
    source_span: SourceSpan,
    params: NonFiniteCoordinateParams,
  ): Diagnostic {
    return runtimeError(
      "ol-range",
      source_span,
      { ...params },
      `${params.operation} needs a finite ${params.axis}, but got ${params.value}.`,
    );
  },

  /**
   * `ol-repcount-outside-repeat`: `repcount` was used outside any enclosing `repeat`
   * (`spec/commands.md:813`). Registry stage is `semantic`, but raised here at `stage: "runtime"`
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
   * (`spec/execution-model.md:764-765`); dict iteration is a later, profile-specific form.
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
   * (`spec/execution-model.md:785-789` — every comprehension form ranges over a list, same
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
   * (`spec/execution-model.md:763-764`), unlike a step merely pointing away from `end` (which
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
   * (`spec/execution-model.md:827-828`). `params.value` is the element's actual length (`0` for a
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
   * `ol-reserved-word`: a declaration slot — `define`/`to` or `struct` — names something OpenLogo
   * itself owns (`spec/error-model.md:125`). This is the runtime half of the phase-1 registration
   * guard `spec/execution-model.md:82-89` requires, raised at `stage: "runtime"` (the registry
   * default is `semantic`) because `execute()` runs `parse()` only, never `check()`, so there is
   * no double-report.
   *
   * `params` is `{ name }` and nothing else, matching the parser's `checker-reserved-word.ts`
   * exactly so both stages agree on identity (issue #839). The `namespace` param this constructor
   * used to carry is **gone** (issue #833 rule 5): `"reserved"`/`"primitive"` collapsed into this
   * one meaning — *OpenLogo owns this name* — while `"procedure"`/`"struct"` moved to
   * {@link runtimeDiag.duplicateDefinition}. The message is the single learner-facing sentence
   * `spec/error-model.md:125` prescribes, and the words *keyword*, *primitive* and *alias* MUST NOT
   * appear in it.
   *
   * **The sentence is imported from `@openlogo/core`, not written here** (issue #1025). Identity
   * agreement with the parser was already enforced by conformance; the *wording* agreement was
   * enforced by nothing, and this constructor is the one that shipped it wrong twice — #751 and
   * #871 both read `<name> is already a reserved primitive, so it can't be redefined here.`,
   * leaking the word the spec forbids. See `diagnostic-messages.ts` for why the sentence is owned
   * there.
   */
  reservedWord(source_span: SourceSpan, name: string): Diagnostic {
    return runtimeError(
      "ol-reserved-word",
      source_span,
      { name },
      builtInNameMessage(name),
    );
  },

  /**
   * `ol-duplicate-definition`: a declaration slot names something an **earlier declaration in the
   * same program** already registered — a procedure defined twice, a struct declared twice, or a
   * procedure and a struct in either order (`spec/error-model.md:126`, `spec/execution-model.md:86-88`,
   * which makes it an error that "MUST NOT be a silent override").
   *
   * `source_span` points at the later declaration and `params.original_span` at the earlier one:
   * both spans are diagnostic *identity*, not message decoration, so `spec/error-model.md:145-148`
   * requires supplying `original_span` rather than folding the earlier location into the prose.
   * Same code, params and spans as the parser's `checker-reserved-word.ts` (issue #839) — only
   * `stage` differs, `"runtime"` here for the same reason {@link runtimeDiag.reservedWord} gives.
   */
  duplicateDefinition(
    source_span: SourceSpan,
    name: string,
    original_span: SourceSpan,
  ): Diagnostic {
    return runtimeError(
      "ol-duplicate-definition",
      source_span,
      { name, original_span },
      `you already defined ${name} on line ${original_span.start[0]}.`,
    );
  },

  /**
   * `ol-no-output`: a procedure was called where a value is required, but the invocation reached
   * the end of its body (or `stop`) without ever executing `return`/`output`/`op`
   * (`spec/execution-model.md:711-728`, `spec/error-model.md:114`). Raised at the CALL site, not
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
   *
   * `keyword` is the spelling the learner wrote; `params.keyword` is the **canonical** Core word it
   * is an alternate spelling of, resolved by {@link canonicalReturnKeyword} through the parser's own
   * Heritage registry. That is what keeps "both stages agree on identity" true: the parser
   * canonicalized this param in issue #737, so until issue #741 canonicalized this copy too the
   * same `output 5` carried `keyword: "return"` when checked and `keyword: "output"` when executed —
   * one condition with two machine-readable identities, which `spec/error-model.md:256-261`
   * forbids. The prose message still echoes the learner's own word; that is the localization
   * boundary and is permitted.
   */
  returnOutsideProc(
    source_span: SourceSpan,
    keyword: SurfaceReturnKeyword,
  ): Diagnostic {
    const params: ReturnOutsideProcParams = {
      keyword: canonicalReturnKeyword(keyword),
    };
    return runtimeError(
      "ol-return-outside-proc",
      source_span,
      { ...params },
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
   * depth (`spec/execution-model.md#execution-safety`, `spec/error-model.md:119`). Raised either at the call
   * site that would have pushed one frame past `limit`, or — issue #726 — when nesting deep enough
   * to overflow the host's own call stack is caught at the `execute()` boundary (a smaller host
   * stack, or expression/parse nesting the depth counter does not itself bound), instead of letting
   * a raw stack-trace crash escape. `params.limit` names which limit this is (`"recursion-depth"`,
   * matching the spec's example) and `params.value` is the enforced threshold, per `ol-limit`'s
   * `{limit, optional value}` param shape. The message speaks of "nesting" rather than counting a
   * precise number of procedure calls, so it reads correctly for the parse/expression-overflow case
   * too, where no procedure frames were involved.
   */
  recursionLimit(source_span: SourceSpan, value: number): Diagnostic {
    return runtimeError(
      "ol-limit",
      source_span,
      { limit: "recursion-depth", value },
      `this is nested too deep (the procedure-recursion limit is ${value}) — check for a recursive procedure that never stops calling itself, or an expression nested far too deeply.`,
    );
  },

  /**
   * `ol-limit`: the other configurable safety limit besides recursion depth — the instruction
   * execution budget (`spec/execution-model.md#execution-safety`, `spec/error-model.md:119`). Raised the
   * moment the running count of executed instructions would exceed `value`, so a
   * runaway `forever`/`while true [ ]` degrades to a friendly diagnostic instead of hanging the
   * host (issue #102: "`forever` is therefore safe only because it is cancellable and
   * budgeted."). An instruction is a statement, a loop pass, a handler firing (issue #828) or — since
   * issue #953 — one tick of a `wait` pause, which is why the message names a long `wait` beside a
   * runaway loop: both are unbounded by construction and both land here.
   * `params.limit` is `"instruction-budget"` and `params.value` is the configured
   * threshold, matching `recursionLimit`'s `{limit, value}` shape above.
   */
  instructionLimit(source_span: SourceSpan, value: number): Diagnostic {
    return runtimeError(
      "ol-limit",
      source_span,
      { limit: "instruction-budget", value },
      `this program ran ${value} instructions without finishing, which is the configured safety limit — check for a loop that never ends, such as an unbounded 'forever' or 'while' whose condition never becomes false, or a 'wait' for a very large number of ticks.`,
    );
  },

  /**
   * `ol-limit`: execution was cancelled from outside the program
   * (`spec/execution-model.md#execution-safety` — "implementations must support cancellation"),
   * e.g. a learner pressing Stop while
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
  noValue(source_span: SourceSpan, form: ComprehensionForm): Diagnostic {
    const params: NoValueParams = { form };
    return runtimeError(
      "ol-no-value",
      source_span,
      { ...params },
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
   *
   * `keyword` is the learner's own spelling and `params.keyword` its canonical Core word, on
   * exactly the terms {@link runtimeDiag.returnOutsideProc} documents above (issue #741). A `stop`
   * is already canonical and has no Heritage spelling, so it reports `"stop"`.
   */
  returnInComprehension(
    source_span: SourceSpan,
    keyword: SurfaceEscapeKeyword,
    form: ComprehensionForm,
  ): Diagnostic {
    const params: ReturnInComprehensionParams = {
      keyword: canonicalEscapeKeyword(keyword),
      form,
    };
    return runtimeError(
      "ol-return-in-comprehension",
      source_span,
      { ...params },
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

  /**
   * `ol-type` for a Core list reporter's wrong-typed argument (issue #101) — see
   * {@link ListReporterTypeErrorParams}.
   */
  listReporterType(
    source_span: SourceSpan,
    params: ListReporterTypeErrorParams,
  ): Diagnostic {
    return runtimeError(
      "ol-type",
      source_span,
      { ...params },
      `${params.operation} needs a ${params.expected}, but got a ${params.actual}.`,
    );
  },

  /**
   * `ol-range` for `first`/`last`/`butfirst`/`butlast` given an empty word or list (issue #101) —
   * see {@link EmptyInputRangeParams}.
   */
  emptyInput(
    source_span: SourceSpan,
    params: EmptyInputRangeParams,
  ): Diagnostic {
    return runtimeError(
      "ol-range",
      source_span,
      { ...params },
      `${params.operation} needs a non-empty word or list, but got an empty one.`,
    );
  },

  /**
   * `ol-range` for `pick` given an empty list (issue #190) — see {@link EmptyListParams}.
   */
  emptyList(source_span: SourceSpan, params: EmptyListParams): Diagnostic {
    return runtimeError(
      "ol-range",
      source_span,
      { ...params },
      `${params.operation} needs a non-empty list, but got an empty one.`,
    );
  },

  /**
   * `ol-bad-color` (issue #208) — `set_color`/`set_background`'s argument is not one of the three
   * accepted color forms (`spec/error-model.md:122`): an unknown color word, an `[r g b]` list of
   * the wrong length or with an out-of-range component, or a malformed hex word. See
   * {@link BadColorParams}.
   */
  badColor(source_span: SourceSpan, params: BadColorParams): Diagnostic {
    return runtimeError(
      "ol-bad-color",
      source_span,
      { ...params },
      `${params.operation} needs a color word, an [r g b] list, or a "#rrggbb" hex word, but got ${params.value}.`,
    );
  },

  /**
   * `ol-range` (issue #209) — `set_width`/`setwidth`'s argument is a number but not positive and
   * finite (`spec/commands.md`'s `set_width` entry: "The width MUST be a positive number."). See
   * {@link NonPositiveWidthParams}.
   */
  nonPositiveWidth(
    source_span: SourceSpan,
    params: NonPositiveWidthParams,
  ): Diagnostic {
    return runtimeError(
      "ol-range",
      source_span,
      { ...params },
      `${params.operation} needs a positive width, but got ${params.value}.`,
    );
  },

  /**
   * `ol-range` (issue #689) — `set_tempo`'s argument is a number but not positive and finite
   * (`spec/interaction-events.md:350`: "one positive number"). Only reached once
   * {@link requireNumber} has already confirmed the value is a number. See
   * {@link NonPositiveTempoParams}.
   */
  nonPositiveTempo(
    source_span: SourceSpan,
    params: NonPositiveTempoParams,
  ): Diagnostic {
    return runtimeError(
      "ol-range",
      source_span,
      { operation: "set_tempo", ...params },
      `set_tempo needs a positive tempo, but got ${params.value}.`,
    );
  },

  /**
   * `ol-range` (issue #690) — `note`/`rest`'s duration argument is a number but not positive and
   * finite (`spec/interaction-events.md`'s `note`/`rest` entries: "Duration MUST be positive and is
   * interpreted in beats"). Folds `Infinity` into the same guard as `0`/negative, exactly as
   * {@link nonPositiveTempo} and {@link nonPositiveWidth} do. Only reached once
   * {@link requireNumber} has already confirmed the value is a number. See
   * {@link NonPositiveDurationParams}.
   */
  nonPositiveDuration(
    source_span: SourceSpan,
    params: NonPositiveDurationParams,
  ): Diagnostic {
    return runtimeError(
      "ol-range",
      source_span,
      { ...params },
      `${params.operation} needs a positive duration, but got ${params.value}.`,
    );
  },

  /**
   * `ol-type` (issue #690) — `note`'s pitch argument is a word, but not a well-formed
   * scientific-pitch-notation pitch (`packages/runtime/src/pitch.ts`'s
   * {@link import("./pitch.js").isValidPitch}). `spec/interaction-events.md`'s `note` entry lists
   * `ol-type` for a bad pitch; like {@link unknownShape}, this stays `ol-type` with
   * `expected: "pitch"`, a diagnostic identity distinct from a non-word argument's
   * `expected: "word"`. See {@link PitchTypeErrorParams}.
   */
  invalidPitch(
    source_span: SourceSpan,
    params: PitchTypeErrorParams,
  ): Diagnostic {
    return runtimeError(
      "ol-type",
      source_span,
      {
        expected: "pitch",
        actual: "word",
        value: params.value,
        operation: params.operation,
      },
      `i don't understand the pitch "${params.value}". try scientific pitch notation like "c4", "fs4" (f sharp), or "bb3" (b flat).`,
    );
  },

  /**
   * `ol-range` (issue #691) — `play`'s melody list has an odd number of elements. The list is
   * pitch/duration pairs, so "The list length MUST be even" (`spec/interaction-events.md`'s `play`
   * entry lists `ol-range`). `spec/error-model.md:100` requires `operation` plus `index` **or**
   * `value` for `ol-range` (`length` is only optional), so `value` carries the offending odd count
   * and `length` repeats it for a descriptive name. Kept distinct from a non-list argument's
   * `ol-type` (`expected: "list"`) and from a step's non-positive `duration`
   * ({@link nonPositiveDuration}). See {@link OddMelodyLengthParams}.
   */
  oddMelodyLength(
    source_span: SourceSpan,
    params: OddMelodyLengthParams,
  ): Diagnostic {
    return runtimeError(
      "ol-range",
      source_span,
      { operation: "play", value: params.length, length: params.length },
      `play needs a melody of pitch/duration pairs, so the list length must be even, but got ${String(params.length)}.`,
    );
  },

  /**
   * `ol-type` (issue #210) — `set_shape`'s argument is a word, but names no recognized shape
   * (`packages/runtime/src/shape.ts`'s `isRecognizedShape`). `spec/commands.md`'s `set_shape`
   * entry defines no dedicated code ("Possible errors: none specified in C3 beyond general type
   * and arity diagnostics") because the shape set is open/implementation-defined
   * (`spec/rendering.md`'s "Turtle avatar and shapes" section), unlike `set_color`'s closed
   * palette — so this stays `ol-type` with `expected: "shape"`, a diagnostic identity distinct
   * from a non-word argument's `expected: "word"` (`error-model.md` treats `params` as part of a
   * diagnostic's identity). See {@link ShapeTypeErrorParams}.
   */
  unknownShape(
    source_span: SourceSpan,
    params: ShapeTypeErrorParams,
  ): Diagnostic {
    return runtimeError(
      "ol-type",
      source_span,
      {
        expected: "shape",
        actual: "word",
        value: params.value,
        operation: params.operation,
      },
      `i don't know the shape "${params.value}". try a shape like "turtle", "triangle", "arrow", or "circle".`,
    );
  },

  /**
   * `ol-range` (issue #287) — `random n`'s argument is a whole number but below the minimum of
   * `1` (`spec/commands.md`'s `random` entry). Only reached once {@link requireWholeNumber} has
   * already confirmed the value is a whole number. See {@link RandomBelowMinimumParams}.
   */
  randomBelowMinimum(
    source_span: SourceSpan,
    params: RandomBelowMinimumParams,
  ): Diagnostic {
    return runtimeError(
      "ol-range",
      source_span,
      { operation: "random", ...params },
      `random needs a whole number of 1 or greater, but got ${params.value}.`,
    );
  },

  /**
   * `ol-range` (issue #287) — `(random a b)`'s bounds are both whole numbers, but `a` is greater
   * than `b` (`spec/commands.md`'s `random` entry: "`a` and `b` MUST be whole numbers with
   * `a <= b`"). Only reached once {@link requireWholeNumber} has already confirmed both bounds are
   * whole numbers. See {@link RandomRangeReversedParams}.
   */
  randomRangeReversed(
    source_span: SourceSpan,
    params: RandomRangeReversedParams,
  ): Diagnostic {
    return runtimeError(
      "ol-range",
      source_span,
      { operation: "random", ...params },
      `random needs its first number to be no greater than its second, but got random ${params.low} ${params.high}.`,
    );
  },

  /**
   * `ol-type` (issue #682) — `when`'s event argument is not a word
   * (`spec/interaction-events.md`'s `### when <event-word> <block>`: "Errors: `ol-type` if the
   * event is not a word", and the profile's error table). `when` registers a block for a *named*
   * event, so the name must be a word; a number, list, or boolean cannot name an event. Carries the
   * `{ operation: "when", expected: "word", actual }` identity shape shared by the other `ol-type`
   * builders. See {@link WhenEventNotWordParams}.
   */
  whenEventNotWord(
    source_span: SourceSpan,
    params: WhenEventNotWordParams,
  ): Diagnostic {
    return runtimeError(
      "ol-type",
      source_span,
      { operation: "when", expected: "word", actual: params.actual },
      `when needs an event word, but got a ${params.actual}.`,
    );
  },

  /**
   * `ol-type` (issue #684, slice I5) — `on_key`'s key argument is not a word
   * (`spec/interaction-events.md`'s `### on_key <key-word> <block>`: "Errors: `ol-type`", and the
   * profile's error table). `on_key` registers a block for a *named* key (`"space"`, `"enter"`,
   * `"a"`, …), so the name must be a word; a number, list, or boolean cannot name a key. Carries the
   * `{ operation: "on_key", expected: "word", actual }` identity shape shared by the other `ol-type`
   * builders (identical in shape to {@link whenEventNotWord}). See {@link OnKeyKeyNotWordParams}.
   */
  onKeyKeyNotWord(
    source_span: SourceSpan,
    params: OnKeyKeyNotWordParams,
  ): Diagnostic {
    return runtimeError(
      "ol-type",
      source_span,
      { operation: "on_key", expected: "word", actual: params.actual },
      `on_key needs a key word, but got a ${params.actual}.`,
    );
  },

  /**
   * `ol-range` (issue #683, slice I4) — `every`'s tick count is a whole number but not positive
   * (`spec/interaction-events.md`'s `### every <n> <block>`: "`n` MUST be a positive whole number: …
   * a zero or negative count raises `ol-range`", and the profile's error table). Only reached once
   * {@link requireWholeNumber} has already confirmed the value is a whole number — TYPE is checked
   * before RANGE, mirroring `random`/`repeat`. Carries the `{ operation: "every", value }` identity
   * shape shared by the other `ol-range` count builders. See {@link EveryNonPositiveParams}.
   */
  everyNonPositive(
    source_span: SourceSpan,
    params: EveryNonPositiveParams,
  ): Diagnostic {
    return runtimeError(
      "ol-range",
      source_span,
      { operation: "every", ...params },
      `every needs a positive whole number of ticks, but got ${params.value}.`,
    );
  },

  /**
   * `ol-type` (issue #681, slice I2; narrowed by the #768 ruling) — `input`'s prompt is not a word
   * (`spec/interaction-events.md`'s `### input <prompt>`: "**Errors:** `ol-type` if the prompt is
   * not a `word`", and the profile's error table). `input` displays the prompt for a person to read
   * and answer, so the prompt is text, and OpenLogo already spells "must be text" as "must be a
   * `word`" — this is the same `{ operation, expected: "word", actual }` identity the `word`
   * reporter and the profile's own {@link whenEventNotWord}/{@link onKeyKeyNotWord} report. See
   * {@link InputPromptNotWordParams} for why `number` and `boolean` are rejected too.
   */
  inputPromptNotWord(
    source_span: SourceSpan,
    params: InputPromptNotWordParams,
  ): Diagnostic {
    return runtimeError(
      "ol-type",
      source_span,
      { operation: "input", expected: "word", actual: params.actual },
      `input needs a prompt word, but got a ${params.actual}.`,
    );
  },
} as const;
