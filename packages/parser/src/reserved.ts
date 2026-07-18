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
 * Is `name` a reserved structural word? Matching is case-insensitive because OpenLogo
 * identifiers are case-insensitive with lowercase canonical.
 */
export function isReservedWord(name: string): name is ReservedWord {
  return RESERVED.has(name.toLowerCase());
}
