/**
 * The OpenLogo AST — the shared contract between parsing and everything downstream
 * (runtime, LSP, docs). The spec deliberately does not define an interpreter, so the AST is
 * our contract, but it MUST mirror the grammar in
 * [`spec/grammar.md`](../../../spec/grammar.md): one node kind per grammar production, a
 * `source_span` on every node, immutable nodes, and a walker. Co-owned by
 * `@language-designer` + `@interpreter` (see the `interpreter/ast-design` skill).
 *
 * M0 scope: {@link OL_NODE_KINDS} is the full Core node-kind vocabulary; concrete node
 * interfaces exist for a representative subset so the factory and walker are exercised
 * end to end. The remaining kinds keep their reserved name here and gain typed shapes with
 * their grammar slice — the AST grows one node per production, never ahead of the grammar.
 */

import type { SourceSpan } from "@openlogo/core";

/**
 * The Core node-kind vocabulary, mirroring the grammar productions of `spec/grammar.md`.
 * Data-profile nodes (`DictLit`, `StructDef`, …) join with that profile.
 */
export const OL_NODE_KINDS = [
  "Program",
  "NumberLit",
  "WordLit",
  "BooleanLit",
  "ListLit",
  "VarRef",
  "Place",
  "Assign",
  "Call",
  "ParenCall",
  "Block",
  "If",
  "While",
  "Repeat",
  "Forever",
  "ForIn",
  "ForRange",
  "Comprehension",
  "ProcedureDef",
  "Return",
  "Stop",
  "Throw",
] as const;

/** One Core AST node kind. */
export type NodeKind = (typeof OL_NODE_KINDS)[number];

/** Fields shared by every node: its kind and the source range it came from. */
export interface NodeBase {
  readonly kind: NodeKind;
  readonly source_span: SourceSpan;
}

/** The whole program: a sequence of statements. */
export interface ProgramNode extends NodeBase {
  readonly kind: "Program";
  readonly body: readonly StatementNode[];
}

/** A delimited instruction block (`[ … ]` or `… end`). */
export interface BlockNode extends NodeBase {
  readonly kind: "Block";
  readonly body: readonly StatementNode[];
}

/** A numeric literal such as `100` or `-3.5`. */
export interface NumberLitNode extends NodeBase {
  readonly kind: "NumberLit";
  readonly value: number;
}

/** A word literal such as `"red"` (value carries the text without the quotes). */
export interface WordLitNode extends NodeBase {
  readonly kind: "WordLit";
  readonly value: string;
}

/** A boolean literal `true` or `false`. */
export interface BooleanLitNode extends NodeBase {
  readonly kind: "BooleanLit";
  readonly value: boolean;
}

/** A list literal `[ … ]` of expressions. */
export interface ListLitNode extends NodeBase {
  readonly kind: "ListLit";
  readonly elements: readonly ExpressionNode[];
}

/** A variable read `:name` (the name carries no leading colon). */
export interface VarRefNode extends NodeBase {
  readonly kind: "VarRef";
  readonly name: string;
}

/**
 * A fixed-arity prefix call such as `forward 100`. `callee` is the surface spelling; when
 * that spelling is a Heritage alias (`fd`, `pr`) `canonical` records the Core name, so
 * tooling and docs can tell alias from canonical without a second node kind.
 */
export interface CallNode extends NodeBase {
  readonly kind: "Call";
  readonly callee: string;
  readonly canonical?: string;
  readonly args: readonly ExpressionNode[];
}

/** Nodes usable in value position. */
export type ExpressionNode =
  | NumberLitNode
  | WordLitNode
  | BooleanLitNode
  | ListLitNode
  | VarRefNode
  | CallNode;

/** Nodes usable in statement position. */
export type StatementNode = CallNode | BlockNode;

/** Any concrete AST node (the M0-typed subset of {@link NodeKind}). */
export type AnyNode = ProgramNode | ExpressionNode | StatementNode;

/** Factory helpers that build immutable, spanned nodes. */
export const ast = {
  program(body: readonly StatementNode[], span: SourceSpan): ProgramNode {
    return { kind: "Program", source_span: span, body };
  },
  block(body: readonly StatementNode[], span: SourceSpan): BlockNode {
    return { kind: "Block", source_span: span, body };
  },
  numberLit(value: number, span: SourceSpan): NumberLitNode {
    return { kind: "NumberLit", source_span: span, value };
  },
  wordLit(value: string, span: SourceSpan): WordLitNode {
    return { kind: "WordLit", source_span: span, value };
  },
  booleanLit(value: boolean, span: SourceSpan): BooleanLitNode {
    return { kind: "BooleanLit", source_span: span, value };
  },
  listLit(elements: readonly ExpressionNode[], span: SourceSpan): ListLitNode {
    return { kind: "ListLit", source_span: span, elements };
  },
  varRef(name: string, span: SourceSpan): VarRefNode {
    return { kind: "VarRef", source_span: span, name };
  },
  call(
    callee: string,
    args: readonly ExpressionNode[],
    span: SourceSpan,
  ): CallNode {
    return { kind: "Call", source_span: span, callee, args };
  },
} as const;

/** A visitor invoked once per node during {@link walk}. */
export type Visitor = (node: AnyNode) => void;

function childrenOf(node: AnyNode): readonly AnyNode[] {
  switch (node.kind) {
    case "Program":
    case "Block":
      return node.body;
    case "ListLit":
      return node.elements;
    case "Call":
      return node.args;
    default:
      return [];
  }
}

/** Pre-order walk: `visit` is called on `node`, then on each descendant in source order. */
export function walk(node: AnyNode, visit: Visitor): void {
  visit(node);
  for (const child of childrenOf(node)) {
    walk(child, visit);
  }
}
