/**
 * Builders for the parse-stage `ol-*` diagnostics this package emits. Centralizing them keeps
 * the lexer and reader from inventing ad-hoc `Error` strings: every finding uses a stable code
 * from the [`@openlogo/core`](../../core/src/diagnostics.ts) registry, carries a
 * {@link SourceSpan}, and pairs structured `params` (the diagnostic identity) with warm,
 * lowercase learner prose derived from them, exactly as
 * [`spec/error-model.md`](../../../spec/error-model.md) requires. Prose is presentation only —
 * tools compare `code` + `params`, never the English message.
 */

import type { Diagnostic, SourceSpan } from "@openlogo/core";

function parseError(
  code: Diagnostic["code"],
  source_span: SourceSpan,
  params: Readonly<Record<string, unknown>>,
  message: string,
): Diagnostic {
  return {
    code,
    source_span,
    params,
    message,
    stage: "parse",
    severity: "error",
  };
}

/** Parse-stage diagnostics, one builder per `ol-*` code the reader/lexer can raise. */
export const parseDiag = {
  unclosedString(span: SourceSpan): Diagnostic {
    return parseError(
      "ol-unclosed-string",
      span,
      { opened_at: span },
      'this word is missing its closing ". every "word" needs a quote on both ends.',
    );
  },

  unclosedComment(span: SourceSpan): Diagnostic {
    return parseError(
      "ol-unclosed-comment",
      span,
      { opened_at: span },
      "this /* comment is missing its closing */.",
    );
  },

  badToken(span: SourceSpan, text: string): Diagnostic {
    return parseError(
      "ol-bad-token",
      span,
      { text },
      `i don't know how to read ${text} here.`,
    );
  },

  unmatchedBracket(span: SourceSpan, delimiter: "[" | "]"): Diagnostic {
    return parseError(
      "ol-unmatched-bracket",
      span,
      { delimiter },
      `this ${delimiter} doesn't have a matching bracket. lists and blocks need both [ and ].`,
    );
  },

  unmatchedParen(span: SourceSpan, delimiter: "(" | ")"): Diagnostic {
    return parseError(
      "ol-unmatched-paren",
      span,
      { delimiter },
      `this ${delimiter} doesn't have a matching parenthesis. a group needs both ( and ).`,
    );
  },

  unmatchedBrace(span: SourceSpan, delimiter: "{" | "}"): Diagnostic {
    return parseError(
      "ol-unmatched-brace",
      span,
      { delimiter },
      `this ${delimiter} doesn't have a matching brace. dictionary literals need both { and }.`,
    );
  },

  missingTerminator(span: SourceSpan, text: string): Diagnostic {
    return parseError(
      "ol-bad-token",
      span,
      { text },
      `each instruction needs a new line of its own. i didn't expect ${text} to keep going on this line.`,
    );
  },

  missingEnd(span: SourceSpan, opener: string): Diagnostic {
    const hint = "wrap the body in [ ] or close it with end.";
    return parseError(
      "ol-missing-end",
      span,
      { opener, hint },
      `${opener} needs a body. ${hint}`,
    );
  },

  mismatchedEnd(
    span: SourceSpan,
    expected: string,
    actual: string,
  ): Diagnostic {
    return parseError(
      "ol-mismatched-end",
      span,
      { expected, actual },
      `this ${actual} doesn't close the block that is open. did you mean ${expected}?`,
    );
  },
} as const;
