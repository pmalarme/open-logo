// Unit tests for the Sprites turtle-identity reporters `new_turtle`/`who`/`turtles` and the
// `spawn-turtle` trace event, driven end to end through `execute()` (issue #673,
// `spec/turtles-and-sprites.md`'s "Turtle creation" + "Addressing model" sections; the event shape
// against `@openlogo/core`'s `SpawnTurtlePayload`, `spec/execution-model.md`'s trace registry).
//
// The identity invariants below are the whole point of the slice: because turtle `==` is keyed on
// the stable id (`@openlogo/core`'s `OLTurtle`), `who == first turtles` and `first turtles == first
// turtles` MUST report `true` even though each reporter builds a fresh `OLTurtle` wrapper. Under the
// discarded reference-identity design those would have been `false`; id-based identity makes them
// true by construction, provided ids are allocated uniquely, stably, and deterministically
// (pinned in turtle-world.test.mjs). The same invariants are locked end to end from `.logo` source
// by the conformance fixtures under tests/conformance/sprites/.
//
// Note the runtime evaluates a *bare* reporter statement as a no-op (as `xcor`/`pos` already are),
// so a turtle is only spawned when `new_turtle`'s value is actually used (assignment, `print`, an
// operand). `bare new_turtle spawns nothing` pins that.

import assert from "node:assert/strict";
import { test } from "node:test";
import { execute } from "@openlogo/runtime";

test("new_turtle emits a spawn-turtle event carrying the new turtle's id and full initial visible state", () => {
  const result = execute(":friend = new_turtle", "main.logo");
  assert.deepEqual(result.diagnostics, []);
  // seq 0 is the assignment's `instruction` event; seq 1 is the spawn.
  assert.equal(result.events.length, 2);
  assert.equal(result.events[0].kind, "instruction");
  assert.deepEqual(result.events[1], {
    seq: 1,
    kind: "spawn-turtle",
    source_span: result.events[1].source_span,
    turtle_id: 1,
    payload: {
      turtle_id: 1,
      position: [0, 0],
      heading: 0,
      pen: "down",
      color: "black",
      width: 1,
      visible: true,
      shape: "turtle",
    },
  });
});

test("the first spawned turtle gets id 1 (one past the reserved main turtle) and successive spawns increment deterministically", () => {
  const result = execute(
    ":a = new_turtle\n:b = new_turtle\n:c = new_turtle",
    "main.logo",
  );
  assert.deepEqual(result.diagnostics, []);
  const spawnIds = result.events
    .filter((event) => event.kind === "spawn-turtle")
    .map((event) => event.turtle_id);
  assert.deepEqual(spawnIds, [1, 2, 3]);
});

test("a bare new_turtle statement is evaluated for effect, and does spawn", () => {
  // Issue #815 changed this. A bare expression statement runs for effect and its value is
  // discarded (`spec/execution-model.md:214-227`'s block-result rule) — but no statement executor
  // claimed a reporter call, so it used to fall off the end of the dispatcher and do *nothing*,
  // the silent no-op this saga exists to remove. The terminal rule now evaluates it, which for a
  // reporter that spawns means the spawn happens.
  const result = execute("new_turtle", "main.logo");
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(
    result.events.map((event) => event.kind),
    ["instruction", "spawn-turtle"],
  );
});

test("who reports the main turtle and equals itself across repeated calls, before any new_turtle", () => {
  // Written directly: a zero-arg reporter is a valid left operand of `==`.
  const result = execute("print who == who", "main.logo");
  assert.deepEqual(result.diagnostics, []);
  const printEvent = result.events.find((event) => event.kind === "print");
  assert.deepEqual(printEvent.payload, { values: [true] });
});

test("who equals the first element of turtles (both are the main turtle)", () => {
  const result = execute("print who == first turtles", "main.logo");
  assert.deepEqual(result.diagnostics, []);
  const printEvent = result.events.find((event) => event.kind === "print");
  assert.deepEqual(printEvent.payload, { values: [true] });
});

test("turtles interns identity: the same slot compared across separate turtles calls is equal despite fresh wrappers", () => {
  const result = execute(
    ":a = first turtles\n:b = first turtles\nprint (:a == :b)",
    "main.logo",
  );
  assert.deepEqual(result.diagnostics, []);
  const printEvent = result.events.find((event) => event.kind === "print");
  assert.deepEqual(printEvent.payload, { values: [true] });
});

test("a turtle from new_turtle is the same turtle as the last element of turtles", () => {
  const result = execute(
    ":friend = new_turtle\nprint (:friend == last turtles)",
    "main.logo",
  );
  assert.deepEqual(result.diagnostics, []);
  const printEvent = result.events.find((event) => event.kind === "print");
  assert.deepEqual(printEvent.payload, { values: [true] });
});

test("turtles grows by one per new_turtle, main turtle always first, spawned turtles in creation order", () => {
  // `count` reports list length; comparing the newly created turtle against `last turtles` and the
  // main turtle (`who`) against `first turtles` together pin the ordering and membership.
  const result = execute(
    ":a = new_turtle\n:b = new_turtle\n:main = who\nprint count turtles\nprint (:main == first turtles)\nprint (:b == last turtles)",
    "main.logo",
  );
  assert.deepEqual(result.diagnostics, []);
  const printed = result.events
    .filter((event) => event.kind === "print")
    .map((event) => event.payload.values[0]);
  assert.deepEqual(printed, [3, true, true]);
});

test("who and new_turtle report distinct turtles (a spawned turtle is not the main turtle)", () => {
  const result = execute(
    ":friend = new_turtle\nprint (:friend == who)",
    "main.logo",
  );
  assert.deepEqual(result.diagnostics, []);
  const printEvent = result.events.find((event) => event.kind === "print");
  assert.deepEqual(printEvent.payload, { values: [false] });
});

test("is_a? reports true for a turtle obtained from new_turtle (C3 deferral: positive end-to-end predicate)", () => {
  const result = execute(
    ':friend = new_turtle\nprint (is_a? :friend "turtle")',
    "main.logo",
  );
  assert.deepEqual(result.diagnostics, []);
  const printEvent = result.events.find((event) => event.kind === "print");
  assert.deepEqual(printEvent.payload, { values: [true] });
});

test("each sprites reporter with an argument is an arity diagnostic, not a crash (covers every arity guard)", () => {
  // Issue #815: `execute()` now runs the semantic check first, and this arity fault is one the
  // checker decides statically — so the program is refused before Phase 2 and the runtime guard
  // below would never be reached. `runUnchecked` is the spec’s own opt-out
  // (`spec/execution-model.md:687-694`), and is what keeps the runtime guard exercised: it runs,
  // raises the identical fault, and `spec/execution-model.md:746-748` collapses the second report
  // into the first — which is why the surviving diagnostic reads `stage: "semantic"`.
  // Parenthesized calls so the extra argument reaches the runtime's arity check rather than being
  // rejected earlier; exercises the `requireExactArgs` guard in all of new_turtle/who/turtles.
  for (const source of [
    ":x = (new_turtle 1)",
    ":x = (who 1)",
    ":x = (turtles 1)",
  ]) {
    const result = execute(source, "main.logo", { runUnchecked: true });
    assert.equal(result.diagnostics.length >= 1, true, source);
    assert.equal(result.diagnostics[0].code, "ol-too-many-inputs", source);
  }
});
