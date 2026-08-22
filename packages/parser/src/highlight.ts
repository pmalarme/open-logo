/**
 * Syntax-highlighting token classes — the normative token-class model from
 * [`spec/tooling.md`](../../../spec/tooling.md). A highlighter classifies tokens from the
 * grammar (grammatical position decides the class), not from ad-hoc regular expressions.
 * Owned by `@language-designer`; consumed by the studio editor, docs, and external editors.
 * The class set tracks the grammar version — a grammar change ships its highlighting update
 * in the same saga.
 *
 * {@link highlight} is the grammar-derived LEXICAL first pass (issue #119) plus the SEMANTIC
 * disambiguation pass (issue #120): it reuses {@link tokenize} and {@link parse} (never
 * re-lexing) to resolve every class and delimiter role decidable from tokens + grammatical
 * position alone, then layers on a local symbol-discovery pass for `procedure-name`,
 * `type-name`, and `field-name`.
 *
 * Symbol discovery is re-derived locally from the AST/token stream on every call — it does not
 * import or share state with the semantic checker (`check.ts`/`checker-*.ts`), which owns a
 * separate, authoritative symbol table for diagnostics. `define`/`to` procedure headers ARE real
 * `ProcedureDefNode`s, so procedure names/calls are resolved via {@link walk}. `struct <type>
 * [ field … ]` has no dedicated AST node yet (`ast.ts`'s comment marks it future Data-profile
 * work; the parser's error recovery drops its tokens rather than building a node for them), so
 * type/field names are resolved the same way #119 resolves the `field-list` bracket role itself:
 * a positional token scan, independent of whether the declaration parses cleanly. `.field`
 * access is classified `field-name` whenever the field's bare spelling matches ANY struct's
 * declared field (there is no static place-to-type binding to narrow it further, per
 * `spec/tooling.md`'s "MAY defer … precision" allowance) — this is a deliberate, best-effort
 * heuristic, not full type inference. A bare name that resolves to neither a known procedure nor
 * a known type stays `primitive` (or `keyword`/`operator` when reserved), matching #119's
 * fallback and the spec's graceful-degradation requirement: unresolved symbols, mid-edit input,
 * and malformed/unclosed constructs never throw and never misclassify a class name/field as a
 * command or keyword.
 */

import { makeSpan } from "@openlogo/core";
import type { Position, SourceSpan } from "@openlogo/core";
import type {
  AnyNode,
  Binder,
  DictEntryNode,
  IsPredicateNode,
  NumberLitNode,
  SpannedName,
  ValueOfKeyNode,
} from "./ast.js";
import { walk } from "./ast.js";
import { parse } from "./parser.js";
import { isKeyword } from "./keywords.js";
import type { LexToken, LexTokenKind } from "./tokens.js";
import { tokenize } from "./tokens.js";

/**
 * The 15 normative token classes. Names are the spec's literal spellings (including the
 * `word/string`, `:variable`, `index/dot`, and `dict-key` forms) so highlighters and
 * semantic-token providers can share one vocabulary.
 */
export const OL_TOKEN_CLASSES = [
  "keyword",
  "primitive",
  "number",
  "word/string",
  ":variable",
  "comment",
  "bracket",
  "brace",
  "paren",
  "operator",
  "index/dot",
  "dict-key",
  "procedure-name",
  "type-name",
  "field-name",
] as const;

/** One normative token class. */
export type TokenClass = (typeof OL_TOKEN_CLASSES)[number];

/**
 * The 5 grammar-derived `[`/`]` delimiter roles from `spec/tooling.md`'s "Delimiter roles"
 * table. A selector's brackets carry role `"selector"` but class `index/dot` (not `bracket`) —
 * see {@link highlight}.
 */
export const OL_BRACKET_ROLES = [
  "list",
  "instruction-block",
  "selector",
  "pattern",
  "field-list",
] as const;

/** One grammar-derived bracket delimiter role. */
export type BracketRole = (typeof OL_BRACKET_ROLES)[number];

/** A classified token: its class, its source text, and where it came from. */
export interface Token {
  readonly class: TokenClass;
  readonly text: string;
  readonly source_span: SourceSpan;
  /** Present only on the `[`/`]` of a list/instruction-block/selector/pattern/field-list. */
  readonly role?: BracketRole;
  /**
   * Present only on the classes with a decidable declaration/reference split —
   * `procedure-name`, `type-name`, `field-name`, and `:variable` (a procedure's own `:param`,
   * a `local` name, and a `for`/comprehension binder) — `true` at the binding site, `false` at
   * every other (use/call/assignment-target) site. Consumed by `semantic-tokens.ts` (issue
   * #121) to compute the LSP `declaration`/`reference` modifiers from `spec/tooling.md:278`;
   * absent on classes with no such split (e.g. `keyword`, `number`).
   */
  readonly declaration?: boolean;
}

/**
 * Word-spelled operators (`spec/tooling.md:39`): `and`, `or`, `not`, and `mod` — always
 * `operator`, never `keyword`. Checked before the {@link isKeyword} lookup so none of the four
 * falls through to `keyword`: all four are on the keyword list (`spec/grammar.md:373`), and
 * `spec/grammar.md:378` makes that list and the `keyword` **token class** "different sets on
 * purpose", so membership here is what decides the class.
 */
const WORD_OPERATORS = new Set(["and", "or", "not", "mod"]);

/** Lexical token kinds that carry highlightable content — never `newline`/`eof`. */
type ContentTokenKind = Exclude<LexTokenKind, "newline" | "eof">;

/** A raw lexer token narrowed to a highlightable kind. */
interface ContentToken extends LexToken {
  readonly kind: ContentTokenKind;
}

function isContentToken(token: LexToken): token is ContentToken {
  return token.kind !== "newline" && token.kind !== "eof";
}

/** `"line:column"` — a stable map key for a `Position` tuple. */
function posKey(position: Position): string {
  return `${position[0]}:${position[1]}`;
}

/** Is `a` at or before `b` in source order? */
function isAtOrBefore(a: Position, b: Position): boolean {
  return a[0] < b[0] || (a[0] === b[0] && a[1] <= b[1]);
}

/**
 * Classify `source` into a flat, source-ordered `Token[]` — the grammar-derived lexical first
 * pass. Reuses {@link tokenize} for the raw token stream and {@link parse} for the AST that
 * resolves grammatical position (list/instruction-block/selector roles, dict-key selector
 * literals, negative-literal merging, contextual `is`-predicate keywords); it never re-lexes.
 * Malformed input still yields a best-effort token stream, matching {@link parse}'s own
 * never-throw contract.
 */
export function highlight(source: string, document = "<input>"): Token[] {
  const lex = tokenize(source, document).tokens;
  const program = parse(source, document).ast;

  // The synthetic `eof` token is zero-width (its start equals its end) and, whenever the source
  // has no trailing newline, that position exactly matches the preceding real token's own end —
  // colliding in `byEnd` and silently shadowing e.g. a closing `]`'s index. `eof` is never a
  // bracket/paren/selector boundary itself, so it is simply excluded from both maps.
  const byStart = new Map<string, number>();
  const byEnd = new Map<string, number>();
  lex.forEach((token, index) => {
    if (token.kind === "eof") {
      return;
    }
    byStart.set(posKey(token.source_span.start), index);
    byEnd.set(posKey(token.source_span.end), index);
  });

  // `dict-key` (`spec/tooling.md:41`) has two grammatical sources: a selector's bare-word key
  // (`:dict[key]`, handled by `markSelectorKey` below) and a dict-*literal*'s bare key before its
  // `:` (`{ key: value }`, handled by the `"DictLit"` case in `visit()`, reusing the same
  // `markSelectorKey` helper for each entry). Both share the identical bare-identifier-vs-quoted
  // -word-literal disambiguation, since a dict-literal key parses to the same `WordLitNode` shape
  // as a bare selector key.
  const roleByIndex = new Map<number, BracketRole>();
  const dictKeyIndexes = new Set<number>();
  const contextualKeywordIndexes = new Set<number>();
  const negativeMergeStarts = new Set<number>();

  // A dict-entry's `:` with no gap before its value's leading identifier (`{ a:foo }`) lexes as
  // one `variable` token — the same ambiguity `parser.ts`'s `splitGluedColonToken` resolves for
  // parsing. Highlighting never re-lexes its own copy, so it re-derives the same split here from
  // the raw `lex` array + the already-parsed AST (`markGluedDictColon` below) rather than sharing
  // parser-internal state: keyed by the raw glued token's index, the stored `Position` is where
  // the value's own AST span begins (one column past the colon), letting the final assembly loop
  // recompute the split colon/name spans and text without re-parsing.
  const dictColonSplits = new Map<number, Position>();

  // Semantic symbol discovery (#120): re-derived locally on every call, never shared with the
  // checker's own symbol table. `typeNames`/`fieldNames` (lowercased spellings) drive constructor
  // calls and `.field` access; the `*Indexes` sets record which raw token indexes carry each
  // resolved class once discovery is done.
  const typeDeclIndexes = new Set<number>();
  const fieldDeclIndexes = new Set<number>();
  const typeNames = new Set<string>();
  const fieldNames = new Set<string>();
  const procDeclIndexes = new Set<number>();
  const procCallIndexes = new Set<number>();
  const typeCallIndexes = new Set<number>();
  const fieldAccessIndexes = new Set<number>();
  // A procedure's own `:param` is the only binding site whose token is *already* `variable`-kind
  // (issue #121). `local`/`for`/comprehension binders parse as bare `name` tokens (see `ast.ts`'s
  // `ProcedureParam` vs. `ForInNode.binder`/`ComprehensionBase.binder`), so they reach
  // `classifyName` instead and are carried by `binderDeclIndexes` below.
  const paramDeclIndexes = new Set<number>();

  // Binding positions whose name is a bare `name` token (issue #840). `spec/grammar.md:363` is
  // the whole rule — "A program may not declare a built-in name. A program may bind a value to
  // any name" — and `:390` lists the positions that "admit keywords freely", which "is what
  // makes `:value = 1`, `{ value: 1 }`, `local end`, and `for end from 1 to 3` legal". A token
  // there names a variable, so it is `:variable` (`spec/tooling.md:34`), never `keyword`
  // (`:30`, "structural words recognized by the reader" — a binder is not structural) and never
  // `primitive` (`:31`, scoped to "the C3 primitive matrix" — a learner's binder is in no
  // matrix). This is decided from grammatical position, as `spec/tooling.md:18-21` requires and
  // exactly as the `dict-key` precedent at `:41` already does; a lexical "is it reserved?" test
  // cannot tell `local end` from `end`-the-block-terminator.
  //
  // The split mirrors what the two spellings of one assignment already do, so that `:count = 5`
  // and `set count to 5` highlight identically:
  //  - `binderDeclIndexes` — a `local` name, a `for`/`map`/`filter`/`reduce` binder, and the
  //    `reduce` accumulator INTRODUCE a name, so they are `declaration` sites.
  //  - `placeHeadIndexes` — the bare-form head of an assignment's place (`set count to 5`) is a
  //    write to a name, so it is a `reference`, matching the colon-form `:count = 5` head.
  // Only a bare `name` token is ever marked: `markNameIndex`'s kind guard leaves the colon-form
  // head (`:count`, a `variable` token, already `:variable`) and the heritage `make "count" 1`
  // target (a `word` token, `word/string`) exactly where they were.
  const binderDeclIndexes = new Set<number>();
  const placeHeadIndexes = new Set<number>();

  /**
   * Tag the raw token starting at `name`'s span with `target`, when it is a real token of
   * `kind` (`"name"` by default; pass `"variable"` for a colon-prefixed binder such as a
   * procedure parameter). A dict-entry's glued `:name` value (`{ a:foo }`, resolved by
   * {@link markGluedDictColon}) has no real raw token starting at its own AST span — the whole
   * `:foo` is one `variable`-kind token — so an ordinary `"name"` lookup also accepts a glued
   * split index there, letting a glued value still resolve to `procedure-name`/`type-name`/
   * `field-name` like any other bare name.
   */
  function markNameIndex(
    name: SpannedName,
    target: Set<number>,
    kind: LexTokenKind = "name",
  ): void {
    const index = byStart.get(posKey(name.source_span.start));
    if (
      index !== undefined &&
      (lex[index]?.kind === kind ||
        (kind === "name" && dictColonSplits.has(index)))
    ) {
      target.add(index);
    }
  }

  /**
   * Mark a `for`/`map`/`filter`/`reduce` binder's bare name as a `declaration` binding site.
   * A destructuring `[ :x :y ]` binder (`spec/grammar.md:136-137`) names its members with
   * `variable`-kind tokens that {@link classifyToken} already classes `:variable`, so it needs
   * no marking here — and deliberately keeps its existing `reference` modifier, since resolving
   * a destructured name's own binding site is not part of this rule.
   */
  function markBinder(binder: Binder): void {
    if (!("kind" in binder)) {
      markNameIndex(binder, binderDeclIndexes);
    }
  }

  /**
   * Tag the `[`/`]` at `span`'s start/end (when they are lexer bracket tokens) with `role`.
   * `spanBetween(open, close)` (the parser's span helper) always sets a `ListLit`/bracket-form
   * `Block`/selector span's start/end to a real open/close bracket token's own start/end, so the
   * `byStart`/`byEnd` lookup always lands on that exact token when the form is bracketed.
   */
  function markBracketPair(span: SourceSpan, role: BracketRole): void {
    // Never override a role the positional `for [` / `struct <type> [` scan already assigned
    // (it runs first, below): a `[` directly after `for`/`struct <type>` can only ever be a
    // pattern/field-list grammatically, even when today's grammar has no binder/type production
    // for it and the parser's error recovery mis-parses the bracket as an unrelated ListLit.
    const openIndex = byStart.get(posKey(span.start));
    if (
      openIndex !== undefined &&
      lex[openIndex]?.kind === "lbracket" &&
      !roleByIndex.has(openIndex)
    ) {
      roleByIndex.set(openIndex, role);
    }
    const closeIndex = byEnd.get(posKey(span.end));
    if (
      closeIndex !== undefined &&
      lex[closeIndex]?.kind === "rbracket" &&
      !roleByIndex.has(closeIndex)
    ) {
      roleByIndex.set(closeIndex, role);
    }
  }

  /** A selector's key that is a bare identifier (not a quoted `"word"`) is a `dict-key`. */
  function markSelectorKey(key: {
    readonly kind: string;
    readonly source_span: SourceSpan;
  }): void {
    if (key.kind !== "WordLit") {
      return;
    }
    const index = byStart.get(posKey(key.source_span.start));
    if (index !== undefined && lex[index]?.kind === "name") {
      dictKeyIndexes.add(index);
    }
  }

  /**
   * Record `entry` in {@link dictColonSplits} when its value has no gap after the `:` (`{ a:foo
   * }`), so the final assembly loop below can split that one glued `variable` token back into an
   * `operator` `:` plus the value's own class. An ordinary, spaced entry's value always starts at
   * a real raw token of its own, so `byStart` already resolves it — only the glued case needs
   * this. The colon character always sits exactly one column before the value on the same line
   * (`parser.ts`'s `splitGluedColonToken` only ever splits a same-line, zero-gap `variable`
   * token), so that position is where the raw glued token must start.
   */
  function markGluedDictColon(entry: DictEntryNode): void {
    const valueStart = entry.value.source_span.start;
    if (byStart.has(posKey(valueStart))) {
      return;
    }
    const colonPosition: Position = [valueStart[0], valueStart[1] - 1];
    const rawIndex = byStart.get(posKey(colonPosition));
    if (rawIndex !== undefined && lex[rawIndex]?.kind === "variable") {
      dictColonSplits.set(rawIndex, valueStart);
      // Let any AST node whose span starts exactly at the value (a `Call`'s callee, a
      // `BooleanLit`, …) resolve back to this raw index too — `markNameIndex` above is the
      // consumer that needs it.
      byStart.set(posKey(valueStart), rawIndex);
    }
  }

  /**
   * A `NumberLitNode` whose span starts at a `-` op token immediately followed by the numeral
   * it merges with (`tryNegativeNumberLiteral` in the parser) is one `number` token, not a
   * separate `operator` + `number` pair.
   *
   * A `NumberLitNode`'s span always starts at a real, non-`eof` token (either the merged `-` op
   * or the numeral itself), so `byStart` always resolves it.
   */
  function markNegativeLiteral(node: NumberLitNode): void {
    const startIndex = byStart.get(posKey(node.source_span.start)) as number;
    const startToken = lex[startIndex];
    const numberToken = lex[startIndex + 1];
    if (
      startToken?.kind === "op" &&
      startToken.text === "-" &&
      numberToken?.kind === "number" &&
      numberToken.source_span.end[0] === node.source_span.end[0] &&
      numberToken.source_span.end[1] === node.source_span.end[1]
    ) {
      negativeMergeStarts.add(startIndex);
    }
  }

  /** Is the token at `index` the word `expected` (case-insensitive)? Tag it if so. */
  function markContextualWord(index: number, expected: string): void {
    const token = lex[index];
    if (token?.kind === "name" && token.text.toLowerCase() === expected) {
      contextualKeywordIndexes.add(index);
    }
  }

  /**
   * `empty`/`member`/`of`/`a` are keywords in reader-recognized positions. `spec/tooling.md:97-99`
   * is the normative highlighter instruction and names two: "only inside an `is`-predicate or the
   * heritage `value of … for key` reader, and as ordinary names elsewhere". This function handles
   * the first — `spec/grammar.md:234` states its adjacency rule — and
   * {@link markValueOfKeyPreposition} below handles the second. `is` itself, `between`, and
   * `strictly` are already globally reserved. The grammar requires each word directly adjacent in
   * the token stream (no `skipNewlines` between them), so once `is` is found the rest are just the
   * following raw token indexes.
   *
   * `node.operand`'s span always ends at a real, non-`eof` token, and the parser only ever
   * builds an `IsPredicateNode` when `is` is the literal next raw token after the operand
   * (`isName` reads `current()` directly, with no `skipNewlines` between) — so `byEnd` always
   * resolves and `isIndex` always lands on that `is` token.
   */
  function markIsPredicateKeywords(node: IsPredicateNode): void {
    const operandEndIndex = byEnd.get(
      posKey(node.operand.source_span.end),
    ) as number;
    const isIndex = operandEndIndex + 1;
    switch (node.test.form) {
      case "empty":
        markContextualWord(isIndex + 1, "empty");
        break;
      case "member-of":
        markContextualWord(isIndex + 1, "member");
        markContextualWord(isIndex + 2, "of");
        break;
      case "a":
        markContextualWord(isIndex + 1, "a");
        break;
      case "between":
        break;
    }
  }

  /**
   * `of` in the Heritage `value of <dict> for key <key>` reader (`spec/grammar.md:213`'s
   * `value-of-reader`) is `keyword`, alongside the `is`-predicate's `of` above.
   *
   * `spec/tooling.md:97-99` is the normative highlighter instruction and names **both** positions:
   * a highlighter marks `empty`/`member`/`of`/`a` as `keyword` "only inside an `is`-predicate or
   * the heritage `value of … for key` reader, and as ordinary names elsewhere". That sentence named
   * only the `is`-predicate until the maintainer's ruling on issue #785 added this reader; the spec
   * amendment and this marking ship in the same change, so no version of the tree has the code and
   * the spec disagreeing.
   *
   * Supporting passages elsewhere in the spec: `spec/tooling.md:30` names `of` among the contextual
   * words that take the `keyword` class in the structural positions it describes;
   * `spec/localization.md:80,82` lists
   * `value of dict for key key_value` among the Heritage grammar forms and states these forms "can
   * contain structural words such as `to`, `of`, `for`, and `key` in fixed grammar slots" — naming
   * `of` a structural word of this production, beside the three siblings that are reserved and so
   * already `keyword`; and `spec/grammar.md:380` calls this `of` "the contextual preposition in the
   * heritage `value of … for key` reader".
   *
   * Not every passage is yet phrased to match. `spec/grammar.md:234` and `:380`,
   * `spec/execution-model.md:154-156`, and `spec/commands.md:461` still scope these four words'
   * contextual-keyword status to the `is`-predicate — `:380` then adds the reader parenthetical
   * quoted above, so it has carried that tension since the spec's initial commit, independently of
   * #785. All four are about reader recognition and *reservation* rather than token class:
   * `spec/grammar.md:7` scopes that document to "lexis, reader-visible syntax … and reserved
   * structural words", and `spec/commands.md:461`'s clause is explicitly a reservation contrast
   * ("Only `is`, `strictly`, and `between` are reserved"). The normative token-class model is
   * `spec/tooling.md`'s, so none of the four governs this class. Tightening their wording is a
   * maintainer call raised with the #785 ruling, not something this change assumes.
   *
   * It is emphatically not `primitive` **as a matrix claim**: `spec/tooling.md:31` scopes that
   * sense to "Built-in commands, reporters, and aliases from the C3 primitive matrix", and
   * `of` is in no primitive table (`corePrimitiveArity("of") === undefined`; `spec/commands.md` has
   * no `of` entry). `:31` does make `primitive` the grammar-safe *fallback* for an unclaimed bare
   * name, but it forbids reading matrix membership into that — whereas `semanticTokens` then
   * decorated `of` with `defaultLibrary`, asserting standard-library membership for a word that has
   * none (the residue tracked by #831).
   *
   * This is a *classification*, not a reservation: `of` is still not a reserved word, so it stays
   * redefinable and remains an ordinary name outside these two positions (`:of`, `define of`,
   * `{ of: 2 }`) — see `keywords.ts`, which deliberately omits all four contextual words.
   *
   * The node's span starts at its own `value` token, and the parser only builds a
   * `ValueOfKeyNode` when `of` is the literal next raw token (`peek(1)`, no `skipNewlines`
   * between) — so `byStart` always resolves and `of` is always the following index. That makes
   * **both** halves of {@link markContextualWord}'s guard redundant defence-in-depth on this path
   * rather than live branches: the token there is always a `name` token, and its text is always
   * `of`. Deleting either half leaves the whole suite green (verified), so neither is pinned from
   * here; they are the shared helper's signature, kept because with them a wrong index degrades to
   * marking nothing, while without them it would mark the *wrong* token `keyword`.
   * Marking by token index leaves every other `of` in the same document untouched.
   */
  function markValueOfKeyPreposition(node: ValueOfKeyNode): void {
    const valueIndex = byStart.get(posKey(node.source_span.start)) as number;
    markContextualWord(valueIndex + 1, "of");
  }

  // Run the positional pattern/field-list scan first: a `[` directly after `for`/`struct
  // <type>` is grammatically never a real list literal today, but the parser's error recovery
  // can still misfile it as one (see markBracketPair's comment) — claiming the role here first
  // means the later AST walk's `markBracketPair` calls simply no-op on those same indexes. It
  // also discovers every `struct <type> [ field … ]`'s type/field names (#120): the declaration
  // has no AST node to walk, so this positional scan is their only source of truth.
  scanPositionalBracketRoles();

  // `define`/`to` procedure headers DO parse into real `ProcedureDefNode`s, so their names are
  // discovered with a plain pre-pass walk — done before the main `visit` walk below so a call
  // that appears lexically before its definition still resolves.
  const procNames = new Set<string>();
  walk(program, (node) => {
    if (node.kind === "ProcedureDef") {
      procNames.add(node.name.name.toLowerCase());
    }
  });

  function visit(node: AnyNode): void {
    switch (node.kind) {
      case "ListLit":
        markBracketPair(node.source_span, "list");
        break;
      case "DictLit":
        for (const entry of node.entries) {
          markSelectorKey(entry.key);
          markGluedDictColon(entry);
        }
        break;
      case "If":
        markBracketPair(node.thenBody.source_span, "instruction-block");
        if (node.elseBody !== undefined) {
          markBracketPair(node.elseBody.source_span, "instruction-block");
        }
        break;
      case "While":
      case "Repeat":
      case "Forever":
        markBracketPair(node.body.source_span, "instruction-block");
        break;
      case "ForIn":
        markBracketPair(node.body.source_span, "instruction-block");
        markBinder(node.binder);
        break;
      case "ForRange":
        markBracketPair(node.body.source_span, "instruction-block");
        markNameIndex(node.variable, binderDeclIndexes);
        break;
      case "Comprehension":
        markBracketPair(node.body.source_span, "instruction-block");
        markBinder(node.binder);
        if (node.form === "reduce") {
          markNameIndex(node.accumulator, binderDeclIndexes);
        }
        break;
      case "Local":
        for (const name of node.names) {
          markNameIndex(name, binderDeclIndexes);
        }
        break;
      case "Assign":
        // Only a real place has a name to highlight: a malformed target (`first :repeat = 5`,
        // `3 = 5`) parses to some other expression and introduces nothing.
        if (node.place.kind === "Place") {
          markNameIndex(node.place.base, placeHeadIndexes);
        }
        break;
      case "ProcedureDef":
        markBracketPair(node.body.source_span, "instruction-block");
        markNameIndex(node.name, procDeclIndexes);
        for (const param of node.params) {
          markNameIndex(param.name, paramDeclIndexes, "variable");
        }
        break;
      case "Call":
      case "ParenCall": {
        const lower = node.callee.name.toLowerCase();
        if (procNames.has(lower)) {
          markNameIndex(node.callee, procCallIndexes);
        } else if (typeNames.has(lower)) {
          markNameIndex(node.callee, typeCallIndexes);
        }
        break;
      }
      case "Place":
      case "PostfixExpression":
        for (const segment of node.segments) {
          if (segment.kind === "index") {
            markBracketPair(segment.source_span, "selector");
            markSelectorKey(segment.key);
          } else if (fieldNames.has(segment.name.name.toLowerCase())) {
            markNameIndex(segment.name, fieldAccessIndexes);
          }
        }
        break;
      case "NumberLit":
        markNegativeLiteral(node);
        break;
      case "IsPredicate":
        markIsPredicateKeywords(node);
        break;
      case "ValueOfKey":
        markValueOfKeyPreposition(node);
        break;
      default:
        break;
    }
  }
  walk(program, visit);

  /**
   * `pattern` (`for [:x :y] in …`) has no AST support yet — destructuring binders are a later
   * slice — so it resolves purely from adjacent raw-token spellings, independent of whether the
   * surrounding construct parses cleanly. `field-list` (`struct <type> [ … ]`) is the same story
   * for its bracket role, and #120 additionally discovers the declaration's type name (the name
   * right before the bracket) and field names (every bare name between the brackets) from this
   * same positional scan, since `struct` has no dedicated AST node to walk either.
   */
  function scanPositionalBracketRoles(): void {
    for (let index = 0; index < lex.length; index += 1) {
      const token = lex[index];
      if (token?.kind !== "lbracket" || roleByIndex.has(index)) {
        continue;
      }
      const prev = previousSignificant(index);
      if (
        prev?.token.kind === "name" &&
        prev.token.text.toLowerCase() === "for"
      ) {
        applyPositionalRole(index, "pattern");
        continue;
      }
      if (prev?.token.kind === "name") {
        const beforePrev = previousSignificant(prev.index);
        if (
          beforePrev?.token.kind === "name" &&
          beforePrev.token.text.toLowerCase() === "struct"
        ) {
          typeDeclIndexes.add(prev.index);
          typeNames.add(prev.token.text.toLowerCase());
          const closeIndex = applyPositionalRole(index, "field-list");
          if (closeIndex !== undefined) {
            // The normative field list is bare names only (`struct <type> [ field1 field2 … ]`)
            // — a nested `[ … ]` is not a field spelling, so depth-track past it rather than
            // scooping up its own contents as bogus fields (e.g. `struct p [ x [ y ] z ]` must
            // not treat `y` as a field of `p`).
            let depth = 0;
            for (
              let fieldIndex = index + 1;
              fieldIndex < closeIndex;
              fieldIndex += 1
            ) {
              const fieldToken = lex[fieldIndex];
              if (fieldToken?.kind === "lbracket") {
                depth += 1;
              } else if (fieldToken?.kind === "rbracket") {
                depth -= 1;
              } else if (depth === 0 && fieldToken?.kind === "name") {
                fieldDeclIndexes.add(fieldIndex);
                fieldNames.add(fieldToken.text.toLowerCase());
              }
            }
          }
        }
      }
    }
  }

  function previousSignificant(
    index: number,
  ): { readonly index: number; readonly token: LexToken } | undefined {
    let cursor = index - 1;
    while (cursor >= 0 && lex[cursor]?.kind === "newline") {
      cursor -= 1;
    }
    const token = cursor >= 0 ? lex[cursor] : undefined;
    return token === undefined ? undefined : { index: cursor, token };
  }

  /**
   * Tag `openIndex` and its depth-matched close bracket with `role`; returns the close bracket's
   * index (or `undefined` when the bracket never closes) so callers that need to inspect what's
   * between the pair — such as `struct <type> [ field … ]`'s field names (#120) — don't have to
   * re-run their own depth-matching scan.
   */
  function applyPositionalRole(
    openIndex: number,
    role: BracketRole,
  ): number | undefined {
    roleByIndex.set(openIndex, role);
    let depth = 1;
    let index = openIndex + 1;
    // Loop until the matching close brings `depth` back to 0 — a genuinely reachable exit hit
    // by every properly-closed pattern/field-list bracket — or bail out early on `eof` for an
    // unclosed one (`tokenize()` always appends a final `eof` token, so this always terminates).
    while (depth > 0) {
      const token = lex[index];
      if (token?.kind === "lbracket") {
        depth += 1;
      } else if (token?.kind === "rbracket") {
        depth -= 1;
      } else if (token?.kind === "eof") {
        return undefined;
      }
      index += 1;
    }
    const closeIndex = index - 1;
    roleByIndex.set(closeIndex, role);
    return closeIndex;
  }

  // Comments live in the whitespace gaps `tokenize()` already skips; scan those gaps only, so
  // string/name/number/operator tokens are never re-inspected (atomicity, spec/tooling.md:25-26).
  const comments = collectComments(source, document, lex);

  const mergedAway = new Set<number>();
  for (const startIndex of negativeMergeStarts) {
    mergedAway.add(startIndex + 1);
  }

  function classifyName(index: number, token: ContentToken): Token {
    if (dictKeyIndexes.has(index)) {
      return {
        class: "dict-key",
        text: token.text,
        source_span: token.source_span,
      };
    }
    if (contextualKeywordIndexes.has(index)) {
      return {
        class: "keyword",
        text: token.text,
        source_span: token.source_span,
      };
    }
    // A binding position (issue #840) decides the class before any name-based fallback below:
    // the token names a variable, whatever it is spelled. Checked ahead of symbol discovery
    // because no other role can occupy the same token — a `local`/binder name is never a call
    // callee, a `define`/`struct` header name, or a `.field` segment — and ahead of the
    // reserved-word/primitive fallbacks, which are exactly the two misclassifications
    // `spec/grammar.md:386` forbids the tooling from implying.
    if (binderDeclIndexes.has(index) || placeHeadIndexes.has(index)) {
      return {
        class: ":variable",
        text: token.text,
        source_span: token.source_span,
        declaration: binderDeclIndexes.has(index),
      };
    }
    // Semantic disambiguation (#120): a name resolved by symbol discovery to a user procedure,
    // struct type, or struct field takes priority over the plain reserved-word/primitive
    // fallback below — this is exactly what lets a reserved-word-spelled field/procedure name
    // (e.g. a field literally named `repeat`) stay its resolved class instead of `keyword`.
    if (procDeclIndexes.has(index) || procCallIndexes.has(index)) {
      return {
        class: "procedure-name",
        text: token.text,
        source_span: token.source_span,
        declaration: procDeclIndexes.has(index),
      };
    }
    if (typeDeclIndexes.has(index) || typeCallIndexes.has(index)) {
      return {
        class: "type-name",
        text: token.text,
        source_span: token.source_span,
        declaration: typeDeclIndexes.has(index),
      };
    }
    if (fieldDeclIndexes.has(index) || fieldAccessIndexes.has(index)) {
      return {
        class: "field-name",
        text: token.text,
        source_span: token.source_span,
        declaration: fieldDeclIndexes.has(index),
      };
    }
    const lower = token.text.toLowerCase();
    if (WORD_OPERATORS.has(lower)) {
      return {
        class: "operator",
        text: token.text,
        source_span: token.source_span,
      };
    }
    if (isKeyword(lower)) {
      return {
        class: "keyword",
        text: token.text,
        source_span: token.source_span,
      };
    }
    return {
      class: "primitive",
      text: token.text,
      source_span: token.source_span,
    };
  }

  function withRole(base: Token, role: BracketRole | undefined): Token {
    return role === undefined ? base : { ...base, role };
  }

  function classifyToken(index: number, token: ContentToken): Token {
    if (negativeMergeStarts.has(index)) {
      const numberToken = lex[index + 1] as LexToken;
      return {
        class: "number",
        text: token.text + numberToken.text,
        source_span: makeSpan(
          document,
          token.source_span.start,
          numberToken.source_span.end,
        ),
      };
    }
    switch (token.kind) {
      case "number":
        return {
          class: "number",
          text: token.text,
          source_span: token.source_span,
        };
      case "word":
        return {
          class: "word/string",
          text: token.text,
          source_span: token.source_span,
        };
      case "variable":
        return {
          class: ":variable",
          text: token.text,
          source_span: token.source_span,
          declaration: paramDeclIndexes.has(index),
        };
      case "lbrace":
      case "rbrace":
        return {
          class: "brace",
          text: token.text,
          source_span: token.source_span,
        };
      case "lparen":
      case "rparen":
        return {
          class: "paren",
          text: token.text,
          source_span: token.source_span,
        };
      case "dot":
        return {
          class: "index/dot",
          text: token.text,
          source_span: token.source_span,
        };
      case "colon":
        return {
          class: "operator",
          text: token.text,
          source_span: token.source_span,
        };
      case "op":
        return {
          class: "operator",
          text: token.text,
          source_span: token.source_span,
        };
      case "lbracket":
      case "rbracket": {
        const role = roleByIndex.get(index);
        const base: Token =
          role === "selector"
            ? {
                class: "index/dot",
                text: token.text,
                source_span: token.source_span,
              }
            : {
                class: "bracket",
                text: token.text,
                source_span: token.source_span,
              };
        return withRole(base, role);
      }
      case "name":
        return classifyName(index, token);
    }
  }

  const output: Token[] = [];
  let commentCursor = 0;
  // `tokenize()` always appends a synthetic `eof` token positioned at the true end of the
  // source (`tokens.ts`), so every comment's start position is at/before the final loop
  // iteration's `eof` token — the flush below always drains `comments` before the loop ends;
  // there is no leftover to flush afterwards.
  for (let index = 0; index < lex.length; index += 1) {
    const token = lex[index] as LexToken;
    while (
      commentCursor < comments.length &&
      isAtOrBefore(
        (comments[commentCursor] as Token).source_span.start,
        token.source_span.start,
      )
    ) {
      output.push(comments[commentCursor] as Token);
      commentCursor += 1;
    }
    if (!isContentToken(token) || mergedAway.has(index)) {
      continue;
    }
    const splitValueStart = dictColonSplits.get(index);
    if (splitValueStart !== undefined) {
      // A glued dict-entry value (`{ a:foo }`) lexed as one `variable`-kind token spanning
      // `:foo`; emit the operator `:` and the value's own real classification separately,
      // matching a normally-spaced entry's two tokens (spec/tooling.md:39,41).
      output.push({
        class: "operator",
        text: ":",
        source_span: makeSpan(
          document,
          token.source_span.start,
          splitValueStart,
        ),
      });
      const nameToken: ContentToken = {
        kind: "name",
        text: token.text.slice(1),
        value: "",
        source_span: makeSpan(document, splitValueStart, token.source_span.end),
      };
      output.push(classifyName(index, nameToken));
      continue;
    }
    output.push(classifyToken(index, token));
  }
  return output;
}

/**
 * Comments are pure whitespace to {@link tokenize} (`tokens.ts` skips `#`, `//`, and `/* ... *\/`
 * without pushing a token or preserving their span/text anywhere) — by design, not oversight, so
 * there is no comment data for `highlight` to "reuse" from the token stream. Recovering them is
 * therefore necessarily a second scan, but a narrow one: it only walks the gaps *between*
 * consecutive real tokens (any *successfully* tokenized content is never part of a gap) and only
 * ever recognizes comment *start* markers (`#`, `//`, `/*`) plus their close, using the exact same
 * marker rules and line/column bookkeeping {@link tokenize} itself uses (see
 * {@link buildOffsetIndex}). It never re-tokenizes or re-classifies a string, name, number,
 * bracket, or operator — those all still come from `lex`. The one caveat is an *unclosed*
 * `"..."`/`"""..."""` string: `tokenize` still consumes its characters but pushes no `word` token
 * for it (`tokens.ts`'s `"` branch only calls `push` when `closed` is true), so that content can
 * land inside a gap too — `scanGap` below bails out the moment it sees a bare `"`, since that can
 * only mean failed string content, never a real comment. Teaching {@link tokenize} itself to
 * preserve comment (and unclosed-string) trivia would remove this scan entirely, but that is a
 * shared, cross-cutting change to the lexer (used by the parser, runtime, and checker) outside
 * this issue's declared write-set — left as a follow-up, not bundled here.
 */
function collectComments(
  source: string,
  document: string,
  lex: readonly LexToken[],
): Token[] {
  const chars = [...source];
  const offsetOf = buildOffsetIndex(chars);
  const comments: Token[] = [];
  let previousEnd: Position = [1, 1];
  for (const token of lex) {
    scanGap(previousEnd, token.source_span.start);
    previousEnd = token.source_span.end;
  }
  return comments;

  function scanGap(from: Position, to: Position): void {
    const startOffset = offsetOf.get(posKey(from));
    const endOffset = offsetOf.get(posKey(to));
    if (
      startOffset === undefined ||
      endOffset === undefined ||
      startOffset >= endOffset
    ) {
      return;
    }
    let index = startOffset;
    let line = from[0];
    let column = from[1];
    // Every call site below only ever invokes `advanceOne` while `index` still addresses a real
    // character: either `index < endOffset` (and `endOffset` is itself a real offset into
    // `chars`) is checked first, or (for the 2-character `/*`/`*/` delimiters) the position was
    // already read as a real, non-`undefined` character just before advancing past it.
    const advanceOne = (): string => {
      const ch = chars[index] as string;
      index += 1;
      if (ch === "\n") {
        line += 1;
        column = 1;
      } else {
        column += 1;
      }
      return ch;
    };
    while (index < endOffset) {
      const ch = chars[index];
      // An unclosed `"..."` or `"""..."""` string is consumed by `tokenize` (advancing its
      // cursor) without ever pushing a `word` token (`tokens.ts`'s `"` branch only calls `push`
      // when `closed` is true) — so its content silently lands inside a "gap" here too, breaking
      // the "a gap holds only whitespace/comments" invariant. A bare `"` can only appear in a gap
      // for this reason (any successfully closed string IS a real token, so its span is never
      // part of a gap), so once one is seen the remainder of this gap is unclassifiable failed
      // string content, not comments — stop scanning it immediately rather than risk misreading
      // e.g. a `#`/`//` inside it as a real comment.
      if (ch === '"') {
        return;
      }
      if (ch === "#" || (ch === "/" && chars[index + 1] === "/")) {
        const start: Position = [line, column];
        let text = "";
        while (index < endOffset && chars[index] !== "\n") {
          text += advanceOne();
        }
        comments.push({
          class: "comment",
          text,
          source_span: makeSpan(document, start, [line, column]),
        });
        continue;
      }
      if (ch === "/" && chars[index + 1] === "*") {
        const start: Position = [line, column];
        let text = advanceOne() + advanceOne();
        while (
          index < endOffset &&
          !(chars[index] === "*" && chars[index + 1] === "/")
        ) {
          text += advanceOne();
        }
        if (index < endOffset) {
          text += advanceOne();
          text += advanceOne();
        }
        comments.push({
          class: "comment",
          text,
          source_span: makeSpan(document, start, [line, column]),
        });
        continue;
      }
      advanceOne();
    }
  }
}

/** Map every `[line, column]` position in `chars` to its code-point offset, mirroring the
 * exact `advance()` line/column bookkeeping {@link tokenize} uses (so gap lookups always hit). */
function buildOffsetIndex(chars: readonly string[]): Map<string, number> {
  const map = new Map<string, number>();
  let line = 1;
  let column = 1;
  for (let index = 0; index <= chars.length; index += 1) {
    map.set(posKey([line, column]), index);
    if (index === chars.length) {
      break;
    }
    const ch = chars[index];
    if (ch === "\n") {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  }
  return map;
}
