import assert from "node:assert/strict";
import { test } from "node:test";
import * as OL from "@openlogo/parser";

/**
 * Unit tests for issue #1155 — `ol-repcount-outside-repeat` reported at `stage: "semantic"`.
 *
 * Behavior is verified through the public `@openlogo/parser` surface (`parse` + `check`), matching
 * the package's black-box test convention. Assertions check diagnostic identity — code, params,
 * stage, severity, span — and deliberately NOT the English message: `tests/conformance/README.md`
 * records that `spec/error-model.md:255-260` makes identity `code` plus `params`, and `:262-264`
 * positively permits a template author to reword, so pinning prose here would make this suite
 * resist a change the spec allows.
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

test("an event-handler body is OPAQUE — dispatch-time, so the static rule says nothing", () => {
  // Measured on the evaluator: one handler, one lexical position, two outcomes.
  //   repeat 1 [ on_key "a" [ print repcount ] ] + repeat 3 [ wait 1 ]  -> prints 1
  //   repeat 1 [ on_key "a" [ print repcount ] ] + wait 1               -> runtime fault
  // A handler body resolves against the repeat stack at DISPATCH time, so judging it lexically
  // errs in both directions; reporting here would refuse a program that runs correctly.
  const handlerProfiles = ["core-language", "interaction-events"];
  assert.deepEqual(
    repcountFindings('on_key "a" [ print repcount ]', handlerProfiles),
    [],
  );
  assert.deepEqual(
    repcountFindings(
      'repeat 2 [ on_key "a" [ print repcount ] ]',
      handlerProfiles,
    ),
    [],
  );
  assert.deepEqual(
    repcountFindings('when "start" [ print repcount ]', handlerProfiles),
    [],
  );
});

test("a handler's HEAD arguments are still checked in the enclosing context", () => {
  // Only the body is opaque. The head is an ordinary expression position, evaluated where the
  // handler is registered, so a repcount there is judged normally.
  const handlerProfiles = ["core-language", "interaction-events"];
  assert.equal(
    repcountFindings("every repcount [ print 1 ]", handlerProfiles).length,
    1,
  );
  assert.deepEqual(
    repcountFindings(
      "repeat 2 [ every repcount [ print 1 ] ]",
      handlerProfiles,
    ),
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
  // Guards a plausible wrong implementation rather than being a smoke test: a rule that matched
  // the WORD `repcount` anywhere, instead of a zero-argument call node, would fire on this bare
  // place base. The `=` spelling above cannot catch that — there the word really is a Call node.
  assert.deepEqual(repcountFindings("set repcount to 100"), []);
});

test("a read nested inside a MALFORMED target is an independent finding", () => {
  // Only the target ROOT is exempt from being read. `first repcount = 5` is two separate
  // mistakes, and this matches the checker's existing policy: `first :undefined_name = 5`
  // already reports ol-not-a-place AND ol-undefined-var.
  const diagnostics = allFindings("first repcount = 5");
  assert.deepEqual(diagnostics.map((finding) => finding.code).sort(), [
    "ol-not-a-place",
    "ol-repcount-outside-repeat",
  ]);
  assert.deepEqual(
    repcountFindings("repeat 2 [ first repcount = 5 ]").length,
    0,
  );
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
  assert.deepEqual(repcountFindings("repeat 2 [ set n to repcount ]"), []);
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
