/**
 * The static arity rule (issue #111): the checker rule that raises `ol-not-enough-inputs` and
 * `ol-too-many-inputs` for a call site whose input count disagrees with the callee's
 * statically-known arity (`spec/tooling.md:182-183`, `spec/error-model.md:98-99`). It is the
 * static counterpart to the runtime call-time arity check (issue #97) and shares that code's
 * `callable`/`expected`/`actual` param shape, differing only in `stage` (`semantic` here).
 *
 * ## What "statically known" means here
 * - **Every primitive an active conformance profile registers** — a default (bare-call) arity and
 *   a variadic ceiling, read through `signatures.ts`'s single
 *   {@link activeProfilePrimitiveArityRange} lookup. That lookup walks the profile-keyed
 *   `PROFILE_PRIMITIVES` registry, so **this rule names no profile and no primitive of its own**:
 *   a table registered there is arity-checked here automatically, gated on its owning profile
 *   being active, and registering a future profile's table requires no edit to this file at all
 *   (issue #874).
 *
 *   That derivation is the fix for a defect this rule shipped in its previous shape. It used to
 *   hand-write one `if (<profile>Active) { … }` branch per profile — and Turtle & Rendering,
 *   Educational, Sprites, and Tutor had no branch, so `(home 10)` and `(clear_screen 10)` checked
 *   completely clean while `execute()` raised `ol-too-many-inputs` for the very same call. `home`
 *   and `clear_screen` are among the first commands a learner types, so the silence was widest
 *   exactly where beginners work. It was the third instance of one recurring shape (#783, #854,
 *   this): a checker component enumerating one profile's names by hand and silently skipping the
 *   rest. Enumerating the four missing profiles would have restored that shape; deriving the set
 *   retires it.
 *
 *   OpenLogo's reader gathers *exactly* the default number of arguments for a bare
 *   (non-parenthesized) call, so a bare primitive call can only ever be short of arguments (the
 *   line or block ended first, e.g. `print first`), never over — extra tokens become stray
 *   statements the parser reports as `ol-bad-token`, not a too-many call. The parenthesized form
 *   `(f …)` is where a learner can over-supply, and it is also the spec's escape hatch for a
 *   primitive's alternate/variadic arities (`(print …)`, `(random a b)`, `(list a b …)`): a
 *   *strictly fixed-arity* primitive given too many inputs there (`(first 1 2)`, `(reverse :a :b)`,
 *   `(home 10)`) raises `ol-too-many-inputs`, while an open variadic (`(print …)`, `(list …)`)
 *   never does. The lower bound of a parenthesized primitive call is left to the runtime arity
 *   check (issue #97), since an open variadic's true minimum is not expressible in the
 *   default-arity table.
 * - **User procedures and struct constructors** — a `define`d procedure has an exact,
 *   non-variadic arity: the required-parameter count (parameters without a default) is the
 *   floor, the total parameter count the ceiling. Optional (defaulted) trailing parameters can
 *   only be supplied via the parenthesized form, so both too-few and too-many are checked in
 *   either call form. A `struct`'s constructor (issue #405) is likewise exact and non-variadic —
 *   its declared field count is both floor and ceiling, always
 *   (`spec/data-structures.md:324`) — checked identically in either call form.
 *
 * A callee that is none of these is *not* statically known — that is `ol-unknown-command`'s job
 * (issue #117); this rule does nothing for it, so the two rules never double-report. Since #874
 * that separation is **structural** rather than incidental: a primitive callee is arity-checked
 * only when {@link collectVisibleNames} — the very set `ol-unknown-command` itself consults —
 * holds its name, so both rules read one shared answer to "is this callee known here?" instead of
 * two lists that can drift apart. It is what lets the Tutor profile's `challenge` sit in the arity
 * registry alongside every other profile while it still has no checker visibility and no runtime:
 * today it is reported `ol-unknown-command` alone, and the slice that makes it visible inherits its
 * arity check for free. Grammar operator calls (`+`, `and`, comparison heads, …) are likewise never
 * registered as primitives, so they fall through the same "unknown arity → skip" path.
 *
 * ## The one way this derivation can still degrade
 * `collectVisibleNames` **is** derived from the same profile-keyed registries since issue #966, so
 * a profile registered in the arity registry (which the compiler forces) is made visible with no
 * edit to `checker-names.ts` at all. What stays hand-written there is the *withholding*: the
 * one-entry `NAMES_AWAITING_AN_EVALUATOR` set, which today holds `challenge` alone because the
 * Tutor profile has no evaluator and a name that checks clean and then does nothing is the silent
 * no-op this repository refuses. A name added to that set — or left in it after its evaluator
 * shipped — falls through the guard above and reports `ol-unknown-command` instead of an arity
 * finding. That degrades *gracefully* — no false positive, and the honest "I don't know this name"
 * is the better of the two — and it is not silent: `profile-arity-derivation.test.mjs`'s DAG sweep
 * collects every registered-but-invisible name and asserts the set is exactly `["challenge"]`, so a
 * second one fails that test by name.
 *
 * ## `params.callable` is the name as its definition declares it
 * Diagnostic identity is `code` plus `params`, and the same condition MUST carry the same
 * structured params (`spec/error-model.md:254-259`). OpenLogo identifiers are case-insensitive, so
 * the *call site's* spelling can never be the identity: `(SQ 1 2)` and `(sq 1 2)` are one condition
 * and must report one `callable`. The rule is therefore **the spelling the name's definition
 * declares**, which resolves both kinds of callee without special-casing either:
 *
 * - **A built-in** is declared by OpenLogo itself, and its declared spelling is the canonical
 *   lowercase name in `signatures.ts`. So `(REVERSE 1 2)` reports `reverse`, and a Heritage alias
 *   reports its canonical twin (`(bf 1 2)` → `butfirst`) — Heritage is "alternate spellings only,
 *   no new semantics" (`spec/conformance.md:150`), the behaviour issues #670/#733/#741/#787 pinned.
 *   Before #874 only Core and Heritage did this while Data/Geometry/Sound/Interaction echoed the
 *   surface spelling, so one condition had two identities depending on which profile owned it.
 * - **A user procedure or struct constructor** is declared by the learner, and *its* declared
 *   spelling is whatever the `define`/`struct` wrote. `define MyProc` reports `MyProc` — from the
 *   declaration, not from the call — so `(MyProc)`, `(myproc)`, and `(MYPROC)` all report `MyProc`.
 *   Lowercasing it would discard the only authority there is and show a learner a name they never
 *   wrote; echoing the call site would give one condition three identities. Note the pre-#874 code
 *   did the latter: it passed the *call site's* spelling, so the reported name changed with how the
 *   procedure happened to be called.
 */

import type { Diagnostic, SourceSpan } from "@openlogo/core";
import type {
  AnyNode,
  CallNode,
  ParenCallNode,
  ProgramNode,
  StructDefNode,
} from "./ast.js";
import { walk } from "./ast.js";
import type { CheckProfile } from "./check.js";
import { collectVisibleNames } from "./checker-names.js";
import type { ArityRange } from "./signatures.js";
import { activeProfilePrimitiveArityRange } from "./signatures.js";

/** The statically-known arity of a callee: a required floor and a total ceiling. */
interface Arity {
  readonly required: number;
  readonly max: number;
  /**
   * The name exactly as its `define`/`struct` declared it, surface case preserved. This — not the
   * call site's spelling and not a lowercased form — is what a finding reports as
   * `params.callable`; see the module doc's `params.callable` section for why.
   */
  readonly declared: string;
}

function isCallSite(node: AnyNode): node is CallNode | ParenCallNode {
  return node.kind === "Call" || node.kind === "ParenCall";
}

/**
 * Every user procedure's arity, keyed by its canonical lowercase name and carrying the spelling its
 * `define` declared. A procedure's required floor is its count of parameters without a default; its
 * ceiling is its total parameter count. A later `define` of the same name overwrites the earlier one
 * here — redefining a procedure is `ol-duplicate-definition`'s concern (issues #113, #838), not this
 * rule's — so the declared spelling reported is the last declaration's, matching the arity beside it.
 */
function collectProcedureArities(
  program: ProgramNode,
): ReadonlyMap<string, Arity> {
  const arities = new Map<string, Arity>();
  walk(program, (node) => {
    if (node.kind === "ProcedureDef") {
      const required = node.params.filter(
        (param) => param.defaultValue === undefined,
      ).length;
      arities.set(node.name.name.toLowerCase(), {
        required,
        max: node.params.length,
        declared: node.name.name,
      });
    }
  });
  return arities;
}

function isStructDef(node: AnyNode): node is StructDefNode {
  return node.kind === "StructDef";
}

/**
 * Every `struct` type's constructor arity, keyed by its canonical lowercase name — the required
 * floor and ceiling are both its declared field count, since a constructor call is always exact
 * (`spec/data-structures.md:324`), never optional/variadic. Mirrors
 * {@link collectProcedureArities} exactly, including "a later `struct` of the same name overwrites
 * the earlier one here" (redefinition collisions are `ol-duplicate-definition`'s concern,
 * `checker-reserved-word.ts`, not this rule's) — and mirrors `@openlogo/runtime`'s own phase-1
 * struct registration (`execute-internal.ts`'s `collectStructs`), which likewise collects every
 * `StructDef` before any statement runs.
 */
function collectStructConstructorArities(
  program: ProgramNode,
): ReadonlyMap<string, Arity> {
  const arities = new Map<string, Arity>();
  walk(program, (node) => {
    if (isStructDef(node)) {
      const fieldCount = node.fields.length;
      arities.set(node.name.name.toLowerCase(), {
        required: fieldCount,
        max: fieldCount,
        declared: node.name.name,
      });
    }
  });
  return arities;
}

/** English number word for a small count, falling back to digits past ten. */
const NUMBER_WORDS: readonly string[] = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
];

function countWord(count: number): string {
  return NUMBER_WORDS[count] ?? String(count);
}

function inputsPhrase(count: number): string {
  return `${countWord(count)} input${count === 1 ? "" : "s"}`;
}

function notEnoughDiagnostic(
  callable: string,
  expected: number,
  actual: number,
  span: SourceSpan,
): Diagnostic {
  return {
    code: "ol-not-enough-inputs",
    source_span: span,
    params: { callable, expected, actual },
    message: `${callable} needs ${inputsPhrase(expected)}.`,
    stage: "semantic",
    severity: "error",
  };
}

function tooManyDiagnostic(
  callable: string,
  expected: number,
  actual: number,
  span: SourceSpan,
): Diagnostic {
  return {
    code: "ol-too-many-inputs",
    source_span: span,
    params: { callable, expected, actual },
    message: `${callable} takes ${inputsPhrase(expected)}, but got ${actual}.`,
    stage: "semantic",
    severity: "error",
  };
}

/**
 * Compares `actual` against a primitive's `[min, max]` accepted-input range for the given call
 * form and pushes the matching `ol-not-enough-inputs`/`ol-too-many-inputs` diagnostic when they
 * disagree. Shared by the primitives of every profile, because the reasoning does not depend on
 * which profile owns the name: a **bare** call can only ever be short of arguments (the reader
 * caps it at the default arity, so extra tokens become a parse-stage `ol-bad-token`, never a
 * too-many call); a **parenthesized** call is where a learner can over-supply, and also where a
 * strictly fixed-arity primitive's true minimum is exact (`max === min`) — a bounded alternate or
 * open variadic's true minimum is left to the runtime arity check (issue #97) to avoid false
 * positives.
 */
function checkPrimitiveRangeArity(
  node: CallNode | ParenCallNode,
  callable: string,
  range: ArityRange,
  actual: number,
  span: SourceSpan,
  diagnostics: Diagnostic[],
): void {
  if (node.kind === "Call") {
    if (actual < range.min) {
      diagnostics.push(notEnoughDiagnostic(callable, range.min, actual, span));
    }
    return;
  }
  if (actual > range.max) {
    diagnostics.push(tooManyDiagnostic(callable, range.max, actual, span));
  } else if (range.max === range.min && actual < range.min) {
    diagnostics.push(notEnoughDiagnostic(callable, range.min, actual, span));
  }
}

/**
 * Compares `actual` against `arity`'s `[required, max]` bounds and pushes the matching
 * `ol-not-enough-inputs`/`ol-too-many-inputs` diagnostic when they disagree. Shared by every
 * exact-arity callable this rule checks — user procedures and, since issue #405, struct
 * constructors — since both have a statically-known, non-variadic arity checked identically
 * regardless of call form (bare or parenthesized).
 */
function checkExactArity(
  callable: string,
  arity: Arity,
  actual: number,
  span: SourceSpan,
  diagnostics: Diagnostic[],
): void {
  if (actual < arity.required) {
    diagnostics.push(
      notEnoughDiagnostic(callable, arity.required, actual, span),
    );
  } else if (actual > arity.max) {
    diagnostics.push(tooManyDiagnostic(callable, arity.max, actual, span));
  }
}

/**
 * The `ol-not-enough-inputs` / `ol-too-many-inputs` rule. For each call site whose callee has a
 * statically-known arity, compares the supplied argument count against that arity and, when they
 * disagree, raises one diagnostic pointing at the callee. Unknown callees are left to
 * `ol-unknown-command`; an open variadic's parenthesized lower bound is left to the runtime.
 */
export function arityRule(
  program: ProgramNode,
  profiles: readonly CheckProfile[],
): readonly Diagnostic[] {
  // User procedures come from the program's own `define`s, so their arity is checked regardless of
  // the active profile set (mirroring `collectVisibleNames`). Struct constructors are declared by
  // the program too, but `struct` is a Data-profile form, so they are collected only when `data` is
  // active — mirroring `collectVisibleNames`'s own `data` gate (issue #405).
  const procedures = collectProcedureArities(program);
  const structs = profiles.includes("data")
    ? collectStructConstructorArities(program)
    : undefined;
  // A Heritage short alias (`pr`/`fd`/…) is arity-checked exactly like the Core-spelled command it
  // spells — Heritage adds no semantics (`spec/conformance.md:150`). The reader already recorded
  // that canonical on the node, so resolve through it, but only when the Heritage profile is
  // active: with it inactive the alias is an unknown callee owned by `ol-unknown-command` (issue
  // #117), never double-reported here — mirroring `collectVisibleNames`'s own heritage gate.
  const heritageActive = profiles.includes("heritage");
  // The one shared answer to "is this callee known here?", built by the same helper
  // `ol-unknown-command` uses. Consulting it — rather than assuming a registered primitive is also
  // a visible one — is what keeps the two rules from double-reporting the same call site.
  const visible = collectVisibleNames(program, profiles);
  const diagnostics: Diagnostic[] = [];

  walk(program, (node) => {
    if (!isCallSite(node)) {
      return;
    }
    const lower = node.callee.name.toLowerCase();
    const actual = node.args.length;
    const span = node.callee.source_span;

    const procedure = procedures.get(lower);
    if (procedure !== undefined) {
      checkExactArity(procedure.declared, procedure, actual, span, diagnostics);
      return;
    }

    if (structs !== undefined) {
      const structArity = structs.get(lower);
      if (structArity !== undefined) {
        checkExactArity(
          structArity.declared,
          structArity,
          actual,
          span,
          diagnostics,
        );
        return;
      }
    }

    if (!visible.has(lower)) {
      // An unknown callee under this profile set: `ol-unknown-command`'s finding, not an arity one.
      return;
    }

    const canonical =
      heritageActive && node.canonical !== undefined ? node.canonical : lower;
    const range = activeProfilePrimitiveArityRange(canonical, profiles);
    if (range === undefined) {
      // Visible, but no active profile registers an arity for it — a keyword the grammar handles,
      // a profile block-head, or a grammar operator. Not this rule's concern.
      return;
    }
    checkPrimitiveRangeArity(node, canonical, range, actual, span, diagnostics);
  });

  return diagnostics;
}
