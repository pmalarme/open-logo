import assert from "node:assert/strict";
import { test } from "node:test";
import { execute, RUNTIME_PACKAGE } from "@openlogo/runtime";

test("RUNTIME_PACKAGE marker export is still present", () => {
  assert.equal(RUNTIME_PACKAGE, "@openlogo/runtime");
});

test("execute emits an instruction event, then a print event, per print statement", () => {
  const result = execute("print 1\nprint 2", "main.logo");

  assert.equal(result.diagnostics.length, 0);
  assert.equal(result.events.length, 4);

  assert.deepEqual(result.events[0], {
    seq: 0,
    kind: "instruction",
    source_span: {
      document: "main.logo",
      start: [1, 1],
      end: [1, 8],
    },
    payload: { statement_kind: "Call" },
  });
  assert.deepEqual(result.events[1], {
    seq: 1,
    kind: "print",
    source_span: {
      document: "main.logo",
      start: [1, 1],
      end: [1, 8],
    },
    payload: { values: [1] },
  });
  assert.deepEqual(result.events[2].payload, { statement_kind: "Call" });
  assert.equal(result.events[2].seq, 2);
  assert.deepEqual(result.events[3], {
    seq: 3,
    kind: "print",
    source_span: {
      document: "main.logo",
      start: [2, 1],
      end: [2, 8],
    },
    payload: { values: [2] },
  });
});

test("execute emits no events for an empty program", () => {
  const result = execute("", "main.logo");
  assert.deepEqual(result.events, []);
  assert.deepEqual(result.diagnostics, []);
});

test("execute returns no events and the parse diagnostics for malformed source", () => {
  const result = execute("]", "main.logo");
  assert.deepEqual(result.events, []);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-unmatched-bracket");
});

test("execute assigns a monotonic seq starting at 0 across statement kinds", () => {
  const result = execute(":x = 1\nprint :x\nrepeat 1 [ print 1 ]", "main.logo");
  assert.equal(result.diagnostics.length, 0);
  // `:x = 1` (Assign, no event beyond its instruction), `print :x` (instruction + print, since
  // `:x` is now a supported read), `repeat 1 [ print 1 ]` (instruction only — repeat bodies are
  // a later slice).
  assert.equal(result.events.length, 4);
  assert.deepEqual(
    result.events.map((event) => event.seq),
    [0, 1, 2, 3],
  );
  assert.deepEqual(
    result.events.map((event) => event.kind),
    ["instruction", "instruction", "print", "instruction"],
  );
  assert.deepEqual(result.events[2].payload, { values: [1] });
  const instructionKinds = result.events
    .filter((event) => event.kind === "instruction")
    .map((event) => event.payload.statement_kind);
  assert.deepEqual(instructionKinds, ["Assign", "Call", "Repeat"]);
});

test("execute evaluates an arithmetic print argument, per issue #93", () => {
  const result = execute("print 2 + 3 * 4", "main.logo");
  assert.equal(result.diagnostics.length, 0);
  assert.equal(result.events.length, 2);
  assert.equal(result.events[0].kind, "instruction");
  assert.deepEqual(result.events[1], {
    seq: 1,
    kind: "print",
    source_span: result.events[0].source_span,
    payload: { values: [14] },
  });
});

test("execute stops and returns the diagnostic when a print argument fails to evaluate", () => {
  const result = execute("print 1\nprint 1 / 0\nprint 3", "main.logo");
  // The first print's instruction + print events are kept; the second statement's instruction
  // event is kept too (it always runs before its argument is evaluated), but evaluation halts
  // there — no third print event, no third statement's events, and the diagnostic is returned.
  assert.equal(result.events.length, 3);
  assert.deepEqual(
    result.events.map((event) => event.kind),
    ["instruction", "print", "instruction"],
  );
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-div-zero");
});

test("execute evaluates a parenthesized `(print value)` call the same as the plain form", () => {
  // `(print 1 + 2)` parses as a top-level `ParenCall`, not `Call` — the parenthesized command
  // form must be handled identically to the plain infix form (`print 1 + 2`).
  const result = execute("(print 1 + 2)", "main.logo");
  assert.equal(result.diagnostics.length, 0);
  assert.equal(result.events.length, 2);
  assert.deepEqual(result.events[0], {
    seq: 0,
    kind: "instruction",
    source_span: {
      document: "main.logo",
      start: [1, 1],
      end: [1, 14],
    },
    payload: { statement_kind: "ParenCall" },
  });
  assert.deepEqual(result.events[1], {
    seq: 1,
    kind: "print",
    source_span: {
      document: "main.logo",
      start: [1, 1],
      end: [1, 14],
    },
    payload: { values: [3] },
  });
});

test("execute leaves an unsupported print argument un-evaluated, emitting no print event", () => {
  // A dotted `.field` place segment is Data/record-profile and deferred (issue #94 covers only
  // the `index` selector), so `:ages.tom` stays unsupported the same way `:x` did before #94.
  const result = execute("print :ages.tom", "main.logo");
  assert.equal(result.diagnostics.length, 0);
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].kind, "instruction");
});

test("execute evaluates the variadic `(print a b …)` form, carrying every value in order", () => {
  const result = execute('(print "a" "b" "c")', "main.logo");
  assert.equal(result.diagnostics.length, 0);
  assert.equal(result.events.length, 2);
  assert.equal(result.events[0].kind, "instruction");
  assert.deepEqual(result.events[1].payload, { values: ["a", "b", "c"] });
});

test("execute carries a boolean and a list value on a print event", () => {
  const result = execute("print true\nprint [1 [2 3]]", "main.logo");
  assert.equal(result.diagnostics.length, 0);
  assert.deepEqual(result.events[1].payload, { values: [true] });
  assert.deepEqual(result.events[3].payload, { values: [[1, [2, 3]]] });
});

test("execute leaves a variadic print un-evaluated when any one operand is unsupported", () => {
  // Every operand must be an expression kind this issue's evaluator supports — `:ages.tom` (a
  // dotted `.field` place, Data-profile and deferred) is not, so the whole `(print 1 :ages.tom)`
  // statement stays un-evaluated (only its `instruction` event fires), even though its first
  // operand (`1`) would evaluate cleanly on its own.
  const result = execute("(print 1 :ages.tom)", "main.logo");
  assert.equal(result.diagnostics.length, 0);
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].kind, "instruction");
});

test("execute stops mid-variadic-print when a later operand fails to evaluate", () => {
  const result = execute('(print 1 (1 / 0) "unreached")', "main.logo");
  // The `instruction` event fires (it always runs before its arguments are evaluated), but no
  // `print` event is emitted since not every operand evaluated cleanly.
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].kind, "instruction");
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-div-zero");
});

test("execute raises ol-not-enough-inputs for a bare zero-argument `print`", () => {
  // The static checker's arity rule (`ol-not-enough-inputs`) never runs inside `execute()` —
  // it only calls `parse()` — so this is the sole runtime guard against silently treating a
  // callee-only `print` as a no-op.
  const result = execute("print", "main.logo");
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].kind, "instruction");
  assert.equal(result.diagnostics.length, 1);
  assert.deepEqual(result.diagnostics[0], {
    code: "ol-not-enough-inputs",
    source_span: {
      document: "main.logo",
      start: [1, 1],
      end: [1, 6],
    },
    params: { callable: "print", expected: 1, actual: 0 },
    message: "print needs one input, but got 0.",
    stage: "runtime",
    severity: "error",
  });
});

test("execute raises ol-not-enough-inputs for a parenthesized zero-argument `(print)`", () => {
  // The checker's static arity rule cannot flag this either: `print`'s parenthesized ceiling is
  // `Infinity` (an open variadic), so its lower bound is deliberately left to the runtime.
  const result = execute("(print)", "main.logo");
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].kind, "instruction");
  assert.equal(result.diagnostics.length, 1);
  assert.deepEqual(result.diagnostics[0], {
    code: "ol-not-enough-inputs",
    source_span: {
      document: "main.logo",
      start: [1, 2],
      end: [1, 7],
    },
    params: { callable: "print", expected: 1, actual: 0 },
    message: "print needs one input, but got 0.",
    stage: "runtime",
    severity: "error",
  });
});

test("execute dispatches an `Assign` statement, making its binding visible to a later statement", () => {
  // `:x = 1` never emits its own event (issue #94: there is no dedicated event kind for
  // assignment) — only its `instruction` event fires — but the binding it creates is visible to
  // `print :x` in the very next statement, proving the root Environment is shared across
  // statements within one `execute()` call.
  const result = execute(":x = 1\nprint :x", "main.logo");
  assert.equal(result.diagnostics.length, 0);
  assert.equal(result.events.length, 3);
  assert.deepEqual(
    result.events.map((event) => event.kind),
    ["instruction", "instruction", "print"],
  );
  assert.deepEqual(result.events[2].payload, { values: [1] });
});

test("execute halts on an Assign failure, keeping only the events emitted so far", () => {
  // `first :nums = 1` assigns to a reporter call, not a place — `ol-not-a-place` — so execution
  // stops there: the failing statement's own `instruction` event is kept, but the `print`
  // statement after it never runs.
  const result = execute('first :nums = 1\nprint "unreached"', "main.logo");
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].kind, "instruction");
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-not-a-place");
  assert.deepEqual(result.diagnostics[0].params, { text: "first" });
});

// --- `if`/`while` execution (issue #100) ------------------------------------------------------

test("execute runs the then-branch of a bracketed `if` when the condition is true", () => {
  const result = execute("if true [ print 1 ]\nprint 2", "main.logo");
  assert.equal(result.diagnostics.length, 0);
  assert.deepEqual(
    result.events.map((event) => event.kind),
    ["instruction", "instruction", "print", "instruction", "print"],
  );
  assert.deepEqual(
    result.events.map((event) => event.payload),
    [
      { statement_kind: "If" },
      { statement_kind: "Call" },
      { values: [1] },
      { statement_kind: "Call" },
      { values: [2] },
    ],
  );
});

test("execute skips the then-branch of a bracketed `if` with no `else` when the condition is false", () => {
  const result = execute("if false [ print 1 ]\nprint 2", "main.logo");
  assert.equal(result.diagnostics.length, 0);
  assert.deepEqual(
    result.events.map((event) => event.kind),
    ["instruction", "instruction", "print"],
  );
  assert.deepEqual(result.events[2].payload, { values: [2] });
});

test("execute runs the else-branch of a bracketed `if` when the condition is false", () => {
  const result = execute("if false [ print 1 ] else [ print 2 ]", "main.logo");
  assert.equal(result.diagnostics.length, 0);
  assert.deepEqual(
    result.events.map((event) => event.kind),
    ["instruction", "instruction", "print"],
  );
  assert.deepEqual(result.events[2].payload, { values: [2] });
});

test("execute runs the long-form `if ... end if` identically to the bracketed form", () => {
  // Per `spec/grammar.md:119-124` the long-form body parses to the same `BlockNode` shape as the
  // bracketed body, so comparing event kinds/payloads (ignoring source spans, which necessarily
  // differ across the two distinct sources) proves the two forms execute identically.
  const bracketed = execute("if true [ print 1 ]", "main.logo");
  const longForm = execute("if true\n  print 1\nend if", "main.logo");
  const shape = (result) =>
    result.events.map((event) => ({
      kind: event.kind,
      payload: event.payload,
    }));
  assert.deepEqual(shape(bracketed), shape(longForm));
  assert.deepEqual(bracketed.diagnostics, longForm.diagnostics);
});

test("execute runs the long-form `if ... else ... end if` identically to the bracketed form", () => {
  const bracketed = execute(
    "if false [ print 1 ] else [ print 2 ]",
    "main.logo",
  );
  const longForm = execute(
    "if false\n  print 1\nelse\n  print 2\nend if",
    "main.logo",
  );
  const shape = (result) =>
    result.events.map((event) => ({
      kind: event.kind,
      payload: event.payload,
    }));
  assert.deepEqual(shape(bracketed), shape(longForm));
  assert.deepEqual(bracketed.diagnostics, longForm.diagnostics);
});

test("execute propagates a diagnostic raised while evaluating an `if` condition itself", () => {
  // `1 / 0` fails to evaluate (`ol-div-zero`), distinct from a non-boolean *value* — the
  // condition evaluation's own failure propagates via `evaluateCondition`'s `!result.ok` branch.
  const result = execute("if 1 / 0 [ print 1 ]", "main.logo");
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].payload.statement_kind, "If");
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-div-zero");
});

test("execute raises ol-not-boolean for a non-boolean `if` condition", () => {
  const result = execute("if 5 [ print 1 ]", "main.logo");
  // Only the `If` statement's own `instruction` event is kept — the condition failure stops
  // execution before the then-branch is ever reached.
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].payload.statement_kind, "If");
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-not-boolean");
  assert.equal(result.diagnostics[0].stage, "runtime");
  assert.deepEqual(result.diagnostics[0].params, {
    actual: "number",
    operation: "if",
  });
});

test("execute discards a trailing bare value inside an `if` body per the block-result rule", () => {
  // `spec/execution-model.md:214-227`: `if`/`while` bodies run for effect only, so `1 + 1`'s
  // value is silently discarded — no value-producing event, no diagnostic.
  const result = execute("if true [ 1 + 1 ]\nprint 2", "main.logo");
  assert.equal(result.diagnostics.length, 0);
  assert.deepEqual(
    result.events.map((event) => event.kind),
    ["instruction", "instruction", "instruction", "print"],
  );
  assert.deepEqual(
    result.events.map((event) => event.payload),
    [
      { statement_kind: "If" },
      { statement_kind: "Call" },
      { statement_kind: "Call" },
      { values: [2] },
    ],
  );
});

test("execute leaves an `if` with an unsupported condition expression un-evaluated", () => {
  // `:x is empty` is an `IsPredicate` — not yet in `isSupportedExpression`'s scope — so the whole
  // `if` (condition and body alike) is left un-evaluated for that expression kind's own future
  // slice, exactly like an unsupported `print` argument. No diagnostic; execution just continues.
  const result = execute(
    ':x = "a"\nif :x is empty [ print 1 ]\nprint 2',
    "main.logo",
  );
  assert.equal(result.diagnostics.length, 0);
  assert.deepEqual(
    result.events.map((event) => event.kind),
    ["instruction", "instruction", "instruction", "print"],
  );
  assert.deepEqual(result.events[3].payload, { values: [2] });
});

test("execute propagates a diagnostic raised inside an `if` branch, halting the whole program", () => {
  const result = execute(
    'if true [ print 1 / 0 ]\nprint "unreached"',
    "main.logo",
  );
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-div-zero");
  // The `If` instruction, the failing `print`'s own instruction — but no `print` event (the
  // division failed before the print event could be emitted) and no events after the `if`.
  assert.deepEqual(
    result.events.map((event) => event.kind),
    ["instruction", "instruction"],
  );
});

test("execute re-evaluates a `while` condition before every pass, running the body 3 times", () => {
  const result = execute(
    ":i = 0\nwhile :i < 3 [\n  print :i\n  :i = :i + 1\n]",
    "main.logo",
  );
  assert.equal(result.diagnostics.length, 0);
  const printedValues = result.events
    .filter((event) => event.kind === "print")
    .map((event) => event.payload.values[0]);
  assert.deepEqual(printedValues, [0, 1, 2]);
  // Assign, While, then 3x (Call + print + Assign) = 2 + 3*3 = 11 events.
  assert.equal(result.events.length, 11);
});

test("execute runs a `while` body zero times when the condition is false on the first check", () => {
  const result = execute("while false [ print 1 ]\nprint 2", "main.logo");
  assert.equal(result.diagnostics.length, 0);
  assert.deepEqual(
    result.events.map((event) => event.kind),
    ["instruction", "instruction", "print"],
  );
  assert.deepEqual(result.events[2].payload, { values: [2] });
});

test("execute propagates a diagnostic raised while evaluating a `while` condition itself", () => {
  const result = execute("while 1 / 0 [ print 1 ]", "main.logo");
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].payload.statement_kind, "While");
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-div-zero");
});

test("execute raises ol-not-boolean for a non-boolean `while` condition", () => {
  const result = execute("while 5 [ print 1 ]", "main.logo");
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].payload.statement_kind, "While");
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-not-boolean");
  assert.equal(result.diagnostics[0].stage, "runtime");
  assert.deepEqual(result.diagnostics[0].params, {
    actual: "number",
    operation: "while",
  });
});

test("execute leaves a `while` with an unsupported condition expression un-evaluated", () => {
  const result = execute(
    ':x = "a"\nwhile :x is empty [ print 1 ]\nprint 2',
    "main.logo",
  );
  assert.equal(result.diagnostics.length, 0);
  assert.deepEqual(
    result.events.map((event) => event.kind),
    ["instruction", "instruction", "instruction", "print"],
  );
  assert.deepEqual(result.events[3].payload, { values: [2] });
});

test("execute propagates a diagnostic raised inside a `while` body, halting the whole program", () => {
  const result = execute(
    'while true [ print 1 / 0 ]\nprint "unreached"',
    "main.logo",
  );
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-div-zero");
  assert.deepEqual(
    result.events.map((event) => event.kind),
    ["instruction", "instruction"],
  );
});

test("execute runs a nested `if` inside a `while` body, keeping the shared Environment threaded through", () => {
  const result = execute(
    ":i = 0\nwhile :i < 4 [\n  if :i < 2 [ print :i ]\n  :i = :i + 1\n]",
    "main.logo",
  );
  assert.equal(result.diagnostics.length, 0);
  const printedValues = result.events
    .filter((event) => event.kind === "print")
    .map((event) => event.payload.values[0]);
  assert.deepEqual(printedValues, [0, 1]);
});
