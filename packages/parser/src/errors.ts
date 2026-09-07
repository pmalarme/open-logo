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
import { builtInNameOwnershipSentence } from "@openlogo/core";
import { isKeyword } from "./keywords.js";

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

/**
 * `spec/grammar.md:160-162` gives `alias-statement`, `import-statement` and `export-statement` a
 * real production that `parser.ts` does not implement, so each raises `ol-bad-token` for its own
 * grammar-correct spelling (`alias forward fd`, `export square`, `import "shapes"`, all measured).
 *
 * They are in `OL_KEYWORDS` — the profile-independent list this package calls the Core keywords —
 * but that membership carries no profile claim: `spec/grammar.md:378` says it "answers one
 * question — *may a program declare this name?* — and no other". By the DAG their behavior belongs
 * to **Modules** (`import`, `export`) and **Localization** (`alias`), which
 * `spec/conformance.md:188-189` makes dependent on Modules.
 *
 * They are excluded from {@link misplacedKeywordClause} because for them the sentence's **causality**
 * would be false. Everywhere else the reader rejects a keyword, the grammar is the reason: a keyword
 * in a position none of `spec/grammar.md:390`'s name-admitting positions cover *"has no derivation at
 * all and is a parse error"*. For these three the grammar permits the word exactly where it stands
 * and the **implementation** is behind, so blaming OpenLogo's ownership would teach a learner
 * something untrue about the language. They keep the bare message until the reader can read them.
 */
export const KEYWORDS_WITH_NO_READER_PRODUCTION: ReadonlySet<string> = new Set([
  "alias",
  "export",
  "import",
]);

/**
 * The sentence that follows `i don't know how to read <text> here.` when `text` is a Core keyword —
 * or the empty string when it is not, which is the common case, since most `ol-bad-token` findings
 * name a stray delimiter, a number, or lexical garbage.
 *
 * `spec/error-model.md:110` asks this message to *"point at the unexpected text and mention the
 * closest legal form when clear"*. The first half was already done; this adds the concept behind the
 * rejection (issue #878). It deliberately stops short of naming a form, and the reason is measured
 * rather than assumed — see {@link parseDiag.badToken}.
 *
 * Membership comes from `keywords.ts`'s {@link isKeyword} with no active profiles, which consults
 * the profile-independent `OL_KEYWORDS` alone. Reusing it rather than rebuilding a set keeps
 * `keywords.ts` the single registry, so a keyword added there is covered here with no second edit.
 * Its matching is already case-insensitive, so a learner who writes `Repeat` is met the same way;
 * `text` itself is quoted back exactly as written. The exclusion lookup is normalized for the same
 * reason and on the same axis — `Alias forward fd` must keep the bare message just as
 * `alias forward fd` does — and a test pins that arm, because review found a mutant that dropped the
 * normalization and survived the suite.
 *
 * The sentence itself comes from `@openlogo/core`'s {@link builtInNameOwnershipSentence}, not from a
 * literal here: this stage and the two declaration-slot producers must say the same thing about the
 * same fact, and issue #1025 found that agreement resting on nothing (see that module's doc). Only
 * the leading space and the absent repair tail are this site's own, and both are deliberate — see
 * {@link parseDiag.badToken} for why the parse stage names the owner but no repair.
 */
function misplacedKeywordClause(text: string): string {
  if (
    !isKeyword(text) ||
    KEYWORDS_WITH_NO_READER_PRODUCTION.has(text.toLowerCase())
  ) {
    return "";
  }
  return ` ${builtInNameOwnershipSentence(text)}`;
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

  /**
   * The token the grammar cannot use here, named — plus, when that token is a Core keyword, the
   * concept behind the rejection: OpenLogo already owns the word (issue #878). Before this,
   * `repeat value [ ]` said only `i don't know how to read value here.`, which is true and leaves the
   * learner with nothing to think about.
   *
   * **It names the owner, not a repair, and that boundary is measured rather than chosen.**
   * `spec/error-model.md:110` asks for *"the closest legal form when clear"*, and at the parse stage
   * it is not clear, for two independent reasons:
   *
   * - **The reader is profile-blind by design** (`reserved-word-value-position.test.mjs`; it is why
   *   issue #864 needed a semantic checker), yet every word issue #878 names is an optional-profile
   *   word. `spec/conformance.md:102-104` puts `add`, `remove`, `clear`, `insert`, dicts and structs
   *   in **Data**; `spec/grammar.md:390` says a bare `value` heads the heritage reader *"where
   *   Heritage is present, and nothing at all where it is not"*. Quoting such a form would answer a
   *   learner who copies it with `ol-unknown-command` — for `make`, with `did you mean set?`,
   *   contradicting the hint that sent them there. This is the load-bearing reason.
   * - **A context-free did-you-mean is right only half the time.** Substituting `:word`, the repair
   *   #878's own text proposes, repairs `repeat value [ ]`, `print 1 + set`, and a completed
   *   `define f (:x set)` — but not `print ( set 1 )`, `struct point set`, or `remove 1 set :sizes`:
   *   **3 of 6**. Getting it right needs the grammar slot, which this shared builder never sees;
   *   threading it through `parser.ts`'s recovery paths is issue #879's territory.
   *
   * **The sentence stops at ownership and makes no claim about *why* this token was rejected.**
   * That is not terseness, it is the only claim measurement supports. An earlier revision ended
   * *"…so it cannot be read as a name here"*, and review showed the causal tail is false often enough
   * to matter: substituting an ordinary name, `struct point wibble` and `remove 1 wibble :sizes` are
   * rejected too — those slots want `[` and `from` — so ownership is the actual cause at **four of
   * the six** probed positions, not all six. `spec/grammar.md:390` guarantees only the weaker
   * proposition, that a keyword outside its name-admitting positions is *"a parse error"* with *"no
   * derivation at all"*. Naming the cause correctly needs the grammar slot, which this shared builder
   * never sees, so the sentence asserts what is true everywhere and stops.
   *
   * The wording is `ol-reserved-word`'s prescribed opening (`spec/error-model.md:125`) **verbatim,
   * capital and all**, so the two codes that answer the same learner question speak with one voice,
   * and the ban on the words *keyword*, *primitive*, and *alias* is honoured. Review measured that an
   * earlier lowercase `openlogo` broke that claim on the one word carrying it: `checker-reserved-word.ts`
   * ships `OpenLogo`, `spec/error-model.md:125` writes `OpenLogo`, and 22 existing fixture rows carry
   * it. Lowercasing has a real argument — `spec/error-model.md:18` asks for a *"warm, lowercase Logo
   * voice"*, and this is otherwise the message's only capital — but it is a house-wide question about
   * the product name, and starting the divergence in the smaller sibling would leave the two codes
   * saying the same sentence two ways. If the house style is settled as lowercase, sweep
   * `checker-reserved-word.ts` and its fixtures with it.
   *
   * **The prescribed second clause, `choose another name.`, is deliberately dropped and must not be
   * restored here**: that advice is right for `ol-reserved-word`, which fires on a *declaration*, and
   * wrong for this code, because `spec/grammar.md:386` makes binding a keyword legal — `local set` and
   * `for set in [ 1 2 3 ] [ print :set ]` are conforming programs — and renaming repairs only three
   * of the six positions above. A test pins the binding half, and another pins that the clause stays
   * out.
   *
   * The addition is prose only. `params` stays `{ text }` — the single entry the registry row lists,
   * and the shape `spec/tooling.md:170`'s own worked `ol-bad-token` example uses while its message
   * names a legal form — so diagnostic identity is untouched and consumers matching on
   * `ol-bad-token` are unaffected. The first sentence stays byte-identical to the profile half of the
   * same rule (`checker-profile-word-position.ts`, issue #864).
   */
  badToken(span: SourceSpan, text: string): Diagnostic {
    return parseError(
      "ol-bad-token",
      span,
      { text },
      `i don't know how to read ${text} here.${misplacedKeywordClause(text)}`,
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
