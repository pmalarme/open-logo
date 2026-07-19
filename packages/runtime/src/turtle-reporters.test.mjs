// Unit tests for the turtle-state reporters `xcor`/`ycor`/`heading`/`pos`/`towards`/`distance`
// (issue #203, spec/commands.md "xcor"/"ycor"/"heading"/"pos"/"towards"/"distance"). Unlike the
// turtle *commands* (`forward`/`set_width`/…), these are pure reads dispatched from `evaluate.ts`'s
// `evaluateCall`, not `execute-internal.ts`'s `dispatchTurtleCommand` — no `move`/`turn`/
// `draw-segment`/`*-change` trace event is ever emitted by any of them.

import assert from "node:assert/strict";
import { test } from "node:test";
import { execute } from "@openlogo/runtime";

const doc = "acceptance.logo";

function printedValues(result) {
  return result.events
    .filter((event) => event.kind === "print")
    .map((event) => event.payload.values[0]);
}

function nonInstructionKinds(result) {
  return result.events
    .map((event) => event.kind)
    .filter((kind) => kind !== "instruction" && kind !== "print");
}

// --- xcor / ycor / heading / pos, at the default turtle state -----------------------------

test("xcor reports 0 for the default turtle state", () => {
  const result = execute("print xcor", doc);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(printedValues(result), [0]);
  assert.deepEqual(nonInstructionKinds(result), []);
});

test("ycor reports 0 for the default turtle state", () => {
  const result = execute("print ycor", doc);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(printedValues(result), [0]);
});

test("heading reports 0 for the default turtle state", () => {
  const result = execute("print heading", doc);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(printedValues(result), [0]);
});

test("pos reports the list [0 0] for the default turtle state", () => {
  const result = execute("print pos", doc);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(printedValues(result), [[0, 0]]);
});

// --- xcor / ycor / heading / pos, after moving -----------------------------------------------

test("xcor and ycor report the turtle's position after set_xy", () => {
  const result = execute("set_xy 30 40\nprint xcor\nprint ycor", doc);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(printedValues(result), [30, 40]);
});

test("heading reports the turtle's heading after set_heading", () => {
  const result = execute("set_heading 90\nprint heading", doc);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(printedValues(result), [90]);
});

test("pos reports the list [30 40] after set_xy", () => {
  const result = execute("set_xy 30 40\nprint pos", doc);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(printedValues(result), [[30, 40]]);
});

test("reading xcor/ycor/heading/pos emits no move/turn/draw-segment/change event", () => {
  const result = execute(
    "set_xy 30 40\nset_heading 90\nprint xcor\nprint ycor\nprint heading\nprint pos",
    doc,
  );
  assert.deepEqual(result.diagnostics, []);
  const kinds = result.events.map((event) => event.kind);
  // Only the two writes (set_xy's move + draw-segment, set_heading's turn) produce state-change
  // events; the four reporter reads that follow contribute nothing beyond their own `print`
  // events.
  const changeEvents = kinds.filter(
    (kind) => kind !== "instruction" && kind !== "print",
  );
  assert.deepEqual(changeEvents, ["move", "draw-segment", "turn"]);
});

// --- xcor / ycor / heading / pos arity: ol-too-many-inputs -----------------------------------

test("(xcor 1) raises ol-too-many-inputs", () => {
  const result = execute("print (xcor 1)", doc);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-too-many-inputs");
  assert.deepEqual(result.diagnostics[0].params, {
    callable: "xcor",
    expected: 0,
    actual: 1,
  });
});

test("(ycor 1) raises ol-too-many-inputs", () => {
  const result = execute("print (ycor 1)", doc);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-too-many-inputs");
  assert.deepEqual(result.diagnostics[0].params, {
    callable: "ycor",
    expected: 0,
    actual: 1,
  });
});

test("(heading 1) raises ol-too-many-inputs", () => {
  const result = execute("print (heading 1)", doc);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-too-many-inputs");
  assert.deepEqual(result.diagnostics[0].params, {
    callable: "heading",
    expected: 0,
    actual: 1,
  });
});

test("(pos 1) raises ol-too-many-inputs", () => {
  const result = execute("print (pos 1)", doc);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-too-many-inputs");
  assert.deepEqual(result.diagnostics[0].params, {
    callable: "pos",
    expected: 0,
    actual: 1,
  });
});

test("(pos 1 2) raises ol-too-many-inputs with the full over-supplied count", () => {
  const result = execute("print (pos 1 2)", doc);
  assert.equal(result.diagnostics.length, 1);
  assert.deepEqual(result.diagnostics[0].params, {
    callable: "pos",
    expected: 0,
    actual: 2,
  });
});

// --- towards / distance, from the origin -------------------------------------------------

test("towards 100 0 from the origin reports heading 90 (due +x)", () => {
  const result = execute("print towards 100 0", doc);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(printedValues(result), [90]);
});

test("distance 100 0 from the origin reports 100", () => {
  const result = execute("print distance 100 0", doc);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(printedValues(result), [100]);
});

test("towards 0 100 from the origin reports heading 0 (due +y/up)", () => {
  const result = execute("print towards 0 100", doc);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(printedValues(result), [0]);
});

test("towards -100 0 from the origin reports heading 270 (due -x, normalized to [0,360))", () => {
  const result = execute("print towards -100 0", doc);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(printedValues(result), [270]);
});

test("towards computes relative to a moved turtle's current position, not the origin", () => {
  const result = execute("set_xy 10 10\nprint towards 110 10", doc);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(printedValues(result), [90]);
});

test("distance computes relative to a moved turtle's current position, not the origin", () => {
  const result = execute("set_xy 10 10\nprint distance 110 10", doc);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(printedValues(result), [100]);
});

test("towards at the turtle's own position reports heading 0, not an error", () => {
  const result = execute("print towards 0 0", doc);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(printedValues(result), [0]);
});

test("towards/distance emit no move/turn/draw-segment event", () => {
  const result = execute("print towards 100 0\nprint distance 100 0", doc);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(nonInstructionKinds(result), []);
});

// --- towards / distance: ol-type for a non-number argument -----------------------------------

test("towards with a non-number first argument raises ol-type naming towards", () => {
  const result = execute('print towards "east" 0', doc);
  assert.equal(result.diagnostics.length, 1);
  assert.deepEqual(result.diagnostics[0].code, "ol-type");
  assert.deepEqual(result.diagnostics[0].params, {
    expected: "number",
    actual: "word",
    value: "east",
    operation: "towards",
  });
});

test("towards with a non-number second argument raises ol-type", () => {
  const result = execute("print towards 0 true", doc);
  assert.equal(result.diagnostics.length, 1);
  assert.deepEqual(result.diagnostics[0].code, "ol-type");
  assert.deepEqual(result.diagnostics[0].params, {
    expected: "number",
    actual: "boolean",
    value: true,
    operation: "towards",
  });
});

test("distance with a non-number first argument raises ol-type naming distance", () => {
  const result = execute('print distance "east" 0', doc);
  assert.equal(result.diagnostics.length, 1);
  assert.deepEqual(result.diagnostics[0].code, "ol-type");
  assert.deepEqual(result.diagnostics[0].params, {
    expected: "number",
    actual: "word",
    value: "east",
    operation: "distance",
  });
});

test("distance with a non-number second argument raises ol-type", () => {
  const result = execute("print distance 0 [1 2]", doc);
  assert.equal(result.diagnostics.length, 1);
  assert.deepEqual(result.diagnostics[0].code, "ol-type");
  assert.deepEqual(result.diagnostics[0].params, {
    expected: "number",
    actual: "list",
    value: [1, 2],
    operation: "distance",
  });
});

test("towards propagates the first argument's evaluation failure instead of evaluating the second", () => {
  const result = execute("print towards :missing 0", doc);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-undefined-var");
});

test("towards propagates the second argument's evaluation failure", () => {
  const result = execute("print towards 100 :missing", doc);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-undefined-var");
});

test("distance propagates the first argument's evaluation failure instead of evaluating the second", () => {
  const result = execute("print distance :missing 0", doc);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-undefined-var");
});

test("distance propagates the second argument's evaluation failure", () => {
  const result = execute("print distance 0 :missing", doc);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-undefined-var");
});

// --- towards / distance arity: ol-not-enough-inputs / ol-too-many-inputs ---------------------

test("towards with no arguments raises ol-not-enough-inputs", () => {
  const result = execute("print (towards)", doc);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-not-enough-inputs");
  assert.deepEqual(result.diagnostics[0].params, {
    callable: "towards",
    expected: 2,
    actual: 0,
  });
});

test("towards with one argument raises ol-not-enough-inputs", () => {
  const result = execute("print (towards 100)", doc);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-not-enough-inputs");
  assert.deepEqual(result.diagnostics[0].params, {
    callable: "towards",
    expected: 2,
    actual: 1,
  });
});

test("towards with three arguments raises ol-too-many-inputs", () => {
  const result = execute("print (towards 100 0 5)", doc);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-too-many-inputs");
  assert.deepEqual(result.diagnostics[0].params, {
    callable: "towards",
    expected: 2,
    actual: 3,
  });
});

test("distance with no arguments raises ol-not-enough-inputs", () => {
  const result = execute("print (distance)", doc);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-not-enough-inputs");
  assert.deepEqual(result.diagnostics[0].params, {
    callable: "distance",
    expected: 2,
    actual: 0,
  });
});

test("distance with three arguments raises ol-too-many-inputs", () => {
  const result = execute("print (distance 100 0 5)", doc);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-too-many-inputs");
  assert.deepEqual(result.diagnostics[0].params, {
    callable: "distance",
    expected: 2,
    actual: 3,
  });
});

// --- unsupported argument expression: left un-evaluated, mirroring #209's `.field` precedent --

test("towards with an unsupported .field argument is left un-executed", () => {
  const result = execute("print towards :places.tom 0", doc);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(printedValues(result), []);
});

test("distance with an unsupported .field argument is left un-executed", () => {
  const result = execute("print distance :places.tom 0", doc);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(printedValues(result), []);
});
