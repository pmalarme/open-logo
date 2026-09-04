// Unit tests for `clear_screen`/`clean` (issue #204, spec/commands.md's `clear_screen`/`clean`
// entries, spec/rendering.md's "Clear operations" section). Both take zero arguments and emit
// exactly one `clear` event. `clear_screen` additionally homes position/heading and — since issue
// #847 — makes that homing observable, emitting `move`/`turn` before the `clear` with NO
// `draw-segment` whatever the pen state. `clean` leaves position/heading untouched and emits the
// `clear` alone. Pen state and visibility are unchanged by either (this file never sets a
// non-default pen color or width).

import assert from "node:assert/strict";
import { test } from "node:test";
import { execute } from "@openlogo/runtime";

test("execute clears the screen and homes the turtle, emitting an observable move/turn before the single clear event", () => {
  const result = execute("forward 30\nright 90\nclear_screen", "main.logo");
  assert.deepEqual(result.diagnostics, []);
  const kinds = result.events.map((event) => event.kind);
  assert.deepEqual(kinds, [
    "instruction",
    "move",
    "draw-segment",
    "instruction",
    "turn",
    "instruction",
    "move",
    "turn",
    "clear",
  ]);
  // The homing move reports the pre-reset heading, exactly as `home`'s does; the turn that
  // follows reports the reset itself, so a heading reset from a non-zero heading is observable.
  assert.deepEqual(result.events[6].payload, {
    from: [0, 30],
    to: [0, 0],
    heading: 90,
  });
  assert.deepEqual(result.events[7].payload, { from: 90, to: 0 });
  assert.deepEqual(result.events[8], {
    seq: 8,
    kind: "clear",
    source_span: result.events[5].source_span,
    payload: { mode: "clear_screen" },
  });
});

test("clear_screen's homing events share the clear_screen call's source span", () => {
  const result = execute("forward 30\nclear_screen", "main.logo");
  assert.deepEqual(result.diagnostics, []);
  const [, , , clearInstruction, move, turn, clear] = result.events;
  for (const event of [move, turn, clear]) {
    assert.deepEqual(event.source_span, clearInstruction.source_span);
  }
});

test("clear_screen emits no draw-segment for its homing even with the pen down", () => {
  // The pen is down throughout (the program never lifts it), so the `forward` draws — but the
  // homing must not, because `clear_screen` wipes the drawing anyway (spec/rendering.md's "Clear
  // operations" table leaves clear_screen with no drawing segments). Issue #847.
  const result = execute("forward 30\nright 90\nclear_screen", "main.logo");
  assert.deepEqual(result.diagnostics, []);
  const segments = result.events.filter(
    (event) => event.kind === "draw-segment",
  );
  assert.equal(segments.length, 1);
  assert.deepEqual(segments[0].payload, {
    from: [0, 0],
    to: [0, 30],
    color: "black",
    width: 1,
  });
});

test("clear_screen's homing still emits move/turn when the turtle is already home", () => {
  // Unconditional, exactly like `home`: a consumer stepping the stream always sees the homing,
  // and never has to infer it from the absence of events.
  const result = execute("clear_screen", "main.logo");
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(
    result.events.map((event) => event.kind),
    ["instruction", "move", "turn", "clear"],
  );
  assert.deepEqual(result.events[1].payload, {
    from: [0, 0],
    to: [0, 0],
    heading: 0,
  });
  assert.deepEqual(result.events[2].payload, { from: 0, to: 0 });
});

test("clear_screen's event stream and the runtime agree on the homed position and heading", () => {
  // Issue #847's exact reproduction: replaying the events must land where `pos`/`heading` report.
  const result = execute(
    "forward 10\nright 45\nclear_screen\nprint pos\nprint heading",
    "main.logo",
  );
  assert.deepEqual(result.diagnostics, []);
  let position = [0, 0];
  let heading = 0;
  for (const event of result.events) {
    if (event.kind === "move") {
      position = event.payload.to;
      heading = event.payload.heading;
    } else if (event.kind === "turn") {
      heading = event.payload.to;
    }
  }
  const printed = result.events
    .filter((event) => event.kind === "print")
    .map((event) => event.payload.values[0]);
  assert.deepEqual(printed, [position, heading]);
  assert.deepEqual(position, [0, 0]);
  assert.equal(heading, 0);
});

test("clear_screen emits its homing triple once per repeat iteration", () => {
  const result = execute("repeat 3 [ forward 10 clear_screen ]", "main.logo");
  assert.deepEqual(result.diagnostics, []);
  const homing = result.events
    .filter((event) => ["move", "turn", "clear"].includes(event.kind))
    .map((event) => event.kind);
  assert.deepEqual(homing, [
    // forward, then the homing triple - three times over.
    "move",
    "move",
    "turn",
    "clear",
    "move",
    "move",
    "turn",
    "clear",
    "move",
    "move",
    "turn",
    "clear",
  ]);
  // Each iteration starts from the origin again, so every forward is the same segment.
  const segments = result.events.filter(
    (event) => event.kind === "draw-segment",
  );
  assert.equal(segments.length, 3);
  for (const segment of segments) {
    assert.deepEqual(segment.payload.from, [0, 0]);
    assert.deepEqual(segment.payload.to, [0, 10]);
  }
});

test("clear_screen inside a procedure homes the caller's turtle and reports the clear_screen statement's own span", () => {
  const result = execute(
    ["define wipe", "  clear_screen", "end", "forward 10", "wipe"].join("\n"),
    "main.logo",
  );
  assert.deepEqual(result.diagnostics, []);
  const homing = result.events.filter((event) =>
    ["move", "turn", "clear"].includes(event.kind),
  );
  assert.deepEqual(
    homing.map((event) => event.kind),
    ["move", "move", "turn", "clear"],
  );
  assert.deepEqual(homing[1].payload, {
    from: [0, 10],
    to: [0, 0],
    heading: 0,
  });
  // The homing events sit between the procedure's enter/exit and carry the `clear_screen` call's
  // own span (line 2), not the call site of `wipe` (line 5).
  for (const event of homing.slice(1)) {
    assert.equal(event.source_span.start[0], 2);
  }
  const kinds = result.events.map((event) => event.kind);
  // Guarded so the ordering comparison below cannot pass vacuously on a missing (-1) index.
  assert.ok(kinds.includes("procedure-enter"));
  assert.ok(kinds.includes("procedure-exit"));
  assert.ok(kinds.indexOf("procedure-enter") < kinds.indexOf("clear"));
  assert.ok(kinds.indexOf("clear") < kinds.indexOf("procedure-exit"));
});

test("clear_screen homes the turtle internally: a following forward draws from the origin", () => {
  const result = execute(
    "forward 30\nright 90\nclear_screen\nforward 50",
    "main.logo",
  );
  assert.deepEqual(result.diagnostics, []);
  const moveEvents = result.events.filter((event) => event.kind === "move");
  assert.equal(moveEvents.length, 3);
  assert.deepEqual(moveEvents[2].payload, {
    from: [0, 0],
    to: [0, 50],
    heading: 0,
  });
});

test("execute cleans the drawing only, emitting a single clear event and leaving position/heading unchanged", () => {
  // `clean` homes no turtle, so it emits no `move`/`turn` — the one clear event is its whole
  // effect (spec/rendering.md's "Clear operations" table: drawing cleared, turtle unchanged).
  const result = execute("forward 30\nright 90\nclean", "main.logo");
  assert.deepEqual(result.diagnostics, []);
  const kinds = result.events.map((event) => event.kind);
  assert.deepEqual(kinds, [
    "instruction",
    "move",
    "draw-segment",
    "instruction",
    "turn",
    "instruction",
    "clear",
  ]);
  assert.deepEqual(result.events[6], {
    seq: 6,
    kind: "clear",
    source_span: result.events[5].source_span,
    payload: { mode: "clean" },
  });
});

test("clean does not home the turtle: a following forward continues from where it was", () => {
  const result = execute("forward 30\nclean\nforward 50", "main.logo");
  assert.deepEqual(result.diagnostics, []);
  const moveEvents = result.events.filter((event) => event.kind === "move");
  assert.equal(moveEvents.length, 2);
  assert.deepEqual(moveEvents[1].payload, {
    from: [0, 30],
    to: [0, 80],
    heading: 0,
  });
});

test("clean does not reset the heading: a following right turn continues from where it was", () => {
  const result = execute("right 90\nclean\nright 10", "main.logo");
  assert.deepEqual(result.diagnostics, []);
  const turnEvents = result.events.filter((event) => event.kind === "turn");
  assert.equal(turnEvents.length, 2);
  assert.deepEqual(turnEvents[1].payload, { from: 90, to: 100 });
});

test("clear_screen preserves pen state and visibility", () => {
  const result = execute(
    "pen_up\nhide_turtle\nclear_screen\nforward 10",
    "main.logo",
  );
  assert.deepEqual(result.diagnostics, []);
  // The pen stayed up across clear_screen, so neither the homing nor the subsequent forward
  // emits a draw-segment - proving pen state survived the clear.
  const kinds = result.events.map((event) => event.kind);
  assert.equal(kinds.includes("draw-segment"), false);
  const moveEvents = result.events.filter((event) => event.kind === "move");
  assert.equal(moveEvents.length, 2);
});

test("execute keeps the drawing intact by default, without any clear command", () => {
  const result = execute("forward 50", "main.logo");
  assert.deepEqual(result.diagnostics, []);
  const kinds = result.events.map((event) => event.kind);
  assert.deepEqual(kinds, ["instruction", "move", "draw-segment"]);
});

test("execute accepts the parenthesized call form for a zero-argument clean", () => {
  const result = execute("(clean)", "main.logo");
  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.events.length, 2);
  assert.equal(result.events[1].kind, "clear");
});

test("execute raises ol-too-many-inputs for a parenthesized clear_screen with an argument", () => {
  // Issue #815: `execute()` now runs the semantic check first, and this arity fault is one the
  // checker decides statically — so the program is refused before Phase 2 and the runtime guard
  // below would never be reached. `runUnchecked` is the spec’s own opt-out
  // (`spec/execution-model.md:687-694`), and is what keeps the runtime guard exercised: it runs,
  // raises the identical fault, and `spec/execution-model.md:746-748` collapses the second report
  // into the first — which is why the surviving diagnostic reads `stage: "semantic"`.
  const result = execute("(clear_screen 1)", "main.logo", { runUnchecked: true });
  assert.equal(result.events.length, 1);
  assert.equal(result.diagnostics.length, 1);
  assert.deepEqual(result.diagnostics[0], {
    code: "ol-too-many-inputs",
    source_span: result.diagnostics[0].source_span,
    params: { callable: "clear_screen", expected: 0, actual: 1 },
    message: result.diagnostics[0].message,
    stage: "semantic",
    severity: "error",
  });
});

test("execute raises ol-too-many-inputs for a parenthesized clean with two arguments", () => {
  // Issue #815: `execute()` now runs the semantic check first, and this arity fault is one the
  // checker decides statically — so the program is refused before Phase 2 and the runtime guard
  // below would never be reached. `runUnchecked` is the spec’s own opt-out
  // (`spec/execution-model.md:687-694`), and is what keeps the runtime guard exercised: it runs,
  // raises the identical fault, and `spec/execution-model.md:746-748` collapses the second report
  // into the first — which is why the surviving diagnostic reads `stage: "semantic"`.
  const result = execute("(clean 1 2)", "main.logo", { runUnchecked: true });
  assert.equal(result.events.length, 1);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-too-many-inputs");
  assert.deepEqual(result.diagnostics[0].params, {
    callable: "clean",
    expected: 0,
    actual: 2,
  });
});
