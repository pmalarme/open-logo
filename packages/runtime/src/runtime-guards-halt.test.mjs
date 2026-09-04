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
