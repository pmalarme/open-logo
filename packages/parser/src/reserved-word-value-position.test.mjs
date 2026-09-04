// Guard tests for keywords in **expression position** (issue #853). A keyword is "a word the
// grammar itself gives meaning to rather than a name a program can introduce"
// (`spec/grammar.md:360`) — so, apart from the handful the `expression`
// production itself admits (`spec/grammar.md:195-208`), none of them may be read as a bare call.
//
// The bug this file locks shut: `repeat value [ ]` and `repeat key [ ]` — plus the Data mutation
// heads `add`/`remove`/`insert`/`clear` — were lowered into a zero-argument `Call` node that no
// checker rule flagged, so they parsed AND checked completely clean under every profile set. That
// is the "silent no-op" class (saga #811): the program does something other than what was written
// and nothing says so. `parser.ts` now derives its non-expression-head set from `OL_KEYWORDS`, so
// the sweeps below also fail if a future slice adds a keyword without deciding, deliberately, which
// side of the line it falls on.
//
// Issue #837 is the first live test of that property, and it held. Adding `mod` to the registry
// pulled it into the derived set automatically, which let #853's one hand-kept exception — `mod`,
// carried explicitly because it was the reader-structural word missing from the registry, filed as
// #868 — be deleted with no behaviour change. The sweeps below now cover `mod` for free, and the
// set has no hand-maintained exceptions left.
//
// **Scope: the global Core registry only.** `OL_PROFILE_KEYWORDS` (`ask`/`each`/`tell` and the
// four event block-heads) is out of scope here and still reads clean in value position — the reader
// is profile-blind by design, so rejecting those belongs to the profile-aware checker, not to this
// set. Tracked as issue #864.

import assert from "node:assert/strict";
import { test } from "node:test";
import * as OL from "@openlogo/parser";

const doc = "reserved-word-value-position.logo";

/**
 * The keywords the `expression` production genuinely admits, and therefore the only ones a
 * sweep must exempt: `true`/`false` are the `boolean-literal` production (`spec/grammar.md:208`),
 * `map`/`filter`/`reduce` open a `comprehension` (`spec/grammar.md:134-137`), and `thing` is the one
 * keyword that is also a Core primitive reporter, so it is a real `fixed-call` callee.
 */
const EXPRESSION_INITIAL = new Set([
  "true",
  "false",
  "map",
  "filter",
  "reduce",
  "thing",
]);

/** The keywords that parse to a value with no complaint at all — the boolean literals. */
const READS_CLEAN = new Set(["true", "false"]);

/** The six words issue #853 found silently accepted. */
const REGRESSION_WORDS = ["value", "key", "add", "remove", "insert", "clear"];

/** Every `Call`/`ParenCall` callee name in `program`, lowercased, in walk order. */
function calleeNames(program) {
  const names = [];
  OL.walk(program, (node) => {
    if (node.kind === "Call" || node.kind === "ParenCall") {
      names.push(node.callee.name.toLowerCase());
    }
  });
  return names;
}

/**
 * Every `ParenCall` callee name in `program`, lowercased. Deliberately narrower than
 * {@link calleeNames}: `( not 1 )` is a *grouped unary* that reads as a plain `Call`, not a
 * `parenthesized-call`, so conflating the two node kinds would hide a regression that made `not` a
 * genuine `callable-name`.
 */
function parenCallCalleeNames(program) {
  const names = [];
  OL.walk(program, (node) => {
    if (node.kind === "ParenCall") {
      names.push(node.callee.name.toLowerCase());
    }
  });
  return names;
}

/** Parse diagnostics plus the semantic/style ones `check()` finds under every profile. */
function allDiagnostics(source) {
  const { ast, diagnostics } = OL.parse(source, doc);
  const checked = OL.check(ast, {
    profiles: [...OL.OL_CHECK_PROFILES],
    source,
  });
  return [...diagnostics, ...checked.diagnostics];
}

test("no keyword except `thing` is ever lowered into a bare call", () => {
  for (const word of OL.OL_KEYWORDS) {
    const { ast } = OL.parse(`:x = ${word}\n`, doc);
    const unexpected = calleeNames(ast).filter((name) => name === word);
    assert.deepEqual(
      unexpected,
      word === "thing" ? ["thing"] : [],
      `\`:x = ${word}\` lowered the keyword into a Call node`,
    );
  }
});

test("every keyword without an expression-head role is diagnosed in value position", () => {
  for (const word of OL.OL_KEYWORDS) {
    if (word === "thing") {
      // The one keyword that is a real callable: a bare `thing` is diagnosed for its missing
      // input, not for its position, so it gets the dedicated test below instead.
      continue;
    }
    const diagnostics = allDiagnostics(`:x = ${word}\n`);
    if (READS_CLEAN.has(word)) {
      assert.deepEqual(
        diagnostics,
        [],
        `\`:x = ${word}\` is a legal value and must not be diagnosed`,
      );
      continue;
    }
    assert.equal(
      diagnostics.length > 0,
      true,
      `\`:x = ${word}\` was silently accepted`,
    );
  }
});

test("`thing` — the one keyword that is also a Core primitive — still reads as a call", () => {
  assert.deepEqual(allDiagnostics(':n = 1\n:x = thing "n"\n'), []);
});

test("a keyword with no expression-head role reports ol-bad-token naming it", () => {
  for (const word of OL.OL_KEYWORDS) {
    if (EXPRESSION_INITIAL.has(word) || word === "not") {
      // `not` is consumed as the prefix operator (`spec/grammar.md:193`) before the reader reaches
      // a primary, so its diagnostic names the missing operand rather than `not` itself.
      continue;
    }
    const texts = allDiagnostics(`:x = ${word}\n`)
      .filter((diagnostic) => diagnostic.code === "ol-bad-token")
      .map((diagnostic) => diagnostic.params.text);
    assert.equal(
      texts.includes(word),
      true,
      `\`:x = ${word}\` reported ${JSON.stringify(texts)} instead of naming ${word}`,
    );
  }
});

test("the six silently-accepted words are rejected in the issue's own `repeat` position", () => {
  for (const word of REGRESSION_WORDS) {
    const diagnostics = allDiagnostics(`repeat ${word} [ ]\n`);
    const badTokens = diagnostics.filter(
      (diagnostic) => diagnostic.code === "ol-bad-token",
    );
    assert.equal(
      badTokens.some((diagnostic) => diagnostic.params.text === word),
      true,
      `\`repeat ${word} [ ]\` produced ${JSON.stringify(diagnostics.map((d) => d.code))}`,
    );
  }
});

test("no keyword except `thing`, `and`, and `or` is a parenthesized-call callee", () => {
  // `parenthesized-call ::= "(" callable-name { expression } ")"` (`spec/grammar.md:217`). Three
  // keywords legitimately reach a `ParenCall` callee, by two different routes:
  //
  // - `thing` — the only one that passes `isCalleeName`, because it is the one keyword that is
  //   also a real Core primitive and so a genuine `callable-name`. This is the sweep that stops
  //   `isCalleeName` drifting from the primary reader's sets, the failure mode issue #853 fixed one
  //   layer up.
  // - `and`/`or` — `isCalleeName` returns FALSE for both (they are in `NON_PRIMARY_NAMES`); they are
  //   rescued by an explicit disjunct in `parseParenthesized`, because their variadic paren form is
  //   normative: "`(and …)` for multiple operands" (`spec/commands.md:588`, `:607`) with
  //   short-circuit semantics (`spec/execution-model.md:143`).
  //
  // `not` is deliberately absent: it never reaches this position at all — see the next test.
  const VARIADIC_OPERATOR_CALLEES = new Set(["and", "or"]);

  for (const word of OL.OL_KEYWORDS) {
    const { ast } = OL.parse(`print ( ${word} 1 )\n`, doc);
    const kept = parenCallCalleeNames(ast).filter((name) => name === word);
    const allowed = word === "thing" || VARIADIC_OPERATOR_CALLEES.has(word);
    assert.deepEqual(
      kept,
      allowed ? [word] : [],
      `\`( ${word} 1 )\` treated the keyword as a callable-name`,
    );
  }
});

test("`( not 1 )` stays a grouped unary, never a parenthesized call", () => {
  // `unary ::= "not" unary` (`spec/grammar.md:193`) inside a `parenthesized-expression`
  // (`spec/grammar.md:215`) — parenthesising groups the unary expression, it does not make `not` a
  // `callable-name`, and unlike `and`/`or` the spec gives `not` no paren form at all
  // (`spec/commands.md:626-628`: "Signature: `not boolean`", "Kind: Reporter unary prefix").
  // Asserted separately so the sweep above cannot pass by conflating the two node kinds.
  const { ast } = OL.parse("print ( not true )\n", doc);

  assert.deepEqual(parenCallCalleeNames(ast), []);
  // Order-dependent on `walk`'s pre-order traversal, deliberately: the point is that `not` survives
  // as an ordinary `Call` *nested inside* `print`'s argument, which the sequence shows and a set
  // comparison would not.
  assert.deepEqual(calleeNames(ast), ["print", "not"]);
});

test("the Heritage `value of … for key …` reader still parses", () => {
  const { ast, diagnostics } = OL.parse(
    'print value of :ages for key "tom"',
    doc,
  );

  assert.deepEqual(diagnostics, []);
  assert.equal(ast.body[0].args[0].kind, "ValueOfKey");
});

test("the Data mutation statement heads still parse as statements", () => {
  const sources = [
    "add 1 to :nums",
    "remove 1 from :nums",
    'remove key "tom" from :ages',
    "insert 1 in :nums at 2",
    "clear :nums",
  ];

  for (const source of sources) {
    assert.deepEqual(
      OL.parse(source, doc).diagnostics,
      [],
      `\`${source}\` must still read as a statement`,
    );
  }
});

test("keywords are still legal data — dict keys, fields, and bare selector keys", () => {
  // "Dictionary keys and selector bare keys are data, not declarations, so built-in names are legal
  // keys" (`spec/grammar.md:408`). `[key]` is the BARE `identifier` alternative of `key-term`
  // (`spec/grammar.md:114`) — the case that actually routes through `parseKeyTerm`'s `name` branch,
  // which a quoted `["key"]` word literal would not exercise.
  const sources = [
    ":settings = { key: 1 value: 2 }",
    "print :settings.value",
    "print :settings[key]",
    "print :settings[value]",
    "struct point [ value key ]",
  ];

  for (const source of sources) {
    assert.deepEqual(
      OL.parse(source, doc).diagnostics,
      [],
      `\`${source}\` uses a keyword as data, which stays legal (spec/grammar.md:408)`,
    );
  }
});

test("a keyword as a bare place still parses, and binding it is legal", () => {
  // `set value to 1` is a BINDING, not data: `bare-place` reads a raw `name` token, so the reader
  // is unaffected by the expression-position guard. This test asserted the checker REJECTED that
  // binding when #853 landed, which was true then; maintainer ruling #833 (spec merged in #875,
  // implemented for the parser by #837) reverses it. `spec/grammar.md:388` now makes accepting any
  // name in a binding position a normative MUST — "An implementation MUST NOT raise
  // `ol-reserved-word` — or any other diagnostic — for the name alone in any of those positions, at
  // any stage" — and enforcement moved to the four declaration slots, which `bare-place` is not
  // (`spec/grammar.md:384`). So both halves are clean, and the reader half is unchanged either way.
  assert.deepEqual(OL.parse("set value to 1", doc).diagnostics, []);
  assert.deepEqual(allDiagnostics("set value to 1\n"), []);
  // The contrast that keeps this test honest: the same word in a DECLARATION slot still raises.
  assert.deepEqual(
    allDiagnostics("define value\nend\n").map((diagnostic) => diagnostic.code),
    ["ol-reserved-word"],
  );
});
