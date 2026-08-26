/**
 * The checker's reusable visible-name model (issue #117 — the checker-rule LEAD deliverable
 * every sibling rule slice, #111/#112/#113/#115, plugs into for name/form visibility). It
 * assembles the candidate set of names a call site's callee may legitimately be: the primitives and
 * reserved statement heads of each **active** conformance profile, plus every name the program
 * itself declares — gated on the active profile set exactly as `spec/tooling.md:175-176` requires
 * ("MUST use the active conformance profile set when deciding which primitives and profile
 * block-heads are available"), never a hardcoded "every optional profile active".
 *
 * **The name universes are derived, with two explicit exceptions.** Both exports below go through
 * {@link profileContributedNames}, which sweeps the profile-keyed registries — `signatures.ts`'s
 * `PROFILE_PRIMITIVES` and `keywords.ts`'s `OL_PROFILE_KEYWORDS` — so a profile that gains a table
 * is covered the moment it lands, and **no profile and no name is enumerated by hand**. Exactly two
 * things are named here rather than derived, and both are claims rather than omissions: Core's
 * profile-independent {@link OL_KEYWORDS}, which by definition cannot come from a profile-keyed
 * table, and the one-entry {@link NAMES_AWAITING_AN_EVALUATOR} withholding. Neither grows when a
 * profile is added, which is the property a spread ladder cannot have.
 *
 * That is issue #966's subject: this module previously kept a
 * spread ladder *and* a nine-branch profile chain, both hand-extended one slice at a time, and the
 * ladder had already fallen behind the registry — it grew no Tutor arm when issue #838 registered
 * `TUTOR_PRIMITIVE_ARITY`, so `challenge` was treated as a Core word by the tie-break below while
 * `checker-style.ts`'s *derived* rule had absorbed it with no edit at all. Deriving is the fix for
 * the next profile as well as this one.
 *
 * {@link isOptionalProfileName} is this module's companion export for `ol-unknown-command`'s
 * did-you-mean tie-break (`spec/error-model.md:210-211`: on a distance tie, "prefer Core words over
 * optional-profile words, then full canonical names over short aliases, then lexicographic order")
 * — a tie between a Core name and an optional-profile name is reachable and MUST resolve in Core's
 * favor, not by lexicographic order alone. Program-declared names (procedures, struct constructors)
 * are not part of it: they are the learner's own, and `checker-unknown-command.ts` exempts them
 * from demotion for that reason.
 */

import type { CheckProfile } from "./check.js";
import type { ProgramNode } from "./ast.js";
import { walk } from "./ast.js";
import { OL_KEYWORDS, profileKeywords } from "./keywords.js";
import {
  primitiveRegistryProfiles,
  profileCallableNames,
} from "./signatures.js";

/**
 * Every name conformance profile `profile` contributes to the checker's name model, from the
 * profile-keyed registries themselves rather than from a per-profile branch here.
 *
 * Three registries answer, and two of them are keyed by profile, so a profile that gains a table
 * reaches both consumers below with **no edit to this module**:
 *
 * - {@link profileCallableNames} — the profile's primitives out of `signatures.ts`'s
 *   `PROFILE_PRIMITIVES` (a `Record<CheckProfile, …>`, exhaustive by construction), plus Heritage's
 *   short aliases, which that registry deliberately holds as `null` because an alias carries no
 *   arity of its own.
 * - {@link profileKeywords} — the profile's reserved statement heads out of `keywords.ts`'s
 *   `OL_PROFILE_KEYWORDS` (`ask`/`each`/`tell`, the four event heads).
 * - {@link OL_KEYWORDS} for Core alone. This is the one arm that names a profile, and it is not a
 *   ladder rung: Core's keyword list is *defined* as the profile-independent one
 *   (`keywords.ts`, `spec/grammar.md:408`), so it cannot be reached through a profile-keyed table,
 *   and a keyword added to it is still picked up here with no edit.
 *
 * **Why one function rather than two similar loops.** Before this, an `OPTIONAL_PROFILE_NAMES`
 * spread ladder and a nine-branch `if (active.has(<profile>))` chain each enumerated the profiles by
 * hand, and they had already drifted: the ladder never grew a Tutor arm when issue #838 registered
 * `TUTOR_PRIMITIVE_ARITY`, so `isOptionalProfileName("challenge")` answered `false` and `challenge`
 * was treated as a Core word in the did-you-mean tie-break (issue #966). Both consumers now call
 * this, so they cannot disagree about what a profile owns — the same structural move `signatures.ts`
 * made when it collapsed the reader's and the checker's arity lookups onto one registry (#874).
 */
function profileContributedNames(profile: CheckProfile): readonly string[] {
  const names = [...profileCallableNames(profile), ...profileKeywords(profile)];
  if (profile === "core-language") {
    names.push(...OL_KEYWORDS);
  }
  return names;
}

/**
 * Every name contributed by an optional (non-Core) conformance profile, as a frozen union computed
 * once so {@link isOptionalProfileName} stays a pure, allocation-free lookup.
 *
 * Derived by sweeping every profile the registry is keyed by except Core and asking
 * {@link profileContributedNames} — so this set answers for a profile registered later without
 * being edited, which is the property the spread ladder it replaces could not have.
 */
const OPTIONAL_PROFILE_NAMES: ReadonlySet<string> = new Set(
  primitiveRegistryProfiles()
    .filter((profile) => profile !== "core-language")
    .flatMap((profile) => profileContributedNames(profile)),
);

/**
 * Whether `name` belongs to an optional (non-Core) conformance profile rather than to Core
 * Language — its primitives, its reserved statement heads, or (for Heritage) its short aliases.
 *
 * Used for `ol-unknown-command`'s did-you-mean tie-break, which asks "is this candidate an
 * optional-profile word?" independent of which profiles are currently active, since a name only
 * reaches the candidate set at all when its owning profile is active (see
 * {@link collectVisibleNames}). Matching is case-insensitive, like every other identifier lookup in
 * this package — the internal caller passes an already-lowercased candidate, but this is a public
 * export and a classification that silently answered `false` for `CHALLENGE` would be a trap.
 */
export function isOptionalProfileName(name: string): boolean {
  return OPTIONAL_PROFILE_NAMES.has(name.toLowerCase());
}

/**
 * Every name the program itself *declares* — user procedures (`ProcedureDef`) and, when Data is
 * relevant, `struct` constructors (`StructDef`) — lowercased. These are program-declared, not
 * profile-owned: they are visible regardless of the active profile set (mirroring
 * {@link collectVisibleNames}'s unconditional procedure/struct walk). The did-you-mean tie-break
 * uses this to tell a user's `define fd … end` apart from the Heritage alias `fd` that happens to
 * share its spelling — a declared name must never be demoted as if it were the short alias
 * (`spec/error-model.md:210-211` orders full canonical names over *Heritage aliases*, not over a
 * learner's own procedures).
 */
export function collectDeclaredNames(
  program: ProgramNode,
): ReadonlySet<string> {
  const names = new Set<string>();
  walk(program, (node) => {
    if (node.kind === "ProcedureDef" || node.kind === "StructDef") {
      names.add(node.name.name.toLowerCase());
    }
  });
  return names;
}

/**
 * Registered primitives a program may not yet **call**, because a profile registered the name
 * before any evaluator could run it.
 *
 * `challenge` is the only one: issue #838 registered `TUTOR_PRIMITIVE_ARITY` so the name would stop
 * being invisible to every parser component at once, but `@openlogo/runtime` has no evaluator for
 * it. Making it visible here would let `challenge` check clean and then do nothing at run time,
 * which is precisely the "silent no-op" this repository refuses: **both halves of a name's
 * registration — checker visibility and a runtime that can run it — land in the same slice**, so a
 * program that checks clean is a program the runtime can actually execute. Until that slice,
 * `ol-unknown-command` is the honest answer.
 *
 * It is an **exception to a derivation, not a second list** — the shape issue #885 proved and epic
 * #900 cites as its own precedent ("derived `NON_PRIMARY_NAMES` from the registry minus an explicit
 * allowlist"). Names still come from the registries; only the deliberate withholding is written
 * down, so shipping Tutor's evaluator is one line deleted here rather than an arm someone must
 * remember to add. Note it deliberately does **not** narrow {@link isOptionalProfileName}: whether
 * `challenge` is an optional-profile word is a question about the registry, not about what runs
 * today, and answering it correctly now is what makes that slice a deletion.
 *
 * **What checks it, stated exactly.** This module cannot verify the claim itself — "an evaluator
 * exists" is a fact about `@openlogo/runtime`, which the parser must not depend on — so the entry
 * is a **manual cross-package exception**, and no test here can detect that an evaluator has since
 * shipped. What {@link namesAwaitingAnEvaluator} makes checkable is the half that lives in this
 * package: `checker-names-derivation.test.mjs` asserts every entry is a name some profile actually
 * registers, so a typo or a name left behind after its table was removed fails rather than silently
 * withholding nothing, and `profile-arity-derivation.test.mjs` pins that `challenge` is the only
 * name withheld, so a second one cannot be added unremarked. Retiring the entry stays a human step,
 * which is why it is one line with its reason beside it.
 */
const NAMES_AWAITING_AN_EVALUATOR: ReadonlySet<string> = new Set(["challenge"]);

/**
 * The registered primitives the checker deliberately withholds from
 * {@link collectVisibleNames} because no evaluator can run them yet. See
 * {@link NAMES_AWAITING_AN_EVALUATOR} for why the exception exists and what does — and does not —
 * enforce it.
 *
 * Exported because it is a **claim**, and a claim nothing can call is a claim nothing can check.
 * The `challenge` misclassification survived precisely because the set it belonged to was
 * unreachable from outside the module, so no test could name it.
 */
export function namesAwaitingAnEvaluator(): readonly string[] {
  return [...NAMES_AWAITING_AN_EVALUATOR].sort();
}

/**
 * Every name visible to a call site in `program` under the active `profiles`, lowercased to
 * OpenLogo's canonical spelling (identifiers are case-insensitive).
 *
 * Each active profile contributes exactly what {@link profileContributedNames} says it owns — its
 * primitives, its reserved statement heads, and (for Core) the structural keywords — so a profile
 * that is not in `profiles` contributes nothing and a profile registered later contributes without
 * an edit here. That is `spec/tooling.md:175-176`'s requirement ("MUST use the active conformance
 * profile set when deciding which primitives and profile block-heads are available") expressed as a
 * sweep rather than as one hand-written `if (active.has(<profile>))` branch per profile — the shape
 * that had already drifted from the registry it mirrored (issue #966).
 *
 * The sweep withholds {@link NAMES_AWAITING_AN_EVALUATOR}, which is the one thing visibility asks
 * that the registry cannot answer. This is where this set and {@link isOptionalProfileName}'s
 * legitimately differ: both read the same profile registries, and only *callability* is filtered.
 *
 * Two things a *program* declares are added on top, and they carry different gates. Every `define`d
 * procedure is added **unconditionally** — procedures are not profile-owned, and declaration order
 * and position do not matter, since OpenLogo procedures are available program-wide rather than only
 * after their `define`. Every `struct` type's constructor name is added **only when `"data"` is
 * active**, because `struct` is that profile's form; it mirrors `@openlogo/runtime`'s phase-1
 * `collectStructs`, and it registers program-wide exactly as a procedure does.
 */
export function collectVisibleNames(
  program: ProgramNode,
  profiles: readonly CheckProfile[],
): ReadonlySet<string> {
  const active = new Set(profiles);
  const names = new Set<string>();

  for (const profile of active) {
    for (const name of profileContributedNames(profile)) {
      if (!NAMES_AWAITING_AN_EVALUATOR.has(name)) {
        names.add(name);
      }
    }
  }

  if (active.has("data")) {
    walk(program, (node) => {
      if (node.kind === "StructDef") {
        names.add(node.name.name.toLowerCase());
      }
    });
  }

  walk(program, (node) => {
    if (node.kind === "ProcedureDef") {
      names.add(node.name.name.toLowerCase());
    }
  });

  return names;
}
