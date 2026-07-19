/**
 * The Layer-3 style-lint rules (issue #115, slice 1 of the 13-code `ol-style-*` family
 * `spec/tooling.md:237-251` registers, sourced from `spec/style-guide.md`). Every finding here
 * reuses the C10 diagnostic shape with `severity: "warning"` and `stage: "semantic"` — a style
 * lint never changes program meaning, unlike a Layer-2 `ol-*` error.
 *
 * These rules are opt-in: `check.ts` only runs {@link STYLE_RULES} when a caller passes
 * `{ style: true }`, so every existing Layer-2-only caller and conformance fixture is unaffected
 * (`check.ts`'s module doc explains why unconditional style-checking is unsafe).
 *
 * This slice implements exactly three of the thirteen registered codes; the rest are tracked in
 * the #115 follow-up issue:
 *
 * - `ol-style-useless-value` — a control block (`if`/`while`/`repeat`/`forever`/`for … in`/
 *   `for … from … to`) whose body's final statement statically produces a value that the block
 *   discards (`spec/style-guide.md` "Useless values in effect blocks"). This is the
 *   control-body, warning-severity analog of `checker-control-flow.ts`'s `ol-no-value`
 *   (comprehension-body, error-severity) — both reuse the exact same
 *   {@link producesValue}/command-vs-reporter classification from that module so the two never
 *   drift apart. Reproduces the spec's own worked example verbatim
 *   (`spec/tooling.md:254-262`): `repeat 4 [ :side * 2 ]` → `ol-style-useless-value
 *   { form: "repeat" }`.
 * - `ol-style-equality-confusion` — a standalone top-level comparison statement (a
 *   `ComparisonChain`, or a `Call`/`ParenCall` whose callee is `==`/`!=`) whose boolean result is
 *   discarded — usually a slip where the learner meant to assign with `=`
 *   (`spec/style-guide.md` "Keep assignment and comparison visually distinct"). `=` written where
 *   a condition belongs is a *parse* error (`ol-missing-end`), never reaching this rule; only the
 *   opposite slip — a bare `==`/`!=` on its own — is a style warning here. Other comparison
 *   operators (`<`, `>`, `<=`, `>=`) as a single `Call` are not flagged as equality confusion
 *   (the code name is specific to `=`/`==` mix-ups), but any multi-operator `ComparisonChain` at
 *   statement position is, since a chain can never itself be a valid statement-level effect.
 * - `ol-style-name-case` — a user identifier (variable, place base/field, procedure name,
 *   parameter, loop/comprehension binder) that is not lowercase snake_case with an optional
 *   trailing `?`/`!` (`spec/style-guide.md` "Names use `snake_case`"). Checked against
 *   `^[a-z][a-z0-9_]*[?!]?$`. Scope note: call/callee names (`Call`/`ParenCall.callee`) are not
 *   checked here — a callee may be a built-in, a Heritage alias, or a user procedure, and telling
 *   those apart needs the same registries `ol-unknown-command` already consults; that
 *   cross-reference is deferred to the #115 follow-up's `ol-style-full-name`/
 *   `ol-style-procedure-name` codes. Struct/field type names have no Core AST node yet (Data
 *   profile), so they are out of scope for the same reason `checker-reserved-word.ts` documents.
 */

import type { Diagnostic } from "@openlogo/core";
import type {
  AnyNode,
  ProgramNode,
  SpannedName,
  StatementNode,
} from "./ast.js";
import { walk } from "./ast.js";
import type { CheckProfile, CheckRule } from "./check.js";
import { producesValue } from "./checker-control-flow.js";

/** The `form` param {@link uselessValueRule} reports for each control-block kind it judges. */
const CONTROL_FORM: Readonly<
  Record<"If" | "While" | "Repeat" | "Forever" | "ForIn" | "ForRange", string>
> = {
  If: "if",
  While: "while",
  Repeat: "repeat",
  Forever: "forever",
  ForIn: "for-in",
  ForRange: "for-range",
};

/** Build an `ol-style-useless-value` at the whole control node's span. */
function uselessValueDiagnostic(node: AnyNode, form: string): Diagnostic {
  return {
    code: "ol-style-useless-value",
    source_span: node.source_span,
    params: { form },
    message: `${form} runs its block for actions, so this value is ignored.`,
    stage: "semantic",
    severity: "warning",
  };
}

/** Does `body`'s final statement statically produce a value that a control block would discard? */
function endsInDiscardedValue(
  body: readonly StatementNode[],
  profiles: readonly CheckProfile[],
): boolean {
  const last = body[body.length - 1];
  return last !== undefined && producesValue(last, profiles);
}

/**
 * `ol-style-useless-value` (issue #115): every `if`/`while`/`repeat`/`forever`/`for … in`/
 * `for … from … to` control body whose final statement statically produces a discarded value.
 * An `if` with an `else` is judged on each branch independently. Comprehension bodies are out of
 * scope here — they are the (required, not discarded) `ol-no-value` error instead.
 */
export function uselessValueRule(
  program: ProgramNode,
  profiles: readonly CheckProfile[],
): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  walk(program, (node) => {
    switch (node.kind) {
      case "If": {
        if (endsInDiscardedValue(node.thenBody.body, profiles)) {
          diagnostics.push(uselessValueDiagnostic(node, CONTROL_FORM.If));
        }
        if (
          node.elseBody !== undefined &&
          endsInDiscardedValue(node.elseBody.body, profiles)
        ) {
          diagnostics.push(uselessValueDiagnostic(node, CONTROL_FORM.If));
        }
        return;
      }
      case "While": {
        if (endsInDiscardedValue(node.body.body, profiles)) {
          diagnostics.push(uselessValueDiagnostic(node, CONTROL_FORM.While));
        }
        return;
      }
      case "Repeat": {
        if (endsInDiscardedValue(node.body.body, profiles)) {
          diagnostics.push(uselessValueDiagnostic(node, CONTROL_FORM.Repeat));
        }
        return;
      }
      case "Forever": {
        if (endsInDiscardedValue(node.body.body, profiles)) {
          diagnostics.push(uselessValueDiagnostic(node, CONTROL_FORM.Forever));
        }
        return;
      }
      case "ForIn": {
        if (endsInDiscardedValue(node.body.body, profiles)) {
          diagnostics.push(uselessValueDiagnostic(node, CONTROL_FORM.ForIn));
        }
        return;
      }
      case "ForRange": {
        if (endsInDiscardedValue(node.body.body, profiles)) {
          diagnostics.push(uselessValueDiagnostic(node, CONTROL_FORM.ForRange));
        }
        return;
      }
      default:
        return;
    }
  });

  return diagnostics;
}

/** Build an `ol-style-equality-confusion` at `node`'s own span. */
function equalityConfusionDiagnostic(
  node: AnyNode,
  operators: readonly string[],
): Diagnostic {
  return {
    code: "ol-style-equality-confusion",
    source_span: node.source_span,
    params: { operators },
    message:
      "this comparison's result is never used. did you mean to assign with =?",
    stage: "semantic",
    severity: "warning",
  };
}

/** The `ol-style-equality-confusion` finding for one statement-position node, if any. */
function equalityConfusionDiagnosticFor(
  statement: StatementNode,
): Diagnostic | undefined {
  if (statement.kind === "ComparisonChain") {
    return equalityConfusionDiagnostic(
      statement,
      statement.operators.map((operator) => operator.name),
    );
  }
  if (statement.kind === "Call" || statement.kind === "ParenCall") {
    const name = statement.callee.name;
    if (name === "==" || name === "!=") {
      return equalityConfusionDiagnostic(statement, [name]);
    }
  }
  return undefined;
}

/**
 * `ol-style-equality-confusion` (issue #115): every statement-position `ComparisonChain` or
 * `==`/`!=` `Call`/`ParenCall` — i.e. an element of a `Program`/`Block`'s own `body` array,
 * never a nested sub-expression — whose discarded boolean usually means the learner meant `=`.
 */
export function equalityConfusionRule(
  program: ProgramNode,
): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  walk(program, (node) => {
    if (node.kind !== "Program" && node.kind !== "Block") {
      return;
    }
    for (const statement of node.body) {
      const diagnostic = equalityConfusionDiagnosticFor(statement);
      if (diagnostic !== undefined) {
        diagnostics.push(diagnostic);
      }
    }
  });

  return diagnostics;
}

/** Lowercase snake_case, with an optional trailing `?`/`!` — `spec/style-guide.md`'s naming rule. */
const NAME_CASE_PATTERN = /^[a-z][a-z0-9_]*[?!]?$/;

/** Build an `ol-style-name-case` at `name`'s own span. */
function nameCaseDiagnostic(name: SpannedName): Diagnostic {
  return {
    code: "ol-style-name-case",
    source_span: name.source_span,
    params: { name: name.name },
    message: `${name.name} should be lowercase snake_case, like a learner would read it aloud.`,
    stage: "semantic",
    severity: "warning",
  };
}

/** Push an `ol-style-name-case` for `name` unless it already matches {@link NAME_CASE_PATTERN}. */
function checkNameCase(name: SpannedName, diagnostics: Diagnostic[]): void {
  if (!NAME_CASE_PATTERN.test(name.name)) {
    diagnostics.push(nameCaseDiagnostic(name));
  }
}

/**
 * The identifier-bearing fields `ol-style-name-case` checks for one node, restricted to the
 * fields `walk`'s generic `childrenOf` traversal does not already visit as their own node (a
 * `SpannedName` carries no `kind`, so it is metadata, never a walked node) — see each case for
 * why. Node kinds with no identifier fields of their own fall through the `default` case.
 */
function checkNamesIn(node: AnyNode, diagnostics: Diagnostic[]): void {
  switch (node.kind) {
    case "VarRef":
      checkNameCase(
        { name: node.name, source_span: node.source_span },
        diagnostics,
      );
      return;
    case "Place":
      checkNameCase(node.base, diagnostics);
      for (const segment of node.segments) {
        if (segment.kind === "field") {
          checkNameCase(segment.name, diagnostics);
        }
      }
      return;
    case "ProcedureDef":
      checkNameCase(node.name, diagnostics);
      for (const param of node.params) {
        checkNameCase(param.name, diagnostics);
      }
      return;
    case "Local":
      for (const name of node.names) {
        checkNameCase(name, diagnostics);
      }
      return;
    case "DestructuringBinder":
      for (const name of node.names) {
        checkNameCase(name, diagnostics);
      }
      return;
    case "ForIn":
      // A destructuring binder is itself a walked "DestructuringBinder" node (see `childrenOf`)
      // and is checked there instead; a bare binder is metadata (a `SpannedName`), so it is only
      // reachable here.
      if (!("kind" in node.binder)) {
        checkNameCase(node.binder, diagnostics);
      }
      return;
    case "ForRange":
      checkNameCase(node.variable, diagnostics);
      return;
    case "Comprehension": {
      // Same reasoning as "ForIn": a destructuring binder is its own walked "DestructuringBinder"
      // node (per `childrenOf`) and is checked there; a bare binder is metadata, only reachable
      // here.
      if (!("kind" in node.binder)) {
        checkNameCase(node.binder, diagnostics);
      }
      if (node.form === "reduce") {
        checkNameCase(node.accumulator, diagnostics);
      }
      return;
    }
    default:
      return;
  }
}

/**
 * `ol-style-name-case` (issue #115): every user identifier occurrence — variable reads, place
 * bases/fields, procedure names, parameters, `local` names, and loop/comprehension binders —
 * that is not lowercase snake_case (`^[a-z][a-z0-9_]*[?!]?$`).
 */
export function nameCaseRule(program: ProgramNode): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  walk(program, (node) => checkNamesIn(node, diagnostics));
  return diagnostics;
}

/**
 * The opt-in Layer-3 style-rule registry (issue #115), run by `check()` only when
 * `options.style === true`. Order is the order findings are reported in; a later #115 slice
 * appends its rule(s) here the same way {@link RULES} in `check.ts` grows for Layer-2.
 */
export const STYLE_RULES: readonly CheckRule[] = [
  uselessValueRule,
  equalityConfusionRule,
  nameCaseRule,
];
