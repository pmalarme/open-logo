/**
 * The OpenLogo reader/parser: it turns a `.logo` source string into the shared {@link ast}
 * (a {@link ProgramNode}) plus a flat list of `ol-*` diagnostics. Malformed input is never
 * thrown — every finding is collected and returned, so a studio, the checker, and the tutor
 * all get a best-effort tree *and* the diagnostics that explain the gaps.
 *
 * It is a hand-written recursive-descent parser over the token stream from {@link tokenize},
 * following the EBNF in [`spec/grammar.md`](../../../spec/grammar.md): prefix, space-separated
 * calls whose argument count comes from the callable's default arity; the precedence ladder
 * `or → and → comparison → additive → multiplicative → unary → postfix → primary`; `[ … ]`
 * inline / `… end` multiline blocks; and `:place = value` / `set place to value` assignment.
 * Operators become {@link ast.call} nodes with the operator as callee, so the AST needs no
 * separate binary-expression kind.
 *
 * Scope for this slice is the Core surface: prefix calls, the precedence ladder, blocks,
 * assignment, `local`, dotted places (`:a.b.c`), worded `is`-predicates, comparison chains,
 * the parenthesized variadic `(and …)`/`(or …)`, and dict literals (`{ key: value … }`, the
 * Data profile's `dict-literal` production). The Heritage assignment/procedure spellings
 * `make`/`to`/`output`/`op` also parse structurally — into the same `Assign`/`ProcedureDef`/
 * `Return` nodes as their Core equivalents, discriminated by `form`/`keyword` (issues #151, #667) —
 * with their profile-legality (Heritage active?) left to the Layer-2 checker's form-head gate.
 * Index/key selectors (`:a[i]`) and struct and the other Data forms are handled by their own later
 * slices; until then those spellings degrade to ordinary calls or a collected diagnostic rather
 * than a crash. The Heritage short command aliases (`fd`/`bk`/`lt`/`rt`/`pu`/`pd`/`st`/`ht`/`cs`/
 * `pr`, issue #668) parse into an ordinary `Call`/`ParenCall` grouped by the canonical command's
 * arity, with `canonical` recording the Core spelling so the runtime dispatches identically — their
 * Heritage-active gating is again the checker's concern.
 */

import { makeSpan } from "@openlogo/core";
import type { Diagnostic, Position, SourceSpan } from "@openlogo/core";
import { ast } from "./ast.js";
import type {
  Binder,
  BlockNode,
  DestructuringBinderNode,
  DictEntryNode,
  ExpressionNode,
  NumberLitNode,
  PlaceSegment,
  ProcedureDefNode,
  ProcedureParam,
  ProgramNode,
  ReturnNode,
  SpannedName,
  StatementNode,
  WordLitNode,
} from "./ast.js";
import { parseDiag } from "./errors.js";
import { OL_KEYWORDS } from "./keywords.js";
import {
  canonicalOfHeritageAlias,
  heritageAliasArity,
  primitiveArity,
} from "./signatures.js";
import { tokenize } from "./tokens.js";
import type { LexToken, LexTokenKind } from "./tokens.js";

/** The result of {@link parse}: a best-effort AST plus every collected diagnostic. */
export interface ParseResult {
  readonly ast: ProgramNode;
  readonly diagnostics: readonly Diagnostic[];
}

/**
 * The keywords that genuinely *may* begin an `expression` (`spec/grammar.md:193-206`), and
 * are therefore the only ones {@link parseNamePrimary} reads rather than rejecting:
 *
 * - `true`/`false` — the `boolean-literal` production (`spec/grammar.md:206`).
 * - `map`/`filter`/`reduce` — the `comprehension` production (`spec/grammar.md:133-136,342-352`),
 *   which "may appear anywhere a value is expected".
 * - `thing` — the one keyword that is *also* a Core primitive reporter (`thing "name`,
 *   `spec/commands.md`), so it is a real `fixed-call` callee.
 *
 * `value` is deliberately absent: it heads the `value-of-reader` production
 * (`spec/grammar.md:217`) only when `of` directly follows, which {@link parseNamePrimary} matches
 * *before* consulting {@link NON_PRIMARY_NAMES} — so the reader form keeps working while a **bare**
 * `value` is rejected like any other misplaced structural word.
 */
const EXPRESSION_INITIAL_KEYWORDS: ReadonlySet<string> = new Set<string>([
  "thing",
  "true",
  "false",
  "map",
  "filter",
  "reduce",
]);

/**
 * Structural words that can never begin an expression, so the reader must not read them as a bare
 * call — it returns `undefined` instead and the caller reports the token with `ol-bad-token`
 * ("a token that is itself a valid OpenLogo token but is not permitted at the current grammar
 * position", `spec/error-model.md:109`).
 *
 * **Derived from {@link OL_KEYWORDS}, not hand-listed** (issue #853). A keyword is "a word the
 * grammar itself gives meaning to rather than a name a program can introduce"
 * (`spec/grammar.md:358`), so *every* keyword is illegal in expression position except the handful
 * {@link EXPRESSION_INITIAL_KEYWORDS} names. Deriving the
 * complement makes that the invariant: a word added to that registry in a future slice is rejected
 * here automatically, instead of silently becoming a zero-arity {@link ast.call} that no rule flags.
 * Before this, `repeat value [ ]` and `repeat key [ ]` parsed *and* checked completely CLEAN under
 * every profile set — as did the Data mutation heads `add`/`remove`/`insert`/`clear` in the same
 * position. That is the "silent no-op" class: the program does something other than what was
 * written, and nothing says so.
 *
 * **That invariant has now had its first live test, and it held.** #853 had to carry `mod` as an
 * explicit extra entry, because `mod` was the one reader-structural word missing from the registry —
 * the gap #853 filed as #868. Issue #837 closes it: `mod` is a keyword
 * (`spec/grammar.md:373`, and see `keywords.ts`), so the derivation now supplies it and the hand-kept
 * exception is **gone**. Removing it is behaviour-preserving by construction — `mod` is in
 * {@link OL_KEYWORDS} and not in {@link EXPRESSION_INITIAL_KEYWORDS}, so the filter yields it
 * either way — which is exactly the property #853 built this derivation to guarantee. This set now
 * has no hand-maintained exceptions at all.
 *
 * Scope is the **global Core registry only**. {@link OL_PROFILE_KEYWORDS} (`ask`/`each`/`tell`, the
 * four event heads) is deliberately excluded: this reader is profile-blind by design (see
 * {@link PROFILE_STATEMENT_FORMS}), so it shapes a program that declares `ask` as an ordinary
 * `define`/call pair rather than a profile statement. Since issue #841 the *checker* then raises
 * `ol-reserved-word` on that declaration — `spec/grammar.md:408` makes profile words built-in names
 * unconditionally — but which diagnostic to raise is the checker's question, not this set's, and
 * rejecting them in value position is a third rule again (issue #864).
 *
 * The statement heads stay unaffected because {@link parseStatement} dispatches `add`/`remove`/
 * `insert`/`clear` by keyword *before* any expression is read, and the bare-key positions
 * (`key-term`, `dict-key`, `.field`) read a raw `name` token rather than a primary — "Dictionary
 * keys and selector bare keys are data, not declarations, so built-in names are legal keys"
 * (`spec/grammar.md:406`) still holds.
 *
 * A `bare-place` (`set value to 1`) also reads a raw `name`, so it too is untouched here. It is a
 * **binding** rather than data, and `spec/grammar.md:386` makes binding any name — keyword
 * included — a conforming program, so nothing rejects it at either layer; this set neither adds nor
 * removes that.
 */
const NON_PRIMARY_NAMES: ReadonlySet<string> = new Set<string>(
  OL_KEYWORDS.filter((word) => !EXPRESSION_INITIAL_KEYWORDS.has(word)),
);

const END_LABELS = new Set<string>([
  "if",
  "while",
  "repeat",
  "for",
  "forever",
  "define",
  // Profile block-head labels: a labeled `end` after a profile block (`end ask`, `end each`,
  // `end when`, `end every`, `end on_key`, `end on_click`) must be recognized as a closer so the
  // block-tail machinery can match it against its opener and raise `ol-mismatched-end` on a wrong
  // label (`spec/turtles-and-sprites.md:167,170`, `spec/interaction-events.md:62,65`). `tell` is
  // absent: it is a bodyless mode-switch command with no block and therefore no `end`.
  "ask",
  "each",
  "when",
  "every",
  "on_key",
  "on_click",
]);

/**
 * A profile-gated statement form the reader recognizes structurally — the extension point for
 * every profile's block-head and mode-switch statement (`spec/grammar.md#profile-grammar-extensions`).
 *
 * - `argCount` — how many Core `expression` arguments the head takes before its block (one for
 *   `tell`/`ask`/`when`/`every`/`on_key`, none for `each`/`on_click`).
 * - `hasBlock` — whether the form takes a block body: a block-head (`ask`, `each`, and all four
 *   event heads) does; the bodyless `tell` mode-switch command does not.
 */
interface ProfileStatementForm {
  readonly argCount: number;
  readonly hasBlock: boolean;
}

/**
 * The profile statement-form registry: the single seam through which every M5 profile statement
 * form hangs off the Core `statement` production, so a profile epic (Sprites SP2/SP3/SP4,
 * Interaction & Events I3–I6) needs no further edit to the reader's statement dispatch. Consulted
 * only in {@link parseStatement}'s name-`switch` default, it keeps that `switch` — the shared code
 * `#151`'s `make` special form also restructured — closed to new profile keywords.
 *
 * The reader is deliberately profile-blind: it parses any registered keyword into a
 * {@link ast.profileStatement} node regardless of the active profile set, reusing the Core
 * `expression` and block productions the spec mandates ("They reuse the Core `expression`,
 * `bracket-block`, `statement`, and `terminator` productions."). Whether a form is *legal* under
 * the program's active profiles is left to the Layer-2 checker (`spec/tooling.md:175-176`),
 * mirroring how {@link primitiveArity} groups a profile primitive's arguments for the reader while
 * `check()` gates legality. The keyword registry (`OL_PROFILE_KEYWORDS`, C1 #663) is
 * the checker's contract, not the reader's — this table is intentionally separate.
 *
 * Sources: `spec/turtles-and-sprites.md:161-167` (`tell`/`ask`/`each`),
 * `spec/interaction-events.md:54-62` (`when`/`every`/`on_key`/`on_click`).
 */
const PROFILE_STATEMENT_FORMS: ReadonlyMap<string, ProfileStatementForm> =
  new Map([
    // Sprites profile.
    ["tell", { argCount: 1, hasBlock: false }],
    ["ask", { argCount: 1, hasBlock: true }],
    ["each", { argCount: 0, hasBlock: true }],
    // Interaction & Events profile.
    ["when", { argCount: 1, hasBlock: true }],
    ["every", { argCount: 1, hasBlock: true }],
    ["on_key", { argCount: 1, hasBlock: true }],
    ["on_click", { argCount: 0, hasBlock: true }],
  ]);

/**
 * Whether the token at index `k` begins a statement — i.e. it is the first token of the stream, the
 * previous token is a statement terminator (`newline`), or the previous token opens a block (`[`), so
 * the first statement inside an inline block body counts too. Used by {@link collectUserArities} to
 * distinguish the Heritage procedure *opener* `to` (statement-leading) from `to`'s mid-statement
 * keyword roles (`set … to` and `for … from … to`, `spec/grammar.md:380`, plus the Data
 * `add … to <list>` preposition, `spec/grammar.md:115` — `:380` names the first two and the
 * opener, not this one), so only the opener registers a callable arity. Including `[` keeps a
 * nested `[to f :x … end …]` procedure registering its arity exactly as the equivalent nested
 * `define` already does — the mid-statement `to` prepositions never sit directly after `[` (their
 * operands always come between the block opener and the `to`), so widening the start set stays safe.
 */
function atStatementStart(tokens: readonly LexToken[], k: number): boolean {
  if (k === 0) {
    return true;
  }
  const previous = (tokens[k - 1] as LexToken).kind;
  return previous === "newline" || previous === "lbracket";
}

/**
 * Pre-scan the token stream for the user-declared forms that register a callable name, so a
 * later prefix call to any of them knows how many arguments to gather:
 *
 * - `define <name> :p …` — a user procedure; its default arity is the count of leading required
 *   `:name` parameters (an optional `( :name default )` parameter does not count).
 * - `to <name> :p …` — the Heritage alternate procedure spelling (`spec/grammar.md:146`), which
 *   registers a callable of the same default arity as `define`, gated to a statement-leading `to`
 *   so `to`'s mid-statement preposition roles never mis-register a following name.
 * - `struct <name> [ f1 f2 … ]` — a Data-profile record type whose type name becomes a constructor
 *   reporter (`spec/data-structures.md:254,264`); its arity is the declared field count. Without
 *   this, a bare constructor call like `point 3 4` would read `point` as a zero-arity call and
 *   leave `3 4` as stray tokens (issue #329) — the same "reader needs a callee's arity to group a
 *   bare call's arguments" mechanism `define` already relies on, extended to the other name-
 *   registering form the grammar already parses (issue #321's `StructDef`).
 *
 * This pre-scan is purely about arity grouping for the reader; it performs no validation. A name
 * that collides with a primitive or another declaration is still recorded here so parsing does not
 * crash — the runtime's phase-1 `struct` registration is what raises `ol-reserved-word` for a real
 * collision (`spec/data-structures.md:264`).
 */
function collectUserArities(
  tokens: readonly LexToken[],
): ReadonlyMap<string, number> {
  const arities = new Map<string, number>();
  // Every read below is bounded by tokens.length, and tokenize always terminates the
  // stream with an eof token, so these indexed reads are in range (eof never matches a
  // name or a variable, so the scans stop before running off the end).
  for (let k = 0; k + 1 < tokens.length; k += 1) {
    const head = tokens[k] as LexToken;
    if (head.kind !== "name") {
      continue;
    }
    const headText = head.text.toLowerCase();
    const nameTok = tokens[k + 1] as LexToken;
    if (nameTok.kind !== "name") {
      continue;
    }
    if (
      headText === "define" ||
      (headText === "to" && atStatementStart(tokens, k))
    ) {
      // `to` is the Heritage alternate spelling of `define` (`spec/grammar.md:146`), so a
      // `to <name> :p …` procedure registers a callable of the same default arity — the count of
      // leading `:name` parameters — exactly as `define` does, so a later bare call to it groups
      // its arguments correctly. `to` carries FOUR roles: the Heritage procedure *opener*, plus the
      // `set … to` and `for … from … to` prepositions (`spec/grammar.md:380` names those three) and
      // the Data `add … to <list>` preposition (`spec/grammar.md:115`). Only the opener begins a
      // statement; the other three appear mid-statement — so {@link atStatementStart} gates this to
      // the opener alone and never mis-registers the `<list>` name in `add 3 to colors` as a
      // procedure.
      let arity = 0;
      for (let j = k + 2; j < tokens.length; j += 1) {
        if ((tokens[j] as LexToken).kind !== "variable") {
          break;
        }
        arity += 1;
      }
      arities.set(nameTok.text.toLowerCase(), arity);
    } else if (
      headText === "struct" &&
      (tokens[k + 2] as LexToken).kind === "lbracket"
    ) {
      // `struct <name> [ f1 f2 … ]`: the constructor's arity is the number of bare field-name
      // tokens between the brackets. The scan stops at the first non-name token (the `]`, or a
      // stray token the parser itself will diagnose).
      let fieldCount = 0;
      for (let j = k + 3; j < tokens.length; j += 1) {
        if ((tokens[j] as LexToken).kind !== "name") {
          break;
        }
        fieldCount += 1;
      }
      arities.set(nameTok.text.toLowerCase(), fieldCount);
    }
  }
  return arities;
}

/** Parse `source` into a Core AST plus diagnostics. Attribution spans point into `document`. */
export function parse(source: string, document = "<input>"): ParseResult {
  const lexed = tokenize(source, document);
  // A local, mutable copy — spliced by parseDictEntry()'s splitGluedColonToken() when a
  // dict-entry's `:` lexed glued to its value (`{ a:foo }`, no gap after the colon) instead of
  // as its own `colon` token, so the rest of the reader still walks a normal token stream.
  const tokens: LexToken[] = lexed.tokens.slice();
  const diagnostics: Diagnostic[] = [...lexed.diagnostics];
  const userArities = collectUserArities(tokens);

  // tokenize always terminates the stream with an eof token, so `tokens` is non-empty and
  // its last element is that eof token — the anchor for end-of-input spans and the value
  // current()/peek() clamp to when a lookahead runs off the end.
  const eofToken = tokens[tokens.length - 1] as LexToken;

  let pos = 0;
  let lastEnd: Position = [1, 1];

  // current()/peek()/advance() clamp with Math.min (a call, not a branch) instead of a
  // guard, so reads past the end return the eof sentinel that every loop already checks —
  // keeping the reader robust with no unreachable defensive branch to leave uncovered.
  function current(): LexToken {
    return tokens[Math.min(pos, tokens.length - 1)] as LexToken;
  }

  function peek(offset: number): LexToken {
    return tokens[Math.min(pos + offset, tokens.length - 1)] as LexToken;
  }

  function advance(): LexToken {
    const token = current();
    lastEnd = token.source_span.end;
    pos += 1;
    return token;
  }

  function skipNewlines(): void {
    while (current().kind === "newline") {
      advance();
    }
  }

  function isName(word: string): boolean {
    const token = current();
    return token.kind === "name" && token.text.toLowerCase() === word;
  }

  function spanFrom(
    start: Position,
    node: { readonly source_span: SourceSpan },
  ): SourceSpan {
    return makeSpan(document, start, node.source_span.end);
  }

  function spanBetween(
    from: { readonly source_span: SourceSpan },
    to: { readonly source_span: SourceSpan },
  ): SourceSpan {
    return makeSpan(document, from.source_span.start, to.source_span.end);
  }

  /** Span from `start` to the end of the most recently consumed token. */
  function spanToHere(start: Position): SourceSpan {
    return makeSpan(document, start, lastEnd);
  }

  function unexpected(token: LexToken): Diagnostic {
    switch (token.kind) {
      case "rbracket":
        return parseDiag.unmatchedBracket(token.source_span, "]");
      case "rparen":
        return parseDiag.unmatchedParen(token.source_span, ")");
      case "lbrace":
        return parseDiag.unmatchedBrace(token.source_span, "{");
      case "rbrace":
        return parseDiag.unmatchedBrace(token.source_span, "}");
      case "newline":
        return parseDiag.badToken(token.source_span, "end of line");
      case "eof":
        return parseDiag.badToken(token.source_span, "end of file");
      default:
        return parseDiag.badToken(token.source_span, token.text);
    }
  }

  /** Build a spanned name from the surface spelling `name` and a source token's span. */
  function sname(name: string, token: LexToken): SpannedName {
    return { name, source_span: token.source_span };
  }

  /**
   * True when a diagnostic already covers the source between `afterToken` and `beforeToken` — i.e.
   * the lexer reported a fault (an unclosed string such as `make "size`, or a multiline triple
   * quoted `make """size`) that consumed the very text a grammar slot expected. A caller uses this
   * to avoid stacking a redundant `ol-bad-token` on top of that more-specific diagnostic
   * (`spec/error-model.md:109`).
   *
   * The window is bounded on *both* sides so an unrelated diagnostic *later* on the line cannot
   * trigger suppression: `make 5 "oops` must still report the invalid `5` target even though an
   * `ol-unclosed-string` appears further along. Positions are compared lexicographically (line then
   * column) so a multiline unclosed string — whose consuming `eof`/`newline` slot token lands on a
   * *later* line — is still recognised as having eaten the slot.
   */
  function lexDiagnosticInGap(
    afterToken: LexToken,
    beforeToken: LexToken,
  ): boolean {
    const gapStart = afterToken.source_span.end;
    const gapEnd = beforeToken.source_span.start;
    const atOrAfter = (a: Position, b: Position): boolean =>
      a[0] > b[0] || (a[0] === b[0] && a[1] >= b[1]);
    return diagnostics.some((diagnostic) => {
      const start = diagnostic.source_span.start;
      return atOrAfter(start, gapStart) && atOrAfter(gapEnd, start);
    });
  }

  /**
   * After a top-level or `end`-terminated statement, a new statement on the *same* line is a
   * run-on: `print 1 print 2` must be flagged, not silently split. We fire only when the next
   * token could actually begin a statement (a name, `:variable`, literal, `(` or `[`); block
   * closers (`end`/`else`), newlines, end-of-input, and lexical garbage fall through so they keep
   * their own diagnostic from {@link resync} or the next {@link parseStatement}.
   */
  /**
   * After a top-level or long-block statement, require a newline (or a block/`end` boundary) before
   * the next one, so `print 1 print 2` is flagged rather than silently read as two statements. The
   * check is skipped when the statement already produced a diagnostic, so a single malformed line
   * yields one error instead of a cascade of run-on reports on the tokens left behind by recovery.
   */
  function requireTerminator(diagnosticsBefore: number): void {
    if (diagnostics.length !== diagnosticsBefore) {
      return;
    }
    const token = current();
    const startsStatement =
      token.kind === "variable" ||
      token.kind === "number" ||
      token.kind === "word" ||
      token.kind === "lparen" ||
      token.kind === "lbracket" ||
      (token.kind === "name" &&
        token.text.toLowerCase() !== "end" &&
        token.text.toLowerCase() !== "else");
    if (startsStatement) {
      diagnostics.push(
        parseDiag.missingTerminator(token.source_span, token.text),
      );
    }
  }

  /**
   * Consume an optional label after `end` and check it names the block that is actually open, so
   * `repeat … end if` is reported rather than silently accepted. An absent label is fine.
   */
  function consumeEndLabel(opener: string): void {
    const label = current();
    if (label.kind === "name" && END_LABELS.has(label.text.toLowerCase())) {
      const actual = label.text.toLowerCase();
      if (actual !== opener) {
        diagnostics.push(
          parseDiag.mismatchedEnd(label.source_span, opener, actual),
        );
      }
      advance();
    }
  }

  /**
   * Look past a `:variable` and any postfix segments — dotted `.field`s and adjacent `[ … ]`
   * selectors — to decide whether this is an assignment target (`:a.b[1] = …`) rather than a bare
   * place read used as an expression. Selectors are skipped by balanced bracket/paren depth so a
   * parenthesized key-term (`:nums[(:i + 1)] = …`) is spanned correctly.
   */
  function peekAdjacent(offset: number): boolean {
    const prevEnd = peek(offset - 1).source_span.end;
    const start = peek(offset).source_span.start;
    return prevEnd[0] === start[0] && prevEnd[1] === start[1];
  }

  function colonAssignmentAhead(): boolean {
    if (current().kind !== "variable") {
      return false;
    }
    let k = 1;
    for (;;) {
      if (peek(k).kind === "dot" && peek(k + 1).kind === "name") {
        k += 2;
        continue;
      }
      if (peek(k).kind === "lbracket" && peekAdjacent(k)) {
        let depth = 0;
        let j = k;
        for (;;) {
          const kind = peek(j).kind;
          if (kind === "eof") {
            return false;
          }
          if (kind === "lbracket" || kind === "lparen") {
            depth += 1;
          } else if (kind === "rbracket" || kind === "rparen") {
            depth -= 1;
            if (depth === 0) {
              j += 1;
              break;
            }
          }
          j += 1;
        }
        k = j;
        continue;
      }
      break;
    }
    const token = peek(k);
    return token.kind === "op" && token.text === "=";
  }

  function resync(): void {
    const token = current();
    if (token.kind === "name" && token.text.toLowerCase() === "end") {
      diagnostics.push(
        parseDiag.mismatchedEnd(token.source_span, "block", "end"),
      );
    } else if (token.kind === "name" && token.text.toLowerCase() === "else") {
      diagnostics.push(
        parseDiag.mismatchedEnd(token.source_span, "if", "else"),
      );
    } else {
      diagnostics.push(unexpected(token));
    }
    advance();
  }

  function arityOf(name: string): number {
    const user = userArities.get(name);
    if (user !== undefined) {
      return user;
    }
    return primitiveArity(name) ?? heritageAliasArity(name) ?? 0;
  }

  /**
   * Is `text` a legal `callable-name` for a parenthesized call (`spec/grammar.md:215`)? **Derived
   * from the same two sets {@link parseNamePrimary} consults** (issue #853), so the primary reader
   * and the parenthesized-call reader cannot drift apart: a word that may not begin an expression is
   * not a callee either, and of the expression-initial keywords only `thing` is a real
   * callable — `true`/`false` are literals and `map`/`filter`/`reduce` open a comprehension, none of
   * which is a `callable-name`. Hand-restating that second list here is the very drift this issue
   * fixed one layer up, so it is computed instead.
   *
   * **This answer is load-bearing for the Heritage `value-of-reader` (issue #830).** Because
   * {@link parseParenthesized} consults it on the head token, `value` answering **false** here is
   * the whole reason `( value of :d for key "a" )` reaches {@link parseValueOfKey} instead of being
   * taken as a `parenthesized-call` on a callee named `value` — the grammar derives the reader
   * inside parentheses (`spec/grammar.md:199,203,213,217`), and returning true for `value` makes
   * that derivation unreachable, which is exactly the `ol-bad-token` defect #830 reported. The
   * false comes from `value` being in {@link NON_PRIMARY_NAMES} via its presence in
   * {@link OL_KEYWORDS} — a property #885 established when it replaced a hand-written list with
   * that derivation, incidentally fixing #830 without naming it.
   *
   * Precisely: what would reopen #830 is dropping `value` from {@link OL_KEYWORDS} (it would leave
   * {@link NON_PRIMARY_NAMES}, and the final clause would then answer true), or special-casing it
   * to true here. Moving it into {@link EXPRESSION_INITIAL_KEYWORDS} would **not** — it would leave
   * {@link NON_PRIMARY_NAMES}, but the final clause negates that same set, so the answer stays
   * false. That edit breaks the *other* rule instead, #853's rejection of a bare `value` in
   * expression position. Both cases are covered: `value-of-key-in-parentheses.test.mjs` and the two
   * `heritage-value-of-key-reader-in-parentheses` conformance fixtures fail on the former, and that
   * test file's bare-`value` case fails on the latter.
   */
  function isCalleeName(text: string): boolean {
    const lower = text.toLowerCase();
    if (NON_PRIMARY_NAMES.has(lower)) {
      return false;
    }
    return lower === "thing" || !EXPRESSION_INITIAL_KEYWORDS.has(lower);
  }

  // --- Expressions ---------------------------------------------------------

  function parseExpression(): ExpressionNode | undefined {
    return parseOr();
  }

  function parseOr(): ExpressionNode | undefined {
    let left = parseAnd();
    if (left === undefined) {
      return undefined;
    }
    for (;;) {
      if (!isName("or")) {
        break;
      }
      const opTok = current();
      advance();
      const right = parseAnd();
      if (right === undefined) {
        diagnostics.push(unexpected(current()));
        break;
      }
      left = ast.call(
        sname("or", opTok),
        [left, right],
        spanBetween(left, right),
      );
    }
    return left;
  }

  function parseAnd(): ExpressionNode | undefined {
    let left = parseComparison();
    if (left === undefined) {
      return undefined;
    }
    for (;;) {
      if (!isName("and")) {
        break;
      }
      const opTok = current();
      advance();
      const right = parseComparison();
      if (right === undefined) {
        diagnostics.push(unexpected(current()));
        break;
      }
      left = ast.call(
        sname("and", opTok),
        [left, right],
        spanBetween(left, right),
      );
    }
    return left;
  }

  function isCompareOp(token: LexToken): boolean {
    return (
      token.kind === "op" &&
      (token.text === "==" ||
        token.text === "!=" ||
        token.text === "<" ||
        token.text === ">" ||
        token.text === "<=" ||
        token.text === ">=")
    );
  }

  function parseComparison(): ExpressionNode | undefined {
    const first = parseAdditive();
    if (first === undefined) {
      return undefined;
    }
    if (isName("is")) {
      return parseIsPredicate(first);
    }
    // A single comparison stays a Call; two or more become one ComparisonChain that stores each
    // operand exactly once, so a side-effecting middle operand is evaluated (and walked) once.
    const operands: ExpressionNode[] = [first];
    const operators: SpannedName[] = [];
    for (;;) {
      const token = current();
      if (!isCompareOp(token)) {
        break;
      }
      advance();
      const right = parseAdditive();
      if (right === undefined) {
        diagnostics.push(unexpected(current()));
        break;
      }
      operators.push(sname(token.text, token));
      operands.push(right);
    }
    if (operators.length === 0) {
      return first;
    }
    const last = operands[operands.length - 1] as ExpressionNode;
    if (operators.length === 1) {
      return ast.call(
        operators[0] as SpannedName,
        [first, last],
        spanBetween(first, last),
      );
    }
    return ast.comparisonChain(operands, operators, spanBetween(first, last));
  }

  function parseIsPredicate(operand: ExpressionNode): ExpressionNode {
    advance(); // consume `is`
    const start = operand.source_span.start;
    const token = current();
    if (token.kind === "name") {
      const lower = token.text.toLowerCase();
      if (lower === "empty") {
        advance();
        return ast.isPredicate(operand, { form: "empty" }, spanToHere(start));
      }
      if (lower === "member") {
        advance();
        if (isName("of")) {
          advance();
        } else {
          diagnostics.push(unexpected(current()));
        }
        const collection = parseAdditive();
        if (collection === undefined) {
          diagnostics.push(unexpected(current()));
          return operand;
        }
        return ast.isPredicate(
          operand,
          { form: "member-of", collection },
          spanToHere(start),
        );
      }
      if (lower === "a") {
        advance();
        const typeTok = current();
        if (typeTok.kind !== "word") {
          diagnostics.push(unexpected(typeTok));
          return operand;
        }
        advance();
        const type = ast.wordLit(typeTok.value, typeTok.source_span);
        return ast.isPredicate(operand, { form: "a", type }, spanToHere(start));
      }
      if (lower === "between" || lower === "strictly") {
        return parseBetween(operand, start, lower === "strictly");
      }
    }
    diagnostics.push(unexpected(token));
    return operand;
  }

  function parseBetween(
    operand: ExpressionNode,
    start: Position,
    strict: boolean,
  ): ExpressionNode {
    advance(); // consume `between` or `strictly`
    if (strict) {
      if (isName("between")) {
        advance();
      } else {
        diagnostics.push(unexpected(current()));
        return operand;
      }
    }
    const low = parseAdditive();
    if (low === undefined) {
      diagnostics.push(unexpected(current()));
      return operand;
    }
    if (isName("and")) {
      advance();
    } else {
      diagnostics.push(unexpected(current()));
      return operand;
    }
    const high = parseAdditive();
    if (high === undefined) {
      diagnostics.push(unexpected(current()));
      return operand;
    }
    return ast.isPredicate(
      operand,
      { form: "between", strict, low, high },
      spanToHere(start),
    );
  }

  function parseAdditive(): ExpressionNode | undefined {
    let left = parseMultiplicative();
    if (left === undefined) {
      return undefined;
    }
    for (;;) {
      const token = current();
      const isAddOp =
        token.kind === "op" && (token.text === "+" || token.text === "-");
      if (!isAddOp) {
        break;
      }
      advance();
      const right = parseMultiplicative();
      if (right === undefined) {
        diagnostics.push(unexpected(current()));
        break;
      }
      left = ast.call(
        sname(token.text, token),
        [left, right],
        spanBetween(left, right),
      );
    }
    return left;
  }

  function parseMultiplicative(): ExpressionNode | undefined {
    let left = parseUnary();
    if (left === undefined) {
      return undefined;
    }
    for (;;) {
      const token = current();
      const isMulOp =
        token.kind === "op" && (token.text === "*" || token.text === "/");
      const isMod = token.kind === "name" && token.text.toLowerCase() === "mod";
      if (!isMulOp && !isMod) {
        break;
      }
      advance();
      const right = parseUnary();
      if (right === undefined) {
        diagnostics.push(unexpected(current()));
        break;
      }
      const opName = isMod ? "mod" : token.text;
      left = ast.call(
        sname(opName, token),
        [left, right],
        spanBetween(left, right),
      );
    }
    return left;
  }

  /**
   * If the current token is a `-` sitting directly against a numeral (no gap), consume both and
   * return the negative numeric literal — a leading `-` is part of the `number` in that position
   * (`spec/grammar.md:17,58`). Returns `undefined` otherwise. Shared by {@link parseUnary} (where a
   * negative literal may lead an expression) and {@link parseKeyTerm} (a selector key is a
   * `number`). A gap (`- 3`, or a block comment between the two) is a stray minus with no left
   * operand, not a negative literal, so the `-`'s end must equal the numeral's start on BOTH line
   * and column — a block comment is whitespace and may span lines (`spec/grammar.md:32`).
   */
  function tryNegativeNumberLiteral(): NumberLitNode | undefined {
    const token = current();
    const after = peek(1);
    const end = token.source_span.end;
    const start = after.source_span.start;
    if (
      token.kind === "op" &&
      token.text === "-" &&
      after.kind === "number" &&
      end[0] === start[0] &&
      end[1] === start[1]
    ) {
      advance();
      const numTok = current();
      advance();
      return ast.numberLit(-Number(numTok.text), spanBetween(token, numTok));
    }
    return undefined;
  }

  function parseUnary(): ExpressionNode | undefined {
    const token = current();
    if (token.kind === "name" && token.text.toLowerCase() === "not") {
      advance();
      const operand = parseUnary();
      if (operand === undefined) {
        diagnostics.push(unexpected(current()));
        return undefined;
      }
      return ast.call(
        sname("not", token),
        [operand],
        spanBetween(token, operand),
      );
    }
    // A negative literal only when `-` sits directly against the numeral (`-3`, `* -2`); with a
    // gap (`- 3`) the leading `-` is a stray minus with no left operand, per grammar.md.
    const negative = tryNegativeNumberLiteral();
    if (negative !== undefined) {
      return negative;
    }
    return parsePostfix();
  }

  /**
   * Is the current token lexically adjacent to the previously consumed token (no gap between
   * them)? A selector `[` binds as a postfix only when it directly follows its place, so
   * `:durations[:i]` is a selector while `map n in :nums [ … ]` keeps `[ … ]` as a separate body.
   * `lastEnd` tracks the end of the last consumed token, so this compares the `[`'s start to it.
   */
  function currentAdjacentToPrev(): boolean {
    const start = current().source_span.start;
    return lastEnd[0] === start[0] && lastEnd[1] === start[1];
  }

  /**
   * Parse one `key-term` inside a selector `[ … ]` (`spec/grammar.md:113`): a `number` (including a
   * negative literal such as `[-1]`), a word literal, a `:name` read, a bare identifier (a *literal
   * word key*, never evaluated — built-in names are valid data here), or a parenthesized
   * expression. Returns `undefined` for anything else so the caller can report the malformed
   * selector.
   */
  function parseKeyTerm(): ExpressionNode | undefined {
    const negative = tryNegativeNumberLiteral();
    if (negative !== undefined) {
      return negative;
    }
    const token = current();
    switch (token.kind) {
      case "number":
        advance();
        return ast.numberLit(Number(token.text), token.source_span);
      case "word":
        advance();
        return ast.wordLit(token.value, token.source_span);
      case "variable":
        advance();
        return ast.varRef(token.value, token.source_span);
      case "name":
        advance();
        return ast.wordLit(token.text, token.source_span);
      case "lparen":
        return parseParenthesized();
      default:
        return undefined;
    }
  }

  /**
   * Collect a place's postfix segments in source order: a dotted `.field` or an adjacent
   * `[ key-term ]` selector, interleaved freely (so `:a.b[1].c` yields field, selector, field).
   * A `[` is only a selector when it is lexically adjacent to what precedes it; a spaced `[`
   * belongs to something else (a list literal, a control body) and ends the chain.
   */
  function collectPostfixSegments(): PlaceSegment[] {
    const segments: PlaceSegment[] = [];
    for (;;) {
      if (current().kind === "dot" && peek(1).kind === "name") {
        const dot = current();
        advance();
        const field = current();
        advance();
        segments.push({
          kind: "field",
          name: sname(field.text, field),
          source_span: makeSpan(
            document,
            dot.source_span.start,
            field.source_span.end,
          ),
        });
        continue;
      }
      if (current().kind === "lbracket" && currentAdjacentToPrev()) {
        const open = current();
        advance();
        const key = parseKeyTerm();
        if (key === undefined) {
          diagnostics.push(unexpected(current()));
          break;
        }
        if (current().kind !== "rbracket") {
          diagnostics.push(parseDiag.unmatchedBracket(open.source_span, "["));
          break;
        }
        const close = current();
        advance();
        segments.push({
          kind: "index",
          key,
          source_span: spanBetween(open, close),
        });
        continue;
      }
      break;
    }
    return segments;
  }

  /**
   * Counts how many redundant bare-grouping `( … )` wrappers `parseParenthesized` stripped
   * around the expression that starts at `innerStart`, by walking the raw token stream forward
   * from `startIndex` (the token `parsePrimary` began consuming from). Its bare-grouping branch
   * never wraps or extends the inner expression's own span, so each stripped level leaves exactly
   * one more leading `lparen` token before reaching `innerStart` — while a callee-form `ParenCall`
   * (e.g. `(first :x)`) already spans its *own* `(`, so `innerStart` equals that very `(` token's
   * position and the scan stops immediately at 0, never double-counting its self-preserved parens
   * (issue #407/F7 follow-up: rubber-duck found a single boolean cannot represent `((1 + 2)).x`'s
   * two stripped levels, and that the same gap let `(:x)` — genuinely parenthesized — wrongly
   * parse as an assignable bare `:x` place).
   */
  function countStrippedGroupingParens(
    startIndex: number,
    innerStart: Position,
  ): number {
    let count = 0;
    let index = startIndex;
    for (;;) {
      const token = tokens[Math.min(index, tokens.length - 1)] as LexToken;
      if (token.kind === "newline") {
        index += 1;
        continue;
      }
      const atInnerStart =
        token.source_span.start[0] === innerStart[0] &&
        token.source_span.start[1] === innerStart[1];
      if (token.kind !== "lparen" || atInnerStart) {
        return count;
      }
      count += 1;
      index += 1;
    }
  }

  function parsePostfix(): ExpressionNode | undefined {
    const primaryStart = current();
    const primaryStartIndex = pos;
    const primary = parsePrimary();
    if (primary === undefined) {
      return undefined;
    }
    // A postfix read `:a.b.c` or `:nums[1]` grows the bare variable into a place; a plain `:a`
    // stays a VarRef. A `[` counts only when adjacent, so a spaced `[ … ]` stays a separate token.
    const hasPostfixAhead =
      (current().kind === "dot" && peek(1).kind === "name") ||
      (current().kind === "lbracket" && currentAdjacentToPrev());
    if (!hasPostfixAhead) {
      return primary;
    }
    const parenGroupCount = countStrippedGroupingParens(
      primaryStartIndex,
      primary.source_span.start,
    );
    // Only a genuinely bare `:name` — never a parenthesized `(:name)` — grows into an assignable
    // Place; `(:x).foo` is a read of `:x`'s own value, not a place chain rooted at `:x` (spec's
    // closed place grammar, `colon-place ::= ":" name { postfix }`, is the bare form only).
    if (primary.kind === "VarRef" && parenGroupCount === 0) {
      const base: SpannedName = {
        name: primary.name,
        source_span: primary.source_span,
      };
      const segments = collectPostfixSegments();
      return ast.place(
        base,
        segments,
        spanToHere(primaryStart.source_span.start),
      );
    }
    // `spec/grammar.md:188` — `postfix-expression ::= primary { selector | "." identifier }` —
    // permits a postfix read after *any* primary, not only a `:name`. A literal-list read
    // (`[1 2][1]`), a dict-literal field read (`{tom: 8}.tom`), a constructor-call-result field
    // read (`(point 0 0).x`), or a parenthesized variable read (`(:x).foo`) all grow their
    // primary into a read-only PostfixExpression. Assignment targets never reach this branch —
    // `set`/`=` parsing builds a `Place` directly from a `:name`/bare-name base without going
    // through `parsePostfix`.
    const segments = collectPostfixSegments();
    return ast.postfixExpression(
      primary,
      segments,
      spanToHere(primaryStart.source_span.start),
      parenGroupCount,
    );
  }

  function parsePrimary(): ExpressionNode | undefined {
    const token = current();
    switch (token.kind) {
      case "number":
        advance();
        return ast.numberLit(Number(token.text), token.source_span);
      case "word":
        advance();
        return ast.wordLit(token.value, token.source_span);
      case "variable":
        advance();
        return ast.varRef(token.value, token.source_span);
      case "lbracket":
        return parseListLiteral();
      case "lbrace":
        return parseDictLiteral();
      case "lparen":
        return parseParenthesized();
      case "name":
        return parseNamePrimary(token);
      case "newline":
      case "eof":
      case "rbracket":
      case "rparen":
      case "rbrace":
        return undefined;
      default:
        advance();
        diagnostics.push(unexpected(token));
        return undefined;
    }
  }

  function parseNamePrimary(token: LexToken): ExpressionNode | undefined {
    const lower = token.text.toLowerCase();
    if (lower === "true") {
      advance();
      return ast.booleanLit(true, token.source_span);
    }
    if (lower === "false") {
      advance();
      return ast.booleanLit(false, token.source_span);
    }
    if (lower === "map" || lower === "filter" || lower === "reduce") {
      return parseComprehension(token, lower);
    }
    if (
      lower === "value" &&
      peek(1).kind === "name" &&
      peek(1).text.toLowerCase() === "of"
    ) {
      return parseValueOfKey(token);
    }
    if (NON_PRIMARY_NAMES.has(lower)) {
      return undefined;
    }
    return parseFixedCall(token);
  }

  /**
   * `value of expression "for" "key" expression` (`spec/grammar.md:217`'s `value-of-reader`), the
   * Heritage dict reader — a read-only equivalent of `dictionary.key`/`dictionary[key]`
   * (`spec/data-structures.md:183-195`). Both the dictionary and the key are full expressions
   * (unlike a selector's narrower `key-term`), so `value of ( f ) for key ( g )` is legal. Only
   * intercepted here when `value` is directly followed by `of` — and that check runs *before*
   * {@link NON_PRIMARY_NAMES}, which is what keeps this Heritage-gated form readable while a bare
   * `value` (never a callable: it is a keyword, `spec/grammar.md:358,371`) is
   * rejected in expression position like every other misplaced keyword (issue #853).
   *
   * The reader is legal **wrapped in parentheses** too — `( value of :d for key "a" )` — because
   * `primary` (`spec/grammar.md:193-204`) offers `parenthesized-expression` (:199) and
   * `value-of-reader` (:203) side by side. That shape arrives here through
   * {@link parseParenthesized}'s fall-through rather than through a `parenthesized-call`; see
   * {@link isCalleeName} for the invariant that keeps it reachable (issue #830).
   */
  function parseValueOfKey(token: LexToken): ExpressionNode | undefined {
    advance(); // "value"
    advance(); // "of"
    const dictionary = requireExpression();
    if (dictionary === undefined) {
      return undefined;
    }
    if (!consumeKeyword("for")) {
      return undefined;
    }
    if (!consumeKeyword("key")) {
      return undefined;
    }
    const key = requireExpression();
    if (key === undefined) {
      return undefined;
    }
    return ast.valueOfKey(
      dictionary,
      key,
      spanFrom(token.source_span.start, key),
    );
  }

  function parseFixedCall(token: LexToken): ExpressionNode {
    advance();
    const arity = arityOf(token.text.toLowerCase());
    const args: ExpressionNode[] = [];
    for (let k = 0; k < arity; k += 1) {
      const arg = parseExpression();
      if (arg === undefined) {
        break;
      }
      args.push(arg);
    }
    const endNode = args.at(-1) ?? token;
    return ast.call(
      sname(token.text, token),
      args,
      spanBetween(token, endNode),
      canonicalOfHeritageAlias(token.text),
    );
  }

  function parseListLiteral(): ExpressionNode {
    const open = current();
    advance();
    const elements: ExpressionNode[] = [];
    for (;;) {
      skipNewlines();
      const token = current();
      if (token.kind === "rbracket") {
        advance();
        return ast.listLit(elements, spanBetween(open, token));
      }
      if (token.kind === "eof") {
        diagnostics.push(parseDiag.unmatchedBracket(open.source_span, "["));
        return ast.listLit(elements, spanBetween(open, token));
      }
      const before = pos;
      const element = parseExpression();
      if (element !== undefined) {
        elements.push(element);
      }
      if (pos === before) {
        diagnostics.push(unexpected(current()));
        advance();
      }
    }
  }

  /**
   * Parse a dictionary literal `{ key: value … }` (`spec/grammar.md`'s `dict-literal ::= "{"
   * { dict-entry } "}"`) — entries are separated only by whitespace/newlines, never commas, so
   * `{ }` (matched, no entries) is a valid empty dict, not an error (`spec/error-model.md`'s
   * `ol-unmatched-brace` fires only for a genuinely unmatched `{`/`}`).
   */
  function parseDictLiteral(): ExpressionNode {
    const open = current();
    advance();
    const entries: DictEntryNode[] = [];
    for (;;) {
      skipNewlines();
      const token = current();
      if (token.kind === "rbrace") {
        advance();
        return ast.dictLit(entries, spanBetween(open, token));
      }
      if (token.kind === "eof") {
        diagnostics.push(parseDiag.unmatchedBrace(open.source_span, "{"));
        return ast.dictLit(entries, spanBetween(open, token));
      }
      const before = pos;
      const entry = parseDictEntry();
      if (entry !== undefined) {
        entries.push(entry);
      }
      if (pos === before) {
        diagnostics.push(unexpected(current()));
        advance();
      }
    }
  }

  /**
   * A dict-entry's `:` with no gap before its value's leading identifier lexes as one
   * `variable` token — the lexer's `:name` rule (`tokens.ts`) has no notion of "dict-entry
   * separator" and greedily reads `:foo` as a variable reference. Since whitespace is
   * insignificant around the separator (`spec/grammar.md`), `{ a:foo }` must parse identically
   * to `{ a: foo }` — a zero-arity call to `foo`, not a `VarRef` — so this splices the glued
   * token back into the real `colon` it opens plus the bare `name` it swallowed, letting the
   * ordinary {@link parseExpression} call read an ordinary name token next.
   */
  function splitGluedColonToken(): void {
    const glued = current();
    const colonStart = glued.source_span.start;
    const colonEnd: Position = [colonStart[0], colonStart[1] + 1];
    const colon: LexToken = {
      kind: "colon",
      text: ":",
      value: "",
      source_span: makeSpan(document, colonStart, colonEnd),
    };
    const name: LexToken = {
      kind: "name",
      text: glued.value,
      value: "",
      source_span: makeSpan(document, colonEnd, glued.source_span.end),
    };
    tokens.splice(pos, 1, colon, name);
  }

  /**
   * Skip a balanced nested literal starting at the current token (assumed to be its own opening
   * delimiter, `{` or `[`), tracking nesting depth so an inner literal of the same kind cannot
   * end the skip early. Shared by {@link skipMalformedDictKeyLiteral} (key position) and
   * {@link unexpectedInDictEntry}'s `lbrace`/`lbracket` cases (separator position) to recover
   * past a well-formed nested dict/list literal that appeared in an illegal `dict-entry` grammar
   * position (`spec/grammar.md`), without misreporting its own, correctly matched delimiters as
   * unmatched.
   */
  function skipBalancedNestedLiteral(
    openKind: LexTokenKind,
    closeKind: LexTokenKind,
  ): void {
    let depth = 1;
    advance();
    while (depth > 0 && current().kind !== "eof") {
      const kind = current().kind;
      if (kind === openKind) {
        depth += 1;
      } else if (kind === closeKind) {
        depth -= 1;
      }
      advance();
    }
  }

  /**
   * Like {@link unexpected}, but for a token found where {@link parseDictEntry} expected a colon
   * or a value. A `}` there is never an unmatched brace: {@link parseDictLiteral}'s own loop is
   * about to consume that very token and close the dict correctly on its next pass (`{ a }` and
   * `{ a: }` both still end up a well-formed, if empty or short, `DictLit`), so this pushes the
   * accurate `ol-bad-token` instead — a colon/value was expected, not a brace — without consuming
   * the `}` so the caller's loop still sees and closes it.
   *
   * A `{` or `[` there is a different malformed shape, at the **separator** position rather than
   * the key position (`print { a { b: 1 } }` — `a` parses as a valid key, but no `:` follows
   * before the nested, itself well-formed and balanced, `{ b: 1 }`; likewise `print { a [1, 2] }`
   * with a nested `[1, 2]`): `spec/data-structures.md`'s malformed-`dict-entry` rule requires
   * exactly one `ol-bad-token` for that inner opening delimiter, never `ol-unmatched-brace`/
   * `ol-unmatched-bracket` for either literal's delimiters — both are, in fact, correctly
   * matched. Falling through to {@link unexpected} would misreport it as unmatched, and leaving
   * it unconsumed would let the caller's loop re-enter {@link parseDictEntry}, which would treat
   * it as a *second*, separately diagnosed malformed key. So this reports the one diagnostic and
   * consumes the whole nested literal itself, reusing {@link skipBalancedNestedLiteral} exactly
   * like the key-position case.
   *
   * Every other token kind defers to {@link unexpected}.
   */
  function unexpectedInDictEntry(token: LexToken): void {
    if (token.kind === "rbrace") {
      diagnostics.push(parseDiag.badToken(token.source_span, token.text));
      return;
    }
    if (token.kind === "lbrace") {
      diagnostics.push(parseDiag.badToken(token.source_span, token.text));
      skipBalancedNestedLiteral("lbrace", "rbrace");
      return;
    }
    if (token.kind === "lbracket") {
      diagnostics.push(parseDiag.badToken(token.source_span, token.text));
      skipBalancedNestedLiteral("lbracket", "rbracket");
      return;
    }
    diagnostics.push(unexpected(token));
  }

  /**
   * A dict-key position accepts only `dict-key ::= identifier | number` (`spec/grammar.md`), so a
   * `{` or `[` opening a nested dict/list literal there is unexpected — but its own delimiters
   * are still balanced, and the enclosing dict literal's braces are unaffected: this is a
   * grammar-position error, not a brace/bracket-matching one (`spec/error-model.md` and
   * `spec/data-structures.md#dictionaries`, issue #520). Reports exactly one `ol-bad-token` for
   * the inner opening delimiter itself (never `ol-unmatched-brace`/`ol-unmatched-bracket`, and
   * never a second diagnostic for anything that follows), then silently recovers by skipping past
   * the whole malformed entry — the balanced nested literal, tracking nesting depth so an inner
   * literal of the same kind cannot end the skip early, plus its trailing `: value` if one
   * follows — so the caller's loop resumes cleanly at the next real dict-entry or the enclosing
   * `}` without cascading into spurious diagnostics for tokens that were never actually
   * malformed.
   */
  function skipMalformedDictKeyLiteral(): void {
    const badToken = current();
    const closeKind: LexTokenKind =
      badToken.kind === "lbrace" ? "rbrace" : "rbracket";
    diagnostics.push(parseDiag.badToken(badToken.source_span, badToken.text));
    skipBalancedNestedLiteral(badToken.kind, closeKind);
    skipNewlines();
    if (current().kind === "variable") {
      splitGluedColonToken();
    }
    if (current().kind === "colon") {
      advance();
      skipNewlines();
      parseExpression();
    }
  }

  /**
   * Parse one `dict-entry ::= dict-key ":" expression` (`spec/grammar.md`). `dict-key` is only
   * `identifier | number` — narrower than {@link parseKeyTerm}'s selector `key-term`, which also
   * accepts `:name` reads, word literals, and parenthesized expressions — because a dict key is
   * always a literal, never evaluated (`spec/data-structures.md:143-171`). A bare identifier
   * reuses {@link WordLitNode} exactly like a bare selector key; built-in names are legal keys
   * for free, since the lexer never special-cases them. Returns `undefined` for anything else so
   * the caller can report the malformed entry.
   */
  function parseDictEntry(): DictEntryNode | undefined {
    const negative = tryNegativeNumberLiteral();
    const token = current();
    let key: WordLitNode | NumberLitNode | undefined = negative;
    if (key === undefined) {
      if (token.kind === "number") {
        advance();
        key = ast.numberLit(Number(token.text), token.source_span);
      } else if (token.kind === "name") {
        advance();
        key = ast.wordLit(token.text, token.source_span);
      } else if (token.kind === "lbrace" || token.kind === "lbracket") {
        skipMalformedDictKeyLiteral();
        return undefined;
      } else {
        return undefined;
      }
    }
    skipNewlines();
    if (current().kind === "variable") {
      splitGluedColonToken();
    }
    if (current().kind !== "colon") {
      unexpectedInDictEntry(current());
      return undefined;
    }
    advance();
    skipNewlines();
    const value = parseExpression();
    if (value === undefined) {
      unexpectedInDictEntry(current());
      return undefined;
    }
    return { key, value, source_span: spanBetween(key, value) };
  }

  function parseParenthesized(): ExpressionNode | undefined {
    const open = current();
    advance();
    skipNewlines();
    const head = current();
    const lower = head.kind === "name" ? head.text.toLowerCase() : "";
    // A parenthesized head that is a callable — including the variadic logic words `and`/`or`,
    // which are not fixed-arity callees elsewhere — gathers every operand up to the `)`.
    //
    // Everything this branch declines falls through to the plain `parenthesized-expression`
    // (`spec/grammar.md:213`) below, which re-enters the full `expression` grammar — and that is
    // how the Heritage `value-of-reader` (:203, defined :217) stays reachable inside parentheses,
    // as `primary` (:193-204) requires (issue #830). `value` is not an `isCalleeName`, so
    // `( value of :d for key "a" )` declines here, reaches `parseExpression()`, and lands in
    // {@link parseNamePrimary}'s `value`-then-`of` interception. Widening this condition to admit
    // a worded reader's head word would swallow the reader and re-open #830.
    if (
      head.kind === "name" &&
      (isCalleeName(head.text) || lower === "and" || lower === "or")
    ) {
      advance();
      const callee =
        lower === "and" || lower === "or"
          ? sname(lower, head)
          : sname(head.text, head);
      const canonical =
        lower === "and" || lower === "or"
          ? undefined
          : canonicalOfHeritageAlias(head.text);
      const args: ExpressionNode[] = [];
      for (;;) {
        skipNewlines();
        const token = current();
        if (token.kind === "rparen") {
          advance();
          return ast.parenCall(
            callee,
            args,
            spanBetween(open, token),
            canonical,
          );
        }
        if (token.kind === "eof") {
          diagnostics.push(parseDiag.unmatchedParen(open.source_span, "("));
          return ast.parenCall(
            callee,
            args,
            spanBetween(open, token),
            canonical,
          );
        }
        const before = pos;
        const arg = parseExpression();
        if (arg !== undefined) {
          args.push(arg);
        }
        if (pos === before) {
          diagnostics.push(unexpected(current()));
          advance();
        }
      }
    }
    const inner = parseExpression();
    skipNewlines();
    if (inner === undefined && current().kind === "rparen") {
      // `( )` closes with no operand for the group — flag it rather than vanishing silently.
      diagnostics.push(
        parseDiag.badToken(current().source_span, current().text),
      );
    }
    if (current().kind === "rparen") {
      advance();
    } else {
      diagnostics.push(parseDiag.unmatchedParen(open.source_span, "("));
    }
    return inner;
  }

  function parseComprehension(
    head: LexToken,
    form: "map" | "filter" | "reduce",
  ): ExpressionNode | undefined {
    advance();
    let accumulator: SpannedName | undefined;
    if (form === "reduce") {
      const accTok = current();
      if (accTok.kind !== "name") {
        diagnostics.push(unexpected(accTok));
        return undefined;
      }
      advance();
      accumulator = sname(accTok.text, accTok);
    }
    let binder: Binder;
    if (current().kind === "lbracket") {
      const destructured = parseDestructuringBinder();
      if (destructured === undefined) {
        return undefined;
      }
      binder = destructured;
    } else {
      const binderTok = current();
      if (binderTok.kind !== "name") {
        diagnostics.push(unexpected(binderTok));
        return undefined;
      }
      advance();
      binder = sname(binderTok.text, binderTok);
    }
    if (!isName("in")) {
      diagnostics.push(unexpected(current()));
      return undefined;
    }
    advance();
    const iterable = parseExpression();
    if (iterable === undefined) {
      diagnostics.push(unexpected(current()));
      return undefined;
    }
    if (form === "reduce") {
      if (!isName("from")) {
        diagnostics.push(unexpected(current()));
        return undefined;
      }
      advance();
      const seed = parseExpression();
      if (seed === undefined) {
        diagnostics.push(unexpected(current()));
        return undefined;
      }
      if (current().kind !== "lbracket") {
        diagnostics.push(parseDiag.missingEnd(head.source_span, form));
        return undefined;
      }
      const body = parseBracketBlock();
      return ast.reduce(
        {
          accumulator: accumulator as SpannedName,
          binder,
          iterable,
          initial: seed,
          body,
        },
        spanFrom(head.source_span.start, body),
      );
    }
    if (current().kind !== "lbracket") {
      diagnostics.push(parseDiag.missingEnd(head.source_span, form));
      return undefined;
    }
    const body = parseBracketBlock();
    return ast.mapFilter(
      form,
      binder,
      iterable,
      body,
      spanFrom(head.source_span.start, body),
    );
  }

  // --- Blocks --------------------------------------------------------------

  function parseBracketBlock(): BlockNode {
    const open = current();
    advance();
    const body: StatementNode[] = [];
    for (;;) {
      skipNewlines();
      const token = current();
      if (token.kind === "rbracket") {
        advance();
        return ast.block(body, spanBetween(open, token));
      }
      if (token.kind === "eof") {
        diagnostics.push(parseDiag.unmatchedBracket(open.source_span, "["));
        return ast.block(body, spanBetween(open, token));
      }
      const before = pos;
      const statement = parseStatement();
      if (statement !== undefined) {
        body.push(statement);
      }
      if (pos === before) {
        resync();
      }
    }
  }

  function parseLongBlock(opener: string, headerSpan: SourceSpan): BlockNode {
    skipNewlines();
    const bodyStart = current().source_span.start;
    const body: StatementNode[] = [];
    for (;;) {
      skipNewlines();
      const token = current();
      if (token.kind === "eof") {
        diagnostics.push(parseDiag.missingEnd(headerSpan, opener));
        break;
      }
      if (token.kind === "name" && token.text.toLowerCase() === "end") {
        advance();
        consumeEndLabel(opener);
        break;
      }
      const before = pos;
      const diagsBefore = diagnostics.length;
      const statement = parseStatement();
      if (statement !== undefined) {
        body.push(statement);
        requireTerminator(diagsBefore);
      } else if (pos === before) {
        resync();
      }
    }
    return ast.block(body, spanToHere(bodyStart));
  }

  function parseControlBody(
    opener: string,
    headerSpan: SourceSpan,
  ): BlockNode | undefined {
    const token = current();
    if (token.kind === "lbracket") {
      return parseBracketBlock();
    }
    if (token.kind === "newline") {
      return parseLongBlock(opener, headerSpan);
    }
    diagnostics.push(parseDiag.missingEnd(headerSpan, opener));
    return undefined;
  }

  // --- Statements ----------------------------------------------------------

  /**
   * Re-wraps a fully-parenthesized assignment target — `(:x)`, `(:x.a)`, `((:x))`, `(first :x)` —
   * into the zero-selector `PostfixExpression` shape `parsePostfix` builds for every other
   * parenthesized read (issue #407/F7), so the semantic checker flags it with `ol-not-a-place`
   * (spec/tooling.md:187, "reject … parenthesized expressions as targets") instead of the blunt
   * parse `ol-bad-token` that discarding the grouping (`parseParenthesized`) would otherwise leave
   * (issue #442/F3). `parseParenthesized` strips the grouping parens, so a `(:x)` target parses to
   * the same bare `VarRef`/`Place` an assignable `:x` does; `countStrippedGroupingParens` recovers
   * how many grouping levels the source wrapped `expr` in — always ≥1 here, since a genuinely bare
   * `:name` before `=` is pre-routed by `colonAssignmentAhead()` and a bare `name`/`(` `set` target
   * is handled before this helper is reached. Any already-non-place kind (a reporter `ParenCall`, a
   * literal) is passed through unchanged.
   */
  function asNonPlaceTarget(
    expr: ExpressionNode,
    groupStartIndex: number,
    groupStartToken: LexToken,
  ): ExpressionNode {
    if (expr.kind === "VarRef" || expr.kind === "Place") {
      return ast.postfixExpression(
        expr,
        [],
        spanToHere(groupStartToken.source_span.start),
        countStrippedGroupingParens(groupStartIndex, expr.source_span.start),
      );
    }
    return expr;
  }

  function parseStatement(): StatementNode | undefined {
    const token = current();
    if (colonAssignmentAhead()) {
      return parseColonAssignment();
    }
    if (
      token.kind === "lparen" &&
      peek(1).kind === "name" &&
      peek(1).text.toLowerCase() === "local"
    ) {
      return parseParenLocal();
    }
    if (token.kind === "name") {
      switch (token.text.toLowerCase()) {
        case "set":
          return parseSetAssignment();
        case "make":
          return parseMakeAssignment();
        case "local":
          return parseLocal();
        case "if":
          return parseIf();
        case "while":
          return parseWhile();
        case "repeat":
          return parseRepeat();
        case "forever":
          return parseForever();
        case "for":
          return parseFor();
        case "define":
          return parseProcedureDef("define");
        case "to":
          // `to` is a keyword with three non-procedure roles: the `set … to` and `for … from … to`
          // prepositions (`spec/grammar.md:380`) and the Data `add … to <list>` preposition
          // (`spec/grammar.md:115`). It opens a Heritage procedure ONLY when a name follows it (`to <name> …`); anything
          // else — including a `to` reached during error recovery of a malformed `set :x to 100` —
          // is not a definition, so fall through to the generic token handling that already
          // reports it, rather than mis-entering `parseProcedureDef` and cascading a spurious
          // diagnostic on the token after `to`.
          if (peek(1).kind === "name") {
            return parseProcedureDef("to");
          }
          break;
        case "return":
          return parseReturn("return");
        case "output":
          return parseReturn("output");
        case "op":
          return parseReturn("op");
        case "stop":
          return parseStop();
        case "throw":
          return parseThrow();
        case "add":
          return parseAdd();
        case "remove":
          return parseRemove();
        case "insert":
          return parseInsert();
        case "clear":
          return parseClear();
        case "struct":
          return parseStructDef();
        default:
          break;
      }
      // A registered profile head becomes a profile statement (`ask`/`each`/`tell`, the four event
      // heads) — the seam every M5 profile grammar slice hangs off. But a *user-declared* callable
      // of the same spelling wins here and parses as an ordinary Core call, because the reader is
      // profile-blind: it never inspects the active profile set, so it cannot ask whether the word
      // is a profile head "right now". Since issue #841 the checker raises `ol-reserved-word` on
      // that declaration whatever the profile set (`spec/grammar.md:408`), so the program is not
      // legal — but it must still be SHAPED as the learner wrote it, or the diagnostic would land
      // on the wrong node. Without this guard the reader would mis-shape ordinary code that shadows
      // one of these heads (see
      // `tests/conformance/educational/meta-commands/hint-in-procedure-falls-back-to-program`).
      const lowerHead = token.text.toLowerCase();
      const profileForm = PROFILE_STATEMENT_FORMS.get(lowerHead);
      if (profileForm !== undefined && !userArities.has(lowerHead)) {
        return parseProfileStatement(profileForm);
      }
    }
    const targetStartIndex = pos;
    const targetStartToken = current();
    const expr = parseExpression();
    // A reporter/call, a bare literal, or a parenthesized expression used as an assignment target —
    // `first :x = 5`, `count :nums = 3`, `3 = 5`, `[1 2][1] = 5`, `(:x) = 2` — is not a place.
    // Recognize the structure here so the semantic checker can flag it with `ol-not-a-place`
    // (spec/tooling.md:187, :213-219) instead of a blunt parse error; `=` is the only op that
    // survives to this fall-through, so a bare `text === "="` guard is sufficient. A genuinely bare
    // `:name` never reaches this fall-through before `=` (it is always routed through
    // `colonAssignmentAhead()`/`parseColonAssignment()` into a proper `Place`), so a `VarRef`/`Place`
    // here before `=` is necessarily a *parenthesized* one (`(:x)`/`(:x.a)`), which
    // `parseParenthesized` stripped to a bare kind; {@link asNonPlaceTarget} re-wraps it into the
    // `PostfixExpression` (issue #407/F7) read shape a valid place can never take. Other kinds pass
    // through and are matched directly by `isNonPlaceTarget` below.
    if (expr === undefined) {
      return undefined;
    }
    const target =
      (expr.kind === "VarRef" || expr.kind === "Place") &&
      current().text === "="
        ? asNonPlaceTarget(expr, targetStartIndex, targetStartToken)
        : expr;
    const isNonPlaceTarget =
      target.kind === "Call" ||
      target.kind === "ParenCall" ||
      target.kind === "NumberLit" ||
      target.kind === "WordLit" ||
      target.kind === "BooleanLit" ||
      target.kind === "ListLit" ||
      target.kind === "PostfixExpression";
    if (isNonPlaceTarget && current().text === "=") {
      advance();
      const value = parseExpression();
      if (value === undefined) {
        diagnostics.push(unexpected(current()));
        return target;
      }
      return ast.assign(
        target,
        value,
        "equals",
        spanFrom(target.source_span.start, value),
      );
    }
    return target;
  }

  /**
   * Parse a registered profile statement form — the shared machinery every profile block-head
   * (`ask`/`each`, `when`/`every`/`on_key`/`on_click`) and bodyless mode-switch command (`tell`)
   * flows through (`spec/grammar.md#profile-grammar-extensions`). The head keyword has already been
   * matched in {@link parseStatement}; `form` is its {@link PROFILE_STATEMENT_FORMS} descriptor.
   *
   * Each `argCount` argument is a Core `expression`; the block-tail (`hasBlock`) is the Core
   * bracket-or-`… end` block reused via {@link parseControlBody}, so `end` and a matching
   * `end <keyword>` both close it and a mismatched label (`ask` closed by `end each`) raises
   * `ol-mismatched-end` — see {@link consumeEndLabel} and the profile labels added to
   * {@link END_LABELS}. The head word is recorded as the node's {@link SpannedName} keyword so the
   * checker can gate the form on the active profile set and point diagnostics at it.
   */
  function parseProfileStatement(
    form: ProfileStatementForm,
  ): StatementNode | undefined {
    const headTok = current();
    const keyword: SpannedName = {
      name: headTok.text.toLowerCase(),
      source_span: headTok.source_span,
    };
    advance();
    const args: ExpressionNode[] = [];
    for (let i = 0; i < form.argCount; i += 1) {
      const arg = parseExpression();
      if (arg === undefined) {
        diagnostics.push(unexpected(current()));
        return undefined;
      }
      args.push(arg);
    }
    if (!form.hasBlock) {
      return ast.profileStatement(
        keyword,
        args,
        undefined,
        spanToHere(headTok.source_span.start),
      );
    }
    const body = parseControlBody(keyword.name, headTok.source_span);
    if (body === undefined) {
      return undefined;
    }
    return ast.profileStatement(
      keyword,
      args,
      body,
      spanToHere(headTok.source_span.start),
    );
  }

  function parseLocal(): StatementNode | undefined {
    const localTok = current();
    advance();
    const nameTok = current();
    if (nameTok.kind !== "name") {
      diagnostics.push(unexpected(nameTok));
      return undefined;
    }
    advance();
    return ast.local(
      [sname(nameTok.text, nameTok)],
      spanToHere(localTok.source_span.start),
    );
  }

  function parseParenLocal(): StatementNode | undefined {
    const open = current();
    advance();
    advance();
    const names: SpannedName[] = [];
    while (current().kind === "name") {
      const token = current();
      advance();
      names.push(sname(token.text, token));
    }
    if (names.length === 0) {
      diagnostics.push(
        parseDiag.badToken(current().source_span, current().text),
      );
    }
    if (current().kind === "rparen") {
      advance();
    } else {
      diagnostics.push(parseDiag.unmatchedParen(open.source_span, "("));
    }
    return ast.local(names, spanToHere(open.source_span.start));
  }

  function parseColonAssignment(): StatementNode | undefined {
    const varTok = current();
    advance();
    const base = sname(varTok.value, varTok);
    const segments = collectPostfixSegments();
    const place = ast.place(
      base,
      segments,
      spanToHere(varTok.source_span.start),
    );
    advance();
    const value = parseExpression();
    if (value === undefined) {
      diagnostics.push(unexpected(current()));
      return undefined;
    }
    return ast.assign(
      place,
      value,
      "equals",
      spanFrom(varTok.source_span.start, value),
    );
  }

  function parseSetAssignment(): StatementNode | undefined {
    const setTok = current();
    advance();
    const target = parseSetTarget();
    if (target === undefined) {
      return undefined;
    }
    if (!isName("to")) {
      diagnostics.push(unexpected(current()));
      return undefined;
    }
    advance();
    const value = parseExpression();
    if (value === undefined) {
      diagnostics.push(unexpected(current()));
      return undefined;
    }
    return ast.assign(
      target,
      value,
      "set",
      spanFrom(setTok.source_span.start, value),
    );
  }

  /**
   * Parses the Heritage assignment spelling `make "name" value`
   * (`make-assignment ::= "make" word-literal expression`, `spec/grammar.md:105`). `make` is a
   * Heritage-profile *alternate spelling only* with no new semantics
   * (`spec/conformance.md:270`), so it lowers to the exact same {@link AssignNode} shape as
   * `set … to`: the word literal's value becomes the base name of a zero-segment {@link PlaceNode}
   * — identical to how `set name to …` builds its bare place — and the runtime's shared
   * `executeAssign` binds it (mutate nearest binding, else create global,
   * `spec/execution-model.md:318`) with no dependence on the surface `form`.
   *
   * The target must be a `word-literal` (`"name"`, lexed as a `word` token); any other token there
   * is a parse error via {@link unexpected}, with the offending token left unconsumed so statement
   * recovery re-parses it. Profile-legality (`make` requires the Heritage profile) is deliberately
   * *not* decided here — the reader has no notion of an active profile (that is the Layer-2
   * checker's job, `spec/tooling.md:175-176`); the Heritage form-head gate is owned by issue #667.
   */
  function parseMakeAssignment(): StatementNode | undefined {
    const makeTok = current();
    advance();
    const nameTok = current();
    if (nameTok.kind !== "word") {
      // The word-literal target is missing. If the lexer already reported an unclosed string
      // starting after `make` (e.g. `make "size`), that diagnostic *is* the missing target and
      // consumed the rest of the line, so an extra `ol-bad-token` would be a redundant cascade —
      // `spec/error-model.md:109` reserves `ol-bad-token` for when no more-specific diagnostic
      // applies. Suppress it there; a genuinely wrong token (`make 5`) or a bare `make` still
      // reports normally.
      if (!lexDiagnosticInGap(makeTok, nameTok)) {
        diagnostics.push(unexpected(nameTok));
      }
      return undefined;
    }
    advance();
    const place = ast.place(
      sname(nameTok.value, nameTok),
      [],
      nameTok.source_span,
    );
    const value = parseExpression();
    if (value === undefined) {
      diagnostics.push(unexpected(current()));
      return undefined;
    }
    return ast.assign(
      place,
      value,
      "make",
      spanFrom(makeTok.source_span.start, value),
    );
  }

  /**
   * Parses the target of a `set … to` assignment. The spec's
   * `set-assignment ::= "set" bare-place "to" expression` (spec/grammar.md:104) requires a
   * *bare* place — a `name` optionally postfixed — which is the one well-formed, assignable case.
   * A parenthesized target (`set (:x) to …`, `set (first :x) to …`) is not a place; like the
   * `<place> = <value>` form it is recognized structurally and re-wrapped by
   * {@link asNonPlaceTarget} (issue #442/F3) so the semantic checker reports `ol-not-a-place`
   * (spec/tooling.md:187) rather than a blunt parse error. Anything else — a colon-place `set :x`
   * (issue #55), a literal `set 5` — is left to the parse `ol-bad-token` the bare-place grammar
   * demands, with the offending token unconsumed so statement recovery re-parses it.
   */
  function parseSetTarget(): ExpressionNode | undefined {
    const targetStartIndex = pos;
    const targetStartToken = current();
    if (targetStartToken.kind === "name") {
      advance();
      const segments = collectPostfixSegments();
      return ast.place(
        sname(targetStartToken.text, targetStartToken),
        segments,
        spanToHere(targetStartToken.source_span.start),
      );
    }
    if (targetStartToken.kind === "lparen") {
      const parsed = parseExpression();
      if (parsed === undefined) {
        return undefined;
      }
      return asNonPlaceTarget(parsed, targetStartIndex, targetStartToken);
    }
    diagnostics.push(unexpected(targetStartToken));
    return undefined;
  }

  function parseIf(): StatementNode | undefined {
    const ifTok = current();
    advance();
    const condition = parseExpression();
    if (condition === undefined) {
      diagnostics.push(unexpected(current()));
      return undefined;
    }
    const tail = current();
    if (tail.kind === "lbracket") {
      const thenBody = parseBracketBlock();
      let elseBody: BlockNode | undefined;
      const save = pos;
      skipNewlines();
      if (isName("else")) {
        advance();
        skipNewlines();
        if (current().kind === "lbracket") {
          elseBody = parseBracketBlock();
        } else {
          diagnostics.push(unexpected(current()));
        }
      } else {
        pos = save;
      }
      const span = spanToHere(ifTok.source_span.start);
      return ast.ifStmt(condition, thenBody, elseBody, span);
    }
    if (tail.kind === "newline") {
      skipNewlines();
      const thenStart = current().source_span.start;
      const thenStmts: StatementNode[] = [];
      for (;;) {
        skipNewlines();
        const token = current();
        if (token.kind === "eof") {
          diagnostics.push(parseDiag.missingEnd(ifTok.source_span, "if"));
          break;
        }
        if (isName("else")) {
          break;
        }
        if (token.kind === "name" && token.text.toLowerCase() === "end") {
          advance();
          consumeEndLabel("if");
          break;
        }
        const before = pos;
        const diagsBefore = diagnostics.length;
        const statement = parseStatement();
        if (statement !== undefined) {
          thenStmts.push(statement);
          requireTerminator(diagsBefore);
        } else if (pos === before) {
          resync();
        }
      }
      const thenBody = ast.block(thenStmts, spanToHere(thenStart));
      let elseBody: BlockNode | undefined;
      if (isName("else")) {
        advance();
        skipNewlines();
        const elseStart = current().source_span.start;
        const elseStmts: StatementNode[] = [];
        for (;;) {
          skipNewlines();
          const token = current();
          if (token.kind === "eof") {
            diagnostics.push(parseDiag.missingEnd(ifTok.source_span, "if"));
            break;
          }
          if (token.kind === "name" && token.text.toLowerCase() === "end") {
            advance();
            consumeEndLabel("if");
            break;
          }
          const before = pos;
          const diagsBefore = diagnostics.length;
          const statement = parseStatement();
          if (statement !== undefined) {
            elseStmts.push(statement);
            requireTerminator(diagsBefore);
          } else if (pos === before) {
            resync();
          }
        }
        elseBody = ast.block(elseStmts, spanToHere(elseStart));
      }
      const span = spanToHere(ifTok.source_span.start);
      return ast.ifStmt(condition, thenBody, elseBody, span);
    }
    diagnostics.push(parseDiag.missingEnd(ifTok.source_span, "if"));
    return undefined;
  }

  function parseWhile(): StatementNode | undefined {
    const token = current();
    advance();
    const condition = parseExpression();
    if (condition === undefined) {
      diagnostics.push(unexpected(current()));
      return undefined;
    }
    const body = parseControlBody("while", token.source_span);
    if (body === undefined) {
      return undefined;
    }
    return ast.whileStmt(condition, body, spanToHere(token.source_span.start));
  }

  function parseRepeat(): StatementNode | undefined {
    const token = current();
    advance();
    const count = parseExpression();
    if (count === undefined) {
      diagnostics.push(unexpected(current()));
      return undefined;
    }
    const body = parseControlBody("repeat", token.source_span);
    if (body === undefined) {
      return undefined;
    }
    return ast.repeat(count, body, spanToHere(token.source_span.start));
  }

  function parseForever(): StatementNode | undefined {
    const token = current();
    advance();
    const body = parseControlBody("forever", token.source_span);
    if (body === undefined) {
      return undefined;
    }
    return ast.forever(body, spanToHere(token.source_span.start));
  }

  /**
   * A destructuring `for` binder: `"[" ":" name { ":" name } "]"` (`spec/grammar.md:136-137`).
   * Only `for … in` accepts this form — `for … from … to …` keeps its single bare-name variable.
   */
  function parseDestructuringBinder(): DestructuringBinderNode | undefined {
    const open = current();
    advance();
    const names: SpannedName[] = [];
    while (current().kind === "variable") {
      const token = current();
      advance();
      names.push(sname(token.value, token));
    }
    if (names.length === 0) {
      diagnostics.push(unexpected(current()));
      // Consume a stray closing bracket (e.g. `for []`) so error recovery
      // doesn't re-diagnose the same `]` a second time as an unmatched top-
      // level token.
      if (current().kind === "rbracket") {
        advance();
      }
      return undefined;
    }
    if (current().kind !== "rbracket") {
      diagnostics.push(parseDiag.unmatchedBracket(open.source_span, "["));
      return undefined;
    }
    const close = current();
    advance();
    return ast.destructuringBinder(names, spanBetween(open, close));
  }

  function parseFor(): StatementNode | undefined {
    const forTok = current();
    advance();
    if (current().kind === "lbracket") {
      const binder = parseDestructuringBinder();
      if (binder === undefined) {
        return undefined;
      }
      if (!isName("in")) {
        diagnostics.push(unexpected(current()));
        return undefined;
      }
      advance();
      const iterable = parseExpression();
      if (iterable === undefined) {
        diagnostics.push(unexpected(current()));
        return undefined;
      }
      const body = parseControlBody("for", forTok.source_span);
      if (body === undefined) {
        return undefined;
      }
      const span = spanToHere(forTok.source_span.start);
      return ast.forIn(binder, iterable, body, span);
    }
    const nameTok = current();
    if (nameTok.kind !== "name") {
      diagnostics.push(unexpected(nameTok));
      return undefined;
    }
    advance();
    const variable = sname(nameTok.text, nameTok);
    if (isName("in")) {
      advance();
      const iterable = parseExpression();
      if (iterable === undefined) {
        diagnostics.push(unexpected(current()));
        return undefined;
      }
      const body = parseControlBody("for", forTok.source_span);
      if (body === undefined) {
        return undefined;
      }
      const span = spanToHere(forTok.source_span.start);
      return ast.forIn(variable, iterable, body, span);
    }
    if (isName("from")) {
      advance();
      const from = parseExpression();
      if (from === undefined) {
        diagnostics.push(unexpected(current()));
        return undefined;
      }
      if (!isName("to")) {
        diagnostics.push(unexpected(current()));
        return undefined;
      }
      advance();
      const to = parseExpression();
      if (to === undefined) {
        diagnostics.push(unexpected(current()));
        return undefined;
      }
      let by: ExpressionNode | undefined;
      if (isName("by")) {
        advance();
        const step = parseExpression();
        if (step === undefined) {
          diagnostics.push(unexpected(current()));
          return undefined;
        }
        by = step;
      }
      const body = parseControlBody("for", forTok.source_span);
      if (body === undefined) {
        return undefined;
      }
      const span = spanToHere(forTok.source_span.start);
      return ast.forRange(variable, from, to, by, body, span);
    }
    diagnostics.push(unexpected(current()));
    return undefined;
  }

  /**
   * Parse a procedure definition: Core `define name :params… <body> end`
   * (`define-statement`, `spec/grammar.md:145`) or the Heritage alternate spelling
   * `to name :params… <body> end` (`to-statement`, `spec/grammar.md:146`). Both share the identical
   * grammar after the opener keyword and the same `define-end ::= "end" [ "define" ]` closer
   * (`spec/grammar.md:147`, `spec/style.md:287` — a `to` body closes with `end` or `end define`,
   * never `end to`), so `to` reuses this whole function and every diagnostic label ("define"): the
   * only difference is the {@link ProcedureDefNode} `keyword` recorded, which the Layer-2 Heritage
   * form-head gate (issue #667) consults to reject `to` when the Heritage profile is inactive. `to`
   * reaches here only as a *statement opener*; its other reserved-word roles (`set … to`,
   * `for … from … to`) consume the word inside those parsers and never dispatch here.
   */
  function parseProcedureDef(
    keyword: ProcedureDefNode["keyword"],
  ): StatementNode | undefined {
    const defTok = current();
    advance();
    const nameTok = current();
    if (nameTok.kind !== "name") {
      diagnostics.push(unexpected(nameTok));
      return undefined;
    }
    advance();
    const name = sname(nameTok.text, nameTok);
    const params: ProcedureParam[] = [];
    for (;;) {
      const param = current();
      if (param.kind !== "variable") {
        break;
      }
      advance();
      params.push({ name: sname(param.value, param) });
    }
    for (;;) {
      const open = current();
      if (open.kind !== "lparen" || peek(1).kind !== "variable") {
        break;
      }
      advance();
      const nameParam = current();
      advance();
      const defaultValue = parseExpression();
      if (defaultValue === undefined) {
        // `define f (:x)` — an optional parameter must carry a default; flag the missing value.
        diagnostics.push(
          parseDiag.badToken(current().source_span, current().text),
        );
      }
      if (current().kind === "rparen") {
        advance();
      } else {
        diagnostics.push(parseDiag.unmatchedParen(open.source_span, "("));
      }
      if (defaultValue === undefined) {
        params.push({ name: sname(nameParam.value, nameParam) });
      } else {
        params.push({ name: sname(nameParam.value, nameParam), defaultValue });
      }
    }
    if (current().kind !== "newline") {
      diagnostics.push(parseDiag.missingEnd(defTok.source_span, "define"));
      return undefined;
    }
    const body = parseLongBlock("define", defTok.source_span);
    const span = spanToHere(defTok.source_span.start);
    return ast.procedureDef(keyword, name, params, body, span);
  }

  /**
   * Parse a return statement: Core `return value` or the Heritage alternate spellings
   * `output value` / `op value` (`return-statement`, `spec/grammar.md:150`). All three share the
   * identical grammar and lower to the same {@link ReturnNode}; `keyword` records the surface word
   * only so the Layer-2 Heritage form-head gate (issue #667) can reject `output`/`op` when the
   * Heritage profile is inactive.
   */
  function parseReturn(
    keyword: ReturnNode["keyword"],
  ): StatementNode | undefined {
    const token = current();
    advance();
    const value = parseExpression();
    if (value === undefined) {
      diagnostics.push(unexpected(current()));
      return undefined;
    }
    return ast.returnStmt(
      keyword,
      value,
      spanFrom(token.source_span.start, value),
    );
  }

  function parseStop(): StatementNode | undefined {
    const token = current();
    advance();
    return ast.stop(token.source_span);
  }

  function parseThrow(): StatementNode | undefined {
    const token = current();
    advance();
    const value = parseExpression();
    if (value === undefined) {
      diagnostics.push(unexpected(current()));
      return undefined;
    }
    return ast.throwStmt(value, spanFrom(token.source_span.start, value));
  }

  /**
   * Parse a required expression, reporting the offending token when none is present. Shared by the
   * list-mutator statements below, whose operands (`spec/grammar.md:113-117`) are all required.
   */
  function requireExpression(): ExpressionNode | undefined {
    const expr = parseExpression();
    if (expr === undefined) {
      diagnostics.push(unexpected(current()));
    }
    return expr;
  }

  /**
   * Consume the contextual keyword `word` (`to`/`from`/`in`/`at`) if it is next, reporting the
   * offending token and leaving the cursor put otherwise. The list-mutator separators are keywords
   * only in these statement forms, so they are matched by surface spelling, not a token kind.
   */
  function consumeKeyword(word: string): boolean {
    if (!isName(word)) {
      diagnostics.push(unexpected(current()));
      return false;
    }
    advance();
    return true;
  }

  /** `add expression "to" expression` (`spec/grammar.md:113`, Data profile). */
  function parseAdd(): StatementNode | undefined {
    const token = current();
    advance();
    const value = requireExpression();
    if (value === undefined) {
      return undefined;
    }
    if (!consumeKeyword("to")) {
      return undefined;
    }
    const target = requireExpression();
    if (target === undefined) {
      return undefined;
    }
    return ast.add(value, target, spanFrom(token.source_span.start, target));
  }

  /**
   * `remove expression "from" expression` (`spec/grammar.md:114`) or, when `key` follows `remove`,
   * the distinct `remove "key" key-term "from" expression` (`spec/grammar.md:115`). Both are Data
   * profile.
   */
  function parseRemove(): StatementNode | undefined {
    const token = current();
    advance();
    if (isName("key")) {
      advance();
      const key = parseKeyTerm();
      if (key === undefined) {
        diagnostics.push(unexpected(current()));
        return undefined;
      }
      if (!consumeKeyword("from")) {
        return undefined;
      }
      const target = requireExpression();
      if (target === undefined) {
        return undefined;
      }
      return ast.removeKey(
        key,
        target,
        spanFrom(token.source_span.start, target),
      );
    }
    const value = requireExpression();
    if (value === undefined) {
      return undefined;
    }
    if (!consumeKeyword("from")) {
      return undefined;
    }
    const target = requireExpression();
    if (target === undefined) {
      return undefined;
    }
    return ast.remove(value, target, spanFrom(token.source_span.start, target));
  }

  /** `insert expression "in" expression "at" expression` (`spec/grammar.md:116`, Data profile). */
  function parseInsert(): StatementNode | undefined {
    const token = current();
    advance();
    const value = requireExpression();
    if (value === undefined) {
      return undefined;
    }
    if (!consumeKeyword("in")) {
      return undefined;
    }
    const target = requireExpression();
    if (target === undefined) {
      return undefined;
    }
    if (!consumeKeyword("at")) {
      return undefined;
    }
    const index = requireExpression();
    if (index === undefined) {
      return undefined;
    }
    return ast.insert(
      value,
      target,
      index,
      spanFrom(token.source_span.start, index),
    );
  }

  /** `clear expression` (`spec/grammar.md:117`, Data profile). */
  function parseClear(): StatementNode | undefined {
    const token = current();
    advance();
    const target = requireExpression();
    if (target === undefined) {
      return undefined;
    }
    return ast.clear(target, spanFrom(token.source_span.start, target));
  }

  /**
   * `struct type-name "[" identifier { identifier } "]"` (`spec/grammar.md:155-156`, Data profile).
   * Declares a record type, its fixed fields, and a same-named constructor. The bracketed field
   * list is not a list literal: it holds bare field names that perform no evaluation
   * (`spec/data-structures.md:264`), so the fields are carried as {@link SpannedName} metadata, the
   * same shape as procedure parameter and destructuring-binder names. Grammar/AST only — the
   * constructor call and field access/mutation land in a later Data-profile slice.
   */
  function parseStructDef(): StatementNode | undefined {
    const structTok = current();
    advance();
    const nameTok = current();
    if (nameTok.kind !== "name") {
      diagnostics.push(unexpected(nameTok));
      return undefined;
    }
    advance();
    const name = sname(nameTok.text, nameTok);
    const open = current();
    if (open.kind !== "lbracket") {
      diagnostics.push(unexpected(open));
      return undefined;
    }
    advance();
    const fields: SpannedName[] = [];
    while (current().kind === "name") {
      const fieldTok = current();
      advance();
      fields.push(sname(fieldTok.text, fieldTok));
    }
    const closer = current();
    if (closer.kind === "rbracket") {
      advance();
      if (fields.length === 0) {
        // `struct point [ ]`: both brackets are present and matched, so the `]` is not itself
        // unmatched — the field list is simply empty where at least one field name was
        // required. Flag the stray closer as an `ol-bad-token`, mirroring how an empty group
        // `( )` reports its matched `)` (see `parseParenthesized`). Consuming it above keeps
        // recovery from re-diagnosing the same bracket as a stray top-level token.
        diagnostics.push(parseDiag.badToken(closer.source_span, closer.text));
        return undefined;
      }
      return ast.structDef(
        name,
        fields,
        spanToHere(structTok.source_span.start),
      );
    }
    if (closer.kind === "newline" || closer.kind === "eof") {
      // The field list was opened but never closed before the statement ended: the opening `[`
      // is the genuinely unmatched bracket (`spec/error-model.md:102`).
      diagnostics.push(parseDiag.unmatchedBracket(open.source_span, "["));
      return undefined;
    }
    // A non-identifier token (e.g. a number) interrupts the field list. Both brackets are
    // present, so the problem is the stray token, not the bracket: report it as `ol-bad-token`
    // at that token, then recover by skipping the balanced remainder up to and including the
    // field list's own `]`. Tracking bracket depth means a nested `[ … ]` inside the garbage
    // cannot end recovery early at the wrong `]` and leak a spurious second diagnostic.
    diagnostics.push(unexpected(closer));
    let depth = 1;
    while (
      depth > 0 &&
      current().kind !== "newline" &&
      current().kind !== "eof"
    ) {
      const kind = current().kind;
      if (kind === "lbracket") {
        depth += 1;
      } else if (kind === "rbracket") {
        depth -= 1;
      }
      advance();
    }
    return undefined;
  }

  function parseProgram(): ProgramNode {
    const body: StatementNode[] = [];
    for (;;) {
      skipNewlines();
      if (current().kind === "eof") {
        break;
      }
      const before = pos;
      const diagsBefore = diagnostics.length;
      const statement = parseStatement();
      if (statement !== undefined) {
        body.push(statement);
        requireTerminator(diagsBefore);
      } else if (pos === before) {
        resync();
      }
    }
    return ast.program(body, spanFrom([1, 1], eofToken));
  }

  const program = parseProgram();
  return { ast: program, diagnostics: dedupeDiagnostics(diagnostics) };
}

/**
 * Error-recovery in a few places (e.g. `is member` missing `of`, then falling through into a
 * failed collection parse; `set :x to …`'s bad-token recovery) can independently push two
 * diagnostics for the very same finding. Collapse any diagnostic whose `(code, source_span,
 * params)` triple is byte-identical to an earlier one, keeping the FIRST occurrence and the
 * original order. `message` is deliberately excluded from the identity key — it is derived
 * prose, not part of a diagnostic's identity. Diagnostics at a *different* span (e.g.
 * `print 1, 2`'s two `ol-bad-token` findings) are distinct findings and both survive.
 */
function dedupeDiagnostics(diagnostics: Diagnostic[]): Diagnostic[] {
  const seen = new Set<string>();
  const result: Diagnostic[] = [];
  for (const diagnostic of diagnostics) {
    const key = JSON.stringify([
      diagnostic.code,
      diagnostic.source_span.start,
      diagnostic.source_span.end,
      diagnostic.params,
    ]);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(diagnostic);
  }
  return result;
}
