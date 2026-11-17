/**
 * `print_under_the_shell` — a hidden incantation, dispatched beside `print` in
 * `execute-internal.ts`.
 *
 * It is deliberately **not** a specified primitive: it appears in no `spec/` file, in no
 * `@openlogo/parser` registry, and therefore in no `spec/built-in-names.json` row. The semantic
 * checker does not know the word and will call it unknown; the evaluator answers anyway. That is
 * the whole point of it — a thing you can only find by wandering off the documented path.
 *
 * Because it is unspecified it emits no new event kind and invents no diagnostic: it reuses
 * `print`'s own `print` event, one per line, so every host that can already show `print` output
 * shows this too, with no host change anywhere.
 */

/**
 * The message, asleep. Every letter was walked forward around the alphabet; everything that is
 * not a letter was left exactly where it stood.
 *
 * ----------------------------------------------------------------------------------------------
 *  A riddle, for whoever found this without being told it was here:
 *
 *      Everything has a first day, this repository included. Find the day it drew
 *      its first breath — the oldest commit there is, the one with nothing behind
 *      it. The history is right here; you already have everything you need to ask.
 *
 *      Write that day as we write days: two digits for the day, two for the month,
 *      four for the year. Eight digits, with nothing at all between them.
 *
 *      That is my stride, and it changes with every letter: the first letter moves
 *      by the first digit, the second letter by the second digit, and when the
 *      eight run out you simply begin the date over. Each new line begins it over
 *      too, so any line can be solved on its own.
 *
 *      Walk every letter BACK by its digit, and leave everything that is not a
 *      letter exactly where it stands. A letter that walks back past `a` comes
 *      around at `z`.
 *
 *      Then the turtle will say what it has been holding all along.
 * ----------------------------------------------------------------------------------------------
 */
const SLEEPING_MESSAGE: readonly string[] = [
  "Iklsq, Cjgsril. 🐢",
  "Jl yvw fqaoj toks, auv grl cltkbjy lzpnusonn deauoj tog ipyuxujviqtt.",
  "Egd hrptuwks. ❤️",
  "",
  "J hupnt vnjy sv aow ipalk fiuipbey rrqmsgmtkni zik wha I foe:",
  'ce pscykth, kxwnotoom, auf wqtekrppg "ynbz im?"',
  "",
  "Ouw nq mcqf yotgtjoom I ugvgx jsankngj.",
];

/**
 * The two alphabets the walk goes around, matched **directly** rather than through
 * `toLowerCase()`. Case folding looked equivalent and was not: a handful of non-ASCII characters
 * fold onto ASCII letters — `U+212A KELVIN SIGN` lowercases to a plain `k` — so a folding walk
 * would have consumed a stride for one and rewritten it as an ordinary letter, quietly breaking
 * both the "everything that is not a letter is left where it stands" guarantee and the round trip
 * for any message that ever contained one.
 */
const LOWERCASE_ALPHABET = "abcdefghijklmnopqrstuvwxyz";
const UPPERCASE_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/**
 * The riddle's stride, as `DDMMYYYY`: the day this repository's first commit landed. Deliberately
 * a date the repository itself can answer for — `git log --reverse` reaches it, and the history is
 * public — rather than a date belonging to a person. A private date would have meant publishing
 * someone's identifying information in plain text beside their name.
 */
const FIRST_DAY = "16072026";

/**
 * {@link FIRST_DAY}'s digits, in order — one step each, then round again. Every digit is below
 * the alphabet's length, which is what lets {@link walkedBack} wrap with a single `+ 26`.
 */
const STRIDES: readonly number[] = [...FIRST_DAY].map(Number);

/**
 * Walk one character back by `stride`, wrapping around the top of the alphabet. A character that
 * is not an ASCII letter — punctuation, a space, a turtle — is returned untouched and reports
 * having spent no stride, which is why the emoji in {@link SLEEPING_MESSAGE} are readable in the
 * source above and why they never push the date out of step.
 *
 * Exported solely so `under-the-shell.test.mjs` can drive the case-folding guarantee directly
 * (the repo's established `../dist/<module>.js` test-import pattern). Asserting that guarantee
 * against the fixed message alone could not fail, because the fixed message contains no folding
 * character — the test has to hand one to this function.
 */
export function walkedBack(
  character: string,
  stride: number,
): { readonly character: string; readonly isLetter: boolean } {
  const lowercaseIndex = LOWERCASE_ALPHABET.indexOf(character);
  if (lowercaseIndex >= 0) {
    return {
      character: LOWERCASE_ALPHABET[
        (lowercaseIndex - stride + LOWERCASE_ALPHABET.length) %
          LOWERCASE_ALPHABET.length
      ] as string,
      isLetter: true,
    };
  }
  const uppercaseIndex = UPPERCASE_ALPHABET.indexOf(character);
  if (uppercaseIndex >= 0) {
    return {
      character: UPPERCASE_ALPHABET[
        (uppercaseIndex - stride + UPPERCASE_ALPHABET.length) %
          UPPERCASE_ALPHABET.length
      ] as string,
      isLetter: true,
    };
  }
  return { character, isLetter: false };
}

/**
 * Wake {@link SLEEPING_MESSAGE} up: the lines of the message in plain text, in order, ready to be
 * emitted one `print` event each. Blank lines are preserved, because the message is shaped, and
 * every line restarts the date so that each one can be solved on its own.
 */
export function messageUnderTheShell(): string[] {
  return SLEEPING_MESSAGE.map((line) => {
    let spent = 0;
    let woken = "";
    for (const character of line) {
      const step = walkedBack(
        character,
        STRIDES[spent % STRIDES.length] as number,
      );
      woken += step.character;
      spent += step.isLetter ? 1 : 0;
    }
    return woken;
  });
}
