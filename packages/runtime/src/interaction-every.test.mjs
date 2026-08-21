// Unit tests for `every <n> <block>` — repeated timed event handler registration and tick-clock
// dispatch (issue #683, slice I4 — `spec/interaction-events.md`'s `### every <n> <block>`, "Time,
// ticks, and handlers", "Trace stream integration", and "Errors and cancellation"). `every`
// registers a handler and emits a `primitive` event AFTER registration; the block first runs after
// `n` ticks have elapsed and repeats every `n` ticks. Because interaction time is measured in ticks
// and a headless batch run only advances the tick clock inside a `wait` pause, an `every` handler
// fires while a `wait` elapses — the spec's "registered `every` … handlers still fire" behavior. The
// tick count MUST be a positive whole number: a non-whole count raises `ol-type`, a zero or negative
// count raises `ol-range`. The stream stays deterministic and headless — no tick count leaks into any
// payload.
//
// Node-version trap (see the PR body): on Node 24+ `--experimental-test-coverage` silently excludes
// `*.test.mjs`, so a local coverage green can be a false positive CI (Node 22) then fails. These
// tests deliberately exercise every branch of the `every` registry (`interaction.ts`'s
// `registerEveryHandler`/`claimDueEveryHandlers`/`emitEveryPrimitive`) and dispatch
// (`isEveryStatement`/`executeEveryStatement`/`invokeEveryHandler`/`dispatchEveryHandlers`) so the
// Node-22 CI gate sees full coverage.

import assert from "node:assert/strict";
import { test } from "node:test";
import { execute } from "@openlogo/runtime";

const doc = "every.logo";

/** The non-`instruction` events a program emits, for concise effect-sequence assertions. */
function effectEvents(result) {
  return result.events.filter((event) => event.kind !== "instruction");
}

// --- Registration emits `primitive` AFTER the handler is registered, headless -----------------

test("every registration emits a primitive(every) event, headless (name only)", () => {
  // With no `wait` to advance the clock, the handler only registers — isolating the registration
  // `primitive` from any handler-run events.
  const result = execute('every 5 [ print "x" ]', doc);
  assert.deepEqual(result.diagnostics, []);
  const primitives = result.events.filter(
    (event) => event.kind === "primitive",
  );
  assert.equal(primitives.length, 1);
  // Headless: the payload's only key is `name` — no tick count, interval, or timing leaks in.
  assert.deepEqual(Object.keys(primitives[0].payload), ["name"]);
  assert.equal(primitives[0].payload.name, "every");
});

test("registration is NOT invocation: the block does not run until n ticks elapse", () => {
  const result = execute('every 3 [ print "never" ]', doc);
  assert.deepEqual(result.diagnostics, []);
  // Only the registration primitive — with no `wait`, no tick advanced, so the body never ran.
  assert.deepEqual(
    effectEvents(result).map((event) => event.payload),
    [{ name: "every" }],
  );
});

// --- Firing during a `wait`: first run after n ticks, then every n ticks -----------------------

test("an every handler first runs after n ticks and repeats every n ticks during a wait", () => {
  // `every 3` during `wait 10` is due on ticks 3, 6, 9 — three runs.
  const result = execute('every 3 [ print "tick" ]\nwait 10', doc);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(
    effectEvents(result).map((event) => event.payload),
    [
      { name: "every" },
      { values: ["tick"] },
      { values: ["tick"] },
      { values: ["tick"] },
      { name: "wait" },
    ],
  );
});

test("the handler-block start emits an instruction event carrying the every keyword's span", () => {
  const result = execute('every 2 [ print "x" ]\nwait 2', doc);
  assert.deepEqual(result.diagnostics, []);
  // seq 0: `every` registration instruction; seq 1: registration primitive; seq 2: the top-level
  // `wait` instruction (emitted before the pause runs); then, during the pause, the handler fires:
  // seq 3: the handler block-start instruction (the `every` block-head span); seq 4-5: the body
  // `print`; seq 6: the `wait` primitive after the pause completes.
  const kinds = result.events.map((event) => event.kind);
  assert.deepEqual(kinds, [
    "instruction",
    "primitive",
    "instruction",
    "instruction",
    "instruction",
    "print",
    "primitive",
  ]);
  // The block-start instruction (seq 3) carries the block-head keyword span (`every`, columns 1-6),
  // not the whole statement — so replay attributes the run to the registration site.
  assert.deepEqual(result.events[3].source_span, {
    document: doc,
    start: [1, 1],
    end: [1, 6],
  });
});

test("wait shorter than the interval fires the handler zero times", () => {
  const result = execute('every 5 [ print "x" ]\nwait 4', doc);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(
    effectEvents(result).map((event) => event.payload),
    [{ name: "every" }, { name: "wait" }],
  );
});

// --- The first run is anchored to REGISTRATION time, not to global tick zero -------------------

test("a handler registered mid-run first fires n ticks after registration, not at a global multiple", () => {
  // The first `wait 2` advances the clock to tick 2, THEN `every 3` registers. Its first run is 3
  // ticks LATER — at tick 5 — not at tick 3 (which would be the wrong "global multiple of 3"
  // reading). `wait 4` covers ticks 3,4,5,6, so the handler fires exactly once, at tick 5.
  const result = execute('wait 2\nevery 3 [ print "x" ]\nwait 4', doc);
  assert.deepEqual(result.diagnostics, []);
  const prints = effectEvents(result).filter((event) => event.kind === "print");
  assert.equal(prints.length, 1);
});

// --- `wait 0` yields but does NOT redeliver a handler already delivered on this tick -----------

test("a wait 0 after a handler fired on the current tick does not fire it again", () => {
  // `wait 2` fires the `every 2` handler once, at tick 2. The following `wait 0` yields to the event
  // loop at the SAME tick 2 (no clock advance), but the handler's next due tick has already advanced
  // past it, so it is not redelivered — exactly one print, not two.
  const result = execute('every 2 [ print "x" ]\nwait 2\nwait 0', doc);
  assert.deepEqual(result.diagnostics, []);
  const prints = effectEvents(result).filter((event) => event.kind === "print");
  assert.equal(prints.length, 1);
});

test("an interval of 1 fires on every tick of the wait", () => {
  const result = execute('every 1 [ print "x" ]\nwait 3', doc);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(
    effectEvents(result).map((event) => event.payload),
    [
      { name: "every" },
      { values: ["x"] },
      { values: ["x"] },
      { values: ["x"] },
      { name: "wait" },
    ],
  );
});

// --- Registration order across multiple every handlers due on the same tick -------------------

test("multiple every handlers due on the same tick fire in registration order", () => {
  // Both `every 2` handlers are due on tick 2; they fire in the order they were registered.
  const result = execute(
    'every 2 [ print "a" ]\nevery 2 [ print "b" ]\nwait 2',
    doc,
  );
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(
    effectEvents(result).map((event) => event.payload),
    [
      { name: "every" },
      { name: "every" },
      { values: ["a"] },
      { values: ["b"] },
      { name: "wait" },
    ],
  );
});

// --- Scope capture: the body runs in its registration-time lexical scope ------------------------

test("an every handler body sees its registration-time lexical scope", () => {
  const program =
    "define setup :n\n  every 2 [ print :n ]\nend\nsetup 7\nwait 2";
  const result = execute(program, doc);
  assert.deepEqual(result.diagnostics, []);
  // The handler registered inside `setup 7` sees `:n = 7` when it later runs during the wait.
  assert.deepEqual(
    effectEvents(result)
      .filter((event) => event.kind === "print")
      .map((event) => event.payload.values),
    [[7]],
  );
});

// --- Errors: TYPE before RANGE (positive whole number) -----------------------------------------

test("every with a non-whole count raises ol-type", () => {
  const result = execute('every 2.5 [ print "x" ]', doc);
  assert.equal(result.diagnostics.length, 1);
  const diagnostic = result.diagnostics[0];
  assert.equal(diagnostic.code, "ol-type");
  // Exact params, not just the code: `params` are part of a diagnostic's identity
  // (`spec/error-model.md`) and the conformance harness compares them exactly. Asserting only
  // `code`/`operation` is precisely what let `wait`'s wording drift away from `every`'s until
  // issue #775 caught it, so the twin is pinned the same way here.
  assert.deepEqual(diagnostic.params, {
    expected: "whole number",
    actual: "number",
    value: 2.5,
    operation: "every",
  });
  // The type check fails BEFORE registration — no `primitive(every)` event, and no handler runs.
  assert.deepEqual(effectEvents(result), []);
});

test("every with a zero count raises ol-range", () => {
  const result = execute('every 0 [ print "x" ]', doc);
  assert.equal(result.diagnostics.length, 1);
  const diagnostic = result.diagnostics[0];
  assert.equal(diagnostic.code, "ol-range");
  assert.deepEqual(diagnostic.params, { operation: "every", value: 0 });
  assert.deepEqual(effectEvents(result), []);
});

test("every with a negative count raises ol-range", () => {
  const result = execute('every -3 [ print "x" ]', doc);
  assert.equal(result.diagnostics.length, 1);
  const diagnostic = result.diagnostics[0];
  assert.equal(diagnostic.code, "ol-range");
  assert.deepEqual(diagnostic.params, { operation: "every", value: -3 });
});

test("every with a non-number count raises ol-type", () => {
  const result = execute('every "loud" [ print "x" ]', doc);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-type");
  assert.deepEqual(result.diagnostics[0].params, {
    expected: "whole number",
    actual: "word",
    value: "loud",
    operation: "every",
  });
  assert.deepEqual(effectEvents(result), []);
});

test("a word that reads as a non-whole number reports the WORD, not a coerced number", () => {
  // The third arm of the tick-count type check, and the one that pins WHICH value the diagnostic
  // names. `spec/execution-model.md:33-34` coerces a numeric word far enough to be judged
  // non-whole, but the learner wrote a word, so `actual`/`value` must say so. An implementation
  // that pre-coerced the word before the wholeness check would report `number`/`2.5` and still
  // satisfy the other two arms — a number literal was never a word, and `"loud"` never coerces at
  // all — which is exactly the defect issue #775 removed from `wait`. Found by mutation: that
  // pre-coercion survived a fully green run until this case (and the twin conformance fixture
  // `every/every-non-whole-word`) existed.
  const result = execute('every "2.5" [ print "x" ]', doc);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-type");
  assert.deepEqual(result.diagnostics[0].params, {
    expected: "whole number",
    actual: "word",
    value: "2.5",
    operation: "every",
  });
  assert.deepEqual(effectEvents(result), []);
});

test("a count that is neither a number nor a word names its own type", () => {
  // Completeness across the value model (`spec/execution-model.md`'s Core values): a list and a
  // boolean reach the same `ol-type` with `actual` naming the offending type, never a coerced
  // stand-in. `wait` is pinned the same way in `interaction-wait.test.mjs`.
  for (const [source, actual, value] of [
    ['every [ 1 2 ] [ print "x" ]', "list", [1, 2]],
    ['every true [ print "x" ]', "boolean", true],
  ]) {
    const result = execute(source, doc);
    assert.equal(result.diagnostics.length, 1);
    assert.equal(result.diagnostics[0].code, "ol-type");
    assert.deepEqual(result.diagnostics[0].params, {
      expected: "whole number",
      actual,
      value,
      operation: "every",
    });
    assert.deepEqual(effectEvents(result), []);
  }
});

// --- Unsupported / un-evaluable count arguments ------------------------------------------------

test("an unsupported count argument leaves the statement un-evaluated (no crash, no diagnostic, no event)", () => {
  // A nested command call (`forward 5`) is not a supported `every` count argument in this slice's
  // evaluator; the statement is left un-evaluated (its instruction event still emits) rather than
  // throwing or diagnosing — the same "defer if unsupported" convention `wait`/`when` and the
  // turtle commands use, so a later slice can widen the evaluator without this slice pre-judging it.
  const result = execute('every forward 5 [ print "x" ]', doc);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(effectEvents(result), []);
});

test("a count argument that evaluates to a diagnostic halts before registration", () => {
  // `:missing` is a supported argument node, but evaluating it fails (unbound). The evaluation
  // diagnostic propagates and no handler is registered — no `primitive(every)`, no handler run.
  const result = execute('every :missing [ print "x" ]', doc);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-undefined-var");
  assert.deepEqual(effectEvents(result), []);
});

// --- The count span points at the offending argument, not the whole statement ------------------

test("the count diagnostic span covers the offending count argument", () => {
  const result = execute('every 0 [ print "x" ]', doc);
  // `0` is at column 7.
  assert.deepEqual(result.diagnostics[0].source_span, {
    document: doc,
    start: [1, 7],
    end: [1, 8],
  });
});

// --- A halt inside a handler body aborts the wait and propagates --------------------------------

test("a runtime error inside an every handler body halts the whole run", () => {
  // `1 / 0` inside the handler raises `ol-div-zero` on the first due tick; the wait aborts there.
  const result = execute("every 2 [ print 1 / 0 ]\nwait 4", doc);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-div-zero");
});

test("a return escaping an every handler body is ol-return-outside-proc", () => {
  const result = execute("every 2 [ return 1 ]\nwait 2", doc);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-return-outside-proc");
});

test("a stop escaping an every handler body is ol-stop-outside-proc", () => {
  const result = execute("every 2 [ stop ]\nwait 2", doc);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-stop-outside-proc");
});

test("a return escaping an every handler registered inside a proc is still ol-return-outside-proc", () => {
  // The handler block is not a procedure body even when `every` was registered inside one, so a
  // `return` that escapes it is the outside-proc diagnostic, not silently consumed as `setup`'s own
  // return (mirrors `when`'s boundary conversion).
  const program = "define setup\n  every 2 [ return 1 ]\nend\nsetup\nwait 2";
  const result = execute(program, doc);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-return-outside-proc");
});

// --- "At most one pending invocation": a re-entrant wait cannot overlap the same handler --------

test("a re-entrant wait inside an every handler does not deliver a second overlapping invocation", () => {
  // The handler for `every 2` runs a nested `wait 2`. While that inner wait advances the clock past
  // another due tick for the SAME handler, the handler is already `running`, so it is skipped — at
  // most one pending invocation, no unbounded buildup. The single outer due tick therefore produces
  // exactly one `print` from this handler.
  const result = execute('every 2 [ print "x" wait 2 ]\nwait 2', doc);
  assert.deepEqual(result.diagnostics, []);
  const prints = effectEvents(result).filter((event) => event.kind === "print");
  assert.equal(prints.length, 1);
});

test("a sibling handler is not re-fired out of order by another handler's re-entrant wait", () => {
  // Both handlers are due on tick 2. The first handler's body runs a nested `wait 2`, advancing the
  // clock to tick 4 — the second handler's next interval boundary. Without an up-front batch claim
  // the second handler would fire during that inner wait (for tick 4) AND again from the outer
  // tick-2 batch, printing "b" twice, out of chronological order. Because the outer batch claims
  // both handlers as `pending` up front, the inner wait sees the second handler already pending and
  // skips it, so it fires exactly once, after "a", in registration order: ["a", "b"].
  const result = execute(
    'every 2 [ print "a" wait 2 ]\nevery 2 [ print "b" ]\nwait 2',
    doc,
  );
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(
    effectEvents(result)
      .filter((event) => event.kind === "print")
      .map((event) => event.payload.values[0]),
    ["a", "b"],
  );
});

// --- Determinism: same program, same event sequence every run ----------------------------------

test("the same every program produces an identical event sequence on every run", () => {
  const program = 'every 3 [ print "tick" ]\nwait 12';
  const first = execute(program, doc);
  const second = execute(program, doc);
  assert.deepEqual(first.diagnostics, []);
  assert.deepEqual(first.events, second.events);
  // `wait 12` fires the handler on ticks 3, 6, 9, 12 — four deterministic runs.
  const prints = effectEvents(first).filter((event) => event.kind === "print");
  assert.equal(prints.length, 4);
});
