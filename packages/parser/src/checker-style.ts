/**
 * The Layer-3 style-lint rules (issue #115, slices 1, 2a, and 2b of the 13-code `ol-style-*`
 * family `spec/tooling.md:237-251` registers, sourced from `spec/style-guide.md`). Every finding
 * here reuses the C10 diagnostic shape with `severity: "warning"` and `stage: "semantic"` — a
 * style lint never changes program meaning, unlike a Layer-2 `ol-*` error.
 *
 * These rules are opt-in: `check.ts` only runs {@link STYLE_RULES} when a caller passes
 * `{ style: true }`, so every existing Layer-2-only caller and conformance fixture is unaffected
 * (`check.ts`'s module doc explains why unconditional style-checking is unsafe).
 *
 * These three slices implement nine of the thirteen registered codes; the rest are tracked in
 * the #169 follow-up issue:
 *
 * - `ol-style-useless-value` — a control block (`if`/`while`/`repeat`/`forever`/`for … in`/
 *   `for … from … to`) whose body's final statement statically produces a value that the block
 *   discards (`spec/style-guide.md` "Useless values in effect blocks"). This is the
 *   control-body, warning-severity analog of `checker-control-flow.ts`'s `ol-no-value`
 *   (comprehension-body, error-severity) — both reuse the exact same
 *   {@link producesValue}/command-vs-reporter classification from that module so the two never
 *   drift apart. Reproduces the spec's own worked example verbatim
 *   (`spec/tooling.md:254-262`): `repeat 4 [ :side * 2 ]` → `ol-style-useless-value
 *   { form: "repeat" }`.
 * - `ol-style-equality-confusion` — a standalone top-level comparison statement (a
 *   `ComparisonChain` containing at least one `==`/`!=`, or a `Call`/`ParenCall` whose callee is
 *   `==`/`!=`) whose boolean result is discarded — usually a slip where the learner meant to
 *   assign with `=` (`spec/style-guide.md` "Keep assignment and comparison visually distinct").
 *   `=` written where a condition belongs is a *parse* error (`ol-missing-end`), never reaching
 *   this rule; only the opposite slip — a bare `==`/`!=` on its own — is a style warning here.
 *   Other comparison operators (`<`, `>`, `<=`, `>=`) as a single `Call` are not flagged as
 *   equality confusion (the code name is specific to `=`/`==` mix-ups); a purely relational
 *   `ComparisonChain` (e.g. `1 < 2 < 3`) is likewise never flagged, since it contains no equality
 *   operator that could have been an `=` typo — only a chain containing at least one `==`/`!=` is.
 * - `ol-style-name-case` — a user identifier (variable, place base/field, procedure name,
 *   parameter, loop/comprehension binder) that is not lowercase snake_case with an optional
 *   trailing `?`/`!` (`spec/style-guide.md` "Names use `snake_case`"), checked against
 *   `^[a-z][a-z0-9_]*[?!]?$`. The same code also covers "Keywords are lowercase" in full:
 *   - A `Call`/`ParenCall` callee is checked *only* when its lowercased spelling is a known Core
 *     primitive/command (e.g. `PRINT`), so `PRINT 1` is flagged but a user-defined procedure call
 *     is left alone (see `checkNamesIn`'s `Call`/`ParenCall` case for why). Word-spelled operators
 *     (`mod`/`and`/`or`/`not`) are excluded from that check — the parser normalizes their callee
 *     spelling to canonical lowercase regardless of source casing, so a non-lowercase source
 *     spelling never survives into the AST to check (see `CORE_CALLEE_NAMES`'s doc comment).
 *   - A bare structural keyword that opens a control form, a procedure definition, `return`/
 *     `stop`/`throw`, or a `map`/`filter`/`reduce` comprehension is also checked, e.g.
 *     `REPEAT 4 [ ... ]` is flagged with `params: { name: "REPEAT" }` (see
 *     {@link checkKeywordCasing}). Unlike a primitive callee, no `ast.ts` node carries a field for
 *     its own keyword's *literal* source spelling (`ReturnNode.keyword` and
 *     `ComprehensionNode.form` both store only the canonical lowercase spelling the parser
 *     normalizes to), so this check can only run when `check()`'s caller supplies the original
 *     `source` text (the conformance harness and every real production caller do) — see
 *     {@link checkKeywordCasing}'s own doc comment for the source-unavailable fallback. `local` is
 *     deliberately excluded — its node span starts at the opening paren, not the keyword, in the
 *     `(local name …)` surface form, so a single span-start slice cannot safely tell that form
 *     apart from bare `local name` (see {@link STRUCTURAL_KEYWORD}'s doc comment) — deferred to
 *     the #169 follow-up. The trailing closing keyword (`end repeat`, `end if`, …) is **not**
 *     checked either: `ast.ts`'s `BlockNode` records only the body statements, not the closing
 *     keyword's own span, so there is nothing to slice `source` against for it; that narrower
 *     sub-case is likewise deferred to the #169 follow-up. Struct/field type names have no Core
 *     AST node yet (Data profile), so they are out of scope for the same reason
 *     `checker-reserved-word.ts` documents.
 * - `ol-style-magic-number` — a numeric literal, outside a small safe/idiomatic set
 *   (`spec/style-guide.md`'s own list: `0`, `1`, `2`, `4`, `90`, `120`, `360`), that occurs two or
 *   more times as a bare literal anywhere in the program ("Repeated unexplained numeric literals
 *   should be named with a variable"). A literal used directly as an assignment's right-hand side
 *   (`:name = 37`, `set name to 37`) is already named by that assignment and is excluded from both
 *   the repetition count and the finding — the learner has already done the thing this lint asks
 *   for at that occurrence. See {@link magicNumberRule}.
 * - `ol-style-predicate-name` — a **narrow, conservative** two-directional heuristic, since Core
 *   has no static type system to decide a procedure's return type in general:
 *   - A procedure whose name does not end in `?`, but whose *every* `return` statement's value is
 *     a syntactically-obvious boolean-producing expression (a `true`/`false` literal, a
 *     `ComparisonChain`, an `==`/`!=` `Call`/`ParenCall`, `and`/`or`/`not`, or an `is`-predicate),
 *     is flagged as missing the `?` suffix.
 *   - A procedure whose name *does* end in `?`, but which either has no `return` statement at all
 *     (a pure command can never report a boolean) or has at least one `return` whose value is a
 *     syntactically-obvious *non*-boolean literal (`NumberLit`/`WordLit`/`ListLit`), is flagged
 *     for a misleading `?` suffix.
 *   Anything the heuristic cannot classify either way (a `return`ed `VarRef`, a call to another
 *   user procedure, a mix it cannot prove one way or the other) is left unflagged rather than
 *   guessed at — see {@link isBooleanProducing}/{@link isDefinitelyNonBoolean}'s doc comments.
 *   `Return`s belonging to a *nested* `ProcedureDef` are never attributed to the outer one (see
 *   {@link collectOwnReturns}).
 * - `ol-style-one-command-per-line` (slice 2b, the layout group) — a `Block` body, itself spanning
 *   more than one physical line (its own span's start and end lines differ — the AST's only
 *   available "is this a deliberately short one-line block" signal, since surface delimiter form
 *   is not otherwise recorded; see {@link isBracketBlock}'s doc comment for how `ol-style-
 *   prefer-block` below *does* recover that form), whose direct statements group two or more onto
 *   the same physical start line ("Prefer one command per line", `spec/style-guide.md`). One
 *   finding per offending line, spanning from that line's first statement to its last. See
 *   {@link oneCommandPerLineRule}.
 * - `ol-style-deep-nesting` — a control-form node (`if`/`while`/`repeat`/`forever`/`for … in`/
 *   `for … from … to`) whose own nesting depth among *other* control-form ancestors reaches three
 *   or more, matching the spec's own bad example verbatim (`spec/style-guide.md` "Deep unlabeled
 *   nesting": a `repeat` containing an `if` containing a `repeat`, depth 3, is presented as
 *   needing a helper procedure or labeled ends). Nesting resets to zero inside a nested
 *   `ProcedureDef`'s own body — extracting a helper is exactly the fix this lint recommends, so
 *   the helper's own body must not inherit its caller's depth. See {@link collectDeepNesting}.
 * - `ol-style-block-indentation` — a multi-line `Block` (same one-line exemption as above) with
 *   two or more direct statements whose start *columns* disagree ("Indent the contents of `[ ]`
 *   and long `… end` blocks consistently", `spec/tooling.md:243` — the word is "consistently", not
 *   a specific width, so this rule is deliberately a **consistency** check among sibling
 *   statements, never an absolute-indent-width check, to stay conservative and avoid flagging a
 *   uniformly (if unusually) indented block). The majority column among the block's direct
 *   statements is the baseline; any statement whose own column disagrees with that baseline is
 *   flagged. See {@link blockIndentationRule}.
 * - `ol-style-prefer-block` — a bracket-form `[ … ]` control body (an `if`/`while`/`repeat`/
 *   `forever`/`for … in`/`for … from … to` body only — never a comprehension body, which the
 *   grammar restricts to `[ … ]` alone, and never a `define … end` procedure body, which has no
 *   bracket form at all) that spans more than one physical line ("Suggest a `… end` block when a
 *   bracketed `[ ]` control body spans multiple lines", `spec/tooling.md:244`). `ast.ts`'s
 *   `BlockNode` does not record its own surface delimiter, but {@link isBracketBlock} recovers it
 *   reliably from spans alone — see its doc comment for the exact parser invariant this exploits.
 *   See {@link preferBlockRule}.
 *
 * Two candidates from the #169 remainder were assessed and deliberately **not** attempted in any
 * slice so far, each for a concrete write-set/infrastructure reason (not merely difficulty):
 *
 * - `ol-style-comment-style` needs comment *trivia* to exist somewhere in the token/AST stream to
 *   inspect at all. `tokens.ts`'s lexer treats every `#`/`//`/`/* … *\/` comment as pure whitespace
 *   and discards its text entirely before the parser ever sees a token — there is nothing for an
 *   additive `checker-style.ts` rule to read. Doing this would require the reader/lexer to start
 *   retaining comment spans, which is out of this slice's additive-only write-set; tracked as
 *   blocker issue #175.
 * - `ol-style-procedure-name`'s normatively-decidable parts (non-snake-case naming; the `is_*?`/
 *   `*?` predicate-suffix pattern) are already fully covered by `ol-style-name-case` and
 *   `ol-style-predicate-name` above — implementing it separately would either duplicate those two
 *   findings verbatim or require inventing an un-normative "vague verb" word list the spec never
 *   supplies (`spec/style-guide.md` gives no such list, only illustrative examples like `do_it`).
 *   Left to the #169 follow-up pending that clarification.
 */

import type { Diagnostic, Position } from "@openlogo/core";
import { makeSpan } from "@openlogo/core";
import type {
  AnyNode,
  BlockNode,
  ExpressionNode,
  NumberLitNode,
  ProgramNode,
  ReturnNode,
  SpannedName,
  StatementNode,
} from "./ast.js";
import { childrenOf, walk } from "./ast.js";
import type { CheckProfile, CheckRule } from "./check.js";
import { CORE_COMMANDS, producesValue } from "./checker-control-flow.js";
import { corePrimitiveNames } from "./signatures.js";

/** The `form` param {@link uselessValueRule} reports for each control-block kind it judges. */
const CONTROL_FORM: Readonly<
  Record<"If" | "While" | "Repeat" | "Forever" | "ForIn" | "ForRange", string>
> = {
  If: "if",
  While: "while",
  Repeat: "repeat",
  Forever: "forever",
  ForIn: "for-in",
  ForRange: "for-range",
};

/** Build an `ol-style-useless-value` at the whole control node's span. */
function uselessValueDiagnostic(node: AnyNode, form: string): Diagnostic {
  return {
    code: "ol-style-useless-value",
    source_span: node.source_span,
    params: { form },
    message: `${form} runs its block for actions, so this value is ignored.`,
    stage: "semantic",
    severity: "warning",
  };
}

/** Does `body`'s final statement statically produce a value that a control block would discard? */
function endsInDiscardedValue(
  body: readonly StatementNode[],
  profiles: readonly CheckProfile[],
): boolean {
  const last = body[body.length - 1];
  return last !== undefined && producesValue(last, profiles);
}

/**
 * `ol-style-useless-value` (issue #115): every `if`/`while`/`repeat`/`forever`/`for … in`/
 * `for … from … to` control body whose final statement statically produces a discarded value.
 * An `if` with an `else` is judged on each branch independently. Comprehension bodies are out of
 * scope here — they are the (required, not discarded) `ol-no-value` error instead.
 */
export function uselessValueRule(
  program: ProgramNode,
  profiles: readonly CheckProfile[],
): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  walk(program, (node) => {
    switch (node.kind) {
      case "If": {
        if (endsInDiscardedValue(node.thenBody.body, profiles)) {
          diagnostics.push(uselessValueDiagnostic(node, CONTROL_FORM.If));
        }
        if (
          node.elseBody !== undefined &&
          endsInDiscardedValue(node.elseBody.body, profiles)
        ) {
          diagnostics.push(uselessValueDiagnostic(node, CONTROL_FORM.If));
        }
        return;
      }
      case "While": {
        if (endsInDiscardedValue(node.body.body, profiles)) {
          diagnostics.push(uselessValueDiagnostic(node, CONTROL_FORM.While));
        }
        return;
      }
      case "Repeat": {
        if (endsInDiscardedValue(node.body.body, profiles)) {
          diagnostics.push(uselessValueDiagnostic(node, CONTROL_FORM.Repeat));
        }
        return;
      }
      case "Forever": {
        if (endsInDiscardedValue(node.body.body, profiles)) {
          diagnostics.push(uselessValueDiagnostic(node, CONTROL_FORM.Forever));
        }
        return;
      }
      case "ForIn": {
        if (endsInDiscardedValue(node.body.body, profiles)) {
          diagnostics.push(uselessValueDiagnostic(node, CONTROL_FORM.ForIn));
        }
        return;
      }
      case "ForRange": {
        if (endsInDiscardedValue(node.body.body, profiles)) {
          diagnostics.push(uselessValueDiagnostic(node, CONTROL_FORM.ForRange));
        }
        return;
      }
      default:
        return;
    }
  });

  return diagnostics;
}

/** Build an `ol-style-equality-confusion` at `node`'s own span. */
function equalityConfusionDiagnostic(
  node: AnyNode,
  operators: readonly string[],
): Diagnostic {
  return {
    code: "ol-style-equality-confusion",
    source_span: node.source_span,
    params: { operators },
    message:
      "this comparison's result is never used. did you mean to assign with =?",
    stage: "semantic",
    severity: "warning",
  };
}

/** Operator spellings this lint treats as the `=`-vs-`==` confusion (never plain relational ops). */
const EQUALITY_OPERATORS: ReadonlySet<string> = new Set(["==", "!="]);

/** The `ol-style-equality-confusion` finding for one statement-position node, if any. */
function equalityConfusionDiagnosticFor(
  statement: StatementNode,
): Diagnostic | undefined {
  if (statement.kind === "ComparisonChain") {
    const operators = statement.operators
      .map((operator) => operator.name)
      .filter((name) => EQUALITY_OPERATORS.has(name));
    // A chain of purely relational operators (e.g. `1 < 2 < 3`) can never be an `=`
    // assignment typo -- only flag chains that contain at least one `==`/`!=`.
    if (operators.length === 0) {
      return undefined;
    }
    return equalityConfusionDiagnostic(statement, operators);
  }
  if (statement.kind === "Call" || statement.kind === "ParenCall") {
    const name = statement.callee.name;
    if (EQUALITY_OPERATORS.has(name)) {
      return equalityConfusionDiagnostic(statement, [name]);
    }
  }
  return undefined;
}

/**
 * `ol-style-equality-confusion` (issue #115): every statement-position `ComparisonChain`
 * containing at least one `==`/`!=` operator, or `==`/`!=` `Call`/`ParenCall` -- i.e. an element
 * of a `Program`/`Block`'s own `body` array, never a nested sub-expression -- whose discarded
 * boolean usually means the learner meant `=`. Chains made up only of relational operators
 * (`<`, `>`, `<=`, `>=`) are never flagged: `1 < 2 < 3` cannot plausibly be an `=` assignment typo.
 */
export function equalityConfusionRule(
  program: ProgramNode,
): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  walk(program, (node) => {
    if (node.kind !== "Program" && node.kind !== "Block") {
      return;
    }
    for (const statement of node.body) {
      const diagnostic = equalityConfusionDiagnosticFor(statement);
      if (diagnostic !== undefined) {
        diagnostics.push(diagnostic);
      }
    }
  });

  return diagnostics;
}

/** Lowercase snake_case, with an optional trailing `?`/`!` — `spec/style-guide.md`'s naming rule. */
const NAME_CASE_PATTERN = /^[a-z][a-z0-9_]*[?!]?$/;

/**
 * Every canonical Core primitive/command spelling this rule checks callee casing against. The
 * word-spelled operators (`mod`/`and`/`or`/`not`) are deliberately excluded: the parser matches
 * them case-insensitively but always *normalizes* the callee's stored spelling to its canonical
 * lowercase form (see `parser.ts`'s `parseMultiplicative`/`parseAnd`/`parseOr`/`parseUnary`), so a
 * source `MOD`/`AND` never survives into the AST for this rule to see — unlike a `Call` built by
 * `parseFixedCall`, which keeps the literal token spelling (`sname(token.text, token)`).
 */
const CORE_CALLEE_NAMES: ReadonlySet<string> = new Set([
  ...corePrimitiveNames(),
  ...CORE_COMMANDS,
]);

/** Build an `ol-style-name-case` at `name`'s own span. */
function nameCaseDiagnostic(name: SpannedName): Diagnostic {
  return {
    code: "ol-style-name-case",
    source_span: name.source_span,
    params: { name: name.name },
    message: `${name.name} should be lowercase snake_case, like a learner would read it aloud.`,
    stage: "semantic",
    severity: "warning",
  };
}

/** Push an `ol-style-name-case` for `name` unless it already matches {@link NAME_CASE_PATTERN}. */
function checkNameCase(name: SpannedName, diagnostics: Diagnostic[]): void {
  if (!NAME_CASE_PATTERN.test(name.name)) {
    diagnostics.push(nameCaseDiagnostic(name));
  }
}

/**
 * Canonical opening-keyword spelling for every node kind whose own keyword casing
 * `ol-style-name-case` checks (`spec/style-guide.md` "Keywords are lowercase"). `ForIn` and
 * `ForRange` share the same `"for"` keyword, since the grammar branches on what follows `for`,
 * not on a different opening word (`spec/grammar.md`'s `for-in`/`for-range` productions).
 *
 * `Comprehension` is not a static entry here: `map`/`filter`/`reduce` share one node kind, and its
 * keyword is picked at lookup time from the node's own `form` field instead (see
 * {@link structuralKeywordFor}) — `form` is itself always the lowercased spelling (`parser.ts`'s
 * `parseComprehension(token, lower)` passes the already-`toLowerCase()`d text as `form`), so it is
 * exactly the canonical spelling to compare `source` against, never a stand-in for the literal one.
 *
 * `Local` is deliberately excluded: its node span starts at the `local` keyword token for the bare
 * `local name` form (`parseLocal`), but at the *opening paren* for `(local name …)`
 * (`parseParenLocal`'s `spanToHere(open.source_span.start)`, where `open` is the `(` token) — the
 * AST does not record which surface form was used, so a single span-start slice cannot
 * distinguish them without risking a false read on the paren form. That narrower sub-case is
 * deferred to the #115 follow-up rather than guessed at.
 */
const STRUCTURAL_KEYWORD: Readonly<Record<string, string>> = {
  If: "if",
  While: "while",
  Repeat: "repeat",
  Forever: "forever",
  ForIn: "for",
  ForRange: "for",
  ProcedureDef: "define",
  Return: "return",
  Stop: "stop",
  Throw: "throw",
};

/**
 * Look up the canonical keyword casing `ol-style-name-case` should check `node`'s own span
 * against, if any. Every kind in {@link STRUCTURAL_KEYWORD} is a direct lookup; `Comprehension` is
 * the one dynamic case, keyed off its own `form` (`map`/`filter`/`reduce`) since all three share
 * one node kind and each carries its own keyword's length.
 */
function structuralKeywordFor(node: AnyNode): string | undefined {
  if (node.kind === "Comprehension") {
    return node.form;
  }
  return STRUCTURAL_KEYWORD[node.kind];
}

/**
 * Slice `length` characters out of `source` starting at 1-based `[line, column]` position
 * `start`. A control node's own span always starts at its opening keyword token (confirmed for
 * every {@link STRUCTURAL_KEYWORD} kind in `parser.ts`: e.g. `parseRepeat`'s
 * `spanToHere(token.source_span.start)`), and a keyword token never itself contains a newline, so
 * the slice never crosses a line boundary. `start`'s line is always within `source`'s own line
 * range, since it comes from a node the same `source` was just parsed into —
 * `noUncheckedIndexedAccess` cannot correlate that invariant with an indexed access, so this
 * documents it instead of adding an unreachable fallback that would fail the 100%
 * branch-coverage gate (the same pattern `checker-not-a-place.ts`'s `renderPlace` uses).
 */
function sliceKeyword(source: string, start: Position, length: number): string {
  const [line, column] = start;
  const lineText = source.split("\n")[line - 1] as string;
  return lineText.slice(column - 1, column - 1 + length);
}

/**
 * Push an `ol-style-name-case` when `node` is a structural keyword written with non-lowercase
 * casing (e.g. `REPEAT 4 [ ... ]`, `RETURN :x`, `MAP :n in :xs [ :n * 2 ]`). Unlike a primitive
 * `Call` callee — whose `SpannedName` is a plain AST field — no `ast.ts` control-flow/statement
 * node kind (`RepeatNode`, `IfNode`, `ReturnNode`, …) records its own keyword's literal source
 * spelling (`ReturnNode.keyword` and `ComprehensionNode.form` both store only the *canonical*
 * lowercase spelling the parser normalizes to — the same normalization `CORE_CALLEE_NAMES`'s doc
 * comment describes for word operators — never the literal source casing), so this check can only
 * run by slicing the original `source` text at the node's own span start. When no `source` is
 * supplied (a caller that only has a `ProgramNode`, with no source text at hand), this check is
 * silently skipped — there is no AST-only fallback for a keyword's literal spelling, unlike
 * `checker-not-a-place.ts`'s `renderNode` fallback for reconstructible expression text.
 */
function checkKeywordCasing(
  node: AnyNode,
  source: string,
  diagnostics: Diagnostic[],
): void {
  const keyword = structuralKeywordFor(node);
  if (keyword === undefined) {
    return;
  }
  const { start, document } = node.source_span;
  const text = sliceKeyword(source, start, keyword.length);
  if (text === keyword) {
    return;
  }
  diagnostics.push({
    code: "ol-style-name-case",
    source_span: makeSpan(document, start, [
      start[0],
      start[1] + keyword.length,
    ]),
    params: { name: text },
    message: `${text} should be lowercase, like a learner would read it aloud.`,
    stage: "semantic",
    severity: "warning",
  });
}

/**
 * The identifier-bearing fields `ol-style-name-case` checks for one node, restricted to the
 * fields `walk`'s generic `childrenOf` traversal does not already visit as their own node (a
 * `SpannedName` carries no `kind`, so it is metadata, never a walked node) — see each case for
 * why. Node kinds with no identifier fields of their own fall through the `default` case.
 */
function checkNamesIn(node: AnyNode, diagnostics: Diagnostic[]): void {
  switch (node.kind) {
    case "VarRef":
      checkNameCase(
        { name: node.name, source_span: node.source_span },
        diagnostics,
      );
      return;
    case "Place":
      checkNameCase(node.base, diagnostics);
      for (const segment of node.segments) {
        if (segment.kind === "field") {
          checkNameCase(segment.name, diagnostics);
        }
      }
      return;
    case "PostfixExpression":
      // Unlike `Place`, the base is a walked expression (checked by `walk`'s own generic
      // recursion via `childrenOf`), so only the dotted field segments — metadata, not their own
      // walked node — need checking here.
      for (const segment of node.segments) {
        if (segment.kind === "field") {
          checkNameCase(segment.name, diagnostics);
        }
      }
      return;
    case "ProcedureDef":
      checkNameCase(node.name, diagnostics);
      for (const param of node.params) {
        checkNameCase(param.name, diagnostics);
      }
      return;
    case "Local":
      for (const name of node.names) {
        checkNameCase(name, diagnostics);
      }
      return;
    case "DestructuringBinder":
      for (const name of node.names) {
        checkNameCase(name, diagnostics);
      }
      return;
    case "ForIn":
      // A destructuring binder is itself a walked "DestructuringBinder" node (see `childrenOf`)
      // and is checked there instead; a bare binder is metadata (a `SpannedName`), so it is only
      // reachable here.
      if (!("kind" in node.binder)) {
        checkNameCase(node.binder, diagnostics);
      }
      return;
    case "ForRange":
      checkNameCase(node.variable, diagnostics);
      return;
    case "Call":
    case "ParenCall":
      // `spec/style-guide.md` "Keywords are lowercase" also covers *primitive* casing (its own
      // linter-check note names `ol-style-name-case`, not `ol-style-full-name`, which is about
      // alias-vs-full-name choice, never case). Only check when the callee's lowercased spelling
      // is a *known* Core primitive/command — a user procedure call is left alone, since telling
      // a mistyped user name from a deliberately different one needs the same registries
      // `ol-unknown-command` consults, deferred to the #115 follow-up.
      if (CORE_CALLEE_NAMES.has(node.callee.name.toLowerCase())) {
        checkNameCase(node.callee, diagnostics);
      }
      return;
    case "Comprehension": {
      // Same reasoning as "ForIn": a destructuring binder is its own walked "DestructuringBinder"
      // node (per `childrenOf`) and is checked there; a bare binder is metadata, only reachable
      // here.
      if (!("kind" in node.binder)) {
        checkNameCase(node.binder, diagnostics);
      }
      if (node.form === "reduce") {
        checkNameCase(node.accumulator, diagnostics);
      }
      return;
    }
    default:
      return;
  }
}

/**
 * `ol-style-name-case` (issue #115): every user identifier occurrence — variable reads, place
 * bases/fields, procedure names, parameters, `local` names, and loop/comprehension binders —
 * that is not lowercase snake_case (`^[a-z][a-z0-9_]*[?!]?$`), plus a known Core primitive/
 * command callee written with non-lowercase casing, plus (when `source` is supplied) a
 * structural keyword (`if`/`while`/`repeat`/`forever`/`for`/`define`/`return`/`stop`/`throw`/
 * `map`/`filter`/`reduce`) written with non-lowercase casing — see {@link checkKeywordCasing}'s
 * doc comment for why `source` is required for that last case only, and
 * {@link STRUCTURAL_KEYWORD}'s doc comment for why `local` is not in that list.
 */
export function nameCaseRule(
  program: ProgramNode,
  _profiles: readonly CheckProfile[],
  source?: string,
): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  walk(program, (node) => {
    checkNamesIn(node, diagnostics);
    if (source !== undefined) {
      checkKeywordCasing(node, source, diagnostics);
    }
  });
  return diagnostics;
}

/**
 * Numeric literals small/idiomatic enough that a repeated bare occurrence is never "magic" —
 * `spec/style-guide.md`'s own list, verbatim: "small obvious values such as `0`, `1`, `2`, `4`,
 * `90`, `120`, and `360`".
 */
const MAGIC_NUMBER_SAFE_VALUES: ReadonlySet<number> = new Set([
  0, 1, 2, 4, 90, 120, 360,
]);

/** Build an `ol-style-magic-number` at `node`'s own span. */
function magicNumberDiagnostic(node: NumberLitNode): Diagnostic {
  return {
    code: "ol-style-magic-number",
    source_span: node.source_span,
    params: { value: node.value },
    message: `${node.value} appears more than once unexplained — name it with a variable.`,
    stage: "semantic",
    severity: "warning",
  };
}

/**
 * `ol-style-magic-number` (issue #169): a bare numeric literal, outside
 * {@link MAGIC_NUMBER_SAFE_VALUES}, that occurs two or more times anywhere in the program
 * ("Repeated unexplained numeric literals should be named with a variable",
 * `spec/style-guide.md` "Magic numbers"). A literal used directly as an assignment's right-hand
 * side (`:name = 37`, `set name to 37`) is already named by that assignment, so it is excluded
 * from both the repetition count and the finding — walking `Assign` nodes pre-order (via `walk`)
 * always visits the `Assign` itself before its `value` child, so marking that child here always
 * runs before the child's own visit in the same traversal.
 */
export function magicNumberRule(program: ProgramNode): readonly Diagnostic[] {
  const excludedAsAssignmentRhs = new Set<ExpressionNode>();
  const occurrencesByValue = new Map<number, NumberLitNode[]>();

  walk(program, (node) => {
    if (node.kind === "Assign" && node.value.kind === "NumberLit") {
      excludedAsAssignmentRhs.add(node.value);
      return;
    }
    if (
      node.kind !== "NumberLit" ||
      excludedAsAssignmentRhs.has(node) ||
      MAGIC_NUMBER_SAFE_VALUES.has(node.value)
    ) {
      return;
    }
    const occurrences = occurrencesByValue.get(node.value);
    if (occurrences === undefined) {
      occurrencesByValue.set(node.value, [node]);
    } else {
      occurrences.push(node);
    }
  });

  const diagnostics: Diagnostic[] = [];
  for (const occurrences of occurrencesByValue.values()) {
    if (occurrences.length < 2) {
      continue;
    }
    for (const occurrence of occurrences) {
      diagnostics.push(magicNumberDiagnostic(occurrence));
    }
  }
  return diagnostics;
}

/**
 * Is `expr` a syntactically-obvious boolean-producing expression? A conservative, Core-only
 * heuristic — Core has no static type system, so this can never be exhaustive; it only
 * recognizes the shapes that *always* report a boolean regardless of operands: a `true`/`false`
 * literal, a comparison (`ComparisonChain`, or a lone `==`/`!=`/`<`/`>`/`<=`/`>=` `Call`/
 * `ParenCall`), a worded `is`-predicate, and the boolean connectives `and`/`or`/`not`. Anything
 * else (a `VarRef`, a call to another user procedure, a number/word/list literal, …) returns
 * `false` — meaning "not provably boolean", not "provably non-boolean"; see
 * {@link isDefinitelyNonBoolean} for that opposite, narrower question.
 */
function isBooleanProducing(expr: ExpressionNode): boolean {
  switch (expr.kind) {
    case "BooleanLit":
    case "ComparisonChain":
    case "IsPredicate":
      return true;
    case "Call":
    case "ParenCall":
      return BOOLEAN_CALLEE_NAMES.has(expr.callee.name);
    default:
      return false;
  }
}

/** Callee spellings whose call always reports a boolean, for {@link isBooleanProducing}. */
const BOOLEAN_CALLEE_NAMES: ReadonlySet<string> = new Set([
  "==",
  "!=",
  "<",
  ">",
  "<=",
  ">=",
  "and",
  "or",
  "not",
]);

/**
 * Is `expr` *definitely* not boolean? Narrower and much more conservative than the negation of
 * {@link isBooleanProducing}: only a literal number/word/list is unambiguous proof, since a
 * `VarRef` or a call to another procedure could still resolve to a boolean at runtime and this
 * rule must never guess.
 */
function isDefinitelyNonBoolean(expr: ExpressionNode): boolean {
  return (
    expr.kind === "NumberLit" ||
    expr.kind === "WordLit" ||
    expr.kind === "ListLit"
  );
}

/**
 * Collect every `Return` node inside `node` that belongs to *this* procedure body — i.e. does not
 * cross into a nested `ProcedureDef`'s own body. `walk` alone cannot express this (it always
 * descends into every child, including a nested procedure's), so this is a small dedicated
 * traversal built directly on {@link childrenOf} instead.
 */
function collectOwnReturns(node: AnyNode, out: ReturnNode[]): void {
  if (node.kind === "Return") {
    out.push(node);
    return;
  }
  if (node.kind === "ProcedureDef") {
    return;
  }
  for (const child of childrenOf(node)) {
    collectOwnReturns(child, out);
  }
}

/** Build an `ol-style-predicate-name` at `name`'s own span. */
function predicateNameDiagnostic(
  name: SpannedName,
  problem: "missing-suffix" | "misleading-suffix",
): Diagnostic {
  const message =
    problem === "missing-suffix"
      ? `${name.name} reports a boolean, so its name should end in ? like a question.`
      : `${name.name} ends in ? but does not report a boolean — drop the ? or return one.`;
  return {
    code: "ol-style-predicate-name",
    source_span: name.source_span,
    params: { name: name.name, problem },
    message,
    stage: "semantic",
    severity: "warning",
  };
}

/**
 * `ol-style-predicate-name` (issue #169): flags a procedure name that disagrees with whether its
 * body provably reports a boolean, in either direction (`spec/style-guide.md` "Name predicates
 * with `?`"). See this file's module doc comment for the full heuristic and its deliberate
 * conservatism — anything the heuristic cannot prove one way or the other is left unflagged.
 */
export function predicateNameRule(program: ProgramNode): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  walk(program, (node) => {
    if (node.kind !== "ProcedureDef") {
      return;
    }
    const returns: ReturnNode[] = [];
    collectOwnReturns(node.body, returns);
    const endsWithQuestion = node.name.name.endsWith("?");

    if (
      !endsWithQuestion &&
      returns.length > 0 &&
      returns.every((r) => isBooleanProducing(r.value))
    ) {
      diagnostics.push(predicateNameDiagnostic(node.name, "missing-suffix"));
      return;
    }
    if (
      endsWithQuestion &&
      (returns.length === 0 ||
        returns.some((r) => isDefinitelyNonBoolean(r.value)))
    ) {
      diagnostics.push(predicateNameDiagnostic(node.name, "misleading-suffix"));
    }
  });
  return diagnostics;
}

/** Build an `ol-style-one-command-per-line` spanning `first`'s start through `last`'s end. */
function oneCommandPerLineDiagnostic(
  first: StatementNode,
  last: StatementNode,
  count: number,
): Diagnostic {
  return {
    code: "ol-style-one-command-per-line",
    source_span: makeSpan(
      first.source_span.document,
      first.source_span.start,
      last.source_span.end,
    ),
    params: { count },
    message: `${count} commands share this line — give each its own line inside a multi-line block.`,
    stage: "semantic",
    severity: "warning",
  };
}

/**
 * `ol-style-one-command-per-line` (issue #169): a `Block` whose own span crosses more than one
 * physical line (excluding a deliberately short one-line block, which the rule never inspects at
 * all) but whose direct statements group two or more onto the very same physical start line
 * (`spec/style-guide.md` "Prefer one command per line"). Statements are grouped by their own
 * `source_span.start` line — same-line statements are always contiguous in a `Block`'s `body`
 * array, since the array is already in source order, so a single `Map` grouping pass (the same
 * shape {@link magicNumberRule} uses to group by value) is enough; no separate adjacency check is
 * needed.
 */
export function oneCommandPerLineRule(
  program: ProgramNode,
): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  walk(program, (node) => {
    if (
      node.kind !== "Block" ||
      node.source_span.start[0] === node.source_span.end[0]
    ) {
      return;
    }
    const byLine = new Map<number, StatementNode[]>();
    for (const statement of node.body) {
      const line = statement.source_span.start[0];
      const group = byLine.get(line);
      if (group === undefined) {
        byLine.set(line, [statement]);
      } else {
        group.push(statement);
      }
    }
    for (const group of byLine.values()) {
      if (group.length < 2) {
        continue;
      }
      const first = group[0];
      const last = group[group.length - 1];
      if (first !== undefined && last !== undefined) {
        diagnostics.push(
          oneCommandPerLineDiagnostic(first, last, group.length),
        );
      }
    }
  });
  return diagnostics;
}

/** The `form` param {@link deepNestingRule} and {@link preferBlockRule} report, reusing the same control-kind → form-name mapping {@link uselessValueRule} uses. */
const NESTING_CONTROL_KIND: ReadonlySet<string> = new Set(
  Object.keys(CONTROL_FORM),
);

/** How many nested control forms are "too deep", matching the spec's own bad example verbatim. */
const DEEP_NESTING_THRESHOLD = 3;

/** Build an `ol-style-deep-nesting` at `node`'s own span. */
function deepNestingDiagnostic(
  node: AnyNode,
  form: string,
  depth: number,
): Diagnostic {
  return {
    code: "ol-style-deep-nesting",
    source_span: node.source_span,
    params: { form, depth },
    message: `this ${form} is nested ${depth} levels deep — extract a helper procedure or add labeled ends.`,
    stage: "semantic",
    severity: "warning",
  };
}

/**
 * Recurse through `node`, tracking `depth` — the count of enclosing control-form ancestors
 * (`If`/`While`/`Repeat`/`Forever`/`ForIn`/`ForRange`), inclusive of `node` itself when `node` is
 * one. Depth resets to zero inside a nested `ProcedureDef`'s own body: extracting a helper
 * procedure is exactly the fix `ol-style-deep-nesting` recommends, so the helper's own nesting
 * must never inherit its caller's depth (the same reset {@link collectOwnReturns} applies for
 * `ol-style-predicate-name`, for the same reason — a nested definition starts a fresh scope).
 */
function collectDeepNesting(
  node: AnyNode,
  depth: number,
  diagnostics: Diagnostic[],
): void {
  if (node.kind === "ProcedureDef") {
    for (const child of childrenOf(node)) {
      collectDeepNesting(child, 0, diagnostics);
    }
    return;
  }
  const isControlForm = NESTING_CONTROL_KIND.has(node.kind);
  const nextDepth = isControlForm ? depth + 1 : depth;
  if (isControlForm && nextDepth >= DEEP_NESTING_THRESHOLD) {
    diagnostics.push(
      deepNestingDiagnostic(
        node,
        CONTROL_FORM[node.kind as keyof typeof CONTROL_FORM],
        nextDepth,
      ),
    );
  }
  for (const child of childrenOf(node)) {
    collectDeepNesting(child, nextDepth, diagnostics);
  }
}

/**
 * `ol-style-deep-nesting` (issue #169): a control-form node whose own nesting depth among other
 * control-form ancestors reaches {@link DEEP_NESTING_THRESHOLD} or more (`spec/style-guide.md`
 * "Deep unlabeled nesting"). See {@link collectDeepNesting} for the traversal and the
 * nested-`ProcedureDef` reset.
 */
export function deepNestingRule(program: ProgramNode): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  collectDeepNesting(program, 0, diagnostics);
  return diagnostics;
}

/** Build an `ol-style-block-indentation` at `statement`'s own span. */
function blockIndentationDiagnostic(
  statement: StatementNode,
  expected: number,
  found: number,
): Diagnostic {
  return {
    code: "ol-style-block-indentation",
    source_span: statement.source_span,
    params: { expected, found },
    message: `this line is indented to column ${found}, but sibling lines in this block use column ${expected}.`,
    stage: "semantic",
    severity: "warning",
  };
}

/**
 * `ol-style-block-indentation` (issue #169): a multi-line `Block` (the same one-line exemption as
 * {@link oneCommandPerLineRule}) whose direct statements' start columns disagree
 * (`spec/tooling.md:243` says blocks should be indented "consistently", not to a specific width,
 * so this is deliberately a consistency check among the block's own direct statements rather than
 * an absolute-width check — a uniformly, if unusually, indented block is never flagged). The
 * *majority* column among the block's direct statements is the baseline (ties break toward
 * whichever column is seen first, via strict `>` on the running best count); every statement whose
 * own column disagrees with that baseline is flagged. A block with fewer than two statements has
 * nothing to compare and is skipped.
 */
export function blockIndentationRule(
  program: ProgramNode,
): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  walk(program, (node) => {
    if (
      node.kind !== "Block" ||
      node.source_span.start[0] === node.source_span.end[0] ||
      node.body.length < 2
    ) {
      return;
    }
    const countByColumn = new Map<number, number>();
    for (const statement of node.body) {
      const column = statement.source_span.start[1];
      countByColumn.set(column, (countByColumn.get(column) ?? 0) + 1);
    }
    let baselineColumn = -1;
    let baselineCount = 0;
    for (const [column, count] of countByColumn) {
      if (count > baselineCount) {
        baselineColumn = column;
        baselineCount = count;
      }
    }
    for (const statement of node.body) {
      const column = statement.source_span.start[1];
      if (column !== baselineColumn) {
        diagnostics.push(
          blockIndentationDiagnostic(statement, baselineColumn, column),
        );
      }
    }
  });
  return diagnostics;
}

/**
 * Does `block` use the bracket `[ … ]` surface form? `ast.ts`'s `BlockNode` records no field for
 * its own surface delimiter, so this recovers it from `source` by inspecting `block`'s own
 * *closing* delimiter rather than its first statement. `parseBracketBlock` (`parser.ts`) always
 * spans `[open, closeBracket)` — i.e. `block.source_span.end` sits immediately after the literal
 * `]` character — while `parseLongBlock`'s span ends immediately after the `end` keyword (or its
 * optional label), both of which are `name` tokens that can never contain `]`. So the character
 * one before `block.source_span.end` is `]` if and only if `block` is bracket-form; checking the
 * *end* of the span (rather than the start, against `body[0]`) is deliberate — it stays correct
 * even when the block's first statement is itself a bracket-delimited expression (e.g. a bare
 * `[1 2 3]` list-literal statement, or the block containing a comprehension whose own body is
 * `[ … ]`), where a start-based comparison would be fooled by the body's own delimiters, and it
 * is unaffected by the parser's error-recovery `resync()` reordering *interior* body statements.
 * `check()` has no documented precondition that its input parsed clean, so this deliberately
 * fails *safe* rather than assuming one: a block missing its own closing `]`/`end` (a genuine
 * parse error) ends its span at whatever token the parser gave up on, which is `]` only by
 * coincidence — `sliceKeyword` then either reads an unrelated character (no false positive; the
 * comparison to `"]"` simply fails) or, when `endColumn` is `1` (the span-end token starts at the
 * very beginning of its line), reads past the start of that line and returns `""` (still no
 * false positive, only a false negative) — never a crash, never a wrong-positive finding.
 *
 * `source` is required: unlike `body[0]`, there is no AST-only proxy for a block's own literal
 * closing text, so — mirroring {@link checkKeywordCasing}'s own "no source, skip the check"
 * precedent in this file — a block is never reported as bracket-form when `source` is absent.
 */
function isBracketBlock(block: BlockNode, source: string | undefined): boolean {
  if (source === undefined) {
    return false;
  }
  const [endLine, endColumn] = block.source_span.end;
  return sliceKeyword(source, [endLine, endColumn - 1], 1) === "]";
}

/** Build an `ol-style-prefer-block` at `block`'s own span. */
function preferBlockDiagnostic(block: BlockNode, form: string): Diagnostic {
  return {
    code: "ol-style-prefer-block",
    source_span: block.source_span,
    params: { form },
    message: `this ${form} body spans multiple lines — an … end block reads more clearly here.`,
    stage: "semantic",
    severity: "warning",
  };
}

/** Flag `block` for `form` when it is a multi-line bracket block, else do nothing. */
function checkPreferBlock(
  block: BlockNode,
  form: string,
  diagnostics: Diagnostic[],
  source: string | undefined,
): void {
  if (
    isBracketBlock(block, source) &&
    block.source_span.start[0] !== block.source_span.end[0]
  ) {
    diagnostics.push(preferBlockDiagnostic(block, form));
  }
}

/**
 * `ol-style-prefer-block` (issue #169): a bracket-form control body — `if`/`while`/`repeat`/
 * `forever`/`for … in`/`for … from … to` only, matching {@link uselessValueRule}'s own six-kind
 * switch — that spans more than one physical line (`spec/tooling.md:244`). A comprehension body
 * is out of scope: the grammar restricts it to `[ … ]` alone (it is "the only body form the
 * block-result rule lets return a value", per `spec/style-guide.md`), so it can never be
 * rewritten as `… end`. A `define … end` procedure body is likewise out of scope: it has no
 * bracket form to begin with. See {@link isBracketBlock} for how the bracket/`end` surface form
 * is recovered without a dedicated AST field.
 */
export function preferBlockRule(
  program: ProgramNode,
  _profiles: readonly CheckProfile[],
  source?: string,
): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  walk(program, (node) => {
    switch (node.kind) {
      case "If":
        checkPreferBlock(node.thenBody, CONTROL_FORM.If, diagnostics, source);
        if (node.elseBody !== undefined) {
          checkPreferBlock(node.elseBody, CONTROL_FORM.If, diagnostics, source);
        }
        return;
      case "While":
        checkPreferBlock(node.body, CONTROL_FORM.While, diagnostics, source);
        return;
      case "Repeat":
        checkPreferBlock(node.body, CONTROL_FORM.Repeat, diagnostics, source);
        return;
      case "Forever":
        checkPreferBlock(node.body, CONTROL_FORM.Forever, diagnostics, source);
        return;
      case "ForIn":
        checkPreferBlock(node.body, CONTROL_FORM.ForIn, diagnostics, source);
        return;
      case "ForRange":
        checkPreferBlock(node.body, CONTROL_FORM.ForRange, diagnostics, source);
        return;
      default:
        return;
    }
  });
  return diagnostics;
}

/**
 * The opt-in Layer-3 style-rule registry (issue #115), run by `check()` only when
 * `options.style === true`. Order is the order findings are reported in; a later #169 slice
 * appends its rule(s) here the same way {@link RULES} in `check.ts` grows for Layer-2.
 */
export const STYLE_RULES: readonly CheckRule[] = [
  uselessValueRule,
  equalityConfusionRule,
  nameCaseRule,
  magicNumberRule,
  predicateNameRule,
  oneCommandPerLineRule,
  deepNestingRule,
  blockIndentationRule,
  preferBlockRule,
];
