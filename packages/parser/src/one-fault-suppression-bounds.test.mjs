// The FOUR bounds on the precedence rule's suppression (`one-fault.ts`).
//
// `spec/execution-model.md:768-777` lets a token be spared exactly when its *only* fault is
// following a callee nothing resolves. Every word of that is a bound, and each is a separate
// mechanism that can be wrong on its own:
//
//   1. POSITION — a token that could never have been an argument keeps its own diagnostic.
//   2. TRAILING — the call must finish where the STATEMENT finishes, not merely somewhere.
//   3. SAME LINE — orphanhood propagates along a line and stops at the line boundary.
//   4. CODE     — only `ol-bad-token` may be suppressed at an orphan position.
//
// They are collected here because a reader auditing the precedence rule should find all four in
// one place, and **each label is red for its own mechanism** — a review measured an earlier draft
// where `BOUND 3` failed for the same-line check rather than the propagation it named, and
// `BOUND 1` only when suppression was disabled wholesale. A label that is red for a neighbouring
// mechanism is the table-row problem again: it reports a pass about something it did not test.
//
// **The fourth is the one worth reading about.** `one-fault.ts` argues at length that a *missing*
// entry in `couldBeAnArgument` only over-reports while a *wrong* entry suppresses a real diagnostic
// silently — correct, and load-bearing, and about the line twelve rows above the code filter that
// has the identical direction. Making the filter suppress EVERY code at an orphan position left
// 5,110 tests and 1,004 conformance fixtures green while four independent real faults vanished: a
// second unknown command, an arity error, an undefined variable. Argument about one token is not
// evidence about the one beside it.
//
// Every bound below asserts the SPAN as well as the code. A row asserting only that two codes
// appear could pass because the position was never an orphan at all — the same lesson as asserting
// the AST shape a row claims to construct, transposed onto positions.

import assert from "node:assert/strict";
import test from "node:test";

import { analyze } from "@openlogo/parser";

const PROFILES = ["core-language", "turtle-rendering", "data"];

/** Every finding for `source`, rendered as `code@line:column`, in order. */
function findings(source) {
  return analyze(source, "one-fault.logo", {
    profiles: PROFILES,
  }).diagnostics.map(
    (diagnostic) =>
      `${diagnostic.code}@${diagnostic.source_span.start.join(":")}`,
  );
}

test("BOUND 4 (code): only ol-bad-token may be suppressed at an orphan position", () => {
  // Each of these has a genuine second fault at column 9 or 11 — the orphan position — that is NOT
  // an `ol-bad-token`, and each must survive. Asserting the span is what makes the row mean
  // something: without it, a case could pass because column 9 was never an orphan.
  assert.deepEqual(findings("fowad 1 bar 2"), [
    "ol-unknown-command@1:1",
    "ol-unknown-command@1:9",
  ]);
  assert.deepEqual(findings("fowad 1 print"), [
    "ol-unknown-command@1:1",
    "ol-not-enough-inputs@1:9",
  ]);
  assert.deepEqual(findings("fowad 1 :x[9]"), [
    "ol-unknown-command@1:1",
    "ol-undefined-var@1:9",
  ]);
  assert.deepEqual(findings("fowad 1 2 bar 3"), [
    "ol-unknown-command@1:1",
    "ol-unknown-command@1:11",
  ]);
});

test("BOUND 4, positive half: an ol-bad-token at an orphan position IS suppressed", () => {
  // The control that keeps the four rows above from being satisfied by a rule that suppresses
  // nothing at all. `fowad 100` earns its `ol-bad-token` on `100` and loses it.
  assert.deepEqual(findings("fowad 100"), ["ol-unknown-command@1:1"]);
  // And the callee resolving is what makes the token independent again.
  assert.deepEqual(findings("forward 100 200"), ["ol-bad-token@1:13"]);
});

test("BOUND 2 (trailing): the call must finish where the STATEMENT finishes", () => {
  // Comparing a call's end to itself rather than to the statement's suppresses the `7` in
  // `[ fowad 1 ] 7`, where `fowad` merely occurs INSIDE a completed list literal and the `7` is an
  // independent fault. That mutation leaves the whole Definition of Done green.
  assert.deepEqual(findings("[ fowad 1 ] 7"), [
    "ol-bad-token@1:13",
    "ol-unknown-command@1:3",
  ]);
});

test("BOUND 1 (position): a token that could never be an argument keeps its diagnostic", () => {
  // `spec/execution-model.md:771-773`. A bracket that closes nothing follows the unresolvable
  // callee but could not have been an argument whatever the callee turned out to be.
  assert.deepEqual(findings("fowad 100 ]"), [
    "ol-unmatched-bracket@1:11",
    "ol-unknown-command@1:1",
  ]);
  // And a statement-only FORM likewise — this is the row that exercises `couldBeAnArgument`, the
  // predicate this bound is actually about. Without it the label was red only when suppression was
  // disabled wholesale, which is a different mechanism.
  assert.deepEqual(findings("fowad if 1 [ ]"), [
    "ol-bad-token@1:7",
    "ol-unknown-command@1:1",
  ]);
});

test("BOUND 3 (same line): orphanhood propagates along a line and stops at its end", () => {
  // The propagation is real and load-bearing: in `fowad 100 200` the `200` is suppressed ONLY
  // because the `100` before it was orphaned, so `previousWasOrphan` carries it along. An earlier
  // draft of this file described the mechanism backwards — as one orphan NOT reaching the next
  // token — and asserted the line boundary while calling it chaining.
  assert.deepEqual(findings("fowad 100 200"), ["ol-unknown-command@1:1"]);
  // Where it stops: each statement is judged on its own callee.
  assert.deepEqual(findings("fowad 1\nfowad 2"), [
    "ol-unknown-command@1:1",
    "ol-unknown-command@2:1",
  ]);
  // And a RESOLVING callee on the second line keeps its own extra-argument fault. Parse-stage
  // findings precede semantic ones in the merged list, as `fowad 100 ]` above also shows.
  assert.deepEqual(findings("fowad 1\nforward 100 200"), [
    "ol-bad-token@2:13",
    "ol-unknown-command@1:1",
  ]);
});

test("BOUND 1, parenthesized: a delimited call's arity is known, so a later token is independent", () => {
  // `(fowad 100) 5` keeps its `ol-bad-token`. The suppression's rationale
  // (`spec/execution-model.md:759-766`) is that a token after an unresolvable callee MIGHT have been
  // its argument, which cannot be judged because the arity is unknown. Parentheses delimit the
  // arguments, so that doubt does not arise — and the control shows the token's independence has
  // nothing to do with whether the callee resolves.
  assert.deepEqual(findings("(fowad 100) 5"), [
    "ol-bad-token@1:13",
    "ol-unknown-command@1:2",
  ]);
  assert.deepEqual(findings("(forward 100) 5"), ["ol-bad-token@1:15"]);
});
