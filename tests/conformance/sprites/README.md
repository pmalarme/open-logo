# Sprites conformance fixtures

Fixtures for the **Sprites** profile — multiple turtles/sprites, turtle identity, sprite
addressing, and per-turtle execution (`spec/conformance.md#sprites`,
`spec/turtles-and-sprites.md`). Epic **#660**'s Sprites terminal slice (**#679**) audited the
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
  `each`'s per-iteration narrowing), so the command is applied once per addressed turtle and each
  application's turtle-specific events are stamped with that turtle. Note a single application may
  emit more than one stamped event — a fanned-out `forward` emits both a `move` and a `draw-segment`
  per turtle.
- **State isolation**: the command runs under a *single-turtle* `ask` to diverge one turtle's state,
  and a later fanned-out command's events then differ per turtle. This proves the state is
  per-turtle, **not** that the command itself fans out. This is the shape of
  `pen-state-per-turtle` (`pen_up` on `:a`, observed as a missing `draw-segment` under a fanned-out
  `forward`) and `color-width-per-turtle` (`set_color`/`set_width` on `:a`, observed as divergent
  `draw-segment` colour/width).

### Per-turtle command coverage

The 16 per-turtle commands of `spec/turtles-and-sprites.md:107`, `:109`, and `:110`, and how each is
proven per-turtle under explicit Sprites addressing. **This table is hand-derived and nothing checks
it** — a coverage claim in prose or in an unchecked table drifts the moment coverage changes, so
treat it as a reader's index into the corpus, not as an asserted invariant. The authority is the
fixtures themselves; when they disagree with this table, the fixtures win and this table is stale.

| Spec line | Command | Shape | Representative fixture |
|---|---|---|---|
| `:107` | `forward` | direct fan-out | `tell-two-turtles-move` |
| `:107` | `back` | direct fan-out | `back-tell-two-turtles` |
| `:107` | `left` | direct fan-out | `left-tell-two-turtles` |
| `:107` | `right` | direct fan-out | `each-two-turtles-who` (stamps a `turn` for turtles 1 and 2) |
| `:107` | `home` | direct fan-out | `ask-turtles-each-canonical` |
| `:107` | `set_xy` | direct fan-out | `set-xy-tell-two-turtles` |
| `:107` | `set_heading` | direct fan-out | `set-heading-tell-two-turtles` |
| `:109` | `pen_up` | direct fan-out + state isolation | `ask-turtles-each-canonical`, `pen-state-per-turtle` |
| `:109` | `pen_down` | direct fan-out | `ask-turtles-each-canonical` |
| `:109` | `set_color` | state isolation | `color-width-per-turtle` |
| `:109` | `set_width` | state isolation | `color-width-per-turtle` |
| `:109` | `fill` | direct fan-out | `fill-tell-two-turtles`, `fill-each-per-turtle-color` |
| `:109` | `stamp` | direct fan-out | `stamp-per-turtle-shape` |
| `:110` | `show_turtle` | direct fan-out | `show-turtle-tell-two-turtles` |
| `:110` | `hide_turtle` | direct fan-out | `visibility-each-two-turtles` |
| `:110` | `set_shape` | direct fan-out | `shape-tell-two-turtles` |

Notes on the table:

- **`set_color`/`set_width` have only the state-isolation shape**, not a direct fan-out fixture, but
  they are not unproven: stamping happens only inside `runPerTurtleCommand`, and `ask` marks
  addressing explicit, so even a single-turtle `ask` yields a stamped event that only the per-turtle
  dispatch path can produce. Removing either from that dispatch set fails the corpus — verified by
  mutation, each reverted: dropping `set_color` fails 5 fixtures, `set_width` 1. What these two lack
  is only the N-applications-from-one-statement *shape*, not proof that they are per-turtle.
- **Heritage aliases `setxy`/`seth`** are exercised for the single default turtle in the
  Turtle & Rendering corpus (`turtle-rendering/movement/setxy-alias`, `seth-alias`) but have no
  Sprites-addressed execution fixture of their own; the canonical `set_xy`/`set_heading` fan-out is
  covered above and the aliases dispatch through the same predicate.
- Each `:107`/`:110` fixture above was **mutation-checked** (issue #792): stamping the acting
  turtle's id as the main turtle's makes every one FAIL (proving per-turtle identity), and making the
  command read the main turtle's state instead of the addressed turtle's also makes each FAIL
  (proving the per-turtle state read), because the two addressed turtles share the single main
  turtle's mutable state once misdirected there.

Fixture shape and conventions: see [`../README.md`](../README.md).
