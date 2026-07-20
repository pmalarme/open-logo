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
  BlockNode,
  CallNode,
  ComparisonChainNode,
  ComprehensionNode,
  ExpressionNode,
  IsPredicateNode,
  ParenCallNode,
  PlaceNode,
  ProcedureDefNode,
  SelectorSegment,
  SpannedName,
  StatementNode,
  WordLitNode,
} from "@openlogo/parser";
import { runtimeDiag } from "./errors.js";
import { notAPlaceTargetText } from "./not-a-place-text.js";
import type { RenderableNode } from "./not-a-place-text.js";
import {
  createRandomNumberGeneratorState,
  nextRandomInt,
} from "./random-number-generator.js";
import type { RandomNumberGeneratorState } from "./random-number-generator.js";
import { normalizeHeading } from "./turtle-math.js";

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
 * Minimal structural shape of the standard `AbortSignal` this package's cancellation gate needs
 * (issue #102, `spec/execution-model.md:551-557`) — just the boolean `aborted` flag it polls.
 * Defined locally instead of referencing the global `AbortSignal` type because this package's
 * `tsconfig` targets `lib: ["es2023"]` with no DOM types (it runs in both Node and the browser).
 *
 * **`execute()` is synchronous and never yields to the event loop mid-run.** That has a real
 * consequence for cancellation: a same-thread `AbortController`/`AbortSignal` — the `fetch()`
 * pattern — cannot interrupt an `execute()` call already in progress, because the click handler
 * that would call `abort()` cannot run on the same thread until `execute()` returns control; by
 * then the run is already over. `checkExecutionLimits` polling `signal.aborted` many times during
 * one synchronous call only helps if something *outside that call* can flip `aborted` without
 * needing a turn of that same thread's event loop. The realistic deployment this is designed for
 * is `@openlogo/studio` running `execute()` inside a Web Worker: the main thread's Stop button
 * writes to a `SharedArrayBuffer` with `Atomics.store`, and the worker's `signal` implementation
 * reads that same buffer with `Atomics.load` in its `aborted` getter — a plain synchronous memory
 * read, visible to the worker thread instantly, with no event-loop cooperation required from the
 * busy worker at all. A same-thread `AbortSignal` remains structurally assignable here (so this
 * type doesn't reject one), but it will not actually cancel a run already underway; only a
 * cross-thread-backed signal like the `Atomics` one above can.
 */
export interface CancellationSignal {
  readonly aborted: boolean;
}

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
 * (`foreverIterationLimit`, also promoted from a separate parameter for the same reason),
 * `callProcedure` — a callback into `execute-internal.ts`'s procedure-call mechanics that lets
 * `evaluateCall` (expression/reporter position, e.g. `print area :r`) invoke a user procedure
 * without this module importing `execute-internal.ts` (which already imports this one, so a
 * direct import here would be a cycle). Statement-position calls (`star 5 100`) instead call
 * `execute-internal.ts`'s `runProcedure` directly — same module, no indirection needed. It also
 * adds `callDepth`, a mutable stack `runProcedure` pushes onto before running a callee's body and
 * pops after (mirroring `repeatTurns`'s push/pop-around-a-pass shape): its length is the current
 * procedure-call nesting depth, checked against a fixed ceiling before every call so unbounded
 * recursion raises a friendly `ol-limit` diagnostic (`spec/execution-model.md:551-557`) instead of
 * overflowing the host's own call stack.
 *
 * Issue #102 adds the other two execution-safety gates `spec/execution-model.md:551-557`
 * requires alongside recursion depth: a configurable instruction-execution budget
 * (`instructionBudget`, checked against the running `instructionCount` box) and external
 * cancellation (`signal`, an `AbortSignal`). `recursionDepthLimit` promotes the previously
 * hardcoded procedure-call depth ceiling to a configurable field of the same shape.
 * `instructionCount` is a single mutable `{ count }` box (not a plain field) for the same reason
 * `repeatTurns`/`callDepth` are arrays rather than reassigned fields: recursive calls receive the
 * very same `Environment` object, so a plain field would be indistinguishable from a fresh one —
 * only a shared mutable container survives being incremented from many nested call frames at
 * once. {@link checkExecutionLimits} is the single gate every looping/recursive execution path
 * calls before it may run another pass or statement.
 *
 * `source` (issue #156) is the original `.logo` source text `execute()`/`runProgram` parsed, when
 * available — `executeAssign`'s `ol-not-a-place` guard slices the exact target surface text out
 * of it (`not-a-place-text.ts`), matching the semantic checker's identical rule. `undefined` for
 * an environment built directly by a unit test with no real source string (this package's own
 * `createEnvironment()`), which falls back to reconstructing the text from the AST instead.
 */
export interface Environment {
  readonly frames: readonly Frame[];
  readonly repeatTurns: number[];
  readonly procedures: ProcedureRegistry;
  readonly events: TraceEvent[];
  readonly foreverIterationLimit?: number;
  readonly callDepth: number[];
  readonly recursionDepthLimit: number;
  readonly instructionBudget: number;
  readonly instructionCount: { count: number };
  readonly signal?: CancellationSignal;
  readonly turtle: TurtleState;
  readonly source?: string;
  readonly callProcedure: (
    node: CallNode | ParenCallNode,
    environment: Environment,
  ) => EvalResult;
  /**
   * The shared, mutable `random`/`randomize` generator state (issue #287,
   * `random-number-generator.ts`). A box like `instructionCount`/`turtle` rather than a plain
   * value, so a `randomize` reseed (or a `random` draw) made from anywhere in the program —
   * including deep inside a procedure call or loop body sharing this same `Environment` — is
   * observed by every later draw in the same run.
   */
  readonly randomNumberGenerator: RandomNumberGeneratorState;
}

/**
 * The turtle's mutable runtime state — position, heading, and the pen/rendering attributes a
 * `draw-segment` event captures at the moment it is emitted (`spec/rendering.md`'s "Line
 * segments" section: "each segment captures the pen color and pen width active when the segment
 * is created"). A single mutable object (like {@link Environment.repeatTurns}/`callDepth`) rather
 * than reassigned `Environment` fields, since every recursive `executeStatements`/`evaluate` call
 * shares the very same `Environment` and must observe the same turtle. Issue #200 (`forward`/
 * `back`) only ever reads `heading`/`penDown`/`color`/`width` and writes `x`/`y`; pen mutability
 * (`pen_up`/`pen_down`, issue #206), turning (issue #201), color/width (issues #208/#209), and
 * visibility (`show_turtle`/`hide_turtle`, issue #207) each add their own statement handling that
 * mutates the remaining fields. `visible` is purely a display flag — it never gates `move`/
 * `draw-segment` the way `penDown` does (`spec/rendering.md`'s "Turtle avatar and shapes" section:
 * a hidden turtle still moves, turns, and draws exactly as when visible). `shape` (issue #210,
 * `set_shape`) is likewise a display-only attribute the avatar wears — it never gates `move`/
 * `draw-segment` either, and `stamp` reads it to snapshot the avatar shape at the moment stamped.
 */
export interface TurtleState {
  x: number;
  y: number;
  heading: number;
  penDown: boolean;
  color: string;
  width: number;
  visible: boolean;
  shape: string;
}

/**
 * The turtle's state at program start (`spec/rendering.md:78`, `spec/commands.md:1189`):
 * position `(0,0)`, heading `0`, pen down, color `"black"`, width `1`, visible, shape `"turtle"`
 * (`spec/rendering.md`'s "Turtle avatar and shapes" section lists `"turtle"` first in the portable
 * set, matching `@openlogo/turtle`'s `INITIAL_TURTLE_STATE.shape`). Exported so
 * `execute-internal.ts`'s `createExecutionEnvironment` (the environment a real `execute()` call
 * runs against) builds the same defaults as this module's own bare `createEnvironment()`.
 */
export function createDefaultTurtleState(): TurtleState {
  return {
    x: 0,
    y: 0,
    heading: 0,
    penDown: true,
    color: "black",
    width: 1,
    visible: true,
    shape: "turtle",
  };
}

/** The empty registry shared by every environment that has no user procedures to call. */
const EMPTY_PROCEDURES: ProcedureRegistry = new Map();

/**
 * A fresh environment holding just the root/global frame, no active `repeat` turn, and no user
 * procedures. Used directly by expression-only tests; `execute-internal.ts` builds its own
 * environment (`createExecutionEnvironment`) with a real `procedures` registry and a working
 * `callProcedure` wired to `runProcedure` instead of this stub, which throws if ever reached —
 * safe, since `procedures` is empty here, so `evaluateCall` never takes the branch that calls it.
 *
 * `instructionBudget` is `Number.POSITIVE_INFINITY` and `recursionDepthLimit` is
 * `Number.POSITIVE_INFINITY` here — this bare environment models a single expression evaluation
 * for this package's own unit tests, not a cancellable/budgeted program run, so neither limit
 * should ever fire under normal test use. `execute-internal.ts`'s `createExecutionEnvironment`
 * is the only place real, finite production defaults are applied (issue #102).
 */
export function createEnvironment(): Environment {
  return {
    frames: [new Map()],
    repeatTurns: [],
    procedures: EMPTY_PROCEDURES,
    events: [],
    callDepth: [],
    recursionDepthLimit: Number.POSITIVE_INFINITY,
    instructionBudget: Number.POSITIVE_INFINITY,
    instructionCount: { count: 0 },
    turtle: createDefaultTurtleState(),
    randomNumberGenerator: createRandomNumberGeneratorState(),
    callProcedure: () => {
      throw new Error(
        "callProcedure is unreachable on a bare createEnvironment() — it has no procedures",
      );
    },
  };
}

/**
 * The single execution-safety gate every looping/recursive execution path must pass before
 * running another pass or statement (`spec/execution-model.md:551-557`): external cancellation
 * first, then the instruction-count budget. Returns the `ol-limit` diagnostic to halt with, or
 * `undefined` when it is safe to proceed — the caller is responsible for turning that into
 * whatever "stop now" outcome its own control-flow shape uses (`execute-internal.ts`'s `halt()`
 * for statement execution, `fail()` for a comprehension's expression-position evaluation).
 *
 * Called from BOTH `executeStatements`' own per-statement loop AND the top of every individual
 * loop pass (`While`/`Forever`/`Repeat`/`ForIn`/`ForRange` in `execute-internal.ts`, plus
 * `evaluateComprehension`'s per-element pass here) — not just the former — because a loop whose
 * body is empty (`while true [ ]`, `forever [ ]`) never enters `executeStatements`' per-statement
 * loop at all, and would otherwise spin forever, uninstrumented and uncancellable. Every call
 * increments `environment.instructionCount`, so budget/cancellation responsiveness does not depend on
 * how many statements a particular pass happens to contain.
 */
export function checkExecutionLimits(
  environment: Environment,
  source_span: SourceSpan,
): Diagnostic | undefined {
  if (environment.signal?.aborted) {
    return runtimeDiag.cancelled(source_span);
  }
  environment.instructionCount.count++;
  if (environment.instructionCount.count > environment.instructionBudget) {
    return runtimeDiag.instructionLimit(
      source_span,
      environment.instructionBudget,
    );
  }
  return undefined;
}

/** Look up `name` nearest frame to root; `undefined` when no frame binds it. */
function lookupVar(
  environment: Environment,
  name: string,
): OLValue | undefined {
  for (const frame of environment.frames) {
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
function assignVar(
  environment: Environment,
  name: string,
  value: OLValue,
): void {
  for (const frame of environment.frames) {
    if (frame.has(name)) {
      frame.set(name, value);
      return;
    }
  }
  const root = environment.frames[environment.frames.length - 1] as Frame;
  root.set(name, value);
}

// --- Loop/comprehension binder helpers (spec/execution-model.md:435-439) --------------------
//
// Shared by `execute-internal.ts`'s `ForIn` statement handling (issue #103) and this module's
// comprehension evaluation (`map`/`filter`/`reduce`, issue #105) — both bind one iterated element
// against the same `Binder` shape (a bare name, or a destructuring pattern), so the logic lives
// here rather than duplicated in both files. `execute-internal.ts` already imports this module,
// so keeping the shared helpers here (never the reverse) is the only cycle-free placement.

/**
 * A `for ... in`/comprehension binder (`spec/grammar.md:136-137`): a bare name, or a
 * destructuring pattern. The pattern node itself (`DestructuringBinderNode`) is not part of
 * `@openlogo/parser`'s public export list, so it is named here via `Extract` off the
 * already-exported {@link ComprehensionNode} rather than importing it directly —
 * `ForInNode["binder"]` is the identical underlying `Binder` type from `ast.ts`, so this one
 * alias serves both callers.
 */
export type Binder = ComprehensionNode["binder"];
export type DestructuringBinder = Extract<
  Binder,
  { kind: "DestructuringBinder" }
>;

/**
 * Push a fresh body-local frame binding `bindings` (name → value) onto `environment`, nearest-first, for
 * a `for`/comprehension binder's own name(s) — `spec/execution-model.md:435-437` ("body-local
 * bindings that shadow outer names only for the body"). Returns a *new* {@link Environment};
 * `environment` itself is never mutated, so once the caller stops using the returned value the binding is
 * gone — there is no explicit "pop" step, unlike `repeatTurns` (a plain mutable array shared by
 * every recursive call). `repeatTurns`/`callDepth` are threaded through unchanged (same array
 * reference) so a loop/comprehension nested inside a `repeat`/procedure call still sees the right
 * `repcount`/call depth.
 */
export function pushLoopFrame(
  environment: Environment,
  bindings: ReadonlyMap<string, OLValue>,
): Environment {
  const frame: Frame = new Map(bindings);
  return { ...environment, frames: [frame, ...environment.frames] };
}

/**
 * The first name in a destructuring pattern that repeats an earlier one in the same pattern
 * (case-insensitively), or `undefined` when every name is distinct. Mirrors the parser's
 * `checker-control-flow.ts` `patternDuplicateDiagnostics` exactly (same case-folding) so the
 * runtime's own `ol-duplicate-binder` guard agrees with the semantic checker's — this is a static
 * property of the pattern, checked once before iterating rather than per element.
 */
export function findDuplicateBinderName(
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
 * Bind one iterated element against `binder`: a bare name binds the whole element, while a
 * destructuring pattern destructures it positionally (`spec/execution-model.md:435-439`). A
 * non-list element, or one whose length disagrees with the pattern's arity, raises `ol-range` — a
 * non-list element's length is treated as `0`, since it can never match a non-empty pattern.
 * `"kind" in binder` — not `binder.kind` — distinguishes a bare-name binder (a plain
 * {@link SpannedName}, with no `kind` field at all) from a destructuring one without a false
 * discriminated-union assumption. Shared by `ForIn` (`execute-internal.ts`) and every comprehension
 * form (`map`/`filter`/`reduce`, below).
 */
export function bindElement(
  binder: Binder,
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
 * issue does not implement yet (`is`-predicates, a dotted `.field` place segment — Data-profile,
 * deferred — and calls to any command other than the arithmetic operators, math builtins,
 * comparison operators, and `thing` below) are left untouched for their own future slice
 * (#94-#105), never reaching {@link evaluate}'s internal "not implemented yet" invariant checks.
 * As of issue #96 a {@link ComparisonChainNode} and the six comparison-operator calls
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
 * procedures in scope). As of issue #105 a {@link ComprehensionNode} (`map`/`filter`/`reduce`) is
 * in scope when its `iterable` (and, for `reduce`, its `initial`) and every body statement are
 * themselves supported (see {@link isSupportedComprehensionBody}) — a comprehension whose body
 * uses a not-yet-implemented expression kind is left wholly unevaluated, same as any other
 * unsupported node, rather than raising a misleading `ol-no-value`. As of issue #99 an
 * {@link IsPredicateNode} is in scope when its `operand` (and, per `test.form`, its `collection`
 * or `low`/`high`) are themselves supported — `test.form === "a"`'s type word is a parse-time
 * literal, never evaluated, so it needs no check of its own — and the prefix `empty?`/`member?`/
 * `is_a?` callees join the known-callee list above. As of issue #101 the Core list reporters
 * `first`/`last`/`butfirst`/`butlast`/`fput`/`lput`/`sentence`/`count` join the known-callee list
 * too. As of issue #203 the turtle-state reporters `xcor`/`ycor`/`heading`/`pos`/`towards`/
 * `distance` join the known-callee list as well — pure reads of {@link Environment.turtle} that
 * emit no trace event. As of issue #234 the word-constructor `word` joins the known-callee list.
 * As of issue #287 the Core Math reporter `random` joins the known-callee list too — it reads and
 * mutates {@link Environment.randomNumberGenerator} but, like the turtle-state reporters above, is
 * otherwise a pure expression with no diagnostic beyond its own argument checks.
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
    case "IsPredicate":
      return isSupportedIsPredicate(node, procedures);
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
        name === "empty?" ||
        name === "member?" ||
        name === "is_a?" ||
        name === "first" ||
        name === "last" ||
        name === "butfirst" ||
        name === "butlast" ||
        name === "fput" ||
        name === "lput" ||
        name === "sentence" ||
        name === "word" ||
        name === "count" ||
        name === "xcor" ||
        name === "ycor" ||
        name === "heading" ||
        name === "pos" ||
        name === "towards" ||
        name === "distance" ||
        name === "random" ||
        procedures.has(name);
      return (
        isKnownCallee &&
        node.args.every((arg) => isSupportedExpression(arg, procedures))
      );
    }
    case "Comprehension":
      return (
        isSupportedExpression(node.iterable, procedures) &&
        (node.form !== "reduce" ||
          isSupportedExpression(node.initial, procedures)) &&
        isSupportedComprehensionBody(node.body, procedures)
      );
    case "DictLit":
      // Dict-literal runtime evaluation (values, reads, writes) is its own blocked slice
      // (issue #149 only delivers the parse/lex/highlight surface) — always unsupported for now.
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

/**
 * Is an {@link IsPredicateNode} in scope? Its `operand` must always be supported; per
 * `test.form`, `member-of`'s `collection` and `between`'s `low`/`high` must be too — `empty`
 * takes no sub-expression, and `a`'s type word is a parse-time literal, never evaluated, so it
 * needs no check of its own (issue #99).
 */
function isSupportedIsPredicate(
  node: IsPredicateNode,
  procedures: ProcedureRegistry = EMPTY_PROCEDURES,
): boolean {
  if (!isSupportedExpression(node.operand, procedures)) {
    return false;
  }
  switch (node.test.form) {
    case "empty":
    case "a":
      return true;
    case "member-of":
      return isSupportedExpression(node.test.collection, procedures);
    case "between":
      return (
        isSupportedExpression(node.test.low, procedures) &&
        isSupportedExpression(node.test.high, procedures)
      );
  }
}

/** Evaluate one Core expression node to a runtime {@link OLValue}. */
export function evaluate(
  node: ExpressionNode,
  environment: Environment = createEnvironment(),
): EvalResult {
  switch (node.kind) {
    case "NumberLit":
    case "WordLit":
    case "BooleanLit":
      return ok(node.value);
    case "ListLit": {
      const values: OLValue[] = [];
      for (const element of node.elements) {
        const result = evaluate(element, environment);
        if (!result.ok) {
          return result;
        }
        values.push(result.value);
      }
      return ok(values);
    }
    case "VarRef": {
      const value = lookupVar(environment, node.name);
      if (value === undefined) {
        return fail(runtimeDiag.undefinedVar(node.source_span, node.name));
      }
      return ok(value);
    }
    case "Place":
      return readPlace(node, environment);
    case "Call":
    case "ParenCall":
      return evaluateCall(node, environment);
    case "ComparisonChain":
      return evaluateComparisonChain(node, environment);
    case "Comprehension":
      return evaluateComprehension(node, environment);
    case "IsPredicate":
      return evaluateIsPredicate(node, environment);
    case "DictLit":
      // `isSupportedExpression` always returns `false` for a `DictLit`, so callers gate it out
      // before ever reaching here (same invariant as `readPlace`'s unimplemented segment kinds,
      // below) — dict-literal runtime evaluation is its own blocked slice (issue #149 is
      // parse/lex/highlight only).
      throw new Error(
        'evaluate: expression kind "DictLit" is not implemented yet — it lands with its own evaluator slice',
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
function readPlace(node: PlaceNode, environment: Environment): EvalResult {
  const base = lookupVar(environment, node.base.name);
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
    const step = resolveIndexSegment(current, segment, environment);
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
  environment: Environment,
): IndexResolution {
  const keyResult = evaluate(segment.key, environment);
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
function evaluateThing(
  node: ArithmeticCallNode,
  environment: Environment,
): EvalResult {
  const argNode = arg(node, 0);
  const argResult = evaluate(argNode, environment);
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
  const value = lookupVar(environment, argResult.value);
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
  environment: Environment,
): EvalResult {
  if (environment.repeatTurns.length === 0) {
    return fail(runtimeDiag.repcountOutsideRepeat(node.source_span));
  }
  return ok(
    environment.repeatTurns[environment.repeatTurns.length - 1] as number,
  );
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
  environment: Environment,
): AssignResult {
  if (node.place.kind !== "Place") {
    // The parser structurally accepts any of `RenderableNode`'s kinds (a reporter/command call,
    // or a bare literal/list) in target position, precisely so this rule — not a blunt parse
    // error — can explain the mistake (`checker-not-a-place.ts`'s doc comment, `spec/grammar.md`,
    // `spec/tooling.md:213-219`): `first :x = 5`, `count :nums = 3`, `3 = 5`, `[1 2] = 5` all
    // reach here as a non-`Place` `node.place`.
    return {
      ok: false,
      diagnostic: runtimeDiag.notAPlace(
        node.place.source_span,
        notAPlaceTargetText(node.place as RenderableNode, environment.source),
      ),
    };
  }
  const place = node.place;
  if (
    !isSupportedPlace(place, environment.procedures) ||
    !isSupportedExpression(node.value, environment.procedures)
  ) {
    return { ok: true };
  }

  const valueResult = evaluate(node.value, environment);
  if (!valueResult.ok) {
    return { ok: false, diagnostic: valueResult.diagnostic };
  }

  if (place.segments.length === 0) {
    assignVar(environment, place.base.name, valueResult.value);
    return { ok: true };
  }
  return writeIndexedPlace(place, valueResult.value, environment);
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
  environment: Environment,
): AssignResult {
  const base = lookupVar(environment, place.base.name);
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
      environment,
    );
    if (!step.ok) {
      return step;
    }
    container = step.list[step.index] as OLValue;
  }

  const lastSegment = segments[segments.length - 1] as SelectorSegment;
  const step = resolveIndexSegment(container, lastSegment, environment);
  if (!step.ok) {
    return step;
  }
  (step.list as OLValue[])[step.index] = value;
  return { ok: true };
}

function evaluateCall(
  node: ArithmeticCallNode,
  environment: Environment,
): EvalResult {
  const name = node.callee.name.toLowerCase();
  if (isBinaryArithmeticOperator(name)) {
    return evaluateBinaryArithmetic(node, name, environment);
  }
  if (isUnaryMathBuiltin(name)) {
    return evaluateUnaryMath(node, name, environment);
  }
  if (isBinaryMathBuiltin(name)) {
    return evaluateBinaryMath(node, name, environment);
  }
  if (isComparisonOperator(name)) {
    return evaluateComparisonCall(node, name, environment);
  }
  if (isLogicalOperator(name)) {
    return evaluateLogical(node, name, environment);
  }
  if (name === "not") {
    return evaluateNot(node, environment);
  }
  if (name === "thing") {
    return evaluateThing(node, environment);
  }
  if (name === "repcount") {
    return evaluateRepcount(node, environment);
  }
  if (name === "empty?") {
    return evaluatePrefixEmpty(node, environment);
  }
  if (name === "member?") {
    return evaluatePrefixMember(node, environment);
  }
  if (name === "is_a?") {
    return evaluatePrefixIsA(node, environment);
  }
  if (name === "first") {
    return evaluateFirst(node, environment);
  }
  if (name === "last") {
    return evaluateLast(node, environment);
  }
  if (name === "butfirst") {
    return evaluateButfirst(node, environment);
  }
  if (name === "butlast") {
    return evaluateButlast(node, environment);
  }
  if (name === "fput") {
    return evaluateFput(node, environment);
  }
  if (name === "lput") {
    return evaluateLput(node, environment);
  }
  if (name === "sentence") {
    return evaluateSentence(node, environment);
  }
  if (name === "word") {
    return evaluateWord(node, environment);
  }
  if (name === "count") {
    return evaluateCount(node, environment);
  }
  if (name === "xcor") {
    return evaluateXcor(node, environment);
  }
  if (name === "ycor") {
    return evaluateYcor(node, environment);
  }
  if (name === "heading") {
    return evaluateHeadingReporter(node, environment);
  }
  if (name === "pos") {
    return evaluatePos(node, environment);
  }
  if (name === "towards") {
    return evaluateTowards(node, environment);
  }
  if (name === "distance") {
    return evaluateDistance(node, environment);
  }
  if (name === "random") {
    return evaluateRandom(node, environment);
  }
  if (environment.procedures.has(name)) {
    return environment.callProcedure(node, environment);
  }
  throw new Error(
    `evaluate: call to "${name}" is not implemented yet — it lands with its own evaluator slice`,
  );
}

function evaluateBinaryArithmetic(
  node: ArithmeticCallNode,
  operator: BinaryArithmeticOperator,
  environment: Environment,
): EvalResult {
  const leftNode = arg(node, 0);
  const rightNode = arg(node, 1);

  const leftResult = evaluate(leftNode, environment);
  if (!leftResult.ok) {
    return leftResult;
  }
  const rightResult = evaluate(rightNode, environment);
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
  environment: Environment,
): EvalResult {
  const argNode = arg(node, 0);
  const argResult = evaluate(argNode, environment);
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
  environment: Environment,
): EvalResult {
  const baseNode = arg(node, 0);
  const exponentNode = arg(node, 1);

  const baseResult = evaluate(baseNode, environment);
  if (!baseResult.ok) {
    return baseResult;
  }
  const exponentResult = evaluate(exponentNode, environment);
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
function evaluateNot(
  node: ArithmeticCallNode,
  environment: Environment,
): EvalResult {
  const operandNode = arg(node, 0);
  const operandResult = evaluate(operandNode, environment);
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
  environment: Environment,
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
    const operandResult = evaluate(operandNode, environment);
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
  environment: Environment,
): EvalResult {
  const leftNode = arg(node, 0);
  const rightNode = arg(node, 1);

  const leftResult = evaluate(leftNode, environment);
  if (!leftResult.ok) {
    return leftResult;
  }
  const rightResult = evaluate(rightNode, environment);
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
  environment: Environment,
): EvalResult {
  const firstNode = node.operands[0] as ExpressionNode;
  const firstResult = evaluate(firstNode, environment);
  if (!firstResult.ok) {
    return firstResult;
  }
  let leftNode = firstNode;
  let left = firstResult.value;

  for (let i = 0; i < node.operators.length; i++) {
    const rightNode = node.operands[i + 1] as ExpressionNode;
    const rightResult = evaluate(rightNode, environment);
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

// --- is-predicates: worded `is ...` and prefix `?`-predicates (spec/execution-model.md:146-166,
// issue #99) ------------------------------------------------------------------------------------
//
// `<value> is empty`/`is member of <collection>`/`is a <type-word>`/`is [ strictly ] between <low>
// and <high>` are the worded forms; `empty?`/`member?`/`is_a?` (ordinary `Call`s dispatched from
// {@link evaluateCall}) are their prefix equivalents (`spec/execution-model.md:153`). The worded
// `is a <type-word>` form's type word is a parse-time literal (`IsTest`'s `{form:"a"}` carries a
// `WordLitNode`, never evaluated), so at runtime it can only be an *unknown* type name
// (`ol-unknown-type`) — never a wrong-typed value (`ol-type` is structurally unreachable for this
// form). The prefix `is_a? value type` form's `type` is an ordinary, dynamically evaluated call
// argument, so it can raise *both* `ol-type` (the argument isn't a word at all) and
// `ol-unknown-type` (it is a word, but not a recognized type name) — two distinct code paths
// ({@link evaluateIsAWorded} vs. {@link evaluateIsAValue}), matching the semantic checker's own
// distinction (`packages/parser/src/checker-type-field.ts`).

/**
 * Core's built-in type words `is a`/`is_a?` recognize (`spec/execution-model.md:161-166`) — the
 * runtime's own copy of the semantic checker's `CORE_TYPE_WORDS`
 * (`packages/parser/src/checker-type-field.ts`, issue #112), kept in sync by hand since it is not
 * part of `@openlogo/parser`'s public surface (`checker-type-field.ts` is not re-exported from
 * `index.ts`). Case-sensitive, matching the checker: `is a "number"` resolves, `is a "Number"`
 * does not (both are "unknown", not a type mismatch). Data-profile words (`dict`, `record`) are
 * deferred exactly as the checker defers them — {@link OLValue} has no way to construct one yet.
 */
const CORE_IS_A_TYPE_WORDS: ReadonlySet<string> = new Set([
  "number",
  "word",
  "list",
  "boolean",
]);

/** Is `value` one of the types `is empty`/`empty?` accepts: a list or a word (dict is deferred). */
function isEmptyableValue(
  value: OLValue,
): value is string | readonly OLValue[] {
  return typeof value === "string" || Array.isArray(value);
}

/**
 * `is empty`/`empty?`: `true` when a list/word operand has no elements/characters
 * (`spec/execution-model.md:160` — accepts lists, dicts, and words; dict is deferred, see
 * {@link CORE_IS_A_TYPE_WORDS}'s doc comment). Any other type raises `ol-type`.
 */
function evaluateIsEmptyValue(
  value: OLValue,
  span: SourceSpan,
  operation: "is empty" | "empty?",
): EvalResult {
  if (!isEmptyableValue(value)) {
    return fail(
      runtimeDiag.isPredicateType(span, {
        expected: "list or word",
        actual: typeNameOf(value),
        value,
        operation,
      }),
    );
  }
  return ok(value.length === 0);
}

/**
 * `is member of <collection>`/`member? value collection`: `true` when `collection` (a list — dict
 * is deferred, see {@link CORE_IS_A_TYPE_WORDS}'s doc comment) has an element equal to `value`
 * (`spec/execution-model.md:161` — `member of` accepts lists and dicts). A non-list `collection`
 * raises `ol-type`; `value`'s own type is unrestricted, using the same equality
 * ({@link valuesEqual}) as `==`.
 */
function evaluateIsMemberValue(
  value: OLValue,
  collection: OLValue,
  collectionSpan: SourceSpan,
  operation: "is member of" | "member?",
): EvalResult {
  if (!Array.isArray(collection)) {
    return fail(
      runtimeDiag.isPredicateType(collectionSpan, {
        expected: "list",
        actual: typeNameOf(collection),
        value: collection,
        operation,
      }),
    );
  }
  return ok(collection.some((element) => valuesEqual(value, element)));
}

/**
 * `is a <type-word>`: `true` when `value`'s runtime type name equals the parse-time literal
 * `typeWord`'s value. The word is grammar-checked (`IsTest`'s `{form:"a"}` carries a
 * `WordLitNode`), so the only runtime-reachable failure is an *unknown* type name —
 * `ol-unknown-type`, never `ol-type` (`spec/execution-model.md:162-163`).
 */
function evaluateIsAWorded(value: OLValue, typeWord: WordLitNode): EvalResult {
  if (!CORE_IS_A_TYPE_WORDS.has(typeWord.value)) {
    return fail(runtimeDiag.unknownType(typeWord.source_span, typeWord.value));
  }
  return ok(typeNameOf(value) === typeWord.value);
}

/**
 * `is_a? value type`: the prefix form's `type` argument is dynamically evaluated
 * (`spec/execution-model.md:164-166`), so — unlike the worded `is a`'s literal — it can itself be
 * the wrong type (`ol-type`, when it isn't a word at all) before the unknown-type-name check
 * ({@link evaluateIsAWorded}'s `ol-unknown-type`) even applies.
 */
function evaluateIsAValue(
  value: OLValue,
  typeArgument: OLValue,
  typeArgumentSpan: SourceSpan,
): EvalResult {
  if (typeof typeArgument !== "string") {
    return fail(
      runtimeDiag.isPredicateType(typeArgumentSpan, {
        expected: "word",
        actual: typeNameOf(typeArgument),
        value: typeArgument,
        operation: "is_a?",
      }),
    );
  }
  if (!CORE_IS_A_TYPE_WORDS.has(typeArgument)) {
    return fail(runtimeDiag.unknownType(typeArgumentSpan, typeArgument));
  }
  return ok(typeNameOf(value) === typeArgument);
}

/**
 * `is [ strictly ] between <low> and <high>`: inclusive by default, exclusive with `strictly`
 * (`spec/execution-model.md:151-152,159`). Reuses the exact number/word ordering primitives `< >
 * <= >=` use ({@link numberOrdering}, {@link compareWords}, {@link orderingHolds}) rather than
 * forking a second comparison implementation, but — unlike calling {@link evaluateOrdering}
 * directly — reports every type mismatch with `operation: "between"` (not an ordering-operator
 * symbol), since that is the predicate the learner actually wrote. `value` must be a number or a
 * word (else `ol-type`, naming `"number or word"`); `low`/`high` must then match `value`'s own
 * type (else `ol-type` naming it specifically).
 */
function evaluateBetween(
  value: OLValue,
  valueNode: ExpressionNode,
  low: OLValue,
  lowNode: ExpressionNode,
  high: OLValue,
  highNode: ExpressionNode,
  strict: boolean,
): EvalResult {
  if (typeof value !== "number" && typeof value !== "string") {
    return fail(
      runtimeDiag.orderingType(valueNode.source_span, {
        expected: "number or word",
        actual: typeNameOf(value),
        value,
        operation: "between",
      }),
    );
  }
  const isNumber = typeof value === "number";
  const boundKind = isNumber ? "number" : "word";
  if (typeof low !== (isNumber ? "number" : "string")) {
    return fail(
      runtimeDiag.orderingType(lowNode.source_span, {
        expected: boundKind,
        actual: typeNameOf(low),
        value: low,
        operation: "between",
      }),
    );
  }
  if (typeof high !== (isNumber ? "number" : "string")) {
    return fail(
      runtimeDiag.orderingType(highNode.source_span, {
        expected: boundKind,
        actual: typeNameOf(high),
        value: high,
        operation: "between",
      }),
    );
  }

  const geLow = isNumber
    ? numberOrdering(strict ? ">" : ">=", value as number, low as number)
    : orderingHolds(
        strict ? ">" : ">=",
        compareWords(value as string, low as string),
      );
  if (!geLow) {
    return ok(false);
  }
  const leHigh = isNumber
    ? numberOrdering(strict ? "<" : "<=", value as number, high as number)
    : orderingHolds(
        strict ? "<" : "<=",
        compareWords(value as string, high as string),
      );
  return ok(leHigh);
}

/** Evaluate a worded `<operand> is ...` predicate (all four {@link IsTest} forms). */
function evaluateIsPredicate(
  node: IsPredicateNode,
  environment: Environment,
): EvalResult {
  const operandResult = evaluate(node.operand, environment);
  if (!operandResult.ok) {
    return operandResult;
  }
  const value = operandResult.value;
  const test = node.test;

  switch (test.form) {
    case "empty":
      return evaluateIsEmptyValue(value, node.operand.source_span, "is empty");
    case "member-of": {
      const collectionResult = evaluate(test.collection, environment);
      if (!collectionResult.ok) {
        return collectionResult;
      }
      return evaluateIsMemberValue(
        value,
        collectionResult.value,
        test.collection.source_span,
        "is member of",
      );
    }
    case "a":
      return evaluateIsAWorded(value, test.type);
    case "between": {
      const lowResult = evaluate(test.low, environment);
      if (!lowResult.ok) {
        return lowResult;
      }
      const highResult = evaluate(test.high, environment);
      if (!highResult.ok) {
        return highResult;
      }
      return evaluateBetween(
        value,
        node.operand,
        lowResult.value,
        test.low,
        highResult.value,
        test.high,
        test.strict,
      );
    }
  }
}

/** `empty? value` — the prefix equivalent of `<value> is empty` (`spec/commands.md:655-669`). */
function evaluatePrefixEmpty(
  node: ArithmeticCallNode,
  environment: Environment,
): EvalResult {
  const operandNode = arg(node, 0);
  const operandResult = evaluate(operandNode, environment);
  if (!operandResult.ok) {
    return operandResult;
  }
  return evaluateIsEmptyValue(
    operandResult.value,
    operandNode.source_span,
    "empty?",
  );
}

/**
 * `member? value collection` — the prefix equivalent of `<value> is member of <collection>`
 * (`spec/commands.md:673-687`).
 */
function evaluatePrefixMember(
  node: ArithmeticCallNode,
  environment: Environment,
): EvalResult {
  const valueNode = arg(node, 0);
  const collectionNode = arg(node, 1);
  const valueResult = evaluate(valueNode, environment);
  if (!valueResult.ok) {
    return valueResult;
  }
  const collectionResult = evaluate(collectionNode, environment);
  if (!collectionResult.ok) {
    return collectionResult;
  }
  return evaluateIsMemberValue(
    valueResult.value,
    collectionResult.value,
    collectionNode.source_span,
    "member?",
  );
}

/**
 * `is_a? value type` — the prefix equivalent of `<value> is a <type-word>`
 * (`spec/commands.md:691-705`), whose `type` argument is dynamically evaluated
 * (see {@link evaluateIsAValue}).
 */
function evaluatePrefixIsA(
  node: ArithmeticCallNode,
  environment: Environment,
): EvalResult {
  const valueNode = arg(node, 0);
  const typeNode = arg(node, 1);
  const valueResult = evaluate(valueNode, environment);
  if (!valueResult.ok) {
    return valueResult;
  }
  const typeResult = evaluate(typeNode, environment);
  if (!typeResult.ok) {
    return typeResult;
  }
  return evaluateIsAValue(
    valueResult.value,
    typeResult.value,
    typeNode.source_span,
  );
}

// --- Core list reporters: first/last/butfirst/butlast/fput/lput/sentence/word/count (issue #101,
// #234; spec/commands.md "Words and lists", spec/execution-model.md:447-482) ---------------------
//
// Every reporter below is a plain `Call`/`ParenCall` — no dedicated AST node — dispatched by
// lowercased callee name, same as the is-predicates above. `fput`/`lput`/`sentence`/`word` always
// return a *fresh* value (never mutate an argument list in place); nested element references
// are shared, only the outer array is copied (`spec/execution-model.md:447-482`'s
// mutation-vs-copy distinction). `reverse`/`pick`/`sort` are Data-profile derived reporters
// (`spec/data-structures.md:125-129`), not Core, so they are intentionally absent here.

/** A word (string) or list (array) — the shared input type of `first`/`last`/`butfirst`/`butlast`/`count`. */
function isWordOrList(value: OLValue): value is string | readonly OLValue[] {
  return typeof value === "string" || Array.isArray(value);
}

/**
 * Guards a list reporter's parenthesized-call under-supply the same way {@link evaluateLogical}
 * guards `and`/`or`: `checker-arity.ts` (issue #111) only statically catches a strictly-fixed-arity
 * primitive's under-supply (`max === min`); for these reporters the parenthesized form's true
 * ceiling is looser than the bare-call default arity (`sentence`) or the checker simply defers the
 * lower bound to the runtime, per its own documented convention ("the lower bound is left to the
 * runtime arity check (#97)"). Since `execute()` runs `parse()` only — never `check()` — the
 * runtime is the sole enforcement point for every one of these, not just the open-variadic ones.
 */
function requireMinArgs(
  node: ArithmeticCallNode,
  name: string,
  min: number,
): Diagnostic | undefined {
  if (node.args.length < min) {
    return runtimeDiag.notEnoughInputs(
      node.callee.source_span,
      name,
      min,
      node.args.length,
    );
  }
  return undefined;
}

/**
 * `first`/`last` — the first/last element of a list, or first/last character of a word, as a
 * one-character word (`spec/commands.md` "first"/"last"). Empty input raises `ol-range`; a
 * non-word/non-list input raises `ol-type`.
 */
function evaluateFirstOrLast(
  node: ArithmeticCallNode,
  environment: Environment,
  which: "first" | "last",
): EvalResult {
  const arityDiagnostic = requireMinArgs(node, which, 1);
  if (arityDiagnostic) {
    return fail(arityDiagnostic);
  }
  const inputNode = arg(node, 0);
  const inputResult = evaluate(inputNode, environment);
  if (!inputResult.ok) {
    return inputResult;
  }
  const value = inputResult.value;
  if (!isWordOrList(value)) {
    return fail(
      runtimeDiag.listReporterType(inputNode.source_span, {
        expected: "word or list",
        actual: typeNameOf(value),
        value,
        operation: which,
      }),
    );
  }
  if (value.length === 0) {
    return fail(
      runtimeDiag.emptyInput(inputNode.source_span, {
        operation: which,
        value,
      }),
    );
  }
  const index = which === "first" ? 0 : value.length - 1;
  return ok(value[index] as OLValue);
}

function evaluateFirst(
  node: ArithmeticCallNode,
  environment: Environment,
): EvalResult {
  return evaluateFirstOrLast(node, environment, "first");
}

function evaluateLast(
  node: ArithmeticCallNode,
  environment: Environment,
): EvalResult {
  return evaluateFirstOrLast(node, environment, "last");
}

/**
 * `butfirst`/`butlast` — every element/character except the first/last, preserving the word-vs-
 * list type (`spec/commands.md` "butfirst"/"butlast"). Empty input raises `ol-range`; a
 * non-word/non-list input raises `ol-type`.
 */
function evaluateButfirstOrButlast(
  node: ArithmeticCallNode,
  environment: Environment,
  which: "butfirst" | "butlast",
): EvalResult {
  const arityDiagnostic = requireMinArgs(node, which, 1);
  if (arityDiagnostic) {
    return fail(arityDiagnostic);
  }
  const inputNode = arg(node, 0);
  const inputResult = evaluate(inputNode, environment);
  if (!inputResult.ok) {
    return inputResult;
  }
  const value = inputResult.value;
  if (!isWordOrList(value)) {
    return fail(
      runtimeDiag.listReporterType(inputNode.source_span, {
        expected: "word or list",
        actual: typeNameOf(value),
        value,
        operation: which,
      }),
    );
  }
  if (value.length === 0) {
    return fail(
      runtimeDiag.emptyInput(inputNode.source_span, {
        operation: which,
        value,
      }),
    );
  }
  const rest =
    which === "butfirst" ? value.slice(1) : value.slice(0, value.length - 1);
  return ok(typeof value === "string" ? (rest as string) : [...rest]);
}

function evaluateButfirst(
  node: ArithmeticCallNode,
  environment: Environment,
): EvalResult {
  return evaluateButfirstOrButlast(node, environment, "butfirst");
}

function evaluateButlast(
  node: ArithmeticCallNode,
  environment: Environment,
): EvalResult {
  return evaluateButfirstOrButlast(node, environment, "butlast");
}

/**
 * `fput`/`lput` — a *fresh* list with `value` prepended/appended to `list`
 * (`spec/commands.md` "fput"/"lput"; `spec/execution-model.md:447-482` — never mutates `list`).
 * A non-list second argument raises `ol-type`.
 */
function evaluateFputOrLput(
  node: ArithmeticCallNode,
  environment: Environment,
  which: "fput" | "lput",
): EvalResult {
  const arityDiagnostic = requireMinArgs(node, which, 2);
  if (arityDiagnostic) {
    return fail(arityDiagnostic);
  }
  const valueNode = arg(node, 0);
  const listNode = arg(node, 1);
  const valueResult = evaluate(valueNode, environment);
  if (!valueResult.ok) {
    return valueResult;
  }
  const listResult = evaluate(listNode, environment);
  if (!listResult.ok) {
    return listResult;
  }
  const list = listResult.value;
  if (!Array.isArray(list)) {
    return fail(
      runtimeDiag.listReporterType(listNode.source_span, {
        expected: "list",
        actual: typeNameOf(list),
        value: list,
        operation: which,
      }),
    );
  }
  return ok(
    which === "fput"
      ? [valueResult.value, ...list]
      : [...list, valueResult.value],
  );
}

function evaluateFput(
  node: ArithmeticCallNode,
  environment: Environment,
): EvalResult {
  return evaluateFputOrLput(node, environment, "fput");
}

function evaluateLput(
  node: ArithmeticCallNode,
  environment: Environment,
): EvalResult {
  return evaluateFputOrLput(node, environment, "lput");
}

/**
 * `sentence` — a *fresh* list combining every argument as sentence items (`spec/commands.md`
 * "sentence"; `spec/data-structures.md`'s combine-as-sentence description): a list-typed
 * argument's own elements flatten one level into the result, a non-list argument becomes a
 * single element. `sentence` places no type restriction on its arguments — this flattening rule
 * is the interpretive reading of the spec's "items participate as sentence items" phrasing,
 * following classic Logo's `sentence` semantics, since the spec has no separate normative
 * "sequence rules" section spelling this out.
 */
function evaluateSentence(
  node: ArithmeticCallNode,
  environment: Environment,
): EvalResult {
  const arityDiagnostic = requireMinArgs(node, "sentence", 2);
  if (arityDiagnostic) {
    return fail(arityDiagnostic);
  }
  const result: OLValue[] = [];
  for (const argNode of node.args) {
    const argResult = evaluate(argNode, environment);
    if (!argResult.ok) {
      return argResult;
    }
    if (Array.isArray(argResult.value)) {
      result.push(...argResult.value);
    } else {
      result.push(argResult.value);
    }
  }
  return ok(result);
}

/**
 * `word` — a *fresh* word concatenating every argument (`spec/commands.md` "word": "Concatenates
 * word values into a word"). Unlike `sentence`'s flattening rule, `word`'s "Argument types: word,
 * word" is strict — every argument must itself be a Core `word` (a string); a `number`/`list`/
 * `boolean` argument raises `ol-type` (`spec/commands.md` "word"'s "Possible errors: `ol-type`").
 */
function evaluateWord(
  node: ArithmeticCallNode,
  environment: Environment,
): EvalResult {
  const arityDiagnostic = requireMinArgs(node, "word", 2);
  if (arityDiagnostic) {
    return fail(arityDiagnostic);
  }
  let result = "";
  for (const argNode of node.args) {
    const argResult = evaluate(argNode, environment);
    if (!argResult.ok) {
      return argResult;
    }
    const value = argResult.value;
    if (typeof value !== "string") {
      return fail(
        runtimeDiag.listReporterType(argNode.source_span, {
          expected: "word",
          actual: typeNameOf(value),
          value,
          operation: "word",
        }),
      );
    }
    result += value;
  }
  return ok(result);
}

/**
 * `count` — the number of elements in a list, or characters in a word
 * (`spec/commands.md` "count"). A non-word/non-list input raises `ol-type`.
 *
 * `spec/commands.md`'s literal `count` signature also accepts a dict argument, but `OLValue`
 * (`packages/core/src/values.ts`) has no dict representation at all yet — this is the same
 * genuine, currently-unimplementable gap `CORE_IS_A_TYPE_WORDS` already documents for `is a
 * "dict"`, deferred rather than invented here.
 */
function evaluateCount(
  node: ArithmeticCallNode,
  environment: Environment,
): EvalResult {
  const arityDiagnostic = requireMinArgs(node, "count", 1);
  if (arityDiagnostic) {
    return fail(arityDiagnostic);
  }
  const inputNode = arg(node, 0);
  const inputResult = evaluate(inputNode, environment);
  if (!inputResult.ok) {
    return inputResult;
  }
  const value = inputResult.value;
  if (!isWordOrList(value)) {
    return fail(
      runtimeDiag.listReporterType(inputNode.source_span, {
        expected: "word or list",
        actual: typeNameOf(value),
        value,
        operation: "count",
      }),
    );
  }
  return ok(value.length);
}

/**
 * Guards a strictly-fixed-arity reporter — 0-arg `xcor`/`ycor`/`heading`/`pos`, 2-arg `towards`/
 * `distance` (issue #203): `ol-not-enough-inputs` when under-supplied, `ol-too-many-inputs` when
 * over-supplied, `undefined` when the count matches. Mirrors `execute-internal.ts`'s inline
 * `args.length !== n` guard on fixed-arity turtle-command statements (e.g.
 * `executeTurtleTurnCall`) — these reporters need the identical shape here since `evaluate()` runs
 * without the static checker (`execute()` never calls `check()`).
 */
function requireExactArgs(
  node: ArithmeticCallNode,
  name: string,
  count: number,
): Diagnostic | undefined {
  if (node.args.length === count) {
    return undefined;
  }
  return node.args.length < count
    ? runtimeDiag.notEnoughInputs(
        node.callee.source_span,
        name,
        count,
        node.args.length,
      )
    : runtimeDiag.tooManyInputs(
        node.callee.source_span,
        name,
        count,
        node.args.length,
      );
}

/**
 * `xcor`/`ycor`/`heading`/`pos` (`spec/commands.md` "xcor"/"ycor"/"heading"/"pos") and `towards`/
 * `distance` (issue #203): pure reads of {@link Environment.turtle} — no `move`/`turn`/
 * `draw-segment` event is ever emitted, since reading position/heading is not an effect
 * (`spec/rendering.md`'s "Line segments"/"Turning" sections only describe events for the
 * *mutating* commands `forward`/`back`/`left`/`right`/`set_xy`/`set_heading`). `heading` returns
 * `turtle.heading` as-is: the statement side (`turnTurtle`/`setHeadingTurtle` in
 * `execute-internal.ts`) already keeps it normalized to `[0,360)` on every write, so there is
 * nothing left to normalize on read.
 */
function evaluateXcor(
  node: ArithmeticCallNode,
  environment: Environment,
): EvalResult {
  const arityDiagnostic = requireExactArgs(node, "xcor", 0);
  if (arityDiagnostic) {
    return fail(arityDiagnostic);
  }
  return ok(environment.turtle.x);
}

function evaluateYcor(
  node: ArithmeticCallNode,
  environment: Environment,
): EvalResult {
  const arityDiagnostic = requireExactArgs(node, "ycor", 0);
  if (arityDiagnostic) {
    return fail(arityDiagnostic);
  }
  return ok(environment.turtle.y);
}

function evaluateHeadingReporter(
  node: ArithmeticCallNode,
  environment: Environment,
): EvalResult {
  const arityDiagnostic = requireExactArgs(node, "heading", 0);
  if (arityDiagnostic) {
    return fail(arityDiagnostic);
  }
  return ok(environment.turtle.heading);
}

/** `pos` — a fresh two-item list `[x y]` of the turtle's current position. */
function evaluatePos(
  node: ArithmeticCallNode,
  environment: Environment,
): EvalResult {
  const arityDiagnostic = requireExactArgs(node, "pos", 0);
  if (arityDiagnostic) {
    return fail(arityDiagnostic);
  }
  return ok([environment.turtle.x, environment.turtle.y]);
}

/**
 * `towards x y` — the heading (`[0,360)`) from the turtle's current position toward `(x, y)`
 * (`spec/commands.md` "towards"). `Math.atan2(dx, dy)` (arguments in `(x, y)` order, not the usual
 * `(y, x)`) directly yields OL's compass-bearing convention — `0` points up/`+y`, `right`/clockwise
 * is positive — matching `spec/execution-model.md:538` and verified against the spec's own worked
 * example: `towards 100 0` from the origin is `90` (dx=100, dy=0 → atan2(100,0) = 90°).
 * {@link normalizeHeading} folds the `atan2` result's `(-180,180]` range into `[0,360)`, same as
 * every other heading-producing path. Non-number `x`/`y` raise `ol-type`
 * ({@link requireNumber}); the spec defines no other error for `towards` (unlike `set_width`, it
 * has no "possible errors" section), so a same-point call (`dx = dy = 0`) is not an error —
 * `atan2(0, 0)` is `0`, reported as heading `0`.
 */
function evaluateTowards(
  node: ArithmeticCallNode,
  environment: Environment,
): EvalResult {
  const arityDiagnostic = requireExactArgs(node, "towards", 2);
  if (arityDiagnostic) {
    return fail(arityDiagnostic);
  }
  const xNode = arg(node, 0);
  const yNode = arg(node, 1);
  const xResult = evaluate(xNode, environment);
  if (!xResult.ok) {
    return xResult;
  }
  const yResult = evaluate(yNode, environment);
  if (!yResult.ok) {
    return yResult;
  }
  const x = requireNumber(xResult.value, xNode.source_span, "towards");
  if (!x.ok) {
    return fail(x.diagnostic);
  }
  const y = requireNumber(yResult.value, yNode.source_span, "towards");
  if (!y.ok) {
    return fail(y.diagnostic);
  }
  const dx = x.value - environment.turtle.x;
  const dy = y.value - environment.turtle.y;
  return ok(normalizeHeading((Math.atan2(dx, dy) * 180) / Math.PI));
}

/**
 * `distance x y` — the straight-line distance from the turtle's current position to `(x, y)`
 * (`spec/commands.md` "distance"). Non-number `x`/`y` raise `ol-type` ({@link requireNumber}); the
 * spec defines no other error, matching {@link evaluateTowards}'s reasoning.
 */
function evaluateDistance(
  node: ArithmeticCallNode,
  environment: Environment,
): EvalResult {
  const arityDiagnostic = requireExactArgs(node, "distance", 2);
  if (arityDiagnostic) {
    return fail(arityDiagnostic);
  }
  const xNode = arg(node, 0);
  const yNode = arg(node, 1);
  const xResult = evaluate(xNode, environment);
  if (!xResult.ok) {
    return xResult;
  }
  const yResult = evaluate(yNode, environment);
  if (!yResult.ok) {
    return yResult;
  }
  const x = requireNumber(xResult.value, xNode.source_span, "distance");
  if (!x.ok) {
    return fail(x.diagnostic);
  }
  const y = requireNumber(yResult.value, yNode.source_span, "distance");
  if (!y.ok) {
    return fail(y.diagnostic);
  }
  const dx = x.value - environment.turtle.x;
  const dy = y.value - environment.turtle.y;
  return ok(Math.hypot(dx, dy));
}

/**
 * `random n` / `(random a b)` (issue #287, `spec/commands.md`'s `random` entry): a whole-number
 * draw from the shared per-{@link Environment} generator
 * ({@link Environment.randomNumberGenerator}). Unlike
 * {@link evaluateTowards}/{@link evaluateDistance}'s single fixed arity, `random` has two valid
 * shapes — bare `random n` (1 argument, reporting `[0, n-1]`) and parenthesized `(random a b)` (2
 * arguments, reporting `[a, b]` inclusive) — so neither {@link requireMinArgs} alone (no upper
 * bound) nor {@link requireExactArgs} alone (only one valid count) fits; both bounds are guarded
 * directly here, the same way `checker-arity.ts`'s static arity rule cannot itself catch every gap
 * for a primitive with more than one valid arity (`execute()` never runs `check()`, so the runtime
 * is the sole enforcement point regardless). Every bound is checked for whole-number TYPE before
 * either RANGE check, exactly matching the entry's documented order: "Inputs are checked in
 * order: a non-whole bound raises `ol-type`; then `n` below `1`, or `a` greater than `b`, raises
 * `ol-range`."
 */
function evaluateRandom(
  node: ArithmeticCallNode,
  environment: Environment,
): EvalResult {
  if (node.args.length < 1 || node.args.length > 2) {
    const source_span = node.callee.source_span;
    return fail(
      node.args.length < 1
        ? runtimeDiag.notEnoughInputs(
            source_span,
            "random",
            1,
            node.args.length,
          )
        : runtimeDiag.tooManyInputs(source_span, "random", 2, node.args.length),
    );
  }
  if (node.args.length === 1) {
    const nNode = arg(node, 0);
    const nResult = evaluate(nNode, environment);
    if (!nResult.ok) {
      return nResult;
    }
    const n = requireWholeNumber(nResult.value, nNode.source_span, "random");
    if (!n.ok) {
      return fail(n.diagnostic);
    }
    if (n.value < 1) {
      return fail(
        runtimeDiag.randomBelowMinimum(nNode.source_span, { value: n.value }),
      );
    }
    return ok(nextRandomInt(environment.randomNumberGenerator, 0, n.value - 1));
  }
  const lowNode = arg(node, 0);
  const highNode = arg(node, 1);
  const lowResult = evaluate(lowNode, environment);
  if (!lowResult.ok) {
    return lowResult;
  }
  const highResult = evaluate(highNode, environment);
  if (!highResult.ok) {
    return highResult;
  }
  const low = requireWholeNumber(
    lowResult.value,
    lowNode.source_span,
    "random",
  );
  if (!low.ok) {
    return fail(low.diagnostic);
  }
  const high = requireWholeNumber(
    highResult.value,
    highNode.source_span,
    "random",
  );
  if (!high.ok) {
    return fail(high.diagnostic);
  }
  if (low.value > high.value) {
    return fail(
      runtimeDiag.randomRangeReversed(node.source_span, {
        low: low.value,
        high: high.value,
      }),
    );
  }
  return ok(
    nextRandomInt(environment.randomNumberGenerator, low.value, high.value),
  );
}

// --- Comprehensions: map / filter / reduce (spec/execution-model.md:380-479, issue #105) ------
//
// Comprehensions are value-producing *expressions* usable anywhere an expression is
// (`spec/execution-model.md:380-384`), so — unlike a procedure body, which can contain arbitrary
// control flow and genuinely needs `execute-internal.ts`'s full `executeStatements` dispatcher —
// every spec worked example and acceptance criterion for a comprehension body is a single
// bracketed expression-block whose *last* statement supplies the result
// (`spec/execution-model.md:200-227`, the block-result rule). This module therefore evaluates a
// comprehension body itself, entirely self-contained, rather than adding a second
// `Environment`-threaded callback (mirroring `callProcedure`) purely to reach
// `execute-internal.ts`'s general statement dispatcher for a case with no current spec pressure —
// a deliberate, narrower scope than a procedure body's. A body may have leading statements too
// (an `Assign`, or an expression evaluated for effect and discarded, per the block-result rule);
// any OTHER leading statement kind (`If`/`While`/`Repeat`/`For`/`Forever`) is left unevaluated,
// mirroring {@link isSupportedExpression}'s own "defer to a future slice" convention, and in fact
// never reached: {@link isSupportedComprehensionBody} keeps such a body from being "supported" in
// the first place, so the whole comprehension is deferred rather than partially evaluated.

/** The Core primitives whose kind is Command (`spec/commands.md`) — mirrors the parser's static
 * checker's `checker-control-flow.ts` `CORE_COMMANDS` (issue #114) exactly, since `execute()`
 * never runs `check()` and this runtime copy is what actually classifies a comprehension body's
 * final statement as command-shaped (reports nothing) vs. reporter-shaped (reports a value) for
 * the block-result rule. Not re-exported by `@openlogo/parser`, so duplicated here rather than
 * imported. */
const COMPREHENSION_COMMAND_NAMES: ReadonlySet<string> = new Set([
  "print",
  "show",
  "randomize",
]);

/**
 * `ExpressionNode.kind`s a comprehension body statement may be while still counting as
 * "value-producing" for the block-result rule — mirrors the checker's `VALUE_PRODUCING_KINDS`
 * (issue #114) exactly, minus `IsPredicate` (not yet implemented by {@link evaluate}, so never
 * reachable here — {@link isSupportedExpression} already excludes it).
 */
const VALUE_PRODUCING_STATEMENT_KINDS: ReadonlySet<string> = new Set([
  "NumberLit",
  "WordLit",
  "BooleanLit",
  "ListLit",
  "VarRef",
  "Place",
  "ComparisonChain",
  "Comprehension",
]);

/** Narrow `statement` to the `ExpressionNode` it also is, or `undefined` when it is a statement
 * kind with no expression counterpart (`If`/`While`/`Repeat`/`For`/`Forever`/`ProcedureDef`). A
 * `Call`/`ParenCall` is always narrowed — whether it is value-producing (a reporter) or not (a
 * Core command) is a separate question {@link isValueProducingStatement} answers. */
function asExpressionStatement(
  statement: StatementNode,
): ExpressionNode | undefined {
  if (
    VALUE_PRODUCING_STATEMENT_KINDS.has(statement.kind) ||
    statement.kind === "Call" ||
    statement.kind === "ParenCall"
  ) {
    return statement as ExpressionNode;
  }
  return undefined;
}

/**
 * Does `statement` produce a value the surrounding block-result rule can use? Mirrors the
 * checker's `producesValue` (`checker-control-flow.ts`, issue #114) exactly: a `Call`/`ParenCall`
 * produces a value unless its callee is a known Core command (`print`/`show`/`randomize`); every
 * other {@link VALUE_PRODUCING_STATEMENT_KINDS} kind always does.
 */
function isValueProducingStatement(statement: StatementNode): boolean {
  if (statement.kind === "Call" || statement.kind === "ParenCall") {
    return !COMPREHENSION_COMMAND_NAMES.has(
      statement.callee.name.toLowerCase(),
    );
  }
  return VALUE_PRODUCING_STATEMENT_KINDS.has(statement.kind);
}

/**
 * Is `statement` a leading (non-final) comprehension body statement this evaluator can run?
 * `Return`/`Stop` are structurally supported (they become `ol-return-in-comprehension` when
 * actually reached, in {@link runComprehensionBody} — not silently deferred); `Assign` is always
 * supported (the assignment target/value that are not yet implemented are themselves silently
 * no-ops, per {@link executeAssign}'s own convention); any expression-shaped statement is
 * supported when {@link isSupportedExpression} says so. Anything else (`If`/`While`/`Repeat`/
 * `For`/`Forever`/`ProcedureDef`) is not.
 */
function isSupportedLeadingBodyStatement(
  statement: StatementNode,
  procedures: ProcedureRegistry,
): boolean {
  if (
    statement.kind === "Return" ||
    statement.kind === "Stop" ||
    statement.kind === "Assign"
  ) {
    return true;
  }
  const expression = asExpressionStatement(statement);
  return (
    expression !== undefined && isSupportedExpression(expression, procedures)
  );
}

/**
 * Is `statement` a final comprehension body statement this evaluator can run? `Return`/`Stop` are
 * structurally supported (as above). A `print`/`show`/`randomize` call is also structurally
 * supported even though {@link evaluate} never gives it a value — {@link runComprehensionBody}
 * correctly turns it into `ol-no-value` (it is command-shaped, not a not-yet-implemented shape),
 * reproducing the spec's own worked example `map num in :nums [ print :num ]` → `ol-no-value`.
 * Any other expression-shaped statement is supported when {@link isSupportedExpression} says so.
 */
function isSupportedFinalBodyStatement(
  statement: StatementNode,
  procedures: ProcedureRegistry,
): boolean {
  if (statement.kind === "Return" || statement.kind === "Stop") {
    return true;
  }
  if (
    (statement.kind === "Call" || statement.kind === "ParenCall") &&
    COMPREHENSION_COMMAND_NAMES.has(statement.callee.name.toLowerCase())
  ) {
    return statement.args.every((argument) =>
      isSupportedExpression(argument, procedures),
    );
  }
  const expression = asExpressionStatement(statement);
  return (
    expression !== undefined && isSupportedExpression(expression, procedures)
  );
}

/**
 * Is every statement of a comprehension `body` one {@link runComprehensionBody} can actually run
 * — every leading statement per {@link isSupportedLeadingBodyStatement}, and the last (if any) per
 * {@link isSupportedFinalBodyStatement}? An empty body is vacuously supported: it always yields
 * `ol-no-value` once evaluated, never an internal invariant violation. Kept in exact lock-step
 * with {@link runComprehensionBody}'s own statement handling so `isSupportedExpression` never
 * reports a comprehension "supported" only for evaluation to then hit an unimplemented shape.
 */
function isSupportedComprehensionBody(
  body: BlockNode,
  procedures: ProcedureRegistry,
): boolean {
  const statements = body.body;
  if (statements.length === 0) {
    return true;
  }
  const last = statements[statements.length - 1] as StatementNode;
  return (
    statements
      .slice(0, -1)
      .every((statement) =>
        isSupportedLeadingBodyStatement(statement, procedures),
      ) && isSupportedFinalBodyStatement(last, procedures)
  );
}

/**
 * The outcome of running a comprehension body: a value (its last statement was value-producing),
 * `"no-value"` (the last statement was not — `ol-no-value` at the whole comprehension's span), an
 * escaping `return`/`stop` (`ol-return-in-comprehension` at the control word's own span — this
 * code wins over `ol-return-outside-proc`/`ol-stop-outside-proc` even when the comprehension is
 * itself inside a procedure, mirroring `checker-control-flow.ts`'s `escapeDiagnostic`), or a halt
 * (a diagnostic propagated from evaluating a statement).
 */
type ComprehensionBodyOutcome =
  | { readonly kind: "value"; readonly value: OLValue }
  | { readonly kind: "no-value" }
  | {
      readonly kind: "escape";
      readonly keyword: "return" | "output" | "op" | "stop";
      readonly source_span: SourceSpan;
    }
  | { readonly kind: "halt"; readonly diagnostic: Diagnostic };

/**
 * Run one comprehension body against the per-element/accumulator {@link Environment} its caller
 * already pushed a fresh frame onto ({@link pushLoopFrame}). Leading statements run for effect
 * only (their value, if any, is discarded); the final statement supplies the body's result, per
 * the block-result rule (`spec/execution-model.md:200-227`). The caller ({@link
 * evaluateComprehension}) only ever calls this once {@link isSupportedComprehensionBody} has
 * confirmed every statement is one of the shapes handled below, so there is no "unimplemented
 * shape" fallback here to keep in sync separately.
 */
function runComprehensionBody(
  body: BlockNode,
  environment: Environment,
): ComprehensionBodyOutcome {
  const statements = body.body;
  if (statements.length === 0) {
    return { kind: "no-value" };
  }

  for (let index = 0; index < statements.length - 1; index++) {
    const statement = statements[index] as StatementNode;
    if (statement.kind === "Return") {
      return {
        kind: "escape",
        keyword: statement.keyword,
        source_span: statement.source_span,
      };
    }
    if (statement.kind === "Stop") {
      return {
        kind: "escape",
        keyword: "stop",
        source_span: statement.source_span,
      };
    }
    if (statement.kind === "Assign") {
      const result = executeAssign(statement, environment);
      if (!result.ok) {
        return { kind: "halt", diagnostic: result.diagnostic };
      }
      continue;
    }
    const expression = asExpressionStatement(statement) as ExpressionNode;
    const result = evaluate(expression, environment);
    if (!result.ok) {
      return { kind: "halt", diagnostic: result.diagnostic };
    }
  }

  const last = statements[statements.length - 1] as StatementNode;
  if (last.kind === "Return") {
    return {
      kind: "escape",
      keyword: last.keyword,
      source_span: last.source_span,
    };
  }
  if (last.kind === "Stop") {
    return { kind: "escape", keyword: "stop", source_span: last.source_span };
  }
  if (!isValueProducingStatement(last)) {
    return { kind: "no-value" };
  }
  const expression = asExpressionStatement(last) as ExpressionNode;
  const result = evaluate(expression, environment);
  if (!result.ok) {
    return { kind: "halt", diagnostic: result.diagnostic };
  }
  return { kind: "value", value: result.value };
}

/** Turn a {@link ComprehensionBodyOutcome} into the {@link EvalResult} `evaluateComprehension`
 * reports for one element/fold step. */
function comprehensionBodyResult(
  outcome: ComprehensionBodyOutcome,
  node: ComprehensionNode,
): EvalResult {
  switch (outcome.kind) {
    case "value":
      return ok(outcome.value);
    case "no-value":
      return fail(runtimeDiag.noValue(node.source_span, node.form));
    case "escape":
      return fail(
        runtimeDiag.returnInComprehension(
          outcome.source_span,
          outcome.keyword,
          node.form,
        ),
      );
    case "halt":
      return fail(outcome.diagnostic);
  }
}

/**
 * The `ol-duplicate-binder` a comprehension's own binders raise before any element is ever
 * bound — a static property of the comprehension's shape, checked once rather than per element.
 * Mirrors `checker-control-flow.ts`'s two rules (issue #114) exactly: a repeated name within one
 * destructuring item-binder pattern (`form: "destructuring"`), or — `reduce` only, and only when
 * the item binder is a bare name, not a pattern — the accumulator name colliding with the item
 * binder's own name (`form: "reduce"`; an accumulator-vs-pattern-name collision is out of scope,
 * matching the checker's own documented boundary).
 */
function comprehensionDuplicateBinder(
  node: ComprehensionNode,
): Diagnostic | undefined {
  if ("kind" in node.binder) {
    const duplicate = findDuplicateBinderName(node.binder);
    return duplicate === undefined
      ? undefined
      : runtimeDiag.duplicateBinder(
          duplicate.source_span,
          duplicate.name,
          "destructuring",
        );
  }
  if (
    node.form === "reduce" &&
    node.accumulator.name.toLowerCase() === node.binder.name.toLowerCase()
  ) {
    return runtimeDiag.duplicateBinder(
      node.binder.source_span,
      node.binder.name,
      "reduce",
    );
  }
  return undefined;
}

/**
 * Evaluate a `map`/`filter`/`reduce` comprehension (`spec/execution-model.md:380-479`, worked
 * examples `:695-741`): binder-duplicate check first ({@link comprehensionDuplicateBinder}), then
 * the iterable (must be a list — `ol-type` otherwise, mirroring `ForIn`'s own `forInNotList`),
 * then one {@link runComprehensionBody} pass per element (each in its own fresh body-local frame,
 * {@link pushLoopFrame}) — collecting every body value for `map`, keeping elements whose boolean
 * body value is `true` for `filter` (`ol-not-boolean` for a non-boolean body value), or folding
 * into an accumulator seeded by `initial` for `reduce` (returned unchanged when `elements` is
 * empty, `spec/execution-model.md:402`).
 */
function evaluateComprehension(
  node: ComprehensionNode,
  environment: Environment,
): EvalResult {
  const duplicate = comprehensionDuplicateBinder(node);
  if (duplicate !== undefined) {
    return fail(duplicate);
  }

  const iterableResult = evaluate(node.iterable, environment);
  if (!iterableResult.ok) {
    return iterableResult;
  }
  if (!Array.isArray(iterableResult.value)) {
    return fail(
      runtimeDiag.comprehensionNotList(node.iterable.source_span, {
        actual: typeNameOf(iterableResult.value),
        value: iterableResult.value,
        operation: node.form,
      }),
    );
  }
  const elements = iterableResult.value;

  if (node.form === "reduce") {
    const initialResult = evaluate(node.initial, environment);
    if (!initialResult.ok) {
      return initialResult;
    }
    let accumulator = initialResult.value;
    for (const element of elements) {
      const limitDiagnostic = checkExecutionLimits(
        environment,
        node.source_span,
      );
      if (limitDiagnostic) {
        return fail(limitDiagnostic);
      }
      const bound = bindElement(node.binder, element);
      if (!bound.ok) {
        return fail(bound.diagnostic);
      }
      const bindings = new Map(bound.bindings);
      bindings.set(node.accumulator.name, accumulator);
      const outcome = runComprehensionBody(
        node.body,
        pushLoopFrame(environment, bindings),
      );
      const stepResult = comprehensionBodyResult(outcome, node);
      if (!stepResult.ok) {
        return stepResult;
      }
      accumulator = stepResult.value;
    }
    return ok(accumulator);
  }

  const results: OLValue[] = [];
  for (const element of elements) {
    const limitDiagnostic = checkExecutionLimits(environment, node.source_span);
    if (limitDiagnostic) {
      return fail(limitDiagnostic);
    }
    const bound = bindElement(node.binder, element);
    if (!bound.ok) {
      return fail(bound.diagnostic);
    }
    const outcome = runComprehensionBody(
      node.body,
      pushLoopFrame(environment, bound.bindings),
    );
    const stepResult = comprehensionBodyResult(outcome, node);
    if (!stepResult.ok) {
      return stepResult;
    }
    if (node.form === "map") {
      results.push(stepResult.value);
      continue;
    }
    if (typeof stepResult.value !== "boolean") {
      return fail(
        runtimeDiag.notBoolean(node.body.source_span, {
          actual: typeNameOf(stepResult.value),
          operation: "filter",
        }),
      );
    }
    if (stepResult.value) {
      results.push(element);
    }
  }
  return ok(results);
}
