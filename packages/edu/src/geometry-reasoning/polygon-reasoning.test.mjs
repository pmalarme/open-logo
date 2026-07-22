import assert from "node:assert/strict";
import { test } from "node:test";
import { reasonAboutPolygon } from "@openlogo/edu";

test("reasonAboutPolygon: a pentagon has a 72-degree exterior angle, a 360-degree turn total, and closes", () => {
  const reasoning = reasonAboutPolygon(5);
  assert.deepEqual(reasoning, {
    concept: "polygon-exterior-angle",
    sides: 5,
    exteriorAngle: 72,
    interiorAngle: 108,
    turnTotal: 360,
    closes: true,
  });
});

test("reasonAboutPolygon: exteriorAngle is always 360 / sides and interiorAngle is 180 - exteriorAngle", () => {
  for (const sides of [3, 4, 6, 8, 12]) {
    const reasoning = reasonAboutPolygon(sides);
    assert.equal(reasoning.exteriorAngle, 360 / sides);
    assert.equal(reasoning.interiorAngle, 180 - 360 / sides);
    assert.equal(reasoning.turnTotal, sides * (360 / sides));
    assert.ok(reasoning.closes);
  }
});

test("reasonAboutPolygon is deterministic: the same sides always fold to a byte-identical result", () => {
  const first = reasonAboutPolygon(7);
  const second = reasonAboutPolygon(7);
  assert.deepEqual(first, second);
});
