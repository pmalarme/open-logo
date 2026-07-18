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
 *    {@link PlaceNode} argument, but renders every call — including infix operators like `+` —
 *    in the AST's own prefix shape (`"+ 1 2"` rather than `"1 + 2"`). Callers who need exact
 *    surface text for every target shape should pass `source`; this fallback exists so `check()`
 *    still produces a *reasonable* (if not always literal) `text` when it cannot.
 */

import type { Diagnostic, SourceSpan } from "@openlogo/core";
import type {
  AnyNode,
  AssignNode,
  BooleanLitNode,
  CallNode,
  ExpressionNode,
  ListLitNode,
  NumberLitNode,
  ParenCallNode,
  PlaceNode,
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
 * inside one as a call argument/list element/postfix selector key: `spec/grammar.md:244-258` and
 * the `AssignNode` doc comment in `ast.ts` together close this to exactly these eight kinds — a
 * comparison chain, `is`-predicate, or comprehension never appears there, so {@link renderNode}
 * does not need to (and — for 100% branch/function coverage — must not) handle them.
 */
type RenderableNode =
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

/**
 * Reconstructs the surface text of a non-place assignment target, for the `text` param. This is
 * the fallback path used only when {@link check} has no `source` text to slice from — see the
 * module doc comment for its known limitation (infix operator calls render in prefix form).
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
    case "ParenCall": {
      const args = node.args.map(renderChild).join(" ");
      return args === "" ? node.callee.name : `${node.callee.name} ${args}`;
    }
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
