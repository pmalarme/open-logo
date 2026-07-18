/**
 * The `ol-unknown-command` semantic rule (issue #117): the first checker rule registered with
 * `check()`'s dispatch (`check.ts`). It walks every call site (`Call`/`ParenCall` — a bare
 * variable read or non-callable node is never in scope here; that is `ol-undefined-var`'s job,
 * #113) and flags a callee name that is not in {@link collectVisibleNames}'s visible set, with a
 * Levenshtein did-you-mean suggestion per `spec/error-model.md:129-151` /
 * `spec/tooling.md:178-180`.
 */

import type { Diagnostic } from "@openlogo/core";
import type { AnyNode, CallNode, ParenCallNode, ProgramNode } from "./ast.js";
import { walk } from "./ast.js";
import type { CheckProfile } from "./check.js";
import { collectVisibleNames } from "./checker-names.js";
import { levenshteinDistance } from "./levenshtein.js";

/**
 * Grammar operator symbols/words the reader lowers to a {@link CallNode} with the operator as
 * callee (`spec/grammar.md:179-186`, and `signatures.ts`'s file doc comment). These come from
 * dedicated precedence-ladder grammar productions, not a learner-typed identifier in call
 * position, so `ol-unknown-command` must never flag them — they are structural tokens, always
 * "visible", regardless of the active profile set or any user declaration.
 */
const OPERATOR_CALLEES: ReadonlySet<string> = new Set([
  "+",
  "-",
  "*",
  "/",
  "mod",
  "==",
  "!=",
  "<",
  ">",
  "<=",
  ">=",
  "and",
  "or",
  "not",
]);

/** The spec's did-you-mean cutoff: candidates strictly farther than this are never suggested. */
const MAX_SUGGESTION_DISTANCE = 2;

function isCallSite(node: AnyNode): node is CallNode | ParenCallNode {
  return node.kind === "Call" || node.kind === "ParenCall";
}

/**
 * The best did-you-mean candidate for `name` among `candidates`, or `undefined` when none is
 * within {@link MAX_SUGGESTION_DISTANCE}. Deterministic tie-break: lowest Levenshtein distance
 * first, then lexicographic order — the checker has only one candidate category (Core Language)
 * today, so the spec's fuller "Core over optional-profile, then full name over alias" tie-break
 * (`spec/error-model.md:145-146`) currently collapses to this; a later profile/alias-aware slice
 * extends the comparator, not this function's contract.
 */
function bestSuggestion(
  name: string,
  candidates: ReadonlySet<string>,
): string | undefined {
  let best: string | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const candidate of candidates) {
    const distance = levenshteinDistance(name, candidate);
    if (distance > MAX_SUGGESTION_DISTANCE) {
      continue;
    }
    const better =
      distance < bestDistance ||
      (distance === bestDistance && best !== undefined && candidate < best);
    if (better || best === undefined) {
      best = candidate;
      bestDistance = distance;
    }
  }

  return best;
}

/** The learner-facing message template from `spec/error-model.md:96`. */
function messageFor(name: string, suggestion: string | undefined): string {
  return suggestion === undefined
    ? `i don't know how to ${name}. check the spelling, or define it with 'define'.`
    : `i don't know how to ${name}. did you mean ${suggestion}?`;
}

/**
 * The `ol-unknown-command` rule: every call site whose callee is not visible (and is not a
 * grammar operator) raises one diagnostic, with a suggestion when a visible candidate is within
 * edit distance 2.
 */
export function unknownCommandRule(
  program: ProgramNode,
  profiles: readonly CheckProfile[],
): readonly Diagnostic[] {
  const visible = collectVisibleNames(program, profiles);
  const diagnostics: Diagnostic[] = [];

  walk(program, (node) => {
    if (!isCallSite(node)) {
      return;
    }
    const raw = node.callee.name;
    const lower = raw.toLowerCase();
    if (OPERATOR_CALLEES.has(lower) || visible.has(lower)) {
      return;
    }

    const suggestion = bestSuggestion(lower, visible);
    const params: Record<string, unknown> =
      suggestion === undefined ? { name: raw } : { name: raw, suggestion };

    diagnostics.push({
      code: "ol-unknown-command",
      source_span: node.callee.source_span,
      params,
      message: messageFor(raw, suggestion),
      stage: "semantic",
      severity: "error",
    });
  });

  return diagnostics;
}
