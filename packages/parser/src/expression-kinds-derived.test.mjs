// The `ExpressionNode` classification is DERIVED, not enumerated — and every consumer reads the
// same derivation.
//
// Issue #815's round-11 review found six hand-written copies of "which node kinds are expressions",
// written at four different times, and no two of them agreed:
//
//   * `one-fault.ts`'s precedence rule named five kinds this AST has never had (`Arithmetic`,
//     `Comparison`, `Logical`, `Not`, `Negate`) and omitted three it does, so `fowad [1][1]`,
//     `fowad 1 < 2 < 3` and `fowad [] is empty` each kept an `ol-bad-token` for a token that IS a
//     valid argument — the second diagnostic the precedence rule exists to suppress.
//   * `evaluate.ts`'s `asExpressionStatement` omitted four, so a leading `[10][1]` in a
//     comprehension body halted with `ol-not-implemented` naming a form the evaluator runs fine.
//   * `checker-control-flow.ts`'s `VALUE_PRODUCING_KINDS` omitted the two Data-profile expression
//     forms, so `map i in :xs [ {a: 1} ]` was told `ol-no-value` about a dict literal.
//
// The last one is the reason this is a defect rather than a tidiness complaint. It was harmless
// while `ol-no-value` was advisory; the severity gate this slice puts in front of `execute()` turns
// the same wrong finding into a REFUSAL TO RUN. An omission from an old list became a blocking
// defect the moment something started acting on it.
//
// `EXPRESSION_NODE_KINDS` is exhaustiveness-checked against the `ExpressionNode` union in both
// directions at COMPILE time (`ast.ts`), which is the only closure that survives a year of edits —
// so the tests here check the two things a type cannot: that the derivation matches what the parser
// actually builds, and that each consumer really reads it.

import assert from "node:assert/strict";
import test from "node:test";

import {
  analyze,
  EXPRESSION_NODE_KINDS,
  isExpressionKind,
  parse,
  walk,
} from "@openlogo/parser";

const PROFILES = ["core-language", "turtle-rendering", "data", "heritage"];

/** One source line per `ExpressionNode` kind, used to prove the set matches the real parser
 * output rather than a second opinion about the grammar. */
const SOURCE_FOR_KIND = {
  NumberLit: "print 1",
  WordLit: 'print "red"',
  BooleanLit: "print true",
  ListLit: "print [1 2]",
  DictLit: "print {a: 1}",
  ValueOfKey: ":ages = {tom: 1}" + "\n" + 'print value of :ages for key "tom"',
  VarRef: ":x = 1\nprint :x",
  Place: ":d = {a: 1}\n:d.a = 2",
  PostfixExpression: "print [1 2][1]",
  Call: "print 1",
  ParenCall: "print (sum 1 2)",
  ComparisonChain: "print 1 < 2 < 3",
  IsPredicate: "print [] is empty",
  Comprehension: "print map i in [1 2] [ :i ]",
};

test("every declared expression kind is one the parser actually builds", () => {
  for (const kind of EXPRESSION_NODE_KINDS) {
    const source = SOURCE_FOR_KIND[kind];
    assert.ok(source, `no source sample declared for expression kind ${kind}`);
    const { ast, diagnostics } = parse(source, "d.logo");
    assert.deepEqual(diagnostics, [], `sample for ${kind} must parse cleanly`);
    let found = false;
    walk(ast, (node) => {
      if (node.kind === kind) {
        found = true;
      }
    });
    assert.ok(found, `sample for ${kind} did not produce a ${kind} node`);
  }
});

test("isExpressionKind agrees with the declared set and rejects statement-only kinds", () => {
  for (const kind of EXPRESSION_NODE_KINDS) {
    assert.equal(
      isExpressionKind(kind),
      true,
      `${kind} must be an expression kind`,
    );
  }
  for (const kind of [
    "If",
    "While",
    "Repeat",
    "Forever",
    "ForIn",
    "ForRange",
    "Assign",
    "Local",
    "Block",
    "ProcedureDef",
    "StructDef",
    "Return",
    "Stop",
    "Program",
    "NotAKindAtAll",
  ]) {
    assert.equal(
      isExpressionKind(kind),
      false,
      `${kind} is statement-only and must not be classified as an expression`,
    );
  }
});

/** The codes `analyze` reports for `source` under the standard profile set. */
function codesFor(source) {
  return analyze(source, "d.logo", { profiles: PROFILES }).diagnostics.map(
    (d) => d.code,
  );
}

test("precedence suppresses every argument-shaped token, not a remembered subset", () => {
  // Each of these was reported as `ol-unknown-command` PLUS a spurious `ol-bad-token` before the
  // precedence rule read the derived set.
  for (const source of [
    "fowad [1][1]",
    "fowad 1 < 2 < 3",
    "fowad [] is empty",
    "fowad {a: 1}",
    "fowad map i in [1] [ :i ]",
  ]) {
    assert.deepEqual(
      codesFor(source),
      ["ol-unknown-command"],
      `${source} must report only the unresolvable callee`,
    );
  }
});

test("the suppression stays bounded in both directions", () => {
  // This file's concern is the DERIVED expression classification, so what it asserts here is that
  // `couldBeAnArgument` reads that derivation: a statement-only form could never have been an
  // argument whatever the callee turned out to be, so its token is an independent fault.
  //
  // The four bounds on the suppression itself — position, trailing, same-line, code — live in
  // `one-fault-suppression-bounds.test.mjs`, named for the rule rather than for this mechanism.
  assert.deepEqual(codesFor("fowad if 1 [ ]"), [
    "ol-bad-token",
    "ol-unknown-command",
  ]);
  assert.deepEqual(codesFor("fowad :x = 1"), [
    "ol-bad-token",
    "ol-unknown-command",
  ]);
  assert.deepEqual(codesFor("forward 100 200"), ["ol-bad-token"]);
});

test("producesValue accepts the Data-profile expression forms", () => {
  // `{a: 1}` and `:d.a` produce values; the enumeration this replaced omitted both, and the
  // severity gate would have refused to run either program.
  assert.deepEqual(codesFor("print map i in [1] [ {a: :i} ]"), []);
  assert.deepEqual(codesFor(":d = {a: 5}\nprint map i in [1] [ :d.a ]"), []);
  assert.deepEqual(codesFor("print map i in [1] [ [10 20][1] ]"), []);
  assert.deepEqual(codesFor("print map i in [1] [ [] is empty ]"), []);
});

test("a body whose last statement really produces no value still reports ol-no-value", () => {
  // The derivation widens what counts as an expression; it must not turn `ol-no-value` off.
  assert.deepEqual(codesFor("print map i in [1] [ forward 1 ]"), [
    "ol-no-value",
  ]);
});

test("the exported kind list is frozen, so it cannot drift from the predicate", () => {
  // `as const` is erased at run time. Without `Object.freeze` a JavaScript consumer of the
  // published package could push onto this array, while `isExpressionKind` answers from a `Set`
  // built once at module load — two exports disagreeing about one question, both looking
  // authoritative. An export is a contract that outlives the slice.
  assert.equal(Object.isFrozen(EXPRESSION_NODE_KINDS), true);
  assert.throws(() => {
    EXPRESSION_NODE_KINDS.push("NotAKind");
  });
  assert.equal(isExpressionKind("NotAKind"), false);
});
