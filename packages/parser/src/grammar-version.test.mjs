// Unit tests for grammar-version tracking (issue #121, team charter §12): the highlighter and
// tooling must track the grammar version, and a version mismatch must be detectable — not just
// asserted never to happen.

import assert from "node:assert/strict";
import { test } from "node:test";
import * as OL from "@openlogo/parser";

test("in sync: the parser's grammar version matches @openlogo/core's OPENLOGO_VERSION today", () => {
  assert.equal(OL.OL_GRAMMAR_VERSION, OL.OPENLOGO_VERSION);
  // The production check (no arguments — the real constants) must not throw while in sync.
  assert.doesNotThrow(() => OL.assertGrammarVersionInSync());
});

test("mismatch is detectable: a desynced grammar/core version pair throws", () => {
  assert.throws(() => OL.assertGrammarVersionInSync("0.1.0", "0.2.0"), Error);
});

test("mismatch is detectable: the reverse direction (core ahead of grammar) also throws", () => {
  assert.throws(() => OL.assertGrammarVersionInSync("0.2.0", "0.1.0"), Error);
});
