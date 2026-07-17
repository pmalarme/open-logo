/**
 * Source spans — the shared location primitive that AST nodes, diagnostics, and trace
 * events all carry. It lives in `@openlogo/core` because core sits at the bottom of the
 * dependency DAG, so `parser`, `runtime`, and `turtle` can all reuse one definition.
 *
 * A span identifies a source document plus a half-open `[start, end)` range, expressed as
 * 1-based `[line, column]` positions — the normative requirement from
 * [`spec/error-model.md`](../../../spec/error-model.md) (`source_span`) and the
 * `interpreter/ast-design` skill.
 */

/** A 1-based `[line, column]` position in a source document. */
export type Position = readonly [line: number, column: number];

/**
 * The source location that best explains an AST node, diagnostic, or event. `start` is
 * inclusive and `end` is exclusive (a half-open range), matching the diagnostic model.
 */
export interface SourceSpan {
  /** The source document the span points into (e.g. a file name or REPL id). */
  readonly document: string;
  /** Inclusive start position. */
  readonly start: Position;
  /** Exclusive end position (half-open range). */
  readonly end: Position;
}

/** Construct a {@link SourceSpan}. */
export function makeSpan(
  document: string,
  start: Position,
  end: Position,
): SourceSpan {
  return { document, start, end };
}
