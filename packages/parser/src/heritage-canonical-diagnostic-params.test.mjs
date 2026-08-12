// The class guard for issue #737: a Heritage surface spelling must never reach a diagnostic's
// structured `params`.
//
// ## Why this file exists
//
// Diagnostic identity is `code` plus structured `params`, and the SAME condition MUST keep the same
// code AND the same params (`spec/error-model.md:235-238`, "Localization boundary"). Heritage is
// defined as "alternate spellings only, no new semantics" (`spec/conformance.md#heritage`), so a
// Heritage spelling and its Core twin are the same condition: their diagnostics must be
// byte-identical in `code` and `params`. Only the prose `message` may echo the learner's own word.
//
// This exact bug shipped three times in saga #572 — `operation` (H5/#670), `callable` (H4/#669 →
// #733), and `keyword` (#737) — each time caught only by review, and once against two domain PASS
// verdicts. Every fix was correct and every fix was local, so the class stayed open. This test is
// the structural guard that closes it: it is driven by the parser's own Heritage registries
// (`heritageSurfaceSpellings()` = `heritageAliasNames()` + `heritageFormHeadNames()`), so a slice
// that adds a fourteenth alias or a fifth form head CANNOT land without either extending the twin
// corpus below or failing this test. A comment would not have caught instances two and three.
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

import assert from "node:assert/strict";
import { test } from "node:test";
import * as OL from "@openlogo/parser";
import {
  canonicalOfHeritageAlias,
  heritageAliasArity,
  heritageAliasNames,
  heritageFormHeadNames,
  heritageSurfaceSpellings,
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
      "`spec/tooling.md:218-219` MANDATES the surface value: `count :nums = 3` → " +
      '`params={ text: "count :nums" }`. It is a machine-readable quotation of the span, not an ' +
      "identifier — canonicalizing it would make the param disagree with its own source_span, " +
      "and a target such as `1 + 2` or `(first :x)` has no canonical form at all.",
  },
  "ol-style-name-case": {
    name:
      "a CASING lint over user identifiers and keywords alike (`spec/tooling.md:240`): its whole " +
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
];

/** Every Heritage-only spelling as a whole-word, case-insensitive matcher. */
const SURFACE_PATTERNS = heritageSurfaceSpellings().map((spelling) => ({
  spelling,
  pattern: new RegExp(`\\b${spelling}\\b`, "i"),
}));

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
  // pairs that do compare canonical values are the escape twins (`keyword`), the reporter aliases
  // (`callable`), and `to print` (`namespace`). This is not a gap that can be closed by a better
  // program: `cs 1` and `cs 1 2` only add another `ol-bad-token`, also `text`-only.
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
            `params (spec/error-model.md:235-238); Heritage adds no new semantics ` +
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
              `(spec/error-model.md:235-238).`,
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
