// Unit tests for the Sprites `tell` addressing command (issue #674, SP2), driven end to end through
// `execute()`. `tell <turtle|turtle-list>` sets the addressed set; subsequent turtle commands apply
// once per addressed turtle, each emitting events carrying that turtle's `turtle_id`. `tell` is a
// command (no block) that stays in effect until the next `tell`. A non-turtle argument (or a list
// containing one) raises `ol-type`. See spec/turtles-and-sprites.md's "Addressing model" and
// "Per-turtle state" sections; the same behavior is locked from source by the conformance fixtures
// under tests/conformance/sprites/tell-*.
//
// The `turtleStateFor` invariant test at the bottom covers the internal "every addressed id has a
// registered state" guarantee's throw path, which real source can never take (mirroring
// procedure-calls.test.mjs's `callProcedure` stub test).

import assert from "node:assert/strict";
import { test } from "node:test";
import { createEnvironment, execute, turtleStateFor } from "@openlogo/runtime";

const moves = (events) =>
  events
    .filter((event) => event.kind === "move")
    .map((event) => [event.turtle_id, event.payload.to]);

test("tell :friend then who reports the addressed turtle (who == :friend is true)", () => {
  const result = execute(
    ":friend = new_turtle\ntell :friend\nprint who == :friend",
    "main.logo",
  );
  assert.deepEqual(result.diagnostics, []);
  const printEvent = result.events.find((event) => event.kind === "print");
  assert.deepEqual(printEvent.payload, { values: [true] });
});

test("after tell, who read twice is equal (a re-wrapped addressed turtle still compares equal)", () => {
  const result = execute(
    ":friend = new_turtle\ntell :friend\nprint who == who",
    "main.logo",
  );
  assert.deepEqual(result.diagnostics, []);
  const printEvent = result.events.find((event) => event.kind === "print");
  assert.deepEqual(printEvent.payload, { values: [true] });
});

test("tell with a list of turtles applies a single command once per addressed turtle, each event stamped with its turtle_id", () => {
  const result = execute(
    ":a = new_turtle\n:b = new_turtle\ntell [ :a :b ]\nforward 50",
    "main.logo",
  );
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(moves(result.events), [
    [1, [0, 50]],
    [2, [0, 50]],
  ]);
  // Each move is followed by its own draw-segment carrying the same turtle_id.
  const drawIds = result.events
    .filter((event) => event.kind === "draw-segment")
    .map((event) => event.turtle_id);
  assert.deepEqual(drawIds, [1, 2]);
});

test("tell narrows the addressed set: a later tell replaces the previous one", () => {
  const result = execute(
    ":a = new_turtle\n:b = new_turtle\ntell [ :a :b ]\ntell :a\nforward 50",
    "main.logo",
  );
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(moves(result.events), [[1, [0, 50]]]);
});

test("before any tell, the main turtle's events carry no turtle_id (backward compatible)", () => {
  const result = execute("forward 50", "main.logo");
  assert.deepEqual(result.diagnostics, []);
  const move = result.events.find((event) => event.kind === "move");
  assert.equal(move.turtle_id, undefined);
});

test("addressed turtles keep independent per-turtle state: a turn on one does not rotate the other", () => {
  const result = execute(
    ":a = new_turtle\n:b = new_turtle\ntell :a\nright 90\ntell [ :a :b ]\nforward 50",
    "main.logo",
  );
  assert.deepEqual(result.diagnostics, []);
  // :a was turned to heading 90 (points +x), :b still heading 0 (points +y). Round the trig-derived
  // coordinates to absorb floating-point noise (sin/cos of 90°).
  const rounded = moves(result.events).map(([id, [x, y]]) => [
    id,
    [Math.round(x), Math.round(y)],
  ]);
  assert.deepEqual(rounded, [
    [1, [50, 0]],
    [2, [0, 50]],
  ]);
});

test("tell to an empty turtle list addresses no turtle: a following command emits nothing and the current turtle falls back to the main turtle", () => {
  const result = execute(
    ":before = who\ntell [ ]\nforward 50\nprint who == :before",
    "main.logo",
  );
  assert.deepEqual(result.diagnostics, []);
  assert.equal(
    result.events.some((event) => event.kind === "move"),
    false,
  );
  const printEvent = result.events.find((event) => event.kind === "print");
  assert.deepEqual(printEvent.payload, { values: [true] });
});

test("after addressing a non-main turtle, tell [ ] keeps who and the movement reporters consistent (both fall back to the main turtle)", () => {
  // Regression for the "current turtle" divergence: `who` reads the addressed set while the
  // movement reporters read the current-turtle pointer. On an empty addressed set both must agree,
  // so `who` reports the main turtle (id 0) AND `xcor`/`ycor` report the main turtle's coordinates.
  const result = execute(
    ":friend = new_turtle\ntell :friend\nforward 50\ntell [ ]\nprint who == first turtles\nprint xcor\nprint ycor",
    "main.logo",
  );
  assert.deepEqual(result.diagnostics, []);
  const prints = result.events
    .filter((event) => event.kind === "print")
    .map((event) => event.payload.values[0]);
  // `first turtles` is the main turtle (id 0); after `tell [ ]` `who` falls back to it.
  assert.equal(prints[0], true);
  // The main turtle never moved (only `:friend` did, before `tell [ ]`), so it is still at (0, 0).
  assert.equal(prints[1], 0);
  assert.equal(prints[2], 0);
});

test("a halting per-turtle command stops the loop at the offending turtle (no later turtle masks the diagnostic)", () => {
  // `set_width 0` is out of range (ol-range); with two turtles addressed it must halt on the first,
  // so exactly one diagnostic surfaces and the second turtle's width is never attempted.
  const result = execute(
    ":a = new_turtle\n:b = new_turtle\ntell [ :a :b ]\nset_width 0",
    "main.logo",
  );
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-range");
});

test("tell of a non-turtle raises ol-type naming the value's type and the tell operation", () => {
  const result = execute("tell 5", "main.logo");
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-type");
  assert.deepEqual(result.diagnostics[0].params, {
    expected: "turtle",
    actual: "number",
    value: 5,
    operation: "tell",
  });
});

test("tell of a list containing a non-turtle raises ol-type on the offending item, leaving the addressed set unchanged", () => {
  const result = execute(
    ":a = new_turtle\ntell :a\ntell [ :a 5 ]\nforward 50",
    "main.logo",
  );
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-type");
  assert.equal(result.diagnostics[0].params.actual, "number");
  // The failed `tell` never changed the addressed set, and execution halted before `forward`.
  assert.equal(
    result.events.some((event) => event.kind === "move"),
    false,
  );
});

test("a tell argument that references an undefined variable surfaces that diagnostic (not a tell type error)", () => {
  const result = execute("tell :missing", "main.logo");
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-undefined-var");
});

test("a tell argument that is not yet evaluable (a call to an unregistered name) is left un-evaluated, changing nothing", () => {
  // Mirrors the movement package's "unsupported forward argument" test: an argument that
  // `isSupportedExpression` reports unsupported (here a call to an unregistered builtin) defers the
  // whole statement — no addressing change, no diagnostic — exactly like every other command.
  const result = execute(
    ":a = new_turtle\ntell (nonexistent_builtin 1)\nforward 50",
    "main.logo",
  );
  assert.deepEqual(result.diagnostics, []);
  // The deferred `tell` never made addressing explicit, so the following `forward` runs on the
  // still-default (unstamped) main turtle.
  const move = result.events.find((event) => event.kind === "move");
  assert.equal(move.turtle_id, undefined);
});

test("a non-tell profile head (`each`) is not run by this slice: it falls through and emits no diagnostic", () => {
  // `each [ … ]` lowers to a ProfileStatement whose head is not `tell`; SP2 dispatches only `tell`,
  // so `dispatchProfileStatement` reports it not-a-profile-statement and execution falls through
  // exactly as before this slice (SP4/#676 will run `each`). No diagnostic, no turtle effect.
  const result = execute("each [ print 1 ]", "main.logo");
  assert.deepEqual(result.diagnostics, []);
  assert.equal(
    result.events.some((event) => event.kind === "print"),
    false,
  );
});

test("an event that already carries a turtle_id (a spawn-turtle from a new_turtle in argument position) is not overwritten by the acting turtle's id", () => {
  // Regression: `stampTurtleId` must stamp only events with no `turtle_id`. `forward` is addressed to
  // `:a` (id 1); its argument evaluates a procedure that spawns a new turtle (id 2), emitting a
  // `spawn-turtle` event whose own authoritative id is 2. Stamping the acting turtle's id (1) over it
  // would corrupt the new turtle's identity, so it must keep `turtle_id: 2` while the `move` the
  // command produces (which arrives unstamped) correctly gets the acting turtle's id (1).
  const result = execute(
    [
      "define spawn_and_report",
      "  :x = new_turtle",
      "  return 10",
      "end",
      ":a = new_turtle",
      "tell :a",
      "forward spawn_and_report",
    ].join("\n"),
    "main.logo",
  );
  assert.deepEqual(result.diagnostics, []);
  const spawnIds = result.events
    .filter((event) => event.kind === "spawn-turtle")
    .map((event) => [event.turtle_id, event.payload.turtle_id]);
  // Both spawns keep their own id in the envelope and payload — the arg spawn (id 2) is not
  // overwritten to the acting turtle's id (1).
  assert.deepEqual(spawnIds, [
    [1, 1],
    [2, 2],
  ]);
  const move = result.events.find((event) => event.kind === "move");
  assert.equal(move.turtle_id, 1);
});

test("a nested tell run during a command's argument evaluation keeps who and the movement reporters consistent", () => {
  // Regression for the current-turtle divergence: a procedure invoked while evaluating `forward`'s
  // argument runs `tell :b`, moving the current turtle for subsequent statements. The command still
  // applies to the addressed `:a` (which moves), but afterwards `who` reports `:b` AND the movement
  // reporters must describe `:b` too — the state pointer is re-derived from the single `currentId`,
  // so it can never be left describing `:a` while `who` says `:b`.
  const result = execute(
    [
      "define retarget",
      "  tell :b",
      "  return 10",
      "end",
      ":a = new_turtle",
      ":b = new_turtle",
      "tell :a",
      "forward retarget",
      "print who == :b",
      "print xcor",
      "print ycor",
    ].join("\n"),
    "main.logo",
  );
  assert.deepEqual(result.diagnostics, []);
  const moves = result.events
    .filter((event) => event.kind === "move")
    .map((event) => event.turtle_id);
  // The command applied to the addressed turtle `:a` (id 1).
  assert.deepEqual(moves, [1]);
  const prints = result.events
    .filter((event) => event.kind === "print")
    .map((event) => event.payload.values[0]);
  // After the nested `tell :b`, `who` reports `:b`, and the movement reporters describe `:b` too —
  // `:b` never moved, so it is still at (0, 0). The two agree; neither describes the moved `:a`.
  assert.equal(prints[0], true);
  assert.equal(prints[1], 0);
  assert.equal(prints[2], 0);
});

test("who inside a per-turtle command's argument reports the turtle currently running the command, then resets to the first addressed turtle", () => {
  // Regression: the per-turtle loop must point `who` at each addressed turtle in turn, so a reporter
  // evaluated in argument position (here `amount`, which prints `who`) sees the acting turtle — not
  // always the first. After the command, `who` resets to the first of the unchanged addressed set.
  const result = execute(
    [
      "define amount",
      "  print who",
      "  return 10",
      "end",
      ":a = new_turtle",
      ":b = new_turtle",
      "tell [ :a :b ]",
      "forward amount",
      "print who",
    ].join("\n"),
    "main.logo",
  );
  assert.deepEqual(result.diagnostics, []);
  const printed = result.events
    .filter((event) => event.kind === "print")
    .map((event) => [event.payload.values[0].id, event.turtle_id]);
  // The two in-argument `who` prints report the acting turtle (1 then 2), each event stamped to
  // match; the final top-level `who` reports the first addressed turtle again (1, unstamped).
  assert.deepEqual(printed, [
    [1, 1],
    [2, 2],
    [1, undefined],
  ]);
});

test("a nested tell run in an early iteration of a multi-turtle command persists as the new addressed set", () => {
  // Regression for a mid-loop nested `tell`: with `tell [ :a :b ]`, the first iteration (`:a`) runs
  // `tell :c`, replacing the addressed set. A later iteration must not clobber that: after the
  // command the addressed set — and the current turtle — is `:c`, not the last-iterated `:b`.
  const result = execute(
    [
      "define retarget",
      "  if who == :a [ tell :c ]",
      "  return 10",
      "end",
      ":a = new_turtle",
      ":b = new_turtle",
      ":c = new_turtle",
      "tell [ :a :b ]",
      "forward retarget",
      "print who == :c",
      "print who == :b",
    ].join("\n"),
    "main.logo",
  );
  assert.deepEqual(result.diagnostics, []);
  const prints = result.events
    .filter((event) => event.kind === "print")
    .map((event) => event.payload.values[0]);
  assert.equal(prints[0], true);
  assert.equal(prints[1], false);
});

test("turtleStateFor returns the registered state for a known id and throws for an unregistered one (internal invariant)", () => {
  const environment = createEnvironment();
  // The main turtle (id 0) is always registered and is the same object `environment.turtle` aliases.
  assert.equal(turtleStateFor(environment.addressing, 0), environment.turtle);
  // No turtle 99 was ever spawned, so requesting its state is an invariant violation, not a user
  // error — real source can never reach this because every addressed id is a spawned/main id.
  assert.throws(
    () => turtleStateFor(environment.addressing, 99),
    /no registered state for turtle id 99/,
  );
});
