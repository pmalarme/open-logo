/**
 * `@openlogo/parser` — lexer, reader, EBNF grammar, AST, keywords, syntax highlighting,
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
  ProfileStatementNode,
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

// The check-before-execution entry point (`spec/execution-model.md:632-694`, issue #815): Layer 1
// and Layer 2 over one program, merged under the one-fault rules. `applyOneFaultRules` is exported
// beside it because a caller running the layers itself — the studio's diagnostics pane does — still
// owes the learner one message per fault.
export { analyze } from "./analyze.js";
export type { AnalyzeOptions, AnalyzeResult } from "./analyze.js";
export { applyOneFaultRules } from "./one-fault.js";

// The checker's name judgements, shared with `@openlogo/runtime` as a resolver bound to one program
// and one profile set. Two producers of "is this name callable here" is two answers waiting to
// diverge (`spec/tooling.md:174-177` assigns the judgement to the semantic layer), and a runtime
// `ol-unknown-command` computed without the check's did-you-mean is a *different* fault under
// `spec/execution-model.md:741-748`'s identity, so the learner reads one fault twice. Bound rather
// than free so the visible set is built once per run and stays this package's own representation.
export { createNameResolver } from "./checker-unknown-command.js";
export type { NameResolver } from "./checker-unknown-command.js";

export { resolveRecordField } from "./checker-type-field.js";
export type { RecordFieldAccess } from "./checker-type-field.js";

export { isBuiltInName } from "./built-in-names.js";

// The did-you-mean tie-break's profile classification (`spec/error-model.md:211-212`, issue #966).
// Exported because it is a CLAIM about the registry — "is this an optional-profile word?" —
// `challenge` was misclassified as Core for exactly as long as nothing could ask: the
// classification was unreachable from outside, so no test could name it and a hand-written ladder
// drifted unobserved. A claim that must be executable has to be callable.
export { isOptionalProfileName } from "./checker-names.js";

export {
  isKeyword,
  isKeywordInAnyProfile,
  isProfileKeyword,
  OL_KEYWORDS,
  OL_PROFILE_KEYWORDS,
} from "./keywords.js";
export type { Keyword, KeywordProfile, ProfileKeyword } from "./keywords.js";

export {
  corePrimitiveArity,
  turtlePrimitiveArity,
  dataPrimitiveArity,
  educationalPrimitiveArity,
  geometryPrimitiveArity,
  interactionPrimitiveArity,
  soundPrimitiveArity,
  spritesPrimitiveArity,
  tutorPrimitiveArity,
  // The profile-keyed primitive registry's two public accessors (issue #874). Together they let a
  // caller walk `OL_CHECK_PROFILES` and ask what each profile registers and what arity it accepts,
  // without restating a single primitive name — which is how the static arity rule stays derived
  // rather than enumerated, and how its tests assert coverage of primitives they never name.
  activeProfilePrimitiveArityRange,
  profilePrimitiveNames,
  // Command-vs-reporter classification, derived from the same profile-keyed registry as the
  // arities (issue #932). `isPrimitiveCommandName` is the profile-blind half `@openlogo/runtime`
  // consults — it executes without an active-profile set — so `check()` and `execute()` judge a
  // comprehension body's last statement against one registry instead of two hand-written lists.
  isPrimitiveCommandName,
  isActiveProfileCommandName,
  // The Turtle & Rendering alias half: `setxy`/`seth`/`setcolor`/`setbg`/`setwidth` and the
  // canonical each is a spelling of (issue #841). An `aliasOf` edge nothing exposes is an edge
  // nothing can verify, so ADR-0021 §3 requires an enumerable canonical map "consumed by the
  // resolver, so it cannot drift". The map is enumerable; the consumption half is NOT satisfied.
  // Sharing a row removes the duplicate arity and nothing more — `turtlePrimitiveArity` never
  // consults this map, so which canonical a spelling maps to remains two facts, here and in the
  // runtime's dispatch. Closing that needs a real consumer, which this slice does not add.
  canonicalOfTurtleAlias,
  turtleAliasNames,
  canonicalOfHeritageAlias,
  heritageAliasNames,
  heritageAliasArity,
  heritageAliasArityRange,
  canonicalOfHeritageFormHead,
  heritageFormHeadNames,
  heritageWordedForm,
  heritageWordedForms,
  heritageWordedFormNames,
  heritageWordedFormHeads,
  heritageSurfaceSpellings,
} from "./signatures.js";
export type {
  ArityRange,
  HeritageFormHead,
  // Exported to name the shapes the worded-form API already hands out: `HeritageWordedForm` is
  // `heritageWordedForms()`'s element type in the emitted `.d.ts`, and `HeritageWordedFormName` is
  // the constraint on `heritageWordedForm<Name extends …>`. Neither has an in-repo consumer today —
  // a caller that must annotate either would otherwise have to restate a structural literal.
  HeritageWordedForm,
  HeritageWordedFormName,
} from "./signatures.js";

export {
  highlight,
  OL_BRACKET_ROLES,
  OL_TOKEN_CLASSES,
  OL_WORD_OPERATORS,
} from "./highlight.js";
export type {
  BracketRole,
  HighlightOptions,
  Token,
  TokenClass,
} from "./highlight.js";

export { OL_TOKEN_MODIFIERS, semanticTokens } from "./semantic-tokens.js";
export type { SemanticToken, TokenModifier } from "./semantic-tokens.js";

export {
  assertGrammarVersionInSync,
  OL_GRAMMAR_VERSION,
} from "./grammar-version.js";

export { OPENLOGO_VERSION } from "@openlogo/core";
export type { Position, SourceSpan } from "@openlogo/core";
