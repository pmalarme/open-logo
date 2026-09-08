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
const HANDLER_PROFILES = ["core-language", "interaction-events"];

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

test("a procedure body is `outside` from every state, wherever the `define` is written", () => {
  assert.equal(
    repcountFindings("define f\n  print repcount\nend\nrepeat 2 [ f ]").length,
    1,
  );
  assert.equal(
    repcountFindings("repeat 2 [ define f\n print repcount\nend\n f ]").length,
    1,
  );
  // Calling is NOT the axis — lexical nesting of the definition is. Asserted here so the claim in
  // `check/repcount-in-procedure-called-from-repeat`'s description is falsifiable rather than prose.
  assert.equal(
    repcountFindings("repeat 2 [ define f\n print repcount\nend ]").length,
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

/**
 * Every block head whose body is dispatch-dependent, paired with a source putting a bare
 * `repcount` directly in that body. Table-driven over the whole set:
 * `interactionEventsBlockHeadNames()` returns four heads, and covering only three let a mutation
 * that drops one member pass unnoticed.
 *
 * A literal `when "start"` is deliberately NOT here — the evaluator runs it synchronously at
 * registration, so it has its own test below. The earlier version of this table listed it
 * alongside the others and thereby asserted the heads were uniform, which measurement refuted:
 * that is "a count of cases is not a count of mechanisms" reappearing inside the fix for it.
 */
const HANDLER_BODY_SOURCES = [
  ["every", "every 10 [ print repcount ]"],
  ["on_key", 'on_key "a" [ print repcount ]'],
  ["on_click", "on_click [ print repcount ]"],
  ['when "stop"', 'when "stop" [ print repcount ]'],
  ['when "START"', 'when "START" [ print repcount ]'],
];

test("a repcount read DIRECTLY in a handler body is dispatch-dependent, so silent", () => {
  // Measured on the evaluator with NO repeat around the handler, so nothing lexical could supply a
  // turn: `on_key "a" [ print repcount ]` + `repeat 3 [ wait 1 ]`, key delivered at tick 2, PRINTS
  // 2 — the dispatching loop's second turn. The same program + a bare `wait 3` faults at runtime.
  // Same source, two outcomes, and the value 2 is not explicable by any lexical reading.
  for (const [head, source] of HANDLER_BODY_SOURCES) {
    assert.deepEqual(
      repcountFindings(source, HANDLER_PROFILES),
      [],
      `expected ${head} body to be dispatch-dependent`,
    );
    assert.deepEqual(
      repcountFindings(`repeat 2 [ ${source} ]`, HANDLER_PROFILES),
      [],
      `expected ${head} body to stay dispatch-dependent inside a repeat`,
    );
  }
});

test('a literal `when "start"` runs SYNCHRONOUSLY, so its body IS judged statically', () => {
  // The one head whose body is not dispatch-dependent. Measured on the evaluator: top level
  // faults after 4 events; `repeat 2 [ when "start" [ print repcount ] ]` prints 1 then 2 and
  // completes; inside a procedure called from a repeat it faults after 8. Meanwhile `when "stop"`,
  // `when "START"` (event words are case-sensitive), `every`, `on_key` and `on_click` never fire
  // in those runs, which is why they stay deferred.
  assert.equal(
    repcountFindings('when "start" [ print repcount ]', HANDLER_PROFILES)
      .length,
    1,
  );
  assert.deepEqual(
    repcountFindings(
      'repeat 2 [ when "start" [ print repcount ] ]',
      HANDLER_PROFILES,
    ),
    [],
  );
  assert.equal(
    repcountFindings(
      'define f\n  when "start" [ print repcount ]\nend\nrepeat 2 [ f ]',
      HANDLER_PROFILES,
    ).length,
    1,
  );
});

test("but a `define` inside a handler body RESTORES certainty and IS reported", () => {
  // dispatch-dependent is not unknowable. A callee's repeat-turn stack starts empty however the
  // handler fired, so this is statically outside any repeat and the evaluator agrees (it rejects
  // the program). The control — the same procedure carrying its OWN repeat — runs clean, which
  // isolates the procedure boundary as the cause rather than the handler nesting.
  assert.equal(
    repcountFindings(
      'on_key "a" [ define f\n print repcount\nend\n f ]',
      HANDLER_PROFILES,
    ).length,
    1,
  );
  assert.deepEqual(
    repcountFindings(
      'on_key "a" [ define f\n repeat 2 [ print repcount ]\nend\n f ]',
      HANDLER_PROFILES,
    ),
    [],
  );
});

test("a handler's HEAD arguments are still checked in the enclosing context", () => {
  // Only the body is dispatch-dependent. A head argument is an ordinary expression, evaluated
  // where the handler is registered, so a repcount there is judged normally.
  assert.equal(
    repcountFindings("every repcount [ print 1 ]", HANDLER_PROFILES).length,
    1,
  );
  assert.deepEqual(
    repcountFindings(
      "repeat 2 [ every repcount [ print 1 ] ]",
      HANDLER_PROFILES,
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
  // NOTE, measured: no mutation of the current rule can falsify this assertion. `set repcount to
  // 100` parses to `Assign{ place: Place{ base: {name:"repcount"} } }`; the `Place` root carries
  // `rootIsRead: false` and `base` is never yielded as a visitable child, so no matching strategy
  // reaches it. An earlier comment here named "a rule matching the WORD repcount anywhere" as the
  // falsifier; that mutation was built and this test did not fail, so the claim was wrong.
  // It is kept because it pins a real asymmetry worth stating — `repcount = 100` parses the word
  // as a `Call`, `set repcount to 100` parses it as a `Place` base — not because it bites.
  assert.deepEqual(repcountFindings("set repcount to 100"), []);
});

test("a repcount in code this run never executes is still reported — deliberately", () => {
  // A measured over-report, disclosed rather than hidden. With the static rule disabled the
  // evaluator accepts all of these: an uncalled procedure body is never entered, and
  // `while false` never runs its body. Reporting anyway is the checker's established convention,
  // not a choice this rule makes — on the same build `define f  print :nope  end` (uncalled)
  // reports ol-undefined-var, `while false [ stop ]` reports ol-stop-outside-proc, and
  // `if false [ return 1 ]` reports ol-return-outside-proc. Exempting repcount would make it the
  // only rule in the checker that goes quiet in dead code.
  //
  // This does not contradict handler deferral: dead code is KNOWABLE but unreached, whereas a
  // dispatch-dependent handler body is UNKNOWABLE — identical text, correct or faulty depending
  // on what is running when the event arrives.
  assert.equal(repcountFindings("define f\n  print repcount\nend").length, 1);
  assert.equal(
    repcountFindings("define f\n  print repcount\nend\nprint 1").length,
    1,
  );
  assert.equal(repcountFindings("while false [ print repcount ]").length, 1);
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
