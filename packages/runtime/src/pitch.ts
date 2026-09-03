/**
 * Scientific-pitch-notation validation for the Sound profile's `note` primitive (issue #690,
 * [`spec/interaction-events.md`](../../../spec/interaction-events.md)'s "Sound primitives" section:
 * "Pitch words use scientific pitch notation with lowercase canonical spelling, such as `"c4"`,
 * `"fs4"` for F sharp, and `"bb3"` for B flat"). The runtime is headless — it never resolves a
 * pitch to a frequency or touches an audio device — so this validates only the *spelling* of the
 * pitch word, exactly as much as the deterministic `sound` trace event needs (the `pitch` string is
 * carried through verbatim). A pitch word is:
 *
 * - a letter `a`–`g` (lowercase canonical spelling),
 * - an optional single accidental — `s` for sharp or `b` for flat,
 * - an octave: one or more decimal digits.
 *
 * Matching is exact/case-sensitive: the spec mandates the *lowercase canonical spelling*, so `"C4"`
 * or `"FS4"` is not a valid pitch and raises `ol-type` — consistent with how the language treats
 * words as case-significant elsewhere. `play` (issue #691) reuses this validator for each melody
 * pitch that is not the literal word `"rest"`.
 */

const PITCH_PATTERN = /^[a-g][sb]?[0-9]+$/;

/**
 * Whether `word` is a well-formed scientific-pitch-notation pitch word accepted by `note`
 * (see the module doc for the exact grammar). Returns `false` for the empty string, mixed case, a
 * double accidental (`"css4"`), a missing octave (`"c"`), or a non-pitch word (`"hello"`).
 */
export function isValidPitch(word: string): boolean {
  return PITCH_PATTERN.test(word);
}
