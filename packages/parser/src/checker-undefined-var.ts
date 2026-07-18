/**
 * The `ol-undefined-var` semantic rule (issue #113): a static read of an unbound `:name` — a
 * bare {@link VarRefNode}, with no leading postfix — or a `thing "name"` call whose literal
 * argument names an unbound variable, with no visible declaration anywhere in the program
 * (`spec/tooling.md:183-184`).
 *
 * Scope boundary: only bare `:name` reads are checked, per the issue's own scoping — a postfixed
 * read such as `:people.tom.age` parses to a {@link PlaceNode}, not a `VarRefNode` (the parser
 * only grows a bare `:name` into a `Place` when it carries a postfix — see the `PlaceNode` doc
 * comment in `ast.ts`), and resolving a struct/dict field chain statically is Data-profile,
 * type-directed work outside this rule.
 *
 * Declaration model: this uses the same whole-program, scope-insensitive "declared anywhere is
 * visible" shape `collectVisibleNames` (#117) and the arity rule's procedure-arity table (#111)
 * already use for callables — a name is declared if it is EVER a procedure parameter, a `local`
 * name, an assignment target's base, or a loop/comprehension binder anywhere in the program,
 * regardless of textual position. `spec/execution-model.md:322-327`: assigning an undeclared
 * name always creates or updates a global rather than erroring, so only READS can be unbound —
 * an assignment target is therefore always a declaration, never itself checked as a read. This
 * flat model trades cross-scope leakage precision for simplicity and — critically — for never
 * reporting a speculative false positive on a name that is genuinely bound in another scope.
 */

import type { Diagnostic } from "@openlogo/core";
import type {
  AssignNode,
  CallNode,
  ExpressionNode,
  ParenCallNode,
  ProgramNode,
  WordLitNode,
} from "./ast.js";
import { walk } from "./ast.js";

/** The base variable name a well-formed assignment declares, or `undefined` for a malformed (non-place) target — see `ol-not-a-place`, which already reports those separately. */
function placeBaseName(place: AssignNode["place"]): string | undefined {
  return place.kind === "Place" ? place.base.name.toLowerCase() : undefined;
}

/**
 * Every variable name the program declares anywhere: procedure parameters, `local` names,
 * assignment target bases, and every loop/comprehension binder (`for`, `map`/`filter`/`reduce`).
 * See the module doc comment for why this is deliberately whole-program and scope-insensitive.
 */
function collectDeclaredVariableNames(
  program: ProgramNode,
): ReadonlySet<string> {
  const names = new Set<string>();

  walk(program, (node) => {
    switch (node.kind) {
      case "ProcedureDef":
        for (const param of node.params) {
          names.add(param.name.name.toLowerCase());
        }
        break;
      case "Local":
        for (const name of node.names) {
          names.add(name.name.toLowerCase());
        }
        break;
      case "Assign": {
        const base = placeBaseName(node.place);
        if (base !== undefined) {
          names.add(base);
        }
        break;
      }
      case "ForIn":
        names.add(node.binder.name.toLowerCase());
        break;
      case "ForRange":
        names.add(node.variable.name.toLowerCase());
        break;
      case "Comprehension":
        names.add(node.binder.name.toLowerCase());
        if (node.form === "reduce") {
          names.add(node.accumulator.name.toLowerCase());
        }
        break;
      default:
        break;
    }
  });

  return names;
}

/** Is `node` a `thing "name"` call — the one form whose literal argument statically names a variable? */
function thingCallArg(node: CallNode | ParenCallNode): WordLitNode | undefined {
  if (node.callee.name.toLowerCase() !== "thing" || node.args.length !== 1) {
    return undefined;
  }
  // `node.args.length === 1` guarantees index 0 is populated; `noUncheckedIndexedAccess` cannot
  // correlate a `.length` check with indexed access, so this documents the invariant instead of
  // adding a redundant runtime `undefined` check whose "undefined" branch could never be taken
  // (the same documented-invariant-cast shape `checker-not-a-place.ts`'s `RenderableNode` cast
  // uses, and for the same reason: an unreachable branch fails the 100% coverage gate).
  const arg = node.args[0] as ExpressionNode;
  return arg.kind === "WordLit" ? arg : undefined;
}

/** The learner-facing message template for a read of an unbound variable name. */
function messageFor(name: string): string {
  return `:${name} is not defined yet. declare it with a parameter, 'local', or an assignment first.`;
}

function undefinedVarDiagnostic(
  name: string,
  span: Diagnostic["source_span"],
): Diagnostic {
  return {
    code: "ol-undefined-var",
    source_span: span,
    params: { name },
    message: messageFor(name),
    stage: "semantic",
    severity: "error",
  };
}

/**
 * The `ol-undefined-var` rule: every bare `:name` read, and every `thing "name"` call, whose name
 * has no declaration anywhere in the program raises one diagnostic at the name's own span.
 */
export function undefinedVarRule(program: ProgramNode): readonly Diagnostic[] {
  const declared = collectDeclaredVariableNames(program);
  const diagnostics: Diagnostic[] = [];

  walk(program, (node) => {
    if (node.kind === "VarRef") {
      const name = node.name.toLowerCase();
      if (!declared.has(name)) {
        diagnostics.push(undefinedVarDiagnostic(name, node.source_span));
      }
      return;
    }
    if (node.kind !== "Call" && node.kind !== "ParenCall") {
      return;
    }
    const wordArg = thingCallArg(node);
    if (wordArg === undefined) {
      return;
    }
    const name = wordArg.value.toLowerCase();
    if (!declared.has(name)) {
      diagnostics.push(undefinedVarDiagnostic(name, wordArg.source_span));
    }
  });

  return diagnostics;
}
