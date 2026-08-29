/**
 * The `ol-unknown-command` semantic rule (issue #117): the first checker rule registered with
 * `check()`'s dispatch (`check.ts`). It walks every call site (`Call`/`ParenCall` — a bare
 * variable read or non-callable node is never in scope here; that is `ol-undefined-var`'s job,
 * #113) and flags a callee name that is not in {@link collectVisibleNames}'s visible set, with a
 * Levenshtein did-you-mean suggestion per `spec/error-model.md:196-216` /
 * `spec/tooling.md:181`.
 */

import type { Diagnostic } from "@openlogo/core";
import type {
  AnyNode,
  CallNode,
  ParenCallNode,
  ProfileStatementNode,
  ProgramNode,
} from "./ast.js";
import { walk } from "./ast.js";
import type { CheckProfile } from "./check.js";
import {
  collectDeclaredNames,
  collectVisibleNames,
  isOptionalProfileName,
} from "./checker-names.js";
import { levenshteinDistance } from "./levenshtein.js";
import { heritageAliasNames } from "./signatures.js";

/**
 * The ten Heritage short command aliases (`fd`/`bk`/…/`pr`, issue #668) as a lookup set, so the
 * did-you-mean tie-break can rank a full canonical name ahead of the short alias that spells it —
 * the "full canonical names over short aliases" step of `spec/error-model.md:145-146`.
 */
const HERITAGE_ALIAS_NAMES: ReadonlySet<string> = new Set(heritageAliasNames());

/**
 * Whether `name`, as a suggestion candidate, is a Heritage short alias to be *demoted* below full
 * canonical names on a tie. A name that the program itself declares (`declared`) is the learner's
 * own procedure/struct — never the alias — even when its spelling collides with one (`define fd …`),
 * so it is exempt from demotion.
 */
function isDemotableHeritageAlias(
  name: string,
  declared: ReadonlySet<string>,
): boolean {
  const lower = name.toLowerCase();
  return HERITAGE_ALIAS_NAMES.has(lower) && !declared.has(lower);
}

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
 * A profile block-head / mode-switch command (`ask`/`each`/`tell`, the four event heads) the reader
 * lowered to a {@link ProfileStatementNode} (issue #664's shared seam). Its `keyword` sits in
 * command position exactly like a {@link CallNode}'s callee, so `ol-unknown-command` gates it the
 * same way: the reader is profile-blind and always shapes these words into a `ProfileStatement`, so a
 * Core-only program (where no profile makes them visible) must see the identical
 * "i don't know how to …" diagnostic it saw before this seam existed — Core-neutrality
 * (`spec/interaction-events.md` §Profiles and reservation). Once a profile is active, its per-profile
 * checker slice registers the block-head name in {@link collectVisibleNames} and the word becomes
 * visible, so no diagnostic fires (`spec/tooling.md:175-176`).
 */
function isProfileStatement(node: AnyNode): node is ProfileStatementNode {
  return node.kind === "ProfileStatement";
}

/**
 * The best did-you-mean candidate for `name` among `candidates`, or `undefined` when none is
 * within {@link MAX_SUGGESTION_DISTANCE}. Deterministic tie-break per `spec/error-model.md:145-146`:
 * lowest Levenshtein distance first; on a distance tie, a Core Language candidate outranks an
 * optional-profile one ({@link isOptionalProfileName}); within the same profile tier a full
 * canonical name outranks a short Heritage alias ({@link isDemotableHeritageAlias}); and only then
 * does lexicographic order decide. `declared` names the program's own procedures/structs so a
 * learner's `define fd … end` is never mistaken for the Heritage alias it spells.
 */
function bestSuggestion(
  name: string,
  candidates: ReadonlySet<string>,
  declared: ReadonlySet<string>,
): string | undefined {
  let best: string | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const candidate of candidates) {
    const distance = levenshteinDistance(name, candidate);
    if (distance > MAX_SUGGESTION_DISTANCE) {
      continue;
    }
    if (best === undefined || distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
      continue;
    }
    if (distance === bestDistance && isBetterTie(candidate, best, declared)) {
      best = candidate;
    }
  }

  return best;
}

/**
 * Whether `candidate` should replace `current` as the did-you-mean pick when both are tied at the
 * same Levenshtein distance. Three ordered rungs, per `spec/error-model.md:145-146`:
 *
 * 1. A Core Language word beats an optional-profile word ({@link isOptionalProfileName}). A name the
 *    program itself declares (a user `define fd … end` or a struct constructor, tracked in
 *    `declared`) is that user procedure, never the optional-profile primitive/alias it happens to
 *    spell, so it is treated as Core-tier here — a learner's own `fd` is not demoted beneath a Core
 *    word the way the Heritage alias `fd` would be.
 * 2. Within the same profile tier, a full canonical name beats a short Heritage alias
 *    ({@link isDemotableHeritageAlias}) — the spec's "full canonical names over short aliases" step.
 *    This rung IS reachable: with the Data and Heritage profiles both active, the unknown word `dca`
 *    sits at distance 2 from both the Data primitive `dict` and the Heritage alias `cs`; both are
 *    optional-profile, so rung 1 cannot separate them and rung 2 must pick the full name `dict`. (A
 *    Heritage alias vs. its OWN Core canonical — `cs` vs `clear_screen` — is always split by rung 1,
 *    since the canonical is Core; rung 2 handles the alias-vs-*other*-profile's-full-name case.) A
 *    candidate the program itself declares (a user `define fd … end`, tracked in `declared`) is that
 *    procedure, not the alias, so it is exempt — it is ordered by rung 1/rung 3 like any full name.
 * 3. Otherwise the lexicographically earlier name wins, for a stable, deterministic result.
 */
function isBetterTie(
  candidate: string,
  current: string,
  declared: ReadonlySet<string>,
): boolean {
  const candidateIsOptionalProfile = isDemotableOptionalProfileName(
    candidate,
    declared,
  );
  const currentIsOptionalProfile = isDemotableOptionalProfileName(
    current,
    declared,
  );
  if (candidateIsOptionalProfile !== currentIsOptionalProfile) {
    return !candidateIsOptionalProfile;
  }
  const candidateIsAlias = isDemotableHeritageAlias(candidate, declared);
  const currentIsAlias = isDemotableHeritageAlias(current, declared);
  if (candidateIsAlias !== currentIsAlias) {
    return !candidateIsAlias;
  }
  return candidate < current;
}

/**
 * Whether `name` should be treated as an optional-profile word for the rung-1 tie-break — i.e. it is
 * an optional-profile primitive/block-head/alias spelling AND the program does not itself declare a
 * procedure or struct of that name. A declared name is the learner's own definition regardless of
 * the active profiles, so it must not be demoted beneath a Core word the way a genuine
 * optional-profile word is. Mirrors {@link isDemotableHeritageAlias}'s `declared` exemption for
 * rung 2, keeping both rungs declaration-aware.
 */
function isDemotableOptionalProfileName(
  name: string,
  declared: ReadonlySet<string>,
): boolean {
  return isOptionalProfileName(name) && !declared.has(name.toLowerCase());
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
  const declared = collectDeclaredNames(program);
  const diagnostics: Diagnostic[] = [];

  walk(program, (node) => {
    let raw: string;
    let span: CallNode["callee"]["source_span"];
    if (isCallSite(node)) {
      raw = node.callee.name;
      span = node.callee.source_span;
    } else if (isProfileStatement(node)) {
      raw = node.keyword.name;
      span = node.keyword.source_span;
    } else {
      return;
    }
    const lower = raw.toLowerCase();
    if (OPERATOR_CALLEES.has(lower) || visible.has(lower)) {
      return;
    }

    const suggestion = bestSuggestion(lower, visible, declared);
    const params: Record<string, unknown> =
      suggestion === undefined ? { name: raw } : { name: raw, suggestion };

    diagnostics.push({
      code: "ol-unknown-command",
      source_span: span,
      params,
      message: messageFor(raw, suggestion),
      stage: "semantic",
      severity: "error",
    });
  });

  return diagnostics;
}
