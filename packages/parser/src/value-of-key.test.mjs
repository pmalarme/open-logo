// Unit tests for the Heritage `value of <dictionary> for key <key>` reader (issue #322,
// `spec/grammar.md:213`'s `value-of-reader`). `coverage.test.mjs`'s `MEGA` walk exercises the
// happy-path shape once for AST-visitor coverage; this file targets the per-branch syntax-error
// recovery `parseValueOfKey` performs when the dictionary expression, the `for` keyword, the `key`
// keyword, or the key expression is missing — each reports a diagnostic and bails out with
// `undefined` rather than throwing or looping.

import assert from "node:assert/strict";
import { test } from "node:test";
import * as OL from "@openlogo/parser";

const doc = "value-of-key.logo";

test("parses `value of <dict> for key <key>` into a ValueOfKey node", () => {
  const { ast, diagnostics } = OL.parse(
    'print value of :ages for key "tom"',
    doc,
  );

  assert.deepEqual(diagnostics, []);
  const node = ast.body[0].args[0];
  assert.equal(node.kind, "ValueOfKey");
  assert.equal(node.dictionary.kind, "VarRef");
  assert.equal(node.dictionary.name, "ages");
  assert.equal(node.key.kind, "WordLit");
  assert.equal(node.key.value, "tom");
});

test("a bare `value` not followed by `of` is left to fall through to a fixed-call/name read, not ValueOfKey", () => {
  const { ast, diagnostics } = OL.parse("print value", doc);

  assert.deepEqual(diagnostics, []);
  const node = ast.body[0].args[0];
  assert.notEqual(node.kind, "ValueOfKey");
});

test("`value of` with no dictionary expression reports a diagnostic and does not parse", () => {
  const { diagnostics } = OL.parse("print value of for key 1", doc);

  assert.equal(diagnostics.length > 0, true);
});

test("`value of <dict>` with no `for` keyword reports a diagnostic and does not parse", () => {
  const { diagnostics } = OL.parse("print value of :ages key 1", doc);

  assert.equal(diagnostics.length > 0, true);
});

test("`value of <dict> for` with no `key` keyword reports a diagnostic and does not parse", () => {
  const { diagnostics } = OL.parse("print value of :ages for 1", doc);

  assert.equal(diagnostics.length > 0, true);
});

test("`value of <dict> for key` with no key expression reports a diagnostic and does not parse", () => {
  const { diagnostics } = OL.parse("print value of :ages for key", doc);

  assert.equal(diagnostics.length > 0, true);
});
