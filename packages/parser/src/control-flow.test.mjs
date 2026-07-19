import assert from "node:assert/strict";
import { test } from "node:test";
import * as OL from "@openlogo/parser";

/**
 * Unit tests for issue #114 — control-flow statics (`ol-return-outside-proc`,
 * `ol-stop-outside-proc`, `ol-return-in-comprehension`, `ol-no-value`, `ol-duplicate-binder`).
 * Behavior is verified through the public `@openlogo/parser` surface (`parse` + `check`), matching
 * the package's black-box test convention. Assertions check diagnostic identity — code, params,
 * stage, severity, and span — never the (non-normative) English message text.
 */

const CONTROL_FLOW_CODES = new Set([
  "ol-return-outside-proc",
  "ol-stop-outside-proc",
  "ol-return-in-comprehension",
  "ol-no-value",
  "ol-duplicate-binder",
]);

function controlFlowFindings(source, profiles = ["core-language"]) {
  const { ast, diagnostics: parseDiagnostics } = OL.parse(source, "unit.logo");
  assert.deepEqual(
    parseDiagnostics,
    [],
    `expected clean parse for ${JSON.stringify(source)}`,
  );
  return OL.check(ast, { profiles }).diagnostics.filter((d) =>
    CONTROL_FLOW_CODES.has(d.code),
  );
}

// --- ol-return-outside-proc -------------------------------------------------

test("flags `return` used at top level, outside any procedure", () => {
  const diagnostics = controlFlowFindings("return 5");
  assert.equal(diagnostics.length, 1);
  const [finding] = diagnostics;
  assert.equal(finding.code, "ol-return-outside-proc");
  assert.equal(finding.stage, "semantic");
  assert.equal(finding.severity, "error");
  assert.deepEqual(finding.params, { keyword: "return" });
  // Span points at just the `return` control word, not `return 5`.
  assert.deepEqual(finding.source_span, {
    document: "unit.logo",
    start: [1, 1],
    end: [1, 7],
  });
});

test("its message uses the warm lowercase Logo voice", () => {
  const { ast } = OL.parse("return 5", "unit.logo");
  const [finding] = OL.check(ast, { profiles: ["core-language"] }).diagnostics;
  assert.match(finding.message, /^return only reports a value/);
});

test("accepts `return` inside a `define … end` procedure body", () => {
  const diagnostics = controlFlowFindings("define f\n  return 5\nend");
  assert.deepEqual(diagnostics, []);
});

// --- ol-stop-outside-proc ---------------------------------------------------

test("flags a bare `stop` at top level, outside any procedure", () => {
  const diagnostics = controlFlowFindings("stop");
  assert.equal(diagnostics.length, 1);
  const [finding] = diagnostics;
  assert.equal(finding.code, "ol-stop-outside-proc");
  assert.equal(finding.stage, "semantic");
  assert.equal(finding.severity, "error");
  assert.deepEqual(finding.params, {});
  assert.deepEqual(finding.source_span, {
    document: "unit.logo",
    start: [1, 1],
    end: [1, 5],
  });
});

test("accepts `stop` inside a `define … end` procedure body", () => {
  const diagnostics = controlFlowFindings("define halt\n  stop\nend");
  assert.deepEqual(diagnostics, []);
});

// --- ol-return-in-comprehension ---------------------------------------------

test("flags `return` inside a comprehension body with its form", () => {
  const diagnostics = controlFlowFindings("print map n in :nums [ return :n ]");
  assert.equal(diagnostics.length, 1);
  const [finding] = diagnostics;
  assert.equal(finding.code, "ol-return-in-comprehension");
  assert.equal(finding.stage, "semantic");
  assert.equal(finding.severity, "error");
  assert.deepEqual(finding.params, { keyword: "return", form: "map" });
  assert.deepEqual(finding.source_span, {
    document: "unit.logo",
    start: [1, 24],
    end: [1, 30],
  });
});

test("routes `stop` inside a comprehension body to the comprehension code", () => {
  const diagnostics = controlFlowFindings("print map n in :nums [ stop ]");
  assert.equal(diagnostics.length, 1);
  const [finding] = diagnostics;
  assert.equal(finding.code, "ol-return-in-comprehension");
  assert.deepEqual(finding.params, { keyword: "stop", form: "map" });
  assert.deepEqual(finding.source_span, {
    document: "unit.logo",
    start: [1, 24],
    end: [1, 28],
  });
});

test("prefers the comprehension code over outside-proc when nested in a procedure", () => {
  const diagnostics = controlFlowFindings(
    "define f\n  print map n in :nums [ return :n ]\nend",
  );
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].code, "ol-return-in-comprehension");
  assert.deepEqual(diagnostics[0].params, { keyword: "return", form: "map" });
});

test("reports the form of the nearest enclosing comprehension (filter, reduce)", () => {
  const filter = controlFlowFindings("print filter n in :nums [ stop ]");
  assert.deepEqual(filter[0].params, { keyword: "stop", form: "filter" });
  const reduce = controlFlowFindings(
    "print reduce acc n in :nums from 0 [ return :acc ]",
  );
  assert.deepEqual(reduce[0].params, { keyword: "return", form: "reduce" });
});

// --- ol-no-value ------------------------------------------------------------

test("reproduces the spec worked example: `map … [ print :num ]` has no value", () => {
  const diagnostics = controlFlowFindings(
    ":nums = [1 2 3]\n:doubled = map num in :nums [\n  print :num\n]",
  );
  assert.equal(diagnostics.length, 1);
  const [finding] = diagnostics;
  assert.equal(finding.code, "ol-no-value");
  assert.equal(finding.stage, "semantic");
  assert.equal(finding.severity, "error");
  assert.deepEqual(finding.params, { form: "map" });
  assert.deepEqual(finding.source_span, {
    document: "unit.logo",
    start: [2, 12],
    end: [4, 2],
  });
});

test("flags an empty comprehension body as no-value", () => {
  const diagnostics = controlFlowFindings("print map n in :nums []");
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].code, "ol-no-value");
  assert.deepEqual(diagnostics[0].params, { form: "map" });
});

test("flags a comprehension body ending in a non-value statement (if) as no-value", () => {
  const diagnostics = controlFlowFindings(
    "print map n in :nums [ if :n [ print :n ] ]",
  );
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].code, "ol-no-value");
});

test("flags a comprehension body ending in a parenthesized Core command as no-value", () => {
  const diagnostics = controlFlowFindings(
    "print map n in :nums [ (print :n) ]",
  );
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].code, "ol-no-value");
  assert.deepEqual(diagnostics[0].params, { form: "map" });
});

test("does not double-report no-value when the last statement is an escape", () => {
  const diagnostics = controlFlowFindings("print map n in :nums [ return :n ]");
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].code, "ol-return-in-comprehension");
});

test("accepts a comprehension body ending in a value-producing expression", () => {
  const varRef = controlFlowFindings("print map n in :nums [ :n ]");
  assert.deepEqual(varRef, []);
  const infix = controlFlowFindings("print map n in :nums [ :n * 2 ]");
  assert.deepEqual(infix, []);
});

test("treats a call to an unknown (non-Core-command) callee as value-producing", () => {
  const diagnostics = controlFlowFindings(
    "print map n in :nums [ neighbors :n ]",
  );
  assert.deepEqual(diagnostics, []);
});

test("treats a Core command as value-producing when core-language is not active", () => {
  const diagnostics = controlFlowFindings(
    "print map n in :nums [ print :n ]",
    [],
  );
  assert.deepEqual(diagnostics, []);
});

// --- ol-duplicate-binder ----------------------------------------------------

test("flags a `reduce` whose accumulator and item binder share a name", () => {
  const diagnostics = controlFlowFindings(
    "print reduce sum sum in :nums from 0 [ :sum ]",
  );
  assert.equal(diagnostics.length, 1);
  const [finding] = diagnostics;
  assert.equal(finding.code, "ol-duplicate-binder");
  assert.equal(finding.stage, "semantic");
  assert.equal(finding.severity, "error");
  assert.deepEqual(finding.params, { name: "sum", form: "reduce" });
  // Span points at the second (item) binder occurrence.
  assert.deepEqual(finding.source_span, {
    document: "unit.logo",
    start: [1, 18],
    end: [1, 21],
  });
});

test("accepts a `reduce` whose accumulator and item binder differ", () => {
  const diagnostics = controlFlowFindings(
    "print reduce acc n in :nums from 0 [ :acc ]",
  );
  assert.deepEqual(diagnostics, []);
});

test("flags a repeated name inside a `for … in` destructuring pattern", () => {
  const diagnostics = controlFlowFindings("for [:x :x] in :pairs [ print :x ]");
  assert.equal(diagnostics.length, 1);
  const [finding] = diagnostics;
  assert.equal(finding.code, "ol-duplicate-binder");
  assert.deepEqual(finding.params, { name: "x", form: "destructuring" });
  assert.deepEqual(finding.source_span, {
    document: "unit.logo",
    start: [1, 9],
    end: [1, 11],
  });
});

test("accepts a `for … in` destructuring pattern whose names are distinct", () => {
  const diagnostics = controlFlowFindings("for [:x :y] in :pairs [ print :x ]");
  assert.deepEqual(diagnostics, []);
});

test("accepts a plain (non-destructuring) `for … in` binder", () => {
  const diagnostics = controlFlowFindings("for n in :nums [ print :n ]");
  assert.deepEqual(diagnostics, []);
});

// --- traversal: context threads through nested constructs -------------------

test("descends into a procedure body to flag a nested comprehension's no-value", () => {
  const diagnostics = controlFlowFindings(
    "define f\n  :x = map n in :nums [ print :n ]\nend",
  );
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].code, "ol-no-value");
});

test("descends into a `return` value expression to reach a nested comprehension", () => {
  const diagnostics = controlFlowFindings(
    "define f\n  return map n in :nums [ print :n ]\nend",
  );
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].code, "ol-no-value");
});

test("judges an escape inside a `for … in` loop body by the surrounding context", () => {
  const outside = controlFlowFindings("for n in :nums [ return 1 ]");
  assert.equal(outside.length, 1);
  assert.equal(outside[0].code, "ol-return-outside-proc");
  const inside = controlFlowFindings(
    "define f\n  for n in :nums [ return 1 ]\nend",
  );
  assert.deepEqual(inside, []);
});
