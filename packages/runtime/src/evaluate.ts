/**
 * The expression evaluator: `.logo` AST expression nodes → runtime {@link OLValue}s. Issue #93
 * gives every Core literal a value and implements arithmetic (`+ - * / mod`) plus the Core math
 * builtins (`abs sqrt int round power`) from
 * [`spec/execution-model.md`](../../../spec/execution-model.md) and
 * [`spec/commands.md`](../../../spec/commands.md). {@link evaluate} is a plain recursive
 * dispatch over {@link ExpressionNode.kind} so the evaluator slices that follow (#94-#105 —
 * variables, comparisons, `is`-predicates, lists, comprehensions, …) each add one more `case`
 * without restructuring this function. Issue #94 adds the {@link Environment} binding model,
 * `:name` reads (`VarRef`/`thing`), assignment (`executeAssign`), and Core-scope postfix list-
 * index places (`Place` with `index` segments only — `.field` is Data-profile and deferred).
 *
 * `-3` is a negative *literal* (the reader already folds the sign into `NumberLitNode.value`,
 * per `spec/grammar.md:17,226`), never unary minus, so there is no negation case here — only
 * the binary `-` Call.
 *
 * Every operator/builtin does its own operand type-checking (`ol-type`) rather than sharing a
 * generic dispatcher, since each has its own arity and error semantics (e.g. only `sqrt` raises
 * `ol-neg-sqrt`, only `/`/`mod` raise `ol-div-zero`).
 *
 * Issue #104 adds {@link requireWholeNumber} (shared by `repeat`'s count validation in
 * `index.ts`) and the `repcount` reporter (`spec/commands.md:775-792`): a 0-arg call that reports
 * the nearest-enclosing `repeat`'s current 1-based turn, or raises `ol-repcount-outside-repeat`
 * when there is none. The active turn stack lives on {@link Environment} (`repeatTurns`, nearest
 * loop last) so nested `repeat`s and the statements they run both see the same mutable stack that
 * `index.ts`'s `executeStatements` pushes/pops around each pass.
 */

import type {
  Diagnostic,
  OLValue,
  SourceSpan,
  TraceEvent,
} from "@openlogo/core";
import { typeNameOf } from "@openlogo/core";
import type {
  AssignNode,
  CallNode,
  ComparisonChainNode,
  ExpressionNode,
  ParenCallNode,
  PlaceNode,
  ProcedureDefNode,
  SelectorSegment,
} from "@openlogo/parser";
import { runtimeDiag } from "./errors.js";

/** The outcome of evaluating one expression: a value, or the diagnostic that stopped it. */
export type EvalResult =
  | { readonly ok: true; readonly value: OLValue }
  | { readonly ok: false; readonly diagnostic: Diagnostic };

function ok(value: OLValue): EvalResult {
  return { ok: true, value };
}

function fail(diagnostic: Diagnostic): EvalResult {
  return { ok: false, diagnostic };
}

// --- Environment: the variable binding model (spec/execution-model.md:316-327) --------------
//
// A frame is one lexical scope's name→value table. `Environment.frames` is nearest-first, and
// the last frame is always the root/global frame — the top-level program runs directly in it.
// Issue #94 only ever has the root frame; procedure call frames (issue #97) push additional
// entries onto the front of `frames` without otherwise changing this shape.

/** One lexical scope: a mutable name→value binding table. */
export type Frame = Map<string, OLValue>;

/**
 * The whole-program name→definition table issue #97's `execute-internal.ts` builds once, up
 * front, by scanning every {@link ProcedureDefNode} in the program (mirroring the static
 * checker's `collectProcedureArities`/`collectVisibleNames`) — so a procedure may be called
 * before its textual `define` (`spec/execution-model.md:328-333`). Keyed by the callee's
 * lowercased name, matching every other case-insensitive command-name lookup in this package.
 */
export type ProcedureRegistry = ReadonlyMap<string, ProcedureDefNode>;

/**
 * The evaluator's binding model: a nearest-first stack of frames, root last, plus the active
 * `repeat` turn stack `repcount` reads (issue #104). `repeatTurns` is a mutable array — nearest
 * (innermost) enclosing `repeat` last — that `index.ts`'s `executeStatements` pushes the current
 * 1-based turn onto before running a `repeat` pass and pops after; the array reference itself
 * never changes, so it is threaded unchanged through every recursive `executeStatements`/
 * `evaluate` call the same way `frames` is.
 *
 * Issue #97 adds the whole-program {@link ProcedureRegistry} (`procedures`), the shared,
 * mutable trace-event sink (`events`) every emitting site now pushes onto directly instead of
 * threading a separate `events` parameter, the whole-program `forever` iteration test cap
 * (`foreverIterationLimit`, also promoted from a separate parameter for the same reason), and
 * `callProcedure` — a callback into `execute-internal.ts`'s procedure-call mechanics that lets
 * `evaluateCall` (expression/reporter position, e.g. `print area :r`) invoke a user procedure
 * without this module importing `execute-internal.ts` (which already imports this one, so a
 * direct import here would be a cycle). Statement-position calls (`star 5 100`) instead call
 * `execute-internal.ts`'s `runProcedure` directly — same module, no indirection needed.
 */
export interface Environment {
  readonly frames: readonly Frame[];
  readonly repeatTurns: number[];
  readonly procedures: ProcedureRegistry;
  readonly events: TraceEvent[];
  readonly foreverIterationLimit?: number;
  readonly callProcedure: (
    node: CallNode | ParenCallNode,
    env: Environment,
  ) => EvalResult;
}

/** The empty registry shared by every environment that has no user procedures to call. */
const EMPTY_PROCEDURES: ProcedureRegistry = new Map();

/**
 * A fresh environment holding just the root/global frame, no active `repeat` turn, and no user
 * procedures. Used directly by expression-only tests; `execute-internal.ts` builds its own
 * environment (`createExecutionEnvironment`) with a real `procedures` registry and a working
 * `callProcedure` wired to `runProcedure` instead of this stub, which throws if ever reached —
 * safe, since `procedures` is empty here, so `evaluateCall` never takes the branch that calls it.
 */
export function createEnvironment(): Environment {
  return {
    frames: [new Map()],
    repeatTurns: [],
    procedures: EMPTY_PROCEDURES,
    events: [],
    callProcedure: () => {
      throw new Error(
        "callProcedure is unreachable on a bare createEnvironment() — it has no procedures",
      );
    },
  };
}

/** Look up `name` nearest frame to root; `undefined` when no frame binds it. */
function lookupVar(env: Environment, name: string): OLValue | undefined {
  for (const frame of env.frames) {
    const value = frame.get(name);
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}

/**
 * `:name = value` / `set name to value`: mutate the nearest existing binding, or create one in
 * the root (last) frame when no frame binds `name` yet (`spec/execution-model.md:322-324`).
 * Assignment to an unbound name never fails — it always creates a global. `createEnvironment` is
 * the only way to build an {@link Environment} and always seeds at least the root frame, so the
 * cast below (rather than a defensive throw no caller could ever trigger) is safe.
 */
function assignVar(env: Environment, name: string, value: OLValue): void {
  for (const frame of env.frames) {
    if (frame.has(name)) {
      frame.set(name, value);
      return;
    }
  }
  const root = env.frames[env.frames.length - 1] as Frame;
  root.set(name, value);
}

/**
 * Fetch a `Call`'s argument by position. The parser's fixed-arity table
 * (`packages/parser/src/signatures.ts`) already guarantees every operator/builtin dispatched to
 * below has this many arguments, so a missing one signals a parser/evaluator arity mismatch —
 * an internal bug, not a learner-facing runtime diagnostic.
 */
/**
 * A command invocation the arithmetic evaluator can dispatch on: the plain infix `Call` form
 * (`1 + 2`) and the explicit-parentheses `ParenCall` form used when nesting a multi-arg command
 * inside another call's argument (`sqrt (power 2 3)`) — both share the same callee/args shape.
 */
type ArithmeticCallNode = CallNode | ParenCallNode;

function arg(node: ArithmeticCallNode, index: number): ExpressionNode {
  const value = node.args[index];
  if (value === undefined) {
    throw new Error(
      `evaluate: "${node.callee.name}" called with no argument at position ${index}`,
    );
  }
  return value;
}

/** Per spec/execution-model.md:33: a word that reads as a full number literal coerces. */
const NUMERIC_WORD = /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/;

function asNumber(value: OLValue): number | undefined {
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "string" && NUMERIC_WORD.test(value)) {
    return Number(value);
  }
  return undefined;
}

/**
 * The outcome of coercing an {@link OLValue} to a number (exported: `index.ts`'s `Repeat`
 * handling calls {@link requireWholeNumber}, whose result carries this shape).
 */
export type NumberOrDiagnostic =
  | { readonly ok: true; readonly value: number }
  | { readonly ok: false; readonly diagnostic: Diagnostic };

/**
 * Require `value` to be a number (with word-that-reads-as-a-number coercion), or `ol-type`.
 * Exported so `execute-internal.ts`'s `ForRange` handling (issue #103) can reuse it for `from`/
 * `to`/`by`, which — unlike `repeat`'s count — are not restricted to whole numbers
 * (`spec/execution-model.md:370-375`).
 */
export function requireNumber(
  value: OLValue,
  source_span: SourceSpan,
  operation: string,
): NumberOrDiagnostic {
  const numeric = asNumber(value);
  if (numeric === undefined) {
    return {
      ok: false,
      diagnostic: runtimeDiag.typeMismatch(source_span, {
        expected: "number",
        actual: typeNameOf(value),
        value,
        operation,
      }),
    };
  }
  return { ok: true, value: numeric };
}

/**
 * Require `value` to be a whole number (with the same word-that-reads-as-a-number coercion as
 * {@link requireNumber}), or `ol-type` — the TYPE half of `repeat`'s count validation
 * (`spec/execution-model.md:367-369`), checked before the RANGE (negative) half its caller
 * performs separately. Exported so `index.ts`'s `Repeat` statement handling can reuse it without
 * duplicating the word-coercion logic.
 */
export function requireWholeNumber(
  value: OLValue,
  source_span: SourceSpan,
  operation: string,
): NumberOrDiagnostic {
  const numeric = asNumber(value);
  if (numeric === undefined || !Number.isInteger(numeric)) {
    return {
      ok: false,
      diagnostic: runtimeDiag.notWholeNumber(source_span, {
        actual: typeNameOf(value),
        value,
        operation,
      }),
    };
  }
  return { ok: true, value: numeric };
}

const BINARY_ARITHMETIC_OPERATORS = ["+", "-", "*", "/", "mod"] as const;
type BinaryArithmeticOperator = (typeof BINARY_ARITHMETIC_OPERATORS)[number];

const UNARY_MATH_BUILTINS = ["abs", "sqrt", "int", "round"] as const;
type UnaryMathBuiltin = (typeof UNARY_MATH_BUILTINS)[number];

const BINARY_MATH_BUILTINS = ["power"] as const;
type BinaryMathBuiltin = (typeof BINARY_MATH_BUILTINS)[number];

/** The comparison operators `spec/execution-model.md:136` places at precedence level 5. */
const COMPARISON_OPERATORS = ["==", "!=", "<", ">", "<=", ">="] as const;
type ComparisonOperator = (typeof COMPARISON_OPERATORS)[number];

/** Ordering operators: a strict subset of {@link COMPARISON_OPERATORS} that need orderable operands. */
type OrderingOperator = "<" | ">" | "<=" | ">=";

/**
 * `and`/`or` at precedence levels 6/7 (`spec/execution-model.md:137-138`): left-associative and
 * short-circuit. The parser lowers both the infix form (`a and b`, nested binary `Call`s for
 * three or more operands) and the parenthesized variadic form (`(and a b c)`, one `ParenCall`
 * with every operand as an arg) to the same callee/args shape, so {@link evaluateLogical} just
 * walks `node.args` left to right — that loop is correct for both a 2-arg binary call and an
 * n-arg variadic one.
 */
const LOGICAL_OPERATORS = ["and", "or"] as const;
type LogicalOperator = (typeof LOGICAL_OPERATORS)[number];

function isBinaryArithmeticOperator(
  name: string,
): name is BinaryArithmeticOperator {
  return (BINARY_ARITHMETIC_OPERATORS as readonly string[]).includes(name);
}

function isUnaryMathBuiltin(name: string): name is UnaryMathBuiltin {
  return (UNARY_MATH_BUILTINS as readonly string[]).includes(name);
}

function isBinaryMathBuiltin(name: string): name is BinaryMathBuiltin {
  return (BINARY_MATH_BUILTINS as readonly string[]).includes(name);
}

function isComparisonOperator(name: string): name is ComparisonOperator {
  return (COMPARISON_OPERATORS as readonly string[]).includes(name);
}

function isLogicalOperator(name: string): name is LogicalOperator {
  return (LOGICAL_OPERATORS as readonly string[]).includes(name);
}

/**
 * Does {@link evaluate} give `node` a value in this issue's scope? `execute()` uses this guard
 * to decide whether to evaluate a `print` argument at all: expression kinds and callees this
 * issue does not implement yet (`is`-predicates, comprehensions, a dotted `.field` place segment
 * — Data-profile, deferred — and calls to any command other than the arithmetic operators, math
 * builtins, comparison operators, and `thing` below) are left untouched for their own future
 * slice (#94-#105), never reaching {@link evaluate}'s internal "not implemented yet" invariant
 * checks. As of issue #96 a {@link ComparisonChainNode} and the six comparison-operator calls
 * (`== != < > <= >=`) are in scope, so a comparison whose operands are all themselves supported
 * is evaluated. As of issue #94 a `VarRef` (`:name`) is always supported, and a `Place` (`:l[i]`)
 * is supported only when every postfix segment is an `index` selector with a supported key —
 * `.field` segments stay unsupported since record/dict places are a later profile. As of issue
 * #95 `and`/`or`/`not` calls are in scope; note this is a *shape* check only — a short-circuited
 * operand such as `:missing` in `false and :missing` is still a supported `VarRef`, it is simply
 * never reached by {@link evaluate}'s short-circuit at runtime. As of issue #104 a 0-arg
 * `repcount` call is in scope too. As of issue #97 a call whose callee is a name in `procedures`
 * (a user procedure, in either the bare or parenthesized call form) is in scope as well — pass
 * the calling environment's `procedures` registry (defaults to none, for callers with no user
 * procedures in scope).
 */
export function isSupportedExpression(
  node: ExpressionNode,
  procedures: ProcedureRegistry = EMPTY_PROCEDURES,
): boolean {
  switch (node.kind) {
    case "NumberLit":
    case "WordLit":
    case "BooleanLit":
    case "VarRef":
      return true;
    case "ListLit":
      return node.elements.every((element) =>
        isSupportedExpression(element, procedures),
      );
    case "ComparisonChain":
      return node.operands.every((operand) =>
        isSupportedExpression(operand, procedures),
      );
    case "Place":
      return isSupportedPlace(node, procedures);
    case "Call":
    case "ParenCall": {
      const name = node.callee.name.toLowerCase();
      const isKnownCallee =
        isBinaryArithmeticOperator(name) ||
        isUnaryMathBuiltin(name) ||
        isBinaryMathBuiltin(name) ||
        isComparisonOperator(name) ||
        isLogicalOperator(name) ||
        name === "not" ||
        name === "thing" ||
        name === "repcount" ||
        procedures.has(name);
      return (
        isKnownCallee &&
        node.args.every((arg) => isSupportedExpression(arg, procedures))
      );
    }
    default:
      return false;
  }
}

/**
 * Is every postfix segment of `place` a Core-scope `index` selector (`:l[i]`) with a supported
 * key expression? A dotted `.field` segment is Data/record-profile and deferred, so a place
 * carrying one is unsupported regardless of its other segments. Vacuously `true` for a
 * zero-segment place (a bare `:name` grown into a place only in assignment-target position).
 */
function isSupportedPlace(
  place: PlaceNode,
  procedures: ProcedureRegistry = EMPTY_PROCEDURES,
): boolean {
  return place.segments.every(
    (segment) =>
      segment.kind === "index" &&
      isSupportedExpression(segment.key, procedures),
  );
}

/** Evaluate one Core expression node to a runtime {@link OLValue}. */
export function evaluate(
  node: ExpressionNode,
  env: Environment = createEnvironment(),
): EvalResult {
  switch (node.kind) {
    case "NumberLit":
    case "WordLit":
    case "BooleanLit":
      return ok(node.value);
    case "ListLit": {
      const values: OLValue[] = [];
      for (const element of node.elements) {
        const result = evaluate(element, env);
        if (!result.ok) {
          return result;
        }
        values.push(result.value);
      }
      return ok(values);
    }
    case "VarRef": {
      const value = lookupVar(env, node.name);
      if (value === undefined) {
        return fail(runtimeDiag.undefinedVar(node.source_span, node.name));
      }
      return ok(value);
    }
    case "Place":
      return readPlace(node, env);
    case "Call":
    case "ParenCall":
      return evaluateCall(node, env);
    case "ComparisonChain":
      return evaluateComparisonChain(node, env);
    default:
      // IsPredicate and Comprehension evaluation land with their own slices (#94-#105); nothing
      // in this issue's scope reaches them.
      throw new Error(
        `evaluate: "${node.kind}" is not implemented yet — it lands with its own evaluator slice`,
      );
  }
}

/**
 * Resolve a {@link PlaceNode} read (`:l[i]`, `:m[1][2]`): look up the base variable, then walk
 * every postfix segment against the value so far. Only `index` segments are in this issue's
 * scope (`isSupportedExpression` keeps a `.field`-bearing place from reaching evaluation from
 * `print`/`execute()`); a segment kind this issue does not implement is an internal invariant
 * violation, mirroring {@link evaluate}'s own "not implemented yet" checks.
 */
function readPlace(node: PlaceNode, env: Environment): EvalResult {
  const base = lookupVar(env, node.base.name);
  if (base === undefined) {
    return fail(
      runtimeDiag.undefinedVar(node.base.source_span, node.base.name),
    );
  }

  let current: OLValue = base;
  for (const segment of node.segments) {
    if (segment.kind !== "index") {
      throw new Error(
        `evaluate: place segment kind "${segment.kind}" is not implemented yet — it lands with its own evaluator slice`,
      );
    }
    const step = resolveIndexSegment(current, segment, env);
    if (!step.ok) {
      return step;
    }
    current = step.list[step.index] as OLValue;
  }
  return ok(current);
}

/** The outcome of resolving one `index` postfix segment against its container value. */
type IndexResolution =
  | {
      readonly ok: true;
      readonly list: readonly OLValue[];
      readonly index: number;
    }
  | { readonly ok: false; readonly diagnostic: Diagnostic };

/**
 * Evaluate `segment.key` and validate it against `container`: the container must be a list
 * (`ol-type`, `expected: "list"`), the key must read as a number (`ol-type`,
 * `expected: "number"` — `spec/error-model.md:99` calls this `ol-type`, not `ol-range`), and the
 * (1-based) key must be a whole number within `1..container.length` (`ol-range` otherwise).
 * Returns the container (as a list) and the equivalent 0-based JS index so callers can either
 * read or mutate the element in place.
 */
function resolveIndexSegment(
  container: OLValue,
  segment: SelectorSegment,
  env: Environment,
): IndexResolution {
  const keyResult = evaluate(segment.key, env);
  if (!keyResult.ok) {
    return keyResult;
  }
  if (!Array.isArray(container)) {
    return {
      ok: false,
      diagnostic: runtimeDiag.placeType(segment.source_span, {
        expected: "list",
        actual: typeNameOf(container),
        value: container,
        operation: "index",
      }),
    };
  }
  const key = keyResult.value;
  const numericKey = asNumber(key);
  if (numericKey === undefined) {
    return {
      ok: false,
      diagnostic: runtimeDiag.placeType(segment.source_span, {
        expected: "number",
        actual: typeNameOf(key),
        value: key,
        operation: "index",
      }),
    };
  }
  if (
    !Number.isInteger(numericKey) ||
    numericKey < 1 ||
    numericKey > container.length
  ) {
    return {
      ok: false,
      diagnostic: runtimeDiag.indexRange(segment.source_span, {
        index: key,
        length: container.length,
      }),
    };
  }
  return { ok: true, list: container, index: numericKey - 1 };
}

/**
 * `thing "name"` — the reporter form of a variable read; `:name` is sugar for this
 * (`spec/execution-model.md:326-327`). The argument must evaluate to a word (`ol-type`
 * otherwise); an unbound name raises `ol-undefined-var`, same as a `:name` read.
 */
function evaluateThing(node: ArithmeticCallNode, env: Environment): EvalResult {
  const argNode = arg(node, 0);
  const argResult = evaluate(argNode, env);
  if (!argResult.ok) {
    return argResult;
  }
  if (typeof argResult.value !== "string") {
    return fail(
      runtimeDiag.placeType(argNode.source_span, {
        expected: "word",
        actual: typeNameOf(argResult.value),
        value: argResult.value,
        operation: "thing",
      }),
    );
  }
  const value = lookupVar(env, argResult.value);
  if (value === undefined) {
    return fail(runtimeDiag.undefinedVar(argNode.source_span, argResult.value));
  }
  return ok(value);
}

/**
 * `repcount` (`spec/commands.md:775-792`): reports the nearest-enclosing `repeat`'s current
 * 1-based turn — the top of {@link Environment.repeatTurns}, since `index.ts`'s `Repeat` handling
 * pushes each pass's turn before running the body and pops it after, so nested `repeat`s naturally
 * stack and the innermost one is always last. `ol-repcount-outside-repeat` when the stack is empty
 * (no enclosing `repeat`) — registry stage `semantic`, but raised here at `stage: "runtime"` since
 * `execute()` never runs `check()` (same convention as `ol-not-a-place`/`ol-undefined-var`).
 */
function evaluateRepcount(
  node: ArithmeticCallNode,
  env: Environment,
): EvalResult {
  if (env.repeatTurns.length === 0) {
    return fail(runtimeDiag.repcountOutsideRepeat(node.source_span));
  }
  return ok(env.repeatTurns[env.repeatTurns.length - 1] as number);
}

/**
 * The target of `=`/`set … to` must be a supported place, per {@link isSupportedPlace}; anything
 * else (a `.field` segment) is Data-profile and left un-executed rather than raised as an error,
 * matching the existing convention for a statement kind this issue does not yet give meaning to.
 */
export type AssignResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly diagnostic: Diagnostic };

/**
 * Execute one `Assign` statement (`:place = value`, `set place to value`): the runtime's own
 * `ol-not-a-place` guard for a reporter/command call used as a target (issue #113's checker
 * catches this too, at `stage: "semantic"`, but `execute()` never runs `check()`), then either
 * `assignVar` for a bare place or {@link writeIndexedPlace} for a postfix (`:l[i] = v`) one. A
 * `.field`-bearing place — or a `.field`-bearing (or otherwise unsupported) value expression, e.g.
 * `:x = :ages.tom` — is silently left un-executed (Data-profile, deferred): neither the place nor
 * the value is evaluated, matching `print`'s "unsupported operand" convention.
 */
export function executeAssign(
  node: AssignNode,
  env: Environment,
): AssignResult {
  if (node.place.kind === "Call" || node.place.kind === "ParenCall") {
    return {
      ok: false,
      diagnostic: runtimeDiag.notAPlace(
        node.place.source_span,
        node.place.callee.name,
      ),
    };
  }
  if (node.place.kind !== "Place") {
    // The grammar only ever builds an Assign target as a Place or a Call/ParenCall
    // (`spec/grammar.md:244-258`); anything else is an internal invariant violation.
    throw new Error(
      `executeAssign: assignment target kind "${node.place.kind}" is not a place`,
    );
  }
  const place = node.place;
  if (
    !isSupportedPlace(place, env.procedures) ||
    !isSupportedExpression(node.value, env.procedures)
  ) {
    return { ok: true };
  }

  const valueResult = evaluate(node.value, env);
  if (!valueResult.ok) {
    return { ok: false, diagnostic: valueResult.diagnostic };
  }

  if (place.segments.length === 0) {
    assignVar(env, place.base.name, valueResult.value);
    return { ok: true };
  }
  return writeIndexedPlace(place, valueResult.value, env);
}

/**
 * Write through a non-empty postfix place (`:l[i] = v`, `:m[1][2] = v`): the base variable must
 * already exist (`ol-undefined-var` otherwise — unlike bare assignment, indexed assignment never
 * creates a base), every intermediate segment resolves against the existing value with no
 * auto-vivification (`ol-range`/`ol-type` per {@link resolveIndexSegment}), and only the final
 * segment's slot is mutated in place — so an aliased reference to the same list observes the
 * write (`spec/execution-model.md:276-287`). The caller ({@link executeAssign}) only reaches
 * here after `isSupportedPlace` has confirmed every segment is `index`-kind, so the cast below
 * is safe without a redundant runtime re-check.
 */
function writeIndexedPlace(
  place: PlaceNode,
  value: OLValue,
  env: Environment,
): AssignResult {
  const base = lookupVar(env, place.base.name);
  if (base === undefined) {
    return {
      ok: false,
      diagnostic: runtimeDiag.undefinedVar(
        place.base.source_span,
        place.base.name,
      ),
    };
  }

  const segments = place.segments as readonly SelectorSegment[];
  let container: OLValue = base;
  for (let i = 0; i < segments.length - 1; i++) {
    const step = resolveIndexSegment(
      container,
      segments[i] as SelectorSegment,
      env,
    );
    if (!step.ok) {
      return step;
    }
    container = step.list[step.index] as OLValue;
  }

  const lastSegment = segments[segments.length - 1] as SelectorSegment;
  const step = resolveIndexSegment(container, lastSegment, env);
  if (!step.ok) {
    return step;
  }
  (step.list as OLValue[])[step.index] = value;
  return { ok: true };
}

function evaluateCall(node: ArithmeticCallNode, env: Environment): EvalResult {
  const name = node.callee.name.toLowerCase();
  if (isBinaryArithmeticOperator(name)) {
    return evaluateBinaryArithmetic(node, name, env);
  }
  if (isUnaryMathBuiltin(name)) {
    return evaluateUnaryMath(node, name, env);
  }
  if (isBinaryMathBuiltin(name)) {
    return evaluateBinaryMath(node, name, env);
  }
  if (isComparisonOperator(name)) {
    return evaluateComparisonCall(node, name, env);
  }
  if (isLogicalOperator(name)) {
    return evaluateLogical(node, name, env);
  }
  if (name === "not") {
    return evaluateNot(node, env);
  }
  if (name === "thing") {
    return evaluateThing(node, env);
  }
  if (name === "repcount") {
    return evaluateRepcount(node, env);
  }
  if (env.procedures.has(name)) {
    return env.callProcedure(node, env);
  }
  throw new Error(
    `evaluate: call to "${name}" is not implemented yet — it lands with its own evaluator slice`,
  );
}

function evaluateBinaryArithmetic(
  node: ArithmeticCallNode,
  operator: BinaryArithmeticOperator,
  env: Environment,
): EvalResult {
  const leftNode = arg(node, 0);
  const rightNode = arg(node, 1);

  const leftResult = evaluate(leftNode, env);
  if (!leftResult.ok) {
    return leftResult;
  }
  const rightResult = evaluate(rightNode, env);
  if (!rightResult.ok) {
    return rightResult;
  }

  const left = requireNumber(leftResult.value, leftNode.source_span, operator);
  if (!left.ok) {
    return fail(left.diagnostic);
  }
  const right = requireNumber(
    rightResult.value,
    rightNode.source_span,
    operator,
  );
  if (!right.ok) {
    return fail(right.diagnostic);
  }

  switch (operator) {
    case "+":
      return ok(left.value + right.value);
    case "-":
      return ok(left.value - right.value);
    case "*":
      return ok(left.value * right.value);
    case "/":
      if (right.value === 0) {
        return fail(runtimeDiag.divZero(node.source_span, "/"));
      }
      return ok(left.value / right.value);
    case "mod":
      if (right.value === 0) {
        return fail(runtimeDiag.divZero(node.source_span, "mod"));
      }
      return ok(left.value % right.value);
  }
}

function evaluateUnaryMath(
  node: ArithmeticCallNode,
  builtin: UnaryMathBuiltin,
  env: Environment,
): EvalResult {
  const argNode = arg(node, 0);
  const argResult = evaluate(argNode, env);
  if (!argResult.ok) {
    return argResult;
  }
  const operand = requireNumber(argResult.value, argNode.source_span, builtin);
  if (!operand.ok) {
    return fail(operand.diagnostic);
  }

  switch (builtin) {
    case "abs":
      return ok(Math.abs(operand.value));
    case "sqrt":
      if (operand.value < 0) {
        return fail(runtimeDiag.negSqrt(node.source_span, operand.value));
      }
      return ok(Math.sqrt(operand.value));
    case "int":
      return ok(Math.trunc(operand.value));
    case "round":
      return ok(Math.round(operand.value));
  }
}

function evaluateBinaryMath(
  node: ArithmeticCallNode,
  builtin: BinaryMathBuiltin,
  env: Environment,
): EvalResult {
  const baseNode = arg(node, 0);
  const exponentNode = arg(node, 1);

  const baseResult = evaluate(baseNode, env);
  if (!baseResult.ok) {
    return baseResult;
  }
  const exponentResult = evaluate(exponentNode, env);
  if (!exponentResult.ok) {
    return exponentResult;
  }

  const base = requireNumber(baseResult.value, baseNode.source_span, builtin);
  if (!base.ok) {
    return fail(base.diagnostic);
  }
  const exponent = requireNumber(
    exponentResult.value,
    exponentNode.source_span,
    builtin,
  );
  if (!exponent.ok) {
    return fail(exponent.diagnostic);
  }

  switch (builtin) {
    case "power":
      return ok(base.value ** exponent.value);
  }
}

// --- Logic: `not` (level 2), `and`/`or` (levels 6/7), no truthiness -------------------------
//
// spec/execution-model.md:133,137-144. There is no truthiness (spec/error-model.md:121): every
// operand of `not`/`and`/`or` must itself be a boolean, or the operation raises `ol-not-boolean`
// rather than coercing a number/word/list.

type BooleanOrDiagnostic =
  | { readonly ok: true; readonly value: boolean }
  | { readonly ok: false; readonly diagnostic: Diagnostic };

/** Require `value` to be a boolean, or `ol-not-boolean` — there is no truthiness. */
function requireBoolean(
  value: OLValue,
  source_span: SourceSpan,
  operation: string,
): BooleanOrDiagnostic {
  if (typeof value !== "boolean") {
    return {
      ok: false,
      diagnostic: runtimeDiag.notBoolean(source_span, {
        actual: typeNameOf(value),
        operation,
      }),
    };
  }
  return { ok: true, value };
}

/**
 * `not operand` — the boolean-only prefix operator (`spec/execution-model.md:133`). A leading
 * `-` on a numeral is a negative *literal*, never unary minus, so `not` is the only prefix
 * operator this evaluator handles.
 */
function evaluateNot(node: ArithmeticCallNode, env: Environment): EvalResult {
  const operandNode = arg(node, 0);
  const operandResult = evaluate(operandNode, env);
  if (!operandResult.ok) {
    return operandResult;
  }
  const operand = requireBoolean(
    operandResult.value,
    operandNode.source_span,
    "not",
  );
  if (!operand.ok) {
    return fail(operand.diagnostic);
  }
  return ok(!operand.value);
}

/**
 * `and`/`or` — left-associative and short-circuit (`spec/execution-model.md:137-144`): `and`
 * evaluates its next operand only while every earlier one was `true`, stopping (and reporting
 * `false`) at the first `false`; `or` stops (reporting `true`) at the first `true`. The parser
 * lowers both the infix form (nested binary `Call`s for three or more operands, left-associative)
 * and the parenthesized variadic form (`(and a b c)`, one call with every operand as an arg) to
 * the same callee/args shape, so walking `node.args` left to right gives identical semantics for
 * both — a later operand, whether the right side of a nested binary call or a later variadic arg,
 * is reached only when every earlier one demanded it. An operand is evaluated at most once, and a
 * short-circuited operand is never evaluated at all — so a diagnostic it would have raised
 * (`ol-undefined-var`, …) never fires.
 *
 * The bare infix form always supplies exactly two operands (the grammar itself guarantees it),
 * but the parenthesized form's operand count is only bounded by the closing `)`
 * (`packages/parser/src/parser.ts`'s `parseParenthesized` gathers every operand up to it) and the
 * static checker never arity-checks a grammar operator callee (`checker-arity.ts`), so `(and)`
 * and `(and :a)` parse clean with zero or one operand. `and`/`or`'s signature is `boolean and
 * boolean` (`spec/commands.md:566,585`) — two operands minimum — so fewer than two would
 * otherwise silently report the identity value (`true` for `and`, `false` for `or`) without ever
 * checking a single operand's type; `execute()` runs `parse()` only, so this is the sole guard.
 */
function evaluateLogical(
  node: ArithmeticCallNode,
  operator: LogicalOperator,
  env: Environment,
): EvalResult {
  if (node.args.length < 2) {
    return fail(
      runtimeDiag.notEnoughInputs(
        node.callee.source_span,
        operator,
        2,
        node.args.length,
      ),
    );
  }
  const shortCircuitValue = operator !== "and";
  for (const operandNode of node.args) {
    const operandResult = evaluate(operandNode, env);
    if (!operandResult.ok) {
      return operandResult;
    }
    const operand = requireBoolean(
      operandResult.value,
      operandNode.source_span,
      operator,
    );
    if (!operand.ok) {
      return fail(operand.diagnostic);
    }
    if (operand.value === shortCircuitValue) {
      return ok(shortCircuitValue);
    }
  }
  return ok(!shortCircuitValue);
}

// --- Comparisons: equality (`== !=`), ordering (`< > <= >=`), and chains --------------------
//
// spec/execution-model.md:483-510. `==`/`!=` compare any two values to a boolean and never
// raise; ordering is defined only for two numbers or two words and raises `ol-type` otherwise.

/**
 * The canonical printed form of a number (`spec/execution-model.md:19,498-500`): whole values
 * print without a decimal, non-whole values are trimmed to at most 10 significant digits. So
 * `5 == "5"` is `true`, `5 == "05"` is `false` (5 prints as `"5"`, not `"05"`), and a word
 * carrying more than 10 significant digits cannot equal the number it looks like.
 * `toPrecision(10)` rounds a non-whole value to 10 significant digits and re-parsing drops the
 * trailing zeros it introduces; a whole value keeps its full integer form. This is the single
 * source of the rule: number↔word equality ({@link valuesEqual}) and the `print` trace event's
 * text ({@link printedForm}, issue #98) both use it.
 */
export function formatNumber(value: number): string {
  if (Number.isInteger(value)) {
    return String(value);
  }
  return String(Number(value.toPrecision(10)));
}

/**
 * The canonical printed form of any Core value (`spec/execution-model.md:19` for numbers;
 * `print`/`show` in `spec/commands.md:142-175` for the command surface). Used to render the
 * `print value`/`(print …)` trace event as learner-visible text: numbers follow
 * {@link formatNumber}; a word prints verbatim (no surrounding quotes); a boolean prints
 * `true`/`false`; a list prints space-separated and bracketed, recursively, so a nested list
 * renders as `[1 [2 3]]`.
 */
export function printedForm(value: OLValue): string {
  if (typeof value === "number") {
    return formatNumber(value);
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  return `[${value.map(printedForm).join(" ")}]`;
}

/**
 * Normative `==` for the four Core types (`spec/execution-model.md:483-510` matrix): numeric
 * equality for two numbers; number↔word by canonical printed form; case-sensitive word equality;
 * boolean identity; structural list equality; every other cross-type pair is `false`. List
 * equality is cycle-safe via pair memoization (see {@link listEqual}). Exported so equality can
 * be exercised directly on constructed {@link OLValue}s — including cyclic lists, which are not
 * yet expressible through Core source (list mutation is issue #101).
 */
export function valuesEqual(a: OLValue, b: OLValue): boolean {
  return equalRec(a, b, new Map());
}

function equalRec(
  a: OLValue,
  b: OLValue,
  inProgress: Map<readonly OLValue[], Set<readonly OLValue[]>>,
): boolean {
  if (typeof a === "number") {
    if (typeof b === "number") {
      return a === b;
    }
    if (typeof b === "string") {
      return formatNumber(a) === b;
    }
    return false;
  }
  if (typeof a === "string") {
    if (typeof b === "string") {
      return a === b;
    }
    if (typeof b === "number") {
      return formatNumber(b) === a;
    }
    return false;
  }
  if (typeof a === "boolean") {
    // `a === b` is `true` only for the same boolean; every cross-type right side is `false`.
    return a === b;
  }
  if (!Array.isArray(b)) {
    return false;
  }
  return listEqual(a, b, inProgress);
}

/**
 * Structural list equality that terminates on cyclic or shared structure
 * (`spec/execution-model.md:502-506`). `inProgress` holds the reference pairs currently on the
 * comparison stack; re-encountering a pair while it is still in progress is the cyclic back-edge,
 * treated as equal for that branch (bisimulation, not identity short-circuiting). Each pair is
 * removed once its comparison completes, so `inProgress` stays a faithful stack rather than a
 * memo that could wrongly report a later-failed pair as equal.
 */
function listEqual(
  a: readonly OLValue[],
  b: readonly OLValue[],
  inProgress: Map<readonly OLValue[], Set<readonly OLValue[]>>,
): boolean {
  const partners = inProgress.get(a);
  if (partners?.has(b)) {
    return true;
  }
  if (a.length !== b.length) {
    return false;
  }
  const active = partners ?? new Set<readonly OLValue[]>();
  if (partners === undefined) {
    inProgress.set(a, active);
  }
  active.add(b);
  try {
    for (let i = 0; i < a.length; i++) {
      if (!equalRec(a[i] as OLValue, b[i] as OLValue, inProgress)) {
        return false;
      }
    }
    return true;
  } finally {
    active.delete(b);
    if (active.size === 0) {
      inProgress.delete(a);
    }
  }
}

/**
 * Lexicographic comparison of two words by Unicode code point
 * (`spec/execution-model.md:509`). `Array.from` iterates by code point (not UTF-16 code unit),
 * so astral characters sort by their true scalar value. Returns a negative number, `0`, or a
 * positive number when `a` sorts before, equal to, or after `b`.
 */
function compareWords(a: string, b: string): number {
  const left = Array.from(a);
  const right = Array.from(b);
  const shared = Math.min(left.length, right.length);
  for (let i = 0; i < shared; i++) {
    const x = (left[i] as string).codePointAt(0) as number;
    const y = (right[i] as string).codePointAt(0) as number;
    if (x !== y) {
      return x - y;
    }
  }
  return left.length - right.length;
}

/** Map an ordering operator and a sign (`< 0`, `0`, `> 0`) to the boolean it reports. */
function orderingHolds(operator: OrderingOperator, sign: number): boolean {
  switch (operator) {
    case "<":
      return sign < 0;
    case ">":
      return sign > 0;
    case "<=":
      return sign <= 0;
    case ">=":
      return sign >= 0;
  }
}

/**
 * Compare two numbers with the ordering operator applied directly. Direct comparison (rather than
 * deriving a sign from `left - right`) keeps equal non-finite operands correct: `Infinity - Infinity`
 * is `NaN`, which would make `<=`/`>=` on two equal infinities wrongly report `false`.
 */
function numberOrdering(
  operator: OrderingOperator,
  left: number,
  right: number,
): boolean {
  switch (operator) {
    case "<":
      return left < right;
    case ">":
      return left > right;
    case "<=":
      return left <= right;
    case ">=":
      return left >= right;
  }
}

/**
 * Ordering (`< > <= >=`) is defined only for two numbers (compared numerically) or two words
 * (compared lexicographically); every other pair raises `ol-type`
 * (`spec/execution-model.md:508-510`). When the left operand is itself non-orderable
 * (boolean/list) the diagnostic points at it and names the expected concept `"number or word"`;
 * otherwise the right operand does not match the left's type and the diagnostic points at the
 * right, naming the left's concept.
 */
function evaluateOrdering(
  operator: OrderingOperator,
  left: OLValue,
  leftNode: ExpressionNode,
  right: OLValue,
  rightNode: ExpressionNode,
): EvalResult {
  if (typeof left === "number" && typeof right === "number") {
    return ok(numberOrdering(operator, left, right));
  }
  if (typeof left === "string" && typeof right === "string") {
    return ok(orderingHolds(operator, compareWords(left, right)));
  }
  if (typeof left !== "number" && typeof left !== "string") {
    return fail(
      runtimeDiag.orderingType(leftNode.source_span, {
        expected: "number or word",
        actual: typeNameOf(left),
        value: left,
        operation: operator,
      }),
    );
  }
  return fail(
    runtimeDiag.orderingType(rightNode.source_span, {
      expected: typeof left === "number" ? "number" : "word",
      actual: typeNameOf(right),
      value: right,
      operation: operator,
    }),
  );
}

/** Evaluate one comparison given both operands' values and nodes (nodes carry the error spans). */
function compareValues(
  operator: ComparisonOperator,
  left: OLValue,
  leftNode: ExpressionNode,
  right: OLValue,
  rightNode: ExpressionNode,
): EvalResult {
  if (operator === "==") {
    return ok(valuesEqual(left, right));
  }
  if (operator === "!=") {
    return ok(!valuesEqual(left, right));
  }
  return evaluateOrdering(operator, left, leftNode, right, rightNode);
}

/** Evaluate a lone comparison written as a binary `Call` (`5 == "5"`, `true < false`). */
function evaluateComparisonCall(
  node: ArithmeticCallNode,
  operator: ComparisonOperator,
  env: Environment,
): EvalResult {
  const leftNode = arg(node, 0);
  const rightNode = arg(node, 1);

  const leftResult = evaluate(leftNode, env);
  if (!leftResult.ok) {
    return leftResult;
  }
  const rightResult = evaluate(rightNode, env);
  if (!rightResult.ok) {
    return rightResult;
  }
  return compareValues(
    operator,
    leftResult.value,
    leftNode,
    rightResult.value,
    rightNode,
  );
}

/**
 * Evaluate a chained comparison (`1 < :x < 10`) as `1 < :x and :x < 10`
 * (`spec/execution-model.md:146-147`). Operands are evaluated left-to-right, each exactly once,
 * and only as far as the `and` short-circuit reaches: a later operand is evaluated only when
 * every earlier link held. The shared middle operand is evaluated once and reused for both of
 * its links — the {@link ComparisonChainNode} stores it once, so single-evaluation is structural.
 */
function evaluateComparisonChain(
  node: ComparisonChainNode,
  env: Environment,
): EvalResult {
  const firstNode = node.operands[0] as ExpressionNode;
  const firstResult = evaluate(firstNode, env);
  if (!firstResult.ok) {
    return firstResult;
  }
  let leftNode = firstNode;
  let left = firstResult.value;

  for (let i = 0; i < node.operators.length; i++) {
    const rightNode = node.operands[i + 1] as ExpressionNode;
    const rightResult = evaluate(rightNode, env);
    if (!rightResult.ok) {
      return rightResult;
    }
    const right = rightResult.value;
    const operator = (node.operators[i] as { readonly name: string })
      .name as ComparisonOperator;
    const link = compareValues(operator, left, leftNode, right, rightNode);
    if (!link.ok) {
      return link;
    }
    if (link.value === false) {
      return ok(false);
    }
    leftNode = rightNode;
    left = right;
  }
  return ok(true);
}
