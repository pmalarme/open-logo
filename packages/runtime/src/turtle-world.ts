/**
 * The turtle **world**: the authoritative, deterministic allocator of turtle identities for one
 * program run (`spec/turtles-and-sprites.md`'s "Turtle creation" and "Addressing model" sections).
 *
 * A turtle value compares by its stable `id` (`@openlogo/core`'s `OLTurtle`,
 * `spec/execution-model.md:900`: two turtle values are the same turtle exactly when their ids are
 * equal), so **id allocation *is* turtle identity**. That makes this module correctness-critical,
 * not bookkeeping: a duplicate id silently merges two distinct turtles into one under `==`, and an
 * unstable id silently splits one turtle into two. The world therefore guarantees ids are
 *
 * - **unique** per live turtle ({@link TurtleWorld.spawn} never returns an id it has returned
 *   before, nor the reserved {@link MAIN_TURTLE_ID}),
 * - **stable** for a turtle's whole life (an id, once allocated, is never reassigned or reused),
 *   and
 * - **deterministic** across runs (allocation is a plain increasing counter seeded identically
 *   every run), since the id also feeds `OLTurtle`'s `turtle #<id>` printed form and the
 *   `turtle-id` of turtle-specific trace events — replay and conformance fixtures depend on it.
 *
 * The **main turtle** — the single default turtle every program starts with, the one Turtle &
 * Rendering commands drive before any `new_turtle` — owns the reserved id {@link MAIN_TURTLE_ID}.
 * Reserving it means `who` is well-defined at top level before any `new_turtle` call, and the
 * first `new_turtle` gets the next id after it. The world seeds its live list with the main turtle,
 * so `turtles` reports the main turtle plus every spawned turtle in creation order.
 *
 * This lives in `@openlogo/runtime` rather than `@openlogo/turtle` because it is *identity
 * allocation during evaluation*, not rendering: `@openlogo/turtle` deterministically **consumes**
 * the runtime's trace/event stream (the dependency runs turtle → core, runtime → core; runtime
 * never imports turtle), so the mutable per-run allocator that the evaluator drives belongs here
 * next to {@link Environment}. It holds no drawing state (position, heading, pen, …); per-turtle
 * drawing state and the trace-event reducers are elsewhere. The Sprites addressing model
 * (`tell`/`ask`/`each`, the *current* turtle) is layered on top by later slices; this slice only
 * allocates identities and enumerates the live set.
 */

import type { TurtleId } from "@openlogo/core";

/**
 * The reserved, deterministic id of the **main turtle** — the default turtle every program starts
 * with (`spec/execution-model.md`'s initial turtle, `spec/turtles-and-sprites.md`'s "Addressing
 * model": at top level the addressed set is the single default turtle). It is `0` so that `who`
 * has a well-defined answer before any `new_turtle` runs and the first spawned turtle gets `1`,
 * matching the `spawn-turtle` payload ids the event registry documents
 * (`@openlogo/core`'s `SpawnTurtlePayload`).
 */
export const MAIN_TURTLE_ID: TurtleId = 0;

/**
 * The authoritative per-run turtle-identity allocator and live-turtle registry. One is created per
 * program run (on {@link Environment}); it starts holding just the main turtle
 * ({@link MAIN_TURTLE_ID}) and hands out a fresh, unique, stable id on every {@link spawn}.
 */
export class TurtleWorld {
  /**
   * Live turtle ids in creation order: {@link MAIN_TURTLE_ID} first, then each `new_turtle`'s id
   * as it was allocated. Backs {@link ids}; never reordered, and ids are never removed (v0.1 has
   * no turtle deletion), so every id here is stable for the whole run.
   */
  private readonly liveIds: TurtleId[] = [MAIN_TURTLE_ID];

  /**
   * The next id {@link spawn} will hand out. Starts one past the reserved main-turtle id and only
   * ever increases, so allocation is deterministic and no id is ever reused or duplicated.
   */
  private nextId: TurtleId = MAIN_TURTLE_ID + 1;

  /**
   * Allocate a brand-new turtle: reserve the next id, record it as live, and return it. The
   * returned id is unique (never previously allocated, never {@link MAIN_TURTLE_ID}), stable (it is
   * never reassigned), and deterministic (the counter is seeded identically every run), which is
   * exactly what the id-based turtle `==` needs to stay correct.
   */
  spawn(): TurtleId {
    const id = this.nextId;
    this.nextId += 1;
    this.liveIds.push(id);
    return id;
  }

  /**
   * The ids of every live turtle in creation order — the main turtle followed by every turtle
   * created with {@link spawn}. `turtles` maps this into the reported list; the returned array is a
   * fresh copy each call, so a caller can neither mutate the world's live set nor observe a later
   * `new_turtle` through an already-returned array.
   */
  ids(): readonly TurtleId[] {
    return [...this.liveIds];
  }
}
