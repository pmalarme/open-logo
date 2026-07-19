// Unit tests for `left`/`right` (issue #201, spec/commands.md's Turtle movement table,
// spec/execution-model.md:537-538's turn convention/normalization). `right` turns clockwise
// (positive heading delta), `left` turns counter-clockwise (negative heading delta); headings are
// always normalized to `[0,360)`.

import assert from "node:assert/strict";
import { test } from "node:test";
import { execute } from "@openlogo/runtime";

test("execute turns the turtle right, emitting a turn event with heading 0 -> 90", () => {
  const result = execute("right 90", "main.logo");
  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.events.length, 2);
  assert.equal(result.events[0].kind, "instruction");
  assert.deepEqual(result.events[1], {
    seq: 1,
    kind: "turn",
    source_span: result.events[0].source_span,
    payload: { from: 0, to: 90 },
  });
});

test("execute turns the turtle left, wrapping around to 270 (counter-clockwise from 0)", () => {
  const result = execute("left 90", "main.logo");
  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.events.length, 2);
  assert.deepEqual(result.events[1], {
    seq: 1,
    kind: "turn",
    source_span: result.events[0].source_span,
    payload: { from: 0, to: 270 },
  });
});

test("execute normalizes a right turn that overflows 360 back into [0,360)", () => {
  // 350 + 20 = 370, mod 360 = 10.
  const result = execute("right 350\nright 20", "main.logo");
  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.events.length, 4);
  assert.deepEqual(result.events[1].payload, { from: 0, to: 350 });
  assert.deepEqual(result.events[3].payload, { from: 350, to: 10 });
});

test("execute normalizes a left turn that underflows below 0 back into [0,360)", () => {
  // 10 - 20 = -10, mod 360 = 350.
  const result = execute("right 10\nleft 20", "main.logo");
  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.events.length, 4);
  assert.deepEqual(result.events[1].payload, { from: 0, to: 10 });
  assert.deepEqual(result.events[3].payload, { from: 10, to: 350 });
});

test("execute normalizes a left full-turn to plain 0, not JavaScript's -0", () => {
  // 0 + (-360) = -360, and -360 % 360 is JavaScript's `-0` (Object.is(-0, 0) is false) —
  // `normalizeHeading` guards this so the emitted heading always serializes as plain `0`.
  const result = execute("left 360", "main.logo");
  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.events.length, 2);
  assert.deepEqual(result.events[1].payload, { from: 0, to: 0 });
  assert.ok(
    !Object.is(result.events[1].payload.to, -0),
    "heading must not be -0",
  );
  assert.equal(JSON.stringify(result.events[1].payload.to), "0");
});

test("execute threads heading across statements without emitting a move/draw-segment event", () => {
  const result = execute("right 45\nright 45", "main.logo");
  assert.deepEqual(result.diagnostics, []);
  // Two instruction events + two turn events; never a move/draw-segment (turning never
  // translates).
  assert.deepEqual(
    result.events.map((event) => event.kind),
    ["instruction", "turn", "instruction", "turn"],
  );
  assert.deepEqual(result.events[3].payload, { from: 45, to: 90 });
});

test("execute evaluates an arithmetic turn-angle argument before turning", () => {
  const result = execute("right 30 + 15", "main.logo");
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(result.events[1].payload, { from: 0, to: 45 });
});

test("execute accepts the parenthesized call form for a single-argument turn", () => {
  const result = execute("(right 90)", "main.logo");
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(result.events[1].payload, { from: 0, to: 90 });
});

test("execute raises ol-not-enough-inputs for a bare zero-argument right", () => {
  const result = execute("right", "main.logo");
  assert.equal(result.events.length, 1);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-not-enough-inputs");
  assert.deepEqual(result.diagnostics[0].params, {
    callable: "right",
    expected: 1,
    actual: 0,
  });
});

test("execute raises ol-too-many-inputs for a parenthesized two-argument left", () => {
  const result = execute("(left 10 20)", "main.logo");
  assert.equal(result.events.length, 1);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-too-many-inputs");
  assert.deepEqual(result.diagnostics[0].params, {
    callable: "left",
    expected: 1,
    actual: 2,
  });
});

test("execute raises ol-type for a non-number turn angle", () => {
  const result = execute('right "abc"', "main.logo");
  assert.equal(result.events.length, 1);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-type");
});

test("execute propagates a failing turn-angle argument expression instead of turning", () => {
  const result = execute("right 1 / 0", "main.logo");
  assert.equal(result.events.length, 1);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-div-zero");
});

test("execute raises ol-range for a right turn angle that overflows to Infinity, instead of emitting a NaN-corrupted turn event", () => {
  // `power 10 1000` overflows IEEE 754 double precision to `Infinity` — `Infinity % 360` is
  // `NaN`, a defect this guard prevents by halting instead of emitting a corrupted event
  // (spec/execution-model.md:517: "OpenLogo never exposes NaN or Infinity as learner-facing
  // results").
  const result = execute("right power 10 1000", "main.logo");
  assert.equal(result.events.length, 1);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-range");
  assert.deepEqual(result.diagnostics[0].params, {
    operation: "right",
    value: "Infinity",
  });
  // `params` is a diagnostic-identity payload and must survive a JSON round-trip
  // (spec/error-model.md:34) — a raw `Infinity` number would silently become `null`.
  assert.deepEqual(
    JSON.parse(JSON.stringify(result.diagnostics[0].params)),
    result.diagnostics[0].params,
  );
});

test("execute raises ol-range for a left turn angle that overflows to -Infinity", () => {
  const result = execute("left power 10 1000", "main.logo");
  assert.equal(result.events.length, 1);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-range");
  assert.deepEqual(result.diagnostics[0].params, {
    operation: "left",
    value: "Infinity",
  });
});

test("execute leaves an unsupported turn-angle argument un-evaluated, emitting no turn event", () => {
  // `:ages.tom` is a place/expression form this slice's parser does not yet fully support in
  // every position (mirrors the equivalent forward/back test) — left un-evaluated rather than
  // raising, matching print's precedent.
  const result = execute("right :ages.tom", "main.logo");
  assert.equal(result.events.length, 1);
  assert.deepEqual(result.diagnostics, []);
});
