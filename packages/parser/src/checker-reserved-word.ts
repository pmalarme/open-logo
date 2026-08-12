/**
 * The `ol-reserved-word` semantic rule. **As first delivered (issue #113)** it covered a
 * `define`/`local` registration whose name
 * collides with a reserved structural word, a Core primitive, or an existing procedure, raising
 * `ol-reserved-word` with `params: { name, namespace }` (`spec/error-model.md:123`). Issue #405
 * extends this to the Data profile: a Data primitive (`dict`, `keys`, …) collides the same way a
 * Core primitive does when `"data"` is active, and `struct` type-name registrations — which
 * declare a same-named constructor reporter, `spec/data-structures.md:252-266` — are now checked
 * the same way `define` is, including against each other and against `define`d procedure names
 * (mirroring `@openlogo/runtime`'s own phase-1 registration guard, `execute-internal.ts`'s
 * `collectStructs`).
 *
 * Scope boundary (issue #739 — **maintainer ruling, "reserved word is reserved word"**): this rule
 * applies to **every form that introduces a name**, not only to registration sites. An earlier
 * revision of this comment scoped it to *registrations* (`define`/`to`/`struct`/`local`/`alias`)
 * and cited `spec/error-model.md:124`'s "where freshness is required" to justify leaving
 * assignment, loop/comprehension binders, and parameters unchecked. **That reading was overruled
 * on #739 and no longer describes this file.** The rationale on the record: assignment is the
 * *primary* way to create a variable in OpenLogo and `local` is optional (`:brandnew = 1` then
 * `print :brandnew` checks clean with no declaration anywhere), so a rule enforced only at `local`
 * is bypassable by omitting an optional keyword — which would make `spec/grammar.md:367`'s "may not
 * be redefined **as variables**" close to meaningless in a learner-facing language. Every form that
 * introduces a **variable, procedure, or struct type constructor** name is therefore checked:
 *
 * | Form | Node | Category checked |
 * |---|---|---|
 * | `define name` / `to name` | {@link ProcedureDefNode} | registration — all four |
 * | `struct name` | {@link StructDefNode} | registration — all four |
 * | `local name` | {@link LocalNode} | registration — all four |
 * | `:name = v` / `set name to v` / `make "name" v` | {@link AssignNode} | binding — reserved only |
 * | `for name in …` / `for name from … to …` | {@link ForInNode}/{@link ForRangeNode} | binding — reserved only |
 * | `map`/`filter`/`reduce` binder + `reduce` accumulator | {@link ComprehensionNode} | binding — reserved only |
 * | `for [ :a :b ] in …` destructuring names | {@link DestructuringBinderNode} | binding — reserved only |
 * | `define f :param` / `define f ( :param default )` | {@link ProcedureDefNode}'s `params` | binding — reserved only |
 *
 * Two name-introducing forms are deliberately **absent** from that table, and neither is an
 * oversight. `alias` targets have no AST node yet (Modules is a later profile — `ast.ts` has no
 * `AliasDefNode`), so the rule cannot reach them. **`struct` field names** ({@link StructDefNode}'s
 * `fields`) introduce names but are *legal* even when reserved, because they are not in the
 * variable or callable namespace at all: `spec/grammar.md:369` — "Record field names live in a
 * per-type namespace reached only by `.field`, so they do not collide with globals or structural
 * words." So `struct point [ repeat y ]` checks clean, by design.
 *
 * **Why binding forms check the reserved-word category only** (see {@link bindingCollision}): the
 * sentence the ruling enforces, `spec/grammar.md:367`, has *reserved words* as its subject — "They
 * may not be redefined as variables, procedures, primitives, or struct type constructors". A
 * *primitive* being shadowed by a variable is a different claim, and `spec/grammar.md:369` denies
 * it: "Primitives, user procedures, and struct type constructors share one callable namespace" —
 * `:name` variables are not in that namespace, so `:count = 1` shadows nothing and stays clean.
 * Reserved words are not namespaced at all; they are structural tokens the reader recognizes
 * (`:367`), which is exactly why they alone collide from a binding position. This is also the
 * blast radius the ruling predicted (`:repeat = 1`, `:if = 1`, `:while = 1` — all reserved words,
 * no primitives). The three registration forms keep their full four-category check unchanged,
 * because a `define`/`struct`/`local` name *does* enter that shared callable namespace.
 *
 * **This narrowing is deliberate — do not "fix" it into a bug.** Widening
 * {@link bindingCollision} to {@link collidingNamespace}'s four categories looks like a tidy
 * unification and would immediately reject `:count = 1`, `:first = 1`, `:last = 1`, and
 * `:word = 1` — `count`/`first`/`last`/`word` are all Core primitives, and `:count = 1` is the
 * archetypal learner counter. Rejecting it in a language written for beginners is a severe false
 * positive that the #739 ruling never sanctioned.
 *
 * **Why a nested place is not a binding site:** only a *bare* place head introduces a name, so
 * `AssignNode` is checked only when its {@link PlaceNode} target has no postfix segments.
 * `:people.tom.age = 30` and `:nums[1] = 5` write *into* an existing structure — their base is
 * read, not introduced, so a reserved base can only be there if some earlier bare binding put it
 * there, and that binding is itself flagged (an unbound one raises `ol-undefined-var` instead).
 * The segments themselves introduce no *variable* binding: `spec/grammar.md:369` — "Record field
 * names live in a per-type namespace reached only by `.field`, so they do not collide with globals
 * or structural words. Dictionary keys and selector bare keys are data, not declarations, so
 * reserved words are legal keys."
 *
 * `namespace` priority when a name collides with more than one category (only reachable today via
 * `thing`, which is both a reserved word and a Core primitive): reserved word, then primitive,
 * then existing procedure, then existing struct — checked in that order, so the more fundamental
 * category wins.
 *
 * Issue #427 (M4 audit) extends the primitive branch again to the Geometry profile: `grid`,
 * `axes`, and `measure` (`signatures.ts`'s `geometryPrimitiveArity`) collide the same way a Core
 * or Data primitive does when `"geometry"` is active, mirroring the Data branch #405 added — gated
 * the same way, so a Core-only program is free to `define grid`.
 *
 * Issue #663 (C1, M5) extends the *reserved-word* branch the same profile-conditional way: the
 * Sprites block-heads `ask`/`each`/`tell` and the Interaction & Events block-heads
 * `when`/`every`/`on_key`/`on_click` are reserved only when their profile is active
 * (`OL_PROFILE_RESERVED_WORDS` in `reserved.ts`; `spec/turtles-and-sprites.md`,
 * `spec/interaction-events.md`). Threading the active `profiles` into `isReservedWord` here — the
 * profile-blind default kept every Core-only program's `ask`/`when` an ordinary name — is the whole
 * wiring; the registry and its non-regression guarantee live in `reserved.ts`.
 *
 * Issue #687 (I8, M5) extends the *primitive* branch to the Interaction & Events profile's `wait`
 * (`signatures.ts`'s `interactionPrimitiveArity`), gated on `"interaction-events"` exactly like the
 * Data/Geometry/Sound branches above. `wait` is an ordinary primitive rather than a reserved
 * block-head, but `spec/tooling.md:184` makes redefining a *primitive* `ol-reserved-word` just the
 * same — the block-head/primitive distinction decides which branch reports it and under which
 * profile, not whether it is reportable at all. Without this, `wait` was the Interaction profile's
 * one primitive and yet the only one of the Data/Geometry/Sound/Interaction primitives a program
 * could silently shadow. (The Turtle & Rendering and Sprites primitive tables are still not
 * consulted here, so `define forward`/`define who` remain accepted — a separate pre-existing gap,
 * not this profile's to close.)
 */

import type { Diagnostic } from "@openlogo/core";
import type {
  AnyNode,
  AssignNode,
  Binder,
  ComprehensionNode,
  DestructuringBinderNode,
  ForInNode,
  ForRangeNode,
  LocalNode,
  PlaceNode,
  ProcedureDefNode,
  ProgramNode,
  SpannedName,
  StructDefNode,
} from "./ast.js";
import { walk } from "./ast.js";
import { isReservedWord } from "./reserved.js";
import {
  corePrimitiveArity,
  dataPrimitiveArity,
  geometryPrimitiveArity,
  interactionPrimitiveArity,
  soundPrimitiveArity,
} from "./signatures.js";
import type { CheckProfile } from "./check.js";

/** One collision category a redefined name can fall into, in priority order. */
type Namespace = "reserved" | "primitive" | "procedure" | "struct";

/** The empty struct-name set for callers that have no struct collisions to check. */
const NO_STRUCTS: ReadonlySet<string> = new Set();

/** The collision category `name` falls into under `profiles`, or `undefined` if it is free to declare. */
function collidingNamespace(
  name: string,
  profiles: readonly CheckProfile[],
  declaredProcedures: ReadonlySet<string>,
  declaredStructs: ReadonlySet<string> = NO_STRUCTS,
): Namespace | undefined {
  if (isReservedWord(name, profiles)) {
    return "reserved";
  }
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
  if (declaredProcedures.has(name)) {
    return "procedure";
  }
  if (declaredStructs.has(name)) {
    return "struct";
  }
  return undefined;
}

/**
 * The collision category `name` falls into when it appears in a **binding** position — assignment,
 * a loop/comprehension binder, or a procedure parameter (issue #739) — or `undefined` if it is free
 * to bind. Only the reserved-word category applies here, unlike {@link collidingNamespace}'s full
 * four-category check for the three *registration* forms: a binding introduces a `:name` variable,
 * and `spec/grammar.md:369` keeps variables out of the one callable namespace primitives, user
 * procedures, and struct constructors share — so `:count = 1` shadows nothing, while a reserved
 * word is a structural token the reader recognizes (`spec/grammar.md:367`) and collides from any
 * position. Profile-conditional reserved words (`tell`/`ask`/`each`, `when`/`every`/`on_key`/
 * `on_click`) collide only while their profile is active, exactly as they do at a registration.
 */
function bindingCollision(
  name: string,
  profiles: readonly CheckProfile[],
): Namespace | undefined {
  return isReservedWord(name, profiles) ? "reserved" : undefined;
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

/**
 * Order two diagnostics by where their span starts — line first, then column. Used to return this
 * rule's findings in source order (see {@link reservedWordRule}).
 */
function compareBySpanStart(left: Diagnostic, right: Diagnostic): number {
  const [leftLine, leftColumn] = left.source_span.start;
  const [rightLine, rightColumn] = right.source_span.start;
  return leftLine - rightLine || leftColumn - rightColumn;
}

function isProcedureDef(node: AnyNode): node is ProcedureDefNode {
  return node.kind === "ProcedureDef";
}

function isLocal(node: AnyNode): node is LocalNode {
  return node.kind === "Local";
}

function isStructDef(node: AnyNode): node is StructDefNode {
  return node.kind === "StructDef";
}

function isAssign(node: AnyNode): node is AssignNode {
  return node.kind === "Assign";
}

function isForIn(node: AnyNode): node is ForInNode {
  return node.kind === "ForIn";
}

function isForRange(node: AnyNode): node is ForRangeNode {
  return node.kind === "ForRange";
}

function isComprehension(node: AnyNode): node is ComprehensionNode {
  return node.kind === "Comprehension";
}

function isDestructuringBinder(node: AnyNode): node is DestructuringBinderNode {
  return node.kind === "DestructuringBinder";
}

/**
 * The name a {@link Binder} introduces directly, or `undefined` for a destructuring pattern — whose
 * names are reached through its own {@link DestructuringBinderNode}, walked as a child of the
 * `for … in`/comprehension that carries it (`ast.ts`'s `childrenOf`), so they are checked exactly
 * once and never twice.
 */
function bareBinderName(binder: Binder): SpannedName | undefined {
  return "kind" in binder ? undefined : binder;
}

/**
 * The bare name an {@link AssignNode} introduces — the head of a zero-segment {@link PlaceNode},
 * covering all three surface spellings (`:name = v`, `set name to v`, and Heritage `make "name" v`,
 * which lowers to the identical node). `undefined` when the target has postfix segments (a write
 * *into* an existing structure, which introduces no name) or is not a place at all (the parser
 * keeps a malformed target so `ol-not-a-place` can report it) — see the module doc comment.
 */
function assignedBareName(node: AssignNode): SpannedName | undefined {
  const place = node.place;
  if (place.kind !== "Place" || place.segments.length > 0) {
    return undefined;
  }
  return place.base;
}

/**
 * The `ol-reserved-word` rule, over **every form that introduces a name** (issue #739's maintainer
 * ruling — see the module doc comment's form table and the two boundary notes it states).
 *
 * *Registrations* — every `define`/`local`/`struct` whose name collides
 * with a reserved word, a Core, Data, Geometry, Sound, or Interaction & Events primitive, or an
 * existing procedure/struct raises
 * one diagnostic at that name's own span. A `local` is checked against every procedure name in the
 * program, since procedures are visible program-wide regardless of declaration order
 * (`checker-names.ts`, `@openlogo/runtime`'s phase-1 registration). A `define`/`struct`, though, is
 * checked only against procedures and structs *already seen earlier in source order* — including
 * across the two kinds — so the first registration of a name stays clean and each later one
 * (whichever kind it is) is flagged as colliding with it, mirroring how two `define`s of the same
 * name are already handled: "already defined" needs a first occurrence to compare against, and
 * checking the full program symmetrically would flag both sides of a single collision instead of
 * just the later one.
 *
 * *Bindings* — an assignment target (`:name = v`, `set name to v`, `make "name" v`), a `for … in`
 * or `for … from … to` binder, a `map`/`filter`/`reduce` binder and a `reduce` accumulator, each
 * name of a destructuring pattern, and each procedure parameter raise one diagnostic at that name's
 * own span when the name is reserved ({@link bindingCollision} — reserved words only, and
 * profile-conditional ones only while their profile is active).
 *
 * Findings are returned in **source order**. The walk's pre-order already gives that for every form
 * but one: a procedure's parameters are checked when its {@link ProcedureDefNode} is visited, while
 * a reserved name inside an *earlier* parameter's default expression — `define f ( :a map repeat in
 * [1 2] [ 1 ] ) ( :while 2 )` — is only reached later, as a walked child. Sorting by span start
 * ({@link compareBySpanStart}) fixes that case and is a no-op for every other, so a consumer
 * (conformance fixture, editor, LSP) can rely on the order unconditionally.
 *
 * Struct participation — both `StructDef`'s own collision check and a `struct` colliding with a
 * `local`/`define` — is gated on `"data"` being active (issue #405), mirroring
 * `checker-names.ts`'s and `checker-arity.ts`'s own `data` gate: with `data` inactive, a struct
 * declaration registers no constructor at all (`collectVisibleNames`), so it must not participate
 * in collision checks here either, or a Core-only program could be flagged for a name that isn't
 * actually registered.
 */
export function reservedWordRule(
  program: ProgramNode,
  profiles: readonly CheckProfile[],
): readonly Diagnostic[] {
  const dataActive = profiles.includes("data");

  const declaredProcedures = new Set<string>();
  const declaredStructs = new Set<string>();
  walk(program, (node) => {
    if (isProcedureDef(node)) {
      declaredProcedures.add(node.name.name.toLowerCase());
    } else if (dataActive && isStructDef(node)) {
      declaredStructs.add(node.name.name.toLowerCase());
    }
  });

  const diagnostics: Diagnostic[] = [];
  const seenProcedures = new Set<string>();
  const seenStructs = new Set<string>();

  /** Report `spannedName` when binding it would collide with a reserved word. */
  const checkBinding = (spannedName: SpannedName | undefined): void => {
    if (spannedName === undefined) {
      return;
    }
    const namespace = bindingCollision(
      spannedName.name.toLowerCase(),
      profiles,
    );
    if (namespace !== undefined) {
      diagnostics.push(reservedWordDiagnostic(spannedName, namespace));
    }
  };

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
      for (const param of node.params) {
        checkBinding(param.name);
      }
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
      return;
    }
    if (isLocal(node)) {
      for (const spannedName of node.names) {
        const name = spannedName.name.toLowerCase();
        const namespace = collidingNamespace(
          name,
          profiles,
          declaredProcedures,
          declaredStructs,
        );
        if (namespace !== undefined) {
          diagnostics.push(reservedWordDiagnostic(spannedName, namespace));
        }
      }
      return;
    }
    if (isAssign(node)) {
      checkBinding(assignedBareName(node));
      return;
    }
    if (isForIn(node)) {
      checkBinding(bareBinderName(node.binder));
      return;
    }
    if (isForRange(node)) {
      checkBinding(node.variable);
      return;
    }
    if (isComprehension(node)) {
      if (node.form === "reduce") {
        checkBinding(node.accumulator);
      }
      checkBinding(bareBinderName(node.binder));
      return;
    }
    if (isDestructuringBinder(node)) {
      for (const spannedName of node.names) {
        checkBinding(spannedName);
      }
    }
  });

  return diagnostics.sort(compareBySpanStart);
}
