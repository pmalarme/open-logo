// Guard tests for reserved words in **expression position** (issue #853). "Reserved words are
// structural tokens recognized by the reader" (`spec/grammar.md:367`) and can never be bound as a
// primitive, procedure, or struct constructor — so, apart from the handful the `expression`
// production itself admits (`spec/grammar.md:190-202`), none of them may be read as a bare call.
//
// The bug this file locks shut: `repeat value [ ]` and `repeat key [ ]` — plus the Data mutation
// heads `add`/`remove`/`insert`/`clear` — were lowered into a zero-argument `Call` node that no
// checker rule flagged, so they parsed AND checked completely clean under every profile set. That
// is the "silent no-op" class (saga #811): the program does something other than what was written
// and nothing says so. `parser.ts` now derives its non-expression-head set from
// `OL_RESERVED_WORDS`, so the sweeps below also fail if a future slice adds a reserved word without
// deciding, deliberately, which side of the line it falls on.
//
// **Scope: the global Core registry only.** `OL_PROFILE_RESERVED_WORDS` (`ask`/`each`/`tell` and the
// four event block-heads) is out of scope here and still reads clean in value position — the reader
// is profile-blind by design, so rejecting those belongs to the profile-aware checker, not to this
// set. Tracked as issue #864.

import assert from "node:assert/strict";
import { test } from "node:test";
import * as OL from "@openlogo/parser";

const doc = "reserved-word-value-position.logo";

/**
 * The reserved words the `expression` production genuinely admits, and therefore the only ones a
 * sweep must exempt: `true`/`false` are the `boolean-literal` production (`spec/grammar.md:202`),
 * `map`/`filter`/`reduce` open a `comprehension` (`spec/grammar.md:200`), and `thing` is the one
 * reserved word that is also a Core primitive reporter, so it is a real `fixed-call` callee.
 */
const EXPRESSION_INITIAL = new Set([
  "true",
  "false",
  "map",
  "filter",
  "reduce",
  "thing",
]);

/** The reserved words that parse to a value with no complaint at all — the boolean literals. */
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

/** Parse diagnostics plus the semantic/style ones `check()` finds under every profile. */
function allDiagnostics(source) {
  const { ast, diagnostics } = OL.parse(source, doc);
  const checked = OL.check(ast, {
    profiles: [...OL.OL_CHECK_PROFILES],
    source,
  });
  return [...diagnostics, ...checked.diagnostics];
}

test("no reserved word except `thing` is ever lowered into a bare call", () => {
  for (const word of OL.OL_RESERVED_WORDS) {
    const { ast } = OL.parse(`:x = ${word}\n`, doc);
    const unexpected = calleeNames(ast).filter((name) => name === word);
    assert.deepEqual(
      unexpected,
      word === "thing" ? ["thing"] : [],
      `\`:x = ${word}\` lowered the reserved word into a Call node`,
    );
  }
});

test("every reserved word without an expression-head role is diagnosed in value position", () => {
  for (const word of OL.OL_RESERVED_WORDS) {
    if (word === "thing") {
      // The one reserved word that is a real callable: a bare `thing` is diagnosed for its missing
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

test("`thing` — the one reserved word that is also a Core primitive — still reads as a call", () => {
  assert.deepEqual(allDiagnostics(':n = 1\n:x = thing "n"\n'), []);
});

test("a reserved word with no expression-head role reports ol-bad-token naming it", () => {
  for (const word of OL.OL_RESERVED_WORDS) {
    if (EXPRESSION_INITIAL.has(word) || word === "not") {
      // `not` is consumed as the prefix operator (`spec/grammar.md:219`) before the reader reaches
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

test("no reserved word except `thing` and the operator words is a parenthesized-call callee", () => {
  // `parenthesized-call ::= "(" callable-name { expression } ")"` (`spec/grammar.md:211`). The
  // reader gates that position through `isCalleeName`, which derives its answer from the same two
  // sets as the primary reader — so this sweep is what stops the two paths drifting apart, the very
  // failure mode issue #853 fixed one layer up.
  //
  // Four reserved words legitimately reach a callee here. `thing` is a real Core primitive; `and`,
  // `or`, and `not` are the grammar's own operator productions, which the reader lowers to a `Call`
  // with the operator as callee (`spec/grammar.md:179-186`) and which `checker-unknown-command.ts`
  // treats as always-visible `OPERATOR_CALLEES`. `( and :a :b :c )` is the spec's variadic form.
  const OPERATOR_CALLEES = new Set(["and", "or", "not"]);

  for (const word of OL.OL_RESERVED_WORDS) {
    const { ast } = OL.parse(`print ( ${word} 1 )\n`, doc);
    const kept = calleeNames(ast).filter((name) => name === word);
    const allowed = word === "thing" || OPERATOR_CALLEES.has(word);
    assert.deepEqual(
      kept,
      allowed ? [word] : [],
      `\`( ${word} 1 )\` treated the reserved word as a callable-name`,
    );
  }
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

test("reserved words are still legal data — dict keys, fields, and bare selector keys", () => {
  // "Dictionary keys and selector bare keys are data, not declarations, so reserved words are legal
  // keys" (`spec/grammar.md:369`). `[key]` is the BARE `identifier` alternative of `key-term`
  // (`spec/grammar.md:111`) — the case that actually routes through `parseKeyTerm`'s `name` branch,
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
      `\`${source}\` uses a reserved word as data, which stays legal (spec/grammar.md:369)`,
    );
  }
});

test("a reserved word as a bare place still parses, and the checker rejects the binding", () => {
  // `set value to 1` is a BINDING, not data: `bare-place` reads a raw `name` token, so the reader
  // is unaffected by the expression-position guard — but binding a reserved word is illegal
  // (`spec/grammar.md:367`), and the semantic layer is what says so.
  assert.deepEqual(OL.parse("set value to 1", doc).diagnostics, []);
  assert.deepEqual(
    allDiagnostics("set value to 1\n").map((diagnostic) => diagnostic.code),
    ["ol-reserved-word"],
  );
});
