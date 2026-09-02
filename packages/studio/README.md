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
  persistence when it degrades gracefully), and `turtleWorld`/`turtleScene` (the Canvas view's
  per-turtle avatar state + retained scene, #218 — `@openlogo/turtle`'s own types, defaulted to its
  program-start `INITIAL_TURTLE_WORLD_STATE`/`INITIAL_TURTLE_SCENE`; `turtleWorld` also carries the
  addressed turtle set the a11y text names, #770; `turtleState` is a derived
  read of `turtleWorld`'s last-acted turtle, #749). State changes only through its
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
    each folded `{ world, scene }` snapshot into the shared `turtleWorld`/`turtleScene` fields (and
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
    `reset()` also resets the turtle animation and restores `turtleWorld`/`turtleScene` to
    `@openlogo/turtle`'s program-start `INITIAL_TURTLE_WORLD_STATE`/`INITIAL_TURTLE_SCENE`, repainting
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

## The `input` prompt (#769)

Wires the studio's prompt UI to the blocking `input` reader seam `@openlogo/runtime` shipped in
#681 (`ExecuteOptions.hostInput.read?: (prompt: string) => string | undefined`), so a learner in the
browser can actually answer `:name = input "what is your name?"`.

**The hard part, stated honestly.** That reader is **synchronous**, and `execute()` never yields, so
a same-thread browser host cannot suspend inside it to await a real prompt.
`window.prompt` is the only synchronous browser prompt, and it is modal, unstyleable, unavailable in
sandboxed iframes, and — decisively — permanently suppressible ("prevent this page from creating
additional dialogs"), after which it returns `null` forever, which the seam reads as "cancel the
run". A Worker + `SharedArrayBuffer`/`Atomics.wait` is the semantically exact answer (and the same
mechanism a genuinely preemptible Stop needs — see the `run-controller.ts` cancellation caveat), but
it needs cross-origin isolation and would make `run()` asynchronous: an architecture change, not
prompt wiring. **The runtime seam was not changed**; instead the run controller reconciles the two
shapes with an **attempt chain**.

- `createInputPromptController()` (`src/input-prompt.ts`) — the headless prompt. It is an
  `InputPromptHost`: the run controller `present()`s one outstanding question through it, and the
  learner ends it with `submit(answer)` or `cancel()`. `cancel()` *is* the runtime reader's own
  `undefined` — the read ends unanswered, which cancels the run
  (`spec/interaction-events.md:110-111`). `dismiss()` is the third path: Stop/Reset withdraw a
  question without answering it, so the responder is dropped rather than called.
  `mapInputPromptRequestToView` is the one place the visible/hidden + label decisions are made, so
  `web/main.ts` stays a branch-free wiring layer.
- `RunControllerOptions.inputPrompt` (`src/run-controller.ts`) — supplying that host is what installs
  `hostInput.read`; **omit it and nothing changes at all** (an `input` read still cancels the run
  exactly as before #769). Each read is answered from a FIFO of the answers already given; the first
  read with none left records its prompt and returns `undefined`. That attempt is a **probe**: its
  animation draws everything up to the read, the question is asked, and the answer re-executes the
  **source captured at `run()`** from the top. N reads cost N+1 executions.
- **Why a replay looks like blocking.** The controller already reduces the *whole* event stream
  wholesale every attempt, and attempt *k+1*'s stream starts with attempt *k*'s, so each replacement
  can only extend what is on screen: output grows monotonically, the canvas resumes (the new
  animation is fast-forwarded past the events already drawn, so it never blanks and redraws), and
  neither the run log nor the tutor-output pane double-counts, because both accumulate only on the
  `"running"` → terminal transition a probe never reaches. A probe's own diagnostics are withheld
  until the learner genuinely dismisses the question — the only diagnostic a probe can carry is the
  reader's own forced cancellation.
- **Run/Stop/Reset.** `runStatus` stays `"running"` for the whole chain (the program *is* running,
  blocked on a read), which is also what makes `run()`'s #314 guard ignore a second Run and the
  Start/Stop toggle offer Stop, with no new state. **Stop** withdraws the question and commits the
  cancelled run (`"stopped"`, with the real `ol-limit`/`cancelled` diagnostic at the waiting
  `input`); **Reset** withdraws it and discards every answer (`"idle"`, so the next run starts over
  at the first question); an answer arriving after either is ignored via a generation counter.
  `step()` is a no-op while a question is open and never installs a host of its own — stepping is a
  scrubber over an already-produced event stream, so there is no execution for a read to block.
- **Accessibility.** `index.html` declares a native `dialog` element opened with `showModal()`, which
  gives a real focus scope, browser-restored focus on close, and Escape → `cancel` (routed to the
  same `cancel()` the button uses) without any focus-management code. Its accessible name is
  `aria-labelledby` the program's **own question**, so a screen reader announces what is being asked
  rather than a generic title; the answer field is labeled and `autofocus`ed.
  `INPUT_PROMPT_FOCUS_ORDER` is the dialog's own focus scope (answer field → Answer → Cancel),
  deliberately separate from `REPL_FOCUS_ORDER` because a modal owns its own scope — `a11y.ts`'s
  `nextFocusStop`/`previousFocusStop` prove it cycles both ways. The dialog starts closed, so until a
  program asks something it is absent from the layout, the tab order, and the accessibility tree —
  which is why the e2e layout baselines are unchanged.
- **One pinned random seed per chain ([#881](https://github.com/pmalarme/open-logo/issues/881),
  closed).** A replay is only a continuation if it *reproduces* the attempt before it. Before this,
  `random` with no `randomize <seed>` reseeded from the wall clock on every `execute()` call, so a
  program whose control flow depended on randomness *before* a read could replay into a **different
  question** than the learner was shown, and already-drawn output could change underneath
  them. `run()` now draws one
  [`ExecuteOptions.randomSeed`](https://github.com/pmalarme/open-logo/issues/865) per chain (from
  `RunControllerOptions.randomSeedSource`, `Date.now` by default — the same implementation-chosen
  seed the runtime would have picked itself, so an ordinary run is no more predictable than before)
  and every attempt of that chain executes with it. That closes the gap **completely for this
  host**, because the clock fallback is `@openlogo/runtime`'s only *ambient* entropy source: nothing
  else there reads a wall clock or `Math.random()`, the tick clock is a pure counter, and since #865
  even a no-argument `randomize` derives its implementation seed by advancing the generator rather
  than reading the clock. The runtime's other caller-supplied functions cannot reintroduce variance
  here either — this package passes `eduTutorTemplate`, a pure mapping, and a reader that answers
  only from the chain's frozen FIFO. So every attempt is bit-identical up to the read the
  newest answer extends — the branch a `random` chose
  cannot change under the covers, the question is never re-asked, what is already on screen is never
  rewritten, and two `input` sites asking the identical prompt text each receive their own answer,
  because a read's FIFO position is now a stable identity.
- **What that removed, and what it kept.** The no-progress retry cap (`MAX_INPUT_REPLAY_RETRIES`) is
  **gone**: a read at FIFO position *i* takes its prompt from the source, the pinned seed, and
  answers *0…i-1*, all frozen for the life of the chain, so the FIFO grows by exactly one entry per
  attempt and a chain can never stall. Recording each answer **with the question it answered**
  (`resolveRecordedAnswer`) is **kept** as defence in depth — it makes "an answer never reaches a
  question the learner was not shown" true by construction rather than by trusting that argument,
  for one comparison per read.
- **What is still outstanding.** Not correctness but mechanism: the read is *reconciled* rather than
  genuinely blocking, and N reads still cost N+1 executions.
  [#876](https://github.com/pmalarme/open-logo/issues/876) (a Worker + `Atomics.wait` execution
  host) is that mechanism — delivered below; the replay stays as the degraded mode wherever
  `SharedArrayBuffer` is unavailable for want of COOP/COEP cross-origin isolation.

## The execution host: a genuinely blocking `input`, and a preemptible Stop (#876)

`createRunController` no longer calls `@openlogo/runtime`'s `execute()` itself. It composes an
**`ExecutionHost`**, whose whole contract is to settle with an `ExecutionSettlement` — the events so
far, their already-reduced `output`/`tutorOutput`, the diagnostics, and the question the run is
suspended on (or `null`). Everything the controller does around a run reaches the same eventual state whichever host is
installed. See [ADR-0023](../../docs/adr/0023-worker-execution-host.md).

**This is a mechanism change, not a correctness fix.** #881 already closed the replay's divergence
window; do not read the section above as describing a bug this removes.

- `createInProcessExecutionHost({ signal })` — the **default**. Runs `execute()` on the calling
  thread with #769's replay reader and settles **synchronously, inside `execute()`**. Omitting
  `RunControllerOptions.executionHost` therefore changes nothing at all: every pre-#876 studio test
  passes untouched.
- `createWorkerExecutionHost({ port, allocateBuffer, notify })` — the **blocking** host. The
  interpreter runs in a Worker and parks *inside* the read on `Atomics.wait`, so **one execution
  answers however many questions**, and its `CancellationSignal` is a getter over `Atomics.load`, so
  Stop aborts a loop *mid*-`execute()`. `repeat 100000 [ … ]` halts where it is rather than at the
  instruction budget — the caveat `run-controller.ts` has carried since #126, finally answered.
  **Both** links are pinned by test, because either alone is worthless: that `stop()`/`reset()`
  actually reach the host, and that a raised flag preempts the running interpreter. Losing the first
  costs a Stop that does not stop, a Reset the program survives and repaints over, and a Worker left
  parked on `Atomics.wait` forever.
- `blocking-input-channel.ts` is the protocol: straight-line logic over an `Int32Array` control block
  and a `Uint16Array` answer region (UTF-16 code units, so no `TextEncoder` seam is needed and
  surrogate pairs round-trip unchanged), with `wait`/`notify` **injected**. A primitive that throws
  on a browser's main thread and cannot be scheduled deterministically therefore stays fully covered
  by `node:test`, with no timing dependence at all.
- `runExecutionWorkerCommand` (`execution-worker-runner.ts`) is the Worker side; `web/execution-worker.ts`
  supplies the real `Atomics.wait` and does nothing else.
- `selectExecutionHost` picks between them from `crossOriginIsolated` + the presence of a
  `SharedArrayBuffer` constructor. It takes a **factory**, so a page without shared memory never
  constructs a Worker it could not use, and `web/main.ts` stays branch-free.

**The learner is never asked a question over a blank canvas.** The runtime's reader is called with
the prompt and nothing else, so a parked Worker would have no way to report what the program had
already drawn — worse than #769, which draws the square and *then* asks.
`ExecuteOptions.observedEvents` (#876, `@openlogo/runtime`) is a caller-supplied array the run
appends to live, so the stream is readable **during** execution rather than only when `execute()`
returns. Rely on its contents, not on identity: for a program that runs it is the same array
`ExecuteResult.events` reports, but a call returning before an execution environment exists — a
parse failure, say — never reaches the sink and reports its own separate empty array.
`spec/interaction-events.md:108-110` explicitly permits continuing to render
already-emitted events while `input` waits, and this is the seam that makes that allowance reachable.

**A settlement carries reduced output, not just events.** Structured clone drops class prototypes: an
`OLDict` arrives as a plain object and `printedForm` throws (`TypeError: record.fields is not a
function`, measured on `print { a: 1 b: 2 }`). Values are therefore reduced to text on the thread
that produced them, and the controller never re-reduces a stream it did not produce in-process.

**The bound.** #881 deleted the replay chain's no-progress retry cap and its reviewers carried the
consequence forward: with the cap gone, a reintroduction of divergence would be an unbounded loop.
A Worker host answers that **structurally** — it never replays to answer a read, so there is no attempt
sequence to
diverge and nothing for a counter to count (asserted directly: one run command for a program with
several reads). Since #952 it does replay to deliver *input*, and since **#976** a chain that has
asked a question keeps accepting input, so a delivery replay **can** now cross a read — which is why
`execution-worker-runner.ts` consumes `ExecutionRequest.answers` before parking rather than
presenting a live read. That path is bounded: one press causes one replay, and each recorded answer
is consumed once, at the position it was given for. Separately, no single **park** is indefinite: `awaitBlockingRead` parks with a timeout and
re-reads the control block, so a Stop is observed within one poll interval even if its wake-up were
missed entirely. What remains unbounded is unchanged and still a host contract: a prompt host that
restarts the run from inside `present()` on *every* presentation, since each restart brings a fresh
`instructionBudget`.

**An over-long answer is refused, never truncated.** The shared answer region is fixed for a run's
lifetime and a blocked Worker's buffer cannot grow, so an answer that does not fit ends the read
unanswered: the run cancels with the runtime's own diagnostic, which is visible and recoverable,
rather than handing the program text the learner did not type. `answerCapacity` is a construction
option so a deployment can put that out of reach.

**Enabling it is a deployment decision.** `SharedArrayBuffer` requires cross-origin isolation, which
a page only gets from `Cross-Origin-Opener-Policy: same-origin` and
`Cross-Origin-Embedder-Policy: require-corp` response headers. This package adds neither, in dev or
in production: until they are served (for local development, via `packages/studio/vite.config.ts`),
`selectExecutionHost` returns `undefined` and the studio keeps the replay.

## Keyboard and pointer input: making `on_key`/`on_click`/`when` fire (#952)

Until this slice the studio installed only `hostInput.read`. `on_key`, `on_click`, and `when "stop"`
**registered, type-checked, highlighted as active keywords — and never fired.** Measured on
[`spec/examples/10-game.logo`](../../spec/examples/10-game.logo) (three `on_key` handlers, one
`on_click`): 131 events, ten coins stamped, **zero prints, zero diagnostics**. A learner pressed the
arrow keys, clicked the canvas, and got silence with a green diagnostics pane. `npm run examples`
could not see it: it runs every program with an **empty** host
([#955](https://github.com/pmalarme/open-logo/issues/955)), so "`10-game.logo` passes" proved it
parsed and executed, never that any of its interaction did anything.

`ExecutionRequest.hostInputEvents` now carries the other half of the seam, `toExecuteOptions`
installs it as `ExecuteOptions.hostInput.events`, and `RunController` gains two deliveries:

- `deliverKey(keyWord)` — one key press, as the lowercase word
  `spec/interaction-events.md:221-225` defines.
- `deliverClick()` — one activation of the drawing surface.

`deliverKey` and `deliverClick` both report whether **that delivery actually ran a handler** — read
from the runtime's own per-delivery count (`ExecuteOptions.handlerDeliveries`, #1024). Each is
`false` for a handler the run never reached, and for a program whose clock never reaches a dispatch
checkpoint at all (one with no `wait`); `deliverKey` is additionally `false` for a key no handler
names. Since #985 a delivery is no longer `false` merely for arriving after a delayed registration —
that was F3, and it is fixed rather than reported.

Until #985 `deliverClick` reported something narrower and different in kind — `chain accepts input &&
on_click registered` — which is a question about the *run*, not about this activation. On the
README's own example, `on_click [ print "C" ] / wait 2`, five clicks returned `[true × 5]` while
handlers ran `[true, true, false, false, false]`: the gate answered `true` for three activations
that ran nothing.

They now agree — **re-measured on the shipped build**, five clicks report `[true × 5]` over output
`["C", "C", "C", "C", "C"]`. The earlier figures in this paragraph were the *capped* behaviour, where
the old counter stopped accepting presses once the program's tick count ran out; scheduling against
the program's own clock removed that cap (see the next bullet), so every click both fires and is
confirmed. The point that survives is the one that mattered: the two numbers are now the same
measurement rather than two booleans that merely looked alike.

### The answer comes from the runtime, not from the event stream (#976)

Every formulation that answers from *history* rather than from the delivery re-created silent
interception somewhere, and four did. The replay's event *stream length* is not **monotonic** (a
handler that raises *shortens* the stream, measured 45 events down to 5 with `ol-undefined-var`,
reporting "nothing responded" for a handler that ran). Asking after the replay settles fails on
**timing**. Pairing declarations with registration events by source position proved only **eventual**
registration, so a press before the handler existed was suppressed with nothing running. And an
"ever responded" set kept answering `true` after the last tick that could fire — invocation counts
`[0,1,2,2]` gave returns `[true,true,true]`.

The fifth formulation, `invocations = instructions − registrations` per source position folded onto
key words parsed back out of the program text, was sound on all of those — but it was still an
answer from history, differenced across a delivery, and its soundness depended on the differencing
window being exactly one press wide. **#976 deletes it.** The runtime reports one
`HandlerDelivery` per delivered occurrence, counting the handler bodies that occurrence entered, so
there is no window to get wrong and no source text to parse. What went with it:
`handlerInvocationsByPosition`, `onKeyInvocationsByKeyWord`, `onClickInvocations`, and
`key-words.ts`'s `collectDeclaredKeyHandlers`/`DeclaredKeyHandler` — 381 lines removed against 176
added. `normalizeKeyWord` stays: mapping `KeyboardEvent.key` onto the spec's vocabulary is not
reconstruction.

A report is matched to its own delivery **by identity** — `HandlerDelivery.input` is the very
schedule entry the controller supplied, never an index into a schedule the runtime sorted. Measured
with the control that makes it mean something: supplying `[tick 4, tick 2]` forces the runtime's
tick sort to reorder, every reported `input` is still `===` a supplied object, and a
structurally-equal copy does *not* match.

A non-literal key word is now confirmable, which the declaration pairing could never do:
`on_key :chosen [ … ]` reported `false` however plainly the handler fired, because the key word
could not be read from the source. A count does not care how it was written.

**Under a host that settles across event-loop turns it is always `false`, so such a host suppresses
nothing at all.** The cause is structural rather than incidental: an `ExecutionRequest` crosses that
thread boundary by structured clone, so the occurrence objects a Worker run reports back are copies
and no identity survives to match on. Pairing on schedule index would close the gap and would be
precisely the reconstruction #975 exists to delete, so it stays open — and it is the deliberate
direction anyway: silent *interception* is worse than silent *inaction*, because it hits every
learner and presents as "the editor is broken". A page that scrolls during a game is a nuisance; a
key that vanishes with nothing happening is a bug report. Pinned by a test, with its in-process
control, so it cannot be quietly "improved" into index arithmetic.

That narrowness is the whole safety story for the ~90% of OpenLogo programs that have no interaction
at all. The bug this closes is *silent inaction*; the regression it must not introduce is *silent
interception*, which is worse — it would hit every learner rather than only Interaction users, and it
would present as "the editor is broken". So:

- **Nothing is captured globally.** `keydown` is registered on the `<canvas>` element and nowhere
  else — never `document` or `window` — so a learner typing `forward 100` in the editor is not on
  that event path at all. Editor focus wins by construction.
- **`preventDefault` is per press, not per program.** A program registering `on_key "up"` suppresses
  `up` and nothing else; a program with no `on_key` suppresses nothing and behaves byte-identically
  to the pre-fix build. Both are asserted against the *real* controller. Suppression needs
  **synchronous confirmation** that the press ran a handler, so it never happens for a press on a
  program whose clock reaches no dispatch checkpoint (nothing ran — exact), nor for any press under
  the Worker host (something may have run, but it cannot be confirmed — conservative).
- **No tab stop is added for a program that cannot use it.** The activation button starts `hidden`
  and is revealed only while the live run registered `on_click` (`RunController.acceptsClick()`) —
  the `hidden`-attribute mechanism `a11y.ts` already documents for the lesson pane, so
  `REPL_FOCUS_ORDER` stays static. It reports **registration**, not reachability: a run that
  registered a handler its clock can never dispatch to still shows the control, visible and inert,
  because whether a program reaches a checkpoint is not knowable without running it.

**Real time never enters the event stream.** `hostInput.events` is a *static, tick-scheduled* list
fixed before a run starts; a keystroke arrives on the wall clock. Bridging them by timestamp would
make two identical play sessions produce different event streams. So the studio assigns ticks
itself — since #985 from the run's own tick timeline rather than from a counter, so a delivery lands
at the tick the learner is looking at (see "Deliveries are scheduled against the program's tick
clock" below). Nothing about *when* a key was pressed is recorded, only where the program had got
to — so "same seed + same input sequence ⇒ byte-identical event stream" holds exactly as it does for
the `input` answer FIFO, and is asserted directly.

**One honest limit shared by all three deliveries:** a scheduled occurrence fires only if the tick
clock reaches its tick, and only a `wait` pause advances that clock. A program that never waits
receives nothing — Stop's `"stop"` notification included — and still pays for the replay.

**What a delivery costs.** One execution per delivery, like an `input` answer. The canvas is
resumed with a single seek to the already-drawn boundary rather than replayed one step at a time,
so the **scene** fold over that prefix costs one array copy rather than one per event
([#977](https://github.com/pmalarme/open-logo/issues/977)). `run-controller.test.mjs` guards the
wiring — that the resume seeks once and never steps over the prefix — and `@openlogo/turtle`'s copy
counter guards the fold against the copy mechanisms the original defect used (that counter's doc
block records what it does *not* cover). Neither is a proof of linearity in general, and none of
this extends to a Sprites-heavy stream, whose world fold is quadratic in several independent ways
(turtle-map copies on spawn and on state changes, plus an addressed-set scan per addressing
snapshot) — separate costs #977 did not address.

**The mechanism is #769's replay, extended.** A delivery appends to the chain's schedule and runs
another attempt of the *same* chain — same captured source, same pinned seed. The canvas resumes
rather than redrawing, because the replay is fast-forwarded past what the live animation had already
drawn. A delivered
replay deliberately does **not** re-announce `runStatus` as `"running"`: it is the same run with more
input, and `run-log.ts`/`tutor-output-pane.ts` accumulate on the `"running"` → terminal transition, so
announcing it would file a run-log entry per keystroke.

**A delivery is accepted only when all three hold**, each measured rather than assumed:

- the chain is live — `run()` opens the window and Stop/Reset close it. A `step()` preparation never
  opens it, and `run()` does not open it while an *unfinished* stepping session is still in progress
  (measured: `step()` then `run()` leaves `runStatus` at `"running"` and refuses delivery). That
  fails safe — it refuses, never intercepts;
- the program actually registered a handler of that kind, according to its own `primitive` trace
  event (`spec/interaction-events.md:120-122`), so a non-interactive program is never re-executed by
  a stray keystroke;
- **no `input` question is outstanding right now.** `spec/interaction-events.md:108-111` blocks
  handlers *until the read finishes*, and this is exactly that — a transient block, matching the
  spec's "until". Until #976 the studio was stricter: a chain that had *ever* asked a question
  refused delivery for the rest of its life, because a delivery was then scheduled at a synthetic
  tick that could land *before* the read and rewrite history the learner had already observed. The
  permanent gate is **deleted** rather than narrowed — but the tick timeline alone did not earn that
  deletion, and an earlier version of this section claimed it did. What replaces the gate is the
  re-clamp below. An answer chain mid-pump is still refused — it is what stops a synchronously-
  answering prompt host being handed one more read per answer (the quadratic hang the `#881`
  section describes).

**What actually makes the deletion safe: `reclampUndeliveredTail()`.** `Math.max` of three terms:

| floor | why | pinned? |
| --- | --- | --- |
| `occurrence.tick` | a learner cannot press a key earlier than their previous press. **Not** because the runtime requires order: `packages/runtime/src/execute-internal.ts:5565` sorts, so it normalises an unsorted schedule | yes, 1 test — but it took ten rounds; see below |
| `tickAtEventIndex(chainTickTimeline, drawnEventCount)` | never deliver into a picture the learner has already seen — that is the history-rewrite the old permanent gate was blocking | yes |
| `lastAnsweredReadTick + 1` | `spec/interaction-events.md:108-111`: a delivery must not land at or before a read it should have followed | yes, 1 test |

**The first term took ten rounds to pin, and the story is the point.** It is the only floor covering
an occurrence appended **re-entrantly during** `drainDeliveredInput`'s loop — the re-clamp runs once
*before* that loop and never revisits it. Neutralising it to `const tick = 0` left the whole suite
green from round 1, and it twice came close to being deleted as dead. Every probe reached it through
`deliverKey`, whose second, unbounded drain silently repairs the mutation.

**A mutation that survives tells you where your probes go, not only what your tests check.** That is
the sharper form of the rule, and it is exactly what the round that deleted a floor on "no test
moves" was missing.

It is raised **at delivery time, not at schedule time**, because the drawn and answered-read floors
keep *moving* while an occurrence waits: a copy taken when the input arrived is stale by the time it
is delivered.

**It is called from both paths that turn the schedule into a request** — `drainDeliveredInput`, and
`stop()`'s direct `beginAttempt`. There are **four** `beginAttempt` call sites, and the other two are
safe for reasons *other* than the re-clamp, recorded here so the next reader does not have to
re-derive them — that enumeration is what caught the bug below:

- `pump()` — `run()` resets the schedule to `[]`.
- the lazy `step()` — reachable only before any run, where the schedule is empty and the chain does
  not accept host input.

Deleting the schedule-time copy without adding the second call was
a regression review caught: `stop()` does not drain, so its `when "stop"` notification kept tick 0,
was consumed during a leading `wait` before the handler had registered, and the pre-termination
notification `spec/interaction-events.md:152-156` requires was lost with no diagnostic. One function
called twice rather than a floor duplicated at each site, because duplication is exactly the
redundancy the deletion removed. Both call sites are load-bearing and cover disjoint tests.

### Deliveries are scheduled against the program's tick clock (#985)

`spec/interaction-events.md:69-73` makes a tick "an implementation-defined logical frame used by
rendering, animation, and event dispatch" — **one clock for all three**. The studio used it for none
of them, and #985 recorded the two consequences separately: **F3**, deliveries scheduled at a
counter, and **F4**, `wait n` not pacing playback. They share that one root, so the tick timeline
(`ExecuteOptions.tickTimeline` + `tickAtEventIndex`) fixes both.

**Both hosts compose the sink.** `ExecutionSettlement.tickTimeline` is **required**, not optional,
because it was optional for one review round and the Worker host silently omitted it: every Worker
delivery then landed at tick 0 — worse than the counter it replaced, not a graceful degradation.
A required field makes that omission a type error rather than a silence, and the two hosts are
asserted to schedule the same program's presses at the same ticks.

The *n*-th delivery used to take tick *n*, from a counter unrelated to the program. That counter was
#985's F3: measured on `[wait <lead>] / on_key "up" [ … ] / wait 6`, the presses lost equalled the
lead's tick count exactly — lead 1 lost 1, lead 5 lost 5 — because each early delivery was scheduled
at a tick that had already passed before the handler existed.

A delivery now lands at the tick the learner is actually looking at, read from the run's own tick
timeline (`ExecuteOptions.tickTimeline` + `tickAtEventIndex`, #985). The schedule stays a pure
function of the input sequence and the program — never of the wall clock — so two identical play
sessions still produce byte-identical event streams.

### `wait n` paces the animation (#985 F4)

The other half of the same root. Playback used a uniform per-step delay and never consulted the
clock, so `wait 0`, `wait 1` and `wait 9` were **identical** — 3 callbacks, delays
`[505, 505, 505]`, total 1515 for all three — identical to the no-`wait` control's own per-step
delay. A learner writing `wait 9` to slow a drawing down saw
no difference at all.

A step's delay is now scaled by the ticks that step spends: `1 + elapsed`, its own drawing time plus
its pause. Measured on `forward 10 / wait n / forward 10`:

| program | delays | total |
|---|---|---|
| `wait 0` | `[505, 505, 505]` | 1515 |
| `wait 1` | `[505, 1010, 505]` | 2020 |
| `wait 2` | `[505, 1515, 505]` | 2525 |
| `wait 9` | `[505, 5050, 505]` | 6060 |
| *no `wait` (control)* | `[505, 505]` | 1010 |

`1 + elapsed` rather than `max(1, elapsed)` is what keeps `wait 0` and `wait 1` distinguishable —
`wait 0` yields without advancing the clock, so it spends 0 ticks and costs 1, while `wait 1` spends
one and costs 2. An ordinary drawing step spends no tick and costs exactly 1, so every program below
the Interaction profile paces exactly as it did before.

The step is priced **before** it runs, from `TurtleAnimationController.nextStepEndIndex()`, not
after. That matters for `spec/interaction-events.md:116-118` — "hold itself open with a long `wait`
while those handlers drive the animation" — because that is a *trailing* `wait`, and a trailing step
has no successor to charge: pricing backwards left `wait 20` and `wait 1` both at 1010. Asking the
animation controller rather than re-deriving the step boundary keeps #1022's single definition
single; a host pricing a step differently from the step it actually gets is a defect with no witness.

Two consequences, both deliberate:

- **A program is responsive for as many inputs as the learner gives it.** The old counter capped the
  number of presses at the program's tick count, so `wait 5` accepted five and then went silent —
  an artifact of the counter rather than a decision.

  **Delivery closes for a program whose clock offers no further yield (#1039).** An earlier version
  of this
  bullet argued from `spec/interaction-events.md:381-384` that *cancellation* is what "stops future
  handler delivery" and nothing names tick exhaustion. Review rejected that reading, correctly:
  `:381-384` says cancellation stops delivery, it does **not** say cancellation is the only way a run
  closes — and `:198-200` says plainly that once the main line has finished "the run closes". The
  maintainer then ruled: *"If the program is ended it should refuse it. If there is a `wait` the
  program is not ended — it is still running."*

  Neither obvious guard could express that. `runStatus` flips to `"done"` when `run()` returns, and
  `animation.status` is `"done"` once `cursor >= events.length`; under the default
  `IMMEDIATE_SCHEDULER` playback drains inside `run()`, so **both read `"done"` for a program sitting
  in a `wait`**. Measured as a mutation arm: gating on `animation?.getSnapshot().status !== "done"`
  fails **40 of the 620** studio tests, the `wait 300` case among them, because it refuses everywhere
  except a paced host. Both read *playback*; the ruling is about the *program*.

  So `run-controller.ts`'s `programIsStillRunning` asks a different question: **has this program got
  a yield left for a delivery to land on?** A scheduled occurrence is dispatched at a yield, and
  `runWait` is the only place the runtime yields — once per tick it advances to, and once at the
  current tick for `wait 0`. #985's tick timeline records every advancing yield, so its last boundary
  is the program's last one; the `wait 0` yield records none, so the run's own trace (`wait`'s
  `primitive` event) carries that case. Those two are not interchangeable: a run that never waited
  and a run whose only wait was `wait 0` have **byte-identical empty timelines** and opposite
  dispatch behaviour, and only the primitive tells them apart. The test is then that last yield
  against the tick the delivery would be clamped to — the drawn floor and the answered-read floor.
  Playback enters only as that floor, and the floor is *compared against the clock*, which is why the
  immediate scheduler does not defeat it: a fully-drawn `wait 300` program has floor `300` and last
  yield `300`.

  Measured under `IMMEDIATE_SCHEDULER`, three presses each:

  | program | before #1039 | after #1039 |
  |---|---|---|
  | `on_key … / wait 300` | `[true, true, true]` | `[true, true, true]` |
  | `on_key … / wait 0` | `[true, true, true]` | `[true, true, true]` |
  | `on_key …` (no `wait`) | `[false, false, false]`, **3 replays** | `[false, false, false]`, **0 replays** |

  The boolean an ended program returns is therefore unchanged — the runtime never had a checkpoint to
  dispatch into — but the studio no longer replays the whole program to discover that, and a chain
  whose `input` finished on the program's last tick is refused up front instead of losing the press
  silently.

  **"Ended" here means the clock offers no further yield**, which is narrower than `:198-204`'s "the
  run closes once the main line has finished". Three shapes fall in the gap, all measured identical
  at `492cdff7` — this predicate neither causes nor fixes them, and refusing them would contradict
  the ruling's "if there is a `wait` the program is not ended":

  | program | presses | replays |
  |---|---|---|
  | `wait 1 / on_key …` — the only yield precedes the registration | `[false, false, false]` | 3 |
  | `on_key … / wait 1 / print "after"` — `["after"]` becomes `["turned","turned","turned","after"]` | `[true, true, true]` | 3 |
  | `on_key … / wait 3 / forward 10` — main line finished, still live | `[true, true, true]` | 3 |

  A bare `forever` (no `wait` inside) is the mirror case: it never yields, so it is refused — the
  runtime's `dispatchDueHandlers` has exactly one call site, inside `runWait`, so no press could ever
  have fired there. Its boolean is unchanged from `492cdff7`; only its three wasted replays are gone.
  All four shapes are pinned by tests so a later maintainer ruling has something to flip.

  Two things are deliberately **outside** the gate: Stop's `when "stop"` notification, which is the
  program's own pre-termination hook rather than input arriving at a live program, and any delivery
  arriving while an attempt is still in flight — `attemptPending` is host state, not liveness (it
  also covers a finished execution whose settlement is still in transport), so the conservative
  answer is to schedule and let `reclampUndeliveredTail` re-judge against the fresh settlement. Both
  halves of that boundary are now pinned: folding the term into the bare `acceptsHostInput`, which
  the drain loop calls, fails `#976: a delivery racing resolveRead is EVENTUALLY replayed`; folding
  it into `acceptsHostInputFor`, which only reaches Stop, left the suite green until
  `#952 (QA finding 1)` gained a replay-count assertion. Dropping the `attemptPending` guard fails
  two tests, `#976 AC2: a DEFERRED delivery is re-clamped past a read that finished while it waited`
  observing `["A","C","B"]` instead of `["A","C","turned","B"]`.
- **Known limitation — under the synchronous replay host a handler registered *by* a handler cannot
  be reached.** With the default `IMMEDIATE_SCHEDULER` the animation is fully drawn the moment a
  replay settles, so every delivery lands on the program's final tick, and the runtime claims pending
  keys against the handlers that exist when a tick's dispatch begins. Measured on
  `on_key "up" [ on_key "down" [ print "inner" ] ] / wait n` across `n` = 2, 4 and 20: outer `true`,
  inner `false`, both scheduled at the final tick. It fails in the **visible** direction — the inner
  handler simply does not fire, nothing is swallowed and no press is lost — and a **paced** host does
  not exhibit it, because its drawn tick genuinely advances between presses.
  `spec/interaction-events.md:79` is why there is no later tick to use: *"a handler does not extend
  the run's lifetime"*. The language-level contract is unaffected, which the conformance corpus
  proves independently — `interaction-events/on_key/on-key-registering-every-stays-clean` schedules
  its press at an explicit `{tick: 1}` and the nested `every` fires 3 times over the remaining 39
  ticks. This is the replay host choosing the tick, not the runtime's dispatch rule. See
  [#977](https://github.com/pmalarme/open-logo/issues/977).

Note what is deliberately **not** a gate: whether an execution has settled. Once the run's **first**
settlement has landed, a delivery arriving while a later attempt is in flight — reachable only under a
host that settles across event-loop turns — is still *scheduled* and replayed when that attempt lands.
Refusing it made the recorded schedule depend on
settlement pacing (measured: the same two calls recorded two entries under a synchronous host and one
under a deferred one) and dropped the key, where `:91-93` requires the most recent key and click state
to be preserved. *Before* that first settlement the registration gate has nothing to read, so a
delivery in that one-settlement-wide window is refused and dropped — it fails safe, but the
pacing-independence claim is genuinely "after the run's first settlement".

**Stop notifies the program first.** `"stop"` is "a requested stop notification **before**
termination" (`:152-156`), so `stop()` schedules it as a named event and replays once before latching
the cancellation signal — but only for a program that registered a `when` handler, so every other
Stop is byte-for-byte the Stop it always was. Subject to the tick limit above: a program with no
`wait` never reaches the notification's tick. If the notification block itself reaches an `input`,
that read is withdrawn rather than left answerable over a `"stopped"` run.

### Supported key words

`spec/interaction-events.md:224-225` asks implementations to document theirs.
`src/key-words.ts`'s `normalizeKeyWord` maps a browser `KeyboardEvent.key` onto:

| Key | Word |
|---|---|
| `ArrowLeft` / `ArrowRight` / `ArrowUp` / `ArrowDown` | `left` / `right` / `up` / `down` |
| Space | `space` |
| `PageUp` / `PageDown` | `page_up` / `page_down` |
| `Enter`, `Escape`, `Tab`, `Backspace`, `Delete`, `Home`, `End` | their own lowercase name |
| any single printable character | that character, lowercased (`A` → `a`) |
| anything else the platform reports | its own lowercase name (`F1` → `f1`) |

A **bare modifier** (Shift, Control, Alt, Meta, Caps Lock, …) and the browser placeholders
`Unidentified`/`Dead` are **not** key presses: they deliver nothing, so tabbing to the canvas with
Shift held does not spend a tick.

```logo
on_key "left" [
  left 15
]
on_key "space" [
  stamp
]
wait 300
```

### The pointer, and its accessible equivalent

`on_click` fires when the surface "is clicked **or activated by an equivalent accessible action**"
(`:214-215`). `src/canvas-interaction.ts` wires both, and neither is a fallback for the other:

- the canvas's own pointer `click`;
- `#canvas-activate-button`, a real, labelled, tab-reachable button the browser natively operates
  with Enter and Space, announced as a button and present in `REPL_FOCUS_ORDER` right after the
  canvas it activates.

It is a **separate control** rather than Enter/Space on the focused canvas because the canvas is also
the keyboard surface: `"enter"` and `"space"` are key words in their own right, so a learner writing
`on_key "space"` must receive a space press, not an activation. Carrying no click *position* is not a
shortcut either — OpenLogo v0.1 "does not standardize click coordinate reporters" (`:216-218`), which
is precisely what makes a keyboard activation an *equal* click rather than a degraded one.

Arrows, space, and the paging keys have their browser default suppressed — but **only on synchronous
confirmation that the press itself ran a handler**, reported by `deliverKey`. So a program registering
`on_key "up"` stops only `up` from scrolling, and one with no `on_key` stops nothing.

Where there is no such confirmation, nothing is suppressed — and that covers two different
situations, which are worth keeping apart:

- **Nothing ran, and that is known** — a key no handler names, or a press past the program's last
  usable tick. Not suppressing is *exact*.
- **Something may have run, but it cannot be confirmed in time** — every press under the Worker host
  (measured: `preventDefault` never called while the program still printed its handler's output), and
  any press for a non-literal `on_key` key word. Not suppressing is *conservative*: the studio
  declines to intercept a key it cannot prove was the program's.

Neither situation over-suppresses, which is the property that matters. `"tab"` is never suppressed
even on confirmation: it is how a learner leaves the canvas, and a running game that swallowed it
would be a keyboard
trap. `"enter"` and `"escape"` are left alone for the same reason.

All of this lives in `src/`, not in `web/main.ts`: `web/**` is outside the `src` build graph, so it
is **neither type-checked nor linted** and no test imports it, yet it is bundled and shipped.
`web/main.ts` looks up the two elements and hands them to `mountCanvasInteraction`, and makes no
decision of its own — asserted by `index.test.mjs`.

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
  (deferred to the Studio Stepper epic #302, per `a11y.ts`'s doc comment) — this
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
  region over the shared store's `turtleWorld` slot (the same one #218 paints from and #228 pushes
  into on every run tick/`step()`/`reset()`), built from `@openlogo/turtle`'s published
  `describeTurtleWorldState` (position/heading/pen wording, never re-derived here — plus, once the
  world holds more than one live turtle, the `turtle #<id>` name of the turtle being described, #749,
  and — whenever the addressed set is not simply that turtle — the set itself, as
  `addressed turtles #1 #2. turtle #2 at x …`, #770: the consumer half of the addressing
  snapshots #766 publishes in the trace stream, which is what lets an `ask`/`each` block's restore
  name the set that is addressed again while still reporting the change the block made)
  plus, when available,
  a trailing "current instruction `<exact source text>`" clause — `spec/rendering.md`'s Non-visual
  state descriptions minimum requires surfacing the current instruction alongside pen/visibility
  state. `run-controller.ts` maps each pushed turtle snapshot to the `source_span` of the most
  recently consumed `"instruction"` trace event (`state.currentInstructionSourceSpan`), and this
  module slices that exact span out of `state.source` — the learner's own spelling, verbatim, never
  reformatted. The clause is omitted entirely (not a placeholder) before any run/step has happened,
  or after `reset()`. Unlike the announcer's growing log, `getText()` always returns the *current*
  description (available immediately, even before any run), and `subscribeText(listener)` notifies
  every listener with the new text whenever `turtleWorld`/`currentInstructionSourceSpan` changes —
  so the region reads in lockstep with the Canvas view as a program runs, and multiple consumers
  never desync.
- No shell region/mount function is added for the announcer or the turtle-state region — both are
  cross-cutting services over the existing store, not panes with their own mount lifecycle.

## Turtle Canvas view (#218, driven live by Run/Stop/Reset in #228)

**#218 delivered static composition** — the initial default turtle state/scene, painted once at
mount. **#228 (above)** wires `run-controller.ts` to update `turtleWorld`/`turtleScene` after each
run/step/reset and repaint the pane live, in lockstep with output/diagnostics.

- `state-model.ts` gains `turtleWorld`/`turtleScene` on `StudioState`, reusing `@openlogo/turtle`'s
  own `TurtleWorldState`/`TurtleScene` types verbatim (never a studio-invented fork) and defaulting to
  its program-start `INITIAL_TURTLE_WORLD_STATE`/`INITIAL_TURTLE_SCENE` — origin, heading `0`, pen down,
  color `"black"`, width `1`, visible, background `"white"`, no drawing items.
- **The DOM ownership boundary**: `@openlogo/turtle` is deliberately DOM-free — its `RenderTarget`
  is a hand-written minimal structural subset of the real Canvas 2D drawing API (this monorepo has
  no `lib.dom` and no `node-canvas` dependency). `src/canvas-view.ts`'s
  `Canvas2DContext` names that same real-context surface from the studio side, and
  `createCanvasRenderTarget(context)` wraps it into `@openlogo/turtle`'s `RenderTarget` — a real
  forwarding adapter (not a pass-through, since a real `CanvasRenderingContext2D`'s
  `fillStyle`/`strokeStyle` accept `CanvasGradient`/`CanvasPattern` too, wider than `RenderTarget`
  declares) — the DOM canvas lives in studio, never in `@openlogo/turtle`.
- `createCanvasViewController(state, { target, viewport })` reads `state.getState().turtleWorld`/
  `.turtleScene` and paints them through `@openlogo/turtle`'s `paintTurtle` — never re-deriving
  turtle coordinates, colors, or scene items itself. `repaint()` always reads the *current* store
  snapshot, so it never goes stale relative to whichever pane last wrote `turtleWorld`/
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

Presentation-only slice (epic #290, Studio UX polish track): from a 48rem (~768px) viewport up,
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

Epic #290, Studio UX polish track: before this slice, the `#output` pane held only the LATEST
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


