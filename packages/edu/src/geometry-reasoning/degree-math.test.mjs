import assert from "node:assert/strict";
import { test } from "node:test";
import {
  clockwiseTurnDelta,
  degreesToRadians,
  isMultipleOf360,
  normalizeDegrees,
  sumClockwiseTurns,
} from "@openlogo/edu";

test("normalizeDegrees leaves an in-range value unchanged", () => {
  assert.equal(normalizeDegrees(72), 72);
  assert.equal(normalizeDegrees(0), 0);
});

test("normalizeDegrees wraps a value at or above 360 down into [0, 360)", () => {
  assert.equal(normalizeDegrees(360), 0);
  assert.equal(normalizeDegrees(432), 72);
  assert.equal(normalizeDegrees(720), 0);
});

test("normalizeDegrees wraps a negative value up into [0, 360)", () => {
  assert.equal(normalizeDegrees(-72), 288);
  assert.equal(normalizeDegrees(-360), 0);
});

test("degreesToRadians converts common angles", () => {
  assert.ok(Math.abs(degreesToRadians(180) - Math.PI) < 1e-12);
  assert.equal(degreesToRadians(0), 0);
  assert.ok(Math.abs(degreesToRadians(90) - Math.PI / 2) < 1e-12);
});

test("isMultipleOf360 is true for exact multiples, including zero", () => {
  assert.ok(isMultipleOf360(0));
  assert.ok(isMultipleOf360(360));
  assert.ok(isMultipleOf360(720));
});

test("isMultipleOf360 tolerates tiny floating-point rounding near a multiple of 360", () => {
  assert.ok(isMultipleOf360(360 + 1e-10));
  assert.ok(isMultipleOf360(360 - 1e-10));
});

test("isMultipleOf360 is false for a turn total that is clearly not a multiple of 360", () => {
  assert.equal(isMultipleOf360(400), false);
  assert.equal(isMultipleOf360(80), false);
});

test("clockwiseTurnDelta reconstructs an ordinary in-range right turn", () => {
  assert.equal(clockwiseTurnDelta(0, 72), 72);
  assert.equal(clockwiseTurnDelta(288, 0), 72);
});

test("sumClockwiseTurns folds only turn events, ignoring every other kind", () => {
  const events = [
    { seq: 0, kind: "move", source_span: {}, payload: {} },
    { seq: 1, kind: "turn", source_span: {}, payload: { from: 0, to: 72 } },
    { seq: 2, kind: "turn", source_span: {}, payload: { from: 72, to: 144 } },
    { seq: 3, kind: "print", source_span: {}, payload: { values: [] } },
  ];
  assert.equal(sumClockwiseTurns(events), 144);
});

test("sumClockwiseTurns returns 0 for an empty event stream", () => {
  assert.equal(sumClockwiseTurns([]), 0);
});
