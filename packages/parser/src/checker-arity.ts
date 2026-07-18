/**
 * The static arity rule (issue #111): the checker rule that raises `ol-not-enough-inputs` and
 * `ol-too-many-inputs` for a call site whose input count disagrees with the callee's
 * statically-known arity (`spec/tooling.md:181-182`, `spec/error-model.md:97-98`). It is the
 * static counterpart to the runtime call-time arity check (issue #97) and shares that code's
 * `callable`/`expected`/`actual` param shape, differing only in `stage` (`semantic` here).
 *
 * ## What "statically known" means here
 * Only two callables have an arity this rule can trust before execution:
 *
 * - **Core primitives** — a default arity from {@link corePrimitiveArity} and a variadic ceiling
 *   from {@link corePrimitiveArityRange}. OpenLogo's reader gathers *exactly* the default number
 *   of arguments for a bare (non-parenthesized) call, so a bare primitive call can only ever be
 *   short of arguments (the line or block ended first, e.g. `print first`), never over — extra
 *   tokens become stray statements the parser reports as `ol-bad-token`, not a too-many call. The
 *   parenthesized form `(f …)` is where a learner can over-supply, and it is also the spec's
 *   escape hatch for a primitive's alternate/variadic arities (`(print …)`, `(random a b)`,
 *   `(word …)`): a *strictly fixed-arity* primitive given too many inputs there (`(first 1 2)`)
 *   raises `ol-too-many-inputs`, while an open variadic (`(print …)`) never does. The lower bound
 *   of a parenthesized primitive call is left to the runtime arity check (issue #97), since an
 *   open variadic's true minimum is not expressible in the default-arity table.
 * - **User procedures** — declared with `define`, they have an exact, non-variadic arity: the
 *   required-parameter count (parameters without a default) is the floor, the total parameter
 *   count the ceiling. Optional (defaulted) trailing parameters can only be supplied via the
 *   parenthesized form, so both too-few and too-many are checked for user procedures, in either
 *   call form.
 *
 * A callee that is neither is *not* statically known — that is `ol-unknown-command`'s job
 * (issue #117); this rule does nothing for it, so the two rules never double-report. Grammar
 * operator calls (`+`, `and`, comparison heads, …) are likewise never in the arity table, so
 * they fall through the same "unknown arity → skip" path.
 */

import type { Diagnostic, SourceSpan } from "@openlogo/core";
import type { AnyNode, CallNode, ParenCallNode, ProgramNode } from "./ast.js";
import { walk } from "./ast.js";
import type { CheckProfile } from "./check.js";
import { corePrimitiveArityRange } from "./signatures.js";

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
      if (actual < procedure.required) {
        diagnostics.push(
          notEnoughDiagnostic(raw, procedure.required, actual, span),
        );
      } else if (actual > procedure.max) {
        diagnostics.push(tooManyDiagnostic(raw, procedure.max, actual, span));
      }
      return;
    }

    if (!coreActive) {
      // Core primitives are not visible: an unknown callee for `ol-unknown-command`, not arity.
      return;
    }
    const range = corePrimitiveArityRange(lower);
    if (range === undefined) {
      // Unknown callee (or grammar operator): not this rule's concern.
      return;
    }
    if (node.kind === "Call") {
      // Bare form: the reader caps a bare call at the primitive's default arity, so extra inputs
      // become stray statements (a parse-stage `ol-bad-token`) and only too-few is reachable.
      if (actual < range.min) {
        diagnostics.push(notEnoughDiagnostic(raw, range.min, actual, span));
      }
      return;
    }
    // Parenthesized form: the learner explicitly grouped the inputs, so this is the only place a
    // primitive can be over-supplied. A strictly fixed-arity primitive has `max === min`, so
    // `(first 1 2)` is too many; an open variadic (`max` is infinite, e.g. `(print …)`) never is.
    // The lower bound of a parenthesized primitive call is left to the runtime arity check (#97):
    // an open variadic's true minimum is not expressible in the single default-arity table.
    if (actual > range.max) {
      diagnostics.push(tooManyDiagnostic(raw, range.max, actual, span));
    }
  });

  return diagnostics;
}
