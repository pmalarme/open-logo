/**
 * The **per-turtle** state reducer: folds the normative trace/event stream (`@openlogo/core`'s
 * `TraceEvent`/`EventKind` registry) into a deterministic, render-agnostic map from turtle
 * identity to that turtle's own state (position, heading, pen, color, width, shape, visibility).
 *
 * Under the **Sprites** profile a program drives many addressable turtles, and every per-turtle
 * effect event carries the acting turtle's `turtle_id` on its envelope
 * (`spec/turtles-and-sprites.md`'s "Per-turtle state and Turtle commands" section:
 * "Implementations MUST produce trace events with the appropriate turtle identity so animation,
 * stepping, `why`, and `debug` can explain which turtle moved or changed"). The single-turtle
 * {@link reduceTurtleState} folds *one* {@link TurtleState} and ignores `turtle_id`, so it cannot
 * follow a sprite drawing: it would collapse every turtle's shape/visibility/position into one
 * state. This reducer is that sibling — it routes each event to the state of the turtle its
 * `turtle_id` names, so a renderer can draw each sprite's avatar with its own shape and visibility.
 *
 * It reuses {@link reduceTurtleState} unchanged for the per-turtle fold: the routing lives here,
 * the field-by-field state transitions stay in one place. A turtle first appears via its
 * `spawn-turtle` event (`spec/turtles-and-sprites.md`'s "Turtle creation" section), whose payload
 * carries the turtle's full initial state; the **main turtle** — the single default turtle every
 * program starts with, whose Turtle & Rendering events carry *no* `turtle_id` before any `tell`
 * (`spec/turtles-and-sprites.md`'s "Addressing model") — is present from the start under
 * {@link MAIN_TURTLE_ID}. Alongside the per-turtle states it tracks the **active** turtle, the
 * identity `spec/rendering.md:115`/`:191` require the avatar and the non-visual state description
 * to name once a program drives more than one turtle.
 *
 * Deterministic in, deterministic out: identical event input always folds to an identical world,
 * with no timing, randomness, or rendering concerns here.
 */

import type { SpawnTurtlePayload, TraceEvent, TurtleId } from "@openlogo/core";

import {
  INITIAL_TURTLE_STATE,
  type TurtleState,
  reduceTurtleState,
} from "./state.js";

/**
 * The reserved id of the **main turtle** — the single default turtle every program starts with,
 * the one Turtle & Rendering commands drive before any `new_turtle`. It is `0` to match
 * `@openlogo/runtime`'s `MAIN_TURTLE_ID` (the allocator that seeds the `turtle_id` this reducer
 * routes on), so a per-turtle event stamped with `turtle_id: 0` and an un-stamped main-turtle
 * event (no `turtle_id`, emitted before any `tell`) fold into the *same* turtle here. Defined
 * locally rather than imported because `@openlogo/turtle` consumes the event stream and must not
 * depend on `@openlogo/runtime` (the dependency runs turtle → core, never turtle → runtime).
 */
export const MAIN_TURTLE_ID: TurtleId = 0;

/**
 * The whole turtle world a renderer paints and describes: every live turtle's own
 * {@link TurtleState}, plus which of them is **active**.
 *
 * - {@link TurtleWorldState.turtles} is keyed by turtle identity. The main turtle
 *   ({@link MAIN_TURTLE_ID}) is always present; each `new_turtle` adds one entry when its
 *   `spawn-turtle` event is folded. Insertion order is creation order (the main turtle first, then
 *   each spawn), matching the `turtles` reporter's order so a renderer can iterate sprites
 *   deterministically.
 * - {@link TurtleWorldState.activeTurtleId} is the turtle that most recently moved or changed —
 *   the identity `spec/rendering.md:115` ("The turtle avatar … indicates the **active turtle's**
 *   position, heading, visibility, and shape") and `spec/rendering.md:191` ("Implementations with
 *   multiple turtles MUST identify the active turtle or addressed turtle set") require a renderer
 *   and its non-visual state text to name.
 *
 * The active turtle is derived from the trace stream alone, because that is all this package
 * consumes: `spec/execution-model.md`'s registry has no addressing event, so `tell`/`ask`/`each`
 * are invisible here — what *is* visible is each effect event's `turtle_id`
 * (`spec/turtles-and-sprites.md:113`: "Implementations MUST produce trace events with the
 * appropriate turtle identity so animation, stepping, `why`, and `debug` can explain **which
 * turtle moved or changed**"). So "active" here means exactly that: the turtle whose own state the
 * most recently folded event changed. During stepping and animation — the cases the avatar and the
 * live a11y region exist for — that is the turtle a learner just watched act. It is deliberately
 * *not* a claim about the runtime's addressed set after an `ask` block restores it, which no
 * consumer of the event stream can observe.
 */
export interface TurtleWorldState {
  /** Every live turtle's own state, keyed by identity, in creation order. */
  readonly turtles: ReadonlyMap<TurtleId, TurtleState>;
  /** The turtle whose state the most recently folded event changed. */
  readonly activeTurtleId: TurtleId;
}

/**
 * Return `map` made genuinely immutable at runtime: its mutators (`set`/`delete`/`clear`) are
 * replaced with ones that throw, then the object is frozen. Used only for the shared
 * {@link INITIAL_TURTLE_WORLD_STATE} seed's turtle map so a JavaScript caller cannot corrupt it —
 * a plain `Object.freeze` does not suffice, because a frozen `Map` still honors `.set`. Reads
 * (`get`/`has`/iteration/`size`) are untouched.
 */
function freezeMap<K, V>(map: Map<K, V>): ReadonlyMap<K, V> {
  const frozen = map as Map<K, V> & {
    set: never;
    delete: never;
    clear: never;
  };
  const reject = (): never => {
    throw new TypeError("INITIAL_TURTLE_WORLD_STATE is immutable");
  };
  frozen.set = reject as never;
  frozen.delete = reject as never;
  frozen.clear = reject as never;
  return Object.freeze(frozen);
}

/**
 * The program-start world: just the main turtle at its {@link INITIAL_TURTLE_STATE}, active.
 * Shared as the default fold seed; every {@link reduceTurtleWorldState} call copies the turtle map
 * before mutating (`new Map(world.turtles)`), so this instance is never written through internally.
 * Its map is both typed `ReadonlyMap` (so the compiler rejects `.set`/`.delete`/`.clear`) and
 * genuinely frozen at runtime by {@link freezeMap}, so a JavaScript caller cannot mutate the shared
 * singleton and corrupt a later default fold either — `Object.freeze` alone would not do this,
 * because a frozen `Map` still honors `.set`. The wrapper object is `Object.freeze`d too, which
 * *is* sufficient for its two plain properties.
 */
export const INITIAL_TURTLE_WORLD_STATE: TurtleWorldState = Object.freeze({
  turtles: freezeMap(
    new Map<TurtleId, TurtleState>([[MAIN_TURTLE_ID, INITIAL_TURTLE_STATE]]),
  ),
  activeTurtleId: MAIN_TURTLE_ID,
});

/**
 * The {@link TurtleWorldState.activeTurtleId} turtle's own state — what the avatar and the
 * non-visual state description describe (`spec/rendering.md:115`). Every world this module folds
 * keeps `activeTurtleId` pointing at a turtle that is present in `turtles`, but the type does not
 * enforce that, so a hand-constructed world naming an absent turtle falls back to the program-start
 * {@link INITIAL_TURTLE_STATE} rather than throwing at paint or announce time.
 */
export function activeTurtleState(world: TurtleWorldState): TurtleState {
  return world.turtles.get(world.activeTurtleId) ?? INITIAL_TURTLE_STATE;
}

/**
 * Reduces one trace event into the next per-turtle world state. A `spawn-turtle` event registers
 * the newly created turtle at the full initial state its payload carries
 * (`spec/turtles-and-sprites.md`'s "Turtle creation" section — a new turtle starts at the same
 * defaults as the main turtle but is nonetheless recorded from its own payload so a renderer never
 * has to assume them). Creating a turtle does **not** make it active: `:friend = new_turtle` leaves
 * the addressed set alone (`spec/turtles-and-sprites.md:42`'s "Addressing model" — only
 * `tell`/`ask`/`each` change who acts), so the newly spawned turtle only becomes active once it
 * actually moves or changes.
 *
 * Every other event is delegated to the single-turtle {@link reduceTurtleState} against the state
 * of the turtle its `turtle_id` names, defaulting to {@link MAIN_TURTLE_ID} when the envelope
 * carries none — the implicit main turtle before any `tell`, and every Core/Turtle & Rendering
 * event, which never carry a `turtle_id`. An event whose `turtle_id` names a turtle not yet present
 * (which cannot happen for a well-formed stream, since a turtle's `spawn-turtle` always precedes
 * its commands) is ignored rather than inventing a turtle, keeping the reducer total without
 * fabricating identities.
 *
 * The turtle becomes {@link TurtleWorldState.activeTurtleId} exactly when the event genuinely
 * changed its state — the same condition that produces a new world. That is why non-state events
 * (`instruction`, `print`, `procedure-enter`, a `clean` clear, …) never re-point the active turtle:
 * they carry no `turtle_id` and would otherwise silently snap "active" back to the main turtle in
 * the middle of a sprite's block.
 */
export function reduceTurtleWorldState(
  world: TurtleWorldState,
  event: TraceEvent,
): TurtleWorldState {
  if (event.kind === "spawn-turtle") {
    const payload = event.payload as SpawnTurtlePayload;
    const turtles = new Map(world.turtles);
    turtles.set(payload.turtle_id, {
      position: payload.position,
      heading: payload.heading,
      penDown: payload.pen === "down",
      color: payload.color,
      width: payload.width,
      shape: payload.shape,
      visible: payload.visible,
    });
    return { turtles, activeTurtleId: world.activeTurtleId };
  }
  const id = event.turtle_id ?? MAIN_TURTLE_ID;
  const current = world.turtles.get(id);
  if (current === undefined) {
    return world;
  }
  const reduced = reduceTurtleState(current, event);
  if (reduced === current) {
    return world;
  }
  const turtles = new Map(world.turtles);
  turtles.set(id, reduced);
  return { turtles, activeTurtleId: id };
}

/**
 * Folds an ordered list of trace events into the resulting per-turtle world state, starting from
 * `initial` (defaulting to {@link INITIAL_TURTLE_WORLD_STATE}). Events MUST already be in
 * increasing `seq` order, per `spec/rendering.md`'s "Execution-event consumption" section — this
 * reducer does not sort or validate ordering, it only folds.
 */
export function reduceTurtleWorldEvents(
  events: readonly TraceEvent[],
  initial: TurtleWorldState = INITIAL_TURTLE_WORLD_STATE,
): TurtleWorldState {
  return events.reduce(reduceTurtleWorldState, initial);
}
