// Black-box tests for the Layer-3 style-lint rules (issue #115 slice 1), exercising only the
// public `@openlogo/parser` surface: `parse()` + `check(ast, { style: true, ... })`. Every fixture
// here parses clean (no Layer-2 diagnostics) so the assertions isolate the style findings.

import assert from "node:assert/strict";
import { test } from "node:test";
import * as OL from "@openlogo/parser";

const doc = "style-lints.logo";

function checkStyle(source, profiles = ["core-language"]) {
  const { ast: program, diagnostics: parseDiagnostics } = OL.parse(source, doc);
  assert.deepEqual(parseDiagnostics, [], "expected the fixture to parse clean");
  return OL.check(program, { profiles, source, style: true }).diagnostics;
}

// --- ol-style-useless-value -------------------------------------------------------------------

test("ol-style-useless-value: reproduces the spec's worked example verbatim (repeat 4 [ :side * 2 ])", () => {
  const diagnostics = checkStyle(":side = 2\nrepeat 4 [ :side * 2 ]");
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].code, "ol-style-useless-value");
  assert.deepEqual(diagnostics[0].params, { form: "repeat" });
  assert.equal(diagnostics[0].severity, "warning");
  assert.equal(diagnostics[0].stage, "semantic");
});

test("ol-style-useless-value: a repeat body ending in a command is clean", () => {
  const diagnostics = checkStyle("repeat 4 [ print 1 ]");
  assert.deepEqual(diagnostics, []);
});

test("ol-style-useless-value: while/forever/for-in/for-range/if each report their own form", () => {
  const cases = [
    ["while :x == :x [ 1 ]", "while"],
    ["forever [ 1 ]", "forever"],
    ["for i in [1 2] [ :i ]", "for-in"],
    ["for i from 1 to 3 [ :i ]", "for-range"],
  ];
  for (const [source, form] of cases) {
    const diagnostics = checkStyle(source);
    const useless = diagnostics.filter(
      (d) => d.code === "ol-style-useless-value",
    );
    assert.equal(useless.length, 1, `expected one finding for: ${source}`);
    assert.deepEqual(useless[0].params, { form });
  }
});

test("ol-style-useless-value: if reports each discarding branch independently", () => {
  const diagnostics = checkStyle("if true [ 1 ] else [ 2 ]").filter(
    (d) => d.code === "ol-style-useless-value",
  );
  assert.equal(diagnostics.length, 2);
  assert.deepEqual(diagnostics[0].params, { form: "if" });
  assert.deepEqual(diagnostics[1].params, { form: "if" });
});

test("ol-style-useless-value: an if whose then-branch discards but whose else-branch acts reports once", () => {
  const diagnostics = checkStyle("if true [ 1 ] else [ print 2 ]").filter(
    (d) => d.code === "ol-style-useless-value",
  );
  assert.equal(diagnostics.length, 1);
});

test("ol-style-useless-value: an empty block body is clean (nothing to discard)", () => {
  const diagnostics = checkStyle("repeat 4 [ ]");
  assert.deepEqual(diagnostics, []);
});

test("ol-style-useless-value: a comprehension body is out of scope for this code (ol-no-value instead)", () => {
  const { ast: program, diagnostics: parseDiagnostics } = OL.parse(
    ":xs = [1 2 3]\n:ys = map n in :xs [ :n ]",
    doc,
  );
  assert.deepEqual(parseDiagnostics, []);
  const diagnostics = OL.check(program, {
    profiles: ["core-language"],
    style: true,
  }).diagnostics;
  assert.deepEqual(diagnostics, []);
});

// --- ol-style-equality-confusion --------------------------------------------------------------

test("ol-style-equality-confusion: a standalone == statement is flagged", () => {
  const diagnostics = checkStyle(":side_count = 4\n:side_count == 4");
  const found = diagnostics.filter(
    (d) => d.code === "ol-style-equality-confusion",
  );
  assert.equal(found.length, 1);
  assert.deepEqual(found[0].params, { operators: ["=="] });
  assert.equal(found[0].severity, "warning");
});

test("ol-style-equality-confusion: a standalone != statement is flagged", () => {
  const diagnostics = checkStyle(":x = 1\n:x != 2").filter(
    (d) => d.code === "ol-style-equality-confusion",
  );
  assert.equal(diagnostics.length, 1);
  assert.deepEqual(diagnostics[0].params, { operators: ["!="] });
});

test("ol-style-equality-confusion: a ComparisonChain mixing relational and == is flagged, reporting only the == operator", () => {
  const diagnostics = checkStyle("1 < 2 == 2").filter(
    (d) => d.code === "ol-style-equality-confusion",
  );
  assert.equal(diagnostics.length, 1);
  assert.deepEqual(diagnostics[0].params, { operators: ["=="] });
});

test("ol-style-equality-confusion: a standalone purely-relational ComparisonChain (no ==/!=) is not flagged", () => {
  // `1 < 2 < 3` cannot plausibly be an `=` assignment typo -- there is no equality operator
  // to have been mistyped, so this must not suggest "did you mean to assign with =?".
  const diagnostics = checkStyle("1 < 2 < 3");
  assert.deepEqual(diagnostics, []);
});

test("ol-style-equality-confusion: == used correctly as a condition is not flagged", () => {
  const diagnostics = checkStyle(':x = 1\nif :x == 1 [ print "yes" ]');
  assert.deepEqual(diagnostics, []);
});

test("ol-style-equality-confusion: == used as a call argument (not statement position) is not flagged", () => {
  const diagnostics = checkStyle(":x = 1\nprint :x == 1");
  assert.deepEqual(diagnostics, []);
});

test("ol-style-equality-confusion: a single non-equality comparison (<, >, <=, >=) is not flagged", () => {
  const diagnostics = checkStyle("1 < 2");
  assert.deepEqual(diagnostics, []);
});

test("ol-style-equality-confusion: an == statement nested inside a repeat block is still flagged", () => {
  const diagnostics = checkStyle(":x = 1\nrepeat 2 [ :x == 1 ]").filter(
    (d) => d.code === "ol-style-equality-confusion",
  );
  assert.equal(diagnostics.length, 1);
});

// --- ol-style-name-case ------------------------------------------------------------------------

test("ol-style-name-case: a snake_case variable read/assignment is clean", () => {
  const diagnostics = checkStyle(":side_length = 100\nprint :side_length");
  assert.deepEqual(diagnostics, []);
});

test("ol-style-name-case: a camelCase variable is flagged at its read AND its assignment place", () => {
  const diagnostics = checkStyle(":sideLength = 100\nprint :sideLength").filter(
    (d) => d.code === "ol-style-name-case",
  );
  assert.equal(diagnostics.length, 2);
  assert.deepEqual(diagnostics[0].params, { name: "sideLength" });
  assert.deepEqual(diagnostics[1].params, { name: "sideLength" });
});

test("ol-style-name-case: an UPPERCASE place field name is flagged", () => {
  // The lexer's identifier grammar has no hyphen (`turn-angle` would tokenize as `turn - angle`,
  // a subtraction), so "hyphenated" is not a reachable name-case violation for any single
  // identifier token; UPPERCASE is the reachable field-name violation this rule covers instead.
  const diagnostics = checkStyle(":person = 1\nprint :person.TurnAngle").filter(
    (d) => d.code === "ol-style-name-case",
  );
  assert.equal(diagnostics.length, 1);
  assert.deepEqual(diagnostics[0].params, { name: "TurnAngle" });
});

test("ol-style-name-case: an UPPERCASE field name on a PostfixExpression base is flagged (issue #407/F7)", () => {
  const diagnostics = checkStyle("print { tom: 8 }.TomAge", [
    "core-language",
    "data",
  ]).filter((d) => d.code === "ol-style-name-case");
  assert.equal(diagnostics.length, 1);
  assert.deepEqual(diagnostics[0].params, { name: "TomAge" });
});

test("ol-style-name-case: an UPPERCASE procedure name and its params are each flagged", () => {
  const diagnostics = checkStyle(
    "define DrawSquare :Size\n  print :Size\nend",
  ).filter((d) => d.code === "ol-style-name-case");
  const names = diagnostics.map((d) => d.params.name);
  assert.ok(names.includes("DrawSquare"));
  assert.ok(names.includes("Size"));
});

test("ol-style-name-case: a trailing ? or ! is allowed", () => {
  const diagnostics = checkStyle("define is_ready?\n  return true\nend");
  assert.deepEqual(diagnostics, []);
});

test("ol-style-name-case: a bad local declaration name is flagged", () => {
  const diagnostics = checkStyle("define f\n  local myVar\nend").filter(
    (d) => d.code === "ol-style-name-case",
  );
  assert.ok(diagnostics.some((d) => d.params.name === "myVar"));
});

test("ol-style-name-case: a bad for-in binder is flagged", () => {
  const diagnostics = checkStyle(
    "for myItem in [1 2] [ print :myItem ]",
  ).filter((d) => d.code === "ol-style-name-case");
  assert.ok(diagnostics.some((d) => d.params.name === "myItem"));
});

test("ol-style-name-case: a bad for-in destructuring binder name is flagged", () => {
  const diagnostics = checkStyle(
    "for [:goodName :other] in [[1 2]] [ print :goodName ]",
  ).filter((d) => d.code === "ol-style-name-case");
  assert.ok(diagnostics.some((d) => d.params.name === "goodName"));
});

test("ol-style-name-case: a bad for-range variable is flagged", () => {
  const diagnostics = checkStyle(
    "for badVar from 1 to 3 [ print :badVar ]",
  ).filter((d) => d.code === "ol-style-name-case");
  assert.ok(diagnostics.some((d) => d.params.name === "badVar"));
});

test("ol-style-name-case: bad map/reduce comprehension binder and accumulator names are flagged", () => {
  const mapDiagnostics = checkStyle(
    ":xs = [1 2]\n:ys = map badItem in :xs [ :badItem ]",
  ).filter((d) => d.code === "ol-style-name-case");
  assert.ok(mapDiagnostics.some((d) => d.params.name === "badItem"));

  const reduceDiagnostics = checkStyle(
    ":xs = [1 2]\n:total = reduce badSum n in :xs from 0 [ :badSum + :n ]",
  ).filter((d) => d.code === "ol-style-name-case");
  assert.ok(reduceDiagnostics.some((d) => d.params.name === "badSum"));
});

test("ol-style-name-case: a bad map destructuring binder name is flagged at its declaration and each read (not silently skipped)", () => {
  const diagnostics = checkStyle(
    ":pairs = [[1 2]]\n:ys = map [:badX :y] in :pairs [ :badX + :y ]",
  ).filter((d) => d.code === "ol-style-name-case");
  // One finding at the destructuring binder's own declaration, one at its later read — mirroring
  // how a plain camelCase variable is flagged at both its assignment and its read.
  assert.equal(diagnostics.length, 2);
  assert.ok(diagnostics.every((d) => d.params.name === "badX"));
});

test("ol-style-name-case: a short lowercase loop binder like `i` is clean", () => {
  const diagnostics = checkStyle("for i from 1 to 4 [ print :i ]");
  assert.deepEqual(diagnostics, []);
});

test("ol-style-name-case: a user procedure/unresolved callee name is out of scope for this rule (not checked)", () => {
  // `badCallee` would be an ol-unknown-command Layer-2 error, not a style warning here — but the
  // point of this test is that a callee spelling that is NOT a known Core primitive/command is
  // never checked for name-case, regardless of whether it resolves; only declaration/reference
  // *identifier* sites (and known-primitive callees, see the next test) are.
  const { ast: program } = OL.parse("badCallee 1", doc);
  const diagnostics = OL.check(program, {
    profiles: ["core-language"],
    style: true,
  }).diagnostics.filter((d) => d.code === "ol-style-name-case");
  assert.deepEqual(diagnostics, []);
});

test("ol-style-name-case: a known Core primitive/command callee IS checked for name-case", () => {
  // `spec/style-guide.md` "Keywords are lowercase" covers primitive casing under this same code —
  // `PRINT` is a known Core command spelling, so its non-lowercase callee use is flagged. Word
  // operators like `mod`/`and`/`or`/`not` are excluded on purpose: the parser normalizes their
  // callee spelling to canonical lowercase regardless of source casing (see checker-style.ts's
  // `CORE_CALLEE_NAMES` doc comment), so a non-lowercase source spelling never reaches this rule.
  const { ast: program, diagnostics: parseDiagnostics } = OL.parse(
    "PRINT 1",
    doc,
  );
  assert.deepEqual(parseDiagnostics, []);
  const diagnostics = OL.check(program, {
    profiles: ["core-language"],
    style: true,
  }).diagnostics.filter((d) => d.code === "ol-style-name-case");
  assert.deepEqual(
    diagnostics.map((d) => d.params.name),
    ["PRINT"],
  );
});

test("ol-style-name-case: a non-lowercase structural keyword is flagged for every control/define form", () => {
  // `spec/style-guide.md` "Keywords are lowercase" explicitly names `REPEAT`/`Define` as the
  // avoided spelling in its own quick-checklist row, checked by this same code. One fixture per
  // `STRUCTURAL_KEYWORD` entry (If, While, Repeat, Forever, ForIn, ForRange, ProcedureDef, Return,
  // Stop, Throw), plus one per `map`/`filter`/`reduce` comprehension form.
  const cases = [
    ["IF 1 == 1 [ print 1 ]", "IF"],
    ["WHILE 1 == 1 [ stop ]", "WHILE"],
    ["REPEAT 4 [ print 1 ]", "REPEAT"],
    // `forever` needs a `stop` so the harness's own program terminates; irrelevant to this rule.
    ["Forever [ stop ]", "Forever"],
    ["FOR i in [ 1 2 3 ] [ print :i ]", "FOR"],
    ["For i from 1 to 4 [ print :i ]", "For"],
    ["DEFINE f\n  return 1\nend", "DEFINE"],
    ["define f\n  RETURN 1\nend", "RETURN"],
    ["define f\n  STOP\nend", "STOP"],
    ["define f\n  THROW 1\nend", "THROW"],
    [":xs = [1 2 3]\n:ys = MAP n in :xs [ :n ]", "MAP"],
    [":xs = [1 2 3]\n:ys = FILTER n in :xs [ :n ]", "FILTER"],
    [
      ":xs = [1 2 3]\n:total = REDUCE acc n in :xs from 0 [ :acc + :n ]",
      "REDUCE",
    ],
  ];
  for (const [source, expectedName] of cases) {
    const { ast: program, diagnostics: parseDiagnostics } = OL.parse(
      source,
      doc,
    );
    assert.deepEqual(parseDiagnostics, [], `expected ${source} to parse clean`);
    const diagnostics = OL.check(program, {
      profiles: ["core-language"],
      source,
      style: true,
    }).diagnostics.filter((d) => d.code === "ol-style-name-case");
    assert.deepEqual(
      diagnostics.map((d) => d.params.name),
      [expectedName],
      `expected only the ${expectedName} keyword to be flagged in: ${source}`,
    );
  }
});

test("ol-style-name-case: an already-lowercase structural keyword is clean", () => {
  const source = "repeat 4\n  print 1\nend repeat";
  const { ast: program } = OL.parse(source, doc);
  const diagnostics = OL.check(program, {
    profiles: ["core-language"],
    source,
    style: true,
  }).diagnostics;
  assert.deepEqual(diagnostics, []);
});

test("ol-style-name-case: keyword casing is silently skipped when no source text is supplied", () => {
  // `checkKeywordCasing` needs the raw source to recover a keyword's own literal spelling (no
  // `ast.ts` node records it) — without `source`, this sub-check is a no-op, not a false positive
  // or a thrown error.
  const { ast: program } = OL.parse("REPEAT 4 [ print 1 ]", doc);
  const diagnostics = OL.check(program, {
    profiles: ["core-language"],
    style: true,
  }).diagnostics;
  assert.deepEqual(diagnostics, []);
});

test("ol-style-name-case: local's own keyword casing is deliberately not checked (bare or paren form)", () => {
  // `local` is excluded from `STRUCTURAL_KEYWORD` on purpose: its node span starts at the `local`
  // token in the bare form but at the *opening paren* in `(local name …)`, and the AST does not
  // record which surface form was parsed — so a blind span-start slice could misread the paren
  // form. Both forms below are proven silently clean (not a false positive), and the gap is
  // tracked in the #115 follow-up rather than guessed at.
  for (const source of ["LOCAL badName\nprint 1", "(LOCAL badName)\nprint 1"]) {
    const { ast: program, diagnostics: parseDiagnostics } = OL.parse(
      source,
      doc,
    );
    assert.deepEqual(parseDiagnostics, [], `expected ${source} to parse clean`);
    const diagnostics = OL.check(program, {
      profiles: ["core-language"],
      source,
      style: true,
    }).diagnostics.filter((d) => d.code === "ol-style-name-case");
    // `badName` is still flagged as a user identifier (checkNamesIn's "Local" case); only the
    // keyword's own casing is out of scope here.
    assert.deepEqual(
      diagnostics.map((d) => d.params.name),
      ["badName"],
      `expected only the user name to be flagged in: ${source}`,
    );
  }
});

// --- ol-style-magic-number ---------------------------------------------------------------------

test("ol-style-magic-number: a repeated bare literal outside the safe set is flagged at every occurrence", () => {
  const diagnostics = checkStyle("print 37\nprint 37").filter(
    (d) => d.code === "ol-style-magic-number",
  );
  assert.equal(diagnostics.length, 2);
  assert.deepEqual(diagnostics[0].params, { value: 37 });
  assert.deepEqual(diagnostics[1].params, { value: 37 });
  assert.equal(diagnostics[0].severity, "warning");
  assert.equal(diagnostics[0].stage, "semantic");
});

test('ol-style-magic-number: a single occurrence is not "repeated" and is left clean', () => {
  assert.deepEqual(checkStyle("print 37"), []);
});

test("ol-style-magic-number: the safe/idiomatic set (0, 1, 2, 4, 90, 120, 360) is never flagged even when repeated", () => {
  assert.deepEqual(checkStyle("print 90\nprint 90\nprint 360\nprint 360"), []);
});

test("ol-style-magic-number: a literal used directly as an assignment's right-hand side is excluded, even when repeated elsewhere", () => {
  // Only the bare `print 37` occurrence counts; `:radius = 37`'s literal is already named by the
  // assignment, so it neither counts toward the repetition nor is itself reported. Since only one
  // *unexcluded* occurrence remains, this is not "repeated" and nothing is flagged.
  assert.deepEqual(checkStyle(":radius = 37\nprint 37"), []);
});

test("ol-style-magic-number: set ... to's right-hand side is likewise excluded from the count", () => {
  const diagnostics = checkStyle("set radius to 37\nprint 37\nprint 37").filter(
    (d) => d.code === "ol-style-magic-number",
  );
  assert.equal(diagnostics.length, 2);
  assert.deepEqual(diagnostics[0].params, { value: 37 });
});

// --- ol-style-predicate-name ------------------------------------------------------------------

test("ol-style-predicate-name: a procedure whose every return is a comparison but whose name lacks ? is flagged", () => {
  const diagnostics = checkStyle(
    "define is_ready :x\n  return :x == 1\nend",
  ).filter((d) => d.code === "ol-style-predicate-name");
  assert.equal(diagnostics.length, 1);
  assert.deepEqual(diagnostics[0].params, {
    name: "is_ready",
    problem: "missing-suffix",
  });
  assert.equal(diagnostics[0].severity, "warning");
  assert.equal(diagnostics[0].stage, "semantic");
});

test("ol-style-predicate-name: a procedure whose return is a boolean literal but whose name lacks ? is flagged", () => {
  const diagnostics = checkStyle("define done\n  return true\nend").filter(
    (d) => d.code === "ol-style-predicate-name",
  );
  assert.equal(diagnostics.length, 1);
  assert.deepEqual(diagnostics[0].params, {
    name: "done",
    problem: "missing-suffix",
  });
});

test("ol-style-predicate-name: a procedure already ending in ? whose return is boolean is clean", () => {
  assert.deepEqual(
    checkStyle("define is_ready? :x\n  return :x == 1\nend"),
    [],
  );
});

test("ol-style-predicate-name: a procedure ending in ? with no return at all is flagged as misleading", () => {
  const diagnostics = checkStyle("define draw?\n  print 1\nend").filter(
    (d) => d.code === "ol-style-predicate-name",
  );
  assert.equal(diagnostics.length, 1);
  assert.deepEqual(diagnostics[0].params, {
    name: "draw?",
    problem: "misleading-suffix",
  });
});

test("ol-style-predicate-name: a procedure ending in ? that returns a number is flagged as misleading", () => {
  const diagnostics = checkStyle("define count?\n  return 1\nend").filter(
    (d) => d.code === "ol-style-predicate-name",
  );
  assert.equal(diagnostics.length, 1);
  assert.deepEqual(diagnostics[0].params, {
    name: "count?",
    problem: "misleading-suffix",
  });
});

test("ol-style-predicate-name: a procedure returning an unclassifiable expression (a variable) is left unflagged either way", () => {
  assert.deepEqual(checkStyle("define pick :flag\n  return :flag\nend"), []);
  assert.deepEqual(checkStyle("define pick? :flag\n  return :flag\nend"), []);
});

test("ol-style-predicate-name: returns belonging to a nested procedure are never attributed to the outer one", () => {
  // The outer `wrapper` procedure's own body has no `return` of its own (only a nested
  // `ProcedureDef` with its own `return`), so it must not be judged by the inner one's shape.
  const diagnostics = checkStyle(
    "define wrapper\n  define inner\n    return true\n  end\n  print 1\nend",
  ).filter((d) => d.code === "ol-style-predicate-name");
  // The nested `inner` procedure's own name (`inner`, no `?`, its only return is boolean) is
  // still flagged on its own merits; `wrapper` (no returns of its own) is not.
  assert.equal(diagnostics.length, 1);
  assert.deepEqual(diagnostics[0].params, {
    name: "inner",
    problem: "missing-suffix",
  });
});

test("ol-style-predicate-name: a plain command procedure with no return and no ? suffix is clean", () => {
  assert.deepEqual(checkStyle("define draw\n  print 1\nend"), []);
});

// --- ol-style-one-command-per-line ---------------------------------------------------------

test("ol-style-one-command-per-line: two commands sharing a line inside a multi-line bracket block are flagged, once per offending line", () => {
  const diagnostics = checkStyle(
    "repeat 4 [\n  print 1  print 2\n  print 3  print 4\n]",
  ).filter((d) => d.code === "ol-style-one-command-per-line");
  assert.equal(diagnostics.length, 2);
  assert.deepEqual(diagnostics[0].params, { count: 2 });
  assert.deepEqual(diagnostics[1].params, { count: 2 });
  assert.equal(diagnostics[0].severity, "warning");
  assert.equal(diagnostics[0].stage, "semantic");
});

test("ol-style-one-command-per-line: a deliberately short one-line bracket block is exempt", () => {
  assert.deepEqual(checkStyle("repeat 4 [ print 1  print 2 ]"), []);
});

test("ol-style-one-command-per-line: a multi-line block with one command per line is clean", () => {
  assert.deepEqual(
    checkStyle("repeat 4 [\n  print 1\n  print 2\n]").filter(
      (d) => d.code === "ol-style-one-command-per-line",
    ),
    [],
  );
});

// --- ol-style-deep-nesting -------------------------------------------------------------------

test("ol-style-deep-nesting: reproduces the spec's own bad example (repeat > if > repeat, 3 levels)", () => {
  const diagnostics = checkStyle(
    "repeat 4\n  if true\n    repeat 3\n      print 1\n    end repeat\n  end if\nend repeat",
  ).filter((d) => d.code === "ol-style-deep-nesting");
  assert.equal(diagnostics.length, 1);
  assert.deepEqual(diagnostics[0].params, { form: "repeat", depth: 3 });
  assert.equal(diagnostics[0].severity, "warning");
  assert.equal(diagnostics[0].stage, "semantic");
});

test("ol-style-deep-nesting: two levels of nesting is clean", () => {
  assert.deepEqual(
    checkStyle("repeat 4\n  if true\n    print 1\n  end if\nend repeat"),
    [],
  );
});

test("ol-style-deep-nesting: a nested procedure's own body starts a fresh depth, never inheriting its caller's nesting", () => {
  // `inner` is defined two control-forms deep inside `outer`, but its own body (repeat > if,
  // 2 levels) never reaches the threshold on its own merits, so nothing is flagged despite the
  // combined textual nesting being deeper than 3.
  const diagnostics = checkStyle(
    "define outer\n  repeat 4\n    if true\n      define inner\n        repeat 3\n          if true\n            print 1\n          end if\n        end repeat\n      end define\n      inner\n      print 2\n    end if\n  end repeat\nend define",
  );
  assert.deepEqual(diagnostics, []);
});

// --- ol-style-block-indentation --------------------------------------------------------------

test("ol-style-block-indentation: a statement indented differently from its siblings is flagged", () => {
  const diagnostics = checkStyle(
    "repeat 4\n  print 1\n   print 2\nend repeat",
  ).filter((d) => d.code === "ol-style-block-indentation");
  assert.equal(diagnostics.length, 1);
  assert.deepEqual(diagnostics[0].params, { expected: 3, found: 4 });
  assert.equal(diagnostics[0].severity, "warning");
  assert.equal(diagnostics[0].stage, "semantic");
});

test("ol-style-block-indentation: consistently indented sibling statements are clean", () => {
  assert.deepEqual(
    checkStyle("repeat 4\n  print 1\n  print 2\nend repeat"),
    [],
  );
});

test("ol-style-block-indentation: with three distinct columns, the majority column is the baseline and both minority columns are flagged", () => {
  const diagnostics = checkStyle(
    "repeat 4\n  print 1\n  print 2\n   print 3\n    print 4\nend repeat",
  ).filter((d) => d.code === "ol-style-block-indentation");
  assert.equal(diagnostics.length, 2);
  assert.deepEqual(diagnostics[0].params, { expected: 3, found: 4 });
  assert.deepEqual(diagnostics[1].params, { expected: 3, found: 5 });
});

test("ol-style-block-indentation: a column-count tie breaks toward whichever column was seen first", () => {
  // Two statements at column 3, two at column 12 (one per line, from the same source that also
  // exercises ol-style-one-command-per-line) — the tie must resolve to the first-seen column (3),
  // so the two column-12 statements are flagged and the two column-3 statements are not.
  const diagnostics = checkStyle(
    "repeat 4 [\n  print 1  print 2\n  print 3  print 4\n]",
  ).filter((d) => d.code === "ol-style-block-indentation");
  assert.equal(diagnostics.length, 2);
  assert.deepEqual(diagnostics[0].params, { expected: 3, found: 12 });
  assert.deepEqual(diagnostics[1].params, { expected: 3, found: 12 });
});

test("ol-style-block-indentation: a block with fewer than two statements has nothing to compare and is never flagged", () => {
  assert.deepEqual(checkStyle("repeat 4\n  print 1\nend repeat"), []);
});

// --- ol-style-prefer-block --------------------------------------------------------------------

test("ol-style-prefer-block: a multi-line bracket-form control body is flagged", () => {
  const diagnostics = checkStyle("repeat 4 [\n  print 1\n  print 2\n]").filter(
    (d) => d.code === "ol-style-prefer-block",
  );
  assert.equal(diagnostics.length, 1);
  assert.deepEqual(diagnostics[0].params, { form: "repeat" });
  assert.equal(diagnostics[0].severity, "warning");
  assert.equal(diagnostics[0].stage, "semantic");
});

test("ol-style-prefer-block: a single-line bracket block is exempt", () => {
  assert.deepEqual(checkStyle("repeat 4 [ print 1  print 2 ]"), []);
});

test("ol-style-prefer-block: a multi-line … end block is already the recommended form and is not flagged", () => {
  assert.deepEqual(
    checkStyle("repeat 4\n  print 1\n  print 2\nend repeat"),
    [],
  );
});

test("ol-style-prefer-block: an empty bracket block is never flagged (nothing to migrate)", () => {
  assert.deepEqual(checkStyle("repeat 4 [ ]"), []);
});

test("ol-style-prefer-block: both branches of an if are checked independently", () => {
  const diagnostics = checkStyle(
    "if true [\n  print 1\n  print 2\n] else [\n  print 3\n  print 4\n]",
  ).filter((d) => d.code === "ol-style-prefer-block");
  assert.equal(diagnostics.length, 2);
  assert.deepEqual(diagnostics[0].params, { form: "if" });
  assert.deepEqual(diagnostics[1].params, { form: "if" });
});

test("ol-style-prefer-block: a comprehension body is never flagged, since it can only ever be a bracket block", () => {
  assert.deepEqual(
    checkStyle(":xs = [1 2 3]\n:ys = map n in :xs [ :n * 2 ]"),
    [],
  );
});

test("ol-style-prefer-block: an … end block whose first statement is itself a bare list literal is not flagged", () => {
  // Regression guard: `isBracketBlock` must key off `block`'s own *closing* delimiter, never its
  // first statement's span. A start-based comparison would misread this block as bracket-form,
  // since a bare `[1 2 3]` list-literal statement's own span happens to start with `[` — exactly
  // the same leading character a real bracket block's span starts with.
  assert.deepEqual(
    checkStyle("repeat 4\n  [1 2 3]\n  print 1\nend repeat"),
    [],
  );
});

test("ol-style-prefer-block: an empty multi-line bracket block is flagged (it is still bracket-form)", () => {
  const diagnostics = checkStyle("repeat 4 [\n]").filter(
    (d) => d.code === "ol-style-prefer-block",
  );
  assert.equal(diagnostics.length, 1);
  assert.deepEqual(diagnostics[0].params, { form: "repeat" });
});

test("ol-style-prefer-block: silently skipped (never a false positive) when no source text is supplied", () => {
  // Mirrors `ol-style-name-case`'s own "no source, skip" precedent: `isBracketBlock` has no
  // AST-only proxy for a block's own literal closing text, so a bracket-form determination is
  // never attempted without `source` — this must stay a no-op, not a false positive.
  const { ast: program } = OL.parse("repeat 4 [\n  print 1\n  print 2\n]", doc);
  const diagnostics = OL.check(program, {
    profiles: ["core-language"],
    style: true,
  }).diagnostics;
  assert.deepEqual(diagnostics, []);
});

// --- opt-in gating -------------------------------------------------------------------------

test("check() never runs style lints unless options.style === true", () => {
  const { ast: program } = OL.parse(":X = 1", doc);
  const diagnostics = OL.check(program, {
    profiles: ["core-language"],
  }).diagnostics;
  assert.deepEqual(diagnostics, []);
});
