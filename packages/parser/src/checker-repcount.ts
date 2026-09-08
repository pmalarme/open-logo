/**
 * The `ol-repcount-outside-repeat` static rule (issue #1155) — the Layer-2 half of a code the
 * registry gives usual stage **`semantic`** (`spec/error-model.md:120`) but which, until this
 * slice, only the evaluator ever raised.
 *
 * `repcount` "reports the current 1-based iteration count of the innermost enclosing `repeat`"
 * and, "when several `repeat` loops are nested, refers to the nearest one"
 * (`spec/commands.md:783`); using it outside any `repeat` is `ol-repcount-outside-repeat`
 * (`spec/commands.md:793`). *Enclosing* is a lexical property of the program text, so whether a
 * `repcount` has one is knowable by reading the source — and `spec/error-model.md:76-78` says a
 * condition an implementation can detect earlier without changing behavior SHOULD be reported at
 * the earlier stage, keeping the same `code`. Reporting it here means the check-before-execution
 * gate (`spec/execution-model.md:632`) refuses the program instead of letting it half-execute:
 * before this rule, `print "start" / print repcount / print "done"` printed `start` and three
 * events' worth of effects before stopping, while the two sibling codes the registry classifies
 * identically — `ol-return-outside-proc` (`:116`) and `ol-stop-outside-proc` (`:119`) — already
 * refused their programs with zero events.
 *
 * ## The scoping rule, measured against the evaluator rather than assumed
 *
 * The rule this walk implements is exactly what `@openlogo/runtime` already does, so `check()`
 * never refuses a program the evaluator would have run. Each clause below was measured on the
 * evaluator before it was written here:
 *
 * - **A `repeat` body encloses; nothing else does.** `for … in`, `for … from … to`, `while`,
 *   `if`, `forever`, a `map`/`filter`/`reduce` body, and an event-handler block are all
 *   transparent — they neither introduce nor hide a turn — because the evaluator threads the same
 *   `repeatTurns` stack through them and only `Repeat` pushes onto it. `forever [ print repcount ]`
 *   is therefore a fault (`forever` is not `repeat`), while
 *   `repeat 2 [ print map i in [ 1 2 ] [ repcount ] ]` is not.
 * - **A `repeat`'s own count expression sits OUTSIDE its body.** `repeat repcount [ … ]` at top
 *   level is a fault; `repeat 2 [ repeat repcount [ … ] ]` is not. The count is evaluated before
 *   the turn is pushed, the same shape as {@link controlFlowRule} visiting a comprehension's
 *   `iterable` in the enclosing context and only its `body` in the inner one.
 * - **A `define … end` body is a boundary, wherever the `define` is written.** `repcount` in a
 *   procedure body is a fault even when the procedure is *called* from inside a `repeat`, and even
 *   when the `define` itself is nested in one. Both were measured on the evaluator; a purely
 *   lexical walk without this boundary would miss both. The spec does **not** settle `repcount`
 *   across a call boundary — `spec/execution-model.md:340-342` fixes lexical frame scoping for
 *   *bindings* ("invisible to callees unless explicitly passed as values"), and the evaluator
 *   extends the same reasoning to the repeat-turn stack by starting each callee frame's empty
 *   (`execute-internal.ts`, which flags it as an assumption). This rule follows the evaluator
 *   rather than deciding the open question.
 *
 * The one shape this rule deliberately does not reach is a handler block registered inside a
 * `repeat` but dispatched after it has finished (`repeat 2 [ on_key "a" [ print repcount ] ]`).
 * Whether that handler's `repcount` has a turn depends on *when the key arrives*, which is not a
 * static property, so it stays exactly as it is today: a `runtime` finding if the handler ever
 * fires. Treating a handler block as a boundary instead would refuse
 * `repeat 2 [ when "start" [ print repcount ] ]`, which the evaluator runs clean — an over-report
 * is strictly worse than leaving a genuinely dynamic case to the evaluator.
 *
 * ## Read position versus place position
 *
 * The fault is *reading* a turn number that does not exist — `spec/error-model.md:120` says
 * `repcount` "was used" outside any enclosing `repeat`. In `repcount = 100` the word is an
 * assignment **target**, not a read: the parser keeps it as a `Call` in `place` position, and
 * `ol-not-a-place` (`checker-not-a-place.ts`) already describes that fault completely — the
 * program is refused before anything is evaluated, so the "read" never happens. Adding a second
 * finding there would break one-fault-one-diagnostic
 * (`spec/execution-model.md:737`). So an `Assign` whose target is
 * not a well-formed {@link PlaceNode} has that target skipped. A target that *is* a `PlaceNode`
 * is visited normally: its own children are just its `[key]` segment expressions, which are
 * genuine reads (`:xs[repcount] = 5`).
 *
 * ## Profile gating
 *
 * `repcount` is a Core name. With `core-language` inactive it is not a known name at all and
 * `unknownCommandRule` already reports `ol-unknown-command` for it, so this rule stays silent
 * rather than stacking a second finding on the same word — the active-profile consultation
 * `spec/tooling.md:175-176` requires of every rule.
 */

import type { Diagnostic } from "@openlogo/core";
import type {
  AnyNode,
  AssignNode,
  CallNode,
  ParenCallNode,
  PlaceNode,
  ProgramNode,
} from "./ast.js";
import { childrenOf } from "./ast.js";
import type { CheckProfile } from "./check.js";

/** The Core reporter this rule judges. Compared case-insensitively, as name lookup is. */
const REPCOUNT = "repcount";

/**
 * Is this node a zero-argument call to `repcount`? Both call shapes reach the reporter — the bare
 * `repcount` reads as a {@link CallNode}, the explicitly parenthesized `(repcount)` as a
 * {@link ParenCallNode} — and the evaluator raises the same code for both.
 */
function isRepcountRead(node: AnyNode): node is CallNode | ParenCallNode {
  return (
    (node.kind === "Call" || node.kind === "ParenCall") &&
    node.args.length === 0 &&
    node.callee.name.toLowerCase() === REPCOUNT
  );
}

/** Build the diagnostic at the reporter's own span; `params` is `none` per the registry. */
function repcountOutsideRepeatDiagnostic(
  node: CallNode | ParenCallNode,
): Diagnostic {
  return {
    code: "ol-repcount-outside-repeat",
    source_span: node.source_span,
    params: {},
    message:
      "repcount only reports a turn number inside a repeat loop — there is no enclosing repeat here.",
    stage: "semantic",
    severity: "error",
  };
}

/**
 * The subtrees of an `Assign` that are genuine reads. The `value` always is. The `place` is only
 * when it is a well-formed {@link PlaceNode} — see the module doc comment's read-versus-place
 * section.
 */
function assignReadChildren(node: AssignNode): readonly AnyNode[] {
  const place: readonly PlaceNode[] =
    node.place.kind === "Place" ? [node.place] : [];
  return [...place, node.value];
}

/**
 * The `ol-repcount-outside-repeat` rule. Registered in {@link RULES} after `controlFlowRule`, the
 * other enclosing-construct static.
 */
export function repcountRule(
  program: ProgramNode,
  profiles: readonly CheckProfile[],
): readonly Diagnostic[] {
  if (!profiles.includes("core-language")) {
    return [];
  }
  const diagnostics: Diagnostic[] = [];

  const visit = (node: AnyNode, insideRepeatBody: boolean): void => {
    if (isRepcountRead(node) && !insideRepeatBody) {
      diagnostics.push(repcountOutsideRepeatDiagnostic(node));
      return;
    }
    switch (node.kind) {
      case "Repeat": {
        visit(node.count, insideRepeatBody);
        visit(node.body, true);
        return;
      }
      case "ProcedureDef": {
        for (const child of childrenOf(node)) {
          visit(child, false);
        }
        return;
      }
      case "Assign": {
        for (const child of assignReadChildren(node)) {
          visit(child, insideRepeatBody);
        }
        return;
      }
      default: {
        for (const child of childrenOf(node)) {
          visit(child, insideRepeatBody);
        }
      }
    }
  };

  visit(program, false);
  return diagnostics;
}
