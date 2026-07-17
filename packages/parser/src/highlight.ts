/**
 * Syntax-highlighting token classes — the normative token-class model from
 * [`spec/tooling.md`](../../../spec/tooling.md). A highlighter classifies tokens from the
 * grammar (grammatical position decides the class), not from ad-hoc regular expressions.
 * Owned by `@language-designer`; consumed by the studio editor, docs, and external editors.
 * The class set tracks the grammar version — a grammar change ships its highlighting update
 * in the same milestone.
 */

import type { SourceSpan } from "@openlogo/core";

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

/** A classified token: its class, its source text, and where it came from. */
export interface Token {
  readonly class: TokenClass;
  readonly text: string;
  readonly source_span: SourceSpan;
}
