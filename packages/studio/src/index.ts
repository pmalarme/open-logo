/**
 * `@openlogo/studio` — the browser learner IDE: editor/REPL, Canvas turtle view, run/stop/step,
 * diagnostics UI, tooling/LSP, the lesson pane, and persistence. Composes every other package;
 * it never reimplements them. Depends on core, parser, runtime, turtle, and edu.
 *
 * ```ts
 * import * as OL from "@openlogo/studio";
 * ```
 *
 * #123 established the two seams every later pane builds on:
 * - {@link createStudioState} — the **single** state model (source, selection, run status,
 *   diagnostics, lesson context, notice). See `state-model.ts` for the full shape + update contract.
 * - {@link createAppShell} — the composable app shell (a region registry) that later panes
 *   (#124 editor, #125 diagnostics, #126 run/stop, #127 lesson, #128 persistence, #129 a11y)
 *   mount into. See `app-shell.ts`.
 *
 * #124 adds the first pane, the headless editor controller:
 * - {@link createEditorController} — editing operations (`insertText`/`deleteBackward`/
 *   `deleteForward`/`setText`/`setSelection`) that read/write straight through the shared state
 *   model, plus a pluggable {@link HighlightProvider} seam (default: {@link noopHighlighter},
 *   plain text — no hard dependency on the epic #118 highlighter). See `editor.ts`.
 * - {@link mountEditorPane} composes the controller into the shell's `editor` region.
 *
 * #126 adds Run/Stop/Reset/Step over `@openlogo/runtime`'s execution budget (issue #102):
 * - {@link createRunController} — `run()` executes the shared `source` via `@openlogo/runtime`'s
 *   `execute()` (composing it, never re-implementing evaluation) and reduces its trace-event
 *   stream to the shared `output`/`diagnostics` fields; `stop()` flips a cancellation signal
 *   `run()` honors on its next call (see `run-controller.ts`'s doc comment for the honest
 *   same-thread caveat this relies on the instruction budget to cover); `reset()` clears
 *   output/diagnostics and re-arms cancellation deterministically; `step()` is a documented
 *   no-op — `execute()` exposes no per-instruction pause/resume API to step through yet.
 * - {@link mountRunController} composes the controller into the shell's `repl` region.
 *
 * #128 adds persistence — the document text survives a reload:
 * - {@link attachPersistence} restores `source` from a pluggable {@link StorageAdapter} once at
 *   creation, then re-saves it on every change, always through the shared state model (no forked
 *   copy). Failures (quota exceeded, storage disabled, adapter throws) degrade gracefully: a
 *   visible {@link Notice} is set on the store instead of crashing or silently losing work.
 * - {@link createInMemoryStorageAdapter} is the default, fully `node:test`-able backend; a real
 *   `localStorage`-backed adapter plugs into the same interface later. See `persistence.ts`.
 *
 * No diagnostics-rendering/lesson UI lands yet — those are #125/#127.
 */

export type {
  LessonContext,
  Notice,
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

export type {
  EditorController,
  EditorControllerOptions,
  HighlightProvider,
  HighlightToken,
} from "./editor.js";
export {
  createEditorController,
  mountEditorPane,
  noopHighlighter,
} from "./editor.js";

export type { RunController, RunControllerOptions } from "./run-controller.js";
export {
  DEFAULT_RUN_DOCUMENT,
  createRunController,
  mountRunController,
} from "./run-controller.js";

export type {
  Persistence,
  PersistenceOptions,
  StorageAdapter,
} from "./persistence.js";
export {
  attachPersistence,
  createInMemoryStorageAdapter,
  DEFAULT_PERSISTENCE_KEY,
} from "./persistence.js";
