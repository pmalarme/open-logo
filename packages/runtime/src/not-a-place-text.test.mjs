// Unit tests for `notAPlaceTargetText` (issue #156): the runtime's own text-derivation helper for
// the `ol-not-a-place` diagnostic's `text` param, mirroring `checker-not-a-place.ts`'s semantic-
// stage rule (issue #79/#113). Exercises both paths directly against real parsed ASTs:
//
// 1. Source slicing (`source` provided) — the primary path `execute()` always uses.
// 2. AST reconstruction (`source` `undefined`) — the fallback this package's own bare-environment
//    unit tests exercise (`variables-places.test.mjs`), covering every `RenderableNode` kind that
//    can appear as a non-place assignment target or nested inside one.
//
// Imported via a deep relative path into this package's own `dist/not-a-place-text.js` build
// output (never through the `"@openlogo/runtime"` package specifier — `index.ts` never re-exports
// it, so it isn't part of the package's public surface, same convention as
// `repeat-forever-repcount.test.mjs`'s import of `execute-internal.js`).

import assert from "node:assert/strict";
import { test } from "node:test";
import * as Parser from "@openlogo/parser";
import { notAPlaceTargetText } from "../dist/not-a-place-text.js";

const doc = "acceptance.logo";

/** Parses `source` as a single `Assign` statement and returns its `place` (target) node. */
function targetOf(source) {
  const { ast, diagnostics } = Parser.parse(source, doc);
  assert.deepEqual(diagnostics, []);
  return ast.body[0].place;
}

// --- AST-reconstruction fallback (no `source`) -----------------------------------------------

test("renders a zero-argument prefix call target (`pi = 5`)", () => {
  assert.equal(notAPlaceTargetText(targetOf("pi = 5"), undefined), "pi");
});

test("renders a multi-argument prefix call target (`first :nums = 1`)", () => {
  assert.equal(
    notAPlaceTargetText(targetOf("first :nums = 1"), undefined),
    "first :nums",
  );
});

test("renders a parenthesized call target (`(first :nums) = 1`)", () => {
  assert.equal(
    notAPlaceTargetText(targetOf("(first :nums) = 1"), undefined),
    "(first :nums)",
  );
});

test("renders an infix-operator call target in infix form (`1 + 2 = 3`)", () => {
  assert.equal(notAPlaceTargetText(targetOf("1 + 2 = 3"), undefined), "1 + 2");
});

test("renders a nested Place argument with both a field and an index selector", () => {
  assert.equal(
    notAPlaceTargetText(targetOf("count :people.tom[1] = 5"), undefined),
    "count :people.tom[1]",
  );
});

test("renders a list-literal argument with mixed element kinds (number, word, boolean)", () => {
  assert.equal(
    notAPlaceTargetText(targetOf('count [1 "two" true] = 5'), undefined),
    'count [1 "two" true]',
  );
});

test("renders a PostfixExpression target with an index segment over a list literal (issue #407/F7), e.g. [1 2][1] = 5", () => {
  assert.equal(
    notAPlaceTargetText(targetOf("[1 2][1] = 5"), undefined),
    "[1 2][1]",
  );
});

test("renders a PostfixExpression target with a field segment over a dict literal (issue #407/F7), e.g. { tom: 8 }.tom = 9", () => {
  assert.equal(
    notAPlaceTargetText(targetOf("{ tom: 8 }.tom = 9"), undefined),
    "{ tom: 8 }.tom",
  );
});

test("renders an empty dict literal PostfixExpression base as `{ }` (issue #407/F7), e.g. { }.tom = 9", () => {
  assert.equal(
    notAPlaceTargetText(targetOf("{ }.tom = 9"), undefined),
    "{ }.tom",
  );
});

test("renders a dict literal PostfixExpression base with a numeric key (issue #407/F7), e.g. { 8: 1 }.foo = 9", () => {
  assert.equal(
    notAPlaceTargetText(targetOf("{ 8: 1 }.foo = 9"), undefined),
    "{ 8: 1 }.foo",
  );
});

// --- Postfix-base render paths for the newly-legal `primary` bases (issue #407/F7 follow-up: a
// comparison chain, `is`-predicate, comprehension, or `value of … for key …` reader can be a
// postfix base directly or via a parenthesized grouping) -------------------------------------

test("renders a parenthesized infix-call postfix base back in its own parens, e.g. (1 + 2).x = 3 (rubber-duck finding: the base's own leading paren was dropped from both the span and the render)", () => {
  assert.equal(
    notAPlaceTargetText(targetOf("(1 + 2).x = 3"), undefined),
    "(1 + 2).x",
  );
});

test("renders a parenthesized comparison-chain postfix base, e.g. (1 < 2 < 3).x = 3", () => {
  assert.equal(
    notAPlaceTargetText(targetOf("(1 < 2 < 3).x = 3"), undefined),
    "(1 < 2 < 3).x",
  );
});

test("renders a parenthesized `is empty` predicate postfix base, e.g. (1 is empty).x = 3", () => {
  assert.equal(
    notAPlaceTargetText(targetOf("(1 is empty).x = 3"), undefined),
    "(1 is empty).x",
  );
});

test("renders every worded is-predicate form nested inside a list-literal postfix base", () => {
  assert.equal(
    notAPlaceTargetText(targetOf("[:x is member of [1 2]].y = 3"), undefined),
    "[:x is member of [1 2]].y",
  );
  assert.equal(
    notAPlaceTargetText(targetOf('[:x is a "number"].y = 3'), undefined),
    '[:x is a "number"].y',
  );
  assert.equal(
    notAPlaceTargetText(targetOf("[:n is between 1 and 10].y = 3"), undefined),
    "[:n is between 1 and 10].y",
  );
  assert.equal(
    notAPlaceTargetText(
      targetOf("[:n is strictly between 1 and 10].y = 3"),
      undefined,
    ),
    "[:n is strictly between 1 and 10].y",
  );
});

test("renders a comprehension postfix base with a bare-name binder, e.g. (map n in [1] [ :n ]).x = 3", () => {
  assert.equal(
    notAPlaceTargetText(targetOf("(map n in [1] [ :n ]).x = 3"), undefined),
    "(map n in [1] [ :n ]).x",
  );
});

test("renders a reduce comprehension postfix base with its accumulator/from clause, e.g. (reduce total n in [1] from 0 [ :total ]).x = 3", () => {
  assert.equal(
    notAPlaceTargetText(
      targetOf("(reduce total n in [1] from 0 [ :total ]).x = 3"),
      undefined,
    ),
    "(reduce total n in [1] from 0 [ :total ]).x",
  );
});

test("renders a comprehension postfix base with a destructuring binder pattern, e.g. (map [ :a :b ] in [[1 2]] [ :a ]).x = 3", () => {
  assert.equal(
    notAPlaceTargetText(
      targetOf("(map [ :a :b ] in [[1 2]] [ :a ]).x = 3"),
      undefined,
    ),
    "(map [ :a :b ] in [[1 2]] [ :a ]).x",
  );
});

test("falls back to a bounded placeholder for a comprehension body that is not a single bracketed expression, e.g. map n in [1] [ local z ].x = 3 (a statement-only form, not an ExpressionNode)", () => {
  assert.equal(
    notAPlaceTargetText(targetOf("map n in [1] [ local z ].x = 3"), undefined),
    "map n in [1] [ … ].x",
  );
});

test('renders a value-of-key reader nested inside a list-literal postfix base, e.g. [value of { a: 1 } for key "a"][0].y = 3 (issue #407/F7 postfix base)', () => {
  assert.equal(
    notAPlaceTargetText(
      targetOf('[value of { a: 1 } for key "a"][0].y = 3'),
      undefined,
    ),
    '[value of { a: 1 } for key "a"][0].y',
  );
});

test("renders a parenthesized bare-variable postfix base (:x).foo = 1 — never a Place, only the unparenthesized :x.foo form roots one (rubber-duck round-2)", () => {
  const target = targetOf("(:x).foo = 1");
  assert.equal(target.kind, "PostfixExpression");
  assert.equal(target.base.kind, "VarRef");
  assert.equal(target.parenGroupCount, 1);
  assert.equal(notAPlaceTargetText(target, undefined), "(:x).foo");
});

test("renders a DOUBLY-parenthesized infix-call postfix base with BOTH grouping levels, e.g. ((1 + 2)).x = 3 (rubber-duck round-2: a single boolean flag can only restore one level)", () => {
  assert.equal(
    notAPlaceTargetText(targetOf("((1 + 2)).x = 3"), undefined),
    "((1 + 2)).x",
  );
});

test("renders one EXTRA grouping level around an already-self-parenthesizing ParenCall base, e.g. ((first :x)).foo = 1", () => {
  assert.equal(
    notAPlaceTargetText(targetOf("((first :x)).foo = 1"), undefined),
    "((first :x)).foo",
  );
});

// --- Source slicing (`source` provided) ------------------------------------------------------

test("slices the exact single-line surface text, preserving non-canonical spacing", () => {
  const source = "1  +  2 = 3";
  assert.equal(notAPlaceTargetText(targetOf(source), source), "1  +  2");
});

test("slices a target whose source span crosses multiple lines", () => {
  const source = "count [1\n2\n3] = 5";
  assert.equal(
    notAPlaceTargetText(targetOf(source), source),
    "count [1\n2\n3]",
  );
});
