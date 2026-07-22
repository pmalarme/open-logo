/**
 * #285 — the real {@link HighlightProvider} for the studio editor, backed entirely by
 * `@openlogo/parser`'s normative token classifier (`highlight()`, `spec/tooling.md`'s 15 token
 * classes). This module never re-implements token classification: it only maps each parser
 * {@link Token} onto one {@link HighlightToken} (a stable CSS class + the same `source_span`
 * start/end the parser already computed) so `editor-cm6.ts`'s decoration extension can paint it.
 *
 * The 15 normative classes map 1:1 onto 15 stable `ol-tok-*` CSS classes (see
 * `OL_HIGHLIGHT_CSS_CLASS` below); `web/styles.css` is the single place that assigns them colors.
 * Bracket **role** (`spec/tooling.md`'s "Delimiter roles" table) is intentionally not encoded in
 * the CSS class — the spec allows a theme to map every role to the same bracket color — but it is
 * still present on the underlying parser {@link Token} for any future semantic-token consumer.
 */

import { highlight } from "@openlogo/parser";
import type { Token, TokenClass } from "@openlogo/parser";
import type { HighlightProvider, HighlightToken } from "./editor.js";

/** Stable CSS class prefix every token-class rule in `web/styles.css` shares. */
export const OL_HIGHLIGHT_CSS_CLASS_PREFIX = "ol-tok-";

/**
 * The normative token class → stable CSS class mapping. A handful of class spellings
 * (`"word/string"`, `":variable"`, `"index/dot"`) are not valid bare CSS identifiers, so this
 * table is the one place that decides their `ol-tok-*` spelling; every other class reuses its own
 * name verbatim.
 */
export const OL_HIGHLIGHT_CSS_CLASS: Readonly<Record<TokenClass, string>> = {
  keyword: `${OL_HIGHLIGHT_CSS_CLASS_PREFIX}keyword`,
  primitive: `${OL_HIGHLIGHT_CSS_CLASS_PREFIX}primitive`,
  number: `${OL_HIGHLIGHT_CSS_CLASS_PREFIX}number`,
  "word/string": `${OL_HIGHLIGHT_CSS_CLASS_PREFIX}string`,
  ":variable": `${OL_HIGHLIGHT_CSS_CLASS_PREFIX}variable`,
  comment: `${OL_HIGHLIGHT_CSS_CLASS_PREFIX}comment`,
  bracket: `${OL_HIGHLIGHT_CSS_CLASS_PREFIX}bracket`,
  brace: `${OL_HIGHLIGHT_CSS_CLASS_PREFIX}brace`,
  paren: `${OL_HIGHLIGHT_CSS_CLASS_PREFIX}paren`,
  operator: `${OL_HIGHLIGHT_CSS_CLASS_PREFIX}operator`,
  "index/dot": `${OL_HIGHLIGHT_CSS_CLASS_PREFIX}index-dot`,
  "dict-key": `${OL_HIGHLIGHT_CSS_CLASS_PREFIX}dict-key`,
  "procedure-name": `${OL_HIGHLIGHT_CSS_CLASS_PREFIX}procedure-name`,
  "type-name": `${OL_HIGHLIGHT_CSS_CLASS_PREFIX}type-name`,
  "field-name": `${OL_HIGHLIGHT_CSS_CLASS_PREFIX}field-name`,
};

/** Map one parser {@link Token} onto the {@link HighlightToken} shape `editor.ts` defines. */
function toHighlightToken(token: Token): HighlightToken {
  return {
    text: token.text,
    class: OL_HIGHLIGHT_CSS_CLASS[token.class],
    start: token.source_span.start,
    end: token.source_span.end,
  };
}

/**
 * Build the real {@link HighlightProvider}: classify `source` with `@openlogo/parser`'s
 * `highlight()` (the grammar-derived lexical pass plus its semantic disambiguation, per
 * `spec/tooling.md`) and map each resulting {@link Token} onto a CSS-classed {@link HighlightToken}.
 * Never throws — {@link highlight} itself has a never-throw contract over malformed/mid-edit
 * input, so this stays safe to call on every keystroke.
 */
export function createParserHighlighter(): HighlightProvider {
  return (source: string) => highlight(source).map(toHighlightToken);
}
