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
  // keyword `structuralKeywordFor` resolves: the static `STRUCTURAL_KEYWORD` entries (If, While,
  // Repeat, Forever, ForIn, ForRange, Stop, Throw) plus its three dynamic cases — `ProcedureDef`
  // and `Return`, which read their own surface spelling since Heritage gave each a second
  // legitimate one (issue #737), and one per `map`/`filter`/`reduce` comprehension form.
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

test("ol-style-name-case: local's own keyword casing stays deliberately unchecked (bare or paren form)", () => {
  // `local` is exempt in `NON_KEYWORD_SPAN_START_KINDS` on purpose, and issue #854 says so in as
  // many words ("`LOCAL` being silent is not a bug"). Its node span starts at the `local` token in
  // the bare form but at the *opening paren* in `(local name …)`, and the AST does not record
  // which surface form was written, so judging one and not the other would be an inconsistency a
  // learner cannot predict. Widening it belongs to the #115 follow-up.
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
    // Whatever else is true, no form may report a truncated slice of the keyword: reading a whole
    // word (rather than a fixed-length slice) is what makes `(loca` structurally unreachable.
    for (const diagnostic of diagnostics) {
      assert.ok(
        !diagnostic.params.name.startsWith("("),
        `a delimiter must never be reported as a name: ${diagnostic.params.name}`,
      );
    }
  }
});

// --- ol-style-name-case: built-ins are derived from the registries (issue #854) -----------------

const ALL_PROFILES = [
  "core-language",
  "turtle-rendering",
  "data",
  "heritage",
  "sprites",
  "interaction-events",
  "sound",
  "educational",
  "geometry",
];

/** The `ol-style-name-case` names reported for `source`, in report order. */
function nameCaseNames(source, profiles = ALL_PROFILES) {
  return checkStyle(source, profiles)
    .filter((d) => d.code === "ol-style-name-case")
    .map((d) => d.params.name);
}

test("ol-style-name-case: every silent row of issue #854's reported table now warns", () => {
  // The defect table verbatim. The first three rows already warned before #854 and must keep
  // warning (a widening must not trade one gap for another); the last four were silent, which is
  // the bug: `spec/tooling.md:241` requires that "built-ins should be shown lowercase", and
  // `forward` is the first command a learner ever types.
  const cases = [
    ["TO f\nreturn 1\nend", ["TO"]],
    ["define f\nOUTPUT 5\nend", ["OUTPUT"]],
    ['PRINT "hi"', ["PRINT"]],
    ['MAKE "x" 1', ["MAKE"]],
    [':d = { a: 1 }\nprint VALUE of :d for key "a"', ["VALUE"]],
    ["FORWARD 100", ["FORWARD"]],
    ["FD 100", ["FD"]],
  ];
  for (const [source, expected] of cases) {
    assert.deepEqual(
      nameCaseNames(source),
      expected,
      `expected ${JSON.stringify(expected)} in: ${source}`,
    );
  }
});

test("ol-style-name-case: EVERY Heritage alias is covered, driven by the registry itself", () => {
  // The point of #854 is not that `MAKE` and `FD` were added to a list — it is that there is no
  // list. This test names no spelling of its own: it iterates the registry
  // (`heritageAliasNames()` + `heritageFormHeadNames()` + `heritageWordedFormHeads()` are exactly
  // what `heritageSurfaceSpellings()` unions) and requires the lint to cover every entry. A
  // spelling added to any of those three tables later joins this assertion automatically, so a
  // hand-added entry could not make this pass while the derivation was broken.
  const spellings = OL.heritageSurfaceSpellings();
  assert.ok(spellings.length > 0, "the Heritage registry must not be empty");
  assert.deepEqual(
    [...spellings].sort(),
    [
      ...OL.heritageAliasNames(),
      ...OL.heritageFormHeadNames(),
      ...OL.heritageWordedFormHeads(),
    ].sort(),
    "heritageSurfaceSpellings() must stay the union of the three Heritage tables",
  );
  for (const spelling of OL.heritageAliasNames()) {
    // A paren call takes any number of inputs, so one shape covers every alias regardless of arity.
    const source = `(${spelling.toUpperCase()})`;
    assert.deepEqual(
      nameCaseNames(source),
      [spelling.toUpperCase()],
      `expected the Heritage alias ${spelling} to be casing-linted`,
    );
    assert.deepEqual(
      nameCaseNames(`(${spelling})`),
      [],
      `expected the lowercase Heritage alias ${spelling} to be clean`,
    );
  }
  for (const head of OL.heritageFormHeadNames()) {
    assert.ok(
      OL.isKeyword(head),
      `the Heritage form head ${head} must reach the lint through the keyword registry`,
    );
  }
});

test("ol-style-name-case: EVERY Heritage form head is covered, driven by the registry itself", () => {
  // The alias test above proves the short aliases; this proves the four FORM heads by lint
  // behaviour rather than by registry membership alone. The program table is keyed by head, and
  // the assertion below requires it to cover exactly `heritageFormHeadNames()` — so a head added
  // to the registry later fails this test until it is genuinely exercised, rather than silently
  // going unchecked.
  const programByHead = {
    make: ['MAKE "x" 1', "MAKE"],
    to: ["TO f\nreturn 1\nend", "TO"],
    output: ["define f\nOUTPUT 5\nend", "OUTPUT"],
    op: ["define f\nOP 5\nend", "OP"],
  };
  assert.deepEqual(
    Object.keys(programByHead).sort(),
    [...OL.heritageFormHeadNames()].sort(),
    "every Heritage form head must have a program exercising its casing",
  );
  for (const head of OL.heritageFormHeadNames()) {
    const [source, expected] = programByHead[head];
    assert.deepEqual(
      nameCaseNames(source),
      [expected],
      `expected the Heritage form head ${head} to be casing-linted`,
    );
  }
});

test("ol-style-name-case: the canonical name behind every Heritage alias is covered too", () => {
  // The strongest available registry-driven proof that the fix is not a longer list. This test
  // names no primitive of its own: it resolves each alias to its canonical through
  // `canonicalOfHeritageAlias()`, which yields a set spanning BOTH tiers of the defect — Core
  // (`print`, `butfirst`, `sentence`) and Turtle & Rendering (`forward`, `back`, `clear_screen`,
  // `pen_up`, …). `PRINT` warned before #854 and `FORWARD` did not; both must warn now, and a
  // canonical added to the registry later joins this assertion automatically.
  const canonicals = [
    ...new Set(
      OL.heritageAliasNames().map((alias) =>
        OL.canonicalOfHeritageAlias(alias),
      ),
    ),
  ];
  assert.ok(canonicals.length > 0, "the alias registry must not be empty");
  for (const canonical of canonicals) {
    assert.notEqual(
      canonical,
      undefined,
      "every alias must resolve to a canonical",
    );
    assert.deepEqual(
      nameCaseNames(`(${canonical.toUpperCase()})`),
      [canonical.toUpperCase()],
      `expected the canonical ${canonical} to be casing-linted`,
    );
    assert.deepEqual(
      nameCaseNames(`(${canonical})`),
      [],
      `expected the lowercase canonical ${canonical} to be clean`,
    );
  }
});

test("ol-style-name-case: optional-profile primitives are covered through the shared arity registry", () => {
  // Each name here is asserted to be *in* its profile's arity table before its casing is checked,
  // so the test fails if a primitive is renamed or dropped rather than silently checking a word
  // that no longer exists. These are the profiles `CORE_CALLEE_NAMES` skipped entirely.
  const cases = [
    ["forward", OL.turtlePrimitiveArity],
    ["home", OL.turtlePrimitiveArity],
    ["pen_up", OL.turtlePrimitiveArity],
    ["play", OL.soundPrimitiveArity],
    ["new_turtle", OL.spritesPrimitiveArity],
    ["wait", OL.interactionPrimitiveArity],
    ["measure", OL.geometryPrimitiveArity],
    ["explain", OL.educationalPrimitiveArity],
    ["type_of", OL.dataPrimitiveArity],
  ];
  for (const [name, arityOf] of cases) {
    assert.notEqual(
      arityOf(name),
      undefined,
      `${name} must be registered in its profile's arity table`,
    );
    assert.deepEqual(
      nameCaseNames(`(${name.toUpperCase()})`),
      [name.toUpperCase()],
      `expected the primitive ${name} to be casing-linted`,
    );
  }
});

test("ol-style-name-case: the Tutor profile's challenge is absorbed by derivation, with no edit here", () => {
  // The live proof that this rule fails CLOSED rather than enumerating. When #854 was written,
  // `challenge` was the one built-in name with no registry at all, so `CHALLENGE` earned no casing
  // warning and the gap was documented as one this rule could not reach. #838 then registered
  // `TUTOR_PRIMITIVE_ARITY` in `PROFILE_PRIMITIVE_ARITY_TABLES`, and the coverage appeared with no
  // change to `checker-style.ts` — the same absorption #885's `NON_PRIMARY_NAMES` showed when #837
  // added `mod`.
  //
  // Asserting the registry membership FIRST is what makes this a derivation test rather than a
  // spelling test: if the Tutor table were dropped, this fails at the registry assertion instead of
  // quietly checking a word nothing registers.
  assert.notEqual(
    OL.tutorPrimitiveArity("challenge"),
    undefined,
    "challenge must be registered in the Tutor arity table",
  );
  assert.deepEqual(
    nameCaseNames("CHALLENGE", ["core-language", "educational", "tutor-ai"]),
    ["CHALLENGE"],
  );
  assert.deepEqual(
    nameCaseNames("challenge", ["core-language", "educational", "tutor-ai"]),
    [],
  );
  // And it is profile-blind like every other built-in: casing is a question about the name, not
  // about whether the profile that makes it run is active.
  assert.deepEqual(nameCaseNames("CHALLENGE", ["core-language"]), [
    "CHALLENGE",
  ]);
});

test("ol-style-name-case: keyword-headed statements the node-kind table never reached are covered", () => {
  // `Assign` and `ValueOfKey` were the two gaps issue #854 reported; `Add`/`Remove`/`Insert`/
  // `Clear`/`StructDef` and the profile block-heads were never in the table either and were silent
  // for the same reason. Reading the word at the span start reaches all of them at once.
  const cases = [
    ['MAKE "x" 1', ["MAKE"]],
    ["SET x to 1", ["SET"]],
    [":xs = [1 2]\nADD 3 to :xs", ["ADD"]],
    [":xs = [1 2]\nREMOVE 1 from :xs", ["REMOVE"]],
    [":xs = [1 2]\nINSERT 9 in :xs at 2", ["INSERT"]],
    [":xs = [1 2]\nCLEAR :xs", ["CLEAR"]],
    ["STRUCT point [ x y ]", ["STRUCT"]],
    ["TELL 1\nforward 10", ["TELL"]],
    ["ASK 1 [ forward 10 ]", ["ASK"]],
    ['ON_KEY "a" [ forward 10 ]', ["ON_KEY"]],
    ["EVERY 1 [ forward 10 ]", ["EVERY"]],
  ];
  for (const [source, expected] of cases) {
    assert.deepEqual(
      nameCaseNames(source),
      expected,
      `expected ${JSON.stringify(expected)} in: ${source}`,
    );
  }
});

test("ol-style-name-case: a prefix word-operator is caught, an infix one is not — pinned, not assumed", () => {
  // A consequence of judging a node's OWN span start, worth pinning because it is asymmetric and a
  // reader could reasonably expect otherwise. `not` is prefix, so its `Call` node's span starts at
  // the operator word and the casing is judged. `mod`/`and`/`or` are infix, so their node's span
  // starts at the LEFT OPERAND and the operator word is interior — the same reason `ELSE` and the
  // worded reader's `OF`/`FOR`/`KEY` stay silent. Neither is a false positive; the infix case is a
  // missed detection deferred to the #115 follow-up along with the other interior keywords.
  assert.deepEqual(nameCaseNames("print NOT true"), ["NOT"]);
  assert.deepEqual(nameCaseNames("print not true"), []);
  assert.deepEqual(nameCaseNames("print 5 MOD 2"), []);
  assert.deepEqual(nameCaseNames("print true AND false"), []);
  assert.deepEqual(nameCaseNames("print true OR false"), []);
});

test("ol-style-name-case: an uppercase word that is no registry's built-in is left alone", () => {
  // The negative control that separates "consults the registries" from "flags every uppercase
  // word". `my_proc` is in no table, so neither its definition-site call nor a bare call to an
  // undeclared name earns a built-in casing finding.
  assert.deepEqual(
    nameCaseNames("define my_proc\nreturn 1\nend\nprint MY_PROC"),
    [],
  );
  assert.deepEqual(nameCaseNames("print MY_PROC"), []);
});

test("ol-style-name-case: a built-in keeps its identity even when a program illegally declares it", () => {
  // `spec/grammar.md:363` is "a program may not declare a built-in name", so `define print … end`
  // is an `ol-reserved-word` error rather than a shadowing. The casing warning must therefore
  // survive it — an invalid declaration cannot buy silence for `PRINT`.
  const source = "define print :x\nreturn 1\nend\nPRINT 1";
  const codes = checkStyle(source, ALL_PROFILES).map((d) => d.code);
  assert.ok(
    codes.includes("ol-reserved-word"),
    "declaring a built-in must still be a reserved-word error",
  );
  assert.deepEqual(nameCaseNames(source), ["PRINT"]);
});

test("ol-style-name-case: a bare word-literal key is data, never a miscased built-in", () => {
  // Dictionary and selector keys may be written bare, and `spec/grammar.md:386` makes a keyword
  // free in every binding position — a key included. A learner writing `{ PRINT: 1 }` has named a
  // key, not miscased the `print` primitive. Reporting it would also be inconsistent, since
  // `{ Alpha: 1 }` (no built-in collision) is left alone; the control pins that symmetry.
  assert.deepEqual(nameCaseNames("print { PRINT: 1 }"), []);
  assert.deepEqual(nameCaseNames("print { Alpha: 1 }"), []);
  assert.deepEqual(nameCaseNames(":d = { print: 1 }\nprint :d[PRINT]"), []);
  assert.deepEqual(nameCaseNames(":d = { a: 1 }\nprint :d[FORWARD]"), []);
  // A quoted word literal begins at the `"`, which starts no word, so it is unreachable either way.
  assert.deepEqual(nameCaseNames('print "PRINT"'), []);
});

test("ol-style-name-case: the boolean keyword literals are casing-linted like any other keyword", () => {
  // `true`/`false` are keywords, so `BooleanLit` is deliberately NOT exempt the way `WordLit` is.
  assert.deepEqual(nameCaseNames("print TRUE"), ["TRUE"]);
  assert.deepEqual(nameCaseNames("print FALSE"), ["FALSE"]);
  assert.deepEqual(nameCaseNames("print true"), []);
});

test("ol-style-name-case: a built-in callee is reported once, keeping the identifier wording", () => {
  // A `Program`/`Block` node's span starts at its first statement and a bare `Call`'s span starts
  // at its own callee, so the same word is reachable twice. Exactly one finding must survive, and
  // it must be the identifier-worded one this rule reported before #854.
  const diagnostics = checkStyle('PRINT "hi"').filter(
    (d) => d.code === "ol-style-name-case",
  );
  assert.equal(diagnostics.length, 1);
  assert.deepEqual(diagnostics[0].params, { name: "PRINT" });
  assert.equal(
    diagnostics[0].message,
    "PRINT should be lowercase snake_case, like a learner would read it aloud.",
  );
  assert.deepEqual(diagnostics[0].source_span.start, [1, 1]);
  assert.deepEqual(diagnostics[0].source_span.end, [1, 6]);
});

test("ol-style-name-case: built-in casing is judged the same under any profile set", () => {
  // A built-in name's *identity* is profile-independent (`spec/grammar.md:408`: a program cannot
  // declare which profiles it requires, so "what a profile decides is whether a name *works*,
  // never whether a program may declare it"). Whether `forward` is available is
  // `ol-unknown-command`'s job; its casing is not. This also pins that a Core-only caller keeps
  // the coverage it had before #854.
  for (const profiles of [["core-language"], ALL_PROFILES]) {
    assert.deepEqual(nameCaseNames('PRINT "hi"', profiles), ["PRINT"]);
    assert.deepEqual(nameCaseNames("FORWARD 100", profiles), ["FORWARD"]);
  }
});

test("ol-style-name-case: a lowercase built-in-headed program is clean under every profile", () => {
  // The positive control for the whole widening: none of these earns a warning, so the new
  // findings above are about casing and not about the words themselves.
  assert.deepEqual(
    nameCaseNames(
      'make "x" 1\nforward 100\nfd 10\nhome\ntell 1\nrepeat 4 [ print 1 ]',
    ),
    [],
  );
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
  // The stand-in name must be one no registry owns: `pick` is a Data primitive, so declaring it
  // raises `ol-reserved-word` and the assertion would fail for a reason unrelated to predicate-name
  // style.
  assert.deepEqual(checkStyle("define decide :flag\n  return :flag\nend"), []);
  assert.deepEqual(checkStyle("define decide? :flag\n  return :flag\nend"), []);
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

// --- ol-style-name-case and the Heritage keyword spellings (issue #737) ------------------------
// `ProcedureDef` and `Return` each have TWO/THREE legitimate lowercase spellings once the Heritage
// profile is active — `to` beside `define`, and `output`/`op` beside `return`
// (spec/conformance.md#heritage, "alternate spellings only"). This lint judges CASING only
// (spec/style-guide.md "Keywords are lowercase"); preferring a Heritage spelling is a profile
// choice, not a style violation, and no `ol-style-*` code in the registry expresses that opinion.
// Before the fix `structuralKeywordFor` compared the source against a hardcoded canonical, so
// `to f` was sliced to `"define".length` and flagged as the mis-cased name `"to f"` — a false
// positive whose `params.name` was neither lowercase advice nor even a keyword.

const HERITAGE_STYLE = ["core-language", "heritage"];

test("ol-style-name-case: a lowercase Heritage keyword spelling is clean, exactly like its Core twin", () => {
  const clean = [
    "define f\n  return 5\nend",
    "to f\n  return 5\nend",
    "define f\n  output 5\nend",
    "define f\n  op 5\nend",
    "to f\n  op 5\nend",
    "to f\n  output 5\nend",
  ];
  for (const source of clean) {
    assert.deepEqual(
      checkStyle(source, HERITAGE_STYLE),
      [],
      `expected no style finding for: ${JSON.stringify(source)}`,
    );
  }
});

test("ol-style-name-case: a mis-cased Heritage keyword is still flagged, naming its own spelling", () => {
  // The casing lint keeps working for the Heritage spellings — it just measures each against the
  // keyword that was actually written. `params.name` is the literal source slice (the lint's own
  // subject), so it is surface by definition, exactly as `REPEAT`/`DEFINE` already are.
  const cases = [
    ["TO f\n  return 5\nend", "TO"],
    ["To f\n  return 5\nend", "To"],
    ["define f\n  OUTPUT 5\nend", "OUTPUT"],
    ["define f\n  OP 5\nend", "OP"],
  ];
  for (const [source, expectedName] of cases) {
    const diagnostics = checkStyle(source, HERITAGE_STYLE).filter(
      (d) => d.code === "ol-style-name-case",
    );
    assert.deepEqual(
      diagnostics.map((d) => d.params.name),
      [expectedName],
      `expected only ${expectedName} to be flagged in: ${source}`,
    );
  }
});

test("ol-style-name-case: a mis-cased Heritage keyword's span covers exactly that keyword", () => {
  // The old hardcoded-canonical slice measured every `Return` against `"return".length` and every
  // `ProcedureDef` against `"define".length`, so it ran past a shorter Heritage spelling into the
  // rest of the line (`op 5` reported `"op 5"`, `to double :n` reported `"to dou"`). Each spelling's
  // span is asserted here, not just its name, so a re-widened slice fails on the span even if the
  // reported name happened to survive.
  //
  // `OUTPUT` is the one case that CANNOT catch that regression: `"OUTPUT".length` is 6, exactly
  // `"return".length`, so the old algorithm produced the identical name and span. It is kept as a
  // behaviour assertion for the longest Heritage escape spelling, not as a regression trap — the
  // trap is `OP`/`TO`/`To`, whose spellings are shorter than the canonical they were measured
  // against.
  const cases = [
    ["define f\n  OP 5\nend", [2, 3], [2, 5]],
    ["define f\n  OUTPUT 5\nend", [2, 3], [2, 9]],
    ["TO f\n  return 5\nend", [1, 1], [1, 3]],
    ["To double :n\n  return :n\nend", [1, 1], [1, 3]],
  ];
  for (const [source, start, end] of cases) {
    const diagnostics = checkStyle(source, HERITAGE_STYLE).filter(
      (d) => d.code === "ol-style-name-case",
    );
    assert.equal(diagnostics.length, 1, `one finding for: ${source}`);
    assert.deepEqual(
      diagnostics[0].source_span,
      { document: doc, start, end },
      `span should cover exactly the keyword in: ${source}`,
    );
  }
});

// --- ol-style-nested-handler (issue #828) -----------------------------------------------------
// The TEACHING half of the #828 ruling. Its other half -- charging each handler firing against the
// instruction budget (PR #910) -- already makes the program safe, so these are warnings that never
// change program meaning. Message wording is asserted HERE and not in a conformance fixture, and
// not because the harness cannot compare it: a fixture opts in with `"compareMessages": true`
// (issue #1025). This wording deliberately does not opt in. `spec/error-model.md:256-259` makes
// identity `code` plus `params` and asks tests to assert those, and `:261-263` positively permits a
// template author to reorder, inflect, or soften prose -- so freezing a style lint's English in a
// stack-neutral fixture would oblige every conforming implementation to emit it verbatim. The
// opt-in is for the messages the spec fixes itself; a unit test is where ours belong.

const INTERACTION_STYLE = ["core-language", "interaction-events"];

/**
 * Shared predicate rather than an inline arrow at each call site, deliberately: the repo's coverage
 * gate counts `*.test.mjs` on Node 22, and `Array.filter`'s callback is never invoked on an empty
 * array — so an arrow used only where the expected result is `[]` is a permanently uncalled
 * function that drops this file below the 100% function bar (the same trap #882 hit). One predicate,
 * exercised by the tests that DO find diagnostics, keeps every negative assertion honest and covered.
 */
const isNestedHandler = (diagnostic) =>
  diagnostic.code === "ol-style-nested-handler";

function nestedHandlerFindings(source) {
  return checkStyle(source, INTERACTION_STYLE).filter(isNestedHandler);
}

test("ol-style-nested-handler: an every that registers an every is flagged once, at the inner span", () => {
  const diagnostics = nestedHandlerFindings(
    'every 3 [ every 3 [ print "x" ] ]',
  );
  assert.equal(diagnostics.length, 1);
  assert.deepEqual(diagnostics[0].params, { outer: "every", inner: "every" });
  assert.equal(diagnostics[0].severity, "warning");
  assert.equal(diagnostics[0].stage, "semantic");
  // Reported at the INNER registration -- the line the learner moves out of the block -- not at the
  // outer handler that merely repeats.
  assert.deepEqual(diagnostics[0].source_span.start, [1, 11]);
});

test("ol-style-nested-handler: the message names both forms and says what to do", () => {
  // No fixture pins this sentence, for the reason given above the section: this lint's prose is
  // ours and stays out of the conformance opt-in, so the unit assertion is where it lives.
  // `spec/error-model.md` requires the warm lowercase Logo voice.
  const [diagnostic] = nestedHandlerFindings(
    'every 3 [ on_key "x" [ print 1 ] ]',
  );
  assert.equal(
    diagnostic.message,
    "every runs again and again, so this on_key can add another handler each time. register it once, outside the every.",
  );
  assert.equal(diagnostic.message, diagnostic.message.toLowerCase());
});

test("ol-style-nested-handler: EVERY registration form is flagged inside an every, not just repeating ones", () => {
  // Measured, not assumed: `every 2 [ on_key "x" [ print 1 ] ]` answers ONE key press with FIVE
  // firings against a baseline of one, because five handlers piled up. What accumulates does not
  // depend on whether the registered handler itself repeats -- only on the outer one repeating.
  for (const [source, inner] of [
    ['every 3 [ every 3 [ print "x" ] ]', "every"],
    ['every 3 [ when "go" [ print 1 ] ]', "when"],
    ['every 3 [ on_key "x" [ print 1 ] ]', "on_key"],
    ["every 3 [ on_click [ print 1 ] ]", "on_click"],
  ]) {
    const diagnostics = nestedHandlerFindings(source);
    assert.equal(diagnostics.length, 1, `one finding for: ${source}`);
    assert.equal(diagnostics[0].params.inner, inner, `inner for: ${source}`);
  }
});

test("ol-style-nested-handler: user-bounded and externally-bounded outers stay completely clean", () => {
  // `on_key`/`on_click` are bounded by a person -- the ruling's control case, and the game pattern
  // the issue exists to protect. `when` is PERSISTENT since maintainer ruling #984, but it repeats
  // only as often as a HOST delivers its named event, not on the tick clock; and `"start"` occurs
  // once per run, so `when "start" [ every 10 [ ... ] ]` registers exactly one handler. None of
  // these accumulates on elapsed time alone, so none is flagged.
  for (const source of [
    'on_key "space" [ every 10 [ print 1 ] ]',
    "on_click [ every 10 [ print 1 ] ]",
    'when "start" [ every 10 [ print 1 ] ]',
    "every 3 [ print 1 ]",
  ]) {
    assert.deepEqual(nestedHandlerFindings(source), [], `clean: ${source}`);
  }
});

test("ol-style-nested-handler: reports once and does not descend into a user-bounded block", () => {
  // `every 3 [ on_key "x" [ every 10 [ ... ] ] ]` has ONE defect: the on_key registration
  // accumulates. The inner `every 10` only misbehaves because the outer already did -- fix the
  // outer and it disappears -- so a second finding would be noise, and would teach that the guarded
  // inner form is itself suspect, contradicting the carve-out.
  const diagnostics = nestedHandlerFindings(
    'every 3 [ on_key "x" [ every 10 [ print 1 ] ] ]',
  );
  assert.equal(diagnostics.length, 1);
  assert.deepEqual(diagnostics[0].params, { outer: "every", inner: "on_key" });
});

test("ol-style-nested-handler: a chain of everys reports each link exactly once", () => {
  // Regression: descending THROUGH a registration made the outer visit report the deepest link as
  // well, so `every 7` was reported twice for one defect. Each `every` is visited as an outer in its
  // own right, so collection must stop at each registration rather than walk through it.
  const diagnostics = nestedHandlerFindings(
    "every 3 [ every 5 [ every 7 [ print 1 ] ] ]",
  );
  assert.equal(diagnostics.length, 2);
  assert.deepEqual(
    diagnostics.map((d) => d.source_span.start),
    [
      [1, 11],
      [1, 21],
    ],
  );
});

test("ol-style-nested-handler: the check is lexical, so a registration behind a call is missed", () => {
  // A DELIBERATE limitation, pinned so it is specified rather than accidental, and stated as such in
  // the normative row. Interprocedural analysis with cycle protection is a large lift for an
  // advisory warning, and it is safe to omit: the runtime half of #828 charges every handler firing
  // against the instruction budget, so this program still terminates with `ol-limit`. Safety never
  // depends on this lint -- only the explanation does.
  assert.deepEqual(
    nestedHandlerFindings(
      'define setup\n  on_key "x" [ print 1 ]\nend\nevery 3 [ setup ]',
    ),
    [],
  );
});

test("ol-style-nested-handler: no reachability analysis, matching the rest of the family", () => {
  // `ol-style-useless-value` flags `if false [ repeat 4 [ :side * 2 ] ]` too: this family does not
  // constant-fold, and a style linter that did would be growing an evaluator. The message says the
  // registration CAN add a handler each time rather than that it does, which stays accurate for a
  // conditional registration whether or not the condition is decidable.
  for (const source of [
    'every 3 [ if false [ on_key "x" [ print 1 ] ] ]',
    'every 3 [ repeat 0 [ on_key "x" [ print 1 ] ] ]',
  ]) {
    const diagnostics = nestedHandlerFindings(source);
    assert.equal(diagnostics.length, 1, `flagged: ${source}`);
    assert.match(diagnostics[0].message, /can add another handler each time/);
  }
});

test("ol-style-nested-handler: finds a registration nested at depth inside the handler body", () => {
  const diagnostics = nestedHandlerFindings(
    "every 3 [ repeat 2 [ every 5 [ print 1 ] ] ]",
  );
  assert.equal(diagnostics.length, 1);
  assert.deepEqual(diagnostics[0].params, { outer: "every", inner: "every" });
  assert.deepEqual(diagnostics[0].source_span.start, [1, 22]);
});

test("ol-style-nested-handler: one finding per accumulating registration in the same body", () => {
  const diagnostics = nestedHandlerFindings(
    "every 3 [ every 5 [ print 1 ] on_click [ print 2 ] ]",
  );
  assert.equal(diagnostics.length, 2);
  assert.deepEqual(
    diagnostics.map((d) => d.params.inner),
    ["every", "on_click"],
  );
});

test("ol-style-nested-handler: silent when the interaction-events profile is inactive", () => {
  // A rule must consult the active profile set rather than assume every optional profile is on.
  // Core-only, the block-heads do not exist, so the program is not this rule's business.
  const { ast: program, diagnostics: parseDiagnostics } = OL.parse(
    'every 3 [ every 3 [ print "x" ] ]',
    doc,
  );
  assert.deepEqual(parseDiagnostics, []);
  const diagnostics = OL.check(program, {
    profiles: ["core-language"],
    style: true,
  }).diagnostics.filter(isNestedHandler);
  assert.deepEqual(diagnostics, []);
});

test("ol-style-nested-handler: never fires unless style checking is opted into", () => {
  const { ast: program } = OL.parse('every 3 [ every 3 [ print "x" ] ]', doc);
  const diagnostics = OL.check(program, {
    profiles: INTERACTION_STYLE,
  }).diagnostics;
  assert.deepEqual(diagnostics.filter(isNestedHandler), []);
});

// --- ol-style-ambiguous-continuation ----------------------------------------------------------

const isAmbiguousContinuation = (d) =>
  d.code === "ol-style-ambiguous-continuation";

// Case A: leading infix operator on continuation line

test("ol-style-ambiguous-continuation: `print 10\\n- 5` flags the leading `- ` as continuation", () => {
  const diagnostics = checkStyle("print 10\n- 5").filter(
    isAmbiguousContinuation,
  );
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].code, "ol-style-ambiguous-continuation");
  assert.deepEqual(diagnostics[0].params, {
    token: "-",
    reading: "continuation",
  });
  assert.equal(diagnostics[0].severity, "warning");
  assert.equal(diagnostics[0].stage, "semantic");
  // Span covers the `-` on line 2
  assert.deepEqual(diagnostics[0].source_span.start, [2, 1]);
  assert.deepEqual(diagnostics[0].source_span.end, [2, 2]);
});

test("ol-style-ambiguous-continuation: `print 10\\n+ 2` flags leading `+`", () => {
  const diagnostics = checkStyle("print 10\n+ 2").filter(
    isAmbiguousContinuation,
  );
  assert.equal(diagnostics.length, 1);
  assert.deepEqual(diagnostics[0].params, {
    token: "+",
    reading: "continuation",
  });
});

test("ol-style-ambiguous-continuation: `print 10\\n* 5` flags leading `*`", () => {
  const diagnostics = checkStyle("print 10\n* 5").filter(
    isAmbiguousContinuation,
  );
  assert.equal(diagnostics.length, 1);
  assert.deepEqual(diagnostics[0].params, {
    token: "*",
    reading: "continuation",
  });
});

test("ol-style-ambiguous-continuation: `print 10\\n/ 2` flags leading `/`", () => {
  const diagnostics = checkStyle("print 10\n/ 2").filter(
    isAmbiguousContinuation,
  );
  assert.equal(diagnostics.length, 1);
  assert.deepEqual(diagnostics[0].params, {
    token: "/",
    reading: "continuation",
  });
});

test("ol-style-ambiguous-continuation: `print 10\\nmod 3` flags leading `mod`", () => {
  const diagnostics = checkStyle("print 10\nmod 3").filter(
    isAmbiguousContinuation,
  );
  assert.equal(diagnostics.length, 1);
  assert.deepEqual(diagnostics[0].params, {
    token: "mod",
    reading: "continuation",
  });
});

// Case B: leading negative literal on new statement

test("ol-style-ambiguous-continuation: `print 10\\n-5` flags the leading `-5` as new-statement", () => {
  const diagnostics = checkStyle("print 10\n-5").filter(
    isAmbiguousContinuation,
  );
  assert.equal(diagnostics.length, 1);
  assert.deepEqual(diagnostics[0].params, {
    token: "-5",
    reading: "new-statement",
  });
  assert.equal(diagnostics[0].severity, "warning");
  assert.equal(diagnostics[0].stage, "semantic");
  // Span covers `-5` on line 2
  assert.deepEqual(diagnostics[0].source_span.start, [2, 1]);
  assert.deepEqual(diagnostics[0].source_span.end, [2, 3]);
});

test("ol-style-ambiguous-continuation: `-3.14` as negative literal", () => {
  const diagnostics = checkStyle("print 10\n-3.14").filter(
    isAmbiguousContinuation,
  );
  assert.equal(diagnostics.length, 1);
  assert.deepEqual(diagnostics[0].params, {
    token: "-3.14",
    reading: "new-statement",
  });
});

// Negative tests — must stay silent

test("ol-style-ambiguous-continuation: `print 10\\nprint 20` is silent", () => {
  const diagnostics = checkStyle("print 10\nprint 20").filter(
    isAmbiguousContinuation,
  );
  assert.deepEqual(diagnostics, []);
});

test("ol-style-ambiguous-continuation: single-line `print 10 - 5` is silent", () => {
  const diagnostics = checkStyle("print 10 - 5").filter(
    isAmbiguousContinuation,
  );
  assert.deepEqual(diagnostics, []);
});

test("ol-style-ambiguous-continuation: inside parens `print (10\\n- 5)` is silent", () => {
  const diagnostics = checkStyle("print (10\n- 5)").filter(
    isAmbiguousContinuation,
  );
  assert.deepEqual(diagnostics, []);
});

test("ol-style-ambiguous-continuation: after control form `repeat 4 [ ]\\n-5` is silent", () => {
  const diagnostics = checkStyle("repeat 4 [ ]\n-5").filter(
    isAmbiguousContinuation,
  );
  assert.deepEqual(diagnostics, []);
});

test("ol-style-ambiguous-continuation: after `if` `if true [ print 1 ]\\n-5` is silent", () => {
  const diagnostics = checkStyle("if true [ print 1 ]\n-5").filter(
    isAmbiguousContinuation,
  );
  assert.deepEqual(diagnostics, []);
});

test("ol-style-ambiguous-continuation: inside a block fires once, not twice", () => {
  const diagnostics = checkStyle("repeat 4 [\nprint 10\n- 5\n]").filter(
    isAmbiguousContinuation,
  );
  assert.equal(diagnostics.length, 1);
  assert.deepEqual(diagnostics[0].params, {
    token: "-",
    reading: "continuation",
  });
});

test("ol-style-ambiguous-continuation: comment line `// foo` is silent", () => {
  const diagnostics = checkStyle("print 10\n// this is a comment\n+ 2").filter(
    isAmbiguousContinuation,
  );
  // The `+ 2` on line 3 should still flag since it continues print 10
  const cont = diagnostics.filter((d) => d.params.reading === "continuation");
  assert.equal(cont.length, 1);
  assert.deepEqual(cont[0].params, { token: "+", reading: "continuation" });
});

test("ol-style-ambiguous-continuation: never fires without style opt-in", () => {
  const src = "print 10\n- 5";
  const { ast: program } = OL.parse(src, doc);
  const diagnostics = OL.check(program, { source: src }).diagnostics;
  assert.deepEqual(diagnostics.filter(isAmbiguousContinuation), []);
});

test("ol-style-ambiguous-continuation: indented continuation still flags", () => {
  const diagnostics = checkStyle("print 10\n  - 5").filter(
    isAmbiguousContinuation,
  );
  assert.equal(diagnostics.length, 1);
  assert.deepEqual(diagnostics[0].params, {
    token: "-",
    reading: "continuation",
  });
  // Column accounts for indentation (1-based, 2 spaces + 1)
  assert.deepEqual(diagnostics[0].source_span.start, [2, 3]);
});

test("ol-style-ambiguous-continuation: `-:x` (no space) on continuation line flags minus as infix", () => {
  const src = ":x = 3\nprint 10\n-:x";
  const diagnostics = checkStyle(src).filter(isAmbiguousContinuation);
  assert.equal(diagnostics.length, 1);
  assert.deepEqual(diagnostics[0].params, {
    token: "-",
    reading: "continuation",
  });
});

test("ol-style-ambiguous-continuation: trailing-operator continuation with non-operator next line is silent", () => {
  // `print 10 +\n5` — the `5` on line 2 is not an infix operator, so no lint.
  const diagnostics = checkStyle("print 10 +\n5").filter(
    isAmbiguousContinuation,
  );
  assert.deepEqual(diagnostics, []);
});

test("ol-style-ambiguous-continuation: trailing-operator continuation with -5 next line is silent", () => {
  // `print 10 +\n-5` — a single statement; `-5` is a negative literal operand,
  // not an ambiguous leading token (the trailing `+` already guaranteed continuation).
  const diagnostics = checkStyle("print 10 +\n-5").filter(
    isAmbiguousContinuation,
  );
  assert.deepEqual(diagnostics, []);
});

test("ol-style-ambiguous-continuation: blank continuation line inside multi-line statement is silent", () => {
  // `print 10 +\n\n5` — the blank line is a continuation interior; no operator found.
  const diagnostics = checkStyle("print 10 +\n\n5").filter(
    isAmbiguousContinuation,
  );
  assert.deepEqual(diagnostics, []);
});

test("ol-style-ambiguous-continuation: `mod` followed by tab on continuation line flags", () => {
  const diagnostics = checkStyle("print 10\nmod\t2").filter(
    isAmbiguousContinuation,
  );
  assert.equal(diagnostics.length, 1);
  assert.deepEqual(diagnostics[0].params, {
    token: "mod",
    reading: "continuation",
  });
});

test("ol-style-ambiguous-continuation: `-0.5` negative decimal as new statement flags", () => {
  const diagnostics = checkStyle("print 10\n-0.5").filter(
    isAmbiguousContinuation,
  );
  assert.equal(diagnostics.length, 1);
  assert.deepEqual(diagnostics[0].params, {
    token: "-0.5",
    reading: "new-statement",
  });
});

test("ol-style-ambiguous-continuation: repeat header continuation flags", () => {
  // `repeat 10\n+ 5 [...]` — the `+ 5` on line 2 is a header continuation
  const diagnostics = checkStyle("repeat 10\n+ 5 [ print 1 ]").filter(
    isAmbiguousContinuation,
  );
  assert.equal(diagnostics.length, 1);
  assert.deepEqual(diagnostics[0].params, {
    token: "+",
    reading: "continuation",
  });
});

test("ol-style-ambiguous-continuation: `add ... to` followed by -5 flags Case B", () => {
  const src = ":xs = []\nadd 1 to :xs\n-5";
  const diagnostics = checkStyle(src).filter(isAmbiguousContinuation);
  assert.equal(diagnostics.length, 1);
  assert.deepEqual(diagnostics[0].params, {
    token: "-5",
    reading: "new-statement",
  });
});

test("ol-style-ambiguous-continuation: `tell` followed by -5 flags Case B", () => {
  const src = "tell 0\n-5";
  const diagnostics = checkStyle(src).filter(isAmbiguousContinuation);
  assert.equal(diagnostics.length, 1);
  assert.deepEqual(diagnostics[0].params, {
    token: "-5",
    reading: "new-statement",
  });
});

test("ol-style-ambiguous-continuation: block-bearing profile statement (`ask`) suppresses Case B", () => {
  const diagnostics = checkStyle("ask 0 [ print 1 ]\n-5").filter(
    isAmbiguousContinuation,
  );
  assert.deepEqual(diagnostics, []);
});

test("ol-style-ambiguous-continuation: `mod(3)` on continuation line flags", () => {
  const diagnostics = checkStyle("print 10\nmod(3)").filter(
    isAmbiguousContinuation,
  );
  assert.equal(diagnostics.length, 1);
  assert.deepEqual(diagnostics[0].params, {
    token: "mod",
    reading: "continuation",
  });
});

test("ol-style-ambiguous-continuation: map comprehension body fires once, not twice", () => {
  const src = ":ys = map x in [1] [\nprint 10\n- 5\n]";
  const diagnostics = checkStyle(src).filter(isAmbiguousContinuation);
  assert.equal(diagnostics.length, 1);
});
test("ol-style-ambiguous-continuation: case-insensitive `MOD` on continuation line flags", () => {
  const diagnostics = checkStyle("print 10\nMOD 3").filter(
    isAmbiguousContinuation,
  );
  assert.equal(diagnostics.length, 1);
  assert.deepEqual(diagnostics[0].params, {
    token: "mod",
    reading: "continuation",
  });
});

test("ol-style-ambiguous-continuation: `mod-3` (operator boundary at hyphen) flags", () => {
  const diagnostics = checkStyle("print 10\nmod-3").filter(
    isAmbiguousContinuation,
  );
  assert.equal(diagnostics.length, 1);
  assert.deepEqual(diagnostics[0].params, {
    token: "mod",
    reading: "continuation",
  });
});

test("ol-style-ambiguous-continuation: `mod :x` flags", () => {
  const diagnostics = checkStyle("print 10\nmod :x").filter(
    isAmbiguousContinuation,
  );
  assert.equal(diagnostics.length, 1);
});

test("ol-style-ambiguous-continuation: `mod [3]` flags", () => {
  const diagnostics = checkStyle("print 10\nmod [3]").filter(
    isAmbiguousContinuation,
  );
  assert.equal(diagnostics.length, 1);
});

test("ol-style-ambiguous-continuation: negative exponent literal `-1.2e-3` flags with full token", () => {
  const diagnostics = checkStyle("print 10\n-1.2e-3").filter(
    isAmbiguousContinuation,
  );
  assert.equal(diagnostics.length, 1);
  assert.deepEqual(diagnostics[0].params, {
    token: "-1.2e-3",
    reading: "new-statement",
  });
});

test("ol-style-ambiguous-continuation: negative exponent literal `-1e3` flags with full token", () => {
  const diagnostics = checkStyle("print 10\n-1e3").filter(
    isAmbiguousContinuation,
  );
  assert.equal(diagnostics.length, 1);
  assert.deepEqual(diagnostics[0].params, {
    token: "-1e3",
    reading: "new-statement",
  });
});

test("ol-style-ambiguous-continuation: `mod?` is an identifier, not mod operator — silent", () => {
  const diagnostics = checkStyle("print 10\nmod?").filter(
    isAmbiguousContinuation,
  );
  assert.deepEqual(diagnostics, []);
});

test("ol-style-ambiguous-continuation: Unicode `modé` is an identifier, not mod operator — silent", () => {
  const diagnostics = checkStyle("print 10\nmodé").filter(
    isAmbiguousContinuation,
  );
  assert.deepEqual(diagnostics, []);
});

test("ol-style-ambiguous-continuation: `mod!` is an identifier, not mod operator — silent", () => {
  const diagnostics = checkStyle("print 10\nmod!").filter(
    isAmbiguousContinuation,
  );
  assert.deepEqual(diagnostics, []);
});

test("ol-style-ambiguous-continuation: astral XID identifier `mod\uD801\uDC00` is not mod operator — silent", () => {
  // Multi-line statement: line 2 starts with `mod𐐀` (an identifier, not `mod` operator).
  // This exercises `leadingInfixOperator`'s surrogate-pair-aware boundary check.
  const diagnostics = checkStyle(":x = 10 +\nmod\uD801\uDC00").filter(
    isAmbiguousContinuation,
  );
  assert.deepEqual(diagnostics, []);
});

// --- Multi-line token suppression (regression: #1074 orchestrator review) ---

test("ol-style-ambiguous-continuation: triple-quoted string bullet list — silent", () => {
  // A shopping list inside `"""` must not fire; the content is data, not code.
  const src =
    ':shopping = """\n- milk\n- 5 eggs\n- bread\n"""\nprint :shopping';
  const diagnostics = checkStyle(src).filter(isAmbiguousContinuation);
  assert.deepEqual(diagnostics, []);
});

test("ol-style-ambiguous-continuation: narrow triple-quoted `- 5` — silent", () => {
  const src = ':p = """\n- 5\n"""';
  const diagnostics = checkStyle(src).filter(isAmbiguousContinuation);
  assert.deepEqual(diagnostics, []);
});

test("ol-style-ambiguous-continuation: multi-line block comment `/* - 5 */` — silent", () => {
  const src = ":x = 10\n/*\n- 5\n*/\nprint :x";
  const diagnostics = checkStyle(src).filter(isAmbiguousContinuation);
  assert.deepEqual(diagnostics, []);
});

// --- List-literal ambiguity (correct by construction → assertion) ---

test("ol-style-ambiguous-continuation: `print [ 1\\n- 5 ]` fires — ambiguity is real inside list", () => {
  // `[ 1\n- 5 ]` → [-4] (one element); `[ 1\n-5 ]` → [1, -5] (two elements).
  const diagnostics = checkStyle("print [ 1\n- 5 ]").filter(
    isAmbiguousContinuation,
  );
  assert.equal(diagnostics.length, 1);
  assert.deepEqual(diagnostics[0].params, {
    token: "-",
    reading: "continuation",
  });
});

test("ol-style-ambiguous-continuation: `print [ 1\\n-5 ]` fires — negative literal in list", () => {
  // `[ 1\n-5 ]` → [1, -5]; `[ 1\n- 5 ]` → [-4]. Same ambiguity, other reading.
  const diagnostics = checkStyle("print [ 1\n-5 ]").filter(
    isAmbiguousContinuation,
  );
  assert.equal(diagnostics.length, 1);
  assert.deepEqual(diagnostics[0].params, {
    token: "-5",
    reading: "new-statement",
  });
});

// --- Trailing-operator suppression of negative-literal sub-case ---

test("ol-style-ambiguous-continuation: `print 10 mod\\n-5` — silent (mod locked continuation)", () => {
  const diagnostics = checkStyle("print 10 mod\n-5").filter(
    isAmbiguousContinuation,
  );
  assert.deepEqual(diagnostics, []);
});

test("ol-style-ambiguous-continuation: `print 10 +\\n\\n-5` — silent (trailing + past blank line)", () => {
  const diagnostics = checkStyle("print 10 +\n\n-5").filter(
    isAmbiguousContinuation,
  );
  assert.deepEqual(diagnostics, []);
});

test("ol-style-ambiguous-continuation: `print 10 + // comment\\n-5` — silent (trailing + behind comment)", () => {
  const diagnostics = checkStyle("print 10 + // comment\n-5").filter(
    isAmbiguousContinuation,
  );
  assert.deepEqual(diagnostics, []);
});

// --- Escaped triple-quote regression ---

test("ol-style-ambiguous-continuation: escaped close inside triple-quoted string — silent", () => {
  // `:p = """\n\\"""\n- 5\n"""` — the `\"""` is an escaped quote, not a close.
  const src = ':p = """\n\\"""\n- 5\n"""';
  const diagnostics = checkStyle(src).filter(isAmbiguousContinuation);
  assert.deepEqual(diagnostics, []);
});

test("ol-style-ambiguous-continuation: string then comment on previous line — trailing op detection handles quotes", () => {
  // Exercises `stripTrailingComment`'s string-tracking path.
  const diagnostics = checkStyle('print [ "x" + // comment\n-5 ]').filter(
    isAmbiguousContinuation,
  );
  assert.deepEqual(diagnostics, []);
});

test("ol-style-ambiguous-continuation: escaped quote in string before comment — trailing op handles escapes", () => {
  // `"x\\"y"` contains an escaped backslash; exercises the escape branch.
  const diagnostics = checkStyle('print [ "x\\\\" + // comment\n-5 ]').filter(
    isAmbiguousContinuation,
  );
  assert.deepEqual(diagnostics, []);
});

test("ol-style-ambiguous-continuation: comment-only preceding lines — first element silent", () => {
  // All lines between [ and -5 are comments; -5 is the first element, so
  // no left operand for subtraction exists — suppressed.
  const diagnostics = checkStyle("print [\n# comment\n-5 ]").filter(
    isAmbiguousContinuation,
  );
  assert.deepEqual(diagnostics, []);
});

test("ol-style-ambiguous-continuation: first element in list — silent", () => {
  // `[\n-5 ]` — `-5` is the first element; `- 5` would be `ol-bad-token`.
  const diagnostics = checkStyle("print [\n-5 ]").filter(
    isAmbiguousContinuation,
  );
  assert.deepEqual(diagnostics, []);
});

test("ol-style-ambiguous-continuation: and trailing — suppressed", () => {
  // `and` already locks continuation; `-5` is unambiguously the right operand.
  const diagnostics = checkStyle(":x = true and\n-5").filter(
    isAmbiguousContinuation,
  );
  assert.deepEqual(diagnostics, []);
});

test("ol-style-ambiguous-continuation: or trailing — suppressed", () => {
  const diagnostics = checkStyle(":x = false or\n-5").filter(
    isAmbiguousContinuation,
  );
  assert.deepEqual(diagnostics, []);
});

test("ol-style-ambiguous-continuation: comparison trailing — suppressed", () => {
  const diagnostics = checkStyle(":x = :y ==\n-5").filter(
    isAmbiguousContinuation,
  );
  assert.deepEqual(diagnostics, []);
});

test("ol-style-ambiguous-continuation: block comment on previous line — not confused with trailing /", () => {
  // `1 /* c */` stripped to `1` — trailing `/` from `*/` must not match division.
  const diagnostics = checkStyle("print [ 1 /* c */\n-5 ]").filter(
    isAmbiguousContinuation,
  );
  assert.equal(diagnostics.length, 1);
  assert.deepEqual(diagnostics[0].params, {
    token: "-5",
    reading: "new-statement",
  });
});

test("ol-style-ambiguous-continuation: not trailing — suppressed", () => {
  // `not` expects a right operand; `-5` is unambiguously it.
  const diagnostics = checkStyle(":x = not\n-5").filter(
    isAmbiguousContinuation,
  );
  assert.deepEqual(diagnostics, []);
});

test("ol-style-ambiguous-continuation: multi-line block comment before -5 — fires", () => {
  // The `*/` closing line has Infinity depth and is skipped; `1` on the
  // first line has no trailing operator, so the ambiguity is real.
  const diagnostics = checkStyle(
    "print [ 1\n/* comment\ncontinued */\n-5 ]",
  ).filter(isAmbiguousContinuation);
  assert.equal(diagnostics.length, 1);
  assert.deepEqual(diagnostics[0].params, {
    token: "-5",
    reading: "new-statement",
  });
});
