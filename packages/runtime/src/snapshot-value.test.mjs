// Unit tests for `snapshotValue` (issue #495, `spec/execution-model.md`'s point-in-time-snapshot
// rule): an effect-event payload (here, `print`/`show`'s) must capture a transitive, immutable
// copy of a mutable value's reachable graph as of emission time — not a live reference — while
// preserving alias/cycle structure via snapshot-local reference identity. These tests drive the
// array/dict/record clone branches and the alias/cycle-preservation memo directly against
// constructed `OLValue`s, complementing the end-to-end `tests/conformance/data/snapshot-identity/`
// fixtures (which prove the same rule through `execute()`'s real event stream).

import assert from "node:assert/strict";
import { test } from "node:test";
import { execute, snapshotValue } from "@openlogo/runtime";
import { OLDict } from "@openlogo/core";

test("snapshotValue returns a primitive unchanged (number, word, boolean)", () => {
  assert.equal(snapshotValue(5), 5);
  assert.equal(snapshotValue("hello"), "hello");
  assert.equal(snapshotValue(true), true);
});

test("snapshotValue clones a list, so a later mutation of the original does not affect the snapshot", () => {
  const original = [1, 2, 3];
  const snapshot = snapshotValue(original);
  assert.deepEqual(snapshot, [1, 2, 3]);
  assert.notEqual(snapshot, original);
  original.push(4);
  assert.deepEqual(snapshot, [1, 2, 3]);
});

test("snapshotValue clones a dict, so a later mutation of the original does not affect the snapshot", () => {
  const original = new OLDict();
  original.set("a", 1);
  const snapshot = snapshotValue(original);
  assert.notEqual(snapshot, original);
  assert.deepEqual(snapshot.keys(), ["a"]);
  original.set("b", 2);
  assert.deepEqual(snapshot.keys(), ["a"]);
});

test("snapshotValue preserves alias identity: two positions sharing one live reference share one snapshot reference", () => {
  const shared = [1, 2];
  const memo = new Map();
  const a = snapshotValue(shared, memo);
  const b = snapshotValue(shared, memo);
  assert.equal(a, b);
  assert.deepEqual(a, [1, 2]);
});

test("snapshotValue terminates on a self-referential list, preserving the cycle rather than recursing forever", () => {
  const list = [1, 2];
  list.push(list);
  const snapshot = snapshotValue(list);
  assert.equal(snapshot[2], snapshot);
  assert.equal(snapshot.length, 3);
  assert.equal(snapshot[0], 1);
  assert.equal(snapshot[1], 2);
});

// A value can be perfectly acyclic yet nested far deeper than any host call stack can recurse
// into natively (issue #495 fixup): an effect-event payload snapshot must not itself throw a host
// `RangeError: Maximum call stack size exceeded` while capturing such a value — exactly the
// uncontrolled failure `spec/error-model.md`'s `ol-limit` guardrail exists to avoid.
test("snapshotValue clones a very deeply nested (but acyclic) list without a host stack overflow", () => {
  let list = [0];
  for (let i = 0; i < 20000; i += 1) {
    list = [list];
  }
  const snapshot = snapshotValue(list);
  assert.notEqual(snapshot, list);
  let cursor = snapshot;
  for (let i = 0; i < 20001; i += 1) {
    // the initial `[0]` plus 20000 further wraps
    assert.equal(cursor.length, 1);
    cursor = cursor[0];
  }
  assert.equal(cursor, 0);
});

// End-to-end repro of the exact regression this fixup addresses: `print`'s payload construction
// snapshots its argument via `snapshotValue` before `printedForm` ever renders it, so a program
// building a very deep (acyclic) structure and printing it must run to completion with no
// diagnostics and no thrown RangeError.
test("execute() runs a program that prints a 20,000-deep acyclic list without a host stack overflow", () => {
  const result = execute(
    ":l = [0]\nrepeat 20000 [ :l = (list :l) ]\nprint :l",
    "acceptance.logo",
  );
  assert.deepEqual(result.diagnostics, []);
  const printed = result.events.find((event) => event.kind === "print");
  assert.ok(printed, "expected a print event");
  let cursor = printed.payload.values[0];
  for (let i = 0; i < 20001; i += 1) {
    // the initial `:l = [0]` plus 20000 further `(list :l)` wraps
    assert.equal(cursor.length, 1);
    cursor = cursor[0];
  }
  assert.equal(cursor, 0);
});

test("snapshotValue clones a record (struct instance), field by field", () => {
  const result = execute(
    "struct point [ x y ]\n:p = point 3 4\nprint :p",
    "acceptance.logo",
  );
  assert.deepEqual(result.diagnostics, []);
  const printed = result.events.find((event) => event.kind === "print");
  const record = printed.payload.values[0];
  assert.equal(record.type, "point");
  assert.equal(record.get("x"), 3);
  assert.equal(record.get("y"), 4);
});

test("a record printed by an effect event is a snapshot, not a live reference to the mutable record", () => {
  const result = execute(
    "struct point [ x y ]\n:p = point 3 4\nprint :p\n:p.x = 99\nprint :p",
    "acceptance.logo",
  );
  assert.deepEqual(result.diagnostics, []);
  const [first, second] = result.events.filter(
    (event) => event.kind === "print",
  );
  assert.equal(first.payload.values[0].get("x"), 3);
  assert.equal(second.payload.values[0].get("x"), 99);
});

// --- issue #495 also applies to `return`/`procedure-enter`/`procedure-exit` payloads, not just
// `print`/`show` (a systematic pass over every `environment.events.push(...)` call site in
// `execute-internal.ts` found these three additional emission sites whose payload embeds a live
// `OLValue`) -----------------------------------------------------------------------------------

test("a procedure's `return` event is a point-in-time snapshot: mutating the returned list afterward does not change the earlier trace event", () => {
  const result = execute(
    "define makeList\n  return [1 2 3]\nend\n:r = makeList\nadd 4 to :r",
    "acceptance.logo",
  );
  assert.deepEqual(result.diagnostics, []);
  const returned = result.events.find((event) => event.kind === "return");
  assert.ok(returned, "expected a return event");
  assert.deepEqual(returned.payload.value, [1, 2, 3]);
});

test("a procedure's `procedure-exit` event is a point-in-time snapshot: mutating the returned list afterward does not change the earlier trace event", () => {
  const result = execute(
    "define makeList\n  return [1 2 3]\nend\n:r = makeList\nadd 4 to :r",
    "acceptance.logo",
  );
  assert.deepEqual(result.diagnostics, []);
  const exited = result.events.find((event) => event.kind === "procedure-exit");
  assert.ok(exited, "expected a procedure-exit event");
  assert.deepEqual(exited.payload.result, [1, 2, 3]);
});

test("a procedure's `procedure-enter` args are point-in-time snapshots that preserve alias identity: passing the same live list to two parameters keeps them aliased in the snapshot, decoupled from later mutation", () => {
  const result = execute(
    "define both :a :b\nend\n:l = [1 2 3]\n(both :l :l)\nadd 4 to :l",
    "acceptance.logo",
  );
  assert.deepEqual(result.diagnostics, []);
  const entered = result.events.find(
    (event) => event.kind === "procedure-enter",
  );
  assert.ok(entered, "expected a procedure-enter event");
  const [a, b] = entered.payload.args;
  assert.deepEqual(a, [1, 2, 3]);
  assert.strictEqual(
    a,
    b,
    "both parameters aliased the same live list, so their snapshots must alias each other too",
  );
});
