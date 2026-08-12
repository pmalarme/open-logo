// Unit tests for the Sprites **addressing trace events** (issue #766), driven end to end through
// `execute()`. `spec/rendering.md:191` is normative — "Implementations with multiple turtles MUST
// identify the active turtle or addressed turtle set" — but before this slice a consumer of the
// trace stream could not: `tell`/`ask`/`each` changed the addressed set silently, and the only
// turtle identity in the stream was the *acting* turtle's `turtle_id` on each per-turtle effect,
// which after an `ask`/`each` block restores (spec/turtles-and-sprites.md:58) is neither the active
// turtle nor the addressed set.
//
// So every change of the addressed set now emits a `primitive` event (the registered generic
// catch-all for a primitive without a more specific kind, spec/execution-model.md:703 — no new event
// kind, see packages/runtime/src/addressing.ts) carrying an absolute snapshot:
// `{ addressed_turtle_ids, current_turtle_id }`. `foldAddressing` below is the whole consumer
// algorithm — assign, never infer — and these tests assert what a renderer or the studio's
// non-visual state region would report at the end of the run, including after every abnormal exit.
//
// The same behavior is locked from source by the conformance fixtures under
// tests/conformance/sprites/addressing-*.

import assert from "node:assert/strict";
import { test } from "node:test";
import { execute } from "@openlogo/runtime";

/** Every addressing event's `[name, addressed_turtle_ids, current_turtle_id]`, in stream order. */
const addressingEvents = (events) =>
  events
    .filter(
      (event) =>
        event.kind === "primitive" && event.payload.addressing !== undefined,
    )
    .map((event) => [
      event.payload.name,
      event.payload.addressing.addressed_turtle_ids,
      event.payload.addressing.current_turtle_id,
    ]);

/**
 * Fold the stream exactly as a consumer would: the last addressing snapshot wins, because the
 * payload is absolute rather than a delta. Returns `null` when the stream carries no addressing
 * event at all (a Core/Turtle & Rendering program), which is itself an assertion this suite makes.
 */
const foldAddressing = (events) => {
  let folded = null;
  for (const event of events) {
    if (event.kind === "primitive" && event.payload.addressing !== undefined) {
      folded = event.payload.addressing;
    }
  }
  return folded;
};

const moves = (events) =>
  events
    .filter((event) => event.kind === "move")
    .map((event) => [event.turtle_id, event.payload.to]);

test("tell publishes the whole addressed set and the current turtle", () => {
  const result = execute(
    ":a = new_turtle\n:b = new_turtle\ntell [ :a :b ]",
    "main.logo",
  );
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(addressingEvents(result.events), [["tell", [1, 2], 1]]);
});

test("an addressing event is never stamped with an envelope turtle_id (it describes a set)", () => {
  // spec/execution-model.md:638 — `turtle-id` is "present only when the event is turtle-specific".
  // An addressing event concerns the whole addressed set, so stamping it with one turtle's id would
  // make a spec-violating envelope binding on every implementation that reads this corpus.
  const result = execute(
    ":a = new_turtle\n:b = new_turtle\ntell [ :a :b ]\neach [ ask :a [ forward 1 ] ]",
    "main.logo",
  );
  assert.deepEqual(result.diagnostics, []);
  const stamped = result.events.filter(
    (event) =>
      event.kind === "primitive" &&
      event.payload.addressing !== undefined &&
      event.turtle_id !== undefined,
  );
  assert.deepEqual(stamped, []);
});

test("issue #766 acceptance: after an ask block, the fold reports the restored set and current turtle", () => {
  // The issue's first acceptance criterion, verbatim: `tell [ :a :b ]` / `forward 10` /
  // `ask :b [ hide_turtle ]`. When the stream is fully folded, the consumer reports the addressed
  // set as { :a, :b } and the current turtle as :a — matching the runtime after `ask` restores.
  // `lastActedTurtleId` (all @openlogo/turtle could derive before this slice) would say :b here.
  const result = execute(
    ":a = new_turtle\n:b = new_turtle\ntell [ :a :b ]\nforward 10\nask :b [ hide_turtle ]",
    "main.logo",
  );
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(foldAddressing(result.events), {
    addressed_turtle_ids: [1, 2],
    current_turtle_id: 1,
  });
  // The last per-turtle effect in the stream still belongs to :b — which is exactly why the
  // addressed set had to become observable in its own right.
  const lastTurtleStamped = result.events
    .filter((event) => event.turtle_id !== undefined)
    .at(-1);
  assert.equal(lastTurtleStamped.turtle_id, 2);
});

test("ask brackets its block with an entry snapshot and a restore snapshot", () => {
  const result = execute(
    ":a = new_turtle\n:b = new_turtle\ntell :a\nask :b [ forward 10 ]\nforward 30",
    "main.logo",
  );
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(addressingEvents(result.events), [
    ["tell", [1], 1],
    ["ask", [2], 2],
    ["ask", [1], 1],
  ]);
});

test("a nested ask unwinds exactly one level", () => {
  const result = execute(
    ":a = new_turtle\n:b = new_turtle\ntell :a\nask :b [ ask :a [ forward 1 ] forward 2 ]",
    "main.logo",
  );
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(addressingEvents(result.events), [
    ["tell", [1], 1],
    ["ask", [2], 2],
    ["ask", [1], 1],
    ["ask", [2], 2],
    ["ask", [1], 1],
  ]);
});

test("each narrows to one turtle per iteration and restores the set it iterated", () => {
  const result = execute(
    ":a = new_turtle\n:b = new_turtle\ntell [ :a :b ]\neach [ forward 10 ]",
    "main.logo",
  );
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(addressingEvents(result.events), [
    ["tell", [1, 2], 1],
    ["each", [1], 1],
    ["each", [2], 2],
    ["each", [1, 2], 1],
  ]);
});

test("each over an empty addressed set narrows zero times but still publishes the restore", () => {
  // Zero iterations means zero narrowings; the `finally` still runs, so the stream ends on the
  // (unchanged) empty set rather than going silent about it.
  const result = execute(
    ":a = new_turtle\ntell [ ]\neach [ forward 99 ]",
    "main.logo",
  );
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(addressingEvents(result.events), [
    ["tell", [], 0],
    ["each", [], 0],
  ]);
  assert.deepEqual(moves(result.events), []);
});

test("a stop unwinding each still publishes the restored set", () => {
  const result = execute(
    "define once\n  each [ forward 10 stop ]\nend\n:a = new_turtle\n:b = new_turtle\ntell [ :a :b ]\nonce\nforward 30",
    "main.logo",
  );
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(addressingEvents(result.events), [
    ["tell", [1, 2], 1],
    ["each", [1], 1],
    ["each", [1, 2], 1],
  ]);
  assert.deepEqual(foldAddressing(result.events), {
    addressed_turtle_ids: [1, 2],
    current_turtle_id: 1,
  });
});

test("a return unwinding ask still publishes the restored set", () => {
  const result = execute(
    "define first_x\n  ask :b [ forward 10 return xcor ]\nend\n:a = new_turtle\n:b = new_turtle\ntell :a\nprint first_x",
    "main.logo",
  );
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(addressingEvents(result.events), [
    ["tell", [1], 1],
    ["ask", [2], 2],
    ["ask", [1], 1],
  ]);
});

test("a throw unwinding each still publishes the restored set before the run halts", () => {
  const result = execute(
    ':a = new_turtle\n:b = new_turtle\ntell [ :a :b ]\neach [ forward 10 throw "stop now" ]\nforward 30',
    "main.logo",
  );
  assert.ok(result.diagnostics.some((d) => d.code === "ol-user-error"));
  assert.deepEqual(addressingEvents(result.events), [
    ["tell", [1, 2], 1],
    ["each", [1], 1],
    ["each", [1, 2], 1],
  ]);
});

test("a runtime error inside ask still publishes the restored set before the run halts", () => {
  const result = execute(
    ':a = new_turtle\n:b = new_turtle\ntell :a\nask :b [ forward "x" ]',
    "main.logo",
  );
  assert.ok(result.diagnostics.some((d) => d.code === "ol-type"));
  assert.deepEqual(addressingEvents(result.events), [
    ["tell", [1], 1],
    ["ask", [2], 2],
    ["ask", [1], 1],
  ]);
});

test("a tell whose argument is not a turtle changes nothing and publishes nothing", () => {
  // `turtleIdsFor` fails before the set is pointed, so the addressed set is unchanged — and an
  // event claiming otherwise would be a lie about state the runtime never entered.
  const result = execute(':a = new_turtle\ntell "not a turtle"', "main.logo");
  assert.ok(result.diagnostics.some((d) => d.code === "ol-type"));
  assert.deepEqual(addressingEvents(result.events), []);
});

test("an ask whose argument is not a turtle never enters its scope, so it publishes nothing", () => {
  const result = execute(
    ":a = new_turtle\ntell :a\nask 42 [ forward 10 ]",
    "main.logo",
  );
  assert.ok(result.diagnostics.some((d) => d.code === "ol-type"));
  assert.deepEqual(addressingEvents(result.events), [["tell", [1], 1]]);
});

test("a Core/Turtle & Rendering program emits no addressing event at all", () => {
  // The byte-identical guarantee: a program with no Sprites addressing cannot reach `tell`/`ask`/
  // `each`, so nothing in its stream changes — every pre-existing Turtle & Rendering fixture still
  // matches unmodified.
  const result = execute(
    "forward 100\nright 90\nforward 50\nhide_turtle",
    "main.logo",
  );
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(addressingEvents(result.events), []);
  assert.equal(foldAddressing(result.events), null);
});

test("each addressing event reports its own set: a later tell does not rewrite an earlier event", () => {
  // spec/execution-model.md:652-661 — an effect payload is a point-in-time snapshot, not a live
  // reference. Re-addressing must leave the first event reporting the set it was emitted for. (The
  // payload's defensive copy of the ids is not *distinguishable* here, because the runtime replaces
  // the ids array rather than mutating it in place; the copy keeps the payload sealed if that ever
  // changes, and this test pins the observable half — each event reports its own set.)
  const result = execute(
    ":a = new_turtle\n:b = new_turtle\ntell [ :a :b ]\ntell :b",
    "main.logo",
  );
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(addressingEvents(result.events), [
    ["tell", [1, 2], 1],
    ["tell", [2], 2],
  ]);
});

test("each inside ask narrows within the ask scope and both levels restore in order", () => {
  const result = execute(
    ":a = new_turtle\n:b = new_turtle\nask [ :a :b ] [ each [ forward 5 ] ]",
    "main.logo",
  );
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(addressingEvents(result.events), [
    ["ask", [1, 2], 1],
    ["each", [1], 1],
    ["each", [2], 2],
    ["each", [1, 2], 1],
    // The `ask` at top level restores the implicit default-turtle set it found.
    ["ask", [0], 0],
  ]);
});
