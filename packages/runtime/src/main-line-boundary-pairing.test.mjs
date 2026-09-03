// The main-line boundary rule, asserted as a MECHANISM rather than left as a convention
// (maintainer ruling #984, `spec/interaction-events.md:211-226`).
//
// ## Why this test exists
//
// A queued `every` occurrence must run "once the handler is free" for as long as the main line has
// not finished. Getting that right means offering a boundary at every point where main-line
// execution makes progress — and that set was discovered ONE CONTAINER AT A TIME across six review
// rounds: the top level, then control-form bodies, then procedure bodies, then comprehension
// iterations, then EMPTY loop bodies, then a comprehension's leading statements. Every fix was
// correct and every one was incomplete, because each was an enumeration of the containers its author
// could think of, and an enumeration cannot fail on the case nobody thought of.
//
// The rule that finally does not depend on anyone's enumeration is derived from the code itself:
//
//   **A main-line boundary belongs wherever the execution budget is charged.**
//
// `checkExecutionLimits` is this runtime's own existing marker for "one unit of main-line progress",
// so pairing the two makes the boundary set a property of the code rather than of a list. This test
// asserts that pairing, so a NEW charge site added without a boundary fails with its author's own
// commit instead of six review rounds later.
//
// ## What this test does NOT prove
//
// It is a **source-text** check. It proves the two constructs are written next to each other; it
// cannot prove the boundary is reachable, correctly ordered, or behaviourally right. Those are
// proven by the conformance fixtures under `tests/conformance/interaction-events/every/` and by
// `interaction-every.test.mjs`. Read a green run here as "nothing was added unpaired", never as
// "the boundary is correct".
//
// Two further limits are known and deliberately left, so they are stated rather than discovered.
// A boundary marker inside a STRING LITERAL, or inside an INLINE `/* … */` comment that does not
// start its line, still counts as an invocation — excluding either needs a parser, and unlike the
// line-comment case there is no plausible way to write one beside a charge site by accident. And
// `SOURCES` below is a hard-coded list, so this replaces enumeration-of-containers with
// enumeration-of-FILES: a charge site added to a third runtime file is invisible here by
// construction. Both were verified inapplicable to the current tree when they were recorded — every
// derived site is a real call, and these two files are the only ones that charge the budget — but
// neither is a property the test enforces.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const SOURCES = ["execute-internal.ts", "evaluate.ts"];

/** Any construct that offers the main-line boundary, directly or through a named helper. */
const BOUNDARY_MARKERS = [
  "mainLineBoundary.fn",
  "runIterationBoundary(",
  "comprehensionBoundaryDiagnostic(",
  // The `wait` tick's boundary (issue #953, which made a tick a charged instruction and so brought
  // a fourth container under the rule). `dispatchDueHandlers` runs on the very tick just charged and
  // claims exactly the `queued && !running && !claimed` set `mainLineBoundary.fn` claims, plus the
  // newly due — `claimDueEveryHandlers` is a SUPERSET of `claimQueuedEveryHandlers`, not a different
  // mechanism — which is what `executeMainLine`'s own doc comment already calls "the end-of-tick
  // drain in dispatchDueHandlers". Added as a fourth marker rather than by widening WINDOW: the
  // charge and this drain are written adjacently in `executeWaitCall`, so the window did its job.
  "dispatchDueHandlers(",
];

/**
 * How far from a charge site the pairing may be written. Measured: the largest real gap is 13 lines
 * (the boundary sits before the charge in `executeStatements`, after it everywhere else), and the
 * window only has to absorb the argument list and the intervening `if (limitDiagnostic)` guard.
 *
 * Kept deliberately tight. A generous window is not a lenient test, it is a BROKEN one: at ±25 the
 * five clustered loop sites covered for each other, so deleting one loop's boundary still found a
 * neighbour's and the mutation passed. Do not widen this to make a new site pass.
 */
const WINDOW = 14;

// NOTE: strip `\r`. This worktree checks out CRLF, so splitting on "\n" leaves a trailing carriage
// return on every line — and a scan comparing a line to "}" then never matches, silently excluding
// the whole file. That exact bug made an earlier version of this test report every charge site it
// then enumerated as unpaired (eight at the time; the derived set is ten today).
// Line-ending assumptions have produced three separate false results in this slice alone.
const read = (name) =>
  readFileSync(fileURLToPath(new URL(`./${name}`, import.meta.url)), "utf8")
    .split("\n")
    .map((line) => line.replace(/\r$/, ""));

/** Charge sites only — the exported definition of `checkExecutionLimits` is not one. */
function chargeSites(lines) {
  const sites = [];
  lines.forEach((line, index) => {
    if (!line.includes("checkExecutionLimits(")) return;
    if (/export function checkExecutionLimits\(/.test(line)) return;
    sites.push(index + 1);
  });
  return sites;
}

/**
 * The line ranges of the boundary helpers themselves. A boundary invocation INSIDE a helper's own
 * body is the helper doing its job — it is not evidence that some unrelated charge site nearby is
 * paired. Excluding these ranges is what makes the test fail on a charge site added next to a
 * helper's definition, which the first version of it passed.
 */
function helperBodyLines(lines) {
  const excluded = new Set();
  lines.forEach((line, index) => {
    if (
      !/^function (runIterationBoundary|comprehensionBoundaryDiagnostic|executeHandlerBody)\(/.test(
        line,
      )
    ) {
      return;
    }
    for (let cursor = index; cursor < lines.length; cursor += 1) {
      excluded.add(cursor + 1);
      if (lines[cursor] === "}") break;
    }
  });
  return excluded;
}

/**
 * Does `line` INVOKE a boundary? A helper's own `function …(` definition line matches the same
 * marker text, so it must be excluded — otherwise an unpaired charge site written next to
 * `runIterationBoundary`'s definition is "paired" with the definition itself.
 *
 * Comments are excluded for the same reason, and the realistic case is specific: an author adding a
 * container that deliberately skips the boundary will very plausibly write "we do not call
 * `runIterationBoundary(` here because…" beside the charge, and that prose would otherwise pair the
 * site. A marker inside a comment is a mention, never a call.
 */
function invokesBoundary(line) {
  if (/^\s*(export\s+)?function\s/.test(line)) return false;
  if (/^\s*(\/\*|\*)/.test(line)) return false;
  // Drop a line comment wherever it starts, not just at the start of the line: a marker after `//`
  // is a MENTION, never a call, and a TRAILING `// runIterationBoundary(` pairs a site just as
  // falsely as a full-line one. Excluding only full-line comments was the narrower instrument.
  const code = line.split("//")[0];
  return BOUNDARY_MARKERS.some((marker) => code.includes(marker));
}

function hasBoundaryNear(lines, lineNumber, excluded) {
  const from = Math.max(1, lineNumber - WINDOW);
  const to = Math.min(lines.length, lineNumber + WINDOW);
  for (let n = from; n <= to; n += 1) {
    if (excluded.has(n)) continue;
    if (invokesBoundary(lines[n - 1])) return true;
  }
  return false;
}

/**
 * Every charge site in `lines` that has no boundary beside it, as `"<label><line>: <text>"`.
 * The label is applied HERE rather than by the caller so that the formatting runs on the synthetic
 * failing cases below: a `.map` at the call site would never execute against the real sources,
 * where the list is always empty, and would sit uncovered.
 */
function unpairedChargeSites(lines, label = "") {
  const excluded = helperBodyLines(lines);
  return chargeSites(lines)
    .filter((lineNumber) => !hasBoundaryNear(lines, lineNumber, excluded))
    .map(
      (lineNumber) => `${label}${lineNumber}: ${lines[lineNumber - 1].trim()}`,
    );
}

// The detector, exercised on synthetic source before it is trusted on the real files. Each case is
// one of the mutations that must fail — written as a permanent test rather than left in a
// throwaway script, because a detector nobody has seen reject anything is not evidence.
const PAIRED = [
  "      for (const item of items) {",
  "        const limitDiagnostic = checkExecutionLimits(environment, span);",
  "        if (limitDiagnostic) {",
  "          return halt(limitDiagnostic);",
  "        }",
  "        const iterationBoundary = runIterationBoundary(body, environment);",
  "        if (iterationBoundary) {",
  "          return iterationBoundary;",
  "        }",
  "      }",
];

test("the detector accepts a charge site that IS paired", () => {
  assert.deepEqual(unpairedChargeSites(PAIRED), []);
});

test("the detector rejects a charge site whose boundary was removed", () => {
  const withoutBoundary = PAIRED.filter(
    (line) =>
      !line.includes("runIterationBoundary(") &&
      !line.includes("iterationBoundary"),
  );
  assert.equal(unpairedChargeSites(withoutBoundary).length, 1);
});

test("the detector rejects a charge site paired only by a helper's own body", () => {
  // The trap that made the first version of this test useless: an unpaired charge site written
  // beside `runIterationBoundary`'s DEFINITION found the boundary inside that definition and passed.
  const besideTheHelper = [
    "function unpairedProbe(environment, span) {",
    "  const limitDiagnostic = checkExecutionLimits(environment, span);",
    "  if (limitDiagnostic) {",
    "    return halt(limitDiagnostic);",
    "  }",
    "  return undefined;",
    "}",
    "",
    "function runIterationBoundary(body, environment) {",
    "  return body.length === 0 ? environment.mainLineBoundary.fn?.() : undefined;",
    "}",
  ];
  assert.equal(unpairedChargeSites(besideTheHelper).length, 1);
});

test("the detector rejects a charge site paired only by a COMMENT", () => {
  // Reviewer finding, round 8. A marker inside a comment is a MENTION, never a call — and the
  // realistic case is specific: an author adding a container that deliberately skips the boundary
  // writes the reason beside the charge, in exactly the words the detector was scanning for.
  // All three comment forms are exercised, because each is a separate guard.
  const pairedOnlyByProse = [
    "for (const id of ids) {",
    "  const limitDiagnostic = checkExecutionLimits(environment, span);",
    "  if (limitDiagnostic) {",
    "    return halt(limitDiagnostic);",
    "  }",
    "  // We deliberately do not call runIterationBoundary( here, because this container",
    "  // never runs a body of its own.",
    "  /* runIterationBoundary( is also not called from the block form. */",
    "  /**",
    "   * ...nor from a JSDoc line naming mainLineBoundary.fn.",
    "   */",
    "}",
  ];
  assert.equal(unpairedChargeSites(pairedOnlyByProse).length, 1);
});

test("the detector rejects a charge site paired only by a TRAILING comment", () => {
  // Round 9: excluding only full-line comments was itself the narrower instrument. A marker after
  // `//` is a mention wherever on the line it sits.
  const pairedOnlyByTrailingProse = [
    "for (const id of ids) {",
    "  const limitDiagnostic = checkExecutionLimits(environment, span); // runIterationBoundary( is",
    "  if (limitDiagnostic) {",
    "    return halt(limitDiagnostic);",
    "  }",
    "}",
  ];
  assert.equal(unpairedChargeSites(pairedOnlyByTrailingProse).length, 1);
});

// The `wait` tick site (issue #953) is the fourth boundary marker, so it gets the same
// accept-then-reject pair every other marker has. Without the rejection half, adding a marker to
// `BOUNDARY_MARKERS` could pair a site with a string nothing ever calls and this file would not
// notice — a marker nobody has seen reject anything is not evidence.
const WAIT_TICK_SHAPE = [
  "  const chargeTick = () => {",
  "    const diagnostic = checkExecutionLimits(environment, waitCall.source_span);",
  "    if (diagnostic === undefined) {",
  "      return false;",
  "    }",
  "    interruption = halt(diagnostic);",
  "    return true;",
  "  };",
  "  const dispatchTick = (tick) => {",
  "    const signal = dispatchDueHandlers(tick, environment, waitCall.source_span);",
  "    return signal.kind !== 'normal';",
  "  };",
];

test("the detector accepts a wait-tick charge paired by its end-of-tick drain", () => {
  assert.deepEqual(unpairedChargeSites(WAIT_TICK_SHAPE), []);
});

test("the detector rejects a wait-tick charge whose end-of-tick drain was removed", () => {
  const withoutDrain = WAIT_TICK_SHAPE.filter(
    (line) => !line.includes("dispatchDueHandlers("),
  );
  assert.equal(unpairedChargeSites(withoutDrain).length, 1);
});

test("the detector ignores the definition of checkExecutionLimits itself", () => {
  assert.deepEqual(
    unpairedChargeSites([
      "export function checkExecutionLimits(environment, span) {",
      "  return undefined;",
      "}",
    ]),
    [],
  );
});

test("every execution-budget charge site is paired with a main-line boundary", () => {
  const unpaired = [];
  let total = 0;
  for (const name of SOURCES) {
    const lines = read(name);
    total += chargeSites(lines).length;
    unpaired.push(...unpairedChargeSites(lines, `${name}:`));
  }
  // A charge site with no boundary beside it is a container that can strand a queued `every`
  // occurrence — the defect this slice fixed six times. If this fails on a site you just added,
  // the fix is to offer the boundary there, not to widen the window.
  assert.deepEqual(
    unpaired,
    [],
    `unpaired execution-budget charge site(s):\n  ${unpaired.join("\n  ")}`,
  );
  // Guard the guard: if the charge sites stop being found at all, the assertion above passes
  // vacuously and this test silently stops protecting anything. The bound is the CURRENT derived
  // total, not a loose floor — a loose floor would not notice three sites disappearing. Raise it
  // when a charge site is legitimately added; never lower it to make a deletion pass. Raised from
  // 10 to 11 by issue #953, which made a `wait` tick a charged instruction (`executeWaitCall`'s
  // `chargeTick`, paired with the `dispatchDueHandlers` drain on the same tick).
  assert.equal(
    total,
    11,
    `expected the 11 derived charge sites across ${SOURCES.join(", ")}, found ${total}`,
  );
});

test("the empty-body asymmetry is a NAMED exception, not a gap in the pairing", () => {
  // `runIterationBoundary` fires only for an empty body, because a non-empty one already has a
  // boundary per statement and firing per iteration would drain twice for one unit of progress.
  // That asymmetry is deliberate and load-bearing (`forever [ ]` had NO boundary before it existed:
  // three handler firings against eleven for `forever [ print 0 ]`), so it is pinned here rather
  // than left to weaken the pairing assertion above.
  const source = read("execute-internal.ts").join("\n");
  assert.match(
    source,
    /function runIterationBoundary\([\s\S]*?body\.length === 0[\s\S]*?mainLineBoundary\.fn/,
    "runIterationBoundary must gate on an empty body and offer the shared boundary",
  );
});

test("handler bodies suppress the boundary, and restore it on every exit path", () => {
  // A handler body is not the main line: a boundary inside one would let a drained occurrence
  // re-enter its own handler. The restore must be in a `finally` so a handler that halts the run
  // cannot leave the main line permanently boundary-less.
  const source = read("execute-internal.ts").join("\n");
  assert.match(
    source,
    /function executeHandlerBody\([\s\S]*?mainLineBoundary\.fn = undefined;[\s\S]*?finally\s*\{[\s\S]*?mainLineBoundary\.fn = suppressed;/,
    "executeHandlerBody must clear the boundary and restore it in a finally",
  );
});
