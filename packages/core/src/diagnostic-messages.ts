/**
 * The learner-facing sentences `spec/error-model.md` fixes **verbatim**, owned here for exactly the
 * reason the `ol-*` code registry next door is: they cross package boundaries, and a sentence built
 * independently in several places drifts.
 *
 * Almost no diagnostic prose belongs here. `spec/error-model.md:254-259` makes prose *presentation*
 * — "diagnostic identity is `code` plus `params`" — so each package writes its own messages next to
 * the condition that raises them, and that is the shape to keep. What lands in this module is the
 * narrow exception: a sentence the spec **dictates word for word** *and* more than one package must
 * produce. Then the wording is not a local presentation choice at all, it is part of the code's
 * contract, and `@openlogo/core` — which every other package already depends on and which nothing
 * depends on — is its only common ancestor.
 *
 * Issue #1025 is why this exists rather than a comment asking three files to stay in step. The
 * built-in-name sentence was assembled in three places (`@openlogo/parser`'s
 * `checker-reserved-word.ts` and `errors.ts`, `@openlogo/runtime`'s `errors.ts`), the third of
 * which had already shipped the wrong wording twice — issues #751 and #871, both of which leaked
 * the word *primitive* at a learner, which `spec/error-model.md:125` makes a MUST NOT. Agreement
 * that depends on three authors remembering is not agreement.
 */

/**
 * *"`<name>` is already part of OpenLogo."* — the sentence that tells a learner OpenLogo owns a
 * name, with **no repair tail**. This is the shared half, used on its own at the parse stage.
 *
 * It names no category on purpose: `spec/error-model.md:125` makes the words *keyword*, *primitive*
 * and *alias* a **MUST NOT** in the learner message, because whether a taken name is a keyword, a
 * primitive, or an alias spelling "is an implementation distinction the learner never has to
 * learn" (issue #883).
 *
 * **The lowercase `is` after `<name>` and the sentence-final period are both deliberate.**
 * `spec/error-model.md:18` requires "the warm, **lowercase** Logo voice", and its own canonical
 * example at `:20` reads `i don't know how to fowad. did you mean forward?`.
 */
export function builtInNameOwnershipSentence(name: string): string {
  return `${name} is already part of OpenLogo.`;
}

/**
 * The full `ol-reserved-word` message `spec/error-model.md:125` prescribes — the ownership sentence
 * plus the one repair a learner can act on: *"`<name>` is already part of OpenLogo. choose another
 * name."*
 *
 * The repair tail is what separates this from {@link builtInNameOwnershipSentence}, and the split is
 * not cosmetic. A **declaration slot** — `define`, `to`, `struct`, or `alias`'s first operand — has
 * exactly one repair, so it says so. The **parse stage** deliberately stops at the ownership
 * sentence, because there the reader has rejected a keyword in some arbitrary position and cannot
 * see which legal form was meant; `packages/parser/src/errors.ts`'s `misplacedKeywordClause`
 * documents that boundary and the measurements behind it.
 *
 * Both stages must agree on the ownership half, and both must obey the same MUST NOT — which is
 * what makes the two functions one source rather than two.
 */
export function builtInNameMessage(name: string): string {
  return `${builtInNameOwnershipSentence(name)} choose another name.`;
}
