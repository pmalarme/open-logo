/**
 * The static arity rule (issue #111): the checker rule that raises `ol-not-enough-inputs` and
 * `ol-too-many-inputs` for a call site whose input count disagrees with the callee's
 * statically-known arity (`spec/tooling.md:181-182`, `spec/error-model.md:97-98`). It is the
 * static counterpart to the runtime call-time arity check (issue #97) and shares that code's
 * `callable`/`expected`/`actual` param shape, differing only in `stage` (`semantic` here).
 *
 * ## What "statically known" means here
 * - **Core, Data-, Sound-, and Interaction & Events-profile primitives** — a default (bare-call)
 *   arity and a variadic ceiling
 *   from {@link corePrimitiveArityRange} / {@link dataPrimitiveArityRange} (issue #405 wires the
 *   latter in, mirroring the former exactly; issue #689 adds Sound's and issue #687 Interaction &
 *   Events' `wait`, each gated on its own active profile). OpenLogo's reader gathers *exactly* the
 *   default
 *   number of arguments for a bare (non-parenthesized) call, so a bare primitive call can only
 *   ever be short of arguments (the line or block ended first, e.g. `print first`), never over —
 *   extra tokens become stray statements the parser reports as `ol-bad-token`, not a too-many
 *   call. The parenthesized form `(f …)` is where a learner can over-supply, and it is also the
 *   spec's escape hatch for a primitive's alternate/variadic arities (`(print …)`, `(random a b)`,
 *   `(list a b …)`): a *strictly fixed-arity* primitive given too many inputs there
 *   (`(first 1 2)`, `(reverse :a :b)`) raises `ol-too-many-inputs`, while an open variadic
 *   (`(print …)`, `(list …)`) never does. The lower bound of a parenthesized primitive call is
 *   left to the runtime arity check (issue #97), since an open variadic's true minimum is not
 *   expressible in the default-arity table.
 * - **User procedures and struct constructors** — a `define`d procedure has an exact,
 *   non-variadic arity: the required-parameter count (parameters without a default) is the
 *   floor, the total parameter count the ceiling. Optional (defaulted) trailing parameters can
 *   only be supplied via the parenthesized form, so both too-few and too-many are checked in
 *   either call form. A `struct`'s constructor (issue #405) is likewise exact and non-variadic —
 *   its declared field count is both floor and ceiling, always
 *   (`spec/data-structures.md:252-266`) — checked identically in either call form.
 *
 * A callee that is none of these is *not* statically known — that is `ol-unknown-command`'s job
 * (issue #117); this rule does nothing for it, so the two rules never double-report. Grammar
 * operator calls (`+`, `and`, comparison heads, …) are likewise never in the arity table, so
 * they fall through the same "unknown arity → skip" path.
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
import {
  corePrimitiveArityRange,
  dataPrimitiveArityRange,
  interactionPrimitiveArityRange,
  soundPrimitiveArityRange,
} from "./signatures.js";

/** The statically-known arity of a callee: a required floor and a total ceiling. */
interface Arity {
  readonly required: number;
  readonly max: number;
}

function isCallSite(node: AnyNode): node is CallNode | ParenCallNode {
  return node.kind === "Call" || node.kind === "ParenCall";
}

/**
 * Every user procedure's arity, keyed by its canonical lowercase name. A procedure's required
 * floor is its count of parameters without a default; its ceiling is its total parameter count.
 * A later `define` of the same name overwrites the earlier one here — redefining a procedure is
 * `ol-reserved-word`'s concern (issue #113), not this rule's.
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
 * (`spec/data-structures.md:252-266`), never optional/variadic. Mirrors
 * {@link collectProcedureArities} exactly, including "a later `struct` of the same name overwrites
 * the earlier one here" (redefinition collisions are `ol-reserved-word`'s concern,
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
 * `form` and pushes the matching `ol-not-enough-inputs`/`ol-too-many-inputs` diagnostic when they
 * disagree. Shared by every primitive whose parenthesized form can be a genuine variadic/alternate
 * arity — currently Core primitives and, since issue #405, `list` (the one Data primitive with a
 * variadic paren form, `spec/data-structures.md:78`) — since the reasoning is identical regardless
 * of profile: a **bare** call can only ever be short of arguments (the reader caps it at the
 * default arity, so extra tokens become a parse-stage `ol-bad-token`, never a too-many call); a
 * **parenthesized** call is where a learner can over-supply, and also where a strictly fixed-arity
 * primitive's true minimum is exact (`max === min`) — a bounded alternate or open variadic's true
 * minimum is left to the runtime arity check (issue #97) to avoid false positives.
 */
function checkPrimitiveRangeArity(
  node: CallNode | ParenCallNode,
  raw: string,
  range: { readonly min: number; readonly max: number },
  actual: number,
  span: SourceSpan,
  diagnostics: Diagnostic[],
): void {
  if (node.kind === "Call") {
    if (actual < range.min) {
      diagnostics.push(notEnoughDiagnostic(raw, range.min, actual, span));
    }
    return;
  }
  if (actual > range.max) {
    diagnostics.push(tooManyDiagnostic(raw, range.max, actual, span));
  } else if (range.max === range.min && actual < range.min) {
    diagnostics.push(notEnoughDiagnostic(raw, range.min, actual, span));
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
  raw: string,
  arity: Arity,
  actual: number,
  span: SourceSpan,
  diagnostics: Diagnostic[],
): void {
  if (actual < arity.required) {
    diagnostics.push(notEnoughDiagnostic(raw, arity.required, actual, span));
  } else if (actual > arity.max) {
    diagnostics.push(tooManyDiagnostic(raw, arity.max, actual, span));
  }
}

/**
 * The `ol-not-enough-inputs` / `ol-too-many-inputs` rule. For each call site whose callee has a
 * statically-known arity, compares the supplied argument count against that arity and, when they
 * disagree, raises one diagnostic pointing at the callee. Parenthesized primitive calls are left
 * to the runtime (they are the alternate/variadic escape hatch); unknown callees are left to
 * `ol-unknown-command`.
 */
export function arityRule(
  program: ProgramNode,
  profiles: readonly CheckProfile[],
): readonly Diagnostic[] {
  const procedures = collectProcedureArities(program);
  // Core primitives are only *visible* — and so only arity-checkable — when Core Language is
  // active; otherwise the callee is unknown and belongs to `ol-unknown-command` (issue #117),
  // never double-reported here. User procedures come from the program's own `define`s, so their
  // arity is checked regardless of the active profile set (mirroring `collectVisibleNames`).
  const coreActive = profiles.includes("core-language");
  // Data-profile primitives and struct constructors are likewise only visible — and so only
  // arity-checkable — when the `data` profile is active (issue #405), mirroring
  // `collectVisibleNames`'s own `data` gate.
  const dataActive = profiles.includes("data");
  const structs = dataActive
    ? collectStructConstructorArities(program)
    : undefined;
  // Sound-profile primitives (`set_tempo`/`beep`) are likewise only visible — and so only
  // arity-checkable — when the `sound` profile is active (issue #689), mirroring
  // `collectVisibleNames`'s own `sound` gate.
  const soundActive = profiles.includes("sound");
  // The Interaction & Events primitive `wait` is likewise only visible — and so only
  // arity-checkable — when the `interaction-events` profile is active (issue #687), mirroring
  // `collectVisibleNames`'s own `interaction-events` gate. The profile's four block-heads
  // (`when`/`every`/`on_key`/`on_click`) are not call sites at all — the reader lowers them to a
  // `ProfileStatement`, so `isCallSite` never sees them and this rule cannot mis-fire on one.
  const interactionActive = profiles.includes("interaction-events");
  const diagnostics: Diagnostic[] = [];

  walk(program, (node) => {
    if (!isCallSite(node)) {
      return;
    }
    const raw = node.callee.name;
    const lower = raw.toLowerCase();
    const actual = node.args.length;
    const span = node.callee.source_span;

    const procedure = procedures.get(lower);
    if (procedure !== undefined) {
      checkExactArity(raw, procedure, actual, span, diagnostics);
      return;
    }

    if (structs !== undefined) {
      const structArity = structs.get(lower);
      if (structArity !== undefined) {
        checkExactArity(raw, structArity, actual, span, diagnostics);
        return;
      }
    }

    if (dataActive) {
      const dataRange = dataPrimitiveArityRange(lower);
      if (dataRange !== undefined) {
        checkPrimitiveRangeArity(
          node,
          raw,
          dataRange,
          actual,
          span,
          diagnostics,
        );
        return;
      }
    }

    if (soundActive) {
      const soundRange = soundPrimitiveArityRange(lower);
      if (soundRange !== undefined) {
        checkPrimitiveRangeArity(
          node,
          raw,
          soundRange,
          actual,
          span,
          diagnostics,
        );
        return;
      }
    }

    if (interactionActive) {
      const interactionRange = interactionPrimitiveArityRange(lower);
      if (interactionRange !== undefined) {
        checkPrimitiveRangeArity(
          node,
          raw,
          interactionRange,
          actual,
          span,
          diagnostics,
        );
        return;
      }
    }

    if (!coreActive) {
      // Core primitives are not visible: an unknown callee for `ol-unknown-command`, not arity.
      return;
    }
    // A Heritage short alias (`pr`/`fd`/…) is arity-checked exactly like the Core command it spells
    // — Heritage adds no semantics (`spec/conformance.md:146`). The reader already recorded that
    // canonical on the node (`canonical`), so resolve through it, but only when the Heritage profile
    // is active: with it inactive the alias is an unknown callee owned by `ol-unknown-command`
    // (issue #117), never double-reported here — mirroring `collectVisibleNames`'s own heritage gate.
    // `pr` resolves to `print` (a Core range, so `(pr …)` is checked as an open variadic and a
    // too-many `(pr)` is caught); the turtle canonicals (`forward`/…) have no Core static range, so
    // they fall through to the runtime arity check exactly as their Core spelling does.
    const heritageActive = profiles.includes("heritage");
    const effective =
      heritageActive && node.canonical !== undefined ? node.canonical : lower;
    const range = corePrimitiveArityRange(effective);
    if (range === undefined) {
      // Unknown callee (or grammar operator): not this rule's concern.
      return;
    }
    // Diagnostic identity is canonical, not the surface spelling (`spec/error-model.md:235-238`,
    // issue #733): a Heritage alias (`bf`) and its Core twin (`butfirst`) name the SAME condition,
    // so `params.callable` — a machine-readable identifier tools assert on — must be the canonical
    // name, identical to the Core twin's, exactly as H5 (#670) canonicalizes `operation` through a
    // shared read helper. `effective` is that canonical name (the reader's `canonical`, or `lower`
    // when there is no alias), so it also drives the diagnostic's prose (canonical display is
    // permitted; `spec/localization.md`). Heritage is "alternate spellings only, no new semantics"
    // (`spec/conformance.md#heritage`) — a diagnostic whose structured identity changed with the
    // spelling would be an observable semantic difference.
    checkPrimitiveRangeArity(node, effective, range, actual, span, diagnostics);
  });

  return diagnostics;
}
