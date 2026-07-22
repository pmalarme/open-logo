import assert from "node:assert/strict";
import { test } from "node:test";
import { analyzeTurtlePathClosure } from "@openlogo/edu";
import * as Runtime from "@openlogo/runtime";

/** Runs `source` and returns the trace events `analyzeTurtlePathClosure` folds over. */
function eventsFrom(source) {
  return Runtime.execute(source, "main.logo").events;
}

test("analyzeTurtlePathClosure: a closing polygon path (repeat 5 [ forward 100 right 72 ]) reports closes true with no misconception", () => {
  const reasoning = analyzeTurtlePathClosure(
    eventsFrom("repeat 5\n  forward 100\n  right 72\nend repeat"),
  );
  assert.equal(reasoning.concept, "turtle-path-closure");
  assert.equal(reasoning.turnTotal, 360);
  assert.equal(reasoning.turnCount, 5);
  assert.equal(reasoning.closes, true);
  assert.equal(reasoning.misconception, undefined);
});

test("analyzeTurtlePathClosure: a non-closing path (repeat 5 [ forward 100 right 80 ]) reports closes false with a non-closing-path misconception signal, not a thrown error", () => {
  const reasoning = analyzeTurtlePathClosure(
    eventsFrom("repeat 5\n  forward 100\n  right 80\nend repeat"),
  );
  assert.equal(reasoning.turnTotal, 400);
  assert.equal(reasoning.turnCount, 5);
  assert.equal(reasoning.closes, false);
  assert.deepEqual(reasoning.misconception, {
    id: "non-closing-path",
    turnTotal: 400,
    expectedMultipleOf: 360,
  });
});

test("analyzeTurtlePathClosure: a path with no turn events trivially closes at turnTotal 0", () => {
  const reasoning = analyzeTurtlePathClosure(eventsFrom("forward 100"));
  assert.equal(reasoning.turnTotal, 0);
  assert.equal(reasoning.turnCount, 0);
  assert.equal(reasoning.closes, true);
  assert.equal(reasoning.misconception, undefined);
});

test("analyzeTurtlePathClosure is deterministic: running the same program twice folds to a byte-identical result", () => {
  const source = "repeat 5\n  forward 100\n  right 72\nend repeat";
  const first = analyzeTurtlePathClosure(eventsFrom(source));
  const second = analyzeTurtlePathClosure(eventsFrom(source));
  assert.deepEqual(first, second);
});
