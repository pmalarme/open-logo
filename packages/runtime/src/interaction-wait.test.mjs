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
  tickAtEventIndex,
  yieldToEventLoop,
} from "@openlogo/runtime";
import { parse } from "@openlogo/parser";
// `runWait` is package-internal (not on `@openlogo/runtime`'s public surface), and the
// charge-before-advance ordering it owns is observable nowhere else — see the ordering test below.
// Reached through the `../dist/<module>.js` idiom this package already uses for internals.
import { runWait } from "../dist/interaction.js";

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
  // Exact params, not just the code: `params` are part of a diagnostic's identity
  // (`spec/error-model.md`) and the conformance harness compares them exactly, so asserting only
  // `code`/`operation` would let the #775 wording regress unnoticed.
  assert.deepEqual(diagnostic.params, {
    expected: "whole number",
    actual: "number",
    value: 1.5,
    operation: "wait",
  });
  // Only the instruction event — the pause never happened, so no primitive event.
  assert.deepEqual(effectEvents(result), []);
});

test("wait -1 (negative) raises ol-range and emits no primitive event", () => {
  const result = execute("wait -1", doc);
  assert.equal(result.diagnostics.length, 1);
  const [diagnostic] = result.diagnostics;
  assert.equal(diagnostic.code, "ol-range");
  assert.deepEqual(diagnostic.params, { operation: "wait", value: -1 });
  assert.deepEqual(effectEvents(result), []);
});

test("a WORD that reads as a negative number still raises ol-range, with the coerced value", () => {
  // The RANGE arm reached through a word. `spec/execution-model.md:33-34` accepts a word that
  // parses as a number wherever a number is expected, so `wait "-1"` must reach the same `ol-range`
  // the literal `-1` does. Nothing exercised that composition: every range case passed a number
  // literal, so an implementation that guarded the range only when the argument was literally a
  // number would let `wait "-1"` SUCCEED and emit a trailing `primitive(wait)` — an invisible wrong
  // result for a pause primitive. Found by mutation; that mutation passed a fully green run.
  //
  // `params.value` is the COERCED number `-1`, not the word — the opposite of the `ol-type` arm
  // above, deliberately: `ol-range` asks about magnitude, which exists only after coercion, while
  // `ol-type` asks what the learner actually wrote.
  const result = execute('wait "-1"', doc);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-range");
  assert.deepEqual(result.diagnostics[0].params, {
    operation: "wait",
    value: -1,
  });
  assert.deepEqual(effectEvents(result), []);
});

test("a non-numeric wait argument raises ol-type expecting a whole number (issue #775)", () => {
  const result = execute('wait "soon"', doc);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-type");
  // `wait`'s tick count is a WHOLE-number argument (`spec/interaction-events.md`'s `### wait <n>`:
  // "`n` MUST be a non-negative whole number"), so a value that is not a number at all reports the
  // whole-number expectation — the same spelling `every`, `repeat`, and `random` emit. Before #775
  // this branch reported `expected: "number"` because `executeWaitCall` type-checked with
  // `requireNumber` instead of `requireWholeNumber`.
  assert.deepEqual(result.diagnostics[0].params, {
    expected: "whole number",
    actual: "word",
    value: "soon",
    operation: "wait",
  });
  assert.deepEqual(effectEvents(result), []);
});

test("a word that reads as a non-whole number reports the WORD, like repeat's count does", () => {
  // `wait "1.5"` coerces far enough to be recognized as non-whole, and the offending value is
  // reported as the learner wrote it (`actual: "word"`, `value: "1.5"`) — exactly what
  // `repeat "2.5"` reports. The pre-#775 path pre-coerced through `requireNumber` and reported
  // `actual: "number"`, `value: 1.5`, losing the fact that the learner passed a word.
  const result = execute('wait "1.5"', doc);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-type");
  assert.deepEqual(result.diagnostics[0].params, {
    expected: "whole number",
    actual: "word",
    value: "1.5",
    operation: "wait",
  });
  assert.deepEqual(effectEvents(result), []);
});

test("a count that is BOTH non-whole AND negative raises ol-type, not ol-range (TYPE before RANGE)", () => {
  // The only input class that can observe the ORDER of the two checks — every other case is
  // non-whole OR out of range, never both. `spec/interaction-events.md`'s `### wait <n>` orders
  // them ("a non-whole count raises `ol-type`, and a negative count raises `ol-range`"), matching
  // `spec/commands.md`'s `repeat` entry. Running the range check first would put a FRACTIONAL value
  // into an `ol-range` count diagnostic and split `wait` from `repeat`. Found by mutation: the
  // inverted order passed a fully green run until this case existed.
  for (const [source, actual, value] of [
    ["wait -1.5", "number", -1.5],
    ['wait "-1.5"', "word", "-1.5"],
  ]) {
    const result = execute(source, doc);
    assert.equal(result.diagnostics.length, 1);
    assert.equal(result.diagnostics[0].code, "ol-type");
    assert.deepEqual(result.diagnostics[0].params, {
      expected: "whole number",
      actual,
      value,
      operation: "wait",
    });
    assert.deepEqual(effectEvents(result), []);
  }
});

test("a tick count that is neither a number nor a word names its own type", () => {
  // Completeness across the value model (`spec/execution-model.md`'s Core values, the Data
  // profile's `dict`/`record`, and the Sprites profile's `turtle` — every `OLTypeName` outside
  // `number`/`word`): each reaches the same `ol-type` with `actual` naming the offending type,
  // never a coerced stand-in. `spec/error-model.md` requires the message to "name the expected
  // learner concept, such as number, word, list, dict, record, or boolean", so labelling a dict or
  // a turtle a word would violate a MUST. `every` is pinned the same way in
  // `interaction-every.test.mjs`, and every class here has a conformance twin under
  // `tests/conformance/interaction-events/` — the harness unwraps an `OLDict`/`OLRecord` into a
  // plain key→value object, so those fixtures compare the contents too.
  const structPrelude = 'struct person [ name age ]\n:p = person "ada" 36\n';
  for (const [source, actual] of [
    ["wait [ 1 2 ]", "list"],
    ["wait true", "boolean"],
    ['wait { name: "ada" }', "dict"],
    [`${structPrelude}wait :p\n`, "record"],
    [":t = new_turtle\nwait :t\n", "turtle"],
  ]) {
    const result = execute(source, doc);
    assert.equal(result.diagnostics.length, 1);
    assert.equal(result.diagnostics[0].code, "ol-type");
    assert.equal(result.diagnostics[0].params.expected, "whole number");
    assert.equal(result.diagnostics[0].params.actual, actual);
    assert.equal(result.diagnostics[0].params.operation, "wait");
  }
  // The classes whose value snapshot IS faithfully comparable are pinned whole.
  for (const [source, actual, value] of [
    ["wait [ 1 2 ]", "list", [1, 2]],
    ["wait true", "boolean", true],
  ]) {
    const result = execute(source, doc);
    assert.deepEqual(result.diagnostics[0].params, {
      expected: "whole number",
      actual,
      value,
      operation: "wait",
    });
  }
  // A turtle's value is an `OLTurtle` instance, so it is pinned by its `id` rather than by a
  // structural deep-equal against a plain object — the conformance twin
  // `wait/wait-turtle-type-error` pins its `{ "id": 1 }` serialisation, which is faithful.
  const turtleValue = execute(":t = new_turtle\nwait :t\n", doc).diagnostics[0]
    .params.value;
  assert.equal(turtleValue.id, 1);
  // The dict/record values are class instances, so they are asserted through their public API
  // rather than by a structural deep-equal — `assert.deepEqual` is strict here and would compare
  // prototypes and private backing Maps. The conformance twins pin the same contents.
  const dictValue = execute('wait { name: "ada" }', doc).diagnostics[0].params
    .value;
  assert.deepEqual(dictValue.keys(), ["name"]);
  assert.equal(dictValue.get("name"), "ada");
  const recordValue = execute(`${structPrelude}wait :p\n`, doc).diagnostics[0]
    .params.value;
  assert.equal(recordValue.type, "person");
  assert.deepEqual(recordValue.fields(), ["name", "age"]);
  assert.equal(recordValue.get("name"), "ada");
  assert.equal(recordValue.get("age"), 36);
});

test("wait and every use ONE type vocabulary for every ol-type input class (issue #775 regression guard)", () => {
  // The defect: for the identical input class — a word that does not parse as a number — the two
  // Interaction numeric-argument forms disagreed (`every` said `whole number`, `wait` said
  // `number`). Both are whole-number arguments per `spec/interaction-events.md`, so the type
  // vocabulary — `expected`/`actual`/`value` — must match; `operation` still names the primitive
  // and is what keeps the two diagnostics distinguishable. Comparing the two live diagnostics
  // (rather than restating literals) means this fails if EITHER primitive drifts.
  //
  // EVERY `ol-type` input class is compared, not just the one that caused #775. `"soon"` alone is
  // NOT enough: a word that never coerces reaches both implementations unchanged, so a form that
  // pre-coerced numeric words before the wholeness check would still agree here. `"2.5"` is the arm
  // that observes pre-coercion, `2.5` anchors the plain non-whole number, `-1.5` is the
  // both-non-whole-and-out-of-range class that observes TYPE-before-RANGE, and the list, boolean,
  // dict, record, and turtle cover every value that is neither number nor word.
  //
  // `value` is compared for every class: `assert.deepEqual` is strict, so two distinct `OLDict`s
  // (or `OLRecord`s) carrying the same contents still compare equal through their backing Maps —
  // the comparison is not vacuous — while two carrying different contents do not.
  const structPrelude = 'struct person [ name age ]\n:p = person "ada" 36\n';
  for (const [waitSource, everySource] of [
    ['wait "soon"', 'every "soon" [ print "x" ]'],
    ['wait "2.5"', 'every "2.5" [ print "x" ]'],
    ["wait 2.5", 'every 2.5 [ print "x" ]'],
    ["wait -1.5", 'every -1.5 [ print "x" ]'],
    ["wait [ 1 2 ]", 'every [ 1 2 ] [ print "x" ]'],
    ["wait true", 'every true [ print "x" ]'],
    [":t = new_turtle\nwait :t\n", ':t = new_turtle\nevery :t [ print "x" ]\n'],
    ['wait { name: "ada" }', 'every { name: "ada" } [ print "x" ]'],
    [`${structPrelude}wait :p\n`, `${structPrelude}every :p [ print "x" ]\n`],
  ]) {
    const waitDiagnostic = execute(waitSource, doc).diagnostics[0];
    const everyDiagnostic = execute(everySource, doc).diagnostics[0];
    assert.equal(waitDiagnostic.code, everyDiagnostic.code);
    assert.equal(
      waitDiagnostic.params.expected,
      everyDiagnostic.params.expected,
    );
    assert.equal(waitDiagnostic.params.actual, everyDiagnostic.params.actual);
    assert.deepEqual(waitDiagnostic.params.value, everyDiagnostic.params.value);
    assert.equal(waitDiagnostic.params.operation, "wait");
    assert.equal(everyDiagnostic.params.operation, "every");
  }
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

// --- Tick-count validation is now entirely `executeWaitCall`'s, like `every`'s (issue #775) ----
//
// The exported `validateTickCount` helper is gone: after #775 its remaining job was a two-line
// non-negativity guard, which `executeWaitCall` now performs inline exactly as
// `executeEveryStatement` performs its own `<= 0` guard. That guard is covered end to end by
// `wait -1` (number literal), `wait "-1"` (the coerced-word arm — a number literal alone cannot
// observe the coercion boundary the guard sits behind), and `wait 0` / `wait 2` for the values it
// must let through. No separate unit is needed, and there is no longer a publicly exported
// "validate" that would silently accept a fractional count.

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

/**
 * #985 — the tick timeline: `ExecuteOptions.tickTimeline` plus `tickAtEventIndex`, the seam an
 * interactive host needs to schedule input against the program's own logical clock rather than a
 * counter of its own. It is deliberately OUT OF BAND: the trace stream carries no tick, and these
 * tests pin that supplying the sink changes neither the events nor the diagnostics.
 */

test("#985: tickAtEventIndex reports the tick an event was emitted at, and 0 before the first boundary", () => {
  const timeline = [
    { tick: 1, eventCount: 3 },
    { tick: 2, eventCount: 3 },
    { tick: 3, eventCount: 6 },
  ];

  // Events emitted before any tick advance belong to tick 0 — the program's own starting tick,
  // reported because it is correct and not as a fallback.
  assert.equal(tickAtEventIndex(timeline, 0), 0);
  assert.equal(tickAtEventIndex(timeline, 2), 0);

  // At and past a boundary's event count, that boundary's tick applies. Two boundaries share an
  // event count here (a tick that emitted nothing), and the LATER one must win.
  assert.equal(tickAtEventIndex(timeline, 3), 2);
  assert.equal(tickAtEventIndex(timeline, 5), 2);
  assert.equal(tickAtEventIndex(timeline, 6), 3);

  // Past the end of the stream the last tick still applies — a host asks for "the tick I am at",
  // and that is the final one once everything has been emitted.
  assert.equal(tickAtEventIndex(timeline, 99), 3);

  // An empty timeline is a run that never advanced its clock: every event is at tick 0.
  assert.equal(tickAtEventIndex([], 0), 0);
  assert.equal(tickAtEventIndex([], 42), 0);
});

test("#985: a run records one tick boundary per elapsed tick, and none for a pause that advances none", () => {
  function timelineOf(source) {
    const tickTimeline = [];
    execute(source, "tick-timeline.logo", { tickTimeline });
    return tickTimeline;
  }

  assert.deepEqual(
    timelineOf("wait 0"),
    [],
    "`wait 0` yields without advancing the clock, so it crosses no boundary",
  );
  assert.deepEqual(timelineOf("wait 1"), [{ tick: 1, eventCount: 1 }]);
  assert.deepEqual(timelineOf("wait 3"), [
    { tick: 1, eventCount: 1 },
    { tick: 2, eventCount: 1 },
    { tick: 3, eventCount: 1 },
  ]);
  assert.deepEqual(
    timelineOf("").length,
    0,
    "a program with no `wait` at all advances no tick",
  );
});

test("#985: supplying the timeline sink changes neither the event stream nor the diagnostics", () => {
  // The whole point of an out-of-band sink: it must be observationally inert. A host that asks for
  // the timeline must get byte-identical execution to one that does not.
  const source = ['on_key "up" [ print "H" ]', "wait 3"].join("\n");
  const options = {
    randomSeed: 7,
    hostInput: { events: [{ tick: 2, kind: "key", key: "up" }] },
  };

  const without = execute(source, "tick-timeline.logo", options);
  const tickTimeline = [];
  const withSink = execute(source, "tick-timeline.logo", {
    ...options,
    tickTimeline,
  });

  assert.equal(
    JSON.stringify(withSink.events),
    JSON.stringify(without.events),
    "no tick is smuggled into the trace stream, and nothing is reordered",
  );
  assert.deepEqual(withSink.diagnostics, without.diagnostics);
  assert.ok(
    tickTimeline.length > 0,
    "…and the sink was genuinely populated, so this is not a vacuous comparison",
  );
});

test("#985: the timeline is deterministic — same source, seed and input schedule, identical boundaries", () => {
  function play() {
    const tickTimeline = [];
    execute(
      ['on_key "up" [ print "H" ]', "wait 4"].join("\n"),
      "tick-timeline.logo",
      {
        randomSeed: 7,
        hostInput: { events: [{ tick: 2, kind: "key", key: "up" }] },
        tickTimeline,
      },
    );
    return JSON.stringify(tickTimeline);
  }

  assert.equal(play(), play());
});

// --- #953: a `wait` tick is a charged instruction ----------------------------------------------
//
// Before #953 the whole pause was ONE charged statement no matter how many ticks it ran, so `wait`
// was the only form in the language that was cancellable but not budgeted — half of the pair
// `spec/execution-model.md`'s Execution safety says safety comes from ("`forever` is therefore safe
// only because it is cancellable AND budgeted"). Measured on the saga tip before the fix, at the
// default budget: `wait 5000000` ran 2.0 s and produced two events and no diagnostic, while a bare
// `wait N` completed cleanly for every N up to 20,000,000 — there was no gate at all.

test("#953: a wait larger than the budget raises ol-limit, and an ordinary wait at the SAME budget does not", () => {
  // The paired control is the point: `ol-limit` on its own is satisfied by any budget too small for
  // anything, so the same budget must let a smaller `wait` through.
  const halted = execute("wait 5", doc, { instructionBudget: 5 });
  assert.equal(halted.diagnostics.length, 1);
  assert.equal(halted.diagnostics[0].code, "ol-limit");
  assert.deepEqual(halted.diagnostics[0].params, {
    limit: "instruction-budget",
    value: 5,
  });
  // The diagnostic points at the paused instruction, not at whatever ran before it.
  assert.deepEqual(halted.diagnostics[0].source_span.start, [1, 1]);

  const ordinary = execute("wait 2", doc, { instructionBudget: 5 });
  assert.deepEqual(ordinary.diagnostics, []);
  assert.equal(effectEvents(ordinary).length, 1);
});

test("#953: the rule is exactly one instruction per tick — `wait n` completes iff n < budget", () => {
  // Stated as the boundary rather than as a magnitude: the statement itself costs 1 and each tick
  // costs 1, so `wait n` needs n + 1. Both sides of the boundary are asserted, so a charge that
  // silently became 2-per-tick or 0-per-tick fails here rather than in a distant integration test.
  for (const n of [1, 2, 5, 20]) {
    assert.equal(
      execute(`wait ${n}`, doc, { instructionBudget: n }).diagnostics.length,
      1,
      `wait ${n} must not be affordable at a budget of ${n}`,
    );
    assert.deepEqual(
      execute(`wait ${n}`, doc, { instructionBudget: n + 1 }).diagnostics,
      [],
      `wait ${n} must be affordable at a budget of ${n + 1}`,
    );
  }
});

test("#953: a cut-short pause keeps its partial trace, stops the TIMELINE at the last affordable tick, and emits no primitive", () => {
  // `ol-limit` preserves the partial trace rather than discarding it — the established behavior
  // (`tests/conformance/core-language/execution/forever-instruction-budget-limit.expected.json`).
  // The trailing `primitive` is NOT emitted, because the pause did not complete, and the timeline
  // stops where the budget did: at a budget of 5 the statement takes 1 and four ticks are
  // affordable, so exactly four boundaries are recorded and the fifth tick is never reached.
  //
  // Named "timeline", not "clock", deliberately: the clock's own stop point is NOT observable
  // through `execute()`, so this test cannot pin it. The charge-before-advance ORDERING that keeps
  // the clock and the timeline agreeing is pinned separately, by the direct `runWait` test below —
  // a review-gate mutation (move the charge after `advanceTickClock`) survived this test and the
  // whole suite, because the timeline push sits after the charge under either ordering.
  const tickTimeline = [];
  const halted = execute("wait 5", doc, { instructionBudget: 5, tickTimeline });
  assert.equal(halted.diagnostics[0].code, "ol-limit");
  assert.deepEqual(
    halted.events.map((event) => event.kind),
    ["instruction"],
  );
  assert.equal(tickTimeline.length, 4);
  assert.equal(tickTimeline[tickTimeline.length - 1].tick, 4);
  // ...against the same program one unit richer, which completes and DOES emit the primitive.
  const clean = [];
  const completed = execute("wait 5", doc, {
    instructionBudget: 6,
    tickTimeline: clean,
  });
  assert.deepEqual(completed.diagnostics, []);
  assert.deepEqual(
    completed.events.map((event) => event.kind),
    ["instruction", "primitive"],
  );
  assert.equal(clean.length, 5);
});

test("#953: the charge is taken BEFORE the clock advances, so an unaffordable tick is never advanced to", () => {
  // The ordering claim `runWait`'s doc comment makes, pinned rather than merely asserted.
  //
  // A review-gate mutation that moved `charge()` to after `advanceTickClock` survived the entire
  // Definition of Done — 4792 unit tests, 941 conformance fixtures, every example — because the one
  // thing it changes is `tickClock.tick` after the halt, and `execute()` exposes no way to read it:
  // the timeline push sits after the charge under both orderings, so it cannot discriminate. That
  // makes this the only place the ordering can be observed, which is why it reaches past the public
  // API to `runWait` itself — the `../dist/<module>.js` idiom this package already uses for
  // internals (`execution-budget.test.mjs` -> `../dist/execute-internal.js`,
  // `not-a-place-text.test.mjs` -> `../dist/not-a-place-text.js`). Node resolves it to the same
  // module instance the package entry already loaded.
  //
  // Charging first, the last affordable tick is 4 and the clock stops there. Advancing first, the
  // clock would reach 5 — a tick the run could not pay for — leaving it one ahead of both the
  // timeline and the trace, which is exactly the disagreement the doc comment promises never happens.
  const clock = createTickClock();
  const events = [];
  const tickTimeline = [];
  let charges = 0;
  const interrupted = runWait(
    clock,
    events,
    5,
    { document: doc, start: [1, 1], end: [1, 7] },
    () => false,
    () => {
      charges += 1;
      return charges > 4;
    },
    tickTimeline,
  );
  assert.equal(interrupted, true, "the fifth charge must abort the pause");
  assert.equal(
    clock.tick,
    4,
    "the clock must not advance to an unaffordable tick",
  );
  assert.equal(tickTimeline.length, 4);
  assert.deepEqual(events, [], "an aborted pause emits no trailing primitive");
});

test("#953: `wait 0` advances no tick and is therefore charged nothing extra", () => {
  // The charge is taken per tick ADVANCED, and `wait 0` advances none — its spec-mandated yield is
  // not a tick. A budget of 1 covers the statement and nothing else, so a `wait 0` that took a tick
  // charge would halt here.
  const tickTimeline = [];
  const result = execute("wait 0", doc, { instructionBudget: 1, tickTimeline });
  assert.deepEqual(result.diagnostics, []);
  assert.equal(tickTimeline.length, 0);
  assert.deepEqual(
    result.events.map((event) => event.kind),
    ["instruction", "primitive"],
  );
});

test("#953: cancellation still wins over the budget AT A TICK, not merely at the statement gate", () => {
  // `checkExecutionLimits` checks the abort FIRST and does not charge for it, so an aborted run
  // paused in a `wait` reports `cancelled` — not `instruction-budget` — even with budget to spare.
  //
  // The signal must FLIP rather than start aborted. Review-gate finding: a pre-aborted signal halts
  // at `executeStatements`' own statement gate BEFORE `runWait` is ever entered, so it proves
  // nothing about the tick charge — the test reads as covering this path while covering a different
  // one. This getter is false for the two statement-level gates the program reaches first and true
  // from the third read on, which is inside `chargeTick`; the run therefore starts, enters the
  // pause, and is cancelled by the tick charge specifically.
  let reads = 0;
  const signal = {
    get aborted() {
      reads += 1;
      return reads > 2;
    },
  };
  const tickTimeline = [];
  const result = execute("print 1\nwait 50", doc, {
    instructionBudget: 1000,
    signal,
    tickTimeline,
  });
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-limit");
  assert.deepEqual(result.diagnostics[0].params, { limit: "cancelled" });
  // ...and it really was cancelled inside the pause: the first statement ran, and the pause was cut
  // far short of its 50 ticks with budget left over (1000 was never approached).
  assert.equal(
    result.events.filter((event) => event.kind === "print").length,
    1,
  );
  assert.ok(
    tickTimeline.length < 50,
    "the pause must have been cut short rather than completing",
  );
});

test("#953: `wait 0` still reaches the dispatcher's own cancellation poll, which the tick charge cannot mask", () => {
  // The companion to the test above, and the reason both are needed. `chargeTick` now polls the
  // abort before `dispatchDueHandlers` does, so on any tick-advancing pause the charge observes
  // cancellation first and the dispatcher's own poll is no longer uniquely exercised there.
  // `wait 0` advances no tick and therefore invokes NO charge callback at all, so the only thing
  // that can observe the abort inside the pause is `dispatchDueHandlers`. Deleting either poll
  // leaves the other test passing; this is the arm that keeps the dispatcher's poll load-bearing.
  const result = execute("wait 0", doc, {
    instructionBudget: 1000,
    signal: { aborted: true },
  });
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-limit");
  assert.deepEqual(result.diagnostics[0].params, { limit: "cancelled" });
});

test("#953: the idiomatic 'register handlers then hold the run open' program is unaffected", () => {
  // AC2. `spec/interaction-events.md` names this shape explicitly — "This is what lets a program
  // register its handlers and then hold itself open with a long `wait` while those handlers drive
  // the animation" — and `spec/examples/10-game.logo` is exactly it, holding open with `wait 300`.
  // At the default budget the whole program is three orders of magnitude inside the new ceiling, so
  // it runs clean and its handler still fires on every interval.
  const source = [
    'on_key "left" [ left 15 ]',
    "on_click [ print 1 ]",
    "every 30 [ forward 1 ]",
    "wait 300",
  ].join("\n");
  const result = execute(source, doc);
  assert.deepEqual(result.diagnostics, []);
  assert.equal(
    result.events.filter((event) => event.kind === "move").length,
    10,
    "every 30 must still fire ten times across 300 ticks",
  );
});
