// Unit tests for comparison operators, chained comparisons, and equality (issue #96) —
// spec/execution-model.md:126-166 (precedence/chaining) and :483-510 (equality matrix, ordering,
// cycle-safe structural equality). Most cases parse real `print <expr>` source through
// @openlogo/parser and evaluate the resulting AST node exactly as execute() does. Two properties
// are not yet expressible through Core source (variable reads land with #94, list mutation with
// #101), so they are exercised directly: single-evaluation of a chain operand via a hand-built
// ComparisonChain whose middle operand counts its own reads, and cyclic/shared list equality via
// valuesEqual() called on directly-constructed OLValues.

import assert from "node:assert/strict";
import { test } from "node:test";
import { makeSpan, OLDict } from "@openlogo/core";
import * as Parser from "@openlogo/parser";
import { evaluate, valuesEqual } from "@openlogo/runtime";

const doc = "comparison-equality.logo";

/** Parse `print <expr>` and return the evaluated result of `<expr>`. */
function evalExpr(expr) {
  const { ast, diagnostics } = Parser.parse(`print ${expr}`, doc);
  assert.deepEqual(diagnostics, []);
  return evaluate(ast.body[0].args[0]);
}

/** Parse `print <expr>` and return the evaluated boolean value, asserting no diagnostic. */
function boolOf(expr) {
  const result = evalExpr(expr);
  assert.equal(result.ok, true, `expected ${expr} to evaluate cleanly`);
  return result.value;
}

/**
 * Build a `NumberLit`-shaped operand whose `value` getter counts each read, returning the node
 * plus a `reads()` accessor. The getter body lives at this single source location, so the
 * single-evaluation test covers it once and the short-circuit test can reuse the same helper while
 * asserting the count stays at 0 (rather than duplicating an uncovered getter body per test).
 */
function makeCountingOperand(value, span) {
  let reads = 0;
  const node = {
    kind: "NumberLit",
    source_span: span,
    get value() {
      reads += 1;
      return value;
    },
  };
  return { node, reads: () => reads };
}

// --- Equality matrix: `==` / `!=` -----------------------------------------------------------

test("number == number is numeric equality", () => {
  assert.equal(boolOf("5 == 5"), true);
  assert.equal(boolOf("5 == 6"), false);
  assert.equal(boolOf("5 != 6"), true);
  assert.equal(boolOf("5 != 5"), false);
  assert.equal(boolOf("-3 == -3"), true);
  assert.equal(boolOf("2.5 == 2.5"), true);
});

test("number == word compares by the number's canonical printed form", () => {
  assert.equal(boolOf('5 == "5"'), true);
  assert.equal(boolOf('"5" == 5'), true);
  assert.equal(boolOf('5 == "05"'), false); // "5" is 5's printed form, not "05"
  assert.equal(boolOf('"05" == 5'), false);
  assert.equal(boolOf('5 == "5.0"'), false); // "5" != "5.0"
  assert.equal(boolOf('5 == "apple"'), false); // word does not parse as a number
  assert.equal(boolOf('2.5 == "2.5"'), true);
  assert.equal(boolOf('5 != "05"'), true);
});

test("word == word is case-sensitive, never numeric coercion between two words", () => {
  assert.equal(boolOf('"red" == "red"'), true);
  assert.equal(boolOf('"red" == "Red"'), false);
  assert.equal(boolOf('"5" == "5.0"'), false); // two words, exact-string equality
  assert.equal(boolOf('"5" == "05"'), false);
  assert.equal(boolOf('"apple" != "banana"'), true);
});

test("boolean == boolean is boolean identity; cross-type is false", () => {
  assert.equal(boolOf("true == true"), true);
  assert.equal(boolOf("false == false"), true);
  assert.equal(boolOf("true == false"), false);
  assert.equal(boolOf("true != false"), true);
  assert.equal(boolOf("true == 1"), false);
  assert.equal(boolOf('true == "true"'), false);
});

test("list == list is structural: same length and pairwise ==", () => {
  assert.equal(boolOf("[1 2 3] == [1 2 3]"), true);
  assert.equal(boolOf("[1 2 3] == [1 2 4]"), false);
  assert.equal(boolOf("[1 2] == [1 2 3]"), false); // different length
  assert.equal(boolOf("[] == []"), true);
  assert.equal(boolOf("[[1] [2]] == [[1] [2]]"), true); // nested
  assert.equal(boolOf("[[1] [2]] == [[1] [3]]"), false);
  assert.equal(boolOf('[1 "red" true] == [1 "red" true]'), true);
  assert.equal(boolOf('[1 "red"] == [1 "5"]'), false);
  assert.equal(boolOf("[1 2] != [1 3]"), true);
});

test("list cross-type with any non-list is false", () => {
  assert.equal(boolOf("[1] == 1"), false);
  assert.equal(boolOf('[1] == "1"'), false);
  assert.equal(boolOf("[1] == true"), false);
  assert.equal(boolOf("1 == [1]"), false);
});

test("number == word inside a nested list uses the printed-form rule", () => {
  assert.equal(boolOf('[5] == ["5"]'), true);
  assert.equal(boolOf('[5] == ["05"]'), false);
});

test("number == word uses the spec canonical printed form (<=10 significant digits)", () => {
  // Whole values print without a decimal; non-whole values trim to at most 10 significant
  // digits (spec/execution-model.md:19). A word carrying more digits than the number prints
  // cannot equal it.
  assert.equal(boolOf('12345 == "12345"'), true); // whole, full integer form
  assert.equal(boolOf('0.3333333333 == "0.3333333333"'), true); // exactly 10 sig digits
  assert.equal(boolOf('0.33333333331 == "0.33333333331"'), false); // 11 digits -> trimmed
  assert.equal(boolOf('1.234567890123 == "1.234567890123"'), false); // trims to 1.23456789
  // Same rule reached directly through valuesEqual.
  assert.equal(valuesEqual(1.234567890123, "1.234567890123"), false);
  assert.equal(valuesEqual(1.234567890123, "1.23456789"), true);
});

// --- Ordering: `< > <= >=` ------------------------------------------------------------------

test("numbers order numerically", () => {
  assert.equal(boolOf("1 < 2"), true);
  assert.equal(boolOf("2 < 1"), false);
  assert.equal(boolOf("2 > 1"), true);
  assert.equal(boolOf("1 > 2"), false);
  assert.equal(boolOf("2 <= 2"), true);
  assert.equal(boolOf("2 <= 1"), false);
  assert.equal(boolOf("2 >= 2"), true);
  assert.equal(boolOf("1 >= 2"), false);
  assert.equal(boolOf("-3 < 0"), true);
});

test("words order lexicographically by Unicode code point", () => {
  assert.equal(boolOf('"apple" < "banana"'), true);
  assert.equal(boolOf('"banana" < "apple"'), false);
  assert.equal(boolOf('"banana" > "apple"'), true);
  assert.equal(boolOf('"app" < "apple"'), true); // shorter prefix sorts first
  assert.equal(boolOf('"apple" < "app"'), false);
  assert.equal(boolOf('"apple" <= "apple"'), true);
  assert.equal(boolOf('"apple" < "apple"'), false);
  assert.equal(boolOf('"apple" >= "apple"'), true);
  assert.equal(boolOf('"Zebra" < "apple"'), true); // 'Z' (0x5A) < 'a' (0x61)
});

test("words order by code point, not UTF-16 code unit, for astral characters", () => {
  // U+1F600 (😀) has a greater code point than U+FFFF, but its leading UTF-16 surrogate
  // (0xD83D) is less than 0xFFFF — a code-unit comparison would get this backwards.
  assert.equal(boolOf('"\u{1F600}" > "\uFFFF"'), true);
  assert.equal(boolOf('"\uFFFF" < "\u{1F600}"'), true);
});

test("ordering two equal infinities compares directly, not by subtraction (no NaN)", () => {
  // `power 10 1000` overflows to Infinity; `Infinity - Infinity` is NaN, so a sign-by-subtraction
  // ordering would wrongly report `<=`/`>=` as false. Build the comparison over Infinity operands
  // directly (overflow is reachable through `power`, but this pins the operand precisely).
  const span = makeSpan(doc, [1, 1], [1, 2]);
  const inf = {
    kind: "NumberLit",
    source_span: span,
    value: Number.POSITIVE_INFINITY,
  };
  const order = (op) =>
    evaluate({
      kind: "Call",
      source_span: span,
      callee: { name: op, source_span: span },
      args: [inf, inf],
    });
  assert.deepEqual(order("<="), { ok: true, value: true });
  assert.deepEqual(order(">="), { ok: true, value: true });
  assert.deepEqual(order("<"), { ok: true, value: false });
  assert.deepEqual(order(">"), { ok: true, value: false });
});

test("ordering a non-orderable left operand raises ol-type naming 'number or word'", () => {
  const result = evalExpr("true < false");
  assert.equal(result.ok, false);
  assert.equal(result.diagnostic.code, "ol-type");
  assert.equal(result.diagnostic.stage, "runtime");
  assert.equal(result.diagnostic.severity, "error");
  assert.deepEqual(result.diagnostic.params, {
    expected: "number or word",
    actual: "boolean",
    value: true,
    operation: "<",
  });
});

test("ordering a list operand raises ol-type", () => {
  const result = evalExpr("[1] > 2");
  assert.equal(result.ok, false);
  assert.equal(result.diagnostic.code, "ol-type");
  assert.deepEqual(result.diagnostic.params, {
    expected: "number or word",
    actual: "list",
    value: [1],
    operation: ">",
  });
});

test("ordering an orderable left but mismatched right names the left's concept", () => {
  const numberWord = evalExpr('5 < "apple"');
  assert.equal(numberWord.ok, false);
  assert.deepEqual(numberWord.diagnostic.params, {
    expected: "number",
    actual: "word",
    value: "apple",
    operation: "<",
  });

  const wordNumber = evalExpr('"apple" <= 5');
  assert.equal(wordNumber.ok, false);
  assert.deepEqual(wordNumber.diagnostic.params, {
    expected: "word",
    actual: "number",
    value: 5,
    operation: "<=",
  });
});

test("a mixed number/word pair is a type error even though each is orderable alone", () => {
  for (const op of ["<", ">", "<=", ">="]) {
    const result = evalExpr(`5 ${op} "5"`);
    assert.equal(result.ok, false, `${op} should reject a mixed pair`);
    assert.equal(result.diagnostic.code, "ol-type");
  }
});

// --- Chained comparisons --------------------------------------------------------------------

test("a same-operator chain evaluates as and-joined pairs", () => {
  assert.equal(boolOf("1 < 5 < 10"), true);
  assert.equal(boolOf("1 < 5 < 3"), false); // second link false
  assert.equal(boolOf("5 < 1 < 10"), false); // first link false
  assert.equal(boolOf("1 < 2 < 3 < 4"), true); // 3-link chain
  assert.equal(boolOf("1 < 2 < 3 < 2"), false);
});

test("a mixed-operator chain joins each pairwise comparison", () => {
  assert.equal(boolOf("1 < 5 <= 5"), true);
  assert.equal(boolOf("3 > 2 == 2"), true);
  assert.equal(boolOf("3 > 2 == 5"), false);
});

test("a word chain orders lexicographically at each link", () => {
  assert.equal(boolOf('"a" < "b" < "c"'), true);
  assert.equal(boolOf('"a" < "c" < "b"'), false);
});

test("a failing earlier link short-circuits before a later link's type error", () => {
  // `5 < 3` is false, so `3 < "apple"` (which would be ol-type) is never computed.
  const result = evalExpr('5 < 3 < "apple"');
  assert.equal(result.ok, true);
  assert.equal(result.value, false);
});

test("a type error in a reached chain link propagates", () => {
  const result = evalExpr('1 < 5 < "apple"');
  assert.equal(result.ok, false);
  assert.equal(result.diagnostic.code, "ol-type");
});

test("a failing operand's own diagnostic propagates out of a comparison", () => {
  // `5 / 0` raises ol-div-zero; the comparison surfaces it unchanged, from either side.
  const left = evalExpr("5 / 0 == 3");
  assert.equal(left.ok, false);
  assert.equal(left.diagnostic.code, "ol-div-zero");

  const right = evalExpr("3 == 5 / 0");
  assert.equal(right.ok, false);
  assert.equal(right.diagnostic.code, "ol-div-zero");
});

test("a failing operand's diagnostic propagates out of a chain, from the first or a later link", () => {
  const first = evalExpr("5 / 0 < 2 < 3");
  assert.equal(first.ok, false);
  assert.equal(first.diagnostic.code, "ol-div-zero");

  const later = evalExpr("1 < 5 / 0 < 3");
  assert.equal(later.ok, false);
  assert.equal(later.diagnostic.code, "ol-div-zero");
});

test("a chain evaluates each operand exactly once (single-evaluation)", () => {
  // Not yet expressible through Core source (variable reads land with #94), so build the chain
  // `1 < <mid> < 10` directly with a middle operand that counts reads of its literal value.
  const span = makeSpan(doc, [1, 1], [1, 2]);
  const middle = makeCountingOperand(5, span);
  const chain = {
    kind: "ComparisonChain",
    source_span: span,
    operands: [
      { kind: "NumberLit", source_span: span, value: 1 },
      middle.node,
      { kind: "NumberLit", source_span: span, value: 10 },
    ],
    operators: [
      { name: "<", source_span: span },
      { name: "<", source_span: span },
    ],
  };
  const result = evaluate(chain);
  assert.equal(result.ok, true);
  assert.equal(result.value, true);
  assert.equal(
    middle.reads(),
    1,
    "the shared middle operand must be evaluated exactly once",
  );
});

test("a chain does not evaluate operands past the short-circuit point", () => {
  const span = makeSpan(doc, [1, 1], [1, 2]);
  const tail = makeCountingOperand(10, span);
  // `5 < 3 < <tail>`: the first link `5 < 3` is false, so the tail is never evaluated.
  const chain = {
    kind: "ComparisonChain",
    source_span: span,
    operands: [
      { kind: "NumberLit", source_span: span, value: 5 },
      { kind: "NumberLit", source_span: span, value: 3 },
      tail.node,
    ],
    operators: [
      { name: "<", source_span: span },
      { name: "<", source_span: span },
    ],
  };
  const result = evaluate(chain);
  assert.equal(result.ok, true);
  assert.equal(result.value, false);
  assert.equal(
    tail.reads(),
    0,
    "a short-circuited operand must not be evaluated",
  );
});

// --- Cycle-safe structural equality (valuesEqual on constructed OLValues) --------------------

test("valuesEqual matches the source-level equality behaviour", () => {
  assert.equal(valuesEqual(5, 5), true);
  assert.equal(valuesEqual(5, "5"), true);
  assert.equal(valuesEqual("5", 5), true);
  assert.equal(valuesEqual(5, "05"), false);
  assert.equal(valuesEqual("red", "red"), true);
  assert.equal(valuesEqual(true, true), true);
  assert.equal(valuesEqual(true, 1), false);
  assert.equal(valuesEqual([1, 2], [1, 2]), true);
  assert.equal(valuesEqual([1, 2], [1, 3]), false);
});

test("structural equality terminates and returns true for two isomorphic self-cycles", () => {
  const a = [1];
  a.push(a); // a = [1, a]
  const b = [1];
  b.push(b); // b = [1, b]
  assert.equal(valuesEqual(a, b), true);
});

test("a self-cycle equals itself", () => {
  const a = [1];
  a.push(a);
  assert.equal(valuesEqual(a, a), true);
});

test("distinct isomorphic cycles with a differing leaf are not equal, and still terminate", () => {
  const a = [1];
  a.push(a); // [1, a]
  const b = [2];
  b.push(b); // [2, b]
  assert.equal(valuesEqual(a, b), false);
});

test("shared structure that visits the same in-progress node against different partners", () => {
  // a[0]=a, a[1]=a. b[0]=b, b[1]=c where c is its own [c, c] self-cycle. All three are the
  // infinite tree "[self, self]", so they are bisimilar and compare equal — exercising the
  // in-progress path where node `a` is compared against a partner it has not seen yet.
  const a = [];
  a.push(a, a);
  const c = [];
  c.push(c, c);
  const b = [];
  b.push(b, c);
  assert.equal(valuesEqual(a, b), true);
});

test("cyclic lists of differing length are unequal without recursing", () => {
  const a = [1];
  a.push(a); // length 2
  const b = [1];
  b.push(b, b); // length 3
  assert.equal(valuesEqual(a, b), false);
});

test("dict == dict is structural: same keys and pairwise ==, order-independent (issue #322)", () => {
  const a = new OLDict();
  a.set("x", 1);
  a.set("y", 2);
  const b = new OLDict();
  b.set("y", 2);
  b.set("x", 1);
  assert.equal(valuesEqual(a, b), true);
});

test("dicts of differing size are unequal", () => {
  const a = new OLDict();
  a.set("x", 1);
  const b = new OLDict();
  b.set("x", 1);
  b.set("y", 2);
  assert.equal(valuesEqual(a, b), false);
});

test("dicts with the same size but different keys are unequal", () => {
  const a = new OLDict();
  a.set("x", 1);
  const b = new OLDict();
  b.set("y", 1);
  assert.equal(valuesEqual(a, b), false);
});

test("dicts with the same keys but a differing value are unequal", () => {
  const a = new OLDict();
  a.set("x", 1);
  const b = new OLDict();
  b.set("x", 2);
  assert.equal(valuesEqual(a, b), false);
});

test("dict cross-type with any non-dict is false", () => {
  const a = new OLDict();
  a.set("x", 1);
  assert.equal(valuesEqual(a, [1]), false);
  assert.equal(valuesEqual(a, 1), false);
  assert.equal(valuesEqual(a, "x"), false);
});

test("a self-referential dict (nested via a shared list) equals itself, terminating on the cycle", () => {
  const a = new OLDict();
  const list = [a];
  a.set("self", list);
  assert.equal(valuesEqual(a, a), true);
});
