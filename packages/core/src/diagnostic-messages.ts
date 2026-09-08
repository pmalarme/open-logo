/**
 * The shared **default English rendering** of the one learner sentence more than one package has to
 * produce, owned here for the same reason the `ol-*` code registry next door is: it crosses package
 * boundaries, and a sentence written out independently in several places drifts.
 *
 * **This is prose, not identity, and nothing here changes that.** `spec/error-model.md:256-261`
 * makes diagnostic identity `code` plus `params` and calls prose presentation, and `:263-265`
 * positively permits a template author to "reorder, inflect, or soften" a message for another
 * language. A localized pack may replace what this module returns; what it may not do is make the
 * two stages disagree, or reintroduce a word the spec forbids. So almost no diagnostic prose belongs
 * here — each package writes its own messages next to the condition that raises them, and that is
 * the shape to keep.
 *
 * **The narrow exception this module is for**, and the boundary a future addition has to clear: the
 * spec must dictate the sentence *itself* (not merely describe the condition), **and** more than one
 * package must produce it. `ol-reserved-word` is the only case today — `spec/error-model.md:125`
 * says *"Say `{name} is already part of OpenLogo. choose another name.`"* and then makes the words
 * *keyword*, *primitive* and *alias* a MUST NOT inside it. A message meeting only the first half
 * belongs in its own package; a message meeting only the second half is a refactor between those two
 * packages, not a reason to add prose to core.
 *
 * **Why core rather than `@openlogo/parser`.** Parser is also a common ancestor of today's three
 * call sites — runtime already depends on it — so this is a placement choice, not a forced one. Core
 * owns the diagnostic contract (`docs/adr/0006-cross-cutting-contracts.md`), and routing the
 * runtime's semantic prose through the *parser's* public API would make a dependency that has
 * nothing to do with parsing.
 *
 * Issue #1025 is why this exists rather than a comment asking three files to stay in step. The
 * sentence was assembled in three places (`@openlogo/parser`'s `checker-reserved-word.ts` and
 * `errors.ts`, `@openlogo/runtime`'s `errors.ts`), the third of which had already shipped the wrong
 * wording twice — issues #751 and #871, both leaking the word *primitive* at a learner. Agreement
 * that depends on three authors remembering is not agreement.
 */

/**
 * *"`<name>` is already part of OpenLogo."* — the sentence that tells a learner OpenLogo owns a
 * name, with **no repair tail**. This is the shared half, used on its own at the parse stage.
 *
 * It names no category on purpose. That is a MUST NOT for `ol-reserved-word` specifically
 * (`spec/error-model.md:125`); the parse-stage clause that reuses this half is held to it by
 * *consistency* rather than by that sentence — the same fact should not be told two ways — because
 * whether a taken name is a keyword, a primitive, or an alias spelling "is an implementation
 * distinction the learner never has to learn" (issue #883) wherever it is said.
 *
 * **The lowercase `is` and the sentence-final period are both deliberate.**
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
 * Two functions rather than one is what keeps a caller from composing the wrong thing: the parse
 * stage cannot reach the repair tail by accident, and a declaration slot that wants the full
 * sentence asks for it by name.
 */
export function builtInNameMessage(name: string): string {
  return `${builtInNameOwnershipSentence(name)} choose another name.`;
}
