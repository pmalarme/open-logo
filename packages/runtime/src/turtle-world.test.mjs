// Unit tests for the turtle world / id allocator (issue #673, `spec/turtles-and-sprites.md`'s
// "Turtle creation" + "Addressing model" sections). `TurtleWorld` and `MAIN_TURTLE_ID` are not part
// of `@openlogo/runtime`'s public API surface (`index.ts` re-exports neither), so these tests reach
// them through this package's own build output, `../dist/turtle-world.js`, exactly as
// `repeat-forever-repcount.test.mjs` reaches its test-only internal.
//
// Because turtle `==` is keyed on the stable id (C3, `@openlogo/core`'s `OLTurtle`), these
// allocation invariants ARE the turtle-identity contract: a duplicate id would silently merge two
// turtles under `==`, an unstable id would split one, and non-deterministic ids would break replay
// and the `turtle #<id>` printed form. The end-to-end consequences are locked by the conformance
// fixtures under tests/conformance/sprites/; these unit tests pin the allocator itself.

import assert from "node:assert/strict";
import { test } from "node:test";
import { MAIN_TURTLE_ID, TurtleWorld } from "../dist/turtle-world.js";

test("MAIN_TURTLE_ID is the reserved contract id 0 for the main turtle", () => {
  // A contract value, not an implementation detail: it is what makes `who` well-defined before any
  // `new_turtle` call and what the first spawned turtle's id (1) is defined relative to.
  assert.equal(MAIN_TURTLE_ID, 0);
});

test("a fresh world already contains exactly the main turtle", () => {
  const world = new TurtleWorld();
  assert.deepEqual(world.ids(), [MAIN_TURTLE_ID]);
});

test("spawn allocates deterministic ids starting one past the main turtle, in order", () => {
  const world = new TurtleWorld();
  assert.equal(world.spawn(), 1);
  assert.equal(world.spawn(), 2);
  assert.equal(world.spawn(), 3);
  assert.deepEqual(world.ids(), [0, 1, 2, 3]);
});

test("two independent worlds allocate the same id sequence (deterministic across runs)", () => {
  const a = new TurtleWorld();
  const b = new TurtleWorld();
  assert.equal(a.spawn(), b.spawn());
  assert.equal(a.spawn(), b.spawn());
  assert.deepEqual(a.ids(), b.ids());
});

test("spawn never returns the reserved main-turtle id and never repeats an id", () => {
  const world = new TurtleWorld();
  const seen = new Set([MAIN_TURTLE_ID]);
  for (let i = 0; i < 50; i += 1) {
    const id = world.spawn();
    assert.equal(seen.has(id), false, `id ${id} was reused`);
    seen.add(id);
  }
});

test("ids() returns a fresh copy each call — a caller cannot mutate the world or observe later spawns through it", () => {
  const world = new TurtleWorld();
  const snapshot = world.ids();
  snapshot.push(999);
  // The world's own live set is untouched by mutating the returned array.
  assert.deepEqual(world.ids(), [MAIN_TURTLE_ID]);
  // A later spawn is not observed through a previously returned array (it was a copy, so it still
  // holds only what it did when returned, plus the caller's own local push).
  const beforeSpawnLength = snapshot.length;
  world.spawn();
  assert.equal(snapshot.length, beforeSpawnLength);
  assert.deepEqual(world.ids(), [MAIN_TURTLE_ID, 1]);
});
