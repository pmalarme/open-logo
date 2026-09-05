// Direct tests for `dedupeDiagnostics`, the **de-duplication** half of *one fault, one diagnostic*
// (`spec/execution-model.md:741-748`).
//
// The identity it implements is `code` + `params` + `source_span`, with `stage` deliberately
// excluded — the spec says outright that `stage` "records when the fault was found, not which fault
// it is". These tests exist because `params` is an arbitrary object and its *serialization* decides
// identity, so the canonicalization is load-bearing rather than incidental.

import assert from "node:assert/strict";
import test from "node:test";

import { dedupeDiagnostics } from "@openlogo/core";

/** An `ol-duplicate-definition` whose `original_span` object is built with the given key order. */
function duplicateDefinition(originalSpan) {
  return {
    code: "ol-duplicate-definition",
    source_span: { document: "d.logo", start: [1, 1], end: [1, 5] },
    params: { name: "f", original_span: originalSpan },
    message: "already defined",
    stage: "semantic",
    severity: "error",
  };
}

test("the same fault reported at two stages collapses to one", () => {
  const semantic = {
    code: "ol-no-output",
    source_span: { document: "d.logo", start: [1, 6], end: [1, 15] },
    params: { procedure: "forward" },
    message: "m",
    stage: "semantic",
    severity: "error",
  };
  const runtime = { ...semantic, stage: "runtime" };
  assert.deepEqual(
    dedupeDiagnostics([semantic, runtime]).map((entry) => entry.stage),
    ["semantic"],
  );
});

test("fault identity is canonical at every depth, not just the top level", () => {
  // `original_span` is itself an object — a normative `params` entry with "the same shape as
  // `source_span`" (`spec/error-model.md:144-147`) — so sorting only top-level keys left nested
  // insertion order deciding identity. Measured before the fix: two identical findings whose
  // `original_span` keys were built in different orders survived as two.
  const a = duplicateDefinition({
    document: "d.logo",
    start: [2, 1],
    end: [2, 5],
  });
  const b = duplicateDefinition({
    start: [2, 1],
    end: [2, 5],
    document: "d.logo",
  });
  assert.equal(dedupeDiagnostics([a, b]).length, 1);
});

test("a genuinely different nested value is still two findings", () => {
  // The control. Without it the test above is satisfied by a canonicalization that discards nested
  // params entirely, which would collapse two distinct faults into one.
  const a = duplicateDefinition({
    document: "d.logo",
    start: [2, 1],
    end: [2, 5],
  });
  const elsewhere = duplicateDefinition({
    document: "other.logo",
    start: [2, 1],
    end: [2, 5],
  });
  assert.equal(dedupeDiagnostics([a, elsewhere]).length, 2);
});

test("the document is part of identity, so the same position in two sources is two faults", () => {
  const here = {
    code: "ol-bad-token",
    source_span: { document: "a.logo", start: [1, 7], end: [1, 10] },
    params: { text: "100" },
    message: "m",
    stage: "parse",
    severity: "error",
  };
  const there = {
    ...here,
    source_span: { ...here.source_span, document: "b.logo" },
  };
  assert.equal(dedupeDiagnostics([here, there]).length, 2);
});
