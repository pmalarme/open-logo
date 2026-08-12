# Interaction & Events conformance fixtures

Fixtures for the **Interaction & Events** profile — blocking `input`, waits, event handlers,
keyboard and pointer events, and timer-style behavior (`spec/conformance.md#interaction--events`,
`spec/interaction-events.md`). Core remains non-interactive: `input` is in this profile, not Core.
Fixtures land here as epic **#658**'s Interaction terminal slice (**#688**) implements the profile.

**Normative dependencies** (`spec/conformance.md` profile DAG): Interaction & Events is a separate
optional profile depending only on **Core Language**. This matches
`PROFILE_DEPS["interaction-events"] = ["core-language"]` in `scripts/harness/index.mjs`.

Until #688 claims `interaction-events` in `packages/core/src/host-metadata.ts`'s
`SUPPORTED_PROFILES`, the examples gate SKIPs (with a visible notice) any `spec/examples/*.logo`
that requires it — see `scripts/examples-gate.mjs`.

- **`wait/`** — the `wait <n>` tick-clock primitive (issue #680, slice I1).
- **`when/`** — the `when <event-word> <block>` named event handler (issue #682, slice I3):
  registration emits `primitive` after the handler is registered, a `"start"` handler fires
  immediately (the run has started), a `"stop"` handler fires once before termination, a non-word
  event is `ol-type`, a mismatched `end` label is `ol-mismatched-end`, and `check`-mode fixtures
  prove `when` is visible only under the `interaction-events` profile and rejected Core-only.
- **`every/`** — the `every <n> <block>` repeated timed handler (issue #683, slice I4):
  registration emits `primitive` after the handler is registered, the block first runs `n` ticks
  **after registration** (not at a global multiple of `n`) and repeats every `n` ticks while a `wait`
  pause advances the tick clock, a `wait 0` yields without redelivering a handler already fired on the
  current tick, a handler whose body's nested `wait` advances the clock through a sibling's next
  interval does not re-fire that sibling out of chronological order, a non-whole count is `ol-type`, a
  zero or negative count is `ol-range`, the event
  sequence is deterministic across runs, and `check`-mode fixtures prove `every` is visible only under
  the `interaction-events` profile and rejected Core-only.
- **`on_key/`** — the `on_key <key-word> <block>` keyboard handler (issue #684, slice I5):
  registration emits `primitive` after the handler is registered; a key press is host input, so in a
  headless batch run the handler is registered but never delivered (locked by
  `on-key-registered-not-delivered`, mirroring I3's `when "stop"`); a non-word key is `ol-type`, the
  multiline `... end on_key` form behaves identically to the bracket form, a mismatched `end` label is
  `ol-mismatched-end`, `on_key` registers correctly in awkward positions (nested in `repeat`,
  registered twice for the same key) with insertion-ordered handlers for #686/I7, and `check`-mode
  fixtures prove `on_key` is visible only under the `interaction-events` profile and rejected
  Core-only.
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
  `input` reporter (that is #681/#657).
- **`forms-check-clean/`** and **`forms-unknown-without-interaction/`** — the profile-wide tooling
  pair (issue #687, slice I8): one `check`-mode program that USES all five implemented forms
  together (`wait` plus the four block-heads, with `wait` nested inside a block inside `repeat`
  inside a procedure) and checks clean under the profile, and its negative twin asserting
  `ol-unknown-command` with exact head-word spans for each of the five when the profile is inactive.
  These prove name visibility and arity only — they do not execute, so handler delivery stays the
  job of the per-form directories above. The profile's `input` reporter is deliberately not covered:
  its slice (#681, I2) is unimplemented, so registering it with the checker would let a program
  check clean and then fail at runtime.
- **`redefine-wait-reserved/`** — also issue #687: redefining the profile primitive `wait` raises
  `ol-reserved-word` (`namespace: "primitive"`) under an active profile, the primitive branch of the
  rule rather than the reserved-word branch (`wait` is not one of the four reserved block-heads).

Fixture shape and conventions: see [`../README.md`](../README.md).
