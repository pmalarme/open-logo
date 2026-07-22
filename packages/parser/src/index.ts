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
  AddNode,
  AnyNode,
  AssignNode,
  Binder,
  BlockNode,
  BooleanLitNode,
  CallNode,
  ClearNode,
  ComparisonChainNode,
  ComprehensionNode,
  DestructuringBinderNode,
  DictEntryNode,
  DictLitNode,
  ExpressionNode,
  FieldSegment,
  ForeverNode,
  ForInNode,
  ForRangeNode,
  IfNode,
  InsertNode,
  IsPredicateNode,
  IsTest,
  ListLitNode,
  LocalNode,
  MapFilterComprehensionNode,
  NodeBase,
  NodeKind,
  NumberLitNode,
  ParenCallNode,
  PlaceNode,
  PlaceSegment,
  PostfixExpressionNode,
  ProcedureDefNode,
  ProcedureParam,
  ProgramNode,
  ReduceComprehensionNode,
  RemoveKeyNode,
  RemoveNode,
  RepeatNode,
  ReturnNode,
  SelectorSegment,
  SpannedName,
  StatementNode,
  StopNode,
  StructDefNode,
  ThrowNode,
  ValueOfKeyNode,
  VarRefNode,
  Visitor,
  WhileNode,
  WordLitNode,
} from "./ast.js";

export { parse } from "./parser.js";
export type { ParseResult } from "./parser.js";

export { check, DEFAULT_CHECK_PROFILES, OL_CHECK_PROFILES } from "./check.js";
export type { CheckOptions, CheckProfile, CheckResult } from "./check.js";

export { resolveRecordField } from "./checker-type-field.js";
export type { RecordFieldAccess } from "./checker-type-field.js";

export { isReservedWord, OL_RESERVED_WORDS } from "./reserved.js";
export type { ReservedWord } from "./reserved.js";

export {
  corePrimitiveArity,
  turtlePrimitiveArity,
  dataPrimitiveArity,
  educationalPrimitiveArity,
  geometryPrimitiveArity,
} from "./signatures.js";

export { highlight, OL_BRACKET_ROLES, OL_TOKEN_CLASSES } from "./highlight.js";
export type { BracketRole, Token, TokenClass } from "./highlight.js";

export { OL_TOKEN_MODIFIERS, semanticTokens } from "./semantic-tokens.js";
export type { SemanticToken, TokenModifier } from "./semantic-tokens.js";

export {
  assertGrammarVersionInSync,
  OL_GRAMMAR_VERSION,
} from "./grammar-version.js";

export { OPENLOGO_VERSION } from "@openlogo/core";
export type { Position, SourceSpan } from "@openlogo/core";
