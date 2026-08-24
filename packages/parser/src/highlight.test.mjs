// Unit tests for `highlight()` (issues #119 and #120), the grammar-derived syntax-highlighting
// classifier: #119's lexical first pass plus #120's semantic disambiguation pass (procedure-name,
// type-name, field-name). These are the primary proof of behavior for this slice — the
// conformance harness has parse/execute/check modes but not a highlight mode. Coverage mirrors
// spec/tooling.md's normative token-class table (lines 28-44) and delimiter-role table
// (lines 71-81):
//   * every lexical class reachable without symbol discovery: keyword, primitive, number,
//     word/string, :variable, comment, bracket, brace, paren, operator, index/dot, dict-key;
//   * all 5 bracket delimiter roles: list, instruction-block, selector, pattern, field-list;
//   * contextual reserved words in/out of `is`-predicate position (spec/tooling.md:96-99); `of`'s
//     second reader-recognized position, the Heritage `value of … for key` reader
//     (spec/grammar.md:380), is proven in `heritage-tooling.test.mjs` (issue #785);
//   * comment/string atomicity (spec/tooling.md:25-26);
//   * negative-literal-as-number merging vs. genuine binary subtraction; and
//   * the semantic bucket (#120): procedure-name (declaration + resolved calls), type-name
//     (struct declaration + constructor calls), and field-name (field-list declaration + known
//     `.field` access) — plus graceful degradation to `primitive` for unresolved names.
//
// The dict-*literal* half of `dict-key` (`{ key: value }`) is covered alongside the selector
// half (issue #149): both share the identical bare-identifier-vs-quoted-word disambiguation.
//
// The final section pins the `profiles` option's BLAST RADIUS (issues #832, #840): the per-profile
// suites assert that the six profile block-heads plus the Sprites mode-switch command `tell`
// (which takes no block — `spec/tooling.md:30` keeps that distinction) move, while this file
// asserts that a representative corpus of non-profile sources does not.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import * as OL from "@openlogo/parser";

const doc = "highlight.logo";
const span = (start, end) => ({ document: doc, start, end });

/** Project just the fields relevant to the assertion, in source order. */
function classes(source) {
  return OL.highlight(source, doc).map((token) => [
    token.class,
    token.text,
    token.role,
  ]);
}

// Shared, named predicate for spotting bracket-classed tokens. Reused by both a positive
// assertion (roleTokens is non-empty, so this runs) and a negative one (list is empty, so this
// is never invoked there) — keeping the negative call site callback-free while still exercising
// the predicate at least once, per the Node 22 coverage-gate convention used across this package.
const isBracketRoleToken = (token) =>
  token.class === "bracket" || token.class === "index/dot";

test("keyword: reserved structural words classify as keyword", () => {
  const tokens = OL.highlight("if :x\n  print 1\nend", doc);
  assert.equal(tokens[0].class, "keyword");
  assert.equal(tokens[0].text, "if");
  assert.equal(tokens.at(-1).class, "keyword");
  assert.equal(tokens.at(-1).text, "end");
});

test("primitive: a core command/reporter name classifies as primitive", () => {
  assert.deepEqual(classes("forward 10"), [
    ["primitive", "forward", undefined],
    ["number", "10", undefined],
  ]);
});

test("number: a plain numeric literal classifies as number", () => {
  assert.deepEqual(classes("print 42"), [
    ["primitive", "print", undefined],
    ["number", "42", undefined],
  ]);
});

test("word/string: a closed double-quoted word literal classifies as word/string, as one token", () => {
  assert.deepEqual(classes('print "hello world"'), [
    ["primitive", "print", undefined],
    ["word/string", '"hello world"', undefined],
  ]);
});

test("word/string: a closed triple-quoted multi-line word literal is one atomic token", () => {
  const tokens = OL.highlight('print """line1\nline2"""', doc);
  assert.equal(tokens.length, 2);
  assert.equal(tokens[1].class, "word/string");
  assert.equal(tokens[1].text, '"""line1\nline2"""');
});

test(":variable: a colon-prefixed read classifies as :variable", () => {
  assert.deepEqual(classes("print :count"), [
    ["primitive", "print", undefined],
    [":variable", ":count", undefined],
  ]);
});

test("comment: a `#` line comment is one atomic comment token", () => {
  const tokens = OL.highlight("print 1 # trailing note\n", doc);
  const comment = tokens.find((token) => token.class === "comment");
  assert.equal(comment.text, "# trailing note");
});

test("comment: a `//` line comment is one atomic comment token", () => {
  const tokens = OL.highlight("print 1 // trailing note\n", doc);
  const comment = tokens.find((token) => token.class === "comment");
  assert.equal(comment.text, "// trailing note");
});

test("comment: a non-nesting `/* ... */` block comment spanning lines is one atomic comment token", () => {
  const tokens = OL.highlight("print 1 /* block\nspans lines */ print 2", doc);
  const comment = tokens.find((token) => token.class === "comment");
  assert.equal(comment.text, "/* block\nspans lines */");
  assert.deepEqual(comment.source_span, span([1, 9], [2, 15]));
});

test("comment: an unterminated block comment does not crash and is still recovered as a comment token", () => {
  const tokens = OL.highlight("print 1 /* oops", doc);
  const comment = tokens.find((token) => token.class === "comment");
  assert.equal(comment.text, "/* oops");
});

test("comment: a comment-only program yields only a comment token, no crash", () => {
  assert.deepEqual(classes("# just a comment"), [
    ["comment", "# just a comment", undefined],
  ]);
});

test("bracket: a list literal's brackets classify as bracket with role list, at both ends of file", () => {
  assert.deepEqual(classes("print [1 2 3]"), [
    ["primitive", "print", undefined],
    ["bracket", "[", "list"],
    ["number", "1", undefined],
    ["number", "2", undefined],
    ["number", "3", undefined],
    ["bracket", "]", "list"],
  ]);
});

test("bracket: a list literal's brackets still resolve when a trailing newline follows", () => {
  const tokens = OL.highlight("print [1 2 3]\n", doc);
  const brackets = tokens.filter((token) => token.class === "bracket");
  assert.equal(brackets.length, 2);
  assert.equal(brackets[0].role, "list");
  assert.equal(brackets[1].role, "list");
});

test("brace: dict-literal braces classify as brace", () => {
  assert.deepEqual(classes("print {a: 1}"), [
    ["primitive", "print", undefined],
    ["brace", "{", undefined],
    ["dict-key", "a", undefined],
    ["operator", ":", undefined],
    ["number", "1", undefined],
    ["brace", "}", undefined],
  ]);
});

test("paren: grouping parens classify as paren", () => {
  assert.deepEqual(classes("print (1 + 2)"), [
    ["primitive", "print", undefined],
    ["paren", "(", undefined],
    ["number", "1", undefined],
    ["operator", "+", undefined],
    ["number", "2", undefined],
    ["paren", ")", undefined],
  ]);
});

test("operator: symbolic arithmetic/comparison/assignment operators classify as operator", () => {
  assert.deepEqual(classes(":x = 1 + 2"), [
    [":variable", ":x", undefined],
    ["operator", "=", undefined],
    ["number", "1", undefined],
    ["operator", "+", undefined],
    ["number", "2", undefined],
  ]);
});

test("operator: word-spelled operators and/or/not/mod classify as operator, never keyword", () => {
  assert.deepEqual(classes("print (1 and 2) or (not 3) mod 4"), [
    ["primitive", "print", undefined],
    ["paren", "(", undefined],
    ["number", "1", undefined],
    ["operator", "and", undefined],
    ["number", "2", undefined],
    ["paren", ")", undefined],
    ["operator", "or", undefined],
    ["paren", "(", undefined],
    ["operator", "not", undefined],
    ["number", "3", undefined],
    ["paren", ")", undefined],
    ["operator", "mod", undefined],
    ["number", "4", undefined],
  ]);
});

test("index/dot: `.` field access punctuation classifies as index/dot", () => {
  assert.deepEqual(classes("print :p.x"), [
    ["primitive", "print", undefined],
    [":variable", ":p", undefined],
    ["index/dot", ".", undefined],
    ["primitive", "x", undefined],
  ]);
});

test("dict-key: a bare selector key classifies as dict-key, distinct from a quoted word key", () => {
  const bare = OL.highlight("print :ages[tom]", doc);
  const bareKey = bare.find((token) => token.text === "tom");
  assert.equal(bareKey.class, "dict-key");

  const quoted = OL.highlight('print :ages["tom"]', doc);
  const quotedKey = quoted.find((token) => token.text === '"tom"');
  assert.equal(quotedKey.class, "word/string");
});

test("dict-key: a reserved word used as a bare selector key is still dict-key, not keyword", () => {
  const tokens = OL.highlight("print :ages[repeat]", doc);
  const key = tokens.find((token) => token.text === "repeat");
  assert.equal(key.class, "dict-key");
});

test("dict-key: a dict-literal's bare key classifies as dict-key, its `:` separator as operator", () => {
  const tokens = OL.highlight("print { field: 6 }", doc);
  const field = tokens.find((token) => token.text === "field");
  assert.equal(field.class, "dict-key");
  const colon = tokens.find((token) => token.text === ":");
  assert.equal(colon.class, "operator");
});

test("dict-key: a dict-literal's number key stays number, not dict-key", () => {
  const tokens = OL.highlight('print { 1: "one" }', doc);
  const numberKey = tokens.find((token) => token.text === "1");
  assert.equal(numberKey.class, "number");
});

// --- Glued dict-entry colon (`{ a:foo }`, issue #149) --------------------------------------
//
// A dict-entry's `:` with no gap before its value's leading identifier lexes as one raw
// `variable`-kind token (the same ambiguity `parser.ts`'s `splitGluedColonToken` resolves for
// parsing). `highlight()` never re-lexes its own copy or shares the parser's internal token
// array, so it must independently split that one raw token back into an `operator` `:` plus
// the value's own class (spec/tooling.md:39,41) rather than emitting a single `:variable` token.

test("dict-key: a glued dict-entry colon splits into operator `:` plus the value's own class", () => {
  assert.deepEqual(classes("print { a:foo }"), [
    ["primitive", "print", undefined],
    ["brace", "{", undefined],
    ["dict-key", "a", undefined],
    ["operator", ":", undefined],
    ["primitive", "foo", undefined],
    ["brace", "}", undefined],
  ]);
});

test("dict-key: a glued dict-entry colon's split operator/name tokens have exact, adjacent spans", () => {
  const tokens = OL.highlight("print { a:foo }", doc);
  const colon = tokens.find((token) => token.text === ":");
  const value = tokens.find((token) => token.text === "foo");
  // "print { a:foo }" — "a" is columns 9-9, ":" is column 10, "foo" is columns 11-13.
  assert.deepEqual(colon.source_span, span([1, 10], [1, 11]));
  assert.deepEqual(value.source_span, span([1, 11], [1, 14]));
});

test("dict-key: a glued dict-entry value that is a reserved word (boolean literal) still splits", () => {
  assert.deepEqual(classes("print { a:true }"), [
    ["primitive", "print", undefined],
    ["brace", "{", undefined],
    ["dict-key", "a", undefined],
    ["operator", ":", undefined],
    ["keyword", "true", undefined],
    ["brace", "}", undefined],
  ]);
});

test("dict-key: a glued dict-entry value resolving to a user-defined procedure classifies procedure-name", () => {
  const source = "define double :n\n  return :n\nend\nprint { a:double 1 }";
  const { diagnostics } = OL.parse(source, doc);
  assert.deepEqual(diagnostics, []);
  const tokens = OL.highlight(source, doc);
  const glued = tokens.find(
    (token) => token.text === "double" && token.class === "procedure-name",
  );
  assert.ok(
    glued,
    "expected the glued dict value to resolve as procedure-name",
  );
});

test("dict-key: a spaced dict-entry colon is unaffected by the glued-colon split logic", () => {
  assert.deepEqual(classes("print { a: foo }"), [
    ["primitive", "print", undefined],
    ["brace", "{", undefined],
    ["dict-key", "a", undefined],
    ["operator", ":", undefined],
    ["primitive", "foo", undefined],
    ["brace", "}", undefined],
  ]);
});

test("dict-key: a glued dict-entry value that is a word-spelled operator classifies operator, not primitive", () => {
  assert.deepEqual(classes("print { a:not true }"), [
    ["primitive", "print", undefined],
    ["brace", "{", undefined],
    ["dict-key", "a", undefined],
    ["operator", ":", undefined],
    ["operator", "not", undefined],
    ["keyword", "true", undefined],
    ["brace", "}", undefined],
  ]);
});

test("dict-key: multiple glued dict entries each split their own colon independently", () => {
  assert.deepEqual(classes("print { a:1 b:2 }"), [
    ["primitive", "print", undefined],
    ["brace", "{", undefined],
    ["dict-key", "a", undefined],
    ["operator", ":", undefined],
    ["number", "1", undefined],
    ["dict-key", "b", undefined],
    ["operator", ":", undefined],
    ["number", "2", undefined],
    ["brace", "}", undefined],
  ]);
});

// --- Bracket delimiter roles (spec/tooling.md:71-81) --------------------------------------

test("role list: a list literal in value position after `=`", () => {
  const tokens = OL.highlight(":xs = [1 2 3]", doc);
  const brackets = tokens.filter(isBracketRoleToken);
  assert.equal(brackets.length, 2);
  assert.equal(brackets[0].role, "list");
  assert.equal(brackets[1].role, "list");
});

test("role instruction-block: repeat's bracketed body", () => {
  const tokens = OL.highlight("repeat 4 [ forward 10 ]", doc);
  const brackets = tokens.filter(isBracketRoleToken);
  assert.deepEqual(
    brackets.map((token) => token.role),
    ["instruction-block", "instruction-block"],
  );
});

test("role instruction-block: if/while/forever/for-in/for-range bracketed bodies", () => {
  const cases = [
    "if :x [ print 1 ]",
    "while :x [ print 1 ]",
    "forever [ stop ]",
    "for x in [1 2] [ print :x ]",
    "for i from 1 to 5 [ print :i ]",
  ];
  for (const source of cases) {
    const tokens = OL.highlight(source, doc);
    const roles = tokens.filter(isBracketRoleToken).map((token) => token.role);
    assert.ok(
      roles.includes("instruction-block"),
      `expected instruction-block role in: ${source}`,
    );
  }
});

test("role instruction-block: an if's else body also gets the role", () => {
  const tokens = OL.highlight("if :x [ print 1 ] else [ print 2 ]", doc);
  const roles = tokens.filter(isBracketRoleToken).map((token) => token.role);
  assert.deepEqual(roles, [
    "instruction-block",
    "instruction-block",
    "instruction-block",
    "instruction-block",
  ]);
});

test("role instruction-block: define's long-form body has no brackets to tag (no role leaks)", () => {
  const tokens = OL.highlight("define f :a\n  print :a\nend", doc);
  assert.deepEqual(tokens.filter(isBracketRoleToken), []);
});

test("role instruction-block: a comprehension's expression-block body", () => {
  const tokens = OL.highlight("map n in [1 2 3] [ :n * 2 ]", doc);
  const roleBrackets = tokens.filter(isBracketRoleToken);
  // [1 2 3] is the iterable (role list); [ :n * 2 ] is the comprehension body (role
  // instruction-block).
  assert.deepEqual(
    roleBrackets.map((token) => token.role),
    ["list", "list", "instruction-block", "instruction-block"],
  );
});

test("role selector: `:nums[1]` tags both brackets index/dot + role selector, not bracket", () => {
  const tokens = OL.highlight("print :nums[1]", doc);
  const open = tokens.find((token) => token.text === "[");
  const close = tokens.find((token) => token.text === "]");
  assert.equal(open.class, "index/dot");
  assert.equal(open.role, "selector");
  assert.equal(close.class, "index/dot");
  assert.equal(close.role, "selector");
});

test("role selector: a spaced `[ ]` right after a variable is NOT a selector (lexical adjacency)", () => {
  // Per issue #79, a selector requires lexical adjacency; a space before `[` makes this a
  // separate list-literal argument instead.
  const tokens = OL.highlight("print :nums [1]", doc);
  const bracket = tokens.find((token) => token.text === "[");
  assert.equal(bracket.class, "bracket");
  assert.equal(bracket.role, "list");
});

test("role pattern: `for [:x :y] in ...` tags both brackets role pattern, even though this binder shape does not parse cleanly yet", () => {
  const tokens = OL.highlight("for [:x :y] in :pairs\n  print :x\nend", doc);
  const roles = tokens
    .filter((token) => token.text === "[" || token.text === "]")
    .map((token) => token.role);
  assert.deepEqual(roles, ["pattern", "pattern"]);
});

test("role pattern: resolves across an intervening newline between `for` and the bracket", () => {
  const tokens = OL.highlight("for\n[:x :y] in :pairs\n  print :x\nend", doc);
  const roles = tokens
    .filter((token) => token.text === "[" || token.text === "]")
    .map((token) => token.role);
  assert.deepEqual(roles, ["pattern", "pattern"]);
});

test("role pattern: a nested bracket inside the pattern is depth-tracked before finding the pattern's own matching close", () => {
  const tokens = OL.highlight(
    "for [[:a :b] :c] in :pairs\n  print :x\nend",
    doc,
  );
  const brackets = tokens.filter(
    (token) => token.text === "[" || token.text === "]",
  );
  assert.equal(brackets[0].role, "pattern"); // the outer `[`, right after `for`
  assert.equal(brackets.at(-1).role, "pattern"); // the outer `]`, past the nested pair
  // The inner `[:a :b]` pair is skipped by the depth-tracking positional scan (which only
  // claims the outer pattern's own matching bracket), but the AST walk still independently
  // resolves it: it *is* a syntactically valid `ListLit` in its own right (two variable
  // references), parsed as such during the outer construct's error recovery, so it gets role
  // "list" from `markBracketPair` rather than being left unmarked.
  assert.equal(brackets[1].role, "list"); // the inner `[`
  assert.equal(brackets[2].role, "list"); // the inner `]`
});

test("role field-list: `struct point [ x y ]` tags both brackets role field-list, even though struct has no dedicated AST node yet", () => {
  const tokens = OL.highlight("struct point [ x y ]", doc);
  const roles = tokens
    .filter((token) => token.text === "[" || token.text === "]")
    .map((token) => token.role);
  assert.deepEqual(roles, ["field-list", "field-list"]);
});

test("role field-list: resolves across an intervening newline between the type name and the bracket", () => {
  const tokens = OL.highlight("struct point\n[ x y ]", doc);
  const roles = tokens
    .filter((token) => token.text === "[" || token.text === "]")
    .map((token) => token.role);
  assert.deepEqual(roles, ["field-list", "field-list"]);
});

test("role field-list vs role list: `struct` is not special-cased when the bracket is not adjacent to a following name", () => {
  // `struct` alone followed by a bracketed list argument (not `struct <type> [...]`) must not be
  // misclassified as a field list.
  const tokens = OL.highlight("print struct [1 2]", doc);
  const brackets = tokens.filter(isBracketRoleToken);
  assert.deepEqual(
    brackets.map((token) => token.role),
    ["list", "list"],
  );
});

// --- Contextual reserved words (spec/tooling.md:96-99; `of` also spec/grammar.md:380) --------

test("contextual: empty/member/a are keyword only immediately after is, and so is `of` there", () => {
  assert.equal(
    OL.highlight("print :x is empty", doc).find(
      (token) => token.text === "empty",
    ).class,
    "keyword",
  );
  const memberOf = OL.highlight("print :x is member of [1 2 3]", doc);
  assert.equal(
    memberOf.find((token) => token.text === "member").class,
    "keyword",
  );
  assert.equal(memberOf.find((token) => token.text === "of").class, "keyword");
  assert.equal(
    OL.highlight('print :x is a "number"', doc).find(
      (token) => token.text === "a",
    ).class,
    "keyword",
  );
});

test("contextual: empty/member/of/a in a plain call position are ordinary names, not is-predicate keywords", () => {
  // `of` has a SECOND reader-recognized position — the Heritage `value of … for key` reader, where
  // it is `keyword` (issue #785, proven in `heritage-tooling.test.mjs`). These four bare calls are
  // in no such position, so each falls through to the bare-name class. (`spec/tooling.md:31` makes
  // that fall-through class `primitive` normatively; what remains of defect #831 is only that
  // `semanticTokens` then adds `defaultLibrary`, which `:31` forbids inferring. This test pins the
  // contextual-word behaviour either way.)
  assert.equal(OL.highlight("print empty", doc).at(-1).class, "primitive");
  assert.equal(OL.highlight("print member", doc).at(-1).class, "primitive");
  assert.equal(OL.highlight("print of", doc).at(-1).class, "primitive");
  assert.equal(OL.highlight("print a", doc).at(-1).class, "primitive");
});

test("contextual: is, between, and strictly are globally reserved keywords everywhere", () => {
  assert.equal(
    OL.highlight("print :x is between 1 and 10", doc).find(
      (token) => token.text === "between",
    ).class,
    "keyword",
  );
  assert.equal(
    OL.highlight("print :x is strictly between 1 and 10", doc).find(
      (token) => token.text === "strictly",
    ).class,
    "keyword",
  );
});

test("contextual: `to` is a keyword everywhere it is used (heritage opener, set...to, for...to) per spec/tooling.md:96", () => {
  // spec/tooling.md:96 documents `to` as playing two grammatical roles (the heritage procedure
  // opener and the `set .../for ...` slot word) but — unlike empty/member/of/a — never carves out
  // an "ordinary name elsewhere" exception for it; `to` stays in the Core reserved-word list
  // (keywords.ts) in every position, so the highlighter classifies it as keyword uniformly.
  assert.equal(
    OL.highlight("to square :n\n  output :n\nend", doc)[0].class,
    "keyword",
  );
  assert.equal(
    OL.highlight("set x to 5", doc).find((token) => token.text === "to").class,
    "keyword",
  );
  assert.equal(
    OL.highlight("for i from 1 to 10\n  print :i\nend", doc).find(
      (token) => token.text === "to",
    ).class,
    "keyword",
  );
});

// --- Atomicity (spec/tooling.md:25-26) ----------------------------------------------------

test("atomicity: keyword/operator/bracket-shaped text inside a comment stays inside one comment token", () => {
  const tokens = OL.highlight("print 1 # repeat [ :x ] and or\nprint 2", doc);
  const comment = tokens.find((token) => token.class === "comment");
  assert.equal(comment.text, "# repeat [ :x ] and or");
  assert.deepEqual(
    tokens.map((token) => token.class),
    ["primitive", "number", "comment", "primitive", "number"],
  );
});

test("atomicity: keyword/operator/bracket-shaped text inside a string stays inside one word/string token", () => {
  const tokens = OL.highlight('print "repeat :x [ 1 ] and or"', doc);
  assert.deepEqual(
    tokens.map((token) => token.class),
    ["primitive", "word/string"],
  );
  assert.equal(tokens[1].text, '"repeat :x [ 1 ] and or"');
});

// --- Negative-literal-as-number merging ----------------------------------------------------

test("number: a negative literal at expression start merges the `-` into one number token", () => {
  assert.deepEqual(classes("print -5"), [
    ["primitive", "print", undefined],
    ["number", "-5", undefined],
  ]);
});

test("number: a negative literal right after another operator merges into one number token", () => {
  assert.deepEqual(classes("print 2 * -5"), [
    ["primitive", "print", undefined],
    ["number", "2", undefined],
    ["operator", "*", undefined],
    ["number", "-5", undefined],
  ]);
});

test("number: a negative literal in selector key position merges into one number token", () => {
  const tokens = OL.highlight("print :nums[-1]", doc);
  const key = tokens.find((token) => token.class === "number");
  assert.equal(key.text, "-1");
});

test("number: binary subtraction is NOT merged — `-` stays its own operator token", () => {
  assert.deepEqual(classes("print 5 - 3"), [
    ["primitive", "print", undefined],
    ["number", "5", undefined],
    ["operator", "-", undefined],
    ["number", "3", undefined],
  ]);
});

test("number: binary subtraction with no surrounding spaces is still NOT merged", () => {
  assert.deepEqual(classes("print 5-3"), [
    ["primitive", "print", undefined],
    ["number", "5", undefined],
    ["operator", "-", undefined],
    ["number", "3", undefined],
  ]);
});

// --- Semantic bucket: procedure-name/type-name/field-name (#120) --------------------------

test("procedure-name: a user procedure's declared name classifies as procedure-name", () => {
  const tokens = OL.highlight("define square :n\n  return :n * :n\nend", doc);
  const name = tokens.find((token) => token.text === "square");
  assert.equal(name.class, "procedure-name");
});

test("procedure-name: a call resolved to a user procedure classifies as procedure-name", () => {
  const tokens = OL.highlight(
    "define square :n\n  return :n\nend\nsquare 5",
    doc,
  );
  const callee = tokens.filter((token) => token.text === "square").at(-1);
  assert.equal(callee.class, "procedure-name");
});

test("procedure-name: a call resolves even when it appears lexically before the definition", () => {
  const tokens = OL.highlight(
    "square 5\ndefine square :n\n  return :n\nend",
    doc,
  );
  const [callee, declared] = tokens.filter((token) => token.text === "square");
  assert.equal(callee.class, "procedure-name");
  assert.equal(declared.class, "procedure-name");
});

test("procedure-name: an unresolved call callee stays primitive, not procedure-name", () => {
  const tokens = OL.highlight("set_xy 1 2", doc);
  const callee = tokens.find((token) => token.text === "set_xy");
  assert.equal(callee.class, "primitive");
});

test("type-name: a struct's declared type name classifies as type-name", () => {
  const tokens = OL.highlight("struct point [ x y ]", doc);
  const typeName = tokens.find((token) => token.text === "point");
  assert.equal(typeName.class, "type-name");
});

test("type-name: a constructor call resolved to a known struct type classifies as type-name", () => {
  const tokens = OL.highlight("struct point [ x y ]\npoint 1 2", doc);
  const callee = tokens.filter((token) => token.text === "point").at(-1);
  assert.equal(callee.class, "type-name");
});

test("type-name: a call to an unknown name is not misclassified as type-name", () => {
  const tokens = OL.highlight("triangle 1 2 3", doc);
  const callee = tokens.find((token) => token.text === "triangle");
  assert.equal(callee.class, "primitive");
});

test("field-name: struct field-list declared names classify as field-name", () => {
  const tokens = OL.highlight("struct point [ x y ]", doc);
  const fieldNames = tokens.filter(
    (token) => token.text === "x" || token.text === "y",
  );
  assert.equal(fieldNames.length, 2);
  for (const field of fieldNames) {
    assert.equal(field.class, "field-name");
  }
});

test("field-name: `.field` access classifies as field-name once the field is known from a struct declaration", () => {
  const tokens = OL.highlight(
    "struct point [ x y ]\ndefine move_to_point :p\n  set_xy :p.x :p.y\nend",
    doc,
  );
  const fieldAccesses = tokens.filter(
    (token) =>
      token.class === "field-name" &&
      (token.text === "x" || token.text === "y"),
  );
  // Two from the field-list declaration, plus one `.x` and one `.y` access.
  assert.equal(fieldAccesses.length, 4);
});

test("field-name: an unknown `.field` access is not misclassified as field-name", () => {
  const tokens = OL.highlight("print :thing.unknown_field", doc);
  const field = tokens.find((token) => token.text === "unknown_field");
  assert.equal(field.class, "primitive");
});

test("field-name: a reserved-word-spelled field is field-name, not keyword", () => {
  const tokens = OL.highlight("struct box [ repeat ]\nprint :b.repeat", doc);
  const fields = tokens.filter((token) => token.text === "repeat");
  assert.equal(fields.length, 2);
  for (const field of fields) {
    assert.equal(field.class, "field-name");
  }
});

test("semantic: the spec's worked example disambiguates every identifier as documented (spec/tooling.md's Disambiguating identifiers)", () => {
  const source =
    "struct point [ x y ]\n" +
    "define move_to_point :p\n" +
    "  set_xy :p.x :p.y\n" +
    "end";
  const tokens = OL.highlight(source, doc);
  const classOf = (text, occurrence = 0) =>
    tokens.filter((token) => token.text === text)[occurrence].class;
  assert.equal(classOf("struct"), "keyword");
  assert.equal(classOf("define"), "keyword");
  assert.equal(classOf("end"), "keyword");
  assert.equal(classOf("point"), "type-name");
  assert.equal(classOf("move_to_point"), "procedure-name");
  assert.equal(classOf("set_xy"), "primitive");
  assert.equal(classOf("x", 0), "field-name"); // field-list declaration
  assert.equal(classOf("y", 0), "field-name"); // field-list declaration
  assert.equal(classOf("x", 1), "field-name"); // `.x` access
  assert.equal(classOf("y", 1), "field-name"); // `.y` access
});

test("semantic: malformed/unclosed struct input does not throw and still degrades gracefully", () => {
  assert.doesNotThrow(() => OL.highlight("struct point [ x y", doc));
  const tokens = OL.highlight("struct point [ x y", doc);
  // The type name itself needs no closed bracket to resolve (it is discovered from
  // `struct <name> [`, before the bracket's matching close is even sought), so `point` still
  // classifies as type-name. Its fields, however, are gathered only up to a resolved close
  // index — the unclosed bracket never yields one, so `x`/`y` are deferred rather than guessed
  // at, staying `primitive` per the never-misclassify graceful-degradation contract.
  const typeName = tokens.find((token) => token.text === "point");
  assert.equal(typeName.class, "type-name");
  const fields = tokens.filter(
    (token) => token.text === "x" || token.text === "y",
  );
  for (const field of fields) {
    assert.equal(field.class, "primitive");
  }
});

test("semantic: a nested bracket inside a field-list is depth-tracked, not swept up as a bogus field", () => {
  const tokens = OL.highlight("struct p [ x [ y ] z ]", doc);
  const nested = tokens.find((token) => token.text === "y");
  // `y` sits inside the nested `[ … ]`, which is not part of the normative field-list grammar
  // (bare names only) — it must not become field-name just because it's textually between the
  // outer struct brackets.
  assert.notEqual(nested.class, "field-name");
  const outerFields = tokens.filter(
    (token) => token.text === "x" || token.text === "z",
  );
  assert.equal(outerFields.length, 2);
  for (const field of outerFields) {
    assert.equal(field.class, "field-name");
  }
});

test("OL_TOKEN_CLASSES lists procedure-name/type-name/field-name for the shared vocabulary", () => {
  assert.ok(OL.OL_TOKEN_CLASSES.includes("procedure-name"));
  assert.ok(OL.OL_TOKEN_CLASSES.includes("type-name"));
  assert.ok(OL.OL_TOKEN_CLASSES.includes("field-name"));
});

// --- Malformed input: never throws, matching parse()'s contract ---------------------------

test("malformed input: an unclosed string does not throw and yields a best-effort token stream", () => {
  assert.doesNotThrow(() => OL.highlight('print "abc', doc));
});

test("malformed input: an unclosed string's content is never misclassified as a comment, even when it looks like one", () => {
  // `tokenize` consumes an unclosed string's characters without ever pushing a `word` token for
  // it, so that content lands in a token-stream "gap" just like a real comment would — the gap
  // scanner must recognize the bare `"` and refuse to scan past it, rather than misreading the
  // `#`/`//` inside the failed string as a real comment.
  const tokens = OL.highlight('print "unfinished # repeat', doc);
  assert.deepEqual(
    tokens.filter((token) => token.class === "comment"),
    [],
  );
});

test("malformed input: a stray unmatched bracket does not throw", () => {
  assert.doesNotThrow(() => OL.highlight("print [1 2", doc));
});

test("malformed input: a lone close bracket with no matching open gets no role at all", () => {
  // Unlike `print [1 2` (whose `[` still gets error-recovered into a `ListLit`), a bare `]`
  // with nothing to pair it never gets tagged by any of the role-assigning passes.
  const tokens = OL.highlight("print 1]", doc);
  const bracket = tokens.find((token) => token.text === "]");
  assert.equal(bracket.class, "bracket");
  assert.equal(bracket.role, undefined);
});

test("malformed input: an unclosed pattern bracket does not throw, and its `[` still resolves to role pattern", () => {
  assert.doesNotThrow(() => OL.highlight("for [:x :y in :pairs", doc));
  const tokens = OL.highlight("for [:x :y in :pairs", doc);
  const open = tokens.find((token) => token.text === "[");
  assert.equal(open.role, "pattern");
});

// --- Public surface -------------------------------------------------------------------------

test("OL_BRACKET_ROLES lists exactly the 5 normative delimiter roles", () => {
  assert.deepEqual(OL.OL_BRACKET_ROLES, [
    "list",
    "instruction-block",
    "selector",
    "pattern",
    "field-list",
  ]);
});

test("tokens are returned in source order and cover the whole meaningful input", () => {
  const tokens = OL.highlight("print 1\nprint 2", doc);
  assert.deepEqual(
    tokens.map((token) => token.text),
    ["print", "1", "print", "2"],
  );
});

// --- The `profiles` option's blast radius (issues #832, #840) ---------------------------------

// `spec/tooling.md:30` puts the profile block-heads — Sprites' `ask`/`each` plus its mode-switch
// command `tell`, and Interaction's `when`/`every`/`on_key`/`on_click` — in the `keyword` class
// "while their profile is active", and `:31` puts "a profile word whose profile is inactive" in
// `primitive`. `highlight()` has honoured BOTH halves since issue #740 gave it an active-profile
// set, and the per-profile suites (`sprites-tooling.test.mjs`, `interaction-tooling.test.mjs`)
// already assert each of the seven names in both directions.
//
// What nothing pinned before this block is the rule's other side: which words the option must
// leave ALONE. `spec/tooling.md:30` names `local end`, `for end from 1 to 3`, `export end`, and
// `:p.end` as positions where `end` is `keyword` anyway, and `:31` names `empty` as `primitive` —
// none of them a profile word, so no profile set may move any of them. That invariant lived only
// in prose, and two slices turned on it. Issue #840 (closed `NOT_PLANNED`) proposed reclassifying
// **any** built-in name in a binding position — its own table lists `local if`, `set count to 5`,
// `for fd in [1 2]` — and, separately, classifying the profile heads *unconditionally*, dropping
// the profile gate #740 added. Both halves would have moved the controls below: the first covers
// `local end`/`local empty` directly, the second is what test 3 measures. Issue #832 then reported
// the seven names as never `keyword`, which is not reproducible — that measurement passed its
// options object in the `document` slot (`highlight(src, { profiles })`), so `options` defaulted
// to `{}` and every column read the Core-only answer.
//
// The `keyword` row of `spec/tooling.md`'s token-class table is **change-detected only**
// (`npm run built-in-names` fingerprints it; nothing checks the edited row is correct) and the
// conformance harness asserts events and diagnostics but has no token-class channel — so these
// four tests are the only thing holding the invariant. They are a matched set, listed in the
// order they appear below:
//
//   1. CORPUS — over a representative corpus, the widest profile set classifies identically to a
//      keyword-free one (blast radius). The corpus carries the *contextual* cases a substituted
//      name cannot show: `local end`, `:p.end`, a dict key, bracket roles, both comment markers;
//   2. MANIFEST — no built-in name moves between the two sets, swept over every entry of
//      `spec/built-in-names.json`, the authoritative manifest (ADR-0021), minus the registry's
//      own words: 141 names, each probed in seven grammatical positions. This is the breadth 1
//      cannot have;
//   3. CONTROLS — the spec's own non-profile examples keep their class under both sets (the named
//      controls, plus `if`/`repeat` as positive keyword controls); and
//   4. REGISTRY — every profile keyword DOES move, in each direction asserted separately —
//      without which the others would pass on a build that ignored `options.profiles` altogether.
//
// What the set proves, stated as narrowly as it was measured. 1 and 2 compare two endpoint
// profile sets, so each proves "nothing I probe moves between these sets" — 1 over a finite
// corpus, 2 over the full name manifest in seven positions each. Neither subsumes the other (a
// widening onto `empty` dies at 1 and not 2, because `empty` is not a manifest entry; one onto
// `fd` dies at 2 and not 1), and neither is a quantifier over arbitrary sources: a gated widening
// onto a name in a position no template covers would still pass. Both gaps are real and were
// measured — a widening onto `fd` or `setcolor` passed the whole suite when only 1, 3 and 4
// existed, and a widening onto `fd` conditioned on a non-initial token index passed it again when
// 2 probed bare names only.
//
// One asymmetry worth naming rather than implying: 1 and 2 compare two endpoint profile sets that
// differ only in `sprites` and `interaction-events` — the two profiles that contribute keywords.
// So they catch a change gated on one of those. A change that reclassifies a word
// **unconditionally**, or gates it on any of the other ten profiles, looks identical from both
// endpoints and is invisible to them by construction — that is what 3's named controls, 4, and the
// rest of this file are for.

/** Every profile a program can claim — the widest active set (`check.ts`'s `OL_CHECK_PROFILES`). */
const ALL_PROFILES = OL.OL_CHECK_PROFILES;

/** The seven profile keywords, read off the registry so a new one joins these tests by itself. */
const PROFILE_HEADS = Object.values(OL.OL_PROFILE_KEYWORDS).flat();

/**
 * The other endpoint: every profile that contributes no keyword, derived as the complement of
 * `OL_PROFILE_KEYWORDS`'s own keys rather than hardcoded, so a profile that starts contributing
 * one leaves this set by itself — the same idiom as {@link PROFILE_HEADS} two lines up.
 */
const NO_KEYWORD_PROFILES = ALL_PROFILES.filter(
  (profile) => !(profile in OL.OL_PROFILE_KEYWORDS),
);

/**
 * Project a whole run, so a count, role, or class change is all caught by one comparison rather
 * than only the class the current defect happens to be about.
 */
function profileClasses(source, profiles) {
  return OL.highlight(source, doc, { profiles }).map((token) => [
    token.class,
    token.text,
    token.role,
  ]);
}

/**
 * Programs deliberately free of profile words, spanning the vocabulary a widened lookup would most
 * plausibly catch: both spellings of the `end` label (bare and `end define`/`end if`), the
 * `is`-predicate contextual keywords (`empty`, `a`, `member`, `of`), binding forms, a
 * comprehension, a selector, and both line-comment markers.
 *
 * Every entry is asserted below to be free of profile words AND to parse without a diagnostic, so
 * a claim of coverage here cannot quietly decay into error recovery — a corpus of malformed
 * sources still compares equal to itself under two profile sets while exercising none of the
 * grammar it names. `export end` is the single deliberate exception: it is one of
 * `spec/tooling.md:30`'s own four normative examples, and the reader currently enters recovery on
 * it, so its diagnostics are listed rather than hidden.
 */
const PROFILE_WORD_FREE_CORPUS = [
  "define greet :name\n  print :name\nend",
  "define greet :name\n  print :name\nend define",
  "local end",
  "for end from 1 to 3 [ forward 1 ]",
  "export end",
  "local p\nprint :p.end",
  "local empty",
  "local x\nif :x is empty [ print 1 ]",
  'local x\nif :x is a "number" [ print 1 ]',
  "if 1 is member of [ 1 2 ] [ print 1 ]",
  "if true\n  print 1\nend if",
  "repeat 3 [ forward 10 ]",
  "local x\nwhile :x [ print :x ]",
  "set x to 1",
  'make "count" 0',
  "struct point [ x y ]",
  "print { a: 1 }",
  "print not true and 3 mod 2",
  "print map n in [ 1 2 3 ] [ :n * 2 ]",
  "# a comment\nforward 10",
  "// another comment\nforward 10",
  "local d\nprint :d[key]",
  "forever [ forward 1 ]",
];

/**
 * Parse diagnostics each corpus entry and named control is expected to raise, keyed by source.
 * Absent = must parse clean. Only `export end` appears, and only because `spec/tooling.md:30`
 * requires the example and the reader currently enters recovery on it.
 */
const DECLARED_PARSE_DIAGNOSTICS = new Map([
  ["export end", ["ol-bad-token", "ol-mismatched-end"]],
]);

test("profiles: the widest profile set moves no word outside OL_PROFILE_KEYWORDS", () => {
  const heads = new Set(PROFILE_HEADS);
  for (const source of PROFILE_WORD_FREE_CORPUS) {
    // Measured, not claimed: a corpus entry that quietly grew a profile word would turn the
    // identity assertion below from an invariant into a coincidence.
    assert.deepEqual(
      OL.highlight(source, doc, { profiles: ALL_PROFILES })
        .map((token) => token.text.toLowerCase())
        .filter((text) => heads.has(text)),
      [],
      `${JSON.stringify(source)} must contain no profile word`,
    );
    // Likewise measured: the corpus must be real OpenLogo, not recovery soup that only looks like
    // it covers the grammar it names.
    assert.deepEqual(
      OL.parse(source, doc).diagnostics.map((diagnostic) => diagnostic.code),
      DECLARED_PARSE_DIAGNOSTICS.get(source) ?? [],
      `${JSON.stringify(source)} must parse as declared`,
    );
    const projected = profileClasses(source, ALL_PROFILES);
    // Guards the identity assertion against the degenerate build where `highlight()` returns
    // nothing at all: two empty projections compare equal and would prove nothing.
    assert.ok(projected.length > 0, `${JSON.stringify(source)} must tokenize`);
    assert.deepEqual(
      projected,
      profileClasses(source, NO_KEYWORD_PROFILES),
      `${JSON.stringify(source)} must classify identically under both profile sets`,
    );
  }
});

/**
 * Breadth where the corpus has depth: every entry of `spec/built-in-names.json` — the
 * authoritative keyword+primitive manifest, aliases included, versioned with the spec
 * (ADR-0021) — minus the profile registry's own words, must classify the same under both
 * profile sets.
 *
 * Read from the normative manifest rather than from the parser's registries on purpose. A test
 * that drew its subject list from the implementation could not notice a name the implementation
 * forgot; `npm run built-in-names` is what ties the two together, and this rides on that. That
 * gate is also what really holds the manifest's size — the floor asserted below is a smoke check
 * against this sweep quietly becoming a no-op, not a census.
 *
 * It asserts a *relation* (the two profile sets agree), never an expected class, so it stays
 * silent about what any individual name should paint — that is `spec/tooling.md`'s business and
 * the rest of this file's. Being relational is also what makes the templates below safe: a name
 * substituted into a template it does not fit still has to classify the same either way.
 */
const BUILT_IN_NAMES = JSON.parse(
  readFileSync(
    new URL("../../../spec/built-in-names.json", import.meta.url),
    "utf8",
  ),
).names.map((entry) => entry.name);

/**
 * Each swept name is probed in several grammatical positions, not just alone. A one-token program
 * is the *only* thing a bare sweep sees, and a widening conditioned on position — `lower === "fd"
 * && index > 0`, painting `repeat 3 [ fd 10 ]` but not a lone `fd` — slips past it untouched while
 * passing every other test in this file.
 *
 * Position-dependence is this block's declared threat model, so the templates cover the positions
 * it names rather than only the convenient ones. #840's AC1 table is entirely **binding**
 * positions, and its three forms — `local if`, `set count to 5`, `for fd in [1 2]` — are the last
 * three templates, the `for` row in its `from` spelling, which is `spec/tooling.md:30`'s own
 * example. Each was needed: with only the non-binding four, widenings onto `local fd`,
 * `set fd to 1`, and `for fd from 1 to 3` each passed the entire suite, and removing any one of
 * the seven lets a real mutant live. Measured, not supposed — and a reminder that citing a
 * position is not probing it.
 *
 * Still not exhaustive over positions, and deliberately not chased further. Three known survivors,
 * named rather than implied: a widening gated on nesting depth, one gated on letter case, and one
 * that separates `for … in` from `for … from` by lookahead (both share `for` as the preceding
 * token, so anything keying on that predecessor is caught). Closing those needs contrivance beyond
 * what this block defends against.
 */
const SWEEP_TEMPLATES = [
  (name) => name,
  (name) => `repeat 1 [ ${name} ]`,
  (name) => `define holder\n  ${name}\nend`,
  (name) => `print ${name}`,
  (name) => `local ${name}`,
  (name) => `set ${name} to 1`,
  (name) => `for ${name} from 1 to 3 [ forward 1 ]`,
];

test("profiles: no built-in-names.json entry outside OL_PROFILE_KEYWORDS changes class between the two sets", () => {
  const heads = new Set(PROFILE_HEADS);
  const swept = BUILT_IN_NAMES.filter((name) => !heads.has(name));
  // A manifest that stopped being read, lost its shape, or stopped containing the profile words
  // would reduce this sweep to a silent no-op. Membership is checked by name rather than by
  // count, so "six heads, one duplicated" cannot masquerade as "all seven present".
  assert.deepEqual(
    PROFILE_HEADS.filter((head) => !BUILT_IN_NAMES.includes(head)),
    [],
    "every profile keyword must appear in the manifest",
  );
  assert.equal(swept.length, BUILT_IN_NAMES.length - heads.size);
  assert.ok(swept.length > 100, `expected a broad sweep, got ${swept.length}`);
  for (const name of swept) {
    for (const template of SWEEP_TEMPLATES) {
      const source = template(name);
      const projected = profileClasses(source, ALL_PROFILES);
      // Subject-level, not merely run-level: a template that swallowed the name it substituted
      // would still compare equal to itself and prove nothing about that name. Degenerate for the
      // 11 probes whose scaffold word IS the subject (`set set to 1`, `local local`, `print
      // print`, `to`, `for for …`), but no name is degenerate in more than two of the seven
      // templates and the bare one can never swallow its subject, so every name keeps a real
      // check.
      assert.ok(
        projected.some(([, text]) => text.toLowerCase() === name.toLowerCase()),
        `${JSON.stringify(source)} must carry ${name} as a token`,
      );
      assert.deepEqual(
        projected,
        profileClasses(source, NO_KEYWORD_PROFILES),
        `${JSON.stringify(source)} must classify identically under both profile sets`,
      );
    }
  }
});

/**
 * `spec/tooling.md:30`'s four ordinary-name positions for `end`, `:31`'s `empty`, and two Core
 * block-heads as positive controls. The expected class is a one-element array, so a filter that
 * silently matched nothing — or matched twice — fails rather than passing vacuously.
 */
const NON_PROFILE_CONTROLS = [
  ["end", "local end", "keyword"],
  ["end", "for end from 1 to 3 [ forward 1 ]", "keyword"],
  ["end", "export end", "keyword"],
  ["end", "local p\nprint :p.end", "keyword"],
  ["empty", "local empty", "primitive"],
  ["if", "if true [ print 1 ]", "keyword"],
  ["repeat", "repeat 3 [ forward 10 ]", "keyword"],
];

test("profiles: the spec's own non-profile examples keep their class under both profile sets", () => {
  for (const [word, source, expected] of NON_PROFILE_CONTROLS) {
    // Held to the same standard the corpus is, for the same reason: round 1 of this change's
    // review found a corpus whose sources did not parse, so a control that quietly stopped being
    // valid OpenLogo would be the identical defect one test over.
    assert.deepEqual(
      OL.parse(source, doc).diagnostics.map((diagnostic) => diagnostic.code),
      DECLARED_PARSE_DIAGNOSTICS.get(source) ?? [],
      `${JSON.stringify(source)} must parse as declared`,
    );
    for (const profiles of [NO_KEYWORD_PROFILES, ALL_PROFILES]) {
      assert.deepEqual(
        OL.highlight(source, doc, { profiles })
          .filter((token) => token.text === word)
          .map((token) => token.class),
        [expected],
        `${word} in ${JSON.stringify(source)} with ${JSON.stringify(profiles)}`,
      );
    }
  }
});

/** One call site per profile keyword, in the position that word actually heads. */
const PROFILE_HEAD_SOURCES = {
  ask: 'ask "bee" [ forward 1 ]',
  each: "each [ forward 1 ]",
  tell: 'tell "bee"',
  when: "when :flag [ forward 1 ]",
  every: "every 5 [ forward 1 ]",
  on_key: 'on_key "a" [ forward 1 ]',
  on_click: "on_click [ forward 1 ]",
};

test("profiles: every OL_PROFILE_KEYWORDS word moves in both directions", () => {
  // Guards the two tests above against the one build that would satisfy them for the wrong
  // reason — a classifier that ignores `options.profiles` entirely, which is precisely what the
  // (mis-measured) report in issue #832 described. Covering the registry exactly also means a
  // profile that starts contributing a keyword fails here until its call site is added.
  assert.deepEqual(
    [...PROFILE_HEADS].sort(),
    Object.keys(PROFILE_HEAD_SOURCES).sort(),
  );
  for (const head of PROFILE_HEADS) {
    const source = PROFILE_HEAD_SOURCES[head];
    const classOf = (profiles) =>
      OL.highlight(source, doc, { profiles })
        .filter((token) => token.text === head)
        .map((token) => token.class);
    // Asserted as two separate one-element comparisons, never as one concatenation: `[...a, ...b]`
    // deepEqual `["primitive", "keyword"]` constrains only the combined sequence, so an empty
    // inactive result beside a two-element active one would satisfy it while proving neither
    // direction.
    assert.deepEqual(
      classOf(NO_KEYWORD_PROFILES),
      ["primitive"],
      `${head} must be primitive while its profile is inactive`,
    );
    assert.deepEqual(
      classOf(ALL_PROFILES),
      ["keyword"],
      `${head} must be keyword while its profile is active`,
    );
  }
});
