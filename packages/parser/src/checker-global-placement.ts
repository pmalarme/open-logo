/**
 * The Layer-2 placement rule for `global` (issue #823) — one semantic diagnostic,
 * `ol-global-outside-root`, at `stage: "semantic"` with the identity `@openlogo/core` registers.
 *
 * `spec/execution-model.md:561-563` makes the rule a single sentence: a `global` declaration is
 * legal **only at the root scope** — "never inside a procedure body, a block, or any other scope" —
 * and raises `ol-global-outside-root` anywhere else. `spec/error-model.md:131` enumerates the four
 * places that "anywhere else" covers (a procedure body, a control-form body, a handler block, a
 * comprehension body), gives the code the single param `name`, and asks the message to say that the
 * declaration belongs at the top level and that `local {name} = …` is how to make a private name
 * here.
 *
 * **The rule is positional, so it is written positionally.** The root scope is exactly
 * `program.body` — `spec/execution-model.md:361-369` gives OpenLogo three kinds of scope, and the
 * other two (a procedure frame, and a block scope created by *each entry into a block*) are both
 * reached only by descending through some other node. So a `Global` that is a direct element of
 * `program.body` is legal and every other one is not, with no list of "nesting" kinds to keep in
 * step with the grammar: a control form, a handler block and a comprehension body are all simply
 * *not* `program.body`, and a node kind added later inherits the right answer instead of needing an
 * entry here.
 *
 * **A legal root-level declaration is exempted, but its subtree is still walked.** Only the
 * declaration itself is at the root; everything below it is not. That distinction is load-bearing
 * rather than pedantic, because a comprehension is an **expression whose body holds statements**
 * (`spec/grammar.md:144`, `expression-block ::= "[" { terminator } { statement { terminator } }
 * "]"`), so a `global` really can be written inside a root `global`'s own initializer — and
 * `spec/error-model.md:131` names the comprehension body as one of the four places this code
 * covers. An earlier revision skipped the whole subtree, on the reasoning that the initializer is
 * an expression and `global-statement` is statement-only; the second half is true and the
 * conclusion does not follow from it. All three review-gate reviewers caught the same hole.
 *
 * **It takes no profile set.** `global` is Core (`spec/conformance.md`'s Core Language profile), and
 * where a declaration may stand is a property of the grammar rather than of the profiles a run
 * claims, exactly as `checker-reserved-word.ts`'s doc comment argues for the declaration slots.
 */

import type { Diagnostic } from "@openlogo/core";
import type { AnyNode, GlobalNode, ProgramNode } from "./ast.js";
import { childrenOf } from "./ast.js";

/**
 * The learner-facing prose. `spec/error-model.md:131` asks for both halves — where the declaration
 * belongs, and the form that makes a private name here — in the warm lowercase Logo voice
 * (`spec/error-model.md:18`). Prose is presentation; identity is `code` + `params`.
 */
function messageFor(name: string): string {
  return `global ${name} belongs at the top level of your program. to make a private name here, write local ${name} = ...`;
}

function outsideRootDiagnostic(node: GlobalNode): Diagnostic {
  return {
    code: "ol-global-outside-root",
    source_span: node.name.source_span,
    params: { name: node.name.name },
    message: messageFor(node.name.name),
    stage: "semantic",
    severity: "error",
  };
}

/** Reports every `Global` at or below `node` — everything reached here is already off the root. */
function reportNestedGlobals(node: AnyNode, diagnostics: Diagnostic[]): void {
  if (node.kind === "Global") {
    diagnostics.push(outsideRootDiagnostic(node));
  }
  for (const child of childrenOf(node)) {
    reportNestedGlobals(child, diagnostics);
  }
}

/**
 * `ol-global-outside-root` for every `global` declaration written anywhere but the root scope,
 * in source order.
 */
export function globalPlacementRule(
  program: ProgramNode,
): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  for (const statement of program.body) {
    if (statement.kind === "Global") {
      // Legal *here* — but only this declaration is at the root. Its initializer can still open a
      // block scope (a comprehension body), so the subtree below it is walked like any other.
      for (const child of childrenOf(statement)) {
        reportNestedGlobals(child, diagnostics);
      }
      continue;
    }
    reportNestedGlobals(statement, diagnostics);
  }
  return diagnostics;
}
