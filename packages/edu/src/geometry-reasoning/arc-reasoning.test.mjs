import assert from "node:assert/strict";
import { test } from "node:test";
import { reasonAboutArc } from "@openlogo/edu";

test("reasonAboutArc: a 90-degree arc from [0, 0] heading 0 ends at heading 270, center [-50, 0], final position [-50, 50] (spec/geometry-module.md:243-254)", () => {
  const reasoning = reasonAboutArc(90, 50, [0, 0], 0);
  assert.equal(reasoning.concept, "arc-heading-position");
  assert.equal(reasoning.angle, 90);
  assert.equal(reasoning.radius, 50);
  assert.deepEqual(reasoning.startPosition, [0, 0]);
  assert.equal(reasoning.startHeading, 0);
  assert.ok(Math.abs(reasoning.center[0] - -50) < 1e-9);
  assert.ok(Math.abs(reasoning.center[1] - 0) < 1e-9);
  assert.ok(Math.abs(reasoning.finalPosition[0] - -50) < 1e-9);
  assert.ok(Math.abs(reasoning.finalPosition[1] - 50) < 1e-9);
  assert.equal(reasoning.finalHeading, 270);
});

test("reasonAboutArc normalizes a negative resulting heading into [0, 360)", () => {
  const reasoning = reasonAboutArc(400, 20, [0, 0], 10);
  assert.equal(reasoning.finalHeading, (((10 - 400) % 360) + 360) % 360);
  assert.ok(reasoning.finalHeading >= 0 && reasoning.finalHeading < 360);
});

test("reasonAboutArc: a zero angle leaves the heading unchanged and the final position equal to the start position", () => {
  const reasoning = reasonAboutArc(0, 50, [10, 20], 45);
  assert.equal(reasoning.finalHeading, 45);
  assert.ok(Math.abs(reasoning.finalPosition[0] - 10) < 1e-9);
  assert.ok(Math.abs(reasoning.finalPosition[1] - 20) < 1e-9);
});

test("reasonAboutArc: the center sits exactly `radius` units to the turtle's left of a non-origin start position", () => {
  const reasoning = reasonAboutArc(90, 25, [100, 100], 90);
  // Heading 90 (facing right); "left" of that is straight up (+y).
  assert.ok(Math.abs(reasoning.center[0] - 100) < 1e-9);
  assert.ok(Math.abs(reasoning.center[1] - 125) < 1e-9);
});

test("reasonAboutArc is deterministic: the same inputs always fold to a byte-identical result", () => {
  const first = reasonAboutArc(90, 50, [0, 0], 0);
  const second = reasonAboutArc(90, 50, [0, 0], 0);
  assert.deepEqual(first, second);
});
