// Direct unit tests for the command-in-value-position rule (`ol-no-output`, issue #716, absorbed
// by #815).
//
// This file exists because a QA review found the rule had **no test that names it**: it reached
// 100% coverage entirely through runtime and conformance paths, and the one line encoding its
// central design — "every position that is not a `Program` or a `Block` is a value position" —
// could be narrowed to the six forms that happened to be tested while the whole Definition of Done
// stayed green. Coverage counts execution, not consequence.
//
// The rule is deliberately written by EXCLUSION rather than as a list of nesting forms, for the
// same reason the terminal rule is: a forgotten entry in an allow-list here means a command in a
// value position is silently accepted, and silence is the failure this slice exists to remove.
// These tests therefore enumerate the nesting forms *the grammar admits* rather than the ones the
// implementation happens to visit.

import assert from "node:assert/strict";
import test from "node:test";

import { analyze } from "@openlogo/parser";

const PROFILES = ["core-language", "turtle-rendering", "data"];

/** The codes `analyze` reports for `source`, in order. */
function codes(source) {
  return analyze(source, "value-position.logo", {
    profiles: PROFILES,
  }).diagnostics.map((diagnostic) => diagnostic.code);
}

/** The single `ol-no-output` `source` reports, asserting there is exactly one. */
function onlyNoOutput(source) {
  const findings = analyze(source, "value-position.logo", {
    profiles: PROFILES,
  }).diagnostics.filter((finding) => finding.code === "ol-no-output");
  assert.equal(
    findings.length,
    1,
    `expected exactly one ol-no-output from ${JSON.stringify(source)}, got ${findings.length}`,
  );
  return findings[0];
}

test("a command is reported in every nesting the grammar admits as a value position", () => {
  // One case per nesting form. `Call`/`ParenCall`/`Repeat`/`If`/`While` were already covered
  // elsewhere; the remaining seven had no deliberate test, and a mutation narrowing the rule to the
  // covered ones left 5,099 tests and 1,004 fixtures green.
  for (const [form, source] of [
    ["call argument", "print forward 1"],
    ["parenthesized call argument", ":x = (count forward 1)"],
    ["assignment value", ":x = forward 1"],
    ["repeat count", "repeat forward 1 [ print 1 ]"],
    ["if condition", "if forward 1 [ print 1 ]"],
    ["while condition", "while forward 1 [ print 1 ]"],
    ["list literal element", ":x = [ 1 forward 1 ]"],
    ["throw operand", "throw forward 1"],
    ["comprehension source", ":x = map n in forward 1 [ :n ]"],
    ["comparison operand", "if forward 1 == 2 [ print 1 ]"],
    ["for-range bound", "for i from 1 to forward 1 [ print 1 ]"],
    ["for-in sequence", "for i in forward 1 [ print 1 ]"],
    ["is-predicate operand", "if forward 1 is empty [ print 1 ]"],
    ["dict literal value", ":x = {a: forward 1}"],
    ["postfix base", ":x = (forward 1)[1]"],
  ]) {
    const finding = onlyNoOutput(source);
    assert.deepEqual(
      finding.params,
      { procedure: "forward" },
      `${form}: names the command that produced no value`,
    );
    assert.equal(
      finding.stage,
      "semantic",
      `${form}: the rule is static, so it must be decidable before the program runs`,
    );
  }
});

test("a Program and a Block are NOT value positions", () => {
  // The two exclusions the rule is written around. A command standing alone as a statement, or as a
  // statement of a control body, is correct OpenLogo and must be silent — if these reported, the
  // rule would fire on every program ever written.
  assert.deepEqual(codes("forward 1"), []);
  assert.deepEqual(codes("repeat 3 [ forward 1 ]"), []);
  assert.deepEqual(codes("if true [ forward 1 ]"), []);
  assert.deepEqual(codes("define f\n  forward 1\nend\nf"), []);

  // The instrument control: `codes` must be able to return a non-empty list, or the four
  // assertions above are satisfied by a helper that reports nothing whatever it is given.
  assert.deepEqual(codes("print forward 1"), ["ol-no-output"]);
});

test("a reporter in the same positions is silent", () => {
  // The control that makes the cases above mean something: the rule must key on the callee being a
  // Command, not on the position being nested.
  assert.deepEqual(codes("print count [1 2]"), []);
  assert.deepEqual(codes(":x = [ 1 count [1 2] ]"), []);
  assert.deepEqual(codes("throw count [1 2]"), []);
  assert.deepEqual(codes("if count [1 2] == 3 [ print 1 ]"), []);
});

test("a user procedure with no return is reported at RUNTIME, and that is correct", () => {
  // `spec/error-model.md`'s row covers "a command, built-in or user procedure" — the uniformity
  // #716 asked for. But the two halves are decided at different stages, and deliberately so:
  // whether a *user* procedure returns a value is not statically knowable, and `spec/tooling.md:
  // 199-200` forbids a checker reporting a speculative type error when dynamic values are unknown.
  // So the static rule stays silent and the runtime raises the same code.
  //
  // Asserted here rather than assumed, because "uniform across forms" could otherwise be read as
  // "uniform across stages", and a future reader finding this case absent from the static rule
  // would reasonably think it a gap.
  assert.deepEqual(codes("define f\n  forward 1\nend\nprint f"), []);
});
