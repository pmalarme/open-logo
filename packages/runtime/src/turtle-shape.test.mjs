// Unit tests for `fill`, `stamp`, and `set_shape` (issue #210; spec/rendering.md's "Fill" and
// "Turtle avatar and shapes" sections; spec/commands.md's `fill`/`stamp`/`set_shape` entries).
// `fill` and `stamp` are 0-arity commands that snapshot current turtle state into a one-shot
// scene event (`fill`/`stamp`) with no turtle-state mutation; `set_shape` takes exactly one word
// argument naming a recognized shape (`turtle`, `triangle`, `arrow`, `circle`), updates
// `turtle.shape`, and emits `shape-change` (`{from, to}`). An unrecognized shape word and a
// non-word argument both raise `ol-type`, differentiated by `expected` ("shape" vs "word") since
// the shape set is open/implementation-defined and has no dedicated `ol-bad-shape` code
// (spec/commands.md's `set_shape` entry: "Possible errors: none specified in C3 beyond general
// type and arity diagnostics").

import assert from "node:assert/strict";
import { test } from "node:test";
import { execute } from "@openlogo/runtime";

test("fill emits a fill event carrying the current pen color and does not change turtle state", () => {
  const result = execute("fill", "main.logo");
  assert.deepEqual(result.diagnostics, []);
  const kinds = result.events.map((event) => event.kind);
  assert.deepEqual(kinds, ["instruction", "fill"]);
  assert.deepEqual(result.events[1].payload, { color: "black" });
});

test("fill after set_color captures the current color", () => {
  const result = execute('set_color "blue"\nfill', "main.logo");
  assert.deepEqual(result.diagnostics, []);
  const fill = result.events.find((event) => event.kind === "fill");
  assert.deepEqual(fill.payload, { color: "blue" });
});

test("fill with an argument raises ol-too-many-inputs", () => {
  const result = execute("(fill 1)", "main.logo");
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-too-many-inputs");
  assert.deepEqual(result.diagnostics[0].params, {
    callable: "fill",
    expected: 0,
    actual: 1,
  });
  assert.equal(
    result.events.some((event) => event.kind === "fill"),
    false,
  );
});

test("stamp emits a stamp event snapshotting position, heading, shape, and color", () => {
  const result = execute("forward 10\nright 90\nstamp", "main.logo");
  assert.deepEqual(result.diagnostics, []);
  const stamp = result.events.find((event) => event.kind === "stamp");
  assert.deepEqual(stamp.payload, {
    position: [0, 10],
    heading: 90,
    shape: "turtle",
    color: "black",
  });
});

test("stamp is recorded even with the pen up (independent of pen state)", () => {
  const result = execute("pen_up\nforward 10\nstamp", "main.logo");
  assert.deepEqual(result.diagnostics, []);
  const stamp = result.events.find((event) => event.kind === "stamp");
  assert.deepEqual(stamp.payload.position, [0, 10]);
  assert.equal(
    result.events.some((event) => event.kind === "draw-segment"),
    false,
  );
});

test("stamp after set_shape captures the new shape", () => {
  const result = execute('set_shape "circle"\nstamp', "main.logo");
  assert.deepEqual(result.diagnostics, []);
  const stamp = result.events.find((event) => event.kind === "stamp");
  assert.equal(stamp.payload.shape, "circle");
});

test("stamp with an argument raises ol-too-many-inputs", () => {
  const result = execute("(stamp 1)", "main.logo");
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-too-many-inputs");
  assert.deepEqual(result.diagnostics[0].params, {
    callable: "stamp",
    expected: 0,
    actual: 1,
  });
  assert.equal(
    result.events.some((event) => event.kind === "stamp"),
    false,
  );
});

test("set_shape changes the turtle's shape from the default 'turtle' and emits shape-change", () => {
  const result = execute('set_shape "triangle"', "main.logo");
  assert.deepEqual(result.diagnostics, []);
  const kinds = result.events.map((event) => event.kind);
  assert.deepEqual(kinds, ["instruction", "shape-change"]);
  assert.deepEqual(result.events[1].payload, {
    from: "turtle",
    to: "triangle",
  });
});

for (const shape of ["turtle", "triangle", "arrow", "circle"]) {
  test(`set_shape accepts the recognized shape "${shape}"`, () => {
    const result = execute(`set_shape "${shape}"`, "main.logo");
    assert.deepEqual(result.diagnostics, []);
    const change = result.events.find((event) => event.kind === "shape-change");
    assert.equal(change.payload.to, shape);
  });
}

test("set_shape is case-insensitive and normalizes to lowercase", () => {
  const result = execute('set_shape "TRIANGLE"', "main.logo");
  assert.deepEqual(result.diagnostics, []);
  const change = result.events.find((event) => event.kind === "shape-change");
  assert.equal(change.payload.to, "triangle");
});

test("a second set_shape reports the prior shape as from", () => {
  const result = execute('set_shape "arrow"\nset_shape "circle"', "main.logo");
  assert.deepEqual(result.diagnostics, []);
  const changes = result.events.filter(
    (event) => event.kind === "shape-change",
  );
  assert.equal(changes.length, 2);
  assert.deepEqual(changes[1].payload, { from: "arrow", to: "circle" });
});

test("set_shape does not emit move/turn/draw-segment events", () => {
  const result = execute('set_shape "circle"', "main.logo");
  assert.deepEqual(result.diagnostics, []);
  assert.equal(
    result.events.some((event) =>
      ["move", "turn", "draw-segment"].includes(event.kind),
    ),
    false,
  );
});

test("set_shape raises ol-type for a non-word argument", () => {
  const result = execute("set_shape 5", "main.logo");
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-type");
  assert.deepEqual(result.diagnostics[0].params, {
    expected: "word",
    actual: "number",
    value: 5,
    operation: "set_shape",
  });
  assert.equal(
    result.events.some((event) => event.kind === "shape-change"),
    false,
  );
});

test("set_shape raises ol-type (expected: shape) for a word naming no recognized shape", () => {
  const result = execute('set_shape "not-a-shape"', "main.logo");
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-type");
  assert.deepEqual(result.diagnostics[0].params, {
    expected: "shape",
    actual: "word",
    value: "not-a-shape",
    operation: "set_shape",
  });
  assert.equal(
    result.events.some((event) => event.kind === "shape-change"),
    false,
  );
});

test("set_shape with no arguments raises ol-not-enough-inputs", () => {
  const result = execute("set_shape", "main.logo");
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-not-enough-inputs");
  assert.deepEqual(result.diagnostics[0].params, {
    callable: "set_shape",
    expected: 1,
    actual: 0,
  });
});

test("set_shape with two arguments raises ol-too-many-inputs", () => {
  const result = execute('(set_shape "circle" "arrow")', "main.logo");
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-too-many-inputs");
  assert.deepEqual(result.diagnostics[0].params, {
    callable: "set_shape",
    expected: 1,
    actual: 2,
  });
});

test("set_shape leaves an unsupported argument expression un-evaluated", () => {
  const result = execute("set_shape (nonexistent_builtin 1)", "main.logo");
  assert.equal(result.diagnostics.length, 0);
  assert.equal(
    result.events.some((event) => event.kind === "shape-change"),
    false,
  );
});

test("set_shape propagates a diagnostic raised while evaluating its argument", () => {
  const result = execute('set_shape power "a" 1', "main.logo");
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-type");
  assert.equal(result.diagnostics[0].params.operation, "power");
});
