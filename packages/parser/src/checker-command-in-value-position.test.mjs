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

import { analyze, parse } from "@openlogo/parser";

const PROFILES = ["core-language", "turtle-rendering", "data"];

/**
 * The `kind` of the nearest AST node enclosing the call to `callee` in `source`.
 *
 * A label in a table is prose, and prose is what this slice distrusts. Two rows here claimed to
 * exercise `ComparisonChain` and `IsPredicate` operands and measured **neither**: `forward` binds
 * the whole following expression, so `if forward 1 == 2 [ … ]` parses as `if (forward (1 == 2))`
 * and the diagnostic comes from the `If` arm the row above already covers. Every assertion passed
 * honestly — one `ol-no-output`, at `semantic`, naming `forward`, no parse noise, no events — which
 * is exactly why nothing caught it, and why excluding those two kinds from the rule left the whole
 * Definition of Done green.
 *
 * So each row now asserts the shape it claims to construct. A row can no longer lie about itself.
 */
function nearestEnclosingKind(source, callee) {
  const { ast, diagnostics } = parse(source, "value-position.logo");
  assert.deepEqual(
    diagnostics,
    [],
    `${source}: must parse cleanly, or the case measures error recovery`,
  );
  const enclosing = [];
  const visit = (node, parent) => {
    if (node === null || typeof node !== "object") {
      return;
    }
    if (
      (node.kind === "Call" || node.kind === "ParenCall") &&
      node.callee?.name === callee
    ) {
      // Every row nests the call, so a missing parent is a broken row rather than a top-level
      // case: it fails the comparison below with "undefined" instead of being papered over.
      enclosing.push(parent?.kind);
    }
    const nextParent = node.kind === undefined ? parent : node;
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) {
        for (const item of value) {
          visit(item, nextParent);
        }
      } else {
        visit(value, nextParent);
      }
    }
  };
  visit(ast, null);
  // Exactly ONE call, so a row naming a kind cannot be answered by a different call to the same
  // name. Taking the last match would fail *safe* — a second call is necessarily in statement
  // position, a kind no row claims — but it would fail saying "Program !== IsPredicate" rather
  // than saying what is actually wrong.
  assert.equal(
    enclosing.length,
    1,
    `${source}: expected exactly one call to ${callee}, found ${enclosing.length}`,
  );
  return enclosing[0];
}

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
  // One row per AST nesting, each asserting the shape it claims to construct — see
  // `nearestEnclosingKind`. `Call`/`ParenCall`/`Repeat`/`If`/`While` were already covered
  // elsewhere; the rest had no deliberate test, and a mutation narrowing the rule to the covered
  // ones left 5,105 tests and 1,004 fixtures green.
  for (const [enclosing, source] of [
    ["Call", "print forward 1"],
    ["ParenCall", ":x = (count forward 1)"],
    ["Assign", ":x = forward 1"],
    ["Repeat", "repeat forward 1 [ print 1 ]"],
    ["If", "if forward 1 [ print 1 ]"],
    ["While", "while forward 1 [ print 1 ]"],
    ["ListLit", ":x = [ 1 forward 1 ]"],
    ["Throw", "throw forward 1"],
    ["Comprehension", ":x = map n in forward 1 [ :n ]"],
    ["ComparisonChain", ":x = 1 < (forward 1) < 3"],
    ["ForRange", "for i from 1 to forward 1 [ print 1 ]"],
    ["ForIn", "for i in forward 1 [ print 1 ]"],
    ["IsPredicate", ":x = (forward 1) is empty"],
    ["DictLit", ":x = {a: forward 1}"],
    ["PostfixExpression", ":x = (forward 1)[1]"],
  ]) {
    assert.equal(
      nearestEnclosingKind(source, "forward"),
      enclosing,
      `${source}: this row claims to nest the command in ${enclosing}`,
    );
    // Pinned rather than filtered: a case that only reports through parse recovery would otherwise
    // be tolerated, which is how three earlier drafts of these rows measured nothing.
    assert.deepEqual(
      codes(source),
      ["ol-no-output"],
      `${enclosing}: exactly one finding, and nothing else`,
    );
    const finding = onlyNoOutput(source);
    assert.deepEqual(
      finding.params,
      { procedure: "forward" },
      `${enclosing}: names the command that produced no value`,
    );
    assert.equal(
      finding.stage,
      "semantic",
      `${enclosing}: the rule is static, so it must be decidable before the program runs`,
    );
  }
});

test("a Program, a Block, and an assignment TARGET are not value positions", () => {
  // The THREE exclusions the rule is written around. A command standing alone as a statement, or as
  // a statement of a control body, is correct OpenLogo and must be silent — if these reported, the
  // rule would fire on every program ever written.
  assert.deepEqual(codes("forward 1"), []);
  assert.deepEqual(codes("repeat 3 [ forward 1 ]"), []);
  assert.deepEqual(codes("if true [ forward 1 ]"), []);
  assert.deepEqual(codes("define f\n  forward 1\nend\nf"), []);

  // The third exclusion, and the only one nothing observed until a QA review measured it. An
  // assignment TARGET is not a value position — nothing reads a value out of it — so a command
  // there is `ol-not-a-place`, not `ol-no-output`. Flipping that one token to `true` produced two
  // findings for one fault, with the wrong one first, while 5,105 tests and 1,004 fixtures stayed
  // green. It is mechanism 4's promise ("one fault, one diagnostic, the right one first")
  // implemented inside mechanism 2's checker, and it was the only one of the four with no
  // assertion at all.
  //
  // The comment this test replaces said "the two exclusions". A derived count, wrong, omitting the
  // non-obvious member — the ungated-prose failure this slice spent itself removing from fixture
  // descriptions, reproduced in the test written to name the rule.
  assert.deepEqual(codes("forward 5 = 1"), ["ol-not-a-place"]);
  assert.deepEqual(codes("(forward 5) = 1"), ["ol-not-a-place"]);

  // The instrument control: `codes` must be able to return a non-empty list, or the assertions
  // above are satisfied by a helper that reports nothing whatever it is given.
  assert.deepEqual(codes("print forward 1"), ["ol-no-output"]);
});

test("an inactive-profile alias is NOT classified here — one fault, one diagnostic", () => {
  // `fd` is a Heritage alias. Under a run that does not claim Heritage the name does not resolve,
  // so `ol-unknown-command` is the whole answer. The rule therefore gates on the name the learner
  // WROTE, not the canonical spelling the reader records.
  //
  // The reader stores `canonical: "forward"` unconditionally — `parse()` takes no profiles — so
  // classifying the canonical name instead produces `ol-unknown-command` AND `ol-no-output`, the
  // second naming a spelling the learner never wrote, under a run that cannot resolve the alias.
  // Two answers to one question. That mutation leaves 5,105 tests and 1,004 fixtures green.
  assert.deepEqual(codes("print fd 5"), ["ol-unknown-command"]);

  // And with Heritage claimed the alias resolves, so the rule fires — reporting the CANONICAL
  // spelling, as `spec/error-model.md:114` requires of the `procedure` param.
  const withHeritage = analyze("print fd 5", "value-position.logo", {
    profiles: [...PROFILES, "heritage"],
  }).diagnostics;
  assert.deepEqual(
    withHeritage.map((finding) => finding.code),
    ["ol-no-output"],
  );
  assert.deepEqual(withHeritage[0]?.params, { procedure: "forward" });
});

test("the reported procedure is case-folded to its canonical spelling", () => {
  // OpenLogo names are case-insensitive — `FORWARD 100` is a clean program — and
  // `spec/error-model.md:114` requires `procedure` to carry the built-in's canonical spelling.
  // Dropping the fold reports `procedure: "FORWARD"`, which contradicts the spec and splits one
  // fault's identity across two spellings of the same call. That mutation leaves the DoD green.
  const finding = onlyNoOutput("print FORWARD 5");
  assert.deepEqual(finding.params, { procedure: "forward" });
});

test("a reporter in the same positions is silent", () => {
  // The control that makes the cases above mean something: the rule must key on the callee being a
  // Command, not on the position being nested. It mirrors the positive table row for row — a
  // review noted it covered 6 of 15 and had dropped its only `If` row when it gained shape
  // assertions, and a table-driven control that covers less than the thing it controls is a
  // weaker control than it appears.
  //
  // Shape-asserted for the same reason the positive table is: `if count [1 2] == 3 [ … ]` nests
  // the call in `If`, not `ComparisonChain`, by the same greedy argument binding that made two
  // positive rows measure the wrong thing.
  for (const [enclosing, source] of [
    ["Call", "print count [1 2]"],
    ["ParenCall", ":x = (word count [1 2])"],
    ["Assign", ":x = count [1 2]"],
    ["Repeat", "repeat count [1 2] [ print 1 ]"],
    ["If", "if count [1 2] [ print 1 ]"],
    ["While", "while count [1 2] [ print 1 ]"],
    ["ListLit", ":x = [ 1 count [1 2] ]"],
    ["Throw", "throw count [1 2]"],
    ["Comprehension", ":x = map n in count [1 2] [ :n ]"],
    ["ComparisonChain", ":x = 1 < (count [1 2]) < 3"],
    ["ForRange", "for i from 1 to count [1 2] [ print 1 ]"],
    ["ForIn", "for i in count [1 2] [ print 1 ]"],
    ["IsPredicate", ":x = (count [1 2]) is empty"],
    ["DictLit", ":x = {a: count [1 2]}"],
    ["PostfixExpression", ":x = (count [1 2])[1]"],
  ]) {
    assert.equal(
      nearestEnclosingKind(source, "count"),
      enclosing,
      `${source}: this row claims to nest the reporter in ${enclosing}`,
    );
    assert.deepEqual(codes(source), [], `${enclosing}: a reporter is silent`);
  }
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
  // would reasonably think it a gap. The runtime half IS measured, so this is a boundary rather
  // than a hole: see `tests/conformance/core-language/execution/procedure-no-output-as-value`
  // and `packages/runtime/src/undefined-var-case-identity.test.mjs`.
  assert.deepEqual(codes("define f\n  forward 1\nend\nprint f"), []);
});
