// Guard for issue #1005: the case-folded-identifier diagnostic-identity guarantee. Two diagnostics
// name conditions keyed on case-insensitive identifiers, so the SAME condition must earn the SAME
// `params` whatever the source casing — `spec/error-model.md:255-260` makes identity `code` + `params`
// and tells tools to assert params, not English message text:
//
//   * `ol-undefined-var` — variable resolution folds case (`lookupVar`), so `:SomeVar` and `:somevar`
//     name the same absent binding. The checker (issue #113) already keys `params.name` on the folded
//     name; before the fix the runtime guard (`execute()`, issue #94) echoed the caller's original
//     casing, so one condition reported two identities across `check()` and `execute()`.
//   * `ol-unknown-field` — record fields are case-insensitive identifiers too (`values.ts` folds its
//     slot map), so `.Missing` and `.MISSING` name the same absent field. Before the fix both the
//     runtime (`errors.ts`'s `unknownField`) and the checker (`resolveRecordField`) echoed the
//     accessor casing, so one condition earned different identities depending on how it was typed.
//
// Both are now folded to the case-insensitive resolution identity at their single emission points.
// The undefined-var section asserts stage-agreement on `params` (and that the span does not diverge)
// over a mixed-case corpus across every runtime emission site: a bare `:name` read, a `thing "name"`
// read, a `Place` base read, and an indexed-place write to an unbound base. Revert either fold and
// the matching section fails with the runtime reporting the original casing.
//
// This is deliberately NOT routed through the `heritage-canonical-diagnostic-params` guards: those
// generate their twin corpus from `heritageSurfaceSpellings()`, but `SomeVar`/`.Missing` are not
// registered Heritage spellings and both stages spell them identically, so those guards can never
// reach this divergence. See the issue for the full rationale.

import assert from "node:assert/strict";
import { test } from "node:test";
import { check, parse } from "@openlogo/parser";
import { execute } from "@openlogo/runtime";

/** The lone `ol-undefined-var` diagnostic the checker raises for `source` (asserts exactly one). */
function checkerUndefinedVar(source) {
  const { ast, diagnostics } = parse(source, "undefined-var-case.logo");
  assert.deepEqual(
    diagnostics,
    [],
    `unexpected parse diagnostics for: ${source}`,
  );
  const undefinedVars = check(ast, {}).diagnostics.filter(
    (diagnostic) => diagnostic.code === "ol-undefined-var",
  );
  assert.equal(
    undefinedVars.length,
    1,
    `expected exactly one checker ol-undefined-var for: ${source}`,
  );
  return undefinedVars[0];
}

/** The lone `ol-undefined-var` diagnostic the runtime raises for `source` (asserts exactly one). */
function runtimeUndefinedVar(source) {
  const undefinedVars = execute(
    source,
    "undefined-var-case.logo",
  ).diagnostics.filter((diagnostic) => diagnostic.code === "ol-undefined-var");
  assert.equal(
    undefinedVars.length,
    1,
    `expected exactly one runtime ol-undefined-var for: ${source}`,
  );
  return undefinedVars[0];
}

// One template per runtime emission site, each parameterised by an undefined variable name. Every
// template must ALSO make the checker raise exactly one `ol-undefined-var` for the same read, so the
// two stages are comparable.
const emissionSites = [
  { site: "bare `:name` read", source: (name) => `print :${name}` },
  { site: '`thing "name"` read', source: (name) => `print thing "${name}"` },
  {
    site: "`Place` base read (dotted)",
    source: (name) => `print :${name}.field`,
  },
  {
    site: "indexed-place write to an unbound base",
    source: (name) => `:${name}[1] = 9`,
  },
];

// A corpus of mixed-case identifiers plus their all-lowercase control. The lowercase rows already
// agreed before the fix, so their presence proves the guard passes on the agreeing case too; the
// mixed-case rows are the ones that diverged.
const identifierCorpus = [
  "SomeVar",
  "SOMEVAR",
  "somevar",
  "MixedCaseName",
  "camelCase",
  "PascalCase",
  "sCreAmInG",
];

for (const { site, source } of emissionSites) {
  for (const name of identifierCorpus) {
    test(`ol-undefined-var params agree across stages — ${site}, :${name}`, () => {
      const src = source(name);
      const checkerDiagnostic = checkerUndefinedVar(src);
      const runtimeDiagnostic = runtimeUndefinedVar(src);

      // The identity (code + params) must be identical across stages — the normative guarantee.
      assert.deepEqual(
        runtimeDiagnostic.params,
        checkerDiagnostic.params,
        `params diverged for ${site} :${name}`,
      );
      // params.name is the folded (case-insensitive resolution) identity, not the source casing.
      assert.deepEqual(runtimeDiagnostic.params, { name: name.toLowerCase() });

      // The issue asks us to record whether the span diverges — it must not.
      assert.deepEqual(
        runtimeDiagnostic.source_span,
        checkerDiagnostic.source_span,
        `span diverged for ${site} :${name}`,
      );
    });
  }
}

// The paired control that makes the case-insensitivity claim meaningful: `:fd = 5; print :FD`
// resolves cleanly (0 undefined-var), while the SAME program reading an unrelated name raises one.
// The non-zero arm proves the zero is genuine resolution, not silence.
test("case-insensitive resolution control: a bound name read in another case is not undefined", () => {
  // `:fd = 5` then `print :FD` resolves cleanly: the whole program is diagnostic-free, so there is
  // certainly no `ol-undefined-var`. Asserting the empty array is a stronger claim than filtering.
  const resolved = execute(":fd = 5\nprint :FD", "control.logo").diagnostics;
  assert.deepEqual(resolved, []);

  // The non-zero arm on the SAME program shape proves the clean result above is genuine resolution,
  // not silence: reading an unrelated, never-set name still raises exactly one folded diagnostic.
  const unresolved = execute(
    ":fd = 5\nprint :NEVERSET",
    "control.logo",
  ).diagnostics.filter((diagnostic) => diagnostic.code === "ol-undefined-var");
  assert.equal(unresolved.length, 1);
  assert.deepEqual(unresolved[0].params, { name: "neverset" });
});

// --- ol-unknown-field: the sibling case-folded identifier param (issue #1005, criterion 4) -------
//
// Record fields are ALSO case-insensitive identifiers (`values.ts` keys its slot map on the folded
// field name; `spec/grammar.md:13`), so `.Missing` and `.MISSING` name the SAME absent field: one
// condition. Before the fix both the runtime (`errors.ts`'s `unknownField`) and the checker
// (`checker-type-field.ts`'s `resolveRecordField`) echoed the accessor's original casing, so one
// condition earned different diagnostic identities depending on how it was typed. Both now fold
// `field` to its resolution identity. This guard proves it two ways: within the runtime a mixed-case
// accessor corpus collapses to one folded `params.field`, and where the checker DOES fire (a
// statically typed parenthesized-constructor read, issue #441) it agrees with the runtime.
//
// `type` is deliberately NOT asserted-as-folded: a record's `type` is always the single declared
// struct-name spelling (`values.ts` stores the declared form, not the constructor call's casing), so
// it is already canonical and does not vary with the accessor.

/** The lone `ol-unknown-field` the runtime raises reading `.field` off a fresh `point 1 2`. */
function runtimeUnknownField(field) {
  const source = `struct point [ x y ]\n:p = point 1 2\nprint :p.${field}`;
  const unknownFields = execute(
    source,
    "unknown-field-case.logo",
  ).diagnostics.filter((diagnostic) => diagnostic.code === "ol-unknown-field");
  assert.equal(
    unknownFields.length,
    1,
    `expected exactly one runtime ol-unknown-field for :p.${field}`,
  );
  return unknownFields[0];
}

/** The lone `ol-unknown-field` the checker raises for a parenthesized-constructor `.field` read. */
function checkerUnknownField(field) {
  const source = `struct point [ x y ]\nprint (point 1 2).${field}`;
  const { ast, diagnostics } = parse(source, "unknown-field-case.logo");
  assert.deepEqual(
    diagnostics,
    [],
    `unexpected parse diagnostics for .${field}`,
  );
  const unknownFields = check(ast, {
    profiles: ["core-language", "data"],
  }).diagnostics.filter((diagnostic) => diagnostic.code === "ol-unknown-field");
  assert.equal(
    unknownFields.length,
    1,
    `expected exactly one checker ol-unknown-field for (point 1 2).${field}`,
  );
  return unknownFields[0];
}

const fieldCorpus = [
  "Missing",
  "MISSING",
  "missing",
  "NoSuchField",
  "camelGone",
];

for (const field of fieldCorpus) {
  test(`ol-unknown-field params.field folds to the resolution identity — runtime :p.${field}`, () => {
    assert.deepEqual(runtimeUnknownField(field).params, {
      type: "point",
      field: field.toLowerCase(),
    });
  });

  test(`ol-unknown-field params agree across stages — (point 1 2).${field}`, () => {
    const runtimeDiagnostic = runtimeUnknownField(field);
    const checkerDiagnostic = checkerUnknownField(field);
    assert.deepEqual(runtimeDiagnostic.params, checkerDiagnostic.params);
    assert.deepEqual(checkerDiagnostic.params, {
      type: "point",
      field: field.toLowerCase(),
    });
  });
}

// --- callable identity: arity / no-output / unknown-command (issue #1005, criterion 4) -----------
//
// Procedure and command *names* are case-insensitive identifiers too (the runtime folds the callee
// before `environment.procedures.get`, and the checker resolves on the folded name), so `FOO`, `Foo`,
// and `foo` are one callable: one condition. The canonical identity is the **definition's declared
// spelling**, which is exactly what the static checker already reports (`checker-arity.ts`'s
// `params.callable` = `procedure.declared`; the enter/exit trace events use `def.name.name`). Before
// the fix the runtime's arity and no-output diagnostics echoed the *call site's* casing instead, so
// `ol-not-enough-inputs` / `ol-too-many-inputs` diverged across `check()` and `execute()`, and
// `ol-no-output` was unstable within the runtime. For an *unknown* command there is no runtime
// counterpart (the runtime never resolves a name it cannot find), but the checker itself echoed the
// source casing, so `Mystery` and `mystery` earned two identities for one absent callable; it now
// folds to the resolution identity. These are still NOT Heritage-shaped — both sides spell the name
// identically — so the `heritage-canonical-diagnostic-params` guards can never reach them.

/** The lone diagnostic of `code` the checker raises for `source` (asserts exactly one). */
function checkerCallable(source, code) {
  const { ast, diagnostics } = parse(source, "callable-case.logo");
  assert.deepEqual(
    diagnostics,
    [],
    `unexpected parse diagnostics for: ${source}`,
  );
  const matches = check(ast, {}).diagnostics.filter(
    (diagnostic) => diagnostic.code === code,
  );
  assert.equal(
    matches.length,
    1,
    `expected exactly one checker ${code} for: ${source}`,
  );
  return matches[0];
}

/** The lone diagnostic of `code` the runtime raises for `source` (asserts exactly one). */
function runtimeCallable(source, code) {
  const matches = execute(source, "callable-case.logo").diagnostics.filter(
    (diagnostic) => diagnostic.code === code,
  );
  assert.equal(
    matches.length,
    1,
    `expected exactly one runtime ${code} for: ${source}`,
  );
  return matches[0];
}

// The definitions use a MIXED-case declared spelling on purpose: an all-lowercase name would let the
// call site, the declared spelling, and the lowercased form coincide, so it could not tell "report
// the declared spelling" apart from "lowercase the call site". `MixedProc`/`MixedCmd` pin the rule to
// the DECLARED spelling — the same reasoning as the check-side `arity-procedure-declared-spelling`
// fixture (issue #874). Each is called in several casings including its own.
const declaredProc = "MixedProc";
const declaredCmd = "MixedCmd";
const callSpellingsFor = (declared) => [
  declared,
  declared.toUpperCase(),
  declared.toLowerCase(),
];

for (const call of callSpellingsFor(declaredProc)) {
  // `define MixedProc :a :b` called with one arg: too few. Checker and runtime must agree on
  // `callable`, and it must be the DECLARED `MixedProc`, never the call-site casing or a lowercasing.
  test(`ol-not-enough-inputs callable identity — (${call} 1)`, () => {
    const source = `define ${declaredProc} :a :b\n  return :a\nend\nprint (${call} 1)`;
    const runtimeDiagnostic = runtimeCallable(source, "ol-not-enough-inputs");
    const checkerDiagnostic = checkerCallable(source, "ol-not-enough-inputs");
    assert.deepEqual(runtimeDiagnostic.params, checkerDiagnostic.params);
    assert.equal(runtimeDiagnostic.params.callable, declaredProc);
  });

  // `define MixedProc :a` called with two args: too many.
  test(`ol-too-many-inputs callable identity — (${call} 1 2)`, () => {
    const source = `define ${declaredProc} :a\n  return :a\nend\nprint (${call} 1 2)`;
    const runtimeDiagnostic = runtimeCallable(source, "ol-too-many-inputs");
    const checkerDiagnostic = checkerCallable(source, "ol-too-many-inputs");
    assert.deepEqual(runtimeDiagnostic.params, checkerDiagnostic.params);
    assert.equal(runtimeDiagnostic.params.callable, declaredProc);
  });
}

for (const call of callSpellingsFor(declaredCmd)) {
  // `define MixedCmd` (a command — never returns) read in value position: `ol-no-output`.
  // Runtime-only, but its `params.procedure` must be the declared spelling regardless of call casing.
  test(`ol-no-output procedure identity — print (${call})`, () => {
    const source = `define ${declaredCmd}\n  forward 1\nend\nprint (${call})`;
    const runtimeDiagnostic = runtimeCallable(source, "ol-no-output");
    assert.deepEqual(runtimeDiagnostic.params, { procedure: declaredCmd });
  });
}

// `ol-unknown-command` is a checker-only diagnostic (the runtime never resolves an unknown name), so
// the guarantee is internal: every casing of one absent callable earns one folded `params.name`.
for (const spelling of ["Mystery", "MYSTERY", "mystery"]) {
  test(`ol-unknown-command params.name folds to the resolution identity — ${spelling}`, () => {
    const diagnostic = checkerCallable(spelling, "ol-unknown-command");
    assert.deepEqual(diagnostic.params, { name: "mystery" });
  });
}

// The paired control: a callable that DOES resolve (in another case) is clean, so the folded
// identities above are genuine resolution, not blanket noise. Declared `foo`, called `FOO`.
test("case-insensitive callable resolution control: a declared procedure called in another case is clean", () => {
  const resolved = execute(
    "define foo :a\n  return :a\nend\nprint (FOO 1)",
    "control.logo",
  ).diagnostics;
  assert.deepEqual(resolved, []);
});

// The field-resolution paired control: a field that DOES resolve in another case is clean, so the
// folded `ol-unknown-field` identities above are genuine resolution, not blanket noise. Declared
// `x`, read as `.X`.
test("case-insensitive field resolution control: a struct field read in another case is clean", () => {
  const resolved = execute(
    "struct point [ x y ]\n:p = point 1 2\nprint :p.X",
    "field-control.logo",
  ).diagnostics;
  assert.deepEqual(resolved, []);
});

// --- primitive callable identity: arity of built-ins (issue #1005, criterion 4) -----------------
//
// A built-in primitive is a case-insensitive callable too, but unlike a user procedure it has no
// "declared spelling" — its canonical identity is the profile's own name for it, which the runtime
// carries as `node.canonical` (a Heritage alias like `RT` canonicalises to `right`) and otherwise
// lowercases. That is exactly what the checker reports (`checker-arity.ts`:
// `heritageActive && node.canonical ? node.canonical : lower`). Before the fix the runtime's ~26
// primitive arity sites echoed the *call site's* casing, so `RIGHT` / `right` / `(PEN_UP 1)` diverged
// across `check()` and `execute()`. This section pins stage-agreement on the canonical identity for a
// spread of profiles: a Core zero/one-arg primitive, a renderer-backed one, a sound one, and a
// Heritage alias (whose canonical is a *different* string, so it also proves the alias folds).
const primitiveArityCases = [
  { source: "RIGHT", code: "ol-not-enough-inputs", callable: "right" },
  {
    source: "SET_HEADING",
    code: "ol-not-enough-inputs",
    callable: "set_heading",
  },
  { source: "(PEN_UP 1)", code: "ol-too-many-inputs", callable: "pen_up" },
  {
    source: "(HIDE_TURTLE 1)",
    code: "ol-too-many-inputs",
    callable: "hide_turtle",
  },
];

for (const { source, code, callable } of primitiveArityCases) {
  test(`primitive ${code} callable identity agrees across stages — ${source}`, () => {
    const { ast, diagnostics: parseDiagnostics } = parse(source, "prim.logo");
    assert.deepEqual(
      parseDiagnostics,
      [],
      `unexpected parse diagnostics for: ${source}`,
    );
    const profiles = { profiles: ["core-language", "turtle-rendering"] };
    const checkerMatches = check(ast, profiles).diagnostics.filter(
      (d) => d.code === code,
    );
    const runtimeMatches = execute(
      source,
      "prim.logo",
      profiles,
    ).diagnostics.filter((d) => d.code === code);
    assert.equal(
      checkerMatches.length,
      1,
      `expected one checker ${code} for: ${source}`,
    );
    assert.equal(
      runtimeMatches.length,
      1,
      `expected one runtime ${code} for: ${source}`,
    );
    assert.deepEqual(runtimeMatches[0].params, checkerMatches[0].params);
    assert.equal(runtimeMatches[0].params.callable, callable);
  });
}

// A Heritage alias whose canonical differs from its surface spelling: `PU` → `pen_up`. Both stages
// must report the canonical `pen_up`, never the alias's own casing.
test("primitive ol-too-many-inputs folds a Heritage alias to its canonical — (PU 1)", () => {
  const source = "(PU 1)";
  const profiles = {
    profiles: ["core-language", "turtle-rendering", "heritage"],
  };
  const { ast } = parse(source, "prim.logo");
  const checkerMatch = check(ast, profiles).diagnostics.find(
    (d) => d.code === "ol-too-many-inputs",
  );
  const runtimeMatch = execute(source, "prim.logo", profiles).diagnostics.find(
    (d) => d.code === "ol-too-many-inputs",
  );
  assert.ok(checkerMatch, "expected a checker ol-too-many-inputs for (PU 1)");
  assert.ok(runtimeMatch, "expected a runtime ol-too-many-inputs for (PU 1)");
  assert.deepEqual(runtimeMatch.params, checkerMatch.params);
  assert.equal(runtimeMatch.params.callable, "pen_up");
});
