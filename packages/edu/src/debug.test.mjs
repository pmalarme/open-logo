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
 * locked the blend in; these widen it to the multi-turtle cases it left open.
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
  const segment = turtleStateOf(
    ':a = new_turtle\n:b = new_turtle\nask :a [ forward 30 set_color "red" ]\nask :b [ right 90 forward 10 set_width 7 ]\ntell [ :a :b ]',
  );
  assert.equal(
    segment,
    "Turtle state so far: turtle 1 — position (0, 30), heading 0, color `red`; " +
      "turtle 2 — position (10, 6.123233995736766e-16), heading 90, width 7.",
  );
  // The blend was not merely incomplete, it was a state no turtle had: :a's color never belonged
  // with :b's width on one turtle.
  assert.ok(!/color `red`, width 7/.test(segment));
});

test("debug reports a position per addressed turtle when one command moved them all", () => {
  // The issue's headline symptom: `tell [ :a :b ]` + a single `forward` moves two turtles to two
  // different places (:a was pre-turned), and `debug` used to report only the last one.
  assert.equal(
    turtleStateOf(
      ":a = new_turtle\n:b = new_turtle\nask :a [ right 90 ]\ntell [ :a :b ]\nforward 10",
    ),
    "Turtle state so far: turtle 1 — position (10, 6.123233995736766e-16), heading 90; " +
      "turtle 2 — position (0, 10), heading 0.",
  );
});

test("debug's turtle state does not depend on the order the turtles were addressed in", () => {
  // `spec/turtles-and-sprites.md:113`: "the result never depends on the order the turtles were
  // listed in: `tell [ :a :b ]` and `tell [ :b :a ]` home the same two turtles". Those two forms
  // genuinely emit their per-turtle events in OPPOSITE orders, so reporting the turtle that acted
  // last — the obvious alternative to reporting per turtle — would make `debug` contradict this.
  const program = (order) =>
    `:a = new_turtle\n:b = new_turtle\nask :a [ right 90 ]\ntell [ ${order} ]\nforward 10`;
  assert.equal(
    turtleStateOf(program(":a :b")),
    turtleStateOf(program(":b :a")),
  );
});

test("debug reports every addressed turtle a clear_screen homed, not just one", () => {
  // The multi-turtle widening of the single-turtle homing test above: `clear_screen` homes EVERY
  // addressed turtle (issue #889), and each homing arrives as that turtle's own `move`/`turn`.
  assert.equal(
    turtleStateOf(
      ":a = new_turtle\n:b = new_turtle\nask :a [ forward 30 ]\nask :b [ right 90 forward 10 ]\ntell [ :a :b ]\nclear_screen",
    ),
    "Turtle state so far: turtle 1 — position (0, 0), heading 0; " +
      "turtle 2 — position (0, 0), heading 0.",
  );
});

test("debug names the turtle even when only one is addressed", () => {
  // With an identity in the trace, `debug` reports it: :113's requirement exists so `debug` can say
  // WHICH turtle, and that answer is useful before a second turtle exists.
  assert.equal(
    turtleStateOf(":a = new_turtle\ntell [ :a ]\nforward 30"),
    "Turtle state so far: turtle 1 — position (0, 30), heading 0.",
  );
});

test("debug treats turtle 0 as a real identity, not as an unaddressed turtle", () => {
  // The main turtle's id is `0`. `tell [ who ]` addresses it explicitly, so its events carry
  // `turtle_id: 0` — and a falsy identity check (`if (event.turtle_id)`) would silently file them
  // under the unaddressed default and report the pre-#891 unnamed wording.
  assert.equal(
    turtleStateOf("tell [ who ]\nforward 5"),
    "Turtle state so far: turtle 0 — position (0, 5), heading 0.",
  );
});

test("debug keeps the unaddressed default turtle distinct from an addressed one", () => {
  // `:friend` moves under `ask` (so its events carry its id); the trailing `forward 3` runs with no
  // explicit addressing in force, so its event carries NO id — `spec/turtles-and-sprites.md`'s
  // "single default turtle". The old fold blended the two into `position (0, 3)`, losing :friend
  // entirely. `debug` must not invent an id for the unattributed one: the spec pins none.
  assert.equal(
    turtleStateOf(":friend = new_turtle\nask :friend [ forward 7 ]\nforward 3"),
    "Turtle state so far: the turtle — position (0, 3), heading 0; " +
      "turtle 1 — position (0, 7), heading 0.",
  );
});

test("debug keeps the unnamed wording for a program with no turtle identities at all", () => {
  // The whole non-Sprites world: no `tell`/`ask`/`each`, so no event carries a `turtle_id` and
  // there is no identity to report. This wording must stay byte-identical to the pre-#891 output.
  assert.equal(
    turtleStateOf("forward 30\nright 90"),
    "Turtle state so far: position (0, 30), heading 90.",
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
    "Turtle state so far: turtle 1 — position (0, 10), heading 0; " +
      "turtle 2 — position (0, 10), heading 0; " +
      "turtle 3 — position (0, 10), heading 0.",
  );
});

test("debug reports the default turtle twice when it is later addressed by id, rather than inventing its identity", () => {
  // The accepted consequence documented on `turtleStateSegment`. `forward 10` runs with no explicit
  // addressing, so its event carries no `turtle_id`; `tell [ who ]` then addresses that SAME turtle
  // explicitly, so `forward 5` carries `turtle_id: 0`. Nothing in the stream says the two are one
  // turtle, and `spec/turtles-and-sprites.md` pins no id for "the single default turtle" — so
  // merging them would have `debug` assert a fact it was never given. Pinned so the trade-off is
  // decided and visible, not accidental.
  assert.equal(
    turtleStateOf("forward 10\ntell [ who ]\nforward 5"),
    "Turtle state so far: the turtle — position (0, 10), heading 0; " +
      "turtle 0 — position (0, 15), heading 0.",
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
    "Turtle state so far: turtle 1 — pen up; turtle 2 — color `blue`.",
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
