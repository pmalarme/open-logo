import assert from "node:assert/strict";
import { test } from "node:test";
import { analyzeTurtlePathClosure } from "@openlogo/edu";
import * as Runtime from "@openlogo/runtime";

/** Runs `source` and returns the trace events `analyzeTurtlePathClosure` folds over. */
function eventsFrom(source) {
  return Runtime.execute(source, "main.logo").events;
}

test("analyzeTurtlePathClosure: a closing polygon path (repeat 5 [ forward 100 right 72 ]) reports closes true (both positional and heading) with no misconception", () => {
  const reasoning = analyzeTurtlePathClosure(
    eventsFrom("repeat 5\n  forward 100\n  right 72\nend repeat"),
  );
  assert.equal(reasoning.concept, "turtle-path-closure");
  assert.equal(reasoning.turnTotal, 360);
  assert.equal(reasoning.turnCount, 5);
  assert.deepEqual(reasoning.headingDeltas, [72, 72, 72, 72, 72]);
  assert.deepEqual(reasoning.startPosition, [0, 0]);
  assert.ok(reasoning.displacement < 1e-6);
  assert.equal(reasoning.startHeading, 0);
  assert.equal(reasoning.finalHeading, 0);
  assert.equal(reasoning.headingCloses, true);
  assert.equal(reasoning.positionCloses, true);
  assert.equal(reasoning.closes, true);
  assert.equal(reasoning.misconception, undefined);
});

test("analyzeTurtlePathClosure: a non-closing path (repeat 5 [ forward 100 right 80 ]) reports closes false with a non-closing-path misconception signal, not a thrown error", () => {
  const reasoning = analyzeTurtlePathClosure(
    eventsFrom("repeat 5\n  forward 100\n  right 80\nend repeat"),
  );
  assert.equal(reasoning.turnTotal, 400);
  assert.equal(reasoning.turnCount, 5);
  assert.deepEqual(reasoning.headingDeltas, [80, 80, 80, 80, 80]);
  assert.equal(reasoning.headingCloses, false);
  assert.equal(reasoning.closes, false);
  assert.deepEqual(reasoning.misconception, {
    id: "non-closing-path",
    turnTotal: 400,
    expectedMultipleOf: 360,
    displacement: reasoning.displacement,
  });
});

test("analyzeTurtlePathClosure: a bare `forward 100` (no turn) reports closes false — it displaces the turtle even though its heading never changes", () => {
  const reasoning = analyzeTurtlePathClosure(eventsFrom("forward 100"));
  assert.equal(reasoning.turnTotal, 0);
  assert.equal(reasoning.turnCount, 0);
  assert.deepEqual(reasoning.headingDeltas, []);
  assert.deepEqual(reasoning.startPosition, [0, 0]);
  assert.deepEqual(reasoning.finalPosition, [0, 100]);
  assert.equal(reasoning.displacement, 100);
  assert.equal(reasoning.startHeading, 0);
  assert.equal(reasoning.finalHeading, 0);
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

test("analyzeTurtlePathClosure: an empty event stream trivially closes at the origin", () => {
  const reasoning = analyzeTurtlePathClosure([]);
  assert.deepEqual(reasoning.startPosition, [0, 0]);
  assert.deepEqual(reasoning.finalPosition, [0, 0]);
  assert.equal(reasoning.displacement, 0);
  assert.equal(reasoning.startHeading, 0);
  assert.equal(reasoning.finalHeading, 0);
  assert.equal(reasoning.closes, true);
  assert.equal(reasoning.misconception, undefined);
});

test("analyzeTurtlePathClosure is deterministic: running the same program twice folds to a byte-identical result", () => {
  const source = "repeat 5\n  forward 100\n  right 72\nend repeat";
  const first = analyzeTurtlePathClosure(eventsFrom(source));
  const second = analyzeTurtlePathClosure(eventsFrom(source));
  assert.deepEqual(first, second);
});
