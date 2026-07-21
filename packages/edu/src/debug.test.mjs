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
      "ran without an error",
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
  for (const segment of output.segments) {
    // A full OpenLogo solution would need at least one newline-separated block of multiple
    // instructions; every `debug` segment here is a single learner-facing sentence.
    assert.ok(!segment.includes("\n"));
  }
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

test("debug falls back to the first ol-* error when the target selects no diagnostic exactly", () => {
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
  assert.equal(output.diagnostic_code, "ol-undefined-var");
  assert.equal(
    output.segments.at(-2),
    "Diagnostic `ol-undefined-var`: `:ghost` has no value yet.",
  );
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
  assert.ok(output.segments.at(-1).includes("ran without an error"));
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
  assert.ok(output.segments.at(-1).includes("ran without an error"));
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

test("debug does not match a diagnostic against a target that starts after it in the same document", () => {
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
  // Falls back to the only ol-* error even though `target` (the second statement) doesn't
  // contain it, since `errorDiagnostics[0]` is the fallback rather than reporting nothing.
  assert.equal(output.diagnostic_code, "ol-undefined-var");
});

test("debug does not match a diagnostic against an earlier target in the same document", () => {
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
  assert.equal(output.diagnostic_code, "ol-type");
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

test("debug pluralizes the variable-value and next-step phrasing when more than one variable is in play", () => {
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
  assert.match(
    output.segments[1],
    /`:a` and `:b` currently hold a `word` value, but this line needs a `number`\./,
  );
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
