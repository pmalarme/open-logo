/**
 * The OpenLogo lexer: it turns `.logo` source text into a flat token stream with a
 * {@link SourceSpan} on every token, plus the parse-stage diagnostics that reading raw
 * characters can surface (`ol-unclosed-string`, `ol-unclosed-comment`, `ol-bad-token`). It
 * follows the lexical rules in [`spec/grammar.md`](../../../spec/grammar.md): case-insensitive
 * keywords, snake_case identifiers with an optional trailing `?`/`!`, `.`-decimal numbers with
 * an optional exponent, `"..."` and `"""..."""` word literals, `#`/`//` line comments and
 * `/* … *\/` block comments as whitespace, and a `-` that is only ever the minus operator (a
 * negative numeral is assembled by the reader).
 *
 * Positions are 1-based `[line, column]` counted in Unicode scalar values — the lexer iterates
 * over code points, not UTF-16 units — so spans stay stable across astral characters. This
 * module is internal to `@openlogo/parser`; the public surface is {@link parse}.
 */

import { makeSpan } from "@openlogo/core";
import type { Diagnostic, Position, SourceSpan } from "@openlogo/core";
import { parseDiag } from "./errors.js";

/** The lexical categories the reader consumes. */
export type LexTokenKind =
  | "number"
  | "word"
  | "name"
  | "variable"
  | "op"
  | "lbracket"
  | "rbracket"
  | "lbrace"
  | "rbrace"
  | "lparen"
  | "rparen"
  | "dot"
  | "newline"
  | "eof";

/** A classified lexical token: its category, raw text, decoded value, and source span. */
export interface LexToken {
  readonly kind: LexTokenKind;
  /** Raw source slice, used for spans, highlighting, and diagnostics. */
  readonly text: string;
  /**
   * Decoded value for `word` tokens and the colon-free name for `variable` tokens; the
   * empty string for tokens that carry no separate value (numbers, operators, delimiters).
   */
  readonly value: string;
  readonly source_span: SourceSpan;
}

/** A tokenized document: the stream (always ending in an `eof` token) and any lexical findings. */
export interface LexResult {
  readonly tokens: readonly LexToken[];
  readonly diagnostics: readonly Diagnostic[];
}

const IDENT_START = /[_]|\p{XID_Start}/u;
const IDENT_CONTINUE = /\p{XID_Continue}/u;

function isDigit(ch: string): boolean {
  return ch >= "0" && ch <= "9";
}

function isIdentStart(ch: string): boolean {
  return ch !== "" && IDENT_START.test(ch);
}

function isIdentContinue(ch: string): boolean {
  return ch !== "" && IDENT_CONTINUE.test(ch);
}

function isHorizontalSpace(ch: string): boolean {
  return ch !== "\n" && /\s/u.test(ch);
}

/**
 * Normalize a triple-quoted literal's raw content: drop the newline right after the opening
 * `"""` and right before the closing `"""`, then remove the common leading whitespace shared by
 * every non-blank line, matching the worked example in `spec/grammar.md`.
 */
function normalizeMultiline(raw: string): string {
  const lines = raw.split(/\r?\n/);
  if (lines[0] === "") {
    lines.shift();
  }
  if (lines[lines.length - 1] === "") {
    lines.pop();
  }
  let common = Number.POSITIVE_INFINITY;
  for (const line of lines) {
    if (line.trim() === "") {
      continue;
    }
    common = Math.min(common, line.length - line.trimStart().length);
  }
  if (!Number.isFinite(common)) {
    common = 0;
  }
  return lines.map((line) => line.slice(common)).join("\n");
}

/** Tokenize `source` (attributing spans to `document`) into a stream plus lexical diagnostics. */
export function tokenize(source: string, document: string): LexResult {
  const chars = [...source];
  const tokens: LexToken[] = [];
  const diagnostics: Diagnostic[] = [];

  let i = 0;
  let line = 1;
  let column = 1;

  const at = (offset: number): string => chars[i + offset] ?? "";

  const pos = (): Position => [line, column];

  const span = (start: Position, end: Position): SourceSpan =>
    makeSpan(document, start, end);

  const advance = (): string => {
    const ch = at(0);
    i += 1;
    if (ch === "\n") {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
    return ch;
  };

  const push = (
    kind: LexTokenKind,
    text: string,
    start: Position,
    value = "",
  ): void => {
    tokens.push({ kind, text, value, source_span: span(start, pos()) });
  };

  const readWhile = (predicate: (ch: string) => boolean): string => {
    let text = "";
    while (predicate(at(0))) {
      text += advance();
    }
    return text;
  };

  while (i < chars.length) {
    const ch = at(0);

    if (ch === "\r" && at(1) === "\n") {
      const start = pos();
      advance();
      advance();
      push("newline", "\r\n", start);
      continue;
    }
    if (ch === "\n") {
      const start = pos();
      advance();
      push("newline", "\n", start);
      continue;
    }
    if (isHorizontalSpace(ch)) {
      advance();
      continue;
    }

    // Comments are whitespace.
    if (ch === "#") {
      readWhile((c) => c !== "\n" && c !== "");
      continue;
    }
    if (ch === "/" && at(1) === "/") {
      readWhile((c) => c !== "\n" && c !== "");
      continue;
    }
    if (ch === "/" && at(1) === "*") {
      const start = pos();
      advance();
      advance();
      let closed = false;
      while (i < chars.length) {
        if (at(0) === "*" && at(1) === "/") {
          advance();
          advance();
          closed = true;
          break;
        }
        advance();
      }
      if (!closed) {
        diagnostics.push(
          parseDiag.unclosedComment(span(start, [start[0], start[1] + 2])),
        );
      }
      continue;
    }

    const start = pos();

    if (isDigit(ch)) {
      let text = readWhile(isDigit);
      if (at(0) === "." && isDigit(at(1))) {
        text += advance();
        text += readWhile(isDigit);
      }
      if (at(0) === "e" || at(0) === "E") {
        const signGap = at(1) === "+" || at(1) === "-" ? 1 : 0;
        if (isDigit(at(1 + signGap))) {
          text += advance();
          if (at(0) === "+" || at(0) === "-") {
            text += advance();
          }
          text += readWhile(isDigit);
        }
      }
      push("number", text, start);
      continue;
    }

    if (isIdentStart(ch)) {
      let text = readWhile(isIdentContinue);
      if (at(0) === "?" || at(0) === "!") {
        text += advance();
      }
      push("name", text, start);
      continue;
    }

    if (ch === ":") {
      if (isIdentStart(at(1))) {
        advance();
        let name = readWhile(isIdentContinue);
        if (at(0) === "?" || at(0) === "!") {
          name += advance();
        }
        push("variable", `:${name}`, start, name);
      } else {
        advance();
        diagnostics.push(parseDiag.badToken(span(start, pos()), ":"));
      }
      continue;
    }

    if (ch === '"') {
      if (at(1) === '"' && at(2) === '"') {
        advance();
        advance();
        advance();
        let raw = "";
        let closed = false;
        while (i < chars.length) {
          if (at(0) === '"' && at(1) === '"' && at(2) === '"') {
            advance();
            advance();
            advance();
            closed = true;
            break;
          }
          if (at(0) === "\\" && (at(1) === '"' || at(1) === "\\")) {
            advance();
            raw += advance();
            continue;
          }
          raw += advance();
        }
        if (!closed) {
          diagnostics.push(
            parseDiag.unclosedString(span(start, [start[0], start[1] + 3])),
          );
        } else {
          push("word", `"""${raw}"""`, start, normalizeMultiline(raw));
        }
      } else {
        advance();
        let value = "";
        let closed = false;
        while (i < chars.length) {
          const c = at(0);
          if (c === "\n") {
            break;
          }
          if (c === '"') {
            advance();
            closed = true;
            break;
          }
          if (c === "\\" && (at(1) === '"' || at(1) === "\\")) {
            advance();
            value += advance();
            continue;
          }
          value += advance();
        }
        if (!closed) {
          diagnostics.push(
            parseDiag.unclosedString(span(start, [start[0], start[1] + 1])),
          );
        } else {
          push("word", `"${value}"`, start, value);
        }
      }
      continue;
    }

    switch (ch) {
      case "[":
        advance();
        push("lbracket", "[", start);
        continue;
      case "]":
        advance();
        push("rbracket", "]", start);
        continue;
      case "{":
        advance();
        push("lbrace", "{", start);
        continue;
      case "}":
        advance();
        push("rbrace", "}", start);
        continue;
      case "(":
        advance();
        push("lparen", "(", start);
        continue;
      case ")":
        advance();
        push("rparen", ")", start);
        continue;
      case ".":
        advance();
        push("dot", ".", start);
        continue;
      default:
        break;
    }

    if (ch === "=" && at(1) === "=") {
      advance();
      advance();
      push("op", "==", start);
      continue;
    }
    if (ch === "!" && at(1) === "=") {
      advance();
      advance();
      push("op", "!=", start);
      continue;
    }
    if (ch === "<" && at(1) === "=") {
      advance();
      advance();
      push("op", "<=", start);
      continue;
    }
    if (ch === ">" && at(1) === "=") {
      advance();
      advance();
      push("op", ">=", start);
      continue;
    }
    if (
      ch === "=" ||
      ch === "<" ||
      ch === ">" ||
      ch === "+" ||
      ch === "-" ||
      ch === "*" ||
      ch === "/"
    ) {
      advance();
      push("op", ch, start);
      continue;
    }

    advance();
    diagnostics.push(parseDiag.badToken(span(start, pos()), ch));
  }

  tokens.push({
    kind: "eof",
    text: "",
    value: "",
    source_span: span(pos(), pos()),
  });
  return { tokens, diagnostics };
}
