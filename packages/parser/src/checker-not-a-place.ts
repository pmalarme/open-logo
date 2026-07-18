/**
 * The `ol-not-a-place` semantic rule (issue #79): the target of `=` or `set … to` must be an
 * assignable place. The parser already keeps a well-formed target as a {@link PlaceNode}, but it
 * also structurally accepts a reporter/command call in target position — `first :x = 5` — so this
 * rule can explain the mistake instead of a blunt parse error (`spec/error-model.md`,
 * `spec/grammar.md:244-258`).
 *
 * Scope boundary: this rule handles ONLY the clearly-syntactic case where the target is itself a
 * call node ({@link CallNode}/{@link ParenCallNode}), i.e. a reporter such as `first`, `count`, or
 * `keys` used as a place. Deeper name-resolution non-place cases (a bound procedure name, a
 * read-only binding) belong to the name/place-resolution slice #113, which lists `ol-not-a-place`
 * alongside `ol-undefined-var`/`ol-reserved-word`.
 */

import type { Diagnostic } from "@openlogo/core";
import type { AnyNode, AssignNode, ProgramNode } from "./ast.js";
import { walk } from "./ast.js";

function isAssign(node: AnyNode): node is AssignNode {
  return node.kind === "Assign";
}

/** The learner-facing message template for a reporter/call used as an assignment target. */
function messageFor(text: string): string {
  return `${text} reports a value, it isn't a place you can assign to.`;
}

/**
 * The `ol-not-a-place` rule: every assignment whose target is a call node (a reporter/command used
 * as a place) raises one diagnostic at the target's span, with the callee name carried as the
 * optional `text` param.
 */
export function notAPlaceRule(program: ProgramNode): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  walk(program, (node) => {
    if (!isAssign(node)) {
      return;
    }
    const target = node.place;
    if (target.kind !== "Call" && target.kind !== "ParenCall") {
      return;
    }
    const text = target.callee.name;
    diagnostics.push({
      code: "ol-not-a-place",
      source_span: target.source_span,
      params: { text },
      message: messageFor(text),
      stage: "semantic",
      severity: "error",
    });
  });

  return diagnostics;
}
