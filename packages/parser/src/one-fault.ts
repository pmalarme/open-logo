/**
 * *One fault, one diagnostic* — `spec/execution-model.md:737-781`'s **precedence** half, applied
 * across Layer 1's and Layer 2's collections once they have been merged (issue #815).
 *
 * The de-duplication half lives in `@openlogo/core` ({@link dedupeDiagnostics}), because it needs
 * nothing but the findings themselves. Precedence needs the **program**, so it lives here.
 *
 * ## The fault it removes
 *
 * ```text
 * fowad 100
 * ```
 *
 * An unresolvable callable has unknown arity, so the reader gives `100` no grammatical home: it
 * ends the `fowad` statement and reads `100` as a statement of its own, which on the same line is a
 * run-on and raises `ol-bad-token`. That token is not the fault, and the spec says so outright —
 * the run MUST report `ol-unknown-command` with `name: "fowad"` and "MUST NOT report
 * `ol-bad-token` with `text: "100"` in its place or beside it" (`spec/execution-model.md:755-766`).
 * `spec/error-model.md:110` carries the same rule from `ol-bad-token`'s own side of the registry.
 *
 * ## The boundary, which is narrow in both directions
 *
 * Only a token whose **only** fault is following an unresolvable callee is suppressed
 * (`spec/execution-model.md:768-777`). Two things follow, and both are pinned by fixtures:
 *
 * - **An independent fault is still reported.** `fowad 100 ]` keeps its `ol-unmatched-bracket`,
 *   "because that bracket is wrong whatever the callee turns out to be"; `fowad @@@` keeps the
 *   lexer's own `ol-bad-token`s, because those characters are not OpenLogo tokens at all.
 * - **A resolvable callee is untouched.** `forward 100 200`, and `f 1 2` for a one-parameter `f`,
 *   still raise `ol-bad-token`: the callee resolves, its arity is known, so the extra argument is a
 *   genuine finding.
 *
 * ## How an orphan is recognised, and why it is derived rather than described
 *
 * The suppression is keyed off the `ol-unknown-command` findings the semantic layer **actually
 * produced**, not off a second opinion about which names resolve. That matters because the answer
 * is profile-dependent — `spec/execution-model.md:761-765` requires `fowad 100` to report
 * `suggestion: "forward"` under a set including Turtle & Rendering and no suggestion under Core
 * Language alone — and a rule that recomputed visibility here could disagree with the rule that
 * reported it.
 *
 * The AST does the rest. A statement the reader could not attach to the preceding call becomes a
 * statement of its own in the very same statement list, so `fowad 100` reads as
 * `[Call(fowad), NumberLit(100)]` (measured). An **orphan** is therefore a statement whose
 * predecessor in its list is either an unresolvable call or itself an orphan — the chain is what
 * covers `fowad 100 200` — and which begins on the line its predecessor ended on, which is exactly
 * the run-on condition the reader used to raise the finding. A parse `ol-bad-token` starting where
 * an orphan starts is that orphan's own diagnostic, and nothing else is touched.
 */

import type { Diagnostic, SourceSpan } from "@openlogo/core";
import { dedupeDiagnostics } from "@openlogo/core";
import type { AnyNode, ProgramNode, StatementNode } from "./ast.js";
import { isExpressionKind, walk } from "./ast.js";

/**
 * The callee spans of every `ol-unknown-command` finding in `diagnostics`, as `"line:column"` keys.
 * `checker-unknown-command.ts` reports at the callee's own span, and a **bare** `Call` node starts
 * at its callee, so such a call is unresolvable exactly when its span **start** is in this set.
 *
 * A `ParenCall` does NOT: `(fowad 100)` spans from the `(` at `1:1` while its callee is at `1:2`,
 * so its start is never in this set. That is why {@link endsInUnresolvableCall} matches `Call`
 * only — and it is the right answer for a reason beyond the span arithmetic. The suppression's
 * rationale (`spec/execution-model.md:759-766`) is that a token following a callee nothing resolves
 * *might* have been its argument, which cannot be judged because the callee's arity is unknown. A
 * parenthesized call has its arguments **delimited by the parentheses**, so a token after the `)` is
 * independent whatever the callee is: `(fowad 100) 5` keeps its `ol-bad-token`, exactly as
 * `(forward 100) 5` does.
 *
 * An earlier version of this comment claimed a `ParenCall` "starts at its callee" and matched on it
 * accordingly. Measured, that arm was structurally dead — 144 `Call` matches across the corpus and
 * **zero** `ParenCall` — so the behaviour was right by accident, and would have come alive as a
 * silent over-suppression the day `checker-unknown-command` reported at the node span instead.
 */
/**
 * A position key that includes the **document**.
 *
 * Dropping it silently suppressed a valid `ol-bad-token` from one source because a *different*
 * source happened to carry an orphan at the same line and column — demonstrated, not inferred, and
 * a supported input shape rather than a hypothetical: `applyOneFaultRules` is exported precisely so
 * a caller assembling findings across documents can apply it (`index.ts`), and
 * `spec/error-model.md:126` says either span of `ol-duplicate-definition` "MAY name a different source document, so an imported module's declaration is an ordinary case".
 *
 * `@openlogo/core`'s `faultIdentity` already keys de-duplication on the document; this is the
 * precedence half of *one fault, one diagnostic* agreeing with it.
 */
function positionKey(span: SourceSpan): string {
  const [line, column] = span.start;
  return `${span.document}\u0000${line}:${column}`;
}

function unresolvableCalleeStarts(
  diagnostics: readonly Diagnostic[],
): ReadonlySet<string> {
  const starts = new Set<string>();
  for (const diagnostic of diagnostics) {
    if (diagnostic.code === "ol-unknown-command") {
      starts.add(positionKey(diagnostic.source_span));
    }
  }
  return starts;
}

/** Whether `statement` ENDS in a call whose callee nothing in the program resolves. */
function endsInUnresolvableCall(
  statement: StatementNode,
  unresolvable: ReadonlySet<string>,
): boolean {
  // The reader gives an orphan token no home because the call it follows has unknown arity — and
  // that call is the LAST thing in the preceding statement, not necessarily the whole of it.
  // `fowad 100` makes the unresolvable call the entire statement, but `:x = fowad 100`,
  // `print fowad 100` and `p fowad 100` each bury it one level down, and the orphaned `100` is
  // exactly as blameless there. So the test is on the statement's trailing sub-expression: any
  // unresolvable call that finishes where the statement finishes.
  let found = false;
  walk(statement, (node) => {
    if (found || node.kind !== "Call") {
      return;
    }
    if (!unresolvable.has(positionKey(node.source_span))) {
      return;
    }
    found =
      node.source_span.end[0] === statement.source_span.end[0] &&
      node.source_span.end[1] === statement.source_span.end[1];
  });
  return found;
}

/**
 * The start positions of every **orphan** statement: one the reader could only read as a statement
 * of its own because the call before it, on the same line, had unknown arity. See the module doc
 * comment for why an orphan is a statement-list neighbour rather than a token offset.
 */
/**
 * Could `statement` have been read as an ARGUMENT to the call before it?
 *
 * The suppression is bounded by the word *only*: a token is spared exactly when its only fault is
 * following a callee nothing resolves (`spec/execution-model.md:768-770`). A statement-only form —
 * `if`, an assignment, a `define` — could never have been an argument expression whatever the
 * callee turned out to be, so its `ol-bad-token` is an independent fault and is still reported, for
 * the same reason `spec/execution-model.md:771-773` keeps the unmatched `]` in `fowad 100 ]`.
 *
 * **Derived, never listed.** This was a hand-written set, and it named five kinds this AST has
 * never had while missing three it does — so `fowad [1][1]`, `fowad 1 < 2 < 3` and
 * `fowad [] is empty` each kept a token that IS a valid argument. The direction matters as much as
 * the derivation: a *missing* entry here only over-reports, but a *wrong* entry suppresses a real
 * diagnostic silently, so this list must be closed by the type system rather than by memory.
 * {@link isExpressionKind} is exhaustiveness-checked against the `ExpressionNode` union itself.
 */
function couldBeAnArgument(statement: StatementNode): boolean {
  return isExpressionKind(statement.kind);
}

function orphanStarts(
  program: ProgramNode,
  unresolvable: ReadonlySet<string>,
): ReadonlySet<string> {
  const starts = new Set<string>();
  const scanList = (body: readonly StatementNode[]): void => {
    let previous: StatementNode | undefined;
    let previousWasOrphan = false;
    for (const statement of body) {
      const orphaned: boolean =
        previous !== undefined &&
        (previousWasOrphan || endsInUnresolvableCall(previous, unresolvable)) &&
        // Same document, then same line. Comparing lines alone let a statement from one source be
        // called the orphan of a call in another when both happened to sit on line 1 — the same
        // defect `positionKey` fixes for the keys, on the axis the keys do not reach.
        statement.source_span.document === previous.source_span.document &&
        statement.source_span.start[0] === previous.source_span.end[0] &&
        couldBeAnArgument(statement);
      if (orphaned) {
        starts.add(positionKey(statement.source_span));
      }
      previousWasOrphan = orphaned;
      previous = statement;
    }
  };
  walk(program, (node: AnyNode) => {
    if (node.kind === "Program" || node.kind === "Block") {
      scanList(node.body);
    }
  });
  return starts;
}

/**
 * Apply both halves of *one fault, one diagnostic* to the merged Layer 1 + Layer 2 findings for
 * `program`: de-duplicate by fault identity, then drop each `ol-bad-token` whose only fault is that
 * it follows a callable name nothing in the program resolves.
 *
 * The input order is preserved, so the reader still sees findings in source-and-layer order.
 */
export function applyOneFaultRules(
  program: ProgramNode,
  diagnostics: readonly Diagnostic[],
): readonly Diagnostic[] {
  const deduped = dedupeDiagnostics(diagnostics);
  const unresolvable = unresolvableCalleeStarts(deduped);
  if (unresolvable.size === 0) {
    return deduped;
  }
  const orphans = orphanStarts(program, unresolvable);
  if (orphans.size === 0) {
    return deduped;
  }
  return deduped.filter((diagnostic) => {
    if (diagnostic.code !== "ol-bad-token") {
      return true;
    }
    return !orphans.has(positionKey(diagnostic.source_span));
  });
}
