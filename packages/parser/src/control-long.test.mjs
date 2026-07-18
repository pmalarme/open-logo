// Unit tests for the Core control-form LONG (`... end`) body syntax —
// `if <cond>`, `while <cond>`, `repeat <n>`, `for … in`/`for … from … to [by]`, `forever` —
// per spec/grammar.md:119-129,139,142-143 (`long-control-block ::= terminator { statement
// terminator } control-end-label`; `control-end-label ::= "end" [ "if" | "while" | "repeat" |
// "for" | "forever" ]`). These validate the already-merged parser; they do not change it. The
// corresponding SHORT (bracketed `[ … ]`) bodies are a separate slice (issue #57,
// control-short.test.mjs) and are out of scope here.
//
// Spans are half-open `[start, end)` with 1-based `[line, column]` positions, per
// @openlogo/core, matching the conventions in parse.test.mjs and control-short.test.mjs.

import assert from "node:assert/strict";
import { test } from "node:test";
import * as OL from "@openlogo/parser";

const doc = "acceptance.logo";
const span = (start, end) => ({ document: doc, start, end });

test("parses `if <cond>` long form with a bare `end` (no label) and only a then-body", () => {
  const source = "if :x > 0\n  print 1\nend\n";
  const { ast, diagnostics } = OL.parse(source, doc);

  assert.deepEqual(diagnostics, []);
  const ifNode = ast.body[0];
  assert.equal(ifNode.kind, "If");
  assert.deepEqual(ifNode.source_span, span([1, 1], [3, 4]));

  assert.equal(ifNode.condition.kind, "Call");
  assert.equal(ifNode.condition.callee.name, ">");

  assert.equal(ifNode.thenBody.kind, "Block");
  assert.deepEqual(ifNode.thenBody.source_span, span([2, 3], [3, 4]));
  assert.equal(ifNode.thenBody.body.length, 1);
  assert.equal(ifNode.thenBody.body[0].callee.name, "print");
  assert.equal(ifNode.thenBody.body[0].args[0].value, 1);

  assert.equal(ifNode.elseBody, undefined);
});

test("parses `if <cond>` long form with both branches and a labeled `end if`", () => {
  const source = "if :x > 0\n  print 1\nelse\n  print 2\nend if\n";
  const { ast, diagnostics } = OL.parse(source, doc);

  assert.deepEqual(diagnostics, []);
  const ifNode = ast.body[0];
  assert.equal(ifNode.kind, "If");
  assert.deepEqual(ifNode.source_span, span([1, 1], [5, 7]));

  assert.equal(ifNode.thenBody.kind, "Block");
  assert.equal(ifNode.thenBody.body.length, 1);
  assert.equal(ifNode.thenBody.body[0].args[0].value, 1);

  assert.equal(ifNode.elseBody.kind, "Block");
  assert.deepEqual(ifNode.elseBody.source_span, span([4, 3], [5, 7]));
  assert.equal(ifNode.elseBody.body.length, 1);
  assert.equal(ifNode.elseBody.body[0].args[0].value, 2);
});

test("bare `end` and labeled `end if` produce the same `If` AST shape (ignoring source spans)", () => {
  const bare = OL.parse("if :x > 0\n  print 1\nend\n", doc);
  const labeled = OL.parse("if :x > 0\n  print 1\nend if\n", doc);

  assert.deepEqual(bare.diagnostics, []);
  assert.deepEqual(labeled.diagnostics, []);

  const stripSpans = (node) =>
    JSON.parse(
      JSON.stringify(node, (key, value) =>
        key === "source_span" ? undefined : value,
      ),
    );

  assert.deepEqual(
    stripSpans(bare.ast.body[0]),
    stripSpans(labeled.ast.body[0]),
  );
});

test("parses `while <cond>` long form with a labeled `end while`", () => {
  const source = "while :x < 10\n  set x to :x + 1\nend while\n";
  const { ast, diagnostics } = OL.parse(source, doc);

  assert.deepEqual(diagnostics, []);
  const whileNode = ast.body[0];
  assert.equal(whileNode.kind, "While");
  assert.deepEqual(whileNode.source_span, span([1, 1], [3, 10]));

  assert.equal(whileNode.condition.callee.name, "<");

  assert.equal(whileNode.body.kind, "Block");
  assert.deepEqual(whileNode.body.source_span, span([2, 3], [3, 10]));
  assert.equal(whileNode.body.body.length, 1);
  const assign = whileNode.body.body[0];
  assert.equal(assign.kind, "Assign");
  assert.equal(assign.form, "set");
  assert.equal(assign.place.base.name, "x");
});

test("bare `end` and labeled `end while` produce the same `While` AST shape (ignoring source spans)", () => {
  const bare = OL.parse("while :x < 10\n  print 1\nend\n", doc);
  const labeled = OL.parse("while :x < 10\n  print 1\nend while\n", doc);

  assert.deepEqual(bare.diagnostics, []);
  assert.deepEqual(labeled.diagnostics, []);

  const stripSpans = (node) =>
    JSON.parse(
      JSON.stringify(node, (key, value) =>
        key === "source_span" ? undefined : value,
      ),
    );

  assert.deepEqual(
    stripSpans(bare.ast.body[0]),
    stripSpans(labeled.ast.body[0]),
  );
});

test("parses `repeat <n>` long form with a multi-statement body separated by a blank line, closed with a labeled `end repeat`", () => {
  const source = "repeat 2\n  print 1\n\n  print 2\nend repeat\n";
  const { ast, diagnostics } = OL.parse(source, doc);

  assert.deepEqual(diagnostics, []);
  const repeatNode = ast.body[0];
  assert.equal(repeatNode.kind, "Repeat");
  assert.deepEqual(repeatNode.source_span, span([1, 1], [5, 11]));

  assert.equal(repeatNode.count.value, 2);
  assert.equal(repeatNode.body.kind, "Block");
  assert.equal(repeatNode.body.body.length, 2);
  assert.equal(repeatNode.body.body[0].args[0].value, 1);
  assert.equal(repeatNode.body.body[1].args[0].value, 2);
});

test("bare `end` and labeled `end repeat` produce the same `Repeat` AST shape (ignoring source spans)", () => {
  const bare = OL.parse("repeat 2\n  print 1\nend\n", doc);
  const labeled = OL.parse("repeat 2\n  print 1\nend repeat\n", doc);

  assert.deepEqual(bare.diagnostics, []);
  assert.deepEqual(labeled.diagnostics, []);

  const stripSpans = (node) =>
    JSON.parse(
      JSON.stringify(node, (key, value) =>
        key === "source_span" ? undefined : value,
      ),
    );

  assert.deepEqual(
    stripSpans(bare.ast.body[0]),
    stripSpans(labeled.ast.body[0]),
  );
});

test("parses `forever` long form with a labeled `end forever`", () => {
  const source = "forever\n  print 1\nend forever\n";
  const { ast, diagnostics } = OL.parse(source, doc);

  assert.deepEqual(diagnostics, []);
  const foreverNode = ast.body[0];
  assert.equal(foreverNode.kind, "Forever");
  assert.deepEqual(foreverNode.source_span, span([1, 1], [3, 12]));

  assert.equal(foreverNode.body.kind, "Block");
  assert.equal(foreverNode.body.body.length, 1);
  assert.equal(foreverNode.body.body[0].callee.name, "print");
});

test("bare `end` and labeled `end forever` produce the same `Forever` AST shape (ignoring source spans)", () => {
  const bare = OL.parse("forever\n  print 1\nend\n", doc);
  const labeled = OL.parse("forever\n  print 1\nend forever\n", doc);

  assert.deepEqual(bare.diagnostics, []);
  assert.deepEqual(labeled.diagnostics, []);

  const stripSpans = (node) =>
    JSON.parse(
      JSON.stringify(node, (key, value) =>
        key === "source_span" ? undefined : value,
      ),
    );

  assert.deepEqual(
    stripSpans(bare.ast.body[0]),
    stripSpans(labeled.ast.body[0]),
  );
});

test("parses `for <name> in <expr>` long form with a labeled `end for`", () => {
  const source = "for item in :items\n  print :item\nend for\n";
  const { ast, diagnostics } = OL.parse(source, doc);

  assert.deepEqual(diagnostics, []);
  const forNode = ast.body[0];
  assert.equal(forNode.kind, "ForIn");
  assert.deepEqual(forNode.source_span, span([1, 1], [3, 8]));

  assert.equal(forNode.binder.name, "item");
  assert.equal(forNode.iterable.kind, "VarRef");
  assert.equal(forNode.iterable.name, "items");

  assert.equal(forNode.body.kind, "Block");
  assert.equal(forNode.body.body.length, 1);
  assert.equal(forNode.body.body[0].callee.name, "print");
});

test("bare `end` and labeled `end for` produce the same `ForIn` AST shape (ignoring source spans)", () => {
  const bare = OL.parse("for item in :items\n  print 1\nend\n", doc);
  const labeled = OL.parse("for item in :items\n  print 1\nend for\n", doc);

  assert.deepEqual(bare.diagnostics, []);
  assert.deepEqual(labeled.diagnostics, []);

  const stripSpans = (node) =>
    JSON.parse(
      JSON.stringify(node, (key, value) =>
        key === "source_span" ? undefined : value,
      ),
    );

  assert.deepEqual(
    stripSpans(bare.ast.body[0]),
    stripSpans(labeled.ast.body[0]),
  );
});

test("parses `for <name> from <expr> to <expr> by <expr>` long form with a bare `end` (no label)", () => {
  const source = "for i from 1 to 10 by 2\n  print :i\nend\n";
  const { ast, diagnostics } = OL.parse(source, doc);

  assert.deepEqual(diagnostics, []);
  const forNode = ast.body[0];
  assert.equal(forNode.kind, "ForRange");
  assert.deepEqual(forNode.source_span, span([1, 1], [3, 4]));

  assert.equal(forNode.variable.name, "i");
  assert.equal(forNode.from.value, 1);
  assert.equal(forNode.to.value, 10);
  assert.equal(forNode.by.value, 2);

  assert.equal(forNode.body.kind, "Block");
  assert.equal(forNode.body.body.length, 1);
});

test("bare `end` and labeled `end for` produce the same `ForRange` AST shape (ignoring source spans)", () => {
  const bare = OL.parse("for i from 1 to 5\n  print :i\nend\n", doc);
  const labeled = OL.parse("for i from 1 to 5\n  print :i\nend for\n", doc);

  assert.deepEqual(bare.diagnostics, []);
  assert.deepEqual(labeled.diagnostics, []);

  const stripSpans = (node) =>
    JSON.parse(
      JSON.stringify(node, (key, value) =>
        key === "source_span" ? undefined : value,
      ),
    );

  assert.deepEqual(
    stripSpans(bare.ast.body[0]),
    stripSpans(labeled.ast.body[0]),
  );
});

test("a mismatched end label on a long block raises `ol-mismatched-end` at parse stage (per spec/grammar.md:281)", () => {
  const source = "repeat 3\n  print 1\nend while\n";
  const { diagnostics } = OL.parse(source, doc);

  assert.equal(diagnostics.length, 1);
  const [diag] = diagnostics;
  assert.equal(diag.code, "ol-mismatched-end");
  assert.equal(diag.stage, "parse");
  assert.equal(diag.severity, "error");
  assert.deepEqual(diag.params, { expected: "repeat", actual: "while" });
  assert.deepEqual(diag.source_span, span([3, 5], [3, 10]));
});

// Per spec/grammar.md:136-137, a `for … in` binder may be a bare `name` OR a destructuring
// `[ :name { :name } ]` pattern (e.g. `for [:x :y] in :points`, spec/grammar.md:333-335).
// Fixed in issue #91 — the destructuring form now parses into a `ForIn` node whose `binder`
// is a `DestructuringBinder` node carrying the ordered `:name` binders.
test("parses `for [:x :y] in <expr>` destructuring binder as a `ForIn` node", () => {
  const source = "for [:x :y] in :points\n  print :x\nend for\n";
  const { ast, diagnostics } = OL.parse(source, doc);

  assert.deepEqual(diagnostics, []);
  const forNode = ast.body[0];
  assert.equal(forNode.kind, "ForIn");
  assert.deepEqual(forNode.source_span, span([1, 1], [3, 8]));

  assert.equal(forNode.binder.kind, "DestructuringBinder");
  assert.deepEqual(
    forNode.binder.names.map((name) => name.name),
    ["x", "y"],
  );
  assert.equal(forNode.iterable.kind, "VarRef");
  assert.equal(forNode.iterable.name, "points");

  assert.equal(forNode.body.kind, "Block");
  assert.equal(forNode.body.body.length, 1);
  assert.equal(forNode.body.body[0].callee.name, "print");
});

test("parses a single-element destructuring binder `for [:x] in <expr>`", () => {
  const source = "for [:x] in :points\n  print :x\nend for\n";
  const { ast, diagnostics } = OL.parse(source, doc);

  assert.deepEqual(diagnostics, []);
  const forNode = ast.body[0];
  assert.equal(forNode.kind, "ForIn");
  assert.equal(forNode.binder.kind, "DestructuringBinder");
  assert.deepEqual(
    forNode.binder.names.map((name) => name.name),
    ["x"],
  );
});

test("bare-name `for <name> in <expr>` binder is unchanged (still a plain SpannedName)", () => {
  const source = "for item in :items\n  print :item\nend for\n";
  const { ast, diagnostics } = OL.parse(source, doc);

  assert.deepEqual(diagnostics, []);
  const forNode = ast.body[0];
  assert.equal(forNode.binder.name, "item");
  assert.equal(forNode.binder.kind, undefined);
});

test("an unclosed destructuring binder `for [:x :y in …` raises `ol-unmatched-bracket`", () => {
  const source = "for [:x :y in :points\n  print :x\nend for\n";
  const { ast, diagnostics } = OL.parse(source, doc);

  assert.ok(diagnostics.some((d) => d.code === "ol-unmatched-bracket"));
  assert.ok(ast.body.every((node) => node.kind !== "ForIn"));
});

test("a destructuring binder with a bare (non-colon) name `for [x] in …` raises `ol-bad-token`", () => {
  const source = "for [x] in :points\n  print 1\nend for\n";
  const { ast, diagnostics } = OL.parse(source, doc);

  assert.ok(diagnostics.some((d) => d.code === "ol-bad-token"));
  assert.ok(ast.body.every((node) => node.kind !== "ForIn"));
});

test("an empty destructuring binder `for [] in …` raises exactly one `ol-unmatched-bracket` (no duplicate)", () => {
  const source = "for [] in :points\n  print 1\nend for\n";
  const { ast, diagnostics } = OL.parse(source, doc);

  const unmatchedBracketDiags = diagnostics.filter(
    (d) => d.code === "ol-unmatched-bracket",
  );
  assert.equal(unmatchedBracketDiags.length, 1);
  assert.deepEqual(unmatchedBracketDiags[0].source_span, span([1, 6], [1, 7]));
  assert.ok(ast.body.every((node) => node.kind !== "ForIn"));
});
