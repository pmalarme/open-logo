/**
 * `@openlogo/parser` — lexer, reader, EBNF grammar, AST, reserved words, syntax highlighting,
 * and the syntax/semantic checker. Depends on `@openlogo/core`.
 *
 * ```ts
 * import * as OL from "@openlogo/parser";
 *
 * const { ast, diagnostics } = OL.parse('print :name');
 * ```
 *
 * {@link parse} reads source text into the shared {@link ast} plus a list of `ol-*`
 * diagnostics; it never throws on malformed input. The AST and token-class contracts below are
 * the parser's two cross-cutting seams. The shared `SourceSpan` that every node carries is
 * re-exported from `@openlogo/core` for convenience. See
 * `docs/adr/0006-cross-cutting-contracts.md`.
 */
export { ast, OL_NODE_KINDS, walk } from "./ast.js";
export type {
  AnyNode,
  AssignNode,
  BlockNode,
  BooleanLitNode,
  CallNode,
  ComprehensionNode,
  ExpressionNode,
  ForeverNode,
  ForInNode,
  ForRangeNode,
  IfNode,
  ListLitNode,
  NodeBase,
  NodeKind,
  NumberLitNode,
  ParenCallNode,
  PlaceNode,
  ProcedureDefNode,
  ProcedureParam,
  ProgramNode,
  RepeatNode,
  ReturnNode,
  StatementNode,
  StopNode,
  ThrowNode,
  VarRefNode,
  Visitor,
  WhileNode,
  WordLitNode,
} from "./ast.js";

export { parse } from "./parser.js";
export type { ParseResult } from "./parser.js";

export { isReservedWord, OL_RESERVED_WORDS } from "./reserved.js";
export type { ReservedWord } from "./reserved.js";

export { CORE_PRIMITIVE_ARITY, corePrimitiveArity } from "./signatures.js";

export { OL_TOKEN_CLASSES } from "./highlight.js";
export type { Token, TokenClass } from "./highlight.js";

export type { Position, SourceSpan } from "@openlogo/core";
