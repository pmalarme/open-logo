// Unit tests for `on_key <key-word> <block>` — keyboard-handler registration (issue #684, slice I5 —
// `spec/interaction-events.md`'s `### on_key <key-word> <block>`, "Time, ticks, and handlers", and
// "Trace stream integration"). `on_key` registers a handler and emits a `primitive` event AFTER
// registration; the key argument MUST be a word (`ol-type` otherwise). A key press is host input, so
// in a headless batch `execute()` run there is no keyboard and the handler is registered but never
// delivered — exactly like a `when "stop"` handler. The stream stays deterministic and headless: no
// key word leaks into any payload.
//
// Node-version trap (see the PR body): on Node 24+ `--experimental-test-coverage` silently excludes
// `*.test.mjs`, so a local coverage green can be a false positive CI (Node 22) then fails. These
// tests deliberately exercise every branch of the `on_key` registry (`interaction.ts`'s
// `registerOnKeyHandler`/`emitOnKeyPrimitive`) and dispatch (`isOnKeyStatement`/
// `executeOnKeyStatement`) so the Node-22 CI gate sees full coverage.

import assert from "node:assert/strict";
import { test } from "node:test";
import { execute } from "@openlogo/runtime";

const doc = "on-key.logo";

/** The non-`instruction` events a program emits, for concise effect-sequence assertions. */
function effectEvents(result) {
  return result.events.filter((event) => event.kind !== "instruction");
}

// --- Registration emits `primitive` AFTER the handler is registered, headless -----------------

test("on_key registration emits a primitive(on_key) event, headless (name only)", () => {
  const result = execute('on_key "space" [ forward 20 ]', doc);
  assert.deepEqual(result.diagnostics, []);
  const primitives = result.events.filter(
    (event) => event.kind === "primitive",
  );
  assert.equal(primitives.length, 1);
  // Headless: the payload's only key is `name` — no key word or timing leaks in.
  assert.deepEqual(Object.keys(primitives[0].payload), ["name"]);
  assert.equal(primitives[0].payload.name, "on_key");
});

test("registration is NOT invocation: the handler block never runs in a headless batch run", () => {
  // No keyboard in a headless run, so `on_key` registers but is never delivered — only the
  // registration's instruction+primitive pair appears, never the body's `forward` move.
  const result = execute('on_key "space" [ forward 20 ]', doc);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(
    effectEvents(result).map((event) => event.payload),
    [{ name: "on_key" }],
  );
});

test("registration is not delivered even when a wait pause advances the tick clock", () => {
  // A key press is host input, not a timed event: unlike `every`, advancing the tick clock through a
  // `wait` must NOT fire an `on_key` handler. Only the registration primitive and the wait primitive
  // appear; the body never runs.
  const result = execute('on_key "space" [ forward 20 ]\nwait 10', doc);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(
    effectEvents(result).map((event) => event.payload),
    [{ name: "on_key" }, { name: "wait" }],
  );
});

test("the registration instruction event carries the on_key block-head span", () => {
  const result = execute('on_key "space" [ forward 20 ]', doc);
  const [instruction] = result.events;
  assert.equal(instruction.kind, "instruction");
  assert.equal(instruction.payload.statement_kind, "ProfileStatement");
  assert.deepEqual(instruction.source_span.start, [1, 1]);
});

// --- The key argument must be a word: `ol-type`, never an ad-hoc string ------------------------

test("a non-word key argument (number) raises ol-type and registers nothing", () => {
  const result = execute("on_key 5 [ forward 20 ]", doc);
  assert.equal(result.diagnostics.length, 1);
  const [diagnostic] = result.diagnostics;
  assert.equal(diagnostic.code, "ol-type");
  assert.equal(diagnostic.stage, "runtime");
  assert.equal(diagnostic.params.operation, "on_key");
  assert.equal(diagnostic.params.expected, "word");
  assert.equal(diagnostic.params.actual, "number");
  // The type check fails BEFORE registration, so no `primitive` event is emitted.
  assert.deepEqual(effectEvents(result), []);
});

test("a non-word key argument (list) raises ol-type", () => {
  const result = execute("on_key [ 1 2 ] [ forward 20 ]", doc);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-type");
  assert.equal(result.diagnostics[0].params.actual, "list");
});

test("a non-word key argument (boolean) raises ol-type", () => {
  const result = execute("on_key true [ forward 20 ]", doc);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-type");
  assert.equal(result.diagnostics[0].params.actual, "boolean");
});

test("a key argument that fails to evaluate surfaces its own diagnostic, not ol-type", () => {
  // `:missing` is a supported argument shape (a variable reference) but evaluating it fails with
  // `ol-undefined-var`; `on_key` halts on that and never reaches the word-type check or registration.
  const result = execute("on_key :missing [ forward 20 ]", doc);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-undefined-var");
  assert.deepEqual(effectEvents(result), []);
});

test("an unsupported key argument leaves the statement un-evaluated (no crash, no diagnostic, no event)", () => {
  // A nested command call (`forward 5`) is not a supported `on_key` key argument in this slice's
  // evaluator; the statement is left un-evaluated (its instruction event still emits) rather than
  // throwing or diagnosing — the same "defer if unsupported" convention `wait`/`when` use.
  const result = execute("on_key forward 5 [ forward 20 ]", doc);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(effectEvents(result), []);
});

// --- The long `... end on_key` form behaves identically to the inline `[ ... ]` form -----------

test("the multiline on_key ... end on_key form registers the same primitive", () => {
  const result = execute('on_key "space"\n  forward 20\nend on_key', doc);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(
    effectEvents(result).map((event) => event.payload),
    [{ name: "on_key" }],
  );
});

test("a mismatched labeled end on an on_key block raises ol-mismatched-end at parse time", () => {
  const result = execute('on_key "space"\n  forward 20\nend when', doc);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-mismatched-end");
});

// --- Awkward positions: nested, registered twice, key words other than "space" -----------------

test("on_key registered inside a repeat body registers one handler per iteration", () => {
  const result = execute('repeat 3 [ on_key "a" [ forward 1 ] ]', doc);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(
    effectEvents(result).map((event) => event.payload),
    [{ name: "on_key" }, { name: "on_key" }, { name: "on_key" }],
  );
});

test("on_key registered inside a procedure body captures its registration-time scope", () => {
  // The handler registers when the procedure runs; nothing fires it, so only the registration
  // primitive appears among the handler's own effects — proving registration happens inside the call
  // without error. (The surrounding `setup` call emits its own primitive envelope.)
  const result = execute(
    'define setup\n  on_key "left" [ left 90 ]\nend\nsetup',
    doc,
  );
  assert.deepEqual(result.diagnostics, []);
  const onKeyPrimitives = result.events.filter(
    (event) => event.kind === "primitive" && event.payload.name === "on_key",
  );
  assert.equal(onKeyPrimitives.length, 1);
  // The handler body's `left 90` never runs (no key delivered), so no `move` effect appears.
  assert.equal(
    result.events.some((event) => event.kind === "move"),
    false,
  );
});

test("registering on_key twice for the same key registers both, in order, with no error", () => {
  const result = execute(
    'on_key "space" [ forward 1 ]\non_key "space" [ forward 2 ]',
    doc,
  );
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(
    effectEvents(result).map((event) => event.payload),
    [{ name: "on_key" }, { name: "on_key" }],
  );
});

test("a single printable-character key word registers like a named key", () => {
  const result = execute('on_key "a" [ forward 1 ]', doc);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(
    effectEvents(result).map((event) => event.payload),
    [{ name: "on_key" }],
  );
});
