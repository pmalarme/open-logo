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
 * value slot by construction, so the rule walks the tree carrying that one fact and reports any
 * command call that is not a statement. That is what makes it uniform: it enumerates the two
 * statement containers rather than the many expression slots, and the expression slots are what
 * keep growing.
 *
 * A **list literal's elements are value expressions** — `spec/grammar.md:208` spells the production
 * `"[" [ expression { expression } ] "]"` and `spec/data-structures.md:51` calls them "whitespace-
 * separated value expressions" — so they are value positions like any other and are deliberately
 * NOT carved out. OpenLogo lists are not classic Logo's word lists: `[a b c]` is three calls, and
 * a list of words is written `["a" "b" "c"]`.
 *
 * **The one exclusion, and it is not written down here.** A comprehension body's final statement
 * *is* a statement, so it is never reported — and `spec/tooling.md:189` requires exactly that: a
 * `map`/`filter`/`reduce` body whose final expression calls a built-in command "has no
 * value-producing final expression, so it belongs" to `ol-no-value`, which
 * `checker-control-flow.ts` already reports. That falls out of the statement/value split rather
 * than being a special case.
 *
 * **Profiles gate it.** {@link isActiveProfileCommandName} consults only the active set
 * (`spec/tooling.md:174-177`), so a primitive whose owning profile is inactive is not classified
 * here at all — its callee is unresolvable and belongs to `ol-unknown-command` instead.
 */

import type { Diagnostic } from "@openlogo/core";
import type { AnyNode, CallNode, ParenCallNode, ProgramNode } from "./ast.js";
import { childrenOf } from "./ast.js";
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
 * The learner-facing message for a command asked for a value it does not report.
 */
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
  const diagnostics: Diagnostic[] = [];

  const scan = (node: AnyNode, inValuePosition: boolean) => {
    if (inValuePosition && isCall(node)) {
      // Gated on the spelling the learner **wrote**, reported under the callee's **canonical**
      // spelling. The two differ only for a Heritage short alias, and conflating them is a real
      // fault rather than a tidiness point: `isActiveProfileCommandName` resolves an alias only
      // when Heritage is active, so asking it about the written `fd` correctly declines under a run
      // that does not claim Heritage — where the call is `ol-unknown-command`, not a command in the
      // wrong position. Asking it about the pre-canonicalised `forward` instead let `print fd 5`
      // report `ol-no-output` for a name the run could not resolve at all, alongside the
      // `ol-unknown-command` it had already earned: two answers to one question.
      // `spec/error-model.md:114` still requires `procedure` to carry "the built-in's canonical
      // spelling", so the report itself is unchanged for an alias the run CAN resolve.
      if (isActiveProfileCommandName(node.callee.name, profiles)) {
        const name = canonicalCalleeName(node);
        diagnostics.push({
          code: "ol-no-output",
          source_span: node.source_span,
          params: { procedure: name },
          message: messageFor(name),
          stage: "semantic",
          severity: "error",
        });
      }
    }
    if (node.kind === "Assign") {
      // An assignment TARGET is not a value position — nothing reads a value out of it — so a
      // command there is `ol-not-a-place` (`checker-not-a-place.ts`), not `ol-no-output`. Reporting
      // both for `forward 5 = 1` would be two findings for one fault, and the wrong one first.
      scan(node.place, false);
      scan(node.value, true);
      return;
    }
    const childInValuePosition =
      node.kind !== "Program" && node.kind !== "Block";
    for (const child of childrenOf(node)) {
      scan(child, childInValuePosition);
    }
  };

  scan(program, false);
  return diagnostics;
}
