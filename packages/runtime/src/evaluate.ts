/**
 * The expression evaluator: `.logo` AST expression nodes → runtime {@link OLValue}s. Issue #93
 * gives every Core literal a value and implements arithmetic (`+ - * / mod`) plus the Core math
 * builtins (`abs sqrt int round power`) from
 * [`spec/execution-model.md`](../../../spec/execution-model.md) and
 * [`spec/commands.md`](../../../spec/commands.md). {@link evaluate} is a plain recursive
 * dispatch over {@link ExpressionNode.kind} so the evaluator slices that follow (#94-#105 —
 * variables, comparisons, `is`-predicates, lists, comprehensions, …) each add one more `case`
 * without restructuring this function.
 *
 * `-3` is a negative *literal* (the reader already folds the sign into `NumberLitNode.value`,
 * per `spec/grammar.md:17,226`), never unary minus, so there is no negation case here — only
 * the binary `-` Call.
 *
 * Every operator/builtin does its own operand type-checking (`ol-type`) rather than sharing a
 * generic dispatcher, since each has its own arity and error semantics (e.g. only `sqrt` raises
 * `ol-neg-sqrt`, only `/`/`mod` raise `ol-div-zero`).
 */

import type { Diagnostic, OLValue, SourceSpan } from "@openlogo/core";
import { typeNameOf } from "@openlogo/core";
import type {
  CallNode,
  ComparisonChainNode,
  ExpressionNode,
  ParenCallNode,
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

type NumberOrDiagnostic =
  | { readonly ok: true; readonly value: number }
  | { readonly ok: false; readonly diagnostic: Diagnostic };

/** Require `value` to be a number (with word-that-reads-as-a-number coercion), or `ol-type`. */
function requireNumber(
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

/**
 * Does {@link evaluate} give `node` a value in this issue's scope? `execute()` uses this guard
 * to decide whether to evaluate a `print` argument at all: expression kinds and callees this
 * issue does not implement yet (`:x` variable reads, `is`-predicates, comprehensions, calls to
 * any command other than the arithmetic operators, math builtins, and comparison operators
 * below) are left untouched for their own future slice (#94-#105), never reaching
 * {@link evaluate}'s internal "not implemented yet" invariant checks. As of issue #96 a
 * {@link ComparisonChainNode} and the six comparison-operator calls (`== != < > <= >=`) are in
 * scope, so a comparison whose operands are all themselves supported is evaluated.
 */
export function isSupportedExpression(node: ExpressionNode): boolean {
  switch (node.kind) {
    case "NumberLit":
    case "WordLit":
    case "BooleanLit":
      return true;
    case "ListLit":
      return node.elements.every(isSupportedExpression);
    case "ComparisonChain":
      return node.operands.every(isSupportedExpression);
    case "Call":
    case "ParenCall": {
      const name = node.callee.name.toLowerCase();
      const isKnownCallee =
        isBinaryArithmeticOperator(name) ||
        isUnaryMathBuiltin(name) ||
        isBinaryMathBuiltin(name) ||
        isComparisonOperator(name);
      return isKnownCallee && node.args.every(isSupportedExpression);
    }
    default:
      return false;
  }
}

/** Evaluate one Core expression node to a runtime {@link OLValue}. */
export function evaluate(node: ExpressionNode): EvalResult {
  switch (node.kind) {
    case "NumberLit":
    case "WordLit":
    case "BooleanLit":
      return ok(node.value);
    case "ListLit": {
      const values: OLValue[] = [];
      for (const element of node.elements) {
        const result = evaluate(element);
        if (!result.ok) {
          return result;
        }
        values.push(result.value);
      }
      return ok(values);
    }
    case "Call":
    case "ParenCall":
      return evaluateCall(node);
    case "ComparisonChain":
      return evaluateComparisonChain(node);
    default:
      // VarRef, Place, IsPredicate, and Comprehension evaluation land with their own slices
      // (#94-#105); nothing in this issue's scope reaches them.
      throw new Error(
        `evaluate: "${node.kind}" is not implemented yet — it lands with its own evaluator slice`,
      );
  }
}

function evaluateCall(node: ArithmeticCallNode): EvalResult {
  const name = node.callee.name.toLowerCase();
  if (isBinaryArithmeticOperator(name)) {
    return evaluateBinaryArithmetic(node, name);
  }
  if (isUnaryMathBuiltin(name)) {
    return evaluateUnaryMath(node, name);
  }
  if (isBinaryMathBuiltin(name)) {
    return evaluateBinaryMath(node, name);
  }
  if (isComparisonOperator(name)) {
    return evaluateComparisonCall(node, name);
  }
  throw new Error(
    `evaluate: call to "${name}" is not implemented yet — it lands with its own evaluator slice`,
  );
}

function evaluateBinaryArithmetic(
  node: ArithmeticCallNode,
  operator: BinaryArithmeticOperator,
): EvalResult {
  const leftNode = arg(node, 0);
  const rightNode = arg(node, 1);

  const leftResult = evaluate(leftNode);
  if (!leftResult.ok) {
    return leftResult;
  }
  const rightResult = evaluate(rightNode);
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
): EvalResult {
  const argNode = arg(node, 0);
  const argResult = evaluate(argNode);
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
): EvalResult {
  const baseNode = arg(node, 0);
  const exponentNode = arg(node, 1);

  const baseResult = evaluate(baseNode);
  if (!baseResult.ok) {
    return baseResult;
  }
  const exponentResult = evaluate(exponentNode);
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

// --- Comparisons: equality (`== !=`), ordering (`< > <= >=`), and chains --------------------
//
// spec/execution-model.md:483-510. `==`/`!=` compare any two values to a boolean and never
// raise; ordering is defined only for two numbers or two words and raises `ol-type` otherwise.

/**
 * The canonical printed form of a number, used by number↔word equality
 * (`spec/execution-model.md:19,498-500`): whole values print without a decimal, non-whole values
 * are trimmed to at most 10 significant digits. So `5 == "5"` is `true`, `5 == "05"` is `false`
 * (5 prints as `"5"`, not `"05"`), and a word carrying more than 10 significant digits cannot
 * equal the number it looks like. `toPrecision(10)` rounds a non-whole value to 10 significant
 * digits and re-parsing drops the trailing zeros it introduces; a whole value keeps its full
 * integer form. (Full `print` formatting is issue #98; when it lands it becomes the single source
 * of this rule.)
 */
function canonicalNumberWord(value: number): string {
  if (Number.isInteger(value)) {
    return String(value);
  }
  return String(Number(value.toPrecision(10)));
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
      return canonicalNumberWord(a) === b;
    }
    return false;
  }
  if (typeof a === "string") {
    if (typeof b === "string") {
      return a === b;
    }
    if (typeof b === "number") {
      return canonicalNumberWord(b) === a;
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
): EvalResult {
  const leftNode = arg(node, 0);
  const rightNode = arg(node, 1);

  const leftResult = evaluate(leftNode);
  if (!leftResult.ok) {
    return leftResult;
  }
  const rightResult = evaluate(rightNode);
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
function evaluateComparisonChain(node: ComparisonChainNode): EvalResult {
  const firstNode = node.operands[0] as ExpressionNode;
  const firstResult = evaluate(firstNode);
  if (!firstResult.ok) {
    return firstResult;
  }
  let leftNode = firstNode;
  let left = firstResult.value;

  for (let i = 0; i < node.operators.length; i++) {
    const rightNode = node.operands[i + 1] as ExpressionNode;
    const rightResult = evaluate(rightNode);
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
