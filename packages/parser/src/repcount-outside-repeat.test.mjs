import assert from "node:assert/strict";
import { test } from "node:test";
import * as OL from "@openlogo/parser";

/**
 * Unit tests for issue #1155 — `ol-repcount-outside-repeat` reported at `stage: "semantic"`.
 *
 * Behavior is verified through the public `@openlogo/parser` surface (`parse` + `check`), matching
 * the package's black-box test convention, and assertions check diagnostic identity — code,
 * params, stage, severity, span — never the non-normative English message.
 *
 * These cover the rule's decision points; the cross-package claim that each verdict AGREES with
 * `@openlogo/runtime`'s evaluator is asserted by the conformance fixtures under
 * `tests/conformance/core-language/{check,execution}/repcount-*`, which run both sides.
 */

const CODE = "ol-repcount-outside-repeat";

function repcountFindings(source, profiles = ["core-language"]) {
  const { ast, diagnostics: parseDiagnostics } = OL.parse(source, "unit.logo");
  assert.deepEqual(
    parseDiagnostics,
    [],
    `expected clean parse for ${JSON.stringify(source)}`,
  );
  return OL.check(ast, { profiles, source }).diagnostics.filter(
    (finding) => finding.code === CODE,
  );
}

/** Every diagnostic `check()` reports, used where a test asserts the COMPLETE finding set. */
function allFindings(source, profiles = ["core-language"]) {
  const { ast } = OL.parse(source, "unit.logo");
  return OL.check(ast, { profiles, source }).diagnostics;
}

// --- identity ---------------------------------------------------------------

test("reports `repcount` outside any repeat at stage semantic, params none", () => {
  const diagnostics = repcountFindings('print "start"\nprint repcount');
  assert.equal(diagnostics.length, 1);
  const [finding] = diagnostics;
  assert.equal(finding.stage, "semantic");
  assert.equal(finding.severity, "error");
  assert.deepEqual(finding.params, {});
  assert.deepEqual(finding.source_span, {
    document: "unit.logo",
    start: [2, 7],
    end: [2, 15],
  });
});

test("its message uses the warm lowercase Logo voice", () => {
  const [finding] = repcountFindings("print repcount");
  assert.match(finding.message, /^repcount only reports a turn number/);
});

test("matches the reporter name case-insensitively, as name lookup is", () => {
  assert.equal(repcountFindings("print REPCOUNT").length, 1);
  assert.equal(repcountFindings("print RepCount").length, 1);
});

test("reports the parenthesized call form too", () => {
  const [finding] = repcountFindings("print (repcount)");
  assert.deepEqual(finding.source_span, {
    document: "unit.logo",
    start: [1, 7],
    end: [1, 17],
  });
});

// --- what encloses ----------------------------------------------------------

test("accepts `repcount` inside a repeat body, however nested", () => {
  assert.deepEqual(repcountFindings("repeat 2 [ print repcount ]"), []);
  assert.deepEqual(
    repcountFindings("repeat 2 [ repeat 3 [ print repcount ] ]"),
    [],
  );
  assert.deepEqual(
    repcountFindings("repeat 2 [ if true [ print repcount ] ]"),
    [],
  );
  assert.deepEqual(
    repcountFindings("repeat 2 [ for n in [ 1 ] [ print repcount ] ]"),
    [],
  );
  assert.deepEqual(repcountFindings("repeat 2 [ print (repcount) ]"), []);
});

test("only a `repeat` encloses — `forever` and `while` do not", () => {
  assert.equal(repcountFindings("forever [ print repcount ]").length, 1);
  assert.equal(repcountFindings("while false [ print repcount ]").length, 1);
});

test("a repeat's own count expression sits outside its body", () => {
  assert.equal(repcountFindings("repeat repcount [ print 1 ]").length, 1);
  assert.deepEqual(
    repcountFindings("repeat 2 [ repeat repcount [ print 1 ] ]"),
    [],
  );
});

test("a procedure body is a boundary, even when called from a repeat", () => {
  assert.equal(
    repcountFindings("define f\n  print repcount\nend\nrepeat 2 [ f ]").length,
    1,
  );
  assert.equal(
    repcountFindings("repeat 2 [ define f\n print repcount\nend\n f ]").length,
    1,
  );
  assert.deepEqual(
    repcountFindings("define f\n  repeat 2 [ print repcount ]\nend\nf"),
    [],
  );
});

test("a comprehension body is transparent in both directions", () => {
  assert.equal(
    repcountFindings("print map n in [ 1 2 ] [ repcount ]").length,
    1,
  );
  assert.deepEqual(
    repcountFindings("repeat 2 [ print map n in [ 1 2 ] [ repcount ] ]"),
    [],
  );
});

test("an event-handler block is transparent, not a boundary", () => {
  assert.equal(
    repcountFindings('when "start" [ print repcount ]', [
      "core-language",
      "interaction-events",
    ]).length,
    1,
  );
  assert.deepEqual(
    repcountFindings('repeat 2 [ when "start" [ print repcount ] ]', [
      "core-language",
      "interaction-events",
    ]),
    [],
  );
});

// --- read position versus place position ------------------------------------

test("a bare `repcount` assignment target raises ol-not-a-place ALONE", () => {
  const diagnostics = allFindings("repcount = 100");
  assert.deepEqual(
    diagnostics.map((finding) => finding.code),
    ["ol-not-a-place"],
  );
});

test("`set repcount to 100` is not a read either", () => {
  assert.deepEqual(repcountFindings("set repcount to 100"), []);
});

test("a read nested inside a WELL-FORMED place is still reported", () => {
  const diagnostics = allFindings("set xs to [ 1 2 ]\n:xs[(repcount)] = 5", [
    "core-language",
    "data",
  ]);
  assert.deepEqual(
    diagnostics.map((finding) => finding.code),
    [CODE],
  );
  assert.deepEqual(diagnostics[0].source_span, {
    document: "unit.logo",
    start: [2, 5],
    end: [2, 15],
  });
});

test("an ordinary assignment to a valid place stays clean", () => {
  assert.deepEqual(repcountFindings("set n to 1\n:n = 2"), []);
});

// --- profile gating ---------------------------------------------------------

test("stays silent when core-language is inactive, leaving ol-unknown-command", () => {
  const diagnostics = allFindings("print repcount", ["turtle-rendering"]);
  assert.ok(diagnostics.every((finding) => finding.code !== CODE));
  assert.ok(
    diagnostics.some(
      (finding) =>
        finding.code === "ol-unknown-command" &&
        finding.params.name === "repcount",
    ),
  );
});
