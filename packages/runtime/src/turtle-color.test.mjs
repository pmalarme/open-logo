// Unit tests for `set_color`/`set_background` and their `setcolor`/`setbg` Turtle & Rendering
// aliases (issue #208, spec/commands.md's `set_color`/`set_background` entries and its "Colors"
// section). Both take exactly one color argument - a named palette word, an `[r g b]` list, or a
// `"#rrggbb"` hex word - and validate it via `normalizeColor` before either updating `turtle.color`
// and emitting `color-change` (`set_color`/`setcolor`) or emitting `background-change` only, with
// no turtle-state change (`set_background`/`setbg`). Any other value raises `ol-bad-color`.

import assert from "node:assert/strict";
import { test } from "node:test";
import { execute } from "@openlogo/runtime";

test("set_color changes the turtle's color from a named word and emits color-change", () => {
  const result = execute('set_color "blue"', "main.logo");
  assert.deepEqual(result.diagnostics, []);
  const kinds = result.events.map((event) => event.kind);
  assert.deepEqual(kinds, ["instruction", "color-change"]);
  assert.deepEqual(result.events[1].payload, { from: "black", to: "blue" });
});

test("setcolor is a Turtle & Rendering alias of set_color and reports its own identity on error", () => {
  const result = execute('setcolor "reddish"', "main.logo");
  assert.equal(
    result.events.some((event) => event.kind === "color-change"),
    false,
  );
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-bad-color");
  assert.deepEqual(result.diagnostics[0].params, {
    operation: "setcolor",
    value: "reddish",
  });
});

test("set_color accepts an [r g b] list and normalizes it to an rgb(...) string", () => {
  const result = execute("set_color [10 20 30]", "main.logo");
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(result.events[1].payload, {
    from: "black",
    to: "rgb(10, 20, 30)",
  });
});

test("set_color accepts a #rrggbb hex word, lowercased", () => {
  const result = execute('set_color "#3366FF"', "main.logo");
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(result.events[1].payload, {
    from: "black",
    to: "#3366ff",
  });
});

test("set_color threads the new color into a subsequently drawn segment", () => {
  const result = execute('set_color "blue"\nforward 10', "main.logo");
  assert.deepEqual(result.diagnostics, []);
  const draw = result.events.find((event) => event.kind === "draw-segment");
  assert.equal(draw.payload.color, "blue");
});

test("a second set_color reports the prior color as from", () => {
  const result = execute('set_color "blue"\nset_color "red"', "main.logo");
  assert.deepEqual(result.diagnostics, []);
  const changes = result.events.filter(
    (event) => event.kind === "color-change",
  );
  assert.equal(changes.length, 2);
  assert.deepEqual(changes[1].payload, { from: "blue", to: "red" });
});

test("set_color raises ol-bad-color for an unknown color word", () => {
  const result = execute('set_color "reddish"', "main.logo");
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-bad-color");
  assert.deepEqual(result.diagnostics[0].params, {
    operation: "set_color",
    value: "reddish",
  });
});

test("set_color raises ol-bad-color for an out-of-range rgb component", () => {
  const result = execute("set_color [10 20 300]", "main.logo");
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-bad-color");
  assert.deepEqual(result.diagnostics[0].params.value, [10, 20, 300]);
});

test("set_color raises ol-bad-color for a wrong-length rgb list", () => {
  const result = execute("set_color [10 20]", "main.logo");
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-bad-color");
});

test("set_color raises ol-bad-color for a malformed hex word", () => {
  const result = execute('set_color "#zzzzzz"', "main.logo");
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-bad-color");
});

test("set_color raises ol-bad-color for a value of the wrong type entirely", () => {
  const result = execute("set_color 5", "main.logo");
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-bad-color");
  assert.deepEqual(result.diagnostics[0].params, {
    operation: "set_color",
    value: 5,
  });
});

test("set_color raises ol-not-enough-inputs with zero arguments (parenthesized form)", () => {
  const result = execute("(set_color)", "main.logo");
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-not-enough-inputs");
  assert.deepEqual(result.diagnostics[0].params, {
    callable: "set_color",
    expected: 1,
    actual: 0,
  });
});

test("setcolor raises ol-too-many-inputs with two arguments", () => {
  const result = execute('(setcolor "blue" "red")', "main.logo");
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-too-many-inputs");
  assert.deepEqual(result.diagnostics[0].params, {
    callable: "setcolor",
    expected: 1,
    actual: 2,
  });
});

test("set_background emits background-change without touching turtle state", () => {
  const result = execute('set_background "green"', "main.logo");
  assert.deepEqual(result.diagnostics, []);
  const kinds = result.events.map((event) => event.kind);
  assert.deepEqual(kinds, ["instruction", "background-change"]);
  assert.deepEqual(result.events[1].payload, { color: "green" });
});

test("setbg is a Turtle & Rendering alias of set_background", () => {
  const result = execute("setbg [1 2 3]", "main.logo");
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(result.events[1].payload, { color: "rgb(1, 2, 3)" });
});

test("set_background raises ol-bad-color for an unknown color word", () => {
  const result = execute('set_background "reddish"', "main.logo");
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-bad-color");
  assert.deepEqual(result.diagnostics[0].params, {
    operation: "set_background",
    value: "reddish",
  });
});

test("setbg raises ol-bad-color with its own operation identity", () => {
  const result = execute("setbg [1 2 999]", "main.logo");
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-bad-color");
  assert.equal(result.diagnostics[0].params.operation, "setbg");
});

test("set_background raises ol-not-enough-inputs with zero arguments", () => {
  const result = execute("(set_background)", "main.logo");
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-not-enough-inputs");
  assert.deepEqual(result.diagnostics[0].params, {
    callable: "set_background",
    expected: 1,
    actual: 0,
  });
});

test("setbg raises ol-too-many-inputs with two arguments", () => {
  const result = execute('(setbg "green" "blue")', "main.logo");
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-too-many-inputs");
  assert.deepEqual(result.diagnostics[0].params, {
    callable: "setbg",
    expected: 1,
    actual: 2,
  });
});

test("set_color leaves an unsupported argument expression un-evaluated (no diagnostic, no event)", () => {
  // Mirrors turtle-movement.test.mjs's equivalent test: `.field` place segments are
  // Data/record-profile and deferred, so `isSupportedExpression` reports this operand
  // unsupported and the statement is left un-evaluated (still no diagnostic, no event).
  const result = execute("set_color :colors.tom", "main.logo");
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].kind, "instruction");
  assert.deepEqual(result.diagnostics, []);
});

test("set_color propagates a diagnostic raised while evaluating its argument", () => {
  // `power "a" 1` is a supported expression form (a known binary math builtin with supported
  // operands) but fails at evaluation time, since `"a"` is not a number - covers the
  // `!argResult.ok` branch distinct from `normalizeColor` rejecting an already-evaluated value.
  const result = execute('set_color power "a" 1', "main.logo");
  assert.equal(
    result.events.some((event) => event.kind === "color-change"),
    false,
  );
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-type");
});

test("set_background leaves an unsupported argument expression un-evaluated (no diagnostic, no event)", () => {
  const result = execute("set_background :colors.tom", "main.logo");
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].kind, "instruction");
  assert.deepEqual(result.diagnostics, []);
});

test("set_background propagates a diagnostic raised while evaluating its argument", () => {
  const result = execute('set_background power "a" 1', "main.logo");
  assert.equal(
    result.events.some((event) => event.kind === "background-change"),
    false,
  );
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-type");
});
