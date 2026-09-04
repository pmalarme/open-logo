// Runtime equivalence tests for the Heritage assignment/procedure/return spellings — `make`,
// `to … end`, `output`/`op` — slice H2 (issue #667). The Heritage profile is "alternate spellings
// only, no new semantics" (spec/conformance.md#heritage): each form MUST evaluate through the exact
// same code path as its Core equivalent, so the runtime is spelling-blind — it acts on
// `Assign`/`ProcedureDef`/`Return` nodes regardless of the surface `form`/`keyword` tag the reader
// recorded. These tests PROVE that identical-behavior contract by running each Heritage form and its
// Core twin through the public `execute()` entry point and asserting the observable output matches.
//
// (The Heritage form-head PROFILE GATE — rejecting these spellings in Core — is a parser/checker
// concern, covered by packages/parser/src/heritage-spellings.test.mjs. The runtime never gates on
// profiles, so these programs are executed directly here.)

import assert from "node:assert/strict";
import { test } from "node:test";
import { execute } from "@openlogo/runtime";

const doc = "acceptance.logo";

/** The ordered list of printed values from running `source`, asserting a clean run. */
function printsOf(source) {
  const result = execute(source, doc);
  assert.deepEqual(
    result.diagnostics,
    [],
    `expected a clean run for ${JSON.stringify(source)}`,
  );
  return result.events
    .filter((event) => event.kind === "print")
    .map((event) => event.payload.values[0]);
}

test('`make "name" value` assigns identically to `set name to value`', () => {
  const heritage = printsOf('make "size" 120\nprint :size\n');
  const core = printsOf("set size to 120\nprint :size\n");
  assert.deepEqual(heritage, [120]);
  assert.deepEqual(heritage, core);
});

test("`make` mutates a nearest existing binding, exactly as `set`/`=` do (spec/execution-model.md)", () => {
  const heritage = printsOf(
    'set size to 1\ndefine bump\n  make "size" 2\nend\nbump\nprint :size\n',
  );
  const core = printsOf(
    "set size to 1\ndefine bump\n  set size to 2\nend\nbump\nprint :size\n",
  );
  assert.deepEqual(heritage, [2]);
  assert.deepEqual(heritage, core);
});

test("`to name … end` defines and calls identically to `define name … end`", () => {
  const heritage = printsOf(
    "to square :n\n  return :n * :n\nend\nprint square 5\n",
  );
  const core = printsOf(
    "define square :n\n  return :n * :n\nend\nprint square 5\n",
  );
  assert.deepEqual(heritage, [25]);
  assert.deepEqual(heritage, core);
});

test("`output value` returns identically to `return value`", () => {
  const heritage = printsOf(
    "to twice :n\n  output :n * 2\nend\nprint twice 7\n",
  );
  const core = printsOf(
    "define twice :n\n  return :n * 2\nend\nprint twice 7\n",
  );
  assert.deepEqual(heritage, [14]);
  assert.deepEqual(heritage, core);
});

test("`op value` returns identically to `return value`", () => {
  const heritage = printsOf("to twice :n\n  op :n * 2\nend\nprint twice 7\n");
  const core = printsOf(
    "define twice :n\n  return :n * 2\nend\nprint twice 7\n",
  );
  assert.deepEqual(heritage, [14]);
  assert.deepEqual(heritage, core);
});

test("all three Heritage forms compose in one program with identical semantics to their Core twin", () => {
  const heritage = printsOf(
    'to grow :by\n  make "size" :size + :by\n  op :size\nend\nset size to 10\nprint grow 5\n',
  );
  const core = printsOf(
    "define grow :by\n  set size to :size + :by\n  return :size\nend\nset size to 10\nprint grow 5\n",
  );
  assert.deepEqual(heritage, [15]);
  assert.deepEqual(heritage, core);
});

test("an `output`/`op` outside any procedure raises the same diagnostic IDENTITY as `return` — canonical params, learner's prose", () => {
  // "No new semantics" covers diagnostics too: identity is `code` plus structured `params`, and the
  // same condition MUST keep the same params (`spec/error-model.md:254-259`). The three spellings
  // are one condition, so `params.keyword` is the canonical `"return"` for all three (issue #741).
  // Identity, not the whole diagnostic: the `message` still echoes the word the learner typed and
  // the span still covers what they wrote — both presentation, and both deliberately different.
  const core = execute("return 5", doc).diagnostics;
  assert.equal(core.length, 1);
  assert.equal(core[0].code, "ol-return-outside-proc");
  assert.deepEqual(core[0].params, { keyword: "return" });

  for (const spelling of ["output", "op"]) {
    const heritage = execute(`${spelling} 5`, doc).diagnostics;
    assert.equal(heritage.length, 1);
    assert.equal(heritage[0].code, core[0].code);
    assert.equal(heritage[0].stage, core[0].stage);
    assert.equal(heritage[0].severity, core[0].severity);
    assert.deepEqual(heritage[0].params, core[0].params);
    assert.match(heritage[0].message, new RegExp(`^${spelling} `));
  }
});
