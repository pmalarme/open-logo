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
 *
 * ## The active profile set (#740)
 * `highlight()` classifies a handful of words *relative to the active conformance profile set*:
 * `spec/tooling.md:30` puts the profile block-heads and the Sprites mode-switch command `tell` in
 * `keyword` "while their profile is active", and `:31` puts "a profile word whose profile is
 * inactive" in `primitive`. Omitting the set gets the parser's profile-neutral default (Core
 * Language alone), which is why a learner with Sprites available used to see `ask` painted as an
 * ordinary primitive. This module supplies {@link STUDIO_PROFILES} — the same set `diagnostics.ts`
 * hands `check()` by default — so the editor's colors and the checker's diagnostics read a program
 * under the same profiles.
 *
 * The token classes are normative (`spec/tooling.md:8`) and an LSP `textDocument/semanticTokens`
 * response returns "the token classes in this document" (`:278-280`), so this adapter has no
 * licence to classify differently from a batch `highlight()` given the same source and profile set.
 * (`spec/tooling.md:294-295`'s explicit batch-parity MUST is about *diagnostics*, not tokens — the
 * token obligation is the normative-class one above.)
 */

import { highlight } from "@openlogo/parser";
import type { CheckProfile, Token, TokenClass } from "@openlogo/parser";
import type { HighlightProvider, HighlightToken } from "./editor.js";
import { STUDIO_PROFILES } from "./profiles.js";

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

/** Optional configuration for {@link createParserHighlighter}. */
export interface ParserHighlighterOptions {
  /**
   * The active conformance profile set, in the same vocabulary `check()` and `highlight()` use.
   * Defaults to {@link STUDIO_PROFILES} — the profiles this build actually supports, which is what
   * a learner in the studio is really running under. Pass an explicit set (e.g.
   * `["core-language"]`) to preview how the same source would be classified elsewhere.
   */
  readonly profiles?: readonly CheckProfile[];
}

/**
 * Build the real {@link HighlightProvider}: classify `source` with `@openlogo/parser`'s
 * `highlight()` (the grammar-derived lexical pass plus its semantic disambiguation, per
 * `spec/tooling.md`) under `options.profiles` — defaulting to {@link STUDIO_PROFILES} — and map
 * each resulting {@link Token} onto a CSS-classed {@link HighlightToken}. Never throws —
 * {@link highlight} itself has a never-throw contract over malformed/mid-edit input, so this stays
 * safe to call on every keystroke.
 *
 * `highlight()`'s `document` argument only labels each token's `source_span`, which
 * {@link HighlightToken} does not carry, so this passes the parser's own default rather than
 * inventing a studio-specific name no caller can observe.
 */
export function createParserHighlighter(
  options: ParserHighlighterOptions = {},
): HighlightProvider {
  const profiles = options.profiles ?? STUDIO_PROFILES;
  return (source: string) =>
    highlight(source, undefined, { profiles }).map(toHighlightToken);
}
