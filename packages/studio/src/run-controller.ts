/**
 * The Run/Stop/Reset/Step controller (#126) — wires the shared studio state model (#123) to
 * `@openlogo/runtime`'s {@link execute} and the execution-safety gates issue #102 added
 * (`ExecuteOptions.instructionBudget`/`recursionDepthLimit`/`signal`,
 * `spec/execution-model.md:623-629`). This module composes the runtime only: it never
 * re-implements evaluation, and every printed value it surfaces is already in the runtime's own
 * canonical form (`printedForm`), never re-formatted here.
 *
 * ## Run
 * `run()` executes the shared state model's current `source` via `execute()` and reduces the
 * returned trace-event stream (`@openlogo/core`'s `OL_EVENT_KINDS`) down to exactly what this
 * slice surfaces: every `print` event's payload becomes one learner-visible `output` line
 * (`state.setOutput`), and the run's diagnostics (parse or runtime) replace the shared
 * `diagnostics` list unchanged — the diagnostics pane (#125) renders them, this module never
 * invents its own diagnostic shape.
 *
 * ## #334 — injecting `@openlogo/edu`'s tutor templates + surfacing `tutor-output`
 * The run passes `tutor-output-pane.ts`'s {@link eduTutorTemplate} as
 * `ExecuteOptions.tutorTemplates` (A2, #332's injectable seam) so `explain`/`why`/`hint`/`debug`
 * emit `@openlogo/edu`'s real curriculum-quality prose instead of the runtime's minimal built-in
 * `defaultTutorTemplate` fallback — this module still never chooses that pedagogy itself, it only
 * composes the HOST's template into the runtime call, exactly as it already composes
 * `instructionBudget`/`recursionDepthLimit`/`signal`. (#876 moved the composition itself into
 * `execution-host.ts`'s `toExecuteOptions`, so every host does it identically; the decision is
 * unchanged.) Every `tutor-output` event the run emits is
 * then reduced (mirroring `collectOutput`'s `print`-event reduction) into the shared state model's
 * `tutorOutput` field (`state.setTutorOutput`) — `tutor-output-pane.ts`'s controller is what
 * accumulates these across runs into the pane's growing, learner-visible history.
 *
 * ## Stop and the same-thread cancellation caveat
 * `@openlogo/runtime`'s {@link CancellationSignal} is checked before every statement/loop pass
 * *within* a single `execute()` call, so it is the correct mechanism to cancel a loop already in
 * progress — but `execute()` is synchronous and never yields, so a same-thread caller (this
 * module, running in a browser's main thread with no Worker) cannot itself invoke `stop()` while
 * a `run()` call is on the stack; nothing else runs until `execute()` returns
 * (`ExecuteOptions.signal`'s doc comment in `@openlogo/runtime` explains why cross-thread shared
 * state, e.g. a Web Worker + `SharedArrayBuffer`/`Atomics`, is what a truly interruptible Stop
 * needs). This controller is honest about that: it does not promise to preempt an in-flight
 * synchronous call. What it *does* provide, both reliably:
 * - The **instruction budget** (`ExecuteOptions.instructionBudget`, default
 *   {@link DEFAULT_INSTRUCTION_BUDGET} unless overridden via {@link RunControllerOptions}) halts
 *   any `forever`/`repeat 10000 [ forward 1 ]`-shape runaway program with `ol-limit` well before
 *   it could hang the session — this is the mechanism that actually keeps a same-thread studio
 *   responsive, budget bound rather than button-press bound.
 * - `stop()` flips a signal this controller owns for its whole lifetime. Once cancelled, that
 *   signal *stays* cancelled — `run()` deliberately does not clear it — so calling `run()` again
 *   after a `stop()` halts immediately with `ol-limit`/`cancelled` rather than silently
 *   discarding the stop request; only `reset()` re-arms the signal for the next `run()`. This
 *   also makes the wiring itself fully headless-testable: `stop()` then `run()` deterministically
 *   reproduces "cancellation takes effect", exactly as it would if a future async/Worker executor
 *   flipped the same signal mid-loop.
 *
 * ## Reset
 * `reset()` clears `output`/`diagnostics` back to empty, re-arms the cancellation signal, and
 * sets `runStatus` to `"idle"` — deterministic, ready-for-next-`run()` state, per the issue's
 * Given/When/Then.
 *
 * ## #228 — driving the turtle Canvas view (#218) in lockstep
 * `execute()` still runs the whole program atomically in one synchronous call and returns the
 * *complete* trace-event stream at once — that hasn't changed, and this module still never
 * re-implements evaluation. What #228 adds is a **replay** of that already-complete stream through
 * `@openlogo/turtle`'s published `TurtleAnimationController` (#216), so the same one event stream
 * that already drives `output`/`diagnostics` also drives the Canvas pane, in lockstep:
 * - `run()` builds a `TurtleAnimationController` over the run's `result.events` and starts it via
 *   `@openlogo/turtle`'s `playWithMotionPreference` (honoring {@link RunControllerOptions.reducedMotion}).
 *   Every consumed tick pushes the controller's folded `world`/`scene` into the shared state model
 *   via `setTurtleWorld`/`setTurtleScene` (#218) and, if a {@link RunControllerOptions.canvasView}
 *   was supplied, calls its `repaint()` immediately — the same composition seam #218 published,
 *   invoked directly rather than duplicated.
 * - `step()` is no longer a no-op: it now realizes what its old doc comment deferred, by advancing
 *   the **animation** one instruction-step over the already-complete stream (never the runtime,
 *   which exposes no per-instruction pause/resume API) and pushing the resulting snapshot.
 * - `stop()` additionally pauses the animation (`TurtleAnimationController.pause()`), so a
 *   still-advancing Canvas view halts at exactly the same point the cancellation signal takes
 *   over the underlying `execute()` call — see `TurtleAnimationController`'s own doc comment for
 *   why a stale scheduled tick can never fire after `pause()` and double-advance the picture.
 * - `reset()` additionally resets the animation and restores `turtleWorld`/`turtleScene` to
 *   `@openlogo/turtle`'s program-start defaults, repainting a blank Canvas alongside the rest of
 *   the studio state clearing.
 * - The default {@link RunControllerOptions.scheduler} is `@openlogo/turtle`'s
 *   `IMMEDIATE_SCHEDULER`, which drains the whole animation synchronously within `run()` —
 *   preserving #126's existing "run() returns already complete" behavior for this headless slice
 *   and every existing test. A real browser entry point injects a `setTimeout`-backed
 *   {@link Scheduler} for actual paced playback; `@openlogo/turtle` stays timer-free (studio owns
 *   the DOM/timer side, the same boundary #218 drew for the canvas context).
 * - `runStatus` still reflects `execute()`'s own completion (`"done"`/`"stopped"`, from the run's
 *   diagnostics — #311 renamed the non-`stop()` completion value from `"idle"` to a distinct
 *   `"done"`, see `state-model.ts`'s `RunStatus` doc comment) exactly as #126 established — but
 *   with a real paced scheduler that flip is deferred until the *animation* itself actually
 *   reaches its own (unrelated, `@openlogo/turtle`-owned) `"done"` status (or `stop()` fires, which
 *   sets `"stopped"` immediately), so a paced Canvas view mid-animation is not reported as already
 *   finished. With the default synchronous scheduler this happens within the same `run()` call,
 *   matching every pre-#228 test unchanged. `output`/`diagnostics` are still set synchronously and
 *   in full the moment `execute()` returns (unchanged from #126) — they were never paced to begin
 *   with, so there is nothing for them to desync from while the Canvas animation continues to play
 *   out the same already-computed stream.
 *
 * ## #310 — a configurable turtle-speed slider
 * Before this slice, `TurtleAnimationController`'s own pacing (`stepsPerSecond`/`setSpeed`) was
 * never wired from studio's side — every run played back at whatever pace the injected
 * `Scheduler` happened to use. `prepare()` now reads the shared state model's `speedSliderValue`
 * and maps it (`turtle-speed.ts`'s {@link mapSpeedSliderValueToTickDelayMs}, the one tested place
 * that owns this decision) to a per-tick delay, remembering whether that delay counts as
 * "instant" ({@link isInstantTickDelay}) for `run()` to use. A **paced** delay becomes the
 * `TurtleAnimationController`'s `stepsPerSecond` option (via
 * {@link tickDelayMsToStepsPerSecond}); an **instant** delay is never passed as `stepsPerSecond`
 * at all (that would require an infinite/zero value the controller's own speed-clamping cannot
 * represent) — instead `run()` combines it into the existing `reducedMotion` flag it already
 * passes to `playWithMotionPreference` (`instant || (options?.reducedMotion ?? false)`), which
 * already knows how to paint a finished scene instantly via `seekToEnd()`. This makes the
 * slider's "instant / no animation" end **complement**, not replace, the OS-level
 * `prefers-reduced-motion` path: either one alone is enough to force instant playback, and
 * neither overrides the other's own reasoning for wanting it.
 *
 * ## #289 — `step()` from the initial idle state (before any `run()`)
 * `run()`'s body was always two halves: *prepare* (execute the source, surface output/diagnostics,
 * build a fresh `TurtleAnimationController` over the run's event stream) and *play* (start that
 * controller animating via `playWithMotionPreference`). `step()` used to only ever operate on an
 * animation `run()` had already prepared, so pressing "Next step" before the first `run()` was a
 * silent no-op — confusing from a blank studio. The *prepare* half is now its own private
 * `prepare()` helper, shared by both: `run()` still calls `prepare()` then immediately plays the
 * result, unchanged; `step()` now calls `prepare()` itself, lazily, whenever no animation exists
 * yet (i.e. `animation` is still `null`, exactly the state `reset()`/program-start leave it in),
 * then steps the (freshly prepared or already-running) animation by one instruction. This makes
 * `step()` a genuine "run one instruction" affordance from a blank studio, not just a scrubber over
 * an animation `run()` must have already started.
 *
 * ## #314 — `run()` never overlaps a still-animating run
 * With a real paced `Scheduler` (the browser's `setTimeout`-backed one; the default
 * {@link IMMEDIATE_SCHEDULER} never leaves this window open), `runStatus` stays `"running"` for the
 * whole animation, across many event-loop turns — during which a learner could press **Run** again.
 * Before this guard, a second `run()` call would silently `prepare()` a brand-new run mid-animation:
 * `output`/`diagnostics` would jump straight to the *second* run's results while the first run's
 * animation was still playing, and the first `TurtleAnimationController` would be orphaned (its
 * already-scheduled ticks still fire, racing the new one). The run log (`run-log.ts`) depends on
 * observing exactly one `"running"` → terminal transition per completed run — an overlapping second
 * `run()` would silently absorb the first run into the second's entry, losing it entirely, which
 * directly contradicts the "keeps the earlier run" acceptance criterion. `run()` now simply ignores
 * a call while `runStatus` is already `"running"`, so a run always finishes (or is `stop()`ped)
 * before another can start — the same "Stop is the only way to interrupt" contract the instruction
 * budget already gives a runaway program, now also guaranteed against a same-thread double-click.
 *
 * ## #769 — the `input` prompt and the synchronous reader
 * `@openlogo/runtime`'s host reader (#681,
 * `ExecuteOptions.hostInput.read?: (prompt: string) => string | undefined`) is **synchronous**:
 * `spec/interaction-events.md:108-111` requires that no OpenLogo instruction and no handler block
 * runs until a read finishes, and a synchronous call is that guarantee by construction. `execute()`
 * itself never yields either (see the Stop caveat above), so a same-thread browser host cannot
 * suspend inside `read` to await a styled, keyboard-operable, screen-reader-announced prompt. That
 * constraint is real, and this module does **not** work around it by changing runtime semantics —
 * the seam is used exactly as specified.
 *
 * What it does instead is an **attempt chain**. When a {@link RunControllerOptions.inputPrompt} host
 * is supplied, the default (in-process) execution host installs a reader that answers each read from
 * an accumulated FIFO of the
 * answers the learner has already given. The first read with no answer left records its prompt and
 * returns `undefined` — the reader's documented "cannot answer" ending, which cancels that
 * execution with `ol-limit`/`cancelled` at the waiting `input`. Such an attempt is a **probe**, not
 * a finished run: once its animation has drawn everything up to the read, the prompt is presented,
 * and when the learner answers, that answer joins the FIFO and the **same captured source** is
 * executed again from the top. N reads cost N+1 executions.
 *
 * **Why a replay honors "the program must not appear to continue".** The learner never observes the
 * cancel-and-re-run, because this module already reduces the *whole* event stream wholesale on
 * every attempt (`collectOutput` → `setOutput`, `setDiagnostics`, `setTutorOutput`, and a fresh
 * `TurtleAnimationController` over the run's events). Attempt *k+1*'s stream begins with attempt
 * *k*'s, so each wholesale replacement can only *extend* what is on screen: output grows
 * monotonically, the canvas resumes rather than blanking (the new animation is fast-forwarded past
 * the events already drawn — see `prepare()`), and no consumer double-counts, because
 * `run-log.ts`/`tutor-output-pane.ts` accumulate only on the `"running"` → terminal transition a
 * probe never reaches. From the learner's side the program stops at the question and continues from
 * exactly there, which is what `:108-111` asks a host to show.
 *
 * ## #881 — why "attempt *k+1* begins with attempt *k*" is now unconditional
 * Before #881 that claim carried a qualifier: it held only "for a program whose prefix is
 * deterministic". A program drawing unseeded randomness before a read re-randomized on every
 * attempt, so the replay could reach a **different question** than the learner was shown, and
 * already-drawn output could change underneath them.
 *
 * `run()` now pins **one `ExecuteOptions.randomSeed` (#865) per chain**, drawn from
 * {@link RunControllerOptions.randomSeedSource} (`Date.now` by default — the very seed the runtime
 * would otherwise have chosen for itself, so an ordinary run is no more predictable than before).
 * That closes it completely **for this host**, because `@openlogo/runtime`'s clock fallback is its
 * only *ambient* entropy source: nothing else there reads a wall clock or `Math.random()`, the tick
 * clock is a pure counter, and since #865 even a no-argument `randomize` derives its
 * implementation-chosen seed by advancing the generator instead of reading the clock. The runtime's
 * other two caller-supplied functions cannot reintroduce variance *here* either: this module's
 * `tutorTemplates` is `eduTutorTemplate`, a pure mapping, and its `hostInput.read` answers only from
 * the chain's frozen FIFO. So `execute()` is, for this caller, a function of the source and the
 * answers given — and every attempt of a chain is *bit-identical* up to the read the newest answer
 * extends. Concretely, for the whole program class #881 named:
 * - the branch a `random` chose does not change under the covers, and the question is not re-asked;
 * - the output and drawing the learner has already observed are never rewritten by a later attempt;
 * - two distinct `input` sites asking the identical prompt text each receive their own answer,
 *   because a read's FIFO position is now stable across attempts and therefore identifies the site.
 *
 * The seed is drawn **per chain, not per attempt** — that distinction is the whole fix, and
 * `run-controller-input.test.mjs` pins it with a seed source that hands out a different seed on
 * every call, so drawing per attempt diverges deterministically rather than by luck.
 *
 * What remains is not a correctness gap but a mechanism one: the read is still *reconciled* rather
 * than genuinely blocking, and N reads still cost N+1 executions. Issue **#876** (a Worker +
 * `Atomics.wait` execution host) is that mechanism; the replay stays as the degraded mode for any
 * deployment that is not cross-origin isolated.
 *
 * ## #876 — composing an execution host instead of calling `execute()`
 * This module no longer calls `@openlogo/runtime`'s `execute()` directly. It composes an
 * {@link ExecutionHost} (`execution-host.ts`), whose whole contract is "settle with an
 * {@link ExecutionSettlement}" — the events so far, their already-reduced output, the diagnostics,
 * and the question the run is suspended on. Everything this module does around a run is identical
 * whichever host is installed.
 *
 * - The **default** host runs `execute()` right here and settles **synchronously**, carrying #769's
 *   replay exactly as described above. Omitting {@link RunControllerOptions.executionHost} therefore
 *   changes nothing at all, which is why every pre-#876 test passes untouched.
 * - The **Worker** host (`worker-execution-host.ts`) runs the interpreter off-thread and parks
 *   inside the read on `Atomics.wait`. It settles once per outstanding read (a prefix, with the
 *   question) and once at completion, so a single execution answers however many questions — and
 *   `stop()`/`reset()` reach a *running* interpreter through shared memory, which is the
 *   **preemptible Stop** the same-thread caveat above has always named as impossible here.
 *
 * A host that genuinely suspends a read exposes `resolveRead`; the default one does not, and that
 * absence is exactly what tells this module to keep driving the attempt chain. So the two endings a
 * learner has — answer, dismiss — are one operation under a Worker (hand the outcome back to the
 * waiting execution and let it continue) and two under the replay (record the answer and run
 * another attempt, or publish the withheld cancellation).
 *
 * **`prepare()` above is now two functions.** `beginAttempt()` starts an attempt through the host;
 * `finishAttempt()` does everything the old function did once a settlement exists — reduce, publish,
 * build the animation, fast-forward past what is already drawn. **Every reference to `prepare()`
 * anywhere in this file — this header block *and* the per-function and per-field doc comments
 * below — means that pair.** Those older sections are deliberately left as they were: each records
 * what the code did at the issue it names (#126, #228, #289, #769, #881), and rewriting them would
 * retroactively falsify that record rather than document a change. `run()` still returns `void`: this controller was already
 * asynchronous-by-continuation (`present`/`respond`, generation counters, a paced scheduler that
 * leaves `runStatus` at `"running"` across many event-loop turns), so a host that settles through a
 * callback needed no new shape.
 *
 * See `docs/adr/0023-worker-execution-host.md` for why the replay is kept rather than deleted (the
 * Worker host needs COOP/COEP cross-origin isolation, a deployment posture), and for the bound that
 * replaces the retry cap #881 removed: a Worker host **never replays to answer a read**, so there is
 * no attempt sequence to diverge and nothing for a counter to count. (Since #952 it does replay to
 * deliver *input* — a different chain, driven by learner keystrokes rather than by answers, and one
 * that is refused outright once a read has happened under such a host. See "#952" below.)
 *
 * {@link resolveRecordedAnswer}'s prompt pairing is kept as defence in depth rather than deleted:
 * it is what makes "an answer can never reach a question the learner was not shown" true **by
 * construction** instead of by trusting the determinism argument above, and it costs one comparison
 * per read.
 *
 * The chain's **no-progress retry cap** (`MAX_INPUT_REPLAY_RETRIES`, removed by #881) went the
 * other way, because #881 makes the situation it guarded provably unreachable rather than merely
 * unlikely. The cap ended a chain whose replay kept diverging and therefore kept answering nothing
 * new. But a read at FIFO position *i* takes its prompt from the source, the chain's pinned seed,
 * and answers *0…i-1* — all frozen for the life of the chain, since an answer is recorded once and
 * never revised. So position *i*'s prompt is **invariant across attempts**; the FIFO grows by
 * exactly one entry per attempt, and a chain can never fail to make progress. Keeping a counter for
 * a branch no program can reach would have been untestable code guarding an impossible state.
 * (What the cap never covered, before or after, is a chain with genuinely *unbounded* reads such as
 * `forever [ :answer = input "?" ]` under a synchronous host — note the **assignment**: a bare
 * `input "?"` statement reads nothing at all, since a reporter in statement position is never
 * evaluated, and that program simply exhausts its budget. Every attempt of the assigned form
 * answers one more read, so it always counted as progress. A *single* `execute()` of it terminates
 * on the instruction budget. The studio's **replayed chain** of it terminates too, but only in
 * principle: attempt *k* answers just *k* reads, so the number of questions put to the learner is
 * linear in the budget (measured: 49 at a budget of 100, 499 at 1,000 — so about 500,000 at the
 * default), while the reads actually replayed across all those attempts grow *quadratically*, on
 * the order of 10^11. Treat it as a hang. What is bounded by
 * **nothing** at all is a *host* that restarts the run from inside `present()`, because each restart
 * brings a fresh budget; that is a host-contract matter and is documented on {@link InputPromptHost}
 * in `input-prompt.ts`.)
 *
 * A probe's own diagnostics are deliberately withheld while its question is outstanding, because the
 * only diagnostic a probe can carry is the reader's own forced cancellation: parse diagnostics stop
 * the program before any read can happen, and a runtime error halts execution at the failure —
 * which, for a probe, *is* that read. Publishing it would tell a learner the run was cancelled while
 * they are still being asked to answer. They are published unchanged the moment the learner
 * genuinely dismisses the prompt, because then the cancellation really did happen.
 *
 * `runStatus` stays `"running"` for the whole chain — the program *is* running, blocked on a read —
 * which also means `run()`'s #314 guard already ignores a second Run while a question is open, and
 * the Start/Stop toggle (`run-controls.ts`) already offers Stop. **Stop** withdraws the question and
 * commits the probe as the cancelled run it is (`"stopped"`); **Reset** withdraws it and clears
 * everything (`"idle"`); a late answer arriving after either is ignored via a generation counter.
 * `step()` deliberately does **not** drive this flow: it is a scrubber over an already-produced
 * event stream (see "#228" above), so there is no execution in progress for a read to block, and its
 * lazy `prepare()` therefore installs no reader at all — behavior unchanged from before #769.
 *
 * ## #952 — delivering keyboard and pointer input, so `on_key`/`on_click`/`when` actually fire
 * Until this slice the studio installed only `hostInput.read`. `on_key`, `on_click`, and
 * `when "stop"` therefore **registered, type-checked, highlighted as active keywords — and never
 * fired**: measured on `spec/examples/10-game.logo` (three `on_key`, one `on_click`), a
 * studio-equivalent run produced 131 events and **zero** prints with no diagnostic at all, while the
 * same program with `hostInput.events` supplied prints `1`, `2`. A learner pressed the arrow keys,
 * clicked the canvas, and got silence.
 *
 * `deliverKey`/`deliverClick` close that, and Stop schedules the `"stop"` named event
 * (`spec/interaction-events.md:152-156`: `"stop"` is "a requested stop notification **before**
 * termination"). All three go through the same mechanism — and share its one honest limit: a
 * scheduled occurrence fires only if the program's tick clock actually reaches its tick, and only a
 * `wait` pause advances that clock. A program that never waits therefore receives nothing, Stop
 * notification included, and still pays for the replay — see "What a delivery costs" below, because
 * on a program that has drawn a lot that bill is seconds, not milliseconds.
 *
 * ### Real time never reaches the event stream
 * `ExecuteOptions.hostInput.events` is a **static, tick-scheduled** list fixed before a run starts —
 * the runtime has no live input port, by design, and this module must not invent one. A keystroke
 * arrives with wall-clock timing; the tick clock is a pure counter. Bridging them by *timestamp*
 * would make two identical play sessions produce different event streams, destroying the replay
 * determinism `input` already depends on (#881).
 *
 * So the studio assigns the ticks itself: **the *n*-th input delivered to a run is scheduled at
 * tick *n***, from a counter that starts at 1 when `run()` starts a chain. Nothing about *when* the
 * learner pressed the key is recorded, only *how many* inputs preceded it. The schedule is therefore
 * a pure function of the input sequence, and "same seed + same input schedule ⇒ byte-identical event
 * stream" holds exactly as it does for the answer FIFO. The runtime imposes the normative same-tick
 * order (`when` → `on_key` → `on_click` → due `every`) at its own drain point, so this module never
 * reasons about ordering either.
 *
 * That mapping also gives the program the last word on its own lifetime, for free: `10-game.logo`
 * ends with `wait 300`, so its tick clock visits ticks 1…300 and the 300th delivery is the last one
 * that can fire. A press past that is still scheduled and still replayed; it simply reaches a tick
 * the program never gets to, and `deliverKey` reports `false` for it because nothing ran. The
 * boolean's one definition lives on {@link RunController.deliverKey}, where it is produced — it is
 * deliberately not restated here, because two sentences describing one boolean is exactly how the
 * two of them diverged and had to be reconciled twice.
 *
 * ### What a delivery costs
 * One execution per delivery, as an `input` answer does. `finishAttempt` resumes the canvas with a
 * single `seekToEventIndex` to the already-drawn boundary rather than stepping to it, so the
 * **scene** fold over that prefix costs one array copy rather than one per event — linear rather
 * than quadratic in how much has been drawn (#977). That is the claim `@openlogo/turtle` pins with
 * a test; it does not extend to a Sprites-heavy stream, whose per-event turtle-map copy is a
 * separate cost this change does not address.
 *
 * ### The mechanism is #769's replay, extended
 * A delivery appends to the chain's schedule and runs **another attempt of the same chain** — same
 * captured source, same pinned seed, same answers — exactly as a new `input` answer does. What the
 * learner sees is the canvas, output, and
 * turtle state updating to reflect the input they just gave, because the replay is fast-forwarded
 * past the events already drawn (`shownEventCount`, set from the live animation's own cursor) rather
 * than redrawing from a blank canvas.
 *
 * A replay for delivered input deliberately does **not** re-announce `runStatus` as `"running"`: it
 * is the *same* run with more input, not a new one. `run-log.ts` and `tutor-output-pane.ts`
 * accumulate on the `"running"` → terminal transition, so announcing it would file a fresh run-log
 * entry and re-append the tutor output on **every keystroke**.
 *
 * ### When a delivery is accepted
 * Three gates, all measurable rather than guessed:
 * - **The chain is live.** `run()` opens the window and Stop/Reset close it. A `step()` preparation
 *   never opens it: stepping is a scrubber, not an interactive run.
 * - **The program actually registered that handler.** Registration emits a `primitive` event named
 *   `on_key`/`on_click`/`when`, so the run's own trace stream answers this. A program that never
 *   registers one is not re-executed at all, which is what keeps this slice a no-op — not merely a
 *   cheap operation — for every non-interactive program and every test that predates it.
 * - **The chain has never asked the learner an `input` question.** A question outstanding refuses the
 *   delivery outright, because `spec/interaction-events.md:108-111` forbids running a handler block
 *   until the read finishes — and once one has been asked the window stays shut for the rest of that
 *   chain, which is stricter than `:108-111` requires and deliberately so. The studio has no tick for
 *   the read boundary, so the next delivery lands at tick 1 and the replay reaches an *earlier* point
 *   than the learner has already observed: measured, a key scheduled at tick 1 after an answered
 *   question introduced a question they had never seen, erased output they had already read, and left
 *   a prompt open over a `"done"` status. {@link resolveRecordedAnswer}'s prompt pairing stops an
 *   answer reaching the wrong question; it cannot stop history being rewritten. An answer chain
 *   mid-pump is refused for the same family of reasons — it is what stops a prompt host answering
 *   synchronously from inside `present()` being handed one more read per answer, the quadratic hang
 *   the "#881" section above describes.
 *
 *   So a program that uses `input` receives no delivered interaction for the rest of that chain.
 *   `run()`/`reset()` reopen the window. That deviation is tracked as **#976**; closing it depends on
 *   **#975** giving the runtime a delivery boundary (or live host input) rather than a static
 *   pre-run schedule.
 *
 * Note what is deliberately **not** a gate: whether an execution has settled. Once the run's **first**
 * settlement has landed, a delivery arriving while a later attempt is in flight — only reachable
 * under a host that settles across event-loop turns — is still *scheduled*, and replayed when that
 * attempt lands. Refusing it made the recorded schedule
 * depend on settlement pacing (measured: the same two calls recorded two entries under a synchronous
 * host and one under a deferred one) and dropped the key outright, where `:91-93` requires the most
 * recent key and click state to be preserved.
 *
 * *Before* that first settlement the registration gate has nothing to read — `run()` clears
 * `currentEvents` — so a delivery in that window is refused and dropped rather than buffered. It
 * fails safe (nothing is scheduled, nothing is suppressed) and the window is one settlement wide,
 * but the pacing-independence claim above is genuinely "after the run's first settlement".
 */

import type { CancellationSignal, HostInputEvent } from "@openlogo/runtime";
import type {
  Diagnostic,
  PrimitivePayload,
  SourceSpan,
  TraceEvent,
} from "@openlogo/core";
import {
  IMMEDIATE_SCHEDULER,
  INITIAL_TURTLE_SCENE,
  INITIAL_TURTLE_WORLD_STATE,
  playWithMotionPreference,
  TurtleAnimationController,
} from "@openlogo/turtle";
import type { Scheduler } from "@openlogo/turtle";
import type { AppShell } from "./app-shell.js";
import type { CanvasViewController } from "./canvas-view.js";
import { createInProcessExecutionHost } from "./execution-host.js";
import { collectDeclaredKeyHandlers } from "./key-words.js";
import type { DeclaredKeyHandler } from "./key-words.js";
import type {
  ExecutionHost,
  ExecutionRequest,
  ExecutionSettlement,
  RecordedAnswer,
} from "./execution-host.js";
import type { InputPromptHost } from "./input-prompt.js";
import type { RunStatus, StudioStateStore } from "./state-model.js";
import {
  isInstantTickDelay,
  mapSpeedSliderValueToTickDelayMs,
  tickDelayMsToStepsPerSecond,
} from "./turtle-speed.js";

/** The document identifier passed to `execute()` when the caller doesn't supply one. */
export const DEFAULT_RUN_DOCUMENT = "studio-session";

/** Optional configuration for {@link createRunController}. */
export interface RunControllerOptions {
  /** The document identifier passed to `execute()`. Defaults to {@link DEFAULT_RUN_DOCUMENT}. */
  readonly document?: string;
  /** Overrides `ExecuteOptions.instructionBudget` for every `run()` call. */
  readonly instructionBudget?: number;
  /** Overrides `ExecuteOptions.recursionDepthLimit` for every `run()` call. */
  readonly recursionDepthLimit?: number;
  /**
   * Paces the turtle Canvas view (#228) alongside the run's output/diagnostics. Defaults to
   * `@openlogo/turtle`'s `IMMEDIATE_SCHEDULER`, which drains the whole animation synchronously
   * within `run()` (preserving #126's existing run-completes-synchronously behavior for this
   * headless slice). Inject a real `setTimeout`/`requestAnimationFrame`-backed `Scheduler` for
   * genuine paced playback in a browser; `@openlogo/turtle` itself stays timer-free.
   */
  readonly scheduler?: Scheduler;
  /**
   * When `true`, `run()` paints the final turtle scene instantly instead of pacing per-step ticks
   * (`@openlogo/turtle`'s `playWithMotionPreference`) — wire this to the browser's
   * `prefers-reduced-motion` media query (#227). Defaults to `false`. Combined with (never
   * replaced by) the shared state model's `speedSliderValue` (#310): a run paints instantly when
   * *either* this option is `true` *or* the slider is at its dedicated "instant" position — see
   * this module's doc comment ("#310").
   */
  readonly reducedMotion?: boolean;
  /**
   * The Canvas view controller (#218) to keep in lockstep with the run. When supplied,
   * `run()`/`step()`/`reset()` call `canvasView.repaint()` immediately after updating the shared
   * state model's `turtleWorld`/`turtleScene`, so the pane never shows a stale frame. Optional —
   * omit in tests that only assert the state model's turtle fields directly.
   */
  readonly canvasView?: CanvasViewController;
  /**
   * The learner-facing prompt host for the blocking `input` reporter (#769) — see
   * `input-prompt.ts`, and this module's doc comment ("#769") for how a synchronous runtime reader
   * is reconciled with an asynchronous browser prompt.
   *
   * **Omit it and nothing changes**: no `ExecuteOptions.hostInput` is passed at all, so `input`
   * falls back to `@openlogo/runtime`'s scripted `responses` queue (empty for a studio run), and an
   * `input` read cancels the program exactly as it did before this option existed.
   */
  readonly inputPrompt?: InputPromptHost;
  /**
   * Draws the `ExecuteOptions.randomSeed` (#865) each `run()` pins its whole `input` attempt chain
   * to (#881) — see this module's doc comment ("#881"). Defaults to `Date.now`, the same
   * implementation-chosen seed `@openlogo/runtime` falls back to on its own, so an ordinary studio
   * run retains exactly the clock-seeded behavior it has always had — which is a weaker property
   * than it sounds, since two runs starting in the same millisecond receive the same seed.
   *
   * Inject a counter here to make a run **exactly** reproducible — a test that needs to prove a
   * replay cannot diverge injects a source that returns a *different* seed on every call, so an
   * implementation that drew per attempt instead of per chain diverges deterministically rather
   * than by luck.
   */
  readonly randomSeedSource?: () => number;
  /**
   * Where each run's `execute()` actually happens (#876). Defaults to
   * {@link createInProcessExecutionHost} — `execute()` on this thread, settling synchronously, with
   * #769's replay reader — which is exactly the behavior this controller has had since #769, so
   * omitting this changes nothing.
   *
   * Supply `worker-execution-host.ts`'s Worker-backed host to get a **genuinely blocking** `input`
   * (one execution however many questions, instead of N+1) and a **preemptible Stop** (the runtime
   * checks its signal before every statement, and a Worker's signal lives in shared memory another
   * thread can flip mid-run). That host needs `SharedArrayBuffer`, so it needs COOP/COEP
   * cross-origin isolation; `web/main.ts` feature-detects and falls back to the replay. See
   * `docs/adr/0023-worker-execution-host.md`.
   */
  readonly executionHost?: ExecutionHost;
}

/**
 * One attempt's outstanding, unanswered `input` read (#769): the prompt to show, plus the host to
 * show it through. Carrying the host here — rather than re-reading `options.inputPrompt` at
 * presentation time — is what makes "a probe can only exist when a host was supplied" true by
 * construction rather than by a runtime check.
 */
interface PendingRead {
  readonly prompt: string;
  readonly host: InputPromptHost;
}

/**
 * One answer the learner has already given during the current chain (#769) — see
 * {@link resolveRecordedAnswer}. Defined in `execution-host.ts`, where the replay that consults it
 * now lives (#876), and re-exported here so this module's long-standing public surface is unchanged.
 */
export type {
  RecordedAnswer,
  RecordedAnswerResolution,
} from "./execution-host.js";
export { resolveRecordedAnswer } from "./execution-host.js";

/** A mutable {@link CancellationSignal} this controller owns and flips via `stop()`/`reset()`. */
interface MutableCancellationSignal extends CancellationSignal {
  aborted: boolean;
}

/** The headless Run/Stop/Reset/Step controller over the shared state model. */
export interface RunController {
  /** The single studio state model instance this controller reads/writes through. */
  readonly state: StudioStateStore;
  /**
   * Execute the current `source` via `@openlogo/runtime` and surface its output/diagnostics, then
   * (#228) replay the same trace-event stream through a `TurtleAnimationController` so the Canvas
   * pane animates in lockstep — see this module's doc comment ("#228").
   */
  run(): void;
  /**
   * Request cancellation. Flips the cancellation signal `run()` passes to `execute()` (honored
   * immediately by an already-cancelled signal on the *next* `run()`, per this module's
   * same-thread caveat), pauses the in-progress turtle animation (#228) so the Canvas view halts
   * at the same point, and sets `runStatus` to `"stopped"` so the UI reflects the request right
   * away. #769 — if an `input` question was outstanding it is withdrawn and the run is committed
   * as the cancelled run it is, with the diagnostics the waiting attempt already produced.
   */
  stop(): void;
  /**
   * Clear output/diagnostics, re-arm cancellation, reset the turtle animation and restore
   * `turtleWorld`/`turtleScene` to `@openlogo/turtle`'s program-start defaults (repainting the
   * Canvas view if one was supplied), and return `runStatus` to `"idle"`. #769 — also withdraws an
   * outstanding `input` question and discards every answer given during the current run, so the
   * next `run()` starts a genuinely fresh chain.
   */
  reset(): void;
  /**
   * Advance the turtle animation (#228) by exactly one instruction-step and push the resulting
   * snapshot, repainting the Canvas view if one was supplied. Once the animation is exhausted this
   * is a no-op (`TurtleAnimationController.step()`'s own guard) — see this module's doc comment
   * ("#228") for why this replays the already-complete event stream rather than stepping the
   * runtime, which exposes no per-instruction pause/resume API. `runStatus` stays `"stopped"` if
   * the learner already called `stop()`, even once stepping exhausts the animation — `step()`
   * never silently reverts an explicit stop back to a completed-run status.
   *
   * #289 — called before the first `run()` (i.e. from the initial idle state), `step()` no longer
   * no-ops: it first lazily runs `prepare()` (everything `run()` does short of actually starting
   * playback — executing the source, surfacing output/diagnostics, and building a fresh
   * `TurtleAnimationController` over the resulting event stream) and then steps that
   * freshly-prepared animation by one instruction, so pressing "Next step" from a blank studio
   * animates the very first instruction instead of doing nothing.
   *
   * #769 — a no-op while an `input` question is outstanding (the run is blocked on it), and its
   * lazy `prepare()` never installs a prompt host: stepping is a scrubber over an already-produced
   * event stream, so there is no execution in progress for a read to block. See this module's doc
   * comment ("#769").
   */
  step(): void;
  /**
   * Deliver one key press to the running program (#952), as the OpenLogo key word
   * `spec/interaction-events.md:221-225` defines — `"left"`, `"space"`, `"a"`, and so on. Browser
   * key names are normalized to that vocabulary by `key-words.ts`'s `normalizeKeyWord`, never here.
   *
   * The press is scheduled at the next studio tick and the current chain is replayed with it, so
   * every matching `on_key` handler fires. **This is the one place the boolean is defined:** it
   * reports whether *this press actually ran a handler*, compared as a strict increase in `on_key`
   * invocation markers across this one delivery (see `onKeyInvocationsByKeyWord`). It is `false`
   * for a key no handler names, for a handler the run never reached, for a press scheduled before
   * the handler registered, and for a press past the program's final usable tick.
   *
   * Every formulation that answers from *history* rather than from this delivery re-creates silent
   * interception somewhere, and four did: stream length inverted on the error path, a settle-later
   * query answered too late, declaration/registration pairing proved only *eventual* registration,
   * and an "ever responded" set kept returning `true` after the last tick that could fire
   * (invocation counts `[0,1,2,2]` → returns `[true,true,true]`).
   *
   * **Under a host that settles across event-loop turns this is always `false`**, because the
   * delivery has not run by the time the answer is needed — so such a host suppresses nothing at
   * all. That is a real capability gap (**#975**), and it is the deliberate direction: the
   * maintainer's constraint is that silent *interception* is worse than silent *inaction*, because
   * it hits every learner and presents as "the editor is broken". A page that scrolls during a game
   * is a nuisance; a key that vanishes with nothing happening is a bug report.
   *
   * `canvas-interaction.ts` decides whether to suppress the browser's own scrolling from this
   * answer, which is why the narrowness is load-bearing rather than fussy.
   *
   * A program whose `on_key` key word is not a literal reports `false` and suppresses nothing, while
   * still delivering the press. `false` with **no execution at all** whenever the chain is not
   * accepting input or the run registered no `on_key` handler. See this module's doc comment
   * ("#952") for those gates and for why a delivery costs a tick rather than a timestamp.
   */
  deliverKey(key: string): boolean;
  /**
   * Deliver one activation of the drawing surface to the running program (#952) — a pointer click
   * **or** "an equivalent accessible action" (`spec/interaction-events.md:241-242`), which is why
   * this takes no pointer coordinates: OpenLogo v0.1 standardizes no click-position reporter, so a
   * keyboard-reachable activation control is exactly as complete a click as a mouse is.
   *
   * Scheduled and gated exactly like {@link deliverKey}. Reports the narrower
   * `chain accepts input && on_click registered` — **not** {@link acceptsClick}, which deliberately
   * ignores the transient blockers so the activation control cannot flicker in and out of the tab
   * order mid-run. The two diverge exactly while a question is outstanding or an answer chain is
   * mid-pump.
   */
  deliverClick(): boolean;
  /**
   * Is the live run registered for `on_click`, with the chain still accepting input (#952)?
   *
   * This is what keeps the keyboard-reachable activation control out of the tab order for the many
   * programs that have no interaction at all: a focusable control nothing can respond to is a tab
   * stop a learner pays for and never uses. `canvas-interaction.ts` hides the control while this is
   * `false`, exactly as `index.html`'s `hidden` attribute — not `REPL_FOCUS_ORDER` — is what removes
   * the lesson pane from the real tab order while no lesson is loaded.
   *
   * It reports **registration**, not reachability: it stays `true` after the program's tick clock
   * has run past the last tick a click could be scheduled on, because how many ticks a program will
   * consume is not knowable without running it and the trace stream carries no tick by design. So
   * the control can outlive its own usefulness by the tail of a run — visible and inert, never
   * hidden while it still works.
   */
  acceptsClick(): boolean;
}

/**
 * Finds the `source_span` of the most recently consumed `"instruction"` event as of `cursor`
 * (`TurtleAnimationController.getSnapshot().cursor`, the index of the *next* unconsumed event in
 * `events`) — this is #410's "current source instruction", surfaced non-visually by
 * `a11y.ts`'s turtle-state region (`spec/rendering.md`'s Non-visual state descriptions minimum).
 * `events` already carries one `"instruction"` event per executed statement
 * (`execute-internal.ts`'s `executeStatements`), each stamped with that statement's own
 * `source_span` — this never re-derives a span, only looks one up in the already-complete stream.
 * Returns `null` before any instruction has been consumed (cursor at or before the first one), so
 * the turtle-state text can omit the clause entirely rather than show a placeholder.
 */
function findCurrentInstructionSourceSpan(
  events: readonly TraceEvent[],
  cursor: number,
): SourceSpan | null {
  for (
    let index = Math.min(cursor, events.length) - 1;
    index >= 0;
    index -= 1
  ) {
    const event = events[index];
    if (event !== undefined && event.kind === "instruction") {
      return event.source_span;
    }
  }
  return null;
}

/**
 * One host input occurrence **without** its tick (#952) — what a caller of `deliverKey`/
 * `deliverClick` names, before the controller assigns the tick that schedules it. Derived from
 * `@openlogo/runtime`'s own {@link HostInputEvent} through a distributive `Omit`, so it cannot drift
 * from the runtime's union; a plain `Omit` would collapse it to the members' *common* keys and
 * silently lose the key word and the event word.
 */
type HostInputOccurrence = HostInputEvent extends infer Member
  ? Member extends HostInputEvent
    ? Omit<Member, "tick">
    : never
  : never;

/**
 * Did this run register a `<name>` event handler (#952)? `when`, `every`, `on_key`, and `on_click`
 * each emit the ordinary catch-all `primitive` event carrying their own name "after the handler is
 * registered" (`spec/interaction-events.md:120-122`), so the run's own trace stream is the record —
 * this never re-parses the source or second-guesses the runtime.
 *
 * It is what keeps delivery a **no-op** rather than merely a cheap operation for a program that
 * registered nothing: with no handler to fire, a keystroke schedules nothing and re-executes
 * nothing, so this slice cannot perturb a non-interactive run.
 */
function hasRegisteredHandler(
  events: readonly TraceEvent[],
  name: string,
): boolean {
  return events.some(
    (event): boolean =>
      event.kind === "primitive" &&
      (event.payload as PrimitivePayload).name === name,
  );
}

/**
 * How many times this run **invoked** an `on_key` handler declared at each of `declared`'s positions
 * (#952, review round 6), keyed by key word.
 *
 * `spec/interaction-events.md:102-103` — "The start of a handler block emits an `instruction` event
 * for the block-head that caused the handler to run." Registration emits an `instruction` **and** a
 * `primitive` at the same start position, an invocation emits only the `instruction`, so at a given
 * position `invocations = instructions − registrations`.
 *
 * This is the counting half of the **fifth** formulation for one question; the four before it each
 * answered from *history* and each re-created silent interception on a different axis:
 * event-stream **length** was not *monotonic* (a raising handler shortens the stream, so a handler
 * that ran reported "nothing responded"), a settle-later **query** failed on *timing* (the answer
 * arrives after the `keydown` has already scrolled), declaration/registration **pairing** proved
 * only *eventual* registration, and "ever responded" **membership** outlived the ticks that could
 * fire. Counting is sound on those axes:
 * - **monotonicity** — a handler raising on its *first* instruction still reports 1, because the
 *   block-head marker is emitted before the handler can fail;
 * - **aliasing** — `repeat 2 [ on_key "up" [ … ] ]` registers twice at one position, and one press
 *   fires **both** (`interaction-events.md` forbids collapsing duplicate registrations), so the
 *   arithmetic gives 2 and the program prints twice: an independent witness agreeing with the count.
 *   Nesting keeps each position's arithmetic separate.
 *
 * It is a **count, not a boolean**, and callers must read it as a strict increase across one
 * delivery — never as "non-zero", which would report every press after the first.
 */
function onKeyInvocationsByKeyWord(
  declared: readonly DeclaredKeyHandler[],
  events: readonly TraceEvent[],
): ReadonlyMap<string, number> {
  const instructionsAt = new Map<string, number>();
  const registrationsAt = new Map<string, number>();
  for (const event of events) {
    const [line, column] = event.source_span.start;
    const position = `${line}:${column}`;
    if (event.kind === "instruction") {
      instructionsAt.set(position, (instructionsAt.get(position) ?? 0) + 1);
    } else if (
      event.kind === "primitive" &&
      (event.payload as PrimitivePayload).name === "on_key"
    ) {
      registrationsAt.set(position, (registrationsAt.get(position) ?? 0) + 1);
    }
  }
  const byKeyWord = new Map<string, number>();
  for (const entry of declared) {
    const position = `${entry.line}:${entry.column}`;
    const invocations =
      (instructionsAt.get(position) ?? 0) -
      (registrationsAt.get(position) ?? 0);
    byKeyWord.set(
      entry.keyWord,
      (byKeyWord.get(entry.keyWord) ?? 0) + invocations,
    );
  }
  return byKeyWord;
}

/** Construct the Run/Stop/Reset/Step controller over an existing state model (never a copy). */
export function createRunController(
  state: StudioStateStore,
  options?: RunControllerOptions,
): RunController {
  const document = options?.document ?? DEFAULT_RUN_DOCUMENT;
  const signal: MutableCancellationSignal = { aborted: false };
  // #881 — where each chain's pinned `ExecuteOptions.randomSeed` (#865) comes from. `Date.now` is
  // exactly what `@openlogo/runtime` would have chosen for itself, so an unpinned studio run is
  // no more predictable than before; what changes is that the choice is now made ONCE per chain
  // instead of once per `execute()` call.
  const drawRandomSeed = options?.randomSeedSource ?? Date.now;
  // #876 — where `execute()` happens. The default runs it right here and settles synchronously, so
  // every path below behaves exactly as it did before this seam existed; a Worker host settles
  // later, and more than once, which is the only difference the code below has to tolerate.
  const executionHost: ExecutionHost =
    options?.executionHost ?? createInProcessExecutionHost({ signal });
  // Present only on a host that genuinely suspends a read (the Worker one): its absence is what
  // says "this host replays", so an answer must be recorded in the chain's FIFO and another attempt
  // asked for. See `ExecutionHost.resolveRead`.
  const resolveReadInPlace = executionHost.resolveRead;

  // The current turtle animation player (#228), rebuilt fresh on every prepare() (called by
  // run(), and by step() lazily when nothing has started yet — #289) over that run's own
  // trace-event stream; null before the first run()/step() and after reset(). `finalRunStatus` is
  // the runStatus run() would already have committed pre-#228 (derived from the run's
  // diagnostics — #311 renamed the non-`stop()` outcome from `"idle"` to a distinct `"done"`, see
  // `state-model.ts`'s `RunStatus` doc comment), deferred here until the animation actually
  // finishes so a still-paced Canvas view is never reported as done/stopped early (see this
  // module's doc comment, "#228"). `userStopped` latches once `stop()` is called and is only
  // cleared by `run()`/`reset()`/a lazy `prepare()` from `step()` — it prevents a later `step()`
  // from silently overwriting an explicit stop back to `finalRunStatus` once the learner finishes
  // manually stepping through the rest of an already-stopped animation. `currentIsInstant` (#310)
  // is prepare()'s verdict on whether the current speedSliderValue maps to the dedicated "instant"
  // tick delay — run() reads it to OR-combine with RunControllerOptions.reducedMotion (see this
  // module's doc comment, "#310").
  let animation: TurtleAnimationController | null = null;
  let finalRunStatus: RunStatus = "idle";
  let userStopped = false;
  let currentIsInstant = false;
  // The most recent prepare()'s complete trace-event stream (#410) — kept alongside `animation`
  // so pushTurtleSnapshot() can look up the current instruction's source_span against the same
  // stream the animation is replaying, without re-executing or re-deriving anything. Cleared back
  // to empty by reset(), exactly like `animation` itself.
  let currentEvents: readonly TraceEvent[] = [];
  // The learner-visible output of the attempt those events belong to, kept rather than recomputed
  // (#876). Reducing `print` events to text is the producing thread's job — a Worker host's events
  // arrive by structured clone, which drops class prototypes, so `printedForm` on a cloned `OLDict`
  // throws. Holding the reduction the host already made is what keeps `commitCancelledRead()` from
  // having to redo it here. See `execution-host.ts`'s doc comment.
  let currentOutput: readonly string[] = [];
  // The exact source text prepare() executed to produce `currentEvents` (#410). A paced run's
  // scheduler callback can fire pushTurtleSnapshot() well after prepare() ran — if the learner
  // edited the editor in between (state-model.ts's setSource()/setSourceAndSelection() already
  // clear currentInstructionSourceSpan on that edit), this run's *next* animation tick would
  // otherwise republish a span looked up against the now-stale `currentEvents`, reintroducing the
  // exact bug that clearing was meant to prevent. Comparing against the live store source lets
  // pushTurtleSnapshot omit the clause instead of re-publishing a span for text that's no longer
  // on screen. Cleared back to "" by reset(), exactly like `currentEvents` itself.
  let preparedSource = "";
  // #769 — the `input` attempt chain. `answers` is the FIFO the installed reader draws from, one
  // entry per question the learner has already answered in the CURRENT chain; `chainSource` is the
  // source text every attempt of that chain executes (captured once at `run()`, so editing the
  // editor while a question is open cannot swap the program the answers were given for).
  // `pendingRead` is non-null exactly while the latest attempt ended on an unanswered read, and
  // `attemptDiagnostics` holds that attempt's real (withheld) diagnostics until the learner either
  // answers — in which case a later attempt replaces them — or dismisses, in which case they are
  // published. `shownEventCount` is how many events the previous attempt already drew, so the next
  // attempt's animation resumes there instead of replaying the picture from a blank canvas.
  // `promptOutstanding` guards the present-once rule (the settle hook runs on every animation tick
  // AND once more after playback), and `promptGeneration` invalidates a responder that arrives
  // after Stop/Reset already decided the run's outcome.
  let answers: readonly RecordedAnswer[] = [];
  let chainSource = "";
  let pendingRead: PendingRead | null = null;
  let attemptDiagnostics: readonly Diagnostic[] = [];
  let shownEventCount = 0;
  let promptOutstanding = false;
  let promptGeneration = 0;
  // The attempt pump's re-entrancy guard. A host may answer synchronously from inside `present()`
  // — i.e. from inside the very attempt that asked — so `pump()` is a loop with a pending-request
  // marker rather than recursion: a synchronous answer records the request and unwinds, and the
  // running loop picks up the next attempt. The marker carries the {@link chainGeneration} the
  // request was made for, which is what tells a stale retry apart from a genuinely new chain: a
  // queued answer whose chain has since been ended by Stop/Reset is dropped, while a `reset()`
  // immediately followed by `run()` — both from inside `present()` — records a request for the NEW
  // chain and is honoured. A bare boolean could not tell those two apart, and silently lost the
  // second. `null` means no attempt is pending. It is also what tells the settle hook that the
  // attempt it is settling has already been superseded.
  let pumping = false;
  let pendingPumpGeneration: number | null = null;
  // #876 — whether an attempt has been handed to the execution host and has not settled yet. With
  // the default in-process host this is only ever true *within* `beginAttempt`, so nothing can
  // observe it; with a Worker host it spans event-loop turns, and it is what stops a second
  // execution being started over an in-flight one. `run()` is already guarded by `runStatus`
  // (#314), but `step()` was not: before this, two early `step()` presses each reached `execute()`,
  // and Stop then cancelled only the second run's shared buffer while the Worker was still
  // executing the first — which is precisely a Stop that does not stop.
  let attemptPending = false;
  // #881 — the one random seed every attempt of the current chain executes with. Drawn once by
  // `run()` (and once per lazy `step()` preparation, which is its own single-attempt chain), so
  // attempt k+1 reproduces attempt k exactly up to the read the new answer extends.
  let chainRandomSeed = 0;
  // Which chain the pump loop is driving. A synchronous host may answer AND then call `stop()` or
  // `reset()` before `present()` returns — the answer records a pending pump request, and the
  // lifecycle call then unwinds into a pump loop that would otherwise run one more attempt on a
  // chain the learner has already ended. Observed: `respond(); stop()` replaced the output the
  // learner had just seen with the empty output of a pre-cancelled attempt, and `respond(); reset()`
  // finished `"done"` over an emptied `chainSource` instead of settling `"idle"`. Stop and Reset
  // bump this because they are the only **re-entrant lifecycle operations that invalidate queued
  // work** — not because they are the only ways a chain ends (normal completion and a dismissed
  // question end one too, but neither leaves a queued request behind to invalidate). `run()` does
  // not bump: it is unreachable while a chain is live, since `#314` ignores it unless `runStatus`
  // has already left `"running"`, and a bump there is provably inert — the nested `pump()` reads
  // `chainGeneration` at the moment it queues, so both sides of the comparison would move together.
  // The pending request carries the generation it was made for: the same generation-token shape
  // `promptGeneration` already uses for a late responder, kept separate because the responder
  // itself bumps that one.
  let chainGeneration = 0;
  // #952 — the current chain's host-input schedule and the tick counter that builds it. Each
  // delivered key press, click, or named event takes the next tick, so the schedule is a pure
  // function of the input SEQUENCE and never of the wall clock (see this module's doc comment,
  // "#952"). `chainAcceptsHostInput` is the delivery window: `run()` opens it, Stop and Reset close
  // it, and a lazy `step()` preparation never opens it at all.
  let hostInputEvents: readonly HostInputEvent[] = [];
  let nextHostInputTick = 1;
  let chainAcceptsHostInput = false;
  // #952 (review round 2/3) — the `on_key` declarations this chain's program contains, computed once
  // per chain from the captured source, each with the source position the runtime stamps its
  // registration with. `null` means at least one `on_key` names a non-literal key, so the set is
  // unknowable before the run. See `key-words.ts`'s `collectDeclaredKeyHandlers`.
  let declaredKeyHandlers: readonly DeclaredKeyHandler[] | null = null;
  // #952 (review round 1/3) — has this chain ever put an `input` question to the learner? Once it
  // has, the chain stops accepting delivered input for good, under **every** host.
  //
  // Round 3 measured why a narrower rule does not hold. Reopening after the read finishes looks
  // right — `spec/interaction-events.md:108-111` blocks handlers only "until the read finishes" —
  // but the studio has no tick for that boundary, so the next delivery is scheduled at tick 1 and
  // the replay reaches an *earlier* point than the learner has already observed: measured, a key
  // scheduled at tick 1 introduced a question the learner had never seen, erased output they had
  // already read, and left a prompt open over a `"done"` status. `resolveRecordedAnswer`'s prompt
  // pairing stops an answer reaching the wrong question; it cannot stop history being rewritten.
  //
  // So the two input sources never coexist in one chain. That is stricter than the spec requires,
  // and it is a real limitation for a program that asks a question and then expects key presses —
  // tracked as **#976**, and documented in `packages/studio/README.md` rather than absorbed
  // silently. Closing it depends on **#975** (a runtime delivery boundary, or live host input,
  // instead of a static pre-run schedule). `run()`/`reset()` start a fresh chain and reopen the
  // window.
  let chainHasAskedQuestion = false;
  // How many schedule entries the attempt currently in flight (or the last one started) carried
  // (#952 review finding). A delivery that arrives while an attempt has not settled — only reachable
  // under a host that settles across event-loop turns — is still SCHEDULED and simply replayed when
  // that attempt lands, rather than refused. Refusing made the recorded schedule depend on
  // settlement pacing (measured: the same two calls recorded two entries under a synchronous host
  // and one under a deferred one) and dropped the key outright, where
  // `spec/interaction-events.md:91-93` requires the most recent key/click state to be preserved.
  let deliveredScheduleLength = 0;
  // Guards the delivery drain against re-entering itself when a host settles synchronously — the
  // same shape `pump()` uses, for the same reason.
  let deliveringInput = false;
  // #952 (review round 5/6) — which attempt, if any, is a Stop `"stop"` notification. Held as the
  // **attempt's own id**, not a bare boolean: a boolean set by `stop()` and cleared only when some
  // attempt settles outlives the attempt it describes, and review measured the consequence — a Stop
  // whose notification never settled left the flag armed, so the *next* chain's first question was
  // presented and instantly withdrawn. Under the blocking Worker host that left the interpreter
  // parked in `Atomics.wait` for an answer that could never be given: a hung studio with no question
  // on screen and no diagnostic. A flag that outlives the thing it describes is the same defect as a
  // count nothing re-derives.
  let stopNotificationAttempt: number | null = null;
  // Monotonic id per attempt, so a settlement can tell whether it is the one an earlier decision was
  // about. Never reset — identity only, no ordering meaning beyond "not the same attempt".
  let attemptSequence = 0;
  // How many events the live animation has actually put on the canvas, tracked at the one place a
  // frame is published (`pushTurtleSnapshot`). A delivered-input replay hands this to
  // `shownEventCount` so the picture RESUMES rather than redrawing — and reading it from here rather
  // than from the animation keeps that a plain measurement with no "what if there is no animation
  // yet" case to reason about: there cannot be one, because a delivery is gated on a run whose
  // handler registration is already in `currentEvents`.
  let drawnEventCount = 0;

  /** Push `current`'s folded per-turtle world/scene into the shared store and repaint (never
   * called with a null animation — callers only invoke this once `animation` has been
   * assigned). */
  function pushTurtleSnapshot(current: TurtleAnimationController): void {
    const snapshot = current.getSnapshot();
    drawnEventCount = snapshot.cursor;
    state.setTurtleWorld(snapshot.world);
    state.setTurtleScene(snapshot.scene);
    // #410 — only trust `currentEvents`' spans while the editor still holds the exact source they
    // were derived from; a mid-run edit means the store's own currentInstructionSourceSpan was
    // already cleared to null by setSource()/setSourceAndSelection(), and republishing a lookup
    // against the old stream here would silently undo that.
    state.setCurrentInstructionSourceSpan(
      state.getState().source === preparedSource
        ? findCurrentInstructionSourceSpan(currentEvents, snapshot.cursor)
        : null,
    );
    options?.canvasView?.repaint();
  }

  /**
   * Called after every animation tick and once more when playback returns. Commits
   * {@link finalRunStatus} once `current` has actually reached `"done"` — unless the learner already
   * called `stop()`, in which case `runStatus` stays `"stopped"` even if a subsequent manual
   * `step()` exhausts the animation (see `userStopped`'s doc comment above).
   *
   * #769 adds the two attempt-chain outcomes ahead of that. A pending pump request means a host
   * already answered this attempt's question synchronously (or ended and restarted the chain), so
   * the *next* attempt supersedes this one and its (probe) outcome must not be committed.
   * Otherwise, an attempt that ended on an unanswered read has now drawn everything up to that
   * read, which is exactly when the question is put to the learner.
   */
  function settleAttempt(current: TurtleAnimationController): void {
    if (current.getSnapshot().status !== "done") {
      return;
    }
    if (attemptPending) {
      // #876 — an execution is in flight, so this animation is not the run's ending: it is the
      // prefix drawn up to a question the learner has already answered. Committing here would
      // report a still-running program as finished.
      return;
    }
    if (pendingPumpGeneration !== null) {
      return;
    }
    if (pendingRead !== null) {
      presentPendingRead(pendingRead);
      return;
    }
    if (!userStopped) {
      state.setRunStatus(finalRunStatus);
    }
  }

  /**
   * Put the outstanding question to the learner (#769). Idempotent: the settle hook above fires both
   * on the animation's final tick and once more when playback returns, and a question must be
   * presented exactly once.
   */
  function presentPendingRead(read: PendingRead): void {
    if (promptOutstanding) {
      return;
    }
    promptOutstanding = true;
    // Everything up to the read is now on the canvas, so the next attempt resumes from here.
    shownEventCount = currentEvents.length;
    const generation = promptGeneration;
    read.host.present({ prompt: read.prompt }, (answer) => {
      if (generation !== promptGeneration) {
        // Stop/Reset already withdrew this question and decided the run's outcome.
        return;
      }
      promptGeneration += 1;
      promptOutstanding = false;
      pendingRead = null;
      if (resolveReadInPlace !== undefined) {
        // #876 — this host genuinely suspended the read, so both endings are the *same* operation:
        // hand the answer (or the dismissal's `undefined`, which is the runtime reader's own
        // "cannot answer") back to the waiting execution and let it continue. There is no attempt
        // to replay and no withheld diagnostic to publish — the run itself reports what happened
        // next, and `settleAttempt` commits that outcome exactly as it does for a finished run.
        //
        // Resuming puts an execution back in flight, so the guard goes back up. Without it the
        // *prefix* animation — which has already reached `"done"`, because it only ever contained
        // the events up to the question — would commit the run as finished while the interpreter is
        // still running: `runStatus` `"done"` over partial output, Run offered instead of Stop, and
        // a live Worker behind a UI that says the program ended.
        attemptPending = true;
        resolveReadInPlace(answer);
        return;
      }
      if (answer === undefined) {
        // The learner dismissed the question, so the read really did end unanswered — which is the
        // one other ending `spec/interaction-events.md:110-111` allows. Publish the cancellation
        // this attempt already produced.
        commitCancelledRead();
        state.setRunStatus("stopped");
        return;
      }
      answers = [...answers, { prompt: read.prompt, answer }];
      pump();
    });
  }

  /**
   * Commit the latest attempt as the cancelled run it is (#769) — the learner dismissed the
   * question, or pressed Stop while it was open. Publishes the diagnostics `prepare()` withheld
   * (see this module's doc comment) alongside the output the attempt did produce, so the run log
   * records the full, real outcome. `signal.aborted` is deliberately NOT set here: the execution
   * already ended, so there is nothing left to cancel, and only an explicit `stop()` should latch
   * the signal (`reset()` is what re-arms it).
   */
  function commitCancelledRead(): void {
    userStopped = true;
    const output = currentOutput;
    state.setOutput(output);
    state.setDiagnostics(attemptDiagnostics);
    state.setLastRunResult({
      source: preparedSource,
      output,
      diagnostics: attemptDiagnostics,
    });
  }

  /**
   * Take down an outstanding question without answering it (#769, Stop/Reset), invalidating any
   * responder still holding it. Reports whether there was a read to withdraw, so the caller knows
   * whether a cancelled attempt needs committing.
   */
  function withdrawPendingRead(): boolean {
    const read = pendingRead;
    if (read === null) {
      return false;
    }
    pendingRead = null;
    promptGeneration += 1;
    if (promptOutstanding) {
      promptOutstanding = false;
      read.host.dismiss();
    }
    return true;
  }

  /**
   * Start one attempt and hand the animation it produced to `then` once the host settles.
   *
   * `then` runs **synchronously, inside this call**, for the default in-process host — which is why
   * `run()`/`step()` still complete within one turn and every pre-#876 test is untouched. A Worker
   * host settles later instead, and settles **again** for each further read and once at completion,
   * so `then` runs once per settled view of the same single execution.
   *
   * `announceRunning` (#952) is `false` for the two attempts that continue a run the learner is
   * already watching rather than starting one: a delivered key/click, and Stop's `"stop"` event.
   * Announcing `"running"` there would make `run-log.ts`/`tutor-output-pane.ts` — which accumulate
   * on the `"running"` → terminal transition — file a fresh entry per keystroke. It also leaves
   * `userStopped` alone, which is what lets Stop's own attempt settle without reverting the
   * `"stopped"` status it is on its way to committing.
   */
  function beginAttempt(
    sourceText: string,
    host: InputPromptHost | undefined,
    then: (current: TurtleAnimationController) => void,
    announceRunning = true,
  ): void {
    if (announceRunning) {
      state.setRunStatus("running");
      userStopped = false;
    }
    pendingRead = null;

    const request: ExecutionRequest = {
      source: sourceText,
      document,
      // #881 — the chain's pinned seed (#865). This is what makes the replay a genuine
      // continuation rather than a fresh roll of the dice: the runtime's clock fallback is its only
      // ambient entropy source, and the collaborators supplied alongside the seed are deterministic
      // too (`eduTutorTemplate` is a pure mapping; the reader answers only from the chain's frozen
      // FIFO), so every attempt reproduces the previous one exactly up to the read. See this
      // module's doc comment ("#881"). A Worker host never replays to answer a read, so the seed
      // matters there only for reproducing a whole run — and, since #952, for making a
      // delivered-input replay a genuine continuation under any host.
      randomSeed: chainRandomSeed,
      // #876 — the controller's cancellation state, carried as data because an object's mutation is
      // invisible across a thread boundary. `stop()` latches `signal.aborted` and only `reset()`
      // clears it, so a `run()` after a Stop is expected to halt immediately with `ol-limit`
      // (see this module's doc comment, "#126"). Without this the Worker host allocated a fresh,
      // uncancelled buffer per run and quietly ran to completion instead — the two hosts disagreeing
      // on a documented rule.
      cancellationRequested: signal.aborted,
      acceptsReads: host !== undefined,
      answers,
      // #952 — the other half of the runtime's `hostInput` seam. Empty for a program that has been
      // given no key, click, or named event, which is every run that predates this slice.
      hostInputEvents,
      ...(options?.instructionBudget !== undefined
        ? { instructionBudget: options.instructionBudget }
        : {}),
      ...(options?.recursionDepthLimit !== undefined
        ? { recursionDepthLimit: options.recursionDepthLimit }
        : {}),
    };

    attemptPending = true;
    deliveredScheduleLength = hostInputEvents.length;
    attemptSequence += 1;
    const attemptId = attemptSequence;
    executionHost.execute(request, (settlement) => {
      attemptPending = false;
      const current = finishAttempt(settlement, sourceText, host);
      if (stopNotificationAttempt === attemptId) {
        // #952 (review round 5/6) — the `"stop"` notification block may itself reach an `input`.
        // That read belongs to an attempt started *after* the question Stop already withdrew, and
        // the program is terminating, so it ends the only other way
        // `spec/interaction-events.md:110-111` allows. Withdrawn **here**, keyed to this exact
        // attempt: under a host that settles across event-loop turns the read does not exist when
        // `stop()` returns, and a check that only asked "is a notification outstanding" withdrew a
        // later, unrelated chain's question instead. Withdrawing before `then` also means the
        // learner never sees it presented and instantly dismissed.
        stopNotificationAttempt = null;
        withdrawPendingRead();
      }
      then(current);
    });
  }

  /**
   * Surface one settled attempt: its output/diagnostics, the turtle animation over its event
   * stream, and — when it ended on an unanswered read — the question still to put to the learner.
   */
  function finishAttempt(
    settlement: ExecutionSettlement,
    sourceText: string,
    host: InputPromptHost | undefined,
  ): TurtleAnimationController {
    answers = settlement.retainedAnswers;
    currentEvents = settlement.events;
    preparedSource = sourceText;
    // `host` is captured into `pendingRead` so a question can only ever exist when a host was
    // supplied — true by construction rather than by a runtime check.
    pendingRead =
      settlement.pendingPrompt !== null && host !== undefined
        ? { prompt: settlement.pendingPrompt, host }
        : null;
    if (pendingRead !== null) {
      // #952 — this chain has now asked something, so it stops accepting delivered input for good.
      // Latched (never cleared by an answer) because the hazards are about the chain's answer FIFO
      // existing at all, not about a question being outstanding right now — see the field's docs.
      chainHasAskedQuestion = true;
    }

    // #769 — a probe (an attempt that ended on an unanswered read) withholds its diagnostics until
    // the learner actually dismisses the question; see this module's doc comment for why the only
    // diagnostic it can carry is the reader's own forced cancellation. A Worker host reports none
    // at all here, because its run is suspended rather than cancelled.
    attemptDiagnostics = settlement.diagnostics;
    const diagnostics: readonly Diagnostic[] =
      pendingRead === null ? settlement.diagnostics : [];

    const output = settlement.output;
    currentOutput = output;
    state.setOutput(output);
    state.setDiagnostics(diagnostics);
    // #432 finding 2 — snapshot this run's output/diagnostics immutably, separate from the live
    // `output`/`diagnostics` fields above. Those live fields get overwritten by
    // `diagnostics.ts`'s parse-as-you-type re-checking on every subsequent source edit — including
    // mid-run, since a paced (non-instant) run leaves `runStatus` at `"running"` across many
    // event-loop turns while the editor stays fully live. `run-log.ts` reads this snapshot instead
    // of the live fields at the terminal transition, so an entry always reflects the run that
    // produced it, never a later edit's parse result.
    state.setLastRunResult({
      source: preparedSource,
      output,
      diagnostics,
    });
    state.setTutorOutput(settlement.tutorOutput);
    finalRunStatus = settlement.diagnostics.some(
      (diagnostic) => diagnostic.code === "ol-limit",
    )
      ? "stopped"
      : "done";

    const baseScheduler = options?.scheduler ?? IMMEDIATE_SCHEDULER;
    let current: TurtleAnimationController;
    const scheduler: Scheduler = (callback, delayMs) =>
      baseScheduler(() => {
        callback();
        pushTurtleSnapshot(current);
        settleAttempt(current);
      }, delayMs);

    const tickDelayMs = mapSpeedSliderValueToTickDelayMs(
      state.getState().speedSliderValue,
    );
    currentIsInstant = isInstantTickDelay(tickDelayMs);

    current = new TurtleAnimationController(settlement.events, {
      // Only set stepsPerSecond for a genuinely paced speed — an "instant" tick delay has no
      // finite steps-per-second equivalent (see turtle-speed.ts's tickDelayMsToStepsPerSecond doc
      // comment) and is instead handled entirely through run()'s reducedMotion OR-combination.
      scheduler,
      ...(currentIsInstant
        ? {}
        : { stepsPerSecond: tickDelayMsToStepsPerSecond(tickDelayMs) }),
    });
    animation = current;
    // #769 — resume the picture instead of redrawing it. A later attempt in the same chain replays
    // the whole program, so its stream starts with everything the previous attempt already drew
    // (under a Worker host each report extends the last, so the prefix is the same either way).
    // Consume that prefix silently
    // (no snapshot is pushed until playback proper begins, so the canvas never blanks) and let
    // paced playback carry on from the read.
    //
    // The prefix is measured in EVENTS but consumed in STEPS, and those do not align at the read:
    // the statement that was waiting on it contributed only its own `instruction` event to the
    // probe, and the learner's answer has now extended that same step with the effects it
    // produces. `forward input "how far?"` is the whole hazard in one line — stepping merely
    // "past the event count" would consume that step's brand-new `move`/`draw-segment` too,
    // silently skipping the very movement the answer just produced. So a step is only fast-
    // forwarded when it ends at or before the already-drawn boundary; the first step that reaches
    // past it is left for playback to animate. That boundary rule now lives on the animation
    // controller as `seekToEventIndex`, which applies it in one fold instead of one step at a
    // time — #977; it clamps to the new stream's own length itself.
    current.seekToEventIndex(shownEventCount);
    return current;
  }

  /** Halt the live animation, if there is one — the one place that decision is expressed. */
  function pauseAnimation(): void {
    animation?.pause();
  }

  /** Start (or resume) playback of the attempt `prepare()` (now `beginAttempt()`/`finishAttempt()`)
   * just built, then settle its outcome. */
  function playCurrentAttempt(current: TurtleAnimationController): void {
    playWithMotionPreference(current, {
      reducedMotion: (options?.reducedMotion ?? false) || currentIsInstant,
    });
    pushTurtleSnapshot(current);
    settleAttempt(current);
    // #952 — an input delivered while this attempt was still in flight is scheduled but not yet
    // replayed; now that it has landed, deliver it. A no-op whenever nothing arrived meanwhile,
    // which is every attempt of every program that takes no input.
    drainDeliveredInput();
  }

  /**
   * Drive attempts of the current chain (#769) until one finishes without an unanswered read, or
   * until a question is left outstanding for the learner. Re-entrant by design: a host that answers
   * synchronously calls back into `pump()` from inside the attempt that asked, which only records a
   * pending request so the already-running loop takes the next attempt — never a nested call stack
   * that would grow with the number of questions.
   *
   * #881 — each iteration strictly consumes one more read than the last: the chain's source, seed,
   * and every already-recorded answer are frozen, so a read's prompt at a given FIFO position is
   * the same on every attempt and the newest answer always advances the chain. That is what makes
   * this loop terminate for any program with a bounded number of reads, and it is why the
   * no-progress retry cap this loop used to carry is gone — see this module's doc comment ("#881").
   *
   * The request is **tagged with the chain it was made for**, and the loop continues only while the
   * pending one still names the current chain. That single comparison covers both re-entrant orders
   * a synchronous host can produce from inside `present()`: answering and then pressing Stop/Reset
   * leaves a request for a chain that has since ended, which is dropped rather than run over the
   * top of the outcome those already committed; while `reset()` immediately followed by `run()`
   * records a request for the **new** chain, which is honoured rather than silently lost. See
   * {@link pendingPumpGeneration}.
   */
  function pump(): void {
    if (pumping) {
      pendingPumpGeneration = chainGeneration;
      return;
    }
    pumping = true;
    try {
      do {
        pendingPumpGeneration = null;
        beginAttempt(chainSource, options?.inputPrompt, playCurrentAttempt);
      } while (pendingPumpGeneration === chainGeneration);
    } finally {
      pumping = false;
      // A request the loop just REFUSED (it named a chain Stop/Reset has ended) must not outlive
      // the loop: `settleAttempt` reads a non-null request as "this attempt was superseded, do not
      // commit its outcome", so a stale one left behind would suppress settlement forever — a later
      // lazy `step()` would finish its animation with `runStatus` stuck at `"running"`, which
      // `run()`'s #314 guard then reads as a run in progress and ignores.
      //
      // Making `settleAttempt`'s own condition chain-aware instead measures **identically** on
      // every probe and survives the whole suite, so this is a choice between two correct
      // placements rather than a correctness argument — an earlier version of this comment claimed
      // otherwise from reasoning that was never run, and `@testing` disproved it by building the
      // variant. (The reason the variant is also safe: `reset()` calls `animation.reset()`, so the
      // controller `settleAttempt` inspects is no longer `"done"` and it returns at its first check
      // regardless.) Clearing here is preferred only because it bounds the marker's lifetime to the
      // loop that owns it, so no other reader has to reason about a stale value at all.
      pendingPumpGeneration = null;
    }
  }

  /**
   * Schedule one host input at the chain's next tick (#952). Tick *n* for the *n*-th delivery — the
   * counter is the whole of the wall-clock-to-tick mapping, which is why two identical play
   * sessions produce byte-identical event streams. See this module's doc comment ("#952").
   */
  function scheduleHostInput(occurrence: HostInputOccurrence): void {
    const tick = nextHostInputTick;
    nextHostInputTick += 1;
    hostInputEvents = [...hostInputEvents, { ...occurrence, tick }];
  }

  /**
   * Replay the current chain until every scheduled input has been delivered (#952). Not a new run:
   * the live animation is paused (its already-scheduled ticks would otherwise push snapshots of a
   * superseded stream over the new one), the events it has already drawn are marked as drawn so
   * `finishAttempt` resumes the picture instead of blanking it, and `runStatus` is deliberately not
   * re-announced — see `beginAttempt`'s `announceRunning`.
   *
   * A loop rather than one attempt, because an input can arrive while an attempt is still in flight
   * (a host that settles across event-loop turns) or from inside a settlement itself. Each iteration
   * consumes the whole schedule as it stands, so it advances only while a delivery genuinely
   * happened during the previous attempt — the same bound `pump()` has. Under a host that has not
   * settled yet it returns instead, and the settlement's own call resumes the drain.
   */
  function drainDeliveredInput(upTo?: number): void {
    if (deliveringInput) {
      // Re-entered from a synchronous settlement; the running loop re-reads the schedule.
      return;
    }
    deliveringInput = true;
    try {
      while (
        acceptsHostInput() &&
        hostInputEvents.length > deliveredScheduleLength &&
        (upTo === undefined || deliveredScheduleLength < upTo)
      ) {
        shownEventCount = drawnEventCount;
        pauseAnimation();
        beginAttempt(
          chainSource,
          options?.inputPrompt,
          playCurrentAttempt,
          false,
        );
        if (attemptPending) {
          return;
        }
      }
    } finally {
      deliveringInput = false;
    }
  }

  /**
   * Is this chain accepting delivered input at all (#952)? It must be live — `run()` opens the
   * window, Stop and Reset close it, and a lazy `step()` preparation never opens it — no question may
   * be outstanding (`spec/interaction-events.md:108-111` forbids running a handler block until a read
   * finishes), and the answer chain must not be mid-pump.
   *
   * The `pumping` check is what keeps a prompt host that answers **synchronously from inside
   * `present()`** from being handed one more read per answer, which review measured as the quadratic
   * hang the "#881" section above describes. The `chainHasAskedQuestion` check applies to **every**
   * host — see that field for the measurement that forces it.
   */
  function acceptsHostInput(): boolean {
    return (
      chainAcceptsHostInput &&
      pendingRead === null &&
      !pumping &&
      !chainHasAskedQuestion
    );
  }

  /**
   * The gate one specific delivery must pass (#952): the chain accepts input, and this run actually
   * registered a handler of that kind. The registration check is what keeps this slice a **no-op**
   * rather than merely a cheap operation for a program that registered nothing — with no handler to
   * fire, a keystroke schedules nothing and re-executes nothing.
   */
  function acceptsHostInputFor(registration: string): boolean {
    return (
      acceptsHostInput() && hasRegisteredHandler(currentEvents, registration)
    );
  }

  function deliverKey(key: string): boolean {
    if (!acceptsHostInputFor("on_key")) {
      return false;
    }
    const declared = declaredKeyHandlers;
    // #952 (review round 7) — the answer is "did **this press** run a handler", compared strictly
    // across this one delivery. Membership of an "ever responded" set was tried and is unsound in
    // the same direction as every earlier mechanism: invocation counts `[0,1,2,2]` produced returns
    // `[true,true,true]`, so a press past the program's final usable tick ran nothing and was still
    // suppressed. Every formulation that answers from history rather than from this delivery
    // re-creates silent interception somewhere.
    const before =
      declared === null
        ? 0
        : (onKeyInvocationsByKeyWord(declared, currentEvents).get(key) ?? 0);
    scheduleHostInput({ kind: "key", key });
    // Drain **only as far as this press**. A settlement can deliver more input re-entrantly (a state
    // subscriber, a prompt host), and an unbounded drain consumed those too — so `after` counted a
    // *later* press's invocation and credited it to this one: measured, the tick-1 press reported
    // `true` and suppressed the key while only the nested tick-2 press actually printed. Anything
    // scheduled during this drain is left for the loop that owns it.
    const scheduledLength = hostInputEvents.length;
    drainDeliveredInput(scheduledLength);
    if (declared === null) {
      // A non-literal key word: unknowable, so deliver but claim nothing and suppress nothing. The
      // remainder still has to be flushed on this path too — returning early from here stranded a
      // re-entrant press until some unrelated later delivery happened to drain it.
      drainDeliveredInput();
      return false;
    }
    const after =
      onKeyInvocationsByKeyWord(declared, currentEvents).get(key) ?? 0;
    const ranAHandler = after > before;
    // Anything scheduled re-entrantly during the drain above was deliberately left behind so it
    // could not be credited to this press. Deliver it now that the attribution is settled — leaving
    // it stranded would be the other half of the same bug.
    drainDeliveredInput();
    return ranAHandler;
  }

  function deliverClick(): boolean {
    if (!acceptsHostInputFor("on_click")) {
      return false;
    }
    scheduleHostInput({ kind: "click" });
    drainDeliveredInput();
    return true;
  }

  function acceptsClick(): boolean {
    // A capability question ("can a click reach a handler in this run"), not a right-now one: the
    // transient blockers in `acceptsHostInput` — a question outstanding, an answer chain mid-pump —
    // come and go within a single `run()` call, and hiding the control for those moments would make
    // a tab stop flicker in and out under the learner. `chainHasAskedQuestion` is **not** transient:
    // it closes delivery for the rest of the chain, so a control left visible past it would be a
    // permanently inert tab stop (measured in review).
    return (
      chainAcceptsHostInput &&
      !chainHasAskedQuestion &&
      hasRegisteredHandler(currentEvents, "on_click")
    );
  }

  function run(): void {
    if (state.getState().runStatus === "running") {
      // #314 — a run is already in progress (only reachable with a real paced scheduler, where
      // runStatus stays "running" across many event-loop turns, or #769's outstanding `input`
      // question): ignore the extra call rather than silently starting a second run mid-animation.
      // See this module's doc comment, "#314".
      return;
    }
    // #769 — a fresh chain: no answers carried over, nothing drawn yet, and the program text pinned
    // for every attempt this chain makes. #881 pins the chain's randomness the same way and for the
    // same reason: every attempt must be the SAME run, not merely the same program.
    answers = [];
    shownEventCount = 0;
    promptGeneration += 1;
    promptOutstanding = false;
    chainSource = state.getState().source;
    chainRandomSeed = drawRandomSeed();
    // #952 — a fresh chain delivers no input yet, and its tick counter restarts at 1 so the schedule
    // depends only on this run's own input sequence. This is also the one place the delivery window
    // opens.
    hostInputEvents = [];
    nextHostInputTick = 1;
    chainAcceptsHostInput = true;
    chainHasAskedQuestion = false;
    declaredKeyHandlers = collectDeclaredKeyHandlers(chainSource);
    drawnEventCount = 0;
    // #876 — publish THIS run's (still empty) result before anything can observe it, and clear
    // every other field a run owns. With the default in-process host the settlement overwrites all
    // of this within the same call, so it is invisible; with a host that settles later, a Stop
    // landing before the first settlement would otherwise leave the *previous* run's state in
    // place. `run-log.ts` would record that earlier run a second time (it snapshots
    // `lastRunResult` on the `"running"` → terminal transition), and `tutor-output-pane.ts` would
    // append its `explain`/`why`/`hint`/`debug` output to the pane's history all over again — both
    // accumulate on exactly the transition an abandoned run still makes. The canvas is cleared for
    // the same reason: a fresh chain draws from a blank scene anyway (`shownEventCount` is 0, so
    // nothing is fast-forwarded), so leaving the previous run's picture up would show a drawing
    // this run never made.
    currentEvents = [];
    currentOutput = [];
    attemptDiagnostics = [];
    preparedSource = chainSource;
    state.setOutput([]);
    state.setDiagnostics([]);
    state.setTutorOutput([]);
    state.setLastRunResult({
      source: chainSource,
      output: [],
      diagnostics: [],
    });
    state.setCurrentInstructionSourceSpan(null);
    state.setTurtleWorld(INITIAL_TURTLE_WORLD_STATE);
    state.setTurtleScene(INITIAL_TURTLE_SCENE);
    options?.canvasView?.repaint();
    pump();
  }

  function stop(): void {
    // #876 — the preemptible half. For the default in-process host this is a no-op (its `execute()`
    // has already returned by the time anything can call `stop()`); for a Worker host it flips a
    // flag in shared memory that the still-running interpreter reads before its very next
    // statement, and wakes it if it is parked on a question. Deleting this line leaves a Stop that
    // does not stop and a Worker parked forever, so it is pinned directly by test.
    executionHost.cancel();
    attemptPending = false;
    // Ends this chain: a queued replay from a synchronous answer must not run after it.
    chainGeneration += 1;
    pauseAnimation();
    const withdrewPendingRead = withdrawPendingRead();
    // #952 — `spec/interaction-events.md:152-156` makes `"stop"` "a requested stop notification
    // BEFORE termination", so the notification is delivered while the program can still act on it,
    // by one final replay of the chain with the named event scheduled. Gated exactly like a key or
    // click: the window must be open, the chain must never have asked a question, and the program
    // must actually have registered a `when` handler — so a Stop on any program that did not is
    // byte-for-byte the Stop it always was. A withdrawn question suppresses it too, because
    // `:108-111` forbids running a handler block for a read that ended unanswered.
    const notifies = !withdrewPendingRead && acceptsHostInputFor("when");
    chainAcceptsHostInput = false;
    // Latched BEFORE the notification attempt so that attempt cannot settle the run as `"done"`
    // over the `"stopped"` this call is committing — including a Worker host's, which settles a
    // turn or more later.
    userStopped = true;
    if (notifies) {
      scheduleHostInput({ kind: "event", event: "stop" });
      shownEventCount = drawnEventCount;
      // Keyed to the attempt this call is about to start, so no later chain can inherit it.
      stopNotificationAttempt = attemptSequence + 1;
      beginAttempt(
        chainSource,
        options?.inputPrompt,
        playCurrentAttempt,
        false,
      );
    }
    // Latched only now: the in-process host executes through this very signal object, so latching
    // it before the notification attempt would cancel that attempt at its first statement with
    // `ol-limit` instead of delivering `"stop"`. Once latched it STAYS latched — a `run()` after a
    // Stop still halts immediately, and only `reset()` re-arms it (see this module's doc comment,
    // "#126").
    signal.aborted = true;
    if (withdrewPendingRead) {
      // #769 — Stop while an `input` question was open: the read ended unanswered, so publish the
      // cancellation the attempt already produced rather than leaving it withheld.
      commitCancelledRead();
    }
    state.setRunStatus("stopped");
  }

  function reset(): void {
    withdrawPendingRead();
    // #876 — abandon whatever the host is still running, so a Worker's in-flight execution cannot
    // settle over the cleared state a moment later. Deleting this line lets a Reset the learner
    // pressed be undone: the studio clears, then the abandoned run finishes and repaints it.
    executionHost.cancel();
    attemptPending = false;
    // Ends this chain, exactly as stop() does — see chainGeneration.
    chainGeneration += 1;
    answers = [];
    chainSource = "";
    attemptDiagnostics = [];
    shownEventCount = 0;
    // #952 — a Reset closes the delivery window and discards the schedule, so the next `run()`
    // starts a genuinely fresh chain in this dimension too, exactly as it does for the answer FIFO.
    hostInputEvents = [];
    nextHostInputTick = 1;
    chainAcceptsHostInput = false;
    chainHasAskedQuestion = false;
    declaredKeyHandlers = null;
    drawnEventCount = 0;
    signal.aborted = false;
    userStopped = false;
    state.setOutput([]);
    state.setDiagnostics([]);
    state.setTutorOutput([]);
    state.setLastRunResult(null);
    animation?.reset();
    animation = null;
    currentEvents = [];
    currentOutput = [];
    preparedSource = "";
    state.setCurrentInstructionSourceSpan(null);
    state.setTurtleWorld(INITIAL_TURTLE_WORLD_STATE);
    state.setTurtleScene(INITIAL_TURTLE_SCENE);
    options?.canvasView?.repaint();
    state.setRunStatus("idle");
  }

  function step(): void {
    if (pendingRead !== null) {
      // #769 — the run is blocked on an `input` question: there is nothing to step until it is
      // answered or dismissed. See this module's doc comment for why stepping never drives the
      // prompt flow itself.
      return;
    }
    if (attemptPending) {
      // #876 — an execution is already in flight and has not settled. Only reachable with a host
      // that settles across event-loop turns; starting a second one would leave two live runs, and
      // the host owns a single cancellation channel, so Stop would reach only the newer of them.
      return;
    }
    // #289 — from the initial idle state (before any run()), no animation exists yet: prepare()
    // lazily builds one (executing the CURRENT source exactly as run() would) so stepping from a
    // blank studio animates the first instruction instead of silently doing nothing. Once an
    // animation already exists (mid-run, paused, or exhausted), this is exactly the pre-#289
    // behavior: step the existing one, never rebuilding it from a possibly-changed source. No
    // prompt host is installed (#769) — see this module's doc comment. #881: a lazy preparation is
    // its own one-attempt chain, so it draws its own seed rather than reusing a finished run's.
    if (animation === null) {
      chainRandomSeed = drawRandomSeed();
      beginAttempt(state.getState().source, undefined, stepAnimation);
      return;
    }
    stepAnimation(animation);
  }

  /** Advance `current` one instruction-step, publish the frame, and settle the run's outcome. */
  function stepAnimation(current: TurtleAnimationController): void {
    current.step();
    pushTurtleSnapshot(current);
    settleAttempt(current);
  }

  return {
    state,
    run,
    stop,
    reset,
    step,
    deliverKey,
    deliverClick,
    acceptsClick,
  };
}

/** Compose the run controller into the shell's `repl` region (the run/output surface). */
export function mountRunController(
  shell: AppShell,
  controller: RunController,
): void {
  shell.mount("repl", controller);
}
