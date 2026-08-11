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

Fixture shape and conventions: see [`../README.md`](../README.md).
