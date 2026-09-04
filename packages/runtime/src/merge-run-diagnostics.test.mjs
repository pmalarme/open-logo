// Direct tests for `mergeRunDiagnostics`, the function that decides whether the runtime's copy of a
// fault the check already reported is a duplicate or a second finding.
//
// It is tested here rather than through `execute()` because **no source program can currently tell
// its `paramsAgree` conjunct apart from a version that always returns `true`** — measured: neutering
// that conjunct leaves `npm run test` green and conformance at 1002/1002. A domain-QA review found
// exactly that and was right to call the doc comment's assurance unverified.
//
// The conjunct is kept rather than deleted, and this file is why the decision is checkable instead
// of asserted. It guards a failure this slice genuinely produced: while `evaluateCall`'s terminal
// still named the *canonical* spelling of a Heritage alias, `print fd 5` under a run not claiming
// Heritage raised a runtime `ol-unknown-command{name:"forward"}` whose span overlapped the check's
// `ol-unknown-command{name:"fd"}`. With `paramsAgree` in place those stayed two findings, which is
// what made the discrepancy visible; without it the runtime's copy would have been silently
// absorbed by a diagnostic about a different word. The bug is fixed — the terminal now names what
// the learner wrote — so the discriminating case no longer arises from a program, and the identity
// rule is pinned directly instead.
//
// `spec/error-model.md:255-260` makes diagnostic identity `code` + `params` + `source_span`;
// `spec/execution-model.md:746-748` is the de-duplication rule this implements, with `stage`
// deliberately excluded so a checker report and its runtime twin collapse.

import assert from "node:assert/strict";
import test from "node:test";

import { makeSpan } from "@openlogo/core";

import { mergeRunDiagnostics } from "../dist/execute-internal.js";

const doc = "merge-run-diagnostics.logo";

function diagnostic(code, params, start, end, stage) {
  return {
    code,
    source_span: makeSpan(doc, start, end),
    params,
    message: `${code} ${JSON.stringify(params)}`,
    stage,
    severity: "error",
  };
}

test("a runtime twin of a fault the check reported collapses into it", () => {
  // Same code, same params, and a runtime span that CONTAINS the check's — the ordinary case, and
  // the reason spans are compared by overlap rather than equality: the checker points at the
  // control word while the runtime points at the whole statement.
  const checked = [
    diagnostic(
      "ol-no-output",
      { procedure: "forward" },
      [1, 6],
      [1, 20],
      "semantic",
    ),
  ];
  const raised = diagnostic(
    "ol-no-output",
    { procedure: "forward" },
    [1, 6],
    [1, 13],
    "runtime",
  );
  const merged = mergeRunDiagnostics(checked, raised);
  assert.deepEqual(
    merged.map((entry) => [entry.code, entry.stage]),
    [["ol-no-output", "semantic"]],
    "the surviving report is the check's, and the stage difference must not keep both",
  );
});

test("params discriminate: a runtime fault naming a different callable is NOT a duplicate", () => {
  // The conjunct this file exists for. Identical code, overlapping spans, different `params` — two
  // genuinely different faults inside one construct. Widening the identity by dropping the params
  // test swallows the second, which is the failure mode the doc comment claims is impossible; this
  // is the assertion that makes the claim true rather than merely written.
  const checked = [
    diagnostic(
      "ol-unknown-command",
      { name: "fd" },
      [1, 7],
      [1, 9],
      "semantic",
    ),
  ];
  const raised = diagnostic(
    "ol-unknown-command",
    { name: "forward" },
    [1, 7],
    [1, 9],
    "runtime",
  );
  const merged = mergeRunDiagnostics(checked, raised);
  assert.deepEqual(
    merged.map((entry) => entry.params.name),
    ["fd", "forward"],
    "a runtime diagnostic about a different name must survive the merge",
  );
});

test("params agreement is subset-shaped, not equality-shaped", () => {
  // The check's `ol-unknown-command` carries a `suggestion` the runtime cannot compute, so equality
  // would keep both copies of one fault. Agreement on the keys they share is the rule.
  const checked = [
    diagnostic(
      "ol-unknown-command",
      { name: "fowad", suggestion: "forward" },
      [1, 1],
      [1, 6],
      "semantic",
    ),
  ];
  const raised = diagnostic(
    "ol-unknown-command",
    { name: "fowad" },
    [1, 1],
    [1, 6],
    "runtime",
  );
  assert.equal(mergeRunDiagnostics(checked, raised).length, 1);
});

test("disjoint spans keep both, even for the same code and params", () => {
  const checked = [
    diagnostic("ol-unknown-command", { name: "a" }, [1, 1], [1, 2], "semantic"),
  ];
  const raised = diagnostic(
    "ol-unknown-command",
    { name: "a" },
    [2, 1],
    [2, 2],
    "runtime",
  );
  assert.equal(mergeRunDiagnostics(checked, raised).length, 2);
});

test("no runtime diagnostic leaves the check's list untouched", () => {
  const checked = [
    diagnostic(
      "ol-style-name-case",
      { name: "FORWARD" },
      [1, 1],
      [1, 8],
      "semantic",
    ),
  ];
  assert.deepEqual(mergeRunDiagnostics(checked, undefined), checked);
});
