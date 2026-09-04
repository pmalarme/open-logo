// The RUNTIME-stage half of the class guard for issues #737/#741: a Heritage surface spelling must
// never reach a diagnostic's structured `params`.
//
// ## Why this file exists, and why it is here rather than beside the parser's guard
//
// Diagnostic identity is `code` plus structured `params`, and the SAME condition MUST keep the same
// code AND the same params (`spec/error-model.md:255-260`, "Localization boundary"). Heritage is
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
// `covers` to `heritageSurfaceSpellings()` = `heritageAliasNames()` + `heritageFormHeadNames()` +
// `heritageWordedFormHeads()`, in both directions. So a slice that adds a fourteenth alias, a fifth
// form head, or a second worded form CANNOT land without either extending the twin corpus below or
// failing this test:
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
//   4. EXACT PARAMS for the worded `value of … for key` reader (EXTRA_TWINS). Properties 1 and 2
//      both run over those pairs, but neither can pin the expected canonical VALUE there. Property
//      2's whole-word matcher does now see the form's head word `value` — and, because `\b` matches
//      at a space, any phrase fragment beginning with it — but it is blind to a defect that puts NO
//      Heritage word in the params at all, such as `operation: "field"` silently becoming
//      `"index"`. Property 1 compares the two sides only against each other, and since issue #784
//      the reader shares the Core selectors' own `resolveDictSegment` rather than restating it, so
//      there is no second copy for it to catch drifting; what it still catches is a wrong ARGUMENT
//      from one side, which moves that side alone. What neither can see is a defect in the shared
//      code itself, which moves both sides together. Only an exact expectation covers that, so
//      these params are pinned by value.
//
// The registries enumerate SINGLE-WORD spellings and, since issue #755, the HEAD WORD of each
// multi-word Heritage FORM. There is exactly one such form, the worded dictionary reader
// `value of … for key` (slice H5, #670), whose head `value` is the one word in it that names THIS
// form unambiguously — `of`, `for` and `key` are ordinary vocabulary and can reach params on their
// own account — so the head is what is registered for matching, and registry coverage is now
// genuinely coverage of Heritage.
// Before #755 no registry named the form at all while `heritageSurfaceSpellings()` described itself
// as the enumerable definition of a Heritage surface spelling: there was no leak, but the claim was
// false, which is the failure mode this saga has hit repeatedly. The form is still twinned in its
// own EXTRA_TWINS list — against the Core selector it mirrors, the dotted `:dict.key` for the
// operand's own type and the runtime-key `:dict["key"]` for the key's — because property 4 needs a
// list whose every entry carries an `expected`; its entries now declare `covers` like any other.
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
// that allow-list is for fields that are surface BY CONTRACT, not for corpus accidents. Watch
// `value` in particular: since #755 it is a registered spelling like any other, but unlike
// `fd`/`bk`/`op`/… it is ordinary English, so a twin written as `value of :d for key "value"` would
// trip `ol-unknown-key`'s `key` — which this file does NOT exempt. Rename the key instead.

import assert from "node:assert/strict";
import { test } from "node:test";
import { OLTurtle } from "@openlogo/core";
import {
  canonicalOfHeritageAlias,
  heritageAliasArity,
  heritageAliasNames,
  heritageFormHeadNames,
  heritageSurfaceSpellings,
  heritageWordedForm,
  heritageWordedFormHeads,
  heritageWordedFormNames,
  parse,
  walk,
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
 * Does `source` parse CLEANLY to an AST containing a node of `kind`? Used to check that a twin's
 * program reaches the AST shape a Heritage form lowers onto, rather than merely mentioning its head
 * word. It does not identify the PRODUCTION: the AST records node kinds only, so it distinguishes
 * registered forms only as long as no two share a kind — an invariant the parser guard asserts.
 *
 * The clean-parse requirement is load-bearing: the reader builds a RECOVERY AST for a program that
 * does not parse, and that AST can contain the very node kind sought — so without this check a form
 * could be "covered" by a program `execute()` never even runs.
 */
function astContains(source, kind) {
  const { ast, diagnostics } = parse(source, doc);
  if (diagnostics.length > 0) {
    return false;
  }
  let found = false;
  walk(ast, (node) => {
    if (node.kind === kind) {
      found = true;
    }
  });
  return found;
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
      "`spec/tooling.md:219-220` MANDATES the surface value: `count :nums = 3` → " +
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
 * spec rule (`spec/execution-model.md:675-676` — "Used alone as a statement, its result is
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
 * Heritage shapes that need an EXACT param expectation, twinned explicitly.
 *
 * Since issue #755 `heritageSurfaceSpellings()` does enumerate this form — by its head word
 * `value`, the literal unique to `value of … for key`'s grammar production and so its
 * least-ambiguous representative when a diagnostic's params are scanned
 * (`checker-heritage-form.ts`'s `VALUE_OF_KEY`, read from that same registry). It is not proof of
 * provenance: a learner may name a dict key `value`. So these pairs
 * declare `covers` like any other twin and are held to the registry-coverage assertion too, plus
 * `coversForm` — the registered form's name, which is the grammar production it comes from — so the
 * witness assertion below is keyed on the FORM rather than on its head word, which two registered
 * forms could legitimately share.
 * They keep their own list because property 4 — the by-value pin — needs a corpus whose every entry
 * carries an `expected`, and because a multi-word form has no `aliasProgram`-style generator.
 *
 * `expected` pins each pair's params BY VALUE rather than leaving them to the whole-word matcher,
 * because the matcher alone cannot see every way this form's params can go wrong. It catches a
 * leaked `value` — and, since `\b` matches at a space, a leaked `"value of"` too — but it is blind
 * to a defect that puts no Heritage word in the params at all: `operation: "field"` becoming
 * `"index"`, or `expected: "dict"` becoming something else, are wrong machine-readable identities
 * carrying no surface spelling to match on. Widening the matcher to catch those is not possible
 * (they are ordinary words), so an exact expectation is what covers them.
 *
 * The reader is no longer a parallel implementation: since issue #784 it calls the very same
 * `resolveDictSegment` the Core selectors call, so there is no second copy for twin equality to
 * catch drifting. Equality still catches a wrong ARGUMENT from one side — `operation`, and so which
 * Core twin this spelling claims, which is exactly what #784 got wrong. What it cannot see is a
 * defect in the shared code itself, which moves both sides together; that is what these by-value
 * pins exist for.
 *
 * **Which Core twin.** The reader is dict-only (`spec/data-structures.md:268` types its operand
 * `dictExpr`), so the container-type twin is the dotted selector `:x.tom` — specifically its dict
 * branch, since `.key` also accepts records — NOT `:x["tom"]`. Pairing it with `[key]` is precisely
 * what produced #784's self-contradictory message. `[key]` remains the twin for the runtime-KEY
 * failure, which `.tom` — whose key is a parse-time identifier — cannot express.
 */
const EXTRA_TWINS = [
  {
    covers: ["value"],
    coversForm: "value-of-reader",
    heritage: ':ages = { tom: 11 }\nprint value of :ages for key "zed"',
    core: ':ages = { tom: 11 }\nprint :ages["zed"]',
    note: "value of … for key on a missing key — ol-unknown-key { key }",
    expected: [{ code: "ol-unknown-key", params: { key: "zed" } }],
  },
  // One pair per non-dict container type (issue #784). The Core side is the dotted `.tom`
  // selector, which is what makes `expected: "dict"` / `operation: "field"` the twin's own params
  // rather than a value invented for Heritage.
  ...NON_DICT_CONTAINERS.map(({ type, setup, value }) => ({
    covers: ["value"],
    coversForm: "value-of-reader",
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
    covers: ["value"],
    coversForm: "value-of-reader",
    // The third failure mode `evaluate.ts`'s dict-read guard documents, and the one the other
    // pairs miss: a key that is neither word nor number. The key is bound to `:k` on both sides so
    // the two programs supply the SAME evaluated value. An inline key would not be a twin on either
    // of two mechanisms: for a LIST key the inline Core form does not even parse
    // (`:ages[[ 1 2 ]]` → `ol-bad-token` plus unmatched brackets), and for a BOOLEAN key it parses
    // but means something else — `spec/grammar.md:258`, "a bare identifier inside a selector is a
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
 * Every twin, registry-driven and explicit alike — the corpus properties 1, 2 and 3 and the
 * supporting invariants run over. Property 4 is deliberately narrower: it uses `EXTRA_TWINS` alone
 * because it exists for exactly those pairs (see `EXTRA_TWINS` above).
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
  const covered = new Set(ALL_TWINS.flatMap((twin) => twin.covers));
  const expected = heritageSurfaceSpellings();
  assert.ok(expected.length > 0, "the Heritage registries must not be empty");
  for (const spelling of expected) {
    assert.ok(
      covered.has(spelling),
      `Heritage spelling "${spelling}" has no twin in the corpus — add one so its RUNTIME ` +
        `diagnostics are proven canonical (issue #741). Every spelling in heritageAliasNames() + ` +
        `heritageFormHeadNames() + heritageWordedFormHeads() must be covered.`,
    );
  }
  // And nothing covers a spelling the registries do not know (a stale entry).
  for (const spelling of covered) {
    assert.ok(
      expected.includes(spelling),
      `the corpus covers "${spelling}", which is not a Heritage surface spelling any more`,
    );
  }
  assert.equal(
    expected.length,
    heritageAliasNames().length +
      heritageFormHeadNames().length +
      heritageWordedFormHeads().length,
    "heritageSurfaceSpellings() must be exactly the aliases plus the form heads plus the worded " +
      "form heads",
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

test("every runtime twin that declares a worded form reaches it, and every worded form has one", () => {
  // The runtime counterpart of the parser guard's witness assertion (issue #755). Head-word
  // coverage above answers "can this WORD leak into a param"; this answers "does every twin that
  // declares a form still reach that form's AST shape here, and does every form have one".
  //
  // Two rules, so neither direction has a hole. UNIVERSAL: every twin that declares `coversForm`
  // must parse cleanly to that form's registered node kind, so a single twin quietly drifting off
  // the form is caught here rather than left to assertions that would still pass — twin equality
  // and the by-value pins both hold for a Heritage program rewritten into its Core spelling.
  // EXISTENTIAL: every registered form must have at least one such twin.
  //
  // Same limit as the parser side, stated the same way: `coversForm` is author-supplied metadata,
  // and what it is checked against is a node KIND. That does not establish which PRODUCTION built
  // the node — the AST records kinds only — so the kind distinguishes registered forms just as long
  // as no two share one, which the parser guard asserts.
  //
  // The AST check uses `@openlogo/parser`'s own `parse`/`walk` rather than re-deriving the shape:
  // `execute()` parses internally, so a program that does not parse cleanly never reaches the
  // runtime stage this file guards at all, which is why a clean parse is required.
  //
  // (The head/node uniqueness invariants this rests on are asserted in the parser guard, which owns
  // the registry; restating them here would be a second copy to drift.)
  const names = new Set(heritageWordedFormNames());
  // UNIVERSAL: no declaring twin may drift off its form.
  for (const twin of ALL_TWINS) {
    if (twin.coversForm === undefined) {
      continue;
    }
    assert.ok(
      names.has(twin.coversForm),
      `${twin.note}: declares coversForm "${twin.coversForm}", which is not a registered Heritage ` +
        "worded form any more",
    );
    const form = heritageWordedForm(twin.coversForm);
    assert.ok(
      astContains(twin.heritage, form.node),
      `${twin.note}: declares coversForm "${twin.coversForm}" but its Heritage program does not ` +
        `parse cleanly to a ${form.node} node — it no longer reaches the form it claims ` +
        "(issues #741, #755).",
    );
    assert.ok(
      twin.covers.includes(form.head),
      `${twin.note}: declares coversForm "${twin.coversForm}" but does not list that form's head ` +
        "in `covers`, so the surface-spelling assertions would skip it",
    );
  }
  // EXISTENTIAL: no registered form may be left without one.
  for (const name of heritageWordedFormNames()) {
    const form = heritageWordedForm(name);
    const witnesses = ALL_TWINS.filter(
      (twin) =>
        twin.coversForm === name && astContains(twin.heritage, form.node),
    );
    assert.ok(
      witnesses.length > 0,
      `the worded form "${name}" (\`${form.phrase}\`) has no runtime twin that declares ` +
        `coversForm: "${name}" AND parses cleanly to a ${form.node} node, so it is unwitnessed by ` +
        "this check. (The by-value pins below still hold whatever twins DO exist; what is missing " +
        "here is a twin tied to this form — issues #741, #755.)",
    );
  }
  // The witness helper's clean-parse rule is asserted directly rather than merely relied on. A
  // RECOVERY AST can contain the very node kind sought, so without it a form could be "witnessed"
  // by a program `execute()` never even parses — and this guard is about the runtime stage, which
  // such a program never reaches.
  assert.equal(
    astContains('print value of :d for key "k" ]', "ValueOfKey"),
    false,
    "a program that does not parse must not witness a form, however its recovery AST looks",
  );
  assert.equal(
    astContains(':d = { k: 1 }\nprint value of :d for key "k"', "ValueOfKey"),
    true,
    "a cleanly-parsing program that uses the form must witness it",
  );
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
          `spelling (spec/error-model.md:255-260)`,
      );
    }
  }
});

test("the worded `value of … for key` reader reports EXACTLY the Core selector's params, on both sides", () => {
  // The registries enumerate this form by its head word `value` (#755), so the whole-word matcher
  // now guards that string — but it is blind to a wrong value in a field that carries no Heritage
  // word at all (`operation: "field"` → `"index"`, say). Twin equality guards the pair only partly,
  // and in a way that changed shape with issue #784: the reader now calls the Core selectors' own
  // `resolveDictSegment` instead of restating it, so there is no longer a second copy that could
  // drift out of step. Equality does still catch a wrong ARGUMENT from one side, which moves that
  // side alone; what stays invisible to it is a defect in the shared code itself, which moves both
  // sides together. Pinning the params by value covers both blind spots: any wrong field — a
  // surface fragment in `operation` or `key`, or an ordinary word in the wrong slot — fails here,
  // on whichever side it appears.
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
            `(spec/error-model.md:255-260)`,
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
            `params (spec/error-model.md:255-260); Heritage adds no new semantics ` +
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
              `(spec/error-model.md:255-260).`,
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
