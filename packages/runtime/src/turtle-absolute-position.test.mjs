// Unit tests for `home`/`set_xy`/`set_heading` (issue #202, spec/commands.md's Turtle movement
// table — `home`/`set_xy` reposition the turtle at an absolute point; `set_heading` sets an
// absolute heading, normalized to `[0,360)` per spec/commands.md:1300). `home` resets both
// position and heading, so it emits `move`/conditional `draw-segment` (like `forward`/`back`,
// issue #200) followed by `turn` (like `left`/`right`, issue #201); `set_xy` only emits
// `move`/`draw-segment` (heading untouched); `set_heading` only emits `turn` (position untouched).
// `setxy`/`seth` are Turtle & Rendering-profile aliases of `set_xy`/`set_heading` (not Heritage —
// spec/conformance.md:105-117's closed Heritage short-alias list does not include them) and behave
// identically; see the alias-specific tests below.

import assert from "node:assert/strict";
import { test } from "node:test";
import { execute } from "@openlogo/runtime";

test("execute resets the turtle home from a moved-and-turned position, emitting move+draw-segment then turn", () => {
  const result = execute("forward 30\nright 90\nhome", "main.logo");
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(
    result.events.map((event) => event.kind),
    [
      "instruction",
      "move",
      "draw-segment",
      "instruction",
      "turn",
      "instruction",
      "move",
      "draw-segment",
      "turn",
    ],
  );
  const homeEvents = result.events.slice(5);
  assert.deepEqual(homeEvents[1].payload, {
    from: [0, 30],
    to: [0, 0],
    heading: 90,
  });
  assert.deepEqual(homeEvents[2].payload, {
    from: [0, 30],
    to: [0, 0],
    color: "black",
    width: 1,
  });
  assert.deepEqual(homeEvents[3].payload, { from: 90, to: 0 });
});

test("execute home at the origin still emits a degenerate (from === to) move/draw-segment plus a no-op turn", () => {
  const result = execute("home", "main.logo");
  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.events.length, 4);
  assert.deepEqual(result.events[1].payload, {
    from: [0, 0],
    to: [0, 0],
    heading: 0,
  });
  assert.deepEqual(result.events[3].payload, { from: 0, to: 0 });
});

test("execute home suppresses draw-segment (but still emits move) while the pen is up", () => {
  const result = execute("pen_up\nforward 30\nhome", "main.logo");
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(
    result.events.map((event) => event.kind),
    [
      "instruction",
      "pen-change",
      "instruction",
      "move",
      "instruction",
      "move",
      "turn",
    ],
  );
});

test("execute accepts the parenthesized call form for zero-argument home", () => {
  const result = execute("(home)", "main.logo");
  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.events.length, 4);
});

test("execute raises ol-too-many-inputs for a parenthesized one-argument home", () => {
  const result = execute("(home 1)", "main.logo");
  assert.equal(result.events.length, 1);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-too-many-inputs");
  assert.deepEqual(result.diagnostics[0].params, {
    callable: "home",
    expected: 0,
    actual: 1,
  });
});

test("execute moves the turtle to an absolute set_xy position, leaving heading unchanged", () => {
  const result = execute("right 90\nset_xy 50 25", "main.logo");
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(
    result.events.map((event) => event.kind),
    ["instruction", "turn", "instruction", "move", "draw-segment"],
  );
  assert.deepEqual(result.events[3].payload, {
    from: [0, 0],
    to: [50, 25],
    heading: 90,
  });
  assert.deepEqual(result.events[4].payload, {
    from: [0, 0],
    to: [50, 25],
    color: "black",
    width: 1,
  });
});

test("execute set_xy suppresses draw-segment (but still emits move) while the pen is up", () => {
  const result = execute("pen_up\nset_xy 50 25", "main.logo");
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(
    result.events.map((event) => event.kind),
    ["instruction", "pen-change", "instruction", "move"],
  );
});

test("execute accepts the parenthesized call form for a two-argument set_xy", () => {
  const result = execute("(set_xy 50 25)", "main.logo");
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(result.events[1].payload, {
    from: [0, 0],
    to: [50, 25],
    heading: 0,
  });
});

test("execute treats the setxy alias identically to set_xy (issue #202, Turtle & Rendering-profile alias, not Heritage)", () => {
  const result = execute("setxy 50 25", "main.logo");
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(
    result.events.map((event) => event.kind),
    ["instruction", "move", "draw-segment"],
  );
  assert.deepEqual(result.events[1].payload, {
    from: [0, 0],
    to: [50, 25],
    heading: 0,
  });
});

test("execute raises ol-not-enough-inputs for a parenthesized one-argument setxy alias", () => {
  const result = execute("(setxy 1)", "main.logo");
  assert.equal(result.events.length, 1);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-not-enough-inputs");
  assert.deepEqual(result.diagnostics[0].params, {
    callable: "setxy",
    expected: 2,
    actual: 1,
  });
});

test("execute raises ol-not-enough-inputs for a parenthesized one-argument set_xy", () => {
  const result = execute("(set_xy 1)", "main.logo");
  assert.equal(result.events.length, 1);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-not-enough-inputs");
  assert.deepEqual(result.diagnostics[0].params, {
    callable: "set_xy",
    expected: 2,
    actual: 1,
  });
});

test("execute raises ol-too-many-inputs for a parenthesized three-argument set_xy", () => {
  const result = execute("(set_xy 1 2 3)", "main.logo");
  assert.equal(result.events.length, 1);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-too-many-inputs");
  assert.deepEqual(result.diagnostics[0].params, {
    callable: "set_xy",
    expected: 2,
    actual: 3,
  });
});

test("execute raises ol-type for a non-number set_xy x argument", () => {
  const result = execute('set_xy "a" 2', "main.logo");
  assert.equal(result.events.length, 1);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-type");
});

test("execute raises ol-type for a non-number set_xy y argument", () => {
  const result = execute('set_xy 1 "b"', "main.logo");
  assert.equal(result.events.length, 1);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-type");
});

test("execute propagates a failing set_xy x-argument expression instead of moving", () => {
  const result = execute("set_xy 1 / 0 2", "main.logo");
  assert.equal(result.events.length, 1);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-div-zero");
});

test("execute propagates a failing set_xy y-argument expression instead of moving", () => {
  const result = execute("set_xy 1 1 / 0", "main.logo");
  assert.equal(result.events.length, 1);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-div-zero");
});

test("execute leaves an unsupported set_xy argument un-evaluated, emitting no move event", () => {
  const result = execute("set_xy :ages.tom 2", "main.logo");
  assert.equal(result.events.length, 1);
  assert.deepEqual(result.diagnostics, []);
});

test("execute raises ol-range for a set_xy x argument that overflows to Infinity, instead of moving the turtle to an infinite position", () => {
  const result = execute("set_xy power 10 1000 2", "main.logo");
  assert.equal(result.events.length, 1);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-range");
  assert.deepEqual(result.diagnostics[0].params, {
    operation: "set_xy",
    axis: "x",
    value: "Infinity",
  });
  // `params` is a diagnostic-identity payload and must survive a JSON round-trip
  // (spec/error-model.md:34) — a raw `Infinity` number would silently become `null`.
  assert.deepEqual(
    JSON.parse(JSON.stringify(result.diagnostics[0].params)),
    result.diagnostics[0].params,
  );
});

test("execute raises ol-range for a set_xy y argument that overflows to -Infinity", () => {
  const result = execute("(set_xy 2 0 - power 10 1000)", "main.logo");
  assert.equal(result.events.length, 1);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-range");
  assert.deepEqual(result.diagnostics[0].params, {
    operation: "set_xy",
    axis: "y",
    value: "-Infinity",
  });
});

test("execute sets the turtle heading directly, emitting only a turn event (no move/draw-segment)", () => {
  const result = execute("forward 10\nset_heading 180", "main.logo");
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(
    result.events.map((event) => event.kind),
    ["instruction", "move", "draw-segment", "instruction", "turn"],
  );
  assert.deepEqual(result.events[4].payload, { from: 0, to: 180 });
});

test("execute normalizes a set_heading above 360 into [0,360)", () => {
  const result = execute("set_heading 450", "main.logo");
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(result.events[1].payload, { from: 0, to: 90 });
});

test("execute normalizes a negative set_heading into [0,360)", () => {
  const result = execute("set_heading -90", "main.logo");
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(result.events[1].payload, { from: 0, to: 270 });
});

test("execute accepts the parenthesized call form for a single-argument set_heading", () => {
  const result = execute("(set_heading 180)", "main.logo");
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(result.events[1].payload, { from: 0, to: 180 });
});

test("execute treats the seth alias identically to set_heading, including normalization (issue #202, Turtle & Rendering-profile alias, not Heritage)", () => {
  const result = execute("seth 450", "main.logo");
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(
    result.events.map((event) => event.kind),
    ["instruction", "turn"],
  );
  assert.deepEqual(result.events[1].payload, { from: 0, to: 90 });
});

test("execute raises ol-too-many-inputs for a parenthesized two-argument seth alias", () => {
  const result = execute("(seth 1 2)", "main.logo");
  assert.equal(result.events.length, 1);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-too-many-inputs");
  assert.deepEqual(result.diagnostics[0].params, {
    callable: "seth",
    expected: 1,
    actual: 2,
  });
});

test("execute raises ol-not-enough-inputs for a bare zero-argument set_heading", () => {
  const result = execute("set_heading", "main.logo");
  assert.equal(result.events.length, 1);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-not-enough-inputs");
  assert.deepEqual(result.diagnostics[0].params, {
    callable: "set_heading",
    expected: 1,
    actual: 0,
  });
});

test("execute raises ol-too-many-inputs for a parenthesized two-argument set_heading", () => {
  const result = execute("(set_heading 1 2)", "main.logo");
  assert.equal(result.events.length, 1);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-too-many-inputs");
  assert.deepEqual(result.diagnostics[0].params, {
    callable: "set_heading",
    expected: 1,
    actual: 2,
  });
});

test("execute raises ol-type for a non-number set_heading argument", () => {
  const result = execute('set_heading "a"', "main.logo");
  assert.equal(result.events.length, 1);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-type");
});

test("execute propagates a failing set_heading argument expression instead of turning", () => {
  const result = execute("set_heading 1 / 0", "main.logo");
  assert.equal(result.events.length, 1);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-div-zero");
});

test("execute leaves an unsupported set_heading argument un-evaluated, emitting no turn event", () => {
  const result = execute("set_heading :ages.tom", "main.logo");
  assert.equal(result.events.length, 1);
  assert.deepEqual(result.diagnostics, []);
});

test("execute raises ol-range for a set_heading angle that overflows to Infinity, instead of emitting a NaN-corrupted turn event", () => {
  const result = execute("set_heading power 10 1000", "main.logo");
  assert.equal(result.events.length, 1);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-range");
  assert.deepEqual(result.diagnostics[0].params, {
    operation: "set_heading",
    value: "Infinity",
  });
  assert.deepEqual(
    JSON.parse(JSON.stringify(result.diagnostics[0].params)),
    result.diagnostics[0].params,
  );
});
