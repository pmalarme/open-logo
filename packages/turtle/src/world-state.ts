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
 * {@link MAIN_TURTLE_ID}. Alongside the per-turtle states it tracks the **addressed turtle set**
 * and its current turtle — folded from the addressing snapshots the stream carries (issue #770) —
 * plus the **last-acted** turtle, so the non-visual state description is never ambiguous about
 * which turtle or turtles it is describing (`spec/rendering.md:191`).
 *
 * Deterministic in, deterministic out: identical event input always folds to an identical world,
 * with no timing, randomness, or rendering concerns here.
 */

import type {
  AddressingSnapshot,
  PrimitivePayload,
  SpawnTurtlePayload,
  TraceEvent,
  TurtleId,
} from "@openlogo/core";

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
 * {@link TurtleState}, which turtles a command is currently addressed to, and which of them a
 * per-turtle command most recently drove.
 *
 * - {@link TurtleWorldState.turtles} is keyed by turtle identity. The main turtle
 *   ({@link MAIN_TURTLE_ID}) is always present; each `new_turtle` adds one entry when its
 *   `spawn-turtle` event is folded. Insertion order is creation order (the main turtle first, then
 *   each spawn), matching the `turtles` reporter's order so a renderer can iterate sprites
 *   deterministically.
 * - {@link TurtleWorldState.addressedTurtleIds} is the set a subsequent turtle command applies to,
 *   once for each (`spec/turtles-and-sprites.md`'s "Addressing model"), and
 *   {@link TurtleWorldState.currentTurtleId} is the turtle `who` reports between commands. Together
 *   they are what lets `describeTurtleWorldState` satisfy `spec/rendering.md:191` ("Implementations
 *   with multiple turtles MUST identify the active turtle or addressed turtle set") — for a *set*,
 *   which no single `turtle_id` can express.
 * - {@link TurtleWorldState.lastActedTurtleId} is the turtle the most recent per-turtle command
 *   drove — whether that command changed the turtle's own state (`forward`, `set_color`, …) or only
 *   the shared scene ({@link SCENE_ONLY_TURTLE_KINDS}: `fill`, `stamp`).
 *
 * The last of those three is called *last-acted*, not *active*, on purpose, and it stays: what
 * every effect event carries is a `turtle_id` (`spec/turtles-and-sprites.md:113`: "Implementations
 * MUST produce trace events with the appropriate turtle identity so animation, stepping, `why`, and
 * `debug` can explain **which turtle moved or changed**"), so what the reducer derives *from effect
 * events alone* is which turtle an event last acted on — the turtle a learner just watched act,
 * which is exactly the question a stepping/animation consumer asks. It is deliberately **not** the
 * addressed set: when an `ask :b [ … ]` block ends the runtime restores the previously addressed
 * set (`spec/turtles-and-sprites.md:58`), but the stream's last per-turtle effect is still `:b`'s,
 * so `:b` stays the last-acted turtle here while the addressed set is back to whatever `tell` had
 * chosen. The two fields answer two different questions and both are kept.
 *
 * The addressing pair is folded from the `primitive` events issue #766 added: every `tell`, every
 * `ask`/`each` entry and per-iteration narrowing, and every restoration path (including the
 * abnormal exits `stop`/`return`/`throw`/runtime diagnostic) emits one carrying
 * `addressing: { addressed_turtle_ids, current_turtle_id }` (`@openlogo/core`'s
 * {@link AddressingSnapshot}). The snapshot is absolute, so it folds by assignment — one rule for
 * entry, narrowing, and restore alike — and this package still never reaches into
 * `@openlogo/runtime` for addressing (the dependency runs turtle → core only).
 *
 * Because a step spans one `instruction` event to the next, an `ask`/`each` block's **restore**
 * lands in the same step as the block's last inner instruction: the addressed set flips back in the
 * very frame that renders the block's last inner move. That is inherent to the trace model and is
 * the intended behavior — each folded step reports one coherent snapshot, namely the addressing in
 * effect *at the end* of that step, which is what the next command will drive.
 */
export interface TurtleWorldState {
  /** Every live turtle's own state, keyed by identity, in creation order. */
  readonly turtles: ReadonlyMap<TurtleId, TurtleState>;
  /** The turtle the most recent per-turtle command drove — a state-bearing one, or a scene-only
   * `fill`/`stamp` ({@link SCENE_ONLY_TURTLE_KINDS}). */
  readonly lastActedTurtleId: TurtleId;
  /** The turtles a subsequent turtle command applies to, deduplicated and in first-occurrence
   * order (the order `each` iterates). Empty exactly when nothing is addressed (`tell [ ]`). */
  readonly addressedTurtleIds: readonly TurtleId[];
  /** The addressed set's first member — the turtle `who` reports between commands — and `null`
   * exactly when {@link TurtleWorldState.addressedTurtleIds} is empty, since the spec defines no
   * current turtle for an empty addressed set. */
  readonly currentTurtleId: TurtleId | null;
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
 * The program-start world: just the main turtle at its {@link INITIAL_TURTLE_STATE}, addressed and
 * current (`spec/turtles-and-sprites.md`'s "Addressing model": "In a program without the Sprites
 * profile, the addressed set contains the single default turtle"), and the last-acted turtle.
 * Shared as the default fold seed; every {@link reduceTurtleWorldState} call copies the turtle map
 * before mutating (`new Map(world.turtles)`), so this instance is never written through internally.
 * Its map is both typed `ReadonlyMap` (so the compiler rejects `.set`/`.delete`/`.clear`) and
 * genuinely frozen at runtime by {@link freezeMap}, so a JavaScript caller cannot mutate the shared
 * singleton and corrupt a later default fold either — `Object.freeze` alone would not do this,
 * because a frozen `Map` still honors `.set`. Its addressed-set array is `Object.freeze`d for the
 * same reason (an array's mutators *do* respect a freeze), and the wrapper object is frozen too,
 * which *is* sufficient for its plain properties.
 */
export const INITIAL_TURTLE_WORLD_STATE: TurtleWorldState = Object.freeze({
  turtles: freezeMap(
    new Map<TurtleId, TurtleState>([[MAIN_TURTLE_ID, INITIAL_TURTLE_STATE]]),
  ),
  lastActedTurtleId: MAIN_TURTLE_ID,
  addressedTurtleIds: Object.freeze([MAIN_TURTLE_ID]) as readonly TurtleId[],
  currentTurtleId: MAIN_TURTLE_ID,
});

/**
 * The {@link TurtleWorldState.lastActedTurtleId} turtle's own state — the subject of the non-visual
 * state description. Every world this module folds keeps `lastActedTurtleId` pointing at a turtle
 * that is present in `turtles`, but the type does not enforce that, so a hand-constructed world
 * naming an absent turtle falls back to the program-start {@link INITIAL_TURTLE_STATE} rather than
 * throwing at paint or announce time.
 */
export function lastActedTurtleState(world: TurtleWorldState): TurtleState {
  return world.turtles.get(world.lastActedTurtleId) ?? INITIAL_TURTLE_STATE;
}

/**
 * Per-turtle command kinds that act on a turtle without changing its own {@link TurtleState}:
 * `fill` and `stamp` both "use the current turtle's pen and shape state"
 * (`spec/turtles-and-sprites.md:109`) and write into the shared retained scene rather than into the
 * turtle. They carry the acting turtle's `turtle_id` once addressing is explicit, like any other
 * per-turtle effect, so they must still mark that turtle as the one that acted — otherwise
 * `tell :a` / `forward 10` / `ask :b [ stamp ]` would leave `:a` reported as the last turtle to act
 * even though `:b` is the turtle that just did something. Before any `tell` they carry no
 * `turtle_id` and resolve to {@link MAIN_TURTLE_ID}, which is already the last-acted turtle, so a
 * single-turtle program is unaffected.
 */
const SCENE_ONLY_TURTLE_KINDS: ReadonlySet<string> = new Set(["fill", "stamp"]);

/**
 * Do two addressed sets hold the same turtles in the same order? `previous` is typed as possibly
 * absent so the reducer stays total against a hand-built JavaScript world that predates the
 * addressing fields (the same posture {@link lastActedTurtleState} takes toward a
 * `lastActedTurtleId` naming no live turtle) — such a world simply counts as different, and folding
 * an addressing event over it produces a world that has the fields.
 */
function sameAddressedTurtles(
  previous: readonly TurtleId[] | undefined,
  next: readonly TurtleId[],
): boolean {
  return (
    previous !== undefined &&
    previous.length === next.length &&
    previous.every((id, index) => id === next[index])
  );
}

/**
 * Fold one {@link AddressingSnapshot} into the world by **assignment**: the snapshot is absolute,
 * never a delta (`@openlogo/core`'s `AddressingSnapshot`), so entering an `ask` scope, narrowing per
 * `each` iteration, and restoring the previous set on the way out all reduce through this one rule
 * — including the abnormal exits (`stop`, `return`, `throw`, a runtime diagnostic) the producer
 * already emits a restoration event for.
 *
 * The addressed set changing is **not** a turtle acting: `tell`/`ask`/`each` only choose who a
 * *subsequent* command will drive, so {@link TurtleWorldState.lastActedTurtleId} is deliberately
 * left alone here (and the addressing event carries no envelope `turtle_id` to re-point it with —
 * it describes a set, not one turtle). A snapshot identical to the world's current addressing —
 * a repeated `tell` of the same turtles, or an `ask` whose block restores what it entered with —
 * returns the same world object, so a downstream reference check sees no change.
 */
function foldAddressing(
  world: TurtleWorldState,
  snapshot: AddressingSnapshot,
): TurtleWorldState {
  const addressedTurtleIds = snapshot.addressed_turtle_ids;
  if (
    world.currentTurtleId === snapshot.current_turtle_id &&
    sameAddressedTurtles(world.addressedTurtleIds, addressedTurtleIds)
  ) {
    return world;
  }
  return {
    ...world,
    // Copied, so a later mutation of the event's own payload array cannot reach into world state.
    addressedTurtleIds: [...addressedTurtleIds],
    currentTurtleId: snapshot.current_turtle_id,
  };
}

/**
 * Reduces one trace event into the next per-turtle world state. A `spawn-turtle` event registers
 * the newly created turtle at the full initial state its payload carries
 * (`spec/turtles-and-sprites.md`'s "Turtle creation" section — a new turtle starts at the same
 * defaults as the main turtle but is nonetheless recorded from its own payload so a renderer never
 * has to assume them). Creating a turtle does **not** make it the last-acted one:
 * `:friend = new_turtle` leaves the addressed set alone (`spec/turtles-and-sprites.md:42`'s
 * "Addressing model" — only `tell`/`ask`/`each` change who acts), so a newly spawned turtle takes
 * that role only once a command actually drives it.
 *
 * Every other event is delegated to the single-turtle {@link reduceTurtleState} against the state
 * of the turtle its `turtle_id` names, defaulting to {@link MAIN_TURTLE_ID} when the envelope
 * carries none — the implicit main turtle before any `tell`, and every Core/Turtle & Rendering
 * event, which never carry a `turtle_id`. An event whose `turtle_id` names a turtle not yet present
 * (which cannot happen for a well-formed stream, since a turtle's `spawn-turtle` always precedes
 * its commands) is ignored rather than inventing a turtle, keeping the reducer total without
 * fabricating identities.
 *
 * A turtle becomes {@link TurtleWorldState.lastActedTurtleId} when a **state-bearing** event
 * targeted it, or when one of the {@link SCENE_ONLY_TURTLE_KINDS} per-turtle commands did. Note the
 * state-bearing condition is "an event of a state-bearing kind arrived for that turtle", *not* "its
 * fields actually differ": every state-bearing branch of {@link reduceTurtleState} spreads a fresh
 * object, so a repeated `pen_down` while the pen is already down still counts as that turtle acting
 * (which is right — the learner did drive it). The remaining kinds — a `clean` clear, `instruction`,
 * `print`, `procedure-enter`, … — must *not* re-point the last-acted turtle: they carry no
 * `turtle_id` and would otherwise silently snap it back to the main turtle in the middle of a
 * sprite's block.
 *
 * A `primitive` event carrying an `addressing` snapshot updates
 * {@link TurtleWorldState.addressedTurtleIds}/{@link TurtleWorldState.currentTurtleId} instead (see
 * {@link foldAddressing}); every other `primitive` — `wait`, the event-registration forms — carries
 * no addressing and leaves the world untouched, exactly as before issue #766 published the snapshot.
 */
export function reduceTurtleWorldState(
  world: TurtleWorldState,
  event: TraceEvent,
): TurtleWorldState {
  if (event.kind === "primitive") {
    const { addressing } = event.payload as PrimitivePayload;
    return addressing === undefined ? world : foldAddressing(world, addressing);
  }
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
    return { ...world, turtles };
  }
  const id = event.turtle_id ?? MAIN_TURTLE_ID;
  const current = world.turtles.get(id);
  if (current === undefined) {
    return world;
  }
  const reduced = reduceTurtleState(current, event);
  if (reduced === current) {
    // The turtle's own state is unchanged, so the turtle map is reused as-is; only a scene-only
    // per-turtle command still re-points the last-acted turtle.
    if (
      !SCENE_ONLY_TURTLE_KINDS.has(event.kind) ||
      world.lastActedTurtleId === id
    ) {
      return world;
    }
    return { ...world, lastActedTurtleId: id };
  }
  const turtles = new Map(world.turtles);
  turtles.set(id, reduced);
  return { ...world, turtles, lastActedTurtleId: id };
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
