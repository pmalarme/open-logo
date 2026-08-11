// Unit tests for the OpenLogo reader/parser (issue #9). They exercise the public
// `parse` surface end to end — the lexer is internal, so its behaviour (spans,
// comments, unclosed strings) is proven through `parse`. Spans are half-open
// `[start, end)` with 1-based `[line, column]` positions, per @openlogo/core.
//
// These run under `node --test` against the built package, so they import the
// same `@openlogo/parser` entry that downstream packages consume.

import assert from "node:assert/strict";
import { test } from "node:test";
import * as OL from "@openlogo/parser";

const doc = "acceptance.logo";
const span = (start, end) => ({ document: doc, start, end });

test("parses an assignment and print into a spanned AST", () => {
  const { ast, diagnostics } = OL.parse(":size = 100\nprint :size", doc);

  assert.deepEqual(diagnostics, []);
  assert.equal(ast.kind, "Program");
  assert.equal(ast.body.length, 2);

  const assign = ast.body[0];
  assert.equal(assign.kind, "Assign");
  assert.equal(assign.form, "equals");
  assert.equal(assign.place.kind, "Place");
  assert.equal(assign.place.base.name, "size");
  assert.deepEqual(assign.place.base.source_span, span([1, 1], [1, 6]));
  assert.deepEqual(assign.place.segments, []);
  assert.deepEqual(assign.place.source_span, span([1, 1], [1, 6]));
  assert.equal(assign.value.kind, "NumberLit");
  assert.equal(assign.value.value, 100);
  assert.deepEqual(assign.value.source_span, span([1, 9], [1, 12]));
  assert.deepEqual(assign.source_span, span([1, 1], [1, 12]));

  const call = ast.body[1];
  assert.equal(call.kind, "Call");
  assert.equal(call.callee.name, "print");
  assert.deepEqual(call.callee.source_span, span([2, 1], [2, 6]));
  assert.equal(call.args.length, 1);
  assert.equal(call.args[0].kind, "VarRef");
  assert.equal(call.args[0].name, "size");
  assert.deepEqual(call.args[0].source_span, span([2, 7], [2, 12]));
  assert.deepEqual(call.source_span, span([2, 1], [2, 12]));
});

test('reports ol-unclosed-string for make "size without throwing', () => {
  let result;
  assert.doesNotThrow(() => {
    result = OL.parse('make "size', doc);
  });

  // The lexer reports the unterminated string, which consumed the rest of the line where the
  // `make` special form expected its `word-literal` target. That single diagnostic already
  // explains the fault, so `make` must NOT stack a redundant `ol-bad-token` on top of it —
  // `spec/error-model.md:109` reserves `ol-bad-token` for when no more-specific diagnostic
  // applies (cf. `print "abc`, which likewise yields only `ol-unclosed-string`).
  assert.equal(result.diagnostics.length, 1);
  const [unclosed] = result.diagnostics;
  assert.equal(unclosed.code, "ol-unclosed-string");
  assert.equal(unclosed.stage, "parse");
  assert.equal(unclosed.severity, "error");
  assert.deepEqual(unclosed.source_span, span([1, 6], [1, 7]));

  // A best-effort tree is still returned alongside the diagnostic; the malformed `make`
  // yields no statement node (recovery consumed the line), so the program body is empty.
  assert.equal(result.ast.kind, "Program");
  assert.equal(result.ast.body.length, 0);
});

test('reports a parse error for make "name" with no value expression', () => {
  // `make-assignment ::= "make" word-literal expression` (spec/grammar.md:105) requires a value
  // after the name; its absence is `ol-bad-token`, and the malformed statement yields no node.
  const { ast, diagnostics } = OL.parse('make "x"', doc);

  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].code, "ol-bad-token");
  assert.equal(diagnostics[0].stage, "parse");
  assert.equal(ast.body.length, 0);
});

test("reports ol-bad-token for a make target that is not a word literal", () => {
  // `make 5` supplies a real (non-word) token where the `word-literal` target is required. Unlike
  // the unclosed-string case, no earlier diagnostic covers that slot, so `make` DOES report the
  // wrong token (`spec/error-model.md:109`) — the `lexDiagnosticInGap` suppression must not
  // swallow a genuine wrong-token target.
  const { diagnostics } = OL.parse("make 5", doc);

  const makeDiag = diagnostics.find((d) => d.code === "ol-bad-token");
  assert.ok(makeDiag, "expected an ol-bad-token for the non-word make target");
  assert.equal(makeDiag.stage, "parse");
});

test("still reports a bad make target when a later lexer error follows on the line", () => {
  // The suppression window is bounded on *both* sides: an unclosed string that appears *after* the
  // target slot (`make 5 "oops`) must not hide the invalid `5` target. Both diagnostics are
  // expected — the later `ol-unclosed-string` AND the target's `ol-bad-token` — because the
  // unclosed string does not sit in the gap between `make` and its (present but wrong) target.
  const { diagnostics } = OL.parse('make 5 "oops', doc);

  const codes = diagnostics.map((d) => d.code);
  assert.ok(
    codes.includes("ol-unclosed-string"),
    "expected the later unclosed string to still be reported",
  );
  assert.ok(
    codes.includes("ol-bad-token"),
    "expected the invalid non-word target to still be reported",
  );
});

test("reports ol-bad-token for a bare make with no target", () => {
  // A lone `make` at end of input has no target and no preceding lexer diagnostic, so the missing
  // word-literal is reported directly — the suppression only applies when the lexer already
  // consumed the target slot (e.g. an unclosed string).
  const { ast, diagnostics } = OL.parse("make", doc);

  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].code, "ol-bad-token");
  assert.equal(diagnostics[0].stage, "parse");
  assert.equal(ast.body.length, 0);
});

test("suppresses the redundant ol-bad-token for a multiline unclosed make target", () => {
  // A triple-quoted string runs to end of input across lines, so the `eof`/`newline` slot token
  // that `make` sees can land on a *later, shorter* line than where the string opened. The
  // suppression window is compared lexicographically (line then column), so `make """size` + a
  // short next line still yields ONLY `ol-unclosed-string` — never a redundant cascade
  // (`spec/error-model.md:109`).
  const { diagnostics } = OL.parse('make """size\nx', doc);

  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].code, "ol-unclosed-string");
  assert.equal(diagnostics[0].stage, "parse");
});

test('parses the heritage make "name" value assignment like set … to', () => {
  const { ast, diagnostics } = OL.parse('make "size" 120', doc);

  assert.deepEqual(diagnostics, []);
  const assign = ast.body[0];
  assert.equal(assign.kind, "Assign");
  assert.equal(assign.form, "make");
  // The word literal's value becomes the base name of a zero-segment place — the exact same
  // shape `set size to 120` builds — so the runtime's shared executeAssign binds it identically.
  assert.equal(assign.place.kind, "Place");
  assert.equal(assign.place.base.name, "size");
  assert.deepEqual(assign.place.segments, []);
  assert.equal(assign.value.kind, "NumberLit");
  assert.equal(assign.value.value, 120);
  // The statement span runs from `make` through the value expression.
  assert.deepEqual(assign.source_span, span([1, 1], [1, 16]));
  // The place span is the word literal's span (`"size"`).
  assert.deepEqual(assign.place.source_span, span([1, 6], [1, 12]));
});

test("assigns with the set ... to form", () => {
  const { ast, diagnostics } = OL.parse("set size to 100", doc);

  assert.deepEqual(diagnostics, []);
  const assign = ast.body[0];
  assert.equal(assign.kind, "Assign");
  assert.equal(assign.form, "set");
  assert.equal(assign.place.base.name, "size");
  assert.equal(assign.value.value, 100);
});

test("reads a list literal", () => {
  const { ast, diagnostics } = OL.parse("print [1 2 3]", doc);

  assert.deepEqual(diagnostics, []);
  const list = ast.body[0].args[0];
  assert.equal(list.kind, "ListLit");
  const values = list.elements.map((element) => element.value);
  assert.deepEqual(values, [1, 2, 3]);
});

test("groups a fixed-arity word/list reporter as one call, not stray statements", () => {
  // Regression: before `count` had a default arity it fell back to 0, so it
  // gathered no inputs and `[1 2 3]` silently became a second, stray statement
  // with no diagnostic. It must read as a single `print (count [1 2 3])`.
  const { ast, diagnostics } = OL.parse("print count [1 2 3]", doc);

  assert.deepEqual(diagnostics, []);
  assert.equal(ast.body.length, 1);
  const print = ast.body[0];
  assert.equal(print.callee.name, "print");
  assert.equal(print.args.length, 1);
  const count = print.args[0];
  assert.equal(count.kind, "Call");
  assert.equal(count.callee.name, "count");
  assert.equal(count.args.length, 1);
  assert.equal(count.args[0].kind, "ListLit");

  // A two-input reporter gathers both inputs into the same statement.
  const two = OL.parse("fput 1 [2 3]", doc);
  assert.deepEqual(two.diagnostics, []);
  assert.equal(two.ast.body.length, 1);
  const fput = two.ast.body[0];
  assert.equal(fput.callee.name, "fput");
  assert.equal(fput.args.length, 2);
  assert.equal(fput.args[0].value, 1);
  assert.equal(fput.args[1].kind, "ListLit");
});

test("gathers the exact input count for every core word/list reporter", () => {
  // The seven names marked (new) were missing from the arity table; the four
  // originals are included so the whole `commands.md` word/list section is pinned.
  const oneInput = [
    "first",
    "last",
    "butfirst", // new
    "butlast", // new
    "count", // new
    "uppercase", // new
    "lowercase", // new
  ];
  for (const name of oneInput) {
    const { ast, diagnostics } = OL.parse(`print ${name} [1 2 3]`, doc);
    assert.deepEqual(
      diagnostics,
      [],
      `${name} should parse without diagnostics`,
    );
    assert.equal(ast.body.length, 1, `${name} should read as one statement`);
    const call = ast.body[0].args[0];
    assert.equal(call.callee.name, name);
    assert.equal(call.args.length, 1, `${name} takes one input`);
  }

  const twoInputs = [
    "word",
    "sentence",
    "fput", // new
    "lput", // new
  ];
  for (const name of twoInputs) {
    const { ast, diagnostics } = OL.parse(`print ${name} 1 [2 3]`, doc);
    assert.deepEqual(
      diagnostics,
      [],
      `${name} should parse without diagnostics`,
    );
    assert.equal(ast.body.length, 1, `${name} should read as one statement`);
    const call = ast.body[0].args[0];
    assert.equal(call.callee.name, name);
    assert.equal(call.args.length, 2, `${name} takes two inputs`);
  }
});

test("binds multiplication tighter than addition", () => {
  const { ast } = OL.parse("print 1 + 2 * 3", doc);

  const sum = ast.body[0].args[0];
  assert.equal(sum.kind, "Call");
  assert.equal(sum.callee.name, "+");
  assert.equal(sum.args[0].value, 1);

  const product = sum.args[1];
  assert.equal(product.callee.name, "*");
  assert.equal(product.args[0].value, 2);
  assert.equal(product.args[1].value, 3);
});

test("keeps a comparison chain as one node that stores each operand once", () => {
  // Regression (P2): `1 < :x < 10` must NOT desugar to `and(<(1,:x), <(:x,10))`, which would
  // alias `:x` into both comparisons and evaluate/walk a side-effecting middle operand twice.
  const { ast } = OL.parse("print 1 < :x < 10", doc);

  const chain = ast.body[0].args[0];
  assert.equal(chain.kind, "ComparisonChain");
  assert.equal(chain.operands.length, 3);
  assert.equal(chain.operators.length, 2);
  assert.equal(chain.operands[0].value, 1);
  assert.equal(chain.operands[1].kind, "VarRef");
  assert.equal(chain.operands[1].name, "x");
  assert.equal(chain.operands[2].value, 10);
  assert.equal(chain.operators[0].name, "<");
  assert.equal(chain.operators[1].name, "<");

  // The single shared operand object appears exactly once in the tree.
  const middle = chain.operands[1];
  let seen = 0;
  OL.walk(ast, (node) => {
    if (node === middle) {
      seen += 1;
    }
  });
  assert.equal(seen, 1);
});

test("keeps a single comparison as a plain call", () => {
  const { ast } = OL.parse("print 1 < 2", doc);
  const cmp = ast.body[0].args[0];
  assert.equal(cmp.kind, "Call");
  assert.equal(cmp.callee.name, "<");
  assert.equal(cmp.args[0].value, 1);
  assert.equal(cmp.args[1].value, 2);
});

test("parses repeat with a delimited block body", () => {
  const { ast, diagnostics } = OL.parse("repeat 3 [ print 1 ]", doc);

  assert.deepEqual(diagnostics, []);
  const loop = ast.body[0];
  assert.equal(loop.kind, "Repeat");
  assert.equal(loop.count.value, 3);
  assert.equal(loop.body.kind, "Block");
  assert.equal(loop.body.body.length, 1);
  assert.equal(loop.body.body[0].callee.name, "print");
});

test("binds a user arity from define for later calls", () => {
  const src = "define square :n\n  print :n\nend\nsquare 5";
  const { ast, diagnostics } = OL.parse(src, doc);

  assert.deepEqual(diagnostics, []);
  assert.equal(ast.body.length, 2);

  const def = ast.body[0];
  assert.equal(def.kind, "ProcedureDef");
  assert.equal(def.name.name, "square");
  assert.deepEqual(def.name.source_span, span([1, 8], [1, 14]));
  assert.equal(def.params.length, 1);
  assert.equal(def.params[0].name.name, "n");
  assert.deepEqual(def.params[0].name.source_span, span([1, 15], [1, 17]));
  assert.equal(def.body.kind, "Block");

  const call = ast.body[1];
  assert.equal(call.kind, "Call");
  assert.equal(call.callee.name, "square");
  assert.equal(call.args.length, 1);
  assert.equal(call.args[0].value, 5);
});

test("reads a negative numeric literal", () => {
  const { ast } = OL.parse("print -3", doc);

  const arg = ast.body[0].args[0];
  assert.equal(arg.kind, "NumberLit");
  assert.equal(arg.value, -3);
});

test("reads boolean and word literals", () => {
  const bool = OL.parse("print true", doc).ast.body[0].args[0];
  assert.equal(bool.kind, "BooleanLit");
  assert.equal(bool.value, true);

  const word = OL.parse('print "red"', doc).ast.body[0].args[0];
  assert.equal(word.kind, "WordLit");
  assert.equal(word.value, "red");
  assert.deepEqual(word.source_span, span([1, 7], [1, 12]));
});

test("treats line and block comments as whitespace", () => {
  const src = "# header\nprint 1 // trailing\n/* block */ print 2";
  const { ast, diagnostics } = OL.parse(src, doc);

  assert.deepEqual(diagnostics, []);
  assert.equal(ast.body.length, 2);
  assert.equal(ast.body[0].args[0].value, 1);
  assert.equal(ast.body[1].args[0].value, 2);
});

test("puts a well-formed source span on every node", () => {
  const { ast } = OL.parse(":size = 100\nprint :size", doc);

  let count = 0;
  OL.walk(ast, (node) => {
    count += 1;
    const s = node.source_span;
    assert.equal(s.document, doc);
    assert.equal(s.start.length, 2);
    assert.equal(s.end.length, 2);
    const [sl, sc] = s.start;
    const [el, ec] = s.end;
    assert.ok(sl >= 1 && sc >= 1);
    assert.ok(el > sl || (el === sl && ec >= sc));
  });

  // Program, Assign, Place, NumberLit, Call, VarRef.
  assert.equal(count, 6);
});

// #106/#148: parse()'s end-of-function dedup pass collapses diagnostics whose
// (code, source_span, params) triple is byte-identical to an earlier one, keeping the
// first occurrence. `message` is deliberately excluded from the identity key.
test("collapses a byte-identical duplicate ol-bad-token diagnostic for the same span (#148)", () => {
  const { diagnostics } = OL.parse("set :x to 100", doc);

  assert.equal(diagnostics.length, 2);
  assert.equal(diagnostics[0].params.text, ":x");
  assert.equal(diagnostics[1].code, "ol-bad-token");
  assert.equal(diagnostics[1].params.text, "to");
  assert.deepEqual(diagnostics[1].source_span, span([1, 8], [1, 10]));
});

test("collapses a byte-identical duplicate ol-bad-token diagnostic from `is member` recovery (#106)", () => {
  const { diagnostics } = OL.parse("print :x is member", doc);

  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].code, "ol-bad-token");
  assert.equal(diagnostics[0].params.text, "end of file");
});

test("preserves distinct-span diagnostics sharing the same code (no over-eager dedup)", () => {
  const { diagnostics } = OL.parse("print 1, 2", doc);

  assert.equal(diagnostics.length, 2);
  assert.equal(diagnostics[0].code, "ol-bad-token");
  assert.equal(diagnostics[1].code, "ol-bad-token");
  assert.notDeepEqual(diagnostics[0].source_span, diagnostics[1].source_span);
});
