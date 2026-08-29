// Unit tests for the Heritage short command aliases — `fd`/`bk`/`lt`/`rt`/`pu`/`pd`/`st`/`ht`/`cs`/
// `pr` — slice H3 (issue #668) of the Heritage epic. Heritage is "alternate spellings only, no new
// semantics" (spec/conformance.md#heritage), so these ten aliases are the Core turtle/output
// commands `forward`/`back`/`left`/`right`/`pen_up`/`pen_down`/`show_turtle`/`hide_turtle`/
// `clear_screen`/`print` under a shorter name. Three concerns are proven here:
//
//   1. READER CANONICALIZATION — an alias call lowers to the same `Call`/`ParenCall` node any Core
//      command uses, additionally carrying `canonical` = the Core name it spells (the field
//      ast.ts documents for exactly this). Its bare-call arity is the canonical's own arity, so
//      `fd 100` groups one argument exactly as `forward 100` does, in every position.
//
//   2. THE PROFILE GATE — reusing the visible-name mechanism (no net-new checker rule): with the
//      Heritage profile INACTIVE, each alias is an unknown callee (`ol-unknown-command`); with
//      Heritage ACTIVE (which needs only Core + its Data dependency, NOT turtle-rendering), all ten
//      resolve silently.
//
// Spans are half-open `[start, end)` with 1-based `[line, column]` positions, per @openlogo/core.

import assert from "node:assert/strict";
import { test } from "node:test";
import * as OL from "@openlogo/parser";
import {
  canonicalOfHeritageAlias,
  heritageAliasNames,
  heritageAliasArity,
  heritageAliasArityRange,
} from "@openlogo/parser";

const doc = "heritage-aliases.logo";
const span = (start, end) => ({ document: doc, start, end });

// `heritage` ALONE makes these aliases VISIBLE — deliberately NOT turtle-rendering: the alias
// SPELLINGS are gated on `heritage`, never on their canonical targets' profile. Data is not one of
// their requirements either; it is in the set below only to stay uniform with the other Heritage
// test files, and the positive test isolates that by re-checking under ["core-language",
// "heritage"]. That checker-gating fact is unchanged by issue #860, which added Heritage's
// normative Turtle & Rendering DAG edge (a conformance-claim requirement: a claimant owing `fd`
// must own `forward`). Profile sets here are activation sets, not conformance claims.
const HERITAGE_ACTIVE = ["core-language", "data", "heritage"];
const CORE_ONLY = ["core-language", "turtle-rendering"];

const ALIAS_TO_CANONICAL = {
  fd: "forward",
  bk: "back",
  lt: "left",
  rt: "right",
  pu: "pen_up",
  pd: "pen_down",
  st: "show_turtle",
  ht: "hide_turtle",
  cs: "clear_screen",
  pr: "print",
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

test("canonicalOfHeritageAlias maps every alias to its Core name and is case-insensitive", () => {
  for (const [alias, canonical] of Object.entries(ALIAS_TO_CANONICAL)) {
    assert.equal(canonicalOfHeritageAlias(alias), canonical);
    assert.equal(canonicalOfHeritageAlias(alias.toUpperCase()), canonical);
  }
});

test("canonicalOfHeritageAlias returns undefined for a non-alias name", () => {
  assert.equal(canonicalOfHeritageAlias("forward"), undefined);
  assert.equal(canonicalOfHeritageAlias("nope"), undefined);
});

test("heritageAliasNames lists every alias, sorted (the ten H3 commands plus the H4 reporters)", () => {
  // H4 (#669) added the list-reporter aliases `bf`/`bl`/`se`; the full visible-name set is the ten
  // H3 command aliases here plus those three, always returned sorted. This file owns the H3 subset
  // (see `ALIAS_TO_CANONICAL`); `heritage-list-reporter-aliases.test.mjs` owns the reporter subset.
  assert.deepEqual(
    [...heritageAliasNames()],
    [...Object.keys(ALIAS_TO_CANONICAL), "bf", "bl", "se"].sort(),
  );
});

test("heritageAliasArity resolves to the canonical command's own arity", () => {
  // Turtle motion/pen/visibility/screen aliases carry their canonical's default bare-call arity;
  // `pr`→`print` is variadic-1 like `print`. `undefined` for a non-alias.
  assert.equal(heritageAliasArity("fd"), 1); // forward
  assert.equal(heritageAliasArity("rt"), 1); // right
  assert.equal(heritageAliasArity("pu"), 0); // pen_up
  assert.equal(heritageAliasArity("st"), 0); // show_turtle
  assert.equal(heritageAliasArity("cs"), 0); // clear_screen
  assert.equal(heritageAliasArity("pr"), 1); // print
  assert.equal(heritageAliasArity("forward"), undefined);
});

test("heritageAliasArityRange mirrors the canonical's static range (only `pr`→`print` has one)", () => {
  // `print`/`pr` is the only one of the ten with a Core static arity range (an open variadic via
  // `(print …)`); the turtle canonicals have no Core static range, so their aliases return
  // undefined too and fall through to the runtime arity check exactly as the Core spelling does.
  assert.deepEqual(heritageAliasArityRange("pr"), { min: 1, max: Infinity });
  assert.equal(heritageAliasArityRange("fd"), undefined);
  assert.equal(heritageAliasArityRange("cs"), undefined);
  assert.equal(heritageAliasArityRange("forward"), undefined);
});

// ---------------------------------------------------------------------------
// Reader canonicalization + arity grouping
// ---------------------------------------------------------------------------

test("each alias parses to a Call carrying `canonical` = its Core name; the Core spelling has none", () => {
  for (const [alias, canonical] of Object.entries(ALIAS_TO_CANONICAL)) {
    const arg = heritageAliasArity(alias) === 0 ? "" : " 10";
    const call = parseClean(`${alias}${arg}\n`).body[0];
    assert.equal(call.kind, "Call");
    assert.equal(
      call.callee.name,
      alias,
      `${alias} keeps its surface spelling`,
    );
    assert.equal(
      call.canonical,
      canonical,
      `${alias}.canonical === ${canonical}`,
    );

    // The Core spelling parses to the same node kind but carries NO canonical (a Core call is not
    // an alias), so the runtime's `canonical ?? callee.name` normalization is a no-op for it.
    const core = parseClean(`${canonical}${arg}\n`).body[0];
    assert.equal(core.kind, "Call");
    assert.equal(core.canonical, undefined);
  }
});

test("`fd 100` groups exactly one argument, identical to `forward 100`", () => {
  const alias = parseClean("fd 100\n").body[0];
  assert.equal(alias.args.length, 1);
  assert.equal(alias.args[0].value, 100);
  const core = parseClean("forward 100\n").body[0];
  assert.equal(core.args.length, 1);
  assert.equal(core.args[0].value, 100);
});

test("a 0-arity alias (`pu`) groups no arguments and does not swallow the next statement", () => {
  const ast = parseClean("pu\nfd 10\n");
  const pu = ast.body[0];
  assert.equal(pu.callee.name, "pu");
  assert.equal(pu.canonical, "pen_up");
  assert.equal(pu.args.length, 0);
  const fd = ast.body[1];
  assert.equal(fd.callee.name, "fd");
  assert.equal(fd.args.length, 1);
});

test("`(pr …)` parenthesized form carries `canonical` = print and gathers all operands", () => {
  const parenCall = parseClean("(pr 1 2 3)\n").body[0];
  assert.equal(parenCall.kind, "ParenCall");
  assert.equal(parenCall.callee.name, "pr");
  assert.equal(parenCall.canonical, "print");
  assert.equal(parenCall.args.length, 3);
});

// ---------------------------------------------------------------------------
// Awkward positions — the reader must canonicalize an alias anywhere a Core call is legal
// ---------------------------------------------------------------------------

test("an alias nested inside a `[ … ]` block groups args and carries canonical, like its Core twin", () => {
  // Regression for the class H2's reviewer caught: a form that works only at top level has invented
  // a semantic difference. `pu`/`fd`/`pd`/`bk` inside a `repeat [ … ]` body must canonicalize.
  const aliasBody = parseClean("repeat 2 [pu fd 10 pd bk 10]\n").body[0].body
    .body;
  const coreBody = parseClean("repeat 2 [pen_up forward 10 pen_down back 10]\n")
    .body[0].body.body;
  assert.equal(aliasBody.length, coreBody.length);
  const expected = [
    ["pu", "pen_up", 0],
    ["fd", "forward", 1],
    ["pd", "pen_down", 0],
    ["bk", "back", 1],
  ];
  for (const [i, [alias, canonical, argc]] of expected.entries()) {
    assert.equal(aliasBody[i].callee.name, alias);
    assert.equal(aliasBody[i].canonical, canonical);
    assert.equal(aliasBody[i].args.length, argc);
    // The Core twin has the identical arg count at the identical index.
    assert.equal(coreBody[i].args.length, argc);
  }
});

test("an alias inside a procedure body carries canonical, like its Core twin", () => {
  const body = parseClean("to spin :n\n  rt 90\n  fd :n\nend\n").body[0].body
    .body;
  assert.equal(body[0].callee.name, "rt");
  assert.equal(body[0].canonical, "right");
  assert.equal(body[0].args.length, 1);
  assert.equal(body[1].callee.name, "fd");
  assert.equal(body[1].canonical, "forward");
  assert.equal(body[1].args.length, 1);
});

// ---------------------------------------------------------------------------
// The profile gate (visible-name based, no net-new checker rule)
// ---------------------------------------------------------------------------

test("Heritage active accepts all ten aliases silently (needs only Core + Heritage)", () => {
  const source = "fd 10\nbk 10\nlt 90\nrt 90\npu\npd\nst\nht\ncs\npr 7\n";
  assert.deepEqual(checkSource(source, HERITAGE_ACTIVE), []);
  // And with Data DEACTIVATED, which is what makes the name a measurement rather than a claim:
  // the negative below uses Core + Turtle & Rendering, so without this line nothing rules out
  // Data as the profile doing the admitting. `heritage` alone is what makes the spellings
  // visible — the nine turtle aliases resolve here with turtle-rendering INACTIVE too, which is
  // exactly why issue #860's DAG edge is a conformance-claim requirement and not a checker gate.
  assert.deepEqual(checkSource(source, ["core-language", "heritage"]), []);
});

test("Core rejects every alias with ol-unknown-command, one diagnostic each", () => {
  const source = "fd 10\nbk 10\nlt 90\nrt 90\npu\npd\nst\nht\ncs\npr 7\n";
  const findings = checkSource(source, CORE_ONLY);
  assert.equal(findings.length, 10);
  for (const finding of findings) {
    assert.equal(finding.code, "ol-unknown-command");
    assert.equal(finding.stage, "semantic");
    assert.equal(finding.severity, "error");
  }
  assert.deepEqual(
    findings.map((d) => d.params.name).sort(),
    Object.keys(ALIAS_TO_CANONICAL).sort(),
  );
  // The first finding's span points at the alias the learner wrote (`fd`, columns 1–3).
  assert.deepEqual(findings[0].source_span, span([1, 1], [1, 3]));
});

test("an alias program with heritage active is not flagged, but the Core-name twin never was", () => {
  const core = "forward 10\nback 10\nleft 90\nright 90\n";
  assert.deepEqual(
    checkSource(core, ["core-language", "turtle-rendering"]),
    [],
  );
});

// ---------------------------------------------------------------------------
// The did-you-mean tie-break: a full canonical name outranks a short alias
// (spec/error-model.md:210-211) when both tie on Levenshtein distance and sit
// in the same profile tier — reachable with Data + Heritage both active.
// ---------------------------------------------------------------------------

function suggestionFor(source, profiles) {
  const finding = checkSource(source, profiles).find(
    (d) => d.code === "ol-unknown-command",
  );
  assert.ok(
    finding,
    `expected ol-unknown-command for ${JSON.stringify(source)}`,
  );
  return finding.params.suggestion;
}

test("a tie between a Data primitive and a Heritage alias picks the full name, not the alias", () => {
  // `dca` is Levenshtein distance 2 from BOTH the Data primitive `dict` and the Heritage alias `cs`.
  // Both are optional-profile, so the Core-beats-optional rung cannot separate them; the full name
  // `dict` must win over the short alias `cs`. This exercises the `candidateIsAlias` rung in both
  // directions as the loop visits `cs` (alias) and `dict` (full name) in set order.
  assert.equal(
    suggestionFor("dca\n", ["core-language", "data", "heritage"]),
    "dict",
  );
  // Without Heritage the alias is not even a candidate, so `dict` wins trivially — same answer,
  // proving the fix did not change the non-Heritage outcome.
  assert.equal(suggestionFor("dca\n", ["core-language", "data"]), "dict");
});

test("an alias still wins when it is strictly the closest candidate", () => {
  // `c` is distance 1 from `cs` and distance ≥2 from any full name, so the alias legitimately wins
  // on distance alone — the tie-break rungs never run. Heritage alternate spellings remain
  // suggestible; the rung only demotes them on a *tie* with a full name.
  assert.equal(
    suggestionFor("c\n", ["core-language", "data", "heritage"]),
    "cs",
  );
});

test("a declared procedure spelled like an optional-profile word is not demoted beneath a Core word", () => {
  // Rung 1 (Core beats optional-profile) must also be declaration-aware. `define fd … end` makes
  // `fd` the learner's own procedure; the misspelling `f` is distance 1 from BOTH the declared `fd`
  // and the Core control word `if`. If `fd` were still classified as an optional-profile word (its
  // Heritage-alias spelling), rung 1 would wrongly demote it beneath Core `if`. Because a declared
  // name is exempt from rung 1's optional-profile demotion, `fd` and `if` are the same tier and the
  // lexicographically earlier `fd` wins — the learner's own definition is suggested, not `if`. Holds
  // with and without Heritage, since a declared name is visible regardless of profile.
  assert.equal(
    suggestionFor("define fd\nend\nf\n", ["core-language", "data"]),
    "fd",
  );
  assert.equal(
    suggestionFor("define fd\nend\nf\n", ["core-language", "data", "heritage"]),
    "fd",
  );
});

test("a user procedure named like an alias is NOT demoted — it is the learner's own procedure", () => {
  // `define fd … end` makes `fd` the program's own procedure, which shares its spelling with the
  // Heritage alias `fd`. The alias-demotion rung must exempt it: for the misspelling `fdck` (distance
  // 2 from both the declared `fd` and the Data primitive `pick`) the declared name must be treated as
  // an ordinary full name, not demoted as the short alias — so `fd` wins the tie over `pick`
  // lexicographically, exactly as it would for any non-alias-spelled procedure. This holds whether or
  // not Heritage is active, since a declared name is visible regardless of profile.
  assert.equal(
    suggestionFor("define fd\nend\nfdck\n", ["core-language", "data"]),
    "fd",
  );
  assert.equal(
    suggestionFor("define fd\nend\nfdck\n", [
      "core-language",
      "data",
      "heritage",
    ]),
    "fd",
  );
});
