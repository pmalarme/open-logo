// **A runtime guard is proven by the run it stops, not by the diagnostic it duplicates.**
//
// Issue #815 put a check in front of `execute()`, so for every fault the semantic layer can decide
// statically the runtime's own guard now fires *second*. Its report is identical to the check's, and
// `spec/execution-model.md:746-748` collapses the two — which means the merged `diagnostics` array a
// test inspects is the **checker's** answer whether the runtime guard raised anything or not.
//
// That is not a theory. Deleting `executeTurtleMoveCall`'s arity guard outright — replacing the
// `halt(...)` with `return undefined` — leaves `npm run build`, `typecheck`, `lint`, `format:check`,
// `test`, `coverage` (100%), `conformance` (1002/1002) and `examples` all green, and
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
// (`spec/execution-model.md:746-748`) then keeps the checker's copy and the runtime's contribution
// disappears from `diagnostics`. That filter is enumerable. Intersecting the codes built in
// `packages/runtime/src/errors.ts` with those pushed by `packages/parser/src/checker-*.ts` gives
// **27 runtime codes, 15 of them maskable**. The other 12 (`ol-div-zero`, `ol-type`, `ol-range`,
// `ol-limit`, `ol-not-boolean`, `ol-user-error`, …) have no checker twin, so they survive as
// `stage: "runtime"` and the ordinary tests already assert them.
//
// **The unit is a raise SITE, not a code, and this file learned that the expensive way.** Those 15
// codes are raised from **83 distinct sites** across `execute-internal.ts` and `evaluate.ts`, and
// sites under one code do not behave alike. `ol-unknown-type` has two: the prefix `is_a?` reports at
// `stage: "runtime"` and is protected by conformance fixtures, while the worded `5 is a "banana"`
// reports at `semantic` and was completely unprotected — its guard could be deleted with the halt
// suite, conformance and all 5030 tests green. An earlier version of this note excused the whole
// code on the strength of the protected sibling. That was prose justifying an absence, and the
// absence was real.
//
// So the honest statement, at site granularity:
//
//   - **12 sites are covered here**, one per code for twelve of the fifteen codes.
//   - **3 codes have no halt to assert at any site**, each for its own measured reason —
//     `ol-too-many-inputs` (refused at parse as `ol-bad-token`; unreachable through `execute()`),
//     and `ol-duplicate-definition` / `ol-reserved-word` (registration-phase: the whole program is
//     refused before any statement runs, so there is no partial run to truncate — `events` is `[]`).
//   - **The remaining sites are NOT enumerated**, and no completeness is claimed for them. Where a
//     code has one site, covering it covers the code; where it has several — `ol-too-many-inputs`
//     29, `ol-not-enough-inputs` 21, `ol-return-outside-proc` 5, `ol-stop-outside-proc` 5,
//     `ol-unknown-command` 5, `ol-duplicate-binder` 4, `ol-undefined-var` 4, `ol-no-output` 2,
//     `ol-unknown-type` 2 — one covered site says nothing about its siblings, as `ol-unknown-type`
//     demonstrates.
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
// neither same-code de-duplication nor precedence, or — far likelier — one of the 71 maskable raise
// sites this file does not cover turning out to be masked and unprotected, exactly as the worded
// `is a` was.

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

test("the claimed profile set cannot be changed after the run has been checked", () => {
  // `spec/execution-model.md:680` — "One value MUST govern both the check and the run" — is not
  // satisfied if a caller can hand in an array and then mutate it. Measured before the array was
  // copied: adding `turtle-rendering` from inside a synchronous host callback made the check report
  // `forward` unknown and the run then move and draw it.
  const profiles = ["core-language"];
  const result = execute("forward 100\n", doc, {
    profiles,
    runUnchecked: true,
  });
  profiles.push("turtle-rendering");
  assert.deepEqual(
    result.events.map((event) => event.kind),
    ["instruction"],
    "mutating the caller's array must not retroactively widen the run",
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
