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
