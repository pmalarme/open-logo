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

Fixture shape and conventions: see [`../README.md`](../README.md).
