// Exhaustive path coverage for the `@openlogo/parser` reader/lexer (issue #9). Where
// `parse.test.mjs` reads as the headline behavioural spec, this file drives every remaining
// lexer state, grammar production, precedence rung, recovery path, and `ol-*` diagnostic so the
// whole parser surface is exercised to 100% line/branch/function. Everything goes through the
// public `parse`/`walk`/registry API — the lexer stays internal, proven end to end.

import assert from "node:assert/strict";
import { test } from "node:test";
import * as OL from "@openlogo/parser";

const doc = "coverage.logo";
const parse = (src) => OL.parse(src, doc);
const codesOf = (src) => parse(src).diagnostics.map((d) => d.code);
const bodyOf = (src) => parse(src).ast.body;
const firstArg = (src) => bodyOf(src)[0].args[0];

// --- Lexer: numbers ---------------------------------------------------------

test("lexes integer, decimal, and exponent number forms", () => {
  assert.equal(firstArg("print 42").value, 42);
  assert.equal(firstArg("print 3.5").value, 3.5);
  assert.equal(firstArg("print 1e5").value, 1e5);
  assert.equal(firstArg("print 1E5").value, 1e5);
  assert.equal(firstArg("print 1e+5").value, 1e5);
  assert.equal(firstArg("print 2e-3").value, 2e-3);
  assert.equal(firstArg("print 1.5e2").value, 150);
});

test("stops a number before a non-exponent letter or a trailing dot", () => {
  // `1e` with no exponent digit: number 1, then the bare name `e` — two statements on one line,
  // which now trips the run-on terminator rule.
  let r = parse("print 1e");
  assert.deepEqual(
    r.diagnostics.map((d) => d.code),
    ["ol-bad-token"],
  );
  assert.equal(r.ast.body[0].args[0].value, 1);
  assert.equal(r.ast.body[1].callee.name, "e");

  // `3.x`: `.identifier` after any primary is a postfix field selector (issue #407/F7's
  // `postfix-expression ::= primary { selector | "." identifier }`, `primary` includes `number`),
  // so this parses cleanly as a `PostfixExpression` over a `NumberLit` base — the type mismatch
  // (a number has no fields) is a runtime/semantic concern, not a parse error.
  r = parse("print 3.x");
  assert.deepEqual(codesOf("print 3.x"), []);
  const postfix = r.ast.body[0].args[0];
  assert.equal(postfix.kind, "PostfixExpression");
  assert.equal(postfix.base.value, 3);
  assert.equal(postfix.segments[0].name.name, "x");

  // `1.` at end of input: no identifier follows the dot, so it is a stray dot token.
  r = parse("print 1.");
  assert.equal(r.ast.body[0].args[0].value, 1);
  assert.deepEqual(codesOf("print 1."), ["ol-bad-token"]);
});

// --- Lexer: names and variables --------------------------------------------

test("lexes names and variables with ? and ! suffixes", () => {
  assert.equal(parse("empty? [1]").ast.body[0].callee.name, "empty?");
  assert.equal(firstArg("print reset!").callee.name, "reset!");

  const q = firstArg("print :done?");
  assert.equal(q.kind, "VarRef");
  assert.equal(q.name, "done?");
  assert.equal(firstArg("print :go!").name, "go!");
});

// --- Lexer: words / strings -------------------------------------------------

test("decodes single-quoted words including escapes", () => {
  assert.equal(firstArg('print "red"').value, "red");
  assert.equal(firstArg('print "a\\"b"').value, 'a"b'); // escaped quote
  assert.equal(firstArg('print "a\\\\b"').value, "a\\b"); // escaped backslash
  assert.equal(firstArg('print "a\\b"').value, "a\\b"); // lone backslash kept verbatim
});

test("reads triple-quoted words and normalizes indentation", () => {
  assert.equal(firstArg('print """abc"""').value, "abc");
  assert.equal(
    firstArg('print """\n  line1\n  line2\n"""').value,
    "line1\nline2",
  );
  assert.equal(firstArg('print """\na\n\nb\n"""').value, "a\n\nb");
  assert.equal(firstArg('print """\n   \n"""').value, "   ");
  assert.equal(firstArg('print """"""').value, "");
  // Escaped quote, escaped backslash, and a lone backslash inside a triple-quote.
  assert.equal(firstArg(String.raw`print """a\"b\\c\d"""`).value, 'a"b\\c\\d');
});

test("normalizes an indented closing triple-quote delimiter (grammar.md §21)", () => {
  // The newline immediately before the closing `"""` is dropped, and "the indentation of the
  // closing `"""` does not affect the result", so an indented closing delimiter must not leave a
  // spurious trailing newline. Every other multi-line case above closes flush-left; this pins the
  // indented-close path (LF and CRLF) — a language-coverage gap that 100% line coverage masked.
  assert.equal(
    firstArg('print """\n  hello\n  world\n  """').value,
    "hello\nworld",
  );
  assert.equal(
    firstArg('print """\r\n  hello\r\n  world\r\n  """').value,
    "hello\nworld",
  );
  // The worked example from grammar.md, closed both flush-left and indented — identical result.
  assert.equal(
    firstArg('print """\n    Hello\n  World\n"""').value,
    "  Hello\nWorld",
  );
  assert.equal(
    firstArg('print """\n    Hello\n  World\n  """').value,
    "  Hello\nWorld",
  );
});

test("keeps a word token's raw source slice as its text (escapes preserved)", () => {
  // `LexToken.text` is the verbatim source slice, not a reconstruction of the decoded value, so an
  // escaped quote or backslash survives round-trip. A run-on surfaces the offending token's raw
  // `text` in the diagnostic params, which is how this internal lexer field is proven end to end.
  const single = parse(String.raw`print 1 "a\"b\\c"`).diagnostics[0];
  assert.equal(single.code, "ol-bad-token");
  assert.equal(single.params.text, String.raw`"a\"b\\c"`);
  const triple = parse(String.raw`print 1 """a\"b"""`).diagnostics[0];
  assert.equal(triple.code, "ol-bad-token");
  assert.equal(triple.params.text, String.raw`"""a\"b"""`);
});

test("reports unclosed strings and comments", () => {
  assert.deepEqual(codesOf('print "abc'), ["ol-unclosed-string"]);
  assert.deepEqual(codesOf('print "abc\nmore'), ["ol-unclosed-string"]);
  assert.deepEqual(codesOf('print """abc'), ["ol-unclosed-string"]);
  assert.deepEqual(codesOf("print 1 /* unclosed"), ["ol-unclosed-comment"]);
});

// --- Lexer: comments, braces, stray characters ------------------------------

test("reports bad tokens for stray characters and a bare colon", () => {
  assert.deepEqual(codesOf("print @"), ["ol-bad-token"]);
  assert.deepEqual(codesOf("print :"), ["ol-bad-token"]);
});

test("lexes braces as real delimiters, matched or not — see dict-literal.test.mjs for the parseable literal", () => {
  // `{ }` (matched) is a valid empty dict literal (spec/error-model.md), not an error — dict
  // literal parsing is covered in its own dedicated dict-literal.test.mjs. Only a genuinely
  // unmatched brace still reports `ol-unmatched-brace`.
  assert.deepEqual(codesOf("{ }"), []);
  assert.deepEqual(codesOf("{ a: 1"), ["ol-unmatched-brace"]);
  assert.deepEqual(codesOf("}"), ["ol-unmatched-brace"]);
});

test("treats a CRLF as a single statement terminator", () => {
  const r = parse("print 1\r\nprint 2");
  assert.deepEqual(r.diagnostics, []);
  assert.equal(r.ast.body.length, 2);
  // The second statement is reported on line 2, so the CRLF advanced the line once.
  assert.deepEqual(r.ast.body[1].source_span.start, [2, 1]);
});

// --- Expressions: operators and precedence ---------------------------------

test("parses every comparison operator", () => {
  for (const op of ["==", "!=", "<", ">", "<=", ">="]) {
    const e = firstArg(`print 1 ${op} 2`);
    assert.equal(e.kind, "Call");
    assert.equal(e.callee.name, op);
    assert.equal(e.args[0].value, 1);
    assert.equal(e.args[1].value, 2);
  }
});

test("parses or, and, not, subtraction, division, and mod", () => {
  assert.equal(firstArg("print true or false").callee.name, "or");
  assert.equal(firstArg("print true and false").callee.name, "and");
  assert.equal(firstArg("print not true").callee.name, "not");
  assert.equal(firstArg("print 5 - 2").callee.name, "-");
  assert.equal(firstArg("print 6 / 2").callee.name, "/");
  assert.equal(firstArg("print 7 mod 3").callee.name, "mod");

  // or/and fold left as the chain grows.
  assert.equal(
    firstArg("print true or false or true").args[0].callee.name,
    "or",
  );
  assert.equal(
    firstArg("print true and false and true").args[0].callee.name,
    "and",
  );
});

test("reports the operand missing after an operator", () => {
  for (const src of [
    "print true or",
    "print true and",
    "print 1 <",
    "print 1 +",
    "print 1 *",
    "print not",
  ]) {
    assert.deepEqual(codesOf(src), ["ol-bad-token"]);
  }
});

test("labels the unexpected token as line end, file end, or a delimiter", () => {
  assert.equal(parse(":x =\n5").diagnostics[0].params.text, "end of line");
  assert.equal(parse(":x =").diagnostics[0].params.text, "end of file");
  // A stray close bracket routes to its own unmatched-bracket code, not a bare bad-token.
  assert.equal(parse(":x = ]").diagnostics[0].code, "ol-unmatched-bracket");
  assert.equal(parse(":x = ]").diagnostics[0].params.delimiter, "]");
});

test("reads a stray leading minus that is not a negative literal", () => {
  // `-` followed by a non-number is the minus operator with nothing to bind to.
  assert.deepEqual(codesOf("print -"), ["ol-bad-token"]);
  assert.deepEqual(codesOf("print - true"), ["ol-bad-token"]);
  // A gap between `-` and the numeral (`- 3`) is not adjacency, so it is not a negative literal.
  assert.deepEqual(codesOf("print - 3"), ["ol-bad-token"]);
  // Adjacent `-3` after a binary operator still reads as a negative literal.
  assert.equal(firstArg("print 4 * -2").args[1].value, -2);
});

// --- Lists ------------------------------------------------------------------

test("reads list literals: flat, multiline, nested, and empty", () => {
  assert.deepEqual(
    firstArg("print [1 2 3]").elements.map((e) => e.value),
    [1, 2, 3],
  );
  assert.deepEqual(
    firstArg("print [\n1\n2\n]").elements.map((e) => e.value),
    [1, 2],
  );
  assert.equal(firstArg("print [[1] [2]]").elements[0].kind, "ListLit");
  assert.deepEqual(firstArg("print []").elements, []);
});

test("recovers inside a list: unmatched bracket and a stuck element", () => {
  assert.deepEqual(codesOf("print [1 2"), ["ol-unmatched-bracket"]);
  // A stray close paren inside a list is reported as an unmatched paren, then recovery continues.
  assert.deepEqual(codesOf("print [1 )]"), ["ol-unmatched-paren"]);
});

// --- Parenthesized calls and groups ----------------------------------------

test("parses parenthesized calls and grouped expressions", () => {
  const pc = firstArg("print (sentence 1 2 3)");
  assert.equal(pc.kind, "ParenCall");
  assert.equal(pc.callee.name, "sentence");
  assert.equal(pc.args.length, 3);

  assert.equal(firstArg("print (1 + 2)").callee.name, "+");
  assert.equal(firstArg("print (sentence\n1\n2)").args.length, 2);
});

test("parses the variadic (and …) and (or …) parenthesized forms", () => {
  const conj = firstArg("print (and true false true)");
  assert.equal(conj.kind, "ParenCall");
  assert.equal(conj.callee.name, "and");
  assert.equal(conj.args.length, 3);

  const disj = firstArg("print (or false true)");
  assert.equal(disj.kind, "ParenCall");
  assert.equal(disj.callee.name, "or");
  assert.equal(disj.args.length, 2);

  // The head keeps its own span so the checker can point at exactly `and`/`or`.
  assert.deepEqual(conj.callee.source_span, {
    document: doc,
    start: [1, 8],
    end: [1, 11],
  });
});

test("a paren head that is a literal or keyword falls back to a group", () => {
  assert.equal(firstArg("print (true)").kind, "BooleanLit");
  assert.equal(firstArg("print (false)").value, false);
  assert.equal(firstArg("print (map x in [1 2] [ :x ])").kind, "Comprehension");
  assert.equal(
    firstArg("print (filter x in [1 2] [ :x ])").kind,
    "Comprehension",
  );
  assert.equal(
    firstArg("print (reduce a x in [1 2] from 0 [ :a ])").kind,
    "Comprehension",
  );
  // `not` is a non-primary keyword, so it is not a paren callee; the group wraps the unary.
  const grouped = firstArg("print (not true)");
  assert.equal(grouped.callee.name, "not");
});

test("reports an empty group and an unmatched ( for calls and groups", () => {
  assert.deepEqual(codesOf("print (sentence 1 2"), ["ol-unmatched-paren"]);
  assert.deepEqual(codesOf("print (1 2"), ["ol-unmatched-paren"]);
  assert.deepEqual(codesOf("print (sentence ] 1 2)"), ["ol-unmatched-bracket"]);
  // An empty group `( )` has no operand — flagged rather than silently vanishing.
  assert.deepEqual(codesOf("print ( )"), ["ol-bad-token"]);
});

// --- Comprehensions ---------------------------------------------------------

test("parses map, filter, and reduce comprehensions", () => {
  let c = firstArg("print map x in [1 2 3] [ :x ]");
  assert.equal(c.kind, "Comprehension");
  assert.equal(c.form, "map");
  assert.equal(c.binder.name, "x");
  assert.equal(c.iterable.kind, "ListLit");
  assert.equal(c.accumulator, undefined);
  assert.equal(c.initial, undefined);

  assert.equal(firstArg("print filter x in [1 2 3] [ :x ]").form, "filter");

  c = firstArg("print reduce acc x in [1 2 3] from 0 [ :acc ]");
  assert.equal(c.form, "reduce");
  assert.equal(c.accumulator.name, "acc");
  assert.equal(c.binder.name, "x");
  assert.equal(c.initial.value, 0);
});

test("reports comprehension syntax errors", () => {
  assert.deepEqual(codesOf("print reduce 5"), ["ol-bad-token"]); // accumulator not a name
  assert.deepEqual(codesOf("print map 5"), ["ol-bad-token"]); // binder not a name
  // A `{` binder is a different malformed shape than a number: it is itself a lexically valid,
  // balanced delimiter (unlike `5`), so it takes the `unexpected()` helper's dedicated `lbrace`
  // branch rather than its generic `default` — `ol-unmatched-brace`, not `ol-bad-token`. This is
  // an unrelated grammar production from the `dict-entry` malformed-key/separator fix (issues
  // #520/#546, `unexpectedInDictEntry`/`skipMalformedDictKeyLiteral`): a comprehension binder
  // position, not a dict-entry position, so it is out of scope for that fix and keeps its
  // original `unexpected()` fallthrough behavior.
  assert.deepEqual(codesOf("print map { a: 1 } in [1 2 3] [ :a ]"), [
    "ol-unmatched-brace",
    "ol-bad-token",
    "ol-bad-token",
  ]);
  assert.deepEqual(codesOf("print map x"), ["ol-bad-token"]); // missing `in`
  assert.deepEqual(codesOf("print map x in"), ["ol-bad-token"]); // iterable missing
  assert.deepEqual(codesOf("print reduce acc x in [1]"), ["ol-bad-token"]); // missing `from`
  assert.deepEqual(codesOf("print reduce acc x in [1] from"), ["ol-bad-token"]); // seed missing
  assert.deepEqual(codesOf("print map x in [1]"), ["ol-missing-end"]); // no bracket body
  assert.deepEqual(codesOf("print reduce a n in [1] from 0"), [
    "ol-missing-end",
  ]); // seed present, no bracket body
});

// --- `is` predicates --------------------------------------------------------

test("parses the worded is-predicate family", () => {
  assert.equal(firstArg("print :x is empty").test.form, "empty");

  let p = firstArg("print :x is member of [1 2 3]");
  assert.equal(p.kind, "IsPredicate");
  assert.equal(p.test.form, "member-of");
  assert.equal(p.test.collection.kind, "ListLit");

  p = firstArg('print :x is a "number"');
  assert.equal(p.test.form, "a");
  assert.equal(p.test.type.value, "number");

  p = firstArg("print :x is between 1 and 10");
  assert.equal(p.test.form, "between");
  assert.equal(p.test.strict, false);
  assert.equal(p.test.low.value, 1);
  assert.equal(p.test.high.value, 10);

  p = firstArg("print :x is strictly between 1 and 10");
  assert.equal(p.test.form, "between");
  assert.equal(p.test.strict, true);

  // The operand is preserved (and walked once) whichever predicate follows.
  const r = parse("print :x is empty");
  let places = 0;
  OL.walk(r.ast, (n) => {
    if (n.kind === "VarRef") places += 1;
  });
  assert.equal(places, 1);
});

test("reports malformed is-predicates on every branch", () => {
  // Unknown word after `is`, and `is` at end of input.
  assert.deepEqual(codesOf("print :x is wibble"), ["ol-bad-token"]);
  assert.deepEqual(codesOf("print :x is"), ["ol-bad-token"]);
  // `member` without `of`, and `member of` with no collection.
  assert.deepEqual(codesOf("print :x is member 5"), ["ol-bad-token"]);
  assert.deepEqual(codesOf("print :x is member of"), ["ol-bad-token"]);
  // `a` without a type word.
  assert.deepEqual(codesOf("print :x is a 5"), ["ol-bad-token"]);
  // `strictly` without `between`.
  assert.deepEqual(codesOf("print :x is strictly 1 and 10"), ["ol-bad-token"]);
  // `between` with a missing low, missing `and`, or missing high.
  assert.deepEqual(codesOf("print :x is between"), ["ol-bad-token"]);
  assert.deepEqual(codesOf("print :x is between 1 10"), ["ol-bad-token"]);
  assert.deepEqual(codesOf("print :x is between 1 and"), ["ol-bad-token"]);
  // The operand is returned unchanged on error, so recovery keeps parsing.
  const r = parse("print :x is wibble");
  assert.equal(r.ast.body[0].callee.name, "print");
});

// --- Assignment -------------------------------------------------------------

test("parses a bare variable and a comparison that both start with a colon var", () => {
  assert.equal(parse(":x\nprint 1").ast.body[0].kind, "VarRef");
  assert.equal(parse(":x < 1").ast.body[0].callee.name, "<");
});

test("parses dotted places for reads and both assignment forms", () => {
  // A dotted read grows the bare variable into a Place with spanned field segments.
  const read = firstArg("print :a.b.c");
  assert.equal(read.kind, "Place");
  assert.equal(read.base.name, "a");
  assert.equal(read.segments.length, 2);
  assert.equal(read.segments[0].kind, "field");
  assert.equal(read.segments[0].name.name, "b");
  assert.equal(read.segments[1].name.name, "c");
  assert.deepEqual(read.segments[0].name.source_span, {
    document: doc,
    start: [1, 10],
    end: [1, 11],
  });

  // A plain `:a` with no dot stays a bare VarRef.
  assert.equal(firstArg("print :a").kind, "VarRef");

  // Colon-assignment onto a dotted target.
  let assign = parse(":a.b = 1").ast.body[0];
  assert.equal(assign.kind, "Assign");
  assert.equal(assign.form, "equals");
  assert.equal(assign.place.base.name, "a");
  assert.equal(assign.place.segments[0].name.name, "b");

  // `set … to` onto a dotted target.
  assign = parse("set a.b to 1").ast.body[0];
  assert.equal(assign.form, "set");
  assert.equal(assign.place.base.name, "a");
  assert.equal(assign.place.segments.length, 1);
  assert.equal(assign.place.segments[0].name.name, "b");
});

test("parses local declarations in bare and parenthesized forms", () => {
  let local = parse("local total").ast.body[0];
  assert.equal(local.kind, "Local");
  assert.equal(local.names.length, 1);
  assert.equal(local.names[0].name, "total");
  assert.deepEqual(local.names[0].source_span, {
    document: doc,
    start: [1, 7],
    end: [1, 12],
  });

  local = parse("(local a b c)").ast.body[0];
  assert.equal(local.kind, "Local");
  assert.deepEqual(
    local.names.map((n) => n.name),
    ["a", "b", "c"],
  );
});

test("reports malformed local declarations", () => {
  assert.deepEqual(codesOf("local 5"), ["ol-bad-token"]); // name not an identifier
  assert.deepEqual(codesOf("local"), ["ol-bad-token"]); // missing name at eof
  assert.deepEqual(codesOf("(local)"), ["ol-bad-token"]); // no names in the group
  assert.deepEqual(codesOf("(local a"), ["ol-unmatched-paren"]); // group never closed
});

test("reports assignment errors for both forms", () => {
  assert.deepEqual(codesOf("set 5"), ["ol-bad-token"]); // target not a name
  assert.deepEqual(codesOf("set x"), ["ol-bad-token"]); // missing `to`
  assert.deepEqual(codesOf("set x to"), ["ol-bad-token"]); // value missing
  assert.deepEqual(codesOf(":x ="), ["ol-bad-token"]); // colon value missing
});

// --- Control forms: while / repeat / forever -------------------------------

test("parses control forms with both bracket and long-block bodies", () => {
  assert.equal(parse("repeat 3\n print 1\nend").ast.body[0].kind, "Repeat");
  assert.equal(parse("while true [ print 1 ]").ast.body[0].kind, "While");
  assert.equal(parse("while true\n print 1\nend").ast.body[0].kind, "While");
  assert.equal(parse("forever [ print 1 ]").ast.body[0].kind, "Forever");
  assert.equal(parse("forever\n stop\nend").ast.body[0].kind, "Forever");

  // A matching label after `end` is accepted and consumed.
  assert.deepEqual(parse("repeat 2\n print 1\nend repeat").diagnostics, []);
  // A label that names a different open block is reported (P4b).
  assert.deepEqual(codesOf("repeat 1\n print 1\nend if"), [
    "ol-mismatched-end",
  ]);
  // A non-label name after `end` starts a new statement, and the run-on is flagged.
  const after = parse("repeat 2\n print 1\nend foo");
  assert.deepEqual(
    after.diagnostics.map((d) => d.code),
    ["ol-bad-token"],
  );
  assert.equal(after.ast.body[1].callee.name, "foo");
});

test("reports missing end and missing bodies for control forms", () => {
  assert.deepEqual(codesOf("repeat 3\n print 1"), ["ol-missing-end"]);
  assert.deepEqual(codesOf("while true\n print 1"), ["ol-missing-end"]);
  assert.deepEqual(codesOf("repeat"), ["ol-bad-token"]); // count missing
  assert.deepEqual(codesOf("while"), ["ol-bad-token"]); // condition missing
  assert.deepEqual(codesOf("repeat 3 foo"), ["ol-missing-end"]);
  assert.deepEqual(codesOf("while true foo"), ["ol-missing-end"]);
  assert.deepEqual(codesOf("forever foo"), ["ol-missing-end"]);
});

test("recovers from a stray token inside bracket and long blocks", () => {
  assert.deepEqual(codesOf("repeat 2 [ ) ]"), ["ol-unmatched-paren"]);
  assert.deepEqual(codesOf("while true\n )\nend"), ["ol-unmatched-paren"]);
  // A bracket block (a control body, not a list) that is never closed.
  assert.deepEqual(codesOf("repeat 3 [ print 1"), ["ol-unmatched-bracket"]);
  // A stray token in each arm of a long-form if resynchronizes.
  assert.deepEqual(codesOf("if 1\n )\nend"), ["ol-unmatched-paren"]);
  assert.deepEqual(codesOf("if 1\n a\nelse\n )\nend"), ["ol-unmatched-paren"]);
});

// --- if / else --------------------------------------------------------------

test("parses if in bracket and long-block shapes, with and without else", () => {
  let r = parse("if 1 [ print 1 ] else [ print 2 ]");
  assert.equal(r.ast.body[0].kind, "If");
  assert.equal(r.ast.body[0].elseBody.body.length, 1);

  assert.equal(parse("if 1 [ print 1 ]").ast.body[0].elseBody, undefined);

  r = parse("if 1\n print 1\nelse\n print 2\nend if");
  assert.equal(r.ast.body[0].kind, "If");
  assert.ok(r.ast.body[0].elseBody);

  assert.equal(parse("if 1\n print 1\nend if").ast.body[0].elseBody, undefined);
  assert.equal(parse("if 1\n print 1\nend").ast.body[0].elseBody, undefined);
  assert.ok(parse("if 1\n a\nelse\n b\nend").ast.body[0].elseBody);
});

test("reports malformed if statements", () => {
  assert.deepEqual(codesOf("if"), ["ol-bad-token"]); // condition missing
  // else head is not a block; the run-on `foo` is suppressed as a cascade of the same bad line.
  assert.deepEqual(codesOf("if 1 [ ] else foo"), ["ol-bad-token"]);
  assert.deepEqual(codesOf("if 1 foo"), ["ol-missing-end"]); // no block after condition
  assert.deepEqual(codesOf("if 1\n print 1"), ["ol-missing-end"]); // then hits eof
  assert.deepEqual(codesOf("if 1\n print 1\nelse\n print 2"), [
    "ol-missing-end",
  ]); // else hits eof
});

// --- Procedures -------------------------------------------------------------

test("parses procedure definitions with required and optional params", () => {
  let r = parse("define sum :a :b\n return :a + :b\nend");
  assert.deepEqual(r.diagnostics, []);
  let def = r.ast.body[0];
  assert.equal(def.kind, "ProcedureDef");
  assert.equal(def.params.length, 2);
  assert.equal(def.params[0].name.name, "a");
  assert.equal(def.params[1].name.name, "b");
  // Required params carry their own span for the checker to point at.
  assert.deepEqual(def.params[0].name.source_span, {
    document: doc,
    start: [1, 12],
    end: [1, 14],
  });

  r = parse('define greet :name ( :greeting "hi" )\n print :greeting\nend');
  def = r.ast.body[0];
  assert.equal(def.params.length, 2);
  assert.equal(def.params[1].name.name, "greeting");
  assert.equal(def.params[1].defaultValue.value, "hi");
});

test("handles procedure header edge cases", () => {
  // An optional param with no default value is accepted but flagged (a default is required).
  let r = parse("define f ( :x )\n stop\nend");
  assert.equal(r.ast.body[0].params[0].name.name, "x");
  assert.equal(r.ast.body[0].params[0].defaultValue, undefined);
  assert.deepEqual(
    r.diagnostics.map((d) => d.code),
    ["ol-bad-token"],
  );

  // Unmatched paren around an optional param.
  assert.ok(
    codesOf("define f ( :x 1\n stop\nend").includes("ol-unmatched-paren"),
  );

  // `(` not followed by a variable is not an optional param; missing newline -> missing-end.
  assert.deepEqual(codesOf("define f ( 1 )"), ["ol-missing-end"]);

  // No params at all.
  assert.equal(parse("define f\n stop\nend").ast.body[0].params.length, 0);

  // Name token must be a name.
  assert.deepEqual(codesOf("define 5"), ["ol-bad-token"]);

  // Header without a following newline.
  assert.deepEqual(codesOf("define f :a"), ["ol-missing-end"]);

  // A non-label name after the closing `end` starts a new statement, and the run-on is flagged.
  r = parse("define f\n stop\nend g");
  assert.deepEqual(
    r.diagnostics.map((d) => d.code),
    ["ol-bad-token"],
  );
  assert.equal(r.ast.body[1].callee.name, "g");
});

// --- return / stop / throw --------------------------------------------------

test("parses return, stop, and throw", () => {
  let r = parse("define f\n return 5\nend");
  const ret = r.ast.body[0].body.body[0];
  assert.equal(ret.kind, "Return");
  assert.equal(ret.keyword, "return");
  assert.equal(ret.value.value, 5);

  r = parse("define f\n stop\nend");
  assert.equal(r.ast.body[0].body.body[0].kind, "Stop");

  r = parse("throw 42");
  assert.equal(r.ast.body[0].kind, "Throw");
  assert.equal(r.ast.body[0].value.value, 42);

  assert.deepEqual(codesOf("return"), ["ol-bad-token"]); // value missing
  assert.deepEqual(codesOf("throw"), ["ol-bad-token"]); // value missing
});

// --- Top-level recovery -----------------------------------------------------

test("reports a stray end or else that closes nothing", () => {
  let d = parse("end").diagnostics;
  assert.equal(d.length, 1);
  assert.equal(d[0].code, "ol-mismatched-end");
  assert.equal(d[0].params.expected, "block");
  assert.equal(d[0].params.actual, "end");

  d = parse("else").diagnostics;
  assert.equal(d[0].code, "ol-mismatched-end");
  assert.equal(d[0].params.expected, "if");
  assert.equal(d[0].params.actual, "else");
});

// --- for / in and for / from-to-by -----------------------------------------

test("parses for-in and for-range loops", () => {
  let r = parse("for x in [1 2] [ print :x ]");
  assert.equal(r.ast.body[0].kind, "ForIn");
  assert.equal(r.ast.body[0].binder.name, "x");

  r = parse("for i from 1 to 5 [ print :i ]");
  assert.equal(r.ast.body[0].kind, "ForRange");
  assert.equal(r.ast.body[0].by, undefined);

  r = parse("for i from 1 to 5 by 2 [ print :i ]");
  assert.equal(r.ast.body[0].by.value, 2);

  // Long-block bodies for both shapes.
  assert.equal(parse("for x in [1]\n print :x\nend").ast.body[0].kind, "ForIn");
  assert.equal(
    parse("for i from 1 to 3\n print :i\nend").ast.body[0].kind,
    "ForRange",
  );
});

test("reports malformed for loops", () => {
  assert.deepEqual(codesOf("for 5"), ["ol-bad-token"]); // loop var not a name
  assert.deepEqual(codesOf("for x foo"), ["ol-bad-token"]); // neither in nor from
  assert.deepEqual(codesOf("for x in"), ["ol-bad-token"]); // iterable missing
  assert.deepEqual(codesOf("for x in [1] foo"), ["ol-missing-end"]); // no body
  assert.deepEqual(codesOf("for x from"), ["ol-bad-token"]); // from value missing
  assert.deepEqual(codesOf("for x from 1 foo"), ["ol-bad-token"]); // missing `to`
  assert.deepEqual(codesOf("for x from 1 to"), ["ol-bad-token"]); // to value missing
  assert.deepEqual(codesOf("for x from 1 to 5 by"), ["ol-bad-token"]); // step missing
  assert.deepEqual(codesOf("for x from 1 to 5 foo"), ["ol-missing-end"]); // no body
});

// Per spec/grammar.md:136-137,333-335: `for … in`'s binder may also be a destructuring
// `[ :name { :name } ]` pattern, distinct from `for … from … to …`'s bare-name variable.
test("parses a destructuring `for [:x :y] in <expr>` binder", () => {
  let r = parse("for [:x :y] in [1] [ print :x ]");
  assert.equal(r.ast.body[0].kind, "ForIn");
  assert.equal(r.ast.body[0].binder.kind, "DestructuringBinder");
  assert.deepEqual(
    r.ast.body[0].binder.names.map((n) => n.name),
    ["x", "y"],
  );

  // One-or-more: a single name is valid.
  r = parse("for [:x] in [1] [ print :x ]");
  assert.deepEqual(
    r.ast.body[0].binder.names.map((n) => n.name),
    ["x"],
  );

  // Long-block body works the same as the bare-name form.
  assert.equal(
    parse("for [:x :y] in :pts\n print :x\nend").ast.body[0].kind,
    "ForIn",
  );
});

test("reports malformed destructuring for-in binders", () => {
  // No names inside the brackets at all (empty pattern) — reported at the closing `]`.
  assert.equal(codesOf("for [] in [1] [ print 1 ]")[0], "ol-unmatched-bracket");
  // A bare (non-colon) name inside the brackets isn't a valid destructuring name.
  assert.equal(codesOf("for [x] in [1] [ print 1 ]")[0], "ol-bad-token");
  // Unclosed pattern.
  assert.equal(
    codesOf("for [:x :y in [1] [ print 1 ]")[0],
    "ol-unmatched-bracket",
  );
  // Missing `in` after a well-formed pattern.
  assert.deepEqual(codesOf("for [:x] foo"), ["ol-bad-token"]);
  // Missing iterable after `in`.
  assert.deepEqual(codesOf("for [:x] in"), ["ol-bad-token"]);
  // Missing body.
  assert.deepEqual(codesOf("for [:x] in [1] foo"), ["ol-missing-end"]);
});

// --- Arity resolution -------------------------------------------------------

test("groups arguments by arity and treats unknown names as zero-arity", () => {
  const e = firstArg('print word "a" "b"');
  assert.equal(e.callee.name, "word");
  assert.equal(e.args.length, 2);

  let r = parse("wibble");
  assert.equal(r.ast.body[0].callee.name, "wibble");
  assert.equal(r.ast.body[0].args.length, 0);

  r = parse("randomize");
  assert.equal(r.ast.body[0].callee.name, "randomize");
  assert.equal(r.ast.body[0].args.length, 0);

  // A forward reference: the call precedes the define, but the pre-scan finds the arity.
  r = parse("double 5\ndefine double :n\n return :n + :n\nend");
  assert.deepEqual(r.diagnostics, []);
  assert.equal(r.ast.body[0].callee.name, "double");
  assert.equal(r.ast.body[0].args.length, 1);
});

// --- Public registries ------------------------------------------------------

test("exposes the reserved-word registry", () => {
  assert.ok(OL.isReservedWord("define"));
  assert.ok(OL.isReservedWord("REPEAT"));
  assert.equal(OL.isReservedWord("wibble"), false);
  assert.ok(OL.OL_RESERVED_WORDS.includes("map"));
});

test("exposes the core primitive arities", () => {
  assert.equal(OL.corePrimitiveArity("print"), 1);
  assert.equal(OL.corePrimitiveArity("PRINT"), 1);
  assert.equal(OL.corePrimitiveArity("wibble"), undefined);
  assert.equal(OL.corePrimitiveArity("power"), 2);
});

test("exposes the turtle & rendering primitive arities", () => {
  assert.equal(OL.turtlePrimitiveArity("forward"), 1);
  assert.equal(OL.turtlePrimitiveArity("FORWARD"), 1);
  assert.equal(OL.turtlePrimitiveArity("wibble"), undefined);
  assert.equal(OL.turtlePrimitiveArity("set_xy"), 2);
  assert.equal(OL.turtlePrimitiveArity("home"), 0);
});

test("exposes the data profile's derived list reporter arities (issue #190)", () => {
  assert.equal(OL.dataPrimitiveArity("reverse"), 1);
  assert.equal(OL.dataPrimitiveArity("PICK"), 1);
  assert.equal(OL.dataPrimitiveArity("sort"), 1);
  assert.equal(OL.dataPrimitiveArity("wibble"), undefined);
});

// --- AST walker -------------------------------------------------------------

const MEGA = [
  ":x = 1",
  "local total",
  'print "a"',
  "print true",
  "print [1 2][1]",
  "print [1 2]",
  "print :x",
  "print :x is empty",
  "print 1 < :x < 10",
  "print (sentence 1 2)",
  "if :x [ print 1 ] else [ print 2 ]",
  "while :x [ print 1 ]",
  "repeat 3 [ print 1 ]",
  "forever [ stop ]",
  "for i in [1 2] [ print :i ]",
  "for [:x :y] in [1 2] [ print :x ]",
  "for i from 1 to 5 by 2 [ print :i ]",
  "print map n in [1 2] [ :n ]",
  "print reduce a n in [1 2] from 0 [ :a ]",
  "define f :p ( :q 1 )\n return :p\nend",
  "throw 9",
  "print { a: 1 }",
  'print value of :x for key "a"',
  "add 3 to :x",
  "remove 3 from :x",
  'remove key "a" from :x',
  "insert 3 in :x at 0",
  "clear :x",
  "struct point [ p q ]",
].join("\n");

test("walk visits every core node kind, pre-order", () => {
  const { ast, diagnostics } = parse(MEGA);
  assert.deepEqual(diagnostics, []);

  const kinds = new Set();
  OL.walk(ast, (node) => kinds.add(node.kind));
  for (const kind of OL.OL_NODE_KINDS) {
    assert.ok(kinds.has(kind), `walk should visit ${kind}`);
  }
});

test("walk descends the optional-child branches when they are absent", () => {
  // If with no else, ForRange with no by, map with no seed, define with no params:
  // each exercises the `=== undefined` arm of childrenOf.
  for (const src of [
    "if 1 [ print 1 ]",
    "for i from 1 to 3 [ stop ]",
    "print map n in [1] [ :n ]",
    "define f\n stop\nend",
  ]) {
    let visited = 0;
    OL.walk(parse(src).ast, () => {
      visited += 1;
    });
    assert.ok(visited > 0);
  }
});

test("every node in a full program carries a well-formed span", () => {
  const { ast } = parse(MEGA);
  OL.walk(ast, (node) => {
    const s = node.source_span;
    assert.equal(s.document, doc);
    assert.equal(s.start.length, 2);
    assert.equal(s.end.length, 2);
    const [sl, sc] = s.start;
    const [el, ec] = s.end;
    assert.ok(sl >= 1 && sc >= 1);
    assert.ok(el > sl || (el === sl && ec >= sc));
  });
});
