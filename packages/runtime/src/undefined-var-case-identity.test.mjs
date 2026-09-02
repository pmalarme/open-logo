// Guard for issue #1005: the `ol-undefined-var` diagnostic must carry the SAME `params.name` from
// the semantic checker (`check()`, issue #113) and the runtime guard (`execute()`, issue #94) for
// the same undefined variable, whatever the source casing.
//
// Why this can actually fail: variable resolution is case-insensitive — `lookupVar` folds `:name`
// to lowercase before probing every frame — so `:SomeVar` and `:somevar` name the *same* absent
// binding: ONE condition. `spec/error-model.md:254-259` makes a diagnostic's identity its `code`
// **plus `params`**, and tells tools to assert codes and params rather than English message text.
// The checker keys `params.name` on the folded name (the resolution identity); before the fix the
// runtime echoed the caller's original casing, so one condition reported two identities. This guard
// asserts stage-agreement on `params` (and, for good measure, that the span does not diverge) over
// a corpus of mixed-case identifiers, across every runtime emission site: a bare `:name` read, a
// `thing "name"` read, a `Place` base read, and an indexed-place write to an unbound base. Revert
// the fold in `errors.ts`'s `undefinedVar` and this guard fails with the runtime reporting the
// original casing while the checker reports the folded name.
//
// This is deliberately NOT routed through the `heritage-canonical-diagnostic-params` guards: those
// generate their twin corpus from `heritageSurfaceSpellings()`, but `SomeVar` is not a registered
// Heritage spelling and both stages spell it identically, so those guards can never reach this
// divergence. See the issue for the full rationale.

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
