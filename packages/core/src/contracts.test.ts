import assert from "node:assert/strict";
import { test } from "node:test";

import { DIAGNOSTIC_CODES } from "./diagnostics.ts";
import { EVENT_KINDS } from "./events.ts";
import type { Diagnostic, SourceSpan, TraceEvent } from "./index.ts";

// Smoke test for the M0 core contract stubs (issue #7): construct one span, one
// diagnostic, and one trace event, and read them back. Runs on Node's built-in
// test runner over the TypeScript source (see scripts/test.mjs).
test("core contract: a span, a diagnostic, and a trace event round-trip", () => {
  const sourceSpan: SourceSpan = {
    document: "main.logo",
    start: { line: 1, column: 1 },
    end: { line: 1, column: 8 },
  };
  assert.equal(sourceSpan.start.line, 1);
  assert.equal(sourceSpan.end.column, 8);

  const diagnostic: Diagnostic = {
    code: "ol-not-enough-inputs",
    sourceSpan,
    params: { callable: "forward", expected: 1, actual: 0 },
    message: "forward needs 1 input (a distance), but none was given.",
    stage: "semantic",
    severity: "error",
  };
  assert.equal(diagnostic.code, "ol-not-enough-inputs");
  assert.ok(DIAGNOSTIC_CODES.includes(diagnostic.code));
  assert.equal(diagnostic.stage, "semantic");
  assert.equal(diagnostic.severity, "error");
  assert.equal(diagnostic.params.callable, "forward");
  assert.equal(diagnostic.sourceSpan.start.line, 1);

  const event: TraceEvent = {
    seq: 1,
    kind: "move",
    sourceSpan,
    payload: { from: [0, 0], to: [0, 100], heading: 0 },
  };
  assert.equal(event.kind, "move");
  assert.ok(EVENT_KINDS.includes(event.kind));
  assert.equal(event.seq, 1);
});
