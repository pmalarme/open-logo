/**
 * AST-derived code-folding ranges (#315) — the grammar-aware alternative to naive `[ … ]`/
 * `… end` text-bracket-matching that `docs/adr/0013-studio-editor-component.md`'s rubber-duck
 * review found unsafe: OpenLogo's `[ … ]` delimiter is reused for list literals, `for`/`struct`
 * pattern and field-list binders, and selector indices (`@openlogo/parser`'s `highlight.ts` calls
 * these bracket *roles* — see `OL_BRACKET_ROLES`), none of which should ever fold. Matching
 * brackets by character alone cannot tell those apart from an actual instruction block, and would
 * also wrongly fold brackets written inside a comment or a string literal.
 *
 * Instead, this module folds exactly the block-bearing AST nodes the grammar defines: `If`
 * (`thenBody`/`elseBody`), `While`, `Repeat`, `Forever`, `ForIn`, `ForRange`, `Comprehension`, and
 * `ProcedureDef` all carry a `body: BlockNode` (`@openlogo/parser`'s `ast.ts`) whose own
 * `source_span` is the range to fold — the exact same span `highlight.ts` uses to mark that
 * node's own bracket pair as the `"instruction-block"` role, uniformly whether the source spelled
 * the block as `[ … ]` or `define … end` (`highlight.ts`'s `markBracketPair(node.body.source_span,
 * "instruction-block")` call is unconditional on delimiter spelling). One AST-based rule therefore
 * folds both surface syntaxes correctly without a separate code path for either.
 *
 * `parse` never throws (`@openlogo/parser`'s own contract): malformed source (e.g. an unterminated
 * `[` or a missing `end`) still yields a best-effort AST via error recovery, but that recovered
 * AST's block `source_span`s cannot be trusted to end where they claim — a recovered block often
 * spans all the way to end-of-source. So {@link computeFoldRanges} checks `parse`'s own
 * `diagnostics` first: if any has `severity: "error"`, it returns no folds at all for that parse
 * rather than guessing a fold boundary from an error-recovered span. This is the module's only
 * "unparseable" branch, and it is document-wide (not per-block) because a parse error's recovery
 * can reshape spans anywhere in the tree, not only inside the block nearest the error.
 *
 * Each range's end is the block's own `source_span.end` (the `]` or `end`), but its start is
 * adjusted by {@link foldStartFor} so the fold gutter's icon lands on the block's HEADER line —
 * `while :x < 10`, `else`, `define f`, the `repeat 4 [` line itself — rather than the body's first
 * token, matching how editors conventionally place a fold marker on the line that opens a block.
 */

import { parse, walk } from "@openlogo/parser";
import type { AnyNode, BlockNode } from "@openlogo/parser";
import type { Position } from "@openlogo/core";

/** One foldable range of source text, as 0-based UTF-16 code-unit offsets (half-open `[start, end)`). */
export interface FoldRange {
  readonly start: number;
  readonly end: number;
}

/** Convert a 1-based `[line, column]` {@link Position} into a 0-based string offset into `source`. */
function offsetFromPosition(source: string, position: Position): number {
  const [line, column] = position;
  const priorLines = source.split("\n").slice(0, line - 1);
  const priorLength = priorLines.reduce(
    (sum, priorLine) => sum + priorLine.length + 1,
    0,
  );
  return priorLength + (column - 1);
}

/** The block(s) `node` directly carries as its own body, if any — never a nested descendant's. */
function blockBodiesOf(node: AnyNode): readonly BlockNode[] {
  switch (node.kind) {
    case "If":
      return node.elseBody ? [node.thenBody, node.elseBody] : [node.thenBody];
    case "While":
    case "Repeat":
    case "Forever":
    case "ForIn":
    case "ForRange":
    case "Comprehension":
    case "ProcedureDef":
      return [node.body];
    default:
      return [];
  }
}

/**
 * A block whose own body starts a fresh line (only leading whitespace precedes it on that line —
 * the `… end` long form) folds most usefully starting at the END of the PRECEDING line (the
 * header line: `while :x < 10`, `else`, `define f`, …) rather than at the body's first token —
 * that puts the fold gutter's icon on the header line, collapsing the newline-plus-body-plus-`end`
 * into it, matching how editors conventionally place a fold marker on the line that "opens" a
 * block. A block whose body starts a `[ … ]` bracket on the SAME line as its header (the short
 * form) already has its own opening line, so its body's own start is used as-is.
 */
function foldStartFor(source: string, body: BlockNode): number {
  const bodyStart = offsetFromPosition(source, body.source_span.start);
  const lineStart = source.lastIndexOf("\n", bodyStart - 1) + 1;
  const textBeforeBodyOnItsLine = source.slice(lineStart, bodyStart);
  const bodyStartsAFreshLine =
    lineStart > 0 && /^\s*$/.test(textBeforeBodyOnItsLine);
  return bodyStartsAFreshLine ? lineStart - 1 : bodyStart;
}

/**
 * Compute every foldable range in `source`: one per block-bearing AST node's body, anchored per
 * {@link foldStartFor} and ending at the body's own `source_span.end`, skipping any block that
 * does not itself span a newline (a single-line block has nothing useful to collapse). Returns
 * `[]` (no folds) if `source` has any `severity: "error"` diagnostic — see the module doc comment.
 * Ranges are returned in AST visit order, which for a well-formed program is also source order; a
 * caller that needs a specific order should sort by {@link FoldRange.start}.
 */
export function computeFoldRanges(source: string): readonly FoldRange[] {
  const { ast, diagnostics } = parse(source);
  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    // `parse` never throws — malformed source (e.g. an unterminated `[`/missing `end`) still
    // yields a best-effort recovered AST whose block `source_span`s can't be trusted to end where
    // they claim (a recovered block's span often runs to end-of-source). Never guess a fold from
    // that: ADR-0013 requires no folds for unparseable/malformed input, so this bails out for the
    // WHOLE document rather than trying to isolate which specific block(s) an error touched.
    return [];
  }
  const ranges: FoldRange[] = [];
  walk(ast, (node) => {
    for (const body of blockBodiesOf(node)) {
      const start = foldStartFor(source, body);
      const end = offsetFromPosition(source, body.source_span.end);
      if (start < end && source.slice(start, end).includes("\n")) {
        ranges.push({ start, end });
      }
    }
  });
  return ranges;
}
