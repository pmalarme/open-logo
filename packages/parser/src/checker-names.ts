/**
 * The checker's reusable visible-name model (issue #117 — the checker-rule LEAD deliverable
 * every sibling rule slice, #111/#112/#113/#115, plugs into for name/form visibility). It
 * assembles the candidate set of names a call site's callee may legitimately be: the primitives and
 * reserved statement heads of each **active** conformance profile, plus every name the program
 * itself declares — gated on the active profile set exactly as `spec/tooling.md:175-176` requires
 * ("MUST use the active conformance profile set when deciding which primitives and profile
 * block-heads are available"), never a hardcoded "every optional profile active".
 *
 * **The name universes are derived, with one explicit exception.** Both exports below go through
 * {@link profileContributedNames}, which sweeps the profile-keyed registries — `signatures.ts`'s
 * `PROFILE_PRIMITIVES` and `keywords.ts`'s `OL_PROFILE_KEYWORDS` — so a profile that gains a table
 * is covered the moment it lands, and **no profile and no name is enumerated by hand**. Exactly one
 * thing is named here rather than derived, and it is a claim rather than an omission: Core's
 * profile-independent {@link OL_KEYWORDS}, which by definition cannot come from a profile-keyed
 * table. It does not grow when a profile is added, which is the property a spread ladder cannot
 * have. (A second exception, a one-entry withholding of `challenge`, was retired by issue #815 —
 * see {@link collectVisibleNames}.)
 *
 * That is issue #966's subject: this module previously kept a
 * spread ladder *and* a nine-branch profile chain, both hand-extended one slice at a time, and the
 * ladder had already fallen behind the registry — it grew no Tutor arm when issue #838 registered
 * `TUTOR_PRIMITIVE_ARITY`, so `challenge` was treated as a Core word by the tie-break below while
 * `checker-style.ts`'s *derived* rule had absorbed it with no edit at all. Deriving is the fix for
 * the next profile as well as this one.
 *
 * {@link isOptionalProfileName} is this module's companion export for `ol-unknown-command`'s
 * did-you-mean tie-break (`spec/error-model.md:211-212`: on a distance tie, "prefer Core words over
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
 * (`spec/error-model.md:211-212` orders full canonical names over *Heritage aliases*, not over a
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
 * Every name visible to a call site in `program` under the active `profiles`, lowercased to
 * OpenLogo's canonical spelling (identifiers are case-insensitive).
 *
 * Each active profile contributes exactly what {@link profileContributedNames} says it owns — its
 * primitives, its reserved statement heads, and (for Core) the structural keywords — so a profile
 * that is not in `profiles` contributes nothing and a profile registered later contributes without
 * an edit here. That is `spec/tooling.md:174-177`'s requirement ("MUST use the active conformance
 * profile set when deciding which primitives and profile block-heads are available") expressed as a
 * sweep rather than as one hand-written `if (active.has(<profile>))` branch per profile — the shape
 * that had already drifted from the registry it mirrored (issue #966).
 *
 * **The sweep withholds nothing** (issue #815). It used to hold back one registered primitive,
 * `challenge`, on the ground that no evaluator could run it, so the call would read as unknown.
 * `spec/error-model.md:131` now forbids exactly that: an implementation "MUST NOT report
 * `ol-unknown-command` for such a name, at any stage, including by withholding it from the visible
 * vocabulary so that the call reads as unknown: the name is known." Withholding also misattributed
 * the fault — it told a learner *i don't know how to challenge* about a word this specification
 * defines and this implementation registered. A registered name whose profile is active is
 * therefore visible here, and a call to one the evaluator cannot run reports `ol-not-implemented`
 * where the gap actually is (`spec/execution-model.md:717-735`).
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
      names.add(name);
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

/**
 * Is `name` callable in `program` under `profiles` — the single question the semantic layer and the
 * run must answer the same way?
 *
 * `spec/execution-model.md:680` says "One value MUST govern both the check and the run", and a
 * *value* governing both is not enough if each side computes its own answer from it.
 * `@openlogo/runtime` used to do exactly that: a second visibility predicate assembled from
 * `isKeyword` plus the primitive registry plus Heritage-alias resolution. Measured over every name
 * in `spec/built-in-names.json` against every profile closure — 1,776 pairs — the two agreed
 * everywhere, so it was a duplication that had not yet drifted rather than a live defect. It is
 * removed anyway: an agreement maintained by hand is a liability whether or not it has failed yet,
 * and the same reasoning retired this slice's other two (a widened de-duplication identity, and a
 * runtime `ol-unknown-command` that omitted the check's did-you-mean).
 *
 * Exported as a predicate rather than as {@link collectVisibleNames} itself so the set stays this
 * module's own representation and a caller cannot hold or mutate it.
 */
export function isNameVisible(
  name: string,
  program: ProgramNode,
  profiles: readonly CheckProfile[],
): boolean {
  return collectVisibleNames(program, profiles).has(name.toLowerCase());
}
