// Unit tests for `on_click <block>` — pointer-handler registration (issue #685, slice I6 —
// `spec/interaction-events.md`'s `### on_click <block>`, "Time, ticks, and handlers", and "Trace
// stream integration"). `on_click` registers a handler and emits a `primitive` event AFTER
// registration; unlike its three siblings it takes NO argument (the spec lists its errors as none).
// A click is host input, so in a headless batch `execute()` run there is no pointer device and the
// handler is registered but never delivered — exactly like a `when "stop"` (I3) or an `on_key` (I5)
// handler. The stream stays deterministic and headless: no coordinate or timing leaks into any
// payload.
//
// Node-version trap (see the PR body): on Node 24+ `--experimental-test-coverage` silently excludes
// `*.test.mjs`, so a local coverage green can be a false positive CI (Node 22) then fails. These
// tests deliberately exercise every branch of the `on_click` registry (`interaction.ts`'s
// `registerOnClickHandler`/`emitOnClickPrimitive`) and dispatch (`isOnClickStatement`/
// `executeOnClickStatement`) so the Node-22 CI gate sees full coverage.

import assert from "node:assert/strict";
import { test } from "node:test";
import { execute } from "@openlogo/runtime";

const doc = "on-click.logo";

/** The non-`instruction` events a program emits, for concise effect-sequence assertions. */
function effectEvents(result) {
  return result.events.filter((event) => event.kind !== "instruction");
}

// --- Registration emits `primitive` AFTER the handler is registered, headless -----------------

test("on_click registration emits a primitive(on_click) event, headless (name only)", () => {
  const result = execute("on_click [ forward 20 ]", doc);
  assert.deepEqual(result.diagnostics, []);
  const primitives = result.events.filter(
    (event) => event.kind === "primitive",
  );
  assert.equal(primitives.length, 1);
  // Headless: the payload's only key is `name` — no coordinate or timing leaks in.
  assert.deepEqual(Object.keys(primitives[0].payload), ["name"]);
  assert.equal(primitives[0].payload.name, "on_click");
});

test("registration is NOT invocation: the handler block never runs in a headless batch run", () => {
  // No pointer device in a headless run, so `on_click` registers but is never delivered — only the
  // registration's instruction+primitive pair appears, never the body's `forward` move.
  const result = execute("on_click [ forward 20 ]", doc);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(
    effectEvents(result).map((event) => event.payload),
    [{ name: "on_click" }],
  );
});

test("registration is not delivered even when a wait pause advances the tick clock", () => {
  // A click is host input, not a timed event: unlike `every`, advancing the tick clock through a
  // `wait` must NOT fire an `on_click` handler. Only the registration primitive and the wait
  // primitive appear; the body never runs.
  const result = execute("on_click [ forward 20 ]\nwait 10", doc);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(
    effectEvents(result).map((event) => event.payload),
    [{ name: "on_click" }, { name: "wait" }],
  );
});

test("the registration instruction event carries the on_click block-head span", () => {
  const result = execute("on_click [ forward 20 ]", doc);
  const [instruction] = result.events;
  assert.equal(instruction.kind, "instruction");
  assert.equal(instruction.payload.statement_kind, "ProfileStatement");
  assert.deepEqual(instruction.source_span.start, [1, 1]);
});

// --- The long `... end on_click` form behaves identically to the inline `[ ... ]` form ---------

test("the multiline on_click ... end on_click form registers the same primitive", () => {
  const result = execute("on_click\n  forward 20\nend on_click", doc);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(
    effectEvents(result).map((event) => event.payload),
    [{ name: "on_click" }],
  );
});

test("the multiline on_click closed by a bare end registers the same primitive", () => {
  const result = execute("on_click\n  forward 20\nend", doc);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(
    effectEvents(result).map((event) => event.payload),
    [{ name: "on_click" }],
  );
});

test("a mismatched labeled end on an on_click block raises ol-mismatched-end at parse time", () => {
  const result = execute("on_click\n  forward 20\nend when", doc);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-mismatched-end");
});

// --- on_click takes no argument: a stray argument is a parse error, never a silent extra move ---

test("a stray argument before the block raises a parse ol-missing-end at the on_click head", () => {
  // `on_click` takes zero args (spec §Profile grammar), so after reading no args the reader expects
  // a block; a stray word where the block should be is not a block opener, so the block-tail parser
  // reports `ol-missing-end` pointed at the `on_click` head rather than silently accepting an arg.
  const result = execute('on_click "extra" [ forward 20 ]', doc);
  assert.ok(result.diagnostics.some((d) => d.code === "ol-missing-end"));
  // Nothing registered: the parse failed, so no events at all were emitted (hence no on_click
  // primitive either). Asserting the empty stream directly avoids a filter predicate that a
  // never-populated event list would leave uninvoked.
  assert.deepEqual(result.events, []);
});

// --- Awkward positions: nested, registered twice -----------------------------------------------

test("on_click registered inside a repeat body registers one handler per iteration", () => {
  const result = execute("repeat 3 [ on_click [ forward 1 ] ]", doc);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(
    effectEvents(result).map((event) => event.payload),
    [{ name: "on_click" }, { name: "on_click" }, { name: "on_click" }],
  );
});

test("on_click registered inside a procedure body captures its registration-time scope", () => {
  // The handler registers when the procedure runs; nothing fires it, so only the registration
  // primitive appears among the handler's own effects — proving registration happens inside the call
  // without error. (The surrounding `setup` call emits its own primitive envelope.)
  const result = execute(
    "define setup\n  on_click [ left 90 ]\nend\nsetup",
    doc,
  );
  assert.deepEqual(result.diagnostics, []);
  const onClickPrimitives = result.events.filter(
    (event) => event.kind === "primitive" && event.payload.name === "on_click",
  );
  assert.equal(onClickPrimitives.length, 1);
  // The handler body's `left 90` never runs (no click delivered), so no `move` effect appears.
  assert.equal(
    result.events.some((event) => event.kind === "move"),
    false,
  );
});

test("registering on_click twice registers both, in order, with no error", () => {
  const result = execute("on_click [ forward 1 ]\non_click [ forward 2 ]", doc);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(
    effectEvents(result).map((event) => event.payload),
    [{ name: "on_click" }, { name: "on_click" }],
  );
});

test("on_click registered nested inside an ask block registers without firing", () => {
  // `ask` scopes the addressed turtle set; `on_click` inside it still just registers headlessly.
  const result = execute(
    ":t = new_turtle\nask :t [ on_click [ forward 1 ] ]",
    doc,
  );
  assert.deepEqual(result.diagnostics, []);
  const onClickPrimitives = result.events.filter(
    (event) => event.kind === "primitive" && event.payload.name === "on_click",
  );
  assert.equal(onClickPrimitives.length, 1);
  assert.equal(
    result.events.some((event) => event.kind === "move"),
    false,
  );
});
