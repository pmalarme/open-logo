/**
 * The OpenLogo AST — the shared contract between parsing and everything downstream
 * (runtime, LSP, docs). The spec deliberately does not define an interpreter, so the AST is
 * our contract, but it MUST mirror the grammar in
 * [`spec/grammar.md`](../../../spec/grammar.md): one node kind per grammar production, a
 * `source_span` on every node, immutable nodes, and a walker. Co-owned by
 * `@language-designer` + `@interpreter` (see the `interpreter/ast-design` skill).
 *
 * Every kind in {@link OL_NODE_KINDS} now has a typed interface, a factory helper on
 * {@link ast}, and a {@link walk} traversal case. Postfix places (`:a.b`, `:a[i]`) and the
 * Data/Heritage profiles extend these shapes in their own slices; the AST still grows one
 * node per grammar production, never ahead of the grammar.
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

/**
 * A variadic or alternate-arity call written with explicit parentheses, e.g. `(list 1 2 3)`
 * or `(print :a :b)`. Same shape as {@link CallNode}; the distinct kind records that the call
 * came from the parenthesized form so tooling can round-trip it.
 */
export interface ParenCallNode extends NodeBase {
  readonly kind: "ParenCall";
  readonly callee: string;
  readonly canonical?: string;
  readonly args: readonly ExpressionNode[];
}

/**
 * An assignable place. This slice carries the base `name`; nested postfix places
 * (`:people.tom.age`, `:nums[1]`) parse with the selector/field slice and will extend this
 * node then. See `spec/grammar.md` `colon-place`/`bare-place`.
 */
export interface PlaceNode extends NodeBase {
  readonly kind: "Place";
  readonly name: string;
}

/**
 * An assignment: `:place = value` (`form: "equals"`) or `set place to value`
 * (`form: "set"`). Both bind the same place; `form` preserves the surface spelling.
 */
export interface AssignNode extends NodeBase {
  readonly kind: "Assign";
  readonly place: PlaceNode;
  readonly value: ExpressionNode;
  readonly form: "equals" | "set";
}

/** `if condition <body> [ else <body> ]`. */
export interface IfNode extends NodeBase {
  readonly kind: "If";
  readonly condition: ExpressionNode;
  readonly thenBody: BlockNode;
  readonly elseBody?: BlockNode;
}

/** `while condition <body>`. */
export interface WhileNode extends NodeBase {
  readonly kind: "While";
  readonly condition: ExpressionNode;
  readonly body: BlockNode;
}

/** `repeat count <body>`. */
export interface RepeatNode extends NodeBase {
  readonly kind: "Repeat";
  readonly count: ExpressionNode;
  readonly body: BlockNode;
}

/** `forever <body>`. */
export interface ForeverNode extends NodeBase {
  readonly kind: "Forever";
  readonly body: BlockNode;
}

/** `for binder in iterable <body>`. The destructuring binder form is a later slice. */
export interface ForInNode extends NodeBase {
  readonly kind: "ForIn";
  readonly binder: string;
  readonly iterable: ExpressionNode;
  readonly body: BlockNode;
}

/** `for variable from start to stop [ by step ] <body>`. */
export interface ForRangeNode extends NodeBase {
  readonly kind: "ForRange";
  readonly variable: string;
  readonly from: ExpressionNode;
  readonly to: ExpressionNode;
  readonly by?: ExpressionNode;
  readonly body: BlockNode;
}

/**
 * A `map`/`filter`/`reduce` comprehension with a bracketed expression body (no lambda).
 * `reduce` also carries its accumulator name and `from` seed; `map`/`filter` leave them unset.
 */
export interface ComprehensionNode extends NodeBase {
  readonly kind: "Comprehension";
  readonly form: "map" | "filter" | "reduce";
  readonly binder: string;
  readonly iterable: ExpressionNode;
  readonly body: BlockNode;
  readonly accumulator?: string;
  readonly initial?: ExpressionNode;
}

/** One procedure parameter: a required `:name`, or an optional `( :name defaultValue )`. */
export interface ProcedureParam {
  readonly name: string;
  readonly defaultValue?: ExpressionNode;
}

/** `define name :params… <body> end`. */
export interface ProcedureDefNode extends NodeBase {
  readonly kind: "ProcedureDef";
  readonly name: string;
  readonly params: readonly ProcedureParam[];
  readonly body: BlockNode;
}

/** `return value` (Core). `output`/`op` are Heritage spellings handled by that profile. */
export interface ReturnNode extends NodeBase {
  readonly kind: "Return";
  readonly keyword: "return" | "output" | "op";
  readonly value: ExpressionNode;
}

/** `stop` — leave the current procedure with no value. */
export interface StopNode extends NodeBase {
  readonly kind: "Stop";
}

/** `throw value` — halt with a learner-facing value. */
export interface ThrowNode extends NodeBase {
  readonly kind: "Throw";
  readonly value: ExpressionNode;
}

/** Nodes usable in value position. */
export type ExpressionNode =
  | NumberLitNode
  | WordLitNode
  | BooleanLitNode
  | ListLitNode
  | VarRefNode
  | CallNode
  | ParenCallNode
  | ComprehensionNode;

/**
 * Nodes usable in statement position. A bare expression is a valid statement, so every
 * {@link ExpressionNode} is also a statement, alongside the statement-only forms.
 */
export type StatementNode =
  | ExpressionNode
  | AssignNode
  | BlockNode
  | IfNode
  | WhileNode
  | RepeatNode
  | ForeverNode
  | ForInNode
  | ForRangeNode
  | ProcedureDefNode
  | ReturnNode
  | StopNode
  | ThrowNode;

/** Any concrete AST node. */
export type AnyNode = ProgramNode | StatementNode | PlaceNode;

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
  parenCall(
    callee: string,
    args: readonly ExpressionNode[],
    span: SourceSpan,
  ): ParenCallNode {
    return { kind: "ParenCall", source_span: span, callee, args };
  },
  place(name: string, span: SourceSpan): PlaceNode {
    return { kind: "Place", source_span: span, name };
  },
  assign(
    place: PlaceNode,
    value: ExpressionNode,
    form: AssignNode["form"],
    span: SourceSpan,
  ): AssignNode {
    return { kind: "Assign", source_span: span, place, value, form };
  },
  ifStmt(
    condition: ExpressionNode,
    thenBody: BlockNode,
    elseBody: BlockNode | undefined,
    span: SourceSpan,
  ): IfNode {
    return { kind: "If", source_span: span, condition, thenBody, elseBody };
  },
  whileStmt(
    condition: ExpressionNode,
    body: BlockNode,
    span: SourceSpan,
  ): WhileNode {
    return { kind: "While", source_span: span, condition, body };
  },
  repeat(count: ExpressionNode, body: BlockNode, span: SourceSpan): RepeatNode {
    return { kind: "Repeat", source_span: span, count, body };
  },
  forever(body: BlockNode, span: SourceSpan): ForeverNode {
    return { kind: "Forever", source_span: span, body };
  },
  forIn(
    binder: string,
    iterable: ExpressionNode,
    body: BlockNode,
    span: SourceSpan,
  ): ForInNode {
    return { kind: "ForIn", source_span: span, binder, iterable, body };
  },
  forRange(
    variable: string,
    from: ExpressionNode,
    to: ExpressionNode,
    by: ExpressionNode | undefined,
    body: BlockNode,
    span: SourceSpan,
  ): ForRangeNode {
    return {
      kind: "ForRange",
      source_span: span,
      variable,
      from,
      to,
      by,
      body,
    };
  },
  comprehension(
    fields: {
      readonly form: ComprehensionNode["form"];
      readonly binder: string;
      readonly iterable: ExpressionNode;
      readonly body: BlockNode;
      readonly accumulator?: string;
      readonly initial?: ExpressionNode;
    },
    span: SourceSpan,
  ): ComprehensionNode {
    return { kind: "Comprehension", source_span: span, ...fields };
  },
  procedureDef(
    name: string,
    params: readonly ProcedureParam[],
    body: BlockNode,
    span: SourceSpan,
  ): ProcedureDefNode {
    return { kind: "ProcedureDef", source_span: span, name, params, body };
  },
  returnStmt(
    keyword: ReturnNode["keyword"],
    value: ExpressionNode,
    span: SourceSpan,
  ): ReturnNode {
    return { kind: "Return", source_span: span, keyword, value };
  },
  stop(span: SourceSpan): StopNode {
    return { kind: "Stop", source_span: span };
  },
  throwStmt(value: ExpressionNode, span: SourceSpan): ThrowNode {
    return { kind: "Throw", source_span: span, value };
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
    case "ParenCall":
      return node.args;
    case "Assign":
      return [node.place, node.value];
    case "If":
      return node.elseBody === undefined
        ? [node.condition, node.thenBody]
        : [node.condition, node.thenBody, node.elseBody];
    case "While":
      return [node.condition, node.body];
    case "Repeat":
      return [node.count, node.body];
    case "Forever":
      return [node.body];
    case "ForIn":
      return [node.iterable, node.body];
    case "ForRange":
      return node.by === undefined
        ? [node.from, node.to, node.body]
        : [node.from, node.to, node.by, node.body];
    case "Comprehension":
      return node.initial === undefined
        ? [node.iterable, node.body]
        : [node.iterable, node.initial, node.body];
    case "ProcedureDef":
      return [
        ...node.params.flatMap((param) =>
          param.defaultValue === undefined ? [] : [param.defaultValue],
        ),
        node.body,
      ];
    case "Return":
    case "Throw":
      return [node.value];
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
