/**
 * The `ol-reserved-word` semantic rule (issue #113): a `define`/`local` registration whose name
 * collides with a reserved structural word, a Core primitive, or an existing procedure raises
 * `ol-reserved-word` with `params: { name, namespace }` (`spec/error-model.md:123`).
 *
 * Scope boundary: the spec's row also lists `to` (Heritage's `define` spelling), `struct`, and
 * `alias` registrations, but none of those has an AST node yet (Heritage/Data/Modules are later
 * profiles — `ast.ts` has no `StructDefNode`/`AliasDefNode`), so only the two registration forms
 * the Core-Language AST can represent — {@link ProcedureDefNode} (`define`) and {@link LocalNode}
 * (`local`) — are checked here. A parameter name collision is not checked either: the spec row
 * scopes this rule to *registrations* (`define`/`to`/`struct`/`local`/`alias`), and a parameter is
 * a binding site, not one of those five forms.
 *
 * `namespace` priority when a name collides with more than one category (only reachable today via
 * `thing`, which is both a reserved word and a Core primitive): reserved word, then primitive,
 * then existing procedure — checked in that order, so the more fundamental category wins.
 */

import type { Diagnostic } from "@openlogo/core";
import type {
  AnyNode,
  LocalNode,
  ProcedureDefNode,
  ProgramNode,
  SpannedName,
} from "./ast.js";
import { walk } from "./ast.js";
import { isReservedWord } from "./reserved.js";
import { corePrimitiveArity } from "./signatures.js";
import type { CheckProfile } from "./check.js";

/** One collision category a redefined name can fall into, in priority order. */
type Namespace = "reserved" | "primitive" | "procedure";

/** The collision category `name` falls into under `profiles`, or `undefined` if it is free to declare. */
function collidingNamespace(
  name: string,
  profiles: readonly CheckProfile[],
  declaredProcedures: ReadonlySet<string>,
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
  if (declaredProcedures.has(name)) {
    return "procedure";
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

/**
 * The `ol-reserved-word` rule: every `define`/`local` registration whose name collides with a
 * reserved word, a Core primitive, or an earlier `define` of the same name raises one diagnostic
 * at that name's own span. Procedures are visible program-wide regardless of declaration order
 * (`checker-names.ts`), so a `local` is checked against every procedure name in the program, but
 * two `define`s of the same name are checked in source order — the first stays clean, and each
 * later one is flagged — since, unlike a callable lookup, "already defined" needs a first
 * occurrence to compare against.
 */
export function reservedWordRule(
  program: ProgramNode,
  profiles: readonly CheckProfile[],
): readonly Diagnostic[] {
  const declaredProcedures = new Set<string>();
  walk(program, (node) => {
    if (isProcedureDef(node)) {
      declaredProcedures.add(node.name.name.toLowerCase());
    }
  });

  const diagnostics: Diagnostic[] = [];
  const seenProcedures = new Set<string>();

  walk(program, (node) => {
    if (isProcedureDef(node)) {
      const name = node.name.name.toLowerCase();
      const namespace = collidingNamespace(name, profiles, seenProcedures);
      if (namespace !== undefined) {
        diagnostics.push(reservedWordDiagnostic(node.name, namespace));
      }
      seenProcedures.add(name);
      return;
    }
    if (isLocal(node)) {
      for (const spannedName of node.names) {
        const name = spannedName.name.toLowerCase();
        const namespace = collidingNamespace(
          name,
          profiles,
          declaredProcedures,
        );
        if (namespace !== undefined) {
          diagnostics.push(reservedWordDiagnostic(spannedName, namespace));
        }
      }
    }
  });

  return diagnostics;
}
