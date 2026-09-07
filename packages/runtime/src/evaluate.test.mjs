// Unit tests for the expression evaluator — Core literals and arithmetic (`+ - * / mod` plus
// `abs sqrt int round power`) per spec/execution-model.md and spec/commands.md (issue #93).
// The since-deleted `isSupportedExpression` gate was extended for `:name` reads and index-only places by issue
// #94; see variables-places.test.mjs for the dedicated variable/place/assignment test suite.
// Most cases parse real source through @openlogo/parser and evaluate the resulting AST node,
// exercising evaluate() exactly as @openlogo/runtime's execute() does. A handful of cases hand-
// build a minimal AST node to exercise evaluator-internal invariants (an unimplemented node
// kind, an unimplemented callee, or a missing argument) that a real parse can never produce
// given the parser's grammar and fixed-arity table — these are safety nets, not user-reachable
// paths.

import assert from "node:assert/strict";
import { test } from "node:test";
import { makeSpan, OLDict, OLRecord } from "@openlogo/core";
import * as Parser from "@openlogo/parser";
import { createEnvironment, evaluate, execute } from "@openlogo/runtime";

const doc = "acceptance.logo";

/** Parse `print <expr>` and return the evaluated result of `<expr>`. */
function evalExpr(expr) {
  const { ast, diagnostics } = Parser.parse(`print ${expr}`, doc);
  assert.deepEqual(diagnostics, []);
  return evaluate(ast.body[0].args[0]);
}

/** Parse `print <expr>` and return the un-evaluated `<expr>` AST node. */
function parseExpr(expr) {
  const { ast, diagnostics } = Parser.parse(`print ${expr}`, doc);
  assert.deepEqual(diagnostics, []);
  return ast.body[0].args[0];
}

test("evaluates each Core literal to its runtime value", () => {
  assert.deepEqual(evalExpr("42"), { ok: true, value: 42 });
  assert.deepEqual(evalExpr("-7"), { ok: true, value: -7 });
  assert.deepEqual(evalExpr('"red"'), { ok: true, value: "red" });
  assert.deepEqual(evalExpr("true"), { ok: true, value: true });
  assert.deepEqual(evalExpr("false"), { ok: true, value: false });
  assert.deepEqual(evalExpr("[1 2 3]"), { ok: true, value: [1, 2, 3] });
  assert.deepEqual(evalExpr("[]"), { ok: true, value: [] });
});

test("propagates a failing element out of a list literal", () => {
  const result = evalExpr("[1 1 / 0]");
  assert.equal(result.ok, false);
  assert.equal(result.diagnostic.code, "ol-div-zero");
});

test("adds, subtracts, multiplies, and left-associates", () => {
  assert.deepEqual(evalExpr("2 + 3"), { ok: true, value: 5 });
  assert.deepEqual(evalExpr("10 - 4"), { ok: true, value: 6 });
  assert.deepEqual(evalExpr("6 * 7"), { ok: true, value: 42 });
  assert.deepEqual(evalExpr("10 - 2 - 3"), { ok: true, value: 5 });
  assert.deepEqual(evalExpr("20 / 4 / 5"), { ok: true, value: 1 });
});

test("divides and reports the full precedence chain", () => {
  assert.deepEqual(evalExpr("12 / 3"), { ok: true, value: 4 });
  assert.deepEqual(evalExpr("2 * 3 + 4 * 5 - 6 / 2 mod 4"), {
    ok: true,
    value: 23,
  });
});

test("reports the remainder with `mod`", () => {
  assert.deepEqual(evalExpr("17 mod 5"), { ok: true, value: 2 });
});

test("raises ol-div-zero for division by zero, never Infinity/NaN", () => {
  const result = evalExpr("5 / 0");
  assert.equal(result.ok, false);
  assert.equal(result.diagnostic.code, "ol-div-zero");
  assert.deepEqual(result.diagnostic.params, { operation: "/" });
  assert.equal(result.diagnostic.stage, "runtime");
  assert.equal(result.diagnostic.severity, "error");
});

test("raises ol-div-zero for `mod` by zero", () => {
  const result = evalExpr("5 mod 0");
  assert.equal(result.ok, false);
  assert.equal(result.diagnostic.code, "ol-div-zero");
  assert.deepEqual(result.diagnostic.params, { operation: "mod" });
});

test("raises ol-type when an arithmetic operand is not a number", () => {
  const left = evalExpr("true + 1");
  assert.equal(left.ok, false);
  assert.equal(left.diagnostic.code, "ol-type");
  assert.deepEqual(left.diagnostic.params, {
    expected: "number",
    actual: "boolean",
    value: true,
    operation: "+",
  });

  const right = evalExpr("1 + true");
  assert.equal(right.ok, false);
  assert.equal(right.diagnostic.code, "ol-type");
  assert.equal(right.diagnostic.params.actual, "boolean");
});

test("propagates a failing left or right operand before checking types", () => {
  const leftFails = evalExpr("(1 / 0) + 1");
  assert.equal(leftFails.ok, false);
  assert.equal(leftFails.diagnostic.code, "ol-div-zero");

  const rightFails = evalExpr("1 + (1 / 0)");
  assert.equal(rightFails.ok, false);
  assert.equal(rightFails.diagnostic.code, "ol-div-zero");
});

test("accepts a word that reads as a number, per execution-model.md:33", () => {
  assert.deepEqual(evalExpr('"5" + 1'), { ok: true, value: 6 });
});

test("rejects a word that does not read as a number", () => {
  const result = evalExpr('"abc" + 1');
  assert.equal(result.ok, false);
  assert.equal(result.diagnostic.code, "ol-type");
  assert.equal(result.diagnostic.params.actual, "word");
});

test("distinguishes a negative literal from subtraction", () => {
  assert.deepEqual(evalExpr("-7"), { ok: true, value: -7 });
  assert.deepEqual(evalExpr("0 - 7"), { ok: true, value: -7 });
});

test("abs reports the distance of a number from zero", () => {
  assert.deepEqual(evalExpr("abs -5"), { ok: true, value: 5 });
  assert.deepEqual(evalExpr("abs 5"), { ok: true, value: 5 });
});

test("sqrt reports the square root of a non-negative number", () => {
  assert.deepEqual(evalExpr("sqrt 81"), { ok: true, value: 9 });
});

test("raises ol-neg-sqrt for a negative sqrt input", () => {
  const result = evalExpr("sqrt -4");
  assert.equal(result.ok, false);
  assert.equal(result.diagnostic.code, "ol-neg-sqrt");
  assert.deepEqual(result.diagnostic.params, { value: -4 });
});

test("int truncates toward zero", () => {
  assert.deepEqual(evalExpr("int 3.8"), { ok: true, value: 3 });
  assert.deepEqual(evalExpr("int -3.8"), { ok: true, value: -3 });
});

test("round rounds ties toward positive infinity", () => {
  assert.deepEqual(evalExpr("round 3.5"), { ok: true, value: 4 });
  assert.deepEqual(evalExpr("round -3.5"), { ok: true, value: -3 });
  assert.deepEqual(evalExpr("round 3.8"), { ok: true, value: 4 });
});

test("propagates a failing operand into a unary math builtin", () => {
  const result = evalExpr("sqrt (1 / 0)");
  assert.equal(result.ok, false);
  assert.equal(result.diagnostic.code, "ol-div-zero");
});

test("raises ol-type when a unary math builtin's operand is not a number", () => {
  const result = evalExpr("sqrt true");
  assert.equal(result.ok, false);
  assert.equal(result.diagnostic.code, "ol-type");
  assert.equal(result.diagnostic.params.operation, "sqrt");
});

test("power raises the first number to the second as an exponent", () => {
  assert.deepEqual(evalExpr("power 2 8"), { ok: true, value: 256 });
});

test("propagates a failing base or exponent into power", () => {
  const baseFails = evalExpr("power (1 / 0) 2");
  assert.equal(baseFails.ok, false);
  assert.equal(baseFails.diagnostic.code, "ol-div-zero");

  const exponentFails = evalExpr("power 2 (1 / 0)");
  assert.equal(exponentFails.ok, false);
  assert.equal(exponentFails.diagnostic.code, "ol-div-zero");
});

test("raises ol-type when power's base or exponent is not a number", () => {
  const badBase = evalExpr("power true 2");
  assert.equal(badBase.ok, false);
  assert.equal(badBase.diagnostic.code, "ol-type");
  assert.equal(badBase.diagnostic.params.operation, "power");

  const badExponent = evalExpr("power 2 true");
  assert.equal(badExponent.ok, false);
  assert.equal(badExponent.diagnostic.code, "ol-type");
});

// `sin`/`cos`/`tan`/`pi` (issue #323, `spec/commands.md`'s "Math" section): the Core Math
// reporters this issue adds. Before this issue, `sin`/`cos`/`tan`/`pi` were already registered in
// the parser's fixed-arity table and so parsed with zero diagnostics, but reached no evaluator
// branch and no entry in the since-deleted `isSupportedExpression` gate, so `print sin 90` silently emitted no `print`
// event and no diagnostic at all — an uncontrolled silent failure this issue fixes.

test("sin/cos report the sine/cosine of an angle in degrees", () => {
  assert.deepEqual(evalExpr("sin 90"), { ok: true, value: 1 });
  assert.deepEqual(evalExpr("sin 0"), { ok: true, value: 0 });
  assert.deepEqual(evalExpr("sin -90"), { ok: true, value: -1 });
  assert.deepEqual(evalExpr("cos 0"), { ok: true, value: 1 });
  assert.deepEqual(evalExpr("cos 180"), { ok: true, value: -1 });
});

test("tan reports the tangent of an angle in degrees", () => {
  assert.deepEqual(evalExpr("tan 0"), { ok: true, value: 0 });
  // `tan 45` is `0.9999999999999999`, not exactly `1`, per IEEE-754 double rounding of `π/4` —
  // `print`'s canonical 10-significant-digit rendering (`formatNumber`) is what makes
  // `print tan 45` display `1`, matching `spec/commands.md`'s worked example; the raw evaluated
  // value is not itself rounded.
  assert.deepEqual(evalExpr("tan 45"), {
    ok: true,
    value: 0.9999999999999999,
  });
});

test("raises ol-tan-undefined for tan at a pole, never a huge finite value, NaN, or Infinity", () => {
  for (const degrees of [90, -90, 270, 450]) {
    const result = evalExpr(`tan ${degrees}`);
    assert.equal(result.ok, false);
    assert.equal(result.diagnostic.code, "ol-tan-undefined");
    assert.deepEqual(result.diagnostic.params, {
      value: degrees,
    });
  }
});

test("evaluates tan normally for angles adjacent to a pole, never a false-positive diagnostic", () => {
  // Regression for a pole-detection bug caught in review: normalizing the remainder into
  // `[0, 180)` by adding `180` before the second `%` is lossy for doubles one ULP away from `90`
  // (`89.99999999999999`, `90.00000000000001`) — the addition rounds the sum to exactly `270`,
  // which then falsely normalizes back to `90`, misclassifying a defined, finite `tan` input as
  // undefined. Comparing `degrees % 180` directly against `90`/`-90` (no addition, so no
  // precision loss) avoids this false positive.
  for (const degrees of [89.99999999999999, 90.00000000000001]) {
    const result = evalExpr(`tan ${degrees}`);
    assert.equal(result.ok, true);
    assert.equal(Number.isFinite(result.value), true);
  }
});

test("pi reports the mathematical constant", () => {
  assert.deepEqual(evalExpr("pi"), { ok: true, value: Math.PI });
});

test("propagates a failing operand into sin/cos/tan", () => {
  for (const builtin of ["sin", "cos", "tan"]) {
    const result = evalExpr(`${builtin} (1 / 0)`);
    assert.equal(result.ok, false);
    assert.equal(result.diagnostic.code, "ol-div-zero");
  }
});

test("raises ol-type when sin/cos/tan's operand is not a number", () => {
  for (const builtin of ["sin", "cos", "tan"]) {
    const result = evalExpr(`${builtin} true`);
    assert.equal(result.ok, false);
    assert.equal(result.diagnostic.code, "ol-type");
    assert.equal(result.diagnostic.params.operation, builtin);
  }
});

// The remaining tests hand-build minimal AST nodes to exercise evaluator-internal invariants
// that the parser's grammar and fixed-arity table make unreachable from real source.

const span = makeSpan(doc, [1, 1], [1, 1]);

test("every literal, arithmetic, and place-read shape this evaluator implements reports a value", () => {
  const env = createEnvironment();
  env.frames[0].set("x", 3);
  env.frames[0].set("nums", [10, 20]);
  env.frames[0].set("i", 1);
  for (const source of [
    "42",
    '"red"',
    "true",
    "[1 2 3]",
    "2 + 3 * 4",
    "sqrt (power 2 3)",
    "sin 90",
    "cos 0",
    "tan 45",
    "pi",
    ":x",
    'thing "x"',
    ":nums[1]",
    ":nums[:i]",
    "{ tom: 8 }.tom",
    "{ a: 1 }",
  ]) {
    assert.equal(evaluate(parseExpr(source), env).ok, true, source);
  }
});

test("an unresolvable callee raises ol-unknown-command at every depth it can nest", () => {
  // Issue #815 replaced `isSupportedExpression`, whose "unsupported" answer made the enclosing
  // statement a silent no-op, with the terminal rule: evaluation "MUST end in exactly one of three
  // outcomes — a value, a completed effect, or a diagnostic … at any depth, in any argument
  // position, and for any callable" (`spec/execution-model.md:717-720`). Every nesting the old
  // predicate enumerated as `false` now has to produce the diagnostic instead.
  const unknownCall = "(nonexistent_builtin 1)";
  for (const source of [
    unknownCall,
    `[1 ${unknownCall}]`,
    `1 + ${unknownCall}`,
    `(${unknownCall} is empty)`,
    `(2 is member of ${unknownCall})`,
    `(5 is between ${unknownCall} and 5)`,
    `(5 is between 1 and ${unknownCall})`,
    `{ a: ${unknownCall} }`,
  ]) {
    const result = evaluate(parseExpr(source));
    assert.equal(result.ok, false, source);
    assert.equal(result.diagnostic.code, "ol-unknown-command", source);
    assert.deepEqual(result.diagnostic.params, {
      name: "nonexistent_builtin",
    });
  }
});

test("a registered Command asked for a value reports ol-no-output, never ol-not-implemented", () => {
  // The runtime twin of `checker-command-in-value-position.ts`'s rule (`spec/tooling.md:193`).
  // `forward` is a statement command with no expression-position evaluation, and the tempting
  // answer — `ol-not-implemented` — would be a lie in the learner's favour: `forward` IS
  // implemented, it simply reports no value. The code that says so is `ol-no-output`, and it is
  // reached only when the check has been bypassed, since a checked run refuses the program first.
  const result = evaluate(parseExpr("(forward 100)"));
  assert.equal(result.ok, false);
  assert.equal(result.diagnostic.code, "ol-no-output");
  assert.deepEqual(result.diagnostic.params, { procedure: "forward" });
  assert.equal(result.diagnostic.stage, "runtime");
});

test("throws when a call is missing an argument the operator requires", () => {
  const call = {
    kind: "Call",
    source_span: span,
    callee: { name: "+", source_span: span },
    args: [{ kind: "NumberLit", source_span: span, value: 1 }],
  };
  assert.throws(() => evaluate(call), /no argument at position 1/);
});

test("evaluate() on a DictLit returns a fresh OLDict with its entries (issue #322)", () => {
  const dictLit = parseExpr('{ a: 1 b: "x" }');
  const result = evaluate(dictLit);
  assert.equal(result.ok, true);
  assert.ok(result.value instanceof OLDict);
  assert.deepEqual(result.value.keys(), ["a", "b"]);
  assert.deepEqual(result.value.values(), [1, "x"]);
});

test("evaluate() on a DictLit propagates a failing entry value's diagnostic (issue #322)", () => {
  const result = evalExpr("{ a: 1 / 0 }");
  assert.equal(result.ok, false);
  assert.equal(result.diagnostic.code, "ol-div-zero");
});

test("`value of <dict> for key <key>` propagates a failing dictionary expression's diagnostic", () => {
  const result = evalExpr('value of (1 / 0) for key "a"');
  assert.equal(result.ok, false);
  assert.equal(result.diagnostic.code, "ol-div-zero");
});

test("`value of <dict> for key <key>` raises the Core dict-read `ol-type` when the dictionary is not a dict", () => {
  // The reader is DICT-ONLY (`spec/data-structures.md:268` types its operand `dictExpr`), so its
  // Core twin is the dotted `.field` selector's dict branch, not `:d[k]`: `operation: "field"`,
  // `expected: "dict"` — no Heritage spelling in the machine-readable params (issue #670), and no
  // `"list or dict"`, which was the `[k]` selector's expectation and self-contradictory for a list
  // operand (issue #784).
  const result = evalExpr('value of 5 for key "a"');
  assert.equal(result.ok, false);
  assert.equal(result.diagnostic.code, "ol-type");
  assert.deepEqual(result.diagnostic.params, {
    expected: "dict",
    actual: "number",
    value: 5,
    operation: "field",
  });
});

// Issue #784's direct regression: a LIST operand used to be told "index needs a list or dict, but
// got a list" — an `expected` set the offending value belongs to, so the diagnostic denied its own
// premise. Asserted on `expected`/`operation` AND on the rendered prose, because the params are the
// machine-readable identity the studio/tutor consume while the sentence is what the learner reads,
// and this defect was a defect in both.
test("`value of <list> for key <key>` reports a dict-only expectation, never `list or dict` (issue #784)", () => {
  const result = evalExpr('value of [ 1 2 ] for key "tom"');
  assert.equal(result.ok, false);
  assert.equal(result.diagnostic.code, "ol-type");
  assert.deepEqual(result.diagnostic.params, {
    expected: "dict",
    actual: "list",
    value: [1, 2],
    operation: "field",
  });
  assert.equal(
    result.diagnostic.message,
    "field needs a dict, but got a list.",
  );
  assert.notEqual(
    result.diagnostic.params.expected,
    result.diagnostic.params.actual,
    "a type error must never name the offending value's own type as what it expected",
  );
});

test("`value of <dict> for key <key>` propagates a failing key expression's diagnostic", () => {
  const result = evalExpr("value of { a: 1 } for key (1 / 0)");
  assert.equal(result.ok, false);
  assert.equal(result.diagnostic.code, "ol-div-zero");
});

test("`value of <dict> for key <key>` raises the Core dict-read `ol-type` when the key is neither word nor number", () => {
  // Byte-identical to the Core `:d[k]` selector's dict bad-key branch (issue #670):
  // `operation: "index"`, `expected: "word or number"`.
  const result = evalExpr("value of { a: 1 } for key true");
  assert.equal(result.ok, false);
  assert.equal(result.diagnostic.code, "ol-type");
  assert.deepEqual(result.diagnostic.params, {
    expected: "word or number",
    actual: "boolean",
    value: true,
    operation: "index",
  });
});

test("`value of <dict> for key <key>` raises ol-unknown-key when the key is missing", () => {
  const result = evalExpr('value of { a: 1 } for key "b"');
  assert.equal(result.ok, false);
  assert.equal(result.diagnostic.code, "ol-unknown-key");
  assert.deepEqual(result.diagnostic.params, { key: "b" });
});

test("`value of <dict> for key <key>` reports a numeric key bare (unquoted) in the ol-unknown-key message", () => {
  const result = evalExpr("value of { a: 1 } for key 5");
  assert.equal(result.ok, false);
  assert.equal(result.diagnostic.code, "ol-unknown-key");
  assert.deepEqual(result.diagnostic.params, { key: 5 });
  assert.equal(result.diagnostic.message, "this dict has no key 5.");
});

// The Heritage-contract twin tests (issue #670, `spec/conformance.md:150` — alternate spellings,
// no new semantics): the reader `value of D for key K` must produce a result byte-identical to its
// Core twin on the same operands — the same value on success, and on failure the same diagnostic
// `code`, `params`, `message`, `stage`, and `severity`. Only the `source_span` may differ (it points
// at where the learner wrote the fault — a localization concern, not part of the machine-readable
// contract, `spec/localization.md`), so it is excluded from the comparison.
//
// There are TWO twins because the reader sits between two Core selectors, and picking the wrong one
// per condition is exactly what issue #784 was:
//   * `D.key`  — the DOTTED read, whose non-record container must be a dict. The twin for the
//     operand's own type, because the reader is dict-only too (`spec/data-structures.md:268` types
//     the operand `dictExpr`). The two agree on every container type except `record`, which `.key`
//     accepts and the reader does not — see the record test below.
//   * `D[K]`   — the read with a RUNTIME key. The twin for the key's type, because `.key` takes a
//     parse-time identifier and so has no runtime-key failure mode to be a twin of.
// The non-dict-container row therefore lives in the `.key` table below and NOT in the `[K]` table,
// where it used to sit asserting `expected: "list or dict"` — a set a list operand belongs to
// (#784). It is not dropped: it is replaced by one row per non-dict container type.
const stripSpan = ({ source_span: _ignored, ...rest }) => rest;

/** Assert the reader and its Core twin agree on value, or on every diagnostic field but the span. */
function assertTwins(reader, twin, label) {
  const readerResult = evalExpr(reader);
  const twinResult = evalExpr(twin);
  assert.equal(readerResult.ok, twinResult.ok, `${label}: ok mismatch`);
  if (readerResult.ok) {
    assert.deepEqual(
      readerResult.value,
      twinResult.value,
      `${label}: value mismatch`,
    );
  } else {
    assert.deepEqual(
      stripSpan(readerResult.diagnostic),
      stripSpan(twinResult.diagnostic),
      `${label}: diagnostic mismatch (excluding span)`,
    );
  }
}

test("`value of <dict> for key <key>` is byte-identical to the Core `:d.key` twin, for every non-dict container type except record", () => {
  // Driven over the non-dict container types rather than a single sampled one, because issue #784
  // survived by corpus shape: the only non-dict type the previous corpus exercised was `number`,
  // and the WRONG message reads sensibly for it ("index needs a list or dict, but got a number").
  // `list` is the one type for which it does not, because `list` is the only non-dict container
  // INSIDE the `"list or dict"` set the message claimed to require — so it alone made `expected`
  // and `actual` overlap. Enumerating the types removes shape as a hiding place.
  //
  // `record` is the only exclusion, and it is excluded because it has no twin to be identical TO:
  // the reader rejects a record (its operand is typed `dictExpr`) while `.key` accepts one and
  // reports `ol-unknown-field`. That case is pinned without a twin by the record test below.
  const twins = [
    // [Heritage reader, Core dotted selector, human label]
    ['value of { tom: 8 } for key "tom"', "{ tom: 8 }.tom", "happy path"],
    ['value of { tom: 8 } for key "zed"', "{ tom: 8 }.zed", "missing key"],
    ['value of (5) for key "tom"', "(5).tom", "number container"],
    ['value of "hi" for key "tom"', '"hi".tom', "word container"],
    ['value of true for key "tom"', "true.tom", "boolean container"],
    ['value of [ 1 2 ] for key "tom"', "[ 1 2 ].tom", "list container (#784)"],
    ['value of who for key "tom"', "who.tom", "turtle container"],
  ];
  for (const [reader, twin, label] of twins) {
    assertTwins(reader, twin, label);
  }
});

test("`value of <dict> for key <key>` is byte-identical to the Core runtime-key `:d[key]` twin where that is the same operation", () => {
  // `[key]` remains the twin for the conditions that do not turn on the operand's own type: a
  // successful read and a missing key. The third such condition — a key that is neither word nor
  // number, which `.key` cannot express at all — needs the SAME evaluated key on both sides, and an
  // inline one is not a twin (`spec/grammar.md:256`: a bare identifier inside a selector is a
  // literal word key, so `:d[true]` is the word "true" while `for key true` is a boolean). It is
  // therefore twinned with the key bound to a variable, in
  // heritage-canonical-diagnostic-params.test.mjs's EXTRA_TWINS, and its params are pinned by the
  // dedicated non-word/number-key test above.
  const twins = [
    ['value of { tom: 8 } for key "tom"', '{ tom: 8 }["tom"]', "happy path"],
    ['value of { tom: 8 } for key "zed"', '{ tom: 8 }["zed"]', "missing key"],
  ];
  for (const [reader, twin, label] of twins) {
    assertTwins(reader, twin, label);
  }
});

// The one container type with NO Core twin, pinned deliberately rather than left to be rediscovered
// as a bug. The reader's operand is typed `dictExpr` (`spec/data-structures.md:268`), so a record is
// out of range and rejected — while the Core `.key` selector it otherwise twins ACCEPTS records
// (`spec/data-structures.md:252-327`) and reports `ol-unknown-field` instead. The divergence
// predates issue #784 (the reader rejected records before it too, just with `expected: "list or
// dict"`) and is spec-mandated, so closing it either way is a `spec/` decision, not a runtime one.
// Uses execute() rather than evalExpr() because a record needs a `struct` declaration and a binding.
test("`value of <record> for key <key>` rejects the record — the one container type with no Core twin", () => {
  const { diagnostics } = execute(
    'struct point [ x y ]\n:p = point 1 2\nprint value of :p for key "tom"',
    doc,
  );
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].code, "ol-type");
  assert.equal(diagnostics[0].params.expected, "dict");
  assert.equal(diagnostics[0].params.actual, "record");
  assert.equal(diagnostics[0].params.operation, "field");
  assert.ok(
    diagnostics[0].params.value instanceof OLRecord,
    "the value param must be the offending record itself",
  );
  assert.equal(diagnostics[0].message, "field needs a dict, but got a record.");

  // And the divergence this pins: the Core `.key` selector accepts the record instead.
  const core = execute(
    "struct point [ x y ]\n:p = point 1 2\nprint :p.tom",
    doc,
  );
  assert.equal(core.diagnostics.length, 1);
  assert.equal(
    core.diagnostics[0].code,
    "ol-unknown-field",
    "if Core ever stops accepting records here, the two spellings have converged and this test " +
      "and its conformance fixture should be revisited",
  );
});
