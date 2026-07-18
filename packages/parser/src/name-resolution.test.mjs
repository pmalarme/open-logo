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

test("a parameter, local+assign, for, and both comprehension binder forms are all declarations, never flagged", () => {
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
