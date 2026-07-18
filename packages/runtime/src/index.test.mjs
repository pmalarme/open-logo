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
  assert.equal(result.events.length, 3);
  assert.deepEqual(
    result.events.map((event) => event.seq),
    [0, 1, 2],
  );
  assert.deepEqual(
    result.events.map((event) => event.kind),
    ["instruction", "instruction", "instruction"],
  );
  assert.deepEqual(
    result.events.map((event) => event.payload.statement_kind),
    ["Assign", "Call", "Repeat"],
  );
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
  const result = execute("print :x", "main.logo");
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
  // Every operand must be an expression kind this issue's evaluator supports — `:x` is not, so
  // the whole `(print 1 :x)` statement stays un-evaluated (only its `instruction` event fires),
  // even though its first operand (`1`) would evaluate cleanly on its own.
  const result = execute("(print 1 :x)", "main.logo");
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
    message: "print needs one input.",
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
    message: "print needs one input.",
    stage: "runtime",
    severity: "error",
  });
});
