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

Every one of the six per-turtle commands named at `spec/turtles-and-sprites.md:109` — `pen_up`,
`pen_down`, `set_color`, `set_width`, `fill`, `stamp` — now has a fixture proving the `:113` MUST
for it: that it applies once per addressed turtle and that its events carry the acting turtle's
identity. `pen-state-per-turtle` (pen state), `color-width-per-turtle` (colour + width),
`fill-tell-two-turtles`/`fill-each-per-turtle-color` (fill), and `stamp-per-turtle-shape` (stamp).
The commands on the neighbouring lines are covered alongside them by `tell-two-turtles-move`
(`forward`, `:107`), `shape-tell-two-turtles` (`set_shape`, `:110`), and
`visibility-each-two-turtles` (`hide_turtle`, `:110`).

Fixture shape and conventions: see [`../README.md`](../README.md).
