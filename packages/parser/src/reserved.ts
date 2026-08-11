/**
 * The normative OpenLogo reserved-word registry (C19 in
 * [`spec/grammar.md`](../../../spec/grammar.md)). Reserved words are structural tokens the
 * reader recognizes; they may not be redefined as variables, procedures, primitives, or
 * struct constructors. This is the single registry shared by the lexer, the highlighter,
 * and the checker — do not fork it (see `parser.instructions.md`).
 *
 * Keywords are matched case-insensitively with lowercase as canonical, so
 * {@link isReservedWord} normalizes to lowercase before looking a name up. The four
 * contextual keywords `empty`, `member`, `of`, and `a` are deliberately **absent**: they act
 * as keywords only just after `is` and stay ordinary names everywhere else.
 *
 * Profile block-heads (`ask`/`each`/`tell`, `when`/`every`/`on_key`/`on_click`) are **not** in
 * {@link OL_RESERVED_WORDS}: they live in the profile-conditional {@link OL_PROFILE_RESERVED_WORDS}
 * registry and are reserved only when their profile is active (C1, issue #663).
 */

/** The reserved structural words, in the grammar's C19 grouping order. */
export const OL_RESERVED_WORDS = [
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
  // Logic and boolean literals.
  "and",
  "or",
  "not",
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

/** One reserved structural word. */
export type ReservedWord = (typeof OL_RESERVED_WORDS)[number];

const RESERVED = new Set<string>(OL_RESERVED_WORDS);

/**
 * The **profile-conditional** reserved words (C1, issue #663). Certain profile block-heads and
 * mode-switch commands are structural tokens *only when their profile is active*; a Core-only
 * program may still use them as ordinary variable, procedure, or struct-constructor names.
 * They are deliberately **absent** from {@link OL_RESERVED_WORDS}, which stays the pure Core
 * (profile-independent) list — see `spec/grammar.md#reserved-words-and-namespaces`:
 * "Profile-specific reserved words are recognized only when their profile is active."
 *
 * Each key is a profile identifier matching the conformance harness's spelling (mirroring
 * `check.ts`'s `OL_CHECK_PROFILES`); each value lists the words that profile reserves:
 *
 * - `"sprites"` — the block-heads `ask` and `each` plus the mode-switch command `tell`
 *   (`spec/turtles-and-sprites.md#reserved-words-in-this-profile`).
 * - `"interaction-events"` — the event block-heads `when`, `every`, `on_key`, and `on_click`
 *   (`spec/interaction-events.md#profiles-and-reservation`).
 *
 * Redefining any of these as a variable, procedure, or struct constructor while the owning
 * profile is active raises `ol-reserved-word` (`spec/error-model.md`), exactly as a Core reserved
 * word does; with the profile inactive the same name is free to declare.
 */
export const OL_PROFILE_RESERVED_WORDS = {
  sprites: ["ask", "each", "tell"],
  "interaction-events": ["when", "every", "on_key", "on_click"],
} as const satisfies Readonly<Record<string, readonly string[]>>;

/** A profile identifier that reserves extra structural words (a key of {@link OL_PROFILE_RESERVED_WORDS}). */
export type ReservingProfile = keyof typeof OL_PROFILE_RESERVED_WORDS;

/** One profile-conditional reserved word (a value of {@link OL_PROFILE_RESERVED_WORDS}). */
export type ProfileReservedWord =
  (typeof OL_PROFILE_RESERVED_WORDS)[ReservingProfile][number];

const PROFILE_RESERVED: ReadonlyMap<string, ReadonlySet<string>> = new Map(
  Object.entries(OL_PROFILE_RESERVED_WORDS).map(([profile, words]) => [
    profile,
    new Set<string>(words),
  ]),
);

/**
 * Is `name` reserved by the profile-conditional registry under the given `activeProfiles`?
 * A word counts only when at least one profile that reserves it is active — a Core-only caller
 * (empty or Core-only `activeProfiles`) never gets a match here, so those words stay ordinary
 * names. Matching is case-insensitive, like {@link isReservedWord}.
 */
export function isProfileReservedWord(
  name: string,
  activeProfiles: readonly string[],
): name is ProfileReservedWord {
  const lower = name.toLowerCase();
  for (const profile of activeProfiles) {
    if (PROFILE_RESERVED.get(profile)?.has(lower)) {
      return true;
    }
  }
  return false;
}

/**
 * Is `name` a reserved structural word? Matching is case-insensitive because OpenLogo
 * identifiers are case-insensitive with lowercase canonical.
 *
 * With no `activeProfiles` (or a Core-only set) this consults only the profile-independent
 * {@link OL_RESERVED_WORDS} — its long-standing behavior, kept **unchanged** so the Core
 * reserved-word list never grows. When `activeProfiles` is supplied, any profile-conditional
 * word ({@link OL_PROFILE_RESERVED_WORDS}) reserved by an active profile also counts, so a
 * consumer that already threads the active profile set (the checker, the highlighter) gets
 * profile-aware reservation from this one registry without forking it.
 */
export function isReservedWord(
  name: string,
  activeProfiles: readonly string[] = [],
): name is ReservedWord | ProfileReservedWord {
  return (
    RESERVED.has(name.toLowerCase()) ||
    isProfileReservedWord(name, activeProfiles)
  );
}
