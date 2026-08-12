// Unit tests for `wait <n>` and the Interaction & Events tick clock (issue #680, slice I1 —
// `spec/interaction-events.md`'s "Time, ticks, and handlers", the `### wait <n>` primitive, and
// "Trace stream integration"). `wait` pauses the current top-level instruction stream for `n`
// ticks and emits a `primitive` event AFTER the pause completes; `n` must be a non-negative whole
// number (`ol-type`/`ol-range` otherwise). The tick clock is headless execution state — it never
// leaks into any event payload.
//
// Node-version trap (see the PR body): on Node 24+ `--experimental-test-coverage` silently
// excludes `*.test.mjs`, so a local coverage green can be a false positive CI then fails. These
// tests deliberately exercise every branch of `interaction.ts` and `executeWaitCall` so the
// Node-22 CI gate sees full coverage.

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  advanceTickClock,
  createTickClock,
  execute,
  isWaitCall,
  validateTickCount,
  yieldToEventLoop,
} from "@openlogo/runtime";
import { parse } from "@openlogo/parser";

const doc = "wait.logo";

/** The single non-`instruction` event a well-formed `wait` program emits, for concise assertions. */
function effectEvents(result) {
  return result.events.filter((event) => event.kind !== "instruction");
}

// --- `wait <n>` happy path: emits one `primitive` event AFTER the pause -----------------------

test("wait 2 emits a single primitive(wait) event after its instruction event", () => {
  const result = execute("wait 2", doc);
  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.events.length, 2);
  assert.equal(result.events[0].kind, "instruction");
  assert.deepEqual(result.events[1], {
    seq: 1,
    kind: "primitive",
    source_span: result.events[1].source_span,
    payload: { name: "wait" },
  });
});

test("the wait primitive event carries only the name — no tick count or timing leaks into the payload", () => {
  const result = execute("wait 5", doc);
  const [primitiveEvent] = effectEvents(result);
  // The stream is headless (`spec/execution-model.md` trace registry): the payload's only key is
  // `name`. A regression that smuggled the tick count/elapsed time in would add a second key.
  assert.deepEqual(Object.keys(primitiveEvent.payload), ["name"]);
  assert.equal(primitiveEvent.payload.name, "wait");
});

test("the primitive event is emitted AFTER the pause — it is the last event of the wait statement", () => {
  // `right 90` before and after brackets the wait so we can see the primitive lands after the
  // wait's own instruction event and before the next statement's instruction event.
  const result = execute("right 90\nwait 2\nright 90", doc);
  assert.deepEqual(result.diagnostics, []);
  const kinds = result.events.map((event) => event.kind);
  assert.deepEqual(kinds, [
    "instruction",
    "turn",
    "instruction",
    "primitive",
    "instruction",
    "turn",
  ]);
});

test("wait 0 yields with no visible delay but still emits its primitive event", () => {
  const result = execute("wait 0", doc);
  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.events.length, 2);
  assert.deepEqual(effectEvents(result), [
    {
      seq: 1,
      kind: "primitive",
      source_span: result.events[1].source_span,
      payload: { name: "wait" },
    },
  ]);
});

test("the parenthesized (wait n) form is accepted the same as the infix form", () => {
  const result = execute("(wait 3)", doc);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(
    effectEvents(result).map((event) => event.payload),
    [{ name: "wait" }],
  );
});

test("wait accepts a word that reads as a number, like every other numeric command", () => {
  const result = execute('wait "2"', doc);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(
    effectEvents(result).map((event) => event.kind),
    ["primitive"],
  );
});

test("wait accepts an evaluated numeric expression argument", () => {
  const result = execute("wait 1 + 1", doc);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(
    effectEvents(result).map((event) => event.kind),
    ["primitive"],
  );
});

// --- Errors: TYPE then RANGE (`ol-type` / `ol-range`), never ad-hoc strings -------------------

test("wait 1.5 (non-whole) raises ol-type and emits no primitive event", () => {
  const result = execute("wait 1.5", doc);
  assert.equal(result.diagnostics.length, 1);
  const [diagnostic] = result.diagnostics;
  assert.equal(diagnostic.code, "ol-type");
  assert.equal(diagnostic.params.operation, "wait");
  // Only the instruction event — the pause never happened, so no primitive event.
  assert.deepEqual(effectEvents(result), []);
});

test("wait -1 (negative) raises ol-range and emits no primitive event", () => {
  const result = execute("wait -1", doc);
  assert.equal(result.diagnostics.length, 1);
  const [diagnostic] = result.diagnostics;
  assert.equal(diagnostic.code, "ol-range");
  assert.equal(diagnostic.params.operation, "wait");
  assert.equal(diagnostic.params.value, -1);
  assert.deepEqual(effectEvents(result), []);
});

test("a non-numeric wait argument raises ol-type (wrong type, not wrong range)", () => {
  const result = execute('wait "soon"', doc);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-type");
  assert.deepEqual(effectEvents(result), []);
});

test("wait with no argument raises ol-not-enough-inputs", () => {
  const result = execute("wait", doc);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-not-enough-inputs");
});

test("(wait a b) with too many arguments raises ol-too-many-inputs", () => {
  const result = execute("(wait 1 2)", doc);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-too-many-inputs");
});

test("a wait argument the evaluator cannot support leaves the call un-evaluated (no crash, no diagnostic, no event)", () => {
  // A nested command call (`forward 5`) whose callee is not a value-producing builtin is not a
  // supported wait argument in this slice's evaluator; the call is left un-evaluated (its
  // instruction event still emits) rather than throwing or diagnosing — the same "defer if
  // unsupported" convention the turtle commands use, so a later slice can widen the evaluator
  // without this slice having pre-judged the argument.
  const result = execute("wait forward 5", doc);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(effectEvents(result), []);
});

test("a supported wait argument that evaluates to an error surfaces that diagnostic and emits no primitive event", () => {
  // `:missing` is a supported argument shape (a variable reference), but evaluating it fails with
  // `ol-undefined-var`; `wait` halts on that diagnostic and never runs the pause.
  const result = execute("wait :missing", doc);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-undefined-var");
  assert.deepEqual(effectEvents(result), []);
});

// --- Determinism: same program, same event sequence every run ---------------------------------

test("the same wait program produces an identical event sequence on every run", () => {
  const program = "wait 2\nright 90\nwait 0\nwait 3";
  const first = execute(program, doc);
  const second = execute(program, doc);
  assert.deepEqual(first.diagnostics, []);
  assert.deepEqual(first.events, second.events);
});

// --- The tick clock is real execution state that keeps advancing ------------------------------

test("createTickClock starts at tick 0 and advanceTickClock advances exactly one tick at a time", () => {
  const clock = createTickClock();
  assert.equal(clock.tick, 0);
  advanceTickClock(clock);
  assert.equal(clock.tick, 1);
  advanceTickClock(clock);
  advanceTickClock(clock);
  assert.equal(clock.tick, 3);
});

test("yieldToEventLoop is the dispatch seam: it forwards the tick to its dispatch callback and does not advance the clock", () => {
  // The seam #682-#686 hang handler dispatch off. It hands the current tick to `dispatch` and
  // forwards its interruption verdict, but must NOT advance the tick (the advance is
  // advanceTickClock's job) — wait yields once per tick AND once for wait 0.
  const clock = createTickClock();
  advanceTickClock(clock);
  const seen = [];
  assert.equal(
    yieldToEventLoop(clock, (tick) => {
      seen.push(tick);
      return false;
    }),
    false,
  );
  assert.deepEqual(seen, [1]);
  assert.equal(clock.tick, 1);
  // An interrupting dispatch is forwarded as `true`.
  assert.equal(
    yieldToEventLoop(clock, () => true),
    true,
  );
  assert.equal(clock.tick, 1);
});

// --- validateTickCount unit coverage (TYPE then RANGE, and the 0/positive happy paths) --------

test("validateTickCount rejects a non-whole number with ol-type", () => {
  const outcome = validateTickCount(2.5, makeSpan());
  assert.equal(outcome.ok, false);
  assert.equal(outcome.diagnostic.code, "ol-type");
  assert.equal(outcome.diagnostic.params.operation, "wait");
});

test("validateTickCount rejects a negative whole number with ol-range", () => {
  const outcome = validateTickCount(-4, makeSpan());
  assert.equal(outcome.ok, false);
  assert.equal(outcome.diagnostic.code, "ol-range");
  assert.equal(outcome.diagnostic.params.value, -4);
});

test("validateTickCount accepts 0 and positive whole numbers", () => {
  assert.deepEqual(validateTickCount(0, makeSpan()), { ok: true, value: 0 });
  assert.deepEqual(validateTickCount(7, makeSpan()), { ok: true, value: 7 });
});

// --- isWaitCall predicate: matches wait calls only --------------------------------------------

test("isWaitCall recognizes an infix and a parenthesized wait call, case-insensitively", () => {
  assert.equal(isWaitCall(firstStatement("wait 2")), true);
  assert.equal(isWaitCall(firstStatement("(wait 2)")), true);
  assert.equal(isWaitCall(firstStatement("WAIT 2")), true);
});

test("isWaitCall rejects a non-wait call and a non-call statement", () => {
  assert.equal(isWaitCall(firstStatement("right 90")), false);
  assert.equal(
    isWaitCall(firstStatement("repeat 2\nright 90\nend repeat")),
    false,
  );
});

/** Parse `source` and return its first top-level statement node. */
function firstStatement(source) {
  const result = parse(`${source}\n`, doc);
  return result.ast.body[0];
}

/** A throwaway source span for direct `validateTickCount` unit calls. */
function makeSpan() {
  return {
    document: doc,
    start: [1, 1],
    end: [1, 2],
  };
}
