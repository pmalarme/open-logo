/**
 * The Layer-2 control-flow static rules (issue #114) — the five semantic diagnostics that judge
 * *where* a control-flow escape is written and *whether* a comprehension body can produce a value,
 * all at `stage: "semantic"` with the exact `ol-*` identities `@openlogo/core` registers:
 *
 * - `ol-return-outside-proc` — `return` (Core; `output`/`op` are the Heritage spellings this node's
 *   `keyword` also carries) used where no enclosing `define … end` procedure body exists
 *   (`spec/error-model.md:114`, `spec/tooling.md:189` — *point at the control word*).
 * - `ol-stop-outside-proc` — `stop` used outside any procedure body (`spec/error-model.md:117`).
 * - `ol-return-in-comprehension` — a `return`/`stop` anywhere inside a `map`/`filter`/`reduce`
 *   body. The spec (`spec/execution-model.md:406-407`, `spec/error-model.md:115`) says a
 *   comprehension body "cannot contain `return`/`output`/`op`" and reports by its last expression;
 *   this code is *preferred over the outside-proc codes* whenever the offending escape is inside a
 *   comprehension body, even one nested in a procedure — a comprehension is a value context, not a
 *   control context. The spec's prose enumerates `return`/`output`/`op`; per the issue #114 design
 *   a `stop` inside a comprehension (which the outside-proc code cannot describe once the
 *   comprehension is itself inside a procedure) is routed here too, carried by the `keyword` param.
 * - `ol-no-value` — a `map`/`filter`/`reduce` body that statically cannot end in a value-producing
 *   expression (`spec/error-model.md:113`, `spec/execution-model.md:406`). Reproduces the spec's
 *   worked example `map num in :nums [ print :num ]` → `ol-no-value { form: "map" }`
 *   (`spec/tooling.md:220-228`). A `return`/`stop` final statement is *not* double-reported here —
 *   it is already the more specific `ol-return-in-comprehension`.
 * - `ol-duplicate-binder` — a binder name repeated where names must be distinct: a `reduce`
 *   accumulator equal to its item binder (`spec/execution-model.md:404,741`), or a repeated name in
 *   a `for [:x :x] in …` destructuring pattern (`spec/error-model.md:116`).
 *
 * The rule walks the Core AST once, threading two pieces of lexical context — whether we are inside
 * a procedure body, and the form of the nearest enclosing comprehension body — so an escape is
 * judged by where it *lexically* sits. Diagnostic identity is `code` + `params`; messages are warm
 * lowercase Logo prose and never part of the contract.
 */

import type { Diagnostic, SourceSpan } from "@openlogo/core";
import type {
  AnyNode,
  ComprehensionNode,
  DestructuringBinderNode,
  NodeKind,
  ProgramNode,
  ReduceComprehensionNode,
  ReturnNode,
  SpannedName,
  StatementNode,
  StopNode,
} from "./ast.js";
import { childrenOf } from "./ast.js";
import type { CheckProfile } from "./check.js";

/** The three comprehension forms, the `form` param value for the comprehension-scoped codes. */
type ComprehensionForm = ComprehensionNode["form"];

/** The lexical context an escape/comprehension is judged in as the walk descends. */
interface Context {
  /** Are we inside a `define … end` procedure body? */
  readonly inProcedure: boolean;
  /** The form of the nearest enclosing comprehension body, or `undefined` if none. */
  readonly comprehensionForm: ComprehensionForm | undefined;
}

/**
 * The Core primitives whose kind is **Command** (`spec/commands.md`): they perform an effect and
 * report no value, so a comprehension body ending in one produces nothing. Every other Core
 * primitive is a Reporter, and the infix operators (`+ - * / mod == …`) parse as {@link CallNode}s
 * with the operator as callee and always report a value. Turtle and later-profile commands are not
 * registered in the parser, so — per "tools MUST NOT report speculative errors" — a call whose
 * callee is not a *known* Core command is treated as value-producing.
 */
const CORE_COMMANDS: ReadonlySet<string> = new Set([
  "print",
  "show",
  "randomize",
]);

/** AST node kinds that are always value-producing expressions in the Core grammar. */
const VALUE_PRODUCING_KINDS: ReadonlySet<NodeKind> = new Set<NodeKind>([
  "NumberLit",
  "WordLit",
  "BooleanLit",
  "ListLit",
  "VarRef",
  "Place",
  "ComparisonChain",
  "IsPredicate",
  "Comprehension",
]);

/**
 * The span of just the control word of a `return`/`stop` — `spec/tooling.md:189` mandates pointing
 * at the control word, but a {@link ReturnNode}'s own span covers `return <value>`. A `stop` node's
 * span is already the bare keyword; a `return`'s keyword span is synthesized from its start plus the
 * keyword's own length (spans are half-open `[start, end)`, columns 1-based).
 */
function controlWordSpan(node: ReturnNode | StopNode): SourceSpan {
  if (node.kind === "Stop") {
    return node.source_span;
  }
  const { document, start } = node.source_span;
  return { document, start, end: [start[0], start[1] + node.keyword.length] };
}

/** Build an `ol-duplicate-binder` at the repeated binder's own span. */
function duplicateBinderDiagnostic(
  name: SpannedName,
  form: "reduce" | "destructuring",
): Diagnostic {
  return {
    code: "ol-duplicate-binder",
    source_span: name.source_span,
    params: { name: name.name, form },
    message: `the binder ${name.name} is used twice here. give each binder a different name.`,
    stage: "semantic",
    severity: "error",
  };
}

/** A `reduce` whose accumulator and item binder are the same name raises one duplicate-binder. */
function reduceDuplicateDiagnostic(
  node: ReduceComprehensionNode,
): Diagnostic | undefined {
  if (node.accumulator.name.toLowerCase() !== node.binder.name.toLowerCase()) {
    return undefined;
  }
  return duplicateBinderDiagnostic(node.binder, "reduce");
}

/** Each name in a destructuring pattern that repeats an earlier one raises a duplicate-binder. */
function patternDuplicateDiagnostics(
  binder: DestructuringBinderNode,
): readonly Diagnostic[] {
  const seen = new Set<string>();
  const diagnostics: Diagnostic[] = [];
  for (const name of binder.names) {
    const key = name.name.toLowerCase();
    if (seen.has(key)) {
      diagnostics.push(duplicateBinderDiagnostic(name, "destructuring"));
    } else {
      seen.add(key);
    }
  }
  return diagnostics;
}

/**
 * The diagnostic a `return`/`stop` raises given its lexical context, or `undefined` when it is
 * validly placed (inside a procedure and not inside a comprehension). A comprehension context wins
 * over the outside-a-procedure check, so a nested escape is always the comprehension code.
 */
function escapeDiagnostic(
  node: ReturnNode | StopNode,
  context: Context,
): Diagnostic | undefined {
  const keyword = node.kind === "Stop" ? "stop" : node.keyword;
  if (context.comprehensionForm !== undefined) {
    const form = context.comprehensionForm;
    return {
      code: "ol-return-in-comprehension",
      source_span: controlWordSpan(node),
      params: { keyword, form },
      message: `${keyword} doesn't belong in a ${form} — a ${form} reports its last expression instead.`,
      stage: "semantic",
      severity: "error",
    };
  }
  if (context.inProcedure) {
    return undefined;
  }
  if (node.kind === "Stop") {
    return {
      code: "ol-stop-outside-proc",
      source_span: controlWordSpan(node),
      params: {},
      message:
        "stop only leaves a procedure, so it belongs between 'define' and 'end'.",
      stage: "semantic",
      severity: "error",
    };
  }
  return {
    code: "ol-return-outside-proc",
    source_span: controlWordSpan(node),
    params: { keyword: node.keyword },
    message: `${node.keyword} only reports a value from inside a procedure. put it between 'define' and 'end'.`,
    stage: "semantic",
    severity: "error",
  };
}

/**
 * The `ol-*` control-flow rule (issue #114). Registered last in {@link RULES}; consulted with the
 * active profile set so command-vs-reporter classification for `ol-no-value` respects which
 * profiles are on.
 */
export function controlFlowRule(
  program: ProgramNode,
  profiles: readonly CheckProfile[],
): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  const isCoreCommand = (name: string): boolean =>
    profiles.includes("core-language") && CORE_COMMANDS.has(name.toLowerCase());

  /** Does this final statement statically produce a value the comprehension can report? */
  const producesValue = (node: StatementNode): boolean => {
    if (node.kind === "Call" || node.kind === "ParenCall") {
      return !isCoreCommand(node.callee.name);
    }
    return VALUE_PRODUCING_KINDS.has(node.kind);
  };

  /** `ol-no-value` when a comprehension body cannot end in a value-producing expression. */
  const noValueDiagnostic = (
    node: ComprehensionNode,
  ): Diagnostic | undefined => {
    const body = node.body.body;
    const last = body[body.length - 1];
    if (
      last !== undefined &&
      (last.kind === "Return" || last.kind === "Stop")
    ) {
      return undefined;
    }
    if (last !== undefined && producesValue(last)) {
      return undefined;
    }
    return {
      code: "ol-no-value",
      source_span: node.source_span,
      params: { form: node.form },
      message: `${node.form} needs the last instruction in its block to make a value.`,
      stage: "semantic",
      severity: "error",
    };
  };

  const visit = (node: AnyNode, context: Context): void => {
    switch (node.kind) {
      case "ProcedureDef": {
        const inner: Context = {
          inProcedure: true,
          comprehensionForm: undefined,
        };
        for (const child of childrenOf(node)) {
          visit(child, inner);
        }
        return;
      }
      case "Comprehension": {
        const noValue = noValueDiagnostic(node);
        if (noValue !== undefined) {
          diagnostics.push(noValue);
        }
        if (node.form === "reduce") {
          const duplicate = reduceDuplicateDiagnostic(node);
          if (duplicate !== undefined) {
            diagnostics.push(duplicate);
          }
          visit(node.initial, context);
        }
        visit(node.iterable, context);
        visit(node.body, {
          inProcedure: context.inProcedure,
          comprehensionForm: node.form,
        });
        return;
      }
      case "ForIn": {
        if ("kind" in node.binder) {
          for (const duplicate of patternDuplicateDiagnostics(node.binder)) {
            diagnostics.push(duplicate);
          }
        }
        for (const child of childrenOf(node)) {
          visit(child, context);
        }
        return;
      }
      case "Return": {
        const diag = escapeDiagnostic(node, context);
        if (diag !== undefined) {
          diagnostics.push(diag);
        }
        visit(node.value, context);
        return;
      }
      case "Stop": {
        const diag = escapeDiagnostic(node, context);
        if (diag !== undefined) {
          diagnostics.push(diag);
        }
        return;
      }
      default: {
        for (const child of childrenOf(node)) {
          visit(child, context);
        }
      }
    }
  };

  visit(program, { inProcedure: false, comprehensionForm: undefined });
  return diagnostics;
}
