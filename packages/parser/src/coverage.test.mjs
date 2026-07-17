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
  // `1e` with no exponent digit: number 1, then the bare name `e`.
  let r = parse("print 1e");
  assert.deepEqual(r.diagnostics, []);
  assert.equal(r.ast.body[0].args[0].value, 1);
  assert.equal(r.ast.body[1].callee, "e");

  // `3.x`: the dot is not a decimal point (no digit follows), so it is a stray dot token.
  r = parse("print 3.x");
  assert.equal(r.ast.body[0].args[0].value, 3);
  assert.ok(codesOf("print 3.x").includes("ol-bad-token"));

  // `1.` at end of input: number 1 then a stray dot.
  r = parse("print 1.");
  assert.equal(r.ast.body[0].args[0].value, 1);
  assert.deepEqual(codesOf("print 1."), ["ol-bad-token"]);
});

// --- Lexer: names and variables --------------------------------------------

test("lexes names and variables with ? and ! suffixes", () => {
  assert.equal(parse("empty? [1]").ast.body[0].callee, "empty?");
  assert.equal(firstArg("print reset!").callee, "reset!");

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

test("lexes braces even though the core parser has no use for them", () => {
  // `{` has no primary; `}` closes nothing — each becomes a bad-token during recovery.
  assert.deepEqual(codesOf("{ }"), ["ol-bad-token", "ol-bad-token"]);
});

// --- Expressions: operators and precedence ---------------------------------

test("parses every comparison operator", () => {
  for (const op of ["==", "!=", "<", ">", "<=", ">="]) {
    const e = firstArg(`print 1 ${op} 2`);
    assert.equal(e.kind, "Call");
    assert.equal(e.callee, op);
    assert.equal(e.args[0].value, 1);
    assert.equal(e.args[1].value, 2);
  }
});

test("parses or, and, not, subtraction, division, and mod", () => {
  assert.equal(firstArg("print true or false").callee, "or");
  assert.equal(firstArg("print true and false").callee, "and");
  assert.equal(firstArg("print not true").callee, "not");
  assert.equal(firstArg("print 5 - 2").callee, "-");
  assert.equal(firstArg("print 6 / 2").callee, "/");
  assert.equal(firstArg("print 7 mod 3").callee, "mod");

  // or/and fold left as the chain grows.
  assert.equal(firstArg("print true or false or true").args[0].callee, "or");
  assert.equal(firstArg("print true and false and true").args[0].callee, "and");
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

test("labels the unexpected token as line end, file end, or its text", () => {
  assert.equal(parse(":x =\n5").diagnostics[0].params.text, "end of line");
  assert.equal(parse(":x =").diagnostics[0].params.text, "end of file");
  assert.equal(parse(":x = ]").diagnostics[0].params.text, "]");
});

test("reads a stray leading minus that is not a negative literal", () => {
  // `-` followed by a non-number is the minus operator with nothing to bind to.
  assert.deepEqual(codesOf("print -"), ["ol-bad-token"]);
  assert.deepEqual(codesOf("print - true"), ["ol-bad-token"]);
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
  assert.deepEqual(codesOf("print [1 )]"), ["ol-bad-token"]);
});

// --- Parenthesized calls and groups ----------------------------------------

test("parses parenthesized calls and grouped expressions", () => {
  const pc = firstArg("print (sentence 1 2 3)");
  assert.equal(pc.kind, "ParenCall");
  assert.equal(pc.callee, "sentence");
  assert.equal(pc.args.length, 3);

  assert.equal(firstArg("print (1 + 2)").callee, "+");
  assert.equal(firstArg("print (sentence\n1\n2)").args.length, 2);
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
  assert.equal(grouped.callee, "not");
});

test("reports an unmatched ( for calls and groups", () => {
  assert.deepEqual(codesOf("print (sentence 1 2"), ["ol-unmatched-paren"]);
  assert.deepEqual(codesOf("print (1 2"), ["ol-unmatched-paren"]);
  assert.deepEqual(codesOf("print (sentence ] 1 2)"), ["ol-bad-token"]);
});

// --- Comprehensions ---------------------------------------------------------

test("parses map, filter, and reduce comprehensions", () => {
  let c = firstArg("print map x in [1 2 3] [ :x ]");
  assert.equal(c.kind, "Comprehension");
  assert.equal(c.form, "map");
  assert.equal(c.binder, "x");
  assert.equal(c.iterable.kind, "ListLit");
  assert.equal(c.accumulator, undefined);
  assert.equal(c.initial, undefined);

  assert.equal(firstArg("print filter x in [1 2 3] [ :x ]").form, "filter");

  c = firstArg("print reduce acc x in [1 2 3] from 0 [ :acc ]");
  assert.equal(c.form, "reduce");
  assert.equal(c.accumulator, "acc");
  assert.equal(c.initial.value, 0);
});

test("reports comprehension syntax errors", () => {
  assert.deepEqual(codesOf("print reduce 5"), ["ol-bad-token"]); // accumulator not a name
  assert.deepEqual(codesOf("print map 5"), ["ol-bad-token"]); // binder not a name
  assert.deepEqual(codesOf("print map x"), ["ol-bad-token"]); // missing `in`
  assert.deepEqual(codesOf("print map x in"), ["ol-bad-token"]); // iterable missing
  assert.deepEqual(codesOf("print reduce acc x in [1]"), ["ol-bad-token"]); // missing `from`
  assert.deepEqual(codesOf("print reduce acc x in [1] from"), ["ol-bad-token"]); // seed missing
  assert.deepEqual(codesOf("print map x in [1]"), ["ol-missing-end"]); // no bracket body
});

// --- Assignment -------------------------------------------------------------

test("parses a bare variable and a comparison that both start with a colon var", () => {
  assert.equal(parse(":x\nprint 1").ast.body[0].kind, "VarRef");
  assert.equal(parse(":x < 1").ast.body[0].callee, "<");
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
  // A non-label name after `end` starts a new statement instead.
  const after = parse("repeat 2\n print 1\nend foo");
  assert.deepEqual(after.diagnostics, []);
  assert.equal(after.ast.body[1].callee, "foo");
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
  assert.deepEqual(codesOf("repeat 2 [ ) ]"), ["ol-bad-token"]);
  assert.deepEqual(codesOf("while true\n )\nend"), ["ol-bad-token"]);
  // A bracket block (a control body, not a list) that is never closed.
  assert.deepEqual(codesOf("repeat 3 [ print 1"), ["ol-unmatched-bracket"]);
  // A stray token in each arm of a long-form if resynchronizes.
  assert.deepEqual(codesOf("if 1\n )\nend"), ["ol-bad-token"]);
  assert.deepEqual(codesOf("if 1\n a\nelse\n )\nend"), ["ol-bad-token"]);
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
  assert.deepEqual(codesOf("if 1 [ ] else foo"), ["ol-bad-token"]); // else not a block
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
  assert.equal(def.params[0].name, "a");
  assert.equal(def.params[1].name, "b");

  r = parse('define greet :name ( :greeting "hi" )\n print :greeting\nend');
  def = r.ast.body[0];
  assert.equal(def.params.length, 2);
  assert.equal(def.params[1].name, "greeting");
  assert.equal(def.params[1].defaultValue.value, "hi");
});

test("handles procedure header edge cases", () => {
  // Optional param with no default value.
  let r = parse("define f ( :x )\n stop\nend");
  assert.equal(r.ast.body[0].params[0].name, "x");
  assert.equal(r.ast.body[0].params[0].defaultValue, undefined);

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

  // A non-label name after the closing `end`.
  r = parse("define f\n stop\nend g");
  assert.deepEqual(r.diagnostics, []);
  assert.equal(r.ast.body[1].callee, "g");
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
  assert.equal(r.ast.body[0].binder, "x");

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

// --- Arity resolution -------------------------------------------------------

test("groups arguments by arity and treats unknown names as zero-arity", () => {
  const e = firstArg('print word "a" "b"');
  assert.equal(e.callee, "word");
  assert.equal(e.args.length, 2);

  let r = parse("wibble");
  assert.equal(r.ast.body[0].callee, "wibble");
  assert.equal(r.ast.body[0].args.length, 0);

  r = parse("randomize");
  assert.equal(r.ast.body[0].callee, "randomize");
  assert.equal(r.ast.body[0].args.length, 0);

  // A forward reference: the call precedes the define, but the pre-scan finds the arity.
  r = parse("double 5\ndefine double :n\n return :n + :n\nend");
  assert.deepEqual(r.diagnostics, []);
  assert.equal(r.ast.body[0].callee, "double");
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
  assert.equal(OL.CORE_PRIMITIVE_ARITY.get("power"), 2);
});

// --- AST walker -------------------------------------------------------------

const MEGA = [
  ":x = 1",
  'print "a"',
  "print true",
  "print [1 2]",
  "print :x",
  "print (sentence 1 2)",
  "if :x [ print 1 ] else [ print 2 ]",
  "while :x [ print 1 ]",
  "repeat 3 [ print 1 ]",
  "forever [ stop ]",
  "for i in [1 2] [ print :i ]",
  "for i from 1 to 5 by 2 [ print :i ]",
  "print map n in [1 2] [ :n ]",
  "print reduce a n in [1 2] from 0 [ :a ]",
  "define f :p ( :q 1 )\n return :p\nend",
  "throw 9",
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
