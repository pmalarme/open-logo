/**
 * The normative OpenLogo **keyword** registry
 * ([`spec/grammar.md`](../../../spec/grammar.md#keywords-primitives-and-built-in-names)). A keyword
 * is a word the grammar itself gives meaning to rather than a name a program can introduce —
 * `define`, `if`, `end`, `and`, `mod`. Keywords and primitives together are OpenLogo's **built-in
 * names**, governed by one rule (`spec/grammar.md:365`):
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
 *   dictionary key (`spec/grammar.md:390`, a normative MUST). The rule is enforced at the four
 *   *declaration slots* instead, which is what makes it unbypassable — see
 *   `checker-reserved-word.ts`.
 * - **Highlighting.** `mod` is on this list for the same reason `and`, `or`, and `not` are: all
 *   four are word-spelled operators of the expression grammar rather than callable primitives. Like
 *   `and`, `mod` is still painted `operator` — `highlight.ts`'s `OL_WORD_OPERATORS` is consulted
 *   before this registry — because the `keyword` **token class** and this list "are different sets
 *   on purpose" (`spec/grammar.md:380`). Reserved-list membership and token class are independent
 *   axes.
 *
 * The four contextual keywords `empty`, `member`, `of`, and `a` are deliberately **absent**: they
 * are structural *by position only*, so a program may still declare them — `define of` is legal and
 * `value of :d for key "a"` still reports the key's value afterwards (`spec/grammar.md:382`). Their
 * *highlighting* is positional too: `spec/tooling.md:97-99` marks them `keyword` only inside an
 * `is`-predicate or the heritage `value of … for key` reader (issue #785), and an ordinary name
 * everywhere else. Registry membership is unaffected by that: none of the four is ever a keyword.
 *
 * Profile block-heads (`ask`/`each`/`tell`, `when`/`every`/`on_key`/`on_click`) are **not** in
 * {@link OL_KEYWORDS}: they live in the separate {@link OL_PROFILE_KEYWORDS} registry, whose doc
 * comment records the profile-gating this ruling reverses and the slice that lands it.
 */

/**
 * The keywords, in the grammar's grouping order (`spec/grammar.md:370-378`).
 *
 * **Adding or removing a keyword edits several places.** Deliberately listed rather than counted,
 * because the count is itself the kind of claim nothing recomputes — and it names which gate covers
 * each, because "gated" alone hides *which* gate, and the last entry below is held by a different
 * one:
 *
 * - `spec/grammar.md:370-377` — normative; `npm run built-in-names` compares its extracted words
 *   against `spec/built-in-names.json`.
 * - `spec/tooling.md:91-94` — mirrors that block; the same gate compares **the same extracted words
 *   in the same order**. Not the bytes: the extractor takes the backticked words, so changing the
 *   spacing *between* them leaves the gate green. Whitespace that breaks the paragraph does not —
 *   a blank line inside it truncates the extraction and is a finding.
 * - this array — reaches that comparison through `spec/built-in-names.json`, in both directions.
 * - `spec/built-in-names.json` itself — the authoritative list, added by #841.
 * - `spec/tooling.md:30` — the `keyword` **token class**, a different set on purpose
 *   (`spec/grammar.md:380`). Since issue #959 the row no longer enumerates it: each name's class is
 *   declared as `tokenClass` in `spec/built-in-names.json`, and the same gate re-paints every name
 *   through `highlight()` and compares. The reverse direction reads the name **sources**
 *   `highlight()` classifies from — this array among them — rather than arbitrary output.
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
 * **Two different questions read this registry, and only one of them is profile-gated.** Confusing
 * them is what issue #841 came to fix, so the split is stated here rather than at each call site:
 *
 * - **May a program declare this name?** No. `spec/grammar.md:412` makes profile words built-in
 *   names **unconditionally** — "a program cannot declare which profiles it requires … so a name
 *   that could be declared in one implementation but not in another would be invisible and
 *   unpredictable to a learner", and "what a profile decides is whether a name *works*, never
 *   whether a program may declare it". {@link isKeywordInAnyProfile} answers this one, and takes no
 *   profile set because there is none to take. It is about the four **declaration** slots only:
 *   `spec/grammar.md:390` makes accepting any of these words as a **binding** a MUST, so
 *   `local ask` and `for ask in :xs` stay legal whatever the profile set.
 * - **Does this word paint as a keyword?** Only while its profile is active, which
 *   `spec/tooling.md:30`'s `keyword` row states directly ("Profile words … take this class while
 *   their profile is active"). {@link isKeyword}'s two-argument form answers this one and stays
 *   profile-gated, because here the gate is what the spec asks for.
 *
 * Issue #855 aligned the rest of the spec with the `:412` ruling, so `turtles-and-sprites.md:154`,
 * `interaction-events.md#profiles-and-reservation`, and `spec/tooling.md:100-104` state the
 * unconditional rule too.
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
 * The keywords one conformance profile contributes, in registration order, or an empty list for a
 * profile that contributes none — the enumerable counterpart of {@link isProfileKeyword}, read
 * straight off {@link OL_PROFILE_KEYWORDS}.
 *
 * It exists so a consumer that must *list* a profile's reserved heads (the checker's visible-name
 * model, `checker-names.ts`) reads them from the same profile-keyed registry that answers whether a
 * word **is** one, instead of keeping a parallel per-profile table beside it. Core's keywords are
 * deliberately not reachable here: {@link OL_KEYWORDS} is profile-independent by definition, and
 * folding it in would make `isKeyword`'s profile gate — the paint axis `spec/tooling.md:30` asks
 * for — answer `true` for a Core word under a profile that does not contribute it.
 */
export function profileKeywords(profile: string): readonly string[] {
  return OL_PROFILE_KEYWORDS[profile as KeywordProfile] ?? [];
}

/**
 * Is `name` a keyword of one of the given `activeProfiles`? A word counts only when at least one
 * profile that contributes it is active — a Core-only caller (empty or Core-only `activeProfiles`)
 * never gets a match here. Matching is case-insensitive, like {@link isKeyword}.
 *
 * **"Not a keyword here" does not mean "an ordinary name".** This is the paint/position axis only:
 * a word that fails this test still may not be **declared**, because `spec/grammar.md:412` makes
 * profile words built-in names unconditionally — ask {@link isKeywordInAnyProfile} for that.
 * Under Core alone `when` is not painted as a keyword and is not structural in value position, yet
 * `define when` is still `ol-reserved-word`.
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
 * Every profile that contributes keywords, straight off {@link OL_PROFILE_KEYWORDS}'s own keys, so
 * a profile that starts contributing keywords is covered without editing this line.
 */
const ALL_KEYWORD_PROFILES: readonly string[] =
  Object.keys(OL_PROFILE_KEYWORDS);

/**
 * Is `name` a keyword of Core **or of any profile at all**, active or not? This is the
 * **declaration** axis of `spec/grammar.md:412` — "what a profile decides is whether a name
 * *works*, never whether a program may declare it" — so `ask`, `tell`, `when` and friends answer
 * `true` here even for a Core-only program, and `define ask` is `ol-reserved-word` in every
 * conformance profile set.
 *
 * It is {@link isKeyword} with every keyword-contributing profile supplied, not a second registry:
 * the profile list is derived from {@link OL_PROFILE_KEYWORDS}'s keys, so no keyword is restated
 * here and the two predicates cannot disagree about what a keyword is — only about *when* it
 * counts. Keep the profile-gated {@link isKeyword} for the paint axis, where `spec/tooling.md:30`
 * does ask for a gate.
 *
 * "Declare" is exact: this is the four declaration slots of `spec/grammar.md:384`, not bindings.
 * `spec/grammar.md:390` makes accepting a keyword as a **binding** a MUST, so `local ask` stays
 * legal whatever this answers.
 */
export function isKeywordInAnyProfile(name: string): boolean {
  return isKeyword(name, ALL_KEYWORD_PROFILES);
}

/**
 * Is `name` a keyword? Matching is case-insensitive because OpenLogo identifiers are
 * case-insensitive with lowercase canonical.
 *
 * With no `activeProfiles` (or a Core-only set) this consults only the profile-independent
 * {@link OL_KEYWORDS} — its long-standing behavior, kept **unchanged** so the Core keyword list
 * never grows. When `activeProfiles` is supplied, any {@link OL_PROFILE_KEYWORDS} word contributed
 * by an active profile also counts, so a consumer that already threads the active profile set gets
 * profile-aware matching from this one registry without forking it.
 *
 * **`highlight.ts` is the only caller that varies the answer by profile**, and since issue #841 it
 * is the only one that should: it passes the program's active profile set so
 * `spec/tooling.md:30`'s "while their profile is active" clause is decided here rather than
 * re-derived there. `checker-style.ts` also calls this form, but passes *every* keyword-contributing
 * profile, so it is asking the unconditional question through the two-argument door. The callers
 * that ask the *declaration* question — whether a program may **declare** the name — moved to
 * {@link isKeywordInAnyProfile}, because `spec/grammar.md:412` makes that answer
 * profile-independent. None of them asks about **bindings**, which `spec/grammar.md:390` requires
 * every consumer to accept regardless.
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
