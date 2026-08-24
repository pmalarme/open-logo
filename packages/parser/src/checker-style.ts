/**
 * The Layer-3 style-lint rules (issue #115, slices 1, 2a, and 2b of the 13-code `ol-style-*`
 * family `spec/tooling.md:238-252` registers, sourced from `spec/style-guide.md`). Every finding
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

import type { Diagnostic, Position } from "@openlogo/core";
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
import { producesValue } from "./checker-control-flow.js";
import { OL_PROFILE_KEYWORDS, isKeyword } from "./keywords.js";
import { heritageSurfaceSpellings, primitiveArity } from "./signatures.js";

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
 * Every conformance profile that contributes keywords, read straight off
 * {@link OL_PROFILE_KEYWORDS}'s own keys rather than named here, so a profile that registers
 * keywords later is consulted without editing this module (issue #854).
 */
const KEYWORD_CONTRIBUTING_PROFILES: readonly string[] =
  Object.keys(OL_PROFILE_KEYWORDS);

/** {@link heritageSurfaceSpellings} as a lookup set, built once (issue #854). */
const HERITAGE_SURFACE_SPELLINGS: ReadonlySet<string> = new Set(
  heritageSurfaceSpellings(),
);

/**
 * Is `name` a **built-in name** — the union `spec/grammar.md:414` defines as "exactly the keywords
 * listed above plus every primitive … so there is no second list to keep in step"? Matching
 * lowercases first, because OpenLogo identifiers are case-insensitive with lowercase canonical,
 * which is the whole premise of a *casing* lint.
 *
 * This is deliberately **three registry consultations, not a list** (issue #854, epic #900's
 * through-line: *no component enumerates built-in names by hand*). Before this, the rule matched
 * callees against a literal `CORE_CALLEE_NAMES` set, so `PRINT` was linted and
 * `FORWARD`, `HOME`, `PLAY`, `NEW_TURTLE` — every
 * non-Core primitive a learner actually types first — were silent, and keyword casing was gated on
 * a hand-written table of *node kinds* that never listed `Assign` or `ValueOfKey`, so `MAKE "x" 1`
 * and `VALUE of :d for key "a"` were silent too. Each of the three sources here is the same one its
 * owning subsystem already fails closed on:
 *
 * - {@link isKeyword} over {@link OL_KEYWORDS} plus every {@link OL_PROFILE_KEYWORDS} profile —
 *   the one registry the highlighter and the checker share (`parser.instructions.md` forbids
 *   forking it). The profile list is derived from the registry's own keys, so a profile that
 *   registers keywords later is picked up here with no edit.
 * - {@link primitiveArity} — the reader's single primitive lookup, which iterates
 *   `signatures.ts`'s `PROFILE_PRIMITIVE_ARITY_TABLES`. A new profile slice adds its arity table
 *   *there* (`signatures.ts` says so in as many words), and this rule absorbs it automatically —
 *   the same structural fix #885 applied to `NON_PRIMARY_NAMES`, whose first live test was #837's
 *   `mod`.
 * - {@link heritageSurfaceSpellings} — the enumerable definition of "a Heritage surface spelling"
 *   (short aliases + form heads + worded-form heads, issue #852). Heritage aliases carry no arity
 *   of their own, so {@link primitiveArity} cannot see them; this is the registry that does.
 *
 * The bound of this derivation is exactly "what the parser knows", and **that bound has already
 * been tested in flight**. When this rule was first written, the Tutor profile's `challenge`
 * (`spec/conformance.md`) was the one built-in name with no registry at all, so `CHALLENGE`
 * reported only `ol-unknown-command` and earned no casing warning. Issue #838 then registered
 * `TUTOR_PRIMITIVE_ARITY` in `signatures.ts`'s `PROFILE_PRIMITIVE_ARITY_TABLES` — and this rule
 * began covering `challenge` **with no edit here at all**, exactly as a derived set should. That is
 * the same absorption #885's `NON_PRIMARY_NAMES` demonstrated when #837 added `mod`, and it is the
 * property a hand-written list cannot have: the fix for the *next* profile is already written.
 *
 * A name no registry carries is still not silently *skipped* here — it is unknown to every parser
 * component alike, and `ol-unknown-command` says so.
 *
 * **This rule deliberately does not consume `built-in-names.ts`.** The third source above is
 * {@link heritageSurfaceSpellings}, which carries Heritage **form heads** as well as short aliases,
 * while `built-in-names.ts` reaches Heritage only through alias resolution. They agree — a fact
 * about the registry, not a property either module guarantees. Narrowing the three sources to one
 * is epic #900's endpoint and belongs with the corpus sweep in issue #842, not to a slice whose
 * subject is the declaration rule.
 *
 * Membership is **profile-independent on purpose** — see {@link nameCaseRule} for why. It is also
 * independent of what the program *declares*: `spec/grammar.md:363` is "a program may not declare
 * a built-in name", so `define print … end` is an `ol-reserved-word` error rather than a shadowing
 * that could make `PRINT`'s casing stop mattering. A call to a name that is in no registry — an
 * ordinary user procedure — is left alone by construction, with no exemption needed.
 */
function isBuiltInName(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    isKeyword(lower, KEYWORD_CONTRIBUTING_PROFILES) ||
    primitiveArity(lower) !== undefined ||
    HERITAGE_SURFACE_SPELLINGS.has(lower)
  );
}

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
 * `REPEATING_HANDLER_HEADS` is the **outer** set: handlers that fire again and again on the tick
 * clock, so a registration inside one runs once per firing. Only `every` qualifies, and that is a
 * measured fact rather than a reading of the ruling's wording. `when` is **one-shot** — the runtime
 * marks a fired handler and never re-delivers it (`invokeWhenHandler` sets `fired`;
 * `pendingHandlersFor` skips it) — so `when "go" [ … ]` with the event delivered four times fires
 * exactly once. Treating `when` as an outer would flag `when "start" [ every 10 [ shoot ] ]`, which
 * registers exactly one handler and is the ordinary way a learner opens a game.
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
];
