/**
 * Source spans — the fundamental source-location contract shared by the AST
 * (`@openlogo/parser`), the trace/event stream, and diagnostics.
 *
 * It lives in `@openlogo/core` (which depends on nothing) so every downstream
 * package can reference one span type without a dependency cycle
 * (`docs/architecture.md` §4). A span is inert data: no behavior lives here.
 *
 * The spec requires a diagnostic's source location to identify at least a source
 * document plus a line/column range (`spec/error-model.md`, `spec/tooling.md`).
 */

/**
 * A 1-based position in a source document. Line 1, column 1 is the first
 * character, matching the spec's diagnostic examples.
 */
export interface Position {
  /** 1-based line number. */
  readonly line: number;
  /** 1-based column number (in Unicode scalar values). */
  readonly column: number;
}

/**
 * A half-open range within a single source document: `start` is inclusive and
 * `end` is exclusive, per the error model's "half-open character range". Spans
 * should point at the most local repair site, not the whole file.
 */
export interface SourceSpan {
  /** The source document URI or path, e.g. `"main.logo"`. */
  readonly document: string;
  /** First position of the range (inclusive). */
  readonly start: Position;
  /** Position just past the range (exclusive). */
  readonly end: Position;
}
