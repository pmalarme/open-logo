/**
 * The **built-in names** — every name OpenLogo itself owns, so a program may not **declare** it.
 *
 * `spec/grammar.md:414` defines the set as "exactly the keywords listed above plus every primitive
 * … so there is no second list to keep in step", and this module is that sentence as code: it
 * restates no name, and composes the two registries that already hold them
 * ({@link isKeywordInAnyProfile} over `keywords.ts`, {@link primitiveArity} over `signatures.ts`'s
 * profile-keyed tables). A profile that gains a keyword or a table that gains a primitive is
 * covered the moment it lands, with no edit here.
 *
 * **Declaring, not binding.** This predicate answers the question asked at the four declaration
 * slots of `spec/grammar.md:382` (`define`, the heritage `to`, `struct`, and the first operand of
 * `alias`) and at no other position. `spec/grammar.md:386` makes accepting a built-in name as a
 * **binding** — `local`, an assignment target, a `for`/comprehension binder, a parameter, a struct
 * field, a dictionary key — a MUST, so a caller that consults this at a binding position is using
 * it wrongly. `local forward` is legal OpenLogo; `define forward` is not.
 *
 * **Why it is one module rather than a predicate in each consumer.** Both stages ask this question
 * — `check()` at a declaration slot (`checker-reserved-word.ts`) and `execute()` at phase-1
 * registration (`execute-internal.ts`). Two compositions of the same rule drift apart silently,
 * because nothing compares them; one predicate called by both removes the possibility rather than
 * the instance. **Do not reintroduce a second one.**
 *
 * Whether the registries it composes agree with the normative `spec/built-in-names.json` is a
 * separate question, and `npm run built-in-names` is what asks it — **of those registries, not of
 * this predicate**, which the gate never calls. `built-in-names.test.mjs` is what ties the
 * predicate back to them, by asserting it recognises every name each registry contributes.
 *
 * @module
 */

import { isKeywordInAnyProfile } from "./keywords.js";
import { canonicalOfHeritageAlias, primitiveArity } from "./signatures.js";

/**
 * Is `name` a primitive of **any** profile, including every Heritage short-alias spelling of one?
 *
 * {@link primitiveArity} is already the profile-blind sweep — it walks every arity-bearing entry of
 * `signatures.ts`'s profile-keyed registry in declaration order — so this adds only the alias leg.
 * An alias resolves to its canonical spelling and re-enters this same lookup rather than getting a
 * table of its own: Heritage is "alternate spellings only, no new semantics"
 * (`spec/conformance.md:150`), so `define pr` must be exactly as illegal as `define print`, and
 * re-entering makes that hold by construction instead of by a second list. The recursion is depth-1
 * because no canonical spelling is itself an alias, which `built-in-names.test.mjs` pins directly
 * off the registry so a future alias-of-an-alias is caught rather than looping.
 */
function isPrimitiveName(name: string): boolean {
  if (primitiveArity(name) !== undefined) {
    return true;
  }
  const canonical = canonicalOfHeritageAlias(name);
  return canonical !== undefined && isPrimitiveName(canonical);
}

/**
 * Does OpenLogo itself own `name` — as a keyword, or as a primitive of any profile including every
 * alias spelling? This is `ol-reserved-word`'s whole subject (`spec/error-model.md:125`).
 *
 * **It takes no profile set, deliberately.** A declaration is legal or illegal for the *version*,
 * never for the profile set a given run happens to claim, because "a program cannot declare which
 * profiles it requires … so a name that could be declared in one implementation but not in another
 * would be invisible and unpredictable to a learner" (`spec/grammar.md:408`). **Do not add one:**
 * a profile-gated answer here makes `define ask` legal for a Core-only program and illegal for a
 * Sprites one, which is exactly the implementation-dependent outcome `:408` forbids.
 *
 * The *availability* question keeps its gate and is asked elsewhere: whether a primitive whose
 * profile is inactive may be **called** is `ol-unknown-command`'s subject
 * (`spec/tooling.md:175-176`, `checker-arity.ts`'s `activeProfilePrimitiveArityRange`). Declaring
 * and calling are different questions and only the second one consults the active profile set.
 */
export function isBuiltInName(name: string): boolean {
  return isKeywordInAnyProfile(name) || isPrimitiveName(name);
}
