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
