// Unit tests for `when <event-word> <block>` — named event handler registration and dispatch
// (issue #682, slice I3 — `spec/interaction-events.md`'s `### when <event-word> <block>`, "Time,
// ticks, and handlers", "Trace stream integration", and "Errors and cancellation"). `when`
// registers a named handler and emits a `primitive` event AFTER registration; the standard `"start"`
// event is already being delivered in a batch run so its handler fires immediately, while `"stop"`
// is "a requested stop notification" that this run does not supply, so a `when "stop"`
// handler is registered but does not fire here. The
// event argument must be a word (`ol-type` otherwise). The stream stays deterministic and headless.
//
// Node-version trap (see the PR body): on Node 24+ `--experimental-test-coverage` silently excludes
// `*.test.mjs`, so a local coverage green can be a false positive CI (Node 22) then fails. These
// tests deliberately exercise every branch of the `when` registry (`interaction.ts`) and dispatch
// (`isWhenStatement`/`executeWhenStatement`/`invokeWhenHandler`/`fireEvent`) so the Node-22 CI gate
// sees full coverage.

import assert from "node:assert/strict";
import { test } from "node:test";
import { execute } from "@openlogo/runtime";

const doc = "when.logo";

/** The non-`instruction` events a program emits, for concise effect-sequence assertions. */
function effectEvents(result) {
  return result.events.filter((event) => event.kind !== "instruction");
}

// --- Registration emits `primitive` AFTER the handler is registered ---------------------------

test("when registration emits a primitive(when) event, headless (name only)", () => {
  // `"idle"` is a word nothing in this run delivers, so the handler only registers — isolating
  // the registration `primitive` from any handler-run events.
  const result = execute('when "idle" [ print "x" ]', doc);
  assert.deepEqual(result.diagnostics, []);
  const primitives = result.events.filter(
    (event) => event.kind === "primitive",
  );
  assert.equal(primitives.length, 1);
  // Headless: the payload's only key is `name` — no event word, tick, or timing leaks in.
  assert.deepEqual(Object.keys(primitives[0].payload), ["name"]);
  assert.equal(primitives[0].payload.name, "when");
});

test("the primitive event is emitted AFTER registration and BEFORE any handler run", () => {
  // A `"start"` handler fires immediately, so we can see the registration primitive (seq 1) precede
  // the handler-block-start instruction (seq 2) and body effects.
  const result = execute('when "start" [ print "ready" ]', doc);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(
    result.events.map((event) => event.kind),
    ["instruction", "primitive", "instruction", "instruction", "print"],
  );
});

// --- `"start"` fires immediately; registration is not invocation for other events -------------

test('a when "start" handler fires immediately, running its block', () => {
  const result = execute('when "start" [ print "ready" ]', doc);
  assert.deepEqual(
    effectEvents(result).map((event) => event.payload),
    [{ name: "when" }, { values: ["ready"] }],
  );
});

test("registration is NOT invocation: a non-live event registers without running the block", () => {
  const result = execute('when "idle" [ print "never" ]', doc);
  assert.deepEqual(result.diagnostics, []);
  // Only the registration primitive — the block did not run (no `print`).
  assert.deepEqual(
    effectEvents(result).map((event) => event.payload),
    [{ name: "when" }],
  );
});

test('two when "start" handlers fire in registration order', () => {
  const result = execute(
    'when "start" [ print "a" ]\nwhen "start" [ print "b" ]',
    doc,
  );
  assert.deepEqual(result.diagnostics, []);
  const printed = effectEvents(result)
    .filter((event) => event.kind === "print")
    .map((event) => event.payload.values[0]);
  assert.deepEqual(printed, ["a", "b"]);
});

// --- `"stop"` is a requested notification: registered, and not fired when none is supplied -----

test('a when "stop" handler is registered but does NOT fire without host input', () => {
  const result = execute('when "stop" [ print "bye" ]\nprint "mid"', doc);
  assert.deepEqual(result.diagnostics, []);
  const printed = effectEvents(result)
    .filter((event) => event.kind === "print")
    .map((event) => event.payload.values[0]);
  // `"stop"` is "a requested stop notification before termination"; this run supplies no such
  // request through `hostInput`, so only `mid` prints — `bye` never runs. A host that schedules
  // `"stop"` via `ExecuteOptions.hostInput` does fire it (#686/I7).
  assert.deepEqual(printed, ["mid"]);
});

test('a when "stop" registration still emits its primitive(when) event', () => {
  // Registration is not invocation: even though the `"stop"` block never runs here, the
  // `when` statement itself is executed, so the instruction+primitive pair is emitted.
  const result = execute('when "stop" [ print "never" ]', doc);
  const primitives = effectEvents(result).filter(
    (event) => event.kind === "primitive",
  );
  assert.equal(primitives.length, 1);
  assert.equal(primitives[0].payload.name, "when");
  // The block did not run, so no print event was produced.
  assert.equal(
    effectEvents(result).filter((event) => event.kind === "print").length,
    0,
  );
});

// --- The event argument must be a word: `ol-type`, never an ad-hoc string ----------------------

test("a non-word event argument (number) raises ol-type and registers nothing", () => {
  const result = execute('when 5 [ print "x" ]', doc);
  assert.equal(result.diagnostics.length, 1);
  const [diagnostic] = result.diagnostics;
  assert.equal(diagnostic.code, "ol-type");
  assert.equal(diagnostic.params.operation, "when");
  assert.equal(diagnostic.params.expected, "word");
  assert.equal(diagnostic.params.actual, "number");
  // The type check fails BEFORE registration, so no `primitive` event is emitted.
  assert.deepEqual(effectEvents(result), []);
});

test("a non-word event argument (list) raises ol-type", () => {
  const result = execute('when [ 1 2 ] [ print "x" ]', doc);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-type");
  assert.equal(result.diagnostics[0].params.actual, "list");
});

test("an event argument that fails to evaluate surfaces its own diagnostic, not ol-type", () => {
  // `:missing` is a supported argument shape (a variable reference) but evaluating it fails with
  // `ol-undefined-var`; `when` halts on that and never reaches the word-type check or registration.
  const result = execute('when :missing [ print "x" ]', doc);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-undefined-var");
  assert.deepEqual(effectEvents(result), []);
});

test("an unsupported event argument leaves the statement un-evaluated (no crash, no diagnostic, no event)", () => {
  // A nested command call (`forward 5`) is not a supported `when` event argument in this slice's
  // evaluator; the statement is left un-evaluated (its instruction event still emits) rather than
  // throwing or diagnosing — the same "defer if unsupported" convention `wait` and the turtle
  // commands use, so a later slice can widen the evaluator without this slice pre-judging the arg.
  const result = execute('when forward 5 [ print "x" ]', doc);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(effectEvents(result), []);
});

// --- The long `... end when` form behaves identically to the inline `[ ... ]` form ------------

test("the multiline `when ... end when` form behaves identically to the inline form", () => {
  const inline = execute('when "start" [ print "ready" ]', doc);
  const multiline = execute('when "start"\n  print "ready"\nend when', doc);
  assert.deepEqual(inline.diagnostics, []);
  assert.deepEqual(multiline.diagnostics, []);
  // Same effect sequence (spans differ, so compare payloads).
  assert.deepEqual(
    effectEvents(multiline).map((event) => event.payload),
    effectEvents(inline).map((event) => event.payload),
  );
});

test("a mismatched closing label (`end every` for a `when` block) raises ol-mismatched-end at parse stage", () => {
  const result = execute('when "start"\n  print "x"\nend every', doc);
  assert.equal(result.diagnostics.length, 1);
  const [diagnostic] = result.diagnostics;
  assert.equal(diagnostic.code, "ol-mismatched-end");
  assert.equal(diagnostic.stage, "parse");
  assert.equal(diagnostic.params.expected, "when");
  assert.equal(diagnostic.params.actual, "every");
  // Parse failed, so nothing ran.
  assert.deepEqual(result.events, []);
});

// --- Errors and cancellation propagate out of a handler body ----------------------------------

test('a runtime error inside a "start" handler body halts the whole run', () => {
  const result = execute('when "start" [ forward :missing ]', doc);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-undefined-var");
});

test('a runtime error inside a "start" handler registered in a procedure halts the run', () => {
  // The `"start"` handler fires immediately inside the procedure frame; a runtime error in its body
  // surfaces as the run diagnostic (it does not get swallowed by the enclosing procedure call).
  const result = execute(
    'define setup\n  when "start" [ forward :missing ]\nend\nsetup',
    doc,
  );
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-undefined-var");
});

test('a "start" handler runs in its registration-time scope (sees a procedure parameter)', () => {
  // Finding: a handler block is a normal block, so it resolves variables against the environment it
  // was registered in. Registered inside `setup :x` and fired immediately, it must see `:x` = 7.
  const result = execute(
    'define setup :x\n  when "start" [ print :x ]\nend\nsetup 7',
    doc,
  );
  assert.deepEqual(result.diagnostics, []);
  const printed = effectEvents(result)
    .filter((event) => event.kind === "print")
    .map((event) => event.payload.values[0]);
  assert.deepEqual(printed, [7]);
});

test("a `return` escaping a handler registered inside a procedure is still ol-return-outside-proc", () => {
  // The handler boundary reclassifies an escaping `return` even when a procedure frame is on the
  // stack, so it cannot be silently consumed as the enclosing procedure's own return.
  const result = execute(
    'define setup\n  when "start" [ return 5 ]\nend\nsetup',
    doc,
  );
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-return-outside-proc");
});

test("a `return` escaping a handler body is ol-return-outside-proc (a handler block is not a procedure)", () => {
  const result = execute('when "start" [ return 5 ]', doc);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-return-outside-proc");
});

test("a `stop` escaping a handler body is ol-stop-outside-proc", () => {
  const result = execute('when "start" [ stop ]', doc);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-stop-outside-proc");
});

// --- A non-`when` profile statement is not treated as a handler -------------------------------

test("a non-when profile statement (`every`) is not dispatched as a when handler", () => {
  // `isWhenStatement` must return false for a ProfileStatement whose head keyword is not `when`, so
  // `every` is not registered as a `when` handler. Since #683 (slice I4) landed, `every` has its own
  // runtime behavior — it registers a timed handler and emits a `primitive(every)` event on
  // registration — so its only effect event here is that registration primitive (never a `when`
  // primitive, and, with no `wait` to advance the clock, its body never runs).
  const result = execute('every 2 [ print "x" ]', doc);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(
    effectEvents(result).map((event) => event.payload),
    [{ name: "every" }],
  );
});

// --- Determinism: same program, same event sequence every run ---------------------------------

test("the same when program produces an identical event sequence on every run", () => {
  const program =
    'when "start" [ print "a" ]\nwhen "stop" [ print "z" ]\nprint "mid"';
  const first = execute(program, doc);
  const second = execute(program, doc);
  assert.deepEqual(first.diagnostics, []);
  assert.deepEqual(first.events, second.events);
});
