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
 * #126 adds Run/Stop/Reset/Step over `@openlogo/runtime`'s execution budget (issue #102) — `step()`
 * is headless-only as of #305 (the `Next step` UI control was removed for 0.1.0; Wave 1/#302
 * rebuilds a UI on it);
 * #228 extends the same controller to replay the completed trace-event stream through
 * `@openlogo/turtle`'s animation player, so the #218 Canvas view moves in lockstep:
 * - {@link createRunController} — `run()` executes the shared `source` via `@openlogo/runtime`'s
 *   `execute()` (composing it, never re-implementing evaluation) and reduces its trace-event
 *   stream to the shared `output`/`diagnostics` fields — this part is unchanged since #126 and
 *   always synchronous/instant. `run()` then (#228) replays that same completed event stream
 *   through a `TurtleAnimationController`, pushing each folded `turtleState`/`turtleScene`
 *   snapshot into the shared state model (and repainting an optional `RunControllerOptions.
 *   canvasView` immediately) as it plays — paced via an injected `RunControllerOptions.scheduler`
 *   (default: `@openlogo/turtle`'s synchronous `IMMEDIATE_SCHEDULER`, which preserves every
 *   pre-#228 test's run-completes-synchronously behavior), or painted instantly via `seekToEnd()`
 *   when `RunControllerOptions.reducedMotion` is set.
 * - `stop()` flips a cancellation signal `run()` honors on its next call (see `run-controller.ts`'s
 *   doc comment for the honest same-thread caveat this relies on the instruction budget to cover)
 *   *and* (#228) pauses the in-progress turtle animation, so the Canvas view freezes at the exact
 *   same point — a stale, already-scheduled tick can never fire afterward and advance it further
 *   (`TurtleAnimationController`'s own guard).
 * - `reset()` clears output/diagnostics and re-arms cancellation deterministically, *and* (#228)
 *   resets the turtle animation and restores `turtleState`/`turtleScene` to `@openlogo/turtle`'s
 *   program-start defaults, repainting the Canvas view if one was supplied.
 * - `step()` — no longer a no-op as of #228: it advances the turtle animation by exactly one
 *   instruction-step and pushes the resulting snapshot (a no-op before the first `run()` or once
 *   the animation is exhausted, since `@openlogo/runtime`'s `execute()` itself still exposes no
 *   per-instruction pause/resume API to step through — #228 steps the *replay*, not the runtime).
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
 * #125 adds the diagnostics pane — one unified rendering path for every diagnostic stage:
 * - {@link createDiagnosticsController} subscribes to the shared store and re-parses `source`
 *   via `@openlogo/parser`'s `parse()` (Layer 1) whenever it changes, publishing the result
 *   through `state.setDiagnostics` so a bad line surfaces at its span without a Run. Semantic
 *   checking (`check()`, epic #108) is available via `semanticCheck: true` but defaults to
 *   `false` — see `diagnostics.ts`'s doc comment for why enabling it today would falsely flag
 *   ordinary turtle programs. Runtime-stage diagnostics (#126's run controller) flow into the
 *   exact same `diagnostics` field, so this is the single surface for every stage.
 * - {@link toDiagnosticsView} is the pure projection from raw `Diagnostic[]` to a rendering
 *   model (`items`/`errorCount`/`warningCount`/`isEmpty`) — it keys off `code`/`severity`/
 *   `stage`/`params` only, never `message` prose (the diagnostic-identity rule).
 * - {@link mountDiagnosticsPane} composes the controller into the shell's `diagnostics` region.
 *
 * #129 adds keyboard + screen-reader accessibility over the REPL loop (editor/run/diagnostics),
 * extended in #229 to the turtle Canvas pane (#218/#228):
 * - {@link REPL_FOCUS_ORDER} is the static, ordered keyboard focus order across every studio pane
 *   (editor → Run/Stop/Reset → Canvas → diagnostics); {@link nextFocusStop}/
 *   {@link previousFocusStop} cycle through it (wrapping both ends), proving there is no keyboard
 *   trap. {@link REPL_LANDMARK_ROLES} declares each pane's container-level ARIA role/label for a
 *   future renderer to map 1:1.
 * - {@link createA11yAnnouncer} subscribes to the shared store and emits a screen-reader
 *   {@link Announcement} whenever `runStatus` or `diagnostics` changes, built from structured
 *   fields only (never `Diagnostic.message` prose). See `a11y.ts`.
 * - {@link createTurtleStateRegion} (#229) is the non-visual turtle-state text region: a single,
 *   always-current `status`/`aria-live="polite"` string over the shared `turtleState` slot,
 *   rendered via `@openlogo/turtle`'s published `describeTurtleState` — never re-derived here —
 *   updating in lockstep with the Canvas view on every run tick, `step()`, and `reset()`.
 *
 * #127 adds the lesson pane, reading `@openlogo/edu`'s read-only `Lesson` contract (#189):
 * - {@link createLessonPaneController} resolves the shared state model's `lesson` context
 *   (`lessonId`/`title`) into a full render-ready {@link LessonPaneView} via a pluggable
 *   {@link LessonLookup} (default: `@openlogo/edu`'s `findLessonById`); degrades to the fixed
 *   {@link NO_LESSON_VIEW} (`isVisible: false`) both in freeform/sandbox mode and for a stale/
 *   unresolvable `lessonId`, so `web/main.ts` never has to branch before reading a field. See
 *   `lesson-pane.ts`.
 * - {@link mountLessonPane} composes the controller into the shell's `lesson` region. This slice
 *   also gives `#lesson-pane` its accessibility landmark and keyboard focus stop — see
 *   `a11y.ts`'s `REPL_LANDMARK_ROLES`/`REPL_FOCUS_ORDER`.
 * - M3's enrichment refined the layout/a11y delta in `web/styles.css`/`index.html`: the lesson
 *   pane is a `complementary` landmark (not the generic `region`), stays its own leftmost column
 *   ahead of editor/turtle, collapses to zero width/height entirely when `hidden`
 *   (freeform/sandbox — a clean `editor | canvas` two-region layout), sizes to a ~300px starting
 *   column that collapses toward zero before editor/turtle are squeezed below their own minimums,
 *   and scrolls its own content independently of the editor/canvas below it.
 *
 * #218 adds the turtle Canvas view — static composition of `@openlogo/turtle`'s DOM-free renderer
 * into the app shell (the dynamic run-loop repaint is #228, above):
 * - `state-model.ts`'s {@link StudioState} gains `turtleState`/`turtleScene` slots, reusing
 *   `@openlogo/turtle`'s own `TurtleState`/`TurtleScene` types verbatim and defaulting to its
 *   `INITIAL_TURTLE_STATE`/`INITIAL_TURTLE_SCENE` program-start defaults.
 * - {@link Canvas2DContext} names the real Canvas 2D context surface this package forwards (this
 *   monorepo has no `lib.dom`); {@link createCanvasRenderTarget} adapts one into
 *   `@openlogo/turtle`'s headless `RenderTarget` — the DOM canvas lives in studio, never in
 *   `@openlogo/turtle`.
 * - {@link createCanvasViewController} paints the shared state model's turtle state/scene through
 *   `@openlogo/turtle`'s `paintTurtle`, never re-deriving coordinates or scene items itself;
 *   {@link mountCanvasView} composes it into the shell's `turtle` region and paints the initial
 *   default state immediately. See `canvas-view.ts`.
 *
 * #277 makes the studio actually servable — a Vite-hosted browser page (`index.html` +
 * `web/main.ts`) composes every seam above onto a real `<textarea>`/`<canvas>`/Run button. The
 * browser entry is a thin, logic-free wiring layer (outside this package's `tsc -b` build graph
 * and never imported by a test); any real logic it needs lives in `web-bootstrap.ts` instead, so
 * it stays inside the 100% coverage gate. See `packages/studio/README.md`'s "Running in a
 * browser" section.
 *
 * #278 makes the page's Run/Stop/Reset controls real and paces the turtle animation
 * visibly, and turns the diagnostics pane into a real list (#305 later removes the `Next step`
 * control from the 0.1.0 UI; the headless `step()` machinery it drove stays intact for Wave 1/
 * #302 to rebuild a UI on):
 * - {@link createTimeoutScheduler} builds a real, paced `RunControllerOptions.scheduler` — a
 *   fixed-delay, `setTimeout`-backed `Scheduler` (`@openlogo/turtle`'s timer-free type) the
 *   browser entry injects so a run's turtle animation plays back step by step instead of
 *   draining instantly (`IMMEDIATE_SCHEDULER`, still the default for headless/test callers).
 *   {@link TimeoutSchedulerTimers} is the injectable timer seam (real `setTimeout`/
 *   `clearTimeout` from the browser entry, fakes in this module's own tests) — kept out of
 *   `run-controller.ts`/`@openlogo/turtle` entirely, per their "studio owns the timer" boundary.
 * - {@link toDiagnosticListItems} projects {@link DiagnosticsController}'s `diagnostics` into a
 *   ready-to-render list — one {@link DiagnosticListItem} per diagnostic, each already carrying
 *   its fully formatted `label` (source span + code + severity + message, per
 *   `spec/error-model.md`'s diagnostic-identity rule); {@link NO_DIAGNOSTICS_LABEL} is the fixed
 *   placeholder shown when the list is empty. The browser entry mounts
 *   {@link createDiagnosticsController} (live parse-stage diagnostics as the learner types) via
 *   {@link mountDiagnosticsPane} and renders both parse- and run-stage diagnostics through this
 *   one path, per `diagnostics.ts`'s "one unified rendering path" doc comment.
 * - {@link formatOutput} formats {@link RunController}'s `state.output` (one line per `print`
 *   trace event, already in `@openlogo/runtime`'s canonical `printedForm`) as a single string for
 *   the output pane's `<pre>`, so a learner running `print 42` actually sees `42` rendered.
 *
 * #279 finishes the servable studio — accessibility, reduced motion, persistence, and branding —
 * wired onto real DOM in `index.html`/`web/main.ts`:
 * - `index.html` maps {@link REPL_LANDMARK_ROLES} onto its `<section>`s/elements and
 *   {@link REPL_FOCUS_ORDER} onto native DOM order (plus `tabindex="0"` on the Canvas and
 *   diagnostics list, which aren't natively focusable), declares the turtle-state `status` region
 *   {@link createTurtleStateRegion} feeds, and two always-live `aria-live` regions
 *   {@link createA11yAnnouncer}'s announcements render into.
 * - {@link selectAnnouncerElementId} picks which of those two live regions — `polite` or
 *   `assertive` — an {@link Announcement} belongs in, keyed only on its `politeness`.
 * - {@link selectScheduler} picks the reduced-motion-aware `RunControllerOptions.scheduler`: the
 *   browser entry reads `window.matchMedia('(prefers-reduced-motion: reduce)').matches` and this
 *   pure function chooses between {@link createTimeoutScheduler}'s paced scheduler and
 *   `@openlogo/turtle`'s synchronous `IMMEDIATE_SCHEDULER`, honoring `spec/rendering.md`'s
 *   reduced-motion requirement.
 * - {@link createKeyValueStorageAdapter} adapts a lazily-resolved `KeyValueStorage` (e.g.
 *   `() => window.localStorage`) into #128's `StorageAdapter` seam, so {@link attachPersistence}
 *   restores/saves the learner's document text across a real page reload; {@link KeyValueStorage}
 *   is the minimal `getItem`/`setItem`/`removeItem` shape it adapts. Resolving the storage lazily
 *   (once per `save`/`load`/`clear`, not at construction) means even a throwing storage getter
 *   degrades gracefully through `attachPersistence`'s existing error handling instead of crashing.
 * - {@link assertPresent} and {@link syncTextValue} keep `web/main.ts`'s remaining DOM-lookup and
 *   editor-sync decisions out of the entrypoint too: the former turns a `document.getElementById`
 *   result into a single asserted, narrowed value (throwing a clear error if missing) instead of a
 *   manual `if`/`throw`; the latter writes the editor's value only when it actually changed, so the
 *   browser entry never has to branch on either.
 * - `web/main.ts` applies the OpenLogo palette/tagline via a linked stylesheet
 *   (`web/styles.css`); no new `src/` logic is needed for static branding.
 *
 * #310 wires up a configurable turtle-speed control — a slider ranging from slow to fast, plus a
 * dedicated "instant / no animation" end — that actually takes effect (previously,
 * `TurtleAnimationController`'s own `stepsPerSecond` pacing was never wired from studio's side;
 * every run played back at whatever pace the browser entry's scheduler happened to use):
 * - {@link mapSpeedSliderValueToTickDelayMs} (`turtle-speed.ts`) is the one tested place that maps
 *   a raw slider position (`SPEED_SLIDER_MIN`..`SPEED_SLIDER_MAX`) to a per-tick delay in
 *   milliseconds — linear interpolation between {@link SLOWEST_TICK_DELAY_MS} and
 *   {@link FASTEST_PACED_TICK_DELAY_MS} for every paced position, and {@link INSTANT_TICK_DELAY_MS}
 *   (`0`) for the dedicated top position. {@link isInstantTickDelay}/
 *   {@link tickDelayMsToStepsPerSecond}/{@link describeSpeedTickDelayMs} are the small, pure
 *   functions built on top of that mapping `run-controller.ts` and a future renderer consume —
 *   keeping every branch out of `web/main.ts`, which stays a thin, branch-free wiring layer.
 * - `state-model.ts`'s {@link StudioState} gains `speedSliderValue` (default
 *   {@link DEFAULT_SPEED_SLIDER_VALUE}), and {@link StudioStateStore.setSpeedSliderValue} replaces
 *   it — the single source of truth for the slider position, exactly like every other learner
 *   input.
 * - `run-controller.ts`'s `prepare()` reads `speedSliderValue` and maps it to the
 *   `TurtleAnimationController`'s `stepsPerSecond` option for a paced speed; for the instant
 *   position, `run()` instead OR-combines it into the `reducedMotion` flag it already passes to
 *   `playWithMotionPreference` — so the slider's instant end **complements**, never replaces, the
 *   OS-level `prefers-reduced-motion` path (either alone is enough to force instant playback). See
 *   `run-controller.ts`'s doc comment ("#310") for the full mechanism.
 * - {@link createTimeoutScheduler} (`web-bootstrap.ts`) is fixed to honor each scheduled call's own
 *   `delayMs` (previously it ignored it in favor of one fixed pace) — the actual bug this slice's
 *   acceptance criteria center on.
 * - {@link REPL_FOCUS_ORDER} (`a11y.ts`) gains a `slider` focus stop for the new control, in the
 *   `repl` region alongside Run/Stop/Reset, so it is keyboard-reachable and screen-reader-labeled
 *   like every other control.
 * - `index.html`/`web/main.ts`/`web/styles.css` add the real `<input type="range">` element, its
 *   accessible label + live speed-description text, and its `input` event wiring — a thin
 *   forwarding call into the tested helpers above, never a branch of its own.
 *
 * #314 adds the run log pane — a history/timeline of every completed run, not just the latest:
 * - {@link createRunLogController} watches the shared store's `runStatus` and appends one
 *   {@link RunLogEntry} (id, completion timestamp, terminal status, output, diagnostics) every
 *   time a run finishes — on its own (`"done"`) or via `stop()`/`ol-limit` (`"stopped"`) — never on
 *   `reset()`. Entries are only ever appended, never replaced or dropped. See `run-log.ts`'s doc
 *   comment for the exact `"running"` → `"done"`/`"stopped"` transition this keys off.
 * - {@link toRunLogListItems} projects the history into ready-to-render {@link RunLogEntryViewItem}s
 *   (a formatted heading, output text, and diagnostic lines reusing #278's `formatOutput`/
 *   `toDiagnosticListItems`), always non-empty (a synthetic {@link NO_RUN_LOG_ENTRIES_LABEL}
 *   placeholder when no run has completed yet), so `web/main.ts` only ever loops unconditionally.
 * - `index.html`/`web/styles.css` host the run log INSIDE the existing Run controls toolbar
 *   (`.pane-controls`, `role="toolbar"`) as a final `.run-log-wrapper` child — not a new top-level
 *   pane — adding no new `role`/`aria-label`/`aria-labelledby` anywhere: #279's
 *   `REPL_LANDMARK_ROLES`/`REPL_FOCUS_ORDER` contracts are untouched (a sibling section would still
 *   pick up an implicit ARIA `role="region"` from its `aria-label` alone, per HTML-AAM, which is
 *   why nesting inside the existing landmark — not merely placing it nearby — is what the issue's
 *   "existing REPL landmark region, no new landmark" acceptance criterion requires).
 *
 * #311 gives the run-status region a friendlier, learner-facing label instead of the raw internal
 * state-machine name:
 * - `state-model.ts`'s {@link RunStatus} gains a `"done"` value, distinct from `"idle"`: `run-
 *   controller.ts`'s `prepare()` now commits `"done"` (not `"idle"`) when a run finishes on its
 *   own (no `stop()`, no `ol-limit`) — the state-machine names themselves are otherwise unchanged,
 *   and `"idle"` still means only "never run" / just after `reset()`.
 * - {@link mapRunStatusToLabel} (`run-status-label.ts`) is the one tested place that maps each
 *   `RunStatus` value to its learner-facing label (`"idle"` → `"Ready"`, `"running"` →
 *   `"Running"`, `"done"` → `"Complete"`, `"stopped"` → `"Stopped"`); `web/main.ts` calls it
 *   instead of rendering `runStatus` raw, staying a thin, branch-free wiring layer.
 * - `a11y.ts`'s `describeRunStatus` gains the matching `"Run complete."` announcement for the new
 *   `"done"` value, keeping the existing `aria-live` announcement in sync with the visible label.
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

export type {
  DiagnosticsController,
  DiagnosticsControllerOptions,
  DiagnosticsView,
  DiagnosticViewItem,
} from "./diagnostics.js";
export {
  createDiagnosticsController,
  DEFAULT_DIAGNOSTICS_DOCUMENT,
  mountDiagnosticsPane,
  toDiagnosticsView,
} from "./diagnostics.js";

export type {
  A11yAnnouncer,
  A11yRole,
  Announcement,
  AnnouncementListener,
  AnnouncementPoliteness,
  FocusStop,
  RegionLandmark,
  TurtleStateRegion,
  TurtleStateTextListener,
} from "./a11y.js";
export {
  createA11yAnnouncer,
  createTurtleStateRegion,
  nextFocusStop,
  previousFocusStop,
  REPL_FOCUS_ORDER,
  REPL_LANDMARK_ROLES,
} from "./a11y.js";

export type {
  Canvas2DContext,
  CanvasViewController,
  CanvasViewOptions,
} from "./canvas-view.js";
export {
  createCanvasRenderTarget,
  createCanvasViewController,
  mountCanvasView,
} from "./canvas-view.js";

export type {
  DiagnosticListItem,
  KeyValueStorage,
  TextValueTarget,
  TimeoutSchedulerTimers,
} from "./web-bootstrap.js";
export {
  ANNOUNCER_ASSERTIVE_ELEMENT_ID,
  ANNOUNCER_POLITE_ELEMENT_ID,
  assertPresent,
  createKeyValueStorageAdapter,
  createTimeoutScheduler,
  DEFAULT_RUN_PROGRAM,
  formatOutput,
  NO_DIAGNOSTICS_LABEL,
  selectAnnouncerElementId,
  selectScheduler,
  syncTextValue,
  toDiagnosticListItems,
} from "./web-bootstrap.js";

export {
  DEFAULT_SPEED_SLIDER_VALUE,
  describeSpeedTickDelayMs,
  FASTEST_PACED_TICK_DELAY_MS,
  INSTANT_TICK_DELAY_MS,
  isInstantTickDelay,
  mapSpeedSliderValueToTickDelayMs,
  SLOWEST_TICK_DELAY_MS,
  SPEED_SLIDER_MAX,
  SPEED_SLIDER_MIN,
  tickDelayMsToStepsPerSecond,
} from "./turtle-speed.js";

export { mapRunStatusToLabel, RUN_STATUS_LABELS } from "./run-status-label.js";

export type {
  RunToggleAction,
  RunToggleIcon,
  RunToggleViewModel,
} from "./run-controls.js";
export {
  mapRunStatusToRunToggleViewModel,
  RUN_TOGGLE_VIEW_MODELS,
} from "./run-controls.js";

export type {
  RunLogController,
  RunLogControllerOptions,
  RunLogEntry,
  RunLogEntryListener,
  RunLogEntryViewItem,
} from "./run-log.js";
export {
  createRunLogController,
  NO_RUN_LOG_ENTRIES_LABEL,
  NO_RUN_OUTPUT_LABEL,
  toRunLogListItems,
} from "./run-log.js";

export type {
  LessonLookup,
  LessonPaneController,
  LessonPaneControllerOptions,
  LessonPaneView,
  WorkedExampleViewItem,
} from "./lesson-pane.js";
export {
  createLessonPaneController,
  mountLessonPane,
  NO_LESSON_VIEW,
} from "./lesson-pane.js";
