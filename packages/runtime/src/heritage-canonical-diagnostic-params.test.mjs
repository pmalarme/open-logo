// The RUNTIME-stage half of the class guard for issues #737/#741: a Heritage surface spelling must
// never reach a diagnostic's structured `params`.
//
// ## Why this file exists, and why it is here rather than beside the parser's guard
//
// Diagnostic identity is `code` plus structured `params`, and the SAME condition MUST keep the same
// code AND the same params (`spec/error-model.md:235-238`, "Localization boundary"). Heritage is
// defined as "alternate spellings only, no new semantics" (`spec/conformance.md#heritage`), so a
// Heritage spelling and its Core twin are the same condition: their diagnostics must agree in `code`
// and in every param whose subject is not the learner's own text. Only the prose `message` — and the
// handful of audited surface-subject fields below, which quote the learner by contract — may echo
// the learner's own word.
//
// OpenLogo reports diagnostics at three stages — parse, semantic, and runtime. `@openlogo/parser`'s
// `heritage-canonical-diagnostic-params.test.mjs` (issue #737) guards the first two through
// `parse()`/`check()`. It cannot reach the third: `execute()` lives in `@openlogo/runtime`, which
// depends on `@openlogo/parser` and not the other way round, so a parser test that imported the
// runtime would invert the package dependency direction (`ts7-package`). This file is that missing
// third stage, and it is the guard's counterpart in the package that owns the code it audits.
//
// The stage matters, and #741 is the proof. `execute()` runs `parse()` only, never `check()`, so
// `@openlogo/runtime` keeps its OWN copies of the checker's control-flow rules. #737 canonicalized
// `params.keyword` in the checker; the runtime copies still emitted the surface spelling, so the
// same `output 5` reported `keyword: "return"` when checked and `keyword: "output"` when executed.
// A LOCAL fix is exactly how this class survived three previous rounds — `operation` (H5/#670) and
// `callable` (H4/#669 → #733) were each fixed at the one param that was reported, and `keyword`
// (#737) at the one stage that was reported. Every fix was correct and every fix was local, so the
// class stayed open. This guard is therefore driven by the registries and covers the whole runtime
// stage rather than the two sites the issue named.
//
// Unlike the parser's guard, this one needs no profile list: `execute()` takes no profile set and
// never runs the profile gate (that is `check()`'s job), so every Heritage spelling is executable
// here by construction — which is precisely why the runtime must canonicalize its params itself.
//
// Four properties. However each twin is authored — the short-alias twins are generated from
// `heritageAliasNames()`, the rest are hand-written literals — property 3 pins the union of their
// `covers` to `heritageSurfaceSpellings()` = `heritageAliasNames()` + `heritageFormHeadNames()`, in
// both directions. So a slice that adds a fourteenth alias or a fifth form head CANNOT land without
// either extending the twin corpus below or failing this test:
//
//   1. TWIN EQUALITY — for each Heritage spelling, an EXECUTED program written with it and the same
//      program written with its Core spelling produce diagnostics with identical `code`, `stage`,
//      `severity`, and param FIELD SET, and identical VALUES for every field except the audited
//      surface-subject ones — those are compared structurally only, since their value IS the
//      learner's own word and so differs by design.
//   2. NO SURFACE SPELLING IN PARAMS — no param value of any diagnostic in the corpus contains a
//      registered Heritage spelling as a whole word. This catches what twin equality cannot: a
//      diagnostic only the Heritage side can ever raise, which has no twin to disagree with.
//   3. COVERAGE — every spelling the registries know has a twin, and no twin names a spelling they
//      no longer know.
//   4. EXACT PARAMS for the one Heritage form no registry enumerates — the worded
//      `value of … for key` reader (EXTRA_TWINS). Properties 1 and 2 both run over those pairs, but
//      neither can pin the expected canonical VALUE there: the form's spelling is not in the
//      registries, so property 2 has no pattern for it, and property 1 compares the two sides only
//      against each other. Since issue #784 the reader shares the Core selectors' own
//      `resolveDictSegment` rather than restating it, so there is no second copy for property 1 to
//      catch drifting; what property 1 still does catch is a wrong ARGUMENT from one side, which
//      moves that side alone. What neither can see is a defect in the shared code itself, which
//      moves both sides together. Only an exact expectation covers that, so its params are pinned
//      by value.
//
// Those registries enumerate SINGLE-WORD spellings only. Heritage also adds one multi-word FORM,
// the worded dictionary reader `value of … for key` (slice H5, #670), which no registry lists —
// so registry coverage alone is NOT coverage of Heritage. It is therefore twinned explicitly in
// EXTRA_TWINS below, against the Core selector it mirrors — the dotted `:dict.key` for the
// operand's own type, the runtime-key `:dict["key"]` for the key's (see EXTRA_TWINS) — and it is
// property 4, not 1 or 2, that actually pins it.
//
// Properties 1 and 2 exempt only the explicitly audited param FIELDS whose subject IS the learner's
// own text (documented with its spec citation in SURFACE_SUBJECT_PARAMS). Exemption is per FIELD,
// never per code: skipping a whole diagnostic would also skip its other params, so a
// canonical-carrying field sitting beside a surface one would go unchecked.
//
// The first three properties are structural — they compare, they do not name a value (property 4 is
// the exception: naming values is exactly what it does). They are therefore backed by DIRECT value
// assertions: `params.callable` against the registry's canonical for every alias, and whole-object
// `params` on both `keyword`-carrying sites for all three `return` spellings plus `stop`. The
// absence of exactly that kind of assertion is what let this bug class ship four times, so the
// structural properties are never left to speak for the values alone. Three further tests guard the
// corpus itself rather than the code — that no pair is vacuous, that every diagnostic compared
// really is runtime-stage, and that no allow-list entry has gone stale.
//
// Twin equality is only as strong as the field the twins actually compare, which is the trap this
// corpus is built to avoid: an alias program whose first statement halts on a spelling-INDEPENDENT
// diagnostic (`fd :missing_input` → `ol-undefined-var { name: "missing_input" }`) compares two
// diagnostics that could never have differed, so surface leakage into a `callable` further down the
// program would pass unnoticed. Every alias twin below is therefore shaped to reach a
// CANONICAL-carrying field — `ol-not-enough-inputs`/`ol-too-many-inputs`'s `callable` — and a
// dedicated test asserts that it really does, by value, for every alias in the registry.
//
// A note for whoever extends the corpus: property 2 matches Heritage spellings as whole words
// against the rendered params, so a param that legitimately quotes learner-chosen text can trip it —
// `print :fd` raises `ol-undefined-var` with `params.name` `"fd"`, which is correct because the
// learner named their variable `fd`. Today's corpus cannot hit that: no learner-chosen name, key, or
// value it puts in front of the runtime collides with a Heritage spelling. If you add a program
// whose identifiers do collide, rename the identifier rather than widening SURFACE_SUBJECT_PARAMS —
// that allow-list is for fields that are surface BY CONTRACT, not for corpus accidents.

import assert from "node:assert/strict";
import { test } from "node:test";
import { OLTurtle } from "@openlogo/core";
import {
  canonicalOfHeritageAlias,
  heritageAliasArity,
  heritageAliasNames,
  heritageFormHeadNames,
  heritageSurfaceSpellings,
} from "@openlogo/parser";
import { execute } from "@openlogo/runtime";

const doc = "heritage-canonical-diagnostic-params.logo";

/**
 * The id `who` reports at top level — the single default main turtle every world starts with,
 * before any `tell` re-points the addressed set (`spec/turtles-and-sprites.md:44`). Restated here
 * rather than imported because the runtime's `MAIN_TURTLE_ID` is internal to `turtle-world.ts` and
 * `@openlogo/turtle`, which exports it, sits on the far side of a package boundary this test must
 * not cross. Should the runtime ever renumber the main turtle, the turtle twin below fails loudly
 * on the mismatch rather than degrading silently.
 */
const MAIN_TURTLE_ID = 0;

/** Every diagnostic an EXECUTED document produces — the runtime stage this guard exists for. */
function diagnosticsFor(source) {
  return execute(source, doc).diagnostics;
}

/**
 * The param FIELDS that are SURFACE by contract, keyed by code then field name, with the reason each
 * was audited and kept. Exemption is deliberately PER FIELD, not per code: skipping a whole
 * diagnostic would also skip its other params, so a canonical-carrying field on one of these codes
 * would go unchecked. Only the named field is exempt; every sibling field is still held to the
 * canonical rule.
 *
 * Exactly one field in this corpus needs that exemption. Other params quote the learner too —
 * `ol-undefined-var`'s `name`, `ol-unknown-key`'s `key` — but the text they quote is the learner's
 * own identifier or key, which is identical on BOTH sides of a twin, so they are compared value for
 * value like any other field. Only a field whose value is the learner's own SPELLING legitimately
 * differs between twins, and only such a field belongs here.
 */
const SURFACE_SUBJECT_PARAMS = {
  "ol-not-a-place": {
    text:
      "`spec/tooling.md:218-219` MANDATES the surface value: `count :nums = 3` → " +
      '`params={ text: "count :nums" }`. It is a machine-readable quotation of the span, not an ' +
      "identifier — canonicalizing it would make the param disagree with its own source_span, " +
      "and a target such as `1 + 2` or `(first :x)` has no canonical form at all. The runtime " +
      "derives it from the same rule as the checker (`not-a-place-text.ts`), so both stages quote " +
      "the learner identically.",
  },
};

/** Is `field` on `code` exempt from the canonical rule? */
function isSurfaceSubject(code, field) {
  const fields = SURFACE_SUBJECT_PARAMS[code];
  return fields !== undefined && fields[field] !== undefined;
}

/**
 * A call written with `name`, in the shape that makes the runtime report on it through a
 * CANONICAL-carrying param — `ol-not-enough-inputs`/`ol-too-many-inputs`'s `callable`.
 *
 * That shape is the point. The obvious program, `fd :missing_input`, halts on `ol-undefined-var`
 * with the learner's own variable name: a diagnostic that could not differ between the two
 * spellings, so comparing it proves nothing about the alias. A zero-arity command is therefore
 * over-supplied through the parenthesized form, and anything else is under-supplied the same way —
 * both of which name the callee, canonically.
 *
 * The extra `print (…)` line is what reaches the three list-reporter aliases (`bf`/`bl`/`se`): the
 * current runtime does not evaluate a bare expression statement — an implementation state, not a
 * spec rule (`spec/execution-model.md:412-413` — "Used alone as a statement, its result is
 * *discarded* like any other unused value", i.e. evaluated and then dropped) — so the reporter is
 * placed where its value is required. The shape is deliberately robust if that changes: an
 * evaluated `(bf)` on line 1 raises the identical `ol-not-enough-inputs` with the identical
 * canonical `callable`, only at a different span, and twin equality deliberately does not compare
 * spans. Should it ever stop reporting at all, the per-alias assertion below fails loudly rather
 * than silently degrading to a vacuous comparison.
 *
 * `heritageAliasArity` resolves the alias and then reads the CANONICAL's own arity table, so both
 * sides of a twin are built at the same arity and differ only in the spelling.
 */
function aliasProgram(name, arity) {
  if (arity === 0) {
    return `(${name} 1)`;
  }
  return `(${name})\nprint (${name})`;
}

/**
 * The twin corpus. Each entry pairs a program written with Heritage spellings against the same
 * program written with their Core spellings, and declares which Heritage spellings it covers so the
 * coverage assertion below can hold it against the parser's own registries. Every program is
 * EXECUTED, so every diagnostic compared here is one `execute()` raises itself.
 */
const TWINS = [
  // --- hand-written twins ---------------------------------------------------------------------
  // The four form heads, plus one alias (`cs`) whose generated arity program cannot reach
  // `ol-not-a-place` — the audited surface-subject field — so it needs a program of its own.
  {
    covers: ["output"],
    heritage: "output 5",
    core: "return 5",
    note: "ol-return-outside-proc — the #741 defect itself",
  },
  {
    covers: ["op"],
    heritage: "op 5",
    core: "return 5",
    note: "ol-return-outside-proc, short spelling",
  },
  {
    covers: ["output", "op"],
    heritage: ":nums = [ 1 2 ]\nprint map n in :nums [ output :n ]",
    core: ":nums = [ 1 2 ]\nprint map n in :nums [ return :n ]",
    note: "ol-return-in-comprehension — the second #741 site",
  },
  {
    covers: ["to"],
    heritage: "to f\n  return 1\nend\nprint (f 1)",
    core: "define f\n  return 1\nend\nprint (f 1)",
    note: "ol-too-many-inputs raised through a Heritage procedure head",
  },
  {
    covers: ["make"],
    heritage: 'make "x" (butfirst)',
    core: "set x to (butfirst)",
    note: "ol-not-enough-inputs raised through a Heritage assignment head",
  },
  {
    covers: ["cs"],
    heritage: "cs = 3",
    core: "clear_screen = 3",
    note: "ol-not-a-place — the runtime's one audited surface-subject field",
  },
  // --- short command/reporter aliases -------------------------------------------------------
  // One entry per alias, generated from the registry itself so the list cannot drift.
  ...heritageAliasNames().map((alias) => {
    // Never `?? 0`: every name from the alias registry HAS an arity by construction
    // (`heritageAliasArity` resolves the alias then reads its canonical's own table), and that
    // invariant is asserted in the coverage test below rather than papered over with a fallback that
    // could silently build a zero-argument program for a one-argument command.
    const arity = heritageAliasArity(alias);
    return {
      covers: [alias],
      heritage: aliasProgram(alias, arity),
      core: aliasProgram(canonicalOfHeritageAlias(alias), arity),
      note: `short alias ${alias} → ${canonicalOfHeritageAlias(alias)}`,
    };
  }),
];

/**
 * Every non-dict container type a program can build, EXCEPT `record`, with the Core value each
 * evaluates to.
 *
 * `record` is excluded because it has no Core twin to compare against: the reader rejects it
 * (`spec/data-structures.md:268` types the operand `dictExpr`) while the Core dotted selector
 * ACCEPTS records and reports `ol-unknown-field` instead, so the two sides legitimately differ and
 * a twin pair would be asserting a falsehood. That case is pinned on its own, without a twin, by
 * `tests/conformance/heritage/execution/heritage-value-of-key-record-container-rejected`.
 *
 * This enumeration exists because issue #784 survived by CORPUS SHAPE, not by absence of tests. The
 * reader had one non-dict twin and it used a number — the only non-dict type the corpus exercised,
 * and one for which the WRONG params (`expected: "list or dict"`, the `[key]` selector's set) still
 * produce a sentence that reads sensibly. A list operand made the same params say "index needs a
 * list or dict, but got a list": `list` is the only non-dict container INSIDE that `expected` set,
 * so it alone made the diagnostic name the offending value's own type as what it required.
 * Enumerating the types, rather than picking one, removes shape as a hiding place: a future
 * divergence that is coherent for some types and not others can no longer land on whichever type
 * nobody wrote a twin for.
 *
 * `turtle` is included even though it needs the Sprites profile, because it is a container type a
 * learner can reach (`who`) and therefore one this reader must answer coherently.
 */
const NON_DICT_CONTAINERS = [
  { type: "number", setup: ":x = 5", value: 5 },
  { type: "word", setup: ':x = "hi"', value: "hi" },
  { type: "boolean", setup: ":x = true", value: true },
  { type: "list", setup: ":x = [ 1 2 ]", value: [1, 2] },
  { type: "turtle", setup: ":x = who", value: new OLTurtle(MAIN_TURTLE_ID) },
];

/**
 * Heritage shapes the registries do NOT enumerate, twinned explicitly, each with the EXACT params
 * its Core twin reports.
 *
 * `heritageSurfaceSpellings()` lists single-word spellings — short aliases and form heads. Heritage
 * also adds one multi-WORD form, the worded dictionary reporter `value of … for key`
 * (`spec/conformance.md#heritage`, slice H5/#670), which no registry names, so registry coverage is
 * not by itself coverage of Heritage. These pairs are held to every property below except the
 * registry-coverage assertion, which is deliberately about registry drift; keeping them in their own
 * list is what stops "covers a spelling the registries do not know" from firing on them.
 *
 * `expected` pins each pair's params BY VALUE rather than leaving them to the whole-word matcher,
 * because for this form the matcher is the wrong tool in both directions. The parser's designated
 * surface head is the bare word `value` (`checker-heritage-form.ts`'s `VALUE_OF_KEY_HEAD`), so a
 * leak could read `operation: "value"` — which no `"value of"`/`"for key"` phrase would catch — while
 * a pattern broad enough to catch it, or a `for key` fragment, would fire spuriously on ordinary
 * learner text that is not Heritage at all. An exact expectation covers both cases.
 *
 * The reader is no longer a parallel implementation: since issue #784 it calls the very same
 * `resolveDictSegment` the Core selectors call, so there is no second copy for twin equality to
 * catch drifting. Equality still catches a wrong ARGUMENT from one side — `operation`, and so which
 * Core twin this spelling claims, which is exactly what #784 got wrong. What it cannot see is a
 * defect in the shared code itself, which moves both sides together; that is what these by-value
 * pins exist for. Issue #755 tracks making the form enumerable in the parser; when it lands these
 * pairs join TWINS and this list goes.
 *
 * **Which Core twin.** The reader is dict-only (`spec/data-structures.md:268` types its operand
 * `dictExpr`), so the container-type twin is the dotted selector `:x.tom` — specifically its dict
 * branch, since `.key` also accepts records — NOT `:x["tom"]`. Pairing it with `[key]` is precisely
 * what produced #784's self-contradictory message. `[key]` remains the twin for the runtime-KEY
 * failure, which `.tom` — whose key is a parse-time identifier — cannot express.
 */
const EXTRA_TWINS = [
  {
    heritage: ':ages = { tom: 11 }\nprint value of :ages for key "zed"',
    core: ':ages = { tom: 11 }\nprint :ages["zed"]',
    note: "value of … for key on a missing key — ol-unknown-key { key }",
    expected: [{ code: "ol-unknown-key", params: { key: "zed" } }],
  },
  // One pair per non-dict container type (issue #784). The Core side is the dotted `.tom`
  // selector, which is what makes `expected: "dict"` / `operation: "field"` the twin's own params
  // rather than a value invented for Heritage.
  ...NON_DICT_CONTAINERS.map(({ type, setup, value }) => ({
    heritage: `${setup}\nprint value of :x for key "tom"`,
    core: `${setup}\nprint :x.tom`,
    note: `value of … for key on a non-dict ${type} container — ol-type { expected, actual, value, operation }`,
    expected: [
      {
        code: "ol-type",
        params: {
          expected: "dict",
          actual: type,
          value,
          operation: "field",
        },
      },
    ],
  })),
  {
    // The third failure mode `evaluate.ts`'s dict-read guard documents, and the one the other
    // pairs miss: a key that is neither word nor number. The key is bound to `:k` on both sides so
    // the two programs supply the SAME evaluated value. An inline key would not be a twin on either
    // of two mechanisms: for a LIST key the inline Core form does not even parse
    // (`:ages[[ 1 2 ]]` → `ol-bad-token` plus unmatched brackets), and for a BOOLEAN key it parses
    // but means something else — `spec/grammar.md:256`, "a bare identifier inside a selector is a
    // literal word key", so `:ages[true]` is the word `"true"` while `for key true` evaluates a
    // boolean. Binding the key sidesteps both.
    heritage:
      ":ages = { tom: 11 }\n:k = [ 1 2 ]\nprint value of :ages for key :k",
    core: ":ages = { tom: 11 }\n:k = [ 1 2 ]\nprint :ages[:k]",
    note: "value of … for key on a non-word/number key — ol-type { expected: 'word or number' }",
    expected: [
      {
        code: "ol-type",
        params: {
          expected: "word or number",
          actual: "list",
          value: [1, 2],
          operation: "index",
        },
      },
    ],
  },
];

/**
 * Every twin, registry-driven and explicit alike — the corpus properties 1 and 2 and the supporting
 * invariants run over. The other two properties are deliberately narrower: property 3, the
 * registry-coverage assertion, uses `TWINS` alone because it is about registry DRIFT and
 * `EXTRA_TWINS` carry no `covers`; property 4 uses `EXTRA_TWINS` alone because it exists for exactly
 * those pairs (see `EXTRA_TWINS` above).
 */
const ALL_TWINS = [...TWINS, ...EXTRA_TWINS];

/** Every Heritage-only spelling the registries know, as a whole-word, case-insensitive matcher. */
const SURFACE_PATTERNS = heritageSurfaceSpellings().map((spelling) => ({
  spelling,
  pattern: new RegExp(`\\b${spelling}\\b`, "i"),
}));

test("the runtime twin corpus covers every Heritage surface spelling the parser knows", () => {
  // The anti-next-instance guard. Driven by the registries, not a hand-kept list: adding a Heritage
  // spelling without adding a twin fails here rather than shipping unchecked at the runtime stage.
  const covered = new Set(TWINS.flatMap((twin) => twin.covers));
  const expected = heritageSurfaceSpellings();
  assert.ok(expected.length > 0, "the Heritage registries must not be empty");
  for (const spelling of expected) {
    assert.ok(
      covered.has(spelling),
      `Heritage spelling "${spelling}" has no twin in TWINS — add one so its RUNTIME diagnostics ` +
        `are proven canonical (issue #741). Every spelling in heritageAliasNames() + ` +
        `heritageFormHeadNames() must be covered.`,
    );
  }
  // And nothing covers a spelling the registries do not know (a stale entry).
  for (const spelling of covered) {
    assert.ok(
      expected.includes(spelling),
      `TWINS covers "${spelling}", which is not a Heritage surface spelling any more`,
    );
  }
  assert.equal(
    expected.length,
    heritageAliasNames().length + heritageFormHeadNames().length,
    "heritageSurfaceSpellings() must be exactly the aliases plus the form heads",
  );
  // Every alias resolves to its canonical's own arity — the invariant the twin corpus is built on,
  // so the two sides of each alias pair differ only in the spelling.
  for (const alias of heritageAliasNames()) {
    assert.notEqual(
      heritageAliasArity(alias),
      undefined,
      `alias ${alias} must resolve to its canonical's arity`,
    );
    assert.notEqual(
      canonicalOfHeritageAlias(alias),
      undefined,
      `alias ${alias} must resolve to a canonical spelling`,
    );
  }
});

test("the runtime twin corpus is not vacuous — every pair raises at least one diagnostic", () => {
  // Guards against the corpus quietly degrading into "no diagnostics on either side", which would
  // pass every equality assertion below while proving nothing. `to f … end` alone is exactly that
  // trap: a Heritage procedure head executes cleanly, so the twin has to CALL the procedure to
  // report at all.
  for (const twin of ALL_TWINS) {
    assert.ok(
      diagnosticsFor(twin.heritage).length > 0,
      `${twin.note}: this twin raises no runtime diagnostic, so its equality assertion proves ` +
        `nothing — give it a program that actually reports`,
    );
    assert.ok(
      diagnosticsFor(twin.core).length > 0,
      `${twin.note}: the Core side raises no runtime diagnostic`,
    );
  }
});

test("every runtime twin's diagnostics are genuinely runtime-stage", () => {
  // The whole point of this file: these are diagnostics `execute()` raised itself, not the
  // semantic-stage findings the parser's guard already covers. A twin that degraded into a parse
  // error would silently stop testing the runtime copies.
  for (const twin of ALL_TWINS) {
    for (const diagnostic of [
      ...diagnosticsFor(twin.heritage),
      ...diagnosticsFor(twin.core),
    ]) {
      assert.equal(
        diagnostic.stage,
        "runtime",
        `${twin.note}: expected a runtime-stage diagnostic, got ${diagnostic.stage} for ${diagnostic.code}`,
      );
    }
  }
});

test("every alias twin reaches a CANONICAL-carrying field, not just a spelling-independent one", () => {
  // Twin equality is only as strong as the field the twins compare. The trap this closes: a program
  // whose first statement halts on `ol-undefined-var { name: "missing_input" }` compares a
  // diagnostic that could not have differed between the spellings, so a surface `callable` further
  // down the program would pass unnoticed. Asserted by VALUE, per alias, against the registry's own
  // canonical — so the corpus cannot silently regress into proving nothing.
  for (const alias of heritageAliasNames()) {
    const canonical = canonicalOfHeritageAlias(alias);
    const findings = diagnosticsFor(
      aliasProgram(alias, heritageAliasArity(alias)),
    );
    const callables = findings
      .map((diagnostic) => diagnostic.params.callable)
      .filter((callable) => callable !== undefined);
    assert.ok(
      callables.length > 0,
      `alias ${alias}: its program raises ${JSON.stringify(findings.map((d) => d.code))}, none of ` +
        `which carries a "callable" param — so this twin compares no canonical field. Reshape the ` +
        `program so the alias itself is named in the params.`,
    );
    for (const callable of callables) {
      assert.equal(
        callable,
        canonical,
        `alias ${alias}: params.callable must be the canonical "${canonical}", never the surface ` +
          `spelling (spec/error-model.md:235-238)`,
      );
    }
  }
});

test("the worded `value of … for key` reader reports EXACTLY the Core selector's params, on both sides", () => {
  // The registries do not enumerate this form (#755), so the whole-word matcher cannot guard it.
  // Twin equality guards it only partly, and in a way that changed shape with issue #784: the
  // reader now calls the Core selectors' own `resolveDictSegment` instead of restating it, so
  // there is no longer a second copy that could drift out of step. Equality does still catch a
  // wrong ARGUMENT from one side, which moves that side alone; what stays invisible to it is a
  // defect in the shared code itself, which moves both sides together. Pinning the params by value
  // covers that: any surface fragment reaching `operation`, `key`, or any sibling — including the
  // parser's bare head word `value` — fails here, on whichever side it appears.
  for (const twin of EXTRA_TWINS) {
    for (const source of [twin.heritage, twin.core]) {
      const findings = diagnosticsFor(source);
      assert.equal(
        findings.length,
        twin.expected.length,
        `${twin.note}: expected ${twin.expected.length} diagnostic(s) from ${JSON.stringify(source)}, got ${JSON.stringify(findings.map((d) => d.code))}`,
      );
      for (const [index, expected] of twin.expected.entries()) {
        assert.equal(
          findings[index].code,
          expected.code,
          `${twin.note}: diagnostic ${index} code`,
        );
        assert.deepEqual(
          findings[index].params,
          expected.params,
          `${twin.note}: diagnostic ${index} params must be exactly the Core selector's — a Heritage ` +
            `spelling in any field is a divergent machine-readable identity ` +
            `(spec/error-model.md:235-238)`,
        );
      }
    }
  }
});

test("an EXECUTED Heritage program's diagnostics match its Core twin's in code and every non-surface-subject param", () => {
  for (const twin of ALL_TWINS) {
    const heritage = diagnosticsFor(twin.heritage);
    const core = diagnosticsFor(twin.core);
    assert.equal(
      heritage.length,
      core.length,
      `${twin.note}: Heritage and Core twins must raise the same number of diagnostics\n` +
        `  heritage: ${JSON.stringify(heritage.map((d) => d.code))}\n` +
        `  core:     ${JSON.stringify(core.map((d) => d.code))}`,
    );
    for (const [index, actual] of heritage.entries()) {
      const expected = core[index];
      assert.equal(
        actual.code,
        expected.code,
        `${twin.note}: diagnostic ${index} code diverged`,
      );
      assert.equal(
        actual.stage,
        expected.stage,
        `${twin.note}: stage diverged`,
      );
      assert.equal(
        actual.severity,
        expected.severity,
        `${twin.note}: severity diverged`,
      );
      // Field by field, so an exempt field never shields its siblings.
      assert.deepEqual(
        Object.keys(actual.params).sort(),
        Object.keys(expected.params).sort(),
        `${twin.note}: diagnostic ${index} (${actual.code}) param FIELDS diverged`,
      );
      for (const [field, value] of Object.entries(actual.params)) {
        if (isSurfaceSubject(actual.code, field)) {
          continue;
        }
        assert.deepEqual(
          value,
          expected.params[field],
          `${twin.note}: diagnostic ${index} (${actual.code}) param "${field}" diverged with the ` +
            `spelling — ${JSON.stringify(value)} vs ${JSON.stringify(expected.params[field])}. ` +
            `Diagnostic identity is code + params and the same condition must keep the same ` +
            `params (spec/error-model.md:235-238); Heritage adds no new semantics ` +
            `(spec/conformance.md#heritage). Canonicalize the param at its source, or — if this ` +
            `FIELD's subject genuinely IS the learner's own text — add it to ` +
            `SURFACE_SUBJECT_PARAMS with the spec citation that says so.`,
        );
      }
    }
  }
});

test("no runtime diagnostic param carries a Heritage surface spelling, outside the audited surface-subject fields", () => {
  // Catches what twin equality cannot: a diagnostic only the Heritage side can raise, so it has no
  // twin to disagree with. Scanned per FIELD, so an exempt field does not excuse its siblings — and
  // over BOTH sides of every pair, not just the Heritage side: a spelling that leaked into the Core
  // side's params would be just as wrong, and twin equality would be blind to it precisely because
  // both sides then agree.
  for (const twin of ALL_TWINS) {
    for (const diagnostic of [
      ...diagnosticsFor(twin.heritage),
      ...diagnosticsFor(twin.core),
    ]) {
      for (const [field, value] of Object.entries(diagnostic.params)) {
        if (isSurfaceSubject(diagnostic.code, field)) {
          continue;
        }
        const rendered = JSON.stringify(value);
        for (const { spelling, pattern } of SURFACE_PATTERNS) {
          assert.ok(
            !pattern.test(rendered),
            `${twin.note}: ${diagnostic.code} param "${field}" = ${rendered} contains the ` +
              `Heritage spelling "${spelling}". Params are canonical; prose is presentation ` +
              `(spec/error-model.md:235-238).`,
          );
        }
      }
    }
  }
});

test("every audited surface-subject field is genuinely reachable at the runtime stage, so the allow-list cannot go stale", () => {
  // A code/field that no longer fires must not keep an entry excusing it.
  const seen = new Map();
  for (const twin of ALL_TWINS) {
    for (const diagnostic of diagnosticsFor(twin.heritage)) {
      const fields = seen.get(diagnostic.code) ?? new Set();
      for (const field of Object.keys(diagnostic.params)) {
        fields.add(field);
      }
      seen.set(diagnostic.code, fields);
    }
  }

  for (const [code, fields] of Object.entries(SURFACE_SUBJECT_PARAMS)) {
    for (const [field, reason] of Object.entries(fields)) {
      assert.ok(
        seen.get(code)?.has(field),
        `${code}.${field} is allow-listed as surface-subject but this corpus never raises it at ` +
          `the runtime stage — either provoke it here or drop the entry`,
      );
      assert.ok(
        reason.length > 0,
        `${code}.${field} must document WHY it is surface`,
      );
    }
  }
});

test("the escape spellings report the CANONICAL keyword while the prose keeps the learner's word", () => {
  // The property the twin comparison proves structurally, asserted directly on the values — the
  // absence of exactly this assertion is what let this bug class ship four times. Both
  // `keyword`-carrying runtime sites, all three `return` spellings, plus `stop` (Core-only, already
  // canonical, and the one escape whose canonical is not "return").
  for (const spelling of ["return", "output", "op"]) {
    const [outsideProc] = diagnosticsFor(`${spelling} 5`);
    assert.equal(outsideProc.code, "ol-return-outside-proc");
    assert.deepEqual(outsideProc.params, { keyword: "return" });
    assert.match(outsideProc.message, new RegExp(`^${spelling} `));

    const [inComprehension] = diagnosticsFor(
      `:out = map n in [ 1 ] [ ${spelling} :n ]`,
    );
    assert.equal(inComprehension.code, "ol-return-in-comprehension");
    assert.deepEqual(inComprehension.params, {
      keyword: "return",
      form: "map",
    });
    assert.match(inComprehension.message, new RegExp(`^${spelling} `));
  }

  const [stopped] = diagnosticsFor(":out = map n in [ 1 ] [ stop ]");
  assert.equal(stopped.code, "ol-return-in-comprehension");
  assert.deepEqual(stopped.params, { keyword: "stop", form: "map" });
});
