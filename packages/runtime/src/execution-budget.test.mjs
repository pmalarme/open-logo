// Direct unit tests for issue #102's three execution-safety gates
// (`spec/execution-model.md:551-557`, `spec/error-model.md` `ol-limit`): a configurable
// instruction budget, a configurable recursion-depth limit, and external cancellation via a
// `CancellationSignal`. These exercise `ExecuteOptions` directly with small explicit overrides
// rather than relying on the production defaults (500 depth / 1,000,000 instructions) or on
// conformance-fixture spillover — per the task's own guidance, a fixture at production scale
// would need an impractically large hand-authored event array (the harness requires an exact,
// full ordered event/diagnostic diff — see `scripts/harness/index.mjs`'s `diffStream`). The one
// conformance fixture this issue adds (`tests/conformance/core-language/execution/`) only proves
// the in-budget, no-false-positive case at production defaults; every exceeded-limit and
// cancellation scenario is proven here instead.
//
// `forward` (the task's suggested stress-fixture primitive) does not exist in `@openlogo/runtime`
// yet — turtle movement belongs to `@openlogo/turtle` and is not wired into this package's
// statement dispatch. `print` stands in for it throughout: it is this package's only
// side-effecting statement, so it is the natural per-pass "did the loop body actually run" probe.
//
// Issue #233 adds the `for ... from ... to` (ForRange) and `for ... in` (ForIn) budget tests
// below, mirroring the existing `forever`/`while`/comprehension tests' pattern exactly. Before
// #233, `execute-internal.ts`'s `for`-loop `checkExecutionLimits`/`halt(limitDiagnostic)` branch
// had no direct unit test of its own — its 100% coverage was parasitic on conformance-corpus
// spillover (the same architecture issue #173 fixed for other branches), which is
// environment-sensitive and flaked the Node-22 coverage gate on an unrelated PR (#232).

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  execute,
  DEFAULT_INSTRUCTION_BUDGET,
  DEFAULT_RECURSION_DEPTH_LIMIT,
} from "@openlogo/runtime";

const doc = "budget.logo";

function printedCount(result) {
  return result.events.filter((event) => event.kind === "print").length;
}

test("an instruction budget smaller than a forever loop needs halts it with ol-limit/instruction-budget", () => {
  const result = execute('forever [ print "x" ]', doc, {
    instructionBudget: 5,
  });
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-limit");
  assert.deepEqual(result.diagnostics[0].params, {
    limit: "instruction-budget",
    value: 5,
  });
  // The loop was cut off well short of running forever — some passes completed (partial trace
  // is preserved, not discarded), but nowhere near an unbounded count.
  const printed = printedCount(result);
  assert.ok(printed > 0, "at least one pass should have completed");
  assert.ok(printed < 5, "the tiny budget must not let the loop run free");
});

test("an empty-bodied forever loop is still budgeted (the loop's own per-pass check, not just executeStatements', catches it)", () => {
  // `forever [ ]`'s body never runs `executeStatements`'s per-statement loop at all (there are no
  // statements), so if the budget were only checked there this would spin forever. It must be
  // caught by Forever's own per-pass check instead.
  const result = execute("forever [ ]", doc, { instructionBudget: 5 });
  assert.equal(result.diagnostics.length, 1);
  assert.deepEqual(result.diagnostics[0].params, {
    limit: "instruction-budget",
    value: 5,
  });
});

test("an empty-bodied while-true loop is still budgeted for the same reason", () => {
  const result = execute("while true [ ]", doc, { instructionBudget: 5 });
  assert.equal(result.diagnostics.length, 1);
  assert.deepEqual(result.diagnostics[0].params, {
    limit: "instruction-budget",
    value: 5,
  });
});

test("a small recursion-depth override raises ol-limit/recursion-depth sooner than the 500 default", () => {
  const result = execute(
    "define loop_forever\n  loop_forever\nend\nloop_forever",
    doc,
    { recursionDepthLimit: 10 },
  );
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-limit");
  assert.deepEqual(result.diagnostics[0].params, {
    limit: "recursion-depth",
    value: 10,
  });
});

test("a recursion-depth override larger than the 500 default lets deeper-than-default recursion complete", () => {
  const result = execute(
    "define countdown :n\n  if :n == 0 [\n    return 0\n  ]\n  return countdown :n - 1\nend\nprint countdown 600",
    doc,
    { recursionDepthLimit: 1000 },
  );
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(
    result.events
      .filter((event) => event.kind === "print")
      .map((event) => event.payload.values[0]),
    [0],
  );
});

test("a pre-aborted signal cancels before the first statement runs, with ol-limit/cancelled and no events", () => {
  const result = execute('print "never"', doc, {
    signal: { aborted: true },
  });
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-limit");
  assert.deepEqual(result.diagnostics[0].params, { limit: "cancelled" });
  assert.deepEqual(result.events, []);
});

test("a signal that flips aborted mid-run stops the loop promptly, keeping the partial trace intact", () => {
  // Simulates the real deployment (see `CancellationSignal`'s doc comment): a Worker running
  // `execute()` reads a `SharedArrayBuffer`-backed flag the main thread's Stop button flips via
  // `Atomics.store` — a plain synchronous memory read the worker observes mid-run with no
  // event-loop cooperation needed. A plain object whose `aborted` getter flips to `true` after a
  // few reads stands in for that `Atomics.load` read without needing real shared memory —
  // `execute()` is synchronous, so this is the only way to observe "cancel after some progress"
  // deterministically in a direct unit test.
  let checks = 0;
  const signal = {
    get aborted() {
      checks += 1;
      return checks > 3;
    },
  };
  const result = execute('forever [ print "tick" ]', doc, { signal });
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-limit");
  assert.deepEqual(result.diagnostics[0].params, { limit: "cancelled" });
  const printed = printedCount(result);
  assert.ok(
    printed > 0,
    "progress made before cancellation must not be discarded",
  );
});

test("an instructionBudget of Infinity, NaN, zero, or a negative number cannot disable the budget gate", () => {
  for (const invalid of [Infinity, NaN, 0, -5]) {
    const result = execute('forever [ print "x" ]', doc, {
      instructionBudget: invalid,
    });
    assert.equal(
      result.diagnostics.length,
      1,
      `instructionBudget: ${invalid} must still halt`,
    );
    assert.equal(result.diagnostics[0].code, "ol-limit");
    assert.deepEqual(
      result.diagnostics[0].params,
      { limit: "instruction-budget", value: DEFAULT_INSTRUCTION_BUDGET },
      `instructionBudget: ${invalid} must fall back to exactly DEFAULT_INSTRUCTION_BUDGET, not disable the gate or fall back to some other value`,
    );
  }
});

test("a recursionDepthLimit of Infinity, NaN, zero, or a negative number cannot disable the depth gate", () => {
  for (const invalid of [Infinity, NaN, 0, -5]) {
    const result = execute(
      "define loop_forever\n  loop_forever\nend\nloop_forever",
      doc,
      { recursionDepthLimit: invalid },
    );
    assert.equal(
      result.diagnostics.length,
      1,
      `recursionDepthLimit: ${invalid} must still halt`,
    );
    assert.equal(result.diagnostics[0].code, "ol-limit");
    assert.deepEqual(
      result.diagnostics[0].params,
      { limit: "recursion-depth", value: DEFAULT_RECURSION_DEPTH_LIMIT },
      `recursionDepthLimit: ${invalid} must fall back to exactly DEFAULT_RECURSION_DEPTH_LIMIT, not disable the gate or fall back to some other value`,
    );
  }
});

test("an ordinary in-budget program is unaffected: no ol-limit, every pass runs, under default limits", () => {
  const result = execute("repeat 5000 [ print 1 ]", doc);
  assert.deepEqual(result.diagnostics, []);
  assert.equal(printedCount(result), 5000);
});

test("instructionBudget and recursionDepthLimit can be overridden together without interfering", () => {
  const result = execute("repeat 3 [ print 1 ]", doc, {
    instructionBudget: 1000,
    recursionDepthLimit: 5,
  });
  assert.deepEqual(result.diagnostics, []);
  assert.equal(printedCount(result), 3);
});

test("a `for ... from ... to` (ForRange) loop is budgeted (issue #233): its own per-pass check halts a huge counted range", () => {
  // Mirrors the `forever`/`while true [ ]` empty-body-safety concern: `for i from 1 to
  // 1000000000 [ print :i ]` has no other exit and would otherwise run a billion passes.
  // `checkExecutionLimits` must be reached from ForRange's own loop, not merely from
  // `executeStatements`'s per-statement loop inside the body.
  const result = execute("for i from 1 to 1000000000 [ print :i ]", doc, {
    instructionBudget: 5,
  });
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-limit");
  assert.deepEqual(result.diagnostics[0].params, {
    limit: "instruction-budget",
    value: 5,
  });
  // The loop was cut off well short of a billion passes — some passes completed (partial
  // trace is preserved, not discarded), but nowhere near an unbounded count.
  const printed = printedCount(result);
  assert.ok(printed > 0, "at least one pass should have completed");
  assert.ok(printed < 5, "the tiny budget must not let the loop run free");
});

test("a `for ... in` (ForIn) loop is budgeted (issue #233): its own per-pass check halts mid-list", () => {
  const result = execute("for n in [1 2 3 4 5 6 7 8 9 10] [ print :n ]", doc, {
    instructionBudget: 3,
  });
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-limit");
  assert.deepEqual(result.diagnostics[0].params, {
    limit: "instruction-budget",
    value: 3,
  });
  // The loop was cut off mid-list — some passes completed (partial trace is preserved), but
  // not the full 10-element list.
  const printed = printedCount(result);
  assert.ok(printed > 0, "at least one pass should have completed");
  assert.ok(
    printed < 10,
    "the tiny budget must not let the loop run to completion",
  );
});

test("a comprehension's map/filter loop is budgeted too (checkExecutionLimits is shared with evaluate.ts, not just execute-internal.ts)", () => {
  const result = execute(
    ":nums = [1 2 3 4 5 6 7 8 9 10]\nprint map n in :nums [ :n ]",
    doc,
    { instructionBudget: 3 },
  );
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-limit");
  assert.deepEqual(result.diagnostics[0].params, {
    limit: "instruction-budget",
    value: 3,
  });
  // The map never got to print anything: it halted mid-comprehension.
  assert.equal(printedCount(result), 0);
});

test("a comprehension's reduce loop is budgeted too (its own separate loop from map/filter)", () => {
  const result = execute(
    ":nums = [1 2 3 4 5 6 7 8 9 10]\nprint reduce sum n in :nums from 0 [ :sum + :n ]",
    doc,
    { instructionBudget: 3 },
  );
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-limit");
  assert.deepEqual(result.diagnostics[0].params, {
    limit: "instruction-budget",
    value: 3,
  });
  assert.equal(printedCount(result), 0);
});
