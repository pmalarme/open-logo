/**
 * The `ol-reserved-word` semantic rule (issue #113): a `define`/`local` registration whose name
 * collides with a reserved structural word, a Core primitive, or an existing procedure raises
 * `ol-reserved-word` with `params: { name, namespace }` (`spec/error-model.md:123`). Issue #405
 * extends this to the Data profile: a Data primitive (`dict`, `keys`, …) collides the same way a
 * Core primitive does when `"data"` is active, and `struct` type-name registrations — which
 * declare a same-named constructor reporter, `spec/data-structures.md:252-266` — are now checked
 * the same way `define` is, including against each other and against `define`d procedure names
 * (mirroring `@openlogo/runtime`'s own phase-1 registration guard, `execute-internal.ts`'s
 * `collectStructs`).
 *
 * Scope boundary: the spec's row also lists `to` (Heritage's `define` spelling) and `alias`
 * registrations, but neither has an AST node yet (Heritage/Modules are later profiles —
 * `ast.ts` has no `AliasDefNode`), so only the three registration forms the AST can represent —
 * {@link ProcedureDefNode} (`define`), {@link LocalNode} (`local`), and {@link StructDefNode}
 * (`struct`) — are checked here. A parameter name collision is not checked either: the spec row
 * scopes this rule to *registrations* (`define`/`to`/`struct`/`local`/`alias`), and a parameter is
 * a binding site, not one of those five forms.
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
 */

import type { Diagnostic } from "@openlogo/core";
import type {
  AnyNode,
  LocalNode,
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
  if (isReservedWord(name)) {
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

function isLocal(node: AnyNode): node is LocalNode {
  return node.kind === "Local";
}

function isStructDef(node: AnyNode): node is StructDefNode {
  return node.kind === "StructDef";
}

/**
 * The `ol-reserved-word` rule: every `define`/`local`/`struct` registration whose name collides
 * with a reserved word, a Core, Data, or Geometry primitive, or an existing procedure/struct raises
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
    }
  });

  return diagnostics;
}
