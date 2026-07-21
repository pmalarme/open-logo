import assert from "node:assert/strict";
import { test } from "node:test";
import * as Core from "@openlogo/core";
import { explain, why } from "@openlogo/edu";
import * as Parser from "@openlogo/parser";

/**
 * Unit tests for the M3 A3 (#336) deterministic `explain`/`why` baseline meta-commands
 * (`spec/educational-model.md#explain`, `#why`). Pure functions over a constructed
 * `TutorContext` (A0, #324) — proving byte-identical, offline, template-based behavior per
 * `spec/conformance.md#educational` without any parser/runtime dispatch wiring (that lands in
 * A1/A2). Verified against the built `@openlogo/edu` entry point, per the shared black-box
 * convention.
 */

const doc = "main.logo";

function parse(source) {
  const { ast, diagnostics } = Parser.parse(source, doc);
  assert.deepEqual(diagnostics, [], `expected a clean parse for ${source}`);
  return ast;
}

function baseContext(overrides = {}) {
  const program = parse("forward 80");
  return {
    command: "explain",
    program,
    events: [],
    diagnostics: [],
    level: "1",
    ...overrides,
  };
}

test("explain: names a known primitive from commandMetadata, describing inputs/effect/level", () => {
  const program = parse("forward 80");
  const context = baseContext({
    program,
    target: program.body[0],
    commandMetadata: { name: "forward", arity: 1, kind: "primitive" },
    level: "1",
  });

  const output = explain(context);

  assert.equal(output.command, "explain");
  assert.deepEqual(output.target_source_span, program.body[0].source_span);
  assert.equal(output.segments[0], "`forward` is a built-in command.");
  assert.match(output.segments[1], /how far to move/);
  assert.match(output.segments[2], /moves the turtle forward/);
  assert.match(output.segments[3], /level 1 of the curriculum/);
});

test("explain: same context always produces byte-identical output (determinism)", () => {
  const program = parse("forward 80");
  const context = baseContext({
    program,
    target: program.body[0],
    commandMetadata: { name: "forward", arity: 1, kind: "primitive" },
  });

  assert.deepEqual(explain(context), explain(context));
});

test("explain: names a special form via commandMetadata (kind special-form)", () => {
  const program = parse("repeat 4 [ forward 80 right 90 ]");
  const context = baseContext({
    program,
    target: program.body[0],
    commandMetadata: { name: "repeat", arity: 1, kind: "special-form" },
    level: "2",
  });

  const output = explain(context);
  assert.equal(output.segments[0], "`repeat` is a special form.");
  assert.match(output.segments[2], /runs its block a fixed number of times/);
  assert.match(output.segments[3], /level 2 of the curriculum/);
});

test("explain: names a learner-defined procedure via commandMetadata (kind procedure, unknown name)", () => {
  const program = parse("define square :size\n forward :size\nend\nsquare 100");
  const context = baseContext({
    program,
    target: program.body[1],
    commandMetadata: { name: "square", arity: 1, kind: "procedure" },
    level: "5",
  });

  const output = explain(context);
  assert.equal(
    output.segments[0],
    "`square` is a procedure the learner defined.",
  );
  assert.match(output.segments[2], /runs the `square` instruction/);
});

test("explain: falls back to the AST node kind for a special form with no commandMetadata (Repeat)", () => {
  const program = parse("repeat 4 [ forward 80 right 90 ]");
  const context = baseContext({
    program,
    target: program.body[0],
    level: "2",
  });

  const output = explain(context);
  assert.equal(output.segments[0], "`repeat` is a special form.");
});

test("explain: falls back to the AST node kind for If/While/Forever/ProcedureDef/Return/Local/Assign", () => {
  const cases = [
    { source: "if true [ forward 1 ]", name: "if" },
    { source: "while true [ forward 1 ]", name: "while" },
    { source: "forever [ forward 1 ]", name: "forever" },
    { source: "define square :size\n forward :size\nend", name: "define" },
    { source: "define f\n return 1\nend", name: "return" },
    { source: "local x", name: "local" },
    { source: ":x = 1", name: "set" },
  ];

  for (const { source, name } of cases) {
    const program = parse(source);
    const target =
      name === "return" ? program.body[0].body.body[0] : program.body[0];
    const context = baseContext({ program, target, level: "5" });
    const output = explain(context);
    assert.equal(
      output.segments[0],
      `\`${name}\` is a special form.`,
      `expected ${name} for ${source}`,
    );
  }
});

test("explain: resolves a Call node's name from its callee when no commandMetadata is supplied", () => {
  const program = parse("forward 80");
  const context = baseContext({ program, target: program.body[0] });

  const output = explain(context);
  assert.equal(output.segments[0], "`forward` is a built-in command.");
});

test("explain: prefers a Call node's canonical name over its surface Heritage spelling", () => {
  const program = parse("forward 80");
  const call = program.body[0];
  const heritageTarget = {
    ...call,
    callee: { ...call.callee, name: "fd" },
    canonical: "forward",
  };
  const context = baseContext({ program, target: heritageTarget });

  const output = explain(context);
  assert.equal(output.segments[0], "`forward` is a built-in command.");
});

test("explain: an unknown special form (via commandMetadata) gets an honest generic special-form description", () => {
  const program = parse("forward 80");
  const context = baseContext({
    program,
    target: program.body[0],
    commandMetadata: {
      name: "mystery_form",
      arity: 0,
      kind: "special-form",
    },
  });

  const output = explain(context);
  assert.equal(output.segments[0], "`mystery_form` is a special form.");
  assert.equal(
    output.segments[2],
    "Running it runs the `mystery_form` instruction.",
  );
});

test("explain: an unknown primitive name gets an honest generic description", () => {
  const program = parse("(mystery_command 1 2)");
  const context = baseContext({ program, target: program.body[0] });

  const output = explain(context);
  assert.equal(output.segments[0], "`mystery_command` is a built-in command.");
  assert.equal(output.segments[1], "Its input is its inputs, as written.");
  assert.equal(
    output.segments[2],
    "Running it runs the `mystery_command` instruction.",
  );
});

test("explain: a learner-defined procedure named like an Object.prototype member (e.g. `constructor`) still gets the honest generic description, not an inherited value", () => {
  const program = parse("(constructor 1)");
  const context = baseContext({ program, target: program.body[0] });

  const output = explain(context);
  assert.equal(output.segments[0], "`constructor` is a built-in command.");
  assert.equal(output.segments[1], "Its input is its inputs, as written.");
  assert.equal(
    output.segments[2],
    "Running it runs the `constructor` instruction.",
  );
});

test("explain: whole-program fallback counts statements when no single instruction is targeted (no target given)", () => {
  const program = parse("forward 80\nright 90");
  const context = baseContext({ program, level: "1" });

  const output = explain(context);
  assert.equal(output.target_source_span, undefined);
  assert.equal(
    output.segments[0],
    "This part of the program runs 2 steps in order.",
  );
  assert.match(output.segments[1], /level 1 of the curriculum/);
});

test("explain: whole-program fallback uses singular 'step' for exactly one statement", () => {
  const program = parse("forward 80");
  const context = baseContext({ program });

  const output = explain(context);
  assert.equal(
    output.segments[0],
    "This part of the program runs 1 step in order.",
  );
});

test("explain: a Block target also uses the statement-count fallback", () => {
  const program = parse("repeat 4 [ forward 80 right 90 ]");
  const block = program.body[0].body;
  assert.equal(block.kind, "Block");
  const context = baseContext({ program, target: block });

  const output = explain(context);
  assert.equal(
    output.segments[0],
    "This part of the program runs 2 steps in order.",
  );
  assert.deepEqual(output.target_source_span, block.source_span);
});

test("explain: a non-instruction, non-block target (e.g. a literal) says there is no single command to name", () => {
  const program = parse("forward 80");
  const numberLiteral = program.body[0].args[0];
  assert.equal(numberLiteral.kind, "NumberLit");
  const context = baseContext({ program, target: numberLiteral });

  const output = explain(context);
  assert.equal(
    output.segments[0],
    "This selection is not a single instruction, so there is no one command to name.",
  );
  assert.deepEqual(output.target_source_span, numberLiteral.source_span);
});

test("explain: every learner level produces a level sentence naming that level", () => {
  for (const level of [
    "1",
    "2",
    "3",
    "4",
    "5",
    "6",
    "7a",
    "7b",
    "7c",
    "8a",
    "8b",
  ]) {
    const program = parse("forward 80");
    const context = baseContext({ program, target: program.body[0], level });
    const output = explain(context);
    const last = output.segments[output.segments.length - 1];
    assert.match(last, new RegExp(`level ${level} of the curriculum`));
  }
});

test("why: explains an ol-* diagnostic matching the selected target", () => {
  const program = parse("forward :missing");
  const target = program.body[0];
  const diagnostic = {
    code: "ol-undefined-var",
    source_span: target.source_span,
    params: {},
    message: "`:missing` has no value yet.",
    stage: "semantic",
    severity: "error",
  };
  assert.ok(Core.isDiagnosticCode(diagnostic.code));

  const context = baseContext({
    program,
    target,
    command: "why",
    diagnostics: [diagnostic],
  });

  const output = why(context);
  assert.equal(output.command, "why");
  assert.equal(output.diagnostic_code, "ol-undefined-var");
  assert.deepEqual(output.target_source_span, target.source_span);
  assert.equal(output.segments[0], "`:missing` has no value yet.");
  assert.equal(output.segments[1], "Diagnostic: `ol-undefined-var`.");
});

test("why: explains a diagnostic whose own span is nested inside the selected instruction (not an exact match)", () => {
  const program = parse("forward :missing");
  const target = program.body[0];
  const nestedSpan = target.args[0].source_span;
  assert.notDeepEqual(nestedSpan, target.source_span);
  const diagnostic = {
    code: "ol-undefined-var",
    source_span: nestedSpan,
    params: {},
    message: "`:missing` has no value yet.",
    stage: "semantic",
    severity: "error",
  };

  const context = baseContext({
    program,
    target,
    command: "why",
    diagnostics: [diagnostic],
  });

  const output = why(context);
  assert.equal(output.diagnostic_code, "ol-undefined-var");
  assert.deepEqual(output.target_source_span, nestedSpan);
});

test("why: with no target selected, explains the most recent ol-* diagnostic", () => {
  const program = parse("forward 1\nforward :missing");
  const diagnosticOne = {
    code: "ol-type",
    source_span: program.body[0].source_span,
    params: {},
    message: "first",
    stage: "semantic",
    severity: "error",
  };
  const diagnosticTwo = {
    code: "ol-undefined-var",
    source_span: program.body[1].source_span,
    params: {},
    message: "second",
    stage: "semantic",
    severity: "error",
  };

  const context = baseContext({
    program,
    command: "why",
    diagnostics: [diagnosticOne, diagnosticTwo],
  });

  const output = why(context);
  assert.equal(output.diagnostic_code, "ol-undefined-var");
  assert.equal(output.segments[0], "second");
});

test("why: style-lint-only diagnostics never trigger the diagnostic arm", () => {
  const program = parse("forward 80");
  const target = program.body[0];
  const styleDiagnostic = {
    code: "ol-style-block-indentation",
    source_span: target.source_span,
    params: {},
    message: "style nit",
    stage: "semantic",
    severity: "warning",
  };
  assert.ok(!Core.isDiagnosticCode(styleDiagnostic.code));

  const context = baseContext({
    program,
    target,
    command: "why",
    diagnostics: [styleDiagnostic],
  });

  const output = why(context);
  assert.equal(output.diagnostic_code, undefined);
});

test("why: a target with diagnostics present but none matching its span falls through to the event/no-event path", () => {
  const program = parse("forward 1\nforward 2");
  const other = {
    code: "ol-type",
    source_span: program.body[0].source_span,
    params: {},
    message: "unrelated",
    stage: "semantic",
    severity: "error",
  };
  const context = baseContext({
    program,
    target: program.body[1],
    command: "why",
    diagnostics: [other],
  });

  const output = why(context);
  assert.equal(output.diagnostic_code, undefined);
  assert.match(output.segments[0], /has not run yet/);
});

test("why: with no matching event and a resolved command, says that command has not run yet", () => {
  const program = parse("forward 80");
  const context = baseContext({
    program,
    target: program.body[0],
    command: "why",
    commandMetadata: { name: "forward", arity: 1, kind: "primitive" },
  });

  const output = why(context);
  assert.equal(
    output.segments[0],
    "`forward` has not run yet, so there is no recorded state to explain.",
  );
});

test("why: with no matching event and no resolvable command, gives a generic no-state message", () => {
  const program = parse("forward 80");
  const numberLiteral = program.body[0].args[0];
  const context = baseContext({
    program,
    target: numberLiteral,
    command: "why",
  });

  const output = why(context);
  assert.equal(
    output.segments[0],
    "Nothing has run yet, so there is no recorded state to explain.",
  );
});

function makeEvent(kind, payload, sourceSpan) {
  return { seq: 1, kind, source_span: sourceSpan, payload };
}

test("why: explains a matching `move` event and names the causing instruction", () => {
  const program = parse("forward 80");
  const target = program.body[0];
  const event = makeEvent(
    "move",
    { from: [0, 0], to: [0, 80], heading: 0 },
    target.source_span,
  );
  const context = baseContext({
    program,
    target,
    command: "why",
    events: [event],
    commandMetadata: { name: "forward", arity: 1, kind: "primitive" },
  });

  const output = why(context);
  assert.equal(output.segments[0], "The turtle moved from (0, 0) to (0, 80).");
  assert.equal(output.segments[1], "This happened because `forward` ran.");
});

test("why: a target with events present but none matching its span says that command has not run yet", () => {
  const program = parse("forward 1\nforward 2");
  const unrelatedEvent = makeEvent(
    "move",
    { from: [0, 0], to: [0, 1], heading: 0 },
    program.body[0].source_span,
  );
  const context = baseContext({
    program,
    target: program.body[1],
    command: "why",
    events: [unrelatedEvent],
    commandMetadata: { name: "forward", arity: 1, kind: "primitive" },
  });

  const output = why(context);
  assert.equal(
    output.segments[0],
    "`forward` has not run yet, so there is no recorded state to explain.",
  );
});

test("why: with no target selected, resolves the causing instruction from the most recent event's own span", () => {
  const program = parse("forward 80\nright 90");
  const moveEvent = makeEvent(
    "move",
    { from: [0, 0], to: [0, 80], heading: 0 },
    program.body[0].source_span,
  );
  const turnEvent = makeEvent(
    "turn",
    { from: 0, to: 90 },
    program.body[1].source_span,
  );
  const context = baseContext({
    program,
    command: "why",
    events: [moveEvent, turnEvent],
  });

  const output = why(context);
  assert.equal(
    output.segments[0],
    "The turtle's heading changed from 0 to 90 degrees.",
  );
  assert.equal(output.segments[1], "This happened because `right` ran.");
  assert.deepEqual(output.target_source_span, program.body[1].source_span);
});

test("why: with no target selected and no AST node matching the event's span, gives a generic cause", () => {
  const program = parse("forward 80");
  const event = makeEvent(
    "move",
    { from: [0, 0], to: [0, 80], heading: 0 },
    Core.makeSpan(doc, [9, 1], [9, 2]),
  );
  const context = baseContext({
    program,
    command: "why",
    events: [event],
  });

  const output = why(context);
  assert.equal(
    output.segments[1],
    "This happened because the selected instruction ran.",
  );
  assert.equal(output.target_source_span, undefined);
});

test("why: describes every known trace-event kind", () => {
  const span = Core.makeSpan(doc, [1, 1], [1, 2]);
  const cases = [
    [
      makeEvent(
        "draw-segment",
        { from: [0, 0], to: [0, 80], color: "black", width: 1 },
        span,
      ),
      /drew a black line, width 1, from \(0, 0\) to \(0, 80\)/,
    ],
    [
      makeEvent("pen-change", { from: "up", to: "down" }, span),
      /pen changed to down/,
    ],
    [
      makeEvent("width-change", { from: 1, to: 3 }, span),
      /pen width changed to 3/,
    ],
    [
      makeEvent("color-change", { from: "black", to: "red" }, span),
      /pen color changed from black to red/,
    ],
    [
      makeEvent("background-change", { color: "blue" }, span),
      /background color changed to blue/,
    ],
    [makeEvent("print", { values: [1, "hi"] }, span), /OpenLogo showed 1, hi/],
    [makeEvent("return", { value: 5 }, span), /procedure answered 5/],
    [
      makeEvent("procedure-enter", { name: "square", args: [10] }, span),
      /`square` started with 10/,
    ],
    [
      makeEvent("procedure-enter", { name: "home", args: [] }, span),
      /`home` started with no arguments/,
    ],
    [
      makeEvent("procedure-exit", { name: "square", result: null }, span),
      /`square` finished without answering a value/,
    ],
    [
      makeEvent("procedure-exit", { name: "square", result: 4 }, span),
      /`square` finished and answered 4/,
    ],
    [
      makeEvent("clear", { mode: "clear_screen" }, span),
      /cleared \(clear_screen\)/,
    ],
    [makeEvent("fill", { color: "red" }, span), /A `fill` change happened/],
  ];

  const program = parse("forward 80");

  for (const [event, pattern] of cases) {
    const context = baseContext({
      program,
      command: "why",
      events: [event],
    });
    const output = why(context);
    assert.match(output.segments[0], pattern, `event kind ${event.kind}`);
  }
});

test("why: same context always produces byte-identical output (determinism)", () => {
  const program = parse("forward 80");
  const target = program.body[0];
  const event = makeEvent(
    "move",
    { from: [0, 0], to: [0, 80], heading: 0 },
    target.source_span,
  );
  const context = baseContext({
    program,
    target,
    command: "why",
    events: [event],
    commandMetadata: { name: "forward", arity: 1, kind: "primitive" },
  });

  assert.deepEqual(why(context), why(context));
});
