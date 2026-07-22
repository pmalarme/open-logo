import assert from "node:assert/strict";
import { test } from "node:test";
import { reasonAboutArc } from "@openlogo/edu";

test("reasonAboutArc: a 90-degree arc from heading 0 ends at heading 270 (spec/geometry-module.md:249)", () => {
  const reasoning = reasonAboutArc(90, 50, 0);
  assert.deepEqual(reasoning, {
    concept: "arc-heading-position",
    angle: 90,
    radius: 50,
    startHeading: 0,
    finalHeading: 270,
  });
});

test("reasonAboutArc normalizes a negative resulting heading into [0, 360)", () => {
  const reasoning = reasonAboutArc(400, 20, 10);
  assert.equal(reasoning.finalHeading, (((10 - 400) % 360) + 360) % 360);
  assert.ok(reasoning.finalHeading >= 0 && reasoning.finalHeading < 360);
});

test("reasonAboutArc: a zero angle leaves the heading unchanged", () => {
  const reasoning = reasonAboutArc(0, 50, 45);
  assert.equal(reasoning.finalHeading, 45);
});

test("reasonAboutArc is deterministic: the same inputs always fold to a byte-identical result", () => {
  const first = reasonAboutArc(90, 50, 0);
  const second = reasonAboutArc(90, 50, 0);
  assert.deepEqual(first, second);
});
