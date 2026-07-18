/**
 * `@openlogo/runtime` — evaluator, scoping, procedures, control forms, comprehensions,
 * places/mutation, equality, and the cancellable execution budget. Depends on `@openlogo/core`
 * and `@openlogo/parser`.
 *
 * {@link execute} is the minimal foundational execution entry point (issue #90): it parses a
 * source document and walks the program's top-level statements, emitting one `instruction`
 * start event per statement (`spec/execution-model.md:559-600` — the `instruction` event is
 * the unit of "one step"). It deliberately implements **no evaluation semantics** — no
 * arithmetic, variables, control flow, procedures, comprehensions, or `print`. Those land one
 * vertical slice at a time (issues #93-#105), each extending this spine with more event kinds
 * and, where the spec calls for it, runtime `ol-*` diagnostics.
 */

import type { Diagnostic, TraceEvent } from "@openlogo/core";
import { parse } from "@openlogo/parser";

/** Marker export so the M0 skeleton is a real ES module; kept alongside the real exports. */
export const RUNTIME_PACKAGE = "@openlogo/runtime";

/**
 * Payload for the generic `instruction` start event this M0 spine emits: the AST node kind of
 * the top-level statement about to run. Refined per-statement payload shapes (e.g. the callee
 * name for a `Call`) are added by the evaluator slice that gives that statement kind meaning.
 */
export interface InstructionPayload {
  readonly statement_kind: string;
}

/** The result of {@link execute}: the ordered trace/event stream plus any diagnostic. */
export interface ExecuteResult {
  readonly events: readonly TraceEvent[];
  readonly diagnostics: readonly Diagnostic[];
}

/**
 * Parse `source` and execute its top-level statements, emitting one `instruction` event per
 * statement with a monotonic `seq` starting at 0. If parsing produced any diagnostic the
 * program is not execution-valid, so no events are emitted and the parse diagnostics are
 * returned unchanged — future slices that raise diagnostics mid-execution extend this function,
 * not replace it.
 */
export function execute(source: string, document: string): ExecuteResult {
  const { ast: program, diagnostics } = parse(source, document);
  if (diagnostics.length > 0) {
    return { events: [], diagnostics };
  }

  const events: TraceEvent[] = program.body.map((statement, index) => ({
    seq: index,
    kind: "instruction",
    source_span: statement.source_span,
    payload: { statement_kind: statement.kind } satisfies InstructionPayload,
  }));

  return { events, diagnostics };
}
