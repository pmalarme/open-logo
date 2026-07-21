// Unit tests for issue #188: runtime evaluation of the four Data-profile list-mutator statements
// `add … to`, `remove … from`, `insert … in … at`, and `clear` (spec/data-structures.md:73-93,
// spec/execution-model.md:447-482). Each mutates a shared list reference in place, emits no
// dedicated effect event (only the generic per-statement `instruction` event, like assignment),
// and raises `ol-type`/`ol-range` on a bad target/position. The dict-only `remove key … from`
// form stays a deferred no-op (dicts have no runtime representation yet — issue #322). Every case
// drives the public `execute()` entry point through real parsed source, exactly as a learner
// program would, so the parser dispatch AND the runtime dispatch are both exercised end to end.

import assert from "node:assert/strict";
import { test } from "node:test";
import { execute } from "@openlogo/runtime";

const doc = "list-mutators.logo";

/** Run `source`, asserting it produced no diagnostic, and return the whole event stream. */
function run(source) {
  const { events, diagnostics } = execute(source, doc);
  assert.deepEqual(
    diagnostics,
    [],
    `unexpected diagnostics: ${JSON.stringify(diagnostics)}`,
  );
  return events;
}

/** Run `source` and return the values carried by its last `print` event. */
function lastPrint(source) {
  const prints = run(source).filter((event) => event.kind === "print");
  assert.ok(prints.length > 0, "expected at least one print event");
  return prints[prints.length - 1].payload.values;
}

/** Run `source` expecting exactly one runtime diagnostic, and return it. */
function runError(source) {
  const { diagnostics } = execute(source, doc);
  assert.equal(diagnostics.length, 1, `expected one diagnostic in ${source}`);
  return diagnostics[0];
}

// --- `add … to` -----------------------------------------------------------------------------

test("`add` appends a value to the end of a list", () => {
  assert.deepEqual(lastPrint(":nums = [1 2 3]\nadd 4 to :nums\nprint :nums"), [
    [1, 2, 3, 4],
  ]);
});

test("`add` appends to an empty list", () => {
  assert.deepEqual(lastPrint(":nums = []\nadd 1 to :nums\nprint :nums"), [[1]]);
});

test("`add` evaluates its value operand before appending", () => {
  assert.deepEqual(
    lastPrint(":nums = [1]\nadd (2 + 3) to :nums\nprint :nums"),
    [[1, 5]],
  );
});

test("`add` mutates a shared list reference (visible through an alias)", () => {
  assert.deepEqual(lastPrint(":a = [1 2]\n:b = :a\nadd 3 to :a\nprint :b"), [
    [1, 2, 3],
  ]);
});

test("`add` mutates a nested list reached through a postfix place", () => {
  assert.deepEqual(lastPrint(":m = [[1] [2]]\nadd 9 to :m[1]\nprint :m"), [
    [[1, 9], [2]],
  ]);
});

test("`add` to a non-list target raises ol-type", () => {
  const diagnostic = runError("add 5 to 3");
  assert.equal(diagnostic.code, "ol-type");
  assert.equal(diagnostic.stage, "runtime");
  assert.equal(diagnostic.severity, "error");
  assert.deepEqual(diagnostic.params, {
    expected: "list",
    actual: "number",
    value: 3,
    operation: "add",
  });
});

test("`add` propagates an unbound target read as ol-undefined-var", () => {
  assert.equal(runError("add 5 to :missing").code, "ol-undefined-var");
});

test("`add` propagates a failing value expression", () => {
  assert.equal(runError(":l = [1]\nadd (1 / 0) to :l").code, "ol-div-zero");
});

test("`add` with an unsupported value expression is a deferred no-op", () => {
  assert.deepEqual(lastPrint(":l = [1]\nadd :d.field to :l\nprint :l"), [[1]]);
});

test("`add` with an unsupported target expression is a deferred no-op", () => {
  assert.deepEqual(lastPrint(":l = [1]\nadd 5 to :l.field\nprint :l"), [[1]]);
});

// --- `remove … from` ------------------------------------------------------------------------

test("`remove` deletes the first matching element only", () => {
  assert.deepEqual(
    lastPrint(":nums = [1 2 3 2]\nremove 2 from :nums\nprint :nums"),
    [[1, 3, 2]],
  );
});

test("`remove` of an absent value leaves the list unchanged", () => {
  assert.deepEqual(
    lastPrint(":nums = [1 2 3]\nremove 9 from :nums\nprint :nums"),
    [[1, 2, 3]],
  );
});

test("`remove` matches by structural (`==`) equality on list elements", () => {
  assert.deepEqual(
    lastPrint(":nums = [[1 2] [3 4]]\nremove [1 2] from :nums\nprint :nums"),
    [[[3, 4]]],
  );
});

test('`remove` uses number/word `==` equality (5 == "5")', () => {
  assert.deepEqual(lastPrint(':l = ["5" 6]\nremove 5 from :l\nprint :l'), [
    [6],
  ]);
});

test("`remove` from a non-list target raises ol-type", () => {
  const diagnostic = runError('remove 1 from "hi"');
  assert.equal(diagnostic.code, "ol-type");
  assert.deepEqual(diagnostic.params, {
    expected: "list",
    actual: "word",
    value: "hi",
    operation: "remove",
  });
});

test("`remove` propagates a failing value expression", () => {
  assert.equal(
    runError(":l = [1]\nremove (1 / 0) from :l").code,
    "ol-div-zero",
  );
});

test("`remove` with an unsupported operand is a deferred no-op", () => {
  assert.deepEqual(lastPrint(":l = [1 2]\nremove :d.field from :l\nprint :l"), [
    [1, 2],
  ]);
});

// --- `insert … in … at` ---------------------------------------------------------------------

test("`insert` places a value before the 1-based position", () => {
  assert.deepEqual(
    lastPrint(":nums = [1 2 3]\ninsert 9 in :nums at 2\nprint :nums"),
    [[1, 9, 2, 3]],
  );
});

test("`insert` at position 1 prepends", () => {
  assert.deepEqual(
    lastPrint(":nums = [1 2]\ninsert 0 in :nums at 1\nprint :nums"),
    [[0, 1, 2]],
  );
});

test("`insert` at position length + 1 appends", () => {
  assert.deepEqual(
    lastPrint(":nums = [1 2]\ninsert 3 in :nums at 3\nprint :nums"),
    [[1, 2, 3]],
  );
});

test("`insert` coerces a word-that-reads-as-a-number position", () => {
  assert.deepEqual(
    lastPrint(':nums = [1 2]\ninsert 9 in :nums at "2"\nprint :nums'),
    [[1, 9, 2]],
  );
});

test("`insert` into a non-list target raises ol-type", () => {
  const diagnostic = runError("insert 1 in 5 at 1");
  assert.equal(diagnostic.code, "ol-type");
  assert.deepEqual(diagnostic.params, {
    expected: "list",
    actual: "number",
    value: 5,
    operation: "insert",
  });
});

test("`insert` with a non-number position raises ol-type", () => {
  const diagnostic = runError(':l = [1]\ninsert 9 in :l at "x"');
  assert.equal(diagnostic.code, "ol-type");
  assert.deepEqual(diagnostic.params, {
    expected: "number",
    actual: "word",
    value: "x",
    operation: "insert",
  });
});

test("`insert` at a position past length + 1 raises ol-range", () => {
  const diagnostic = runError(":l = [1 2]\ninsert 9 in :l at 4");
  assert.equal(diagnostic.code, "ol-range");
  assert.deepEqual(diagnostic.params, {
    operation: "insert",
    index: 4,
    length: 2,
  });
});

test("`insert` at position 0 raises ol-range", () => {
  assert.equal(runError(":l = [1 2]\ninsert 9 in :l at 0").code, "ol-range");
});

test("`insert` at a non-whole-number position raises ol-range", () => {
  const diagnostic = runError(":l = [1 2]\ninsert 9 in :l at 2.5");
  assert.equal(diagnostic.code, "ol-range");
  assert.deepEqual(diagnostic.params, {
    operation: "insert",
    index: 2.5,
    length: 2,
  });
});

test("`insert` propagates a failing position expression", () => {
  assert.equal(
    runError(":l = [1]\ninsert 9 in :l at (1 / 0)").code,
    "ol-div-zero",
  );
});

test("`insert` propagates a failing value expression", () => {
  assert.equal(
    runError(":l = [1]\ninsert (1 / 0) in :l at 1").code,
    "ol-div-zero",
  );
});

test("`insert` checks the target type before evaluating the position, short-circuiting", () => {
  // `:count` is a number, and the position `(1 / 0)` would raise `ol-div-zero` if it were
  // evaluated. Because the non-list target is caught first (value → target → position order),
  // the learner sees the `ol-type` about their real mistake, not a division error from an
  // argument that never should have run.
  const diagnostic = runError(":count = 5\ninsert 9 in :count at (1 / 0)");
  assert.equal(diagnostic.code, "ol-type");
  assert.deepEqual(diagnostic.params, {
    expected: "list",
    actual: "number",
    value: 5,
    operation: "insert",
  });
});

test("`insert` with an unsupported value operand is a deferred no-op", () => {
  assert.deepEqual(
    lastPrint(":l = [1]\ninsert :d.field in :l at 1\nprint :l"),
    [[1]],
  );
});

test("`insert` with an unsupported target operand is a deferred no-op", () => {
  assert.deepEqual(lastPrint(":l = [1]\ninsert 5 in :l.field at 1\nprint :l"), [
    [1],
  ]);
});

test("`insert` with an unsupported position operand is a deferred no-op", () => {
  assert.deepEqual(
    lastPrint(":l = [1]\ninsert 5 in :l at :d.field\nprint :l"),
    [[1]],
  );
});

// --- `clear` --------------------------------------------------------------------------------

test("`clear` empties a list in place", () => {
  assert.deepEqual(lastPrint(":nums = [1 2 3]\nclear :nums\nprint :nums"), [
    [],
  ]);
});

test("`clear` on an already-empty list is a no-op", () => {
  assert.deepEqual(lastPrint(":nums = []\nclear :nums\nprint :nums"), [[]]);
});

test("`clear` empties a shared list reference (visible through an alias)", () => {
  assert.deepEqual(lastPrint(":a = [1 2]\n:b = :a\nclear :a\nprint :b"), [[]]);
});

test("`clear` of a non-list target raises ol-type", () => {
  const diagnostic = runError("clear 5");
  assert.equal(diagnostic.code, "ol-type");
  assert.deepEqual(diagnostic.params, {
    expected: "list",
    actual: "number",
    value: 5,
    operation: "clear",
  });
});

test("`clear` with an unsupported target expression is a deferred no-op", () => {
  assert.deepEqual(lastPrint(":l = [1]\nclear :l.field\nprint :l"), [[1]]);
});

// --- `remove key … from` (deferred) + wiring ------------------------------------------------

test("`remove key … from` is a deferred no-op (dict runtime is issue #322)", () => {
  const events = run(":x = [1 2]\nremove key foo from :x\nprint :x");
  // The list is untouched...
  const prints = events.filter((event) => event.kind === "print");
  assert.deepEqual(prints[prints.length - 1].payload.values, [[1, 2]]);
  // ...and it reached the runtime as a genuine RemoveKey statement (not misparsed as a plain
  // Remove that happened to no-op), so this really exercises the #322 deferral path.
  const removeKey = events.find(
    (event) =>
      event.kind === "instruction" &&
      event.payload.statement_kind === "RemoveKey",
  );
  assert.ok(removeKey, "expected a RemoveKey instruction event");
});

test("a mutator statement emits the generic `instruction` event", () => {
  const events = run(":l = [1]\nadd 2 to :l");
  const instructions = events.filter((event) => event.kind === "instruction");
  const addInstruction = instructions.find(
    (event) => event.payload.statement_kind === "Add",
  );
  assert.ok(
    addInstruction,
    "expected an instruction event for the Add statement",
  );
});
