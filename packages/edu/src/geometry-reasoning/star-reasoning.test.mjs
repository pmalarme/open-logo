import assert from "node:assert/strict";
import { test } from "node:test";
import { reasonAboutStar } from "@openlogo/edu";

test("reasonAboutStar: a default pentagram has a 144-degree exterior turn, a 720-degree turn total, and closes", () => {
  const reasoning = reasonAboutStar(5);
  assert.deepEqual(reasoning, {
    concept: "star-skip-turn",
    points: 5,
    step: 2,
    exteriorTurn: 144,
    turnTotal: 720,
    closes: true,
  });
});

test("reasonAboutStar: an explicit step is honored and exteriorTurn is 360 * step / points", () => {
  const reasoning = reasonAboutStar(7, 3);
  assert.equal(reasoning.step, 3);
  assert.equal(reasoning.exteriorTurn, (360 * 3) / 7);
  assert.equal(reasoning.turnTotal, 7 * ((360 * 3) / 7));
  assert.ok(reasoning.closes);
});

test("reasonAboutStar's turnTotal formula is distinct from a polygon's: it is 360 * step, not always 360", () => {
  const reasoning = reasonAboutStar(5, 2);
  assert.equal(reasoning.turnTotal, 360 * 2);
  assert.notEqual(reasoning.turnTotal, 360);
});

test("reasonAboutStar is deterministic: the same points/step always fold to a byte-identical result", () => {
  const first = reasonAboutStar(5, 2);
  const second = reasonAboutStar(5, 2);
  assert.deepEqual(first, second);
});
