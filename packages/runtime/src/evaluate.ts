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
import type { CallNode, ExpressionNode, ParenCallNode } from "@openlogo/parser";
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

/**
 * Does {@link evaluate} give `node` a value in this issue's scope? `execute()` uses this guard
 * to decide whether to evaluate a `print` argument at all: expression kinds and callees this
 * issue does not implement yet (`:x`, comparisons, `is`-predicates, comprehensions, calls to any
 * command other than the arithmetic operators/math builtins below) are left untouched for their
 * own future slice (#94-#105), never reaching {@link evaluate}'s internal "not implemented yet"
 * invariant checks.
 */
export function isSupportedExpression(node: ExpressionNode): boolean {
  switch (node.kind) {
    case "NumberLit":
    case "WordLit":
    case "BooleanLit":
      return true;
    case "ListLit":
      return node.elements.every(isSupportedExpression);
    case "Call":
    case "ParenCall": {
      const name = node.callee.name.toLowerCase();
      const isKnownCallee =
        isBinaryArithmeticOperator(name) ||
        isUnaryMathBuiltin(name) ||
        isBinaryMathBuiltin(name);
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
    default:
      // VarRef, Place, ComparisonChain, IsPredicate, and Comprehension evaluation land with
      // their own slices (#94-#105); nothing in this issue's scope reaches them.
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
