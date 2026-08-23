import assert from "node:assert/strict";
import { test } from "node:test";
import * as Core from "@openlogo/core";
import * as OL from "@openlogo/edu";
import * as Parser from "@openlogo/parser";
import * as Runtime from "@openlogo/runtime";

/**
 * Builds a real {@link OL.TutorContext} from source: parses it for the AST, executes it for the
 * trace events + diagnostics (`@openlogo/runtime`'s `execute()`), and lets the caller pick which
 * statement is the `target` (by index into the top-level program body). Mirrors
 * `tutor-context.test.mjs`'s pattern of building contexts from a real parsed program, but also
 * threads real execution results so `debug`'s diagnostic/turtle-state/call-path segments are
 * exercised against genuine runtime output, not hand-rolled fixtures.
 */
function contextFromSource(source, { targetIndex, level = "3" } = {}) {
  const { ast: program } = Parser.parse(source, "main.logo");
  const { events, diagnostics } = Runtime.execute(source, "main.logo");
  const target =
    targetIndex === undefined ? undefined : program.body[targetIndex];
  return { command: "debug", program, target, events, diagnostics, level };
}

test("debug describes the whole program when no target is selected and nothing went wrong", () => {
  const context = contextFromSource("forward 80\nright 90", {});
  const output = OL.debug(context);

  assert.equal(output.command, "debug");
  assert.equal(output.segments[0], "You're looking at the whole program.");
  assert.equal(output.diagnostic_code, undefined);
  assert.equal(output.target_source_span, undefined);
  assert.ok(
    output.segments[output.segments.length - 1].includes(
      "No error is associated",
    ),
  );
});

test("debug is deterministic: the same context always folds to a byte-identical output", () => {
  const context = contextFromSource("forward 80\nright 90", { targetIndex: 0 });
  const first = OL.debug(context);
  const second = OL.debug(context);
  assert.deepEqual(first, second);
});

test("debug never emits a complete ready-to-run solution program", () => {
  const context = contextFromSource(':size = "big"\nforward :size', {
    targetIndex: 1,
    level: "3",
  });
  const output = OL.debug(context);
  // Don't rely on newline-absence: a full solution can be a runnable one-liner
  // (`repeat 4 [ forward 80 right 90 ]`), so "no `\n`" proves nothing. Instead, concatenate the
  // segments the way a program's statements are separated and assert the result is NOT a runnable
  // standalone OpenLogo program — every `debug` segment is learner-facing prose, so the combined
  // text must fail to parse (diagnostics), never compile clean into instructions.
  const combined = output.segments.join("\n");
  const { diagnostics } = Parser.parse(combined, "debug-output.logo");
  assert.ok(
    diagnostics.length > 0,
    `debug output must not parse as a runnable program, got: ${combined}`,
  );
});

test("debug on a call target names the callee via commandMetadata and reports a type-mismatch diagnostic with the variable in play", () => {
  const source = ':size = "big"\nforward :size';
  const context = {
    ...contextFromSource(source, { targetIndex: 1 }),
    commandMetadata: { name: "forward", arity: 1, kind: "primitive" },
  };
  const output = OL.debug(context);

  assert.equal(output.segments[0], "The current instruction calls `forward`.");
  assert.match(
    output.segments[1],
    /`:size` currently holds a `word` value, but this line needs a `number`\./,
  );
  assert.equal(output.diagnostic_code, "ol-type");
  assert.deepEqual(output.target_source_span, {
    document: "main.logo",
    start: [2, 9],
    end: [2, 14],
  });
  assert.match(
    output.segments.at(-2),
    /^Diagnostic `ol-type`: forward needs a number, but got a word\.$/,
  );
  assert.match(
    output.segments.at(-1),
    /Try tracing back where `:size` gets its value/,
  );
});

test("debug names a special-form target by its commandMetadata kind", () => {
  const context = {
    ...contextFromSource("repeat 4\n  forward 80\n  right 90\nend repeat", {
      targetIndex: 0,
    }),
    commandMetadata: { name: "repeat", arity: 1, kind: "special-form" },
  };
  const output = OL.debug(context);
  assert.equal(
    output.segments[0],
    "The current instruction is the `repeat` control form.",
  );
});

test("debug names a procedure target by its commandMetadata kind", () => {
  const source =
    "define square\n  repeat 4\n    forward 80\n    right 90\n  end repeat\nend\nsquare";
  const context = {
    ...contextFromSource(source, { targetIndex: 1 }),
    commandMetadata: { name: "square", arity: 0, kind: "procedure" },
  };
  const output = OL.debug(context);
  assert.equal(
    output.segments[0],
    "The current instruction calls the `square` procedure.",
  );
  // The call to `square` already ran to completion (no trace events at all here, so no
  // procedure-enter/procedure-exit frame is open) — the target's own commandMetadata still
  // names it, so the learner sees which procedure this line invokes instead of no call path.
  assert.ok(output.segments.includes("Call path: `square`."));
});

test("debug describes a non-call target using its statement kind when no commandMetadata is given", () => {
  const context = contextFromSource(':size = "big"', { targetIndex: 0 });
  const output = OL.debug(context);
  assert.equal(
    output.segments[0],
    "The current instruction sets a variable's value.",
  );
});

test("debug falls back to naming the raw node kind for a statement kind it has no template for", () => {
  const context = contextFromSource("[1 2 3]", { targetIndex: 0 });
  const output = OL.debug(context);
  assert.equal(output.segments[0], "The current instruction is a `ListLit`.");
});

test("debug lists a bare variable read as the target's own variable value", () => {
  const context = contextFromSource(":size = 10\n:size", { targetIndex: 1 });
  const output = OL.debug(context);
  assert.equal(output.segments[1], "Variables used here: `:size`.");
});

test("debug lists every distinct variable argument of a parenthesized call, without duplicates", () => {
  const context = contextFromSource(":a = 1\n:b = 2\n(print :a :b :a)", {
    targetIndex: 2,
  });
  const output = OL.debug(context);
  assert.equal(output.segments[1], "Variables used here: `:a` and `:b`.");
});

test("debug reports no variable segment when the target reads no variables", () => {
  const context = contextFromSource("forward 80", { targetIndex: 0 });
  const output = OL.debug(context);
  assert.equal(output.segments.length, 3);
  assert.ok(!output.segments.some((segment) => segment.includes("Variables")));
});

test("debug reports turtle state (position, heading, pen, color, width) folded from the trace", () => {
  const source = [
    "forward 30",
    "right 90",
    "pen_up",
    'set_color "green"',
    "set_width 3",
  ].join("\n");
  const context = contextFromSource(source, {});
  const output = OL.debug(context);
  const turtleSegment = output.segments.find((segment) =>
    segment.startsWith("Turtle state so far:"),
  );
  assert.ok(turtleSegment !== undefined);
  assert.match(turtleSegment, /position \(0, 30\)/);
  assert.match(turtleSegment, /heading 90/);
  assert.match(turtleSegment, /pen up/);
  assert.match(turtleSegment, /color `green`/);
  assert.match(turtleSegment, /width 3/);
});

test("debug omits the turtle-state segment when the trace never touched turtle state", () => {
  const context = contextFromSource(":x = 1", {});
  const output = OL.debug(context);
  assert.ok(
    !output.segments.some((segment) => segment.startsWith("Turtle state")),
  );
});

test("debug's turtle state reflects a clear_screen homing position and heading, but a clean leaving them untouched", () => {
  const homed = OL.debug(
    contextFromSource("forward 30\nright 90\nclear_screen", {}),
  );
  const homedSegment = homed.segments.find((segment) =>
    segment.startsWith("Turtle state so far:"),
  );
  assert.match(homedSegment, /position \(0, 0\)/);
  assert.match(homedSegment, /heading 0/);

  const cleaned = OL.debug(
    contextFromSource("forward 30\nright 90\nclean", {}),
  );
  const cleanedSegment = cleaned.segments.find((segment) =>
    segment.startsWith("Turtle state so far:"),
  );
  assert.match(cleanedSegment, /position \(0, 30\)/);
  assert.match(cleanedSegment, /heading 90/);
});

test("debug reports the turtle a clear_screen did NOT home, because no turtle was addressed", () => {
  // Issue #738: `clear_screen` homes every ADDRESSED turtle, so `tell [ ]` homes none while still
  // clearing the shared surface. `spec/turtles-and-sprites.md:113` forbids a consumer reading the
  // `clear` as an instruction to move a turtle, and names `debug` as one of the consumers the rule
  // exists for. Folding the `clear` here used to report position (0, 0) heading 0 for a turtle the
  // runtime had left at (0, 10) heading 30 — `debug` contradicting the `pos` the same program
  // prints. The homing arrives as `move`/`turn` when it happens at all (the case above), so those
  // arms carry it and this one has nothing to add.
  const untouched = OL.debug(
    contextFromSource("forward 10\nright 30\ntell [ ]\nclear_screen", {}),
  );
  const segment = untouched.segments.find((line) =>
    line.startsWith("Turtle state so far:"),
  );
  assert.match(segment, /position \(0, 10\)/);
  assert.match(segment, /heading 30/);
});

test("debug follows the addressed turtle's own homing under tell", () => {
  // The `move`/`turn` pair `clear_screen` emits per addressed turtle is what carries the homing to
  // this fold now. With one turtle addressed there is no ambiguity about whose state is reported,
  // so the reported state must match the runtime's: homed.
  const homed = OL.debug(
    contextFromSource(
      ":a = new_turtle\ntell [ :a ]\nforward 30\nright 90\nclear_screen",
      {},
    ),
  );
  const segment = homed.segments.find((line) =>
    line.startsWith("Turtle state so far:"),
  );
  assert.match(segment, /position \(0, 0\)/);
  assert.match(segment, /heading 0/);
});

/**
 * Issue #891: `turtleStateSegment` used to fold every event through one set of variables, so under
 * Sprites an addressed set of several turtles collapsed into a single *blended* state — last write
 * wins per field — that no turtle ever actually had. `spec/turtles-and-sprites.md:113` requires the
 * per-event identities to exist precisely "so animation, stepping, `why`, and `debug` can explain
 * which turtle moved or changed", and names `debug` among the consumers the rule exists for.
 *
 * The test above is deliberately scoped to a SINGLE addressed turtle (issue #738), so it never
 * locked the blend in; these widen it to the multi-turtle cases it left open. Each asserts a full
 * literal segment rather than a pattern, so a regression shows up as a diff rather than a silent
 * near-miss.
 */
const turtleStateOf = (source) => {
  const segment = OL.debug(contextFromSource(source, {})).segments.find(
    (line) => line.startsWith("Turtle state so far:"),
  );
  assert.ok(segment !== undefined, `no turtle-state segment for: ${source}`);
  return segment;
};

test("debug reports each addressed turtle's own state instead of one blended state", () => {
  // :a ends at (0, 30) heading 0 in red; :b at (10, ~0) heading 90 with width 7. The old fold
  // reported ONE line taking position+heading from :b and color from :a — a state neither turtle
  // was ever in. Each field must now be attributed to the turtle it actually belongs to.
  assert.equal(
    turtleStateOf(
      ':a = new_turtle\n:b = new_turtle\nask :a [ forward 30 set_color "red" ]\nask :b [ right 90 forward 10 set_width 7 ]\ntell [ :a :b ]',
    ),
    "Turtle state so far: turtle #1 — position (0, 30), heading 0, color `red`; " +
      "turtle #2 — position (10, 6.123233995736766e-16), heading 90, width 7.",
  );
});

test("debug reports a position per addressed turtle when one command moved them all", () => {
  // The issue's headline symptom: `tell [ :a :b ]` + a single `forward` moves two turtles to two
  // different places (:a was pre-turned), and `debug` used to report only the last one.
  assert.equal(
    turtleStateOf(
      ":a = new_turtle\n:b = new_turtle\nask :a [ right 90 ]\ntell [ :a :b ]\nforward 10",
    ),
    "Turtle state so far: turtle #1 — position (10, 6.123233995736766e-16), heading 90; " +
      "turtle #2 — position (0, 10), heading 0.",
  );
});

test("debug's turtle state does not depend on the order the turtles were addressed in", () => {
  // `spec/turtles-and-sprites.md:113`: "the result never depends on the order the turtles were
  // listed in: `tell [ :a :b ]` and `tell [ :b :a ]` home the same two turtles". Those two forms
  // genuinely emit their per-turtle events in OPPOSITE orders, so reporting the turtle that acted
  // last — the obvious alternative to reporting per turtle — would make `debug` contradict this.
  //
  // Both turtles must end in the SAME state, so that clause ORDER is the only thing that could
  // differ between the two programs. An earlier version of this test turned :a before the `tell`,
  // which created :a's bucket first in both orderings and so passed even with the sort deleted.
  const program = (order) =>
    `:a = new_turtle\n:b = new_turtle\ntell [ ${order} ]\nforward 10`;
  assert.equal(
    turtleStateOf(program(":a :b")),
    turtleStateOf(program(":b :a")),
  );
  assert.equal(
    turtleStateOf(program(":b :a")),
    "Turtle state so far: turtle #1 — position (0, 10), heading 0; " +
      "turtle #2 — position (0, 10), heading 0.",
  );
});

test("debug reports every addressed turtle a clear_screen homed, not just one", () => {
  // The multi-turtle widening of the single-turtle homing test above: `clear_screen` homes EVERY
  // addressed turtle (issue #889), and each homing arrives as that turtle's own `move`/`turn`.
  assert.equal(
    turtleStateOf(
      ":a = new_turtle\n:b = new_turtle\nask :a [ forward 30 ]\nask :b [ right 90 forward 10 ]\ntell [ :a :b ]\nclear_screen",
    ),
    "Turtle state so far: turtle #1 — position (0, 0), heading 0; " +
      "turtle #2 — position (0, 0), heading 0.",
  );
});

test("debug leaves a turtle unnamed only in a one-turtle world", () => {
  // Nothing exists to confuse it with, and such a world can only ever be the main turtle — which
  // is what keeps every Turtle & Rendering program's wording byte-identical to the pre-#891 output.
  assert.equal(
    turtleStateOf("forward 30\nright 90"),
    "Turtle state so far: position (0, 30), heading 90.",
  );
  // `tell [ who ]` addresses the main turtle explicitly, so its events carry `turtle_id: 0`, but
  // the world still holds exactly one turtle — still unnamed.
  assert.equal(
    turtleStateOf("tell [ who ]\nforward 5"),
    "Turtle state so far: position (0, 5), heading 0.",
  );
});

test("debug names the moving turtle as soon as a second turtle exists, even though only one moved", () => {
  // The simplest Sprites program there is. Only turtle #1 has state, so counting turtles-with-state
  // would print `position (0, 5), heading 0.` — byte-identical to what a bare `forward 5` prints
  // for the MAIN turtle, which here has not moved at all. `spec/rendering.md:193`: "Implementations
  // with multiple turtles MUST identify the active turtle or addressed turtle set."
  assert.equal(
    turtleStateOf(":a = new_turtle\nask :a [ forward 5 ]"),
    "Turtle state so far: turtle #1 — position (0, 5), heading 0.",
  );
  assert.notEqual(
    turtleStateOf(":a = new_turtle\nask :a [ forward 5 ]"),
    turtleStateOf("forward 5"),
  );
  assert.equal(
    turtleStateOf(":a = new_turtle\ntell [ :a ]\nforward 30"),
    "Turtle state so far: turtle #1 — position (0, 30), heading 0.",
  );
});

test("debug names the main turtle #0 when it is the only one that moved but another turtle exists", () => {
  // The mirror image of the case above, and the one a rule keyed on "is the sole reported turtle
  // the main turtle?" would still get wrong: `:a` exists but never acted, so the main turtle is the
  // only turtle with state — and naming it is exactly what distinguishes this from a lone `forward`.
  assert.equal(
    turtleStateOf(":a = new_turtle\nforward 10"),
    "Turtle state so far: turtle #0 — position (0, 10), heading 0.",
  );
});

test("debug names turtles when two have state even if the trace never showed them being created", () => {
  // A host may feed `debug` per-turtle events without the `spawn-turtle` that produced them, so the
  // live-turtle count is 1 while two turtles plainly have state. The second clause must still be
  // named, or one turtle's state would be reported as if it were the other's.
  const program = {
    kind: "Program",
    source_span: Core.makeSpan("main.logo", [1, 1], [1, 1]),
    body: [],
  };
  const moveEvent = (seq, turtleId, y) => ({
    seq,
    kind: "move",
    source_span: Core.makeSpan("main.logo", [1, 1], [1, 10]),
    turtle_id: turtleId,
    payload: { from: [0, 0], to: [0, y], heading: 0 },
  });
  const output = OL.debug({
    command: "debug",
    program,
    events: [moveEvent(0, 3, 7), moveEvent(1, 5, 9)],
    diagnostics: [],
    level: "3",
  });
  assert.ok(
    output.segments.includes(
      "Turtle state so far: turtle #3 — position (0, 7), heading 0; " +
        "turtle #5 — position (0, 9), heading 0.",
    ),
    `unexpected segments: ${JSON.stringify(output.segments)}`,
  );
});

test("debug folds the main turtle's addressed and unaddressed movement into one turtle", () => {
  // The main turtle's id is `0`, and `tell [ who ]` addresses it explicitly, so `forward 5` here
  // carries `turtle_id: 0` while the surrounding `forward`s carry none. All three are the SAME
  // turtle: `@openlogo/turtle`'s `reduceTurtleState` folds the two spellings together for the
  // renderer, so `debug` must too or it starts contradicting the picture on screen — reporting one
  // turtle twice, with the addressed clause frozen at a stale (0, 10).
  assert.equal(
    turtleStateOf("forward 5\nask who [ forward 5 ]\nforward 5"),
    "Turtle state so far: position (0, 15), heading 0.",
  );
  assert.equal(
    turtleStateOf("forward 10\ntell [ who ]\nforward 5"),
    "Turtle state so far: position (0, 15), heading 0.",
  );
});

test("debug distinguishes the main turtle from another turtle, naming it turtle #0", () => {
  // `:friend` moves under `ask` (so its events carry its id); the trailing `forward 3` runs with no
  // explicit addressing in force, so its event carries NO id — that is the main turtle, id 0. The
  // old fold blended the two into `position (0, 3)`, losing :friend entirely. Now that a second
  // turtle is in play, both are named, and the main turtle gets its real id rather than a label.
  assert.equal(
    turtleStateOf(":friend = new_turtle\nask :friend [ forward 7 ]\nforward 3"),
    "Turtle state so far: turtle #0 — position (0, 3), heading 0; " +
      "turtle #1 — position (0, 7), heading 0.",
  );
});

test("debug names turtles with the same `turtle #<id>` tag a turtle value prints as", () => {
  // `spec/turtles-and-sprites.md:13` / `spec/execution-model.md:540`: a turtle's printed form is
  // `turtle #<id>`. `debug` uses the same tag so a learner can line its clauses up against what
  // `print who` just showed them, rather than having to translate between two spellings. The tag
  // is taken from the runtime's own `printedForm`, so the two cannot drift apart silently.
  const { events } = Runtime.execute(
    ":a = new_turtle\ntell [ :a ]\nprint who",
    "main.logo",
  );
  const printed = events.find((event) => event.kind === "print");
  const printedTurtle = Runtime.printedForm(printed.payload.values[0]);
  assert.equal(printedTurtle, "turtle #1");
  assert.match(
    turtleStateOf(
      ":a = new_turtle\n:b = new_turtle\ntell [ :a :b ]\nforward 10",
    ),
    new RegExp(`${printedTurtle} —`),
  );
});

test("debug reports addressed turtles in ascending id order, not the order they were listed", () => {
  // `tell [ :c :a :b ]` emits its per-turtle events in the listed order, so an event-order report
  // would start at :c. `spec/turtles-and-sprites.md:113` requires the result not to depend on the
  // listing order, so the clauses are sorted by id — three turtles make the sort observable in a
  // way two cannot (a two-element reversal is also a swap).
  assert.equal(
    turtleStateOf(
      ":a = new_turtle\n:b = new_turtle\n:c = new_turtle\ntell [ :c :a :b ]\nforward 10",
    ),
    "Turtle state so far: turtle #1 — position (0, 10), heading 0; " +
      "turtle #2 — position (0, 10), heading 0; " +
      "turtle #3 — position (0, 10), heading 0.",
  );
});

test("debug reports only the fields each turtle actually changed", () => {
  // Per-turtle folding must not leak one turtle's field onto another: :a only lifted its pen and
  // :b only set a color, so neither clause may mention the other's field (nor a position, since
  // neither moved). The old single-variable fold reported both fields on one line.
  assert.equal(
    turtleStateOf(
      ':a = new_turtle\n:b = new_turtle\nask :a [ pen_up ]\nask :b [ set_color "blue" ]',
    ),
    "Turtle state so far: turtle #1 — pen up; turtle #2 — color `blue`.",
  );
});

test("debug lists one turtle's fields in the spec's order: position, heading, pen, color, width", () => {
  // `spec/educational-model.md:520` fixes the order ("position, heading, pen, color, width"), so a
  // single turtle must carry ALL five at once for the sequence itself to be pinned — splitting them
  // across turtles leaves neighbouring pairs (e.g. color/width) free to swap unnoticed.
  assert.equal(
    turtleStateOf(
      ':a = new_turtle\n:b = new_turtle\nask :a [ right 90 forward 5 pen_up set_color "blue" set_width 4 ]\nask :b [ forward 1 ]',
    ),
    "Turtle state so far: turtle #1 — position (5, 3.061616997868383e-16), heading 90, " +
      "pen up, color `blue`, width 4; turtle #2 — position (0, 1), heading 0.",
  );
});

test("debug reports a turtle that has state even after it stops being addressed", () => {
  // The reported subject is every turtle the trace GAVE STATE, not the addressed set in force at
  // the end — this segment is a history ("state so far"). :a moved and was then un-addressed by
  // `tell [ :b ]`; its position is exactly what a learner asking "where did :a end up?" needs, so
  // it must survive. Reporting the addressed set instead would drop :a and add nothing for :b.
  assert.equal(
    turtleStateOf(
      ":a = new_turtle\n:b = new_turtle\nask :a [ forward 30 ]\nask :b [ forward 5 ]\ntell [ :b ]",
    ),
    "Turtle state so far: turtle #1 — position (0, 30), heading 0; " +
      "turtle #2 — position (0, 5), heading 0.",
  );
});

test("debug omits a turtle whose events described no state at all, rather than emitting an empty clause", () => {
  // Buckets are created per state-bearing event kind, before the payload is known to carry a
  // defined value. A host feeding `debug` an off-contract payload must not produce a malformed
  // `turtle #1 — .` clause (or a bare `Turtle state so far: .`) — such a turtle contributes
  // nothing and is dropped, which for a single turtle means no segment at all.
  const program = {
    kind: "Program",
    source_span: Core.makeSpan("main.logo", [1, 1], [1, 1]),
    body: [],
  };
  const emptyPayloadEvent = {
    seq: 0,
    kind: "pen-change",
    source_span: Core.makeSpan("main.logo", [1, 1], [1, 7]),
    turtle_id: 1,
    payload: {},
  };
  const output = OL.debug({
    command: "debug",
    program,
    events: [emptyPayloadEvent],
    diagnostics: [],
    level: "3",
  });
  assert.ok(
    output.segments.length > 0,
    "the absence check below is only meaningful over a non-empty segment list",
  );
  assert.ok(
    !output.segments.some((segment) => segment.startsWith("Turtle state")),
    `expected no turtle-state segment, got: ${JSON.stringify(output.segments)}`,
  );
});

test("debug shows a friendly call path for a procedure still open at the point of failure", () => {
  const program = {
    kind: "Program",
    source_span: Core.makeSpan("main.logo", [1, 1], [1, 1]),
    body: [],
  };
  const events = [
    {
      seq: 0,
      kind: "procedure-enter",
      source_span: Core.makeSpan("main.logo", [1, 1], [1, 8]),
      payload: { name: "countdown", args: [2] },
    },
    {
      seq: 1,
      kind: "procedure-enter",
      source_span: Core.makeSpan("main.logo", [2, 1], [2, 8]),
      payload: { name: "helper", args: [] },
    },
  ];
  const context = {
    command: "debug",
    program,
    events,
    diagnostics: [],
    level: "8a",
  };
  const output = OL.debug(context);
  assert.ok(output.segments.includes("Call path: `countdown` → `helper`."));
});

test("debug's call path closes over matched procedure-enter/procedure-exit pairs", () => {
  const program = {
    kind: "Program",
    source_span: Core.makeSpan("main.logo", [1, 1], [1, 1]),
    body: [],
  };
  const events = [
    {
      seq: 0,
      kind: "procedure-enter",
      source_span: Core.makeSpan("main.logo", [1, 1], [1, 8]),
      payload: { name: "countdown", args: [1] },
    },
    {
      seq: 1,
      kind: "procedure-exit",
      source_span: Core.makeSpan("main.logo", [1, 1], [1, 8]),
      payload: { name: "countdown", result: null },
    },
  ];
  const context = {
    command: "debug",
    program,
    events,
    diagnostics: [],
    level: "8a",
  };
  const output = OL.debug(context);
  assert.ok(
    !output.segments.some((segment) => segment.startsWith("Call path")),
  );
});

test("debug does not attribute an error from a different document to a selected target", () => {
  const { ast: program } = Parser.parse("forward 80", "main.logo");
  const diagnostic = {
    code: "ol-undefined-var",
    source_span: Core.makeSpan("other.logo", [5, 1], [5, 6]),
    params: { name: "ghost" },
    message: "`:ghost` has no value yet.",
    stage: "runtime",
    severity: "error",
  };
  const context = {
    command: "debug",
    program,
    target: program.body[0],
    events: [],
    diagnostics: [diagnostic],
    level: "3",
  };
  const output = OL.debug(context);
  // No containing/matching diagnostic for this target: `debug` reports no error rather than
  // misattributing an unrelated one to the instruction the learner is looking at.
  assert.equal(output.diagnostic_code, undefined);
  assert.ok(output.segments.at(-1).includes("No error is associated"));
});

test("debug ignores style diagnostics and diagnostics that are not severity error when picking what to explain", () => {
  const { ast: program } = Parser.parse("forward 80", "main.logo");
  const styleDiagnostic = {
    code: "ol-style-magic-number",
    source_span: program.body[0].source_span,
    params: {},
    message: "Consider naming this number.",
    stage: "semantic",
    severity: "warning",
  };
  const context = {
    command: "debug",
    program,
    target: program.body[0],
    events: [],
    diagnostics: [styleDiagnostic],
    level: "3",
  };
  const output = OL.debug(context);
  assert.equal(output.diagnostic_code, undefined);
  assert.ok(output.segments.at(-1).includes("No error is associated"));
});

test("debug's next-step suggestion falls back to naming the callee when there is an error but no variable in play", () => {
  const { ast: program } = Parser.parse("forward 80", "main.logo");
  const diagnostic = {
    code: "ol-type",
    source_span: program.body[0].source_span,
    params: { operation: "forward" },
    message: "forward needs a number, but got something else.",
    stage: "runtime",
    severity: "error",
  };
  const context = {
    command: "debug",
    program,
    target: program.body[0],
    commandMetadata: { name: "forward", arity: 1, kind: "primitive" },
    events: [],
    diagnostics: [diagnostic],
    level: "3",
  };
  const output = OL.debug(context);
  assert.equal(
    output.segments.at(-1),
    "Look at what `forward` receives here and compare it with what `forward` expects.",
  );
});

test("debug ignores an error-severity diagnostic whose code is not a stable ol-* code", () => {
  const { ast: program } = Parser.parse("forward 80", "main.logo");
  const diagnostic = {
    code: "not-a-real-code",
    source_span: program.body[0].source_span,
    params: {},
    message: "This should never be cited.",
    stage: "runtime",
    severity: "error",
  };
  const context = {
    command: "debug",
    program,
    target: program.body[0],
    events: [],
    diagnostics: [diagnostic],
    level: "3",
  };
  const output = OL.debug(context);
  assert.equal(output.diagnostic_code, undefined);
  assert.ok(output.segments.at(-1).includes("No error is associated"));
});

test("debug still cites the only ol-* error when no target is selected at all", () => {
  const source = ':size = "big"\nforward :size';
  const { events, diagnostics } = Runtime.execute(source, "main.logo");
  const context = {
    command: "debug",
    program: Parser.parse(source, "main.logo").ast,
    target: undefined,
    events,
    diagnostics,
    level: "3",
  };
  const output = OL.debug(context);
  assert.equal(output.segments[0], "You're looking at the whole program.");
  assert.equal(output.diagnostic_code, "ol-type");
});

test("debug matches a diagnostic whose span exactly equals the target's own span", () => {
  const { ast: program } = Parser.parse("forward 80", "main.logo");
  const diagnostic = {
    code: "ol-type",
    source_span: program.body[0].source_span,
    params: { expected: "number", actual: "word" },
    message: "forward needs a number, but got a word.",
    stage: "runtime",
    severity: "error",
  };
  const context = {
    command: "debug",
    program,
    target: program.body[0],
    events: [],
    diagnostics: [diagnostic],
    level: "3",
  };
  const output = OL.debug(context);
  assert.equal(output.diagnostic_code, "ol-type");
});

test("debug's span containment reaches across a multi-line block to the failing sub-expression", () => {
  const source = "repeat 2\n  forward :missing\nend repeat";
  const { ast: program } = Parser.parse(source, "main.logo");
  const { events, diagnostics } = Runtime.execute(source, "main.logo");
  const context = {
    command: "debug",
    program,
    target: program.body[0],
    events,
    diagnostics,
    level: "3",
  };
  const output = OL.debug(context);
  assert.equal(output.diagnostic_code, "ol-undefined-var");
});

test("debug does not attribute a diagnostic to a target that starts after it in the same document", () => {
  const source = "forward :missing\nright 90";
  const { ast: program } = Parser.parse(source, "main.logo");
  const { events, diagnostics } = Runtime.execute(source, "main.logo");
  const context = {
    command: "debug",
    program,
    target: program.body[1],
    events,
    diagnostics,
    level: "3",
  };
  const output = OL.debug(context);
  // `target` (the second statement) doesn't contain the first statement's error, so `debug`
  // reports no error for it rather than misattributing an unrelated failure.
  assert.equal(output.diagnostic_code, undefined);
  assert.ok(output.segments.at(-1).includes("No error is associated"));
});

test("debug does not attribute a diagnostic to an earlier target in the same document", () => {
  const source = ':size = "big"\nforward :size';
  const { ast: program } = Parser.parse(source, "main.logo");
  const { events, diagnostics } = Runtime.execute(source, "main.logo");
  const context = {
    command: "debug",
    program,
    target: program.body[0],
    events,
    diagnostics,
    level: "3",
  };
  const output = OL.debug(context);
  assert.equal(output.diagnostic_code, undefined);
  assert.ok(output.segments.at(-1).includes("No error is associated"));
});

test("debug reports a variable segment without a type-mismatch phrase when the diagnostic carries no expected/actual params", () => {
  const source = ":size = 10\n:size";
  const { ast: program } = Parser.parse(source, "main.logo");
  const diagnostic = {
    code: "ol-undefined-var",
    source_span: program.body[1].source_span,
    params: { name: "size" },
    message: "`:size` has no value yet.",
    stage: "runtime",
    severity: "error",
  };
  const context = {
    command: "debug",
    program,
    target: program.body[1],
    events: [],
    diagnostics: [diagnostic],
    level: "3",
  };
  const output = OL.debug(context);
  assert.equal(output.segments[1], "Variables used here: `:size`.");
});

test("debug reports a generic variable list, never a shared type-mismatch phrase, when more than one variable is in play", () => {
  const { ast: program } = Parser.parse("(print :a :b)", "main.logo");
  const diagnostic = {
    code: "ol-type",
    source_span: program.body[0].source_span,
    params: { expected: "number", actual: "word", operation: "print" },
    message: "print needs a number, but got a word.",
    stage: "runtime",
    severity: "error",
  };
  const context = {
    command: "debug",
    program,
    target: program.body[0],
    events: [],
    diagnostics: [diagnostic],
    level: "3",
  };
  const output = OL.debug(context);
  // A diagnostic's `expected`/`actual` describes exactly one failing value, so with more than one
  // variable in play `debug` must not claim every one of them holds the same wrong type — it only
  // pluralizes the generic listing and the next-step suggestion, both of which state no fact.
  assert.equal(output.segments[1], "Variables used here: `:a` and `:b`.");
  assert.match(
    output.segments.at(-1),
    /Try tracing back where `:a` and `:b` get their values before this line runs\./,
  );
});

test("debug reports a lone turtle-state field (heading only) when only a turn event was traced", () => {
  const context = contextFromSource("right 90", {});
  const output = OL.debug(context);
  const turtleSegment = output.segments.find((segment) =>
    segment.startsWith("Turtle state so far:"),
  );
  assert.equal(turtleSegment, "Turtle state so far: heading 90.");
});

test("debug's next-step suggestion has a fully generic fallback when there is an error, no variable, and no commandMetadata", () => {
  const { ast: program } = Parser.parse("forward 80", "main.logo");
  const diagnostic = {
    code: "ol-type",
    source_span: program.body[0].source_span,
    params: {},
    message: "forward needs a number, but got something else.",
    stage: "runtime",
    severity: "error",
  };
  const context = {
    command: "debug",
    program,
    target: program.body[0],
    events: [],
    diagnostics: [diagnostic],
    level: "3",
  };
  const output = OL.debug(context);
  assert.equal(
    output.segments.at(-1),
    "Look closely at this line's inputs and compare them with what it expects.",
  );
});
