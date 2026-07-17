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
 * Scope for this slice is the Core surface. Postfix places (`:a.b`, `:a[i]`), dict/struct and
 * the other Data forms, the Heritage spellings (`make`/`to`/`output`/`op`/aliases), and the
 * `is`/`between` predicates are handled by their own later slices; until then those spellings
 * degrade to ordinary calls or a collected diagnostic rather than a crash.
 */

import { makeSpan } from "@openlogo/core";
import type { Diagnostic, Position, SourceSpan } from "@openlogo/core";
import { ast } from "./ast.js";
import type {
  BlockNode,
  ExpressionNode,
  ProcedureParam,
  ProgramNode,
  StatementNode,
} from "./ast.js";
import { parseDiag } from "./errors.js";
import { corePrimitiveArity } from "./signatures.js";
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
    const label =
      token.kind === "newline"
        ? "end of line"
        : token.kind === "eof"
          ? "end of file"
          : token.text;
    return parseDiag.badToken(token.source_span, label);
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
    return corePrimitiveArity(name) ?? 0;
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
      advance();
      const right = parseAnd();
      if (right === undefined) {
        diagnostics.push(unexpected(current()));
        break;
      }
      left = ast.call("or", [left, right], spanBetween(left, right));
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
      advance();
      const right = parseComparison();
      if (right === undefined) {
        diagnostics.push(unexpected(current()));
        break;
      }
      left = ast.call("and", [left, right], spanBetween(left, right));
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
    // Comparison chaining: `1 < :x < 10` desugars to `and(<(1, :x), <(:x, 10))`,
    // folded left as each operator is read so no operand is indexed after the fact.
    let previous = first;
    let chain: ExpressionNode | undefined;
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
      const comparison = ast.call(
        token.text,
        [previous, right],
        spanBetween(previous, right),
      );
      chain =
        chain === undefined
          ? comparison
          : ast.call(
              "and",
              [chain, comparison],
              spanBetween(chain, comparison),
            );
      previous = right;
    }
    return chain ?? first;
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
      left = ast.call(token.text, [left, right], spanBetween(left, right));
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
      left = ast.call(opName, [left, right], spanBetween(left, right));
    }
    return left;
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
      return ast.call("not", [operand], spanBetween(token, operand));
    }
    if (
      token.kind === "op" &&
      token.text === "-" &&
      peek(1).kind === "number"
    ) {
      advance();
      const numTok = current();
      advance();
      return ast.numberLit(-Number(numTok.text), spanBetween(token, numTok));
    }
    return parsePostfix();
  }

  function parsePostfix(): ExpressionNode | undefined {
    // Postfix selectors and fields (`[i]`, `.field`) arrive with the places slice.
    return parsePrimary();
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
    return ast.call(token.text, args, spanBetween(token, endNode));
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
    if (head.kind === "name" && isCalleeName(head.text)) {
      advance();
      const args: ExpressionNode[] = [];
      for (;;) {
        skipNewlines();
        const token = current();
        if (token.kind === "rparen") {
          advance();
          return ast.parenCall(head.text, args, spanBetween(open, token));
        }
        if (token.kind === "eof") {
          diagnostics.push(parseDiag.unmatchedParen(open.source_span, "("));
          return ast.parenCall(head.text, args, spanBetween(open, token));
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
    let accumulator: string | undefined;
    if (form === "reduce") {
      const accTok = current();
      if (accTok.kind !== "name") {
        diagnostics.push(unexpected(accTok));
        return undefined;
      }
      advance();
      accumulator = accTok.text;
    }
    const binderTok = current();
    if (binderTok.kind !== "name") {
      diagnostics.push(unexpected(binderTok));
      return undefined;
    }
    advance();
    const binder = binderTok.text;
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
    let initial: ExpressionNode | undefined;
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
      initial = seed;
    }
    if (current().kind !== "lbracket") {
      diagnostics.push(parseDiag.missingEnd(head.source_span, form));
      return undefined;
    }
    const body = parseBracketBlock();
    return ast.comprehension(
      { form, binder, iterable, body, accumulator, initial },
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
        const label = current();
        if (label.kind === "name" && END_LABELS.has(label.text.toLowerCase())) {
          advance();
        }
        break;
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
    const next = peek(1);
    if (token.kind === "variable" && next.kind === "op" && next.text === "=") {
      return parseColonAssignment();
    }
    if (token.kind === "name") {
      switch (token.text.toLowerCase()) {
        case "set":
          return parseSetAssignment();
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
    return parseExpression();
  }

  function parseColonAssignment(): StatementNode | undefined {
    const varTok = current();
    advance();
    const place = ast.place(varTok.value, varTok.source_span);
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
    const place = ast.place(nameTok.text, nameTok.source_span);
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
          if (isName("if")) {
            advance();
          }
          break;
        }
        const before = pos;
        const statement = parseStatement();
        if (statement !== undefined) {
          thenStmts.push(statement);
        }
        if (pos === before) {
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
            if (isName("if")) {
              advance();
            }
            break;
          }
          const before = pos;
          const statement = parseStatement();
          if (statement !== undefined) {
            elseStmts.push(statement);
          }
          if (pos === before) {
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

  function parseFor(): StatementNode | undefined {
    const forTok = current();
    advance();
    const nameTok = current();
    if (nameTok.kind !== "name") {
      diagnostics.push(unexpected(nameTok));
      return undefined;
    }
    advance();
    const variable = nameTok.text;
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
    const name = nameTok.text;
    const params: ProcedureParam[] = [];
    for (;;) {
      const param = current();
      if (param.kind !== "variable") {
        break;
      }
      advance();
      params.push({ name: param.value });
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
      if (current().kind === "rparen") {
        advance();
      } else {
        diagnostics.push(parseDiag.unmatchedParen(open.source_span, "("));
      }
      if (defaultValue === undefined) {
        params.push({ name: nameParam.value });
      } else {
        params.push({ name: nameParam.value, defaultValue });
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
      const statement = parseStatement();
      if (statement !== undefined) {
        body.push(statement);
      }
      if (pos === before) {
        resync();
      }
    }
    return ast.program(body, spanFrom([1, 1], eofToken));
  }

  return { ast: parseProgram(), diagnostics };
}
