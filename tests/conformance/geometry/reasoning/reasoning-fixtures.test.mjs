// Stack-neutral reasoning fixtures for issue #408 (M4 audit remediation F6): each `.logo` fixture
// here is run through a real `@openlogo/runtime` `execute()`, and the resulting trace events are
// fed into `@openlogo/edu`'s geometric-reasoning primitives — proving the reasoning contract
// (position/heading closure, arc center/final-position, per-step heading-delta sequence) against
// an actual execution rather than only against its own formulas, the same spirit as
// `../../../../packages/edu/src/geometry-reasoning/runtime-validation.test.mjs`.
//
// This reads only the `move`/`turn` trace events already defined by `spec/execution-model.md`
// (no new event kind, no `@openlogo/core` registry change — hard constraint of #408).

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as Runtime from "@openlogo/runtime";
import { analyzeTurtlePathClosure, reasonAboutArc } from "@openlogo/edu";

const FIXTURES_DIR = join("tests", "conformance", "geometry", "reasoning");

/** Executes the named `.logo` fixture and returns its trace events (asserting a clean run). */
function eventsFromFixture(fixtureName) {
  const source = readFileSync(
    join(FIXTURES_DIR, `${fixtureName}.logo`),
    "utf8",
  );
  const { events, diagnostics } = Runtime.execute(
    source,
    `geometry/reasoning/${fixtureName}`,
  );
  assert.deepEqual(diagnostics, []);
  return events;
}

test("closing-pentagon: a regular pentagon path closes both positionally and by heading", () => {
  const reasoning = analyzeTurtlePathClosure(
    eventsFromFixture("closing-pentagon"),
  );
  assert.equal(reasoning.turnCount, 5);
  assert.deepEqual(reasoning.headingDeltas, [72, 72, 72, 72, 72]);
  assert.ok(reasoning.displacement < 1e-6);
  assert.equal(reasoning.headingCloses, true);
  assert.equal(reasoning.positionCloses, true);
  assert.equal(reasoning.closes, true);
  assert.equal(reasoning.misconception, undefined);
});

test("non-closing-forward: a bare `forward 100` reports closes false as a structured signal, not a thrown error", () => {
  const reasoning = analyzeTurtlePathClosure(
    eventsFromFixture("non-closing-forward"),
  );
  assert.equal(reasoning.turnCount, 0);
  assert.deepEqual(reasoning.headingDeltas, []);
  assert.equal(reasoning.displacement, 100);
  assert.equal(reasoning.headingCloses, true);
  assert.equal(reasoning.positionCloses, false);
  assert.equal(reasoning.closes, false);
  assert.deepEqual(reasoning.misconception, {
    id: "non-closing-path",
    turnTotal: 0,
    expectedMultipleOf: 360,
    displacement: 100,
  });
});

test("non-closing-pentagon: repeat 5 [ forward 100 right 80 ] exposes an ordered per-step heading-delta sequence and fails to close by heading", () => {
  const reasoning = analyzeTurtlePathClosure(
    eventsFromFixture("non-closing-pentagon"),
  );
  assert.deepEqual(reasoning.headingDeltas, [80, 80, 80, 80, 80]);
  assert.equal(reasoning.turnTotal, 400);
  assert.equal(reasoning.headingCloses, false);
  assert.equal(reasoning.closes, false);
  assert.ok(reasoning.misconception !== undefined);
  assert.equal(reasoning.misconception.turnTotal, 400);
});

test("arc-quarter-turn: reasonAboutArc's center/finalPosition/finalHeading match a real `arc 90 50` execution from [0, 0] heading 0", () => {
  const events = eventsFromFixture("arc-quarter-turn");
  const moveEvents = events.filter((event) => event.kind === "move");
  const actualFinalPosition = moveEvents[moveEvents.length - 1].payload.to;
  const printedValues = events
    .filter((event) => event.kind === "print")
    .map((event) => event.payload.values[0]);
  const [actualX, actualY, actualHeading] = printedValues;

  const reasoning = reasonAboutArc(90, 50, [0, 0], 0);

  assert.deepEqual(reasoning.startPosition, [0, 0]);
  assert.equal(reasoning.startHeading, 0);
  // Center: `radius` units to the turtle's left of the start (spec/geometry-module.md:243-247).
  assert.ok(Math.abs(reasoning.center[0] - -50) < 1e-6);
  assert.ok(Math.abs(reasoning.center[1] - 0) < 1e-6);
  // Final position/heading match the actual stepped-chord execution within numeric tolerance
  // (spec/geometry-module.md:256: "MUST preserve the direction, center, final position, and
  // final heading within documented numeric tolerance").
  assert.ok(
    Math.abs(reasoning.finalPosition[0] - actualFinalPosition[0]) < 1e-6,
  );
  assert.ok(
    Math.abs(reasoning.finalPosition[1] - actualFinalPosition[1]) < 1e-6,
  );
  assert.ok(Math.abs(reasoning.finalPosition[0] - actualX) < 1e-6);
  assert.ok(Math.abs(reasoning.finalPosition[1] - actualY) < 1e-6);
  assert.ok(Math.abs(reasoning.finalHeading - actualHeading) < 1e-6);
  assert.equal(reasoning.finalHeading, 270);
});

test("reasoning fixtures are deterministic: running the same fixture twice folds to a byte-identical result", () => {
  const events = eventsFromFixture("closing-pentagon");
  const first = analyzeTurtlePathClosure(events);
  const second = analyzeTurtlePathClosure(events);
  assert.deepEqual(first, second);
});
