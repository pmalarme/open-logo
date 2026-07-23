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
- See `editor.ts`'s doc comment for the DOM/mount integration contract the real-widget slice below
  follows to stay headless-first and avoid ever forking the document text or regressing keyboard
  operability.

## Rich editor surface — CodeMirror 6 (#315)

- The browser now mounts a real **CodeMirror 6** `EditorView` (`web/main.ts`) into a plain
  `#editor-host` container (`index.html`) instead of the old `<textarea>`, giving the editor a
  **line-number gutter** and **code folding** of `[ ... ]`/`... end` blocks. The choice, its
  accessibility analysis, and its measured bundle cost are recorded in
  [`docs/adr/0013-studio-editor-component.md`](../../docs/adr/0013-studio-editor-component.md).
- **Modular, pinned deps** — only `@codemirror/{state,view,commands,language}` (exact versions
  pinned in `package.json`/`package-lock.json`, no `^`/`~`); no `codemirror` convenience bundle, no
  `@codemirror/lang-*`, no autocomplete/search/lint packages.
- **Fold ranges are AST-derived, not text-scanned**: `src/fold-ranges.ts` walks
  `@openlogo/parser`'s own AST and only folds a control-form/procedure body's `instruction-block`
  span — never a list literal, selector index, or pattern/field-list bracket — and falls back to no
  folds while the source doesn't parse, rather than guessing from raw text.
- **`src/editor-cm6.ts`** builds the CM6 extension list (`lineNumbers()`, `foldGutter()`, the AST
  fold service, the default/history/fold keymaps) and owns the origin-tagged sync protocol between
  CM6's own transactional state and the shared `StudioStateStore` (`buildStoreSyncSpec`,
  `handleViewUpdate`) — this module stays DOM-free and fully unit-tested; only the one-line
  `new EditorView({ state, parent })` construction and its native event wiring live in `web/main.ts`
  (the same tested-helper/thin-DOM-glue split every other pane in this package follows).
- **Accessibility parity (non-negotiable, #279):** CM6's own content-editable — not the static
  `#editor-host` div — carries `role="textbox"`/`aria-label="OpenLogo source editor"` via its
  `contentAttributes` facet, so the editor remains exactly one `textbox` focus stop/landmark
  (`REPL_FOCUS_ORDER`/`REPL_LANDMARK_ROLES`, cross-checked by `src/a11y.test.mjs`). CM6's own
  `.cm-gutters` (line numbers + fold icons) is `aria-hidden` by the library itself. Reduced motion
  (`prefers-reduced-motion: reduce`) disables transition/scroll animation on the editor via a
  `reduced-motion` class plus a CSS media-query fallback; CM6's fold/unfold is itself instant
  (a synchronous state effect), so there is no fold animation to suppress in JS.
- **Measured bundle cost:** adding the four packages took the `web-dist/` production JS from
  46.11 KB to 141.01 KB gzip (~+95 KB gzip) — see the ADR's KISS section for the full before/after
  table and why the real number landed above the ADR's original 50-80 KB estimate.

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
    since #126 and always synchronous/instant — `execute()` never yields. `runStatus` settles to
    `"done"` (#311) once a run finishes on its own — distinct from `"idle"`, which now means only
    "never run" / just after `reset()`.
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
  never reported `"done"`/`"stopped"` before its animation has actually reached its own,
  `@openlogo/turtle`-owned `"done"` status).

## Friendlier run-status labels (#311)

The `#run-status` region (`index.html`) shows a learner-facing label instead of the raw internal
`RunStatus` state-machine name:

- `state-model.ts`'s `RunStatus` gained a `"done"` value distinct from `"idle"`: `run-controller.ts`
  now commits `"done"` (not `"idle"`) when a run finishes on its own, so a renderer can tell "never
  run yet" apart from "just finished" — the state-machine names are otherwise unchanged.
- `src/run-status-label.ts` — the single, fully-tested pure lookup `web/main.ts` reads instead of
  rendering `runStatus` raw: `mapRunStatusToLabel(runStatus)` maps `"idle"` → `"Ready"`,
  `"running"` → `"Running"`, `"done"` → `"Complete"`, `"stopped"` → `"Stopped"`
  (`RUN_STATUS_LABELS` is the underlying table).
- `a11y.ts`'s `describeRunStatus` gained the matching `"Run complete."` screen-reader announcement
  for `"done"`, so the existing `aria-live` announcement stays in sync with the visible label.
- Accessibility: `#run-status` keeps its existing `aria-live="polite"`/`role="status"` region (no
  new markup needed beyond a `role`/`aria-label` for parity with the turtle-state region); the label
  is plain text — color is never used to distinguish run states.

## Icon Start/Stop run-toggle (#316, relabeled to honest "Stop" in #410)

Presentation only, over the unchanged `run-controller.ts` — no new run-lifecycle semantics.

- The separate `#run-button` ("Run") and `#stop-button` ("Stop") are replaced by a single
  `#run-toggle-button` in `index.html`, an icon + label toggle: a play icon/"Start" label while
  idle/done/stopped, a stop icon/"Stop" label while running. `#reset-button` is unchanged in
  behavior and gains a matching icon.
- `src/run-controls.ts` — the one tested, pure place that decides the toggle's presentation:
  `mapRunStatusToRunToggleViewModel(runStatus)` maps every internal `RunStatus` to a
  `RunToggleViewModel` (`action: "run" | "stop"`, `icon: "play" | "stop"`, `label`, `ariaLabel`).
  `"running"` is the only status that maps to `action: "stop"`; every other status maps to
  `action: "run"`. `web/main.ts` never branches on
  `runStatus` itself to decide the toggle's label/icon/click target — it looks the already-decided
  `action` up in a small `Record<RunToggleAction, () => void>` (`run: () => runController.run()`,
  `stop: () => runController.stop()`) and applies the view model's fields onto the DOM via plain
  attribute assignment (`renderRunToggleButton`), matching this package's existing thin,
  branch-free `web/main.ts` convention (`run-status-label.ts`/`turtle-speed.ts` follow the same
  shape).
- **Scope boundary:** clicking the toggle while running still calls the existing `stop()` — there
  is no pause/resume method, and `run()`/`stop()`/`reset()` are otherwise byte-for-byte unchanged.
  **#410 relabeled the toggle's `"running"` presentation from "Pause" to "Stop"**: the button's
  action was always `stop()`, which latches cancellation irreversibly (only `reset()` re-arms it),
  so "Pause" falsely promised a resume that never existed — `spec/rendering.md` defines "pause" as
  a genuinely resumable control, distinct from cancellation. The toggle is now honestly a one-shot
  Stop affordance with **no `aria-pressed` attribute at all** (nothing here is a real pressed
  toggle — `aria-pressed`, even set to `"false"`, still tells assistive technology this is a toggle
  button with a resumable state, which #410 explicitly disavows).
  There is still no `step()`/"Next step" control in the 0.1.0 UI, and no genuine resumable pause
  (deferred to Studio Stepper Wave 1 / #302 / milestone #12, per `a11y.ts`'s doc comment) — this
  slice does not cross that boundary.
- Accessibility: the icon (`.control-icon`, a CSS `::before`-rendered Unicode glyph keyed off the
  button's `data-icon` attribute) is `aria-hidden="true"` and never the only accessible signal —
  the toggle always carries an `aria-label` (`"Start run"`/`"Stop run"`) plus a visible text label
  (`#run-toggle-label`, "Start"/"Stop"), and **no `aria-pressed` attribute** (#410 — a plain Stop
  is not a pressed toggle promising resume, so it does not claim toggle semantics at all).
  `REPL_FOCUS_ORDER`/`REPL_LANDMARK_ROLES` (`a11y.ts`) collapse the former two Run/Stop
  focus stops into the single `run-toggle-button` stop; Reset keeps its own stop. Button background
  colors (`--ol-button-start`/`--ol-button-stop`/`--ol-button-reset` in `web/styles.css`) were
  chosen to clear WCAG AA's 4.5:1 text-contrast threshold against the white button-label text,
  distinct from the lighter `--ol-green`/`--ol-orange`/`--ol-blue` used elsewhere (tagline text,
  focus outline) that fall short of it. No animation/transition is introduced, so there is nothing
  for `prefers-reduced-motion` to suppress.

## Turtle-speed control (#310)

The Run/Stop/Reset animation pace, previously a hardcoded fixed delay `web/main.ts` ignored the
runtime's own per-call pacing to enforce, is now a learner-controllable slider:

- `src/turtle-speed.ts` — the single, fully-tested pure-function mapping the slider owns:
  - `SPEED_SLIDER_MIN`/`SPEED_SLIDER_MAX` (`0`..`100`) bound the slider's range;
    `DEFAULT_SPEED_SLIDER_VALUE` (`50`) is its initial position.
  - `mapSpeedSliderValueToTickDelayMs(value)` linearly interpolates a slider position down from
    `SLOWEST_TICK_DELAY_MS` (at `SPEED_SLIDER_MIN`) to `FASTEST_PACED_TICK_DELAY_MS` (at
    `SPEED_SLIDER_MAX - 1`), clamping out-of-range input — **and** dedicates the slider's top end
    (`SPEED_SLIDER_MAX`) to `INSTANT_TICK_DELAY_MS`, a distinct "no animation at all" position
    rather than just an extreme pace.
  - `isInstantTickDelay(delayMs)` / `tickDelayMsToStepsPerSecond(delayMs)` /
    `describeSpeedTickDelayMs(delayMs)` (a short learner-facing string, e.g. `"Instant"` or
    `"5 steps/second"`) round out the helper — every branch of the slider's behavior lives here,
    fully covered by `turtle-speed.test.mjs`, so `web/main.ts` never has to.
- `state-model.ts` gains `speedSliderValue` (defaulting to `DEFAULT_SPEED_SLIDER_VALUE`) and
  `setSpeedSliderValue` — the same single-source-of-truth contract every other field follows.
- `run-controller.ts`'s `prepare()` reads `speedSliderValue` on every `run()`/`step()` and maps it
  to a tick delay: when paced, it constructs the `TurtleAnimationController` with the matching
  `stepsPerSecond` (via `tickDelayMsToStepsPerSecond`) so each scheduled tick actually waits that
  long; when the slider is at the dedicated instant position, `run()` paints the final scene
  immediately via the same `seekToEnd()` path `reducedMotion` already used — **the slider's instant
  position and the OS's `prefers-reduced-motion` are OR-combined**, so either one alone is enough to
  skip the animation; neither replaces the other's own reason for existing.
- The literal bug this issue targets: `web-bootstrap.ts`'s `createTimeoutScheduler` used to take an
  outer, fixed `delayMs` and ignore the per-call one `TurtleAnimationController` passed on every
  tick — so no matter what pace the caller asked for, every run animated at the same hardcoded
  speed. It now takes no outer `delayMs` at all; its returned scheduler forwards each call's own
  `delayMs` straight to the injected `setTimeout`, so the slider's chosen pace is what actually
  plays back.
- `web/main.ts` wires the `#speed-slider` `<input type="range">` straight to
  `setSpeedSliderValue` on every `input` event (no branch — the mapping is already a plain function
  call), and mirrors both the slider's position and its `describeSpeedTickDelayMs` text into
  `#speed-description` whenever `speedSliderValue` changes, including on first paint.
- Accessibility: the slider is a real `<input type="range">` (implicit `role="slider"`) with a
  `<label for="speed-slider">`, so it is keyboard-operable (arrow keys) and announces its accessible
  name to a screen reader; `#speed-description`'s live text is the *only* signal for the instant
  position — color is never used to distinguish it. `a11y.ts`'s `REPL_FOCUS_ORDER` gains the
  matching `speed-slider` stop (see below).

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
  across the studio: the editor (one `textbox` stop), the Start/Stop toggle and Reset (two
  `button` stops, matching `run-controller.ts`'s `run()`/`stop()`/`reset()` — collapsed from three
  stops to two by #316's icon toggle, relabeled "Stop" in #410, see that section above), the
  turtle-speed slider (one `slider` stop, #310), the run log (one `log` stop, #410), the turtle
  Canvas (one `img` stop), the non-visual turtle-state text (one `status` stop, #410), the program
  output pane (one `status` stop, #410), and the diagnostics list (one `log` stop).
  `nextFocusStop`/`previousFocusStop` cycle through it, wrapping at both ends — proof there is no
  keyboard trap: from any stop you can always reach every other stop moving forward or backward.
  `run-controller.ts`'s headless `step()` method still exists (Wave 1/#302 rebuilds a UI on it), but
  0.1.0 removed its `Next step` control (#305), and has no `export` control either (`@openlogo/turtle`
  exposes `exportTurtleSvg`/`exportTurtlePng`, but studio does not wire it into a learner-facing
  action today), so this module deliberately adds no focus stop for that action that does not
  exist — the same "document the honest gap, never fake it" precedent #126/#228 set for
  `step()`/`stop()`.
- **Semantic structure** — `REPL_LANDMARK_ROLES` declares each pane's container-level ARIA role +
  label (editor≈`textbox`, run controls≈`toolbar` "Run controls", the Canvas≈`img` "Turtle canvas",
  its non-visual state text≈`status` "Turtle state", the program output pane≈`status` "Program
  output" (#410), diagnostics≈`log` "Diagnostics"), for a renderer to map onto real
  `role`/`aria-label` attributes.
- **Screen-reader announcements** — `createA11yAnnouncer(state)` subscribes to the shared #123
  store (never a copy) and emits an `Announcement` (`{ politeness, message }`) whenever
  `runStatus` or `diagnostics` changes: run-status transitions ("Run started."/"Run complete."/
  "Run stopped."/"Ready.") and diagnostics changes (e.g. "1 error found.", `politeness: "assertive"`
  when any diagnostic is an error, else `"polite"`). Announcement text is built **only** from
  structured fields (`runStatus`; diagnostics' `severity` counts) — it never reads or branches on a
  `Diagnostic.message`'s prose, per the diagnostic-identity rule already followed by
  `diagnostics.ts`. `getAnnouncements()` returns the full history; `subscribeAnnouncements(...)`
  notifies every listener with the same events, so multiple consumers never desync (the #123
  single-source-of-truth contract, once again).
- **Non-visual turtle state (#229, extended in #410 to include the current source instruction)** —
  `createTurtleStateRegion(state)` is a single, always-current `status`/`aria-live="polite"` text
  region over the shared store's `turtleState` slot (the same one #218 paints from and #228 pushes
  into on every run tick/`step()`/`reset()`), built from `@openlogo/turtle`'s published
  `describeTurtleState` (position/heading/pen wording, never re-derived here) plus, when available,
  a trailing "current instruction `<exact source text>`" clause — `spec/rendering.md`'s Non-visual
  state descriptions minimum requires surfacing the current instruction alongside pen/visibility
  state. `run-controller.ts` maps each pushed turtle snapshot to the `source_span` of the most
  recently consumed `"instruction"` trace event (`state.currentInstructionSourceSpan`), and this
  module slices that exact span out of `state.source` — the learner's own spelling, verbatim, never
  reformatted. The clause is omitted entirely (not a placeholder) before any run/step has happened,
  or after `reset()`. Unlike the announcer's growing log, `getText()` always returns the *current*
  description (available immediately, even before any run), and `subscribeText(listener)` notifies
  every listener with the new text whenever `turtleState`/`currentInstructionSourceSpan` changes —
  so the region reads in lockstep with the Canvas view as a program runs, and multiple consumers
  never desync.
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
  summary string, #310's slider→tick-delay mapping) lives in `src/web-bootstrap.ts` and
  `src/turtle-speed.ts` instead, each with its own `.test.mjs` and staying inside the 100% coverage
  gate — `web/**` is outside this package's `tsc -b` build graph (`src/` only) and is never imported
  by a test, so it does not count toward that gate either way.
- This is the **walking skeleton** (epic #276's slice 1): Stop/Reset with live animation, the
  full diagnostics list pane, and a11y/persistence/branding polish are later slices. A bad program
  (e.g. `forward`) does not crash the page on Run — its diagnostics render as a plain-text summary,
  not yet the full diagnostics pane. `Next step` was removed from the 0.1.0 UI (#305); the
  headless `step()` machinery it drove stays intact for Wave 1 (#302) to rebuild the control on.

## Side-by-side code/run layout (#313)

Presentation-only slice (epic #290, Studio UX polish milestone): from a 48rem (~768px) viewport up,
the editor and the turtle Canvas render **side by side** — the editor and run controls stack in a
left column, the Canvas fills a right column beside them, and output/diagnostics stay full-width
below — so a learner sees code and the drawing it produces at the same time. Narrower (mobile)
viewports keep the original single-column stack.

- Pure CSS (`web/styles.css`): a `grid-template-areas` layout on `<main>`, switched at one
  `@media (min-width: 48rem)` breakpoint. `index.html`'s `<section>`s each gained a `pane-*` class
  purely to name their grid area — no element was reordered, and every existing `id`/`role`/
  `aria-label` is unchanged, so #279's `REPL_LANDMARK_ROLES`/`REPL_FOCUS_ORDER` contracts (and their
  `index.test.mjs` proofs) still hold: keyboard tab order still follows DOM order, which reads
  editor → run controls → Canvas → output → diagnostics in both layouts.
- The Canvas gained `max-width: 100%; height: auto` so it scales down to fit its column on
  narrower screens; its `width`/`height` attributes (and thus the turtle's actual drawing
  resolution `@openlogo/turtle` paints at) are untouched — purely a visual scale.
- No `src/` or `web/main.ts` changes: there is no layout *decision* logic to test — CSS alone
  decides when to switch columns, so `web/main.ts` stays exactly as thin and branch-free as before.
- **#410** — a holistic-audit found that no test actually loaded `web/styles.css`, so a change that
  silently broke this grid (e.g. dropping a `grid-area`, or deleting the `48rem` breakpoint) would
  have passed the full suite untouched. `web/layout.test.mjs` closes that gap: it reads
  `web/styles.css` and `index.html` as text and asserts the real contract — `main` is a grid
  container, every `.pane-*` class both exists in `index.html` and owns the `grid-area` this section
  documents, the default single-column stack is exactly `editor → controls → turtle → output →
  diagnostics`, and the `48rem` breakpoint switches to the two-column `editor/controls | turtle`
  layout with output/diagnostics full-width below.

**Shell write-set (declared)** — exactly these three files, nothing else:
`index.html` (adds `pane-*` classes + the extension-slot placeholder below — no reordering, no
`id`/`role`/`aria-label` change to any existing element), `web/styles.css` (the grid rules above +
the extension-slot rules below), `README.md` (this section). `src/app-shell.ts` was **not**
touched — its `"lesson"` region already existed (see below).

### Extension slot for the future lesson pane (#127/M3)

M11 and M3 build toward the same end-state three-pane layout — **Lesson pane (context) | Code
editor | Run/Canvas** — so this slice reserves that third slot now, CSS-only, so `#127` never has
to reshape `index.html`/`web/styles.css`/`src/app-shell.ts` again:

- **DOM contract**: `index.html` gains `<section id="lesson-pane" class="pane-lesson"
  hidden></section>` as `<main>`'s first child (matching the target reading order). It carries
  **no `role`/`aria-label` of its own** — declaring one now would create an unmodelled implicit
  `region` landmark the moment `hidden` is cleared, since `src/a11y.ts` has no entry for it yet.
  It ships `hidden`, so it has no box, no grid participation, and — critically — is entirely
  absent from the accessibility tree and the keyboard focus order while empty: nothing to regress,
  no empty landmark, no focus-order gap (verified — see below).
- **App-shell contract**: no change needed. `src/app-shell.ts`'s `APP_SHELL_REGIONS` has included
  `"lesson"` as a named region since #123. A future lesson-pane module mounts exactly like
  `canvas-view.ts`'s `mountCanvasView` does for `"turtle"`: call `shell.mount("lesson",
  controller)`, then clear `#lesson-pane`'s `hidden` attribute (e.g.
  `document.getElementById("lesson-pane").hidden = false`) once it has real content to show.
- **CSS contract**: `web/styles.css`'s `main:has(.pane-lesson:not([hidden]))` rules are the *only*
  place the `lesson` grid area is defined — in the narrow layout it inserts a `"lesson"` row above
  `editor`; from 48rem up it inserts a column to the left of the existing editor/turtle columns.
  Both activate automatically the instant the `hidden` attribute is cleared — no `styles.css` edit
  required to add the third pane. (`:has()` is supported by every evergreen browser this project
  targets.)
- **What #127 still owns**: the lesson-pane module itself, plus updating `src/a11y.ts` to add a
  `REPL_LANDMARK_ROLES` entry (region `"lesson"`) and any `REPL_FOCUS_ORDER` stops for its own
  interactive content, and giving `#lesson-pane` (or its rendered content) a real `role`. #313
  deliberately declares none of that for content that doesn't exist yet — declaring an empty
  landmark ahead of time would itself be the accessibility regression this slice's DoD forbids.

**#127 delivered** (see `src/lesson-pane.ts` for the full doc comment): `#lesson-pane` now carries
`role="complementary"`/`aria-label="Lesson"` (`REPL_LANDMARK_ROLES`/`REPL_FOCUS_ORDER` in
`src/a11y.ts`), M3's enrichment refined the wide-layout column from the placeholder
`minmax(14rem, 22%)` above to `minmax(0, 300px)` (a ~300px starting width that collapses toward
zero — the M3-required "collapses before editor/turtle drop below their own minimums" behavior —
rather than a percentage), and `.pane-lesson` gained its own bounded, independently scrolling box
(`max-height`/`overflow-y: auto`, matching the run log's `#run-log` precedent below) so long lesson
content never pushes the editor/canvas down.

## Run log pane (#314)

Epic #290, Studio UX polish milestone: before this slice, the `#output` pane held only the LATEST
run's printed output — a second `run()` silently overwrote whatever the first one printed, so a
learner who ran two programs in a row lost the first one's output the moment the second finished.
This slice adds an additive, append-only **run log** — a scrollable history/timeline of every run
this session, each entry timestamped and carrying that run's own output and `ol-*` diagnostics —
without changing `#output`'s existing "show the latest run" behavior at all.

- **`src/run-log.ts`** (new, 100%-covered) is the tested model:
  - `createRunLogController(state, options?)` watches the shared `StudioStateStore` and appends
    exactly one `RunLogEntry` every time `runStatus` transitions from `"running"` into a terminal
    status — `"done"` (finished on its own, including a run whose only outcome was an `ol-*`
    diagnostic) or `"stopped"` (`stop()`, or an `ol-limit` runaway-program halt). It never appends
    on `reset()` (`"…" → "idle"` is not a completed run) and never on a `"running"`→`"running"`
    no-op update. Entries are only ever appended (`[...entries, entry]`), never replaced or
    reordered, so earlier runs' history is preserved across later ones.
  - `toRunLogListItems(entries)` is the pure rendering projection: one already-formatted item per
    entry (a deterministic `"Run N — <ISO timestamp>"` heading, its output text via #278's
    `formatOutput`, and its diagnostics via #278's `toDiagnosticListItems` — the exact same
    source-span/code/severity/message formatting the diagnostics pane already uses), plus a
    `hasErrors` flag for styling. Like `toDiagnosticListItems`, it always returns a **non-empty**
    list — a single synthetic "No runs yet." placeholder when history is empty — so `web/main.ts`
    only ever loops unconditionally, with no `if`/`for` decision of its own.
- **`index.html`/`web/styles.css`** host the run log **inside the existing Run controls toolbar**
  (`<section class="pane-controls" aria-label="Run controls" role="toolbar">`) as a final
  `<div class="run-log-wrapper">` child, rather than as a new top-level `pane-*` section. The issue's
  acceptance criteria require reusing "the existing REPL landmark region" with **no new landmark**:
  in this codebase `REPL_LANDMARK_ROLES`/`REPL_FOCUS_ORDER` (`src/a11y.ts`) specifically name that
  toolbar section as the "REPL" region, and a `<section>` with an `aria-label` (even without an
  explicit `role`) still gets an *implicit* ARIA `role="region"` per the HTML-AAM spec — so a
  sibling `pane-runlog` section, however additively placed, would in fact have introduced a brand
  new landmark. Nesting inside `pane-controls` instead adds zero new `role`/`aria-label` attributes
  anywhere: every existing Run/Stop/Reset/speed-slider/`#run-status` element keeps its exact
  attributes and DOM position, so #279's `REPL_LANDMARK_ROLES`/`REPL_FOCUS_ORDER` contracts (and
  `index.test.mjs`'s proofs of them) are unaffected — keyboard tab order still follows DOM order.
  CSS-wise this means the log is no longer its own grid-area row; it renders within the "controls"
  grid area (which grows to fit), separated from the Run/Stop/Reset row by a `.run-log-wrapper`
  top border.
- **`web/main.ts`** wires `createRunLogController`/`toRunLogListItems` onto `#run-log` the same
  thin, branch-free way every other pane is wired: a `createRunLogEntryElement` mapping function
  (unavoidably untested, like `createDiagnosticListItemElement`, since this repo's `node:test` has
  no DOM) builds one `<li>` per already-computed view item, and `renderRunLog` re-renders the whole
  list from `runLog.getEntries()` whenever a new entry is appended.
- **`src/run-controller.ts`** gained a re-entrancy guard: `run()` now ignores a call while
  `runStatus` is already `"running"`. With a real paced `Scheduler` (the browser's, not the
  headless-test-default `IMMEDIATE_SCHEDULER`), `runStatus` stays `"running"` across many
  event-loop turns while the Canvas animation plays out — a second Run click in that window used to
  silently `prepare()` a new run, overwriting `output`/`diagnostics` with the in-flight run's data
  and orphaning its animation, so the run log recorded only the second run and silently lost the
  first. The guard makes a run always finish (or `stop()`) before another can start, matching the
  "Stop is the only way to interrupt a run" contract the instruction budget already gives runaway
  programs.

## Browser visual-regression for the responsive layout (#475)

`web/layout.test.mjs` can only assert the **text** of `web/styles.css` — the monorepo's `node:test`
runner has no CSS engine or browser, so it proves the #313/#472 grid *rules* are present but not
that the drawing pane actually renders at a usable size. This slice (epic #473) adds the real
browser-rendered proof with **Playwright**.

- **`playwright.config.ts`** defines two projects — a **narrow** (390px, `< 48rem`) and a **wide**
  (1440px, `>= 48rem`) Chromium viewport — and a `webServer` that runs `npm run build:web` then
  serves the production bundle with `vite preview` (not the dev server, so no HMR client leaks into
  a snapshot).
- **`e2e/layout.spec.ts`** seeds a program with a long, non-wrapping line (via the persistence
  `localStorage` key), loads the studio, and asserts the drawing pane's real geometry: single-column
  stacking with a usably-sized square canvas on narrow; and on wide, the turtle pane sits beside the
  editor and stays the **larger** column (never squeezed to a thumbnail). These geometry assertions
  are the primary regression guard — they fail exactly when a change lets the editor column steal the
  turtle track's width (the #472 regression). A masked pixel snapshot (`toHaveScreenshot`, the editor
  pane masked because its caret/text are volatile) adds a second, whole-layout check.

### Running it

```bash
npm run test:visual -w @openlogo/studio          # run against committed baselines
npm run test:visual -w @openlogo/studio -- --update-snapshots   # regenerate baselines
```

These `e2e/*.spec.ts` files are deliberately **outside** the Node-22 `node:test` coverage gate: they
are not `*.test.mjs`, so `node --test` never discovers them and the 100% line/branch/function
denominator is unchanged.

### Baselines are Linux-only — regenerate in Docker

Pixel baselines depend on the exact browser + system fonts, so they are committed **per platform**
(`snapshotPathTemplate` keeps the `{platform}` token). Only the `…-linux.png` files under
`e2e/__screenshots__/` are committed; a local Windows/macOS `--update-snapshots` produces distinct
`…-win32.png`/`…-darwin.png` files that `.gitignore` excludes. CI runs inside the
`mcr.microsoft.com/playwright:v1.61.1-jammy` container, so committed baselines **must** be generated
in that same image:

```bash
docker run --rm -v "$PWD:/work" -w /work mcr.microsoft.com/playwright:v1.61.1-jammy \
  bash -lc "npm ci && npm run test:visual -w @openlogo/studio -- --update-snapshots"
```

### Flaky-run guidance

The snapshot tolerates sub-pixel anti-aliasing via `maxDiffPixelRatio: 0.02` and masks the volatile
editor pane, so the geometry — not font hinting — is what regresses. Under CI the suite retries a
failing spec twice (`retries: 2`, CI-only; `0` locally) to ride out transient rendering/timing
noise, while a genuine squeeze fails deterministically on every attempt. If a legitimate layout
change lands, regenerate the baselines with the Docker command above and commit the updated
`-linux.png` files in the **same** PR. If a run flakes on width by a pixel, re-run; a genuine
squeeze is deterministic and fails every time.

### CI wiring (`@devops`)

A path-scoped, required **`studio-visual`** job in [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml)
runs this suite inside the matching Playwright container. A `dorny/paths-filter` step in the `meta`
job gates it so it only runs when the studio (or a package it composes) changes, keeping unrelated
PRs fast.


