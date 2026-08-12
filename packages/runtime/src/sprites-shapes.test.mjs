// Unit tests for per-turtle **shapes and visibility** under the Sprites profile (issue #677, slice
// SP5), driven end to end through `execute()`. The Turtle & Rendering commands `set_shape`, `stamp`,
// `show_turtle`, and `hide_turtle` are per-turtle: under `tell`/`ask`/`each` each applies once for
// every addressed turtle, mutating that turtle's own state and emitting `shape-change` /
// `stamp` / `visibility-change` events carrying the acting turtle's `turtle_id`
// (spec/turtles-and-sprites.md's "Per-turtle state and Turtle commands" + "Shapes and sprites"
// sections). Single-turtle semantics and the argument/arity diagnostics live in
// turtle-shape.test.mjs and turtle-visibility.test.mjs; this file only exercises the Sprites
// addressing composition — the awkward positions (`ask`, `each`, `repeat`, procedure body, empty
// set, single default turtle) and per-turtle state isolation. The same behavior is locked from
// source by the conformance fixtures under tests/conformance/sprites/shape-* / stamp-* /
// visibility-*.

import assert from "node:assert/strict";
import { test } from "node:test";
import { execute } from "@openlogo/runtime";

const of = (events, kind) => events.filter((event) => event.kind === kind);

test("set_shape under ask applies to the addressed turtle only, stamping its turtle_id", () => {
  // Acceptance criteria: `ask :bee [ set_shape "bee" ... ]` changes :bee's shape (emitting
  // shape-change with :bee's id), moves only :bee, and leaves the main turtle untouched.
  const result = execute(
    ':bee = new_turtle\nask :bee [ set_shape "triangle" set_color "yellow" forward 60 ]',
    "main.logo",
  );
  assert.deepEqual(result.diagnostics, []);
  const changes = of(result.events, "shape-change");
  assert.equal(changes.length, 1);
  assert.equal(changes[0].turtle_id, 1);
  assert.deepEqual(changes[0].payload, { from: "turtle", to: "triangle" });
  // Only :bee moved.
  assert.deepEqual(
    of(result.events, "move").map((event) => event.turtle_id),
    [1],
  );
});

test("set_shape under tell applies once per addressed turtle, each keeping its own shape", () => {
  const result = execute(
    ':a = new_turtle\n:b = new_turtle\ntell [ :a :b ]\nset_shape "arrow"',
    "main.logo",
  );
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(
    of(result.events, "shape-change").map((event) => [
      event.turtle_id,
      event.payload.to,
    ]),
    [
      [1, "arrow"],
      [2, "arrow"],
    ],
  );
});

test("stamp captures each addressed turtle's own current shape", () => {
  // :a becomes an arrow, :b a circle; a single `stamp` under `tell [ :a :b ]` stamps each turtle's
  // own shape — proving per-turtle shape state is isolated, not shared.
  const result = execute(
    ':a = new_turtle\n:b = new_turtle\nask :a [ set_shape "arrow" ]\nask :b [ set_shape "circle" ]\ntell [ :a :b ]\nstamp',
    "main.logo",
  );
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(
    of(result.events, "stamp").map((event) => [
      event.turtle_id,
      event.payload.shape,
    ]),
    [
      [1, "arrow"],
      [2, "circle"],
    ],
  );
});

test("hide_turtle / show_turtle under ask emit visibility-change for that turtle only", () => {
  const result = execute(
    ":a = new_turtle\n:b = new_turtle\nask :a [ hide_turtle ]",
    "main.logo",
  );
  assert.deepEqual(result.diagnostics, []);
  const changes = of(result.events, "visibility-change");
  assert.equal(changes.length, 1);
  assert.equal(changes[0].turtle_id, 1);
  assert.deepEqual(changes[0].payload, { from: true, to: false });
});

test("visibility is per-turtle: hiding one turtle leaves the other visible", () => {
  const result = execute(
    ":a = new_turtle\n:b = new_turtle\ntell [ :a :b ]\nhide_turtle\nask :a [ show_turtle ]",
    "main.logo",
  );
  assert.deepEqual(result.diagnostics, []);
  const changes = of(result.events, "visibility-change").map((event) => [
    event.turtle_id,
    event.payload.to,
  ]);
  // Both hidden by `tell`, then only :a shown again.
  assert.deepEqual(changes, [
    [1, false],
    [2, false],
    [1, true],
  ]);
});

test("set_shape and hide_turtle inside each run once per distinct turtle", () => {
  const result = execute(
    ':a = new_turtle\n:b = new_turtle\ntell [ :a :b ]\neach [\n  set_shape "circle"\n  hide_turtle\n]',
    "main.logo",
  );
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(
    of(result.events, "shape-change").map((event) => event.turtle_id),
    [1, 2],
  );
  assert.deepEqual(
    of(result.events, "visibility-change").map((event) => event.turtle_id),
    [1, 2],
  );
});

test("set_shape inside repeat under ask stamps the addressed turtle's id every iteration", () => {
  const result = execute(
    ':bee = new_turtle\nask :bee [ repeat 3 [ set_shape "arrow" stamp ] ]',
    "main.logo",
  );
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(
    of(result.events, "shape-change").map((event) => event.turtle_id),
    [1, 1, 1],
  );
  assert.deepEqual(
    of(result.events, "stamp").map((event) => event.turtle_id),
    [1, 1, 1],
  );
});

test("set_shape in a procedure body called under ask stamps the addressed turtle", () => {
  const result = execute(
    'define dress\n  set_shape "triangle"\n  hide_turtle\nend\n:bee = new_turtle\nask :bee [ dress ]',
    "main.logo",
  );
  assert.deepEqual(result.diagnostics, []);
  const shape = of(result.events, "shape-change");
  const vis = of(result.events, "visibility-change");
  assert.equal(shape.length, 1);
  assert.equal(shape[0].turtle_id, 1);
  assert.equal(vis.length, 1);
  assert.equal(vis[0].turtle_id, 1);
});

test("set_shape / stamp / hide_turtle over an empty addressed set emit nothing", () => {
  const result = execute(
    ':a = new_turtle\ntell [ ]\nset_shape "arrow"\nhide_turtle\nstamp',
    "main.logo",
  );
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(of(result.events, "shape-change"), []);
  assert.deepEqual(of(result.events, "visibility-change"), []);
  assert.deepEqual(of(result.events, "stamp"), []);
});

test("with the implicit single default turtle, shape/visibility events carry no turtle_id", () => {
  // Before any `tell`, the addressed set is the implicit main turtle and per-turtle events are NOT
  // stamped — preserving every Core/Turtle & Rendering fixture.
  const result = execute('set_shape "arrow"\nhide_turtle\nstamp', "main.logo");
  assert.deepEqual(result.diagnostics, []);
  for (const kind of ["shape-change", "visibility-change", "stamp"]) {
    const [ev] = of(result.events, kind);
    assert.equal(ev.turtle_id, undefined, `${kind} should carry no turtle_id`);
  }
});

test("a single-turtle each still attributes shape/visibility events to that turtle", () => {
  const result = execute(
    ':bee = new_turtle\ntell [ :bee ]\neach [ set_shape "circle" hide_turtle ]',
    "main.logo",
  );
  assert.deepEqual(result.diagnostics, []);
  assert.equal(of(result.events, "shape-change")[0].turtle_id, 1);
  assert.equal(of(result.events, "visibility-change")[0].turtle_id, 1);
});

test("set_shape does not change a turtle's identity (== still holds after set_shape)", () => {
  // spec/turtles-and-sprites.md: "Shapes do not change the identity of a turtle."
  const result = execute(
    ':bee = new_turtle\nask :bee [ set_shape "triangle" ]\nprint :bee == :bee',
    "main.logo",
  );
  assert.deepEqual(result.diagnostics, []);
  const [print] = result.events.filter((event) => event.kind === "print");
  assert.deepEqual(print.payload.values, [true]);
});
