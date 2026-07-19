/**
 * `@openlogo/studio` — the browser learner IDE: editor/REPL, Canvas turtle view, run/stop/step,
 * diagnostics UI, tooling/LSP, the lesson pane, and persistence. Composes every other package;
 * it never reimplements them. Depends on core, parser, runtime, turtle, and edu.
 *
 * ```ts
 * import * as OL from "@openlogo/studio";
 * ```
 *
 * This slice (#123) establishes the two seams every later pane builds on:
 * - {@link createStudioState} — the **single** state model (source, selection, run status,
 *   diagnostics, lesson context). See `state-model.ts` for the full shape + update contract.
 * - {@link createAppShell} — the composable app shell (a region registry) that later panes
 *   (#124 editor, #125 diagnostics, #126 run/stop, #127 lesson, #128 persistence, #129 a11y)
 *   mount into. See `app-shell.ts`.
 *
 * No run/diagnostics-rendering/lesson behavior lands yet — this slice only proves the shell
 * renders, holds one shared state instance, and is composable.
 */

export type {
  LessonContext,
  RunStatus,
  Selection,
  StudioState,
  StudioStateListener,
  StudioStateStore,
  Unsubscribe,
} from "./state-model.js";
export { createStudioState } from "./state-model.js";

export type { AppShell, RegionName, RegionState } from "./app-shell.js";
export { APP_SHELL_REGIONS, createAppShell } from "./app-shell.js";
