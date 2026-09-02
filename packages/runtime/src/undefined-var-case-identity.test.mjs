// Guard for issue #1005: the case-folded-identifier diagnostic-identity guarantee. Two diagnostics
// name conditions keyed on case-insensitive identifiers, so the SAME condition must earn the SAME
// `params` whatever the source casing — `spec/error-model.md:254-259` makes identity `code` + `params`
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

// The paired control: a field that IS declared (in another case) resolves cleanly, so the folded
// identities above are genuine resolution, not blanket noise. `.X` addresses declared `x`.
test("case-insensitive field resolution control: a declared field read in another case is clean", () => {
  const resolved = execute(
    "struct point [ x y ]\n:p = point 1 2\nprint :p.X",
    "control.logo",
  ).diagnostics;
  assert.deepEqual(resolved, []);
});
