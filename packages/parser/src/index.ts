/**
 * `@openlogo/parser` — lexer, reader, EBNF grammar, AST, reserved words, syntax highlighting,
 * and the syntax/semantic checker. Depends on `@openlogo/core`.
 *
 * ```ts
 * import * as OL from "@openlogo/parser";
 * ```
 *
 * The AST and token-class contracts below are the parser's two cross-cutting seams. The
 * shared `SourceSpan` that every node carries is re-exported from `@openlogo/core` for
 * convenience. See `docs/adr/0006-cross-cutting-contracts.md`.
 */
export { ast, OL_NODE_KINDS, walk } from "./ast.js";
export type {
  AnyNode,
  BlockNode,
  BooleanLitNode,
  CallNode,
  ExpressionNode,
  ListLitNode,
  NodeBase,
  NodeKind,
  NumberLitNode,
  ProgramNode,
  StatementNode,
  VarRefNode,
  Visitor,
  WordLitNode,
} from "./ast.js";

export { OL_TOKEN_CLASSES } from "./highlight.js";
export type { Token, TokenClass } from "./highlight.js";

export type { Position, SourceSpan } from "@openlogo/core";
