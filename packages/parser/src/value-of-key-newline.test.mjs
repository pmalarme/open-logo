// Guard tests for a newline **inside** the Heritage `value of … for key …` reader (issue #962).
//
// `value-of-reader ::= "value" "of" expression "for" "key" expression` (`spec/grammar.md:219`) is a
// single expression, and `spec/grammar.md:34` says newlines are insignificant inside one. The
// reader nonetheless stopped at the newline before its required `for key` tail, so every spelling
// below raised `ol-bad-token` — and wrapped in parentheses it raised `ol-unmatched-paren` twice
// more, on parentheses that are correctly matched, the phantom-diagnostic class #933 removed for
// arithmetic. `parseValueOfKey` now consults `continuesOnNextLine`, the mechanism the six worded
// and symbolic operators already share.
//
// **Asserting the AST, not the absence of diagnostics, is the point of this file.** Inside a dict
// literal the broken reading was *diagnosed but also silently wrong*: `{ a: value of :d` ⏎
// `for key :k }` raised two `ol-bad-token` describing an incomplete reader, while the tree it
// produced held a single entry keyed `key` whose value was a call to a procedure `k`, with the
// entry `a` gone. No diagnostic said that, so a fix could have removed the two `ol-bad-token`
// while leaving the wrong tree and every diagnostics-only assertion would still have passed.
//
// PR #916 — `test(heritage,grammar): pin the value-of-key reader inside parentheses` — pinned this
// reader in this container and #962 still slipped through, but not because it asserted only
// diagnostics: its header declared newline splitting a general, pre-existing limitation and
// reported it separately. What it did leave behind is that every shape it pinned was single-line,
// so the corpus varied the container and never the newline. Hence the table below is a
// **cross-product**: each newline position appears at the top level *and* inside a dict entry
// value, because a dictionary is the one context where a newline separates entries and a
// continuation can therefore behave differently there. The `for` ⏎ `key` cell of exactly that
// cross-product was a real defect in this fix's first draft, found in review.
//
// **Case is the third axis of that cross-product** and is varied for the same reason. OpenLogo
// keywords are case-insensitive (`spec/grammar.md:13`), so `FOR KEY` must continue across a
// newline exactly as `for key` does — and a continuation that compared surface text instead of
// folding case would break only the uppercase spelling, which every lowercase row leaves
// unasserted. Both halves of the predicate need it: the half that CONTINUES (`for`, `key`) and the
// half that DECLINES (`in`, `from`, which keep a `for key in …` loop intact), so uppercase rows
// appear on both sides below.
//
// Uppercase costs no diagnostic here, but **not** because `style` is off — measured, turning
// `style: true` on changes nothing on these rows. `ol-style-name-case` fires only on the reader's
// head `value`, which is lowercase in every row; `of`/`for`/`key` have no span of their own in the
// AST and so are **not linted at all**, deferred to the #115 follow-up. That is recorded in
// `heritage/style/name-case-uppercase-value-of-key-reader`'s own description, which is where the
// head's lint is pinned.
//
// The two ways a fix of this shape goes wrong get their own tests below: swallowing the following
// statement (`for` is the one continuation word here that can BEGIN a statement) and suppressing
// the real `ol-unmatched-paren` along with the phantom one.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import * as OL from "@openlogo/parser";

const doc = "value-of-key-newline.logo";

/** A dict to read from, and a word to key it with. */
const PRELUDE = ':d = { a: 7 b: "a" }\n:k = "a"\n';

/**
 * `source`'s AST with every `source_span` removed. Spans are exactly what a newline is *allowed*
 * to change — the two-line spelling genuinely does span two lines — so comparing two spellings
 * means comparing the tree shape that survives that difference.
 */
function shape(source) {
  return JSON.stringify(OL.parse(source, doc).ast, (key, value) =>
    key === "source_span" ? undefined : value,
  );
}

/** Parse diagnostics plus the semantic ones `check()` finds under Core + Data + Heritage. */
function allDiagnostics(source) {
  const { ast, diagnostics } = OL.parse(source, doc);
  const checked = OL.check(ast, {
    profiles: ["core-language", "data", "heritage"],
    source,
  });
  return [...diagnostics, ...checked.diagnostics];
}

/** The `ol-*` codes `source` produces, in order. */
function codesOf(source) {
  return allDiagnostics(source).map((diagnostic) => diagnostic.code);
}

/**
 * Every container the issue measured, each as `[one-line spelling, newline spelling]`. The
 * one-line member is the CONTROL — it was clean before the fix — and is also the expected reading
 * of its partner, so one table drives both halves of acceptance criterion 1.
 */
const SPELLINGS = [
  [
    "bare reader",
    "print value of :d for key :k",
    "print value of :d\nfor key :k",
  ],
  [
    "parenthesized",
    "print (value of :d for key :k)",
    "print (value of :d\nfor key :k)",
  ],
  [
    "list literal",
    "print [value of :d for key :k]",
    "print [value of :d\nfor key :k]",
  ],
  [
    "dict entry value",
    "print { a: value of :d for key :k }",
    "print { a: value of :d\nfor key :k }",
  ],
  [
    "newline after `of`",
    "print value of :d for key :k",
    "print value of\n:d for key :k",
  ],
  [
    "newline between `for` and `key`",
    "print value of :d for key :k",
    "print value of :d for\nkey :k",
  ],
  [
    "newline after `key`",
    "print value of :d for key :k",
    "print value of :d for key\n:k",
  ],
  [
    "newline after `of`, in a dict entry value",
    "print { a: value of :d for key :k }",
    "print { a: value of\n:d for key :k }",
  ],
  [
    "newline between `for` and `key`, in a dict entry value",
    "print { a: value of :d for key :k }",
    "print { a: value of :d for\nkey :k }",
  ],
  [
    "newline after `key`, in a dict entry value",
    "print { a: value of :d for key :k }",
    "print { a: value of :d for key\n:k }",
  ],
  [
    "a newline on BOTH sides of `for`",
    "print value of :d for key :k",
    "print value of :d\nfor\nkey :k",
  ],
  [
    "a newline on both sides of `for`, in a dict entry value",
    "print { a: value of :d for key :k }",
    "print { a: value of :d\nfor\nkey :k }",
  ],
  [
    "an UPPERCASE tail across the newline",
    "print value of :d FOR KEY :k",
    "print value of :d\nFOR KEY :k",
  ],
  [
    "a MiXeD-case tail across the newline",
    "print value of :d For Key :k",
    "print value of :d\nFor Key :k",
  ],
  [
    "a mixed-case tail, in a dict entry value",
    "print { a: value of :d FOR key :k }",
    "print { a: value of :d\nFOR key :k }",
  ],
  [
    "blank lines and a comment inside the reader",
    "print value of :d for key :k",
    "print value of :d\n\n# a comment\n\nfor key :k",
  ],
  [
    "nested reader, both split",
    'print value of (value of { inner: :d } for key "inner") for key "a"',
    'print value of (value of { inner: :d }\nfor key "inner")\nfor key "a"',
  ],
];

test("a newline inside the reader is diagnosed neither at parse nor at check", () => {
  for (const [label, , split] of SPELLINGS) {
    assert.deepEqual(
      allDiagnostics(`${PRELUDE}${split}\n`),
      [],
      `${label}: the newline spelling was diagnosed`,
    );
  }
});

test("the one-line spellings stay clean", () => {
  // Controls. They were clean before the fix; a regression here would mean the continuation logic
  // broke the shape it was meant to preserve.
  for (const [label, oneLine] of SPELLINGS) {
    assert.deepEqual(
      allDiagnostics(`${PRELUDE}${oneLine}\n`),
      [],
      `${label}: the one-line control was diagnosed`,
    );
  }
});

test("a newline inside the reader produces the AST of its one-line spelling", () => {
  // The load-bearing assertion (issue #962's criterion 1). The `dict entry value` rows are the
  // ones that make it necessary: their broken reading raised `ol-bad-token` about an incomplete
  // reader while ALSO building the wrong tree, and only the tree tells that second half apart.
  for (const [label, oneLine, split] of SPELLINGS) {
    assert.equal(
      shape(`${PRELUDE}${split}\n`),
      shape(`${PRELUDE}${oneLine}\n`),
      `${label}: the newline spelling parsed to a different tree`,
    );
  }
});

test("the dict entry keeps its own key instead of gaining one named `key`", () => {
  // Names the exact misreading rather than trusting the tree comparison above to have covered it:
  // under the defect this dict held ONE entry, keyed `key`, and `a` had disappeared. The two
  // `ol-bad-token` the defect also raised described an incomplete reader, never this — which is
  // why the tree, not the diagnostics, is what this test looks at.
  const { ast } = OL.parse(
    `${PRELUDE}print { a: value of :d\nfor key :k }\n`,
    doc,
  );
  const dicts = [];
  OL.walk(ast, (node) => {
    if (node.kind === "DictLit") {
      dicts.push(node);
    }
  });
  const printed = dicts.at(-1);
  assert.equal(printed.entries.length, 1);
  assert.equal(printed.entries[0].key.value, "a");
  assert.equal(printed.entries[0].value.kind, "ValueOfKey");
});

test("no `ol-unmatched-paren` is raised on parentheses that are matched", () => {
  // Criterion 2, asserted by CODE rather than by overall cleanliness, so this test keeps failing
  // for the right reason if some unrelated diagnostic ever appears on the same source.
  const codes = codesOf(`${PRELUDE}print (value of :d\nfor key :k)\n`);
  assert.deepEqual(codes.includes("ol-unmatched-paren"), false);
  assert.deepEqual(codes, []);
});

test("a genuinely unmatched paren is still reported, exactly once", () => {
  // The other direction of criterion 2, and the reason it is stated separately: a "fix" that
  // suppressed `ol-unmatched-paren` would satisfy the test above and destroy error reporting.
  // Both spellings are pinned — the newline one is the shape the fix now carries the parse
  // through, the one-line one was already correct and must stay so.
  for (const source of [
    "print (value of :d for key :k",
    "print (value of :d\nfor key :k",
  ]) {
    assert.deepEqual(
      codesOf(`${PRELUDE}${source}\n`).filter(
        (code) => code === "ol-unmatched-paren",
      ),
      ["ol-unmatched-paren"],
      `expected exactly one ol-unmatched-paren for \`${source}\``,
    );
    const unmatched = allDiagnostics(`${PRELUDE}${source}\n`).filter(
      (diagnostic) => diagnostic.code === "ol-unmatched-paren",
    );
    assert.equal(unmatched[0].params.delimiter, "(");
    assert.equal(unmatched[0].stage, "parse");
    assert.deepEqual(unmatched[0].source_span.start, [3, 7]);
    assert.deepEqual(unmatched[0].source_span.end, [3, 8]);
  }
});

test("a newline still terminates a statement", () => {
  // The failure mode a newline-skipping fix invites, and the worse one: silently changing programs
  // that are correct today.
  const { ast, diagnostics } = OL.parse("print 1\nprint 2\n", doc);
  assert.deepEqual(diagnostics, []);
  assert.equal(ast.body.length, 2);

  // The reader's own statement boundary: once the tail is read, the next line is its own statement.
  const after = OL.parse(
    `${PRELUDE}print value of :d\nfor key :k\nprint 2\n`,
    doc,
  );
  assert.deepEqual(after.diagnostics, []);
  assert.deepEqual(
    after.ast.body.map((statement) => statement.kind),
    ["Assign", "Assign", "Call", "Call"],
  );

  // And an INCOMPLETE reader releases the newline rather than reaching across it: the continuation
  // is refused outright when what follows is not this reader's tail, so `print 2` is still read as
  // its own statement and the only complaint is the reader's own.
  const incomplete = OL.parse(`${PRELUDE}print value of :d\nprint 2\n`, doc);
  assert.deepEqual(
    incomplete.ast.body.map((statement) => statement.kind),
    ["Assign", "Assign", "Call", "Call"],
  );
  assert.deepEqual(
    incomplete.diagnostics.map((diagnostic) => diagnostic.code),
    ["ol-bad-token"],
  );
  assert.equal(incomplete.diagnostics[0].params.text, "end of line");
});

test("an incomplete reader does not swallow the `for` statement on the next line", () => {
  // `for` is the one word this reader crosses a newline for that can also BEGIN a statement
  // (`for-in-statement`/`for-range-statement`, `spec/grammar.md:130-131`). The newline is therefore
  // only crossed when the whole two-word `for key` tail follows it AND `key` is not the loop's own
  // binder. Without those guards the loops below would be consumed into the broken reader's error
  // recovery and vanish from the tree — and this program is already invalid, which is exactly why
  // nothing else would notice.
  //
  // The `key`-binder rows are the ones the two-word guard alone gets wrong: a `binder` is a `name`
  // (`spec/grammar.md:139`) and a reserved keyword is legal in that slot (`:388`), so `key` is a
  // legal binder and `for key in …` satisfies "the tail is there" while being a loop. Only the word
  // after `key` tells them apart.
  for (const [loop, kind] of [
    ["for i in [ 1 2 ] [ print :i ]", "ForIn"],
    ["for i from 1 to 3 [ print :i ]", "ForRange"],
    ["for key in [ 1 2 ] [ print :key ]", "ForIn"],
    ["for key from 1 to 3 [ print :key ]", "ForRange"],
    // The exclusion words are matched case-insensitively too, and by a comparison of their own:
    // making only `in`/`from` case-sensitive would leave every `FOR`/`KEY` row above green while
    // swallowing these loops.
    ["for key IN [ 1 2 ] [ print :key ]", "ForIn"],
    ["for key FROM 1 to 3 [ print :key ]", "ForRange"],
    ["FOR KEY In [ 1 2 ] [ print :key ]", "ForIn"],
    // Defensive controls, not discriminating rows. `isKeywordToken` folds case, so an uppercase
    // `FOR` matches the first half of condition 1 — but the same condition's required-`key`
    // lookahead then fails, because `i` is not `key`, so the predicate declines there and
    // condition 2's `in`/`from` guard is never reached. The decline therefore happens *before*
    // case can matter anywhere else, and these two rows behave exactly as their lowercase twins do
    // under every mutation of this predicate. Making the `for` lookup case-sensitive is caught
    // loudly elsewhere: by the diagnostics test and the AST-equality test over `SPELLINGS`, whose
    // `FOR KEY` rows do reach the comparison. These are here because an uppercase `for` on a line
    // the reader must DECLINE is cheap to state and would otherwise be asserted nowhere at all.
    ["FOR i in [ 1 2 ] [ print :i ]", "ForIn"],
    ["FOR i FROM 1 to 3 [ print :i ]", "ForRange"],
  ]) {
    const { ast, diagnostics } = OL.parse(
      `${PRELUDE}print value of :d\n${loop}\n`,
      doc,
    );
    assert.equal(
      ast.body.at(-1).kind,
      kind,
      `\`${loop}\` was swallowed by the incomplete reader`,
    );
    assert.equal(
      diagnostics.filter((diagnostic) => diagnostic.code === "ol-bad-token")
        .length,
      1,
      `\`${loop}\`: expected the single ol-bad-token for the incomplete reader`,
    );
  }
});

test("the newline is not crossed for a `for` that is not this reader's tail", () => {
  // The two-word lookahead in isolation. Relying only on the binder guard would leave every
  // malformed `for …` line pulled into the reader: the diagnostic would then name a token from
  // line two (`zzz`) and the line would contribute an extra statement, instead of the reader
  // stopping at the newline and the line being read on its own terms. Anchoring on "end of line"
  // is the observable form of "the reader did not reach past the newline".
  for (const line of ["for zzz :k", "for keys :k", "for 1 2"]) {
    const { diagnostics } = OL.parse(
      `${PRELUDE}print value of :d\n${line}\n`,
      doc,
    );
    assert.equal(diagnostics[0].code, "ol-bad-token");
    assert.equal(
      diagnostics[0].params.text,
      "end of line",
      `\`${line}\`: the reader reached past the newline`,
    );
  }
});

test("a completed reader still lets a `for key …` loop follow it", () => {
  // The other side of the binder guard: declining to continue must not cost the reader its own
  // tail when the tail really is there. Here the reader is complete on line one and the loop on
  // line two binds `key`, so both must survive, clean.
  const source = `${PRELUDE}print value of :d for key :k\nfor key in [ 1 2 ] [ print :key ]\n`;
  assert.deepEqual(allDiagnostics(source), []);
  assert.deepEqual(
    OL.parse(source, doc).ast.body.map((statement) => statement.kind),
    ["Assign", "Assign", "Call", "ForIn"],
  );
});

test("a missing operand at end of input is still reported", () => {
  // Skipping the newline before a pending piece of the reader moves the diagnostic's anchor from
  // the newline ("end of line") to what follows it — here end of input. That drift is inherent to
  // `skipNewlinesBeforeOperand` and is shared with every operator that already uses it, so it is
  // pinned as intended behaviour rather than left to be rediscovered: what must not change is that
  // the error is still REPORTED, once, with the same code.
  for (const source of [
    "print value of\n",
    "print value of :d for key\n",
    "print value of :d for\n",
  ]) {
    const badTokens = allDiagnostics(`${PRELUDE}${source}`).filter(
      (diagnostic) => diagnostic.code === "ol-bad-token",
    );
    assert.equal(
      badTokens.length,
      1,
      `expected one ol-bad-token for \`${source}\``,
    );
    assert.equal(badTokens[0].params.text, "end of file");
    assert.equal(badTokens[0].stage, "parse");
  }
});

test("the swallow fixture's prose counts match its measured diagnostics", () => {
  // Three separate review rounds caught a hand-written count in that fixture going stale after a
  // row was added to it — the same "asserted, never measured" failure the fixture corpus exists to
  // prevent, committed in the prose of a fixture about measuring. The numbers are derivable, so
  // this derives them: any future row makes the prose and the JSON disagree, loudly, here. The
  // `.logo`'s comment block is unwrapped to one line first, because its sentences wrap across `#`
  // prefixes and a claim split mid-phrase would otherwise be matched only by luck.
  const base = new URL(
    "../../../tests/conformance/heritage/check/heritage-value-of-key-newline-does-not-swallow-the-next-statement",
    import.meta.url,
  ).href;
  const fixture = JSON.parse(
    readFileSync(new URL(`${base}.expected.json`), "utf8"),
  );
  const logo = readFileSync(new URL(`${base}.logo`), "utf8").replace(
    /\r?\n#[ \t]?/g,
    " ",
  );

  const total = fixture.diagnostics.length;
  const readers = fixture.diagnostics.filter(
    (diagnostic) => diagnostic.params.text === "end of line",
  ).length;
  const extra = fixture.diagnostics.findIndex(
    (diagnostic) => diagnostic.params.text === "1",
  );

  const NUMBER_WORDS = [
    "zero",
    "one",
    "two",
    "three",
    "four",
    "five",
    "six",
    "seven",
    "eight",
    "nine",
    "ten",
    "eleven",
    "twelve",
  ];
  const ORDINAL_WORDS = [
    "zeroth",
    "first",
    "second",
    "third",
    "fourth",
    "fifth",
    "sixth",
    "seventh",
    "eighth",
    "ninth",
    "tenth",
    "eleventh",
    "twelfth",
  ];

  assert.equal(
    logo.match(/all (\w+) diagnostics below are identical/)[1],
    NUMBER_WORDS[total],
    "the .logo header's total is stale",
  );
  const readerClaim = logo.match(/(\w+) readers means (\w+) such/);
  assert.equal(
    readerClaim[1].toLowerCase(),
    NUMBER_WORDS[readers],
    "the .logo header's reader count is stale",
  );
  assert.equal(readerClaim[2], NUMBER_WORDS[readers]);
  const extraClaim = logo.match(
    /on `1` — (\w+) of the (\w+) in document order/,
  );
  assert.equal(
    extraClaim[1],
    ORDINAL_WORDS[extra + 1],
    "the .logo header gives the extra diagnostic the wrong position",
  );
  assert.equal(
    extraClaim[2],
    NUMBER_WORDS[total],
    "the .logo header's total beside the extra diagnostic is stale",
  );

  assert.equal(
    Number(
      fixture.description.match(/all (\d+) diagnostics below are identical/)[1],
    ),
    total,
    "the description's total is stale",
  );
  const positionClaim = fixture.description.match(
    /on `1` at \[(\d+),(\d+)\] -- (\w+) of the (\d+)/,
  );
  assert.deepEqual(
    [Number(positionClaim[1]), Number(positionClaim[2])],
    fixture.diagnostics[extra].source_span.start,
    "the description cites a stale span for the extra diagnostic",
  );
  assert.equal(positionClaim[3], ORDINAL_WORDS[extra + 1]);
  assert.equal(Number(positionClaim[4]), total);
});

test("`for` and `key` remain usable as dictionary keys across a newline", () => {
  // A defensive control, not an exercise of any guard: on this source no continuation predicate
  // ever matches (the reader is not involved at all), so it passes before the fix and survives
  // every mutation of it. It is here because `for` and `key` being ordinary keys — legal data, not
  // declarations — is the property a careless continuation would break. Two passages carry that,
  // and both are cited because reviewers have twice disagreed about which one does:
  // `spec/grammar.md:392` is the precise one for KEYWORDS ("The positions that name data … admit
  // keywords freely: a plain `name`, … a `key-term`, a `dict-key` …"), and `:408` states the
  // property in the words used here ("Dictionary keys and selector bare keys are data, not
  // declarations, so built-in names are legal keys") — which reaches `for`/`key` because
  // `spec/built-in-names.json` lists both as `category: "keyword"`, and that file is the
  // authoritative list of every keyword and every primitive.
  const source = `${PRELUDE}:m = { a: 1\nkey: 2\nfor: 3 }\nprint :m.key\nprint :m.for\n`;
  assert.deepEqual(allDiagnostics(source), []);
  const { ast } = OL.parse(source, doc);
  const dict = ast.body[2].value;
  assert.deepEqual(
    dict.entries.map((entry) => entry.key.value),
    ["a", "key", "for"],
  );
});

test("a dict entry after a multi-line reader is still its own entry", () => {
  // The reader consuming the newline must not consume the entry separator that follows its tail.
  const source = `${PRELUDE}print { a: value of :d\nfor key :k\nb: 2 }\n`;
  assert.deepEqual(allDiagnostics(source), []);
  assert.equal(
    shape(source),
    shape(`${PRELUDE}print { a: value of :d for key :k b: 2 }\n`),
  );
});
