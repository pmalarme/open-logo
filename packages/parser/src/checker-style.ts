/**
 * The Layer-3 style-lint rules (issue #115, slice 1 of the 13-code `ol-style-*` family
 * `spec/tooling.md:237-251` registers, sourced from `spec/style-guide.md`). Every finding here
 * reuses the C10 diagnostic shape with `severity: "warning"` and `stage: "semantic"` — a style
 * lint never changes program meaning, unlike a Layer-2 `ol-*` error.
 *
 * These rules are opt-in: `check.ts` only runs {@link STYLE_RULES} when a caller passes
 * `{ style: true }`, so every existing Layer-2-only caller and conformance fixture is unaffected
 * (`check.ts`'s module doc explains why unconditional style-checking is unsafe).
 *
 * This slice implements exactly three of the thirteen registered codes; the rest are tracked in
 * the #115 follow-up issue:
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
 *   `ComparisonChain`, or a `Call`/`ParenCall` whose callee is `==`/`!=`) whose boolean result is
 *   discarded — usually a slip where the learner meant to assign with `=`
 *   (`spec/style-guide.md` "Keep assignment and comparison visually distinct"). `=` written where
 *   a condition belongs is a *parse* error (`ol-missing-end`), never reaching this rule; only the
 *   opposite slip — a bare `==`/`!=` on its own — is a style warning here. Other comparison
 *   operators (`<`, `>`, `<=`, `>=`) as a single `Call` are not flagged as equality confusion
 *   (the code name is specific to `=`/`==` mix-ups), but any multi-operator `ComparisonChain` at
 *   statement position is, since a chain can never itself be a valid statement-level effect.
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
 *     the #115 follow-up. The trailing closing keyword (`end repeat`, `end if`, …) is **not**
 *     checked either: `ast.ts`'s `BlockNode` records only the body statements, not the closing
 *     keyword's own span, so there is nothing to slice `source` against for it; that narrower
 *     sub-case is likewise deferred to the #115 follow-up. Struct/field type names have no Core
 *     AST node yet (Data profile), so they are out of scope for the same reason
 *     `checker-reserved-word.ts` documents.
 */

import type { Diagnostic, Position } from "@openlogo/core";
import { makeSpan } from "@openlogo/core";
import type {
  AnyNode,
  ProgramNode,
  SpannedName,
  StatementNode,
} from "./ast.js";
import { walk } from "./ast.js";
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

/** The `ol-style-equality-confusion` finding for one statement-position node, if any. */
function equalityConfusionDiagnosticFor(
  statement: StatementNode,
): Diagnostic | undefined {
  if (statement.kind === "ComparisonChain") {
    return equalityConfusionDiagnostic(
      statement,
      statement.operators.map((operator) => operator.name),
    );
  }
  if (statement.kind === "Call" || statement.kind === "ParenCall") {
    const name = statement.callee.name;
    if (name === "==" || name === "!=") {
      return equalityConfusionDiagnostic(statement, [name]);
    }
  }
  return undefined;
}

/**
 * `ol-style-equality-confusion` (issue #115): every statement-position `ComparisonChain` or
 * `==`/`!=` `Call`/`ParenCall` — i.e. an element of a `Program`/`Block`'s own `body` array,
 * never a nested sub-expression — whose discarded boolean usually means the learner meant `=`.
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
 * The opt-in Layer-3 style-rule registry (issue #115), run by `check()` only when
 * `options.style === true`. Order is the order findings are reported in; a later #115 slice
 * appends its rule(s) here the same way {@link RULES} in `check.ts` grows for Layer-2.
 */
export const STYLE_RULES: readonly CheckRule[] = [
  uselessValueRule,
  equalityConfusionRule,
  nameCaseRule,
];
