import assert from "node:assert/strict";
import { test } from "node:test";

import type { SourceSpan } from "@openlogo/core";

import { TOKEN_CLASSES } from "./tokens.ts";
import type { NumberLit, Program, TokenClass } from "./index.ts";

// Smoke test for the M0 parser contract stubs (issue #7): construct one AST node
// (with a span) inside a program, plus a token class, and read them back. Runs on
// Node's built-in test runner over the TypeScript source (see scripts/test.mjs).
test("parser contract: an AST node, a program, and token classes round-trip", () => {
  const sourceSpan: SourceSpan = {
    document: "main.logo",
    start: { line: 1, column: 9 },
    end: { line: 1, column: 12 },
  };

  const distance: NumberLit = { kind: "NumberLit", sourceSpan, value: 100 };
  assert.equal(distance.kind, "NumberLit");
  assert.equal(distance.value, 100);
  assert.equal(distance.sourceSpan.document, "main.logo");

  const program: Program = { kind: "Program", sourceSpan, body: [distance] };
  assert.equal(program.body.length, 1);
  assert.equal(program.body[0]?.kind, "NumberLit");

  const tokenClass: TokenClass = ":variable";
  assert.ok(TOKEN_CLASSES.includes(tokenClass));
  assert.equal(TOKEN_CLASSES.length, 15);
});
