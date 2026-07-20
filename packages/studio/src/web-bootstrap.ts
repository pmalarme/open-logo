/**
 * Headless glue for the browser entry (`web/main.ts`, issue #277). Everything a real DOM host
 * needs beyond composing the published `@openlogo/studio` controllers verbatim lives here, so it
 * stays `node:test`-able and inside the 100% coverage gate — `web/main.ts` itself is a thin,
 * logic-free wiring layer that only touches `document`/`window` and is never imported by a test
 * (per this package's `tsconfig.json`, `web/**` is outside the `src` build graph and this monorepo
 * has no `lib.dom`), so any real logic must live here instead.
 */

import type { Diagnostic } from "@openlogo/core";
import { toDiagnosticsView } from "./diagnostics.js";

/**
 * The program the editor boots with — the canonical acceptance square from issue #277 and the
 * root README ("Try a program"). Kept as a named constant so both the browser entry and this
 * module's tests assert the exact same string.
 */
export const DEFAULT_RUN_PROGRAM = "repeat 4 [ forward 100 right 90 ]";

/**
 * Render the current diagnostics list as one learner-visible line per diagnostic, or a fixed
 * "no diagnostics" message when the list is empty. This is deliberately the simplest possible
 * summary — a full diagnostics list pane (with source spans, did-you-mean, etc.) is #278 (epic
 * #276's slice 2); this slice only needs a Run on a bad program to surface *something* instead of
 * silently doing nothing or crashing the page (issue #277's third acceptance criterion). Built
 * from {@link toDiagnosticsView}'s structured fields only, never by re-deriving diagnostic
 * identity from `message` prose.
 */
export function formatDiagnosticsSummary(
  diagnostics: readonly Diagnostic[],
): string {
  const view = toDiagnosticsView(diagnostics);
  if (view.isEmpty) {
    return "No diagnostics.";
  }
  return view.items
    .map((item) => `${item.code} (${item.severity}): ${item.message}`)
    .join("\n");
}
