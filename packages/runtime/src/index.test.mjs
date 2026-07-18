import assert from "node:assert/strict";
import { test } from "node:test";
import { execute, RUNTIME_PACKAGE } from "@openlogo/runtime";

test("RUNTIME_PACKAGE marker export is still present", () => {
  assert.equal(RUNTIME_PACKAGE, "@openlogo/runtime");
});

test("execute emits one instruction event per top-level statement", () => {
  const result = execute("print 1\nprint 2", "main.logo");

  assert.equal(result.diagnostics.length, 0);
  assert.equal(result.events.length, 2);

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
  assert.deepEqual(result.events[1].payload, { statement_kind: "Call" });
  assert.equal(result.events[1].seq, 1);
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
