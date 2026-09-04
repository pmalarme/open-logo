# Sound conformance fixtures

Fixtures for the **Sound** profile — sound and music primitives (`spec/conformance.md#sound`,
`spec/interaction-events.md` §Sound primitives). It may share the execution event stream with
Interaction & Events, but it is a **separate** optional profile. These fixtures were landed by
epic **#658**'s slices (**#689**–**#692**) and the profile is claimed by its terminal slice
(**#693**).

**Normative dependencies** (`spec/conformance.md` profile DAG): Sound is a separate optional profile
depending only on **Core Language**. This matches `PROFILE_DEPS.sound = ["core-language"]` in
`scripts/harness/index.mjs`.

As of #693, `sound` is claimed in `packages/core/src/host-metadata.ts`'s `SUPPORTED_PROFILES` and
listed in `scripts/examples-gate.mjs`'s `IMPLEMENTED_PROFILES`, so `spec/examples/11-music.logo`
runs (rather than SKIPs) in the examples gate.

The suite covers all five Sound commands (`set_tempo`, `note`, `play`, `beep`, `rest`): positive
event-stream fixtures, negative `ol-type`/`ol-range` fixtures, and `check/` recognition fixtures
(the profile-active clean program plus the Core-only rejection where each command is an
`ol-unknown-command`). Every `sound` event is emitted unconditionally — modeling the muted-environment
guarantee (`spec/interaction-events.md:337-340`) that implementations which cannot play audio still
emit `sound` trace events for deterministic replay.

Fixture shape and conventions: see [`../README.md`](../README.md).
