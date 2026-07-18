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
 * {@link renderNode} reconstructs that text purely from the AST rather than by threading the
 * original source string through {@link check}: `check()`'s public signature takes only a
 * `ProgramNode`, and its existing unit tests already call it without source text, so an
 * AST-only renderer is both necessary (no source available) and sufficient (the parser only ever
 * builds a small, closed set of node kinds in target position — see {@link RenderableNode}).
 */

import type { Diagnostic } from "@openlogo/core";
import type {
  AnyNode,
  AssignNode,
  BooleanLitNode,
  CallNode,
  ExpressionNode,
  ListLitNode,
  NumberLitNode,
  ParenCallNode,
  ProgramNode,
  VarRefNode,
  WordLitNode,
} from "./ast.js";
import { walk } from "./ast.js";

function isAssign(node: AnyNode): node is AssignNode {
  return node.kind === "Assign";
}

/**
 * Every expression kind the parser can build in non-place assignment-target position, or nest
 * inside one as a call argument/list element: `spec/grammar.md:244-258` and the `AssignNode` doc
 * comment in `ast.ts` together close this to exactly these seven kinds. A comparison chain,
 * `is`-predicate, or comprehension never appears there, so {@link renderNode} does not need to
 * (and — for 100% branch/function coverage — must not) handle them.
 */
type RenderableNode =
  | NumberLitNode
  | WordLitNode
  | BooleanLitNode
  | VarRefNode
  | ListLitNode
  | CallNode
  | ParenCallNode;

/** Renders a nested expression (a call argument or a list element). See {@link RenderableNode}. */
function renderChild(node: ExpressionNode): string {
  return renderNode(node as RenderableNode);
}

/** Reconstructs the surface text of a non-place assignment target, for the `text` param. */
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
    case "ListLit":
      return `[${node.elements.map(renderChild).join(" ")}]`;
    case "Call":
    case "ParenCall": {
      const args = node.args.map(renderChild).join(" ");
      return args === "" ? node.callee.name : `${node.callee.name} ${args}`;
    }
  }
}

/** The learner-facing message template for a non-place used as an assignment target. */
function messageFor(text: string): string {
  return `${text} is a value, not a place you can change.`;
}

/**
 * The `ol-not-a-place` rule: every assignment whose target is not a `Place` raises one diagnostic
 * at the target's span, with its reconstructed surface text carried as the `text` param
 * (`spec/tooling.md:213-219`).
 */
export function notAPlaceRule(program: ProgramNode): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  walk(program, (node) => {
    if (!isAssign(node)) {
      return;
    }
    const target = node.place;
    if (target.kind === "Place") {
      return;
    }
    // The parser only ever builds a non-place assignment target as one of `RenderableNode`'s
    // kinds — see that type's doc comment — so this cast documents the invariant instead of
    // widening `renderNode` to the full `ExpressionNode` union.
    const text = renderNode(target as RenderableNode);
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
