// Unit tests for `notAPlaceTargetText` (issue #156): the runtime's own text-derivation helper for
// the `ol-not-a-place` diagnostic's `text` param, mirroring `checker-not-a-place.ts`'s semantic-
// stage rule (issue #79/#113). Exercises both paths directly against real parsed ASTs:
//
// 1. Source slicing (`source` provided) — the primary path `execute()` always uses.
// 2. AST reconstruction (`source` `undefined`) — the fallback this package's own bare-environment
//    unit tests exercise (`variables-places.test.mjs`), covering every `RenderableNode` kind that
//    can appear as a non-place assignment target or nested inside one.
//
// Imported via a deep relative path into this package's own `dist/not-a-place-text.js` build
// output (never through the `"@openlogo/runtime"` package specifier — `index.ts` never re-exports
// it, so it isn't part of the package's public surface, same convention as
// `repeat-forever-repcount.test.mjs`'s import of `execute-internal.js`).

import assert from "node:assert/strict";
import { test } from "node:test";
import * as Parser from "@openlogo/parser";
import { notAPlaceTargetText } from "../dist/not-a-place-text.js";

const doc = "acceptance.logo";

/** Parses `source` as a single `Assign` statement and returns its `place` (target) node. */
function targetOf(source) {
  const { ast, diagnostics } = Parser.parse(source, doc);
  assert.deepEqual(diagnostics, []);
  return ast.body[0].place;
}

// --- AST-reconstruction fallback (no `source`) -----------------------------------------------

test("renders a zero-argument prefix call target (`pi = 5`)", () => {
  assert.equal(notAPlaceTargetText(targetOf("pi = 5"), undefined), "pi");
});

test("renders a multi-argument prefix call target (`first :nums = 1`)", () => {
  assert.equal(
    notAPlaceTargetText(targetOf("first :nums = 1"), undefined),
    "first :nums",
  );
});

test("renders a parenthesized call target (`(first :nums) = 1`)", () => {
  assert.equal(
    notAPlaceTargetText(targetOf("(first :nums) = 1"), undefined),
    "(first :nums)",
  );
});

test("renders an infix-operator call target in infix form (`1 + 2 = 3`)", () => {
  assert.equal(notAPlaceTargetText(targetOf("1 + 2 = 3"), undefined), "1 + 2");
});

test("renders a nested Place argument with both a field and an index selector", () => {
  assert.equal(
    notAPlaceTargetText(targetOf("count :people.tom[1] = 5"), undefined),
    "count :people.tom[1]",
  );
});

test("renders a list-literal argument with mixed element kinds (number, word, boolean)", () => {
  assert.equal(
    notAPlaceTargetText(targetOf('count [1 "two" true] = 5'), undefined),
    'count [1 "two" true]',
  );
});

// --- Source slicing (`source` provided) ------------------------------------------------------

test("slices the exact single-line surface text, preserving non-canonical spacing", () => {
  const source = "1  +  2 = 3";
  assert.equal(notAPlaceTargetText(targetOf(source), source), "1  +  2");
});

test("slices a target whose source span crosses multiple lines", () => {
  const source = "count [1\n2\n3] = 5";
  assert.equal(
    notAPlaceTargetText(targetOf(source), source),
    "count [1\n2\n3]",
  );
});
