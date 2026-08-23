/**
 * The normative OpenLogo **keyword** registry
 * ([`spec/grammar.md`](../../../spec/grammar.md#keywords-primitives-and-built-in-names)). A keyword
 * is a word the grammar itself gives meaning to rather than a name a program can introduce —
 * `define`, `if`, `end`, `and`, `mod`. Keywords and primitives together are OpenLogo's **built-in
 * names**, governed by one rule (`spec/grammar.md:363`):
 *
 * > **A program may not declare a built-in name. A program may bind a value to any name.**
 *
 * This is the single registry the highlighter and the checker share — do not fork it (see
 * `parser.instructions.md`). The reader keeps its own, deliberately narrower
 * `NON_PRIMARY_NAMES`/`END_LABELS` tables in `parser.ts`: those answer "may this word begin an
 * expression?", which is a different question from this registry's.
 *
 * Keywords are matched case-insensitively with lowercase as canonical, so {@link isKeyword}
 * normalizes to lowercase before looking a name up.
 *
 * **Membership answers exactly one question: may a program *declare* this name?** Two things it
 * deliberately does not decide:
 *
 * - **Binding.** A keyword is free in every binding position — `:end = 1`, `set end to 1`,
 *   `make "end" 1`, `local count`, a parameter, a `for`/comprehension binder, a struct field, a
 *   dictionary key (`spec/grammar.md:386`, a normative MUST). The rule is enforced at the four
 *   *declaration slots* instead, which is what makes it unbypassable — see
 *   `checker-reserved-word.ts`.
 * - **Highlighting.** `mod` is on this list for the same reason `and`, `or`, and `not` are: all
 *   four are word-spelled operators of the expression grammar rather than callable primitives. Like
 *   `and`, `mod` is still painted `operator` — `highlight.ts`'s `WORD_OPERATORS` is consulted
 *   before this registry — because the `keyword` **token class** and this list "are different sets
 *   on purpose" (`spec/grammar.md:378`). Reserved-list membership and token class are independent
 *   axes.
 *
 * The four contextual keywords `empty`, `member`, `of`, and `a` are deliberately **absent**: they
 * are structural *by position only*, so a program may still declare them — `define of` is legal and
 * `value of :d for key "a"` still reports the key's value afterwards (`spec/grammar.md:380`). Their
 * *highlighting* is positional too: `spec/tooling.md:97-99` marks them `keyword` only inside an
 * `is`-predicate or the heritage `value of … for key` reader (issue #785), and an ordinary name
 * everywhere else. Registry membership is unaffected by that: none of the four is ever a keyword.
 *
 * Profile block-heads (`ask`/`each`/`tell`, `when`/`every`/`on_key`/`on_click`) are **not** in
 * {@link OL_KEYWORDS}: they live in the separate {@link OL_PROFILE_KEYWORDS} registry, whose doc
 * comment records the profile-gating this ruling reverses and the slice that lands it.
 */

/**
 * The keywords, in the grammar's grouping order (`spec/grammar.md:368-376`).
 *
 * **Adding or removing a keyword edits several places.** Deliberately listed rather than counted,
 * because the count is itself the kind of claim nothing recomputes — and it names which gate covers
 * each, because "gated" alone hides the difference between a comparison and a change detector:
 *
 * - `spec/grammar.md:368-375` — normative; `npm run built-in-names` compares its extracted words
 *   against `spec/built-in-names.json`.
 * - `spec/tooling.md:91-94` — mirrors that block; the same gate compares **the same extracted words
 *   in the same order**. Not the bytes: the extractor takes the backticked words, so a
 *   whitespace-only edit to that paragraph changes the file and the gate stays green.
 * - this array — reaches that comparison through `spec/built-in-names.json`, in both directions.
 * - `spec/built-in-names.json` itself — the authoritative list, added by #841.
 * - `spec/tooling.md:30` — the `keyword` **token class**, a different set on purpose
 *   (`spec/grammar.md:378`). **Change-detected only**: a content fingerprint notices an edit, and
 *   nothing verifies the edited row is still correct.
 * - `keywords.profiles.test.mjs`'s `EXPECTED_CORE_KEYWORDS` — asserted against this array by the
 *   pre-existing `npm run test`, not by `npm run built-in-names`.
 *
 * The gate exists because the `tooling.md` mirror had already drifted to 43 words (missing `mod`)
 * before #855 restored it, with nothing reading `spec/*.md` to notice.
 */
export const OL_KEYWORDS = [
  // Procedures and control transfer.
  "define",
  "to",
  "end",
  "return",
  "output",
  "op",
  "stop",
  "throw",
  // Assignment and binding.
  "set",
  "make",
  "local",
  "thing",
  // Control forms and their contextual prepositions.
  "if",
  "else",
  "while",
  "repeat",
  "for",
  "forever",
  "in",
  "from",
  "at",
  "by",
  // Data access and mutation.
  "key",
  "value",
  "add",
  "remove",
  "insert",
  "clear",
  // Comprehensions.
  "map",
  "filter",
  "reduce",
  // Logic, the word-spelled arithmetic operator, and boolean literals.
  "and",
  "or",
  "not",
  "mod",
  "true",
  "false",
  // Worded predicates.
  "is",
  "between",
  "strictly",
  // Types, aliases, and modules.
  "struct",
  "alias",
  "import",
  "export",
] as const;

/** One keyword. */
export type Keyword = (typeof OL_KEYWORDS)[number];

const KEYWORDS = new Set<string>(OL_KEYWORDS);

/**
 * The **profile** keywords (C1, issue #663): profile block-heads and mode-switch commands that
 * are structural tokens of an optional profile rather than of Core. They are deliberately
 * **absent** from {@link OL_KEYWORDS}, which stays the profile-independent Core list.
 *
 * Each key is a profile identifier matching the conformance harness's spelling (mirroring
 * `check.ts`'s `OL_CHECK_PROFILES`); each value lists that profile's keywords:
 *
 * - `"sprites"` — the block-heads `ask` and `each` plus the mode-switch command `tell`
 *   (`spec/turtles-and-sprites.md#reserved-words-in-this-profile`).
 * - `"interaction-events"` — the event block-heads `when`, `every`, `on_key`, and `on_click`
 *   (`spec/interaction-events.md#profiles-and-reservation`).
 *
 * **These words are still gated on their profile here, and the spec no longer is.**
 * `spec/grammar.md:408` says profile words are built-in names **unconditionally** — "a program
 * cannot declare which profiles it requires … so a name that could be declared in one
 * implementation but not in another would be invisible and unpredictable to a learner", and "what a
 * profile decides is whether a name *works*, never whether a program may declare it". Issue #855
 * aligned the rest of the spec with that ruling, so `turtles-and-sprites.md:154`,
 * `interaction-events.md#profiles-and-reservation`, and `spec/tooling.md:100-104` now state the
 * unconditional rule too. The always-on built-in-names list that retires this gate is still #841:
 * until it lands, {@link isKeyword} keeps consulting this registry only for **active** profiles —
 * the behavior every current caller and fixture is written against — so this comment records a
 * known, tracked deviation from the spec rather than a rule the spec still states.
 */
export const OL_PROFILE_KEYWORDS = {
  sprites: ["ask", "each", "tell"],
  "interaction-events": ["when", "every", "on_key", "on_click"],
} as const satisfies Readonly<Record<string, readonly string[]>>;

/** A profile identifier that contributes keywords (a key of {@link OL_PROFILE_KEYWORDS}). */
export type KeywordProfile = keyof typeof OL_PROFILE_KEYWORDS;

/** One profile keyword (a value of {@link OL_PROFILE_KEYWORDS}). */
export type ProfileKeyword =
  (typeof OL_PROFILE_KEYWORDS)[KeywordProfile][number];

const PROFILE_KEYWORDS: ReadonlyMap<string, ReadonlySet<string>> = new Map(
  Object.entries(OL_PROFILE_KEYWORDS).map(([profile, words]) => [
    profile,
    new Set<string>(words),
  ]),
);

/**
 * Is `name` a keyword of one of the given `activeProfiles`? A word counts only when at least one
 * profile that contributes it is active — a Core-only caller (empty or Core-only `activeProfiles`)
 * never gets a match here, so those words stay ordinary names. Matching is case-insensitive, like
 * {@link isKeyword}.
 *
 * Returns a plain `boolean` (not a type predicate): because matching is case-insensitive, a
 * mixed-case `name` like `"ASK"` matches yet is not literally a lowercase-canonical
 * {@link ProfileKeyword}, so narrowing to that union would be unsound (it could make an
 * exhaustive `switch` branch look unreachable). Every consumer treats the result opaquely.
 */
export function isProfileKeyword(
  name: string,
  activeProfiles: readonly string[],
): boolean {
  const lower = name.toLowerCase();
  for (const profile of activeProfiles) {
    if (PROFILE_KEYWORDS.get(profile)?.has(lower)) {
      return true;
    }
  }
  return false;
}

/**
 * Is `name` a keyword? Matching is case-insensitive because OpenLogo identifiers are
 * case-insensitive with lowercase canonical.
 *
 * With no `activeProfiles` (or a Core-only set) this consults only the profile-independent
 * {@link OL_KEYWORDS} — its long-standing behavior, kept **unchanged** so the Core keyword list
 * never grows. When `activeProfiles` is supplied, any {@link OL_PROFILE_KEYWORDS} word contributed
 * by an active profile also counts, so a consumer that already threads the active profile set gets
 * profile-aware matching from this one registry without forking it. Both consumers now do: the
 * **checker** (`check.ts`) and, since issue #740, the **highlighter** — `highlight.ts` calls this
 * two-argument form so `spec/tooling.md:30`'s "while their profile is active" clause is decided
 * here rather than re-derived there.
 *
 * Returns a plain `boolean` rather than a type predicate: matching is case-insensitive, so a
 * mixed-case keyword `name` is not literally a lowercase-canonical `Keyword`/`ProfileKeyword`, and
 * narrowing to that union would be unsound. Consumers use the result as a yes/no test, never for
 * type narrowing.
 */
export function isKeyword(
  name: string,
  activeProfiles: readonly string[] = [],
): boolean {
  return (
    KEYWORDS.has(name.toLowerCase()) || isProfileKeyword(name, activeProfiles)
  );
}
