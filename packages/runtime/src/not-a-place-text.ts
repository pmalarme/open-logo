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
  BooleanLitNode,
  CallNode,
  ExpressionNode,
  ListLitNode,
  NumberLitNode,
  ParenCallNode,
  PlaceNode,
  VarRefNode,
  WordLitNode,
} from "@openlogo/parser";

/**
 * Every expression kind the parser can build in non-place assignment-target position, or nest
 * inside one as a call argument/list element/postfix selector key — the runtime's copy of
 * `checker-not-a-place.ts`'s `RenderableNode` (see that module's doc comment for why this set is
 * closed to exactly these eight kinds).
 */
export type RenderableNode =
  | NumberLitNode
  | WordLitNode
  | BooleanLitNode
  | VarRefNode
  | PlaceNode
  | ListLitNode
  | CallNode
  | ParenCallNode;

/** Renders a nested expression (a call argument or a list element). See {@link RenderableNode}. */
function renderChild(node: ExpressionNode): string {
  return renderNode(node as RenderableNode);
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

/** Renders a postfixed place `:base.field[key]` in its own surface spelling. */
function renderPlace(node: PlaceNode): string {
  const segments = node.segments
    .map((segment) =>
      segment.kind === "field"
        ? `.${segment.name.name}`
        : `[${renderChild(segment.key)}]`,
    )
    .join("");
  return `:${node.base.name}${segments}`;
}

/** Renders a `Call`/`ParenCall`'s callee and arguments in prefix form: `name arg1 arg2`. */
function renderPrefixCall(node: CallNode | ParenCallNode): string {
  const args = node.args.map(renderChild).join(" ");
  return args === "" ? node.callee.name : `${node.callee.name} ${args}`;
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
    case "ListLit":
      return `[${node.elements.map(renderChild).join(" ")}]`;
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
