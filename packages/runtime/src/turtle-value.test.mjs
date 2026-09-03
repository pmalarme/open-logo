// Unit tests for the Sprites-profile `turtle` value type in the runtime's value machinery
// (issue #665, `spec/turtles-and-sprites.md:13`, `spec/execution-model.md:25,540`): identity
// equality, a stable/deterministic printed form, and snapshot leaf-handling that preserves turtle
// identity inside containers. `new_turtle` (SP1, #673) does not exist yet, so a turtle value cannot
// be produced through `.logo` source; these tests drive the exported value helpers (`valuesEqual`,
// `printedForm`, `snapshotValue`) directly against constructed `OLTurtle`s, exactly as the
// comparison/snapshot suites exercise cyclic lists and constructed dicts before their source
// surface exists. The `is_a? … "turtle"` recognition is proven end to end in
// `is-predicate-eval.test.mjs`.

import assert from "node:assert/strict";
import { test } from "node:test";
import { OLDict, OLTurtle } from "@openlogo/core";
import { printedForm, snapshotValue, valuesEqual } from "@openlogo/runtime";

// --- identity equality (spec/execution-model.md:675 — turtle row is "Same turtle identity") ----

test("a turtle equals itself under `==`", () => {
  const a = new OLTurtle(0);
  assert.equal(valuesEqual(a, a), true);
});

test("two turtle values denote the same turtle iff they share an id (identity is the id, not the instance)", () => {
  const a = new OLTurtle(0);
  const b = new OLTurtle(1);
  // Distinct turtles (distinct ids) are never ==.
  assert.equal(valuesEqual(a, b), false);
  // Two DIFFERENT instances with the SAME id are the same turtle — this is the interning-invariant
  // guarantee (issue #665): a later slice's `who`/`turtles`/`ask` route may hand back a freshly
  // built wrapper for a live turtle, and `who == :friend` must still be true. Keying `==` on the id
  // makes that hold by construction, so SP1+ cannot regress it by re-wrapping.
  const sameTurtle = new OLTurtle(0);
  assert.equal(valuesEqual(a, sameTurtle), true);
});

test("turtle identity survives a snapshot round-trip: a snapshotted turtle is == the original", () => {
  // `snapshotValue` is the one route available today (pre-`new_turtle`) that can produce a second
  // handle to a turtle; the snapshot must still compare equal to the original turtle.
  const turtle = new OLTurtle(5);
  assert.equal(valuesEqual(snapshotValue(turtle), turtle), true);
  const list = [turtle];
  const snapshot = snapshotValue(list);
  assert.equal(valuesEqual(snapshot[0], turtle), true);
});

test("a turtle never equals a non-turtle value of any type", () => {
  const turtle = new OLTurtle(0);
  assert.equal(valuesEqual(turtle, 0), false);
  assert.equal(valuesEqual(turtle, "turtle #0"), false);
  assert.equal(valuesEqual(turtle, true), false);
  assert.equal(valuesEqual(turtle, []), false);
  assert.equal(valuesEqual(turtle, new OLDict()), false);
  // ...and from the other side, a non-turtle never equals a turtle.
  assert.equal(valuesEqual(0, turtle), false);
  // A turtle also never equals a record/word/number even when nested, but two turtles of the same
  // id inside lists DO match (covered below) — so here compare against a genuinely different type.
  assert.equal(valuesEqual([turtle], ["turtle #0"]), false);
});

test("two lists of turtles compare structurally by turtle identity", () => {
  const a = new OLTurtle(0);
  const b = new OLTurtle(1);
  assert.equal(valuesEqual([a, b], [a, b]), true);
  assert.equal(valuesEqual([a, b], [b, a]), false);
  // Same-id turtles are the same turtle, so lists holding same-id turtles are structurally equal
  // even though the instances differ — the interning invariant flowing through list equality.
  assert.equal(valuesEqual([a], [new OLTurtle(0)]), true);
  // Distinct ids → distinct turtles → unequal lists.
  assert.equal(valuesEqual([a], [b]), false);
});

// --- printed form (stable & deterministic, spec/turtles-and-sprites.md:13) ---------------------

test("a turtle's printed form is the stable `turtle #<id>` tag", () => {
  assert.equal(printedForm(new OLTurtle(0)), "turtle #0");
  assert.equal(printedForm(new OLTurtle(42)), "turtle #42");
});

test("a turtle's printed form is deterministic and depends only on its id, not on state", () => {
  const turtle = new OLTurtle(7);
  // Rendering the same turtle twice yields the identical string — no per-render or state variance.
  assert.equal(printedForm(turtle), printedForm(turtle));
  assert.equal(printedForm(turtle), "turtle #7");
});

test("a turtle nested in a list/dict renders as its leaf tag, not as a container", () => {
  const turtle = new OLTurtle(3);
  assert.equal(printedForm([turtle, [turtle]]), "[turtle #3 [turtle #3]]");
  const dict = new OLDict();
  dict.set("bee", turtle);
  assert.equal(printedForm(dict), "{bee: turtle #3}");
});

// --- snapshot leaf handling (spec/execution-model.md point-in-time-snapshot rule) --------------

test("snapshotValue returns a turtle unchanged, preserving its identity", () => {
  const turtle = new OLTurtle(0);
  const snapshot = snapshotValue(turtle);
  assert.equal(snapshot, turtle);
  // A snapshotted turtle still `==` the original (identity survives the snapshot).
  assert.equal(valuesEqual(snapshot, turtle), true);
});

test("snapshotValue preserves turtle identity for turtles nested in a cloned list", () => {
  const turtle = new OLTurtle(1);
  const original = [turtle, [turtle]];
  const snapshot = snapshotValue(original);
  // The list structure is cloned...
  assert.notEqual(snapshot, original);
  assert.notEqual(snapshot[1], original[1]);
  // ...but the turtle leaves are the very same references (identity, not a copy).
  assert.equal(snapshot[0], turtle);
  assert.equal(snapshot[1][0], turtle);
  assert.equal(valuesEqual(snapshot[0], turtle), true);
});

test("snapshotValue preserves turtle identity for a turtle stored in a cloned dict", () => {
  const turtle = new OLTurtle(2);
  const original = new OLDict();
  original.set("leader", turtle);
  const snapshot = snapshotValue(original);
  assert.notEqual(snapshot, original);
  assert.equal(snapshot.get("leader"), turtle);
});
