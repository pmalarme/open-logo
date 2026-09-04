// Unit tests for issue #837: **binding a built-in name is free**, and the `ol-reserved-word` rule
// is keyed to the grammar's four DECLARATION SLOTS instead.
//
// This file is the exact inverse of what it asserted before, and the reversal is deliberate. It
// used to pin issue #739's maintainer ruling ("reserved word is reserved word"), which extended
// `ol-reserved-word` to *every form that introduces a name*. Maintainer ruling #833 overrules that;
// the normative text landed in #875:
//
//   spec/grammar.md:365 — "A program may not declare a built-in name. A program may bind a value to
//                          any name."
//   spec/grammar.md:390 — every binding form "MUST accept **any** name, including a keyword, a
//                          primitive, or an alias spelling of one … An implementation MUST NOT raise
//                          `ol-reserved-word` — or any other diagnostic — for the name alone in any
//                          of those positions, at any stage."
//   spec/grammar.md:392 — why the declaration slots are the complete enforcement point: "A
//                          restriction on a binding form is bypassable, because `local` is optional
//                          and the same name can be bound with `<place> = <value>` instead."
//
// Measured at the previous HEAD (`31781c7`), sanity-asserted: all 43 keywords parsed clean, executed
// clean and printed their value, yet checked `ol-reserved-word` from every binding position — 43 of
// 43. `local` was the same, with `local count` additionally reporting a primitive collision.
// After this change all 44 (the list gained `mod`) are clean at check from every binding position,
// while `define`/`struct` still reject all 44.
//
// Every assertion here is driven off the public `OL_KEYWORDS` registry rather than a hand-kept
// sample, so a keyword added later is pulled into this guard automatically. The assertions are
// deliberately "no diagnostic at all", not "no `ol-reserved-word`", because that is what the spec
// sentence says; each form carries an ordinary-name control so a form that is broken for unrelated
// reasons cannot make the keyword rows pass vacuously.
//
// Runs under `node --test` against the built `@openlogo/parser` package, exercising only its public
// `parse`/`check` surface.

import assert from "node:assert/strict";
import { test } from "node:test";
import * as OL from "@openlogo/parser";

const doc = "unit.logo";
const QUOTE = String.fromCharCode(34);

const SPRITES_WORDS = ["ask", "each", "tell"];
const INTERACTION_WORDS = ["when", "every", "on_key", "on_click"];
const CORE = ["core-language"];
const CORE_AND_SPRITES = ["core-language", "sprites"];
const CORE_AND_INTERACTION = ["core-language", "interaction-events"];
const CORE_AND_HERITAGE = ["core-language", "heritage"];
const CORE_AND_DATA = ["core-language", "data"];

/** Every keyword, from the registry — never a hand-kept sample. */
const KEYWORDS = OL.OL_KEYWORDS;

function checkSource(source, profiles = CORE) {
  const { ast, diagnostics: parseDiagnostics } = OL.parse(source, doc);
  assert.deepEqual(
    parseDiagnostics,
    [],
    `expected a clean parse for ${JSON.stringify(source)}`,
  );
  return OL.check(ast, { profiles, source }).diagnostics;
}

const isReservedWordFinding = (diagnostic) =>
  diagnostic.code === "ol-reserved-word";

function reservedFindings(source, profiles = CORE) {
  return checkSource(source, profiles).filter(isReservedWordFinding);
}

/**
 * Every binding position `spec/grammar.md:390` names, as a template that puts `name` in it. `make`
 * is absent only because its target is a word literal rather than a name token and it needs the
 * Heritage profile; it gets its own test below.
 *
 * `local <name> = <value>` and `global <name> = <value>` are both named in that same normative
 * sentence and joined the list with issue #823, which is the slice that made either parse.
 */
const BINDING_FORMS = [
  {
    label: "assignment (`:name = v`, colon-place)",
    source: (name) => `:${name} = 1\n`,
  },
  {
    label: "assignment (`set name to v`, bare-place)",
    source: (name) => `set ${name} to 1\n`,
  },
  { label: "`local`", source: (name) => `local ${name}\n` },
  {
    label: "`local` with an initializer",
    source: (name) => `local ${name} = 1\n`,
  },
  {
    label: "`global` declaration",
    source: (name) => `global ${name} = 1\n`,
  },
  {
    label: "`for … in` binder",
    source: (name) => `for ${name} in [1 2] [ print 1 ]\n`,
  },
  {
    label: "`for … from … to` binder",
    source: (name) => `for ${name} from 1 to 3 [ print 1 ]\n`,
  },
  {
    label: "`map` comprehension binder",
    source: (name) => `print map ${name} in [1 2] [ 1 ]\n`,
  },
  {
    label: "`filter` comprehension binder",
    source: (name) => `print filter ${name} in [1 2] [ true ]\n`,
  },
  {
    label: "`reduce` accumulator",
    source: (name) => `print reduce ${name} item in [1 2] from 0 [ 1 ]\n`,
  },
  {
    label: "`reduce` item binder",
    source: (name) => `print reduce total ${name} in [1 2] from 0 [ 1 ]\n`,
  },
  {
    label: "destructuring-pattern name",
    source: (name) => `for [ :${name} :b ] in [[1 2]] [ print 1 ]\n`,
  },
  {
    label: "procedure parameter",
    source: (name) => `define f :${name}\n  print 1\nend\n`,
  },
  {
    label: "optional procedure parameter",
    source: (name) => `define f ( :${name} 5 )\n  print 1\nend\n`,
  },
];

/** Assert `form` bound to `word` under `profiles` raises no diagnostic of any code. */
function assertBindingIsFree(form, word, profiles) {
  const source = form.source(word);
  assert.deepEqual(
    checkSource(source, profiles),
    [],
    `${form.label} with \`${word}\` must be accepted (spec/grammar.md:390)`,
  );
}

test("every binding form is free for every keyword — no diagnostic of any code", () => {
  assert.ok(
    KEYWORDS.length >= 44,
    "expected the keyword registry to be populated",
  );
  for (const form of BINDING_FORMS) {
    // The control: whatever this form does for an ordinary name, it must do for a keyword.
    assertBindingIsFree(form, "counter", CORE);
    for (const word of KEYWORDS) {
      assertBindingIsFree(form, word, CORE);
    }
  }
});

test("every binding form is free for a profile word — in BOTH directions", () => {
  // `spec/grammar.md:412` makes profile words built-in unconditionally, and binding a built-in name
  // is free, so the profile set must make no difference at a binding. Asserted with the profile
  // active *and* inactive, so neither direction can regress unnoticed.
  for (const form of BINDING_FORMS) {
    for (const word of SPRITES_WORDS) {
      assertBindingIsFree(form, word, CORE_AND_SPRITES);
      assertBindingIsFree(form, word, CORE);
    }
    for (const word of INTERACTION_WORDS) {
      assertBindingIsFree(form, word, CORE_AND_INTERACTION);
      assertBindingIsFree(form, word, CORE);
    }
  }
});

test('the Heritage `make "name" value` spelling is free for every keyword too', () => {
  // `make` binds the same place as `:name = v` (it lowers to the identical AssignNode), so it must
  // be equally free. Under Core alone `make` is gated by the Heritage profile and reports
  // `ol-unknown-command` — a profile gate, not a name collision — so this runs with heritage active.
  for (const word of KEYWORDS) {
    assert.deepEqual(
      checkSource(`make ${QUOTE}${word}${QUOTE} 1\n`, CORE_AND_HERITAGE),
      [],
      `make "${word}" must be accepted`,
    );
  }
  for (const word of [...SPRITES_WORDS, ...INTERACTION_WORDS]) {
    assert.deepEqual(
      checkSource(`make ${QUOTE}${word}${QUOTE} 1\n`, [
        ...CORE_AND_HERITAGE,
        "sprites",
        "interaction-events",
      ]),
      [],
      `make "${word}" must be accepted with its profile active`,
    );
  }
});

test("`local` is a binding, not a declaration: it registers nothing callable", () => {
  // This is the evidence `spec/grammar.md:392` rests on, asserted rather than quoted. `local foo`
  // followed by a call to `foo` is an unknown command, so `local` never enters the callable
  // namespace and cannot be a declaration slot — which is why it stopped being checked here.
  const findings = checkSource("define g\n  local foo\nend\nfoo\n");
  assert.deepEqual(
    findings.map((finding) => finding.code),
    ["ol-unknown-command"],
    "local must not register a callable name",
  );
});

test("`local` no longer collides in any of the four categories #739 checked", () => {
  for (const [label, source, profiles] of [
    ["keyword", "local repeat\n", CORE],
    ["Core primitive", "local count\n", CORE],
    ["procedure", "define myproc\n  print 1\nend\nlocal myproc\n", CORE],
    [
      "struct constructor",
      "struct point [ x y ]\nlocal point\n",
      CORE_AND_DATA,
    ],
    ["Sprites word", "local tell\n", CORE_AND_SPRITES],
    ["Heritage alias", "local pr\n", CORE_AND_HERITAGE],
  ]) {
    assert.deepEqual(
      checkSource(source, profiles),
      [],
      `local must accept a ${label} name`,
    );
  }
});

test("a nested place is a write into an existing structure, so it stays clean", () => {
  // spec/grammar.md:408,410 — "A write **into** an existing value introduces no name … a postfix
  // names a field or key, which is data", and "Dictionary keys and selector bare keys are data, not
  // declarations, so built-in names are legal keys."
  assert.deepEqual(
    reservedFindings(":box = {a: 1}\n:box.tell = 5\n", CORE_AND_SPRITES),
    [],
    "a built-in field name on a dotted place must stay clean",
  );
  assert.deepEqual(
    reservedFindings(":xs = [1 2]\n:xs[1] = 5\n", CORE_AND_SPRITES),
    [],
    "a bracketed selector write introduces no name",
  );
  assert.deepEqual(
    reservedFindings("set box to {a: 1}\nset box.repeat to 5\n"),
    [],
    "the bare-place spelling of a nested write is equally unflagged",
  );
});

test("struct fields and dictionary keys are data, so built-in names are legal there", () => {
  for (const word of KEYWORDS) {
    assert.deepEqual(
      checkSource(`struct s [ ${word} b ]\n`, CORE_AND_DATA),
      [],
      `${word} must be a legal struct field name`,
    );
    assert.deepEqual(
      checkSource(`:d = { ${word}: 1 }\n`, CORE_AND_DATA),
      [],
      `${word} must be a legal dictionary key`,
    );
  }
});

test("a non-place assignment target raises ol-not-a-place only — the reserved-word rule skips it", () => {
  const diagnostics = checkSource("first :repeat = 5\n");
  assert.deepEqual(
    diagnostics.filter(isReservedWordFinding),
    [],
    "a malformed target introduces no name, so it must not be flagged here",
  );
  assert.ok(
    diagnostics.some((diagnostic) => diagnostic.code === "ol-not-a-place"),
    "the malformed target is still reported by its own rule",
  );
});

test("matching stays case-insensitive: an upper-case keyword binds just as freely", () => {
  assert.deepEqual(checkSource(":TELL = 1\n", CORE_AND_SPRITES), []);
  assert.deepEqual(checkSource(":REPEAT = 1\n"), []);
});

test("at a declaration slot, matching is case-insensitive but the reported name keeps the source spelling", () => {
  // The other side of case-insensitivity, and the one with a reportable name. `isBuiltInName`
  // looks the name up lowercased while `reservedWordDiagnostic` reports `spannedName.name`, so the
  // learner is told the spelling they wrote. A "simplification" that reported the lowercased lookup
  // key instead would regress this silently, which is why it is pinned rather than assumed.
  for (const written of ["REPEAT", "CoUnT"]) {
    const findings = reservedFindings(`define ${written}\nend\n`);
    assert.equal(findings.length, 1, `define ${written} must raise once`);
    assert.deepEqual(findings[0].params, { name: written });
  }
});

// --- The other half of the ruling: the declaration slots still reject ---------------------------

test("non-regression: `define` and `struct` still reject every keyword", () => {
  for (const word of KEYWORDS) {
    const defineFindings = reservedFindings(`define ${word}\nend\n`);
    assert.equal(
      defineFindings.length,
      1,
      `define ${word} must raise exactly one ol-reserved-word`,
    );
    assert.deepEqual(defineFindings[0].params, { name: word });
    const structFindings = reservedFindings(
      `struct ${word} [ a ]\n`,
      CORE_AND_DATA,
    );
    assert.equal(
      structFindings.length,
      1,
      `struct ${word} must raise exactly one ol-reserved-word`,
    );
    assert.deepEqual(structFindings[0].params, { name: word });
  }
});

test("non-regression: `define` keeps its full check, now split across two codes", () => {
  // Issue #838 divided the old four-category `namespace` between two codes that each mean one
  // thing (`spec/error-model.md:134-143`): a keyword or primitive is `ol-reserved-word` ("OpenLogo
  // owns this name"), while an earlier procedure or struct declaration is `ol-duplicate-definition`
  // ("something already declares this name") carrying both spans. All four situations are still
  // caught; only the reporting changed.
  const [primitiveFinding] = reservedFindings("define count\nend\n");
  assert.deepEqual(primitiveFinding.params, { name: "count" });

  const [procedureFinding] = checkSource(
    "define myproc\n  print 1\nend\ndefine myproc\n  print 2\nend\n",
  );
  assert.equal(procedureFinding.code, "ol-duplicate-definition");
  assert.equal(procedureFinding.params.name, "myproc");
  assert.deepEqual(procedureFinding.params.original_span.start, [1, 8]);

  const [structFinding] = checkSource(
    "struct point [ x y ]\ndefine point\nend\n",
    CORE_AND_DATA,
  );
  assert.equal(structFinding.code, "ol-duplicate-definition");
  assert.equal(structFinding.params.name, "point");
  assert.deepEqual(structFinding.params.original_span.start, [1, 8]);
});

test("the declaration slot and the binding slot of one statement are judged separately", () => {
  // `define repeat :repeat` puts the same keyword in both a declaration slot and a binding slot.
  // Exactly one finding, at the procedure name — the parameter is free. This is the sharpest
  // statement of "registration versus binding", and it fails loudly if either half regresses.
  const findings = reservedFindings("define repeat :repeat\n  print 1\nend\n");
  assert.equal(findings.length, 1, JSON.stringify(findings));
  assert.deepEqual(findings[0].source_span, {
    document: doc,
    start: [1, 8],
    end: [1, 14],
  });
});

test("call sites stay legal — the rule is keyed to `declared-callable-name`, not `callable-name`", () => {
  // spec/grammar.md:167 — `callable-name`/`type-name` remain the CALL slots, "where every built-in
  // name is of course legal — that is how `forward 100` and `point 3 4` are written". Keying the
  // rule to them instead of to the declaration slots would make this program illegal.
  assert.deepEqual(
    checkSource("forward 100\nright 90\n", [...CORE, "turtle-rendering"]),
    [],
  );
  assert.deepEqual(checkSource("print 7 mod 3\n"), []);
  assert.deepEqual(checkSource("print ( and true false )\n"), []);
});
