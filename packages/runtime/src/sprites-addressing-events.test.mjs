// Unit tests for the Sprites **addressing trace events** (issue #766), driven end to end through
// `execute()`. `spec/rendering.md:193` is normative — "Implementations with multiple turtles MUST
// identify the active turtle or addressed turtle set" — but before this slice a consumer of the
// trace stream could not: `tell`/`ask`/`each` changed the addressed set silently, and the only
// turtle identity in the stream was the *acting* turtle's `turtle_id` on each per-turtle effect,
// which after an `ask`/`each` block restores (spec/turtles-and-sprites.md:58) is neither the active
// turtle nor the addressed set.
//
// So every change of the addressed set now emits a `primitive` event (the registered generic
// catch-all for a primitive without a more specific kind, spec/execution-model.md:836 — no new event
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
  // spec/execution-model.md:771 — `turtle-id` is "present only when the event is turtle-specific".
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

test("an addressing form reached from a per-turtle command's ARGUMENT is still never stamped", () => {
  // Regression for the review-gate finding that `stampTurtleId` labelled every un-stamped event
  // produced while one addressed turtle ran a per-turtle command — and argument evaluation happens
  // inside that window. `forward nudge` evaluates `nudge` once per addressed turtle, and `nudge`
  // addresses :a, so the `ask` entry/restore events are emitted mid-stamping-window. Under
  // `tell [ :a :b ]` the stamp would have named turtle 2 on an event whose addressed set is [ 1 ].
  const result = execute(
    [
      ":a = new_turtle",
      ":b = new_turtle",
      "define nudge",
      "  ask :a [ right 1 ]",
      "  return 3",
      "end",
      "tell [ :a :b ]",
      "forward nudge",
    ].join("\n"),
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
  // Both turtles ran the command, so `nudge` (and its `ask`) ran twice: four addressing events.
  assert.deepEqual(addressingEvents(result.events), [
    ["tell", [1, 2], 1],
    ["ask", [1], 1],
    ["ask", [1, 2], 1],
    ["ask", [1], 1],
    ["ask", [1, 2], 1],
  ]);
});

test("a scene-only clean reached from a per-turtle command's argument is never stamped", () => {
  // No `clear` carries a `turtle_id` in any mode (spec/turtles-and-sprites.md:113), and `clean`
  // additionally concerns no turtle at all — it only wipes the shared drawing surface. Since
  // argument evaluation runs inside the per-turtle stamping window, a `clean` in a reporter's body
  // would otherwise be labelled with each acting turtle in turn (turtles 1 and 2 here).
  const result = execute(
    [
      ":a = new_turtle",
      ":b = new_turtle",
      "define wipe",
      "  clean",
      "  return 5",
      "end",
      "tell [ :a :b ]",
      "forward wipe",
    ].join("\n"),
    "main.logo",
  );
  assert.deepEqual(result.diagnostics, []);
  const clears = result.events
    .filter((event) => event.kind === "clear")
    .map((event) => [event.payload.mode, event.turtle_id]);
  assert.deepEqual(clears, [
    ["clean", undefined],
    ["clean", undefined],
  ]);
});

test("clear_screen's homing move/turn carry the homed turtle's id under explicit addressing", () => {
  // Issue #847 + spec/turtles-and-sprites.md:113: the homing is observable, so the events that
  // describe it must name the turtle they homed — otherwise a per-turtle reducer would home the
  // main turtle. The addressed set here is the single turtle 2, so the homing pair names it and
  // turtle 1 is left where `forward 10` put it. The `clear` names nobody: it describes the shared
  // surface (:113), so the identity lives on the movement events alone.
  const result = execute(
    [
      ":a = new_turtle",
      ":b = new_turtle",
      "tell [ :a :b ]",
      "forward 10",
      "tell [ :b ]",
      "clear_screen",
    ].join("\n"),
    "main.logo",
  );
  assert.deepEqual(result.diagnostics, []);
  const homing = result.events
    .slice(result.events.findIndex((event) => event.kind === "clear") - 2)
    .map((event) => [event.kind, event.turtle_id]);
  assert.deepEqual(homing, [
    ["move", 2],
    ["turn", 2],
    ["clear", undefined],
  ]);
  // …and no draw-segment came with it, even though turtle 2's pen is down.
  assert.equal(
    result.events.filter((event) => event.kind === "draw-segment").length,
    2,
  );
});

test("clear_screen under tell homes every addressed turtle but clears the surface once", () => {
  // The issue #738 ruling: there is ONE shared drawing surface, so it is cleared once however many
  // turtles are addressed (spec/turtles-and-sprites.md:111), while the homing is ordinary per-turtle
  // movement and applies once for each addressed turtle (:113). So two turtles produce two homing
  // pairs and exactly one `clear`.
  const result = execute(
    [
      ":a = new_turtle",
      ":b = new_turtle",
      "tell [ :a :b ]",
      "forward 10",
      "right 45",
      "clear_screen",
    ].join("\n"),
    "main.logo",
  );
  assert.deepEqual(result.diagnostics, []);
  const homing = result.events
    .slice(result.events.findIndex((event) => event.kind === "clear") - 4)
    .map((event) => [event.kind, event.turtle_id]);
  assert.deepEqual(homing, [
    ["move", 1],
    ["turn", 1],
    ["move", 2],
    ["turn", 2],
    ["clear", undefined],
  ]);
});

test("clear_screen homes the same turtles whichever order tell listed them in", () => {
  // The wart the ruling removes (issue #738): "current" used to be the FIRST member of the addressed
  // set, so `tell [ :a :b ]` homed :a and `tell [ :b :a ]` homed :b. spec/turtles-and-sprites.md:113
  // now states the result "never depends on the order the turtles were listed in". Asserted on the
  // homed SET rather than the event order, since the events do follow the addressed set's order.
  const homedTurtles = (order) => {
    const result = execute(
      [
        ":a = new_turtle",
        ":b = new_turtle",
        `tell [ ${order} ]`,
        "forward 10",
        "right 45",
        "clear_screen",
        "each [ print pos ]",
      ].join("\n"),
      "main.logo",
    );
    assert.deepEqual(result.diagnostics, []);
    const clearIndex = result.events.findIndex(
      (event) => event.kind === "clear",
    );
    return {
      homed: new Set(
        result.events
          .slice(0, clearIndex)
          .filter((event) => event.kind === "move" && event.payload.to[1] === 0)
          .map((event) => event.turtle_id),
      ),
      clears: result.events.filter((event) => event.kind === "clear").length,
      positions: result.events
        .filter((event) => event.kind === "print")
        .map((event) => event.payload.values[0]),
    };
  };
  const forwards = homedTurtles(":a :b");
  const backwards = homedTurtles(":b :a");
  // Numeric comparator: `Array.prototype.sort`'s default is lexicographic, which would order ten or
  // more turtle ids wrongly and hide a genuine difference between the two orderings.
  const byId = (left, right) => left - right;
  assert.deepEqual([...forwards.homed].sort(byId), [1, 2]);
  assert.deepEqual(
    [...forwards.homed].sort(byId),
    [...backwards.homed].sort(byId),
  );
  assert.equal(forwards.clears, 1);
  assert.equal(backwards.clears, 1);
  assert.deepEqual(forwards.positions, [
    [0, 0],
    [0, 0],
  ]);
  assert.deepEqual(backwards.positions, forwards.positions);
});

test("clear_screen with an empty addressed set clears the surface and homes nobody", () => {
  // `tell [ ]` addresses no turtle, so the per-turtle half of `clear_screen` applies zero times —
  // the same empty-set no-op every other per-turtle command has. The shared surface is still
  // cleared. The main turtle was never addressed, so it must NOT be homed: before issue #738 the
  // homing followed the current turtle, which `tell [ ]` leaves pointing at it.
  const result = execute(
    ["forward 10", "right 30", "tell [ ]", "clear_screen", "print pos"].join(
      "\n",
    ),
    "main.logo",
  );
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(
    result.events
      .filter((event) => ["move", "turn", "clear"].includes(event.kind))
      .map((event) => [event.kind, event.turtle_id]),
    [
      ["move", undefined],
      ["turn", undefined],
      ["clear", undefined],
    ],
  );
  assert.deepEqual(
    result.events.filter((event) => event.kind === "print")[0].payload
      .values[0],
    [0, 10],
  );
});

test("a clear_screen reached from a per-turtle command's argument homes the addressed set", () => {
  // The `clean` counterpart above proves a scene-only clear is never stamped; `clear_screen` is the
  // homing case. Argument evaluation runs inside the per-turtle window, so the reporter's body runs
  // once per addressed turtle — but the per-turtle loop only re-points the CURRENT turtle, it does
  // not narrow the addressed set, so each run of `clear_screen` homes the whole `tell [ :a :b ]` set
  // (spec/turtles-and-sprites.md:113). Two runs, two homing pairs each, one `clear` each — and none
  // of the clears is stamped even though it was emitted inside the stamping window.
  const result = execute(
    [
      ":a = new_turtle",
      ":b = new_turtle",
      "define wipe",
      "  clear_screen",
      "  return 5",
      "end",
      "tell [ :a :b ]",
      "forward wipe",
    ].join("\n"),
    "main.logo",
  );
  assert.deepEqual(result.diagnostics, []);
  const homing = result.events
    .filter((event) => ["move", "turn", "clear"].includes(event.kind))
    .map((event) => [event.kind, event.turtle_id]);
  assert.deepEqual(homing, [
    ["move", 1],
    ["turn", 1],
    ["move", 2],
    ["turn", 2],
    ["clear", undefined],
    ["move", 1],
    ["move", 1],
    ["turn", 1],
    ["move", 2],
    ["turn", 2],
    ["clear", undefined],
    ["move", 2],
  ]);
});

test("clear_screen under ask homes the asked turtle, leaving the rest untouched", () => {
  // `ask` is a scoped `tell`, so the addressed set inside the block is just :b and the homing loop
  // reaches only that turtle. Pinned so it stays that way: :b is homed and named by its own
  // `move`/`turn`, while :a keeps the position/heading `forward`/`right` gave it. The `clear`
  // carries no identity even here, where exactly one turtle is addressed
  // (spec/turtles-and-sprites.md:113).
  const result = execute(
    [
      ":a = new_turtle",
      ":b = new_turtle",
      "tell [ :a :b ]",
      "forward 10",
      "right 45",
      "ask :b [ clear_screen ]",
      "each [",
      "  print pos",
      "]",
    ].join("\n"),
    "main.logo",
  );
  assert.deepEqual(result.diagnostics, []);
  const homing = result.events
    .filter((event) => ["move", "turn", "clear"].includes(event.kind))
    .slice(-3)
    .map((event) => [event.kind, event.turtle_id]);
  assert.deepEqual(homing, [
    ["move", 2],
    ["turn", 2],
    ["clear", undefined],
  ]);
  const printed = result.events
    .filter((event) => event.kind === "print")
    .map((event) => event.payload.values[0]);
  assert.deepEqual(printed, [
    [0, 10],
    [0, 0],
  ]);
});

test("who inside the argument still reports the acting turtle while the snapshot reports the set", () => {
  // The documented division of labour: an addressing snapshot describes ADDRESSING (the set and its
  // first member), while the transient per-turtle pointer — which makes `who` report the turtle
  // actually running a multi-turtle command — is expressed on each effect event's own `turtle_id`.
  // Inside turtle 2's run the nested `ask` restores to the set [1, 2] and reports current turtle 1,
  // while `print who` on the next line of the same argument reports turtle 2. Both are correct and
  // neither is the other's business; this pins that they are deliberately different views.
  const result = execute(
    [
      ":a = new_turtle",
      ":b = new_turtle",
      "define nudge",
      "  ask :a [ right 1 ]",
      "  print who",
      "  return 3",
      "end",
      "tell [ :a :b ]",
      "forward nudge",
    ].join("\n"),
    "main.logo",
  );
  assert.deepEqual(result.diagnostics, []);
  // `who` inside the argument: turtle 1 on the first run, turtle 2 on the second.
  const printed = result.events
    .filter((event) => event.kind === "print")
    .map((event) => event.payload.values[0].id);
  assert.deepEqual(printed, [1, 2]);
  // Every addressing snapshot in the same stream reports the addressed set's own first member.
  assert.deepEqual(addressingEvents(result.events), [
    ["tell", [1, 2], 1],
    ["ask", [1], 1],
    ["ask", [1, 2], 1],
    ["ask", [1], 1],
    ["ask", [1, 2], 1],
  ]);
});

test("current_turtle_id follows the addressed set, never the per-turtle loop's transient pointer", () => {
  // Regression for the review-gate finding that `runPerTurtleCommand` re-aims `addressing.currentId`
  // at each addressed turtle in turn (so a `who` inside an argument reports the turtle actually
  // running the command) WITHOUT emitting. An `ask` reached from that argument snapshotted the
  // transient pointer and republished it on restore, so the second iteration reported
  // `current_turtle_id: 2` for the set [ 1, 2 ] — contradicting both `ids[0]` and the `who` reported
  // by the very next statement. Deriving the payload's current turtle from the set fixes it by
  // construction.
  const result = execute(
    [
      ":a = new_turtle",
      ":b = new_turtle",
      "define nudge",
      "  ask :a [ right 1 ]",
      "  return 3",
      "end",
      "tell [ :a :b ]",
      "forward nudge",
      "print who",
    ].join("\n"),
    "main.logo",
  );
  assert.deepEqual(result.diagnostics, []);
  // The last addressing snapshot and the `who` printed straight after it agree on turtle 1.
  assert.deepEqual(foldAddressing(result.events), {
    addressed_turtle_ids: [1, 2],
    current_turtle_id: 1,
  });
  const printed = result.events.filter((event) => event.kind === "print");
  assert.equal(printed.at(-1).payload.values[0].id, 1);
  // Every snapshot in the stream is self-consistent: the current turtle is its set's first member.
  for (const [, ids, current] of addressingEvents(result.events)) {
    assert.ok(ids.length > 0);
    assert.equal(current, ids[0]);
  }
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
  // Each iteration's own effect belongs to the turtle its narrowing event named, in the same
  // order — the pairing that lets a consumer attribute effects to the narrowed set.
  assert.deepEqual(moves(result.events), [
    [1, [0, 10]],
    [2, [0, 10]],
  ]);
});

test("each over an empty addressed set narrows zero times but still publishes the restore", () => {
  // Zero iterations means zero narrowings; the `finally` still runs, so the stream ends on the
  // (unchanged) empty set rather than going silent about it. `current_turtle_id` is `null`, not this
  // implementation's own `who` fallback: the spec defines no current turtle for an empty addressed
  // set, so a portable fixture must not make one implementation's choice binding.
  const result = execute(
    ":a = new_turtle\ntell [ ]\neach [ forward 99 ]",
    "main.logo",
  );
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(addressingEvents(result.events), [
    ["tell", [], null],
    ["each", [], null],
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
  // spec/execution-model.md:785-794 — an effect payload is a point-in-time snapshot, not a live
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
