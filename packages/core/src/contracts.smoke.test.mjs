import assert from "node:assert/strict";
import { test } from "node:test";
import * as OL from "@openlogo/core";

test("core exposes the ol-* diagnostic registry and shape", () => {
  assert.ok(OL.OL_DIAGNOSTIC_CODES.includes("ol-not-enough-inputs"));
  assert.equal(OL.isDiagnosticCode("ol-not-enough-inputs"), true);
  assert.equal(OL.isDiagnosticCode("nope"), false);

  // Construct one diagnostic and read it back.
  const diagnostic = {
    code: "ol-not-enough-inputs",
    source_span: OL.makeSpan("main.logo", [1, 1], [1, 8]),
    params: { callable: "forward", expected: 1, actual: 0 },
    message: "forward needs 1 input (a distance), but none was given.",
    stage: "semantic",
    severity: "error",
  };
  assert.ok(OL.isDiagnosticCode(diagnostic.code));
  assert.deepEqual(diagnostic.source_span.start, [1, 1]);
  assert.equal(diagnostic.stage, "semantic");
  assert.equal(diagnostic.severity, "error");
});

test("core exposes the trace/event registry and envelope", () => {
  assert.ok(OL.OL_EVENT_KINDS.includes("move"));
  assert.equal(OL.isEventKind("draw-segment"), true);
  assert.equal(OL.isEventKind("nope"), false);

  // Construct one event and read it back.
  const event = {
    seq: 1,
    kind: "move",
    source_span: OL.makeSpan("main.logo", [1, 1], [1, 12]),
    turtle_id: 0,
    payload: { from: [0, 0], to: [0, 100], heading: 0 },
  };
  assert.ok(OL.isEventKind(event.kind));
  assert.equal(event.seq, 1);
  assert.equal(event.payload.to[1], 100);
});
