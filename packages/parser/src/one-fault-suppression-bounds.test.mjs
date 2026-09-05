// The FOUR bounds on the precedence rule's suppression (`one-fault.ts`).
//
// `spec/execution-model.md:768-777` lets a token be spared exactly when its *only* fault is
// following a callee nothing resolves. Every word of that is a bound, and each is a separate
// mechanism that can be wrong on its own:
//
//   1. POSITION — which spans count as orphaned by the unresolvable call.
//   2. TRAILING — the call must finish where the STATEMENT finishes, not merely somewhere.
//   3. CHAINING — one orphan's tokens do not make the next statement's tokens orphans.
//   4. CODE     — only `ol-bad-token` may be suppressed at an orphan position.
//
// They are collected here because a reader auditing the precedence rule should find all four in
// one place. Two of them previously lived in `expression-kinds-derived.test.mjs`, a file named for
// a different mechanism entirely, and the fourth lived nowhere at all.
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

test("BOUND 1 (position): a bracket that closes nothing is never an argument", () => {
  // `spec/execution-model.md:771-773`. The `]` follows the unresolvable callee but could not have
  // been an argument whatever the callee turned out to be, so it keeps its own diagnostic.
  assert.deepEqual(findings("fowad 100 ]"), [
    "ol-unmatched-bracket@1:11",
    "ol-unknown-command@1:1",
  ]);
});

test("BOUND 3 (chaining): one orphan does not orphan the next statement", () => {
  // Each statement is judged on its own callee. The second `fowad`'s token is suppressed because
  // the second callee is unresolvable, not because the first one was.
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
