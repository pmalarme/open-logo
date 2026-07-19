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
 * assignment, `local`, dotted places (`:a.b.c`), worded `is`-predicates, comparison chains, and
 * the parenthesized variadic `(and …)`/`(or …)`. Index/key selectors (`:a[i]`), dict/struct and
 * the other Data forms, and the Heritage spellings (`make`/`to`/`output`/`op`/aliases) are
 * handled by their own later slices; until then those spellings degrade to ordinary calls or a
 * collected diagnostic rather than a crash.
 */

import { makeSpan } from "@openlogo/core";
import type { Diagnostic, Position, SourceSpan } from "@openlogo/core";
import { ast } from "./ast.js";
import type {
  Binder,
  BlockNode,
  DestructuringBinderNode,
  ExpressionNode,
  PlaceSegment,
  ProcedureParam,
  ProgramNode,
  SpannedName,
  StatementNode,
} from "./ast.js";
import { parseDiag } from "./errors.js";
import { primitiveArity } from "./signatures.js";
import { tokenize } from "./tokens.js";
import type { LexToken } from "./tokens.js";

/** The result of {@link parse}: a best-effort AST plus every collected diagnostic. */
export interface ParseResult {
  readonly ast: ProgramNode;
  readonly diagnostics: readonly Diagnostic[];
}

/**
 * Structural words that can never begin an expression, so the reader must not read them as a
 * bare call. This is intentionally narrower than {@link OL_RESERVED_WORDS}: reserved command
 * words like `thing`, `print`, `add`, and `value` *are* callables, whereas these are control,
 * binding, preposition, logic, predicate, and module keywords.
 */
const NON_PRIMARY_NAMES = new Set<string>([
  "set",
  "if",
  "else",
  "while",
  "repeat",
  "for",
  "forever",
  "define",
  "to",
  "end",
  "return",
  "output",
  "op",
  "stop",
  "throw",
  "local",
  "in",
  "from",
  "at",
  "by",
  "and",
  "or",
  "not",
  "is",
  "between",
  "strictly",
  "mod",
  "struct",
  "alias",
  "import",
  "export",
]);

const END_LABELS = new Set<string>([
  "if",
  "while",
  "repeat",
  "for",
  "forever",
  "define",
]);

/**
 * Pre-scan the token stream for `define <name> :p …` headers so a later prefix call to a user
 * procedure knows how many arguments to gather. Optional `( :name default )` parameters do not
 * count toward the default arity — only the leading required `:name` parameters do.
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
    if (head.kind !== "name" || head.text.toLowerCase() !== "define") {
      continue;
    }
    const nameTok = tokens[k + 1] as LexToken;
    if (nameTok.kind !== "name") {
      continue;
    }
    let arity = 0;
    for (let j = k + 2; j < tokens.length; j += 1) {
      if ((tokens[j] as LexToken).kind !== "variable") {
        break;
      }
      arity += 1;
    }
    arities.set(nameTok.text.toLowerCase(), arity);
  }
  return arities;
}

/** Parse `source` into a Core AST plus diagnostics. Attribution spans point into `document`. */
export function parse(source: string, document = "<input>"): ParseResult {
  const lexed = tokenize(source, document);
  const tokens = lexed.tokens;
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
    return primitiveArity(name) ?? 0;
  }

  function isCalleeName(text: string): boolean {
    const lower = text.toLowerCase();
    if (lower === "true" || lower === "false") {
      return false;
    }
    if (lower === "map" || lower === "filter" || lower === "reduce") {
      return false;
    }
    return !NON_PRIMARY_NAMES.has(lower);
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
  function tryNegativeNumberLiteral(): ExpressionNode | undefined {
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
   * Parse one `key-term` inside a selector `[ … ]` (`spec/grammar.md:111`): a `number` (including a
   * negative literal such as `[-1]`), a word literal, a `:name` read, a bare identifier (a *literal
   * word key*, never evaluated — reserved words are valid data here), or a parenthesized
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

  function parsePostfix(): ExpressionNode | undefined {
    const primary = parsePrimary();
    if (primary === undefined) {
      return undefined;
    }
    // A postfix read `:a.b.c` or `:nums[1]` grows the bare variable into a place; a plain `:a`
    // stays a VarRef. A `[` counts only when adjacent, so a spaced `[ … ]` stays a separate token.
    if (
      primary.kind === "VarRef" &&
      ((current().kind === "dot" && peek(1).kind === "name") ||
        (current().kind === "lbracket" && currentAdjacentToPrev()))
    ) {
      const base: SpannedName = {
        name: primary.name,
        source_span: primary.source_span,
      };
      const segments = collectPostfixSegments();
      return ast.place(base, segments, spanToHere(primary.source_span.start));
    }
    return primary;
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
    if (NON_PRIMARY_NAMES.has(lower)) {
      return undefined;
    }
    return parseFixedCall(token);
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

  function parseParenthesized(): ExpressionNode | undefined {
    const open = current();
    advance();
    skipNewlines();
    const head = current();
    const lower = head.kind === "name" ? head.text.toLowerCase() : "";
    // A parenthesized head that is a callable — including the variadic logic words `and`/`or`,
    // which are not fixed-arity callees elsewhere — gathers every operand up to the `)`.
    if (
      head.kind === "name" &&
      (isCalleeName(head.text) || lower === "and" || lower === "or")
    ) {
      advance();
      const callee =
        lower === "and" || lower === "or"
          ? sname(lower, head)
          : sname(head.text, head);
      const args: ExpressionNode[] = [];
      for (;;) {
        skipNewlines();
        const token = current();
        if (token.kind === "rparen") {
          advance();
          return ast.parenCall(callee, args, spanBetween(open, token));
        }
        if (token.kind === "eof") {
          diagnostics.push(parseDiag.unmatchedParen(open.source_span, "("));
          return ast.parenCall(callee, args, spanBetween(open, token));
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
          return parseProcedureDef();
        case "return":
          return parseReturn();
        case "stop":
          return parseStop();
        case "throw":
          return parseThrow();
        default:
          break;
      }
    }
    const expr = parseExpression();
    // A reporter/call or a bare literal used as an assignment target — `first :x = 5`,
    // `count :nums = 3`, `3 = 5` — is not a place. Recognize the structure here so the semantic
    // checker can flag it with `ol-not-a-place` (spec/tooling.md:213-219) instead of a blunt parse
    // error; `=` is the only op that survives to this fall-through, so a bare `text === "="` guard
    // is sufficient. A bare `:name` never reaches this fall-through (it is always routed through
    // `colonAssignmentAhead()`/`parseColonAssignment()` into a proper `Place`), so `VarRef` is not
    // one of the kinds recognized here.
    if (expr === undefined) {
      return undefined;
    }
    const isNonPlaceTarget =
      expr.kind === "Call" ||
      expr.kind === "ParenCall" ||
      expr.kind === "NumberLit" ||
      expr.kind === "WordLit" ||
      expr.kind === "BooleanLit" ||
      expr.kind === "ListLit";
    if (isNonPlaceTarget && current().text === "=") {
      advance();
      const value = parseExpression();
      if (value === undefined) {
        diagnostics.push(unexpected(current()));
        return expr;
      }
      return ast.assign(
        expr,
        value,
        "equals",
        spanFrom(expr.source_span.start, value),
      );
    }
    return expr;
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
    const nameTok = current();
    if (nameTok.kind !== "name") {
      diagnostics.push(unexpected(nameTok));
      return undefined;
    }
    advance();
    const base = sname(nameTok.text, nameTok);
    const segments = collectPostfixSegments();
    const place = ast.place(
      base,
      segments,
      spanToHere(nameTok.source_span.start),
    );
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
      place,
      value,
      "set",
      spanFrom(setTok.source_span.start, value),
    );
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

  function parseProcedureDef(): StatementNode | undefined {
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
    return ast.procedureDef(name, params, body, span);
  }

  function parseReturn(): StatementNode | undefined {
    const token = current();
    advance();
    const value = parseExpression();
    if (value === undefined) {
      diagnostics.push(unexpected(current()));
      return undefined;
    }
    return ast.returnStmt(
      "return",
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
