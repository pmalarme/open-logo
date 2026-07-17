/**
 * Token classes — the normative highlighting / semantic-token contract.
 *
 * The highlighter and LSP semantic-token provider (`@openlogo/parser`, consumed
 * by `@openlogo/studio` and external editors) classify tokens into exactly these
 * 15 classes from `spec/tooling.md` ("Normative token-class model"). The final
 * class depends on grammatical position, not ad-hoc regex, so classification is
 * a parser concern; this module only fixes the stable set of class names.
 *
 * Class names are transcribed verbatim from the spec, including the ones that
 * carry punctuation (`word/string`, `:variable`, `index/dot`), so tools and
 * editors agree on one vocabulary. Types + registry data only — no behavior.
 */

/**
 * The 15 normative token classes (`spec/tooling.md`). Order follows the spec's
 * table.
 */
export const TOKEN_CLASSES = [
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
export type TokenClass = (typeof TOKEN_CLASSES)[number];
