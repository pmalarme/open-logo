// Black-box tests for the Layer-3 style-lint rules (issue #115 slice 1), exercising only the
// public `@openlogo/parser` surface: `parse()` + `check(ast, { style: true, ... })`. Every fixture
// here parses clean (no Layer-2 diagnostics) so the assertions isolate the style findings.

import assert from "node:assert/strict";
import { test } from "node:test";
import * as OL from "@openlogo/parser";

const doc = "style-lints.logo";

function checkStyle(source, profiles = ["core-language"]) {
  const { ast: program, diagnostics: parseDiagnostics } = OL.parse(source, doc);
  assert.deepEqual(parseDiagnostics, [], "expected the fixture to parse clean");
  return OL.check(program, { profiles, source, style: true }).diagnostics;
}

// --- ol-style-useless-value -------------------------------------------------------------------

test("ol-style-useless-value: reproduces the spec's worked example verbatim (repeat 4 [ :side * 2 ])", () => {
  const diagnostics = checkStyle(":side = 2\nrepeat 4 [ :side * 2 ]");
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].code, "ol-style-useless-value");
  assert.deepEqual(diagnostics[0].params, { form: "repeat" });
  assert.equal(diagnostics[0].severity, "warning");
  assert.equal(diagnostics[0].stage, "semantic");
});

test("ol-style-useless-value: a repeat body ending in a command is clean", () => {
  const diagnostics = checkStyle("repeat 4 [ print 1 ]");
  assert.deepEqual(diagnostics, []);
});

test("ol-style-useless-value: while/forever/for-in/for-range/if each report their own form", () => {
  const cases = [
    ["while :x == :x [ 1 ]", "while"],
    ["forever [ 1 ]", "forever"],
    ["for i in [1 2] [ :i ]", "for-in"],
    ["for i from 1 to 3 [ :i ]", "for-range"],
  ];
  for (const [source, form] of cases) {
    const diagnostics = checkStyle(source);
    const useless = diagnostics.filter(
      (d) => d.code === "ol-style-useless-value",
    );
    assert.equal(useless.length, 1, `expected one finding for: ${source}`);
    assert.deepEqual(useless[0].params, { form });
  }
});

test("ol-style-useless-value: if reports each discarding branch independently", () => {
  const diagnostics = checkStyle("if true [ 1 ] else [ 2 ]").filter(
    (d) => d.code === "ol-style-useless-value",
  );
  assert.equal(diagnostics.length, 2);
  assert.deepEqual(diagnostics[0].params, { form: "if" });
  assert.deepEqual(diagnostics[1].params, { form: "if" });
});

test("ol-style-useless-value: an if whose then-branch discards but whose else-branch acts reports once", () => {
  const diagnostics = checkStyle("if true [ 1 ] else [ print 2 ]").filter(
    (d) => d.code === "ol-style-useless-value",
  );
  assert.equal(diagnostics.length, 1);
});

test("ol-style-useless-value: an empty block body is clean (nothing to discard)", () => {
  const diagnostics = checkStyle("repeat 4 [ ]");
  assert.deepEqual(diagnostics, []);
});

test("ol-style-useless-value: a comprehension body is out of scope for this code (ol-no-value instead)", () => {
  const { ast: program, diagnostics: parseDiagnostics } = OL.parse(
    ":xs = [1 2 3]\n:ys = map n in :xs [ :n ]",
    doc,
  );
  assert.deepEqual(parseDiagnostics, []);
  const diagnostics = OL.check(program, {
    profiles: ["core-language"],
    style: true,
  }).diagnostics;
  assert.deepEqual(diagnostics, []);
});

// --- ol-style-equality-confusion --------------------------------------------------------------

test("ol-style-equality-confusion: a standalone == statement is flagged", () => {
  const diagnostics = checkStyle(":side_count = 4\n:side_count == 4");
  const found = diagnostics.filter(
    (d) => d.code === "ol-style-equality-confusion",
  );
  assert.equal(found.length, 1);
  assert.deepEqual(found[0].params, { operators: ["=="] });
  assert.equal(found[0].severity, "warning");
});

test("ol-style-equality-confusion: a standalone != statement is flagged", () => {
  const diagnostics = checkStyle(":x = 1\n:x != 2").filter(
    (d) => d.code === "ol-style-equality-confusion",
  );
  assert.equal(diagnostics.length, 1);
  assert.deepEqual(diagnostics[0].params, { operators: ["!="] });
});

test("ol-style-equality-confusion: a standalone multi-operator ComparisonChain is flagged", () => {
  const diagnostics = checkStyle("1 < 2 < 3").filter(
    (d) => d.code === "ol-style-equality-confusion",
  );
  assert.equal(diagnostics.length, 1);
  assert.deepEqual(diagnostics[0].params, { operators: ["<", "<"] });
});

test("ol-style-equality-confusion: == used correctly as a condition is not flagged", () => {
  const diagnostics = checkStyle(':x = 1\nif :x == 1 [ print "yes" ]');
  assert.deepEqual(diagnostics, []);
});

test("ol-style-equality-confusion: == used as a call argument (not statement position) is not flagged", () => {
  const diagnostics = checkStyle(":x = 1\nprint :x == 1");
  assert.deepEqual(diagnostics, []);
});

test("ol-style-equality-confusion: a single non-equality comparison (<, >, <=, >=) is not flagged", () => {
  const diagnostics = checkStyle("1 < 2");
  assert.deepEqual(diagnostics, []);
});

test("ol-style-equality-confusion: an == statement nested inside a repeat block is still flagged", () => {
  const diagnostics = checkStyle(":x = 1\nrepeat 2 [ :x == 1 ]").filter(
    (d) => d.code === "ol-style-equality-confusion",
  );
  assert.equal(diagnostics.length, 1);
});

// --- ol-style-name-case ------------------------------------------------------------------------

test("ol-style-name-case: a snake_case variable read/assignment is clean", () => {
  const diagnostics = checkStyle(":side_length = 100\nprint :side_length");
  assert.deepEqual(diagnostics, []);
});

test("ol-style-name-case: a camelCase variable is flagged at its read AND its assignment place", () => {
  const diagnostics = checkStyle(":sideLength = 100\nprint :sideLength").filter(
    (d) => d.code === "ol-style-name-case",
  );
  assert.equal(diagnostics.length, 2);
  assert.deepEqual(diagnostics[0].params, { name: "sideLength" });
  assert.deepEqual(diagnostics[1].params, { name: "sideLength" });
});

test("ol-style-name-case: an UPPERCASE place field name is flagged", () => {
  // The lexer's identifier grammar has no hyphen (`turn-angle` would tokenize as `turn - angle`,
  // a subtraction), so "hyphenated" is not a reachable name-case violation for any single
  // identifier token; UPPERCASE is the reachable field-name violation this rule covers instead.
  const diagnostics = checkStyle(":person = 1\nprint :person.TurnAngle").filter(
    (d) => d.code === "ol-style-name-case",
  );
  assert.equal(diagnostics.length, 1);
  assert.deepEqual(diagnostics[0].params, { name: "TurnAngle" });
});

test("ol-style-name-case: an UPPERCASE procedure name and its params are each flagged", () => {
  const diagnostics = checkStyle(
    "define DrawSquare :Size\n  print :Size\nend",
  ).filter((d) => d.code === "ol-style-name-case");
  const names = diagnostics.map((d) => d.params.name);
  assert.ok(names.includes("DrawSquare"));
  assert.ok(names.includes("Size"));
});

test("ol-style-name-case: a trailing ? or ! is allowed", () => {
  const diagnostics = checkStyle("define is_ready?\n  return true\nend");
  assert.deepEqual(diagnostics, []);
});

test("ol-style-name-case: a bad local declaration name is flagged", () => {
  const diagnostics = checkStyle("define f\n  local myVar\nend").filter(
    (d) => d.code === "ol-style-name-case",
  );
  assert.ok(diagnostics.some((d) => d.params.name === "myVar"));
});

test("ol-style-name-case: a bad for-in binder is flagged", () => {
  const diagnostics = checkStyle(
    "for myItem in [1 2] [ print :myItem ]",
  ).filter((d) => d.code === "ol-style-name-case");
  assert.ok(diagnostics.some((d) => d.params.name === "myItem"));
});

test("ol-style-name-case: a bad for-in destructuring binder name is flagged", () => {
  const diagnostics = checkStyle(
    "for [:goodName :other] in [[1 2]] [ print :goodName ]",
  ).filter((d) => d.code === "ol-style-name-case");
  assert.ok(diagnostics.some((d) => d.params.name === "goodName"));
});

test("ol-style-name-case: a bad for-range variable is flagged", () => {
  const diagnostics = checkStyle(
    "for badVar from 1 to 3 [ print :badVar ]",
  ).filter((d) => d.code === "ol-style-name-case");
  assert.ok(diagnostics.some((d) => d.params.name === "badVar"));
});

test("ol-style-name-case: bad map/reduce comprehension binder and accumulator names are flagged", () => {
  const mapDiagnostics = checkStyle(
    ":xs = [1 2]\n:ys = map badItem in :xs [ :badItem ]",
  ).filter((d) => d.code === "ol-style-name-case");
  assert.ok(mapDiagnostics.some((d) => d.params.name === "badItem"));

  const reduceDiagnostics = checkStyle(
    ":xs = [1 2]\n:total = reduce badSum n in :xs from 0 [ :badSum + :n ]",
  ).filter((d) => d.code === "ol-style-name-case");
  assert.ok(reduceDiagnostics.some((d) => d.params.name === "badSum"));
});

test("ol-style-name-case: a short lowercase loop binder like `i` is clean", () => {
  const diagnostics = checkStyle("for i from 1 to 4 [ print :i ]");
  assert.deepEqual(diagnostics, []);
});

test("ol-style-name-case: a call/callee name is out of scope for this rule (not checked)", () => {
  // `badCallee` would be an ol-unknown-command Layer-2 error, not a style warning here — but the
  // point of this test is that the *callee* spelling itself is never checked for name-case,
  // regardless of whether it resolves; only declaration/reference *identifier* sites are.
  const { ast: program } = OL.parse("badCallee 1", doc);
  const diagnostics = OL.check(program, {
    profiles: ["core-language"],
    style: true,
  }).diagnostics.filter((d) => d.code === "ol-style-name-case");
  assert.deepEqual(diagnostics, []);
});

// --- opt-in gating -------------------------------------------------------------------------

test("check() never runs style lints unless options.style === true", () => {
  const { ast: program } = OL.parse(":X = 1", doc);
  const diagnostics = OL.check(program, {
    profiles: ["core-language"],
  }).diagnostics;
  assert.deepEqual(diagnostics, []);
});
