/**
 * The OpenLogo AST — the shared contract between parsing and everything downstream
 * (runtime, LSP, docs). The spec deliberately does not define an interpreter, so the AST is
 * our contract, but it MUST mirror the grammar in
 * [`spec/grammar.md`](../../../spec/grammar.md): one node kind per grammar production, a
 * `source_span` on every node, immutable nodes, and a walker. Co-owned by
 * `@language-designer` + `@interpreter` (see the `interpreter/ast-design` skill).
 *
 * Every kind in {@link OL_NODE_KINDS} now has a typed interface, a factory helper on
 * {@link ast}, and a {@link walk} traversal case. Names that the checker points diagnostics at
 * (callees, procedure names, parameters, binders, and place bases/fields) carry their own
 * {@link SpannedName}. Core parses dotted places (`:a.b.c`); index/key selectors (`:a[i]`) and
 * the Data/Heritage profiles extend these shapes in their own slices. The AST still grows one
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
  "Local",
  "Call",
  "ParenCall",
  "ComparisonChain",
  "IsPredicate",
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

/**
 * A name written in the source together with its own span: a callee, a procedure name, a
 * parameter, a loop/comprehension binder, or a place base/field. It is metadata, not a walkable
 * node (it has no `kind`), so the checker can point `ol-reserved-word`, `ol-duplicate-binder`,
 * and `ol-unknown-command` at the exact identifier without a second lookup or a re-lex.
 */
export interface SpannedName {
  readonly name: string;
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
  readonly callee: SpannedName;
  readonly canonical?: string;
  readonly args: readonly ExpressionNode[];
}

/**
 * A variadic or alternate-arity call written with explicit parentheses, e.g. `(list 1 2 3)`
 * or `(print :a :b)`. Same shape as {@link CallNode}; the distinct kind records that the call
 * came from the parenthesized form so tooling can round-trip it. The parenthesized `(and …)`
 * and `(or …)` variadic logic heads use this node too.
 */
export interface ParenCallNode extends NodeBase {
  readonly kind: "ParenCall";
  readonly callee: SpannedName;
  readonly canonical?: string;
  readonly args: readonly ExpressionNode[];
}

/**
 * One postfix segment of a place written as `.identifier`: a literal field or key that is never
 * evaluated (`spec/grammar.md:109,256`). Its sibling {@link SelectorSegment} covers the bracketed
 * `[ key-term ]` form.
 */
export interface FieldSegment {
  readonly kind: "field";
  readonly name: SpannedName;
  readonly source_span: SourceSpan;
}

/**
 * One postfix segment of a place written as a bracketed selector `[ key-term ]`
 * (`spec/grammar.md:110-111`). Unlike a {@link FieldSegment}, the key is a first-class
 * expression: a `number`/`word` literal, a `:name` read ({@link VarRefNode}), a bare identifier
 * (a literal word key, carried as a {@link WordLitNode}), or a parenthesized expression. It
 * carries its own span so tooling can point at exactly the `[ … ]`.
 */
export interface SelectorSegment {
  readonly kind: "index";
  readonly key: ExpressionNode;
  readonly source_span: SourceSpan;
}

/**
 * A postfix place segment: a dotted `.field` ({@link FieldSegment}) or a bracketed `[ key-term ]`
 * selector ({@link SelectorSegment}). The two interleave in source order on one place, so
 * `:a.b[1].c` carries a field, then a selector, then a field.
 */
export type PlaceSegment = FieldSegment | SelectorSegment;

/**
 * An assignable place: a base variable plus zero or more postfix segments, so `:count` reads as
 * `{ base: count, segments: [] }` and `:people.tom.age` carries a `.tom` and an `.age` field
 * segment. Assignment targets are always a place; a bare `:name` read stays a {@link VarRefNode}
 * for the common case and only grows into a place when it has a postfix.
 */
export interface PlaceNode extends NodeBase {
  readonly kind: "Place";
  readonly base: SpannedName;
  readonly segments: readonly PlaceSegment[];
}

/**
 * An assignment: `:place = value` (`form: "equals"`) or `set place to value`
 * (`form: "set"`). Both bind the same place; `form` preserves the surface spelling.
 *
 * A well-formed target is always a {@link PlaceNode} (even a bare `:x` grows into a zero-segment
 * place). The parser also accepts a non-place expression here — a reporter/command call such as
 * `first :x = 5`, or a bare literal/list such as `3 = 5`/`count :nums = 3` — purely so the
 * semantic checker can raise `ol-not-a-place` (`spec/error-model.md`, `spec/tooling.md:213-219`)
 * at `stage: "semantic"` instead of a blunt parse error. The runtime only ever sees a `Place`,
 * because `check()` rejects every non-place target first.
 */
export interface AssignNode extends NodeBase {
  readonly kind: "Assign";
  readonly place: ExpressionNode;
  readonly value: ExpressionNode;
  readonly form: "equals" | "set";
}

/**
 * `local name` or `(local name {name})` — declare one or more names in the current scope. The
 * names carry their own spans so the checker can point `ol-reserved-word`/`ol-duplicate-binder`
 * at each one.
 */
export interface LocalNode extends NodeBase {
  readonly kind: "Local";
  readonly names: readonly SpannedName[];
}

/**
 * A comparison chain of two or more comparisons, e.g. `1 < :x < 10`. Each operand is stored
 * exactly once (`operators[i]` sits between `operands[i]` and `operands[i + 1]`), so a
 * side-effecting middle operand is evaluated and walked once — the runtime lowers the chain to
 * left-to-right `and` with that single-evaluation guarantee. A lone comparison stays a
 * {@link CallNode} with the operator as callee; the chain node appears only for two or more.
 */
export interface ComparisonChainNode extends NodeBase {
  readonly kind: "ComparisonChain";
  readonly operands: readonly ExpressionNode[];
  readonly operators: readonly SpannedName[];
}

/**
 * The tail of a worded `is`-predicate, operand-first: `is empty`, `is member of <collection>`,
 * `is a <type-word>`, or `is [ strictly ] between <low> and <high>`.
 */
export type IsTest =
  | { readonly form: "empty" }
  | { readonly form: "member-of"; readonly collection: ExpressionNode }
  | { readonly form: "a"; readonly type: WordLitNode }
  | {
      readonly form: "between";
      readonly strict: boolean;
      readonly low: ExpressionNode;
      readonly high: ExpressionNode;
    };

/** A worded `is`-predicate such as `:x is empty` or `:n is between 1 and 10`. */
export interface IsPredicateNode extends NodeBase {
  readonly kind: "IsPredicate";
  readonly operand: ExpressionNode;
  readonly test: IsTest;
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
  readonly binder: SpannedName;
  readonly iterable: ExpressionNode;
  readonly body: BlockNode;
}

/** `for variable from start to stop [ by step ] <body>`. */
export interface ForRangeNode extends NodeBase {
  readonly kind: "ForRange";
  readonly variable: SpannedName;
  readonly from: ExpressionNode;
  readonly to: ExpressionNode;
  readonly by?: ExpressionNode;
  readonly body: BlockNode;
}

/**
 * Fields shared by every `map`/`filter`/`reduce` comprehension: a binder and the iterable it
 * ranges over, plus a bracketed expression body (no lambda).
 */
interface ComprehensionBase extends NodeBase {
  readonly kind: "Comprehension";
  readonly binder: SpannedName;
  readonly iterable: ExpressionNode;
  readonly body: BlockNode;
}

/** A `map` or `filter` comprehension: binder, iterable, body — no accumulator. */
export interface MapFilterComprehensionNode extends ComprehensionBase {
  readonly form: "map" | "filter";
}

/** A `reduce` comprehension: it also carries its accumulator name and `from` seed. */
export interface ReduceComprehensionNode extends ComprehensionBase {
  readonly form: "reduce";
  readonly accumulator: SpannedName;
  readonly initial: ExpressionNode;
}

/**
 * A comprehension, discriminated on `form` so `reduce` always carries an `accumulator` and
 * `initial` seed while `map`/`filter` cannot — the impossible states are unrepresentable.
 */
export type ComprehensionNode =
  MapFilterComprehensionNode | ReduceComprehensionNode;

/** One procedure parameter: a required `:name`, or an optional `( :name defaultValue )`. */
export interface ProcedureParam {
  readonly name: SpannedName;
  readonly defaultValue?: ExpressionNode;
}

/** `define name :params… <body> end`. */
export interface ProcedureDefNode extends NodeBase {
  readonly kind: "ProcedureDef";
  readonly name: SpannedName;
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
  | PlaceNode
  | CallNode
  | ParenCallNode
  | ComparisonChainNode
  | IsPredicateNode
  | ComprehensionNode;

/**
 * Nodes usable in statement position. A bare expression is a valid statement, so every
 * {@link ExpressionNode} is also a statement, alongside the statement-only forms.
 */
export type StatementNode =
  | ExpressionNode
  | AssignNode
  | LocalNode
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
export type AnyNode = ProgramNode | StatementNode;

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
    callee: SpannedName,
    args: readonly ExpressionNode[],
    span: SourceSpan,
  ): CallNode {
    return { kind: "Call", source_span: span, callee, args };
  },
  parenCall(
    callee: SpannedName,
    args: readonly ExpressionNode[],
    span: SourceSpan,
  ): ParenCallNode {
    return { kind: "ParenCall", source_span: span, callee, args };
  },
  place(
    base: SpannedName,
    segments: readonly PlaceSegment[],
    span: SourceSpan,
  ): PlaceNode {
    return { kind: "Place", source_span: span, base, segments };
  },
  assign(
    place: ExpressionNode,
    value: ExpressionNode,
    form: AssignNode["form"],
    span: SourceSpan,
  ): AssignNode {
    return { kind: "Assign", source_span: span, place, value, form };
  },
  local(names: readonly SpannedName[], span: SourceSpan): LocalNode {
    return { kind: "Local", source_span: span, names };
  },
  comparisonChain(
    operands: readonly ExpressionNode[],
    operators: readonly SpannedName[],
    span: SourceSpan,
  ): ComparisonChainNode {
    return { kind: "ComparisonChain", source_span: span, operands, operators };
  },
  isPredicate(
    operand: ExpressionNode,
    test: IsTest,
    span: SourceSpan,
  ): IsPredicateNode {
    return { kind: "IsPredicate", source_span: span, operand, test };
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
    binder: SpannedName,
    iterable: ExpressionNode,
    body: BlockNode,
    span: SourceSpan,
  ): ForInNode {
    return { kind: "ForIn", source_span: span, binder, iterable, body };
  },
  forRange(
    variable: SpannedName,
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
  mapFilter(
    form: "map" | "filter",
    binder: SpannedName,
    iterable: ExpressionNode,
    body: BlockNode,
    span: SourceSpan,
  ): MapFilterComprehensionNode {
    return {
      kind: "Comprehension",
      source_span: span,
      form,
      binder,
      iterable,
      body,
    };
  },
  reduce(
    fields: {
      readonly accumulator: SpannedName;
      readonly binder: SpannedName;
      readonly iterable: ExpressionNode;
      readonly initial: ExpressionNode;
      readonly body: BlockNode;
    },
    span: SourceSpan,
  ): ReduceComprehensionNode {
    return {
      kind: "Comprehension",
      source_span: span,
      form: "reduce",
      ...fields,
    };
  },
  procedureDef(
    name: SpannedName,
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

/**
 * The direct child nodes `walk` descends into for `node`, in source order. Exported (alongside
 * `walk`) so a rule that needs scope-aware traversal — pushing/popping its own context around
 * specific node kinds, e.g. `ol-undefined-var`'s procedure-frame/binder-scope walk — can still
 * reuse this shared child list for every node kind it does *not* special-case, instead of
 * duplicating (and risking drift from) this switch.
 */
export function childrenOf(node: AnyNode): readonly AnyNode[] {
  switch (node.kind) {
    case "Program":
    case "Block":
      return node.body;
    case "ListLit":
      return node.elements;
    case "Call":
    case "ParenCall":
      return node.args;
    case "ComparisonChain":
      return node.operands;
    case "IsPredicate":
      switch (node.test.form) {
        case "member-of":
          return [node.operand, node.test.collection];
        case "a":
          return [node.operand, node.test.type];
        case "between":
          return [node.operand, node.test.low, node.test.high];
        default:
          return [node.operand];
      }
    case "Assign":
      return [node.place, node.value];
    case "Place":
      // Field segments are metadata (a SpannedName, no `kind`); only bracketed selectors carry a
      // walkable key expression, so a dotted-only place still has no expression children.
      return node.segments.flatMap((segment) =>
        segment.kind === "index" ? [segment.key] : [],
      );
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
      return node.form === "reduce"
        ? [node.iterable, node.initial, node.body]
        : [node.iterable, node.body];
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
