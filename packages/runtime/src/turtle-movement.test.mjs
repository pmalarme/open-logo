// Unit tests for `forward`/`back` (issue #200, spec/commands.md's Turtle movement table,
// spec/execution-model.md:545-546's movement math, spec/rendering.md's "Line segments" section).
// The turtle starts at `(0,0)`, heading `0`, pen down, color `"black"`, width `1`
// (spec/rendering.md:78) — this slice implements no way to change heading/pen/color/width yet
// (issues #201/#206/#208/#209), so every case here necessarily starts and stays at heading `0`.
// That still exercises every line this slice adds: the `sin`/`cos` movement formula runs
// identically regardless of the (here always `0`) heading value, and `back`'s sign flip is
// covered by running both `forward` and `back` in the same program.

import assert from "node:assert/strict";
import { test } from "node:test";
import { execute } from "@openlogo/runtime";

test("execute moves the turtle forward, emitting a move then a draw-segment event", () => {
  const result = execute("forward 100", "main.logo");
  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.events.length, 3);
  assert.equal(result.events[0].kind, "instruction");
  assert.deepEqual(result.events[1], {
    seq: 1,
    kind: "move",
    source_span: result.events[0].source_span,
    payload: { from: [0, 0], to: [0, 100], heading: 0 },
  });
  assert.deepEqual(result.events[2], {
    seq: 2,
    kind: "draw-segment",
    source_span: result.events[0].source_span,
    payload: { from: [0, 0], to: [0, 100], color: "black", width: 1 },
  });
});

test("execute moves the turtle back, opposite the current heading, not turning it", () => {
  const result = execute("back 50", "main.logo");
  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.events.length, 3);
  assert.deepEqual(result.events[1].payload, {
    from: [0, 0],
    to: [0, -50],
    heading: 0,
  });
  assert.deepEqual(result.events[2].payload, {
    from: [0, 0],
    to: [0, -50],
    color: "black",
    width: 1,
  });
});

test("execute threads the turtle's position across statements", () => {
  const result = execute("forward 10\nback 10", "main.logo");
  assert.deepEqual(result.diagnostics, []);
  // forward 10: instruction, move, draw-segment; back 10: instruction, move, draw-segment.
  assert.equal(result.events.length, 6);
  assert.deepEqual(result.events[1].payload, {
    from: [0, 0],
    to: [0, 10],
    heading: 0,
  });
  assert.deepEqual(result.events[4].payload, {
    from: [0, 10],
    to: [0, 0],
    heading: 0,
  });
});

test("execute evaluates a supported forward argument expression, per issue #93 arithmetic", () => {
  const result = execute("forward 2 * 3", "main.logo");
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(result.events[1].payload, {
    from: [0, 0],
    to: [0, 6],
    heading: 0,
  });
});

test("execute evaluates a parenthesized `(forward value)` call the same as the plain form", () => {
  const result = execute("(forward 5)", "main.logo");
  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.events[0].payload.statement_kind, "ParenCall");
  assert.deepEqual(result.events[1].payload, {
    from: [0, 0],
    to: [0, 5],
    heading: 0,
  });
});

test("execute raises ol-not-enough-inputs for a bare zero-argument `forward`", () => {
  // The static checker's arity rule never runs inside `execute()` — it only calls `parse()` —
  // so this is the sole runtime guard against silently treating a callee-only `forward` as a
  // no-op (mirrors `print`'s equivalent zero-argument test in `index.test.mjs`).
  const result = execute("forward", "main.logo");
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].kind, "instruction");
  assert.deepEqual(result.diagnostics, [
    {
      code: "ol-not-enough-inputs",
      source_span: { document: "main.logo", start: [1, 1], end: [1, 8] },
      params: { callable: "forward", expected: 1, actual: 0 },
      message: "forward needs one input, but got 0.",
      stage: "runtime",
      severity: "error",
    },
  ]);
});

test("execute raises ol-too-many-inputs for a parenthesized `(back a b)` call", () => {
  const result = execute("(back 10 20)", "main.logo");
  assert.equal(result.events.length, 1);
  assert.deepEqual(result.diagnostics, [
    {
      code: "ol-too-many-inputs",
      source_span: { document: "main.logo", start: [1, 2], end: [1, 6] },
      params: { callable: "back", expected: 1, actual: 2 },
      message: "back takes one input, but got 2.",
      stage: "runtime",
      severity: "error",
    },
  ]);
});

test("execute raises ol-type for a non-number forward argument", () => {
  const result = execute('forward "abc"', "main.logo");
  assert.equal(result.events.length, 1);
  assert.deepEqual(result.diagnostics, [
    {
      code: "ol-type",
      source_span: { document: "main.logo", start: [1, 9], end: [1, 14] },
      params: {
        expected: "number",
        actual: "word",
        value: "abc",
        operation: "forward",
      },
      message: "forward needs a number, but got a word.",
      stage: "runtime",
      severity: "error",
    },
  ]);
});

test("execute propagates a failing forward argument expression instead of moving", () => {
  const result = execute("forward 1 / 0", "main.logo");
  assert.equal(result.events.length, 1);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-div-zero");
});

test("execute raises ol-range for a forward distance that overflows to Infinity, instead of emitting a NaN-corrupted move event", () => {
  // `power 10 1000` overflows IEEE 754 double precision to `Infinity` (a legitimately reachable
  // `number` OLValue elsewhere in this codebase — see `comparison-equality.test.mjs`), but
  // `moveTurtle`'s `d·sin h`/`d·cos h` turns `Infinity * sin(0)` (`0`) into `NaN` — a defect this
  // guard prevents by halting instead of emitting a corrupted event (spec/execution-model.md:517:
  // "OpenLogo never exposes NaN or Infinity as learner-facing results").
  const result = execute("forward power 10 1000", "main.logo");
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].kind, "instruction");
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-range");
  assert.deepEqual(result.diagnostics[0].params, {
    operation: "forward",
    value: "Infinity",
  });
  // `params` is a diagnostic-identity payload and must survive a JSON round-trip
  // (spec/error-model.md:34) — a raw `Infinity` number would silently become `null`.
  assert.deepEqual(
    JSON.parse(JSON.stringify(result.diagnostics[0].params)),
    result.diagnostics[0].params,
  );
});

test("execute raises ol-range for a back distance that overflows to -Infinity", () => {
  const result = execute("back power 10 1000", "main.logo");
  assert.equal(result.events.length, 1);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-range");
  assert.deepEqual(result.diagnostics[0].params, {
    operation: "back",
    value: "Infinity",
  });
});

test("execute leaves an unsupported forward argument un-evaluated, emitting no move/draw-segment event", () => {
  // Mirrors `print`'s equivalent test in `index.test.mjs`: `.field` place segments are
  // Data/record-profile and deferred, so `isSupportedExpression` reports this operand
  // unsupported and the statement is left un-evaluated (still no diagnostic).
  const result = execute("forward :ages.tom", "main.logo");
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].kind, "instruction");
  assert.deepEqual(result.diagnostics, []);
});
