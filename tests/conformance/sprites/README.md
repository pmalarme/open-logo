# Sprites conformance fixtures

Fixtures for the **Sprites** profile — multiple turtles/sprites, turtle identity, sprite
addressing, and per-turtle execution (`spec/conformance.md#sprites`,
`spec/turtles-and-sprites.md`). Epic **#658**'s Sprites terminal slice (**#679**) audited the
profile and claimed it.

**Normative dependencies** (`spec/conformance.md` profile DAG): Sprites depends on
**Turtle & Rendering** (which itself depends on Core Language). This matches
`PROFILE_DEPS.sprites = ["turtle-rendering"]` in `scripts/harness/index.mjs`.

`sprites` is claimed in `packages/core/src/host-metadata.ts`'s `SUPPORTED_PROFILES` and in
`scripts/examples-gate.mjs`'s `IMPLEMENTED_PROFILES` (#679), so `spec/examples/09-sprites.logo`
RUNS in the examples gate rather than being SKIPped.

Fixture shape and conventions: see [`../README.md`](../README.md).
