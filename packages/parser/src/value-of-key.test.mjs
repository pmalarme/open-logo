// Unit tests for the Heritage `value of <dictionary> for key <key>` reader (issue #322,
// `spec/grammar.md:217`'s `value-of-reader`). `coverage.test.mjs`'s `MEGA` walk exercises the
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

test("a bare `value` not followed by `of` is rejected as a misplaced reserved word, not read as a call", () => {
  const { diagnostics } = OL.parse("print value", doc);

  // `value` is globally reserved (`spec/grammar.md:371`) and heads no `expression` alternative but
  // the `of`-gated reader above, so outside that form it is not permitted at this grammar position
  // (`spec/error-model.md:110`). Before issue #853 it fell through to a bare zero-argument call
  // that parsed and checked clean in every profile set — a silent no-op.
  assert.deepEqual(
    diagnostics.map((diagnostic) => [diagnostic.code, diagnostic.params.text]),
    [["ol-bad-token", "value"]],
  );
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

test("the reader now works inside parentheses, and nested inside itself", () => {
  // Both of these were BROKEN before issue #853 and are fixed as a side effect: while `value` was
  // still a `callable-name`, `( value of … )` read the `value` as a parenthesized call and choked on
  // `of`. Pinned here so a later change cannot silently re-break them.
  for (const source of [
    'print ( value of :ages for key "tom" )',
    'print value of ( value of :nested for key "inner" ) for key "outer"',
  ]) {
    assert.deepEqual(
      OL.parse(source, doc).diagnostics,
      [],
      `\`${source}\` must read as the value-of-key reader`,
    );
  }
});
