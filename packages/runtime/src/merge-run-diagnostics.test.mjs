// Direct tests for `mergeRunDiagnostics`, the function that decides whether the runtime's copy of a
// fault the check already reported is a duplicate or a second finding.
//
// **It implements the spec's identity and nothing wider, and that is the point of this file.** An
// earlier version extended fault identity along two axes — *overlapping* spans rather than equal
// ones, and `params` in a subset relation rather than equal ones — to absorb three places where the
// two stages described one fault at different granularities. `spec/execution-model.md:741-743`
// makes identity exactly `code` + `params` + `source_span`, and `:663-664` requires the delivered
// set to be "otherwise unaltered", so that widening was a non-normative alteration: it suppressed
// findings the contract says must be delivered.
//
// The repair was to remove the divergences rather than tolerate them. `ol-no-output` now carries
// the whole call's span at both stages; `ol-return-outside-proc` and `ol-return-in-comprehension`
// are narrowed to the control word at both; and a runtime `ol-unknown-command` carries the same
// `suggestion` because both stages call `@openlogo/parser`'s single did-you-mean implementation.
// Measured after: across seventeen probe programs under the unchecked-run opt-out, **zero** report
// any code twice.
//
// So the tests below pin both directions — identical findings collapse, and findings that differ in
// span or params are two findings and are both delivered. The second direction is the one that
// keeps this honest: it is what makes a future divergence fail loudly here instead of being
// silently absorbed.
//
// `spec/error-model.md:255-260` defines diagnostic identity; `spec/execution-model.md:744-745`
// excludes `stage` from it, so a checker report and its runtime twin collapse.

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
  // The whole of the rule: identical `code`, `params` and `source_span`, differing only in `stage`,
  // which `spec/execution-model.md:744-745` explicitly excludes — "it records when the fault was
  // found, not which fault it is".
  const checked = [
    diagnostic(
      "ol-no-output",
      { procedure: "forward" },
      [1, 6],
      [1, 15],
      "semantic",
    ),
  ];
  const raised = diagnostic(
    "ol-no-output",
    { procedure: "forward" },
    [1, 6],
    [1, 15],
    "runtime",
  );
  assert.deepEqual(
    mergeRunDiagnostics(checked, raised).map((entry) => [
      entry.code,
      entry.stage,
    ]),
    [["ol-no-output", "semantic"]],
    "the surviving report is the check's, and the stage difference must not keep both",
  );
});

test("a DIFFERENT span is a different finding, and both are delivered", () => {
  // The boundary the widening used to blur. `spec/execution-model.md:741-743` makes the
  // `source_span` part of fault identity, and `:663-664` requires the delivered set to be
  // "otherwise unaltered" — so a runtime report at a coarser span is not the same fault and MUST
  // NOT be suppressed. This is what forced the two stages to agree at the source instead: the
  // repair for a divergence is to remove it, not to tolerate it here.
  const checked = [
    diagnostic(
      "ol-no-output",
      { procedure: "forward" },
      [1, 6],
      [1, 15],
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
  assert.equal(mergeRunDiagnostics(checked, raised).length, 2);
});

test("DIFFERENT params are a different finding, and both are delivered", () => {
  // Same reasoning on the other axis. A runtime `ol-unknown-command` missing the `suggestion` the
  // check computed would land here — which is why the runtime now calls `@openlogo/parser`'s own
  // did-you-mean rather than reporting a coarser copy.
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
  assert.equal(mergeRunDiagnostics(checked, raised).length, 2);
});

test("the code discriminates: a different code at the same span is NOT a duplicate", () => {
  // The third conjunct, and the one every other test here holds constant. Dropping
  // `diagnostic.code === raised.code` passes this file's other cases, conformance, and all 5030
  // tests — no source program reaches it today — so it is pinned directly rather than left as an
  // assurance in a comment.
  //
  // It matters more than its reachability suggests: the whole masking analysis in
  // `runtime-guards-halt.test.mjs` rests on de-duplication being **same-code**, which is what keeps
  // the precedence rule (which suppresses across *different* codes) a separate mechanism that
  // cannot reach a runtime diagnostic. If this conjunct went, that argument would go with it.
  const checked = [
    diagnostic(
      "ol-no-output",
      { procedure: "forward" },
      [1, 1],
      [1, 8],
      "semantic",
    ),
  ];
  const raised = diagnostic(
    "ol-not-implemented",
    { procedure: "forward" },
    [1, 1],
    [1, 8],
    "runtime",
  );
  assert.deepEqual(
    mergeRunDiagnostics(checked, raised).map((entry) => entry.code),
    ["ol-no-output", "ol-not-implemented"],
    "two different codes about one span are two findings, not one",
  );
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
