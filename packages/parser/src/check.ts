/**
 * `check()` — the Layer-2 semantic-checker (and Layer-3 style-linter) entry point (issue #116).
 * It runs over an already-parsed Core AST, *after* parsing, the alias/import pre-pass, and
 * procedure/struct registration (`spec/tooling.md:172-177`), and returns an ordered list of
 * C10-shaped diagnostics (`spec/tooling.md:121-137`) — `stage: "semantic"`, reusing the exact
 * `Diagnostic` shape and `ol-*`/`ol-style-*` code registry `@openlogo/core` already owns.
 *
 * This is the M1 infrastructure skeleton for epic #108: it stands up the entry point's shape,
 * the active-profile-set plumbing every rule MUST consult for name/form visibility
 * (`spec/tooling.md:175-176` — never a hardcoded "every optional profile active"), and the
 * return contract. It deliberately implements **no rule yet** — every document, including one a
 * future rule would flag, currently checks clean. The six rule slices (#117 unknown-command,
 * #111 arity, #113 name/place, #114 control-flow, #112 type/field, #115 style) each extend this
 * function with their own findings, one vertical slice at a time, exactly as issue #90's
 * `execute()` spine is filled in by the runtime evaluator slices.
 */

import type { Diagnostic } from "@openlogo/core";
import type { ProgramNode } from "./ast.js";

/**
 * Every OpenLogo conformance profile identifier from the spec's dependency DAG
 * (`spec/conformance.md`), in the same spelling the conformance harness uses.
 */
export const OL_CHECK_PROFILES = [
  "core-language",
  "turtle-rendering",
  "geometry",
  "sprites",
  "data",
  "heritage",
  "interaction-events",
  "sound",
  "modules",
  "localization",
  "educational",
  "tutor-ai",
] as const;

/** A stable profile identifier from {@link OL_CHECK_PROFILES}. */
export type CheckProfile = (typeof OL_CHECK_PROFILES)[number];

/**
 * Options controlling {@link check}. `profiles` is the active conformance profile set a rule
 * MUST consult when deciding which primitives, block-heads, and reserved words are visible;
 * it defaults to Core Language only — never every optional profile.
 */
export interface CheckOptions {
  readonly profiles?: readonly CheckProfile[];
}

/** The result of {@link check}: the ordered semantic/style diagnostics it found. */
export interface CheckResult {
  readonly diagnostics: readonly Diagnostic[];
}

/** The default active profile set when a caller does not specify one: Core Language only. */
export const DEFAULT_CHECK_PROFILES: readonly CheckProfile[] = [
  "core-language",
];

/**
 * Run the Layer-2/Layer-3 static checks over `program`, consulting `options.profiles` (default
 * {@link DEFAULT_CHECK_PROFILES}) for name/form visibility. Returns an empty diagnostics list
 * until a rule slice extends this function — see the module doc comment above.
 */
export function check(
  program: ProgramNode,
  options: CheckOptions = {},
): CheckResult {
  const profiles = options.profiles ?? DEFAULT_CHECK_PROFILES;

  // No Layer-2/Layer-3 rule is implemented yet; `program` and `profiles` are the plumbing the
  // rule slices will consult (spec/tooling.md:172-177), not dead parameters.
  return { diagnostics: findings(program, profiles) };
}

/** Placeholder rule dispatch: no rule is registered yet, so every check is clean. */
function findings(
  _program: ProgramNode,
  _profiles: readonly CheckProfile[],
): readonly Diagnostic[] {
  return [];
}
