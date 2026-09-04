/**
 * The Layer-3 style-lint rules (issue #115, slices 1, 2a, and 2b of the 15-code `ol-style-*`
 * family `spec/tooling.md:238-254` registers, sourced from `spec/style-guide.md`). Every finding
 * here reuses the C10 diagnostic shape with `severity: "warning"` and `stage: "semantic"` — a
 * style lint never changes program meaning, unlike a Layer-2 `ol-*` error.
 *
 * These rules are opt-in: `check.ts` only runs {@link STYLE_RULES} when a caller passes
 * `{ style: true }`, so every existing Layer-2-only caller and conformance fixture is unaffected
 * (`check.ts`'s module doc explains why unconditional style-checking is unsafe).
 *
 * These three slices — together with the `ol-style-nested-handler` and
 * `ol-style-ambiguous-continuation` rules added by later issues — implement eleven of the fifteen registered codes; the rest are tracked in
 * the #169 follow-up issue:
 *
 * - `ol-style-useless-value` — a control block (`if`/`while`/`repeat`/`forever`/`for … in`/
 *   `for … from … to`) whose body's final statement statically produces a value that the block
 *   discards (`spec/style-guide.md` "Useless values in effect blocks"). This is the
 *   control-body, warning-severity analog of `checker-control-flow.ts`'s `ol-no-value`
 *   (comprehension-body, error-severity) — both reuse the exact same
 *   {@link producesValue}/command-vs-reporter classification from that module so the two never
 *   drift apart. Reproduces the spec's own worked example — the `… end repeat` block form at
 *   `spec/tooling.md:255-264`, written here in its equivalent bracket form:
 *   `repeat 4 [ :side * 2 ]` → `ol-style-useless-value { form: "repeat" }`.
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
 *   `^[a-z][a-z0-9_]*[?!]?$`. The same code also covers "Keywords are lowercase", for every
 *   keyword or primitive that has a span of its own to judge:
 *   - A `Call`/`ParenCall` callee is checked *only* when it is a **built-in name**
 *     ({@link isBuiltInName}), so `PRINT 1` and `FORWARD 100` are flagged but a user-defined
 *     procedure call is left alone (see `checkNamesIn`'s `Call`/`ParenCall` case for why).
 *   - A statement whose own span opens with a built-in name written in some other case is flagged
 *     too, e.g. `REPEAT 4 [ ... ]` with `params: { name: "REPEAT" }` (see
 *     {@link keywordCasingDiagnostic}). Unlike a primitive callee, no `ast.ts` node carries a field
 *     for its own keyword's *literal* source spelling (`ReturnNode.keyword` and
 *     `ComprehensionNode.form` both store only the canonical lowercase spelling the parser
 *     normalizes to), so this check can only run when `check()`'s caller supplies the original
 *     `source` text (the conformance harness and every real production caller do) — see
 *     {@link keywordCasingDiagnostic}'s own doc comment for the source-unavailable fallback.
 *   - A keyword with **no span of its own** is out of scope and deferred to the #115 follow-up:
 *     `else` (no `else` span on `IfNode`), a block's closing `end repeat`/`end if` (`ast.ts`'s
 *     `BlockNode` records only the body statements), and the worded reader's `of`/`for`/`key`
 *     (only its head `value` is spanned). Struct/field type names have no Core AST node yet (Data
 *     profile), so they are out of scope for the same reason `checker-reserved-word.ts` documents.
 *
 *     Both checked halves consult the **registries** rather than a list of names or of node kinds
 *     (issue #854, epic #900: *no component enumerates built-in names by hand*) — see
 *     {@link isBuiltInName} for the three sources and {@link leadingWordAt} for why reading a whole
 *     word out of the source is what removes the node-kind table.
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
 *   and long `… end` blocks consistently", `spec/tooling.md:244` — the word is "consistently", not
 *   a specific width, so this rule is deliberately a **consistency** check among sibling
 *   statements, never an absolute-indent-width check, to stay conservative and avoid flagging a
 *   uniformly (if unusually) indented block). The majority column among the block's direct
 *   statements is the baseline; any statement whose own column disagrees with that baseline is
 *   flagged. See {@link blockIndentationRule}.
 * - `ol-style-prefer-block` — a bracket-form `[ … ]` control body (an `if`/`while`/`repeat`/
 *   `forever`/`for … in`/`for … from … to` body only — never a comprehension body, which the
 *   grammar restricts to `[ … ]` alone, and never a `define … end` procedure body, which has no
 *   bracket form at all) that spans more than one physical line ("Suggest a `… end` block when a
 *   bracketed `[ ]` control body spans multiple lines", `spec/tooling.md:245`). `ast.ts`'s
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

import type { Diagnostic, Position, SourceSpan } from "@openlogo/core";
import { makeSpan } from "@openlogo/core";
import type {
  AnyNode,
  BlockNode,
  ExpressionNode,
  NodeKind,
  NumberLitNode,
  ProgramNode,
  ReturnNode,
  SpannedName,
  StatementNode,
} from "./ast.js";
import { childrenOf, walk } from "./ast.js";
import type { CheckProfile, CheckRule } from "./check.js";
import { isBuiltInName } from "./built-in-names.js";
import { producesValue } from "./checker-control-flow.js";

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
 * The casing lint's built-in-name question is **the shared predicate**, not a local composition.
 *
 * It used to be one: `isKeyword` + `primitiveArity` + `heritageSurfaceSpellings`, with a comment
 * conceding that it agreed with `built-in-names.ts` as "a fact about the registry, not a property
 * either module guarantees", and deferring the narrowing to a corpus sweep that closed without
 * doing it. Measured before the collapse (issue #965): the two agreed on all **148** names of the
 * complete registry universe, but **13** of them — `bf bk bl cs fd ht lt pd pr pu rt se st` — were
 * true on one side through alias resolution and on the other through the surface-spelling registry.
 * Names that coincide through different legs are not names that correspond, and nothing compared
 * them, so the agreement was an unenforced assertion inside the epic that forbids them.
 *
 * `built-in-names.ts` now consults the surface-spelling registry itself, which was this rule's only
 * substantive extra source, so there is nothing left for a second composition to carry. Everything
 * the deleted block documented still holds and is documented there: the derivation is registry
 * consultations rather than a list (issue #854), and its bound was tested in flight when issue #838
 * registered `TUTOR_PRIMITIVE_ARITY` and this rule began covering `challenge` with no edit at all.
 *
 * Membership is **profile-independent on purpose** — see {@link nameCaseRule} for why. It is also
 * independent of what the program *declares*: `spec/grammar.md:363` is "a program may not declare
 * a built-in name", so `define print … end` is an `ol-reserved-word` error rather than a shadowing
 * that could make `PRINT`'s casing stop mattering. A call to a name that is in no registry — an
 * ordinary user procedure — is left alone by construction, with no exemption needed.
 */

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
 * An identifier-shaped word, anchored at the start of the text it is matched against — the shape
 * `tokens.ts` lexes a name/keyword as, plus the optional trailing `?`/`!`
 * {@link NAME_CASE_PATTERN} allows, so a predicate name is read as ONE word rather than a stem.
 * Deliberately case-insensitive in the leading class: this pattern exists to read the learner's
 * *literal* casing back out of the source, so it must match `REPEAT` and `Repeat` as readily as
 * `repeat`.
 */
const LEADING_WORD_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*[?!]?/;

/**
 * The identifier-shaped word `lines` begins with at 1-based `[line, column]` position `start`, or
 * `undefined` when no word starts exactly there.
 *
 * `undefined` is the load-bearing case, and it is what lets this rule be derived instead of
 * enumerated. A node's span starts at its opening token, but that token is only *sometimes* a
 * word: `(local name …)` starts at the `(`, `:x = 1` at the `:`, `[ … ]` at the `[`. The previous
 * implementation sliced a FIXED number of characters and compared them against a per-node-kind
 * canonical, so it had to keep a hand-written table of node kinds it dared to slice at — and
 * `Local` had to be excluded by hand, because `(loca` would have been reported verbatim as a
 * mis-cased keyword. Reading a whole word and asking a registry whether it *is* a built-in inverts
 * that: a non-word start simply yields no candidate, so the false read the exclusion guarded
 * against is now structurally impossible rather than hand-avoided.
 *
 * `start`'s line is always within `lines`' own range, since it comes from a node the same source
 * was just parsed into — `noUncheckedIndexedAccess` cannot correlate that invariant with an
 * indexed access, so this documents it instead of adding an unreachable fallback that would fail
 * the 100% branch-coverage gate (the same pattern `checker-not-a-place.ts`'s `renderPlace` uses).
 */
function leadingWordAt(
  lines: readonly string[],
  start: Position,
): string | undefined {
  const [line, column] = start;
  const lineText = lines[line - 1] as string;
  return LEADING_WORD_PATTERN.exec(lineText.slice(column - 1))?.[0];
}

/**
 * Slice `length` characters out of `source` starting at 1-based `[line, column]` position
 * `start`. Its one caller, {@link isBracketBlock}, reads a single delimiter character back out of
 * the source at a span end. `start`'s line is always within `source`'s own line range, since it
 * comes from a node the same `source` was just parsed into — `noUncheckedIndexedAccess` cannot
 * correlate that invariant with an indexed access, so this documents it instead of adding an
 * unreachable fallback that would fail the 100% branch-coverage gate (the same pattern
 * `checker-not-a-place.ts`'s `renderPlace` uses).
 */
function sliceKeyword(source: string, start: Position, length: number): string {
  const [line, column] = start;
  const lineText = source.split("\n")[line - 1] as string;
  return lineText.slice(column - 1, column - 1 + length);
}

/**
 * Node kinds whose own span start is **not** a name-in-that-position, so the word found there must
 * not be judged as a built-in spelling. This is emphatically **not** a list of built-in names — it
 * is two statements about the grammar, each with its own reason, and neither drifts when a
 * primitive or keyword is added:
 *
 * - `WordLit` — a bare word literal is **data**. The dictionary-literal and selector productions
 *   let a key be written bare (`{ print: 1 }`, `:d[print]`), and `spec/grammar.md:386` makes that
 *   explicit: a keyword is free in every binding position, a dictionary key included. A learner
 *   writing `{ PRINT: 1 }` has named a key, not miscased the `print` primitive, so reporting it as
 *   a built-in would be a false positive — and an inconsistent one, since `{ Alpha: 1 }` is rightly
 *   left alone. Quoted word literals never reach this anyway: their span starts at the `"`, which
 *   begins no word.
 * - `Local` — a deliberate, still-open exemption, NOT a casualty of the derivation. Its node span
 *   starts at the `local` token for bare `local name` but at the *opening paren* for
 *   `(local name …)` (`parseParenLocal`'s `spanToHere(open.source_span.start)`), and the AST does
 *   not record which surface form was written — so judging one form and silently not the other
 *   would be an inconsistency a learner cannot predict. Issue #854 states in as many words that
 *   `LOCAL` being silent is not part of that bug; widening it belongs to the #115 follow-up, where
 *   the surface-form question is decided once. (Reading a whole word rather than a fixed-length
 *   slice does remove the *false read* the old exclusion also guarded against — `(loca` reported
 *   verbatim as a keyword — so this entry now carries only the consistency reason.)
 *
 * `BooleanLit` is deliberately absent: `true`/`false` are keywords, so `print TRUE` is a
 * keyword-casing slip exactly as `REPEAT` is, not data.
 *
 * {@link nameCaseRule} applies this against the *position* a node starts at rather than against the
 * node itself, because a `Program`/`Block` parent shares its first statement's span start and would
 * otherwise report the exact word the exemption exists to protect.
 */
const NON_KEYWORD_SPAN_START_KINDS: ReadonlySet<NodeKind> = new Set<NodeKind>([
  "WordLit",
  "Local",
]);

/**
 * The `ol-style-name-case` finding for the built-in name `node`'s own span *opens with*, when that
 * word is written with non-lowercase casing (`REPEAT 4 [ … ]`, `MAKE "x" 1`, `TO f`, `OUTPUT 5`,
 * `WHEN :ready [ … ]`, `VALUE of :d for key "a"`) — otherwise `undefined`.
 *
 * No `ast.ts` node kind records its own keyword's literal source *casing*: the fields that exist
 * (`ReturnNode.keyword`, `ProcedureDefNode.keyword`, `ComprehensionNode.form`) store the
 * already-lowercased spelling the parser normalizes to — *which* spelling was written, never *how*
 * it was cased. So the learner's casing can only come from the original source text, which is why
 * {@link nameCaseRule} skips this check entirely when no `source` was supplied.
 *
 * What changed in issue #854 is *which question the slice asks*. It used to ask "does this node
 * kind have a canonical keyword, and does a fixed-length slice at its span start differ from it?",
 * which needed a hand-written table of node kinds — a table that never listed `Assign` or
 * `ValueOfKey`, leaving `MAKE` and the worded reader permanently silent. It now asks "is the word
 * this node opens with a built-in name ({@link isBuiltInName}), and did the learner write it in
 * some other case?" — a question the registries answer for *every* keyword-headed node kind at
 * once, including the `Add`/`Remove`/`Insert`/`Clear`/`StructDef` heads no table ever reached, and
 * one that a future node kind gets for free. {@link NON_KEYWORD_SPAN_START_KINDS} carves out the
 * two positions where the span-start word is not a name being *used*.
 *
 * Judging **casing only** is unchanged: choosing a Heritage spelling over its Core twin is a
 * profile choice, not a style violation, and no `ol-style-*` code in the registry expresses that
 * opinion — so `to`/`output`/`op`/`make` written lowercase are clean here exactly as
 * `define`/`return`/`set` are, while `TO`/`OUTPUT`/`OP`/`MAKE` are flagged exactly as
 * `DEFINE`/`RETURN`/`SET` are.
 */
function keywordCasingDiagnostic(
  node: AnyNode,
  lines: readonly string[],
): Diagnostic | undefined {
  const { start, document } = node.source_span;
  const word = leadingWordAt(lines, start);
  if (
    word === undefined ||
    word === word.toLowerCase() ||
    !isBuiltInName(word)
  ) {
    return undefined;
  }
  return {
    code: "ol-style-name-case",
    source_span: makeSpan(document, start, [start[0], start[1] + word.length]),
    params: { name: word },
    message: `${word} should be lowercase, like a learner would read it aloud.`,
    stage: "semantic",
    severity: "warning",
  };
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
      // `spec/style-guide.md` "Keywords are lowercase" also covers *primitive* casing — its own
      // linter-check note reads "warns when canonical keywords or primitive names are written with
      // other casing", and names `ol-style-name-case`, not `ol-style-full-name`, which is about
      // alias-vs-full-name choice, never case. Only check when the callee is a *built-in* name
      // ({@link isBuiltInName}) — a user procedure call is left alone by construction, since an
      // ordinary user name is in no registry. Telling a *mistyped* user name from a deliberately
      // different one needs the same registries `ol-unknown-command` consults, and stays deferred
      // to the #115 follow-up.
      //
      // The word-spelled operators (`mod`/`and`/`or`/`not`) are built-in names and so are in the
      // set, but can never produce a finding *on this path*: the parser matches them
      // case-insensitively and always *normalizes* the callee's stored spelling to canonical
      // lowercase (`parser.ts`'s `parseMultiplicative`/`parseAnd`/`parseOr`/`parseUnary`), so a
      // source `MOD`/`AND` never survives into the AST for this rule to see — unlike a `Call`
      // built by `parseFixedCall`, which keeps the literal token spelling
      // (`sname(token.text, token)`). Excluding them would be a hand-kept exception guarding
      // nothing, which is exactly what issue #854 removed.
      //
      // Read that narrowly: it is a statement about the CALLEE path, not about the operators. A
      // *prefix* operator's node span starts at the operator word itself, so `print NOT true` is
      // still caught by {@link keywordCasingDiagnostic}, while an *infix* operator's span starts
      // at its left operand, so `5 MOD 2` is not. That asymmetry follows from spans rather than
      // from any judgement about the operators, and it is pinned by a test.
      if (isBuiltInName(node.callee.name)) {
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
 * A span's start, as the key {@link nameCaseRule} de-duplicates and exempts on. Two
 * `ol-style-name-case` findings that start at the same position are always about the same run of
 * source characters, so at most one of them may be reported.
 *
 * The document is part of the key even though one `ProgramNode` is one document today: keying on
 * `line:column` alone would silently start dropping findings the moment a program spanned more
 * than one, and a de-duplicator that fails by *discarding* is the wrong failure direction.
 *
 * **No test guards the document component, and that is stated here rather than assumed.** A
 * multi-document `ProgramNode` is not constructible through this package's public API — `parse()`
 * takes one document — so there is no way to write a failing case for it today, and a mutation
 * that drops `span.document` from this key goes green. It is defence for a shape the AST does not
 * yet have; a slice that introduces multi-document programs owns writing the test that makes it
 * fail closed.
 */
function positionKey(span: Diagnostic["source_span"]): string {
  const [line, column] = span.start;
  return `${span.document}:${line}:${column}`;
}

/**
 * `ol-style-name-case` (issue #115, widened by issue #854): every user identifier occurrence —
 * variable reads, place bases/fields, procedure names, parameters, `local` names, and
 * loop/comprehension binders — that is not lowercase snake_case (`^[a-z][a-z0-9_]*[?!]?$`), plus
 * every **built-in name** ({@link isBuiltInName}) written with some other casing, whether it
 * reaches this rule as a `Call`/`ParenCall` callee or (when `source` is supplied) as the word a
 * statement's own span opens with — see {@link keywordCasingDiagnostic} for why the second case
 * needs the source text, and {@link NON_KEYWORD_SPAN_START_KINDS} for the two positions it skips.
 *
 * `spec/tooling.md:241` states the rule in two halves, and this is the second one: "User
 * identifiers should be lowercase snake_case with optional `?` or `!`; **built-ins should be shown
 * lowercase**." Issue #854 is what made that half true of built-ins generally rather than of one
 * hand-written sample of them: `PRINT` warned while `FORWARD` — the first command a learner ever
 * types — `FD`, `MAKE`, `HOME`, `PLAY`, and the worded `VALUE of … for key` reader did not.
 *
 * Coverage is a node's **own span start**, not every keyword inside it, so some sub-cases remain
 * open for the #115 follow-up and this rule does not claim them: a *trailing* or *interior*
 * keyword has no span of its own in the AST to slice `source` against. `ELSE` (no `else` span on
 * `IfNode`), a closing `end repeat`/`end if` (`BlockNode` records only body statements), and the
 * worded reader's `OF`/`FOR`/`KEY` (only the head `value` is spanned) are therefore still silent.
 *
 * **`_profiles` stays unused on purpose, and that is the fix, not a leftover.** A built-in name's
 * *identity* is profile-independent: `spec/grammar.md:408` rules that profile words are built-in
 * names unconditionally, because "a program cannot declare which profiles it requires … so a name
 * that could be declared in one implementation but not in another would be invisible and
 * unpredictable to a learner", and "what a profile decides is whether a name *works*, never
 * whether a program may declare it". Casing is a question about the name, not about whether it
 * runs — so `FORWARD 100` earns the same nudge under any profile set, and a Core-only caller does
 * not quietly lose the coverage it has today. Whether `forward` is *available* is
 * `ol-unknown-command`'s (profile-gated) job, and it is unaffected by this warning.
 *
 * Findings are de-duplicated by start position, keeping the identifier finding when both halves
 * land on the same word. Two nodes legitimately share a span start — a `Program`/`Block` starts at
 * its first statement, and a bare `Call` starts at its own callee — so without this a single
 * `PRINT "hi"` would report twice.
 */
export function nameCaseRule(
  program: ProgramNode,
  _profiles: readonly CheckProfile[],
  source?: string,
): readonly Diagnostic[] {
  // Split once per rule run, not once per node: every node is a keyword-casing candidate now.
  const lines = source === undefined ? undefined : source.split("\n");
  const byPosition = new Map<
    string,
    { readonly diagnostic: Diagnostic; readonly fromKeyword: boolean }
  >();
  const exemptPositions = new Set<string>();
  walk(program, (node) => {
    const nodeKey = positionKey(node.source_span);
    if (NON_KEYWORD_SPAN_START_KINDS.has(node.kind)) {
      exemptPositions.add(nodeKey);
    }
    if (lines !== undefined) {
      const keywordFinding = keywordCasingDiagnostic(node, lines);
      if (keywordFinding !== undefined && !byPosition.has(nodeKey)) {
        byPosition.set(nodeKey, {
          diagnostic: keywordFinding,
          fromKeyword: true,
        });
      }
    }
    const identifierFindings: Diagnostic[] = [];
    checkNamesIn(node, identifierFindings);
    for (const finding of identifierFindings) {
      // Overwrites a keyword finding at the same position while keeping its report order (a `Map`
      // re-`set` does not move an existing key), so a callee keeps its identifier wording.
      byPosition.set(positionKey(finding.source_span), {
        diagnostic: finding,
        fromKeyword: false,
      });
    }
  });
  const diagnostics: Diagnostic[] = [];
  for (const [key, entry] of byPosition) {
    // An exempt position drops only its KEYWORD finding: an identifier finding there is a separate
    // judgement (`local badName`'s own name) the exemption never covered.
    if (entry.fromKeyword && exemptPositions.has(key)) {
      continue;
    }
    diagnostics.push(entry.diagnostic);
  }
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
 * (`spec/tooling.md:244` says blocks should be indented "consistently", not to a specific width,
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
 * switch — that spans more than one physical line (`spec/tooling.md:245`). A comprehension body
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
 * The handler block-head keywords the Interaction & Events profile defines
 * (`spec/interaction-events.md`'s "Profile grammar"), lowercased for comparison — OpenLogo
 * identifiers are case-insensitive. Split into the two roles {@link nestedHandlerRule} needs.
 *
 * `REPEATING_HANDLER_HEADS` is the **outer** set: handlers that fire again and again **on the tick
 * clock**, so a registration inside one runs once per firing with nothing but elapsed time driving
 * it. Only `every` qualifies. The other three all repeat — `when` is persistent since maintainer
 * ruling #984 (`spec/interaction-events.md:158-163`), exactly as `on_key` and `on_click` always
 * were — but each of them repeats only as often as something **outside the program** makes it
 * repeat: a key press, a click, or a host delivering a named event. That is the ruling's control
 * case, and it is why the outer set is keyed on the tick clock rather than on repetition alone.
 * Treating `when` as an outer would flag `when "start" [ every 10 [ shoot ] ]`, which registers
 * exactly one handler — `"start"` occurs once per run (`spec/interaction-events.md:152-156`) — and
 * is the ordinary way a learner opens a game.
 *
 * `HANDLER_HEADS` is the **inner** set: every registration form, not merely the repeating ones,
 * because what accumulates does not depend on whether the registered handler itself repeats.
 * Measured: `every 2 [ on_key "x" [ print 1 ] ]` over 12 ticks answers a SINGLE key press with
 * **five** firings against a baseline of one, because five `on_key` handlers had piled up by then —
 * and that count grows with runtime. `on_key` is not a repeating handler, yet the hazard is exactly
 * the one #828 exists to catch.
 */
const REPEATING_HANDLER_HEADS: ReadonlySet<string> = new Set(["every"]);

/** Every Interaction & Events registration form — the inner set (see {@link REPEATING_HANDLER_HEADS}). */
const HANDLER_HEADS: ReadonlySet<string> = new Set([
  "every",
  "when",
  "on_key",
  "on_click",
]);

/** The head keyword of `node` lowercased, or `undefined` when `node` is not a profile block-head. */
function handlerHeadName(node: AnyNode): string | undefined {
  return node.kind === "ProfileStatement"
    ? node.keyword.name.toLowerCase()
    : undefined;
}

/** Build an `ol-style-nested-handler` at the inner registration's own span. */
function nestedHandlerDiagnostic(
  node: AnyNode,
  outer: string,
  inner: string,
): Diagnostic {
  return {
    code: "ol-style-nested-handler",
    source_span: node.source_span,
    params: { outer, inner },
    message: `${outer} runs again and again, so this ${inner} can add another handler each time. register it once, outside the ${outer}.`,
    stage: "semantic",
    severity: "warning",
  };
}

/**
 * Collect the handler registrations `body` performs, **stopping at each registration rather than
 * descending through it**.
 *
 * Stopping is what keeps one finding per defect. The caller runs this for *every* `every` in the
 * program, so a chain like `every 3 [ every 5 [ every 7 [ … ] ] ]` is covered by three separate
 * visits: the outer reports `every 5`, and `every 5`'s own visit reports `every 7`. Descending
 * through a registration instead made the outer visit report `every 7` as well, so the deepest
 * link was reported twice for a single defect (the review-gate finding that produced this
 * comment).
 *
 * The same stop is independently required for `on_key`/`on_click`, and there for a semantic reason
 * rather than a bookkeeping one: in `every 3 [ on_key "x" [ every 10 [ … ] ] ]` the `on_key`
 * registration is what accumulates, one per tick, while the `every 10` inside it is guarded by a key
 * press and only misbehaves because the outer already did. Fix the outer and it disappears — and
 * because `on_key` is not itself an outer, nothing re-reports its contents later.
 *
 * Descent is otherwise unrestricted, so a registration buried in a `repeat` or an `if` inside the
 * handler body is still found.
 */
function collectNestedRegistrations(
  body: BlockNode,
  out: { node: AnyNode; head: string }[],
): void {
  const visit = (node: AnyNode): void => {
    const head = handlerHeadName(node);
    if (head !== undefined && HANDLER_HEADS.has(head)) {
      out.push({ node, head });
      return;
    }
    for (const child of childrenOf(node)) {
      visit(child);
    }
  };
  for (const statement of body.body) {
    visit(statement);
  }
}

/**
 * `ol-style-nested-handler` (issue #828): an `every` handler whose block registers another handler.
 *
 * This is the **teaching half** of the #828 ruling. Its other half — charging each handler firing
 * against the instruction budget — already makes the program *safe*, so a learner who never reads
 * this warning is still protected: the accumulation exhausts the budget and raises `ol-limit`
 * exactly as a runaway `forever` does. The lint exists so a learner finds out *why* before being
 * bitten, which is why it is a `warning` that never changes program meaning.
 *
 * Only runs when the `interaction-events` profile is active — the block-heads it looks for do not
 * exist otherwise, and a rule must consult the active profile set rather than assume every optional
 * profile is on (`spec/tooling.md`'s Layer-2/Layer-3 visibility rule).
 *
 * The finding is reported at the **inner** registration's span, not the outer handler's: that is the
 * line the learner would move out of the block, and it keeps one finding per accumulating
 * registration when a body registers several.
 *
 * ## Two limitations, both deliberate, both safe by construction
 *
 * **The check is purely lexical.** A registration reached only through a procedure call —
 * `define setup ; on_key "x" [ … ] ; end` invoked from `every 3 [ setup ]` — is NOT flagged. Making
 * it so would mean interprocedural analysis with call-cycle protection inside a *style* linter,
 * which is a large lift for an advisory warning. It is safe to omit because the two halves of the
 * #828 ruling are not redundant: the runtime charges every handler firing against the instruction
 * budget, so the interprocedural case still terminates with `ol-limit`. **Safety never depends on
 * this lint** — only the explanation does. The normative row in `spec/tooling.md` says "lexically"
 * for exactly this reason, so the limitation is specified rather than accidental.
 *
 * **No reachability analysis.** `every 3 [ if false [ on_key "x" [ … ] ] ]` is flagged even though
 * the registration can never run. That matches the rest of this family — `ol-style-useless-value`
 * flags `if false [ repeat 4 [ :side * 2 ] ]` the same way — and declining to constant-fold keeps a
 * style linter from growing an evaluator. The message says the registration **can** add a handler
 * each time rather than that it does, which is accurate for a conditional registration whether or
 * not the condition is decidable.
 */
export function nestedHandlerRule(
  program: ProgramNode,
  profiles: readonly CheckProfile[],
): readonly Diagnostic[] {
  if (!profiles.includes("interaction-events")) {
    return [];
  }
  const diagnostics: Diagnostic[] = [];
  walk(program, (node) => {
    const head = handlerHeadName(node);
    if (
      head === undefined ||
      !REPEATING_HANDLER_HEADS.has(head) ||
      node.kind !== "ProfileStatement" ||
      node.body === undefined
    ) {
      return;
    }
    const registrations: { node: AnyNode; head: string }[] = [];
    collectNestedRegistrations(node.body, registrations);
    for (const registration of registrations) {
      diagnostics.push(
        nestedHandlerDiagnostic(registration.node, head, registration.head),
      );
    }
  });
  return diagnostics;
}

// ---------------------------------------------------------------------------
// ol-style-ambiguous-continuation (issue #1074)
// ---------------------------------------------------------------------------

/**
 * Operator-name map for the infix operators that can appear at the start of a
 * continuation line (`spec/grammar.md:34`, items 2–3).
 */
const INFIX_OPERATOR_NAMES: ReadonlyMap<string, string> = new Map([
  ["-", "subtraction"],
  ["+", "addition"],
  ["*", "multiplication"],
  ["/", "division"],
  ["mod", "remainder"],
]);

/**
 * Statement kinds whose tail is a body or keyword, not an expression — so a
 * following `-<digit>` literal cannot be reinterpreted as `- <digit>` continuation.
 * Used by {@link ambiguousContinuationRule} (Case B) to suppress false positives.
 *
 * Data commands (`Add`, `Remove`, etc.) and `ProfileStatement` are deliberately
 * excluded: they accept infix continuation on the next line.
 */
const NON_CONTINUING_KINDS: ReadonlySet<NodeKind> = new Set([
  "If",
  "While",
  "Repeat",
  "Forever",
  "ForIn",
  "ForRange",
  "ProcedureDef",
  "Block",
  "StructDef",
  "Stop",
  "Local",
]);

/**
 * Statement kinds that contain a block body. Their continuation lines
 * are split into header lines (before the first block body) and body lines
 * (inside the block). Only header lines are checked in Case A — the block's
 * own body is walked separately by the main `walk()` visitor.
 */
const BODY_CONTAINING_KINDS: ReadonlySet<NodeKind> = new Set([
  "If",
  "While",
  "Repeat",
  "Forever",
  "ForIn",
  "ForRange",
  "ProcedureDef",
  "Block",
  "StructDef",
  "ProfileStatement",
]);

/**
 * Return the start line of the earliest `Block` child in a statement node,
 * or `undefined` when none is found. Used by Case A to separate header
 * continuation lines (which need checking) from body lines (checked by `walk`).
 */
function firstBlockChildLine(node: StatementNode): number | undefined {
  let earliest: number | undefined;
  // Iterate own enumerable properties looking for Block children.
  for (const value of Object.values(node)) {
    if (
      typeof value === "object" &&
      value !== null &&
      "kind" in value &&
      (value as { kind: string }).kind === "Block"
    ) {
      const line = (value as { source_span: SourceSpan }).source_span.start[0];
      if (earliest === undefined || line < earliest) earliest = line;
    }
  }
  return earliest;
}

/**
 * Detect a leading infix operator at the start of `trimmedLine` (leading whitespace
 * already stripped). Returns the operator string if found, `undefined` otherwise.
 *
 * For `-`, only matches when followed by a space or tab (or end-of-line) — a `-`
 * immediately before a digit is a negative literal (Case B), not an infix operator.
 * For `/`, rejects `//` and `/*` (comment starts).
 * For `mod`, requires a word boundary (space or tab) so that `modify` is not matched.
 */
function leadingInfixOperator(trimmedLine: string): string | undefined {
  const ch = trimmedLine[0];
  if (ch === undefined) return undefined;

  if (ch === "+" || ch === "*") return ch;
  if (ch === "-") {
    const next = trimmedLine[1];
    // `-5` is a negative numeric literal (Case B), not infix minus.
    // `-.5` is invalid in OpenLogo (no leading-dot literals), so only
    // digits distinguish the literal case.
    if (next !== undefined && next >= "0" && next <= "9") {
      return undefined;
    }
    return "-";
  }
  if (ch === "/") {
    const next = trimmedLine[1];
    if (next !== "/" && next !== "*") return "/";
    return undefined;
  }
  if (
    trimmedLine.length >= 3 &&
    trimmedLine.slice(0, 3).toLowerCase() === "mod" &&
    (trimmedLine.length === 3 ||
      !/^[\p{XID_Continue}?!]/u.test(trimmedLine.slice(3)))
  ) {
    return "mod";
  }

  return undefined;
}

/**
 * Regex to extract a negative numeric literal at the very start of a string
 * (e.g. `"-5"`, `"-3.14"`). Callers first verify the line starts with
 * `-<digit>`, so the regex always matches when invoked.
 */
const NEGATIVE_LITERAL_RE = /^(-(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?)/;

/**
 * Compute the parenthesis/brace grouping depth at the **start** of each 1-based
 * source line. `result[0]` is the depth at the start of line 1. Lines inside an
 * unclosed `(` or `{` have `depth > 0`; those lines are explicitly grouped and
 * their leading operator is not ambiguous. Lines inside a multi-line token
 * (triple-quoted string or block comment) use a sentinel depth of `Infinity`.
 *
 * `[`/`]` are deliberately excluded because they are ambiguous between blocks and
 * list literals. Delimiters inside single-line strings or comments produce a (rare) false
 * negative — acceptable for an opt-in style lint.
 */
function groupingDepthPerLine(lines: readonly string[]): readonly number[] {
  const depths: number[] = [0];
  let depth = 0;
  let inTripleQuote = false;
  let inBlockComment = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    // Lines whose content is inside a multi-line token are data/commentary.
    if (inTripleQuote || inBlockComment) {
      depths[i] = Infinity;
    }

    let j = 0;
    while (j < line.length) {
      if (inTripleQuote) {
        if (line[j] === "\\") {
          j += 2; // skip escaped character
          continue;
        }
        if (line[j] === '"' && line[j + 1] === '"' && line[j + 2] === '"') {
          inTripleQuote = false;
          j += 3;
        } else {
          j++;
        }
        continue;
      }

      if (inBlockComment) {
        const star = line[j] === "*";
        const slash = line[j + 1] === "/";
        if (star && slash) {
          inBlockComment = false;
          j += 2;
        } else {
          j++;
        }
        continue;
      }

      const ch = line[j]!;

      if (ch === '"' && line[j + 1] === '"' && line[j + 2] === '"') {
        inTripleQuote = true;
        j += 3;
        continue;
      }

      // Single-line string: skip to closing quote
      if (ch === '"') {
        j++;
        while (j < line.length && line[j] !== '"') {
          if (line[j] === "\\") j++;
          j++;
        }
        j++;
        continue;
      }

      if (ch === "/" && line[j + 1] === "*") {
        inBlockComment = true;
        j += 2;
        continue;
      }

      // Line comment: rest of line is commentary
      if (ch === "#" || (ch === "/" && line[j + 1] === "/")) {
        break;
      }

      if (ch === "(" || ch === "{") depth++;
      else if (ch === ")" || ch === "}") depth = Math.max(0, depth - 1);

      j++;
    }

    depths.push(depth);
  }

  return depths;
}

/** Build an `ol-style-ambiguous-continuation` diagnostic. */
function ambiguousContinuationDiagnostic(
  document: string,
  lineNum: number,
  col: number,
  tokenLength: number,
  token: string,
  reading: "continuation" | "new-statement",
  message: string,
): Diagnostic {
  return {
    code: "ol-style-ambiguous-continuation",
    source_span: makeSpan(
      document,
      [lineNum, col],
      [lineNum, col + tokenLength],
    ),
    params: { token, reading },
    message,
    stage: "semantic",
    severity: "warning",
  };
}

/**
 * Strip trailing comments (`#`, `//`, and `/* … *​/`) and whitespace from a
 * line, respecting string literals. Returns the code-only prefix, trimmed.
 */
function stripTrailingComment(line: string): string {
  let inString = false;
  for (let i = 0; i < line.length; i++) {
    if (inString) {
      if (line[i] === "\\") {
        i++;
        continue;
      }
      if (line[i] === '"') inString = false;
      continue;
    }
    if (line[i] === '"') {
      inString = true;
      continue;
    }
    if (line[i] === "#") return line.slice(0, i).trimEnd();
    if (line[i] === "/" && line[i + 1] === "/")
      return line.slice(0, i).trimEnd();
    // Skip `/* … */` block comments (single-line only in this helper).
    if (line[i] === "/" && line[i + 1] === "*") {
      const close = line.indexOf("*/", i + 2);
      if (close !== -1) {
        // Replace the comment span with a single space so surrounding
        // tokens don't accidentally merge when we trimEnd() later.
        line = line.slice(0, i) + " " + line.slice(close + 2);
        // Re-examine the same index (now points past the space).
        i--;
        continue;
      }
      // Unclosed `/*` — opening line of a multi-line block comment.
      // Everything from `/*` onward is comment text.
      return line.slice(0, i).trimEnd();
    }
  }
  return line.trimEnd();
}

/**
 * `ol-style-ambiguous-continuation` (issue #1074): flags lines whose reading
 * depends on whitespace under the continuation rules (`spec/grammar.md:34`).
 *
 * **Case A — infix operator on a continuation line.** A statement spans multiple
 * physical lines, and a non-first line begins (after optional indentation) with an
 * infix operator token (`+`, `-`, `*`, `/`, `mod`). The parser read it as
 * continuation; the learner may have expected a new statement. Lines inside an
 * explicit grouping (`(…)` or `{…}`) are skipped, since the delimiters already
 * disambiguate.
 *
 * **Case B — negative literal starting a new statement.** A statement begins with
 * a negative numeric literal (e.g. `-5`), and the previous statement in the same
 * body ends on an earlier line **and** could syntactically have accepted `- 5` as
 * an infix continuation. The parser read it as a new statement; the learner may
 * have meant subtraction.
 *
 * The message names both readings and states which one was chosen, as required by
 * issue #1074.
 */
export function ambiguousContinuationRule(
  program: ProgramNode,
  _profiles: readonly CheckProfile[],
  source?: string,
): readonly Diagnostic[] {
  if (source === undefined) return [];
  const lines = source.split("\n");
  const depths = groupingDepthPerLine(lines);
  const diagnostics: Diagnostic[] = [];
  const document = program.source_span.document;
  /** Lines already flagged — prevents duplicates when an outer statement and
   *  an inner Block both span the same continuation line. */
  const flaggedLines = new Set<number>();

  function checkBody(body: readonly StatementNode[]): void {
    let prev: StatementNode | undefined;
    for (const statement of body) {
      const startLine = statement.source_span.start[0];
      const endLine = statement.source_span.end[0];

      // Case A: multi-line statement — check each continuation line.
      // For body-containing statements, only check the header lines (before
      // the first Block child) to avoid double-counting with the Block's own
      // body, which is walked separately.
      if (startLine < endLine) {
        let lastLineToCheck = endLine;
        if (BODY_CONTAINING_KINDS.has(statement.kind)) {
          const blockLine = firstBlockChildLine(statement);
          if (blockLine !== undefined) {
            // Check lines up to and including the block's start line —
            // the leading-token check inspects only the start of the line,
            // which is the header expression, not the block body.
            lastLineToCheck = blockLine;
          }
        }
        for (
          let lineNum = startLine + 1;
          lineNum <= lastLineToCheck;
          lineNum++
        ) {
          if (depths[lineNum - 1]! > 0) continue; // inside grouping or multi-line token
          if (flaggedLines.has(lineNum)) continue; // already reported
          const lineText = lines[lineNum - 1]!;
          const trimmed = lineText.trimStart();
          const operator = leadingInfixOperator(trimmed);
          if (operator !== undefined) {
            // For `-`, suppress when the operand is not a digit: both
            // `- :x` and `-:x` parse identically as subtraction, so there
            // is no genuine ambiguity.  Only `- <digit>` vs `-<digit>`
            // changes the parse (subtraction vs negative literal).
            if (operator === "-") {
              const afterOp = trimmed.slice(1).trimStart();
              const firstAfter = afterOp[0];
              if (
                firstAfter === undefined ||
                firstAfter < "0" ||
                firstAfter > "9"
              ) {
                // No ambiguity — fall through to the negative-literal
                // sub-case check (which will also reject non-digits).
              } else {
                const indent = lineText.length - trimmed.length;
                const col = indent + 1;
                const name = INFIX_OPERATOR_NAMES.get(operator)!;
                const message = `This line starts with \`-\` (${name}), which continues the previous line. \`-\` before a number without a space would start a new statement as a negative literal.`;
                diagnostics.push(
                  ambiguousContinuationDiagnostic(
                    document,
                    lineNum,
                    col,
                    operator.length,
                    operator,
                    "continuation",
                    message,
                  ),
                );
                flaggedLines.add(lineNum);
              }
            } else {
              const indent = lineText.length - trimmed.length;
              const col = indent + 1;
              const name = INFIX_OPERATOR_NAMES.get(operator)!;
              const message = `This line starts with \`${operator}\` (${name}), which continues the previous line. Without this operator, the line would start a new statement.`;

              diagnostics.push(
                ambiguousContinuationDiagnostic(
                  document,
                  lineNum,
                  col,
                  operator.length,
                  operator,
                  "continuation",
                  message,
                ),
              );
              flaggedLines.add(lineNum);
            }
          } else if (trimmed[0] === "-") {
            // Sub-case: negative literal inside a multi-line statement (e.g. in
            // a list literal). Adding a space would make it subtraction. Skip
            // when a preceding line (scanning backwards past blanks/comments)
            // ends with an infix operator, since that already locked continuation.
            let trailingOp = false;
            for (let prev = lineNum - 1; prev >= startLine; prev--) {
              // Skip lines inside multi-line tokens (triple-quoted strings,
              // block comments) — their content is data, not code.
              if (depths[prev - 1]! === Infinity) continue;
              const stripped = stripTrailingComment(lines[prev - 1]!);
              if (stripped.length === 0) continue; // blank or comment-only
              trailingOp =
                stripped.endsWith("+") ||
                stripped.endsWith("-") ||
                stripped.endsWith("*") ||
                stripped.endsWith("/") ||
                stripped.endsWith("=") ||
                stripped.endsWith("<") ||
                stripped.endsWith(">") ||
                /\b(?:mod|and|or|not)$/i.test(stripped);
              break;
            }
            if (!trailingOp) {
              // Also suppress when this is the first element after `[` — there
              // is no left operand for subtraction, so the alternative reading
              // (adding a space) would produce `ol-bad-token`, not a valid
              // different program.
              let firstElement = false;
              for (let prev = lineNum - 1; prev >= startLine; prev--) {
                if (depths[prev - 1]! === Infinity) continue;
                const stripped = stripTrailingComment(lines[prev - 1]!);
                if (stripped.length === 0) continue;
                firstElement = stripped.endsWith("[");
                break;
              }
              if (firstElement) {
                // no-op: `-5` is the first list element, no ambiguity
              } else {
                const ch1 = trimmed[1];
                if (ch1 !== undefined && ch1 >= "0" && ch1 <= "9") {
                  const literal = NEGATIVE_LITERAL_RE.exec(trimmed)?.[1];
                  if (literal !== undefined) {
                    const indent = lineText.length - trimmed.length;
                    const col = indent + 1;
                    const message =
                      "This line starts with `" +
                      literal +
                      "` (a negative number). Adding a space after `-` would make it subtraction, continuing the previous line.";
                    diagnostics.push(
                      ambiguousContinuationDiagnostic(
                        document,
                        lineNum,
                        col,
                        literal.length,
                        literal,
                        "new-statement",
                        message,
                      ),
                    );
                    flaggedLines.add(lineNum);
                  }
                }
              }
            }
          }
        }
      }

      // Case B: negative literal at start of new statement.
      if (prev !== undefined) {
        const prevNonCont =
          NON_CONTINUING_KINDS.has(prev.kind) ||
          // ProfileStatements with a body (`ask`, `listen`) are block-bearing
          // and do not accept continuation, but bodyless ones (`tell`) do.
          (prev.kind === "ProfileStatement" &&
            "body" in prev &&
            prev.body !== undefined);
        if (
          !prevNonCont &&
          prev.source_span.end[0] < startLine &&
          depths[startLine - 1]! <= 0
        ) {
          const lineText = lines[startLine - 1]!;
          const trimmed = lineText.trimStart();
          // A new statement starting with `-<digit>` is a negative
          // literal; `-<letter>` is structurally impossible here (the parser treats
          // it as infix continuation, never a separate statement), and `-.5` is
          // invalid in OpenLogo (no leading-dot literals).
          if (trimmed[0] === "-") {
            const ch1 = trimmed[1];
            if (ch1 !== undefined && ch1 >= "0" && ch1 <= "9") {
              const literal = NEGATIVE_LITERAL_RE.exec(trimmed)?.[1];
              if (literal !== undefined) {
                const indent = lineText.length - trimmed.length;
                const col = indent + 1;
                const digitPart = literal.slice(1);

                diagnostics.push(
                  ambiguousContinuationDiagnostic(
                    document,
                    startLine,
                    col,
                    literal.length,
                    literal,
                    "new-statement",
                    `This line starts with \`${literal}\`, a negative number starting a new statement. With a space, \`- ${digitPart}\` would be subtraction continuing the previous line.`,
                  ),
                );
              }
            }
          }
        }
      }
      prev = statement;
    }
  }

  walk(program, (node) => {
    if (node.kind === "Program" || node.kind === "Block") {
      checkBody(node.body);
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
  nestedHandlerRule,
  ambiguousContinuationRule,
];
