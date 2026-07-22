/**
 * The `ol-not-a-place` target-text derivation shared by the runtime's own `executeAssign` guard
 * (issue #94/#156) — mirrors the semantic checker's identical rule
 * (`packages/parser/src/checker-not-a-place.ts`, issue #79/#113) so both stages report the FULL
 * target surface text (`spec/tooling.md:213-219`'s worked example: `count :nums = 3` →
 * `{text:"count :nums"}`), not just the offending callee's name. Deliberately duplicated rather
 * than imported: `checker-not-a-place.ts`'s renderer is a parser-internal module, not part of
 * `@openlogo/parser`'s public `index.ts` surface, so the runtime cannot depend on its internals
 * without crossing the package boundary (`spec-fidelity`/`ts7-package` conventions) — this module
 * keeps the two implementations byte-for-byte identical by construction instead.
 *
 * Two text-recovery paths, in priority order, exactly matching the checker's:
 *
 * 1. **Source slicing** ({@link sliceSourceSpan}) — when the caller has the original `source`
 *    text (`execute()`/`runProgram` always does), the target's own `source_span` is sliced
 *    directly out of it. Exact for any target shape, including infix operator calls
 *    (`1 + 2` parses as a `Call` with callee `"+"`, prefix-shaped in the AST but written infix in
 *    source).
 * 2. **AST reconstruction** ({@link renderNode}) — the fallback when no `source` is available
 *    (e.g. this package's own unit tests that hand-build an `Environment` via
 *    `createEnvironment()`, which carries no `source`).
 */

import type { SourceSpan } from "@openlogo/core";
import type {
  Binder,
  BlockNode,
  CallNode,
  ComparisonChainNode,
  ComprehensionNode,
  DictEntryNode,
  DictLitNode,
  ExpressionNode,
  IsPredicateNode,
  IsTest,
  ParenCallNode,
  PlaceNode,
  PostfixExpressionNode,
  SpannedName,
  StatementNode,
  ValueOfKeyNode,
} from "@openlogo/parser";

/**
 * Every expression kind the parser can build in non-place assignment-target position, or nest
 * inside one as a call argument/list element/dict entry value/postfix base/postfix selector key —
 * the runtime's copy of `checker-not-a-place.ts`'s `RenderableNode`: exactly `ExpressionNode`,
 * kept exhaustive by `renderNode`'s switch (see that module's doc comment).
 */
export type RenderableNode = ExpressionNode;

/** Renders a nested expression (a call argument or a list element). See {@link RenderableNode}. */
function renderChild(node: ExpressionNode): string {
  return renderNode(node);
}

/**
 * The two-argument operator callees the parser only ever builds infix — see
 * `checker-not-a-place.ts`'s identical constant for the full rationale.
 */
const INFIX_OPERATORS: ReadonlySet<string> = new Set([
  "+",
  "-",
  "*",
  "/",
  "mod",
  "==",
  "!=",
  "<",
  ">",
  "<=",
  ">=",
  "and",
  "or",
]);

/** Whether a `Call` node is one of the fixed infix operator forms (see {@link INFIX_OPERATORS}). */
function isInfixOperatorCall(node: CallNode): boolean {
  return node.args.length === 2 && INFIX_OPERATORS.has(node.callee.name);
}

/** Renders the shared `.field[key]` postfix segment suffix of a `Place`/`PostfixExpression`. */
function renderSegments(segments: PlaceNode["segments"]): string {
  return segments
    .map((segment) =>
      segment.kind === "field"
        ? `.${segment.name.name}`
        : `[${renderChild(segment.key)}]`,
    )
    .join("");
}

/** Renders a postfixed place `:base.field[key]` in its own surface spelling. */
function renderPlace(node: PlaceNode): string {
  return `:${node.base.name}${renderSegments(node.segments)}`;
}

/**
 * Renders a postfix read over an arbitrary primary — `[1 2][1]`, `{tom: 8}.tom`,
 * `(point 0 0).x`, `(1 + 2).x`, `((1 + 2)).x` (issue #407/F7) — never itself a valid place, so it
 * only ever appears here as a non-place assignment target. `parenGroupCount` re-adds every level
 * of bare-grouping `( … )` the surface source wrapped `base` in (`ast.ts`'s `PostfixExpressionNode`
 * doc comment).
 */
function renderPostfixExpression(node: PostfixExpressionNode): string {
  const base = renderChild(node.base);
  const baseText = `${"(".repeat(node.parenGroupCount)}${base}${")".repeat(node.parenGroupCount)}`;
  return `${baseText}${renderSegments(node.segments)}`;
}

/** Renders a dict-entry key (`spec/grammar.md`'s `dict-key`) — always bare, never quoted. */
function renderDictKey(key: DictEntryNode["key"]): string {
  return key.kind === "WordLit" ? key.value : String(key.value);
}

/** Renders a dict literal `{ key: value … }` (Data profile), an empty one as `{ }`. */
function renderDictLit(node: DictLitNode): string {
  if (node.entries.length === 0) {
    return "{ }";
  }
  const entries = node.entries
    .map((entry) => `${renderDictKey(entry.key)}: ${renderChild(entry.value)}`)
    .join(" ");
  return `{ ${entries} }`;
}

/** Renders a `Call`/`ParenCall`'s callee and arguments in prefix form: `name arg1 arg2`. */
function renderPrefixCall(node: CallNode | ParenCallNode): string {
  const args = node.args.map(renderChild).join(" ");
  return args === "" ? node.callee.name : `${node.callee.name} ${args}`;
}

/** Renders a comprehension binder: a bare name, or a destructuring `[ :a :b ]` pattern. */
function renderBinder(binder: Binder): string {
  return "kind" in binder
    ? `[ ${binder.names.map((name) => `:${name.name}`).join(" ")} ]`
    : binder.name;
}

/**
 * The set of `StatementNode` kinds that are also {@link ExpressionNode} kinds — i.e. a bare
 * expression used as a statement. Used to recognize a comprehension body's common,
 * spec-conventional shape: a single bracketed expression, no lambda.
 */
const EXPRESSION_STATEMENT_KINDS: ReadonlySet<string> = new Set([
  "NumberLit",
  "WordLit",
  "BooleanLit",
  "ListLit",
  "DictLit",
  "ValueOfKey",
  "VarRef",
  "Place",
  "PostfixExpression",
  "Call",
  "ParenCall",
  "ComparisonChain",
  "IsPredicate",
  "Comprehension",
]);

/** Whether a statement is a bare expression (see {@link EXPRESSION_STATEMENT_KINDS}). */
function isExpressionStatement(
  statement: StatementNode,
): statement is ExpressionNode {
  return EXPRESSION_STATEMENT_KINDS.has(statement.kind);
}

/**
 * Renders a comprehension body block. `map`/`filter`/`reduce` bodies are, by spec convention, a
 * single bracketed expression (no lambda), so a one-statement expression body renders that
 * expression exactly; any other shape renders as a bounded placeholder instead of risking a full
 * statement-level unparser here — see `checker-not-a-place.ts`'s identical helper.
 */
function renderComprehensionBody(body: BlockNode): string {
  if (body.body.length === 1) {
    const [statement] = body.body as readonly [StatementNode];
    if (isExpressionStatement(statement)) {
      return renderChild(statement);
    }
  }
  return "…";
}

/** Renders a `map`/`filter`/`reduce` comprehension (issue #407/F7 postfix base). */
function renderComprehension(node: ComprehensionNode): string {
  const binderText = renderBinder(node.binder);
  const bodyText = renderComprehensionBody(node.body);
  if (node.form === "reduce") {
    return `reduce ${node.accumulator.name} ${binderText} in ${renderChild(node.iterable)} from ${renderChild(node.initial)} [ ${bodyText} ]`;
  }
  return `${node.form} ${binderText} in ${renderChild(node.iterable)} [ ${bodyText} ]`;
}

/** Renders the tail of a worded `is`-predicate (`spec/grammar.md`'s `is-test`). */
function renderIsTest(test: IsTest): string {
  switch (test.form) {
    case "empty":
      return "is empty";
    case "member-of":
      return `is member of ${renderChild(test.collection)}`;
    case "a":
      return `is a ${renderChild(test.type)}`;
    case "between":
      return `is ${test.strict ? "strictly " : ""}between ${renderChild(test.low)} and ${renderChild(test.high)}`;
  }
}

/** Renders a worded `is`-predicate such as `:x is empty` or `:n is between 1 and 10`. */
function renderIsPredicate(node: IsPredicateNode): string {
  return `${renderChild(node.operand)} ${renderIsTest(node.test)}`;
}

/**
 * Renders a comparison chain `1 < :x < 10` — each operand once, operators interleaved
 * (`ast.ts`'s `ComparisonChainNode` doc comment).
 */
function renderComparisonChain(node: ComparisonChainNode): string {
  const parts: string[] = [renderChild(node.operands[0] as ExpressionNode)];
  for (let index = 0; index < node.operators.length; index += 1) {
    const operator = node.operators[index] as SpannedName;
    const operand = node.operands[index + 1] as ExpressionNode;
    parts.push(operator.name, renderChild(operand));
  }
  return parts.join(" ");
}

/** Renders a `value of <dictionary> for key <key>` reader (issue #407/F7 postfix base). */
function renderValueOfKey(node: ValueOfKeyNode): string {
  return `value of ${renderChild(node.dictionary)} for key ${renderChild(node.key)}`;
}

/**
 * Reconstructs the surface text of a non-place assignment target, for the `text` param. This is
 * the fallback path used only when no `source` text is available to slice from.
 */
function renderNode(node: RenderableNode): string {
  switch (node.kind) {
    case "NumberLit":
      return String(node.value);
    case "WordLit":
      return `"${node.value}"`;
    case "BooleanLit":
      return String(node.value);
    case "VarRef":
      return `:${node.name}`;
    case "Place":
      return renderPlace(node);
    case "PostfixExpression":
      return renderPostfixExpression(node);
    case "ListLit":
      return `[${node.elements.map(renderChild).join(" ")}]`;
    case "DictLit":
      return renderDictLit(node);
    case "ValueOfKey":
      return renderValueOfKey(node);
    case "ComparisonChain":
      return renderComparisonChain(node);
    case "IsPredicate":
      return renderIsPredicate(node);
    case "Comprehension":
      return renderComprehension(node);
    case "Call":
      // A two-argument call to one of the fixed infix operator names is always infix in
      // source — see INFIX_OPERATORS — everything else (including a zero/one/three-or-more
      // argument call) renders prefix.
      if (isInfixOperatorCall(node)) {
        const [left, right] = node.args as readonly [
          ExpressionNode,
          ExpressionNode,
        ];
        return `${renderChild(left)} ${node.callee.name} ${renderChild(right)}`;
      }
      return renderPrefixCall(node);
    case "ParenCall":
      // A ParenCall only ever comes from the explicitly parenthesized `( … )` surface form, so
      // its rendering always re-wraps the parens the source had.
      return `(${renderPrefixCall(node)})`;
  }
}

/**
 * Slices the exact text `span` covers out of `source`, using its 1-based, half-open
 * `[start, end)` line/column range (`@openlogo/core`'s `SourceSpan`). Exact for any target shape,
 * since it reads the learner's own surface spelling instead of reconstructing it from the AST.
 */
function sliceSourceSpan(source: string, span: SourceSpan): string {
  const lines = source.split("\n");
  const [startLine, startColumn] = span.start;
  const [endLine, endColumn] = span.end;
  // A span's line numbers are always within `[1, lines.length]` — `noUncheckedIndexedAccess`
  // cannot correlate that invariant with an indexed access, so this documents it instead of
  // adding an unreachable fallback that would fail the 100% branch-coverage gate.
  const startText = lines[startLine - 1] as string;
  if (startLine === endLine) {
    return startText.slice(startColumn - 1, endColumn - 1);
  }
  const middle: string[] = [];
  for (let line = startLine + 1; line < endLine; line += 1) {
    middle.push(lines[line - 1] as string);
  }
  const endText = lines[endLine - 1] as string;
  return [
    startText.slice(startColumn - 1),
    ...middle,
    endText.slice(0, endColumn - 1),
  ].join("\n");
}

/**
 * The `ol-not-a-place` `text` param for `target` (any non-`Place` assignment target the parser
 * can build — a `Call`/`ParenCall`, or a bare `NumberLit`/`WordLit`/`BooleanLit`/`ListLit`): the
 * FULL target surface text, sliced from `source` when available, or reconstructed from the AST
 * otherwise. See this module's doc comment for the two-path priority.
 */
export function notAPlaceTargetText(
  target: RenderableNode,
  source: string | undefined,
): string {
  return source !== undefined
    ? sliceSourceSpan(source, target.source_span)
    : renderNode(target);
}
