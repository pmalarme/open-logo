// Guard tests for the Heritage `value of … for key …` reader **inside parentheses** (issue #830).
//
// `spec/grammar.md` derives the reader there. `primary` (`spec/grammar.md:193-204`) offers both
// `parenthesized-expression` (:199, defined :213) and `value-of-reader` (:203, defined :217), so
// `expression → … → primary → value-of-reader` makes `( value of :d for key "a" )` a
// `parenthesized-expression` wrapping a `value-of-reader`.
//
// The bug this file locks shut: the `(` path committed to `parenthesized-call` (:215) as soon as
// the head looked like a `callable-name`, so `value` became the callee and the reader was never
// entered — `ol-bad-token`, no `ValueOfKey` node. #885 fixed it *incidentally*, by deriving
// `NON_PRIMARY_NAMES` from `OL_KEYWORDS` (which contains `value`): `isCalleeName` now answers
// false for `value`, and the `(` path falls through to `parseExpression()` → `parseNamePrimary` →
// `parseValueOfKey`.
//
// Because that fix was incidental, nothing recorded the dependency. These tests do: they fail if a
// future slice makes `value` callable again — by adding it to `EXPRESSION_INITIAL_KEYWORDS`, by
// unwinding #885's derivation, or by special-casing it in `isCalleeName`. Asserting the
// `ValueOfKey` node (not merely "no diagnostics") is what makes them load-bearing: a program that
// silently re-parses as a call to a procedure named `value` is the "silent no-op" class this saga
// keeps rediscovering.

import assert from "node:assert/strict";
import { test } from "node:test";
import * as OL from "@openlogo/parser";

const doc = "value-of-key-in-parentheses.logo";

/** A dict to read from, plus a nested one so a reader can report a dict for another reader. */
const PRELUDE = ':d = { a: 7 b: "a" }\n:nested = { inner: { x: 9 } }\n';

/** How many `ValueOfKey` nodes `program` contains. */
function valueOfKeyCount(program) {
  let count = 0;
  OL.walk(program, (node) => {
    if (node.kind === "ValueOfKey") {
      count += 1;
    }
  });
  return count;
}

/** Every `ParenCall` callee name in `program`, lowercased — the node the defect produced. */
function parenCallCallees(program) {
  const names = [];
  OL.walk(program, (node) => {
    if (node.kind === "ParenCall") {
      names.push(node.callee.name.toLowerCase());
    }
  });
  return names;
}

/** Parse diagnostics plus the semantic ones `check()` finds under Core + Data + Heritage. */
function allDiagnostics(source) {
  const { ast, diagnostics } = OL.parse(source, doc);
  const checked = OL.check(ast, {
    profiles: ["core-language", "data", "heritage"],
    source,
  });
  return [...diagnostics, ...checked.diagnostics];
}

/**
 * The parenthesized shapes the grammar's own derivation makes legal, with the number of
 * `ValueOfKey` nodes each must produce. The counts matter as much as the cleanliness: under the
 * defect the two operand shapes still yielded ONE reader (the outer one), so a test that only
 * counted "at least one" would have passed while the inner reader silently became a call.
 */
const LEGAL_SHAPES = [
  ['print (value of :d for key "a")', 1, "reader wholly parenthesized"],
  [
    'print value of (value of :nested for key "inner") for key "x"',
    2,
    "parenthesized reader as the dictionary operand",
  ],
  [
    'print value of :d for key (value of :d for key "b")',
    2,
    "parenthesized reader as the key operand",
  ],
  ['print ((value of :d for key "a"))', 1, "redundant grouping"],
  ['print (value of :d for key "a") + 1', 1, "parenthesized reader then infix"],
  ['print 1 + (value of :d for key "a")', 1, "infix then parenthesized reader"],
  [
    'print (value of :nested for key "inner").x',
    1,
    "`.field` postfix on a parenthesized reader",
  ],
  [
    "print (value of :nested for key \"inner\")[x]",
    1,
    "`[selector]` postfix on a parenthesized reader",
  ],
  [
    'print (value of (value of :nested for key "inner") for key "x")',
    2,
    "both readers parenthesized",
  ],
];

test("a parenthesized value-of-key reader parses to a ValueOfKey node", () => {
  for (const [line, expectedReaders, label] of LEGAL_SHAPES) {
    const source = `${PRELUDE}${line}\n`;
    const { ast } = OL.parse(source, doc);
    assert.equal(
      valueOfKeyCount(ast),
      expectedReaders,
      `${label}: wrong ValueOfKey count for \`${line}\``,
    );
  }
});

test("a parenthesized value-of-key reader is never lowered into a call to `value`", () => {
  for (const [line, , label] of LEGAL_SHAPES) {
    const { ast } = OL.parse(`${PRELUDE}${line}\n`, doc);
    assert.equal(
      parenCallCallees(ast).includes("value"),
      false,
      `${label}: \`${line}\` took \`value\` as a parenthesized-call callee`,
    );
  }
});

test("a parenthesized value-of-key reader is clean at parse and check", () => {
  for (const [line, , label] of LEGAL_SHAPES) {
    assert.deepEqual(
      allDiagnostics(`${PRELUDE}${line}\n`),
      [],
      `${label}: \`${line}\` was diagnosed`,
    );
  }
});

test("`value` is not a callable-name, which is what routes the `(` path to the reader", () => {
  // The invariant #885 established and #830 depends on. If this flips, every test above fails
  // too — this one just names the cause rather than the symptom.
  assert.equal(
    OL.OL_KEYWORDS.includes("value"),
    true,
    "`value` left the keyword registry, so `isCalleeName` would accept it as a callee again",
  );
  assert.equal(
    OL.OL_KEYWORDS.includes("key"),
    true,
    "`key` left the keyword registry",
  );
});

test("parenthesized calls and grouping still work beside the reader", () => {
  // The `(` path's other two roles must be untouched: `parenthesized-call` (`spec/grammar.md:215`)
  // and plain `parenthesized-expression` (:213).
  const { ast: grouped } = OL.parse("print ( 1 + 2 )\n", doc);
  assert.deepEqual(parenCallCallees(grouped), []);
  assert.deepEqual(allDiagnostics("print ( 1 + 2 )\n"), []);

  const { ast: called } = OL.parse("print (sentence 1 2)\n", doc);
  assert.deepEqual(parenCallCallees(called), ["sentence"]);
  assert.equal(valueOfKeyCount(called), 0);
});

test("`value` and `key` remain legal data beside the parenthesized reader", () => {
  // The other half of #853: tightening expression position must not touch their data roles.
  // `spec/grammar.md:406` — "Dictionary keys and selector bare keys are data, not declarations,
  // so built-in names are legal keys."
  const source =
    ':settings = { key: "alpha" value: 42 }\n' +
    'print (value of :settings for key "key")\n' +
    "print :settings.value\n" +
    "print :settings[key]\n";
  assert.deepEqual(allDiagnostics(source), []);
  const { ast } = OL.parse(source, doc);
  assert.equal(valueOfKeyCount(ast), 1);
});

test("a bare `value` in parentheses is still rejected", () => {
  // The reader is entered only when `of` directly follows, so parenthesizing a bare `value` must
  // not smuggle it in as a callee. It reports `ol-bad-token` naming the word.
  const diagnostics = allDiagnostics("print (value)\n");
  const badToken = diagnostics.filter(
    (diagnostic) => diagnostic.code === "ol-bad-token",
  );
  assert.equal(badToken.length, 1, "expected exactly one ol-bad-token");
  const { ast } = OL.parse("print (value)\n", doc);
  assert.equal(valueOfKeyCount(ast), 0);
  assert.equal(parenCallCallees(ast).includes("value"), false);
});
