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

## What the per-turtle fixtures actually prove

`spec/turtles-and-sprites.md:113` makes two demands of a turtle command: it "applies once for each
addressed turtle", and its trace events carry "the appropriate turtle identity". Two distinct
fixture shapes are used here, and they are **not** interchangeable — keep the distinction when
citing one as proof:

- **Direct fan-out**: the command itself is the statement under a multi-turtle `tell` (or is run by
  `each`'s per-iteration narrowing), so one statement must produce one stamped event *per turtle*.
  Covered for `forward` (`tell-two-turtles-move`, `:107`), `set_shape` (`shape-tell-two-turtles`)
  and `hide_turtle` (`visibility-each-two-turtles`) on `:110`, and on `:109` for `stamp`
  (`stamp-per-turtle-shape`) and `fill` (`fill-tell-two-turtles`, plus `fill-each-per-turtle-color`
  for the `each` narrowing).
- **State isolation**: the command runs under a *single-turtle* `ask` to diverge one turtle's state,
  and a later fanned-out command's events then differ per turtle. This proves the state is
  per-turtle, **not** that the command itself fans out. This is the shape of
  `pen-state-per-turtle` (`pen_up` on `:a`, observed as a missing `draw-segment` under a fanned-out
  `forward`) and `color-width-per-turtle` (`set_color`/`set_width` on `:a`, observed as divergent
  `draw-segment` colour/width).

**Why the state-isolation shape is still sufficient for the other four.** `pen_up`/`pen_down` and
`set_color`/`set_width` have no direct fan-out fixture, but they are not unproven: stamping happens
only inside `runPerTurtleCommand`, and `ask` marks addressing explicit, so even a single-turtle
`ask` yields a stamped event that only the per-turtle dispatch path can produce. Removing any one of
them from that dispatch set therefore fails the corpus — verified by mutation, each reverted:
dropping `set_color` fails 5 fixtures, the shared `pen_up`/`pen_down` entry 2, and `set_width` 1.
The shared one-statement-to-N-turtles loop they run in is itself proven by the direct fan-out
fixtures above. So what these four lack is only the N-events-from-one-statement *shape*, not proof
that they are per-turtle. (`pen_down` is the default pen state, so it has no isolation fixture of
its own; it shares one dispatch entry with `pen_up`, which the mutation above covers.)

Fixture shape and conventions: see [`../README.md`](../README.md).
