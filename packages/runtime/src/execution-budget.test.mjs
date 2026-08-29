// Direct unit tests for issue #102's three execution-safety gates
// (`spec/execution-model.md:634-638`, `spec/error-model.md` `ol-limit`): a configurable
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
  HOST_SAFE_RECURSION_DEPTH,
  resolveEffectiveRecursionDepthLimit,
} from "@openlogo/runtime";
import { recoverFromNativeStackOverflowForTests } from "../dist/execute-internal.js";

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

test("a recursion-depth override larger than the host-safe ceiling is clamped, so deeper recursion trips ol-limit at the ceiling instead of a raw RangeError (issue #726)", () => {
  // Issue #726's core reconciliation: OpenLogo's recursion-depth budget is a *language* limit,
  // V8's call stack is a *host* limit, and each OpenLogo frame costs several native frames on the
  // `evaluate` -> `evaluateCall` -> `callProcedure` chain. A caller that sets `recursionDepthLimit`
  // above what the host stack can hold must NOT get a raw `RangeError: Maximum call stack size
  // exceeded` (no `ol-*` code, no source span, forbidden by `spec/error-model.md`). So the
  // configured limit is clamped to `HOST_SAFE_RECURSION_DEPTH`, and recursion deeper than that
  // ceiling degrades to the ordinary `ol-limit`/`recursion-depth` diagnostic — reporting the depth
  // actually enforced (the clamp), not the unhonoured configured value.
  //
  // The asserted depth is chosen against a documented headroom margin rather than a value that
  // silently drifts as the evaluator grows: `HOST_SAFE_RECURSION_DEPTH` is pinned to 500, ~40%
  // below the ~800-frame cold overflow floor measured on Node 22 (the `.nvmrc`/CI pin), so this
  // test is deterministic on Node 22 and a future slice adding a frame to the hot chain cannot tip
  // it into a `RangeError` — the clamp guarantees the counter always trips first. See
  // `HOST_SAFE_RECURSION_DEPTH`'s doc comment for the full rationale and the smallest-host caveat.
  const configured = HOST_SAFE_RECURSION_DEPTH + 500;
  const result = execute(
    "define countdown :n\n  if :n == 0 [\n    return 0\n  ]\n  return countdown :n - 1\nend\nprint countdown 100000",
    doc,
    { recursionDepthLimit: configured },
  );
  // Exactly one diagnostic, and it is the friendly recursion-depth limit — never a host error.
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-limit");
  assert.deepEqual(result.diagnostics[0].params, {
    limit: "recursion-depth",
    // Reports the CLAMPED depth (the ceiling actually enforced), not the larger configured value.
    value: HOST_SAFE_RECURSION_DEPTH,
  });
  // It carries a real source span (the deepest call site), per `spec/error-model.md` — a raw
  // `RangeError` would have none.
  assert.ok(
    result.diagnostics[0].source_span,
    "the recursion-depth diagnostic must carry a source span",
  );
  // Nothing was printed: the recursion never reached `:n == 0`, it tripped the ceiling first.
  assert.equal(printedCount(result), 0);
});

test("recursion up to just under the host-safe ceiling completes normally, with no ol-limit and no host error (issue #726)", () => {
  // The clamp does not penalise programs that stay within the ceiling: recursion one level shy of
  // `HOST_SAFE_RECURSION_DEPTH` runs to completion. This is the deterministic Node-22-safe successor
  // to the old depth-600/limit-1000 assertion, which promised a depth (600 within a limit of 1000)
  // the host could not honor and so overflowed the native stack on CI's Node 22.
  const depth = HOST_SAFE_RECURSION_DEPTH - 1;
  const result = execute(
    `define countdown :n\n  if :n == 0 [\n    return 0\n  ]\n  return countdown :n - 1\nend\nprint countdown ${depth}`,
    doc,
    { recursionDepthLimit: HOST_SAFE_RECURSION_DEPTH },
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

// Issue #726 — the last-resort guard: if a host stack smaller than `HOST_SAFE_RECURSION_DEPTH`
// assumes (a browser tab, a `--stack-size`-reduced Node) overflows *before* the interpreter's
// clamped depth counter trips — or deeply nested expression evaluation / parsing overflows, which
// the counter does not bound — the escaping native `RangeError` must still become an `ol-*`
// diagnostic with a source span, never reach the caller raw. `recoverFromNativeStackOverflow` (the
// `runProgram` catch body) is exercised here directly with a fabricated `RangeError` rather than by
// provoking a real, host-dependent overflow, so both arms are covered deterministically on Node 22.
test("the native-stack-overflow guard rewrites an escaped RangeError into ol-limit/recursion-depth with the supplied span and preserved trace (issue #726)", () => {
  const callSpan = {
    document: doc,
    start: [2, 3],
    end: [2, 15],
  };
  const events = [{ kind: "print", payload: { values: [1] } }];

  const result = recoverFromNativeStackOverflowForTests(
    new RangeError("Maximum call stack size exceeded"),
    callSpan,
    events,
    HOST_SAFE_RECURSION_DEPTH,
  );

  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-limit");
  assert.deepEqual(result.diagnostics[0].params, {
    limit: "recursion-depth",
    value: HOST_SAFE_RECURSION_DEPTH,
  });
  // The diagnostic points at the supplied span (the deepest call reached), not a bare host trace.
  assert.deepEqual(result.diagnostics[0].source_span, callSpan);
  // The partial trace collected before the overflow is preserved (copied), as a language-level
  // halt does — and it is a copy, not the caller's array.
  assert.deepEqual(result.events, events);
  assert.notEqual(result.events, events);
});

test("the native-stack-overflow guard also rewrites Firefox's overflow signature (InternalError: too much recursion), an intended browser target — issue #726, rubber-duck round 2", () => {
  // Firefox (SpiderMonkey) reports stack exhaustion as `InternalError: too much recursion`, NOT a
  // `RangeError: Maximum call stack size exceeded`. The studio targets Firefox (ADR-0013), so an
  // `instanceof RangeError` gate would let a real Firefox overflow escape raw — reintroducing #726
  // on that host. Node has no `InternalError` global, so we synthesise the exact signature: a
  // plain Error whose message is Firefox's. isNativeStackOverflow matches on message, so this is
  // reclassified into the same ol-limit diagnostic as the V8 case.
  const span = { document: doc, start: [1, 1], end: [1, 1] };
  const firefoxOverflow = new Error("too much recursion");

  const result = recoverFromNativeStackOverflowForTests(
    firefoxOverflow,
    span,
    [],
    HOST_SAFE_RECURSION_DEPTH,
  );

  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-limit");
  assert.equal(result.diagnostics[0].params.limit, "recursion-depth");
});

test("the native-stack-overflow guard rethrows any non-RangeError unchanged — it must never mask a genuine bug (issue #726)", () => {
  const span = { document: doc, start: [1, 1], end: [1, 1] };
  const bug = new TypeError("a genuine interpreter bug");

  assert.throws(
    () =>
      recoverFromNativeStackOverflowForTests(
        bug,
        span,
        [],
        HOST_SAFE_RECURSION_DEPTH,
      ),
    (thrown) => thrown === bug,
  );

  // A thrown non-Error value (a `throw "..."` or `throw {}`) has no `message` string, so the guard's
  // defensive type check — not just the message comparison — must reject it and rethrow it verbatim
  // rather than dereferencing a missing `.message`.
  const notAnError = "a raw thrown string, not an Error";
  assert.throws(
    () =>
      recoverFromNativeStackOverflowForTests(
        notAnError,
        span,
        [],
        HOST_SAFE_RECURSION_DEPTH,
      ),
    (thrown) => thrown === notAnError,
  );
});

test("the native-stack-overflow guard rethrows an *unrelated* RangeError unchanged — only a genuine V8 stack overflow is a recursion diagnostic (issue #726, rubber-duck NB#1)", () => {
  // A `RangeError` is not automatically a stack overflow: an injected callback (e.g.
  // `tutorTemplates`) or an option getter can throw one for its own reasons — `new Array(-1)`,
  // `Number.prototype.toFixed(101)`, an explicit `throw new RangeError(...)`. The guard must match
  // V8's exact overflow message ("Maximum call stack size exceeded") and rethrow anything else, so
  // a real integration bug surfaces as itself rather than a bogus learner-facing recursion halt.
  const span = { document: doc, start: [1, 1], end: [1, 1] };
  const unrelated = new RangeError(
    "toFixed() digits argument must be between 0 and 100",
  );

  assert.throws(
    () =>
      recoverFromNativeStackOverflowForTests(
        unrelated,
        span,
        [],
        HOST_SAFE_RECURSION_DEPTH,
      ),
    (thrown) => thrown === unrelated,
  );
});

test("resolveEffectiveRecursionDepthLimit locks the clamp contract: a request deeper than the host-safe ceiling resolves to the ceiling (issue #726)", () => {
  // The clamp is an *observable, tested* contract, not a silent narrowing (orchestrator finding):
  // the effective ceiling is publicly readable, and this assertion pins requesting 1000 -> 500 so
  // the next person to change `HOST_SAFE_RECURSION_DEPTH` gets a failing test telling them exactly
  // which capability they are altering. Configuring recursion deeper than the ceiling is removed by
  // design — the implementation must not promise a depth the host stack cannot honour.
  //
  // The ceiling is pinned to the LITERAL 500, not to `HOST_SAFE_RECURSION_DEPTH` — otherwise raising
  // the constant to 600 would move both sides of the assertion together and the test would keep
  // passing while silently changing the contract it exists to protect (rubber-duck round 2, NB#3).
  assert.equal(HOST_SAFE_RECURSION_DEPTH, 500);
  assert.equal(resolveEffectiveRecursionDepthLimit(1000), 500);
  // A request at or below the ceiling is honoured unchanged...
  assert.equal(resolveEffectiveRecursionDepthLimit(50), 50);
  assert.equal(resolveEffectiveRecursionDepthLimit(500), 500);
  // ...and an omitted / non-usable request falls back to the default, then is likewise capped.
  assert.equal(
    resolveEffectiveRecursionDepthLimit(undefined),
    DEFAULT_RECURSION_DEPTH_LIMIT,
  );
});

test("a deeply nested expression that overflows the host stack during parsing yields ol-limit/recursion-depth, not a raw RangeError escaping execute() (issue #726)", () => {
  // A real, host-independent trigger for the guard: 20000-deep nested parentheses overflow V8's
  // native stack while *parsing*, on every supported host, long before any depth counter could
  // apply. Before #726 this threw a raw `RangeError` out of `execute()` with no `ol-*` code and no
  // span; now it is caught at the `runProgram` boundary and rewritten into the friendly
  // recursion-depth diagnostic carrying a whole-source span.
  const depth = 20000;
  const source = `\nprint ${"(".repeat(depth)}1${" + 1)".repeat(depth)}`;
  const result = execute(source, doc);

  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-limit");
  assert.equal(result.diagnostics[0].params.limit, "recursion-depth");
  assert.equal(result.diagnostics[0].params.value, HOST_SAFE_RECURSION_DEPTH);
  // A whole-source span, document-anchored (spanning the leading newline into line 2) — never a
  // bare host trace.
  assert.equal(result.diagnostics[0].source_span.document, doc);
  assert.deepEqual(result.diagnostics[0].source_span.start, [1, 1]);
  assert.equal(result.diagnostics[0].source_span.end[0], 2);
  assert.deepEqual(result.events, []);
});
