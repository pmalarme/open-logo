// Unit tests for the Heritage list-reporter aliases — `bf`/`bl`/`se` — slice H4 (issue #669) of the
// Heritage epic. Heritage is "alternate spellings only, no new semantics" (spec/conformance.md#
// heritage), so these three aliases are the Core list reporters `butfirst`/`butlast`/`sentence`
// under a shorter name (spec/commands.md's per-command **Aliases** rows: `bf`→`butfirst`,
// `bl`→`butlast`, `se`→`sentence`). Unlike H3's ten *command* aliases these are REPORTERS — they
// return a value and appear in EXPRESSION position (as arguments, as an assignment RHS, composed
// with one another) — so they exercise the reader's expression-call path, not just a leading
// statement. Three concerns are proven here, mirroring the H3 alias tests:
//
//   1. READER CANONICALIZATION — a reporter-alias call lowers to the same `Call`/`ParenCall` node
//      any Core reporter uses, additionally carrying `canonical` = the Core name it spells. Its
//      bare-call arity is the canonical's own arity, so `bf :l` groups one argument exactly as
//      `butfirst :l` does, and `se a b` groups two exactly as `sentence a b` does, in every
//      position (nested in blocks, in `repeat` bodies, in procedure bodies, composed).
//
//   2. THE PROFILE GATE — reusing the visible-name mechanism (no net-new checker rule): with the
//      Heritage profile INACTIVE, each alias is an unknown callee (`ol-unknown-command`); with
//      Heritage ACTIVE (Core + its Data dependency, spec/conformance.md#heritage), all three
//      resolve silently. `se`→`sentence` is a list reporter, so Data is the correct dependency.
//
//   3. ARITY — the alias groups arguments by the canonical reporter's own arity, and its static
//      range is the canonical's (`se`→`sentence` is an open variadic; `bf`/`bl` are fixed-arity 1).
//
// Spans are half-open `[start, end)` with 1-based `[line, column]` positions, per @openlogo/core.

import assert from "node:assert/strict";
import { test } from "node:test";
import * as OL from "@openlogo/parser";
import {
  canonicalOfHeritageAlias,
  heritageAliasArity,
  heritageAliasArityRange,
} from "@openlogo/parser";

const doc = "heritage-list-reporter-aliases.logo";
const span = (start, end) => ({ document: doc, start, end });

// Heritage active needs only Core + Data (its declared dependency, spec/conformance.md#heritage):
// `se`→`sentence` builds a list, so Data is the right dependency, and deliberately NOT
// turtle-rendering — the alias SPELLINGS are gated on `heritage`, never their Core targets.
const HERITAGE_ACTIVE = ["core-language", "data", "heritage"];
const CORE_ONLY = ["core-language", "data"];

const ALIAS_TO_CANONICAL = {
  bf: "butfirst",
  bl: "butlast",
  se: "sentence",
};

function parseClean(source) {
  const { ast, diagnostics } = OL.parse(source, doc);
  assert.deepEqual(
    diagnostics,
    [],
    `expected a clean parse for ${JSON.stringify(source)}`,
  );
  return ast;
}

function checkSource(source, profiles) {
  const ast = parseClean(source);
  return OL.check(ast, { profiles, source }).diagnostics;
}

// ---------------------------------------------------------------------------
// signatures.ts accessors (the single source of truth for the alias mapping)
// ---------------------------------------------------------------------------

test("canonicalOfHeritageAlias maps each reporter alias to its Core name and is case-insensitive", () => {
  for (const [alias, canonical] of Object.entries(ALIAS_TO_CANONICAL)) {
    assert.equal(canonicalOfHeritageAlias(alias), canonical);
    assert.equal(canonicalOfHeritageAlias(alias.toUpperCase()), canonical);
  }
});

test("heritageAliasArity resolves to the canonical reporter's own arity", () => {
  // `bf`/`bl`→`butfirst`/`butlast` are fixed-arity 1; `se`→`sentence` groups by its bare default 2.
  assert.equal(heritageAliasArity("bf"), 1); // butfirst
  assert.equal(heritageAliasArity("bl"), 1); // butlast
  assert.equal(heritageAliasArity("se"), 2); // sentence
  assert.equal(heritageAliasArity("butfirst"), undefined);
});

test("heritageAliasArityRange mirrors the canonical reporter's static range", () => {
  // `bf`/`bl`→`butfirst`/`butlast` are strictly fixed-arity 1; `se`→`sentence` is an open variadic
  // (`(sentence …)`), exactly as its Core spelling — so an alias can never accept a different count.
  assert.deepEqual(heritageAliasArityRange("bf"), { min: 1, max: 1 });
  assert.deepEqual(heritageAliasArityRange("bl"), { min: 1, max: 1 });
  assert.deepEqual(heritageAliasArityRange("se"), { min: 2, max: Infinity });
  assert.equal(heritageAliasArityRange("butfirst"), undefined);
});

// ---------------------------------------------------------------------------
// Reader canonicalization + arity grouping (expression position)
// ---------------------------------------------------------------------------

test("each reporter alias parses to a Call carrying `canonical` = its Core name; the Core spelling has none", () => {
  const cases = [
    ["bf [1 2 3]", "butfirst", 1],
    ["bl [1 2 3]", "butlast", 1],
    ['se "a" "b"', "sentence", 2],
  ];
  for (const [alias, canonical, argc] of cases) {
    // In leading-statement position the reporter alias is still an ordinary `Call` carrying
    // `canonical`; the reader is profile-blind so it records `canonical` regardless of position.
    const call = parseClean(`${alias}\n`).body[0];
    assert.equal(call.kind, "Call");
    assert.equal(call.canonical, canonical);
    assert.equal(call.args.length, argc);
    // The Core spelling parses to the same node kind but carries NO canonical.
    const surface = alias.slice(0, alias.indexOf(" "));
    const core = parseClean(`${alias.replace(surface, canonical)}\n`).body[0];
    assert.equal(core.kind, "Call");
    assert.equal(core.canonical, undefined);
  }
});

test("a reporter alias in argument position carries `canonical` and groups identically to its Core twin", () => {
  const alias = parseClean("print bf [1 2 3]\n").body[0];
  assert.equal(alias.callee.name, "print");
  const aliasArg = alias.args[0];
  assert.equal(aliasArg.callee.name, "bf");
  assert.equal(aliasArg.canonical, "butfirst");
  assert.equal(aliasArg.args.length, 1);

  const core = parseClean("print butfirst [1 2 3]\n").body[0];
  const coreArg = core.args[0];
  assert.equal(coreArg.callee.name, "butfirst");
  assert.equal(coreArg.canonical, undefined);
  assert.equal(coreArg.args.length, 1);
});

test("`se a b` groups exactly two arguments, identical to `sentence a b`", () => {
  const alias = parseClean('print se "a" "b"\n').body[0].args[0];
  assert.equal(alias.callee.name, "se");
  assert.equal(alias.canonical, "sentence");
  assert.equal(alias.args.length, 2);
  const core = parseClean('print sentence "a" "b"\n').body[0].args[0];
  assert.equal(core.args.length, 2);
});

test("`(se …)` parenthesized form carries `canonical` = sentence and gathers all operands", () => {
  const parenCall = parseClean('print (se "a" "b" "c")\n').body[0].args[0];
  assert.equal(parenCall.kind, "ParenCall");
  assert.equal(parenCall.callee.name, "se");
  assert.equal(parenCall.canonical, "sentence");
  assert.equal(parenCall.args.length, 3);
});

// ---------------------------------------------------------------------------
// Awkward + composed positions — the reader must canonicalize an alias anywhere a Core reporter is
// legal, including composed with one another (`bf bl :l`).
// ---------------------------------------------------------------------------

test("composed reporter aliases (`bf bl :l`) each carry canonical, like their Core twin", () => {
  // `bf bl :l` — the outer `bf` takes one argument, which is `bl :l`. Both must canonicalize.
  const outer = parseClean('make "l" [10 20 30 40]\nprint bf bl :l\n').body[1]
    .args[0];
  assert.equal(outer.callee.name, "bf");
  assert.equal(outer.canonical, "butfirst");
  assert.equal(outer.args.length, 1);
  const inner = outer.args[0];
  assert.equal(inner.callee.name, "bl");
  assert.equal(inner.canonical, "butlast");
  assert.equal(inner.args.length, 1);
});

test("a reporter alias nested inside a `[ … ]` repeat body carries canonical, like its Core twin", () => {
  // Regression for the class H2's reviewer caught: a form that works only at top level has invented
  // a semantic difference. A `print se …` inside a `repeat [ … ]` body must canonicalize.
  const aliasBody = parseClean('repeat 2 [print se "a" "b"]\n').body[0].body
    .body;
  const coreBody = parseClean('repeat 2 [print sentence "a" "b"]\n').body[0]
    .body.body;
  assert.equal(aliasBody.length, coreBody.length);
  const aliasArg = aliasBody[0].args[0];
  assert.equal(aliasArg.callee.name, "se");
  assert.equal(aliasArg.canonical, "sentence");
  assert.equal(aliasArg.args.length, 2);
  assert.equal(coreBody[0].args[0].args.length, 2);
});

test("a reporter alias inside a procedure body carries canonical, like its Core twin", () => {
  const body = parseClean("to rest :l\n  print bf :l\nend\n").body[0].body.body;
  const arg = body[0].args[0];
  assert.equal(arg.callee.name, "bf");
  assert.equal(arg.canonical, "butfirst");
  assert.equal(arg.args.length, 1);
});

test("a reporter alias as an assignment RHS carries canonical, like its Core twin", () => {
  const alias = parseClean('make "x" se "a" "b"\n').body[0];
  assert.equal(alias.value.callee.name, "se");
  assert.equal(alias.value.canonical, "sentence");
  assert.equal(alias.value.args.length, 2);
});

// ---------------------------------------------------------------------------
// The profile gate (visible-name based, no net-new checker rule)
// ---------------------------------------------------------------------------

test("Heritage active accepts every reporter alias silently (needs only Core + Data)", () => {
  const source = 'print bf [1 2 3]\nprint bl [1 2 3]\nprint se "a" "b"\n';
  assert.deepEqual(checkSource(source, HERITAGE_ACTIVE), []);
});

test("Core rejects every reporter alias with ol-unknown-command, one diagnostic each", () => {
  const source = 'print bf [1 2 3]\nprint bl [1 2 3]\nprint se "a" "b"\n';
  const findings = checkSource(source, CORE_ONLY);
  assert.equal(findings.length, 3);
  for (const finding of findings) {
    assert.equal(finding.code, "ol-unknown-command");
    assert.equal(finding.stage, "semantic");
    assert.equal(finding.severity, "error");
  }
  assert.deepEqual(
    findings.map((d) => d.params.name).sort(),
    Object.keys(ALIAS_TO_CANONICAL).sort(),
  );
  // The first finding's span points at the alias the learner wrote (`bf`, columns 7–9).
  assert.deepEqual(findings[0].source_span, span([1, 7], [1, 9]));
});

test("the full-name Core reporters remain callable without Heritage (Core, not gated)", () => {
  // The reporter aliases require Heritage, but their Core spellings are always Core — proving the
  // gate demotes only the alias spelling, never its canonical target.
  const source =
    'print butfirst [1 2 3]\nprint butlast [1 2 3]\nprint sentence "a" "b"\n';
  assert.deepEqual(checkSource(source, CORE_ONLY), []);
});

// Diagnostic-equivalence at the CHECKER layer (rubber-duck review, #669). A parenthesized
// fixed-arity reporter IS arity-checked by the semantic checker (checker-arity.ts:320-328 resolves
// the alias through its `canonical`): `(bf)` under-applies butfirst and `(bl 1 2)` over-applies
// butlast. The alias and its Core twin must raise the SAME arity diagnostic — same code, expected,
// actual, stage, severity — proving the alias neither invents nor suppresses a semantic finding.
// The `callable`/`message` fields intentionally ECHO THE LEARNER'S SPELLING (`bf`, not `butfirst`):
// a diagnostic points at the source the learner wrote, which is a source-fidelity concern, NOT the
// no-new-semantics contract. That contract governs the EVENT STREAM (proven byte-identical in the
// runtime suite); a diagnostic naming the surface spelling is correct and expected.
test("a parenthesized reporter alias raises the SAME arity diagnostic as its Core twin, echoing the learner's spelling", () => {
  const strip = (source) =>
    checkSource(source, HERITAGE_ACTIVE).map(
      ({ source_span, ...rest }) => rest,
    );
  const cases = [
    // [alias source, core source, surface spelling the diagnostic must echo, canonical]
    ["print (bf)\n", "print (butfirst)\n", "bf", "butfirst"],
    ["print (bl 1 2)\n", "print (butlast 1 2)\n", "bl", "butlast"],
  ];
  for (const [aliasSource, coreSource, surface, canonical] of cases) {
    const [aliasDiag] = strip(aliasSource);
    const [coreDiag] = strip(coreSource);
    // Same finding, aside from the learner-facing name: code/expected/actual/stage/severity match.
    assert.equal(aliasDiag.code, coreDiag.code);
    assert.equal(aliasDiag.params.expected, coreDiag.params.expected);
    assert.equal(aliasDiag.params.actual, coreDiag.params.actual);
    assert.equal(aliasDiag.stage, coreDiag.stage);
    assert.equal(aliasDiag.severity, coreDiag.severity);
    // The diagnostic echoes the SURFACE spelling the learner wrote, not the canonical name.
    assert.equal(aliasDiag.params.callable, surface);
    assert.equal(coreDiag.params.callable, canonical);
    assert.ok(aliasDiag.message.startsWith(surface));
  }
});
