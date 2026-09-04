/**
 * The OpenLogo AST — the shared contract between parsing and everything downstream
 * (runtime, LSP, docs). The spec deliberately does not define an interpreter, so the AST is
 * our contract, but it MUST mirror the grammar in
 * [`spec/grammar.md`](../../../spec/grammar.md): one node kind per grammar production, a
 * `source_span` on every node, immutable nodes, and a walker. Co-owned by
 * `@language-designer` + `@interpreter` (see the `interpreter/ast-design` skill).
 *
 * Every kind in {@link OL_NODE_KINDS} now has a typed interface, a factory helper on
 * {@link ast}, and a {@link walk} traversal case. Membership of {@link AnyNode} without a case is a
 * compile error ({@link childrenOf}'s switch is exhaustive); a kind listed in
 * {@link OL_NODE_KINDS} but in no union is inert, and is caught by `child-edges.test.mjs` — which
 * reads the `AnyNode` union out of these declarations and compares its kinds against
 * {@link OL_NODE_KINDS} — rather than by the compiler. Names
 * that the checker points diagnostics at (callees, procedure names, parameters, binders, and place
 * bases/fields) carry their own {@link SpannedName}. Core parses dotted places (`:a.b.c`);
 * index/key selectors (`:a[i]`) and the Data/Heritage profiles extend these shapes in their own
 * slices. The AST still grows one node per grammar production, never ahead of the grammar.
 */

import type { SourceSpan } from "@openlogo/core";

/**
 * The Core node-kind vocabulary, mirroring the grammar productions of `spec/grammar.md`.
 * `DictLit` is the first Data-profile node kind; `StructDef` (the `struct` declaration) joins it,
 * and further Data-profile nodes land in their own slices.
 */
export const OL_NODE_KINDS = [
  "Program",
  "NumberLit",
  "WordLit",
  "BooleanLit",
  "ListLit",
  "DictLit",
  "ValueOfKey",
  "VarRef",
  "Place",
  "PostfixExpression",
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
  "DestructuringBinder",
  "ForIn",
  "ForRange",
  "Comprehension",
  "ProcedureDef",
  "Return",
  "Stop",
  "Throw",
  "Add",
  "Remove",
  "RemoveKey",
  "Insert",
  "Clear",
  "StructDef",
  "ProfileStatement",
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

/**
 * One `key: value` entry of a {@link DictLitNode} (`spec/grammar.md`'s
 * `dict-entry ::= dict-key ":" expression`). The key is a literal, never a variable read — a
 * bare identifier reuses {@link WordLitNode} exactly like a bare {@link SelectorSegment} key, and
 * a bare number key reuses {@link NumberLitNode}. Duplicate-key/insertion-order rules
 * (`spec/data-structures.md:143-171`) are a runtime concern; the parser only has to preserve
 * every entry in source order.
 */
export interface DictEntryNode {
  readonly key: WordLitNode | NumberLitNode;
  readonly value: ExpressionNode;
  readonly source_span: SourceSpan;
}

/** A dictionary literal `{ key: value … }` (Data profile, `spec/grammar.md`'s `dict-literal`). */
export interface DictLitNode extends NodeBase {
  readonly kind: "DictLit";
  readonly entries: readonly DictEntryNode[];
}

/**
 * The Heritage dict reader `value of <dictionary> for key <key>` (Data profile,
 * `spec/grammar.md:219`'s `value-of-reader ::= "value" "of" expression "for" "key" expression`).
 * Read-only, equivalent to `dictionary.key`/`dictionary[key]` at runtime
 * (`spec/data-structures.md:183-195`). Both `dictionary` and `key` are full expressions, not the
 * narrower {@link SelectorSegment} key-term grammar.
 */
export interface ValueOfKeyNode extends NodeBase {
  readonly kind: "ValueOfKey";
  readonly dictionary: ExpressionNode;
  readonly key: ExpressionNode;
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
 * evaluated (`spec/grammar.md:110,258`). Its sibling {@link SelectorSegment} covers the bracketed
 * `[ key-term ]` form.
 */
export interface FieldSegment {
  readonly kind: "field";
  readonly name: SpannedName;
  readonly source_span: SourceSpan;
}

/**
 * One postfix segment of a place written as a bracketed selector `[ key-term ]`
 * (`spec/grammar.md:111-112`). Unlike a {@link FieldSegment}, the key is a first-class
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
 * A postfix read over an arbitrary expression base — `spec/grammar.md:194`'s
 * `postfix-expression ::= primary { selector | "." identifier }`, which permits a postfix after
 * *any* primary, not only a `:name` (that narrower, variable-rooted case stays a {@link PlaceNode}
 * so assignment targets are unaffected). Covers a selector/field read directly off a list/dict
 * literal (`[1 2][1]`, `{tom: 8}.tom`) or a constructor-call/parenthesized result
 * (`(point 0 0).x`). Read-only: this node never appears as an assignment target — `parser.ts`'s
 * assignment-target parsing builds a {@link PlaceNode} directly and never goes through
 * `parsePostfix`, so a `PostfixExpression` base is always evaluated, then its segments are walked
 * exactly like a `Place`'s (never upserted).
 */
export interface PostfixExpressionNode extends NodeBase {
  readonly kind: "PostfixExpression";
  readonly base: ExpressionNode;
  readonly segments: readonly PlaceSegment[];
  /**
   * How many redundant bare-grouping `( … )` wrappers the surface source put around `base` —
   * `(1 + 2).x` is 1, `((1 + 2)).x` is 2, `1 + 2.x` (no wrapping) is 0 (issue #407/F7 follow-up:
   * rubber-duck found a single boolean cannot represent more than one level). `parsePostfix`
   * strips every one of those parens when it re-derives `base`'s span from the primary-start
   * token, so this count is the only remaining signal for the AST-fallback renderer
   * (`checker-not-a-place.ts`'s `renderPostfixExpression`) to re-add them; source-slicing needs no
   * such count because `source_span` already spans the parens. A callee-form `(first :x)` is a
   * `ParenCall`, which already preserves its own parens in its own `source_span` — it is never
   * counted here, so its `PostfixExpression` wrapper (if any) starts at 0 and only counts any
   * *additional* bare grouping around it, e.g. `((first :x)).foo` is 1.
   */
  readonly parenGroupCount: number;
}

/**
 * An assignment: `:place = value` (`form: "equals"`), `set place to value` (`form: "set"`), or the
 * Heritage spelling `make "name" value` (`form: "make"`). All three bind the same place; `form`
 * preserves the surface spelling. `make` is a Heritage-profile *alternate spelling only* with no
 * new semantics (`spec/conformance.md:270`, `spec/execution-model.md:318`), so it lowers to the
 * exact same {@link AssignNode} shape as `set … to` — its target is the bare name carried by the
 * word literal (`spec/grammar.md:108`, `make-assignment ::= "make" word-literal expression`),
 * grown into a zero-segment {@link PlaceNode} just like `set name to …`.
 *
 * A well-formed target is always a {@link PlaceNode} (even a bare `:x` grows into a zero-segment
 * place). The parser also accepts a non-place expression here — a reporter/command call such as
 * `first :x = 5`, or a bare literal/list such as `3 = 5`/`count :nums = 3` — purely so the
 * semantic checker can raise `ol-not-a-place` (`spec/error-model.md`, `spec/tooling.md:216-222`)
 * at `stage: "semantic"` instead of a blunt parse error. The runtime only ever sees a `Place`,
 * because `check()` rejects every non-place target first.
 */
export interface AssignNode extends NodeBase {
  readonly kind: "Assign";
  readonly place: ExpressionNode;
  readonly value: ExpressionNode;
  readonly form: "equals" | "set" | "make";
}

/**
 * A `local name` or `(local name {name})` — declare one or more names in the current scope. The
 * names carry their own spans so the checker can point `ol-duplicate-binder`
 * at each one. (`local` is a **binding** form, not a declaration slot, so it never raises
 * `ol-reserved-word` — maintainer ruling #833, `spec/grammar.md:390`.)
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

/**
 * A `for … in` / `map` / `filter` / `reduce` binder: either a bare `name`, or a destructuring
 * `[ :name { :name } ]` pattern that binds one or more names positionally
 * (`spec/grammar.md:137-138`).
 */
export interface DestructuringBinderNode extends NodeBase {
  readonly kind: "DestructuringBinder";
  readonly names: readonly SpannedName[];
}

/** A loop/comprehension binder: a bare name, or a destructuring pattern node. */
export type Binder = SpannedName | DestructuringBinderNode;

/** `for binder in iterable <body>`. */
export interface ForInNode extends NodeBase {
  readonly kind: "ForIn";
  readonly binder: Binder;
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
  readonly binder: Binder;
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

/**
 * `define name :params… <body> end`. `keyword` records the surface procedure-definition spelling:
 * `"define"` (Core) or `"to"` (the Heritage alternate spelling, `spec/conformance.md#heritage`).
 * Both build the *identical* node otherwise — Heritage adds no new semantics, so the runtime is
 * spelling-blind and only the Layer-2 checker's Heritage form-head gate (`checker-heritage-form.ts`,
 * issue #667) consults `keyword` to reject `to` when the Heritage profile is inactive.
 */
export interface ProcedureDefNode extends NodeBase {
  readonly kind: "ProcedureDef";
  readonly keyword: "define" | "to";
  readonly name: SpannedName;
  readonly params: readonly ProcedureParam[];
  readonly body: BlockNode;
}

/**
 * `return value` (Core), or the Heritage alternate spellings `output value` / `op value`
 * (`spec/conformance.md#heritage`). All three build the identical node — Heritage adds no new
 * semantics — so the runtime is spelling-blind; `keyword` records the surface word only so the
 * Layer-2 checker's Heritage form-head gate (issue #667) can reject `output`/`op` when the
 * Heritage profile is inactive.
 */
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

/**
 * `add value to target` — append `value` to the list `target` (Data profile,
 * `spec/grammar.md`'s `add-statement ::= "add" expression "to" expression`;
 * `spec/execution-model.md:807-842`). A statement, never a reporter — it mutates in place and
 * returns nothing. Runtime evaluation lands in its own Data-profile slice.
 */
export interface AddNode extends NodeBase {
  readonly kind: "Add";
  readonly value: ExpressionNode;
  readonly target: ExpressionNode;
}

/**
 * `remove value from target` — remove `value` from the list `target` (Data profile,
 * `spec/grammar.md`'s `remove-statement ::= "remove" expression "from" expression`). Distinct
 * from {@link RemoveKeyNode}, which drops a dictionary entry by key rather than a list element by
 * value.
 */
export interface RemoveNode extends NodeBase {
  readonly kind: "Remove";
  readonly value: ExpressionNode;
  readonly target: ExpressionNode;
}

/**
 * `remove key <key-term> from target` — drop the entry keyed `key` from the dictionary `target`
 * (Data profile, `spec/grammar.md`'s
 * `remove-key-statement ::= "remove" "key" key-term "from" expression`). Its own production,
 * separate from {@link RemoveNode}: the `key` is a `key-term` (a literal word/number, a `:name`
 * read, or a parenthesized expression), so a bare identifier such as `sophie` is carried as a
 * {@link WordLitNode}, exactly like a bracketed selector key.
 */
export interface RemoveKeyNode extends NodeBase {
  readonly kind: "RemoveKey";
  readonly key: ExpressionNode;
  readonly target: ExpressionNode;
}

/**
 * `insert value in target at index` — insert `value` into the list `target` at position `index`
 * (Data profile, `spec/grammar.md`'s
 * `insert-statement ::= "insert" expression "in" expression "at" expression`).
 */
export interface InsertNode extends NodeBase {
  readonly kind: "Insert";
  readonly value: ExpressionNode;
  readonly target: ExpressionNode;
  readonly index: ExpressionNode;
}

/**
 * `clear target` — empty the collection `target` (Data profile, `spec/grammar.md`'s
 * `clear-statement ::= "clear" expression`).
 */
export interface ClearNode extends NodeBase {
  readonly kind: "Clear";
  readonly target: ExpressionNode;
}

/**
 * `struct type-name "[" identifier { identifier } "]"` — declares a record type, its fixed field
 * set, and a same-named constructor reporter (Data profile, `spec/grammar.md:159-160`'s
 * `struct-declaration`/`field-list`; `spec/data-structures.md:252-266`). Both `name` and each
 * `field` are {@link SpannedName} metadata, not walkable nodes: the bracketed field list contains
 * bare field names that perform no evaluation (`spec/data-structures.md:264`), so a `StructDef` has
 * no expression children (its own `childrenOf` case returns none). Grammar/AST only — the
 * constructor-call and field mutation semantics land in a later Data-profile slice.
 */
export interface StructDefNode extends NodeBase {
  readonly kind: "StructDef";
  readonly name: SpannedName;
  readonly fields: readonly SpannedName[];
}

/**
 * A profile-gated statement form: a head keyword, its argument expressions, and an optional
 * delimited block body (`spec/grammar.md#profile-grammar-extensions`). This is the single shared
 * shape for every profile's block-head and mode-switch statement, so a profile epic registers a
 * new form in the reader (`parser.ts`'s `PROFILE_STATEMENT_FORMS`) without adding a per-keyword AST
 * node kind — see [turtles-and-sprites.md](../../../spec/turtles-and-sprites.md) §Profile grammar
 * (`tell`/`ask`/`each`) and [interaction-events.md](../../../spec/interaction-events.md) §Profile
 * grammar (`when`/`every`/`on_key`/`on_click`).
 *
 * The reader is profile-blind: it parses any registered head keyword into this node regardless of
 * the active profile set, reusing the Core `expression` and block productions exactly as the spec
 * requires ("They reuse the Core `expression`, `bracket-block`, `statement`, and `terminator`
 * productions."). Whether the form is *legal* under the program's active profiles — and any
 * per-keyword type/semantic checking — is the Layer-2 checker's job (`spec/tooling.md:175-176`),
 * mirroring how {@link primitiveArity} groups a bare profile primitive's arguments for the reader
 * while `check()` gates its legality.
 *
 * `keyword` is the head word ({@link SpannedName}); `args` are the head's argument expressions
 * (one for `tell`/`ask`/`when`/`every`/`on_key`, none for `each`/`on_click`); `body` is the
 * block for a block-head form and is absent for a bodyless command (`tell`). A labeled `end` MUST
 * match its opener — `end ask` closes `ask`, `end when` closes `when` — with a mismatched label
 * raising `ol-mismatched-end`.
 */
export interface ProfileStatementNode extends NodeBase {
  readonly kind: "ProfileStatement";
  readonly keyword: SpannedName;
  readonly args: readonly ExpressionNode[];
  readonly body?: BlockNode;
}

/** Nodes usable in value position. */
export type ExpressionNode =
  | NumberLitNode
  | WordLitNode
  | BooleanLitNode
  | ListLitNode
  | DictLitNode
  | ValueOfKeyNode
  | VarRefNode
  | PlaceNode
  | PostfixExpressionNode
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
  | ThrowNode
  | AddNode
  | RemoveNode
  | RemoveKeyNode
  | InsertNode
  | ClearNode
  | StructDefNode
  | ProfileStatementNode;

/** Any concrete AST node. */
export type AnyNode = ProgramNode | StatementNode | DestructuringBinderNode;

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
  dictLit(entries: readonly DictEntryNode[], span: SourceSpan): DictLitNode {
    return { kind: "DictLit", source_span: span, entries };
  },
  valueOfKey(
    dictionary: ExpressionNode,
    key: ExpressionNode,
    span: SourceSpan,
  ): ValueOfKeyNode {
    return { kind: "ValueOfKey", source_span: span, dictionary, key };
  },
  varRef(name: string, span: SourceSpan): VarRefNode {
    return { kind: "VarRef", source_span: span, name };
  },
  call(
    callee: SpannedName,
    args: readonly ExpressionNode[],
    span: SourceSpan,
    canonical?: string,
  ): CallNode {
    return canonical === undefined
      ? { kind: "Call", source_span: span, callee, args }
      : { kind: "Call", source_span: span, callee, args, canonical };
  },
  parenCall(
    callee: SpannedName,
    args: readonly ExpressionNode[],
    span: SourceSpan,
    canonical?: string,
  ): ParenCallNode {
    return canonical === undefined
      ? { kind: "ParenCall", source_span: span, callee, args }
      : { kind: "ParenCall", source_span: span, callee, args, canonical };
  },
  place(
    base: SpannedName,
    segments: readonly PlaceSegment[],
    span: SourceSpan,
  ): PlaceNode {
    return { kind: "Place", source_span: span, base, segments };
  },
  postfixExpression(
    base: ExpressionNode,
    segments: readonly PlaceSegment[],
    span: SourceSpan,
    parenGroupCount: number,
  ): PostfixExpressionNode {
    return {
      kind: "PostfixExpression",
      source_span: span,
      base,
      segments,
      parenGroupCount,
    };
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
    binder: Binder,
    iterable: ExpressionNode,
    body: BlockNode,
    span: SourceSpan,
  ): ForInNode {
    return { kind: "ForIn", source_span: span, binder, iterable, body };
  },
  destructuringBinder(
    names: readonly SpannedName[],
    span: SourceSpan,
  ): DestructuringBinderNode {
    return { kind: "DestructuringBinder", source_span: span, names };
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
    binder: Binder,
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
      readonly binder: Binder;
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
    keyword: ProcedureDefNode["keyword"],
    name: SpannedName,
    params: readonly ProcedureParam[],
    body: BlockNode,
    span: SourceSpan,
  ): ProcedureDefNode {
    return {
      kind: "ProcedureDef",
      source_span: span,
      keyword,
      name,
      params,
      body,
    };
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
  add(
    value: ExpressionNode,
    target: ExpressionNode,
    span: SourceSpan,
  ): AddNode {
    return { kind: "Add", source_span: span, value, target };
  },
  remove(
    value: ExpressionNode,
    target: ExpressionNode,
    span: SourceSpan,
  ): RemoveNode {
    return { kind: "Remove", source_span: span, value, target };
  },
  removeKey(
    key: ExpressionNode,
    target: ExpressionNode,
    span: SourceSpan,
  ): RemoveKeyNode {
    return { kind: "RemoveKey", source_span: span, key, target };
  },
  insert(
    value: ExpressionNode,
    target: ExpressionNode,
    index: ExpressionNode,
    span: SourceSpan,
  ): InsertNode {
    return { kind: "Insert", source_span: span, value, target, index };
  },
  clear(target: ExpressionNode, span: SourceSpan): ClearNode {
    return { kind: "Clear", source_span: span, target };
  },
  structDef(
    name: SpannedName,
    fields: readonly SpannedName[],
    span: SourceSpan,
  ): StructDefNode {
    return { kind: "StructDef", source_span: span, name, fields };
  },
  profileStatement(
    keyword: SpannedName,
    args: readonly ExpressionNode[],
    body: BlockNode | undefined,
    span: SourceSpan,
  ): ProfileStatementNode {
    return body === undefined
      ? { kind: "ProfileStatement", source_span: span, keyword, args }
      : { kind: "ProfileStatement", source_span: span, keyword, args, body };
  },
} as const;

/** A visitor invoked once per node during {@link walk}. */
export type Visitor = (node: AnyNode) => void;

/**
 * Rejects a discriminant value one of {@link childrenOf}'s switches has no case for. The first
 * parameter is `never`, so a new value of the discriminant being switched on — a node kind, an
 * {@link IsTest} form, a {@link PlaceSegment} kind, or a {@link ComprehensionNode} form — fails
 * `tsc` at the call site and names the omitted type.
 *
 * It throws rather than reporting no children, because a silently childless node is the exact
 * failure mode issue #925 exists to remove: `walk` would still visit the node — the visitor runs
 * before the descent — but everything *below* it would vanish, and with it the runtime's
 * declaration registration and every checker's view of that subtree. Production callers pass
 * well-typed {@link AnyNode} values, from `parse` or the {@link ast} factory; only malformed
 * untyped input reaches here, and it fails loudly.
 */
function unhandledChildCase(_unhandled: never, seen: string): never {
  throw new Error(
    `childrenOf has no case for ${seen} — this is an OpenLogo bug, not a program error ` +
      "(see docs/adr/0024-ast-traversal-kind-dispatch-is-compiler-enforced.md).",
  );
}

/**
 * The walkable children of one postfix segment, shared by {@link PlaceNode} and
 * {@link PostfixExpressionNode} so the two cannot drift apart. A dotted `.field` segment holds a
 * {@link SpannedName} — metadata, not a walkable node — so only a bracketed selector contributes a
 * child, and a dotted-only place has no expression children at all.
 */
function segmentChildren(segment: PlaceSegment): readonly AnyNode[] {
  switch (segment.kind) {
    case "field":
      return [];
    case "index":
      return [segment.key];
    default:
      return unhandledChildCase(
        segment,
        `place segment kind ${JSON.stringify((segment as PlaceSegment).kind)}`,
      );
  }
}

/**
 * The direct child nodes `walk` descends into for `node`, in source order. Exported within the
 * package — unlike `walk`, it is not part of `index.ts`'s public surface — so a rule that needs
 * scope-aware traversal, pushing/popping its own context around specific node kinds (e.g.
 * `ol-undefined-var`'s procedure-frame/binder-scope walk), can still reuse this shared child list
 * for every node kind it does *not* special-case, instead of duplicating (and risking drift from)
 * this switch.
 *
 * All four of this function's dispatches — node kind, {@link IsTest} form, {@link PlaceSegment}
 * kind, and {@link ComprehensionNode} form — enumerate **every** value their discriminant can take,
 * childless ones included, so each `default` narrows to `never` and omitting a case is a compile
 * error rather than a silent hole in every traversal in the repository (issue #925).
 * `ForIn`/`Comprehension` binders are the deliberate exception: they discriminate structurally
 * (`"kind" in …`), so a future node-shaped binder is included automatically and metadata binders
 * stay excluded.
 *
 * **What that buys is exhaustive dispatch, not a correct child list, and the difference matters.**
 * Every value those discriminants can take selects an explicit case; `tsc` does not check that the
 * case returns *every* node-valued field of its kind — a field added to an already-handled kind, or
 * a union member reusing an existing discriminant value, compiles clean with the field silently
 * absent from the child list. That half is checked at test time instead, by
 * `child-edges.test.mjs`: it derives each node's edges by reflection, from a source that does not
 * use this function, and fails naming the dotted path of any field omitted here
 * ([ADR-0025](../../../docs/adr/0025-child-edge-gate-audits-childrenof-independently.md)). The
 * residual that left — a node-valued field that **no** fixture populates, which is invisible to
 * reflection too — is narrowed by the same file's declaration-derived field set, which reads these
 * declarations through the TypeScript compiler API and fails when one of them is never exercised
 * ([ADR-0028](../../../docs/adr/0028-child-edge-field-set-is-declaration-derived.md)). What survives
 * is a field sharing a path with an exercised variant: paths are keyed by `kind` plus dotted route,
 * so an unexercised `initial` on `MapFilterComprehensionNode` hides behind
 * `ReduceComprehensionNode.initial` (measured, issue #1004). See also
 * [ADR-0024](../../../docs/adr/0024-ast-traversal-kind-dispatch-is-compiler-enforced.md).
 */
export function childrenOf(node: AnyNode): readonly AnyNode[] {
  switch (node.kind) {
    case "Program":
    case "Block":
      return node.body;
    case "ListLit":
      return node.elements;
    case "DictLit":
      return node.entries.flatMap((entry) => [entry.key, entry.value]);
    case "ValueOfKey":
      return [node.dictionary, node.key];
    case "Call":
    case "ParenCall":
      return node.args;
    case "ComparisonChain":
      return node.operands;
    case "IsPredicate": {
      // Bound to a local so the `form` switch narrows `test` itself, which is what lets the
      // `default` below reject a form nobody gave a case.
      const test = node.test;
      switch (test.form) {
        case "empty":
          return [node.operand];
        case "member-of":
          return [node.operand, test.collection];
        case "a":
          return [node.operand, test.type];
        case "between":
          return [node.operand, test.low, test.high];
        default:
          return unhandledChildCase(
            test,
            `"is" test form ${JSON.stringify((test as IsTest).form)}`,
          );
      }
    }
    case "Assign":
      return [node.place, node.value];
    case "Place":
      return node.segments.flatMap(segmentChildren);
    case "PostfixExpression":
      // Unlike `Place`, the base itself is a walkable expression (a literal, constructor call, or
      // any other primary); the segments contribute exactly what they do for a place.
      return [node.base, ...node.segments.flatMap(segmentChildren)];
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
    case "DestructuringBinder":
      // Its `names` are metadata SpannedNames (no `kind`), same as `Place`'s field segments —
      // nothing further to walk.
      return [];
    case "ForIn":
      return "kind" in node.binder
        ? [node.binder, node.iterable, node.body]
        : [node.iterable, node.body];
    case "ForRange":
      return node.by === undefined
        ? [node.from, node.to, node.body]
        : [node.from, node.to, node.by, node.body];
    case "Comprehension": {
      const binderChildren = "kind" in node.binder ? [node.binder] : [];
      switch (node.form) {
        case "map":
        case "filter":
          return [...binderChildren, node.iterable, node.body];
        case "reduce":
          // Only `reduce` carries an accumulator seed; the union makes the other forms unable to.
          return [...binderChildren, node.iterable, node.initial, node.body];
        default:
          return unhandledChildCase(
            node,
            `comprehension form ${JSON.stringify((node as ComprehensionNode).form)}`,
          );
      }
    }
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
    case "Add":
    case "Remove":
      return [node.value, node.target];
    case "RemoveKey":
      return [node.key, node.target];
    case "Insert":
      return [node.value, node.target, node.index];
    case "Clear":
      return [node.target];
    case "ProfileStatement":
      // The head keyword is a metadata SpannedName (no `kind`), like `Place`'s field segments;
      // only the argument expressions and the optional block body are walkable children.
      return node.body === undefined ? node.args : [...node.args, node.body];
    // The childless kinds: everything they carry is a primitive value or `SpannedName` metadata,
    // so there is nothing to descend into. They are enumerated here rather than left to `default`
    // deliberately — a kind that falls through keeps the default clause inhabited, the `never`
    // binding below stops binding, and the guard silently becomes decorative.
    case "NumberLit":
    case "WordLit":
    case "BooleanLit":
    case "VarRef":
    case "Local":
    case "Stop":
    case "StructDef":
      return [];
    default:
      // Unreachable for a well-typed caller. Because every `AnyNode` kind is handled above,
      // `node` narrows to `never` here, so a kind added to the union without its own case fails
      // `tsc` ("Type 'XNode' is not assignable to type 'never'") and names the omission. That
      // compile error is the only thing that can see this gap: every AST-derived instrument in
      // the repository traverses *through* this switch, so an omitted kind is invisible to both
      // the instrument and its subject at once (issue #925).
      return unhandledChildCase(
        node,
        `node kind ${JSON.stringify((node as AnyNode).kind)}`,
      );
  }
}

/** Pre-order walk: `visit` is called on `node`, then on each descendant in source order. */
export function walk(node: AnyNode, visit: Visitor): void {
  visit(node);
  for (const child of childrenOf(node)) {
    walk(child, visit);
  }
}
