// Tests for the per-turtle world-state reducer (`world-state.ts`, issue #677, slice SP5): under the
// Sprites profile many turtles draw at once and each per-turtle event carries the acting turtle's
// `turtle_id`, so a renderer needs each sprite's own shape/visibility/position — not the single
// collapsed state `reduceTurtleEvents` folds. These exercise the routing: `spawn-turtle`
// registration, per-turtle attribution keyed on `turtle_id`, the implicit main turtle (no
// `turtle_id`) folding into id 0, isolation between turtles, and the render-following obligation
// from `spec/turtles-and-sprites.md`'s "Per-turtle state and Turtle commands" section — plus
// (issue #749) the **last-acted** turtle the non-visual state description names as its subject
// (`spec/rendering.md:115`/`:191`).
import assert from "node:assert/strict";
import { test } from "node:test";
import * as Core from "@openlogo/core";
import * as OL from "@openlogo/turtle";

function makeSpan() {
  return Core.makeSpan("main.logo", [1, 1], [1, 1]);
}

let seq = 0;
// Build an event; pass `turtleId = undefined` to model an un-stamped Core/main-turtle event.
function event(kind, payload, turtleId) {
  seq += 1;
  const envelope = { seq, kind, source_span: makeSpan(), payload };
  if (turtleId !== undefined) {
    envelope.turtle_id = turtleId;
  }
  return envelope;
}

function spawn(turtleId, overrides = {}) {
  return event(
    "spawn-turtle",
    {
      turtle_id: turtleId,
      position: [0, 0],
      heading: 0,
      pen: "down",
      color: "black",
      width: 1,
      visible: true,
      shape: "turtle",
      ...overrides,
    },
    turtleId,
  );
}

test("initial world holds just the main turtle at the program-start defaults, last-acted", () => {
  assert.deepEqual(
    [...OL.INITIAL_TURTLE_WORLD_STATE.turtles.keys()],
    [OL.MAIN_TURTLE_ID],
  );
  assert.deepEqual(
    OL.INITIAL_TURTLE_WORLD_STATE.turtles.get(OL.MAIN_TURTLE_ID),
    OL.INITIAL_TURTLE_STATE,
  );
  assert.equal(
    OL.INITIAL_TURTLE_WORLD_STATE.lastActedTurtleId,
    OL.MAIN_TURTLE_ID,
  );
  assert.equal(
    OL.lastActedTurtleState(OL.INITIAL_TURTLE_WORLD_STATE),
    OL.INITIAL_TURTLE_STATE,
  );
});

test("MAIN_TURTLE_ID is 0, matching the runtime allocator's reserved main-turtle id", () => {
  assert.equal(OL.MAIN_TURTLE_ID, 0);
});

test("the shared initial world is genuinely immutable at runtime", () => {
  // Not merely a ReadonlyMap type: a JavaScript caller must not be able to corrupt the shared seed
  // and taint a later default fold, so its map's mutators throw and the wrapper itself is frozen.
  assert.throws(
    () => OL.INITIAL_TURTLE_WORLD_STATE.turtles.set(9, {}),
    TypeError,
  );
  assert.throws(
    () => OL.INITIAL_TURTLE_WORLD_STATE.turtles.delete(0),
    TypeError,
  );
  assert.throws(() => OL.INITIAL_TURTLE_WORLD_STATE.turtles.clear(), TypeError);
  assert.equal(Object.isFrozen(OL.INITIAL_TURTLE_WORLD_STATE), true);
  // The seed is unchanged and still folds correctly afterward.
  assert.deepEqual(
    [...OL.INITIAL_TURTLE_WORLD_STATE.turtles.keys()],
    [OL.MAIN_TURTLE_ID],
  );
  assert.equal(
    OL.INITIAL_TURTLE_WORLD_STATE.lastActedTurtleId,
    OL.MAIN_TURTLE_ID,
  );
});

test("spawn-turtle registers a new turtle from its payload's initial state", () => {
  const world = OL.reduceTurtleWorldEvents([
    spawn(1, { shape: "bee", visible: false, color: "yellow", width: 3 }),
  ]);
  assert.deepEqual([...world.turtles.keys()], [0, 1]);
  assert.deepEqual(world.turtles.get(1), {
    position: [0, 0],
    heading: 0,
    penDown: true,
    color: "yellow",
    width: 3,
    shape: "bee",
    visible: false,
  });
});

test("shape-change routes to the addressed turtle, leaving the main turtle unchanged", () => {
  const world = OL.reduceTurtleWorldEvents([
    spawn(1),
    event("shape-change", { from: "turtle", to: "triangle" }, 1),
  ]);
  assert.equal(world.turtles.get(1).shape, "triangle");
  assert.equal(world.turtles.get(0).shape, "turtle");
});

test("visibility-change routes to the addressed turtle only", () => {
  const world = OL.reduceTurtleWorldEvents([
    spawn(1),
    spawn(2),
    event("visibility-change", { from: true, to: false }, 1),
  ]);
  assert.equal(world.turtles.get(1).visible, false);
  assert.equal(world.turtles.get(2).visible, true);
  assert.equal(world.turtles.get(0).visible, true);
});

test("two turtles keep independent shape and visibility", () => {
  const world = OL.reduceTurtleWorldEvents([
    spawn(1),
    spawn(2),
    event("shape-change", { from: "turtle", to: "arrow" }, 1),
    event("shape-change", { from: "turtle", to: "circle" }, 2),
    event("visibility-change", { from: true, to: false }, 2),
  ]);
  assert.equal(world.turtles.get(1).shape, "arrow");
  assert.equal(world.turtles.get(1).visible, true);
  assert.equal(world.turtles.get(2).shape, "circle");
  assert.equal(world.turtles.get(2).visible, false);
});

test("un-stamped events (no turtle_id) fold into the main turtle", () => {
  const world = OL.reduceTurtleWorldEvents([
    event("shape-change", { from: "turtle", to: "triangle" }, undefined),
    event("visibility-change", { from: true, to: false }, undefined),
  ]);
  assert.equal(world.turtles.get(0).shape, "triangle");
  assert.equal(world.turtles.get(0).visible, false);
  assert.deepEqual([...world.turtles.keys()], [0]);
});

test("a turtle_id: 0 stamped event and an un-stamped event fold into the same main turtle", () => {
  const world = OL.reduceTurtleWorldEvents([
    event("shape-change", { from: "turtle", to: "triangle" }, 0),
    event("visibility-change", { from: true, to: false }, undefined),
  ]);
  assert.equal(world.turtles.get(0).shape, "triangle");
  assert.equal(world.turtles.get(0).visible, false);
});

test("move routes per turtle so each sprite tracks its own position and heading", () => {
  const world = OL.reduceTurtleWorldEvents([
    spawn(1),
    spawn(2),
    event("move", { from: [0, 0], to: [0, 50], heading: 0 }, 1),
    event("move", { from: [0, 0], to: [30, 0], heading: 90 }, 2),
  ]);
  assert.deepEqual(world.turtles.get(1).position, [0, 50]);
  assert.equal(world.turtles.get(1).heading, 0);
  assert.deepEqual(world.turtles.get(2).position, [30, 0]);
  assert.equal(world.turtles.get(2).heading, 90);
});

test("an event naming an unspawned turtle is ignored rather than inventing a turtle", () => {
  const world = OL.reduceTurtleWorldEvents([
    event("shape-change", { from: "turtle", to: "triangle" }, 7),
  ]);
  assert.deepEqual([...world.turtles.keys()], [0]);
  assert.equal(world.turtles.get(0).shape, "turtle");
});

test("a non-state event (print) leaves the world referentially unchanged", () => {
  const before = OL.INITIAL_TURTLE_WORLD_STATE;
  const after = OL.reduceTurtleWorldState(
    before,
    event("print", { values: [] }, undefined),
  );
  assert.equal(after, before);
});

test("a clean clear leaves per-turtle state untouched", () => {
  const world = OL.reduceTurtleWorldEvents([
    spawn(1),
    event("move", { from: [0, 0], to: [0, 50], heading: 0 }, 1),
    event("clear", { mode: "clean" }, 1),
  ]);
  assert.deepEqual(world.turtles.get(1).position, [0, 50]);
});

test("a stamped clear_screen clear homes only the turtle it names", () => {
  // The runtime stamps a `clear_screen`'s single `clear` event with the homed turtle's `turtle_id`
  // under explicit addressing (`tell`/`ask`/`each`), so the reducer homes exactly that turtle and
  // leaves every other turtle's state untouched (`clearScreen`'s doc comment in the runtime).
  const world = OL.reduceTurtleWorldEvents([
    spawn(1),
    event("move", { from: [0, 0], to: [0, 50], heading: 90 }, 1),
    event("move", { from: [0, 0], to: [10, 0], heading: 45 }, 0),
    event("clear", { mode: "clear_screen" }, 1),
  ]);
  assert.deepEqual(world.turtles.get(1).position, [0, 0]);
  assert.equal(world.turtles.get(1).heading, 0);
  assert.deepEqual(world.turtles.get(0).position, [10, 0]);
  assert.equal(world.turtles.get(0).heading, 45);
});

test("an un-stamped clear_screen clear homes the main turtle", () => {
  // Before any `tell` the runtime emits `clear` with no `turtle_id`; it homes the main turtle (id
  // 0), matching the pre-slice single-turtle reducer and Turtle & Rendering `clear` fixtures.
  const world = OL.reduceTurtleWorldEvents([
    event("move", { from: [0, 0], to: [7, 0], heading: 90 }, undefined),
    event("clear", { mode: "clear_screen" }, undefined),
  ]);
  assert.deepEqual(world.turtles.get(0).position, [0, 0]);
  assert.equal(world.turtles.get(0).heading, 0);
});

test("reduceTurtleWorldEvents defaults its seed to the initial world", () => {
  const world = OL.reduceTurtleWorldEvents([spawn(1)]);
  assert.deepEqual([...world.turtles.keys()], [0, 1]);
});

test("reducing no events returns the seed unchanged", () => {
  const world = OL.reduceTurtleWorldEvents([]);
  assert.equal(world, OL.INITIAL_TURTLE_WORLD_STATE);
});

// --- the last-acted turtle (`spec/rendering.md:191`) ---

test("the turtle a state-bearing event targeted becomes the last-acted turtle", () => {
  const world = OL.reduceTurtleWorldEvents([
    spawn(1),
    spawn(2),
    event("move", { from: [0, 0], to: [0, 50], heading: 0 }, 1),
    event("color-change", { from: "black", to: "blue" }, 2),
  ]);
  assert.equal(world.lastActedTurtleId, 2);
  assert.equal(OL.lastActedTurtleState(world).color, "blue");
});

test("creating a turtle does not make it the last-acted one — only acting does", () => {
  // `:friend = new_turtle` leaves the addressed set alone (spec/turtles-and-sprites.md:42), so the
  // main turtle is still the one a learner is driving until something addresses the new turtle.
  const afterSpawn = OL.reduceTurtleWorldEvents([spawn(1)]);
  assert.equal(afterSpawn.lastActedTurtleId, OL.MAIN_TURTLE_ID);
  const afterItActs = OL.reduceTurtleWorldState(
    afterSpawn,
    event("move", { from: [0, 0], to: [0, 5], heading: 0 }, 1),
  );
  assert.equal(afterItActs.lastActedTurtleId, 1);
});

test("a non-state event does not re-point the last-acted turtle back at the main turtle", () => {
  // `instruction`/`print`/`procedure-enter` carry no turtle_id. Treating "no turtle_id" as "the
  // main turtle acted" would snap it back to 0 in the middle of a sprite's block.
  const world = OL.reduceTurtleWorldEvents([
    spawn(1),
    event("shape-change", { from: "turtle", to: "bee" }, 1),
    event("instruction", { text: "print 1" }, undefined),
    event("print", { values: [] }, undefined),
    event("clear", { mode: "clean" }, undefined),
  ]);
  assert.equal(world.lastActedTurtleId, 1);
});

test("an event naming an unspawned turtle leaves the last-acted turtle alone", () => {
  const world = OL.reduceTurtleWorldEvents([
    spawn(1),
    event("move", { from: [0, 0], to: [0, 5], heading: 0 }, 1),
    event("shape-change", { from: "turtle", to: "triangle" }, 7),
  ]);
  assert.equal(world.lastActedTurtleId, 1);
});

test("an un-stamped event makes the main turtle the last-acted one again", () => {
  // A single-turtle program's events never carry a turtle_id, so the main turtle is the last-acted
  // turtle throughout — the property that keeps single-turtle output unchanged.
  const world = OL.reduceTurtleWorldEvents([
    spawn(1),
    event("move", { from: [0, 0], to: [0, 5], heading: 0 }, 1),
    event("move", { from: [0, 0], to: [9, 0], heading: 90 }, undefined),
  ]);
  assert.equal(world.lastActedTurtleId, OL.MAIN_TURTLE_ID);
});

test("a scene-only per-turtle command (stamp) makes its turtle the last-acted one", () => {
  // `tell :a` / `forward 10` / `ask :b [ stamp ]`. `stamp` and `fill` are per-turtle commands
  // (spec/turtles-and-sprites.md:109 — they "use the current turtle's pen and shape state") that
  // write into the shared scene rather than the turtle, so they change no TurtleState. Ignoring
  // them would leave `:a` reported as the last turtle to act while `:b` is the one that just did
  // something.
  const world = OL.reduceTurtleWorldEvents([
    spawn(1),
    spawn(2),
    event("move", { from: [0, 0], to: [0, 10], heading: 0 }, 1),
    event(
      "stamp",
      { position: [0, 0], heading: 0, shape: "turtle", color: "black" },
      2,
    ),
  ]);
  assert.equal(world.lastActedTurtleId, 2);
  // The stamp changed no turtle's own state, so the turtle map is reused untouched.
  assert.deepEqual(world.turtles.get(2), {
    position: [0, 0],
    heading: 0,
    penDown: true,
    color: "black",
    width: 1,
    shape: "turtle",
    visible: true,
  });
});

test("a scene-only per-turtle command (fill) makes its turtle the last-acted one", () => {
  const world = OL.reduceTurtleWorldEvents([
    spawn(1),
    spawn(2),
    event("move", { from: [0, 0], to: [0, 10], heading: 0 }, 1),
    event("fill", { color: "green" }, 2),
  ]);
  assert.equal(world.lastActedTurtleId, 2);
});

test("a scene-only per-turtle command for the already-last-acted turtle leaves the world referentially unchanged", () => {
  // Nothing about the world differs, so there is no reason to hand back a new object and make
  // every downstream reference check see a change.
  const before = OL.reduceTurtleWorldEvents([
    spawn(1),
    event("move", { from: [0, 0], to: [0, 10], heading: 0 }, 1),
  ]);
  const after = OL.reduceTurtleWorldState(
    before,
    event("fill", { color: "green" }, 1),
  );
  assert.equal(after, before);
});

test("a scene-only per-turtle command naming an unspawned turtle is ignored", () => {
  const world = OL.reduceTurtleWorldEvents([
    spawn(1),
    event("move", { from: [0, 0], to: [0, 10], heading: 0 }, 1),
    event("fill", { color: "green" }, 9),
  ]);
  assert.equal(world.lastActedTurtleId, 1);
  assert.deepEqual([...world.turtles.keys()], [0, 1]);
});

test("lastActedTurtleState falls back to the program-start defaults for a hand-built world naming an absent turtle", () => {
  // The type cannot enforce that `lastActedTurtleId` is a live key, so the accessor stays total
  // instead of throwing at paint/announce time.
  const world = { turtles: new Map(), lastActedTurtleId: 4 };
  assert.deepEqual(OL.lastActedTurtleState(world), OL.INITIAL_TURTLE_STATE);
});

// --- the addressed turtle set (#770, consumer half of #766; spec/rendering.md:191) -------------

/** An addressing `primitive` event, exactly as the runtime emits it (issue #766): the snapshot
 * rides the existing `primitive` payload, and carries no envelope `turtle_id` because it describes
 * a *set*, not one turtle. */
function addressing(name, addressedTurtleIds, currentTurtleId) {
  return event(
    "primitive",
    {
      name,
      addressing: {
        addressed_turtle_ids: addressedTurtleIds,
        current_turtle_id: currentTurtleId,
      },
    },
    undefined,
  );
}

test("the initial world addresses the single default turtle", () => {
  // spec/turtles-and-sprites.md:44 — "In a program without the Sprites profile, the addressed set
  // contains the single default turtle."
  assert.deepEqual(OL.INITIAL_TURTLE_WORLD_STATE.addressedTurtleIds, [
    OL.MAIN_TURTLE_ID,
  ]);
  assert.equal(
    OL.INITIAL_TURTLE_WORLD_STATE.currentTurtleId,
    OL.MAIN_TURTLE_ID,
  );
});

test("the shared initial world's addressed set is genuinely immutable at runtime", () => {
  // Same reasoning as the frozen turtle map: a JavaScript caller must not be able to corrupt the
  // shared seed and taint a later default fold. Unlike a Map, an array's mutators do respect a
  // freeze, so Object.freeze is sufficient here.
  assert.equal(
    Object.isFrozen(OL.INITIAL_TURTLE_WORLD_STATE.addressedTurtleIds),
    true,
  );
  assert.throws(
    () => OL.INITIAL_TURTLE_WORLD_STATE.addressedTurtleIds.push(9),
    TypeError,
  );
  assert.deepEqual(OL.INITIAL_TURTLE_WORLD_STATE.addressedTurtleIds, [
    OL.MAIN_TURTLE_ID,
  ]);
});

test("tell folds the whole addressed set, which no single turtle_id could express", () => {
  const world = OL.reduceTurtleWorldEvents([
    spawn(1),
    spawn(2),
    addressing("tell", [1, 2], 1),
  ]);
  assert.deepEqual(world.addressedTurtleIds, [1, 2]);
  assert.equal(world.currentTurtleId, 1);
});

test("tell [ :a :b ] / forward 10 / ask :b [ hide_turtle ] ends addressed { 1, 2 } with current turtle 1 (#770 acceptance criterion)", () => {
  // The stream of tests/conformance/sprites/addressing-tell-ask-restore, folded. After `ask`
  // restores (spec/turtles-and-sprites.md:58) the last turtle-stamped effect still belongs to
  // turtle 2 — so `lastActedTurtleId` is 2 while the addressed set is back to { 1, 2 } and the
  // current turtle is 1. That difference is the whole point of folding the snapshot.
  const world = OL.reduceTurtleWorldEvents([
    spawn(1),
    spawn(2),
    event("instruction", { statement_kind: "ProfileStatement" }, undefined),
    addressing("tell", [1, 2], 1),
    event("instruction", { statement_kind: "Call" }, undefined),
    event("move", { from: [0, 0], to: [0, 10], heading: 0 }, 1),
    event("move", { from: [0, 0], to: [0, 10], heading: 0 }, 2),
    event("instruction", { statement_kind: "ProfileStatement" }, undefined),
    addressing("ask", [2], 2),
    event("visibility-change", { from: true, to: false }, 2),
    addressing("ask", [1, 2], 1),
  ]);
  assert.deepEqual(world.addressedTurtleIds, [1, 2]);
  assert.equal(world.currentTurtleId, 1);
  assert.equal(world.lastActedTurtleId, 2);
});

test("ask entry narrows the addressed set, and the restore puts the previous set back", () => {
  const entered = OL.reduceTurtleWorldEvents([
    spawn(1),
    spawn(2),
    addressing("tell", [1, 2], 1),
    addressing("ask", [2], 2),
  ]);
  assert.deepEqual(entered.addressedTurtleIds, [2]);
  assert.equal(entered.currentTurtleId, 2);

  const restored = OL.reduceTurtleWorldState(
    entered,
    addressing("ask", [1, 2], 1),
  );
  assert.deepEqual(restored.addressedTurtleIds, [1, 2]);
  assert.equal(restored.currentTurtleId, 1);
});

test("each narrows to one turtle per iteration and restores the set afterwards", () => {
  // spec/turtles-and-sprites.md:78 — `each` "runs its block once per turtle in the current tell or
  // ask set", and `who` reports that iteration's turtle. Every narrowing is its own snapshot, so
  // folding by assignment tracks each iteration exactly.
  const events = [
    spawn(1),
    spawn(2),
    addressing("tell", [1, 2], 1),
    addressing("each", [1], 1),
    addressing("each", [2], 2),
    addressing("each", [1, 2], 1),
  ];
  const perIteration = events.map((_, index) =>
    OL.reduceTurtleWorldEvents(events.slice(0, index + 1)),
  );
  assert.deepEqual(perIteration[3].addressedTurtleIds, [1]);
  assert.equal(perIteration[3].currentTurtleId, 1);
  assert.deepEqual(perIteration[4].addressedTurtleIds, [2]);
  assert.equal(perIteration[4].currentTurtleId, 2);
  assert.deepEqual(perIteration[5].addressedTurtleIds, [1, 2]);
  assert.equal(perIteration[5].currentTurtleId, 1);
});

test("an abnormal exit's restoration snapshot folds through the same single rule", () => {
  // The producer emits a restoration event on every exit path — `stop`, `return`, `throw`, and a
  // runtime diagnostic — not just the normal one. The snapshot is absolute, so the consumer needs
  // no branch per exit kind: it assigns, exactly as it does on entry.
  const world = OL.reduceTurtleWorldEvents([
    spawn(1),
    spawn(2),
    addressing("tell", [1], 1),
    addressing("ask", [2], 2),
    event("move", { from: [0, 0], to: [0, 3], heading: 0 }, 2),
    event("error", { code: "ol-arity" }, undefined),
    addressing("ask", [1], 1),
  ]);
  assert.deepEqual(world.addressedTurtleIds, [1]);
  assert.equal(world.currentTurtleId, 1);
});

test("tell [ ] addresses nothing, and reports no current turtle", () => {
  // `current_turtle_id` is null exactly when the addressed set is empty: the spec defines no
  // current turtle there, so the stream claims nothing and the consumer picks its own display
  // fallback (see a11y.ts).
  const world = OL.reduceTurtleWorldEvents([
    spawn(1),
    addressing("tell", [], null),
  ]);
  assert.deepEqual(world.addressedTurtleIds, []);
  assert.equal(world.currentTurtleId, null);
});

test("changing the addressed set is not a turtle acting", () => {
  // `tell`/`ask`/`each` only choose who a *subsequent* command drives, so they must not re-point
  // the last-acted turtle — and the addressing event carries no envelope turtle_id to do it with.
  const world = OL.reduceTurtleWorldEvents([
    spawn(1),
    spawn(2),
    event("move", { from: [0, 0], to: [0, 5], heading: 0 }, 1),
    addressing("tell", [2], 2),
  ]);
  assert.equal(world.lastActedTurtleId, 1);
});

test("a primitive event without an addressing snapshot leaves the world referentially unchanged", () => {
  // `wait` and the Interaction registration forms emit `primitive` with a name only. An
  // addressing-unaware payload must stay as inert as it was before #766 published the snapshot.
  const before = OL.reduceTurtleWorldEvents([spawn(1)]);
  const after = OL.reduceTurtleWorldState(
    before,
    event("primitive", { name: "wait" }, undefined),
  );
  assert.equal(after, before);
});

test("re-addressing the identical set leaves the world referentially unchanged", () => {
  const before = OL.reduceTurtleWorldEvents([
    spawn(1),
    spawn(2),
    addressing("tell", [1, 2], 1),
  ]);
  assert.equal(
    OL.reduceTurtleWorldState(before, addressing("tell", [1, 2], 1)),
    before,
  );
  // A genuinely different set (same length, different members) is still folded.
  const narrowed = OL.reduceTurtleWorldState(
    before,
    addressing("tell", [1, 0], 1),
  );
  assert.notEqual(narrowed, before);
  assert.deepEqual(narrowed.addressedTurtleIds, [1, 0]);
  // As is a same-set change of the current turtle alone.
  const recentred = OL.reduceTurtleWorldState(
    before,
    addressing("each", [1, 2], 2),
  );
  assert.notEqual(recentred, before);
  assert.equal(recentred.currentTurtleId, 2);
});

test("the folded addressed set is a copy, so mutating the event's payload cannot reach world state", () => {
  const ids = [1, 2];
  const world = OL.reduceTurtleWorldEvents([
    spawn(1),
    spawn(2),
    addressing("tell", ids, 1),
  ]);
  ids.push(99);
  assert.deepEqual(world.addressedTurtleIds, [1, 2]);
});

test("folding an addressing event over a world that predates the addressing fields gives it them", () => {
  // The reducer stays total against a hand-built JavaScript world (only constructible that way,
  // since TurtleWorldState requires the fields), rather than throwing on the absent previous set.
  const legacy = {
    turtles: new Map([[0, OL.INITIAL_TURTLE_STATE]]),
    lastActedTurtleId: 0,
  };
  const world = OL.reduceTurtleWorldState(legacy, addressing("tell", [0], 0));
  assert.deepEqual(world.addressedTurtleIds, [0]);
  assert.equal(world.currentTurtleId, 0);
});

test("spawning a turtle and driving one both preserve the addressed set", () => {
  const afterTell = OL.reduceTurtleWorldEvents([
    spawn(1),
    addressing("tell", [1], 1),
  ]);
  const afterSpawn = OL.reduceTurtleWorldState(afterTell, spawn(2));
  assert.deepEqual(afterSpawn.addressedTurtleIds, [1]);
  assert.equal(afterSpawn.currentTurtleId, 1);

  const afterMove = OL.reduceTurtleWorldState(
    afterSpawn,
    event("move", { from: [0, 0], to: [0, 4], heading: 0 }, 1),
  );
  assert.deepEqual(afterMove.addressedTurtleIds, [1]);
  assert.equal(afterMove.currentTurtleId, 1);

  const afterStamp = OL.reduceTurtleWorldState(
    afterMove,
    event(
      "stamp",
      { position: [0, 0], heading: 0, shape: "turtle", color: "black" },
      2,
    ),
  );
  assert.deepEqual(afterStamp.addressedTurtleIds, [1]);
  assert.equal(afterStamp.currentTurtleId, 1);
  assert.equal(afterStamp.lastActedTurtleId, 2);
});
