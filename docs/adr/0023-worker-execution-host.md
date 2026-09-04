# 23. A Worker + `Atomics.wait` execution host, with the replay kept as the degraded mode

- Status: Accepted
- Date: 2026-08-23
- Deciders: OpenLogo maintainer (@pmalarme) + learner-experience + interpreter + orchestrator
- Related: [ADR-0000](0000-record-architecture-decisions.md) (immutability rule);
  [ADR-0006](0006-cross-cutting-contracts.md) (the trace/event stream and `ol-*` diagnostics this
  crosses a thread boundary with); [ADR-0011](0011-studio-app-bundler.md) (Vite, which bundles the
  Worker entry); [ADR-0014](0014-deterministic-coverage-gate.md) (why a timing-dependent primitive
  may not be allowed to decide a gate); issue #876, epic #902, issues #769/#681/#865/#881

## Context

`spec/interaction-events.md:165-168` makes `input` the **only blocking read** in v0.1: no OpenLogo
instruction and no event-handler block may run until a read finishes or the program is cancelled.
`@openlogo/runtime` honours that by construction — `ExecuteOptions.hostInput.read` is
**synchronous**, and `execute()` never yields.

A browser's main thread cannot block for a styled, keyboard-operable, screen-reader-announced
prompt. Issue #769 reconciled the two with a **replay**: the studio answers each read from an
accumulated FIFO; the first unanswered read records its prompt and returns `undefined` (the reader's
own "cannot answer", which cancels that attempt at the waiting `input`); when the learner answers,
the studio re-executes the **same captured source** with the answer appended. N reads cost N+1
executions.

That replay is **correct**. #865 added `ExecuteOptions.randomSeed` and made a bare `randomize`
derive its implementation seed from the generator rather than the clock; #881 then pinned one seed
per `input` chain, so every attempt is bit-identical up to the read the newest answer extends. The
divergence window epic #902 was opened for is closed. Nothing below is a correctness fix, and it
should not be described as one.

What remains is a **mechanism** gap, and it has two distinct costs:

1. **The read is reconciled, not blocked.** N reads cost N+1 executions, and the read a learner is
   waiting on is, underneath, a cancelled attempt rather than a suspended one.
2. **Stop cannot preempt.** `@openlogo/runtime` checks `ExecuteOptions.signal` before every statement
   and loop pass, so it is the right mechanism to cancel a loop already in progress — but a
   same-thread caller cannot flip it while `execute()` is on its own stack. `run-controller.ts` has
   carried that caveat in its doc comment since #126, naming the fix: a Worker plus
   `SharedArrayBuffer`/`Atomics`. Until now the instruction budget was the only thing keeping a
   runaway program from hanging the session.

Three reconciliations were enumerated by the #769 session. `window.prompt` was rejected on a
decisive ground: browsers let a user suppress dialogs ("prevent additional dialogs"), after which it
returns `null` forever and silently becomes a permanent cancel — disqualifying for a learner tool.
That leaves the replay and a Worker.

The Worker path carries one constraint the studio does not control: `SharedArrayBuffer` — and
therefore `Atomics.wait` — requires **cross-origin isolation**, which a page only gets from the
`Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` response
headers. Those change what a deployment may embed. That is a **deployment posture, not a code
decision**.

## Decision

**1. `run-controller.ts` composes an `ExecutionHost` instead of calling `execute()` itself.** The
host's whole contract is "settle with an `ExecutionSettlement`" — the events so far, their reduced
output, the diagnostics, and the question the run is suspended on (or `null`). Everything the
controller does around a run — reducing to `output`, driving the turtle animation, committing
`runStatus`, presenting the question — reaches the same eventual state whichever host is installed.
What differs is *when*: the in-process host settles synchronously, so a run ends within the call that
started it, while a Worker host settles across event-loop turns.

**2. Two hosts ship, and the replay is the fallback rather than a deletion.**
`createInProcessExecutionHost` carries #769's replay unchanged and settles **synchronously inside
`execute()`**; `createWorkerExecutionHost` runs the interpreter in a Worker and settles once per
outstanding read plus once at completion. `web/main.ts` feature-detects cross-origin isolation
(`selectExecutionHost`) and installs the blocking host only when the page actually has shared
memory.

**3. `run()` stays `void`.** Issue #876 predicted that a Worker makes `run()` async and "breaks every
current studio test". It does not. The controller was already asynchronous-by-continuation —
`present`/`respond` callbacks, generation counters, and a paced scheduler already leave `runStatus`
at `"running"` across many event-loop turns — so a host that settles through a callback fits the
existing shape. No pre-existing studio test was changed — the two existing test files this slice
touches gain appended cases and two import lines, and delete nothing.

**4. `@openlogo/runtime` gains `ExecuteOptions.observedEvents`.** A caller-supplied array the run
appends every trace event to as it is emitted, so the stream is readable **during** execution rather
than only when `execute()` returns. Rely on its *contents*, not on identity: for a program that runs
it is the same array `ExecuteResult.events` reports, but a call returning before an execution
environment exists — a parse failure, say — never reaches the sink and reports its own separate empty
array. The reader is called with the
prompt and nothing else, so without it a Worker parked inside a read cannot tell the main thread what
the program has drawn — and the learner is asked a question over a **blank canvas**, a straight
regression against #769, which draws the square and *then* asks.
`spec/interaction-events.md:165-167` explicitly permits the opposite ("the implementation **MAY**
continue rendering already-emitted trace events"), and this is the seam that makes that allowance
reachable.

**5. The shared-memory protocol is a pure module over typed arrays, with `wait`/`notify` injected.**
`blocking-input-channel.ts` decides everything as straight-line logic over an `Int32Array` control
block and a `Uint16Array` answer region; the real `Atomics.wait`/`Atomics.notify` are supplied by
`web/execution-worker.ts` and `web/main.ts`. This follows the package's existing rule that browser
globals are injected and never referenced (`web-bootstrap.ts`'s `TimeoutSchedulerTimers`), and it is
what lets a primitive that throws on a main thread and cannot be scheduled deterministically be
covered by `node:test` with no timing dependence at all — the same principle as
[ADR-0014](0014-deterministic-coverage-gate.md).

**6. COOP/COEP is a configuration input, not a baked-in assumption.** This slice adds no response
headers, in dev or in production. The code degrades gracefully and documents the requirement; the
deployment decision belongs to the maintainer.

## Consequences

**A genuinely blocking read.** One `execute()` per run, however many questions. Each report extends
the last rather than replacing it — the events the learner has already seen are a **prefix** of every
later report, so "attempt *k+1* begins with attempt *k*" stops being an argument about determinism
and becomes a property of a single growing stream. (In the Worker it *is* one array; what crosses
the boundary is a snapshot of it, since structured clone copies.)

**A preemptible Stop.** The Worker's `CancellationSignal` is a getter over `Atomics.load`, so Stop
takes effect on the interpreter's very next statement. A `repeat 100000 [ … ]` halts where it is
rather than at the instruction budget — impossible before. **Both** links of that chain are pinned by
test, because either alone is worthless: that `stop()`/`reset()` actually reach the host, and that a
raised flag preempts the running interpreter. (Review measured the cost of losing the first: a Stop
that does not stop, a Reset the program survives and repaints over, and a Worker left parked on
`Atomics.wait` forever.)

**The bound that replaces the deleted retry cap.** #881 removed the replay chain's no-progress retry
cap, having proved the state it guarded unreachable; its reviewers carried forward the consequence
that a future reintroduction of divergence would be an unbounded loop rather than a bounded test
failure. A Worker host answers that **structurally**: it never replays, so there is no attempt
sequence to diverge and nothing for a counter to count. That invariant is asserted directly (one run
command for a program with several reads). Separately, no single **park** is indefinite:
`awaitBlockingRead` parks with a timeout and re-reads the control block, so a cancellation is
observed within one poll interval **even if its wake-up were missed entirely**. The *total* time a
learner may be asked to wait is of course unbounded — that is what a blocking question is — but it
always ends on their next Stop rather than on a wake-up arriving.

**The bound applies to the Worker host only, and the replay is what everyone runs today.** Until
COOP/COEP is decided the in-process replay is the sole reachable host, and its divergence bound is
still the structural argument #881 made, not a counter. A future defect that reintroduced divergence
there would present as a synchronous non-terminating `pump()` — a hang rather than a red test, since
`--test-timeout` cannot interrupt a synchronous loop. That is inherited, not introduced here, and it
is the strongest argument for enabling the isolated path once the deployment decision lands.

**What is still unbounded is unchanged, and still a host contract.** A prompt host that
unconditionally restarts the run from inside `present()` is a host-side infinite loop that nothing
can bound — each restart brings a fresh `instructionBudget`, so the runtime's safety gate never
fires (measured on #769: 5,000 questions in 460 ms with no diagnostic). That is documented on
`InputPromptHost` and is not changed here. A program with genuinely unbounded reads
(`forever [ :answer = input "?" ]`) is *better* under this host than under the replay — one budgeted
execution rather than a chain that replays quadratically many reads — but a learner still faces
questions until they press Stop, which is now genuinely preemptible.

**Values must be reduced on the thread that produced them.** Structured clone drops class
prototypes: an `OLDict` arrives as a plain object and `printedForm` throws
(`TypeError: record.fields is not a function`, measured on `print { a: 1 b: 2 }`). So a settlement
carries the finished `output`/`tutorOutput` alongside the raw events, and the controller never
re-reduces a stream it did not produce in-process. The events themselves are consumed only by
`@openlogo/turtle`'s animation and the instruction-span lookup, both of which read plain data — but
keeping the reduction with the values makes that a rule rather than a coincidence.

**An over-long answer is refused, never truncated.** The shared answer region is fixed for the life
of a run and a blocked Worker's buffer cannot grow, so an answer that does not fit ends the read
unanswered — the run cancels with the runtime's own diagnostic, which is visible and recoverable,
rather than handing the program text the learner did not type. The capacity is a construction
option so a deployment can put this out of reach.

**Every report carries the run it belongs to.** A Worker processes messages serially and a cancelled
run still finishes and reports, so Stop immediately followed by Run would otherwise settle the *new*
run with the *old* one's events — clearing the callback does not cover it, because the new run
reinstalls one. A monotonic `runId` on the command and on every report makes that one comparison.

**Two execution paths now exist, and both must keep working.** The replay is not legacy: any
deployment without COOP/COEP runs it, so it stays covered, documented, and reviewed. The cost is
that a behavioural change to the run loop has to be considered against both.

**A small behavioural difference at Stop.** Pressing Stop while a question is open publishes the
withheld cancellation diagnostic under the replay (the attempt really had been cancelled) and
publishes none under the Worker host (the run was *suspended*, and Stop abandons it before it can
report). Dismissing the question is identical under both: the read ends unanswered and the run
cancels with the runtime's own diagnostic.

**Until COOP/COEP is decided, the blocking host is unreachable in the shipped app.** The seam, both
hosts, and the protocol are complete and tested; a page that is not cross-origin isolated simply
keeps the replay. Enabling it is one deployment change plus, for local development, the two headers
in `packages/studio/vite.config.ts`.
