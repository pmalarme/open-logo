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
 * {@link MAIN_TURTLE_ID}.
 *
 * Deterministic in, deterministic out: identical event input always folds to an identical map,
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
 * Per-turtle state keyed by turtle identity: every live turtle's own {@link TurtleState}. The main
 * turtle ({@link MAIN_TURTLE_ID}) is always present; each `new_turtle` adds one entry when its
 * `spawn-turtle` event is folded. Insertion order is creation order (the main turtle first, then
 * each spawn), matching the `turtles` reporter's order so a renderer can iterate sprites
 * deterministically.
 */
export type TurtleWorldState = ReadonlyMap<TurtleId, TurtleState>;

/**
 * The program-start world: just the main turtle at its {@link INITIAL_TURTLE_STATE}. Frozen and
 * shared, like {@link INITIAL_TURTLE_STATE} itself; every reducer call returns a fresh map rather
 * than mutating this one, so it is safe to reuse as the seed for any fold.
 */
export const INITIAL_TURTLE_WORLD_STATE: TurtleWorldState = Object.freeze(
  new Map<TurtleId, TurtleState>([[MAIN_TURTLE_ID, INITIAL_TURTLE_STATE]]),
) as TurtleWorldState;

/**
 * Reduces one trace event into the next per-turtle world state. A `spawn-turtle` event registers
 * the newly created turtle at the full initial state its payload carries
 * (`spec/turtles-and-sprites.md`'s "Turtle creation" section — a new turtle starts at the same
 * defaults as the main turtle but is nonetheless recorded from its own payload so a renderer never
 * has to assume them). Every other event is delegated to the single-turtle
 * {@link reduceTurtleState} against the state of the turtle its `turtle_id` names, defaulting to
 * {@link MAIN_TURTLE_ID} when the envelope carries none — the implicit main turtle before any
 * `tell`, and every Core/Turtle & Rendering event, which never carry a `turtle_id`. An event whose
 * `turtle_id` names a turtle not yet present (which cannot happen for a well-formed stream, since a
 * turtle's `spawn-turtle` always precedes its commands) is ignored rather than inventing a turtle,
 * keeping the reducer total without fabricating identities.
 */
export function reduceTurtleWorldState(
  world: TurtleWorldState,
  event: TraceEvent,
): TurtleWorldState {
  if (event.kind === "spawn-turtle") {
    const payload = event.payload as SpawnTurtlePayload;
    const next = new Map(world);
    next.set(payload.turtle_id, {
      position: payload.position,
      heading: payload.heading,
      penDown: payload.pen === "down",
      color: payload.color,
      width: payload.width,
      shape: payload.shape,
      visible: payload.visible,
    });
    return next;
  }
  const id = event.turtle_id ?? MAIN_TURTLE_ID;
  const current = world.get(id);
  if (current === undefined) {
    return world;
  }
  const reduced = reduceTurtleState(current, event);
  if (reduced === current) {
    return world;
  }
  const next = new Map(world);
  next.set(id, reduced);
  return next;
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
