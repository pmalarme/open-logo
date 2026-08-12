// Unit tests for issue #739: `ol-reserved-word` must be raised for EVERY form that introduces a
// name, not only at the three registration forms (`define`/`struct`/`local`) the rule originally
// covered. The maintainer ruling on #739 ("reserved word is reserved word") settled this against
// the earlier "registrations only" reading that `checker-reserved-word.ts`'s doc comment used to
// assert; the rationale on the record is that assignment is the PRIMARY way to create a variable
// in OpenLogo and `local` is optional (`:brandnew = 1` then `print :brandnew` checks clean with no
// declaration anywhere), so a rule enforced only at `local` is bypassable by omitting an optional
// keyword — which would make spec/grammar.md:367's "may not be redefined as variables" close to
// meaningless in a learner-facing language.
//
// Newly covered here (all previously clean): assignment in all three surface spellings
// (`:name = v` colon-place, `set name to v` bare-place, Heritage `make "name" v`), `for … in` and
// `for … from … to` binders, `map`/`filter`/`reduce` binders and the `reduce` accumulator,
// destructuring-pattern names, and procedure parameters. spec/grammar.md:103-108,127,131-136,153.
//
// Two boundaries are asserted as hard negatives, not left implicit:
//   - Only a BARE place head introduces a name. `:d.tell = 5` and `:xs[1] = 5` write into an
//     existing structure, and spec/grammar.md:369 keeps field names and selector keys out of the
//     structural-word namespace ("reserved words are legal keys"), so they stay clean.
//   - A binding introduces a `:name` VARIABLE, and spec/grammar.md:369 keeps variables out of the
//     one callable namespace primitives/procedures/struct constructors share, so `:count = 1` and
//     `:myproc = 1` stay clean. Only the reserved-word category collides from a binding position —
//     which is exactly the blast radius the ruling predicted (`:repeat = 1`, `:if = 1`,
//     `:while = 1`). The three REGISTRATION forms keep their full four-category check unchanged,
//     and that non-regression is asserted here too.
//
// Profile-conditional words (`tell`/`ask`/`each` under `sprites`; `when`/`every`/`on_key`/
// `on_click` under `interaction-events`, C1/#663) are asserted in BOTH directions on every new
// form: reserved while their profile is active, ordinary names while it is not.
//
// Runs under `node --test` against the built `@openlogo/parser` package, exercising only its
// public `parse`/`check` surface. Asserts identity (codes, params, spans, stage, severity) only.

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
 * Every newly covered binding form, as a template that puts `name` in the binding position. The
 * `column` is where that binding's own span starts (1-based), so each test asserts the diagnostic
 * points at the bound name itself rather than at the enclosing statement.
 */
const BINDING_FORMS = [
  {
    label: "assignment (`:name = v`, colon-place)",
    source: (name) => `:${name} = 1\n`,
    column: 1,
    // The colon is part of a colon-place head's span, matching how `ol-undefined-var` already
    // spans a `:name` read.
    width: (name) => name.length + 1,
  },
  {
    label: "assignment (`set name to v`, bare-place)",
    source: (name) => `set ${name} to 1\n`,
    column: 5,
    width: (name) => name.length,
  },
  {
    label: "`for … in` binder",
    source: (name) => `for ${name} in [1 2] [ print 1 ]\n`,
    column: 5,
    width: (name) => name.length,
  },
  {
    label: "`for … from … to` binder",
    source: (name) => `for ${name} from 1 to 3 [ print 1 ]\n`,
    column: 5,
    width: (name) => name.length,
  },
  {
    label: "`map` comprehension binder",
    source: (name) => `print map ${name} in [1 2] [ 1 ]\n`,
    column: 11,
    width: (name) => name.length,
  },
  {
    label: "`filter` comprehension binder",
    source: (name) => `print filter ${name} in [1 2] [ true ]\n`,
    column: 14,
    width: (name) => name.length,
  },
  {
    label: "`reduce` accumulator",
    source: (name) => `print reduce ${name} item in [1 2] from 0 [ 1 ]\n`,
    column: 14,
    width: (name) => name.length,
  },
  {
    label: "`reduce` item binder",
    source: (name) => `print reduce total ${name} in [1 2] from 0 [ 1 ]\n`,
    column: 20,
    width: (name) => name.length,
  },
  {
    label: "destructuring-pattern name",
    source: (name) => `for [ :${name} :b ] in [[1 2]] [ print 1 ]\n`,
    column: 7,
    width: (name) => name.length + 1,
  },
  {
    label: "procedure parameter",
    source: (name) => `define f :${name}\n  print 1\nend\n`,
    column: 10,
    width: (name) => name.length + 1,
  },
];

test("every binding form raises ol-reserved-word for a Core reserved word, at that name's own span", () => {
  for (const form of BINDING_FORMS) {
    for (const word of ["repeat", "if", "while"]) {
      const source = form.source(word);
      const findings = reservedFindings(source);
      assert.equal(
        findings.length,
        1,
        `${form.label} with \`${word}\` should raise exactly one ol-reserved-word, got ${JSON.stringify(findings)}`,
      );
      const [finding] = findings;
      assert.deepEqual(finding.params, { name: word, namespace: "reserved" });
      assert.equal(finding.stage, "semantic");
      assert.equal(finding.severity, "error");
      assert.deepEqual(
        finding.source_span,
        {
          document: doc,
          start: [1, form.column],
          end: [1, form.column + form.width(word)],
        },
        `${form.label} should point at the bound name in ${JSON.stringify(source)}`,
      );
    }
  }
});

test("every binding form raises ol-reserved-word for a Sprites word while `sprites` is active", () => {
  for (const form of BINDING_FORMS) {
    for (const word of SPRITES_WORDS) {
      const [finding] = reservedFindings(form.source(word), CORE_AND_SPRITES);
      assert.ok(
        finding,
        `${form.label} with \`${word}\` should be flagged when sprites is active`,
      );
      assert.deepEqual(finding.params, { name: word, namespace: "reserved" });
    }
  }
});

test("every binding form leaves a Sprites word alone in a Core-only program", () => {
  for (const form of BINDING_FORMS) {
    for (const word of SPRITES_WORDS) {
      assert.deepEqual(
        reservedFindings(form.source(word)),
        [],
        `${form.label}: \`${word}\` must stay a legal name when sprites is inactive`,
      );
    }
  }
});

test("every binding form raises ol-reserved-word for an Interaction word while `interaction-events` is active", () => {
  for (const form of BINDING_FORMS) {
    for (const word of INTERACTION_WORDS) {
      const [finding] = reservedFindings(
        form.source(word),
        CORE_AND_INTERACTION,
      );
      assert.ok(
        finding,
        `${form.label} with \`${word}\` should be flagged when interaction-events is active`,
      );
      assert.deepEqual(finding.params, { name: word, namespace: "reserved" });
    }
  }
});

test("every binding form leaves an Interaction word alone in a Core-only program", () => {
  for (const form of BINDING_FORMS) {
    for (const word of INTERACTION_WORDS) {
      assert.deepEqual(
        reservedFindings(form.source(word)),
        [],
        `${form.label}: \`${word}\` must stay a legal name when interaction-events is inactive`,
      );
    }
  }
});

test("every binding form accepts an ordinary name", () => {
  for (const form of BINDING_FORMS) {
    assert.deepEqual(
      reservedFindings(form.source("counter"), [
        ...CORE_AND_SPRITES,
        "interaction-events",
      ]),
      [],
      `${form.label} must accept an ordinary name`,
    );
  }
});

test('the Heritage `make "name" value` spelling binds the same place, so it is checked too', () => {
  const source = `make ${QUOTE}tell${QUOTE} 1\n`;
  const [finding] = reservedFindings(source, [...CORE_AND_SPRITES, "heritage"]);
  assert.ok(
    finding,
    "`make` binds a name, so a reserved target must be flagged",
  );
  assert.deepEqual(finding.params, { name: "tell", namespace: "reserved" });
  // `make`'s target is a word literal (spec/grammar.md:105), so its span covers the quoted word.
  assert.deepEqual(finding.source_span, {
    document: doc,
    start: [1, 6],
    end: [1, 12],
  });
  assert.deepEqual(
    reservedFindings(`make ${QUOTE}counter${QUOTE} 1\n`, [
      ...CORE_AND_SPRITES,
      "heritage",
    ]),
    [],
    "an ordinary `make` target stays clean",
  );
});

test("a nested place is a write into an existing structure, not a new name, so it is not flagged", () => {
  // A dotted field and a bracketed selector, each rooted at an ordinary base: spec/grammar.md:369
  // — "Record field names live in a per-type namespace … Dictionary keys and selector bare keys
  // are data, not declarations, so reserved words are legal keys."
  assert.deepEqual(
    reservedFindings(":box = {a: 1}\n:box.tell = 5\n", CORE_AND_SPRITES),
    [],
    "a reserved field name on a dotted place must stay clean",
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

test("a reserved base is flagged once at the bare binding that introduced it, not again at each nested write", () => {
  const findings = reservedFindings(
    ":tell = [1 2]\n:tell[1] = 5\n:tell[2] = 6\n",
    CORE_AND_SPRITES,
  );
  assert.equal(
    findings.length,
    1,
    `only the introducing binding is flagged, got ${JSON.stringify(findings)}`,
  );
  assert.deepEqual(findings[0].source_span, {
    document: doc,
    start: [1, 1],
    end: [1, 6],
  });
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

test("a binding does not collide with a primitive, a procedure, or a struct constructor", () => {
  // spec/grammar.md:369 — "Primitives, user procedures, and struct type constructors share one
  // callable namespace"; `:name` variables are not in it, so a binding shadows none of them.
  for (const source of [
    ":count = 1\nprint :count\n",
    ":print = 1\nprint :print\n",
    "for count in [1 2] [ print :count ]\n",
    "define f :count\n  print :count\nend\n",
  ]) {
    assert.deepEqual(
      reservedFindings(source),
      [],
      `a Core primitive name must stay bindable: ${JSON.stringify(source)}`,
    );
  }
  assert.deepEqual(
    reservedFindings("define myproc\n  print 1\nend\n:myproc = 1\n"),
    [],
    "a user procedure name must stay bindable",
  );
  assert.deepEqual(
    reservedFindings("struct point [ x y ]\n:point = 1\n", [...CORE, "data"]),
    [],
    "a struct constructor name must stay bindable",
  );
});

test("the three registration forms keep their full four-category check (non-regression)", () => {
  const [primitiveFinding] = reservedFindings("local count\n");
  assert.deepEqual(primitiveFinding.params, {
    name: "count",
    namespace: "primitive",
  });

  const [procedureFinding] = reservedFindings(
    "define myproc\n  print 1\nend\nlocal myproc\n",
  );
  assert.deepEqual(procedureFinding.params, {
    name: "myproc",
    namespace: "procedure",
  });

  const [structFinding] = reservedFindings(
    "struct point [ x y ]\nlocal point\n",
    [...CORE, "data"],
  );
  assert.deepEqual(structFinding.params, {
    name: "point",
    namespace: "struct",
  });

  const [reservedFinding] = reservedFindings("define repeat\n  print 1\nend\n");
  assert.deepEqual(reservedFinding.params, {
    name: "repeat",
    namespace: "reserved",
  });
});

test("findings from mixed registration and binding forms come out in source order", () => {
  const findings = reservedFindings(
    "local tell\n:ask = 1\nfor each in [1 2] [ print 1 ]\n",
    CORE_AND_SPRITES,
  );
  assert.deepEqual(
    findings.map((finding) => [
      finding.params.name,
      finding.source_span.start[0],
    ]),
    [
      ["tell", 1],
      ["ask", 2],
      ["each", 3],
    ],
  );
});

test("a reserved binder is flagged inside a nested body, not only at top level", () => {
  const [finding] = reservedFindings(
    "define draw\n  repeat 2 [ for tell in [1 2] [ print 1 ] ]\nend\n",
    CORE_AND_SPRITES,
  );
  assert.ok(finding, "the walk must reach binders nested in bodies");
  assert.deepEqual(finding.params, { name: "tell", namespace: "reserved" });
  assert.equal(finding.source_span.start[0], 2);
});

test("matching is case-insensitive, and the reported name keeps the source spelling", () => {
  const [finding] = reservedFindings(":TELL = 1\n", CORE_AND_SPRITES);
  assert.deepEqual(finding.params, { name: "TELL", namespace: "reserved" });
});
