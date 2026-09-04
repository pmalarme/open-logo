/**
 * The `ol-no-output` semantic rule for **built-in commands used where a value is required**
 * (issue #815, absorbing #716) — `wait forward 5`, `repeat forward 5 [ … ]`, `right forward 5`,
 * `print print 1`.
 *
 * `spec/tooling.md:193` puts this in Layer 2 and says why it can live there at all: "The Kind of a
 * built-in is fixed by the [C3 matrix](commands.md), so a Command in value position … is
 * statically decidable and MUST be reported here." A **user** procedure's Kind depends on the path
 * taken through its body, so that half stays the runtime diagnostic `spec/error-model.md:114`
 * describes; both halves share one code and one `procedure` param, which is why this rule reports
 * `ol-no-output` rather than a second code of its own.
 *
 * **Why one rule rather than one guard per form.** Issue #716 recorded that `wait forward 5` was
 * silent while `wait p` (a user procedure) reported correctly, and that fixing `wait` alone would
 * make the inconsistency worse rather than better: the same fault appears in `repeat`'s count, in a
 * turtle command's distance, in `when`/`every`'s operands, in `print`'s argument, and in every
 * argument of a user procedure call. So the rule is positional, not per-callee: **every**
 * `Call`/`ParenCall` the AST holds in a value slot is checked the same way, and a form added later
 * is covered with no edit here.
 *
 * **How "value position" is decided.** A statement list — `Program.body` and every `Block.body` —
 * is the *only* place a bare command call is legitimate. Everything else `childrenOf` reaches is a
 * value slot by construction, so the rule collects the statements once and reports any command call
 * that is not one of them. That is what makes it uniform: it enumerates the two statement
 * containers rather than the many expression slots, and the expression slots are what keep growing.
 *
 * **The one exclusion, and it is not an exception.** A comprehension body's final statement *is* a
 * statement, so it is never reported here — and `spec/tooling.md:189` requires exactly that: a
 * `map`/`filter`/`reduce` body whose final expression calls a built-in command "has no
 * value-producing final expression, so it belongs" to `ol-no-value`, which
 * `checker-control-flow.ts` already reports. The exclusion therefore falls out of the statement/
 * value split rather than being written down as a special case.
 *
 * **Profiles gate it.** {@link isActiveProfileCommandName} consults only the active set
 * (`spec/tooling.md:174-177`), so a primitive whose owning profile is inactive is not classified
 * here at all — its callee is unresolvable and belongs to `ol-unknown-command` instead.
 */

import type { Diagnostic } from "@openlogo/core";
import type {
  AnyNode,
  CallNode,
  ParenCallNode,
  ProgramNode,
  StatementNode,
} from "./ast.js";
import { walk } from "./ast.js";
import type { CheckProfile } from "./check.js";
import { isActiveProfileCommandName } from "./signatures.js";

/** Whether `node` is a call in either surface form — bare `forward 5` or parenthesized `(print 1 2)`. */
function isCall(node: AnyNode): node is CallNode | ParenCallNode {
  return node.kind === "Call" || node.kind === "ParenCall";
}

/**
 * The **canonical** spelling of a call's callee: the Core name a Heritage short alias spells
 * (`fd` → `forward`), recorded on the node by the reader, or the surface spelling itself when
 * there is no alias. `spec/error-model.md:114` requires `procedure` to carry "the built-in's
 * canonical spelling", so `print fd 5` reports `forward` exactly as `print forward 5` does —
 * Heritage is "alternate spellings only, no new semantics".
 */
function canonicalCalleeName(call: CallNode | ParenCallNode): string {
  return (call.canonical ?? call.callee.name).toLowerCase();
}

/**
 * Every node that occupies a **statement** slot: the members of `Program.body` and of every
 * `Block.body`. These are the two — and only two — statement containers the grammar has
 * (`spec/grammar.md`'s `program` and `block`), which is why collecting them is a complete
 * complement of "value position" rather than a sample of it.
 */
function collectStatements(program: ProgramNode): ReadonlySet<StatementNode> {
  const statements = new Set<StatementNode>();
  walk(program, (node) => {
    if (node.kind === "Program" || node.kind === "Block") {
      for (const statement of node.body) {
        statements.add(statement);
      }
    }
  });
  return statements;
}

/** The learner-facing message for a command asked for a value it does not report. */
function messageFor(name: string): string {
  return `${name} does something, it doesn't make a value. i need a value here.`;
}

/**
 * The `ol-no-output` rule for built-in commands in value position. Reports one diagnostic at the
 * offending **call site** — the call node's own span, per `spec/error-model.md:114` — carrying the
 * callee's canonical spelling in `procedure`.
 */
export function commandInValuePositionRule(
  program: ProgramNode,
  profiles: readonly CheckProfile[],
): readonly Diagnostic[] {
  const statements = collectStatements(program);
  const diagnostics: Diagnostic[] = [];

  walk(program, (node) => {
    if (!isCall(node) || statements.has(node)) {
      return;
    }
    const name = canonicalCalleeName(node);
    if (!isActiveProfileCommandName(name, profiles)) {
      return;
    }
    diagnostics.push({
      code: "ol-no-output",
      source_span: node.source_span,
      params: { procedure: name },
      message: messageFor(name),
      stage: "semantic",
      severity: "error",
    });
  });

  return diagnostics;
}
