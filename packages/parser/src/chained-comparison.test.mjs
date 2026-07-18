// Unit tests for chained comparisons (issue #52). `parse.test.mjs` already covers the two-link case
// (`1 < :x < 10`) and the lone-comparison boundary (`1 < 2` stays a Call); this file targets what
// that leaves untested: 3+ link chains, mixed comparison operators in one chain, and chains whose
// operands are themselves variables/expressions, per spec/grammar.md:180 and the single-evaluation
// ComparisonChain lowering documented in packages/parser/src/ast.ts. PARSE-shape only — no runtime
// single-evaluation assertions (out of scope for this parse-only slice).
//
// Runs under `node --test` against the built `@openlogo/parser` package, exercising only its
// public `parse` surface.

import assert from "node:assert/strict";
import { test } from "node:test";
import * as OL from "@openlogo/parser";

const doc = "chained-comparison.logo";

test("a same-operator 3-link chain `1 < 2 < 3` is one ComparisonChain with 3 operands and 2 operators", () => {
  const { ast, diagnostics } = OL.parse("print 1 < 2 < 3", doc);

  assert.deepEqual(diagnostics, []);
  const chain = ast.body[0].args[0];
  assert.equal(chain.kind, "ComparisonChain");
  assert.equal(chain.operands.length, 3);
  assert.equal(chain.operators.length, 2);
  assert.deepEqual(
    chain.operands.map((n) => n.value),
    [1, 2, 3],
  );
  assert.deepEqual(
    chain.operators.map((o) => o.name),
    ["<", "<"],
  );
});

test("a mixed-operator 4-link chain `1 < 2 <= 3 < 4` keeps each operator distinct in order", () => {
  const { ast, diagnostics } = OL.parse("print 1 < 2 <= 3 < 4", doc);

  assert.deepEqual(diagnostics, []);
  const chain = ast.body[0].args[0];
  assert.equal(chain.kind, "ComparisonChain");
  assert.equal(chain.operands.length, 4);
  assert.equal(chain.operators.length, 3);
  assert.deepEqual(
    chain.operands.map((n) => n.value),
    [1, 2, 3, 4],
  );
  assert.deepEqual(
    chain.operators.map((o) => o.name),
    ["<", "<=", "<"],
  );
});

test("a chain with variable and expression operands `:a < :b + 1 < :c` stores each operand once, uncombined", () => {
  const { ast, diagnostics } = OL.parse("print :a < :b + 1 < :c", doc);

  assert.deepEqual(diagnostics, []);
  const chain = ast.body[0].args[0];
  assert.equal(chain.kind, "ComparisonChain");
  assert.equal(chain.operands.length, 3);
  assert.equal(chain.operators.length, 2);

  const [a, bPlus1, c] = chain.operands;
  assert.equal(a.kind, "VarRef");
  assert.equal(a.name, "a");

  assert.equal(bPlus1.kind, "Call");
  assert.equal(bPlus1.callee.name, "+");
  assert.equal(bPlus1.args[0].kind, "VarRef");
  assert.equal(bPlus1.args[0].name, "b");
  assert.equal(bPlus1.args[1].value, 1);

  assert.equal(c.kind, "VarRef");
  assert.equal(c.name, "c");

  assert.deepEqual(
    chain.operators.map((o) => o.name),
    ["<", "<"],
  );

  // Each operand appears exactly once in the tree (single-evaluation guarantee), including the
  // shared `:b + 1` Call node.
  let seen = 0;
  OL.walk(ast, (node) => {
    if (node === bPlus1) {
      seen += 1;
    }
  });
  assert.equal(seen, 1);
});

test("each ComparisonChain operator carries its own source span, not the whole chain's span", () => {
  const src = "print 1 < 2 <= 3 < 4";
  const { ast, diagnostics } = OL.parse(src, doc);

  assert.deepEqual(diagnostics, []);
  const chain = ast.body[0].args[0];
  assert.equal(chain.kind, "ComparisonChain");

  const [op1, op2, op3] = chain.operators;
  assert.deepEqual(op1.source_span, {
    document: doc,
    start: [1, 9],
    end: [1, 10],
  });
  assert.deepEqual(op2.source_span, {
    document: doc,
    start: [1, 13],
    end: [1, 15],
  });
  assert.deepEqual(op3.source_span, {
    document: doc,
    start: [1, 18],
    end: [1, 19],
  });
  assert.deepEqual(chain.source_span, {
    document: doc,
    start: [1, 7],
    end: [1, src.length + 1],
  });
});

test("a lone comparison `1 < 2` stays a plain binary Call, never a ComparisonChain (boundary case)", () => {
  const { ast, diagnostics } = OL.parse("print 1 < 2", doc);

  assert.deepEqual(diagnostics, []);
  const cmp = ast.body[0].args[0];
  assert.equal(cmp.kind, "Call");
  assert.notEqual(cmp.kind, "ComparisonChain");
  assert.equal(cmp.callee.name, "<");
  assert.equal(cmp.args.length, 2);
  assert.equal(cmp.args[0].value, 1);
  assert.equal(cmp.args[1].value, 2);
});
