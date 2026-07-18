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
 * return contract. `findings()` dispatches over an ordered list of rule functions, each
 * `(program, profiles) => readonly Diagnostic[]`; a rule slice adds its module and one
 * registration line in {@link RULES}. #117's `ol-unknown-command` is the first rule registered
 * here; the remaining five rule slices (#111 arity, #113 name/place, #114 control-flow, #112
 * type/field, #115 style) each extend {@link RULES} the same way, one vertical slice at a time,
 * exactly as issue #90's `execute()` spine is filled in by the runtime evaluator slices.
 */

import type { Diagnostic } from "@openlogo/core";
import type { ProgramNode } from "./ast.js";
import { unknownCommandRule } from "./checker-unknown-command.js";

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
 * {@link DEFAULT_CHECK_PROFILES}) for name/form visibility. Returns every registered rule's
 * findings, concatenated in registration order — see {@link RULES}.
 */
export function check(
  program: ProgramNode,
  options: CheckOptions = {},
): CheckResult {
  const profiles = options.profiles ?? DEFAULT_CHECK_PROFILES;
  return { diagnostics: findings(program, profiles) };
}

/** A single checker rule: given the program and active profiles, returns its findings. */
type CheckRule = (
  program: ProgramNode,
  profiles: readonly CheckProfile[],
) => readonly Diagnostic[];

/**
 * The ordered rule registry. Order is the order findings are reported in; a rule slice adds its
 * module and one entry here — see the module doc comment above.
 */
const RULES: readonly CheckRule[] = [unknownCommandRule];

/** Dispatches `program`/`profiles` to every registered rule and concatenates their findings. */
function findings(
  program: ProgramNode,
  profiles: readonly CheckProfile[],
): readonly Diagnostic[] {
  return RULES.flatMap((rule) => rule(program, profiles));
}
