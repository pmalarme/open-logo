// The class guard for issue #737: a Heritage surface spelling must never reach a diagnostic's
// structured `params`.
//
// ## Why this file exists
//
// Diagnostic identity is `code` plus structured `params`, and the SAME condition MUST keep the same
// code AND the same params (`spec/error-model.md:255-260`, "Localization boundary"). Heritage is
// defined as "alternate spellings only, no new semantics" (`spec/conformance.md#heritage`), so a
// Heritage spelling and its Core twin are the same condition: their diagnostics must be
// byte-identical in `code` and `params`. Only the prose `message` may echo the learner's own word.
//
// This exact bug shipped three times in saga #572 — `operation` (H5/#670), `callable` (H4/#669 →
// #733), and `keyword` (#737) — each time caught only by review, and once against two domain PASS
// verdicts. Every fix was correct and every fix was local, so the class stayed open. This test is
// the structural guard that closes it: it is driven by the parser's own Heritage registries
// (`heritageSurfaceSpellings()` = `heritageAliasNames()` + `heritageFormHeadNames()` +
// `heritageWordedFormHeads()`), so a slice that adds a fourteenth alias, a fifth form head, or a
// second worded form CANNOT land without either extending the twin corpus below or failing this
// test. A comment would not have caught instances two and three.
//
// Those registries cover every spelling `spec/conformance.md:146-157`'s Heritage inventory writes
// in code formatting, and saying so is itself a guarded claim (issue #755): until that issue,
// `heritageSurfaceSpellings()` was the two SINGLE-WORD tables only and its doc comment nevertheless
// called itself "the enumerable definition of a Heritage surface spelling" — so a reader trusting
// it would have believed the worded dictionary reader `value of … for key` was covered here when
// nothing named it at all. There was no leak to fix; the defect was the false claim, which is why
// the registry grew a third table rather than the guard growing a hand-written exception. The test
// "the registries enumerate every code-formatted Heritage spelling the spec lists" below now holds
// the registries against that spec inventory directly, so the claim cannot go stale a second time —
// with the one residual gap that test documents in its own comment (a spelling the spec writes in
// bare prose).
//
// Two independent properties are asserted, both over BOTH stages — the corpus includes programs
// that fail to parse, because `check()` never runs on those and a parse-stage param would
// otherwise be unreachable:
//
//   1. TWIN EQUALITY — for each Heritage spelling, a program written with it and the same program
//      written with its Core spelling produce diagnostics with identical `code`, `stage`,
//      `severity`, and `params`.
//   2. NO SURFACE SPELLING IN PARAMS — no param value of any diagnostic in the corpus contains a
//      Heritage-only spelling as a whole word.
//
// "Both stages" here means both stages THIS package can reach: parse and semantic. Diagnostics have
// a third stage, `runtime`, and `@openlogo/runtime` keeps its own copies of the checker's
// control-flow rules, kept for a caller driving `evaluate()` directly with no checker in front of it — copies that still
// emitted the surface spelling after this file landed (issue #741), so the same `output 5` reported
// one identity when checked and another when executed. That stage is guarded by the counterpart
// file `packages/runtime/src/heritage-canonical-diagnostic-params.test.mjs`, which drives the same
// registries through `execute()`. It lives there rather than here because `@openlogo/runtime`
// depends on `@openlogo/parser` and not the reverse, so importing the runtime into a parser test
// would invert the package dependency direction. Between the two files, all three stages a
// diagnostic can be raised at are covered.
//
// Both exempt only the explicitly audited param FIELDS whose subject IS the learner's own text
// (documented one by one, with spec citations, in SURFACE_SUBJECT_PARAMS). Exemption is per FIELD,
// never per code: skipping a whole diagnostic would also skip its other params, so a
// canonical-carrying field sitting beside a surface one would go unchecked.
//
// Property 2 catches the case property 1 cannot: a diagnostic that only the Heritage side can ever
// raise, which therefore has no twin to compare against.
//
// A note for whoever extends the corpus: property 2 matches Heritage spellings as whole words
// against the rendered params, so a param that legitimately quotes learner-chosen text can trip it
// — `print :fd` raises `ol-undefined-var` with `params.name` `"fd"`, which is correct because the
// learner named their variable `fd`. Today's corpus cannot hit that (every generated program uses
// `:missing_input`). If you add a program whose identifiers collide with an alias spelling, rename
// the identifier rather than widening SURFACE_SUBJECT_PARAMS — that allow-list is for fields that
// are surface BY CONTRACT, not for corpus accidents.
//
// Watch `value` in particular. Since #755 it is a registered spelling like any other, but unlike
// `fd`/`bk`/`op`/… it is ordinary English, so it is far likelier to turn up as a learner's own
// identifier, dict key, or word literal. Nothing in today's corpus collides — but a twin written as
// `value of :d for key "value"` would trip `ol-unknown-key`'s `key`, which is deliberately NOT
// exempt. Rename the key; do not widen the allow-list to accommodate it.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import * as OL from "@openlogo/parser";
import {
  canonicalOfHeritageAlias,
  heritageAliasArity,
  heritageAliasNames,
  heritageFormHeadNames,
  heritageSurfaceSpellings,
  heritageWordedFormHeads,
  heritageWordedFormNames,
  heritageWordedForms,
} from "@openlogo/parser";

const doc = "heritage-canonical-diagnostic-params.logo";

// Heritage depends on Data (`spec/conformance.md#heritage`); Turtle & Rendering is active so the
// Core twins of the turtle command aliases (`forward`, `pen_up`, …) are visible names too.
const PROFILES = ["core-language", "data", "turtle-rendering", "heritage"];

function diagnosticsFor(source, profiles = PROFILES) {
  const { ast, diagnostics: parseDiagnostics } = OL.parse(source, doc);
  assert.deepEqual(
    parseDiagnostics,
    [],
    `expected a clean parse for ${JSON.stringify(source)}`,
  );
  return OL.check(ast, { profiles, source, style: true }).diagnostics;
}

/**
 * Every diagnostic a document produces at whichever stage it reaches — parse diagnostics when it
 * does not parse, semantic/style findings when it does. Mirrors the conformance harness's own
 * `produce()`, so the guard can audit parse-stage params that `check()` can never see.
 */
function stagedDiagnosticsFor(source, profiles = PROFILES) {
  const { ast, diagnostics: parseDiagnostics } = OL.parse(source, doc);
  return parseDiagnostics.length > 0
    ? parseDiagnostics
    : OL.check(ast, { profiles, source, style: true }).diagnostics;
}

/**
 * Does `source` parse CLEANLY to an AST containing a node of `kind`? Used to check that a twin's
 * program really reaches the AST shape a Heritage form lowers onto, rather than merely mentioning
 * the form's head word somewhere in the program. It does not identify the PRODUCTION: the AST
 * records node kinds only, so this distinguishes registered forms only as long as no two share a
 * kind — the invariant the witness test asserts before relying on it.
 *
 * The clean-parse requirement is load-bearing, not incidental: the reader builds a RECOVERY AST for
 * a program that fails to parse, and that recovery AST can contain the very node kind being looked
 * for — `print value of :d for key "k" ]` reports `ol-unmatched-bracket` and still yields a
 * `ValueOfKey`. Without this check a form could be "covered" solely by a twin that never parses,
 * which says nothing about the form as the language actually reads it.
 */
function astContains(source, kind) {
  const { ast, diagnostics } = OL.parse(source, doc);
  if (diagnostics.length > 0) {
    return false;
  }
  let found = false;
  OL.walk(ast, (node) => {
    if (node.kind === kind) {
      found = true;
    }
  });
  return found;
}

/**
 * The param FIELDS that are SURFACE by contract, keyed by code then field name, with the reason
 * each was audited and kept. Exemption is deliberately PER FIELD, not per code: skipping a whole
 * diagnostic would also skip its other params, so a canonical-carrying field on one of these codes
 * (`ol-unknown-command`'s future params, say) would go unchecked. Only the named field is exempt;
 * every sibling field is still held to the canonical rule.
 *
 * These are not exceptions to that rule — they are params whose subject IS the text the learner
 * wrote, where either no Core twin raises the condition at all or the spec mandates the surface
 * value outright, so there is nothing to keep byte-identical and a canonical value would name
 * something absent from the diagnostic's own span.
 */
const SURFACE_SUBJECT_PARAMS = {
  "ol-unknown-command": {
    name:
      "the word the language does not know. Its Core twin is VALID and raises nothing " +
      "(`set x to 1` is fine while a Core-only `make` is not), so there is no same-condition " +
      "pair. `spec/error-model.md:96` defines `name` as the unknown word itself.",
    suggestion:
      "points at a name that IS visible, which with Heritage active legitimately includes an " +
      "alias — `bff` is closest to `bf`. Ties deliberately resolve to the full canonical name " +
      "(fixture `check/heritage-alias-suggestion-loses-tie-to-full-name`, #669), but a strictly " +
      "closer alias is the correct repair to offer.",
  },
  "ol-reserved-word": {
    name:
      "names the registration the learner wrote (`spec/error-model.md:124`). The subject is that " +
      "very name at that very span.",
  },
  "ol-not-a-place": {
    text:
      "`spec/tooling.md:221-222` MANDATES the surface value: `count :nums = 3` → " +
      '`params={ text: "count :nums" }`. It is a machine-readable quotation of the span, not an ' +
      "identifier — canonicalizing it would make the param disagree with its own source_span, " +
      "and a target such as `1 + 2` or `(first :x)` has no canonical form at all.",
  },
  "ol-style-name-case": {
    name:
      "a CASING lint over user identifiers and keywords alike (`spec/tooling.md:243`): its whole " +
      "subject is the literal source slice, so a surface value is the point. A canonical value " +
      'would report `name: "return"` for a learner who wrote `OUTPUT` — advice to lowercase a ' +
      "word that is already lowercase and that they never typed.",
  },
  "ol-bad-token": {
    text:
      '`spec/error-model.md:109` — `text` "names the offending token in every case". A ' +
      "parse-stage quotation of the token the parser could not place.",
  },
};

/** Is `field` on `code` exempt from the canonical rule? */
function isSurfaceSubject(code, field) {
  return SURFACE_SUBJECT_PARAMS[code]?.[field] !== undefined;
}

/**
 * The twin corpus. Each entry pairs a program written with Heritage spellings against the same
 * program written with their Core spellings, and declares which Heritage spellings it covers so
 * the coverage assertion below can hold it against the parser's own registries.
 */
/**
 * A call written with `name` at `arity` arguments, every one an undefined variable, then a
 * zero-argument parenthesized call, then the name in assignment-target position. Both sides of an
 * alias twin are built with the SAME arity — the one the registry reports for the alias, which is
 * by definition its canonical's own arity (`heritageAliasArity` resolves the alias then reads the
 * canonical's table) — so the two programs differ only in the spelling, and a zero-arity command
 * such as `cs` is never handed an argument the reader would reject.
 *
 * The assignment-target line is added only for the ZERO-arity commands
 * (`cs`/`st`/`ht`/`pu`/`pd`): their canonicals have no static arity range, so a call alone raises
 * nothing and those five twins used to compare empty against empty — a pass that proved nothing.
 * An arity-1 alias already reports through its undefined argument, and `bf = 3` would not even
 * parse (the reader takes `=` as `bf`'s argument), so it is deliberately not appended there.
 */
function aliasProgram(name, arity) {
  const args = Array.from({ length: arity }, () => ":missing_input").join(" ");
  if (arity === 0) {
    return `${name}\nprint (${name})\n${name} = 3`;
  }
  return `${name} ${args}\nprint (${name})`;
}

const TWINS = [
  // --- form heads ---------------------------------------------------------------------------
  {
    covers: ["output"],
    heritage: "output 5",
    core: "return 5",
    note: "ol-return-outside-proc — the #737 defect itself",
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
    note: "ol-return-in-comprehension — the second #737 site",
  },
  {
    covers: ["to"],
    heritage: "to print\n  return 1\nend",
    core: "define print\n  return 1\nend",
    note: "ol-reserved-word raised through a Heritage procedure head",
  },
  {
    covers: ["make"],
    heritage: 'make "x" (butfirst)',
    core: "set x to (butfirst)",
    note: "ol-not-enough-inputs raised through a Heritage assignment head",
  },
  // --- short command/reporter aliases -------------------------------------------------------
  // One entry per alias, generated from the registry itself so the list cannot drift. Each alias
  // is called with exactly its canonical's default arity (`heritageAliasArity`) filled with an
  // undefined variable — which every callee reports identically as `ol-undefined-var` — plus a
  // zero-argument parenthesized call, which exercises the static arity rule for the aliases whose
  // canonical has a Core arity range (`bf`/`bl`/`pr`/`se`).
  ...heritageAliasNames().map((alias) => {
    // Never `?? 0`: every name from the alias registry HAS an arity by construction
    // (`heritageAliasArity` resolves the alias then reads its canonical's own table), and that
    // invariant is asserted in the coverage test below rather than papered over with a fallback
    // that could silently build a zero-argument program for a one-argument command.
    const arity = heritageAliasArity(alias);
    return {
      covers: [alias],
      heritage: aliasProgram(alias, arity),
      core: aliasProgram(canonicalOfHeritageAlias(alias), arity),
      note: `short alias ${alias} → ${canonicalOfHeritageAlias(alias)}`,
    };
  }),
  // --- worded forms -------------------------------------------------------------------------
  // The multi-word Heritage spellings (issue #755). `value of … for key` is the only one today,
  // and it is the reason the registry grew a third table: it is a FORM, not a callable name, so
  // neither single-word table could hold it and the guard was blind to it.
  //
  // These declare `coversForm` — the grammar PRODUCTION name — as well as `covers`, and the two
  // answer different questions. `covers` feeds the surface-spelling coverage assertion, which is
  // about the WORD that can leak into a param. `coversForm` feeds the witness assertion, which is
  // about the FORM: two productions could legitimately share a head word, and then head-based
  // coverage would let one form's twin stand in for the other's, which is exactly the
  // looks-like-coverage-but-is-not defect this issue closes.
  //
  // Its Core twin is the `[]`/`.` selector syntax (`spec/data-structures.md:265-268`) rather than
  // a Core word, so these pairs differ by a whole expression shape and not just a spelling — which
  // is exactly what makes them worth asserting: the two forms must still report the SAME condition
  // identically.
  //
  // The programs are chosen for a reason the vacuity test below would otherwise expose. With
  // Heritage ACTIVE the reader raises nothing of its own at either stage this package can reach —
  // every failure it can produce (`ol-unknown-key`, `ol-type`) is runtime-stage, and is twinned in
  // `@openlogo/runtime`'s counterpart guard. So the pairs here put the reader inside a program that
  // reports for an INDEPENDENT reason and assert that the surface spelling perturbs nothing: an
  // undefined operand, and a `return` escape inside a comprehension, which is the one pair that
  // reaches a canonical-carrying param (`keyword`) with the reader in the program.
  {
    covers: ["value"],
    coversForm: "value-of-reader",
    heritage: 'print value of :missing_input for key "tom"',
    core: 'print :missing_input["tom"]',
    note: "worded reader over an undefined dict — ol-undefined-var",
  },
  {
    covers: ["value"],
    coversForm: "value-of-reader",
    heritage:
      ':ages = { tom: 11 }\n:nums = [ 1 ]\nprint map n in :nums [ output value of :ages for key "tom" ]',
    core: ':ages = { tom: 11 }\n:nums = [ 1 ]\nprint map n in :nums [ return :ages["tom"] ]',
    note: "worded reader inside a comprehension escape — ol-return-in-comprehension { keyword }",
  },
];

/**
 * Twins that deliberately FAIL to parse, so the guard reaches parse-stage params too. `check()`
 * never runs on a document that did not parse, so a parse-stage diagnostic is unreachable through
 * the semantic corpus above — and `ol-bad-token` carries a `text` param that quotes the offending
 * token, which is exactly the shape this bug class hides in.
 *
 * These are supplementary depth, not the coverage set: a pair is only usable here when both
 * spellings drive the parser down the SAME recovery path, so the comparison is about params rather
 * than about error recovery. `to` has no usable pair for that reason — `repeat to [ ]` reports one
 * `ol-bad-token` while `repeat define [ ]` reports two, because `define` opens a procedure and
 * resyncs differently. That is a recovery difference, not a Heritage params divergence, and
 * `to`'s params are covered at the semantic stage by TWINS.
 */
const PARSE_TWINS = [
  {
    covers: ["output"],
    heritage: "repeat output [ ]",
    core: "repeat return [ ]",
    note: "ol-bad-token — parse stage, escape keyword in an expression position",
  },
  {
    covers: ["op"],
    heritage: "repeat op [ ]",
    core: "repeat return [ ]",
    note: "ol-bad-token — parse stage, short escape spelling",
  },
  {
    covers: ["make"],
    heritage: "repeat make [ ]",
    core: "repeat set [ ]",
    note: "ol-bad-token — parse stage, assignment head in an expression position",
  },
  {
    covers: ["value"],
    heritage: "print value of",
    core: "print :ages[",
    note: "ol-bad-token — parse stage, worded reader truncated mid-form",
  },
];

/** Every Heritage-only spelling as a whole-word, case-insensitive matcher. */
const SURFACE_PATTERNS = heritageSurfaceSpellings().map((spelling) => ({
  spelling,
  pattern: new RegExp(`\\b${spelling}\\b`, "i"),
}));

test("the registries enumerate every code-formatted Heritage spelling the spec lists", () => {
  // The claim `heritageSurfaceSpellings()` makes about itself, held against the spec rather than
  // against a hand-kept copy of it — which is the whole of issue #755. Before it, the registry was
  // the two single-word tables and its doc comment nevertheless called itself "the enumerable
  // definition of a Heritage surface spelling"; the worded reader `value of … for key` was in the
  // spec's inventory and in no registry, so a reader trusting that comment believed this guard
  // covered a form nothing named. Restating the inventory here would reproduce the same failure one
  // level up, so the inventory is read from `spec/conformance.md`'s Heritage bullet list itself.
  //
  // The bullets are the normative inventory (`spec/conformance.md:146-153`, "It includes:"). Every
  // code span in them is either a Heritage surface spelling, the phrase of a worded form, or a CORE
  // canonical the list names as the thing a Heritage spelling stands for (`return`, for
  // `output`/`op`) — and the registries know all three, so the check closes in both directions with
  // no exception list to go stale.
  //
  // If the spec's Heritage section is reworded this test fails. That is the intent: a change to the
  // normative Heritage inventory is exactly when these registries must be re-checked by a human.
  //
  // **What this does and does not guarantee.** It reads SPELLINGS the inventory writes in code
  // formatting, which is that section's own convention throughout. A bullet that named a spelling
  // in bare prose would be invisible to it, so it additionally asserts that every bullet carries at
  // least one code span — which catches a new bullet added in prose, the realistic drift — but a
  // second, unformatted spelling smuggled into an EXISTING bullet would still slip past. That
  // residual gap is why the claim above is "every spelling the inventory writes in code formatting"
  // and not "every spelling", and it is not closable without parsing English.
  //
  // Line endings normalised: the repo is checked out with CRLF on Windows, and the section/bullet
  // shapes below are the point of the test, not the platform's newline.
  const conformance = readFileSync(
    new URL("../../../spec/conformance.md", import.meta.url),
    "utf8",
  ).replace(/\r\n/g, "\n");
  const section = /\n### Heritage\n([\s\S]*?)\n### /.exec(conformance);
  assert.ok(
    section,
    "spec/conformance.md must still have a `### Heritage` section — if it moved, repoint this test",
  );
  const inventory = /It includes:\n\n([\s\S]*?)\n\n/.exec(section[1]);
  assert.ok(
    inventory,
    "the Heritage section must still introduce its inventory with `It includes:` followed by a " +
      "bullet list — if the spec reworded it, re-check the registries against the new wording",
  );
  const bullets = inventory[1]
    .split("\n- ")
    .map((bullet) => bullet.replace(/^- /, "").trim());
  assert.ok(
    bullets.length > 3,
    `only ${bullets.length} bullets found in the Heritage inventory — the list did not parse as ` +
      "expected",
  );
  for (const bullet of bullets) {
    // A bullet with no code span names its spellings in prose, where nothing below can see them.
    assert.match(
      bullet,
      /`[^`]+`/,
      "spec/conformance.md's Heritage inventory has a bullet with no code-formatted spelling — " +
        `"${bullet}". This test reads spellings from code spans, so an unformatted one would be ` +
        "invisible to it: either format the spelling, or register it by hand (issue #755).",
    );
  }
  // Extracted from the whole inventory block, NOT per physical line: a bullet the spec later
  // reflows across lines keeps its spellings on continuation lines, and reading only lines that
  // start with `- ` would silently drop them — a completeness check with a hole in it, which is the
  // very defect this test exists to prevent. Splitting into LOGICAL bullets above keeps the
  // per-bullet formatting check correct across a reflow for the same reason.
  const listed = [...inventory[1].matchAll(/`([^`]+)`/g)].map(
    (match) => match[1],
  );
  assert.ok(
    listed.length > 10,
    `only ${listed.length} code spans found in the Heritage inventory — the bullet list did not ` +
      "parse as expected",
  );

  const spellings = new Set(heritageSurfaceSpellings());
  const phrases = new Set(heritageWordedForms().map((form) => form.phrase));
  // The Core spellings the inventory names as what a Heritage form stands for. Derived from the
  // form-head registry, not written out, so it cannot drift either.
  const canonicals = new Set(
    heritageFormHeadNames().map((head) => OL.canonicalOfHeritageFormHead(head)),
  );
  for (const entry of listed) {
    assert.ok(
      spellings.has(entry) || phrases.has(entry) || canonicals.has(entry),
      `spec/conformance.md's Heritage inventory lists \`${entry}\`, which no parser registry ` +
        "knows. Add it to heritageAliasNames(), heritageFormHeadNames(), or " +
        "heritageWordedForms() so the canonical-diagnostic-params guards cover it (issue #755).",
    );
  }
  // And the other direction: nothing in the registries is absent from the spec's inventory.
  for (const spelling of heritageSurfaceSpellings()) {
    assert.ok(
      listed.includes(spelling) || heritageWordedFormHeads().includes(spelling),
      `the parser registers \`${spelling}\` as a Heritage surface spelling, but ` +
        "spec/conformance.md's Heritage inventory does not list it",
    );
  }
  // The worded forms are carried into the surface spellings by their HEAD, and the head is what a
  // diagnostic can ever contain — so assert the bridge explicitly rather than inferring it.
  for (const form of heritageWordedForms()) {
    assert.ok(
      listed.includes(form.phrase),
      `the parser registers the worded form \`${form.phrase}\`, but spec/conformance.md's ` +
        "Heritage inventory does not list that phrase verbatim",
    );
    assert.ok(
      form.phrase.split(/\s+/).includes(form.head),
      `worded form \`${form.phrase}\` must contain its own head word \`${form.head}\``,
    );
    assert.ok(
      spellings.has(form.head),
      `worded form \`${form.phrase}\`'s head \`${form.head}\` must reach ` +
        "heritageSurfaceSpellings(), or the guards below never match it",
    );
  }
});

test("the checker's worded-reader head and node agree with the registry", () => {
  // `checker-heritage-form.ts` spans and reports the reader's head, and matches its AST node kind,
  // from `heritageWordedForm("value-of-reader")` rather than restating either literal — a second
  // private copy beside the registry is how a spelling drifts out from under a guard that looks
  // like it covers it, which is the failure mode issue #755 is about.
  //
  // What this asserts is AGREEMENT, observed through the checker's own output, and nothing more: it
  // fails the moment the checker reports a head or spans a node the registry does not name. It
  // cannot prove the checker READS the registry — re-inlining the matching literal `"value"` would
  // still pass — so the test name claims agreement, not provenance. What holds the provenance is
  // the lookup in the source; what this adds is that the two cannot silently drift apart.
  const form = OL.heritageWordedForm("value-of-reader");
  assert.equal(form.phrase, "value of … for key");
  assert.equal(form.node, "ValueOfKey");
  assert.deepEqual([...heritageWordedFormHeads()], [form.head]);

  const source = ':ages = { tom: 11 }\nprint value of :ages for key "tom"';
  const rejected = stagedDiagnosticsFor(source, ["core-language", "data"]);
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].code, "ol-unknown-command");
  assert.deepEqual(rejected[0].params, { name: form.head });
  // `params.name` and `source_span` must quote the SAME text — so slice the span out of the source
  // and compare, rather than only checking its length. A length check alone passes even when the
  // rule spans a completely different node, which is exactly how a head/node mismatch would hide.
  const [startLine, startColumn] = rejected[0].source_span.start;
  const [endLine, endColumn] = rejected[0].source_span.end;
  assert.equal(startLine, endLine);
  const line = source.split("\n")[startLine - 1];
  assert.equal(line.slice(startColumn - 1, endColumn - 1), form.head);
});

test("the worded-form registry's entries are frozen, so no consumer can poison what the guards match on", () => {
  // `heritageWordedForm` hands out the entry object itself rather than a copy, and both guards plus
  // `checker-heritage-form.ts` read the same object. An unfrozen entry would let one consumer
  // rewrite the head every other consumer reads — the checker would report a poisoned name while
  // `heritageSurfaceSpellings()` still matched on the real one, which is the single-source-of-truth
  // guarantee this table exists to provide (issue #755). `as const` is a TYPE-level assertion and
  // stops nothing at runtime, so this asserts the runtime freeze, on both fields the checker reads.
  //
  // Scope, stated precisely: this covers the ENTRIES, which are the only part of the registry a
  // consumer can reach. `signatures.ts` also freezes the table itself, but that table is module-
  // private — no external caller can add, replace, or drop a production, so no test here can
  // exercise it. That freeze guards against an accident inside `signatures.ts`, and nothing below
  // proves it.
  for (const form of heritageWordedForms()) {
    assert.ok(
      Object.isFrozen(form),
      `worded form \`${form.phrase}\`'s entry must be frozen`,
    );
    assert.throws(
      () => {
        form.head = "poisoned";
      },
      TypeError,
      `writing \`${form.phrase}\`'s head must throw, not silently poison the registry`,
    );
    assert.throws(
      () => {
        form.node = "DictLit";
      },
      TypeError,
      `writing \`${form.phrase}\`'s node kind must throw — the witness assertions match on it`,
    );
    assert.ok(
      heritageSurfaceSpellings().includes(form.head),
      `the head \`${form.head}\` the checker reports must still be the one the surface matcher ` +
        "enumerates",
    );
  }
  // And the values a consumer reads back are unchanged after those attempted writes.
  const form = OL.heritageWordedForm("value-of-reader");
  assert.equal(form.head, "value");
  assert.equal(form.node, "ValueOfKey");
});

test("every twin that declares a worded form reaches it, and every worded form has one (parse/semantic)", () => {
  // Coverage for a multi-word form cannot be keyed on its head word alone. `covers: ["value"]` is
  // satisfied by any program containing the word, so a twin that lost its `value of … for key`
  // expression would keep the coverage assertion green while testing nothing — and two productions
  // that legitimately shared a head would let one form's twin stand in for the other's. That is
  // exactly the "a guard that looks like coverage but is not" defect issue #755 exists to close.
  //
  // **Exactly what this checks, and what it does not.** Two rules, one universal and one
  // existential, so neither direction has a hole. UNIVERSAL: every twin that declares `coversForm`
  // must parse CLEANLY to that form's registered node kind — so a single twin quietly losing the
  // form is caught here, not left to assertions that would still pass. EXISTENTIAL: every
  // registered form must have at least one such twin, so a form cannot be dropped from the corpus.
  //
  // `coversForm` is author-supplied metadata, and what it is checked against is a node KIND. That
  // does not establish which PRODUCTION built the node: the AST records kinds only (`ValueOfKeyNode`
  // carries `kind`, its operands and a `source_span`, and no production identifier), so two
  // productions lowering to the same kind would be indistinguishable here. That is a property of
  // the AST, not something this test can fix. What keeps the node kind a usable discriminator TODAY
  // is the registry invariant asserted first below — no two worded forms share a node kind — which
  // fails loudly the moment a future slice makes it ambiguous, rather than letting this quietly
  // decay into self-attestation.
  //
  // PARSE_TWINS deliberately do NOT declare `coversForm`: they exist to reach parse-stage params
  // and so must fail to parse, which means they can never satisfy the universal rule. They still
  // carry `covers`, because the head word is exactly what a parse-stage param could leak.
  //
  // Those registry invariants come FIRST, because both rules rest on them: asserting them after
  // would let a witness failure mask the reason the node kind had stopped being usable.
  const heads = heritageWordedForms().map((form) => form.head);
  assert.equal(
    new Set(heads).size,
    heads.length,
    `two Heritage worded forms share a head word (${JSON.stringify(heads)}). Give each form a ` +
      "distinct head, or teach the surface matcher about the ambiguity.",
  );
  const nodes = heritageWordedForms().map((form) => form.node);
  assert.equal(
    new Set(nodes).size,
    nodes.length,
    `two Heritage worded forms lower to the same AST node kind (${JSON.stringify(nodes)}). The ` +
      "witness assertion below uses the node kind to tell registered forms apart, so it would " +
      "credit one form's twin to the other: give each form its own node kind, or give the witness " +
      "a discriminator the AST can actually express (issue #755).",
  );
  const names = new Set(heritageWordedFormNames());
  // UNIVERSAL: no declaring twin may drift off its form.
  for (const twin of TWINS) {
    if (twin.coversForm === undefined) {
      continue;
    }
    assert.ok(
      names.has(twin.coversForm),
      `${twin.note}: declares coversForm "${twin.coversForm}", which is not a registered Heritage ` +
        "worded form any more",
    );
    const form = OL.heritageWordedForm(twin.coversForm);
    assert.ok(
      astContains(twin.heritage, form.node),
      `${twin.note}: declares coversForm "${twin.coversForm}" but its Heritage program does not ` +
        `parse cleanly to a ${form.node} node — it no longer reaches the form it claims ` +
        "(issue #755).",
    );
    assert.ok(
      twin.covers.includes(form.head),
      `${twin.note}: declares coversForm "${twin.coversForm}" but does not list that form's head ` +
        "in `covers`, so the surface-spelling assertions would skip it",
    );
  }
  // EXISTENTIAL: no registered form may be left without one.
  for (const name of heritageWordedFormNames()) {
    const form = OL.heritageWordedForm(name);
    const witnesses = TWINS.filter(
      (twin) =>
        twin.coversForm === name && astContains(twin.heritage, form.node),
    );
    assert.ok(
      witnesses.length > 0,
      `the worded form "${name}" (\`${form.phrase}\`) has no twin that declares ` +
        `coversForm: "${name}" AND parses cleanly to a ${form.node} node, so it is unwitnessed by ` +
        `this check. A twin that merely mentions "${form.head}", or that declares a different ` +
        "form, does not witness this one (issue #755).",
    );
  }
  // PARSE_TWINS may not smuggle in a `coversForm` they cannot honour — and must really be what they
  // claim to be. A pair that quietly became a cleanly-parsing program would still pass every other
  // assertion in this file while silently withdrawing the parse-stage reach the corpus exists to
  // give, so both sides are checked to report at the parse stage.
  for (const twin of PARSE_TWINS) {
    assert.equal(
      twin.coversForm,
      undefined,
      `${twin.note}: a parse-stage twin must not declare coversForm — it deliberately fails to ` +
        "parse, so it can never reach the form's node kind",
    );
    for (const [side, source] of [
      ["heritage", twin.heritage],
      ["core", twin.core],
    ]) {
      assert.ok(
        OL.parse(source, doc).diagnostics.length > 0,
        `${twin.note}: the ${side} side parses cleanly, so this pair no longer reaches the PARSE ` +
          "stage it exists for — its findings would come from check() like any TWINS entry. Give " +
          "it a program that fails to parse, or move it to TWINS.",
      );
    }
  }
  // And the clean-parse rule those twins fall foul of is asserted directly rather than merely
  // relied on: a RECOVERY AST can contain the very node kind sought, so without it a form could be
  // "witnessed" by a program the language never actually reads as that form.
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

test("the twin corpus covers every Heritage surface spelling the parser knows", () => {
  // The anti-fourth-instance guard. Driven by the registries, not a hand-kept list: adding a
  // Heritage spelling without adding a twin fails here rather than shipping unchecked.
  const covered = new Set(TWINS.flatMap((twin) => twin.covers));
  const expected = heritageSurfaceSpellings();
  assert.ok(expected.length > 0, "the Heritage registries must not be empty");
  for (const spelling of expected) {
    assert.ok(
      covered.has(spelling),
      `Heritage spelling "${spelling}" has no twin in TWINS — add one so its diagnostics are ` +
        `proven canonical (issue #737). Every spelling in heritageAliasNames() + ` +
        `heritageFormHeadNames() + heritageWordedFormHeads() must be covered.`,
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

test("the twin corpus is not vacuous — every pair raises at least one diagnostic", () => {
  // Guards against the corpus quietly degrading into "no diagnostics on either side", which would
  // pass every equality assertion below while proving nothing. The zero-arity turtle aliases used
  // to be vacuous here; `aliasProgram`'s assignment-target line is what made them real.
  //
  // Read "not vacuous" precisely: it means each pair genuinely REPORTS, not that each pair compares
  // a canonical VALUE. Two groups can only be compared structurally today, because every param they
  // carry is an audited surface-subject field — the arity-0 aliases (one `ol-not-a-place`, whose
  // sole param `text` quotes the target) and all of PARSE_TWINS (`ol-bad-token`, whose sole param
  // `text` quotes the token). For those, what is asserted is code + stage + severity + count + the
  // param KEY SET, which is still what would break if a spelling changed a diagnostic's shape. The
  // pairs that do compare canonical values are the escape twins (`keyword`) and the reporter
  // aliases (`callable`). `to print` used to be a third, comparing `namespace`; issue #838 dropped
  // that param from `ol-reserved-word` (`spec/error-model.md:125`), and its one remaining param
  // `name` is an audited surface subject above, so that twin has joined the structural group. This
  // is not a gap that can be closed by a better program: `cs 1` and `cs 1 2` only add another
  // `ol-bad-token`, also `text`-only.
  for (const twin of [...TWINS, ...PARSE_TWINS]) {
    const findings = stagedDiagnosticsFor(twin.heritage);
    assert.ok(
      findings.length > 0,
      `${twin.note}: this twin raises no diagnostic, so its equality assertion proves nothing — ` +
        `give it a program that actually reports`,
    );
    assert.ok(
      stagedDiagnosticsFor(twin.core).length > 0,
      `${twin.note}: the Core side raises no diagnostic`,
    );
  }
});

test("every TWINS program parses clean, so its findings are genuinely semantic-stage", () => {
  // PARSE_TWINS is the deliberate exception; the semantic corpus must not silently degrade into
  // parse errors, which would stop `check()` from ever running.
  for (const twin of TWINS) {
    diagnosticsFor(twin.heritage);
    diagnosticsFor(twin.core);
  }
});

test("a Heritage program's diagnostics are byte-identical to its Core twin's in code and params", () => {
  for (const twin of [...TWINS, ...PARSE_TWINS]) {
    const heritage = stagedDiagnosticsFor(twin.heritage);
    const core = stagedDiagnosticsFor(twin.core);
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

test("no diagnostic param carries a Heritage surface spelling, outside the audited surface-subject fields", () => {
  // Catches what twin equality cannot: a diagnostic only the Heritage side can raise, so it has no
  // twin to disagree with. Scanned per FIELD, so an exempt field does not excuse its siblings.
  for (const twin of [...TWINS, ...PARSE_TWINS]) {
    for (const diagnostic of stagedDiagnosticsFor(twin.heritage)) {
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

test("every audited surface-subject field is genuinely reachable, so the allow-list cannot go stale", () => {
  // A code/field that no longer fires must not keep an entry excusing it. `ol-unknown-command` is
  // reachable only with Heritage INACTIVE (precisely why it has no same-condition twin), so it is
  // provoked with a Core-only profile set; its `suggestion` field needs a near-miss spelling.
  const seen = new Map();
  const record = (diagnostics) => {
    for (const diagnostic of diagnostics) {
      const fields = seen.get(diagnostic.code) ?? new Set();
      for (const field of Object.keys(diagnostic.params)) {
        fields.add(field);
      }
      seen.set(diagnostic.code, fields);
    }
  };
  for (const twin of [...TWINS, ...PARSE_TWINS]) {
    record(stagedDiagnosticsFor(twin.heritage));
  }
  record(stagedDiagnosticsFor("output 5", ["core-language", "data"]));
  record(stagedDiagnosticsFor("print bff [ 1 2 ]"));
  record(stagedDiagnosticsFor(":nums = [ 1 2 ]\nbf :nums = 3"));
  record(stagedDiagnosticsFor("define f\n  OUTPUT 5\nend"));

  for (const [code, fields] of Object.entries(SURFACE_SUBJECT_PARAMS)) {
    for (const [field, reason] of Object.entries(fields)) {
      assert.ok(
        seen.get(code)?.has(field),
        `${code}.${field} is allow-listed as surface-subject but this corpus never raises it — ` +
          `either provoke it here or drop the entry`,
      );
      assert.ok(
        reason.length > 0,
        `${code}.${field} must document WHY it is surface`,
      );
    }
  }
});
