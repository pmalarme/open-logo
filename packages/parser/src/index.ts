/**
 * `@openlogo/parser` — the lexer, reader, EBNF grammar, the AST, reserved words, syntax
 * highlighting classes, and the syntax + semantic checker. This module is the package's
 * only public entry point; import it as the OpenLogo (`OL`) namespace:
 *
 * ```ts
 * import * as OL from "@openlogo/parser";
 * ```
 *
 * The version constant keeps the `@openlogo/*` tuple in lockstep; the AST and token-class
 * contracts below are the parser's two cross-cutting seams. The shared `SourceSpan` that
 * every node carries is re-exported from `@openlogo/core` for convenience. See
 * `docs/adr/0006-cross-cutting-contracts.md`.
 */
export const version = "0.1.0";

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
