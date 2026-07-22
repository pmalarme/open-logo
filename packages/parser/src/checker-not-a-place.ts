/**
 * The `ol-not-a-place` semantic rule (issues #79/#113): the target of `=` or `set … to` must be
 * an assignable place. The parser keeps a well-formed target as a {@link PlaceNode}, but it also
 * structurally accepts a reporter/command call or a bare literal/list in target position —
 * `first :x = 5`, `count :nums = 3`, `3 = 5` — so this rule can explain the mistake with the exact
 * shape the spec's worked example mandates instead of a blunt parse error
 * (`spec/error-model.md`, `spec/tooling.md:213-219`).
 *
 * `spec/tooling.md:213-219` mandates `count :nums = 3` → `ol-not-a-place`,
 * `params: { text: "count :nums" }` — the FULL target surface text, not just the callee name.
 *
 * Two text-recovery paths, in priority order:
 *
 * 1. **Source slicing** ({@link sliceSourceSpan}) — when {@link check}'s caller supplies the
 *    original `source` text (the conformance harness and every real production caller do), the
 *    target's own `source_span` is sliced directly out of it. This is exact for *any* target
 *    shape — nested `Place` arguments, parenthesized sub-expressions, infix operator calls such
 *    as `1 + 2` (which parse as a `Call` with callee `"+"`, prefix-shaped in the AST but written
 *    infix in source) — because it reads what the learner actually typed instead of
 *    reconstructing it.
 * 2. **AST reconstruction** ({@link renderNode}) — the fallback when no `source` is available
 *    (e.g. a caller that only has a `ProgramNode`, as `check()`'s own pre-#113 unit tests did).
 *    It handles every node kind the parser can build in target position, including a nested
 *    {@link PlaceNode} argument. It also recognizes the fixed set of two-argument operator
 *    callees the parser only ever builds infix (`+ - * / mod == != < > <= >=`/`and`/`or` —
 *    `parser.ts`'s `parseOr`/`parseAnd`/`parseComparison`/`parseAdditive`/`parseMultiplicative`)
 *    and renders those infix (`"1 + 2"`, not `"+ 1 2"`), and wraps a `ParenCall` target back in
 *    its own parentheses (`"(first :x)"`), so both text-recovery paths agree exactly for every
 *    target shape the parser can build — not just the ones that happen to already look the same
 *    prefix or infix.
 */

import type { Diagnostic, SourceSpan } from "@openlogo/core";
import type {
  AnyNode,
  AssignNode,
  BooleanLitNode,
  CallNode,
  DictEntryNode,
  DictLitNode,
  ExpressionNode,
  ListLitNode,
  NumberLitNode,
  ParenCallNode,
  PlaceNode,
  PostfixExpressionNode,
  ProgramNode,
  VarRefNode,
  WordLitNode,
} from "./ast.js";
import { walk } from "./ast.js";
import type { CheckProfile } from "./check.js";

function isAssign(node: AnyNode): node is AssignNode {
  return node.kind === "Assign";
}

/**
 * Every expression kind the parser can build in non-place assignment-target position, or nest
 * inside one as a call argument/list element/dict entry value/postfix base/postfix selector key:
 * `spec/grammar.md:244-258` and the `AssignNode` doc comment in `ast.ts` together close this to
 * exactly these ten kinds — a comparison chain, `is`-predicate, or comprehension never appears
 * there, so {@link renderNode} does not need to (and — for 100% branch/function coverage —
 * must not) handle them. `DictLitNode` joined this set with `PostfixExpressionNode` (issue
 * #407/F7): a postfix read's base can be any primary, including a dict literal (`{tom: 8}.tom`).
 */
type RenderableNode =
  | NumberLitNode
  | WordLitNode
  | BooleanLitNode
  | VarRefNode
  | PlaceNode
  | PostfixExpressionNode
  | ListLitNode
  | DictLitNode
  | CallNode
  | ParenCallNode;

/** Renders a nested expression (a call argument or a list element). See {@link RenderableNode}. */
function renderChild(node: ExpressionNode): string {
  return renderNode(node as RenderableNode);
}

/**
 * The two-argument operator callees `parser.ts` only ever builds infix — `parseOr`/`parseAnd`
 * (`and`/`or`), `parseComparison` (`== != < > <= >=`), `parseAdditive` (`+ -`), and
 * `parseMultiplicative` (`* /`/`mod`). None of these names can also be a user-defined or Core
 * primitive callee (the symbols are `op`-kind tokens, and `and`/`or`/`mod` are reserved words), so
 * a two-argument `Call` with one of these callee names is unambiguously an infix operator and
 * never a genuine prefix call that merely happens to take two arguments.
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
 * `(point 0 0).x` (issue #407/F7) — never itself a valid place, so it only ever appears here as a
 * non-place assignment target.
 */
function renderPostfixExpression(node: PostfixExpressionNode): string {
  return `${renderChild(node.base)}${renderSegments(node.segments)}`;
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

/**
 * Reconstructs the surface text of a non-place assignment target, for the `text` param. This is
 * the fallback path used only when {@link check} has no `source` text to slice from.
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

/** The learner-facing message template for a non-place used as an assignment target. */
function messageFor(text: string): string {
  return `${text} is a value, not a place you can change.`;
}

/**
 * The `ol-not-a-place` rule: every assignment whose target is not a `Place` raises one diagnostic
 * at the target's span, with its exact surface text carried as the `text` param
 * (`spec/tooling.md:213-219`). Prefers slicing `source` (exact for any shape); falls back to
 * reconstructing the text from the AST when no `source` is available — see the module doc
 * comment.
 */
export function notAPlaceRule(
  program: ProgramNode,
  _profiles: readonly CheckProfile[],
  source?: string,
): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  walk(program, (node) => {
    if (!isAssign(node)) {
      return;
    }
    const target = node.place;
    if (target.kind === "Place") {
      return;
    }
    const text =
      source !== undefined
        ? sliceSourceSpan(source, target.source_span)
        : // The parser only ever builds a non-place assignment target as one of
          // `RenderableNode`'s kinds — see that type's doc comment — so this cast documents the
          // invariant instead of widening `renderNode` to the full `ExpressionNode` union.
          renderNode(target as RenderableNode);
    diagnostics.push({
      code: "ol-not-a-place",
      source_span: target.source_span,
      params: { text },
      message: messageFor(text),
      stage: "semantic",
      severity: "error",
    });
  });

  return diagnostics;
}
