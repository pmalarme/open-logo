// Unit tests for comprehension evaluation: map/filter/reduce (issue #105,
// spec/execution-model.md:380-479, worked examples :695-741). Conformance fixtures under
// tests/conformance/core-language/comprehensions/*.expected.json cover the primary
// event/diagnostic shapes end to end (the spec's own worked map/reduce traces, destructuring item
// binders, and the headline diagnostics). These unit tests fill in what a fixture cannot: every
// dynamically-reachable diagnostic path exercised directly (not via conformance-fixture
// subprocess spillover, per the #172/#173 lesson), both `ol-duplicate-binder` forms, both escape
// keywords (`return`/`stop`) in both leading and final body position, multi-statement bodies
// (leading `Assign`/expression-for-effect statements), a nested comprehension, a user-procedure
// call as the body's final expression (including `ol-no-output`), and the "unsupported body
// statement defers the whole comprehension" branch — mirroring `for-loop-binders.test.mjs`'s own
// pattern for the sibling `ForIn` binder machinery this issue's evaluation reuses.

import assert from "node:assert/strict";
import { test } from "node:test";
import { execute } from "@openlogo/runtime";

const doc = "acceptance.logo";

function printedValues(result) {
  return result.events
    .filter((event) => event.kind === "print")
    .map((event) => event.payload.values[0]);
}

test("map doubles every element, in order (spec's own worked example)", () => {
  const result = execute(
    ":nums = [1 2 3]\n:doubled = map n in :nums [ :n * 2 ]\nprint :doubled",
    doc,
  );
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(printedValues(result), [[2, 4, 6]]);
});

test("filter keeps elements whose body evaluates true, drops the rest", () => {
  const result = execute(
    ":nums = [1 2 3 4]\n:evens = filter n in :nums [ :n / 2 == :n / 2 ]\nprint :evens",
    doc,
  );
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(printedValues(result), [[1, 2, 3, 4]]);
});

test("filter drops elements whose body evaluates false", () => {
  const result = execute(
    ":nums = [1 2 3 4]\n:big = filter n in :nums [ :n > 2 ]\nprint :big",
    doc,
  );
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(printedValues(result), [[3, 4]]);
});

test("reduce folds an accumulator across every element, seeded by `from` (spec's own worked example)", () => {
  const result = execute(
    ":nums = [1 2 3]\n:total = reduce sum n in :nums from 0 [ :sum + :n ]\nprint :total",
    doc,
  );
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(printedValues(result), [6]);
});

test("reduce's accumulator name case-folds: declared `Sum`, read `:sum` (issue #512, spec/grammar.md:13)", () => {
  const result = execute(
    ":nums = [1 2 3]\n:total = reduce Sum n in :nums from 0 [ :sum + :n ]\nprint :total",
    doc,
  );
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(printedValues(result), [6]);
});

test("reduce over an empty list returns `from` unchanged (spec/execution-model.md:402)", () => {
  const result = execute(
    ":total = reduce sum n in [] from 42 [ :sum + :n ]\nprint :total",
    doc,
  );
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(printedValues(result), [42]);
});

test("map over an empty list produces an empty list, no diagnostic", () => {
  const result = execute(":out = map n in [] [ :n ]\nprint :out", doc);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(printedValues(result), [[]]);
});

test("a destructuring item binder destructures each element positionally (spec/execution-model.md:443)", () => {
  const result = execute(
    ":corners = [[1 2] [3 4]]\n:xs = map [:x :y] in :corners [ :x ]\nprint :xs",
    doc,
  );
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(printedValues(result), [[1, 3]]);
});

test("a destructuring item binder in `reduce` destructures each element, distinct from the accumulator", () => {
  const result = execute(
    ":pairs = [[1 2] [3 4]]\n:total = reduce sum [:x :y] in :pairs from 0 [ :sum + :x + :y ]\nprint :total",
    doc,
  );
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(printedValues(result), [10]);
});

test("map over a non-list source raises ol-type", () => {
  const result = execute(":out = map n in 5 [ :n ]\nprint :out", doc);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-type");
  assert.deepEqual(result.diagnostics[0].params, {
    expected: "list",
    actual: "number",
    value: 5,
    operation: "map",
  });
});

test("filter over a non-list source raises ol-type naming the filter operation", () => {
  const result = execute(':out = filter n in "x" [ true ]\nprint :out', doc);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-type");
  assert.equal(result.diagnostics[0].params.operation, "filter");
});

test("reduce over a non-list source raises ol-type naming the reduce operation", () => {
  const result = execute(
    ":out = reduce sum n in true from 0 [ :sum ]\nprint :out",
    doc,
  );
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-type");
  assert.equal(result.diagnostics[0].params.operation, "reduce");
});

test("a filter body evaluating to a non-boolean raises ol-not-boolean", () => {
  const result = execute(":out = filter n in [1 2] [ :n ]\nprint :out", doc);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-not-boolean");
  assert.deepEqual(result.diagnostics[0].params, {
    actual: "number",
    operation: "filter",
  });
});

test("map's destructuring length mismatch raises ol-range (reusing ForIn's own builder)", () => {
  const result = execute(":out = map [:x :y] in [[1]] [ :x ]\nprint :out", doc);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-range");
  assert.deepEqual(result.diagnostics[0].params, {
    operation: "destructuring",
    value: 1,
    length: 2,
  });
});

test("reduce's own destructuring length mismatch raises ol-range too (separate loop from map/filter)", () => {
  const result = execute(
    ":out = reduce sum [:x :y] in [[1]] from 0 [ :sum ]\nprint :out",
    doc,
  );
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-range");
});

test("a duplicate name within a destructuring item-binder pattern raises ol-duplicate-binder (form: destructuring)", () => {
  const result = execute(
    ":out = map [:x :x] in [[1 2]] [ :x ]\nprint :out",
    doc,
  );
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-duplicate-binder");
  assert.deepEqual(result.diagnostics[0].params, {
    name: "x",
    form: "destructuring",
  });
});

test("reduce whose accumulator name collides with its bare item binder raises ol-duplicate-binder (form: reduce, spec's own worked example)", () => {
  const result = execute(
    ":total = reduce sum sum in [1 2 3] from 0 [ :sum ]\nprint :total",
    doc,
  );
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-duplicate-binder");
  assert.deepEqual(result.diagnostics[0].params, {
    name: "sum",
    form: "reduce",
  });
});

test("a body with no value-producing final statement raises ol-no-value (spec's own worked example)", () => {
  const result = execute(":out = map n in [1] [ print :n ]\nprint :out", doc);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-no-value");
  assert.deepEqual(result.diagnostics[0].params, { form: "map" });
});

test("an empty comprehension body ([ ]) raises ol-no-value — an empty body is vacuously a supported shape", () => {
  const result = execute(":out = map n in [1] [ ]\nprint :out", doc);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-no-value");
  assert.deepEqual(result.diagnostics[0].params, { form: "map" });
});

test("a `stop` as a comprehension body's only statement raises ol-return-in-comprehension, not ol-stop-outside-proc", () => {
  const result = execute(":out = map n in [1] [ stop ]\nprint :out", doc);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-return-in-comprehension");
  assert.deepEqual(result.diagnostics[0].params, {
    keyword: "stop",
    form: "map",
  });
});

test("a `return` as a comprehension body's final statement raises ol-return-in-comprehension, not ol-return-outside-proc", () => {
  const result = execute(":out = map n in [1] [ return :n ]\nprint :out", doc);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-return-in-comprehension");
  assert.deepEqual(result.diagnostics[0].params, {
    keyword: "return",
    form: "map",
  });
});

test("a `return` as a LEADING (non-final) comprehension body statement still raises ol-return-in-comprehension immediately", () => {
  const result = execute(
    ":out = map n in [1] [\n  return :n\n  :n\n]\nprint :out",
    doc,
  );
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-return-in-comprehension");
  assert.deepEqual(result.diagnostics[0].params, {
    keyword: "return",
    form: "map",
  });
});

test("a `stop` as a LEADING (non-final) comprehension body statement still raises ol-return-in-comprehension immediately", () => {
  const result = execute(
    ":out = filter n in [1] [\n  stop\n  true\n]\nprint :out",
    doc,
  );
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-return-in-comprehension");
  assert.deepEqual(result.diagnostics[0].params, {
    keyword: "stop",
    form: "filter",
  });
});

test("a return/stop lexically inside a comprehension wins over ol-return-outside-proc, even at the top level", () => {
  // No enclosing procedure at all — still ol-return-in-comprehension, not ol-return-outside-proc.
  const result = execute(
    ":out = reduce sum n in [1] from 0 [\n  return 1\n]\nprint :out",
    doc,
  );
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-return-in-comprehension");
});

test("a leading Assign statement in a comprehension body runs for effect, then the final expression supplies the value", () => {
  const result = execute(
    ":out = map n in [1 2] [\n  :seen = :n\n  :seen + 1\n]\nprint :out",
    doc,
  );
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(printedValues(result), [[2, 3]]);
});

test("a leading value-producing expression statement in a comprehension body runs for effect and is discarded", () => {
  const result = execute(
    ":out = map n in [1 2] [\n  :n + 100\n  :n * 10\n]\nprint :out",
    doc,
  );
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(printedValues(result), [[10, 20]]);
});

test("a diagnostic raised evaluating a leading body statement halts the whole comprehension", () => {
  const result = execute(
    ":out = map n in [1 2] [\n  1 / 0\n  :n\n]\nprint :out",
    doc,
  );
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-div-zero");
});

test("a diagnostic raised evaluating a leading Assign statement halts the whole comprehension", () => {
  const result = execute(
    ":out = map n in [1 2] [\n  :bad = 1 / 0\n  :n\n]\nprint :out",
    doc,
  );
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-div-zero");
});

test("a diagnostic raised evaluating the final body statement halts the whole comprehension", () => {
  const result = execute(
    ":out = reduce sum n in [1 0] from 1 [ :sum / :n ]\nprint :out",
    doc,
  );
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-div-zero");
});

test("a diagnostic raised evaluating the iterable itself halts before any element is bound", () => {
  const result = execute(":out = map n in 1 / 0 [ :n ]\nprint :out", doc);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-div-zero");
});

test("a diagnostic raised evaluating reduce's `from` seed halts before any element is bound", () => {
  const result = execute(
    ":out = reduce sum n in [1] from 1 / 0 [ :sum ]\nprint :out",
    doc,
  );
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-div-zero");
});

test("a user-procedure call as a comprehension body's final expression reports its returned value", () => {
  const result = execute(
    "define doubled_of :n\n  return :n * 2\nend\n:out = map n in [1 2] [ doubled_of :n ]\nprint :out",
    doc,
  );
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(printedValues(result), [[2, 4]]);
});

test("a command user-procedure used as a comprehension body's final expression raises ol-no-output at the call site", () => {
  const result = execute(
    "define nothing :n\n  print :n\nend\n:out = map n in [1] [ nothing :n ]\nprint :out",
    doc,
  );
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-no-output");
  assert.deepEqual(result.diagnostics[0].params, { procedure: "nothing" });
});

test("a print call as a comprehension body's final statement is structurally supported but still not value-producing (ol-no-value, not deferred)", () => {
  const result = execute(
    ":out = filter n in [1] [ print :n ]\nprint :out",
    doc,
  );
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "ol-no-value");
  assert.deepEqual(result.diagnostics[0].params, { form: "filter" });
});

test("a comprehension whose body ends in an expression kind this evaluator does not implement is deferred entirely, no diagnostic", () => {
  // `(nonexistent_builtin 1)` is a call to a name this evaluator does not know: the whole
  // comprehension is left unevaluated (the assignment target is simply never set), matching
  // `print`/`ForIn`'s own "unsupported operand" convention, rather than misreporting
  // `ol-no-value` for a shape that is actually value-producing syntactically. (No trailing
  // `print` here — reading the never-set `:out` afterward would raise its own, unrelated
  // `ol-undefined-var`.) Only the top-level `Assign` statement's own `instruction` event fires —
  // nothing from inside the deferred body.
  const result = execute(
    ":out = map n in [1] [ (nonexistent_builtin 1) ]",
    doc,
  );
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(
    result.events.map((event) => event.kind),
    ["instruction"],
  );
});

test("a comprehension whose body has a leading statement kind this evaluator does not implement (If) is deferred entirely, no diagnostic", () => {
  const result = execute(
    ":out = map n in [1] [\n  if true [\n    print 1\n  ]\n  :n\n]",
    doc,
  );
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(
    result.events.map((event) => event.kind),
    ["instruction"],
  );
});

test("a comprehension whose iterable is an expression kind this evaluator does not implement is deferred entirely, no diagnostic", () => {
  const result = execute(":out = map n in (nonexistent_builtin 1) [ :n ]", doc);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(
    result.events.map((event) => event.kind),
    ["instruction"],
  );
});

test("a reduce whose `from` seed is an expression kind this evaluator does not implement is deferred entirely, no diagnostic", () => {
  const result = execute(
    ":out = reduce sum n in [1] from (nonexistent_builtin 1) [ :sum ]",
    doc,
  );
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(
    result.events.map((event) => event.kind),
    ["instruction"],
  );
});

test("a comprehension nested as another comprehension's final body expression evaluates correctly", () => {
  const result = execute(
    ":grid = [[1 2] [3 4]]\n:out = map row in :grid [ map n in :row [ :n * 10 ] ]\nprint :out",
    doc,
  );
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(printedValues(result), [
    [
      [10, 20],
      [30, 40],
    ],
  ]);
});

test("comprehension binders shadow an outer variable of the same name only for the body", () => {
  const result = execute(
    ":n = 100\n:out = map n in [1 2] [ :n ]\nprint :n\nprint :out",
    doc,
  );
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(printedValues(result), [100, [1, 2]]);
});
