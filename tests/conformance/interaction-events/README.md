# Interaction & Events conformance fixtures

Fixtures for the **Interaction & Events** profile — blocking `input`, waits, event handlers,
keyboard and pointer events, and timer-style behavior (`spec/conformance.md#interaction--events`,
`spec/interaction-events.md`). Core remains non-interactive: `input` is in this profile, not Core.
Fixtures landed here as epic **#658**'s Interaction slices implemented the profile; the terminal
slice (**#688**) audited the corpus and claimed it.

**Normative dependencies** (`spec/conformance.md` profile DAG): Interaction & Events is a separate
optional profile depending only on **Core Language**. This matches
`PROFILE_DEPS["interaction-events"] = ["core-language"]` in `scripts/harness/index.mjs`.

`interaction-events` **is claimed** in `packages/core/src/host-metadata.ts`'s `SUPPORTED_PROFILES`
and in `scripts/examples-gate.mjs`'s `IMPLEMENTED_PROFILES` (#688), so `spec/examples/10-game.logo`
RUNS and PASSES in the examples gate rather than being SKIPped — the observable proof of the claim.
With it, saga #572's four M5 profiles are all claimed and no example in the corpus is skipped.

- **`wait/`** — the `wait <n>` tick-clock primitive (issue #680, slice I1).
- **`input/`** — the blocking `input <prompt>` reporter (issue #681, slice I2), the profile's other
  ordinary call and "the only blocking read in OpenLogo v0.1"
  (`spec/interaction-events.md:137-148`). Per the maintainer's ruling on #657, `input` is tested by
  **mocking the answer** — scripted answers ride the existing `executeOptions.hostInput` seam as
  `responses`, a FIFO consumed in order by each `input` call — and the read adds **no new event
  kind**: it emits the ordinary catch-all `primitive` named `input` after the read finishes, so
  `spec/execution-model.md`'s trace/event registry is unchanged. `input-number-answer` and
  `input-word-answer` pin the two branches of the number-vs-word rule (`:136-137`) against one
  another by asking the same `is a "number"` question and recording opposite answers, and by
  recording the raw printed value (the JSON number `42` versus a string). Note that **arithmetic
  would not discriminate them** — OpenLogo's `+` coerces a numeric word, so `:answer + 1` reports
  43 whether the read returned the number `42` or the word `"42"`; a proof built on it would look
  convincing while being inert against an implementation that never reports numbers at all.
  `input-responses-consumed-in-order` proves the queue is consumed in order with each answer
  classified independently; `input-unanswered-cancels` takes the read's *other* spec-sanctioned
  ending (`:110-111` — "until the read finishes or the program is cancelled") through the profile's
  ordinary cancellation diagnostic rather than inventing an answer or a lookalike code; and the
  `check`-mode pair `input-visible-under-profile`/`input-rejected-core-only` proves the name is
  gated on the profile, as `spec/conformance.md:171-173` and `spec/interaction-events.md:11`
  require.

  **The prompt's `ol-type` (`:131`) is now fixtured — the #768 ruling settled it.** #681 withheld
  a fixture because "the prompt cannot be displayed as learner text" had two defensible readings and
  a fixture is normative for every implementation ("Any conforming implementation should pass them",
  `.github/skills/shared/conformance-fixture/SKILL.md:13-15`), so shipping one would have settled a
  contested clause by fixture instead of by ruling. The maintainer then ruled **narrower than either
  reading on the table**: the prompt MUST be a `word`, so `number` and `boolean` are rejected
  alongside `list`/`dict`/`record`/`turtle`, and the diagnostic carries `expected: "word"` — the
  identity the `word` reporter itself reports (`word "Question" 3`) and the one `when`/`on_key` use —
  rather than #681's one-off `expected: "text"`. `spec/interaction-events.md:140`/`:131` now state
  the rule outright ("**Args:** one prompt, which MUST be a `word`" / "**Errors:** `ol-type` if the
  prompt is not a `word`"), so the fixtures transcribe a normative clause instead of binding a
  reading. Four land: `input-prompt-number-rejected` and `input-prompt-boolean-rejected` (the two
  kinds the ruling newly rejects, so an implementation still carrying #681's scalar reading fails
  exactly these two and nothing else), `input-prompt-list-rejected` (the compound half — `dict` and
  `record` would drag in the Data profile and `turtle` the Sprites one for no extra proof, so all
  six kinds stay asserted together in `packages/runtime/src/interaction-input.test.mjs`), and
  `input-prompt-numeric-word-accepted`, the positive complement without which an implementation that
  rejected *every* prompt would pass all three negatives. That last one forms a discriminating pair
  with the number case: the two programs are byte-identical but for the quotes, so `input "42"` and
  `input 42` display the same two characters while the pair demands OPPOSITE verdicts on them. No
  classifier that looks only at printed form can satisfy both — it fails whichever member its
  decision goes against (accepting numerals fails the number negative, rejecting them fails the
  positive) — and reject-everything fails the positive. Neither member alone catches both.

  The **blocking** property (`:108-111`) is observable here only as the *pair*
  `input-does-not-deliver-handlers` + `input-blocking-control-wait-delivers`: the same program and
  the same tick-0 pending key, with a read in one and `wait 0` in the other, so the control proves
  the key was genuinely deliverable and only the read declined to deliver it. A fixture cannot
  prove the property in full — with a scripted answer the read returns immediately, so there is no
  waiting interval a headless source→events fold can observe — so the complete proof, including
  that a read never advances the tick clock (and therefore can bring no `every` handler due), lives
  in `packages/runtime/src/interaction-input-blocking.test.mjs`.
- **`when/`** — the `when <event-word> <block>` named event handler (issue #682, slice I3):
  registration emits `primitive` after the handler is registered, a `"start"` handler fires
  immediately (the run has started), a `"stop"` handler fires once before termination, a non-word
  event is `ol-type`, a mismatched `end` label is `ol-mismatched-end`, and `check`-mode fixtures
  prove `when` is visible only under the `interaction-events` profile and rejected Core-only.
  Issue **#828** adds two budget fixtures, one per delivery path, because `when` has two: a handler
  *firing* is itself one charged instruction, so in `when-firing-counts-against-budget` an empty-bodied
  `"start"` handler fired synchronously at registration consumes the instruction the following
  statement would have had, and a budget of 2 raises `ol-limit`.
  `when-host-delivered-firing-counts-against-budget` covers the other path — a named event delivered
  by the host through the tick dispatcher — because charging one path but not the other passed the
  entire corpus. `when-non-empty-body-refused-at-boundary-budget` is the discriminating twin of the
  first at the *same* budget of 2: an empty body is delivered, a non-empty one is refused, because a
  handler must afford its firing **and** its body's first statement. That absence — no second
  `ProfileStatement` `instruction` event — is what a source→events fold observes, and dropping the
  body-gate arm adds exactly that orphan block-head.
  Maintainer ruling **#984** adds the three fixtures that pin `when`'s **persistence**
  (`spec/interaction-events.md:169-174` — a handler runs each time its event occurs, once per
  occurrence, and is never retired). `when-persistent-vendor-event-fires-each-occurrence` delivers
  `"acme.shake"` on two different ticks and `when-persistent-same-tick-occurrences-each-fire`
  delivers it twice on one tick; both fire the handler twice, and they are separate fixtures because
  they exercise separate mechanisms — two drains each finding one occurrence, versus one drain that
  must preserve its queue's multiplicity rather than collapse it to a set. Both use a
  **vendor-prefixed** word by necessity: `"start"` and `"stop"` occur once per run, so under them a
  one-shot implementation is indistinguishable from a persistent one. `when-start-identical-registrations-fire-once-each`
  pins the consequence that is easiest to get wrong — persistence must **not** re-fire the whole
  `"start"` cohort when a later handler registers — with two byte-identical registrations that fire
  exactly twice, at two different head spans. It fails both the cohort-refiring reading (three prints)
  and a registry that collapses the identical pair into one handler (one print), the latter being
  independently forbidden by `spec/interaction-events.md:79`.
- **`every/`** — the `every <n> <block>` repeated timed handler (issue #683, slice I4):
  registration emits `primitive` after the handler is registered, the block first runs `n` ticks
  **after registration** (not at a global multiple of `n`) and repeats every `n` ticks while a `wait`
  pause advances the tick clock, a `wait 0` yields without redelivering a handler already fired on the
  current tick, a handler whose body's nested `wait` advances the clock through a sibling's next
  interval does not re-fire that sibling out of chronological order, a non-whole count is `ol-type`, a
  zero or negative count is `ol-range`, the event
  sequence is deterministic across runs, and `check`-mode fixtures prove `every` is visible only under
  the `interaction-events` profile and rejected Core-only.
  Issue **#828** adds the two properties that bound a handler which registers another handler. First,
  registrations are **never collapsed, deduplicated, or replaced**: `every-nested-registration-not-collapsed`
  (`every 3 [ every 3 [ … ] ]`) fires exactly **6** times over 12 ticks against exactly **4** for its
  twin `every-single-registration-baseline`, so each registration provably survives as a **distinct
  handler**. Note the narrow scope of that claim: the bodies print a literal, so the pair proves
  collapse-freedom only — it says nothing about *capture*, which is issue #821's separate ruling and
  is **not** repaired here (E-A still prints `30 30 30`). Collapse-freedom is the property #821's
  repair will build on; #828 only guarantees it is not taken away. Second, that growth is bounded by the **ordinary
  instruction budget** rather than by a mechanism of its own, because each firing is a charged
  instruction: `every-nested-registration-budgeted` raises `ol-limit` where its control twin
  `every-single-registration-budgeted` — one non-accumulating `every`, same 12 ticks, same budget of
  14 — completes cleanly, so the diagnostic is caused by the accumulation and not by a budget too
  small for any program. (The twins are not byte-identical bodies: the nested subject's *outer* body
  holds the inner registration, while the control's body is empty. The control charges roughly 6
  against 14, so it never approaches the boundary and the comparison stays honest.)
  `every-body-runs-in-registration-environment` pins a third, older property that had no fixture at
  all: a handler body runs in the environment captured at **registration**, not the one current when
  it fires. It registers inside `define setup :v` and fires from the top-level `wait`, after `setup`
  has returned, so printing `7` is only possible if that environment was captured — resolving against
  the firing-time scope raises `ol-undefined-var` instead. Note this pins capture of the *environment*,
  which is weaker than capturing *values*: nothing is snapshotted and no fresh bindings are made,
  which is why #821's loop case is still open.
  Maintainer ruling **#984** adds the fixtures that pin how an **overrunning** handler behaves, a
  region the corpus had left entirely open. `every-missed-occurrence-is-queued-and-runs` proves
  coalescing is **required** and that the queued occurrence runs as soon as the handler is free,
  inside the same dispatch: the outer `wait` has already spent its last tick, so a runtime that
  defers the drain to a fresh checkpoint loses the occurrence outright. `every-queue-coalesces-to-one`
  proves the **cap** — four intervals arrive while a once-firing `on_key` holds the thread, and only
  one survives. Its outer `wait 26` is load-bearing and was the second design: a backlog drains at a
  bounded rate — at most one occurrence per tick dispatch and one per main-line statement boundary —
  so with a short outer `wait` the run closes before an uncapped queue can show itself, a capped and
  an uncapped queue are measurably identical, and the fixture pins nothing.
  `every-fixed-rate-interval-not-re-measured`
  pins the third rule (`spec/interaction-events.md:194-198`) — a handler delayed by a one-time block
  still finds its intervals on the original grid (ticks 4, 8, 12, 16), where a fixed-**delay** clock
  that disarms the handler while an invocation runs slips off those boundaries and fires one time
  fewer. That fixture delays the handler with a FOREIGN `on_key` body, so it cannot separate fixed rate from a scheduler that merely re-measures the period from each completion -- its `every` body is instantaneous, so completion and start share a tick. `every-fixed-rate-survives-a-slow-body` closes that gap with a body that itself takes two ticks: nine firings under fixed rate against five under a completion-re-measured clock. Both are needed; neither catches the mutation the other does.
  The fixtures that follow pin the **run-lifetime** rule the same ruling settled: a handler does not extend the run.
  `every-queued-occurrence-discarded-when-run-closes` shows a self-overrunning handler terminating
  cleanly with its last queued occurrence discarded;
  `every-queued-occurrence-runs-while-main-line-continues` is that same program with one more
  top-level statement, where the run is still open and the occurrence therefore MUST run — the pair
  brackets the exact boundary between "run it once the handler is free" and "discard once the main
  line finishes", which an implementation can otherwise satisfy one of while violating the other.
  `every-queued-occurrence-runs-in-an-empty-each-body` covers the same hazard for a per-turtle
  body -- an `each` iteration narrows the addressed set and runs a body, so it is main-line progress
  even when that body is empty. `new_turtle` is a REPORTER, so its value must be BOUND for a turtle
  to exist -- a bare `new_turtle` statement creates nothing -- and the fixture needs more than one
  addressed turtle, because over a single turtle a per-iteration boundary and a per-statement one are
  indistinguishable. Two bindings plus the implicit default turtle give three iterations, at which
  `each [ ]`, `each [ print 0 ]` and an equivalent `repeat 3 [ ]` under the same prelude all agree at
  seven handler firings, against four for `each [ ]` before the boundary was added -- one occurrence
  lost per iteration, while the other two forms reported seven in both states. And
  `every-queued-occurrence-runs-in-an-empty-loop-body` covers the container that executes no
  statements at all: a body's statements are what carry the boundary, so an empty body had none, even though each of
  its iterations is charged against the budget on the same terms as one that runs something --
  measured at three handler firings for `forever [ ]` against eleven for `forever [ print 0 ]` before
  it was added. And `every-queued-occurrence-runs-inside-a-comprehension` extends that same guarantee to the one
  main-line container that does not go through the statement executor: a comprehension body is an
  **expression**, so it needs its own per-iteration boundary — measured at three handler firings
  against six for an equivalent `repeat` or `for … in` before it was added. And
  `every-overrunning-handler-runs-back-to-back-under-forever` shows the same handler running back to
  back until the budget raises `ol-limit` when the learner holds the run open explicitly. Neither of
  the last two is
  sufficient alone: the discard rule by itself is satisfied by never draining at all — precisely the
  defect this issue's first implementation shipped — and the `forever` fixture is what forbids that,
  since a runtime that drops missed occurrences never accumulates the firings that exhaust the budget.
- **`on_key/`** — the `on_key <key-word> <block>` keyboard handler (issue #684, slice I5):
  registration emits `primitive` after the handler is registered; a key press is host input, so with
  no host input supplied the handler is registered but never fires (locked by
  `on-key-registered-not-delivered`, mirroring I3's `when "stop"`); a non-word key is `ol-type`, the
  multiline `... end on_key` form behaves identically to the bracket form, a mismatched `end` label is
  `ol-mismatched-end`, `on_key` registers correctly in awkward positions (nested in `repeat`,
  registered twice for the same key) with insertion-ordered handlers for #686/I7, and `check`-mode
  fixtures prove `on_key` is visible only under the `interaction-events` profile and rejected
  Core-only.
  Issue **#828** adds two more. `on-key-registering-every-stays-clean` is the ruled **user-bounded
  control case**: a finger bounds the registration rate where a clock does not, so
  `on_key "space" [ every 10 [ … ] ]` is a legitimate game pattern and stays completely clean (it runs
  at the default budget and deliberately claims nothing about charging). `on-key-firing-counts-against-budget`
  is what asserts the charge for this kind: four key presses on an empty-bodied handler exhaust a
  budget of 5 and raise `ol-limit`.
- **`on_click/`** — the `on_click <block>` pointer handler (issue #685, slice I6): the last handler
  form and the only one that takes **no argument** (`spec/interaction-events.md` §Profile grammar:
  "`on_click` takes none"). Registration emits `primitive` after the handler is registered; a click is
  host input, so with no host input supplied the handler is registered but never fires (locked by
  `on-click-registered-not-delivered`, mirroring I3's `when "stop"` and I5's `on_key`) — and, with no
  host input supplied, advancing the tick clock with `wait` still does not fire it because nothing was
  pending (`on-click-wait-does-not-fire`; #686/I7 reconciled its wording — a click delivered via
  `hostInput` DOES fire during a `wait`); the multiline
  `... end on_click` form behaves identically to the bracket form, a mismatched `end` label is
  `ol-mismatched-end`, a stray argument where the block belongs is a parse `ol-missing-end` pointed at
  the `on_click` head (the spec lists its errors as none, so a bad argument is caught at parse time),
  `on_click` registers correctly in awkward positions (nested in `repeat`, registered twice) with
  insertion-ordered handlers kept in their own list for #686/I7's same-tick delivery order, and
  `check`-mode fixtures prove `on_click` is visible only under the `interaction-events` profile and
  rejected Core-only.
  Issue **#828** adds `on-click-firing-counts-against-budget`: four clicks on an empty-bodied handler
  exhaust a budget of 5 and raise `ol-limit`, asserting for this kind the same "a firing is one charged
  instruction" rule the `when`, `every`, and `on_key` groups assert for theirs — the four together
  cover the universal clause at `spec/interaction-events.md:79`.
- **`dispatch/`** — the deterministic same-tick dispatch order + cancellation (issue #686, slice I7):
  the slice that proves the four handler forms COMPOSE. When several handlers of different kinds
  become due on one tick they fire in the normative order `when` → `on_key` → `on_click` → due `every`,
  each in registration order (`spec/interaction-events.md:95-100`) — `cross-kind-order-during-wait`
  delivers a named event, a key, a click, and an `every` all at tick 1 via `executeOptions.hostInput`
  (see below) and asserts they print 1, 2, 3, 4; `every-multi-same-tick-deterministic` proves multiple
  handlers of one kind order by registration, reproducibly. Cancellation
  (`cancellation-stops-delivery`) proves an already-cancelled run emits no events and delivers no
  handler even with input scheduled (`spec/interaction-events.md` §Errors and cancellation). A
  `check`-mode fixture (`return-in-on-key-handler-checked`) locks the checker's agreement with the
  runtime that an `on_key` body is a control-flow boundary (`ol-return-outside-proc`). Cross-kind
  ordering, cancellation stopping mid-tick delivery, and the "`wait` does not defer handler delivery"
  criterion inherited from I1 are proven in full by `packages/runtime/src/interaction-dispatch-order.test.mjs`,
  which reaches input through the public `execute()` (no test-only export). **`ExecuteOptions.hostInput`**
  (`packages/runtime/src/index.ts`) is the tick-scheduled key/click/named-event input a host would
  deliver, so a headless fixture can prove handlers fire and fire in order
  (`spec/interaction-events.md:102-104` requires preserving pending key/click state). Like the harness's
  `signal`, JSON can express only a STATIC tick→deliveries schedule fixed before the run; input that
  reacts to program state stays a unit-test concern. It is host execution context, never observable in
  any event payload; it is NOT a device/TTY, defines no coalescing policy, and is NOT the blocking
  `input` reporter — that reporter's scripted answers are the sibling `hostInput.responses` field
  (#681/#657, see `input/` above).

  **The handler discriminator (issue #954)** is proven by two fixtures here.
  `handler-firing-discriminated-from-registration` is the gap in one file: an `on_key` registration
  and its firing emit `instruction` events that start at the **same** line 1 column 1 with the same
  `statement_kind`, and before #954 they differed only in `end` column (27 versus 7) — so a consumer
  told registration from firing by comparing span **width**, an invariant the spec never states and
  no fixture asserted. Now the registration carries no `handler` key at all while the firing carries
  `{kind: "on_key", key: "space"}`. `handler-firing-names-its-own-argument` supplies the
  discriminating power a single-handler fixture cannot: four handlers with four distinct arguments
  (keys `space`/`enter`, intervals 2/3) all fire in one run, so a payload that hardcoded its argument
  or read a sibling's fails. `on_key/on-key-registered-not-delivered` is the negative control — a
  registration that never fires produces no `handler` key anywhere. What the payload carries is the
  handler's **registration-time signature**: the block-head kind plus the argument the handler was
  registered with, evaluated (so `every :n` reports the number `:n` held at registration, and
  `every "3"` reports the number `3`, not the word). It excludes **occurrence and dispatch
  metadata** — anything describing *when* or *how* one firing was delivered — which is the rule
  recorded on `HandlerFiring` in `@openlogo/core` and the reason a **tick** is deliberately not
  carried there: a tick describes when a firing happened rather than what the handler is, and
  `spec/interaction-events.md:69-73` makes it an implementation-defined logical frame besides. It is
  a signature and **not an identifier**: duplicate registrations (`repeat 3 [ on_key "space" … ]`)
  emit an identical payload *and* an identical span, so the stream cannot tell them apart — a
  consumer needing per-registration identity uses `ExecuteOptions.handlerRegistrations` instead.
  Note also what is *not* claimed: a registered argument may be computed (`every (random 1 3) [ … ]`),
  and `spec/commands.md:353-378` promises reproducible randomness only within an implementation, so
  this is not a claim that two independent implementations emit identical values here.

  The **inbound** half of that contract — `ExecuteOptions.handlerRegistrations` ("which key words
  currently have handlers") and `ExecuteOptions.handlerDeliveries` ("was this delivered input
  handled"), issue #975 — is deliberately **not** fixtured here. Those are host-facing TypeScript
  API rather than language behavior: a conformant implementation in another language would expose
  them differently, so pinning them in a stack-neutral corpus would over-claim. They are proven in
  `packages/runtime/src/handler-contract.test.mjs`, which also asserts that supplying the sinks
  leaves `events` and `diagnostics` byte-identical — the property that keeps them out of band.
- **`forms-check-clean/`** and **`forms-unknown-without-interaction/`** — the profile-wide tooling
  pair (issue #687, slice I8; extended by #681, slice I2): one `check`-mode program that USES all
  six implemented forms together (`wait` and `input` plus the four block-heads, with `wait` nested
  inside a block inside `repeat` inside a procedure and `input` in that same procedure body) and
  checks clean under the profile, and its negative twin asserting `ol-unknown-command` with exact
  head-word spans for each of the six when the profile is inactive.
  These prove name visibility and arity only — they do not execute, so handler delivery and the
  read itself stay the job of the per-form directories above. `input` joined this pair with its own
  slice (#681): I8 deliberately excluded it because registering a checker name with no runtime
  evaluator behind it would let a program check clean and then fail at runtime, and #681 lands both
  halves of its registration together.
- **`redefine-wait-reserved/`** — also issue #687: redefining the profile primitive `wait` raises
  `ol-reserved-word` under an active profile, the primitive branch of the
  rule rather than the reserved-word branch (`wait` is not one of the four reserved block-heads).
- **`bindings-free-with-interaction/`** and **`bindings-free-core-only/`** — issue #837: the same
  four block-heads used in **binding** positions (`:when = 1`, `set every to 2`, a `for on_key in …`
  binder, `local on_click`) check clean with the profile active *and* without it. Maintainer ruling
  #833 keys `ol-reserved-word` to the grammar's four declaration slots only, and
  `spec/grammar.md:386` makes accepting any name in a binding position a MUST. See the terminal-slice
  notes below for why this is a *pair* rather than a single fixture.

Fixture shape and conventions: see [`../README.md`](../README.md).

## What the terminal slice (#688) added

The claim slice audited the corpus against `spec/interaction-events.md` before claiming, and closed
the gaps it found rather than rubber-stamping them:

- **Intra-kind same-tick delivery order.** `spec/interaction-events.md:95-100` is a four-item MUST —
  pending `when`, then `on_key`, then `on_click`, then due `every`, **each in registration order**.
  The corpus proved the *cross-kind* order (`dispatch/cross-kind-order-during-wait`, one handler per
  kind) and item 4's intra-kind order (`dispatch/every-multi-same-tick-deterministic`), but items
  1-3 had no shared drain point at all: `on-key-registered-twice`/`on-click-registered-twice` prove
  registration only and record that neither handler fires, and `when-registration-order` covers only
  `"start"`, which a batch run is already delivering, so its two handlers each fire at their own
  registration and are never pending together. Three fixtures now deliver ONE key / ONE click / ONE
  named event to TWO handlers apiece — `on_key/on-key-handlers-fire-in-registration-order`,
  `on_click/on-click-handlers-fire-in-registration-order`,
  `when/when-host-event-handlers-fire-in-registration-order` — each pinning the order twice over,
  by the printed values and by the handler-start `instruction` spans. Verified genuine by mutation:
  reversing each drain in `packages/runtime/src/interaction.ts` fails exactly these three fixtures
  and **no other fixture in the corpus**.
- **The non-number `ol-type` branch** for the two numeric-argument forms, together with its positive
  complement. The existing negatives cover a value that is a number but not whole (`2.5`, `1.5`);
  `every/every-non-number-type-error` and `wait/wait-non-number-type-error` cover a value that is not
  a number at all. Crucially they are paired with `every/every-numeric-word-accepted` and
  `wait/wait-numeric-word-accepted`, because `spec/execution-model.md:33-34` makes "words that parse
  as numbers are accepted where a number is expected" a normative **Core** rule: `wait "2"` is legal
  and must pause for 2 ticks. Without the positive half, an implementation that rejected *every*
  word — violating that Core rule — would pass the whole corpus while the negatives looked like
  proof that words are simply illegal here. The negatives originally recorded an observable wording
  asymmetry — `every` reported `params.expected: "whole number"` where `wait` reported `"number"`
  for the identical case — flagged here as normatively binding because the harness compares
  `params` exactly. **Issue #775 has since resolved it**: `executeWaitCall` now type-checks through
  the same shared `requireWholeNumber` as `executeEveryStatement` (and as `repeat` and `random`), so
  both forms report `expected: "whole number"` with matching `actual`/`value` — one shared type
  vocabulary; `params.operation` still names the primitive, so the two diagnostics stay
  distinguishable. `wait/wait-non-number-type-error` was updated in that PR as the deliberate,
  disclosed conformance-breaking change it is, and the pair `wait/wait-non-whole-word` /
  `every/every-non-whole-word` was added there for the third arm the corpus had never covered on
  either side: a *word* that parses as a non-whole number (`wait "1.5"`, `every "2.5"`), which pins
  `actual: "word"` and the value as written rather than the pre-coerced `number` the old
  `requireNumber` path reported. That arm is the only one that observes pre-coercion — a number
  literal was never a word, and a non-numeric word never coerces at all — and its absence was found
  by mutation: reintroducing the pre-coercion on `every` survived a fully green run.
- **The arms of the two numeric-argument checks that only a *word* can reach**, added in the same
  PR after mutation testing found each of them surviving a fully green run. The corpus had always
  reached `ol-range` through a number literal (`wait -1`, `every 0`, `every -3`), so an
  implementation could guard the range only when the argument was literally a number and let
  `wait "-1"` **succeed** — emitting a trailing `primitive(wait)` as though a pause had run — or
  register an `every` handler with an interval of `0`. `wait/wait-negative-word` and
  `every/every-non-positive-word` close that, and they also pin a deliberate asymmetry that was
  undocumented: on the `ol-range` arm `params.value` is the **coerced number**, not the word,
  because range is a question about magnitude (which exists only after coercion) whereas `ol-type`
  is a question about what the learner actually wrote. Separately,
  `wait/wait-non-number-list-type-error`, `every/every-non-number-boolean-type-error`,
  `wait/wait-non-number-dict-type-error`, `every/every-non-number-record-type-error`, and the pair
  `wait/wait-turtle-type-error` / `every/every-turtle-type-error` cover a count that is neither a
  number nor a word — between them every `OLTypeName` outside `number`/`word`. Before them every
  `expected: "whole number"` fixture in the whole corpus (`wait`, `every`, `repeat`, `random`)
  pinned `actual` as only `number` or `word`, so an implementation could report anything at all for
  a list, dict, record, boolean, or turtle and still pass the full stack-neutral corpus —
  `spec/error-model.md` requires an `ol-type` to "name the expected learner concept, such as number,
  word, list, dict, record, or boolean", so mislabelling one violates a MUST. Each pins the value as
  well as the concept: the harness unwraps an `OLDict`/`OLRecord` into a plain key→value object
  before deep-comparing (see this corpus's top-level README, "Dict/record contents"), the record
  fixture opts into the reserved `__type` key so a same-shaped `struct` of another type cannot
  masquerade, and a turtle's value is the `{ "id": 1 }` shape `sprites/turtle-type-diagnostic`
  already binds. The dict/record and turtle fixtures declare the **Data** and **Sprites** profiles
  only to *construct* their values; the check under test is the Interaction one. Finally
  `wait/wait-negative-non-whole` and `every/every-negative-non-whole`, with their `-word` twins
  `wait/wait-negative-non-whole-word` and `every/every-negative-non-whole-word`, pin a count that is
  **both** non-whole and out of range — the only input class that can observe the normative
  TYPE-before-RANGE ordering (`spec/interaction-events.md`'s two entries, `spec/commands.md`'s
  `repeat` entry). Every other count fixture is non-whole *or* out of range, never both, so an
  implementation that checked range first passed the whole corpus while putting a fractional value
  into an `ol-range` count diagnostic — which `spec/error-model.md` scopes to a negative
  *whole*-number count — and silently splitting `wait`/`every` from `repeat`. The `-word` twins
  exist because a word takes the coercion path, so ordering could be correct for numbers and wrong
  for words; every one of these gaps was found by mutation.
- **Unconditional reservation of the four block-heads.** The pair
  `block-heads-reserved-under-profile` / `block-heads-reserved-under-core-only` runs the **byte-identical**
  source both ways: the same `define`s raising `ol-reserved-word` under the active profile, and the
  same diagnostics under Core Language alone. Either fixture alone is satisfied by an
  implementation that answers the same way for the wrong reason; only the pair pins the rule as
  invariant under the profile set (`spec/grammar.md:408`).

  Both fixtures of that pair use `define`, which issue #837 confirmed is the right slot: maintainer
  ruling #833 keys `ol-reserved-word` to the grammar's four **declaration** slots and frees every
  **binding** position for every name (`spec/grammar.md:363,386`). The second pair
  `bindings-free-with-interaction` / `bindings-free-core-only` runs a byte-identical *binding* source
  both ways — `:when = 1`, `set every to 2`, a `for on_key in …` binder, and `local on_click` — and
  is clean in both directions, so profile-word binding freedom is pinned as **profile-independent**
  rather than inferred. The two profile sets differ by exactly `interaction-events`, since this
  profile depends only on Core (`PROFILE_DEPS`), so nothing else confounds the comparison. It mirrors
  the Sprites `reserved-bindings-with-sprites` / `-without-sprites` pair.
- **Description corrections.** Three fixtures still deferred handler delivery to "a later
  interactive host slice" that #686 had already landed (`on-key-registered-not-delivered`,
  `on-click-registered-not-delivered`, `when-stop-registered-not-delivered` — and `"stop"` is in
  fact host-deliverable via `hostInput`), and three asserted `interaction-events` was *not* in
  `SUPPORTED_PROFILES`, which this slice's own claim falsifies. All six now state what their fixture
  actually pins.

**Landed after the audit: the `input-prompt-*` fixtures.** #681 shipped 751 fixtures rather than 752
by withdrawing `input-prompt-not-text`, because **#768** recorded both readings of "the prompt cannot
be displayed as learner text" (`spec/interaction-events.md:142`) as defensible, and a fixture is
normative for every implementation. #768 has since been ruled — the prompt MUST be a `word` — and the
spec states that outright at `:129`/`:131`, so the four `input-prompt-*` fixtures described under
`input/` above now transcribe a normative clause rather than settling a contested one. The runtime
unit tests in `packages/runtime/src/interaction-input.test.mjs` remain, covering the three rejected
kinds a fixture would have to import another profile to reach (`dict`, `record`, `turtle`).

**Landed under maintainer ruling #984: the two undecided rules, and a third.** This section used to
record a `when` repeated-delivery fixture as **deliberately withheld**. The #688 review had found,
and the author confirmed by direct execution, that a `when` handler fired **at most once per run**:
with the same named event delivered at tick 1 and tick 2 the body ran once, whereas an `on_key`
handler given the same key at both ticks ran twice. That was deliberate implemented behavior locked
only by a runtime flag and a unit test, and no fixture in this corpus delivered a named event twice,
so the corpus neither pinned nor contradicted it. The stated reason for withholding was sound —
**the spec did not settle it**, and a fixture asserting either reading would have bound every
implementation to a clause the spec had not written.

The claim that a ruling had been *requested*, however, was false when it was written: no such issue
existed, and the #661 Epic Gate found it by searching. That is the same defect class epic #901 exists
to close, sitting inside the conformance corpus itself. Issue **#984** was then filed, and ruled:

1. **`when` is persistent** — its block runs each time its event occurs, once per occurrence
   (`spec/interaction-events.md:169-174`).
2. **Coalescing one missed `every` occurrence is required**, not permitted (`:189-196`). The runtime's
   contrary reading — that zero overlapping invocations satisfies an "at most one" *upper bound* —
   was rejected.
3. **`every n` is fixed rate** (`:183-187`), a third rule the audit had not surfaced: the interval
   clock keeps its own schedule and a late invocation does not re-measure the period.
4. **A handler does not extend the run's lifetime** (`:198-204`), a fourth the ruling added while
   settling the third: once the main line has finished and any already-started handler body has
   completed, the run closes and a queued-but-unstarted occurrence is discarded.

Thirteen fixtures land with it — three under `when/` and ten under `every/`, described in those
sections above. Two properties of this corpus are worth recording, because they are why the rules
could ship undecided at all. First, **the ruling's first three rules changed nothing the corpus could
see**: 910 fixtures passed before that runtime change and 910 passed after, so not one of them
discriminated any of the three. The fixtures listed above were added precisely to close
that gap, and each is mutation-verified against the readings the rulings reject. A dimension nothing varies is a dimension nothing can observe.
Second, the two `when` fixtures that pin persistence **must** use a vendor-prefixed event word
(`spec/interaction-events.md:166-167`): both standard v0.1 words are inherently once-per-run, so with
`"start"` or `"stop"` a one-shot and a persistent implementation emit byte-identical streams.

One coverage note, recorded because it is easy to misread the list above as complete: the rule that a handler body does NOT open a main-line boundary -- so a drained occurrence cannot re-enter its own handler -- is pinned by none of the fixtures listed above. It is caught by the pre-existing `every-sibling-not-reordered-by-nested-wait`, plus a stack-specific unit test. That is not a hole, but the guarantee lives outside the group that was added for it.

Every one of the thirteen was mutation-verified against runtimes reverted to each rejected reading —
including the drain, not merely the queueing. That distinction was not academic: this issue's first
implementation queued correctly and drained only at the next event-loop checkpoint, which silently
discarded the occurrence whenever the program's `wait`s ran out first, and its three `every` fixtures
were written *from* that runtime and so encoded the defect rather than catching it. One of them was
the failing case plus a single trailing `wait 1` token. A fixture derived from the implementation
cannot falsify the implementation; only mutating the behaviour it claims to pin can show whether it
pins anything.
