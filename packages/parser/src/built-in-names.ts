/**
 * The **built-in names** — every name OpenLogo itself owns, so a program may not bind it.
 *
 * `spec/grammar.md:414` defines the set as "exactly the keywords listed above plus every primitive
 * … so there is no second list to keep in step", and this module is that sentence as code: it
 * restates no name, and composes the two registries that already hold them
 * ({@link isKeywordInAnyProfile} over `keywords.ts`, {@link primitiveArity} over `signatures.ts`'s
 * profile-keyed tables). A profile that gains a keyword or a table that gains a primitive is
 * covered the moment it lands, with no edit here.
 *
 * **Why it is one module rather than a predicate in each consumer.** Both stages ask this question
 * — `check()` at a declaration slot (`checker-reserved-word.ts`) and `execute()` at phase-1
 * registration (`execute-internal.ts`) — and until issue #841 each answered it with its own
 * composition. They drifted, and the drift was measured rather than hypothesised: the runtime's
 * copy omitted Sprites, Tutor and every Heritage alias, "the hole through which 45 names were
 * declarable at run time", while the checker's copy gated six profiles the spec does not gate. One
 * predicate, called by both, is what
 * [ADR-0021](../../../docs/adr/0021-built-in-names-list-and-ci-gate.md) means by the
 * implementation's registries being read rather than re-derived, and it is what
 * `spec/built-in-names.json`'s CI gate compares against.
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
 * **It takes no profile set, and that is the change issue #841 landed.** A declaration is legal or
 * illegal for the *version*, never for the profile set a given run happens to claim, because "a
 * program cannot declare which profiles it requires … so a name that could be declared in one
 * implementation but not in another would be invisible and unpredictable to a learner"
 * (`spec/grammar.md:408`). Before #841 the checker gated six of these profiles, so `define ask`
 * checked clean under Core alone and raised under Sprites — the implementation-dependent outcome
 * `:408` exists to forbid.
 *
 * The *availability* question keeps its gate and is asked elsewhere: whether a primitive whose
 * profile is inactive may be **called** is `ol-unknown-command`'s subject
 * (`spec/tooling.md:175-176`, `checker-arity.ts`'s `activeProfilePrimitiveArityRange`). Declaring
 * and calling are different questions and only the second one consults the active profile set.
 */
export function isBuiltInName(name: string): boolean {
  return isKeywordInAnyProfile(name) || isPrimitiveName(name);
}
