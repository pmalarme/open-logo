import assert from "node:assert/strict";
import { test } from "node:test";
import { reasonAboutCircle } from "@openlogo/edu";

test("reasonAboutCircle: the default 36 segments has a 10-degree turn per segment and closes as an approximation", () => {
  const reasoning = reasonAboutCircle(50);
  assert.equal(reasoning.concept, "circle-inscribed-polygon-approximation");
  assert.equal(reasoning.radius, 50);
  assert.equal(reasoning.segments, 36);
  assert.equal(reasoning.exteriorTurnPerSegment, 10);
  assert.equal(reasoning.turnTotal, 360);
  assert.ok(reasoning.closes);
  assert.equal(reasoning.isApproximation, true);
});

test("reasonAboutCircle: sideLength matches the spec's 2 * radius * sin(180 / segments) formula", () => {
  const reasoning = reasonAboutCircle(50, 72);
  const expected = 2 * 50 * Math.sin((Math.PI * (180 / 72)) / 180);
  assert.ok(Math.abs(reasoning.sideLength - expected) < 1e-9);
  assert.equal(reasoning.segments, 72);
  assert.equal(reasoning.exteriorTurnPerSegment, 5);
});

test("reasonAboutCircle never claims to be an exact circle", () => {
  const reasoning = reasonAboutCircle(10, 3);
  assert.equal(reasoning.isApproximation, true);
});

test("reasonAboutCircle is deterministic: the same radius/segments always fold to a byte-identical result", () => {
  const first = reasonAboutCircle(50, 36);
  const second = reasonAboutCircle(50, 36);
  assert.deepEqual(first, second);
});
