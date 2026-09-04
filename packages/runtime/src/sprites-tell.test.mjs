// Unit tests for the Sprites `tell` addressing command (issue #674, SP2), driven end to end through
// `execute()`. `tell <turtle|turtle-list>` sets the addressed set; subsequent turtle commands apply
// once per addressed turtle, each emitting events carrying that turtle's `turtle_id`. A turtle
// listed twice is one member of the set, so the command still applies once (issue #748). `tell` is a
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
import {
  createEnvironment,
  currentTurtleState,
  execute,
  turtleStateFor,
} from "@openlogo/runtime";

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
  // Issue #815: the unresolvable callee is now REPORTED, not silently skipped. The check before
  // execution refuses the program (`spec/execution-model.md:659-664`), so the effect below never
  // happens — but for a reason the learner is told, which is the whole point of the slice.
  assert.deepEqual(
    result.diagnostics.map((diagnostic) => diagnostic.code),
    ["ol-unknown-command"],
  );
  // The deferred `tell` never made addressing explicit, so the following `forward` runs on the
  // still-default (unstamped) main turtle.
  const move = result.events.find((event) => event.kind === "move");
  assert.equal(move.turtle_id, undefined);
});

test("`each` is now run by SP4 (#676): at top level it runs its block once for the default turtle", () => {
  // Updated for SP4 (#676): `each [ … ]` lowers to a ProfileStatement whose head is `each`, which
  // `dispatchProfileStatement` now runs (it fell through as not-a-profile-statement under SP2). At top
  // level with only the default turtle addressed it runs the block once, so `print 1` emits one print.
  const result = execute("each [ print 1 ]", "main.logo");
  assert.deepEqual(result.diagnostics, []);
  const prints = result.events.filter((event) => event.kind === "print");
  assert.deepEqual(
    prints.map((event) => event.payload.values),
    [[1]],
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
  // applies to the addressed `:a` (which moves) — the acting turtle is fixed when the statement
  // begins, so the argument cannot re-aim the command it belongs to — but afterwards `who` reports
  // `:b` AND the movement reporters must describe `:b` too, because both read the single
  // `addressing.currentId`. Neither can be left describing `:a` while the other says `:b`.
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
  // The two in-argument `who` prints report the acting turtle (1 then 2); the final top-level `who`
  // reports the first addressed turtle again (1). None of the three `print` events carries a
  // `turtle_id`: `print` is not turtle-specific, so its envelope must not claim an identity
  // (`spec/execution-model.md:789`, issue #764) — before that filter landed these events tracked
  // *addressing context* rather than turtle-specificity, and the same program without the `tell`
  // emitted them unstamped.
  assert.deepEqual(printed, [
    [1, undefined],
    [2, undefined],
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

// --- #782: a `tell` inside a procedure ------------------------------------------------------
//
// `spec/turtles-and-sprites.md:46` makes `tell` a plain command that "changes the current addressed
// set for subsequent turtle commands", with no scoping language attached to it. `ask` is the form
// the spec explicitly scopes — `:58`, "The previous addressed set is restored after the block
// finishes" — and `each` (`:78`) narrows to one turtle per iteration within the current `tell`/`ask`
// set. A procedure body is neither, so a callee's `tell` PERSISTS after the
// call returns and the caller's reporters must observe it. The bug these tests pin: the current
// turtle's state used to be cached per `Environment`, and `runProcedure` shallow-copies that object,
// so a callee's `tell` updated the shared addressed-set pointer `who` reads while leaving the
// caller's copy of the cache — read by `xcor`/`ycor`/`heading`/`pos` — aimed at the previous turtle.

test("#782: a tell inside a procedure persists after the call — who and ycor describe the callee's turtle", () => {
  const result = execute(
    [
      ":a = new_turtle",
      ":b = new_turtle",
      "tell :a",
      "forward 10",
      "tell :b",
      "forward 20",
      "tell :a",
      "define go",
      "  tell :b",
      "end",
      "go",
      "print who",
      "print ycor",
    ].join("\n"),
    "main.logo",
  );
  assert.deepEqual(result.diagnostics, []);
  const prints = result.events
    .filter((event) => event.kind === "print")
    .map((event) => event.payload.values[0]);
  // :b is turtle 2 and stands at y 20; :a is turtle 1 at y 10. The reported pair must be a state
  // ONE turtle really has — the defect printed turtle #2 with :a's y of 10, which no turtle had.
  assert.equal(prints[0].id, 2);
  assert.equal(prints[1], 20);
});

test("#782: a tell two call frames deep persists too — nesting does not re-scope it", () => {
  const result = execute(
    [
      ":a = new_turtle",
      ":b = new_turtle",
      "tell :b",
      "forward 20",
      "tell :a",
      "forward 10",
      "define inner",
      "  tell :b",
      "end",
      "define outer",
      "  inner",
      "end",
      "outer",
      "print who",
      "print ycor",
    ].join("\n"),
    "main.logo",
  );
  assert.deepEqual(result.diagnostics, []);
  const prints = result.events
    .filter((event) => event.kind === "print")
    .map((event) => event.payload.values[0]);
  assert.equal(prints[0].id, 2);
  assert.equal(prints[1], 20);
});

test("#782: the who/position agreement invariant holds after a callee's tell, with no hard-coded coordinate", () => {
  // States the invariant itself rather than one instance of it. `:reported` is what the caller's own
  // `ycor` says; `:current` is the turtle `who` names; `:actual` is that turtle's real y, read by
  // addressing it. Only one current turtle exists (`spec/turtles-and-sprites.md:26,105`), so the two
  // MUST be equal — the pair `who`/`ycor` produce has to be a state some single turtle really has.
  //
  // Both reads happen BEFORE the `ask`: re-establishing the addressed set is precisely what used to
  // paper over the divergence (the defect self-healed on the next addressing form or turtle command),
  // so an invariant written as `ask who [ ... ]` would have passed on the broken runtime. Reading
  // `ycor` and `who` first is what makes this test able to fail.
  const result = execute(
    [
      ":a = new_turtle",
      ":b = new_turtle",
      "tell :a",
      "forward 10",
      "tell :b",
      "forward 20",
      "tell :a",
      "define go",
      "  tell :b",
      "end",
      "go",
      ":reported = ycor",
      ":current = who",
      ":actual = 0",
      "ask :current [ :actual = ycor ]",
      "print :actual == :reported",
    ].join("\n"),
    "main.logo",
  );
  assert.deepEqual(result.diagnostics, []);
  const printEvent = result.events.find((event) => event.kind === "print");
  assert.deepEqual(printEvent.payload, { values: [true] });
});

test("#782: heading and pos agree with who after a callee's tell too, not just ycor", () => {
  // The cache the defect forked backed all four movement reporters, so pin the other two as well —
  // a fix that re-derived only `ycor` would leave `heading`/`pos` describing the caller's turtle.
  const result = execute(
    [
      ":a = new_turtle",
      ":b = new_turtle",
      "tell :a",
      "right 45",
      "tell :b",
      "forward 20",
      "right 90",
      "tell :a",
      "define go",
      "  tell :b",
      "end",
      "go",
      "print who",
      "print heading",
      "print pos",
      "print ycor",
    ].join("\n"),
    "main.logo",
  );
  assert.deepEqual(result.diagnostics, []);
  const prints = result.events
    .filter((event) => event.kind === "print")
    .map((event) => event.payload.values[0]);
  // :b moved 20 up then turned to 90, so it stands at (0, 20) facing 90; :a only turned 45 and never
  // moved, so it is at (0, 0) facing 45. Every reporter must describe :b, not :a.
  assert.equal(prints[0].id, 2);
  assert.equal(prints[1], 90);
  assert.deepEqual(prints[2], [0, 20]);
  assert.equal(prints[3], 20);
});

test("#782: a turtle command after a callee's tell applies to the newly addressed turtle (the self-heal path)", () => {
  // The path that made the defect intermittent: the first turtle command after the call re-derived
  // the stale cache and hid the divergence, so the wrong answer was only visible in the window
  // between the call returning and the next turtle command. Reading `ycor` inside that window first
  // is what makes this test able to fail; the command that follows must then apply to the turtle the
  // callee addressed, with its events carrying that turtle's id (`spec/turtles-and-sprites.md:113`).
  const result = execute(
    [
      ":a = new_turtle",
      ":b = new_turtle",
      "tell :a",
      "forward 10",
      "tell :b",
      "forward 20",
      "tell :a",
      "define go",
      "  tell :b",
      "end",
      "go",
      "print ycor",
      "forward 40",
      "print who",
      "print ycor",
    ].join("\n"),
    "main.logo",
  );
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(moves(result.events), [
    [1, [0, 10]],
    [2, [0, 20]],
    [2, [0, 60]],
  ]);
  const prints = result.events
    .filter((event) => event.kind === "print")
    .map((event) => event.payload.values[0]);
  // In the divergence window: :b's y of 20, not :a's 10. After the command: still :b, now at 60.
  assert.equal(prints[0], 20);
  assert.equal(prints[1].id, 2);
  assert.equal(prints[2], 60);
});

test("#782: a tell in an argument does not re-aim the non-movement command it is an argument of", () => {
  // The acting turtle is fixed when the statement begins, for EVERY per-turtle command — not just
  // `forward`. `set_color` addressed to :a keeps recolouring :a even though its argument's procedure
  // re-addressed :b, so the `color-change` event and its `turtle_id` describe one turtle; the
  // `tell` still takes effect for what follows, which `who` then reports.
  //
  // :b is pre-coloured blue so the `from` field discriminates (recolouring :b would report
  // `from: "blue"`), and :a draws afterwards so the segment's captured pen colour proves which
  // turtle actually changed rather than only which id the event claims.
  const result = execute(
    [
      "define choose_color",
      "  tell :b",
      '  return "red"',
      "end",
      ":a = new_turtle",
      ":b = new_turtle",
      "tell :b",
      'set_color "blue"',
      "tell :a",
      "set_color choose_color",
      "print who",
      "tell :a",
      "forward 5",
    ].join("\n"),
    "main.logo",
  );
  assert.deepEqual(result.diagnostics, []);
  const colorChanges = result.events
    .filter((event) => event.kind === "color-change")
    .map((event) => [event.turtle_id, event.payload]);
  assert.deepEqual(colorChanges, [
    [2, { from: "black", to: "blue" }],
    [1, { from: "black", to: "red" }],
  ]);
  const printEvent = result.events.find((event) => event.kind === "print");
  assert.equal(printEvent.payload.values[0].id, 2);
  // :a really carries the new pen colour: its segment captures "red", not the "black" it would
  // still be if the argument's `tell` had re-aimed `set_color` at :b.
  const segment = result.events.find((event) => event.kind === "draw-segment");
  assert.equal(segment.turtle_id, 1);
  assert.equal(segment.payload.color, "red");
});

test("#782: an ask inside a procedure still restores the caller's addressed set (tell persists, ask does not)", () => {
  // The counterpart of the persistence rule: `ask` IS scoped (`spec/turtles-and-sprites.md:58`), and
  // making a callee's `tell` visible must not accidentally make a callee's `ask` leak. After `nudge`
  // returns, the addressed set is still the caller's :a — proven by `who` and by a `forward` landing
  // on :a — even though the `ask` inside it addressed :b.
  const result = execute(
    [
      ":a = new_turtle",
      ":b = new_turtle",
      "tell :a",
      "define nudge",
      "  ask :b [ forward 5 ]",
      "end",
      "nudge",
      "print who",
      "forward 7",
    ].join("\n"),
    "main.logo",
  );
  assert.deepEqual(result.diagnostics, []);
  const printEvent = result.events.find((event) => event.kind === "print");
  assert.equal(printEvent.payload.values[0].id, 1);
  assert.deepEqual(moves(result.events), [
    [2, [0, 5]],
    [1, [0, 7]],
  ]);
});

test("#748: a turtle listed twice is ONE member of the addressed set — a direct turtle command applies once (dedup by id)", () => {
  // The addressed set is a SET (spec/turtles-and-sprites.md:44) whose members compare by "Same
  // turtle identity" (spec/execution-model.md:540), and a turtle command "applies once for each
  // addressed turtle" (:113). `tell [ :a :a ]` therefore addresses :a ONCE: one move to [0, 10],
  // ending there — not two moves ending at [0, 20], which is what the direct path did before #748
  // while `each` (same epic) already ran once.
  const result = execute(
    ":a = new_turtle\ntell [ :a :a ]\nforward 10\nprint ycor",
    "main.logo",
  );
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(moves(result.events), [[1, [0, 10]]]);
  const printEvent = result.events.find((event) => event.kind === "print");
  assert.deepEqual(printEvent.payload, { values: [10] });
});

test("#748: dedup preserves first-occurrence order — tell [ :b :a :b ] keeps :b first, so who reports :b and it moves first", () => {
  // Requirement #679: `tell [ :b :a ]` makes :b current. Dropping the repeat of :b must not promote
  // :a to the front nor reorder the iteration: exactly two moves, :b (id 2) then :a (id 1).
  const result = execute(
    ":a = new_turtle\n:b = new_turtle\ntell [ :b :a :b ]\nprint who == :b\nforward 10",
    "main.logo",
  );
  assert.deepEqual(result.diagnostics, []);
  const printEvent = result.events.find((event) => event.kind === "print");
  assert.deepEqual(printEvent.payload, { values: [true] });
  assert.deepEqual(moves(result.events), [
    [2, [0, 10]],
    [1, [0, 10]],
  ]);
});

test("#748: dedup is by turtle identity, not by list position — the same turtle reached through two variables is still one member", () => {
  // `:copy = :a` binds the same turtle value; `tell [ :a :copy ]` addresses one turtle, proving the
  // rule keys on the stable id rather than on the surface expressions in the list.
  const result = execute(
    ":a = new_turtle\n:copy = :a\ntell [ :a :copy ]\nforward 10",
    "main.logo",
  );
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(moves(result.events), [[1, [0, 10]]]);
});

test("#748: the de-duplicated set is what each iterates too — the direct and each paths agree turtle for turtle", () => {
  // The contradiction #748 fixed was BETWEEN the two paths, so pin them against each other: after
  // `tell [ :a :a ]`, `forward 10` and `each [ forward 10 ]` each emit exactly one move for :a, so
  // :a ends at [0, 20] after both — never [0, 30].
  const result = execute(
    ":a = new_turtle\ntell [ :a :a ]\nforward 10\neach [ forward 10 ]\nprint ycor",
    "main.logo",
  );
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(moves(result.events), [
    [1, [0, 10]],
    [1, [0, 20]],
  ]);
  const prints = result.events
    .filter((event) => event.kind === "print")
    .map((event) => event.payload.values[0]);
  assert.deepEqual(prints, [20]);
});

test("#748: a command's argument is evaluated once per MEMBER, not once per listed item (side effects dedup too)", () => {
  // The per-turtle loop evaluates the command's argument once per addressed turtle, so dedup is
  // observable in argument side effects as well as in move events: with `tell [ :a :a ]`, `step`
  // (which prints) runs ONCE, not twice — a repeated turtle no longer doubles the work its command
  // triggers. Pins the behavioral consequence @turtle-engine flagged reviewing #748.
  const result = execute(
    [
      "define step",
      "  print who",
      "  return 10",
      "end",
      ":a = new_turtle",
      "tell [ :a :a ]",
      "forward step",
    ].join("\n"),
    "main.logo",
  );
  assert.deepEqual(result.diagnostics, []);
  const printed = result.events
    .filter((event) => event.kind === "print")
    .map((event) => event.payload.values[0].id);
  assert.deepEqual(printed, [1]);
  assert.deepEqual(moves(result.events), [[1, [0, 10]]]);
});

test("turtleStateFor returns the registered state for a known id and throws for an unregistered one (internal invariant)", () => {
  const environment = createEnvironment();
  // The main turtle (id 0) is always registered and is the state the current-turtle accessor
  // resolves to before any `tell` — one object, reached two ways (#782: nothing caches a second).
  assert.equal(
    turtleStateFor(environment.addressing, 0),
    currentTurtleState(environment),
  );
  // No turtle 99 was ever spawned, so requesting its state is an invariant violation, not a user
  // error — real source can never reach this because every addressed id is a spawned/main id.
  assert.throws(
    () => turtleStateFor(environment.addressing, 99),
    /no registered state for turtle id 99/,
  );
});
