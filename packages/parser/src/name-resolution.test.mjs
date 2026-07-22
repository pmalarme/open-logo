import assert from "node:assert/strict";
import { test } from "node:test";
import * as OL from "@openlogo/parser";

/**
 * Unit tests for the name/place resolution rules (issue #113) — `ol-not-a-place` (the
 * completion of #79's first cut), `ol-undefined-var`, and `ol-reserved-word`. Behavior is
 * verified against the built `check()` entry point per the shared black-box convention
 * (co-located `*.test.mjs` importing only `@openlogo/parser`), matching `arity.test.mjs`'s
 * `checkSource` helper shape.
 */

function checkSource(source, profiles = ["core-language"]) {
  const { ast, diagnostics: parseDiagnostics } = OL.parse(source, "unit.logo");
  assert.deepEqual(
    parseDiagnostics,
    [],
    `expected a clean parse for ${JSON.stringify(source)}`,
  );
  return OL.check(ast, { profiles, source }).diagnostics;
}

/**
 * Like {@link checkSource}, but calls `check()` WITHOUT a `source` string — exercising
 * `checker-not-a-place.ts`'s AST-reconstruction fallback path ({@link renderNode}/
 * {@link renderPlace}) instead of the primary source-slicing path. A caller with only a
 * `ProgramNode` (no original text) is exactly `postfix-selectors.test.mjs`'s pre-#113 shape.
 */
function checkNoSource(source, profiles = ["core-language"]) {
  const { ast, diagnostics: parseDiagnostics } = OL.parse(source, "unit.logo");
  assert.deepEqual(
    parseDiagnostics,
    [],
    `expected a clean parse for ${JSON.stringify(source)}`,
  );
  return OL.check(ast, { profiles }).diagnostics;
}

// Shared, named predicates. Reused across positive and negative assertions so every negative
// (empty-array) assertion stays callback-free, keeping function coverage at 100% on Node 22 —
// the same shape `postfix-selectors.test.mjs`'s `isNotAPlace` uses.
const isNotAPlace = (d) => d.code === "ol-not-a-place";
const isUndefinedVar = (d) => d.code === "ol-undefined-var";
const isReservedWordFinding = (d) => d.code === "ol-reserved-word";

// ── ol-not-a-place: reconciling #79's first cut to the spec worked example ──────────────────

test("the spec's worked example count :nums = 3 renders the FULL target surface text (spec/tooling.md:213-219)", () => {
  const diagnostics = checkSource(":nums = 1\ncount :nums = 3\n");
  const [finding] = diagnostics.filter(isNotAPlace);
  assert.equal(finding.code, "ol-not-a-place");
  assert.equal(finding.stage, "semantic");
  assert.equal(finding.severity, "error");
  assert.deepEqual(finding.params, { text: "count :nums" });
});

test("a bare number literal target 3 = 5 parses as an Assign with a NumberLit target", () => {
  const { ast } = OL.parse("3 = 5", "unit.logo");
  const assign = ast.body[0];
  assert.equal(assign.kind, "Assign");
  assert.equal(assign.place.kind, "NumberLit");
});

test("check() flags a bare number literal target 3 = 5 with ol-not-a-place, rendered verbatim", () => {
  const [finding] = checkSource("3 = 5").filter(isNotAPlace);
  assert.deepEqual(finding.params, { text: "3" });
});

test('check() flags a bare word literal target "red" = 5, rendered with its quotes', () => {
  const [finding] = checkSource('"red" = 5').filter(isNotAPlace);
  assert.deepEqual(finding.params, { text: '"red"' });
});

test("check() flags a bare boolean literal target true = 5, rendered verbatim", () => {
  const [finding] = checkSource("true = 5").filter(isNotAPlace);
  assert.deepEqual(finding.params, { text: "true" });
});

test("check() flags a bare list literal target [1 2] = 5, rendering every element", () => {
  const [finding] = checkSource("[1 2] = 5").filter(isNotAPlace);
  assert.deepEqual(finding.params, { text: "[1 2]" });
});

test("a zero-argument primitive target pi = 5 renders just the callee name, no trailing arguments", () => {
  const [finding] = checkSource("pi = 5").filter(isNotAPlace);
  assert.deepEqual(finding.params, { text: "pi" });
});

test("a well-formed place target is never flagged ol-not-a-place", () => {
  assert.deepEqual(checkSource(":x = 1\nprint :x\n").filter(isNotAPlace), []);
});

test("check() renders the EXACT source text for a nested Place argument target, e.g. count :nums[1] = 3 (reconciling #79's AST-only renderer, which dropped Place arguments)", () => {
  const [finding] = checkSource(":nums = [1 2 3]\ncount :nums[1] = 3").filter(
    isNotAPlace,
  );
  assert.deepEqual(finding.params, { text: "count :nums[1]" });
});

test("check() renders the EXACT source text for an infix-operator target, e.g. 1 + 2 = 3 (reconciling #79's AST-only renderer, which rendered infix operators in prefix form)", () => {
  const [finding] = checkSource("1 + 2 = 3").filter(isNotAPlace);
  assert.deepEqual(finding.params, { text: "1 + 2" });
});

test("check() slices a target spanning MULTIPLE source lines verbatim, including the lines strictly between its start and end", () => {
  const source = "(first\n  :x\n  :y) = 5\n";
  const [finding] = checkSource(source).filter(isNotAPlace);
  assert.deepEqual(finding.params, { text: "(first\n  :x\n  :y)" });
});

// ── ol-not-a-place's AST-reconstruction fallback (no `source` supplied to check()) ───────────
//
// checker-not-a-place.ts prefers slicing `source` when available, but falls back to
// reconstructing the target's text from the AST when it is not (e.g. a caller that only has a
// `ProgramNode`, matching postfix-selectors.test.mjs's pre-#113 `OL.check(ast)` call shape).
// These cases happen to render identically to their source text, but they exercise a materially
// different code path (`renderNode`/`renderPlace`), so they are asserted separately.

test("the AST fallback renders every bare literal target kind verbatim when no source is supplied", () => {
  assert.deepEqual(checkNoSource("3 = 5").filter(isNotAPlace)[0].params, {
    text: "3",
  });
  assert.deepEqual(checkNoSource('"red" = 5').filter(isNotAPlace)[0].params, {
    text: '"red"',
  });
  assert.deepEqual(checkNoSource("true = 5").filter(isNotAPlace)[0].params, {
    text: "true",
  });
  assert.deepEqual(checkNoSource("[1 2] = 5").filter(isNotAPlace)[0].params, {
    text: "[1 2]",
  });
});

test("the AST fallback renders a nested Place call argument via renderPlace, e.g. count :nums[1] = 3 (reconciling #79's renderer, which dropped Place arguments entirely)", () => {
  const [finding] = checkNoSource(":nums = [1 2 3]\ncount :nums[1] = 3").filter(
    isNotAPlace,
  );
  assert.deepEqual(finding.params, { text: "count :nums[1]" });
});

test("the AST fallback renders a field-selector Place call argument via renderPlace, e.g. count :point.x = 5", () => {
  const [finding] = checkNoSource("count :point.x = 5").filter(isNotAPlace);
  assert.deepEqual(finding.params, { text: "count :point.x" });
});

test("the AST fallback renders a PostfixExpression target via renderPostfixExpression/renderSegments (issue #407/F7), e.g. [1 2][1] = 5", () => {
  const [finding] = checkNoSource("[1 2][1] = 5").filter(isNotAPlace);
  assert.deepEqual(finding.params, { text: "[1 2][1]" });
});

test("the AST fallback renders a field-selector PostfixExpression target, e.g. { tom: 8 }.tom = 9", () => {
  const [finding] = checkNoSource("{ tom: 8 }.tom = 9", [
    "core-language",
    "data",
  ]).filter(isNotAPlace);
  assert.deepEqual(finding.params, { text: "{ tom: 8 }.tom" });
});

test("the AST fallback renders a dict literal PostfixExpression base with a numeric key, e.g. { 8: 1 }.foo = 9", () => {
  const [finding] = checkNoSource("{ 8: 1 }.foo = 9", [
    "core-language",
    "data",
  ]).filter(isNotAPlace);
  assert.deepEqual(finding.params, { text: "{ 8: 1 }.foo" });
});

test("the AST fallback renders an empty dict literal PostfixExpression base as `{ }`, e.g. { }.foo = 9", () => {
  const [finding] = checkNoSource("{ }.foo = 9", [
    "core-language",
    "data",
  ]).filter(isNotAPlace);
  assert.deepEqual(finding.params, { text: "{ }.foo" });
});

test("the AST fallback renders a zero-argument callee target with just its name, no trailing space", () => {
  const [finding] = checkNoSource("pi = 5").filter(isNotAPlace);
  assert.deepEqual(finding.params, { text: "pi" });
});

test("the AST fallback renders an infix-operator target INFIX, not in the AST's own prefix shape (rubber-duck finding: 1 + 2 = 3 must render as 1 + 2, never + 1 2)", () => {
  const [finding] = checkNoSource("1 + 2 = 3").filter(isNotAPlace);
  assert.deepEqual(finding.params, { text: "1 + 2" });
});

test("the AST fallback recognizes every fixed infix operator name, not just +", () => {
  assert.deepEqual(checkNoSource("1 - 2 = 3").filter(isNotAPlace)[0].params, {
    text: "1 - 2",
  });
  assert.deepEqual(checkNoSource("1 * 2 = 3").filter(isNotAPlace)[0].params, {
    text: "1 * 2",
  });
  assert.deepEqual(checkNoSource("1 / 2 = 3").filter(isNotAPlace)[0].params, {
    text: "1 / 2",
  });
  assert.deepEqual(checkNoSource("1 mod 2 = 3").filter(isNotAPlace)[0].params, {
    text: "1 mod 2",
  });
  assert.deepEqual(checkNoSource("1 == 2 = 3").filter(isNotAPlace)[0].params, {
    text: "1 == 2",
  });
  assert.deepEqual(checkNoSource("1 != 2 = 3").filter(isNotAPlace)[0].params, {
    text: "1 != 2",
  });
  assert.deepEqual(checkNoSource("1 < 2 = 3").filter(isNotAPlace)[0].params, {
    text: "1 < 2",
  });
  assert.deepEqual(checkNoSource("1 > 2 = 3").filter(isNotAPlace)[0].params, {
    text: "1 > 2",
  });
  assert.deepEqual(checkNoSource("1 <= 2 = 3").filter(isNotAPlace)[0].params, {
    text: "1 <= 2",
  });
  assert.deepEqual(checkNoSource("1 >= 2 = 3").filter(isNotAPlace)[0].params, {
    text: "1 >= 2",
  });
  assert.deepEqual(
    checkNoSource("true and false = 3").filter(isNotAPlace)[0].params,
    { text: "true and false" },
  );
  assert.deepEqual(
    checkNoSource("true or false = 3").filter(isNotAPlace)[0].params,
    { text: "true or false" },
  );
});

test("the AST fallback wraps a ParenCall target back in its own parentheses, e.g. (first :x) = 5 (rubber-duck finding: parens were dropped)", () => {
  const [finding] = checkNoSource("(first :x) = 5").filter(isNotAPlace);
  assert.deepEqual(finding.params, { text: "(first :x)" });
});

test("the AST fallback renders a genuine two-argument prefix call target in prefix form — a two-argument callee that is NOT one of the fixed infix operator names is never mistaken for one", () => {
  const [finding] = checkNoSource(
    "define combine :a :b\n  print :a\nend\ncombine 1 2 = 5\n",
  ).filter(isNotAPlace);
  assert.deepEqual(finding.params, { text: "combine 1 2" });
});

// ── The AST fallback's postfix-base render paths for the newly-legal `primary` bases (issue
// #407/F7 follow-up: a comparison chain, `is`-predicate, comprehension, or `value of … for
// key …` reader can be a postfix base directly or via a parenthesized grouping) ────────────────

test("the AST fallback wraps a parenthesized infix-call postfix base back in its own parens, e.g. (1 + 2).x = 3 (rubber-duck finding: the base's own leading paren was dropped from both the span and the render)", () => {
  const [finding] = checkNoSource("(1 + 2).x = 3").filter(isNotAPlace);
  assert.deepEqual(finding.params, { text: "(1 + 2).x" });
});

test("the AST fallback renders a parenthesized comparison-chain postfix base, e.g. (1 < 2 < 3).x = 3", () => {
  const [finding] = checkNoSource("(1 < 2 < 3).x = 3").filter(isNotAPlace);
  assert.deepEqual(finding.params, { text: "(1 < 2 < 3).x" });
});

test("the AST fallback renders a parenthesized `is empty` predicate postfix base, e.g. (1 is empty).x = 3", () => {
  const [finding] = checkNoSource("(1 is empty).x = 3").filter(isNotAPlace);
  assert.deepEqual(finding.params, { text: "(1 is empty).x" });
});

test("the AST fallback renders every worded is-predicate form nested inside a list-literal postfix base", () => {
  assert.deepEqual(
    checkNoSource("[:x is member of [1 2]].y = 3").filter(isNotAPlace)[0]
      .params,
    { text: "[:x is member of [1 2]].y" },
  );
  assert.deepEqual(
    checkNoSource('[:x is a "number"].y = 3').filter(isNotAPlace)[0].params,
    { text: '[:x is a "number"].y' },
  );
  assert.deepEqual(
    checkNoSource("[:n is between 1 and 10].y = 3").filter(isNotAPlace)[0]
      .params,
    { text: "[:n is between 1 and 10].y" },
  );
  assert.deepEqual(
    checkNoSource("[:n is strictly between 1 and 10].y = 3").filter(
      isNotAPlace,
    )[0].params,
    { text: "[:n is strictly between 1 and 10].y" },
  );
});

test("the AST fallback renders a comprehension postfix base with a bare-name binder, e.g. (map n in [1] [ :n ]).x = 3", () => {
  const [finding] = checkNoSource("(map n in [1] [ :n ]).x = 3").filter(
    isNotAPlace,
  );
  assert.deepEqual(finding.params, { text: "(map n in [1] [ :n ]).x" });
});

test("the AST fallback renders a reduce comprehension postfix base with its accumulator/from clause, e.g. (reduce total n in [1] from 0 [ :total ]).x = 3", () => {
  const [finding] = checkNoSource(
    "(reduce total n in [1] from 0 [ :total ]).x = 3",
  ).filter(isNotAPlace);
  assert.deepEqual(finding.params, {
    text: "(reduce total n in [1] from 0 [ :total ]).x",
  });
});

test("the AST fallback renders a comprehension postfix base with a destructuring binder pattern, e.g. (map [ :a :b ] in [[1 2]] [ :a ]).x = 3", () => {
  const [finding] = checkNoSource(
    "(map [ :a :b ] in [[1 2]] [ :a ]).x = 3",
  ).filter(isNotAPlace);
  assert.deepEqual(finding.params, {
    text: "(map [ :a :b ] in [[1 2]] [ :a ]).x",
  });
});

test("the AST fallback falls back to a bounded placeholder for a comprehension body that is not a single bracketed expression, e.g. map n in [1] [ local z ].x = 3 (a statement-only form, not an ExpressionNode)", () => {
  const [finding] = checkNoSource("map n in [1] [ local z ].x = 3").filter(
    isNotAPlace,
  );
  assert.deepEqual(finding.params, { text: "map n in [1] [ … ].x" });
});

test('the AST fallback renders a value-of-key reader nested inside a list-literal postfix base, e.g. [value of { a: 1 } for key "a"][0].y = 3 (issue #407/F7 postfix base)', () => {
  const [finding] = checkNoSource('[value of { a: 1 } for key "a"][0].y = 3', [
    "core-language",
    "data",
  ]).filter(isNotAPlace);
  assert.deepEqual(finding.params, {
    text: '[value of { a: 1 } for key "a"][0].y',
  });
});

// ── ol-undefined-var: static reads of an unbound `:name` ─────────────────────────────────────

test("a bare :missing read with no declaration anywhere raises ol-undefined-var at the variable's span", () => {
  const [finding] = checkSource("print :missing").filter(isUndefinedVar);
  assert.equal(finding.stage, "semantic");
  assert.equal(finding.severity, "error");
  assert.deepEqual(finding.params, { name: "missing" });
});

test('thing "missing" is checked the same way a bare read is (spec/error-model.md:101)', () => {
  const [finding] = checkSource('print thing "missing"').filter(isUndefinedVar);
  assert.deepEqual(finding.params, { name: "missing" });
});

test("a parameter, local+assign, for (with and without by), and both comprehension binder forms are all declarations, never flagged", () => {
  const source = [
    "define f :a",
    "  print :a",
    "end",
    "f 1",
    "",
    "local y",
    ":y = 2",
    "print :y",
    "",
    "for i in [1 2 3]",
    "  print :i",
    "end",
    "",
    "for j from 1 to 3",
    "  print :j",
    "end",
    "",
    "for k from 1 to 10 by 2",
    "  print :k",
    "end",
    "",
    ":doubled = map n in [1 2 3] [ :n * 2 ]",
    ":total = reduce sum n in [1 2 3] from 0 [ :sum + :n ]",
    "",
  ].join("\n");
  assert.deepEqual(checkSource(source).filter(isUndefinedVar), []);
});

test("assigning an undeclared name always declares it — a later read is never flagged (spec/execution-model.md:322-327)", () => {
  assert.deepEqual(
    checkSource(":brandNew = 1\nprint :brandNew").filter(isUndefinedVar),
    [],
  );
});

test("reading a global BEFORE its (later, textual) assignment is accepted — this rule does not simulate control-flow order (see the module doc comment's deliberate scope boundary)", () => {
  assert.deepEqual(
    checkSource("print :later\n:later = 1\n").filter(isUndefinedVar),
    [],
  );
});

test("a malformed (non-place) assignment target declares nothing; a nested undeclared read is still flagged", () => {
  const diagnostics = checkSource("first :missing = 5");
  assert.ok(diagnostics.some(isNotAPlace));
  const [undefinedVar] = diagnostics.filter(isUndefinedVar);
  assert.deepEqual(undefinedVar.params, { name: "missing" });
});

test("thing with the wrong argument count is not read as a name lookup", () => {
  assert.deepEqual(checkSource('(thing "a" "b")').filter(isUndefinedVar), []);
});

test("thing of a variable (not a literal word) is not read as a name lookup", () => {
  assert.deepEqual(
    checkSource("local y\nprint thing :y").filter(isUndefinedVar),
    [],
  );
});

test('thing "declared" naming an already-declared global is not flagged', () => {
  assert.deepEqual(
    checkSource(':declared = 1\nprint thing "declared"').filter(isUndefinedVar),
    [],
  );
});

// ── Lexical frame scoping regressions (rubber-duck findings on the first rewrite) ────────────

test("a procedure's own parameter is invisible outside its frame — reading it inside the body is fine, but a top-level read of the same name is flagged", () => {
  const diagnostics = checkSource(
    "define f :secret\n  print :secret\nend\nf 1\nprint :secret\n",
  );
  const findings = diagnostics.filter(isUndefinedVar);
  assert.equal(findings.length, 1);
  assert.deepEqual(findings[0].params, { name: "secret" });
});

test("a procedure's own local is invisible outside its frame", () => {
  const diagnostics = checkSource(
    "define g\n  local temp\n  :temp = 1\n  print :temp\nend\ng\nprint :temp\n",
  );
  const findings = diagnostics.filter(isUndefinedVar);
  assert.equal(findings.length, 1);
  assert.deepEqual(findings[0].params, { name: "temp" });
});

test("two different procedures' own parameters do not leak into each other's frame", () => {
  const diagnostics = checkSource(
    "define f :a\n  print :a\nend\ndefine g :b\n  print :a\nend\nf 1\ng 2\n",
  );
  const findings = diagnostics.filter(isUndefinedVar);
  assert.equal(findings.length, 1);
  assert.deepEqual(findings[0].params, { name: "a" });
});

test("a nested procedure definition does not inherit its enclosing procedure's frame or locals (no closures) — reconciling the flat whole-program model this rule replaced", () => {
  const source = [
    "define outer :a",
    "  define inner",
    "    local secret",
    "    :secret = 1",
    "    print :secret",
    "  end",
    "  inner",
    "  print :secret",
    "end",
    "outer 1",
  ].join("\n");
  const diagnostics = checkSource(source);
  const findings = diagnostics.filter(isUndefinedVar);
  assert.equal(findings.length, 1);
  assert.deepEqual(findings[0].params, { name: "secret" });
});

test("a for binder is invisible after its own loop body ends (no scope leakage past the block)", () => {
  const diagnostics = checkSource(
    "for i in [1 2 3]\n  print :i\nend\nprint :i\n",
  );
  const findings = diagnostics.filter(isUndefinedVar);
  assert.equal(findings.length, 1);
  assert.deepEqual(findings[0].params, { name: "i" });
});

// Issue #91: a destructuring `for [:x :y] in …` binder introduces every named binder as a
// declaration within its body, same as a bare-name binder — and none of them leak past the end.
test("a destructuring for-in binder's names are all declarations, never flagged, within the body", () => {
  const source = [
    "for [:x :y] in [1 2 3]",
    "  print :x",
    "  print :y",
    "end",
    "",
  ].join("\n");
  assert.deepEqual(checkSource(source).filter(isUndefinedVar), []);
});

test("a destructuring for-in binder's names are invisible after the loop body ends (no scope leakage)", () => {
  const diagnostics = checkSource(
    "for [:x :y] in [1 2 3]\n  print :x\nend\nprint :x\nprint :y\n",
  );
  const findings = diagnostics.filter(isUndefinedVar);
  assert.equal(findings.length, 2);
  assert.deepEqual(
    findings.map((f) => f.params),
    [{ name: "x" }, { name: "y" }],
  );
});

test("a reduce comprehension's accumulator binder is invisible after its own body ends", () => {
  const diagnostics = checkSource(
    ":total = reduce sum n in [1 2 3] from 0 [ :sum + :n ]\nprint :sum\n",
  );
  const findings = diagnostics.filter(isUndefinedVar);
  assert.equal(findings.length, 1);
  assert.deepEqual(findings[0].params, { name: "sum" });
});

test("a postfixed read of an unbound Place base raises ol-undefined-var at the base (rubber-duck finding: bases were never checked as reads)", () => {
  const [finding] = checkSource("print :missing.field").filter(isUndefinedVar);
  assert.deepEqual(finding.params, { name: "missing" });
});

test("a segmented assignment target's base must already be bound — no auto-vivification (spec/execution-model.md:251-291)", () => {
  const [finding] = checkSource(":missing.field = 1").filter(isUndefinedVar);
  assert.deepEqual(finding.params, { name: "missing" });
});

test("a segmented assignment target's base is accepted once declared, and the index/key expression is itself checked as a read", () => {
  assert.deepEqual(
    checkSource(":people = 1\n:people.tom = 1\n").filter(isUndefinedVar),
    [],
  );
  const [finding] = checkSource(":people = 1\n:people[:missing] = 1\n").filter(
    isUndefinedVar,
  );
  assert.deepEqual(finding.params, { name: "missing" });
});

test("a parameter default value can reference an earlier parameter of the same procedure frame", () => {
  assert.deepEqual(
    checkSource(
      "define f :a (:b :a)\n  print :a\n  print :b\nend\nf 1\n",
    ).filter(isUndefinedVar),
    [],
  );
});

test("a parameter default value referencing an undeclared name is flagged the same as any other read", () => {
  const [finding] = checkSource(
    "define f (:b :missing)\n  print :b\nend\nf\n",
  ).filter(isUndefinedVar);
  assert.deepEqual(finding.params, { name: "missing" });
});

// ── ol-reserved-word: define/local registrations colliding with an existing name ─────────────

test("define first ... end collides with a Core primitive", () => {
  const [finding] = checkSource("define first :x\n  print :x\nend\n").filter(
    isReservedWordFinding,
  );
  assert.equal(finding.stage, "semantic");
  assert.equal(finding.severity, "error");
  assert.deepEqual(finding.params, { name: "first", namespace: "primitive" });
});

test("define repeat ... end collides with a reserved structural word", () => {
  const [finding] = checkSource("define repeat :x\n  print :x\nend\n").filter(
    isReservedWordFinding,
  );
  assert.deepEqual(finding.params, { name: "repeat", namespace: "reserved" });
});

test("thing is reachable in two categories at once; the reserved-word category wins over primitive", () => {
  const [finding] = checkSource("define thing :x\n  print :x\nend\n").filter(
    isReservedWordFinding,
  );
  assert.deepEqual(finding.params, { name: "thing", namespace: "reserved" });
});

test("a Core primitive collision is only checked when core-language is an active profile", () => {
  assert.deepEqual(
    checkSource("define first :x\n  print :x\nend\n", []).filter(
      isReservedWordFinding,
    ),
    [],
  );
});

test("two define f ... end blocks only flag the second, later occurrence", () => {
  const findings = checkSource(
    "define f :a\n  print :a\nend\ndefine f :a\n  print :a\nend\n",
  ).filter(isReservedWordFinding);
  assert.equal(findings.length, 1);
  assert.deepEqual(findings[0].params, { name: "f", namespace: "procedure" });
});

test("local first inside a procedure body collides with a Core primitive the same way define does", () => {
  const [finding] = checkSource(
    "define g :y\n  local first\n  print :y\nend\n",
  ).filter(isReservedWordFinding);
  assert.deepEqual(finding.params, { name: "first", namespace: "primitive" });
});

test("a fresh, non-colliding define and local are never flagged ol-reserved-word", () => {
  assert.deepEqual(
    checkSource("define greet\n  local farewell\n  print 1\nend\n").filter(
      isReservedWordFinding,
    ),
    [],
  );
});
