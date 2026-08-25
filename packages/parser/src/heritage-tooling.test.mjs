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
//      structural words, so `highlight()` classifies each `keyword` (`spec/tooling.md:30`, with the
//      class each name carries declared as `tokenClass` in `spec/built-in-names.json`),
//      exactly as their Core equivalents `set`/`define`/`return` are — never `primitive`. Recognition
//      is the Layer-2 `heritageFormRule` profile gate (`checker-heritage-form.ts`), NOT a
//      visible-name rule, because they lower onto the same Core AST nodes as their equivalents.
//   2. Ten short command aliases — `fd`/`bk`/`lt`/`rt`/`pu`/`pd`/`st`/`ht`/`cs`/`pr` (#668). Ordinary
//      primitive call names (not reserved), so they fall through the profile-blind lexical fallback
//      to `primitive` + `defaultLibrary` (`spec/tooling.md:31,279`), exactly like `forward`.
//      Recognized under an active `heritage` profile by `collectVisibleNames`.
//   3. Three list-reporter aliases — `bf`/`bl`/`se` (#669). Also ordinary primitive names, but they
//      appear in EXPRESSION position (as arguments), a different highlighter path than a
//      statement-head call — still `primitive` + `defaultLibrary`, like `butfirst`/`sentence`.
//   4. The `value of <dict> for key <key>` reader (#670). A four-word grammar production
//      (`spec/grammar.md:217`) lowering to a dedicated `ValueOfKeyNode`. All four of its words are
//      `keyword` and none carries `defaultLibrary`. `value`/`for`/`key` because they are reserved
//      words (`spec/tooling.md:92`); `of` because `spec/tooling.md:97-99` — the normative
//      highlighter instruction — marks these contextual words `keyword` "only inside an
//      `is`-predicate or the heritage `value of … for key` reader", this reader being named there
//      by the maintainer's ruling on #785. Supporting passages elsewhere:
//      `spec/localization.md:80,82` lists this reader as a Heritage grammar form whose forms "can
//      contain structural words such as `to`, `of`, `for`, and `key` in fixed grammar slots" —
//      naming `of` a structural word beside its three reserved siblings — `spec/tooling.md:30`
//      names `of` among the contextual words that take the `keyword` class in the structural
//      positions it describes, and
//      `spec/grammar.md:380` calls it "the contextual preposition in the heritage
//      `value of … for key` reader". Those passages now match: `spec/grammar.md:234`,
//      `spec/execution-model.md:156-159`, and `spec/commands.md:461` each keep their
//      "after `is`" claim scoped to their own subject and name this reader as `of`'s other
//      structural position (#856), and `spec/grammar.md:380` had already folded its reader
//      parenthetical into the sentence (#875), ending the tension it carried from the spec's
//      initial commit. None of them governs the token-class model that `spec/tooling.md` owns.
//
//      Until #785 `of` alone was `primitive` + `defaultLibrary` — a class `spec/tooling.md:31`
//      scopes to "commands, reporters, and aliases **from the C3 primitive matrix**", which `of` is
//      not in (`corePrimitiveArity("of") === undefined`; `spec/commands.md` has no `of` row), so
//      `defaultLibrary` asserted standard-library membership for a word that has none.
//
//      It is a classification, not a reservation: `of` stays redefinable and an ordinary name
//      outside those two positions (`:of`, `define of`, `{ of: 2 }`), asserted below in both
//      directions and with several roles present in ONE document pinned per occurrence, so a fix
//      cannot mark every `of` wholesale. Recognized by the same `heritageFormRule` gate; because it
//      reads a dict, Heritage depends on Data (`spec/conformance.md#heritage`).
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

/**
 * Every structural word of the `value of … for key` reader (`spec/grammar.md:217`) — all four are
 * `keyword`. `value`/`for`/`key` are reserved words; `of` is the contextual preposition this
 * production recognizes positionally (issue #785).
 */
const VALUE_OF_KEY_WORDS = ["value", "of", "for", "key"];

const HERITAGE_PROFILES = ["core-language", "data", "heritage"];
// The negative (unknown-command) direction is checked with the MINIMAL profile set — pure Core, no
// Data — so a passing negative proves each Heritage spelling is unknown without relying on any other
// profile being present (Data does not change these diagnostics; verified). Heritage-depends-on-Data
// only matters in the positive direction, which uses HERITAGE_PROFILES above.
const CORE_PROFILES = ["core-language"];

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
  // marker, `spec/tooling.md:279`). Assert the class and the absence of the modifier so a form head
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
// Shape 4 — the `value of … for key` reader: all four structural words are keyword (issue #785)
// =================================================================================================

test("highlight: every structural word of the value-of-key reader is a keyword, `of` included", () => {
  // Issue #785. `of` used to be the odd one out — `primitive`, while its three siblings in the SAME
  // production were `keyword`. `spec/tooling.md:31` scopes the *matrix* sense of `primitive` to
  // "aliases from the C3 primitive matrix" and `of` is in no primitive table (it would reach that
  // class only through `:31`'s grammar-safe fallback, which asserts no membership);
  // `spec/tooling.md:97-99` now names this
  // reader alongside the `is`-predicate as a position where these contextual words are `keyword`.
  const source = 'print value of :d for key "a"';
  for (const word of VALUE_OF_KEY_WORDS) {
    assert.equal(
      classOf(source, word),
      "keyword",
      `${word} should highlight as keyword in the value-of-key reader`,
    );
  }
  assert.equal(
    OL.corePrimitiveArity("of"),
    undefined,
    "`of` is in no C3 primitive table, so `primitive` would be only the grammar-safe fallback for it, never a matrix claim",
  );
});

test("highlight: `of` is a keyword in BOTH positions `spec/tooling.md:97-99` names — the reader and an is-predicate", () => {
  // The normative highlighter instruction names exactly these two positions, so they classify
  // identically; a highlighter that marked the same contextual preposition differently per
  // production would contradict that one sentence.
  assert.equal(classOf('print value of :d for key "a"', "of"), "keyword");
  assert.equal(classOf("if :x is member of [1 2] [ ]", "of"), "keyword");
});

test("highlight: `of` outside a reader-recognized position stays an ordinary name, not a keyword", () => {
  // The other direction of `spec/tooling.md:97-99` / `spec/grammar.md:380`: `of` is *contextual*,
  // not reserved, so it remains freely usable as a variable, a procedure name, and a dict key. This
  // is what the reader fix must not break — being `keyword` in one production must not lock the
  // spelling globally the way a reserved word does.
  assert.equal(classOf("local of\n:of = 5\nprint :of", ":of"), ":variable");
  const declared = OL.highlight("define of :x\n print :x\nend\nof 3", doc)
    .filter((t) => t.text === "of")
    .map((t) => t.class);
  assert.deepEqual(declared, ["procedure-name", "procedure-name"]);
  assert.equal(classOf("print { of: 1 }", "of"), "dict-key");
  assert.equal(classOf("print :d[of]", "of"), "dict-key");
});

test("highlight: the reader, is-predicate, procedure, dict-key, and variable roles of `of` are resolved per occurrence within ONE document", () => {
  // Review-gate finding (NON-BLOCKING, rubber-duck): the assertions above use a separate document
  // per role, so an implementation that marked EVERY `of` in any document containing a
  // `ValueOfKeyNode` would survive them. This program gives `of` those five roles at once and pins
  // each occurrence in source order, which is what the by-token-index marking actually guarantees.
  // Binder positions (`local of`, `for of in …`) are deliberately NOT covered: they hit the general
  // unresolved-bare-name fall-through documented at `highlight.ts:26-30`, which is not specific to
  // `of` and is tracked as its own follow-up rather than pinned here.
  const source = [
    "define of :x", //                   1. procedure-name (declaration)
    "  print :x",
    "end",
    "of 1", //                           2. procedure-name (reference)
    ":of = 5", //                        (a `:variable` place, asserted separately below)
    ":d = { of: 2 }", //                 3. dict-key
    'print value of :d for key "of"', // 4. keyword (reader); the quoted "of" is a word literal
    "print 3 is member of [ 3 ]", //     5. keyword (is-predicate)
  ].join("\n");
  const tokens = OL.highlight(source, doc);
  assert.deepEqual(
    tokens.filter((t) => t.text === "of").map((t) => t.class),
    ["procedure-name", "procedure-name", "dict-key", "keyword", "keyword"],
  );
  assert.deepEqual(
    tokens.filter((t) => t.text === ":of").map((t) => t.class),
    [":variable"],
  );
  // The quoted `"of"` key is a word literal, never a structural word (`spec/tooling.md:25-26`:
  // tokens inside closed strings are never classified as keywords).
  const quoted = tokens.find((t) => t.text === '"of"');
  assert.ok(quoted, 'expected the quoted "of" key to be its own token');
  assert.equal(quoted.class, "word/string");
});

test("highlight: the reader's `of` is a keyword in awkward positions — nested, chained, and upper-case", () => {
  // Tokenization is case-insensitive for structural words (`spec/tooling.md:23`), and the reader
  // nests: `value of value of :d for key "a" for key "b"` is two `ValueOfKeyNode`s, so BOTH `of`
  // tokens must resolve — a fix that only handled the first (or only a top-level) occurrence fails
  // here.
  assert.equal(
    classOf('repeat 2 [ print value of :d for key "a" ]', "of"),
    "keyword",
  );
  assert.equal(
    classOf('define f :d\n print value of :d for key "a"\nend', "of"),
    "keyword",
  );
  assert.equal(classOf('print VALUE OF :d FOR KEY "a"', "OF"), "keyword");
  const chained = OL.highlight(
    'print value of value of :d for key "a" for key "b"',
    doc,
  ).filter((t) => t.text === "of");
  assert.equal(chained.length, 2, "a chained reader has two `of` tokens");
  assert.ok(chained.every((t) => t.class === "keyword"));
});

test("highlight: a mid-edit or malformed reader degrades gracefully — `of` falls back, never throws, never marks a wrong token", () => {
  // Review-gate finding (NON-BLOCKING, @testing). `highlight.ts:26-30` makes graceful degradation a
  // contract: "unresolved symbols, mid-edit input, and malformed/unclosed constructs never throw and
  // never misclassify". Every other assertion in this block uses a WELL-FORMED reader, so nothing
  // pinned what happens at `parseValueOfKey`'s four `return undefined` bail-outs, where no
  // `ValueOfKeyNode` is built and the marking path is never reached.
  //
  // This matters beyond tidiness: #830 (the reader is unreachable inside a parenthesized expression)
  // will touch this exact parse path, and a plausible recovery improvement there — returning a
  // PARTIAL `ValueOfKeyNode` for better diagnostics — would change the node's span or its build
  // precondition. Today the only thing between that and marking the wrong token `keyword` is
  // `markContextualWord`'s text guard, which nothing on this path exercises.
  //
  // The fall-back class asserted here is `primitive`, which `spec/tooling.md:31` now makes the
  // normative grammar-safe fallback for a bare name no other row claims. What remains of defect
  // #831 is only that `semanticTokens` adds `defaultLibrary` on top, asserting a matrix membership
  // `:31` explicitly forbids inferring. What this test actually pins — and what must hold under
  // either — is that no
  // `ValueOfKeyNode` means `of` is left to the ordinary fall-back rather than marked `keyword` at a
  // guessed index, and that `highlight()` does not throw.
  const partial = {
    "print value of": ["primitive"], //                     no dictionary expression
    "print value of :d": ["primitive"], //                  no `for`
    "print value of :d for": ["primitive"], //              no `key`
    "print value of :d for key": ["primitive"], //          no key expression
    'print value of :d for key "a': ["primitive"], //       unclosed word literal
    'print value of :d key "a"': ["primitive"], //          `for` missing mid-form
    // The inner reader consumes `for key "a"`, so the outer one runs out of input and bails; the
    // inner node is discarded along with the failed outer parse, leaving ZERO `ValueOfKeyNode`s in
    // the AST (verified) and therefore both `of` tokens on the fall-back path.
    'print value of value of :d for key "a"': ["primitive", "primitive"],
  };
  for (const [source, expected] of Object.entries(partial)) {
    let classes;
    assert.doesNotThrow(
      () => {
        classes = OL.highlight(source, doc)
          .filter((t) => t.text.toLowerCase() === "of")
          .map((t) => t.class);
      },
      `highlight must not throw on ${JSON.stringify(source)}`,
    );
    assert.deepEqual(
      classes,
      expected,
      `${JSON.stringify(source)} builds no ValueOfKeyNode, so its \`of\` falls back rather than being mis-marked`,
    );
  }
  // A COMPLETE reader followed by unrelated junk still parses, so its `of` is still a keyword —
  // degradation is scoped to the reader itself, not to any diagnostic anywhere in the document.
  assert.equal(classOf('print value of :d for key "a" ]', "of"), "keyword");
});

test("semanticTokens: no structural word of the value-of-key reader carries defaultLibrary", () => {
  // `defaultLibrary` asserts standard-library membership (`spec/tooling.md:279`). `of` used to
  // carry it purely because it was classified `primitive`; with the class corrected the modifier
  // goes with it, which is the half of #785 an LSP client actually consumes.
  const tokens = OL.semanticTokens('print value of :d for key "a"', doc);
  for (const word of VALUE_OF_KEY_WORDS) {
    const token = tokens.find((t) => t.text === word);
    assert.ok(token, `expected a semantic token for ${word}`);
    assert.equal(token.class, "keyword", `${word} should be a keyword`);
    assert.deepEqual(
      token.modifiers,
      [],
      `${word} is structural, so it carries no modifier at all`,
    );
  }
});

// =================================================================================================
// A form head is never keyword-locked: it can be a user-declared name where the grammar allows one
// =================================================================================================

test("highlight: a short alias name is never a keyword — it can be redefined as a procedure name", () => {
  // This is a *highlighting* claim only — `highlight()` never calls `check()`. The short aliases are
  // not keywords, so a user procedure literally named `fd` resolves to `procedure-name` at its
  // declaration and call — proving the alias is classified by name/role, not locked to `primitive`
  // the way a keyword is. Declaring `fd` is nonetheless ILLEGAL: since #838 wired
  // `turtlePrimitiveArity` into the declaration-slot rule, the checker raises `ol-reserved-word` on
  // it Core-only (measured; pinned by `heritage/check/heritage-alias-redefinition-rejected-in-core`).
  // What this test pins is token recovery for such a declaration, not its legality.
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
  for (const word of VALUE_OF_KEY_WORDS) {
    const seen = classesOf(word);
    assert.ok(seen.length >= 1, `expected ${word} in the nested program`);
    for (const cls of seen) {
      // Every occurrence, not just one: `includes("keyword")` would let a nested regression on a
      // repeated structural word pass.
      assert.equal(cls, "keyword", `nested ${word} should stay keyword`);
    }
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

test("semanticTokens: no reader word carries defaultLibrary nested in a whole program", () => {
  // The nested counterpart of the #785 LSP assertion above: the reader inside a `to … end`
  // procedure body must not reintroduce the standard-library modifier on any structural word.
  const tokens = OL.semanticTokens(NESTED_HERITAGE_PROGRAM, doc);
  for (const word of VALUE_OF_KEY_WORDS) {
    const matches = tokens.filter((t) => t.text === word);
    assert.ok(
      matches.length >= 1,
      `expected a semantic token for nested ${word}`,
    );
    for (const token of matches) {
      assert.equal(token.class, "keyword", `nested ${word} should be keyword`);
      assert.deepEqual(
        token.modifiers,
        [],
        `nested ${word} should carry no modifier`,
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
