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
 * events' worth of effects before stopping, while the two sibling codes the registry gives the same
 * usual stage — `ol-return-outside-proc` (`spec/error-model.md:116`) and `ol-stop-outside-proc`
 * (`spec/error-model.md:119`) — already refused their programs with zero events. Only the *stage*
 * is shared; their required params differ (`keyword`, `none or keyword`, and `none` respectively).
 *
 * ## The scoping rule, measured against the evaluator rather than assumed
 *
 * The rule this walk implements is exactly what `@openlogo/runtime` already does, so `check()`
 * never refuses a program the evaluator would have run. Each clause below was measured on the
 * evaluator before it was written here:
 *
 * - **A `repeat` body encloses; nothing else does.** `for … in`, `for … from … to`, `while`,
 *   `if`, `forever`, and a `map`/`filter`/`reduce` body are all transparent — they neither
 *   introduce nor hide a turn — because the evaluator threads the same `repeatTurns` stack through
 *   them and only `Repeat` pushes onto it. `forever [ print repcount ]`
 *   is therefore a fault (`forever` is not `repeat`), while
 *   `repeat 2 [ print map i in [ 1 2 ] [ repcount ] ]` is not.
 * - **An event-handler BODY is `dispatch-dependent`, and is traversed rather than skipped.** A
 *   handler body is the one place where the question is not static: its `repcount` reads whatever
 *   turn is on the stack when the handler *fires*. The discriminating measurement is a handler
 *   with **no `repeat` anywhere around it**, so no enclosing construct could supply a turn —
 *   `on_key "a" [ print repcount ]` followed by `repeat 3 [ wait 1 ]`, with the key delivered at
 *   **tick 2**, **prints 2**: the dispatching loop's second turn. The same program followed by a
 *   bare `wait 3` raises `ol-repcount-outside-repeat` at `runtime`. Same source, two outcomes,
 *   decided only by what is running when the key arrives. Judging a handler body lexically
 *   therefore errs in both directions, and the over-report direction is the damaging one: it
 *   refuses a program that prints correctly.
 *
 *   But `dispatch-dependent` is **not** "unknowable", which is why the body is still walked. A
 *   `define … end` inside a handler body restores certainty — a callee's repeat-turn stack starts
 *   empty however the handler was dispatched — so
 *   `on_key "a" [ define f  print repcount  end  f ]` is a fault even though the handler itself is
 *   dispatch-dependent, and the evaluator agrees (`runtime`). Treating the body as wholly opaque
 *   missed exactly that.
 * - **A `repeat`'s own count expression sits OUTSIDE its body.** `repeat repcount [ … ]` at top
 *   level is a fault; `repeat 2 [ repeat repcount [ … ] ]` is not. The count is evaluated before
 *   the turn is pushed, the same shape as {@link controlFlowRule} visiting a comprehension's
 *   `iterable` in the enclosing context and only its `body` in the inner one.
 * - **A `define … end` body is `outside` from every state, wherever the `define` is written.**
 *   `repcount` in a procedure body is a fault even when the procedure is *called* from inside a
 *   `repeat`, when the `define` itself is nested in one, and when it is nested in a handler body.
 *   All three were measured on the evaluator. The spec does **not** settle `repcount`
 *   across a call boundary — `spec/execution-model.md:340-342` fixes lexical frame scoping for
 *   *bindings* ("invisible to callees unless explicitly passed as values"), and the evaluator
 *   extends the same reasoning to the repeat-turn stack by starting each callee frame's empty
 *   (`execute-internal.ts`, which flags it as an assumption). This rule follows the evaluator
 *   rather than deciding the open question.
 *
 * The shapes this rule deliberately does not reach are those left `dispatch-dependent`: a
 * `repcount` read directly in an event-handler body, with no intervening construct that restores
 * certainty. Those stay exactly as they are today — a `runtime` finding if the handler fires.
 *
 * ## Read position versus place position
 *
 * The fault is *reading* a turn number that does not exist — `spec/error-model.md:120` says
 * `repcount` "was used" outside any enclosing `repeat`. In `repcount = 100` the word is the
 * assignment **target itself**, not a read: the parser keeps it as a `Call` in `place` position,
 * and `ol-not-a-place` (`checker-not-a-place.ts`) already describes that fault completely. So the
 * **root** of a target that is not a well-formed {@link PlaceNode} is not treated as a read.
 *
 * Only the root. Its children are still visited, because a read nested inside a malformed target
 * is an **independent** fault: `first repcount = 5` is two separate mistakes, and fixing either
 * leaves the other standing. That is the checker's existing policy rather than a new invention —
 * `first :undefined_name = 5` already reports `ol-not-a-place` **and** `ol-undefined-var`
 * (`checker-undefined-var.ts`). An earlier draft skipped the whole subtree and cited
 * `spec/execution-model.md:737` for it; that section governs which of two *competing* diagnostics
 * about one fault wins, not whether an unrelated finding elsewhere in the subtree may be
 * suppressed, so it never supported the wider claim. A target that *is* a `PlaceNode` is visited
 * normally: its own children are just its `[key]` segment expressions, which are genuine reads
 * (`:xs[(repcount)] = 5`).
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
  ProgramNode,
} from "./ast.js";
import { childrenOf } from "./ast.js";
import type { CheckProfile } from "./check.js";
import { interactionEventsBlockHeadNames } from "./signatures.js";

/**
 * Where a `repcount` sits, as the walk descends. Deliberately three-valued rather than a boolean:
 * the question "is this inside a `repeat`?" has a third answer, and collapsing it either way is
 * wrong. `outside` and `inside` are the two static answers. `dispatch-dependent` is an
 * event-handler body, whose turn is whatever is on the evaluator's stack when the handler *fires*.
 *
 * Only `outside` reports. `dispatch-dependent` stays silent — but it is a distinct state, not a
 * synonym for `inside`, because a construct nested inside a handler body can still *restore*
 * certainty: a `define … end` body always begins with an empty repeat-turn stack no matter when
 * its caller ran, so a `repcount` there is `outside` again and knowable. A boolean cannot express
 * that, which is exactly the defect this type replaced.
 */
type RepeatContext = "outside" | "inside" | "dispatch-dependent";

/** The Core reporter this rule judges. Compared case-insensitively, as name lookup is. */
const REPCOUNT = "repcount";

/**
 * The event-handler block-head keywords whose block body this rule treats as **opaque** — see the
 * module doc comment. Derived from the parser's single source of truth
 * ({@link interactionEventsBlockHeadNames}) rather than a second hardcoded copy, so a head added
 * by a later slice is covered without an edit here. Same derivation
 * `checker-control-flow.ts` uses, for the same reason. Case-insensitive lookup.
 */
const HANDLER_BLOCK_HEADS: ReadonlySet<string> = new Set(
  interactionEventsBlockHeadNames().map((name) => name.toLowerCase()),
);

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
 * The subtrees of an `Assign`, and whether each may itself be read as a `repcount`. The `value`
 * always may. The `place` may not at its **root** — that root is precisely what `ol-not-a-place`
 * describes — but is still descended into, so a read nested inside it is found. See the module
 * doc comment's read-versus-place section.
 */
function assignChildren(
  node: AssignNode,
): readonly { readonly node: AnyNode; readonly rootIsRead: boolean }[] {
  return [
    { node: node.place, rootIsRead: false },
    { node: node.value, rootIsRead: true },
  ];
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

  /**
   * `rootIsRead` is `false` only for the root of an assignment target; it never propagates to
   * children, so a read nested inside a malformed target is still found.
   */
  const visit = (
    node: AnyNode,
    context: RepeatContext,
    rootIsRead = true,
  ): void => {
    if (rootIsRead && isRepcountRead(node) && context === "outside") {
      diagnostics.push(repcountOutsideRepeatDiagnostic(node));
      return;
    }
    switch (node.kind) {
      case "Repeat": {
        visit(node.count, context);
        visit(node.body, "inside");
        return;
      }
      case "ProcedureDef": {
        // A callee's repeat-turn stack always starts empty, whenever and however it is called, so
        // a procedure body is `outside` from EVERY state — including `dispatch-dependent`. That is
        // what keeps a `define` nested in a handler body statically knowable.
        for (const child of childrenOf(node)) {
          visit(child, "outside");
        }
        return;
      }
      case "Assign": {
        for (const child of assignChildren(node)) {
          visit(child.node, context, child.rootIsRead);
        }
        return;
      }
      case "ProfileStatement": {
        // An event-handler body is `dispatch-dependent`: its `repcount` resolves against the
        // repeat stack at DISPATCH time, which no static walk can know. It is still TRAVERSED, so
        // a construct inside it that restores certainty (a `define … end` body) is judged. The
        // head arguments are ordinary expressions in the enclosing context. A non-handler
        // ProfileStatement, or one with no block, walks its children unchanged.
        if (
          node.body !== undefined &&
          HANDLER_BLOCK_HEADS.has(node.keyword.name.toLowerCase())
        ) {
          for (const arg of node.args) {
            visit(arg, context);
          }
          visit(node.body, "dispatch-dependent");
          return;
        }
        for (const child of childrenOf(node)) {
          visit(child, context);
        }
        return;
      }
      default: {
        for (const child of childrenOf(node)) {
          visit(child, context);
        }
      }
    }
  };

  visit(program, "outside");
  return diagnostics;
}
