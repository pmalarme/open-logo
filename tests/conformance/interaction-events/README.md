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
  (`spec/interaction-events.md:126-137`). Per the maintainer's ruling on #657, `input` is tested by
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
  gated on the profile, as `spec/conformance.md:167-169` and `spec/interaction-events.md:11`
  require.

  **The prompt's `ol-type` (`:131`) is now fixtured — the #768 ruling settled it.** #681 withheld
  a fixture because "the prompt cannot be displayed as learner text" had two defensible readings and
  a fixture is normative for every implementation ("Any conforming implementation should pass them",
  `.github/skills/shared/conformance-fixture/SKILL.md:13-15`), so shipping one would have settled a
  contested clause by fixture instead of by ruling. The maintainer then ruled **narrower than either
  reading on the table**: the prompt MUST be a `word`, so `number` and `boolean` are rejected
  alongside `list`/`dict`/`record`/`turtle`, and the diagnostic carries `expected: "word"` — the
  identity the `word` reporter itself reports (`word "Question" 3`) and the one `when`/`on_key` use —
  rather than #681's one-off `expected: "text"`. `spec/interaction-events.md:129`/`:131` now state
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
  Issue **#828** adds `when-firing-counts-against-budget`: a handler *firing* is itself one charged
  instruction, so an empty-bodied `"start"` handler consumes the instruction the following statement
  would have had and a budget of 2 raises `ol-limit`.
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
  `every-single-registration-budgeted` — same empty body, same ticks, same budget — completes cleanly,
  so the diagnostic is caused by the accumulation and not by a budget too small for any program.
- **`on_key/`** — the `on_key <key-word> <block>` keyboard handler (issue #684, slice I5):
  registration emits `primitive` after the handler is registered; a key press is host input, so in a
  headless batch run the handler is registered but never delivered (locked by
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
  host input, so in a headless batch run the handler is registered but never delivered (locked by
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
  each in registration order (`spec/interaction-events.md:84-89`) — `cross-kind-order-during-wait`
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
  (`spec/interaction-events.md:91-93` requires preserving pending key/click state). Like the harness's
  `signal`, JSON can express only a STATIC tick→deliveries schedule fixed before the run; input that
  reacts to program state stays a unit-test concern. It is host execution context, never observable in
  any event payload; it is NOT a device/TTY, defines no coalescing policy, and is NOT the blocking
  `input` reporter — that reporter's scripted answers are the sibling `hostInput.responses` field
  (#681/#657, see `input/` above).
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
  `ol-reserved-word` (`namespace: "primitive"`) under an active profile, the primitive branch of the
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

- **Intra-kind same-tick delivery order.** `spec/interaction-events.md:84-89` is a four-item MUST —
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
- **Profile-scoped reservation of the four block-heads.** `spec/interaction-events.md:43-46` reserves
  `when`/`every`/`on_key`/`on_click` **only within** the profile — a bidirectional MUST that had no
  fixture at all: `redefine-wait-reserved` covers only `wait`, which is a *primitive* name
  (`namespace: "primitive"`), not a reserved block-head. The new pair
  `block-heads-reserved-under-profile` / `block-heads-free-core-only` runs the **byte-identical**
  source both ways — four `define`s raising `ol-reserved-word` with `namespace: "reserved"` under the
  active profile, and checking clean under Core Language alone. Either fixture alone is satisfied by
  an implementation that reserves the words unconditionally or by one that never reserves them; only
  the pair pins the scope. This is the same gap class the Sprites terminal slice #679 found for its
  own `ol-reserved-word` rule. (The recorded `message` reads "when is already a reserved, so it
  can't be redefined here." — an ungrammatical pre-existing template in
  `packages/parser/src/checker-reserved-word.ts`, already recorded by three Sprites fixtures.
  `message` is excluded from harness comparison, so it binds nothing and fixing it needs no fixture
  change; **filed as a follow-up** for `@language-designer`.)

  Both fixtures of that pair use `define`, which issue #837 confirmed is the right slot: maintainer
  ruling #833 keys `ol-reserved-word` to the grammar's four **declaration** slots and frees every
  **binding** position for every name (`spec/grammar.md:363,386`). The second pair
  `bindings-free-with-interaction` / `bindings-free-core-only` runs a byte-identical *binding* source
  both ways — `:when = 1`, `set every to 2`, a `for on_key in …` binder, and `local on_click` — and
  is clean in both directions, so profile-word binding freedom is pinned as **profile-independent**
  rather than inferred. The two profile sets differ by exactly `interaction-events`, since this
  profile depends only on Core (`PROFILE_DEPS`), so nothing else confounds the comparison. It mirrors
  the Sprites `reserved-bindings-with-sprites` / `-without-sprites` pair, whose two halves became
  clean under the same ruling.
- **Description corrections.** Three fixtures still deferred handler delivery to "a later
  interactive host slice" that #686 had already landed (`on-key-registered-not-delivered`,
  `on-click-registered-not-delivered`, `when-stop-registered-not-delivered` — and `"stop"` is in
  fact host-deliverable via `hostInput`), and three asserted `interaction-events` was *not* in
  `SUPPORTED_PROFILES`, which this slice's own claim falsifies. All six now state what their fixture
  actually pins.

**Landed after the audit: the `input-prompt-*` fixtures.** #681 shipped 751 fixtures rather than 752
by withdrawing `input-prompt-not-text`, because **#768** recorded both readings of "the prompt cannot
be displayed as learner text" (`spec/interaction-events.md:131`) as defensible, and a fixture is
normative for every implementation. #768 has since been ruled — the prompt MUST be a `word` — and the
spec states that outright at `:129`/`:131`, so the four `input-prompt-*` fixtures described under
`input/` above now transcribe a normative clause rather than settling a contested one. The runtime
unit tests in `packages/runtime/src/interaction-input.test.mjs` remain, covering the three rejected
kinds a fixture would have to import another profile to reach (`dict`, `record`, `turtle`).

**Deliberately NOT added: a repeated-delivery fixture for `when`.** The #688 review found, and the
author confirmed by direct execution, that a `when` handler fires **at most once per run**: with the
same named event delivered at tick 1 and tick 2, the body runs once, whereas an `on_key` handler
given the same key at both ticks runs twice. This is deliberate implemented behavior (`WhenHandler.fired`
in `packages/runtime/src/interaction.ts`, locked by the #686 unit test "a one-shot `when` handler
fires at most once even if its event is pending twice"), and no fixture in this corpus delivers a
named event twice, so the corpus neither pins nor contradicts it.

It is left unfixtured on purpose, for the reason `input-prompt-not-text` was withheld before #768
ruled: **the spec does not settle it.** `spec/interaction-events.md` says a handler invocation is
enqueued "when an event fires" but never states whether a `when` registration is one-shot or
persistent, and both standard
v0.1 event words are inherently once-per-run — `"start"` is "the start of the interactive run" and
`"stop"` is "a requested stop notification before termination" (`:152-156`). A fixture asserting
either reading would bind every implementation to a clause the spec has not written, and the
alternative reading matters mainly for the vendor-prefixed events the spec permits but does not
define. This also sits in `packages/runtime/`, outside this slice's write-set. **Filed for a
maintainer ruling; a fixture lands once that ruling exists.**
