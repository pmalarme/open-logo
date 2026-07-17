/**
 * `@openlogo/parser` — the lexer, reader, EBNF grammar, the AST, reserved words,
 * syntax highlighting classes, and the syntax + semantic checker. This module is
 * the package's only public entry point; import it as the OpenLogo (`OL`)
 * namespace:
 *
 * ```ts
 * import * as OL from "@openlogo/parser";
 * ```
 *
 * `@openlogo/parser` may depend on `@openlogo/core` (never the reverse). The
 * lexer, reader, and checker land with their own slices; the cross-cutting
 * contract stubs (the AST + the token classes) land here.
 */

export { TOKEN_CLASSES } from "./tokens.js";
export type { TokenClass } from "./tokens.js";

export type {
  NodeBase,
  BinaryOperator,
  UnaryOperator,
  DestructuringPattern,
  Binder,
  Param,
  DictEntry,
  NumberLit,
  WordLit,
  BooleanLit,
  ListLit,
  DictLit,
  VarRef,
  Index,
  Field,
  Place,
  Call,
  ParenCall,
  UnaryOp,
  BinaryOp,
  Comprehension,
  Block,
  Assign,
  If,
  While,
  Repeat,
  Forever,
  ForIn,
  ForRange,
  ProcedureDef,
  Return,
  Stop,
  Throw,
  StructDef,
  Program,
  Expression,
  Statement,
  Node,
  NodeKind,
  Visitor,
} from "./ast.js";

/**
 * The OpenLogo language/feature-detection version. The `@openlogo/*` tuple
 * versions in lockstep (`docs/adr/0003-versioning-and-release.md`).
 */
export const version = "0.1.0";
