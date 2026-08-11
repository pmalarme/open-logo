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
that requires it — see `scripts/examples-gate.mjs`. This directory is registration scaffolding
(issue #666); it carries no fixtures yet, and an empty profile fixture set keeps the suite green.

Fixture shape and conventions: see [`../README.md`](../README.md).
