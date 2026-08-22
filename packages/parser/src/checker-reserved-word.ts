/**
 * The two **declaration-slot** semantic rules, `ol-reserved-word` and `ol-duplicate-definition`.
 * **As first delivered (issue #113)** this file covered a
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
 * ---
 *
 * ## Issue #838: one question, two codes, and 44 more names
 *
 * A declaration slot asks exactly one question — *is this name already taken, and by whom?* — and
 * `spec/error-model.md:132-141` splits the answer in two so that each code means exactly one thing:
 *
 * - **`ol-reserved-word` — OpenLogo owns this name.** `params: { name }` and nothing else. The
 *   `namespace` param is **gone** (`spec/error-model.md:125`), and with it the ungrammatical
 *   *"thing is already a reserved"* and the jargon-leaking *"count is already a primitive"* that
 *   issue #883 reported. Whether the taken name is a keyword, a primitive, or an alias spelling "is
 *   an implementation distinction the learner never has to learn" — so the one message is
 *   {@link builtInMessage}'s *"`<name>` is already part of OpenLogo. choose another name."*, and
 *   the words *keyword*, *primitive* and *alias* MUST NOT appear in it.
 * - **`ol-duplicate-definition` — something in the program already declares this name.** The
 *   `procedure` and `struct` namespaces move here (`spec/grammar.md:412`), and the code carries
 *   **both** spans: `source_span` at the later declaration, `original_span` in `params` at the
 *   earlier one, so the message can name the line the learner already used
 *   ({@link duplicateDefinitionDiagnostic}). It is deliberately *not* `ol-reserved-word`: a name the
 *   learner (or a library written in OpenLogo, such as the derived Geometry standard library) has
 *   declared is not a name OpenLogo owns.
 *
 * The two are mutually exclusive outcomes of one lookup at one slot, so they are produced by one
 * pre-order walk in {@link declarationSlotRule} rather than by two rules over two walks — which is
 * also what keeps a name that is *both* built in and declared twice from being reported twice, and
 * what keeps the two codes interleaved in **source order** rather than grouped by code.
 *
 * **The 44 names #838 closes.** `spec/grammar.md:414` makes the built-in names "exactly the
 * keywords listed above plus every primitive … and every alias spelling", and `:408` makes profile
 * words built-in **unconditionally**. Measured at the saga tip `fc4371d` with a sanity-asserted
 * harness (`define count` must raise before any row is recorded), 44 of the 45 names in issue
 * #838's AC2 were free to declare at **both** registration forms — `mod` was the only one already
 * blocked, as a keyword added by #837. They are closed here by {@link unconditionalBuiltInName},
 * which consults the three tables the profile-gated lookup never reached — Turtle & Rendering's 30
 * names (including the five compact alias spellings `setbg`/`setcolor`/`seth`/`setwidth`/`setxy`,
 * which are members of `turtlePrimitiveNames()` and so need no list of their own), Educational's
 * four meta-commands, and Tutor's `challenge` — plus the nine Heritage short aliases that resolve
 * into them.
 *
 * **Why {@link unconditionalBuiltInName} is not profile-gated, while {@link gatedPrimitiveCollision}
 * still is.** `spec/grammar.md:408`: "a name that could be declared in one implementation but not
 * in another would be invisible and unpredictable to a learner", so every profile's names are
 * built in "whether or not that profile is claimed". Issue #838's AC2 requires exactly that of its
 * 45 names — *regardless of the active profile set, including Core-only* — so the new branch takes
 * no `profiles` argument at all. The pre-existing Data/Geometry/Sound/Interaction/Sprites branches
 * below keep their gates for now: retiring **those** is issue #841's always-on built-in-names list
 * and its CI drift gate, and reaching into them here would have silently changed names outside
 * this slice's measured 45.
 *
 * ---
 *
 * `namespace` priority when a name collided with more than one category used to be reserved →
 * primitive → procedure → struct. With the param gone, what survives is the **code** priority:
 * built-in beats duplicate, because "OpenLogo owns this name" is the more fundamental answer and
 * the only one the learner can do nothing about.
 *
 * Issue #427 (M4 audit) extends the primitive branch again to the Geometry profile: `grid`,
 * `axes`, and `measure` (`signatures.ts`'s `geometryPrimitiveArity`) collide the same way a Core
 * or Data primitive does when `"geometry"` is active, mirroring the Data branch #405 added — gated
 * the same way, so a Core-only program is free to `define grid`.
 *
 * Issue #663 (C1, M5) extends the *keyword* branch the same profile-conditional way: the
 * Sprites block-heads `ask`/`each`/`tell` and the Interaction & Events block-heads
 * `when`/`every`/`on_key`/`on_click` count only when their profile is active
 * (`OL_PROFILE_KEYWORDS` in `keywords.ts`; `spec/turtles-and-sprites.md`,
 * `spec/interaction-events.md`). Threading the active `profiles` into `isKeyword` here — the
 * profile-blind default kept every Core-only program's `ask`/`when` an ordinary name — is the whole
 * wiring; the registry and its non-regression guarantee live in `keywords.ts`, whose doc comment
 * also records that `spec/grammar.md:408` now makes profile words built-in **unconditionally** and
 * that retiring this gate is issue #841's.
 *
 * Issue #687 (I8, M5) extends the *primitive* branch to the Interaction & Events profile's `wait`
 * (`signatures.ts`'s `interactionPrimitiveArity`), gated on `"interaction-events"` exactly like the
 * Data/Geometry/Sound branches above. `wait` is an ordinary primitive rather than a profile
 * block-head, but `spec/tooling.md:184` makes redefining a *primitive* `ol-reserved-word` just the
 * same — the block-head/primitive distinction decides which branch reports it and under which
 * profile, not whether it is reportable at all. Without this, `wait` was the Interaction profile's
 * one primitive and yet the only one of the Data/Geometry/Sound/Interaction primitives a program
 * could silently shadow.
 *
 * Issues #746 (Sprites half) and #742 (Heritage half) close the last two holes in that same
 * primitive category, and had to land **together** — see {@link gatedPrimitiveCollision}, which is where
 * every profile's *gated* table is now consulted from. #746 adds the Sprites reporters
 * `new_turtle`/`who`/`turtles` (`signatures.ts`'s `spritesPrimitiveArity`), gated on `"sprites"`,
 * so they collide exactly as `grid` (Geometry), `set_tempo` (Sound), `dict` (Data), and `wait`
 * (Interaction & Events) already did. #742 adds the Heritage short aliases, gated on `"heritage"`,
 * by **resolving the alias to its canonical spelling and re-running that same table lookup** —
 * never by a second table of its own. Heritage is "alternate spellings only, no new semantics"
 * (`spec/conformance.md:146`), so `define pr` had to be exactly as (il)legal as `define print`;
 * before this, `define print` raised while `define pr` was accepted **and the shadow took effect**,
 * so `pr 7` then reported `ol-bad-token` — a Heritage program could silently lose its `print`.
 * Resolving through {@link canonicalOfHeritageAlias} makes that symmetry hold **by construction**
 * (the model slice H5/#670 and #733/#747 established), so an alias can never drift from its
 * canonical: whatever table the canonical is in — or is *not* in — decides both spellings alike.
 * {@link unconditionalBuiltInName} reuses that exact shape, which is why the nine turtle aliases
 * `fd bk lt rt st ht pu pd cs` needed no list of their own here: they resolve to Turtle & Rendering
 * canonicals, and so flip to unconditional together with them. `pr`/`bf`/`bl`/`se` resolve to
 * **Core** canonicals instead, so they stay in the gated branch until #841 retires it — the one
 * boundary this slice deliberately leaves visible.
 */

import type { Diagnostic, SourceSpan } from "@openlogo/core";
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
  educationalPrimitiveArity,
  geometryPrimitiveArity,
  interactionPrimitiveArity,
  soundPrimitiveArity,
  spritesPrimitiveArity,
  turtlePrimitiveArity,
  tutorPrimitiveArity,
} from "./signatures.js";
import type { CheckProfile } from "./check.js";

/**
 * Is `name` a built-in name **no matter which profiles are active** (`spec/grammar.md:408`)?
 *
 * This is issue #838's branch: the Turtle & Rendering, Educational and Tutor tables that
 * {@link gatedPrimitiveCollision} never consulted, plus — by the same resolve-to-canonical construction
 * #742 established — any Heritage short alias of one of them. Between them they cover 44 of the 45
 * names AC2 measured as free at the saga tip (`mod`, the 45th, is a keyword and is reached by
 * {@link isKeyword}).
 *
 * It takes no `profiles` argument on purpose. A declaration is legal or illegal for the *version*,
 * never for the profile set a given run happens to claim, because "what a profile decides is
 * whether a name works, never whether a program may declare it" (`spec/grammar.md:408`). The
 * recursion is depth-1 by construction — no canonical spelling is itself an alias, which
 * `checker-reserved-word.test.mjs` pins directly off the registry.
 */
function unconditionalBuiltInName(name: string): boolean {
  if (
    turtlePrimitiveArity(name) !== undefined ||
    educationalPrimitiveArity(name) !== undefined ||
    tutorPrimitiveArity(name) !== undefined
  ) {
    return true;
  }
  const canonical = canonicalOfHeritageAlias(name);
  return canonical !== undefined && unconditionalBuiltInName(canonical);
}

/**
 * Is `name` a primitive of some **active** profile? The gated half of the primitive category, in
 * one place, so a profile slice adds exactly one branch here (`spec/tooling.md:184` "Required
 * behavior", applied against the active profile set per `:175-176`).
 *
 * Two properties this function exists to guarantee:
 *
 * 1. **Every profile is gated on its own claim**, so a Core-only program stays free to
 *    `define grid`/`define who`/`define pr`, exactly as it is free to `define ask`. Retiring these
 *    gates — `spec/grammar.md:408` makes profile words built-in unconditionally — is issue #841's
 *    always-on list; #838 moved only the names it measured (see {@link unconditionalBuiltInName}).
 * 2. **A Heritage alias is its canonical, by construction.** The `heritage` branch resolves through
 *    {@link canonicalOfHeritageAlias} and re-enters this same function on the canonical spelling
 *    rather than consulting a table of its own, so `define pr` is exactly as (il)legal as
 *    `define print` — no arity or name knowledge is duplicated and the two spellings cannot drift
 *    (issue #742; the same resolve-then-reuse shape as `signatures.ts`'s `heritageAliasArity`).
 *    The recursion is depth-1 by construction: no canonical spelling is itself an alias, which
 *    `checker-reserved-word.test.mjs` pins directly off the registry so a future alias whose
 *    canonical is another alias is caught rather than looping.
 */
function gatedPrimitiveCollision(
  name: string,
  profiles: readonly CheckProfile[],
): boolean {
  if (
    profiles.includes("core-language") &&
    corePrimitiveArity(name) !== undefined
  ) {
    return true;
  }
  if (profiles.includes("data") && dataPrimitiveArity(name) !== undefined) {
    return true;
  }
  if (
    profiles.includes("geometry") &&
    geometryPrimitiveArity(name) !== undefined
  ) {
    return true;
  }
  if (profiles.includes("sound") && soundPrimitiveArity(name) !== undefined) {
    return true;
  }
  if (
    profiles.includes("interaction-events") &&
    interactionPrimitiveArity(name) !== undefined
  ) {
    return true;
  }
  if (
    profiles.includes("sprites") &&
    spritesPrimitiveArity(name) !== undefined
  ) {
    return true;
  }
  if (profiles.includes("heritage")) {
    const canonical = canonicalOfHeritageAlias(name);
    if (canonical !== undefined) {
      return gatedPrimitiveCollision(canonical, profiles);
    }
  }
  return false;
}

/**
 * Does OpenLogo itself own `name` — as a keyword, or as a primitive of any kind including every
 * alias spelling? This is `ol-reserved-word`'s whole subject (`spec/error-model.md:125`).
 */
function isBuiltInName(
  name: string,
  profiles: readonly CheckProfile[],
): boolean {
  return (
    isKeyword(name, profiles) ||
    unconditionalBuiltInName(name) ||
    gatedPrimitiveCollision(name, profiles)
  );
}

/**
 * The one learner-facing sentence for a built-in name, from `spec/error-model.md:125`. It names no
 * category on purpose: *keyword*, *primitive* and *alias* MUST NOT appear (issue #883).
 *
 * **Lowercase after the period is deliberate**, and is the house voice rather than a typo:
 * `spec/error-model.md:18` requires "the warm, **lowercase** Logo voice", and its own canonical
 * example at `:20` reads `i don't know how to fowad. did you mean forward?`. Every shipped
 * diagnostic already follows it — `@openlogo/runtime`'s `errors.ts` has
 * "…`check the spelling.`" and "…`put it between 'define' and 'end'.`". The capitalized
 * spelling in `docs/design-notes/0007-binding-vs-registration.md` is the outlier (non-normative,
 * tracked as issue #887), not the model.
 */
function builtInMessage(name: string): string {
  return `${name} is already part of OpenLogo. choose another name.`;
}

function reservedWordDiagnostic(spannedName: SpannedName): Diagnostic {
  return {
    code: "ol-reserved-word",
    source_span: spannedName.source_span,
    params: { name: spannedName.name },
    message: builtInMessage(spannedName.name),
    stage: "semantic",
    severity: "error",
  };
}

/**
 * `ol-duplicate-definition` at the later declaration, carrying the earlier one's span in
 * `params.original_span` (`spec/error-model.md:126,143-146`). Both spans are required identity, not
 * message decoration: `original_span` is "an ordinary `params` entry with the same shape as
 * `source_span`", and an implementation "MUST supply it rather than folding the earlier location
 * into the message text" — which is also what lets an editor offer *jump to the first definition*
 * and what makes the code work unchanged when the earlier declaration is in another document.
 */
function duplicateDefinitionDiagnostic(
  spannedName: SpannedName,
  originalSpan: SourceSpan,
): Diagnostic {
  return {
    code: "ol-duplicate-definition",
    source_span: spannedName.source_span,
    params: { name: spannedName.name, original_span: originalSpan },
    message: `you already defined ${spannedName.name} on line ${originalSpan.start[0]}.`,
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
 * The declaration-slot rule, over the grammar's **declaration slots** — and only those (issue
 * #833's maintainer ruling; see the module doc comment's form table).
 *
 * Every `define`/`to` and `struct` name is looked up once, and answers with the one code that fits:
 * `ol-reserved-word` when OpenLogo owns the name ({@link isBuiltInName} — a keyword, or a primitive
 * of any profile including every alias spelling), otherwise `ol-duplicate-definition` when an
 * earlier `define`/`struct` in the program already declared it. Built-in wins, so a name that is
 * both is reported once, as the thing the learner cannot change.
 *
 * A `define`/`struct` is checked only against declarations *already seen earlier in
 * source order* — including across the two kinds — so the first declaration of a name stays clean
 * and each later one (whichever kind it is) is flagged against it. That is what supplies
 * `original_span`, and why checking the full program symmetrically would be wrong: it would flag
 * both sides of a single collision and leave "which one came first" unanswerable.
 *
 * Every **binding** position — `local`, an assignment target, a `for`/comprehension binder, a
 * destructuring name, a `reduce` accumulator, a procedure parameter, a struct field, a dictionary
 * key — is deliberately not visited: `spec/grammar.md:386` makes accepting them a MUST.
 *
 * Findings are returned in **source order**, which the walk's pre-order gives directly now that
 * only a declaration's own name is checked, and across both codes because one walk emits both.
 * (The rule used to sort by span start, because a keyword inside an *earlier* parameter's default
 * expression was reached later than the `ProcedureDefNode` carrying it; with parameters no longer
 * checked, that was the only out-of-order case and the sort became dead weight.) A consumer —
 * conformance fixture, editor, LSP — can rely on the order unconditionally either way.
 *
 * **Both declaration kinds are treated identically, and neither is profile-gated.** `define` and
 * `struct` share one first-declaration map, so a name's first declaration wins whichever kind it is
 * and every later one names *that* span. An earlier revision (issue #838's first round) kept two
 * maps and consulted procedures before structs, which had two defects a review caught:
 *
 * - `struct f` / `define f` / `define f` pointed the third declaration's `original_span` at the
 *   **second**, because the procedure map's first entry was the second declaration overall.
 *   `spec/error-model.md:126` wants the earlier declaration, and "earlier" is a property of the
 *   program, not of the node kind.
 * - The duplicate check was gated on `"data"` (inherited from issue #405's reasoning for the *old*
 *   rule), so Core-only `struct f` twice — and `define f` then `struct f` — checked **clean**.
 *   That is wrong twice over. `spec/execution-model.md:82-88` makes phase-1 registration
 *   unconditional ("The reader registers every `define`/`to` procedure **and every `struct`
 *   declaration** … a name an earlier declaration in the program or an imported module already
 *   registered raises `ol-duplicate-definition`"), and `spec/data-structures.md:304` says the same.
 *   #405 reasoned about what a declaration *registers*; a duplicate is a property of what the
 *   program *declares*, which no profile changes. And the runtime's own phase-1 guard
 *   (`execute-internal.ts`'s `collectStructs`) is profile-blind, so the gate made `check()` and
 *   `execute()` disagree — the exact disagreement `docs/design-notes/0007-binding-vs-registration.md`
 *   says this ruling removes.
 *
 * `checker-names.ts` and `checker-arity.ts` keep their own `data` gates, and correctly so: those
 * rules answer "is this name *visible* to call", which is precisely what a profile decides
 * (`spec/grammar.md:408`). This rule answers "may the program declare it", which a profile never
 * decides. Same word, two different questions.
 */
export function declarationSlotRule(
  program: ProgramNode,
  profiles: readonly CheckProfile[],
): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  /**
   * The span of the **first** declaration of each name, across both declaration kinds. Only ever
   * written when absent, so the third declaration of a name still names the first — and so a
   * built-in name is never recorded at all, which is what keeps `define forward` twice reporting
   * two `ol-reserved-word`s rather than degrading the second into a duplicate.
   */
  const firstDeclaration = new Map<string, SourceSpan>();

  walk(program, (node) => {
    if (!isProcedureDef(node) && !isStructDef(node)) {
      return;
    }
    const declared = node.name;
    const name = declared.name.toLowerCase();
    if (isBuiltInName(name, profiles)) {
      diagnostics.push(reservedWordDiagnostic(declared));
      return;
    }
    const originalSpan = firstDeclaration.get(name);
    if (originalSpan !== undefined) {
      diagnostics.push(duplicateDefinitionDiagnostic(declared, originalSpan));
      return;
    }
    firstDeclaration.set(name, declared.source_span);
  });

  return diagnostics;
}
