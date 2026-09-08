/**
 * The Layer-2 lexical-enclosure rule for `repcount` (issue #1097) — one semantic diagnostic,
 * `ol-repcount-outside-repeat`, at `stage: "semantic"` with the identity `@openlogo/core` registers
 * and the `params: none` `spec/error-model.md:120` declares.
 *
 * `spec/tooling.md:195` states the rule for this layer in one line: *"Decide enclosure lexically: a
 * procedure body is never inside its caller's `repeat`, and a handler block is never inside a
 * `repeat` written outside it, so `repcount` in either is an error even when a `repeat` is running.
 * A `repeat` written inside the handler block encloses normally."* `spec/execution-model.md:671-690`
 * is the normative ruling behind it and closes with the sentence that is the whole difficulty of
 * this rule: **"Lexical enclosure is therefore necessary but not sufficient: it must be enclosure by
 * a `repeat` whose body the code runs as part of."**
 *
 * So this rule is deliberately *not* "is there a `Repeat` above me in the AST". It threads a single
 * piece of lexical context — is this position on a turn of some `repeat`? — and **resets it to
 * `false` at the two boundaries the spec names**:
 *
 * - a `define … end` **procedure body** (`spec/execution-model.md:673-678`) — "dynamic loop state
 *   does not cross the procedure boundary any more than a variable does";
 * - a **handler block** (`spec/execution-model.md:682-688`) — a handler invocation "is a separate,
 *   deferred instruction rather than part of the loop that registered it", so the enclosing
 *   `repeat` does not reach into it "however the loop is placed and whether or not it has finished".
 *
 * Everything else inherits the enclosing answer, which is what makes the two clean cases clean
 * without enumerating them: `if`, `while`, `for`, `forever`, a comprehension body, and a Sprites
 * `ask`/`tell`/`each` block all "run as part of the statement that contains it"
 * (`spec/execution-model.md:664-667`), and the Sprites forms are called out again at
 * `spec/execution-model.md:678-680` as carrying dynamic *turtle* state rather than a name binding,
 * so they are "unaffected by this rule". A node kind added later therefore inherits the right
 * answer instead of needing an entry here.
 *
 * **Only `repeat` encloses.** `forever` runs a block without a turn number, and
 * `spec/commands.md:804` ties `repcount` to "the innermost `repeat`". Measured against the runtime
 * before this rule existed: `forever [ print repcount ]` raises `ol-repcount-outside-repeat`, so
 * treating `forever` as an enclosing loop here would have made the checker disagree with the
 * evaluator.
 *
 * **A `repeat`'s own count expression is *not* inside its body.** `repeat 2 [ repeat repcount [ … ] ]`
 * reads the OUTER loop's turn — measured: it prints three times, once for turn 1 and twice for
 * turn 2 — so `count` is visited in the enclosing context and only `body` gets the fresh `true`.
 *
 * ## What it does NOT report, and why
 *
 * `spec/tooling.md:199-200` forbids speculative reports, and a checker that cries wolf teaches
 * learners to ignore it. Two deliberate silences:
 *
 * - A `repcount` written inside a procedure that is **never called** is still reported. That is not
 *   speculative: enclosure is a purely lexical property of where the word is written, decidable
 *   without any execution order, and no call site can supply an enclosing `repeat` — that is
 *   precisely the ruling. This is the case the static stage adds most value on, since the runtime
 *   never reaches an uncalled body at all.
 * - A program that **declares its own `repcount`** is left alone ({@link collectDeclaredNames}).
 *   Such a declaration is already rejected — `repcount` is a built-in name, so `define repcount …`
 *   raises `ol-reserved-word` — and the runtime's own dispatch lets a same-named user procedure
 *   shadow the primitive, so the call sites are not reads of the reporter at all. Reporting them
 *   here would cascade a second, unrelated code across every call of an already-diagnosed name.
 * - A `repcount` in the **target** of an `=`/`set`/`make` (`repcount = 100`) is a write position,
 *   not a read; `checker-not-a-place.ts` already reports `ol-not-a-place` there, and the evaluator
 *   never runs the reporter. Same cascade, same silence — found by
 *   `tests/conformance/core-language/assignment/bare-place-invalid`, which uses exactly that program
 *   to pin `ol-not-a-place` and went red when this rule first double-reported it.
 */

import type { Diagnostic } from "@openlogo/core";
import type {
  AnyNode,
  BlockNode,
  CallNode,
  ParenCallNode,
  ProfileStatementNode,
  ProgramNode,
} from "./ast.js";
import { childrenOf } from "./ast.js";
import { HANDLER_BLOCK_HEADS } from "./checker-control-flow.js";
import { collectDeclaredNames } from "./checker-names.js";

/** The Core reporter this rule judges, lowercased (identifiers are case-insensitive). */
const REPCOUNT = "repcount";

/**
 * The learner-facing prose, **identical to the sentence `@openlogo/runtime`'s
 * `repcountOutsideRepeat` already raises**. One code carries one lesson: a learner who meets
 * `ol-repcount-outside-repeat` from the editor before running and then again from a run must not be
 * taught two different things by the two stages. It says both halves `spec/error-model.md:120` asks
 * for — what `repcount` reports, and that it only has meaning inside a `repeat`. Prose is
 * presentation; identity is `code` + `params`, and the params are `none`.
 */
const MESSAGE =
  "repcount only reports a turn number inside a repeat loop — there is no enclosing repeat here.";

/** Is this call a read of the Core `repcount` reporter? */
function isRepcountCall(node: CallNode | ParenCallNode): boolean {
  return node.callee.name.toLowerCase() === REPCOUNT;
}

function outsideRepeatDiagnostic(node: CallNode | ParenCallNode): Diagnostic {
  return {
    code: "ol-repcount-outside-repeat",
    source_span: node.source_span,
    params: {},
    message: MESSAGE,
    stage: "semantic",
    severity: "error",
  };
}

/**
 * Does `node` open a **handler block** — a body whose invocation is deferred and therefore is never
 * on a turn of a `repeat` written outside it? Derived from the same
 * {@link HANDLER_BLOCK_HEADS} set `checker-control-flow.ts` uses for the sibling boundary rule
 * (`return`/`stop` inside a handler is outside any procedure), so both Layer-2 boundary rules read
 * one definition of "handler block" and a head added to the Interaction & Events registry reaches
 * both without an edit.
 */
function isHandlerBlock(
  node: AnyNode,
): node is ProfileStatementNode & { readonly body: BlockNode } {
  return (
    node.kind === "ProfileStatement" &&
    node.body !== undefined &&
    HANDLER_BLOCK_HEADS.has(node.keyword.name.toLowerCase())
  );
}

/**
 * `ol-repcount-outside-repeat` for every `repcount` read with no *qualifying* lexically enclosing
 * `repeat`, in source order. Takes no profile set: `repcount` and `repeat` are both Core
 * (`spec/conformance.md`'s Core Language profile), and where a word is written is a property of the
 * grammar rather than of the profiles a run claims — the same argument
 * `checker-global-placement.ts` and `checker-reserved-word.ts` make for their own rules.
 */
export function repcountRule(program: ProgramNode): readonly Diagnostic[] {
  if (collectDeclaredNames(program).has(REPCOUNT)) {
    return [];
  }
  const diagnostics: Diagnostic[] = [];

  const visit = (node: AnyNode, onARepeatTurn: boolean): void => {
    if (
      (node.kind === "Call" || node.kind === "ParenCall") &&
      isRepcountCall(node)
    ) {
      if (!onARepeatTurn) {
        diagnostics.push(outsideRepeatDiagnostic(node));
      }
      // `repcount` takes no arguments, but a mis-written call may still carry some — walk them in
      // the same context rather than dropping a subtree the rule would otherwise have judged.
      for (const argument of node.args) {
        visit(argument, onARepeatTurn);
      }
      return;
    }
    if (node.kind === "Repeat") {
      // The count is evaluated where the `repeat` is *written*, so it sees the enclosing answer;
      // only the body is on a turn of this loop.
      visit(node.count, onARepeatTurn);
      visit(node.body, true);
      return;
    }
    if (node.kind === "Assign") {
      // `repcount = 100` is a WRITE position, not a read: `checker-not-a-place.ts` already rules an
      // `=`/`set`/`make` target that is not a place, and the runtime never evaluates the reporter
      // there at all. Judging it again as an unenclosed read would cascade a second, misleading
      // code onto one defect — the same conservatism `spec/tooling.md:199-200` asks for, and the
      // same reason a program declaring its own `repcount` is left to `ol-reserved-word` above.
      // Only the target's own head is exempt: its subtree is still walked, because a target can
      // genuinely *read* the reporter — measured, `:cells[(repcount)] = 9` and
      // `(item repcount [1 2]) = 5` both do, and both still report. (A bare `:cells[repcount]` does
      // not: a bare word in a `[ ]` key position is a literal key, not a call.)
      const target = node.place;
      if (
        (target.kind === "Call" || target.kind === "ParenCall") &&
        isRepcountCall(target)
      ) {
        for (const argument of target.args) {
          visit(argument, onARepeatTurn);
        }
      } else {
        visit(target, onARepeatTurn);
      }
      visit(node.value, onARepeatTurn);
      return;
    }
    if (node.kind === "ProcedureDef") {
      // The whole declaration is sealed, parameter defaults included — measured: a default written
      // `define f (:n repcount)` raises even when `f` is called from inside a live `repeat`.
      for (const child of childrenOf(node)) {
        visit(child, false);
      }
      return;
    }
    if (isHandlerBlock(node)) {
      // Only the BODY is deferred. A handler head's arguments (`every 5`, `on_key "a"`) are
      // ordinary expressions evaluated where the registration is written, exactly like a `repeat`'s
      // count — measured: `repeat 2 [ every repcount [ … ] ]` runs clean and reads the outer turn.
      for (const argument of node.args) {
        visit(argument, onARepeatTurn);
      }
      visit(node.body, false);
      return;
    }
    for (const child of childrenOf(node)) {
      visit(child, onARepeatTurn);
    }
  };

  visit(program, false);
  return diagnostics;
}
