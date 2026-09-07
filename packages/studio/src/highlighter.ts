/**
 * #285 — the real {@link HighlightProvider} for the studio editor, backed entirely by
 * `@openlogo/parser`'s normative token classifier (`semanticTokens()`, layered over `highlight()`
 * and `spec/tooling.md`'s 15 token classes). This module never re-implements token classification
 * or name resolution: it only maps each parser {@link SemanticToken} onto one
 * {@link HighlightToken} (a stable CSS class, its modifier CSS classes, and the same `source_span`
 * start/end the parser already computed) so `editor-cm6.ts`'s decoration extension can paint it.
 *
 * The 15 normative classes map 1:1 onto 15 stable `ol-tok-*` CSS classes (see
 * `OL_HIGHLIGHT_CSS_CLASS` below); `web/styles.css` is the single place that assigns them colors.
 *
 * ## The modifier channel (#1106)
 * A token also carries LSP-style **semantic-token modifiers** — a second, independent axis from the
 * class (`spec/tooling.md:83-84` puts the five bracket roles on it rather than inventing classes
 * for them; ADR-0032 puts `global` there for the same reason). {@link OL_HIGHLIGHT_MODIFIER_CSS_CLASS}
 * maps the modifiers this studio actually paints onto stable `ol-mod-*` CSS classes, additively:
 * a token keeps its own `ol-tok-*` class either way, so a theme that styles no `ol-mod-*` rule
 * renders a modified token exactly like an unmodified one, which is the degradation
 * `spec/tooling.md:83-84` explicitly contemplates for the bracket roles.
 *
 * That table is deliberately **partial**. The modifier vocabulary is open — `spec/tooling.md:281-283`
 * lists "optional modifiers **such as** …" — so a total record would turn every parser-side
 * addition into a compile error here, which is precisely what ADR-0032 chose the modifier channel
 * to avoid. Today one modifier earns paint: `global`, the answer to "does this `:name` reach state
 * the whole program shares, or does it create a private binding?" — the one question
 * `spec/execution-model.md:441-446` rules is *correct* and therefore never diagnoses, so paint is
 * the only reader-facing guard for it. `declaration`/`reference`/`readonly`/`defaultLibrary` and the
 * three bracket roles are consumed and dropped: they are true of nearly every token, so painting
 * them would be noise, not information.
 *
 * Marking follows the parser's **resolution**, never spelling: a `local` that shadows a global is
 * not painted, and `packages/parser/src/global-variable-resolution.ts` is the single source of that
 * answer. This module must never re-derive it — a second, subtly different scope model in the
 * studio is exactly the divergence saga #819 exists to prevent.
 *
 * ## The active profile set (#740)
 * `highlight()` classifies a handful of words *relative to the active conformance profile set*:
 * `spec/tooling.md:30` puts the profile block-heads and the Sprites mode-switch command `tell` in
 * `keyword` "while their profile is active", and `:31` puts "a profile word whose profile is
 * inactive" in `primitive`. Omitting the set gets the parser's profile-neutral default (Core
 * Language alone), which is why a learner with Sprites available used to see `ask` painted with the
 * plain `primitive` fallback. This module supplies {@link STUDIO_PROFILES} — the same set `diagnostics.ts`
 * hands `check()` by default — so when neither caller overrides that default, the editor's colors
 * and the checker's diagnostics read a program under the same profiles.
 *
 * The token classes are normative (`spec/tooling.md:8`) and an LSP `textDocument/semanticTokens`
 * response returns "the token classes in this document" (`:281-283`), so this adapter has no
 * licence to classify differently from a batch `highlight()` given the same source and profile set.
 * (`spec/tooling.md:297-298`'s explicit batch-parity MUST is about *diagnostics*, not tokens — the
 * token obligation is the normative-class one above.) `semanticTokens()` carries every
 * `highlight()` token through unchanged and only appends `modifiers`, so switching this seam onto
 * it changes no class.
 */

import { semanticTokens } from "@openlogo/parser";
import type {
  CheckProfile,
  SemanticToken,
  TokenClass,
  TokenModifier,
} from "@openlogo/parser";
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

/**
 * Stable CSS class prefix every semantic-token **modifier** rule in `web/styles.css` shares.
 * Deliberately distinct from {@link OL_HIGHLIGHT_CSS_CLASS_PREFIX}: class and modifier are two
 * independent axes (ADR-0032), and keeping the `ol-tok-*` namespace closed to the 15 normative
 * classes is what lets `highlighter.test.mjs`'s contrast gate keep asserting "every `ol-tok-*` rule
 * sets a color" without a modifier rule — which sets none — having to lie to satisfy it.
 */
export const OL_HIGHLIGHT_MODIFIER_CSS_CLASS_PREFIX = "ol-mod-";

/**
 * The semantic-token modifiers this studio paints → their stable `ol-mod-*` CSS class. **Partial by
 * design** — see the module doc comment: the modifier vocabulary is open, an unmapped modifier is
 * simply dropped, and a token always keeps its own `ol-tok-*` class, so nothing here can break a
 * consumer or a theme that ignores it.
 */
export const OL_HIGHLIGHT_MODIFIER_CSS_CLASS: Readonly<
  Partial<Record<TokenModifier, string>>
> = {
  global: `${OL_HIGHLIGHT_MODIFIER_CSS_CLASS_PREFIX}global`,
};

/**
 * The plain-language description a `global`-modified token carries as its
 * {@link HighlightToken.description} — surfaced by `editor-cm6.ts` as the mark decoration's `title`
 * attribute, so the distinction is reachable on hover and as the span's accessible description, not
 * only as a visual treatment.
 *
 * Worded for a learner rather than for a compiler writer: `spec/execution-model.md`'s question is
 * "which binding does this name reach?", and the answer that matters to a child is that everybody
 * else can see this one. It deliberately does not say "global variable" alone — the word `global`
 * is the *spelling* the learner already sees on screen; what they cannot see is the consequence.
 */
export const OL_GLOBAL_VARIABLE_DESCRIPTION =
  "Shared variable: it was declared with global, so the whole program sees this same value.";

/** Map one parser {@link SemanticToken} onto the {@link HighlightToken} shape `editor.ts` defines. */
function toHighlightToken(token: SemanticToken): HighlightToken {
  const modifiers = token.modifiers
    .map((modifier) => OL_HIGHLIGHT_MODIFIER_CSS_CLASS[modifier])
    .filter((cssClass): cssClass is string => cssClass !== undefined);
  const description = token.modifiers.includes("global")
    ? OL_GLOBAL_VARIABLE_DESCRIPTION
    : undefined;
  return {
    text: token.text,
    class: OL_HIGHLIGHT_CSS_CLASS[token.class],
    start: token.source_span.start,
    end: token.source_span.end,
    ...(modifiers.length > 0 ? { modifiers } : {}),
    ...(description === undefined ? {} : { description }),
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
 * `semanticTokens()` (`highlight()`'s grammar-derived lexical pass plus its semantic
 * disambiguation, per `spec/tooling.md`, with the LSP-style modifiers layered on) under
 * `options.profiles` — defaulting to {@link STUDIO_PROFILES} — and map each resulting
 * {@link SemanticToken} onto a CSS-classed {@link HighlightToken}. Never throws —
 * {@link semanticTokens} inherits `highlight()`'s never-throw contract over malformed/mid-edit
 * input, so this stays safe to call on every keystroke. (It does reject a non-string `document`
 * with a `TypeError`, matching #951's guard on `highlight()`, but that is about the host's
 * arguments, not the source: the literal below can never trip it.)
 *
 * The `document` argument only labels each token's `source_span`, which {@link HighlightToken} does
 * not carry, so this passes the `"<input>"` placeholder that `parse()` still defaults to
 * (`packages/parser/src/parser.ts`) rather than inventing a studio-specific name no caller can
 * observe. It is spelled out because #951 made that parameter required — an options object in that
 * slot used to bind to it silently.
 */
export function createParserHighlighter(
  options: ParserHighlighterOptions = {},
): HighlightProvider {
  const profiles = options.profiles ?? STUDIO_PROFILES;
  return (source: string) =>
    semanticTokens(source, "<input>", { profiles }).map(toHighlightToken);
}
