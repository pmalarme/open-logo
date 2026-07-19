// Unit tests for `set_width` and its `setwidth` Turtle & Rendering alias (issue #209,
// spec/commands.md's `set_width` entry: "The width MUST be a positive number"). Takes exactly one
// numeric argument, validated by `requireNumber` (a non-number raises `ol-type`) and then by a
// positive-and-finite guard (`0`, a negative width, or a non-finite width raises `ol-range`) before
// updating `turtle.width` and emitting `width-change` (`{from, to}`). The new width threads into a
// subsequently drawn segment's `DrawSegmentPayload.width`, exactly as `set_color` threads into
// `color` (issue #208's precedent).

import assert from "node:assert/strict";
import { test } from "node:test";
import { execute } from "@openlogo/runtime";

test("set_width changes the turtle's width from the default 1 and emits width-change", () => {
  const result = execute("set_width 4", "main.logo");
  assert.deepEqual(result.diagnostics, []);
  const kinds = result.events.map((event) => event.kind);
  assert.deepEqual(kinds, ["instruction", "width-change"]);
  assert.deepEqual(result.events[1].payload, { from: 1, to: 4 });
});

test("setwidth is a Turtle & Rendering alias of set_width and behaves identically", () => {
  const result = execute("setwidth 4", "main.logo");
  assert.deepEqual(result.diagnostics, []);
  const change = result.events.find((event) => event.kind === "width-change");
  assert.deepEqual(change.payload, { from: 1, to: 4 });
});

test("set_width threads the new width into a subsequently drawn segment", () => {
  const result = execute("set_width 4\nforward 10", "main.logo");
  assert.deepEqual(result.diagnostics, []);
  const draw = result.events.find((event) => event.kind === "draw-segment");
  assert.equal(draw.payload.width, 4);
});

test("a second set_width reports the prior width as from", () => {
  const result = execute("set_width 4\nset_width 7", "main.logo");
  assert.deepEqual(result.diagnostics, []);
  const changes = result.events.filter(
    (event) => event.kind === "width-change",
  );
  assert.equal(changes.length, 2);
  assert.deepEqual(changes[1].payload, { from: 4, to: 7 });
});

test("set_width accepts a fractional positive width", () => {
  const result = execute("set_width 2.5", "main.logo");
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(result.events[1].payload, { from: 1, to: 2.5 });
});

test("set_width raises ol-type for a non-number width", () => {
  const result = execute('set_width "thick"', "main.logo");
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-type");
  assert.deepEqual(result.diagnostics[0].params, {
    expected: "number",
    actual: "word",
    value: "thick",
    operation: "set_width",
  });
});

test("setwidth raises ol-type for a non-number width and reports its own identity", () => {
  const result = execute('setwidth "thick"', "main.logo");
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-type");
  assert.equal(result.diagnostics[0].params.operation, "setwidth");
});

test("set_width raises ol-range for zero", () => {
  const result = execute("set_width 0", "main.logo");
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-range");
  assert.deepEqual(result.diagnostics[0].params, {
    operation: "set_width",
    value: "0",
  });
  assert.equal(
    result.events.some((event) => event.kind === "width-change"),
    false,
  );
});

test("set_width raises ol-range for a negative width", () => {
  const result = execute("set_width -2", "main.logo");
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-range");
  assert.deepEqual(result.diagnostics[0].params, {
    operation: "set_width",
    value: "-2",
  });
});

test("setwidth raises ol-range for a negative width and reports its own identity", () => {
  const result = execute("setwidth -2", "main.logo");
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-range");
  assert.equal(result.diagnostics[0].params.operation, "setwidth");
});

test("set_width raises ol-range for a non-finite width reachable via arithmetic overflow", () => {
  const result = execute("set_width power 10 1000", "main.logo");
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-range");
  assert.deepEqual(result.diagnostics[0].params, {
    operation: "set_width",
    value: "Infinity",
  });
});

test("set_width with no arguments raises ol-not-enough-inputs", () => {
  const result = execute("set_width", "main.logo");
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-not-enough-inputs");
  assert.deepEqual(result.diagnostics[0].params, {
    callable: "set_width",
    expected: 1,
    actual: 0,
  });
});

test("setwidth with no arguments raises ol-not-enough-inputs with its own identity", () => {
  const result = execute("setwidth", "main.logo");
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-not-enough-inputs");
  assert.equal(result.diagnostics[0].params.callable, "setwidth");
});

test("set_width with two arguments raises ol-too-many-inputs", () => {
  const result = execute("(set_width 4 5)", "main.logo");
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-too-many-inputs");
  assert.deepEqual(result.diagnostics[0].params, {
    callable: "set_width",
    expected: 1,
    actual: 2,
  });
});

test("setwidth with two arguments raises ol-too-many-inputs with its own identity", () => {
  const result = execute("(setwidth 4 5)", "main.logo");
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-too-many-inputs");
  assert.equal(result.diagnostics[0].params.callable, "setwidth");
});

test("set_width leaves an unsupported argument expression un-evaluated (place segment)", () => {
  const result = execute("set_width :widths.tom", "main.logo");
  assert.equal(result.diagnostics.length, 0);
  assert.equal(
    result.events.some((event) => event.kind === "width-change"),
    false,
  );
});

test("set_width propagates a diagnostic raised while evaluating its argument", () => {
  const result = execute('set_width power "a" 1', "main.logo");
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-type");
  assert.equal(result.diagnostics[0].params.operation, "power");
});
