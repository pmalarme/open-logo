# Sprites conformance fixtures

Fixtures for the **Sprites** profile — multiple turtles/sprites, turtle identity, sprite
addressing, and per-turtle execution (`spec/conformance.md#sprites`,
`spec/turtles-and-sprites.md`). Fixtures land here as epic **#658**'s Sprites terminal slice
(**#679**) implements the profile.

**Normative dependencies** (`spec/conformance.md` profile DAG): Sprites depends on
**Turtle & Rendering** (which itself depends on Core Language). This matches
`PROFILE_DEPS.sprites = ["turtle-rendering"]` in `scripts/harness/index.mjs`.

Until #679 claims `sprites` in `packages/core/src/host-metadata.ts`'s `SUPPORTED_PROFILES`, the
examples gate SKIPs (with a visible notice) any `spec/examples/*.logo` that requires it — see
`scripts/examples-gate.mjs`. This directory is registration scaffolding (issue #666); it carries no
fixtures yet, and an empty profile fixture set keeps the suite green.

Fixture shape and conventions: see [`../README.md`](../README.md).
