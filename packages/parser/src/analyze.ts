/**
 * `analyze()` — the **check-before-execution** entry point (issue #815). One call performs the two
 * layers `spec/execution-model.md:659-664` requires of anything that offers to run OpenLogo source:
 * "before Phase 2 begins, an implementation MUST run Layer 1 (lex and parse) and Layer 2 (semantic)
 * of [tooling.md](tooling.md) over the whole program", and then applies the *one fault, one
 * diagnostic* rules to the merged result.
 *
 * ## Why the two layers are joined here rather than at each caller
 *
 * The spec puts the obligation on the implementation, not on its caller: "anything that offers to
 * *run* OpenLogo source MUST perform the check itself and MUST NOT assume a host ran one first"
 * (`spec/execution-model.md:634-639`). `@openlogo/runtime`'s `execute()` is the first caller, but it
 * is not the only surface that has to answer this question the same way, so the composition is a
 * function rather than a paragraph asking each caller to remember the order.
 *
 * Joining them is also what makes the precedence rule expressible at all. `fowad 100` raises
 * `ol-bad-token` in Layer 1 and `ol-unknown-command` in Layer 2, and the rule that suppresses the
 * first needs both in hand (`one-fault.ts`). A caller that ran the layers separately and stopped at
 * the first non-empty collection could never apply it — which is exactly what `execute()` did
 * before this slice.
 *
 * ## Layer 2 runs even when Layer 1 found something
 *
 * `parse()` recovers, so a program with parse findings still yields a best-effort AST, and the
 * spec asks for both layers over "the whole program" rather than for the first one that fails.
 * `fowad 100` is the case that makes it load-bearing: the finding a learner must read is the
 * Layer-2 one.
 *
 * ## Severity is the caller's decision, not this function's
 *
 * `analyze()` reports; it does not refuse. Whether a finding stops a run is
 * `spec/execution-model.md:666-671`'s severity test, and it belongs to whoever is starting the run
 * — deliberately, because {@link AnalyzeOptions.style} can put Layer-3 warnings in the same
 * collection, and "a presence test silently converts a style opinion into a refusal to run a
 * correct program".
 */

import type { Diagnostic } from "@openlogo/core";
import type { ProgramNode } from "./ast.js";
import type { CheckProfile } from "./check.js";
import { check } from "./check.js";
import { applyOneFaultRules } from "./one-fault.js";
import { parse } from "./parser.js";

/**
 * Options controlling {@link analyze}. `profiles` is the active conformance profile set, and for a
 * run it MUST be the run's own (`spec/execution-model.md:673-680`) — there is deliberately no
 * default here, so a caller that starts a run cannot inherit a narrower set than it executes under.
 * `style` opts into the Layer-3 lints exactly as {@link check}'s own option does.
 */
export interface AnalyzeOptions {
  readonly profiles: readonly CheckProfile[];
  readonly style?: boolean;
}

/** The result of {@link analyze}: the parsed program and every finding both layers reported. */
export interface AnalyzeResult {
  readonly ast: ProgramNode;
  readonly diagnostics: readonly Diagnostic[];
}

/**
 * Parse `source`, run the semantic (and optionally style) checks over it under `options.profiles`,
 * and return the merged findings with de-duplication and precedence applied.
 */
export function analyze(
  source: string,
  document: string,
  options: AnalyzeOptions,
): AnalyzeResult {
  const { ast, diagnostics: parsed } = parse(source, document);
  const checked = check(ast, {
    profiles: options.profiles,
    source,
    style: options.style === true,
  });
  return {
    ast,
    diagnostics: applyOneFaultRules(ast, [...parsed, ...checked.diagnostics]),
  };
}
