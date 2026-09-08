import assert from "node:assert/strict";
import { test } from "node:test";
import * as OL from "@openlogo/parser";
// Not re-exported by `index.ts`, so this deep relative import into the package's own build output
// is the only way to reach the block-head registry that does not change the package public surface — the
// same convention `packages/runtime/src/repeat-forever-repcount.test.mjs` uses for its own
// test-only reach into `execute-internal.js`.
import { interactionEventsBlockHeadNames } from "../dist/signatures.js";

const REGISTERED_BLOCK_HEADS = interactionEventsBlockHeadNames();

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
 * These cover the rule's decision points. Agreement with `@openlogo/runtime`'s evaluator is
 * asserted only by the fixtures that actually run it — the `execute: true` ones, which include
 * `core-language/execution/procedure-stop-exits-nested-loop`, whose filename does not carry the
 * word. A `check: true` fixture calls the checker alone and returns before `execute()`
 * (`scripts/harness/index.mjs:814`).
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

test("an optional parameter's DEFAULT expression is judged in the procedure's context", () => {
  // `childrenOf(ProcedureDef)` yields default expressions as well as the body, and both reset to
  // `outside`. Without these cases, a mutation resetting only `node.body` — letting defaults
  // inherit the surrounding `inside`/`dispatch-dependent` state — passes the whole suite.
  assert.equal(
    repcountFindings("define f (:x repcount)\n  print :x\nend").length,
    1,
  );
  assert.equal(
    repcountFindings("repeat 2 [ define f (:x repcount)\n  print :x\nend ]")
      .length,
    1,
  );
  assert.equal(
    repcountFindings(
      'on_key "a" [ define f (:x repcount)\n  print :x\nend ]',
      HANDLER_PROFILES,
    ).length,
    1,
  );
  assert.deepEqual(repcountFindings("define f (:x 1)\n  print :x\nend"), []);
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
  // The one head-and-argument SHAPE the checker places statically. `when` is the head, and its other
  // arguments (`when "stop"`, `when "START"`, `when :e`) stay deferred. Measured: top level faults after
  // 4 events; `repeat 2 [ when "start" [ print repcount ] ]` prints 1 then 2 and completes; inside
  // a procedure called from a repeat it faults after 8.
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

test("the start discriminator recognizes a SUBSET of the synchronous cases", () => {
  // The evaluator does not require a literal — it fires whenever the event expression EVALUATES to
  // "start". Measured: `set e to "start"` / `when :e [ print repcount ]` faults synchronously
  // (5 events), and so does `when word "st" "art" [ print repcount ]` (4 events). The checker
  // cannot see either, so it defers them — an under-report, which is the safe direction.
  //
  // This is the assertion that pins it. Without it, a mutation treating every non-literal `when`
  // as synchronous survives the whole unit suite AND the full conformance corpus, while reporting
  // on `set e to "stop"` / `when :e [ print repcount ]` — a program the evaluator runs clean.
  assert.deepEqual(
    repcountFindings(
      'set e to "start"\nwhen :e [ print repcount ]',
      HANDLER_PROFILES,
    ),
    [],
  );
  assert.deepEqual(
    repcountFindings(
      'set e to "stop"\nwhen :e [ print repcount ]',
      HANDLER_PROFILES,
    ),
    [],
  );
  assert.deepEqual(
    repcountFindings(
      'when word "st" "art" [ print repcount ]',
      HANDLER_PROFILES,
    ),
    [],
  );
});

test("both axes of the start discriminator are load-bearing", () => {
  // The `when` keyword guard: without it `on_key "start" [ print repcount ]` — a legal program the
  // evaluator accepts — would be reported, a false positive in the direction the design calls the
  // damaging one. Measured: it parses, checks clean, and runs to completion.
  assert.deepEqual(
    repcountFindings('on_key "start" [ print repcount ]', HANDLER_PROFILES),
    [],
  );
  // The exact-case value test: the evaluator fires a start handler on a strict `===` against the
  // word `start` (`execute-internal.ts`), so `when "START"` does not fire and its body must stay
  // deferred like any other unrecognized event.
  assert.deepEqual(
    repcountFindings('when "START" [ print repcount ]', HANDLER_PROFILES),
    [],
  );
  // Block-head lookup lowercases before matching. This assertion pins the BEHAVIOUR — an uppercase
  // head is still a handler and its body is still deferred — but note, measured, that it cannot
  // bite: the reader normalises `ON_KEY` to `on_key` in the AST, so removing either of the
  // block-head lookup's two lowercasing calls is an equivalent mutant — both were built and
  // measured. A review finding claimed such a mutation would make this program
  // report; it was built and nothing changed.
  assert.deepEqual(
    repcountFindings('ON_KEY "a" [ print repcount ]', HANDLER_PROFILES),
    [],
  );
});

test("only a ZERO-argument call is the reporter", () => {
  // `repcount` takes no arguments, so `(repcount 5)` is an arity fault and not a reader of a turn.
  // Dropping the zero-argument guard would stack a spurious ol-repcount-outside-repeat beside the
  // ol-too-many-inputs that already describes it — two findings for one mistake. Measured: the
  // complete finding set is the arity code alone.
  assert.deepEqual(
    allFindings("print (repcount 5)").map((finding) => finding.code),
    ["ol-too-many-inputs"],
  );
  assert.deepEqual(
    allFindings("repeat 2 [ print (repcount 5) ]").map(
      (finding) => finding.code,
    ),
    ["ol-too-many-inputs"],
  );
});

test("a NON-handler profile block is judged in the enclosing context", () => {
  // The handler carve-out is keyed on the block-head registry, and this pins the BOUNDARY rather
  // than the set: `each` and `ask` carry blocks but are not event handlers, so their bodies run
  // where they are written and are judged there. Measured on the evaluator for `each`:
  // `each [ print repcount ]` faults, `repeat 2 [ each [ print repcount ] ]` prints 1 then 2.
  // Without these assertions, widening the carve-out to EVERY block-bearing profile statement
  // leaves the unit suite and the full conformance corpus green while silently deferring both.
  const spriteProfiles = ["core-language", "turtle-rendering", "sprites"];
  assert.equal(
    repcountFindings("each [ print repcount ]", spriteProfiles).length,
    1,
  );
  assert.deepEqual(
    repcountFindings("repeat 2 [ each [ print repcount ] ]", spriteProfiles),
    [],
  );
  // `ask` likewise at this layer. Note the caveat, measured: `ask 1 [ … ]` additionally raises
  // `ol-type` at RUNTIME because `1` is not a sprite, so this assertion is about the static
  // boundary only and says nothing about that program's runtime outcome.
  assert.equal(
    repcountFindings("ask 1 [ print repcount ]", spriteProfiles).length,
    1,
  );
  assert.deepEqual(
    repcountFindings("repeat 2 [ ask 1 [ print repcount ] ]", spriteProfiles),
    [],
  );
});

test("the deferred-head table covers every registered block head", () => {
  // Derived rather than asserted in prose. The table is hand-written, so this pins that it stays
  // in step with the registry it is meant to cover — a hardcoded list plus a prose count is
  // exactly how the `on_click` gap opened. `interactionEventsBlockHeadNames()` is not part of the
  // package's public surface, so it is reached through the build output, the same way
  // `repeat-forever-repcount.test.mjs` reaches `execute-internal.js`.
  const covered = new Set(
    HANDLER_BODY_SOURCES.map(([head]) => head.split(" ")[0]),
  );
  for (const head of REGISTERED_BLOCK_HEADS) {
    assert.ok(
      covered.has(head),
      `block head ${head} is registered but absent from HANDLER_BODY_SOURCES`,
    );
  }
});

test("but a `define` inside a handler body RESTORES certainty and IS reported", () => {
  // `execute-internal.ts` creates each callee frame with `repeatTurns: []`, so this is statically
  // outside any repeat and the evaluator agrees (it rejects
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
  // NOTE, measured: this assertion survived every mutation run against the rule so far. The
  // mechanism is that `set repcount to 100` parses to `Assign{ place: Place{ base: {name:"repcount"} } }`; the `Place` root carries
  // `rootIsRead: false`, and `childrenOf` a `Place` yields only its segment children (`ast.ts`),
  // never `base` — so a mutation of the MATCHING strategy cannot reach it. An earlier comment
  // named "a rule matching the WORD repcount anywhere" as its falsifier; that mutation was built
  // and this test did not fail, so the named falsifier was wrong. A later draft replaced it with
  // "no mutation can falsify this", which claims more than any run establishes.
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
  // `if false [ return 1 ]` reports ol-return-outside-proc. Of the rules sampled — those three
  // plus ol-unknown-command and ol-not-a-place — none goes quiet in dead code, so exempting
  // repcount would make it the odd one out.
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

test("an assignment's VALUE is a read, in both spellings", () => {
  // The fault direction, which the clean control above does not cover: suppressing the check of
  // assignment values leaves the whole unit suite and the full corpus green while restoring
  // partial execution. `set n to` and `:n =` parse to the same `Assign` node, differing only in
  // `form`, so this is one mechanism in two spellings rather than two mechanisms.
  assert.equal(repcountFindings("set n to repcount").length, 1);
  assert.equal(repcountFindings(":n = repcount").length, 1);
  assert.equal(repcountFindings("set n to repcount + 1").length, 1);
});

test("the mutation statements' value expressions are reads too", () => {
  // `add`/`insert`/`remove` are distinct node kinds from `Assign` and reach the walk through its
  // default case. Measured on the pre-#1155 evaluator, each raises `ol-repcount-outside-repeat`
  // at `runtime` after 2 events.
  const dataProfiles = ["core-language", "data"];
  assert.equal(
    repcountFindings("set xs to [ 1 ]\nadd repcount to :xs", dataProfiles)
      .length,
    1,
  );
  assert.equal(
    repcountFindings(
      "set xs to [ 1 ]\ninsert repcount in :xs at 1",
      dataProfiles,
    ).length,
    1,
  );
  assert.equal(
    repcountFindings("set xs to [ 1 ]\nremove repcount from :xs", dataProfiles)
      .length,
    1,
  );
  assert.deepEqual(
    repcountFindings(
      "set xs to [ 1 ]\nrepeat 2 [ add repcount to :xs ]",
      dataProfiles,
    ),
    [],
  );
});

test("a bare word in KEY position is a key, not a read", () => {
  // The same shape as a `[ … ]` index key: `remove key repcount from :d` parses the word as a
  // `WordLit`, so there is no read to miss and the silence is correct. The parenthesized form is
  // a `ParenCall` and IS reported. A silence is only a miss if there is a read to miss.
  const dataProfiles = ["core-language", "data"];
  assert.deepEqual(
    repcountFindings(
      "set d to { a: 1 }\nremove key repcount from :d",
      dataProfiles,
    ),
    [],
  );
  assert.equal(
    repcountFindings(
      "set d to { a: 1 }\nremove key (repcount) from :d",
      dataProfiles,
    ).length,
    1,
  );
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
