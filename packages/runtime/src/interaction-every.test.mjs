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
// (`isEveryStatement`/`executeEveryStatement`/`invokeEveryHandler`/`dispatchDueHandlers/claimQueuedEveryHandlers`) so the
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

test("a WORD that reads as a non-positive number still raises ol-range, with the coerced value", () => {
  // The RANGE arm reached through a word. `spec/execution-model.md:33-34` accepts a word that
  // parses as a number wherever a number is expected, so `every "0"` must reach the same `ol-range`
  // the literal `0` does. Nothing exercised that composition: every range case passed a number
  // literal, so an implementation that guarded the range only when the argument was literally a
  // number would REGISTER a handler with an interval of 0 or -3 — an unbounded-rerun hazard — and
  // still pass a fully green run. Found by mutation.
  //
  // `params.value` is the COERCED number, not the word — the opposite of the `ol-type` arm above,
  // deliberately: `ol-range` asks about magnitude, which exists only after coercion, while
  // `ol-type` asks what the learner actually wrote.
  for (const [source, value] of [
    ['every "0" [ print "x" ]', 0],
    ['every "-3" [ print "x" ]', -3],
  ]) {
    const result = execute(source, doc);
    assert.equal(result.diagnostics.length, 1);
    assert.equal(result.diagnostics[0].code, "ol-range");
    assert.deepEqual(result.diagnostics[0].params, {
      operation: "every",
      value,
    });
    // The range check fails BEFORE registration — nothing registered, no `primitive(every)`.
    assert.deepEqual(effectEvents(result), []);
  }
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

test("a count that is BOTH non-whole AND non-positive raises ol-type, not ol-range (TYPE before RANGE)", () => {
  // The only input class that can observe the ORDER of the two checks — every other case is
  // non-whole OR out of range, never both. `spec/interaction-events.md`'s `### every <n> <block>`
  // orders them ("a non-whole count raises `ol-type`, and a zero or negative count raises
  // `ol-range`"), matching `spec/commands.md`'s `repeat` entry. Running the range check first would
  // put a FRACTIONAL value into an `ol-range` count diagnostic and split `every` from `repeat`.
  // Found by mutation: the inverted order passed a fully green run until this case existed.
  for (const [source, actual, value] of [
    ['every -2.5 [ print "x" ]', "number", -2.5],
    ['every "-2.5" [ print "x" ]', "word", "-2.5"],
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

test("a count that is neither a number nor a word names its own type", () => {
  // Completeness across the value model (`spec/execution-model.md`'s Core values, the Data
  // profile's `dict`/`record`, and the Sprites profile's `turtle` — every `OLTypeName` outside
  // `number`/`word`): each reaches the same `ol-type` with `actual` naming the offending type,
  // never a coerced stand-in. `spec/error-model.md` requires the message to "name the expected
  // learner concept, such as number, word, list, dict, record, or boolean", so labelling a dict or
  // a turtle a word would violate a MUST. `wait` is pinned the same way in
  // `interaction-wait.test.mjs`, and every class here has a conformance twin under
  // `tests/conformance/interaction-events/` — the harness unwraps an `OLDict`/`OLRecord` into a
  // plain key→value object, so those fixtures compare the contents too.
  const structPrelude = 'struct person [ name age ]\n:p = person "ada" 36\n';
  for (const [source, actual] of [
    ['every [ 1 2 ] [ print "x" ]', "list"],
    ['every true [ print "x" ]', "boolean"],
    ['every { name: "ada" } [ print "x" ]', "dict"],
    [`${structPrelude}every :p [ print "x" ]\n`, "record"],
    [':t = new_turtle\nevery :t [ print "x" ]\n', "turtle"],
  ]) {
    const result = execute(source, doc);
    assert.equal(result.diagnostics.length, 1);
    assert.equal(result.diagnostics[0].code, "ol-type");
    assert.equal(result.diagnostics[0].params.expected, "whole number");
    assert.equal(result.diagnostics[0].params.actual, actual);
    assert.equal(result.diagnostics[0].params.operation, "every");
  }
  // The classes whose value snapshot IS faithfully comparable are pinned whole.
  for (const [source, actual, value] of [
    ['every [ 1 2 ] [ print "x" ]', "list", [1, 2]],
    ['every true [ print "x" ]', "boolean", true],
  ]) {
    const result = execute(source, doc);
    assert.deepEqual(result.diagnostics[0].params, {
      expected: "whole number",
      actual,
      value,
      operation: "every",
    });
  }
  // A turtle's value is an `OLTurtle` instance, so it is pinned by its `id` rather than by a
  // structural deep-equal against a plain object — the conformance twin
  // `every/every-turtle-type-error` pins its `{ "id": 1 }` serialisation, which is faithful.
  const turtleValue = execute(':t = new_turtle\nevery :t [ print "x" ]\n', doc)
    .diagnostics[0].params.value;
  assert.equal(turtleValue.id, 1);
  // The dict/record values are class instances, so they are asserted through their public API
  // rather than by a structural deep-equal — `assert.deepEqual` is strict here and would compare
  // prototypes and private backing Maps. The conformance twins pin the same contents.
  const dictValue = execute('every { name: "ada" } [ print "x" ]', doc)
    .diagnostics[0].params.value;
  assert.deepEqual(dictValue.keys(), ["name"]);
  assert.equal(dictValue.get("name"), "ada");
  const recordValue = execute(`${structPrelude}every :p [ print "x" ]\n`, doc)
    .diagnostics[0].params.value;
  assert.equal(recordValue.type, "person");
  assert.deepEqual(recordValue.fields(), ["name", "age"]);
  assert.equal(recordValue.get("name"), "ada");
  assert.equal(recordValue.get("age"), 36);
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

// --- The queueing rule: a missed occurrence is coalesced to one and RUN, never dropped -----------

test("a re-entrant wait inside an every handler does not deliver a second OVERLAPPING invocation", () => {
  // The handler for `every 2` runs a nested `wait 2`. While that inner wait advances the clock past
  // another due tick for the SAME handler, the handler is already `running`, so the arriving
  // occurrence is QUEUED rather than re-entered — no invocation ever overlaps itself, which is what
  // "at most one pending invocation" buys (`spec/interaction-events.md:189-196`). The queued
  // occurrence is not lost: it is drained once the body returns, so the run prints twice. What is
  // pinned here is the absence of OVERLAP, not the absence of a second run — the second `print`
  // provably follows the first rather than interleaving with it.
  const result = execute('every 2 [ print "x" wait 2 ]\nwait 2', doc);
  assert.deepEqual(result.diagnostics, []);
  const prints = effectEvents(result).filter((event) => event.kind === "print");
  assert.equal(prints.length, 2);
});

test("an occurrence missed while the handler was running is queued and RUNS once it is free", () => {
  // Maintainer ruling #984: coalescing is REQUIRED, not optional, and the queued occurrence runs
  // "once the handler is free" — not at whatever later checkpoint the program happens to supply.
  // `every 3`'s body takes 4 ticks, so the interval arriving at tick 6 lands while the tick-3
  // invocation is still running and must be queued. The body finishes at tick 7 and the queued
  // occurrence is drained immediately after it, inside the SAME dispatch — note the outer `wait 3`
  // has already spent its last tick, so a runtime that waits for a fresh checkpoint prints once and
  // loses the occurrence, which is the rejected "drop it" reading wearing a different hat.
  const result = execute('every 3 [ print "a" wait 4 ]\nwait 3', doc);
  assert.deepEqual(result.diagnostics, []);
  const prints = effectEvents(result).filter((event) => event.kind === "print");
  assert.equal(prints.length, 2);
});

test("a queued-but-unstarted occurrence is discarded when the run closes", () => {
  // The run-lifetime half of ruling #984: "the run's lifetime is the main line's business — an
  // `every` handler does not extend it". The drained invocation above overruns in its turn and
  // queues another occurrence, but the main line's `wait 3` is spent, so the run closes and that
  // occurrence is discarded. Exactly two prints and NO diagnostic. Draining in a loop until the
  // queues empty instead manufactures ticks the main line never asked for, running back to back
  // until the budget raises `ol-limit` — measured at 333,333 prints before this was corrected.
  const result = execute('every 3 [ print "a" wait 4 ]\nwait 3', doc);
  assert.deepEqual(result.diagnostics, []);
});

test("a halt from the boundary drain propagates and stops the run", () => {
  // The drain at a main-line statement boundary is a real handler dispatch, so it passes the same
  // budget/cancellation gate as any other: `guardHandlerDispatch` refuses a firing the budget cannot
  // afford and the halt propagates instead of the statement running. Measured against the same
  // program WITHOUT the trailing `print` at the same budget of 9, which completes cleanly with no
  // diagnostic — so the `ol-limit` here is caused specifically by the boundary drain being attempted,
  // not by the budget being too small for the program's own statements.
  const source = 'every 3 [ print "a" wait 4 ]\nwait 3\nprint "main"';
  const halted = execute(source, doc, { instructionBudget: 9 });
  assert.equal(halted.diagnostics.length, 1);
  assert.equal(halted.diagnostics[0].code, "ol-limit");
  assert.deepEqual(
    effectEvents(halted)
      .filter((event) => event.kind === "print")
      .map((event) => event.payload.values[0]),
    ["a", "a"],
  );
  const withoutTail = execute('every 3 [ print "a" wait 4 ]\nwait 3', doc, {
    instructionBudget: 9,
  });
  assert.deepEqual(withoutTail.diagnostics, []);
});

test("the main-line boundary reaches every container, including a comprehension body", () => {
  // Ruling #984's "run it once the handler is free" holds for as long as the main line has not
  // finished — and a `repeat` body, a `for … in` body, and a `map` iteration are all main-line
  // progress. The first two go through the statement executor and inherit its per-statement
  // boundary; a comprehension body is an EXPRESSION and does not, so it runs the same hook at its
  // own per-iteration point. Measured before that was added: the two loops gave a queued occurrence
  // three chances each and the comprehension gave it none — 6, 6, 3. All three now agree.
  const handlerPrints = (source) =>
    effectEvents(execute(source, doc)).filter(
      (event) => event.kind === "print" && event.payload.values[0] === "a",
    ).length;
  const prelude = 'every 3 [ print "a" wait 4 ]\nwait 3\n';
  assert.equal(handlerPrints(`${prelude}repeat 3 [ print "y" ]`), 6);
  assert.equal(handlerPrints(`${prelude}for i in [1 2 3] [ print "y" ]`), 6);
  assert.equal(handlerPrints(`${prelude}print map i in [1 2 3] [ :i ]`), 6);
});

test("a halt from the comprehension boundary propagates out of the comprehension", () => {
  // The per-iteration boundary inside a comprehension is a real handler dispatch, so the budget gate
  // can refuse a drained firing — and a comprehension is an EXPRESSION context, which has no way to
  // carry an execution signal. The halt therefore has to surface as the evaluation's own diagnostic.
  // Measured at a budget of 19: the handler fires five times and the run then stops with `ol-limit`,
  // against six firings and no diagnostic at a budget of 24.
  const source =
    'every 3 [ print "a" wait 4 ]\nwait 3\nprint map i in [1 2 3] [ :i ]';
  const halted = execute(source, doc, { instructionBudget: 19 });
  assert.equal(halted.diagnostics.length, 1);
  assert.equal(halted.diagnostics[0].code, "ol-limit");
  const clean = execute(source, doc, { instructionBudget: 24 });
  assert.deepEqual(clean.diagnostics, []);
});

test("the same halt propagates out of a reduce comprehension", () => {
  // `reduce` has its own iteration loop, so its boundary is a separate code path from `map`/`filter`.
  const source =
    'every 3 [ print "a" wait 4 ]\nwait 3\nprint reduce sum i in [1 2 3] from 0 [ :sum + :i ]';
  const halted = execute(source, doc, { instructionBudget: 19 });
  assert.equal(halted.diagnostics.length, 1);
  assert.equal(halted.diagnostics[0].code, "ol-limit");
});

test("the `each` iteration charge and its boundary halt both propagate", () => {
  // Two new halt paths came with the eighth container, and each needs its own witness.
  // (1) The iteration is now charged against the budget, so a run with more turtles than budget
  //     stops mid-`each` — it is no longer possible to iterate turtles for free.
  const charged = execute(
    `${"new_turtle\n".repeat(8)}tell turtles\neach [ ]`,
    doc,
    { instructionBudget: 10 },
  );
  assert.equal(charged.diagnostics.length, 1);
  assert.equal(charged.diagnostics[0].code, "ol-limit");
  const affordable = execute(
    `${"new_turtle\n".repeat(8)}tell turtles\neach [ ]`,
    doc,
    { instructionBudget: 11 },
  );
  assert.deepEqual(affordable.diagnostics, []);
  // (2) The boundary drain inside an empty `each` body is a real handler dispatch, so the budget
  //     gate can refuse it and that halt must propagate out of the loop rather than be swallowed.
  const source =
    'new_turtle\nnew_turtle\nevery 3 [ print "a" wait 4 ]\nwait 3\ntell turtles\neach [ ]';
  const refused = execute(source, doc, { instructionBudget: 19 });
  assert.equal(refused.diagnostics.length, 1);
  assert.equal(refused.diagnostics[0].code, "ol-limit");
  const clean = execute(source, doc, { instructionBudget: 22 });
  assert.deepEqual(clean.diagnostics, []);
});

test("an EMPTY `each` body still offers a main-line boundary each iteration", () => {
  // The eighth container. An `each` iteration narrows the addressed set to one turtle and runs a
  // body, so it is main-line progress exactly as a loop iteration is — but the boundary fires per
  // STATEMENT, so an empty per-turtle body had none. Measured before the fix: two turtles with
  // `each [ ]` gave four firings where `each [ print 0 ]` and `repeat 2 [ ]` both gave five.
  const handlerPrints = (source) =>
    effectEvents(execute(source, doc)).filter(
      (event) => event.kind === "print" && event.payload.values[0] === "a",
    ).length;
  const prelude =
    'new_turtle\nnew_turtle\nevery 3 [ print "a" wait 4 ]\nwait 3\ntell turtles\n';
  assert.equal(handlerPrints(`${prelude}each [ ]`), 5);
  // The empty and non-empty per-turtle bodies agree, and both agree with the equivalent loop.
  assert.equal(handlerPrints(`${prelude}each [ print 0 ]`), 5);
  assert.equal(
    handlerPrints('every 3 [ print "a" wait 4 ]\nwait 3\nrepeat 2 [ ]'),
    5,
  );
});

test("an EMPTY loop body still offers a main-line boundary each iteration", () => {
  // The boundary that covers every other container fires per STATEMENT, so a body with no statements
  // had none — yet each of its iterations is charged against the budget and is main-line progress on
  // exactly the same terms. Measured before this was fixed: `forever [ ]` gave a queued occurrence
  // three firings before `ol-limit` where `forever [ print 0 ]` gave eleven, so ruling #984's
  // back-to-back guarantee held only for loops that happened to contain something.
  const handlerPrints = (source, options) =>
    effectEvents(execute(source, doc, options)).filter(
      (event) => event.kind === "print" && event.payload.values[0] === "a",
    ).length;
  const prelude = 'every 3 [ print "a" wait 4 ]\nwait 3\n';
  assert.equal(handlerPrints(`${prelude}repeat 4 [ ]`), 7);
  // The empty and non-empty bodies now agree: neither is starved of boundaries.
  assert.equal(handlerPrints(`${prelude}repeat 4 [ print 0 ]`), 7);
});

test("a queued occurrence still RUNS when the main line has statements left", () => {
  // The other side of the same boundary, and the defect a review caught: "discard when the run
  // closes" must not become "discard whenever the tick dispatch is over". This is the program above
  // plus one more top-level statement, so the run is still open and the handler is free — that
  // occurrence must run. Measured a, a, a, main: the third fires at the statement boundary before
  // `print "main"`, and the one ITS body queues is discarded when the main line ends, so the count
  // does not run away. Draining only inside the tick dispatch prints a, a, main.
  const result = execute(
    'every 3 [ print "a" wait 4 ]\nwait 3\nprint "main"',
    doc,
  );
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(
    effectEvents(result)
      .filter((event) => event.kind === "print")
      .map((event) => event.payload.values[0]),
    ["a", "a", "a", "main"],
  );
});

test("under an explicit forever, an overrunning handler runs back to back until the budget stops it", () => {
  // The counterpart: a learner who wants the timer to keep firing says so, and then
  // `spec/interaction-events.md:189-196`'s "degrades to running back to back" applies, bounded by
  // the ordinary instruction budget exactly as any non-terminating program is (`:79`). This is what
  // keeps the discard rule honest — without it, "discarded when the run closes" could be satisfied
  // by never draining at all.
  const result = execute(
    'every 2 [ print "a" wait 3 ]\nforever [ wait 1 ]',
    doc,
    {
      instructionBudget: 60,
    },
  );
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-limit");
  const prints = effectEvents(result).filter((event) => event.kind === "print");
  assert.ok(
    prints.length > 1,
    "the handler fired repeatedly before the budget stopped it",
  );
});

test("further intervals arriving while one is already queued coalesce: the queue never exceeds one", () => {
  // The cap. A once-firing `on_key` holds the thread for 17 ticks while the `every 4` handler is
  // claimed, so four of its intervals (ticks 8, 12, 16, 20) arrive and all coalesce into the single
  // slot. The outer `wait 26` keeps the run OPEN past the blockage, which is what makes the cap
  // observable at all: a backlog drains one occurrence per checkpoint, so if the main line stopped
  // supplying checkpoints when the block ended, a capped and an uncapped queue would be
  // indistinguishable. Measured 7 prints here against 10 for an uncapped counter.
  const result = execute(
    'every 4 [ print "a" ]\non_key "space" [ wait 17 ]\nwait 26',
    doc,
    { hostInput: { events: [{ tick: 4, kind: "key", key: "space" }] } },
  );
  assert.deepEqual(result.diagnostics, []);
  const prints = effectEvents(result).filter((event) => event.kind === "print");
  assert.equal(prints.length, 7);
});

test("the interval clock is FIXED RATE: a late invocation does not re-measure the period", () => {
  // Maintainer ruling #984, `spec/interaction-events.md:183-187`. A one-time block separates the two
  // readings: a key press at tick 4 holds the thread for six ticks while the `every 4` handler is
  // claimed, so the handler is delayed but its clock is not — intervals stand at ticks 4, 8 and 12,
  // the original grid, and the run prints four times. Under fixed DELAY the period would restart
  // from each invocation's completion, pushing the next interval past the end of the outer
  // `wait 12`; that runtime prints three times.
  const result = execute(
    'every 4 [ print "a" ]\non_key "space" [ wait 6 ]\nwait 12',
    doc,
    { hostInput: { events: [{ tick: 4, kind: "key", key: "space" }] } },
  );
  assert.deepEqual(result.diagnostics, []);
  const prints = effectEvents(result).filter((event) => event.kind === "print");
  assert.equal(prints.length, 4);
});

test("a sibling handler is not re-fired out of order by another handler's re-entrant wait", () => {
  // Both handlers are due on tick 2. The first handler's body runs a nested `wait 2`, advancing the
  // clock to tick 4 — the second handler's next interval boundary. Because the outer batch marks
  // both handlers `claimed` up front, the inner wait cannot claim the sibling a second time and
  // fire it out of chronological order; it queues that occurrence instead. The batch therefore runs
  // them once each in registration order, and the two queued tick-4 occurrences are then drained
  // after it, again in registration order: a, b, a, b.
  const result = execute(
    'every 2 [ print "a" wait 2 ]\nevery 2 [ print "b" ]\nwait 2',
    doc,
  );
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(
    effectEvents(result)
      .filter((event) => event.kind === "print")
      .map((event) => event.payload.values[0]),
    ["a", "b", "a", "b"],
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
