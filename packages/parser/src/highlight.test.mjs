// Unit tests for `highlight()` (issues #119 and #120), the grammar-derived syntax-highlighting
// classifier: #119's lexical first pass plus #120's semantic disambiguation pass (procedure-name,
// type-name, field-name). These are the primary proof of behavior for this slice — the
// conformance harness has parse/execute/check modes but not a highlight mode. Coverage mirrors
// spec/tooling.md's normative token-class table (lines 28-44) and delimiter-role table
// (lines 71-81):
//   * every lexical class reachable without symbol discovery: keyword, primitive, number,
//     word/string, :variable, comment, bracket, brace, paren, operator, index/dot, dict-key;
//   * all 5 bracket delimiter roles: list, instruction-block, selector, pattern, field-list;
//   * contextual reserved words in/out of `is`-predicate position (spec/tooling.md:96-98);
//   * comment/string atomicity (spec/tooling.md:25-26);
//   * negative-literal-as-number merging vs. genuine binary subtraction; and
//   * the semantic bucket (#120): procedure-name (declaration + resolved calls), type-name
//     (struct declaration + constructor calls), and field-name (field-list declaration + known
//     `.field` access) — plus graceful degradation to `primitive` for unresolved names.
//
// The dict-*literal* half of `dict-key` (`{ key: value }`) is covered alongside the selector
// half (issue #149): both share the identical bare-identifier-vs-quoted-word disambiguation.

import assert from "node:assert/strict";
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
  const source = "define double :n\n  return :n\nend\nprint { a:double() }";
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

// --- Contextual reserved words (spec/tooling.md:96-98) ------------------------------------

test("contextual: empty/member/of/a are keyword only immediately after is", () => {
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

test("contextual: empty/member/of/a are ordinary primitive names outside is-predicate position", () => {
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
  // (reserved.ts) in every position, so the highlighter classifies it as keyword uniformly.
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
