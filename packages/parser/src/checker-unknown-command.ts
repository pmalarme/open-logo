/**
 * The `ol-unknown-command` semantic rule (issue #117): the first checker rule registered with
 * `check()`'s dispatch (`check.ts`). It walks every call site (`Call`/`ParenCall` — a bare
 * variable read or non-callable node is never in scope here; that is `ol-undefined-var`'s job,
 * #113) and flags a callee name that is not in {@link collectVisibleNames}'s visible set, with a
 * Levenshtein did-you-mean suggestion per `spec/error-model.md:129-130,132-152` /
 * `spec/tooling.md:178-180`.
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
 * the "full canonical names over short aliases" step of `spec/error-model.md:146-147`.
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
 * within {@link MAX_SUGGESTION_DISTANCE}. Deterministic tie-break per `spec/error-model.md:146-147`:
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
 * same Levenshtein distance. Three ordered rungs, per `spec/error-model.md:146-147`:
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
 * A **name resolver** bound to one program and one claimed profile set: the checker's answers to
 * "is this name callable here" and "what did you mean", built once and reused.
 *
 * ## Why `@openlogo/runtime` uses this instead of its own
 *
 * The runtime used to compute both itself — visibility from `isKeyword` plus the primitive registry
 * plus Heritage-alias resolution, and did-you-mean not at all. Two producers of a judgement this
 * package owns; `spec/tooling.md:174-177` assigns visibility to the semantic layer. Measured over
 * every name in `spec/built-in-names.json` against every profile closure — 1,776 pairs — the two
 * visibility answers agreed everywhere, so it was a duplication that had not yet drifted rather
 * than a live defect. It is consolidated anyway, because an agreement maintained by hand is a
 * liability whether or not it has failed yet.
 *
 * The did-you-mean copy *had* already drifted, to the degenerate case of no suggestion at all,
 * which made a runtime `ol-unknown-command` a different fault from the check's under
 * `spec/execution-model.md:741-748`'s identity — so one fault was delivered to the learner twice.
 *
 * ## Why a bound resolver, and not a predicate or the raw set
 *
 * The visible set stays this module's representation — a caller receives answers, never the set —
 * and the resolver is bound to one program, so it cannot be asked about a different one. But it
 * must be built **once per run**, not once per call. The runtime asks `isVisible` on the SUCCESS
 * path of every executing statement, so a per-call rebuild — two `walk()` passes over the whole AST
 * each time — made execution **O(statements × program size)**: a learner's drawing getting slower
 * with every `define` they add to the worksheet.
 *
 * The shape is stated rather than the milliseconds, which are hardware-dependent, unreproducible
 * and ungated (two reviewers measured this same benchmark an order of magnitude apart). Binding
 * once makes cost **flat in declaration count**; a simulated per-call rebuild is roughly 24× slower
 * at eighty declarations than at none, and that ratio is what reproduces.
 *
 * ## The snapshot cannot go stale, and that is structural rather than lucky
 *
 * A bound resolver is a cache, so the question is what invalidates it.
 *
 * **The load-bearing fact is that the language has no dynamic evaluation.** There is no `run`,
 * `eval`, `apply`, `call`, `parse` or `load` anywhere in `spec/built-in-names.json` — measured over
 * all 148 entries — so no constructed code can ever be executed and the bound AST cannot grow after
 * binding. Every other argument below is narrower than this one.
 *
 * Within this implementation the name space is additionally **closed by Phase 1**:
 * `@openlogo/runtime`'s `registerDeclarations` holds the only two writes to the procedure and
 * struct registries in that package, and runs to completion before the environment — and therefore
 * this resolver — is built. A failed registration returns before the environment exists at all, so
 * a partially-registered program never reaches one. Nesting and source order cannot separate the
 * two either, because `registerDeclarations` and {@link collectVisibleNames} both `walk()` the
 * **whole** program: measured, a `define` inside a `when` handler, a `define` inside another
 * procedure, a `struct` inside a handler, and a call written before its own `define` all resolve.
 *
 * ## What to protect, which is not what it first looks like
 *
 * The obvious candidate for a future stale-maker is `alias`, because `spec/grammar.md:165` and
 * `:382` make its **first operand** one of the grammar's four declaration slots — "`define`, the
 * heritage `to`, `struct`, and the first operand of `alias`". `import` is not a declaration slot
 * and `spec/grammar.md:384` says `export` is not one either, so `alias` is the only one of the
 * three that names a callable at all.
 *
 * **But a spec-faithful `alias` cannot grow the visible set, and that is the point.**
 * `spec/localization.md:21` makes it "a special form resolved in the C2 reader pre-pass", running
 * "before procedure registration and before top-level execution"; `:40` says "Aliases do not create
 * new procedures", and after resolution "`avance 100` is the same instruction as `forward 100`".
 * The pre-pass rewrites tokens to canonical spellings, so by the time this checker sees a program
 * the alias is gone. Implemented per the spec, `alias` **strengthens** this invariant rather than
 * falsifying it.
 *
 * So the thing to protect is the STAGE, not the name: `spec/localization.md:223` requires tools to
 * "run the same alias pre-pass as the interpreter before syntax checking, highlighting structural
 * keywords, or reporting unknown commands" — this rule being one of those callers. An
 * implementation that resolved aliases *inside* the checker instead would break that ordering, and
 * with it the assumption that the visible set is fixed when the resolver is built. That is the edit
 * to watch for.
 *
 * Two inferences to avoid, both of which were made here and corrected. Do **not** read
 * `registries: ["reserved"]` as evidence a form is inert: `define` and `struct` carry the identical
 * marker and are exactly the forms that DO register callables — it encodes "may not be declared as
 * a name". And do **not** read keyword-list membership as a profile claim: `spec/grammar.md:378`
 * says membership "answers one question — *may a program declare this name?* — and no other". By
 * the DAG, `alias` is **Localization**, which `spec/conformance.md:188-189` makes dependent on
 * **Modules**; it is not a Core word.
 *
 * (Today all three are unreachable for a narrower reason than "no grammar form":
 * `spec/grammar.md:160-162` **does** define `alias-statement`, `import-statement` and
 * `export-statement`. What is missing is a production in *this reader*, so each is `ol-bad-token`,
 * measured.)
 */
export interface NameResolver {
  /** Is `name` callable in the bound program under the bound profile set? */
  readonly isVisible: (name: string) => boolean;
  /** The did-you-mean suggestion for an unresolvable `name`, or `undefined` when none is close. */
  readonly suggestionFor: (name: string) => string | undefined;
}

/** Build a {@link NameResolver}. The visible and declared sets are computed once, here. */
export function createNameResolver(
  program: ProgramNode,
  profiles: readonly CheckProfile[],
): NameResolver {
  const visible = collectVisibleNames(program, profiles);
  const declared = collectDeclaredNames(program);
  return {
    isVisible: (name) => visible.has(name.toLowerCase()),
    suggestionFor: (name) =>
      bestSuggestion(name.toLowerCase(), visible, declared),
  };
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
  // Through the same resolver `@openlogo/runtime` uses. The rule that establishes "one producer"
  // should be the first thing consuming it — hand-composing the same three helpers here cannot
  // drift today, but it is a second assembly of the judgement this file exists to centralise.
  const names = createNameResolver(program, profiles);
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
    if (OPERATOR_CALLEES.has(lower) || names.isVisible(lower)) {
      return;
    }

    const suggestion = names.suggestionFor(lower);
    // OpenLogo identifiers are case-insensitive, so the call site's spelling can never be the
    // diagnostic's identity (`spec/error-model.md:255-260`): `Mystery`, `MYSTERY`, and `mystery`
    // are one absent callable and must report one `params.name`. Emit the case-folded resolution
    // name, not the source spelling (issue #1005).
    const params: Record<string, unknown> =
      suggestion === undefined ? { name: lower } : { name: lower, suggestion };

    diagnostics.push({
      code: "ol-unknown-command",
      source_span: span,
      params,
      message: messageFor(lower, suggestion),
      stage: "semantic",
      severity: "error",
    });
  });

  return diagnostics;
}
