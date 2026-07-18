import assert from "node:assert/strict";
import { test } from "node:test";
import * as OL from "@openlogo/parser";

/**
 * Unit tests for the static arity rule (issue #111) — `ol-not-enough-inputs` /
 * `ol-too-many-inputs`. Behavior is verified against the built `check()` entry point per the
 * shared black-box convention (co-located `*.test.mjs` importing only `@openlogo/parser`).
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

test("the spec worked example `print first` raises ol-not-enough-inputs (spec/tooling.md:207-212)", () => {
  const diagnostics = checkSource("print first");
  assert.equal(diagnostics.length, 1);
  const [finding] = diagnostics;
  assert.equal(finding.code, "ol-not-enough-inputs");
  assert.equal(finding.stage, "semantic");
  assert.equal(finding.severity, "error");
  assert.deepEqual(finding.params, {
    callable: "first",
    expected: 1,
    actual: 0,
  });
  assert.equal(finding.message, "first needs one input.");
});

test("a fixed-arity primitive short of arguments raises too-few (power needs 2, given 1)", () => {
  const [finding] = checkSource("power 2");
  assert.equal(finding.code, "ol-not-enough-inputs");
  assert.deepEqual(finding.params, {
    callable: "power",
    expected: 2,
    actual: 1,
  });
  assert.equal(finding.message, "power needs two inputs.");
});

test("a fully-applied fixed-arity primitive call is never flagged", () => {
  assert.deepEqual(checkSource("print 1"), []);
});

test("a parenthesized fixed-arity primitive given too many inputs raises too-many", () => {
  const [finding] = checkSource("(first 1 2)");
  assert.equal(finding.code, "ol-too-many-inputs");
  assert.equal(finding.stage, "semantic");
  assert.equal(finding.severity, "error");
  assert.deepEqual(finding.params, {
    callable: "first",
    expected: 1,
    actual: 2,
  });
  assert.equal(finding.message, "first takes one input, but got 2.");
});

test("a parenthesized bounded-alternate primitive is judged against its ceiling, not its default", () => {
  // `random`'s bare default arity is 1, but `(random a b)` is a valid two-input alternate form.
  assert.deepEqual(checkSource("(random 1 5)"), []);
  const [finding] = checkSource("(random 1 2 3)");
  assert.deepEqual(finding.params, {
    callable: "random",
    expected: 2,
    actual: 3,
  });
});

test("an open-variadic primitive is never flagged too-many, however many inputs it gets", () => {
  assert.deepEqual(checkSource("(print 1 2 3 4)"), []);
  assert.deepEqual(checkSource('(word "a" "b" "c")'), []);
});

test("the lower bound of a parenthesized primitive call is left to the runtime (not flagged)", () => {
  // A parenthesized under-supply (`(power 1)`, `(first)`) is the runtime arity check's job (#97):
  // an open variadic's true minimum is not expressible in the default-arity table.
  assert.deepEqual(checkSource("(power 1)"), []);
  assert.deepEqual(checkSource("(first)"), []);
});

test("a parenthesized primitive call in the alternate/variadic form is never flagged", () => {
  // `first` is fixed-arity-1; a correct parenthesized call supplies exactly its arity.
  assert.deepEqual(checkSource('(print "x" 1)'), []);
  assert.deepEqual(checkSource("(first 1)"), []);
});

test("an unknown callee is left entirely to ol-unknown-command (no arity finding)", () => {
  // `nope` has no known arity, so the arity rule must not report it; only ol-unknown-command does.
  const diagnostics = checkSource("(nope 1 2)");
  assert.ok(
    diagnostics.every(
      (d) =>
        d.code !== "ol-not-enough-inputs" && d.code !== "ol-too-many-inputs",
    ),
    "the arity rule must not report an unknown callee",
  );
});

test("grammar operator calls carry no table arity, so are never flagged", () => {
  for (const source of [
    "print 1 + 2",
    "print 5 mod 2",
    "print true and false",
    "print not true",
    "print 1 < 2",
  ]) {
    const diagnostics = checkSource(source);
    assert.ok(
      diagnostics.every(
        (d) =>
          d.code !== "ol-not-enough-inputs" && d.code !== "ol-too-many-inputs",
      ),
      `expected no arity finding for ${JSON.stringify(source)}`,
    );
  }
});

test("a user procedure called with fewer than its required parameters raises too-few", () => {
  const source = "define f :a :b\n  print 1\nend\nf 1\n";
  const [finding] = checkSource(source);
  assert.equal(finding.code, "ol-not-enough-inputs");
  assert.deepEqual(finding.params, { callable: "f", expected: 2, actual: 1 });
});

test("a user procedure called (parenthesized) with more than its parameters raises too-many", () => {
  const source = "define f :a :b\n  print 1\nend\n(f 1 2 3)\n";
  const [finding] = checkSource(source);
  assert.equal(finding.code, "ol-too-many-inputs");
  assert.deepEqual(finding.params, { callable: "f", expected: 2, actual: 3 });
  assert.equal(finding.message, "f takes two inputs, but got 3.");
});

test("a user procedure with an optional parameter counts only the required floor", () => {
  // `g` requires `:a`; `:b` defaults. The optional argument arrives only via the paren form.
  const declare = "define g :a (:b 5)\n  print 1\nend\n";
  assert.deepEqual(checkSource(`${declare}g 1\n`), []); // required met
  assert.deepEqual(checkSource(`${declare}(g 1 2)\n`), []); // within [1, 2]
  const [tooFew] = checkSource(`${declare}(g)\n`);
  assert.deepEqual(tooFew.params, { callable: "g", expected: 1, actual: 0 });
  const [tooMany] = checkSource(`${declare}(g 1 2 3)\n`);
  assert.deepEqual(tooMany.params, { callable: "g", expected: 2, actual: 3 });
});

test("a later define of the same name overwrites the earlier arity", () => {
  const source =
    "define h :a\n  print 1\nend\ndefine h :a :b\n  print 1\nend\n(h 1)\n";
  // The second `h` requires two parameters, so `(h 1)` is now too-few against arity 2.
  const finding = checkSource(source).find(
    (d) => d.code === "ol-not-enough-inputs",
  );
  assert.ok(finding, "expected the later two-parameter arity to apply");
  assert.deepEqual(finding.params, { callable: "h", expected: 2, actual: 1 });
});

test("required-count messages spell small numbers but fall back to digits past ten", () => {
  const params = Array.from({ length: 11 }, (_, i) => `:p${i + 1}`).join(" ");
  const source = `define big ${params}\n  print 1\nend\nbig 1\n`;
  const [finding] = checkSource(source);
  assert.deepEqual(finding.params, {
    callable: "big",
    expected: 11,
    actual: 1,
  });
  assert.equal(finding.message, "big needs 11 inputs.");
});

test("the rule runs regardless of the active profile set (procedure arity is program-derived)", () => {
  // With no profiles active, `print` inside the body is unknown, but the user-procedure arity
  // check for `f` still fires — its arity comes from the program's own `define`, not a profile.
  const source = "define f :a :b\n  print 1\nend\nf 1\n";
  const diagnostics = OL.check(OL.parse(source, "unit.logo").ast, {
    profiles: [],
  }).diagnostics;
  assert.ok(
    diagnostics.some(
      (d) => d.code === "ol-not-enough-inputs" && d.params.callable === "f",
    ),
    "user-procedure arity is checked independent of profile gating",
  );
});
