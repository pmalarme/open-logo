/**
 * AST — the shared syntax-tree contract between parsing and everything
 * downstream (`@openlogo/runtime`, studio/LSP, docs). The spec deliberately does
 * not define an interpreter, so the AST is our contract; it MUST mirror the
 * grammar in `spec/grammar.md` and carry the spans that diagnostics and
 * highlighting depend on. Co-owned by `@language-designer` + `@interpreter`.
 *
 * Rules (see `.github/skills/interpreter/ast-design`):
 * - One node kind per grammar production; nodes are **data only** (no evaluation
 *   logic — that lives in `@openlogo/runtime`).
 * - Every node carries a `sourceSpan` (via {@link NodeBase}); fields are
 *   `readonly` (immutable trees).
 * - Heritage spellings (`to`, `fd`, …) are the **same** node kind as their Core
 *   form, with the surface spelling recorded (e.g. {@link ProcedureDef.syntax},
 *   or the callee word on a {@link Call}) rather than a new semantic node.
 *
 * This is the M0 stub: the Core node kinds plus the Data-profile `DictLit` /
 * `StructDef`. The union is extended per slice (collection statements, worded
 * `is`-predicates, `local`/`alias`/`import`/`export`, `value of`, …) together
 * with the parser, the {@link Visitor}, and fixtures.
 */

import type { SourceSpan } from "@openlogo/core";

/**
 * The shape shared by every AST node: a discriminant `kind` and the
 * `sourceSpan` that produced it. Generic over the kind literal so concrete
 * nodes stay a discriminated union without a hand-maintained kind list.
 */
export interface NodeBase<K extends string> {
  /** Discriminant identifying the node kind. */
  readonly kind: K;
  /** The source range this node was parsed from. */
  readonly sourceSpan: SourceSpan;
}

/** Infix operators, by grammatical precedence level (`spec/grammar.md`). */
export type BinaryOperator =
  "*" | "/" | "mod" | "+" | "-" | "==" | "!=" | "<" | ">" | "<=" | ">=" | "and" | "or";

/** The single prefix operator; a leading `-` on a numeral is a negative literal. */
export type UnaryOperator = "not";

/**
 * A destructuring pattern in binder position, e.g. `[:x :y]`; binds names
 * positionally from a list or record.
 */
export interface DestructuringPattern {
  readonly names: readonly string[];
}

/** A loop/comprehension binder: a single name or a destructuring pattern. */
export type Binder = string | DestructuringPattern;

/**
 * A procedure parameter. A present `default` marks an optional parameter
 * (`(:name default)`); absent marks a required parameter (`:name`).
 */
export interface Param {
  readonly name: string;
  readonly default?: Expression;
}

/** One `key: value` entry of a dictionary literal (Data profile). */
export interface DictEntry {
  /** A bare identifier key or a numeric key. */
  readonly key: string | number;
  readonly value: Expression;
}

// --- Literals ---------------------------------------------------------------

/** A numeric literal, e.g. `100` or `-5`. */
export interface NumberLit extends NodeBase<"NumberLit"> {
  readonly value: number;
}

/** A closed word/string literal, e.g. `"tom"`; `value` is the decoded text. */
export interface WordLit extends NodeBase<"WordLit"> {
  readonly value: string;
}

/** A boolean literal, `true` or `false`. */
export interface BooleanLit extends NodeBase<"BooleanLit"> {
  readonly value: boolean;
}

/** A list literal, e.g. `[1 2 3]`. */
export interface ListLit extends NodeBase<"ListLit"> {
  readonly elements: readonly Expression[];
}

/** A dictionary literal, e.g. `{ tom: 8 }` (Data profile). */
export interface DictLit extends NodeBase<"DictLit"> {
  readonly entries: readonly DictEntry[];
}

// --- References and access --------------------------------------------------

/** A variable read `:name`. */
export interface VarRef extends NodeBase<"VarRef"> {
  readonly name: string;
}

/** A selector access `target[key]`, e.g. `:nums[1]` or `:ages[:who]`. */
export interface Index extends NodeBase<"Index"> {
  readonly target: Expression;
  readonly key: Expression;
}

/** A dot access `target.name`, e.g. `:people.tom`. Always a literal field/key. */
export interface Field extends NodeBase<"Field"> {
  readonly target: Expression;
  readonly name: string;
}

/**
 * An assignable place: a variable read optionally followed by index/field
 * postfixes (`:size`, `:nums[1]`, `:people.tom.age`). Whether a given place is
 * actually assignable is a semantic check, not a distinct node kind.
 */
export type Place = VarRef | Index | Field;

// --- Calls and operators ----------------------------------------------------

/**
 * A fixed-arity prefix call, e.g. `forward 100`. The surface callee word is
 * kept in `callee`, so Heritage aliases (`fd`) reuse this node.
 */
export interface Call extends NodeBase<"Call"> {
  readonly callee: string;
  readonly args: readonly Expression[];
}

/** A parenthesized variadic/alternate-arity call, e.g. `(list 1 2 3)`. */
export interface ParenCall extends NodeBase<"ParenCall"> {
  readonly callee: string;
  readonly args: readonly Expression[];
}

/** A prefix unary operation, e.g. `not :ready?`. */
export interface UnaryOp extends NodeBase<"UnaryOp"> {
  readonly operator: UnaryOperator;
  readonly operand: Expression;
}

/** A left-associative binary operation, e.g. `:size * 2`. */
export interface BinaryOp extends NodeBase<"BinaryOp"> {
  readonly operator: BinaryOperator;
  readonly left: Expression;
  readonly right: Expression;
}

/**
 * A `map` / `filter` / `reduce` comprehension. `reduce` additionally carries the
 * `accumulator` name and its `initial` (`from`) value; both are absent for
 * `map` and `filter`.
 */
export interface Comprehension extends NodeBase<"Comprehension"> {
  readonly form: "map" | "filter" | "reduce";
  readonly binder: Binder;
  readonly iterable: Expression;
  readonly body: Block;
  readonly accumulator?: string;
  readonly initial?: Expression;
}

// --- Blocks -----------------------------------------------------------------

/**
 * A delimited body: a bracketed `[ … ]` block, a long `… end` control block, or
 * a comprehension expression-block. The block-result rule
 * (`spec/execution-model.md`) decides how its value is used.
 */
export interface Block extends NodeBase<"Block"> {
  readonly statements: readonly Statement[];
}

// --- Assignment -------------------------------------------------------------

/**
 * An assignment. `syntax` records the surface form: `"colon"` for
 * `<place> = <value>` and `"set"` for `set <place> to <value>`.
 */
export interface Assign extends NodeBase<"Assign"> {
  readonly syntax: "colon" | "set";
  readonly target: Place;
  readonly value: Expression;
}

// --- Control forms ----------------------------------------------------------

/** An `if` with a `then` block and an optional `else` (`otherwise`) block. */
export interface If extends NodeBase<"If"> {
  readonly condition: Expression;
  readonly then: Block;
  readonly otherwise?: Block;
}

/** A `while` loop. */
export interface While extends NodeBase<"While"> {
  readonly condition: Expression;
  readonly body: Block;
}

/** A `repeat` loop. */
export interface Repeat extends NodeBase<"Repeat"> {
  readonly count: Expression;
  readonly body: Block;
}

/** A `forever` loop. */
export interface Forever extends NodeBase<"Forever"> {
  readonly body: Block;
}

/** A `for <binder> in <iterable>` loop. */
export interface ForIn extends NodeBase<"ForIn"> {
  readonly binder: Binder;
  readonly iterable: Expression;
  readonly body: Block;
}

/** A `for <name> from <from> to <to> [by <by>]` numeric-range loop. */
export interface ForRange extends NodeBase<"ForRange"> {
  readonly name: string;
  readonly from: Expression;
  readonly to: Expression;
  readonly by?: Expression;
  readonly body: Block;
}

// --- Procedures and flow ----------------------------------------------------

/**
 * A procedure definition. `syntax` records the opener keyword: `"define"`
 * (Core) or `"to"` (Heritage). The body is a long `… end` block.
 */
export interface ProcedureDef extends NodeBase<"ProcedureDef"> {
  readonly syntax: "define" | "to";
  readonly name: string;
  readonly params: readonly Param[];
  readonly body: Block;
}

/**
 * A reporter return. `keyword` records the surface word: `"return"` (Core) or
 * the Heritage `"output"` / `"op"`.
 */
export interface Return extends NodeBase<"Return"> {
  readonly keyword: "return" | "output" | "op";
  readonly value: Expression;
}

/** A `stop` — return from a command procedure with no value. */
export type Stop = NodeBase<"Stop">;

/** A `throw` that halts with a learner-facing value. */
export interface Throw extends NodeBase<"Throw"> {
  readonly value: Expression;
}

// --- Data profile -----------------------------------------------------------

/**
 * A `struct <name> [ field … ]` declaration, which registers the record type
 * and a same-named constructor reporter (Data profile).
 */
export interface StructDef extends NodeBase<"StructDef"> {
  readonly name: string;
  readonly fields: readonly string[];
}

// --- Program ----------------------------------------------------------------

/** The root node: a whole `.logo` program. */
export interface Program extends NodeBase<"Program"> {
  readonly body: readonly Statement[];
}

// --- Unions -----------------------------------------------------------------

/** Any node that produces a value. */
export type Expression =
  | NumberLit
  | WordLit
  | BooleanLit
  | ListLit
  | DictLit
  | VarRef
  | Index
  | Field
  | Call
  | ParenCall
  | UnaryOp
  | BinaryOp
  | Comprehension;

/** Any node that can appear as a statement; a bare expression is a statement. */
export type Statement =
  | Assign
  | If
  | While
  | Repeat
  | Forever
  | ForIn
  | ForRange
  | ProcedureDef
  | Return
  | Stop
  | Throw
  | StructDef
  | Expression;

/** Any AST node. */
export type Node = Program | Block | Statement;

/** The discriminant of any node, derived from the {@link Node} union. */
export type NodeKind = Node["kind"];

// --- Visitor ----------------------------------------------------------------

/**
 * A visitor over AST nodes, one handler per node kind, returning `R`. Consumers
 * may instead `switch` on `node.kind` — the union is exhaustively discriminated.
 * Per the ast-design skill, a slice that adds a node kind updates this interface
 * alongside the parser and fixtures.
 */
export interface Visitor<R> {
  visitProgram(node: Program): R;
  visitBlock(node: Block): R;
  visitNumberLit(node: NumberLit): R;
  visitWordLit(node: WordLit): R;
  visitBooleanLit(node: BooleanLit): R;
  visitListLit(node: ListLit): R;
  visitDictLit(node: DictLit): R;
  visitVarRef(node: VarRef): R;
  visitIndex(node: Index): R;
  visitField(node: Field): R;
  visitCall(node: Call): R;
  visitParenCall(node: ParenCall): R;
  visitUnaryOp(node: UnaryOp): R;
  visitBinaryOp(node: BinaryOp): R;
  visitComprehension(node: Comprehension): R;
  visitAssign(node: Assign): R;
  visitIf(node: If): R;
  visitWhile(node: While): R;
  visitRepeat(node: Repeat): R;
  visitForever(node: Forever): R;
  visitForIn(node: ForIn): R;
  visitForRange(node: ForRange): R;
  visitProcedureDef(node: ProcedureDef): R;
  visitReturn(node: Return): R;
  visitStop(node: Stop): R;
  visitThrow(node: Throw): R;
  visitStructDef(node: StructDef): R;
}
