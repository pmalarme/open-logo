# Sound conformance fixtures

Fixtures for the **Sound** profile — sound and music primitives (`spec/conformance.md#sound`,
`spec/interaction-events.md` §Sound primitives). It may share the execution event stream with
Interaction & Events, but it is a **separate** optional profile. Fixtures land here as epic
**#658**'s Sound terminal slice (**#693**) implements the profile.

**Normative dependencies** (`spec/conformance.md` profile DAG): Sound is a separate optional profile
depending only on **Core Language**. This matches `PROFILE_DEPS.sound = ["core-language"]` in
`scripts/harness/index.mjs`.

Until #693 claims `sound` in `packages/core/src/host-metadata.ts`'s `SUPPORTED_PROFILES`, the
examples gate SKIPs (with a visible notice) any `spec/examples/*.logo` that requires it — see
`scripts/examples-gate.mjs`. This directory is registration scaffolding (issue #666); it carries no
fixtures yet, and an empty profile fixture set keeps the suite green.

Fixture shape and conventions: see [`../README.md`](../README.md).
