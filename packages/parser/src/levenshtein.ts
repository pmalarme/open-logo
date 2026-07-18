/**
 * Classic Levenshtein edit distance (insertion, deletion, substitution — each cost 1), used by
 * the checker's did-you-mean machinery (`spec/error-model.md:139-147`,
 * `spec/tooling.md:178-180`). Callers normalize both operands with OpenLogo's case-insensitive
 * name comparison *before* calling this — the function itself is a plain string-distance
 * primitive with no OpenLogo-specific casing rule baked in, so it stays reusable by every future
 * checker rule that needs did-you-mean (arity, type/field, name/place).
 */

/**
 * The Levenshtein edit distance between `a` and `b`: the minimum number of single-character
 * insertions, deletions, or substitutions needed to turn one into the other. Uses the standard
 * two-row dynamic-programming table. Handles empty strings and `a === b` without a special case:
 * the loop bounds and the `previousRow` seed already produce the correct answer (`b.length`,
 * `a.length`, and `0` respectively) for those inputs.
 */
export function levenshteinDistance(a: string, b: string): number {
  const cols = b.length + 1;
  let previousRow = Array.from({ length: cols }, (_, index) => index);
  let currentRow = new Array<number>(cols).fill(0);

  for (let i = 1; i <= a.length; i++) {
    currentRow[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const substitutionCost = a[i - 1] === b[j - 1] ? 0 : 1;
      currentRow[j] = Math.min(
        (previousRow[j] as number) + 1, // deletion
        (currentRow[j - 1] as number) + 1, // insertion
        (previousRow[j - 1] as number) + substitutionCost, // substitution
      );
    }
    [previousRow, currentRow] = [currentRow, previousRow];
  }

  return previousRow[cols - 1] as number;
}
