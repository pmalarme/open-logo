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
  // `interaction-every.test.mjs`.
  //
  // The `dict` and `record` arms are unit-only, deliberately: their `params.value` currently
  // serialises to JSON lossily (`{"entries":{}}` for a dict, `slots:{}` for a record — the Map
  // contents vanish), so a conformance fixture would make that lossy shape normatively binding on
  // every implementation. See the "Deliberately NOT fixtured" note in
  // `tests/conformance/interaction-events/README.md`. The LIVE value is not lossy, so it is
  // asserted here; only its JSON form is unsafe to pin.
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
  // The dict/record value is only lossy through JSON: assert the live payload through its public
  // API, so the snapshot is pinned without making its serialisation normative.
  const dictValue = execute('wait { name: "ada" }', doc).diagnostics[0].params
    .value;
  assert.deepEqual(dictValue.keys(), ["name"]);
  assert.equal(dictValue.get("name"), "ada");
  const recordValue = execute(`${structPrelude}wait :p\n`, doc).diagnostics[0]
    .params.value;
  assert.equal(recordValue.type, "person");
  assert.deepEqual(recordValue.fields(), ["name", "age"]);
  assert.equal(recordValue.get("name"), "ada");
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
  // `value` is compared only where its snapshot is faithfully comparable: a dict/record `value`
  // serialises lossily and comparing the two live objects would pass vacuously, so those two
  // classes compare `expected`/`actual` and have their payloads pinned per-primitive above.
  const structPrelude = 'struct person [ name age ]\n:p = person "ada" 36\n';
  for (const [waitSource, everySource, comparesValue] of [
    ['wait "soon"', 'every "soon" [ print "x" ]', true],
    ['wait "2.5"', 'every "2.5" [ print "x" ]', true],
    ["wait 2.5", 'every 2.5 [ print "x" ]', true],
    ["wait -1.5", 'every -1.5 [ print "x" ]', true],
    ["wait [ 1 2 ]", 'every [ 1 2 ] [ print "x" ]', true],
    ["wait true", 'every true [ print "x" ]', true],
    [
      ":t = new_turtle\nwait :t\n",
      ':t = new_turtle\nevery :t [ print "x" ]\n',
      true,
    ],
    ['wait { name: "ada" }', 'every { name: "ada" } [ print "x" ]', false],
    [
      `${structPrelude}wait :p\n`,
      `${structPrelude}every :p [ print "x" ]\n`,
      false,
    ],
  ]) {
    const waitDiagnostic = execute(waitSource, doc).diagnostics[0];
    const everyDiagnostic = execute(everySource, doc).diagnostics[0];
    assert.equal(waitDiagnostic.code, everyDiagnostic.code);
    assert.equal(
      waitDiagnostic.params.expected,
      everyDiagnostic.params.expected,
    );
    assert.equal(waitDiagnostic.params.actual, everyDiagnostic.params.actual);
    if (comparesValue) {
      assert.deepEqual(
        waitDiagnostic.params.value,
        everyDiagnostic.params.value,
      );
    }
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
