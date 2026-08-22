/**
 * The `ol-reserved-word` semantic rule. **As first delivered (issue #113)** it covered a
 * `define`/`local` registration whose name
 * collides with a keyword, a Core primitive, or an existing procedure, raising
 * `ol-reserved-word` with `params: { name, namespace }` (`spec/error-model.md:123`). Issue #405
 * extends this to the Data profile: a Data primitive (`dict`, `keys`, …) collides the same way a
 * Core primitive does when `"data"` is active, and `struct` type-name registrations — which
 * declare a same-named constructor reporter, `spec/data-structures.md:252-266` — are now checked
 * the same way `define` is, including against each other and against `define`d procedure names
 * (mirroring `@openlogo/runtime`'s own phase-1 registration guard, `execute-internal.ts`'s
 * `collectStructs`).
 *
 * Scope boundary (issue #833 — **maintainer ruling on built-in names**, spec text merged in #875):
 * this rule applies at the grammar's **declaration slots** and nowhere else. The single rule it
 * enforces is `spec/grammar.md:363`:
 *
 * > **A program may not declare a built-in name. A program may bind a value to any name.**
 *
 * A **built-in name** is a keyword (`keywords.ts`'s `OL_KEYWORDS`) or a primitive — including
 * every alias spelling of one. Declaring one registers a callable and so collides; binding one
 * registers nothing and so does not.
 *
 * | Form | Node | Checked? |
 * |---|---|---|
 * | `define name` / `to name` | {@link ProcedureDefNode} | **yes** — declaration slot |
 * | `struct name` | {@link StructDefNode} | **yes** — declaration slot |
 * | `alias new old` (first operand) | — no AST node yet | declaration slot, unreachable (see below) |
 * | `local name` | `LocalNode` | no — binding |
 * | `:name = v` / `set name to v` / `make "name" v` | `AssignNode` | no — binding |
 * | `for name in …` / `for name from … to …` | `ForInNode`/`ForRangeNode` | no — binding |
 * | `map`/`filter`/`reduce` binder + `reduce` accumulator | `ComprehensionNode` | no — binding |
 * | `for [ :a :b ] in …` destructuring names | `DestructuringBinderNode` | no — binding |
 * | `define f :param` / `define f ( :param default )` | {@link ProcedureDefNode}'s `params` | no — binding |
 * | `struct point [ repeat y ]` field names | {@link StructDefNode}'s `fields` | no — data, per-type namespace |
 * | `{ end: 1 }` dictionary keys | — | no — data |
 *
 * **This reverses issue #739 and is a deliberate removal, not an omission.** #739 was a maintainer
 * ruling ("reserved word is reserved word") that extended this rule to *every form that introduces
 * a name*, so at the previous HEAD all 43 keywords raised `ol-reserved-word` from every binding
 * position — measured: `:end = 7` parsed clean, ran clean and printed `7`, yet checked
 * `ol-reserved-word`. #833 overrules that: `spec/grammar.md:386` now requires that an
 * implementation "MUST NOT raise `ol-reserved-word` — or any other diagnostic — for the name alone
 * in any of those positions, at any stage", and names `local` among them. Do not reinstate a
 * binding-position check here; the sentence #739 relied on ("may not be redefined as variables") is
 * gone from the spec.
 *
 * **Why the declaration slots are the complete enforcement point**, in the spec's own words
 * (`spec/grammar.md:388`): "A restriction on a binding form is bypassable, because `local` is
 * optional and the same name can be bound with `<place> = <value>` instead; the four declaration
 * slots are the only way to register a callable, so there is nothing to bypass." That is also why
 * `local` moved out: `local foo` registers nothing callable — a later `foo` call raises
 * `ol-unknown-command` — so it is a binding, and its old primitive/procedure/struct branches were
 * #113 *freshness* behavior that the ruling retires along with the rest.
 *
 * **Keying to the declaration slots, not to `callable-name`.** `spec/grammar.md:58-59,165` gives
 * the four slots their own EBNF productions, `declared-callable-name` and `declared-type-name`, so
 * the rule is readable straight off the grammar. Both expand to `identifier`, so **parsing is
 * unchanged** and `define end` still parses and is then rejected *semantically* — which is exactly
 * why `ol-reserved-word` is a `stage: "semantic"` diagnostic. `callable-name`/`type-name` remain
 * the **call** slots, where every built-in name is legal; keying this rule to them instead would
 * make `forward 100` illegal.
 *
 * **`alias` is a declaration slot with nothing to check yet.** Only its *first* operand declares
 * (`spec/grammar.md:410`) — `alias definir define` is legal, which is how a localized keyword pack
 * renames a keyword. Modules is a later profile and `ast.ts` has no `AliasDefNode`, so the slot has
 * no node to reach; it is listed here so the day it gains one, the fourth slot is wired rather than
 * rediscovered.
 *
 * **`struct` field names and dictionary keys stay legal even when built in**, because they are not
 * in the callable namespace at all: `spec/grammar.md:406` — "Record field names live in a per-type
 * namespace reached only by `.field` … Dictionary keys and selector bare keys are data, not
 * declarations, so built-in names are legal keys." So `struct point [ repeat y ]` and `{ end: 1 }`
 * check clean, by design.
 *
 * `namespace` priority when a name collides with more than one category (only reachable today via
 * `thing`, which is both a keyword and a Core primitive): reserved word, then primitive, then
 * existing procedure, then existing struct — checked in that order, so the more fundamental
 * category wins. (`spec/error-model.md` drops the `namespace` param and splits the
 * procedure/struct cases out to `ol-duplicate-definition`; that is issue #838's, not this file's.)
 *
 * Issue #427 (M4 audit) extends the primitive branch again to the Geometry profile: `grid`,
 * `axes`, and `measure` (`signatures.ts`'s `geometryPrimitiveArity`) collide the same way a Core
 * or Data primitive does when `"geometry"` is active, mirroring the Data branch #405 added — gated
 * the same way, so a Core-only program is currently accepted when it declares `grid`. That gate is
 * the shipped deviation #841 closes, not a rule the spec states.
 *
 * Issue #663 (C1, M5) extends the *keyword* branch the same profile-conditional way: the
 * Sprites block-heads `ask`/`each`/`tell` and the Interaction & Events block-heads
 * `when`/`every`/`on_key`/`on_click` count only when their profile is active
 * (`OL_PROFILE_KEYWORDS` in `keywords.ts`). Threading the active `profiles` into `isKeyword` here —
 * the profile-blind default kept every Core-only program's `ask`/`when` an ordinary name — is the
 * whole wiring; the registry and its non-regression guarantee live in `keywords.ts`, whose doc
 * comment also records that `spec/grammar.md:408` makes profile words built-in **unconditionally**,
 * that `spec/turtles-and-sprites.md:154` and `spec/interaction-events.md#profiles-and-reservation`
 * now say so too (issue #855), and that retiring this gate is issue #841's.
 *
 * Issue #687 (I8, M5) extends the *primitive* branch to the Interaction & Events profile's `wait`
 * (`signatures.ts`'s `interactionPrimitiveArity`), gated on `"interaction-events"` exactly like the
 * Data/Geometry/Sound branches above. `wait` is an ordinary primitive rather than a profile
 * block-head, but `spec/tooling.md:185` makes declaring a *primitive* `ol-reserved-word` just the
 * same — the block-head/primitive distinction decides which branch reports it and under which
 * profile, not whether it is reportable at all. Without this, `wait` was the Interaction profile's
 * one primitive and yet the only one of the Data/Geometry/Sound/Interaction primitives a program
 * could silently shadow.
 *
 * Issues #746 (Sprites half) and #742 (Heritage half) close the last two holes in that same
 * primitive category, and had to land **together** — see {@link primitiveCollision}, which is where
 * every profile's table is now consulted from. #746 adds the Sprites reporters `new_turtle`/`who`/
 * `turtles` (`signatures.ts`'s `spritesPrimitiveArity`), gated on `"sprites"`, so they collide
 * exactly as `grid` (Geometry), `set_tempo` (Sound), `dict` (Data), and `wait` (Interaction &
 * Events) already did. #742 adds the Heritage short aliases, gated on `"heritage"`, by **resolving
 * the alias to its canonical spelling and re-running that same table lookup** — never by a second
 * table of its own. Heritage is "alternate spellings only, no new semantics"
 * (`spec/conformance.md:146`), so `define pr` had to be exactly as (il)legal as `define print`;
 * before this, `define print` raised while `define pr` was accepted **and the shadow took effect**,
 * so `pr 7` then reported `ol-bad-token` — a Heritage program could silently lose its `print`.
 * Resolving through {@link canonicalOfHeritageAlias} makes that symmetry hold **by construction**
 * (the model slice H5/#670 and #733/#747 established), so an alias can never drift from its
 * canonical: whatever table the canonical is in — or is *not* in — decides both spellings alike.
 *
 * **Turtle & Rendering is still deliberately not consulted** (issue #783). The normative question is
 * now settled — `spec/tooling.md:185` and `spec/grammar.md:408` make every profile's primitives
 * built-in names whether or not the profile is claimed — so what remains is implementation, tracked
 * with the rest of the always-on list in #841. That is a scope boundary, not an oversight, and the
 * resolve-to-canonical design above is precisely what keeps it from leaking: `define forward` is
 * accepted, so `define fd` — which resolves to `forward` and finds no consulted table — is accepted
 * too. The nine
 * turtle aliases (`fd bk lt rt st ht pu pd cs`) therefore stay legal *because* their canonicals do,
 * and the day #783 wires in `turtlePrimitiveArity` all nine start colliding with no further edit
 * here. A parallel alias table would have had to be revisited by hand instead, which is exactly the
 * drift this design forbids.
 */

import type { Diagnostic } from "@openlogo/core";
import type {
  AnyNode,
  ProcedureDefNode,
  ProgramNode,
  SpannedName,
  StructDefNode,
} from "./ast.js";
import { walk } from "./ast.js";
import { isKeyword } from "./keywords.js";
import {
  canonicalOfHeritageAlias,
  corePrimitiveArity,
  dataPrimitiveArity,
  geometryPrimitiveArity,
  interactionPrimitiveArity,
  soundPrimitiveArity,
  spritesPrimitiveArity,
} from "./signatures.js";
import type { CheckProfile } from "./check.js";

/** One collision category a redefined name can fall into, in priority order. */
type Namespace = "reserved" | "primitive" | "procedure" | "struct";

/** The empty struct-name set for callers that have no struct collisions to check. */
const NO_STRUCTS: ReadonlySet<string> = new Set();

/**
 * `"primitive"` when `name` is a built-in of some **active** profile, `undefined` otherwise — the
 * whole of {@link collidingNamespace}'s primitive category, in one place, so a profile slice adds
 * exactly one branch here (`spec/tooling.md:185` "Required behavior").
 *
 * **The active-profile gating is shipped behaviour, not what that row requires.** `:185` and
 * `spec/grammar.md:408` make profile primitives built-in names whether or not their profile is
 * claimed; `:175-176` gates which names are *available* (the `ol-unknown-command` axis), which is a
 * different question from whether a name may be declared. Retiring the gate here is #841's.
 *
 * Two properties this function exists to guarantee:
 *
 * 1. **Every profile is gated on its own claim**, so a Core-only program is currently accepted when
 *    it declares `grid`/`who`/`pr`, exactly as it is when it declares `ask` — the deviation #841
 *    closes.
 * 2. **A Heritage alias is its canonical, by construction.** The `heritage` branch resolves through
 *    {@link canonicalOfHeritageAlias} and re-enters this same function on the canonical spelling
 *    rather than consulting a table of its own, so `define pr` is exactly as (il)legal as
 *    `define print` — no arity or name knowledge is duplicated and the two spellings cannot drift
 *    (issue #742; the same resolve-then-reuse shape as `signatures.ts`'s `heritageAliasArity`).
 *    The recursion is depth-1 by construction: no canonical spelling is itself an alias, which
 *    `checker-reserved-word.test.mjs` pins directly off the registry so a future alias whose
 *    canonical is another alias is caught rather than looping.
 */
function primitiveCollision(
  name: string,
  profiles: readonly CheckProfile[],
): Namespace | undefined {
  if (
    profiles.includes("core-language") &&
    corePrimitiveArity(name) !== undefined
  ) {
    return "primitive";
  }
  if (profiles.includes("data") && dataPrimitiveArity(name) !== undefined) {
    return "primitive";
  }
  if (
    profiles.includes("geometry") &&
    geometryPrimitiveArity(name) !== undefined
  ) {
    return "primitive";
  }
  if (profiles.includes("sound") && soundPrimitiveArity(name) !== undefined) {
    return "primitive";
  }
  if (
    profiles.includes("interaction-events") &&
    interactionPrimitiveArity(name) !== undefined
  ) {
    return "primitive";
  }
  if (
    profiles.includes("sprites") &&
    spritesPrimitiveArity(name) !== undefined
  ) {
    return "primitive";
  }
  if (profiles.includes("heritage")) {
    const canonical = canonicalOfHeritageAlias(name);
    if (canonical !== undefined) {
      return primitiveCollision(canonical, profiles);
    }
  }
  return undefined;
}

/** The collision category `name` falls into under `profiles`, or `undefined` if it is free to declare. */
function collidingNamespace(
  name: string,
  profiles: readonly CheckProfile[],
  declaredProcedures: ReadonlySet<string>,
  declaredStructs: ReadonlySet<string> = NO_STRUCTS,
): Namespace | undefined {
  if (isKeyword(name, profiles)) {
    return "reserved";
  }
  const primitive = primitiveCollision(name, profiles);
  if (primitive !== undefined) {
    return primitive;
  }
  if (declaredProcedures.has(name)) {
    return "procedure";
  }
  if (declaredStructs.has(name)) {
    return "struct";
  }
  return undefined;
}

/** The learner-facing message template for a name that collides with an existing `namespace`. */
function messageFor(name: string, namespace: Namespace): string {
  return `${name} is already a ${namespace}, so it can't be redefined here.`;
}

function reservedWordDiagnostic(
  spannedName: SpannedName,
  namespace: Namespace,
): Diagnostic {
  return {
    code: "ol-reserved-word",
    source_span: spannedName.source_span,
    params: { name: spannedName.name, namespace },
    message: messageFor(spannedName.name, namespace),
    stage: "semantic",
    severity: "error",
  };
}

function isProcedureDef(node: AnyNode): node is ProcedureDefNode {
  return node.kind === "ProcedureDef";
}

function isStructDef(node: AnyNode): node is StructDefNode {
  return node.kind === "StructDef";
}

/**
 * The `ol-reserved-word` rule, over the grammar's **declaration slots** — and only those (issue
 * #833's maintainer ruling; see the module doc comment's form table).
 *
 * Every `define`/`to` and `struct` whose name collides
 * with a keyword, a primitive of any active profile ({@link primitiveCollision} — Core, Data,
 * Geometry, Sound, Interaction & Events, Sprites, or a Heritage alias of any of them), or an
 * existing procedure/struct raises
 * one diagnostic at that name's own span. A `define`/`struct` is
 * checked only against procedures and structs *already seen earlier in source order* — including
 * across the two kinds — so the first registration of a name stays clean and each later one
 * (whichever kind it is) is flagged as colliding with it, mirroring how two `define`s of the same
 * name are already handled: "already defined" needs a first occurrence to compare against, and
 * checking the full program symmetrically would flag both sides of a single collision instead of
 * just the later one.
 *
 * Every **binding** position — `local`, an assignment target, a `for`/comprehension binder, a
 * destructuring name, a `reduce` accumulator, a procedure parameter, a struct field, a dictionary
 * key — is deliberately not visited: `spec/grammar.md:386` makes accepting them a MUST.
 *
 * Findings are returned in **source order**, which the walk's pre-order gives directly now that
 * only a declaration's own name is checked. (The rule used to sort by span start, because a
 * keyword inside an *earlier* parameter's default expression was reached later than the
 * `ProcedureDefNode` carrying it; with parameters no longer checked, that was the only
 * out-of-order case and the sort became dead weight.) A consumer — conformance fixture, editor,
 * LSP — can rely on the order unconditionally either way.
 *
 * Struct participation — both `StructDef`'s own collision check and a `struct` colliding with a
 * `define` — is gated on `"data"` being active (issue #405), mirroring
 * `checker-names.ts`'s and `checker-arity.ts`'s own `data` gate: with `data` inactive, a struct
 * declaration registers no constructor at all (`collectVisibleNames`), so it must not participate
 * in collision checks here either, or a Core-only program could be flagged for a name that isn't
 * actually registered. **That gate is shipped behaviour, not what the spec requires:**
 * `spec/tooling.md:185` and `spec/grammar.md:382` make `struct` a declaration slot
 * unconditionally, so `struct if [ x ]` must raise under Core-only too — measured, it is clean
 * without `data` and raises with it. Retiring the gate belongs with the rest of the always-on list
 * in #841.
 */
export function reservedWordRule(
  program: ProgramNode,
  profiles: readonly CheckProfile[],
): readonly Diagnostic[] {
  const dataActive = profiles.includes("data");

  const diagnostics: Diagnostic[] = [];
  const seenProcedures = new Set<string>();
  const seenStructs = new Set<string>();

  walk(program, (node) => {
    if (isProcedureDef(node)) {
      const name = node.name.name.toLowerCase();
      const namespace = collidingNamespace(
        name,
        profiles,
        seenProcedures,
        seenStructs,
      );
      if (namespace !== undefined) {
        diagnostics.push(reservedWordDiagnostic(node.name, namespace));
      }
      seenProcedures.add(name);
      return;
    }
    if (dataActive && isStructDef(node)) {
      const name = node.name.name.toLowerCase();
      const namespace = collidingNamespace(
        name,
        profiles,
        seenProcedures,
        seenStructs,
      );
      if (namespace !== undefined) {
        diagnostics.push(reservedWordDiagnostic(node.name, namespace));
      }
      seenStructs.add(name);
    }
  });

  return diagnostics;
}
