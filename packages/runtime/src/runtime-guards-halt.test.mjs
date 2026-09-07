// **A runtime guard is proven by the run it stops, not by the diagnostic it duplicates.**
//
// Issue #815 put a check in front of `execute()`, so for every fault the semantic layer can decide
// statically the runtime's own guard now fires *second*. Its report is identical to the check's, and
// `spec/execution-model.md:746-748` collapses the two — which means the merged `diagnostics` array a
// test inspects is the **checker's** answer whether the runtime guard raised anything or not.
//
// That is not a theory. Deleting `executeTurtleMoveCall`'s arity guard outright — replacing the
// `halt(...)` with `return undefined` — leaves `npm run build`, `typecheck`, `lint`, `format:check`,
// `test`, `coverage` (100%), `conformance` and `examples` all green, and
// `execute("forward", …, { runUnchecked: true })` returns a byte-identical result. A whole family of
// tests that read as runtime-behaviour assertions had quietly become checker-echo assertions.
//
// What the guard actually does is **stop the run at the fault**, and that survives de-duplication
// because it is written in the event stream rather than in the diagnostics. Each case below runs a
// faulting statement followed by a sentinel `forward 100`; if the guard stops working, the sentinel
// executes and appends `move` + `draw-segment`. Measured against the same deletion: the assertion
// goes from `["instruction"]` to `["instruction", "instruction", "move", "draw-segment"]` — a
// learner shown a drawing the program never earned, which is exactly saga #811's subject reached
// from the opposite side.
//
// Every case is `runUnchecked: true` on purpose. Without it the gate refuses the program and no
// runtime guard is reachable at all (`spec/execution-model.md:661-664`); with it,
// `spec/execution-model.md:687-694`'s "runs an exercise up to its first mistake" is precisely the
// behaviour being pinned — *up to*, not past.
//
// Only faults that genuinely reach execution are listed. A surplus argument (`forward 1 2`,
// `pen_down 1`) is rejected at PARSE as `ol-bad-token`, so the parse gate refuses the program and
// its runtime too-many-inputs guard is unreachable through `execute()` — measured, `events` is
// empty for those, and listing them here would assert the parse gate while appearing to assert the
// guard.
//
// ## How this set was established, and what would falsify it
//
// **A count of cases is not a count of mechanisms covered, and the count is what everyone reads.**
// The first version of this file had eleven cases and looked broad; six of them were the same code
// (`ol-not-enough-inputs`) reached through different commands, so it was wide in commands and
// narrow in mechanism. That is the illusion this note exists to prevent.
//
// The at-risk class is defined by the mechanism, not by inspection: a runtime guard is masked
// exactly when **the checker can emit the same code for the same program**, because de-duplication
// (`spec/execution-model.md:741-748`) then keeps the checker's copy and the runtime's contribution
// disappears from `diagnostics`. That filter is enumerable — intersect the codes built in
// `packages/runtime/src/errors.ts` with those pushed by `packages/parser/src/checker-*.ts` — and it
// is worth re-deriving rather than trusting a number written here:
//
//   git grep -o 'ol-[a-z-]*' -- packages/runtime/src/errors.ts | sort -u
//   git grep -o 'ol-[a-z-]*' -- 'packages/parser/src/checker-*.ts' | sort -u
//
// Codes with no checker twin (`ol-div-zero`, `ol-type`, `ol-range`, `ol-limit`, `ol-not-boolean`,
// `ol-user-error`, …) are not at risk: they survive as `stage: "runtime"` and the ordinary tests
// already assert them.
//
// **The unit is a raise SITE, not a code, and this file learned that the expensive way.** Sites
// under one code do not behave alike. `ol-unknown-type` has two: the prefix `is_a?` reports at
// `stage: "runtime"` and is protected by conformance fixtures, while the worded `5 is a "banana"`
// reports at `semantic` and was completely unprotected — its guard could be deleted with the halt
// suite, conformance and the whole test suite green. An earlier version of this note excused the
// whole code on the strength of the protected sibling. That was prose justifying an absence, and
// the absence was real.
//
// **No completeness is claimed, and the counts that used to be here are gone.** They were wrong
// twice — a count of codes reported as a count of sites, then a count of cases that miscounted
// itself — and `AGENTS.md` is explicit that a derived count in prose is an unenforced assertion.
// What is true and checkable: every case below is a maskable site, each was measured to halt with
// the surviving diagnostic reading `stage: "semantic"`, and **the maskable sites this file does not
// list are not covered by anything**. Three codes have no halt to assert at any site, each for its
// own measured reason — `ol-too-many-inputs` (refused at parse as `ol-bad-token`, so unreachable
// through `execute()`), and `ol-duplicate-definition` / `ol-reserved-word` (registration-phase: the
// whole program is refused before any statement runs, so there is no partial run to truncate).
//
// **Two cases below are weaker than the rest, and say so rather than being quietly counted.**
// Top-level `return` and `stop` terminate through their own control signals before `runProgram`
// builds a diagnostic, so deleting the diagnostic construction alone leaves both the event
// assertion and the merged-diagnostic assertion green. They are kept because the halt itself is
// still worth pinning, but they are control paths, not load-bearing diagnostic raise sites.
//
// **The second suppression mechanism was checked too, and does not extend the class.** This slice
// also implements the precedence rule, which suppresses a *different* code (`ol-bad-token` beside an
// unresolvable callee), so a code intersection cannot see it by construction. It cannot mask a
// runtime guard, and the reason is structural rather than empirical: `applyOneFaultRules` is called
// from exactly one place — `packages/parser/src/analyze.ts` — over the parse and semantic
// diagnostics only, and `mergeRunDiagnostics` never re-applies it, so no runtime diagnostic is ever
// in a set precedence examines.
//
// **What would falsify this** is either the frame or the granularity: a masking route that is
// neither same-code de-duplication nor precedence, or — far likelier — a maskable raise site this
// file does not list turning out to be masked and unprotected, exactly as the worded `is a` was.

import assert from "node:assert/strict";
import test from "node:test";

import { execute } from "@openlogo/runtime";

const doc = "runtime-guards-halt.logo";

/** Appended after every faulting statement. If the run does not stop, this draws. */
const SENTINEL = "forward 100";

/**
 * Each entry: the faulting statement, the diagnostic it earns, and the **exact** event kinds the
 * run may emit. Every `events` value was measured, not predicted.
 */
const HALTING_FAULTS = [
  {
    label: "a turtle move with no input",
    source: "forward",
    code: "ol-not-enough-inputs",
    events: ["instruction"],
  },
  {
    label: "a turn with no input",
    source: "right",
    code: "ol-not-enough-inputs",
    events: ["instruction"],
  },
  {
    label: "a pen colour with no input",
    source: "set_color",
    code: "ol-not-enough-inputs",
    events: ["instruction"],
  },
  {
    label: "absolute positioning with too few inputs",
    source: "set_xy 1",
    code: "ol-not-enough-inputs",
    events: ["instruction"],
  },
  {
    label: "a heading with no input",
    source: "set_heading",
    code: "ol-not-enough-inputs",
    events: ["instruction"],
  },
  {
    label: "a shape with no input",
    source: "set_shape",
    code: "ol-not-enough-inputs",
    events: ["instruction"],
  },
  {
    label: "reading an unbound variable",
    source: "print :nope",
    code: "ol-undefined-var",
    events: ["instruction"],
  },
  {
    label: "dividing by zero",
    source: "print 1 / 0",
    code: "ol-div-zero",
    events: ["instruction"],
  },
  {
    label: "an unresolvable name in argument position (saga #811's own shape)",
    source: "print (wibble 2)",
    code: "ol-unknown-command",
    events: ["instruction"],
  },
  {
    label: "a command used where a value is required",
    source: "wait forward 5",
    code: "ol-no-output",
    events: ["instruction"],
  },
  {
    label: "a return outside any procedure",
    source: "return 1",
    code: "ol-return-outside-proc",
    events: ["instruction", "return"],
  },
  // The six below close the gap the enumeration found — see the header note on how the class was
  // derived. Each was measured to halt with the surviving diagnostic reading `stage: "semantic"`,
  // i.e. the checker's copy, leaving the truncated event stream as the runtime guard's only
  // observable contribution.
  {
    label: "a stop outside any procedure",
    source: "stop",
    code: "ol-stop-outside-proc",
    events: ["instruction"],
  },
  {
    label: "assigning to something that is not a place",
    source: "first [1 2] = 3",
    code: "ol-not-a-place",
    events: ["instruction"],
  },
  {
    label: "a comprehension body that reports no value",
    source: ":out = map n in [1] [ print :n ]",
    code: "ol-no-value",
    events: ["instruction"],
  },
  {
    label: "a return inside a comprehension body",
    source: ":out = map n in [1] [ return :n ]",
    code: "ol-return-in-comprehension",
    events: ["instruction"],
  },
  {
    label: "a comprehension binder declared twice",
    source: ":total = reduce sum sum in [1 2 3] from 0 [ :sum ]",
    code: "ol-duplicate-binder",
    events: ["instruction"],
  },
  {
    label: "reading a field a struct does not declare",
    source: "struct point [ x y ]\nprint (point 0 0).z",
    code: "ol-unknown-field",
    events: ["instruction", "instruction"],
  },
  {
    // The WORDED form specifically. Its sibling raise site — the prefix `is_a?` at
    // `evaluate.ts`'s `evaluatePrefixIsA` — reports at `stage: "runtime"` and is protected by two
    // conformance fixtures, and this file previously cited that sibling as grounds for excluding
    // the whole code. Measured, the two sites differ: `print (5 is a "banana")` surfaces
    // `ol-unknown-type` at `stage: "semantic"`, the checker's copy, so this site IS masked, and
    // deleting its guard left the halt suite, conformance and all 5030 tests green.
    label: "the worded `is a` given a type word that does not exist",
    source: 'print (5 is a "banana")',
    code: "ol-unknown-type",
    events: ["instruction"],
  },
];

for (const { label, source, code, events } of HALTING_FAULTS) {
  test(`the run stops at ${label}, so nothing after it runs`, () => {
    const result = execute(`${source}\n${SENTINEL}\n`, doc, {
      runUnchecked: true,
    });

    // The load-bearing assertion. `move`/`draw-segment` appearing here means the sentinel ran,
    // which means the fault did not stop the program.
    assert.deepEqual(
      result.events.map((event) => event.kind),
      events,
      `${source} did not stop the run: the sentinel ${SENTINEL} left traces`,
    );
    assert.ok(
      result.diagnostics.some((diagnostic) => diagnostic.code === code),
      `${source} should still report ${code}`,
    );
  });
}

test("the sentinel really draws when nothing stops it", () => {
  // Sanity-assert the instrument. Every assertion above is "these events are ABSENT", which a
  // sentinel that never drew would satisfy for free — the vacuity that makes a negative assertion
  // worth distrusting. Same program shape, no faulting statement.
  const result = execute(`${SENTINEL}\n${SENTINEL}\n`, doc, {
    runUnchecked: true,
  });
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(
    result.events.map((event) => event.kind),
    [
      "instruction",
      "move",
      "draw-segment",
      "instruction",
      "move",
      "draw-segment",
    ],
  );
});

test("a fault reached only at run time still stops the run", () => {
  // The cases above are all statically decidable, so each has a checker twin whose report survives
  // de-duplication. This one does not: whether `count` is called with a list or a number is not
  // decided until the value exists, so the diagnostic here is the RUNTIME's own — the control case
  // showing the halt and the diagnostic are separate observations rather than one.
  const result = execute(`print count 5\n${SENTINEL}\n`, doc);
  assert.deepEqual(
    result.diagnostics.map((diagnostic) => [diagnostic.code, diagnostic.stage]),
    [["ol-type", "runtime"]],
  );
  assert.deepEqual(
    result.events.map((event) => event.kind),
    ["instruction"],
  );
});

// ---------------------------------------------------------------------------------------------
// The run obeys the profile set it CLAIMS, not the implementation's own (issue #815).
//
// `spec/execution-model.md:673-680` closes with "One value MUST govern both the check and the run",
// and before these cases only the check was governed. Measured then, under
// `{ profiles: ["core-language"] }`: `forward 10` was reported `ol-unknown-command` and **still
// moved and drew**, and `challenge` collected `ol-unknown-command` from the check *and*
// `ol-not-implemented` from the run — two contradictory answers about one name, which the
// de-duplication rule cannot collapse because the codes differ.
//
// Every case needs `runUnchecked`, because a checked run is refused by the gate before Phase 2 and
// the divergence is unobservable. That is also why it went unnoticed: the two values could only
// disagree on the one path that deliberately ignores the first of them.
// ---------------------------------------------------------------------------------------------

/**
 * A sentinel that is itself Core Language, for the profile cases below. `SENTINEL` is a turtle
 * command, so under a run claiming Core alone it would be unresolvable too and would report a
 * SECOND `ol-unknown-command` — making the assertion about the fault under test ambiguous.
 */
const CORE_SENTINEL = 'print "after"';

/** Core Language alone — no Turtle & Rendering, no Heritage, no Tutor (AI). */
const CORE_ONLY = { profiles: ["core-language"], runUnchecked: true };

test("a primitive of an unclaimed profile does not run, and does not draw", () => {
  const result = execute(`forward 10\n${CORE_SENTINEL}\n`, doc, CORE_ONLY);
  assert.deepEqual(
    result.diagnostics.map((diagnostic) => [
      diagnostic.code,
      diagnostic.params.name,
    ]),
    [["ol-unknown-command", "forward"]],
  );
  assert.deepEqual(
    result.events.map((event) => event.kind),
    ["instruction"],
    "Core Language alone does not include forward, so nothing may move or draw",
  );
});

test("the same program under the claimed profile runs normally", () => {
  // The other half of the pair. Without it the assertion above is satisfied by an implementation
  // that simply refuses `forward` always, which would be a far worse defect.
  const result = execute("forward 10\n", doc, {
    profiles: ["core-language", "turtle-rendering"],
  });
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(
    result.events.map((event) => event.kind),
    ["instruction", "move", "draw-segment"],
  );
});

test("a registered-but-unevaluable name under an unclaimed profile is unknown, not unimplemented", () => {
  // `spec/error-model.md:131`: `ol-not-implemented` requires the name to "resolve under the run's
  // active profile set", and "a call under a profile the run does not claim is still
  // `ol-unknown-command`, because there the name does not resolve". One answer, not two.
  const result = execute("challenge\n", doc, CORE_ONLY);
  assert.deepEqual(
    result.diagnostics.map((diagnostic) => diagnostic.code),
    ["ol-unknown-command"],
  );
});

test("claiming Tutor (AI) changes that same call to ol-not-implemented", () => {
  const result = execute("challenge\n", doc, {
    profiles: ["core-language", "educational", "tutor-ai"],
  });
  assert.deepEqual(
    result.diagnostics.map((diagnostic) => [diagnostic.code, diagnostic.stage]),
    [["ol-not-implemented", "runtime"]],
  );
});

test("a Heritage alias needs Heritage itself, not just its canonical's profile", () => {
  // The alias must not inherit visibility from the profile that owns the Core name it spells.
  // `spec/conformance.md:150` makes Heritage "alternate spellings only — no new semantics", so the
  // spelling is available exactly when its own profile is.
  const withoutHeritage = execute(`fd 10\n${CORE_SENTINEL}\n`, doc, {
    profiles: ["core-language", "turtle-rendering"],
    runUnchecked: true,
  });
  assert.deepEqual(
    withoutHeritage.diagnostics.map((diagnostic) => [
      diagnostic.code,
      diagnostic.params.name,
    ]),
    [["ol-unknown-command", "fd"]],
    "the diagnostic must name `fd`, the word the learner wrote, not the `forward` it spells",
  );
  assert.deepEqual(
    withoutHeritage.events.map((event) => event.kind),
    ["instruction"],
  );

  const withHeritage = execute("fd 10\n", doc, {
    profiles: ["core-language", "turtle-rendering", "heritage"],
  });
  assert.deepEqual(withHeritage.diagnostics, []);
  assert.deepEqual(
    withHeritage.events.map((event) => event.kind),
    ["instruction", "move", "draw-segment"],
  );
});

test("a keyword is known under every profile set, so it never reads as a typo", () => {
  // `spec/grammar.md:408` keeps the reserved-word set a property of the language version rather
  // than of the profile set a run claims, so gating keywords here would make the same word known
  // or unknown depending on the caller. Core Language alone still parses and runs a `repeat`.
  const result = execute("repeat 2 [ print 1 ]\n", doc, {
    profiles: ["core-language"],
  });
  assert.deepEqual(result.diagnostics, []);
  assert.equal(
    result.events.filter((event) => event.kind === "print").length,
    2,
  );
});

test("an unclaimed profile's reporter does not answer in ARGUMENT position either", () => {
  // The expression-position counterpart, and the half that was wrong twice. The guard first sat
  // with the terminal rule at the bottom of `evaluateCall`, which every name with an implemented
  // branch reached past: measured then, `print xcor` under Core Language alone reported
  // `ol-unknown-command` and still printed `0`. A statement-level guard alone cannot see this,
  // because the statement here is `print`, which resolves perfectly well.
  const result = execute(`print xcor\n${CORE_SENTINEL}\n`, doc, CORE_ONLY);
  assert.deepEqual(
    result.diagnostics.map((diagnostic) => diagnostic.code),
    ["ol-unknown-command"],
  );
  assert.deepEqual(
    result.events.map((event) => event.kind),
    ["instruction"],
    "nothing may be printed: the reporter's profile is not claimed",
  );

  const claimed = execute("print xcor\n", doc, {
    profiles: ["core-language", "turtle-rendering"],
  });
  assert.deepEqual(claimed.diagnostics, []);
  assert.equal(
    claimed.events.filter((event) => event.kind === "print").length,
    1,
  );
});

test("a PROFILE keyword is gated by its own profile, in both directions", () => {
  // The counterpart, and the half that a bare `isKeyword(name)` got wrong twice over: `when` is a
  // keyword only "while their profile is active" (`spec/tooling.md:30`). Measured before this was
  // fixed, a run claiming Core Language alone registered the handler and ran its body.
  const withoutProfile = execute('when "start" [ print 1 ]\n', doc, {
    profiles: ["core-language"],
    runUnchecked: true,
  });
  assert.deepEqual(
    withoutProfile.events.map((event) => event.kind),
    ["instruction"],
  );

  const withProfile = execute('when "start" [ print 1 ]\n', doc, {});
  assert.deepEqual(withProfile.diagnostics, []);
  assert.equal(
    withProfile.events.filter((event) => event.kind === "print").length,
    1,
  );
});

test("a declaration of an inactive profile does not run its constructor", () => {
  // `struct` is Data's. The constructor call cannot be caught by the callee guard — `point` is a
  // user-declared name, not a built-in — so refusing the DECLARATION is what stops it.
  const withoutData = execute(
    "struct point [ x y ]\nprint (point 1 2).x\n",
    doc,
    { profiles: ["core-language"], runUnchecked: true },
  );
  assert.deepEqual(
    withoutData.events.map((event) => event.kind),
    ["instruction"],
    "the constructor must not run under a profile set that has no struct",
  );

  const withData = execute("struct point [ x y ]\nprint (point 1 2).x\n", doc, {
    profiles: ["core-language", "data"],
  });
  assert.deepEqual(withData.diagnostics, []);
  assert.equal(
    withData.events.filter((event) => event.kind === "print").length,
    1,
  );
});

test("the claimed profile set cannot be widened DURING the run", () => {
  // `spec/execution-model.md:680` — "One value MUST govern both the check and the run" — is not
  // satisfied if a caller can hand in an array and then mutate it. An earlier version of this test
  // mutated `profiles` *after* `execute()` returned, which proves nothing: `execute()` is
  // synchronous, so the run is already over and the assertion passes whether the array was copied
  // or aliased. A reviewer caught that, and the fix is to mutate from inside the run.
  //
  // `hostInput.read` is the seam that makes it possible: it is called synchronously mid-run
  // (`spec/interaction-events.md:108-111` requires no instruction to advance until the read
  // finishes), so widening the caller's array there is exactly the hostile case. Interaction &
  // Events is claimed because `input` belongs to it — without that the run halts at the `input`
  // itself and the callback never fires, which is how the first attempt at this test silently
  // measured nothing. Turtle & Rendering is the profile the host tries to smuggle in.
  const profiles = ["core-language", "interaction-events"];
  let widenedDuringRun = false;
  const result = execute(':answer = input "go"\nforward 100\n', doc, {
    profiles,
    runUnchecked: true,
    hostInput: {
      read: () => {
        profiles.push("turtle-rendering");
        widenedDuringRun = true;
        return "ok";
      },
    },
  });

  assert.ok(widenedDuringRun, "the host callback must actually have run");
  assert.ok(
    !result.events.some(
      (event) => event.kind === "move" || event.kind === "draw-segment",
    ),
    "widening the caller's array mid-run must not admit a primitive the run never claimed",
  );
});

test("precedence suppressing a parse error does not let a recovery AST run", () => {
  // The interaction between this slice's two suppression mechanisms. The precedence rule removes
  // the `ol-bad-token` beside an unresolvable callee (`spec/execution-model.md:768-777`), and that
  // token was the program's only PARSE-stage error — so under `runUnchecked` the gate no longer
  // sees an unreadable program and proceeds. What stops it is that the same condition which
  // triggers the suppression (a callee nothing resolves) also guarantees the terminal rule halts
  // at that callee, so the sentinel never runs. Bounded in both directions below.
  const suppressed = execute(`fowad 100\n${SENTINEL}\n`, doc, {
    runUnchecked: true,
  });
  assert.deepEqual(
    suppressed.diagnostics.map((diagnostic) => diagnostic.code),
    ["ol-unknown-command"],
    "the ol-bad-token beside the unresolvable callee is suppressed",
  );
  assert.deepEqual(
    suppressed.events.map((event) => event.kind),
    ["instruction"],
    "and the recovery AST must not run on past it",
  );

  // A resolvable callee keeps its bad token, so the parse error survives and the gate refuses the
  // program outright — no events at all, not even a marker.
  const kept = execute(`forward 100 200\n${SENTINEL}\n`, doc, {
    runUnchecked: true,
  });
  assert.deepEqual(
    kept.diagnostics.map((diagnostic) => [diagnostic.code, diagnostic.stage]),
    [["ol-bad-token", "parse"]],
  );
  assert.deepEqual(kept.events, []);
});

test("a NON-CALL expression statement that fails stops the run", () => {
  // The terminal rule at statement position was written as an allow-list naming `Call`/`ParenCall`,
  // and the grammar admits every `ExpressionNode` as a statement — so every other expression form
  // was silently skipped. Measured then: `:x[2]` on a one-element list discarded the out-of-range
  // read with no `ol-range` at all, and the following statement ran. That is this slice's own
  // defect class, at a statement kind the first version of the rule did not enumerate.
  const result = execute(`:x = [1]\n:x[2]\n${CORE_SENTINEL}\n`, doc, {});
  assert.deepEqual(
    result.diagnostics.map((diagnostic) => diagnostic.code),
    ["ol-range"],
  );
  assert.deepEqual(
    result.events.map((event) => event.kind),
    ["instruction", "instruction"],
    "nothing after the failing expression statement may run",
  );
});

test("a declaration of an inactive profile stays inert even when never executed", () => {
  // `registerDeclarations` walks the WHOLE program, so a `struct` inside an untaken branch is
  // registered in Phase 1 and never passes the executed-statement guard. Measured before this:
  // under Core Language alone, `if false [ struct point [ x ] ]` then `print (point 1).x` printed
  // `1`, and `print (is_a? 1 "point")` answered `false` with no diagnostic at all — the constructor
  // and the type lookup both bypassing the profile set the run claimed.
  const dormant = "if false [ struct point [ x ] ]\n";
  const constructed = execute(`${dormant}print (point 1).x\n`, doc, {
    profiles: ["core-language"],
    runUnchecked: true,
  });
  assert.deepEqual(
    constructed.diagnostics.map((diagnostic) => diagnostic.code),
    ["ol-unknown-command"],
  );
  assert.ok(
    !constructed.events.some((event) => event.kind === "print"),
    "the constructor must not run under a set that has no struct",
  );

  const typed = execute(`${dormant}print (is_a? 1 "point")\n`, doc, {
    profiles: ["core-language"],
  });
  assert.deepEqual(
    typed.diagnostics.map((diagnostic) => diagnostic.code),
    ["ol-unknown-type"],
    "the type word must be unknown too, not silently false",
  );

  // The control: with Data claimed, the same dormant declaration works normally.
  const withData = execute(`${dormant}print (point 1).x\n`, doc, {
    profiles: ["core-language", "data"],
  });
  assert.deepEqual(withData.diagnostics, []);
  assert.equal(
    withData.events.filter((event) => event.kind === "print").length,
    1,
  );
});
