// Unit tests for the **tooling** view of the Heritage profile (issue #671, slice H6 of the Heritage
// epic #659 under saga #572; `spec/tooling.md`'s token classes + three checker layers,
// `spec/conformance.md#heritage`, `spec/commands.md`'s C3 alias rows). Heritage's *executable* and
// *checker-recognition* behavior already shipped in H2–H5 (#151/#667, #668, #669, #670) and is
// exercised by `heritage-spellings.test.mjs`, `heritage-aliases.test.mjs`,
// `heritage-list-reporter-aliases.test.mjs`, `heritage-value-of-key-gate.test.mjs`, and the
// `tests/conformance/heritage/check/*` fixtures. This file locks the grammar-derived **tooling**
// contract those slices left implicit for the highlighter and semantic-token provider — no source
// change was required (verified, following the S4 pattern, #692/PR #721).
//
// Heritage is four DISTINCT syntactic shapes, and each takes a different path through the highlighter
// and checker, so all four are proven here — not one representative:
//
//   1. Statement-level special-form heads — `make`, `to`, `output`, `op` (#151/#667). Reserved
//      structural words, so `highlight()` classifies each `keyword` (`spec/tooling.md:30,91`),
//      exactly as their Core equivalents `set`/`define`/`return` are — never `primitive`. Recognition
//      is the Layer-2 `heritageFormRule` profile gate (`checker-heritage-form.ts`), NOT a
//      visible-name rule, because they lower onto the same Core AST nodes as their equivalents.
//   2. Ten short command aliases — `fd`/`bk`/`lt`/`rt`/`pu`/`pd`/`st`/`ht`/`cs`/`pr` (#668). Ordinary
//      primitive call names (not reserved), so they fall through the profile-blind lexical fallback
//      to `primitive` + `defaultLibrary` (`spec/tooling.md:31,277`), exactly like `forward`.
//      Recognized under an active `heritage` profile by `collectVisibleNames`.
//   3. Three list-reporter aliases — `bf`/`bl`/`se` (#669). Also ordinary primitive names, but they
//      appear in EXPRESSION position (as arguments), a different highlighter path than a
//      statement-head call — still `primitive` + `defaultLibrary`, like `butfirst`/`sentence`.
//   4. The `value of <dict> for key <key>` reader (#670). A four-keyword grammar production
//      (`spec/grammar.md:213`) lowering to a dedicated `ValueOfKeyNode`: `value`/`for`/`key` are
//      reserved words → `keyword`, while `of` is a contextual keyword that is `keyword` ONLY inside
//      an `is`-predicate and an ordinary name elsewhere (`spec/tooling.md:97-98`), so here it stays
//      `primitive` — the spec-correct classification, asserted so a regression cannot "tidy" it.
//      Recognized by the same `heritageFormRule` gate; because it reads a dict, Heritage depends on
//      Data (`spec/conformance.md#heritage`).
//
// Every classification is proven in **awkward positions** — inside a `[ … ]` block, inside `repeat`,
// and in a procedure body — via one shared whole-program constant, so a regression that only handled
// a top-level spelling cannot slip through (S4's round-1 finding was subset coverage; this file
// covers every spelling of every shape). This slice does NOT claim the `heritage` profile
// (`SUPPORTED_PROFILES` is untouched, #672's job).

import assert from "node:assert/strict";
import { test } from "node:test";
import * as OL from "@openlogo/parser";

const doc = "heritage-tooling.logo";

// --- The Heritage surface, derived from the source of truth, not re-typed from issue titles ------

/** Every Heritage short command alias, from the parser's own table (`heritageAliasNames()`). */
const ALL_HERITAGE_ALIASES = OL.heritageAliasNames();

/** The three list-reporter aliases (#669), each with an arity-correct call in expression position. */
const HERITAGE_REPORTER_ALIASES = ["bf", "bl", "se"];
/** An arity-correct `print <reporter> …` program per reporter alias (`se`/`sentence` takes two). */
const REPORTER_ALIAS_CALLS = Object.freeze({
  bf: "print bf [1 2]",
  bl: "print bl [1 2]",
  se: "print se [1] [2]",
});
const HERITAGE_COMMAND_ALIASES = ALL_HERITAGE_ALIASES.filter(
  (name) => !HERITAGE_REPORTER_ALIASES.includes(name),
);

// Guard the derivation: if the parser's alias table ever changes, this test's shape lists must be
// updated deliberately rather than silently drifting out of coverage.
test("meta: the alias shape lists together cover exactly the parser's Heritage alias table", () => {
  assert.deepEqual(
    [...ALL_HERITAGE_ALIASES].sort(),
    [...HERITAGE_COMMAND_ALIASES, ...HERITAGE_REPORTER_ALIASES].sort(),
  );
  assert.equal(
    HERITAGE_COMMAND_ALIASES.length,
    10,
    "ten short command aliases",
  );
  assert.equal(
    HERITAGE_REPORTER_ALIASES.length,
    3,
    "three list-reporter aliases",
  );
});

/** The four Heritage statement-level special-form head keywords (#151/#667). */
const HERITAGE_FORM_HEADS = ["make", "to", "output", "op"];

/**
 * An arity-correct bare call for a short COMMAND alias: the zero-arity turtle aliases (`pu`/`pd`/
 * `st`/`ht`/`cs`) are called alone, the one-arity ones (`fd`/`bk`/`lt`/`rt`/`pr`) with a single
 * argument — the alias's own default arity comes from the parser (`heritageAliasArity`), so a table
 * change can never silently produce a mis-grouped (and thus mis-parsed) call here.
 */
function commandAliasCall(alias) {
  const arity = OL.heritageAliasArity(alias);
  return arity === 0 ? alias : `${alias} 1`;
}

/** The three reserved-word keywords of the `value of … for key` reader (`of` is contextual — below). */
const VALUE_OF_KEY_KEYWORDS = ["value", "for", "key"];

const HERITAGE_PROFILES = ["core-language", "data", "heritage"];
const CORE_PROFILES = ["core-language", "data"];

/**
 * One whole Heritage program placing every shape in an awkward position: the `to … output … op`
 * procedure head/returns; a `make` assignment; the short command aliases split across a `repeat` body
 * and a `[ … ]` instruction block; the list-reporter aliases nested as expression arguments; and the
 * `value of … for key` reader inside a `print`. Shared by the nested highlighting, semantic-token,
 * and checker assertions so a regression that only handled a top-level spelling cannot pass.
 */
const NESTED_HERITAGE_PROGRAM = [
  "to demo :d",
  '  make "n" 3',
  "  repeat 2 [ fd 10 rt 90 pu pd ]",
  "  st",
  "  ht",
  "  cs",
  "  bk 10",
  "  lt 45",
  "  pr bf [1 2]",
  "  pr bl [3 4]",
  "  pr se [1] [2]",
  '  print value of :d for key "a"',
  "  output :n",
  "  op :n",
  "end",
].join("\n");

/** The `class` of the (first) token whose text is `name`, from `highlight()` over `source`. */
function classOf(source, name) {
  const token = OL.highlight(source, doc).find((t) => t.text === name);
  assert.ok(
    token,
    `expected a token spelled ${JSON.stringify(name)} in ${JSON.stringify(source)}`,
  );
  return token.class;
}

/** `check()` diagnostics for `source` under `profiles`; the parse must be clean first. */
function checkDiagnostics(source, profiles) {
  const { ast, diagnostics: parseDiagnostics } = OL.parse(source, doc);
  assert.deepEqual(
    parseDiagnostics,
    [],
    `expected a clean parse for ${JSON.stringify(source)}`,
  );
  return OL.check(ast, { profiles }).diagnostics;
}

// =================================================================================================
// Shape 1 — statement-level special-form heads: `make` / `to` / `output` / `op` highlight `keyword`
// =================================================================================================

test("highlight: each Heritage form head is a keyword, like its Core equivalent (never primitive)", () => {
  // The Core equivalents `set`/`define`/`return` are reserved structural words highlighted `keyword`;
  // `make`/`to`/`output`/`op` are equally reserved (`spec/tooling.md:91`), so they must match.
  assert.equal(classOf('make "n" 1', "make"), "keyword");
  assert.equal(classOf("to f :n\n output :n\nend", "to"), "keyword");
  assert.equal(classOf("to f :n\n output :n\nend", "output"), "keyword");
  assert.equal(classOf("to f :n\n op :n\nend", "op"), "keyword");
});

test("semanticTokens: each Heritage form head carries no defaultLibrary — it is a keyword, not a primitive", () => {
  // Keyword-class tokens get NO `defaultLibrary` modifier (that modifier is the `primitive`/library
  // marker, `spec/tooling.md:277`). Assert the class and the absence of the modifier so a form head
  // can never be mistaken for a callable primitive.
  const cases = {
    make: 'make "n" 1',
    to: "to f :n\n output :n\nend",
    output: "to f :n\n output :n\nend",
    op: "to f :n\n op :n\nend",
  };
  for (const [head, source] of Object.entries(cases)) {
    const token = OL.semanticTokens(source, doc).find((t) => t.text === head);
    assert.ok(token, `expected a semantic token for ${head}`);
    assert.equal(token.class, "keyword", `${head} should be a keyword`);
    assert.ok(
      !token.modifiers.includes("defaultLibrary"),
      `${head} must not carry defaultLibrary`,
    );
  }
});

// =================================================================================================
// Shape 2 — ten short command aliases: `fd`/`bk`/…/`pr` highlight `primitive` + `defaultLibrary`
// =================================================================================================

test("highlight: each short command alias classifies as primitive, like its canonical (fd like forward)", () => {
  for (const alias of HERITAGE_COMMAND_ALIASES) {
    // A bare alias call in statement position: `fd`, `st`, `pr`, … each on its own line so the reader
    // groups it independently of its (canonical's) arity.
    assert.equal(
      classOf(commandAliasCall(alias), alias),
      "primitive",
      `${alias} should highlight as primitive`,
    );
  }
});

test("semanticTokens: each short command alias carries defaultLibrary, like a Core primitive", () => {
  for (const alias of HERITAGE_COMMAND_ALIASES) {
    const token = OL.semanticTokens(commandAliasCall(alias), doc).find(
      (t) => t.text === alias,
    );
    assert.ok(token, `expected a semantic token for ${alias}`);
    assert.equal(token.class, "primitive");
    assert.ok(
      token.modifiers.includes("defaultLibrary"),
      `${alias} should be a defaultLibrary primitive`,
    );
  }
});

// =================================================================================================
// Shape 3 — three list-reporter aliases: `bf`/`bl`/`se` in EXPRESSION position, primitive + library
// =================================================================================================

test("highlight: each list-reporter alias classifies as primitive in expression position (bf like butfirst)", () => {
  for (const alias of HERITAGE_REPORTER_ALIASES) {
    // A reporter alias only appears as an argument (expression position) — a different highlighter
    // path than a statement-head call, still classified by name → primitive.
    assert.equal(
      classOf(REPORTER_ALIAS_CALLS[alias], alias),
      "primitive",
      `${alias} should highlight as primitive in expression position`,
    );
  }
});

test("semanticTokens: each list-reporter alias carries defaultLibrary in expression position", () => {
  for (const alias of HERITAGE_REPORTER_ALIASES) {
    const token = OL.semanticTokens(REPORTER_ALIAS_CALLS[alias], doc).find(
      (t) => t.text === alias,
    );
    assert.ok(token, `expected a semantic token for ${alias}`);
    assert.equal(token.class, "primitive");
    assert.ok(
      token.modifiers.includes("defaultLibrary"),
      `${alias} should be a defaultLibrary primitive`,
    );
  }
});

// =================================================================================================
// Shape 4 — the `value of … for key` reader: reserved words keyword; contextual `of` stays primitive
// =================================================================================================

test("highlight: value/for/key in the value-of-key reader are keywords", () => {
  const source = 'print value of :d for key "a"';
  for (const word of VALUE_OF_KEY_KEYWORDS) {
    assert.equal(
      classOf(source, word),
      "keyword",
      `${word} should highlight as keyword in the value-of-key reader`,
    );
  }
});

test("highlight: `of` in the value-of-key reader stays primitive — it is a keyword only inside an is-predicate", () => {
  // `spec/tooling.md:97-98`: `of` is a contextual keyword, marked `keyword` ONLY inside an
  // `is`-predicate and an ordinary name elsewhere. The `value of … for key` reader is not an
  // is-predicate, so `of` here is an ordinary name → the highlighter's `primitive` fallback. Pinned
  // so a future change cannot silently promote it to `keyword` (which would contradict the spec) —
  // and, for contrast, `of` inside an `is`-predicate IS a keyword.
  assert.equal(classOf('print value of :d for key "a"', "of"), "primitive");
  assert.equal(classOf("if :x is member of [1 2] [ ]", "of"), "keyword");
});

test("semanticTokens: value/for/key carry no defaultLibrary (keywords); `of` does (ordinary primitive)", () => {
  const tokens = OL.semanticTokens('print value of :d for key "a"', doc);
  for (const word of VALUE_OF_KEY_KEYWORDS) {
    const token = tokens.find((t) => t.text === word);
    assert.ok(token, `expected a semantic token for ${word}`);
    assert.equal(token.class, "keyword");
    assert.ok(!token.modifiers.includes("defaultLibrary"));
  }
  const of = tokens.find((t) => t.text === "of");
  assert.ok(of);
  assert.equal(of.class, "primitive");
  assert.ok(of.modifiers.includes("defaultLibrary"));
});

// =================================================================================================
// A form head is never keyword-locked: it can be a user-declared name where the grammar allows one
// =================================================================================================

test("highlight: a short alias name is never a keyword — it can be redefined as a procedure name", () => {
  // Reserved block-heads always highlight `keyword`; the short aliases are NOT reserved words, so a
  // user procedure literally named `fd` resolves to `procedure-name` at its declaration and call —
  // proving the alias is classified by name/role, not locked to `primitive` the way a keyword is.
  const tokens = OL.highlight("define fd\nend\nfd", doc).filter(
    (t) => t.text === "fd",
  );
  assert.equal(tokens.length, 2);
  assert.ok(tokens.every((t) => t.class === "procedure-name"));
});

// =================================================================================================
// Nested: every shape keeps its class inside a whole program (block, repeat, procedure body)
// =================================================================================================

test("highlight: every Heritage spelling keeps its class nested in a whole program", () => {
  const tokens = OL.highlight(NESTED_HERITAGE_PROGRAM, doc);
  const classesOf = (name) =>
    tokens.filter((t) => t.text === name).map((t) => t.class);

  for (const head of HERITAGE_FORM_HEADS) {
    for (const cls of classesOf(head)) {
      assert.equal(cls, "keyword", `nested ${head} should stay keyword`);
    }
  }
  for (const alias of [
    ...HERITAGE_COMMAND_ALIASES,
    ...HERITAGE_REPORTER_ALIASES,
  ]) {
    const seen = classesOf(alias);
    assert.ok(seen.length >= 1, `expected ${alias} in the nested program`);
    for (const cls of seen) {
      assert.equal(cls, "primitive", `nested ${alias} should stay primitive`);
    }
  }
  for (const word of VALUE_OF_KEY_KEYWORDS) {
    assert.ok(
      classesOf(word).includes("keyword"),
      `nested ${word} should be a keyword`,
    );
  }
});

test("semanticTokens: every Heritage alias keeps primitive+defaultLibrary nested in a whole program", () => {
  const tokens = OL.semanticTokens(NESTED_HERITAGE_PROGRAM, doc);
  for (const alias of [
    ...HERITAGE_COMMAND_ALIASES,
    ...HERITAGE_REPORTER_ALIASES,
  ]) {
    const matches = tokens.filter((t) => t.text === alias);
    assert.ok(
      matches.length >= 1,
      `expected a semantic token for nested ${alias}`,
    );
    for (const token of matches) {
      assert.equal(token.class, "primitive");
      assert.ok(
        token.modifiers.includes("defaultLibrary"),
        `nested ${alias} should be a defaultLibrary primitive`,
      );
    }
  }
});

// =================================================================================================
// Checker recognition — active heritage clean; Core-only unknown, per shape and whole-program
// =================================================================================================

test("check: with heritage active, each form head is accepted (checks clean)", () => {
  const cases = {
    make: 'make "n" 1',
    to: "to f :n\n output :n\nend",
    output: "to f :n\n output :n\nend",
    op: "to f :n\n op :n\nend",
  };
  for (const [head, source] of Object.entries(cases)) {
    assert.deepEqual(
      checkDiagnostics(source, HERITAGE_PROFILES),
      [],
      `${head} should check clean under an active heritage profile`,
    );
  }
});

test("check: without heritage, each form head is ol-unknown-command with a Core did-you-mean", () => {
  const cases = {
    make: { source: 'make "n" 1', suggestion: "set" },
    to: { source: "to f :n\n output :n\nend", suggestion: "define" },
    op: { source: "to f :n\n op :n\nend", suggestion: "define" },
  };
  // `make` alone: a single head. `to … output`/`to … op`: the reader lowers `to` to a ProcedureDef
  // and `output`/`op` to a Return, so Core flags both heads — assert `to`'s among them here and cover
  // `output`/`op` explicitly below.
  const makeDiags = checkDiagnostics(cases.make.source, CORE_PROFILES);
  assert.equal(makeDiags.length, 1);
  assert.equal(makeDiags[0].code, "ol-unknown-command");
  assert.equal(makeDiags[0].params.name, "make");
  assert.equal(makeDiags[0].params.suggestion, "set");

  for (const returnHead of ["output", "op"]) {
    const source = `to f :n\n ${returnHead} :n\nend`;
    const names = checkDiagnostics(source, CORE_PROFILES)
      .filter((d) => d.code === "ol-unknown-command")
      .map((d) => `${d.params.name}->${d.params.suggestion}`)
      .sort();
    assert.deepEqual(names, [`${returnHead}->return`, "to->define"]);
  }
});

test("check: with heritage active, every short/reporter alias is a known callee (checks clean)", () => {
  for (const alias of HERITAGE_COMMAND_ALIASES) {
    assert.deepEqual(
      checkDiagnostics(commandAliasCall(alias), HERITAGE_PROFILES),
      [],
      `${alias} should check clean under an active heritage profile`,
    );
  }
  for (const alias of HERITAGE_REPORTER_ALIASES) {
    assert.deepEqual(
      checkDiagnostics(REPORTER_ALIAS_CALLS[alias], HERITAGE_PROFILES),
      [],
      `${alias} should check clean in expression position under heritage`,
    );
  }
});

test("check: without heritage, every short/reporter alias is ol-unknown-command", () => {
  for (const alias of HERITAGE_COMMAND_ALIASES) {
    const diagnostics = checkDiagnostics(
      commandAliasCall(alias),
      CORE_PROFILES,
    ).filter((d) => d.code === "ol-unknown-command");
    assert.equal(
      diagnostics.length,
      1,
      `${alias} should be unknown under Core`,
    );
    assert.equal(diagnostics[0].params.name, alias);
    assert.equal(diagnostics[0].stage, "semantic");
  }
  for (const alias of HERITAGE_REPORTER_ALIASES) {
    const names = checkDiagnostics(REPORTER_ALIAS_CALLS[alias], CORE_PROFILES)
      .filter((d) => d.code === "ol-unknown-command")
      .map((d) => d.params.name);
    assert.ok(names.includes(alias), `${alias} should be unknown under Core`);
  }
});

test("check: the value-of-key reader is accepted under heritage, ol-unknown-command under Core", () => {
  // Needs a real dict, so the whole program declares one; the reader form itself is the subject.
  const source = 'make "d" {a: 1}\nprint value of :d for key "a"';
  assert.deepEqual(checkDiagnostics(source, HERITAGE_PROFILES), []);

  // Under Core the `make`/dict/`value of` are all unknown; assert the reader head specifically.
  const valueDiag = checkDiagnostics(
    'print value of :d for key "a"',
    CORE_PROFILES,
  ).find((d) => d.code === "ol-unknown-command" && d.params.name === "value");
  assert.ok(
    valueDiag,
    "the value-of-key head should be ol-unknown-command under Core",
  );
  assert.equal(
    valueDiag.params.suggestion,
    undefined,
    "the reader carries no suggestion",
  );
  assert.equal(valueDiag.stage, "semantic");
});

test("check: a wrong-arity Heritage alias raises the same diagnostic a Core call would", () => {
  // `bf` resolves to `butfirst` (fixed arity 1). Give the parenthesized form too few inputs and
  // compare `(bf)` to `(butfirst)`: both must raise the identical diagnostic, proving the alias
  // arity-checks through its canonical, not on a spelling of its own.
  const aliasDiags = checkDiagnostics("print (bf)", HERITAGE_PROFILES);
  const canonicalDiags = checkDiagnostics(
    "print (butfirst)",
    HERITAGE_PROFILES,
  );
  assert.ok(
    aliasDiags.length >= 1,
    "an arity-violating alias call should be flagged",
  );
  assert.equal(aliasDiags[0].code, canonicalDiags[0].code);
  assert.equal(aliasDiags[0].code, "ol-not-enough-inputs");
});

test("check: a whole Heritage program in awkward positions checks clean under heritage", () => {
  assert.deepEqual(
    checkDiagnostics(NESTED_HERITAGE_PROGRAM, HERITAGE_PROFILES),
    [],
  );
});

test("check: that same program under Core flags every Heritage spelling as unknown", () => {
  // Nesting must not hide a Heritage spelling from the checker: every form head, every alias, and the
  // value-of-key reader head is reported under Core-only. Assert each expected name appears.
  const names = new Set(
    checkDiagnostics(NESTED_HERITAGE_PROGRAM, CORE_PROFILES)
      .filter((d) => d.code === "ol-unknown-command")
      .map((d) => d.params.name),
  );
  for (const expected of [
    ...HERITAGE_FORM_HEADS,
    ...HERITAGE_COMMAND_ALIASES,
    ...HERITAGE_REPORTER_ALIASES,
    "value",
  ]) {
    assert.ok(
      names.has(expected),
      `expected ${expected} to be ol-unknown-command under Core`,
    );
  }
});
