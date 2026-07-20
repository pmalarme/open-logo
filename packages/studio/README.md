# `@openlogo/studio`

**The OpenLogo UI that runs in a browser.** A TypeScript web app hosting the code editor/REPL, the
**Canvas** turtle view, the diagnostics UI, and the lesson/tutor pane, with Run/Stop/Reset,
persistence, and accessibility. It composes the other packages and owns no language logic.

- **Source root:** `src/` — app entry `src/index.ts`; keep a headless `run-controller.ts` + state
  model separate from the view/DOM so it is testable without a browser.
- **Owner:** [`@learner-experience`](../../.github/agents/learner-experience.agent.md).
- **Working rules:** [`studio.instructions.md`](../../.github/instructions/studio.instructions.md).
- **Spec:** [`rendering.md`](../../spec/rendering.md) (Canvas target + controls + a11y),
  [`tooling.md`](../../spec/tooling.md) (LSP integration),
  [`interaction-events.md`](../../spec/interaction-events.md).
- **Depends on:** `@openlogo/parser`, `@openlogo/runtime`, `@openlogo/turtle`, `@openlogo/edu`,
  `@openlogo/core`.

## State model + app shell (#123)

Every pane composes over **one** shared instance — never a per-pane copy:

- `createStudioState()` (`src/state-model.ts`) — the single source of truth: `source`
  (document text), `selection` (cursor/selection), `runStatus`
  (`"idle" | "running" | "stopped"`), `diagnostics` (`@openlogo/core` `Diagnostic[]`), `output`
  (learner-visible printed lines from the most recent run, #126), `lesson` (lesson context for
  `@openlogo/edu` content), `notice` (a non-fatal, learner-visible status set by e.g. #128
  persistence when it degrades gracefully), and `turtleState`/`turtleScene` (the Canvas view's
  turtle avatar state + retained scene, #218 — `@openlogo/turtle`'s own types, defaulted to its
  program-start `INITIAL_TURTLE_STATE`/`INITIAL_TURTLE_SCENE`). State changes only through its
  `set*` methods; `getState()` is stable by reference between changes, and `subscribe` notifies
  listeners synchronously after every change — see the doc comment in `state-model.ts` for the full
  contract.
- `createAppShell(state)` (`src/app-shell.ts`) — a composable region registry (`editor`,
  `turtle`, `diagnostics`, `lesson`, `repl`), each starting as an empty placeholder. Later panes
  (#124 editor, #125 diagnostics, #126 run/stop, #127 lesson, #128 persistence, #129 a11y) call
  `shell.mount(region, pane)` to compose themselves in, and read/write state via `shell.state`
  (the same store instance, not a copy).

No studio shell framework/bundler is pinned yet (deferred in ADR-0001), so this slice models the
shell headlessly (plain objects, no DOM) to stay simple and testable under `node:test`; a later
slice may swap in a real renderer without changing this contract.

## Editor pane (#124)

- `createEditorController(state, options?)` (`src/editor.ts`) — the headless editing controller:
  `getText`/`getSelection` read straight from the shared state model; `setText`/`setSelection`/
  `insertText`/`deleteBackward`/`deleteForward` write straight through it. There is no private
  text buffer, so two controllers over the same store always agree — the #123 single-source-of-
  truth contract holds through editing.
- `mountEditorPane(shell, controller)` composes the controller into the shell's `editor` region.
- Syntax coloring is a pluggable seam: `getTokens()` delegates to a `HighlightProvider` (default
  `noopHighlighter`, i.e. plain text). This slice has no hard dependency on the epic #118
  highlighter — pass a provider built from `@openlogo/parser`'s `semanticTokens` once you want
  real coloring; this module never re-implements token classification itself.
- See `editor.ts`'s doc comment for the DOM/mount integration contract a later real-widget slice
  (e.g. a `<textarea>`/CodeMirror/Monaco host) should follow to stay headless-first and avoid
  ever forking the document text or regressing keyboard operability.

## Persistence (#128)

- `attachPersistence(state, options?)` (`src/persistence.ts`) — the smallest mechanism that
  satisfies "a learner's document text survives a reload." It restores `source` from a
  `StorageAdapter` once at creation, then re-saves it on every change (skipping saves when
  `source` is unchanged), always through the shared state model — no forked copy of the text.
- `StorageAdapter` (`save`/`load`/`clear`) is the pluggable backend seam, matching the #123/#124
  headless-first approach: `createInMemoryStorageAdapter()` is the default, fully `node:test`-able
  implementation. A real `localStorage`-backed adapter plugs into the same three synchronous
  methods later — nothing here needs to change to support that.
- **Graceful degradation:** if the adapter throws on restore, save, or clear (quota exceeded,
  storage disabled, etc.), `attachPersistence` never lets the failure crash the session or lose
  work silently — it catches the error and calls `state.setNotice({ level: "warning", message })`,
  so a later pane can render a visible notice. The learner keeps working either way.
- `attachPersistence(...).dispose()` stops persisting further changes;
  `attachPersistence(...).clearPersisted()` removes the stored value (also degrading gracefully).

## Run/Stop/Reset (#126, extended in #228 to drive the turtle Canvas view in lockstep)

- `createRunController(state, options?)` (`src/run-controller.ts`) — the headless run controller
  over `@openlogo/runtime`'s execution budget (issue #102):
  - **Run** — `run()` calls `execute(state.getState().source, document, options)` and reduces the
    returned trace-event stream to exactly what #126 surfaced: every `print` event becomes one
    `output` line (already in the runtime's canonical `printedForm`, never reformatted here), and
    the run's diagnostics replace the shared `diagnostics` list unchanged. This part is unchanged
    since #126 and always synchronous/instant — `execute()` never yields.
  - **Turtle Canvas lockstep (#228)** — `run()` then replays that same already-complete
    trace-event stream through `@openlogo/turtle`'s `TurtleAnimationController` (#216), pushing
    each folded `{ state, scene }` snapshot into the shared `turtleState`/`turtleScene` fields (and
    calling `options.canvasView.repaint()` immediately, if one was supplied) as playback advances.
    The runtime executes once, atomically; the animation controller replays that recording —
    `run-controller.ts` never re-implements movement math or drives the runtime step-by-step.
    Pacing is via an injected `options.scheduler` (a `@openlogo/turtle` `Scheduler`; studio owns
    the concrete `setTimeout`/`requestAnimationFrame` implementation — `@openlogo/turtle` itself
    stays timer-free). It defaults to `@openlogo/turtle`'s synchronous `IMMEDIATE_SCHEDULER`, which
    drains the whole animation within `run()` before it returns — preserving every pre-#228 test's
    run-completes-synchronously behavior unmodified. Set `options.reducedMotion: true` to honor
    `prefers-reduced-motion` (#227): `run()` then paints the final scene instantly via
    `playWithMotionPreference`'s `seekToEnd()` path instead of pacing per-step ticks.
  - **Stop** — `stop()` flips a cancellation signal this controller owns for its whole lifetime
    and sets `runStatus` to `"stopped"` immediately. Because `execute()` is synchronous and never
    yields, a same-thread `stop()` cannot preempt a call already on the stack — true mid-loop
    interruption needs a Web Worker + `SharedArrayBuffer`/`Atomics` architecture, which is out of
    scope for this slice. What genuinely keeps a runaway `forever`/`repeat 10000 [...]` program
    from hanging the session is the **instruction budget** (`options.instructionBudget`, default
    `DEFAULT_INSTRUCTION_BUDGET`), checked before every statement/loop pass inside `execute()`
    itself. A cancelled signal stays cancelled until `reset()` re-arms it, so `stop()` then `run()`
    deterministically halts with `ol-limit`/`cancelled` rather than silently dropping the request.
    (#228) `stop()` also pauses the in-progress turtle animation, so the Canvas view freezes at the
    exact same point the output/diagnostics already stopped at — any tick already scheduled before
    `stop()` is a guaranteed no-op when it eventually fires, per `TurtleAnimationController`'s own
    `status !== "running"` guard, so a stale async tick can never sneak in an extra frame.
  - **Reset** — `reset()` clears `output`/`diagnostics` back to empty, re-arms the cancellation
    signal, and sets `runStatus` to `"idle"` — deterministic, ready for the next `run()`. (#228)
    `reset()` also resets the turtle animation and restores `turtleState`/`turtleScene` to
    `@openlogo/turtle`'s program-start `INITIAL_TURTLE_STATE`/`INITIAL_TURTLE_SCENE`, repainting
    the Canvas view (if supplied) back to a blank slate.
  - **Step** (headless only — not surfaced in the 0.1.0 UI, see #305; Wave 1/#302 rebuilds a UI on
    it) — no longer a no-op as of #228: `step()` advances the turtle animation by exactly one
    instruction-step (matching `TurtleAnimationController.step()`'s own granularity) and pushes the
    resulting snapshot, repainting the Canvas view if supplied. It remains a no-op before the first
    `run()` or once the animation is exhausted. This is deliberately stepping the *replay* of an
    already-complete event stream, not the runtime — `@openlogo/runtime`'s `execute()` itself still
    exposes no per-instruction pause/resume API; a follow-up issue should track real runtime
    step-through once it grows an incremental execution entry point.
  - `mountRunController(shell, controller)` composes the controller into the shell's `repl` region.
- See `run-controller.ts`'s doc comment for the full same-thread cancellation rationale and the
  `runStatus`-vs-animation-completion decoupling #228 introduces (a still-paced Canvas view is
  never reported `"idle"`/`"stopped"` before its animation has actually reached `"done"`).

## Diagnostics pane (#125)

- `createDiagnosticsController(state, options?)` (`src/diagnostics.ts`) — subscribes to the
  shared store and, whenever `source` changes, re-parses it via `@openlogo/parser`'s `parse()`
  (Layer 1, issue #9) and republishes the result through `state.setDiagnostics`, so a bad line
  (e.g. `ol-bad-token`) surfaces at its `source_span` as the learner types, with no Run needed and
  without ever crashing the session (`parse()` reports diagnostics instead of throwing).
- **One unified rendering path for every stage.** Parse-stage (this controller), runtime-stage
  (#126's run controller, already writing `execute()`'s diagnostics into the same field), and
  semantic/style-stage (`@openlogo/parser`'s `check()`, epic #108) all flow through the exact same
  `state.diagnostics` field and render through the exact same {@link toDiagnosticsView} — there is
  no separate ad-hoc "runtime error" UI.
- **Semantic checking is opt-in**, not automatic: pass `semanticCheck: true` to also run `check()`
  after every parse. It defaults to `false` because `check()`'s `ol-unknown-command` rule does not
  yet recognize runtime-registered primitives outside Core Language, so enabling it unconditionally
  today would falsely flag an ordinary turtle program like `forward 100` as unknown-command — see
  `diagnostics.ts`'s doc comment. Flip it on once epic #108 closes that gap; no rendering-side
  change is needed when it does.
- `toDiagnosticsView(diagnostics)` — the pure projection from a raw `Diagnostic[]` to a rendering
  model (`items`/`errorCount`/`warningCount`/`isEmpty`). It keys off `code`/`severity`/`stage`/
  `params` only and never inspects `message` prose, per the diagnostic-identity rule
  (`spec/error-model.md`); `severity` stays a structured field on each item rather than being
  translated into styling here.
- `mountDiagnosticsPane(shell, controller)` composes the controller into the shell's `diagnostics`
  region.

## Studio keyboard + screen-reader accessibility (#129, extended in #229 to the Canvas pane)

Scope: every studio surface — editor (#124), run controls (#126/#228, mounted in the `repl`
region), the turtle Canvas pane (#218/#228, mounted in the `turtle` region), and diagnostics
(#125). Lesson-pane a11y is a separate slice (#127/M3). Like every prior slice, ADR-0001 leaves the
DOM/framework choice open, so this is a **headless, `node:test`-able a11y contract/view-model
layer** (`src/a11y.ts`) that a later real renderer maps onto actual DOM attributes 1:1 — there is
no DOM here to regress.

- **Keyboard operability** — `REPL_FOCUS_ORDER` is a static, ordered list of every focusable stop
  across the studio: the editor (one `textbox` stop), Run/Stop/Reset (three `button` stops,
  matching `run-controller.ts`'s `run()`/`stop()`/`reset()`), the turtle Canvas (one `img`
  stop), and the diagnostics list (one `log` stop). `nextFocusStop`/`previousFocusStop` cycle
  through it, wrapping at both ends — proof there is no keyboard trap: from any stop you can always
  reach every other stop moving forward or backward. `run-controller.ts`'s headless `step()` method
  still exists (Wave 1/#302 rebuilds a UI on it), but 0.1.0 removed its `Next step` control (#305),
  and has no `speed`/`export` control either (`@openlogo/turtle` exposes
  `exportTurtleSvg`/`exportTurtlePng` and an animation `stepsPerSecond` option, but studio does not
  wire either into a learner-facing action today), so
  this module deliberately adds no focus stop for an action that does not exist — the same
  "document the honest gap, never fake it" precedent #126/#228 set for `step()`/`stop()`.
- **Semantic structure** — `REPL_LANDMARK_ROLES` declares each pane's container-level ARIA role +
  label (editor≈`textbox`, run controls≈`toolbar` "Run controls", the Canvas≈`img` "Turtle canvas",
  its non-visual state text≈`status` "Turtle state", diagnostics≈`log` "Diagnostics"), for a
  renderer to map onto real `role`/`aria-label` attributes.
- **Screen-reader announcements** — `createA11yAnnouncer(state)` subscribes to the shared #123
  store (never a copy) and emits an `Announcement` (`{ politeness, message }`) whenever
  `runStatus` or `diagnostics` changes: run-status transitions ("Run started."/"Run stopped."/
  "Ready.") and diagnostics changes (e.g. "1 error found.", `politeness: "assertive"` when any
  diagnostic is an error, else `"polite"`). Announcement text is built **only** from structured
  fields (`runStatus`; diagnostics' `severity` counts) — it never reads or branches on a
  `Diagnostic.message`'s prose, per the diagnostic-identity rule already followed by
  `diagnostics.ts`. `getAnnouncements()` returns the full history; `subscribeAnnouncements(...)`
  notifies every listener with the same events, so multiple consumers never desync (the #123
  single-source-of-truth contract, once again).
- **Non-visual turtle state (#229)** — `createTurtleStateRegion(state)` is a single, always-current
  `status`/`aria-live="polite"` text region over the shared store's `turtleState` slot (the same
  one #218 paints from and #228 pushes into on every run tick/`step()`/`reset()`), rendered via
  `@openlogo/turtle`'s published `describeTurtleState` — this module never re-derives
  position/heading/pen wording itself. Unlike the announcer's growing log, `getText()` always
  returns the *current* description (available immediately, even before any run), and
  `subscribeText(listener)` notifies every listener with the new text whenever `turtleState`
  changes — so the region reads in lockstep with the Canvas view as a program runs, and multiple
  consumers never desync.
- No shell region/mount function is added for the announcer or the turtle-state region — both are
  cross-cutting services over the existing store, not panes with their own mount lifecycle.

## Turtle Canvas view (#218, driven live by Run/Stop/Reset in #228)

**#218 delivered static composition** — the initial default turtle state/scene, painted once at
mount. **#228 (above)** wires `run-controller.ts` to update `turtleState`/`turtleScene` after each
run/step/reset and repaint the pane live, in lockstep with output/diagnostics.

- `state-model.ts` gains `turtleState`/`turtleScene` on `StudioState`, reusing `@openlogo/turtle`'s
  own `TurtleState`/`TurtleScene` types verbatim (never a studio-invented fork) and defaulting to
  its program-start `INITIAL_TURTLE_STATE`/`INITIAL_TURTLE_SCENE` — origin, heading `0`, pen down,
  color `"black"`, width `1`, visible, background `"white"`, no drawing items.
- **The DOM ownership boundary**: `@openlogo/turtle` is deliberately DOM-free — its `RenderTarget`
  is a hand-written minimal structural subset of the real Canvas 2D drawing API (this monorepo has
  no `lib.dom` and no `node-canvas` dependency). `src/canvas-view.ts`'s
  `Canvas2DContext` names that same real-context surface from the studio side, and
  `createCanvasRenderTarget(context)` wraps it into `@openlogo/turtle`'s `RenderTarget` — a real
  forwarding adapter (not a pass-through, since a real `CanvasRenderingContext2D`'s
  `fillStyle`/`strokeStyle` accept `CanvasGradient`/`CanvasPattern` too, wider than `RenderTarget`
  declares) — the DOM canvas lives in studio, never in `@openlogo/turtle`.
- `createCanvasViewController(state, { target, viewport })` reads `state.getState().turtleState`/
  `.turtleScene` and paints them through `@openlogo/turtle`'s `paintTurtle` — never re-deriving
  turtle coordinates, colors, or scene items itself. `repaint()` always reads the *current* store
  snapshot, so it never goes stale relative to whichever pane last wrote `turtleState`/
  `turtleScene`.
- `mountCanvasView(shell, controller)` composes the controller into the app shell's existing
  `turtle` region (seeded by #123) and calls `repaint()` immediately, so the pane never shows a
  blank/stale target the moment it mounts.

## Running in a browser (#277)

The package is now genuinely servable, not just headless-testable:

- **`npm run dev`** (from this directory, or `npm run dev` at the repo root) starts a **Vite** dev
  server (see [ADR-0011](../../docs/adr/0011-studio-app-bundler.md)) serving `index.html`. A
  `predev` hook runs `npm run build` first (`tsc -b`'s project references transitively build every
  `@openlogo/*` dependency), so `npm install` → `npm run dev` on a fresh clone works with no
  separate manual build step. Type `repeat 4 [ forward 100 right 90 ]` (the default boot program)
  into the editor and press **Run** — a square draws on the Canvas.
- **`npm run build:web`** (`vite build`) produces a static, deployable bundle in `web-dist/`;
  **`npm run preview`** (`vite preview`) serves that bundle locally.
- **`web/main.ts`** is the browser entry — a thin, logic-free wiring layer that composes
  `createStudioState`/`createAppShell`/`createEditorController`/`createCanvasViewController`/
  `createRunController` (every seam documented above) onto real DOM elements from `index.html`. It
  never reimplements any of them. Any non-trivial glue (the default boot program, a diagnostics
  summary string) lives in `src/web-bootstrap.ts` instead, which has its own `.test.mjs` and stays
  inside the 100% coverage gate — `web/**` is outside this package's `tsc -b` build graph (`src/`
  only) and is never imported by a test, so it does not count toward that gate either way.
- This is the **walking skeleton** (epic #276's slice 1): Stop/Reset with live animation, the
  full diagnostics list pane, and a11y/persistence/branding polish are later slices. A bad program
  (e.g. `forward`) does not crash the page on Run — its diagnostics render as a plain-text summary,
  not yet the full diagnostics pane. `Next step` was removed from the 0.1.0 UI (#305); the
  headless `step()` machinery it drove stays intact for Wave 1 (#302) to rebuild the control on.


