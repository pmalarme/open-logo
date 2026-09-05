// Direct tests for `dedupeDiagnostics`, the **de-duplication** half of *one fault, one diagnostic*
// (`spec/execution-model.md:741-748`).
//
// The identity it implements is `code` + `params` + `source_span`, with `stage` deliberately
// excluded — the spec says outright that `stage` "records when the fault was found, not which fault
// it is". These tests exist because `params` is an arbitrary object and its *serialization* decides
// identity, so the canonicalization is load-bearing rather than incidental.

import assert from "node:assert/strict";
import test from "node:test";

import { dedupeDiagnostics, OLDict, OLRecord, OLTurtle } from "@openlogo/core";

/** An `ol-duplicate-definition` whose `original_span` object is built with the given key order. */
function duplicateDefinition(originalSpan) {
  return {
    code: "ol-duplicate-definition",
    source_span: { document: "d.logo", start: [1, 1], end: [1, 5] },
    params: { name: "f", original_span: originalSpan },
    message: "already defined",
    stage: "semantic",
    severity: "error",
  };
}

test("the same fault reported at two stages collapses to one", () => {
  const semantic = {
    code: "ol-no-output",
    source_span: { document: "d.logo", start: [1, 6], end: [1, 15] },
    params: { procedure: "forward" },
    message: "m",
    stage: "semantic",
    severity: "error",
  };
  const runtime = { ...semantic, stage: "runtime" };
  assert.deepEqual(
    dedupeDiagnostics([semantic, runtime]).map((entry) => entry.stage),
    ["semantic"],
  );
});

test("fault identity is canonical at every depth, not just the top level", () => {
  // `original_span` is itself an object — a normative `params` entry with "the same shape as
  // `source_span`" (`spec/error-model.md:144-147`) — so sorting only top-level keys left nested
  // insertion order deciding identity. Measured before the fix: two identical findings whose
  // `original_span` keys were built in different orders survived as two.
  const a = duplicateDefinition({
    document: "d.logo",
    start: [2, 1],
    end: [2, 5],
  });
  const b = duplicateDefinition({
    start: [2, 1],
    end: [2, 5],
    document: "d.logo",
  });
  assert.equal(dedupeDiagnostics([a, b]).length, 1);
});

test("a genuinely different nested value is still two findings", () => {
  // The control. Without it the test above is satisfied by a canonicalization that discards nested
  // params entirely, which would collapse two distinct faults into one.
  const a = duplicateDefinition({
    document: "d.logo",
    start: [2, 1],
    end: [2, 5],
  });
  const elsewhere = duplicateDefinition({
    document: "other.logo",
    start: [2, 1],
    end: [2, 5],
  });
  assert.equal(dedupeDiagnostics([a, elsewhere]).length, 2);
});

test("the document is part of identity, so the same position in two sources is two faults", () => {
  const here = {
    code: "ol-bad-token",
    source_span: { document: "a.logo", start: [1, 7], end: [1, 10] },
    params: { text: "100" },
    message: "m",
    stage: "parse",
    severity: "error",
  };
  const there = {
    ...here,
    source_span: { ...here.source_span, document: "b.logo" },
  };
  assert.equal(dedupeDiagnostics([here, there]).length, 2);
});

// --- Round-11 review: the canonical encoding must be INJECTIVE ------------------------------
//
// A missed duplicate is merely visible — the learner reads the same fault twice. A COLLISION is
// silent: two genuinely different faults are judged one and the second is discarded with nothing
// left to show it existed, which is the exact failure this slice exists to remove. The structural
// encoding that sorted an object into its entry list rendered `{a: 1}` and `[["a", 1]]`
// identically, and both shapes are reachable in `params` (`original_span` is an object, `expected`
// is an array).

/** Two findings that differ ONLY in whether a `params` entry is an object or the array of its
 * entries — the shape the pre-tag canonicalization rendered identically. */
function objectVersusPairs() {
  const base = {
    code: "ol-duplicate-definition",
    source_span: { document: "d.logo", start: [1, 1], end: [1, 5] },
    message: "m",
    stage: "semantic",
    severity: "error",
  };
  return [
    { ...base, params: { x: { a: 1 } } },
    { ...base, params: { x: [["a", 1]] } },
  ];
}

test("an object param and the array of its entries are different faults", () => {
  const [asObject, asPairs] = objectVersusPairs();
  const kept = dedupeDiagnostics([asObject, asPairs]);
  assert.equal(
    kept.length,
    2,
    "a dict-valued param and a list-of-pairs param are distinct faults; collapsing them discards a real diagnostic",
  );
  assert.deepEqual(kept[0]?.params, { x: { a: 1 } });
  assert.deepEqual(kept[1]?.params, { x: [["a", 1]] });
});

test("a nested object and its entry list are also distinguished", () => {
  const base = {
    code: "ol-no-output",
    source_span: { document: "d.logo", start: [2, 1], end: [2, 4] },
    message: "m",
    stage: "runtime",
    severity: "error",
  };
  const kept = dedupeDiagnostics([
    { ...base, params: { outer: { inner: { a: 1 } } } },
    { ...base, params: { outer: { inner: [["a", 1]] } } },
  ]);
  assert.equal(
    kept.length,
    2,
    "the tag must apply at every depth, not only the top level",
  );
});

test("tagging does not weaken the duplicate collapse it exists beside", () => {
  const base = {
    code: "ol-no-output",
    source_span: { document: "d.logo", start: [2, 1], end: [2, 4] },
    message: "m",
    severity: "error",
  };
  const kept = dedupeDiagnostics([
    { ...base, stage: "semantic", params: { a: 1, b: { c: 2, d: [3, 4] } } },
    { ...base, stage: "runtime", params: { b: { d: [3, 4], c: 2 }, a: 1 } },
  ]);
  assert.equal(
    kept.length,
    1,
    "key order at any depth is still not part of a fault's identity",
  );
  assert.equal(kept[0]?.stage, "semantic", "the first report survives");
});

// --- Round-12 review: INJECTIVE, TOTAL, and CYCLE-SAFE ------------------------------------------
//
// Round 11 fixed one collision (an object vs the array of its entries). Round 12 found the same
// defect three more times, and the pattern in how it kept being missed is the point: each fix was
// tested against the case it fixed, and the CONTROL that would have caught the next one was left
// out. Special atoms were encoded by name — so the number `NaN` and the word `"NaN"` collided —
// and the test compared the specials only against each other, never against their spellings.
//
// So the table below is written as pairs that must be DISTINGUISHED plus pairs that must still
// COLLAPSE, across every type `params` can carry. `params` is `Record<string, unknown>`, not
// `OLValue`, so a host can put anything there; the encoding is total over all of it.
//
// The failure direction is why this is worth the space: a missed duplicate is visible — the learner
// reads the same fault twice — while a collision silently discards a real diagnostic, and a crash
// in the de-duplicator replaces the diagnostic a program was owed with whatever the throw becomes.

/** One diagnostic carrying `value`, at a fixed code and span so only `params` can differ. */
function carrying(value) {
  return {
    code: "ol-type",
    source_span: { document: "d.logo", start: [1, 1], end: [1, 2] },
    params: { v: value },
    message: "m",
    stage: "runtime",
    severity: "error",
  };
}

/** How many findings survive de-duplication when `left` and `right` are reported at one span. */
function survivors(left, right) {
  return dedupeDiagnostics([carrying(left), carrying(right)]).length;
}

test("a special atom never collides with the word that spells it", () => {
  // The round-12 defect exactly: encoding `NaN` as the text "NaN" made it equal to the word "NaN".
  for (const [special, spelling] of [
    [Number.NaN, "NaN"],
    [Infinity, "Infinity"],
    [-Infinity, "-Infinity"],
    [undefined, "undefined"],
    [null, "null"],
    [true, "true"],
    [1, "1"],
  ]) {
    assert.equal(
      survivors(special, spelling),
      2,
      `${String(special)} and the word "${spelling}" are different faults`,
    );
  }
});

test("values of different shapes never collide", () => {
  const dict = new OLDict();
  dict.set("a", 1);
  for (const [left, right, why] of [
    [{ a: 1 }, [["a", 1]], "an object and the array of its entries"],
    [["x", "y"], ["xy"], "two words and their concatenation"],
    [
      "a:b",
      ["a", "b"],
      "a word containing the separator and the pair it looks like",
    ],
    [0, -0, "positive and negative zero"],
    [dict, new OLRecord("p", [], []), "an empty-keyed dict and a record"],
    [5n, "5", "a bigint and its printed form"],
  ]) {
    assert.equal(survivors(left, right), 2, why);
  }
});

test("equal values of every carried type still collapse to one", () => {
  const dictA = new OLDict();
  dictA.set("a", 1);
  const dictB = new OLDict();
  dictB.set("a", 1);
  for (const [left, right, why] of [
    [Number.NaN, Number.NaN, "NaN is one fault, not two"],
    [dictA, dictB, "dicts with equal contents"],
    [
      new OLRecord("p", ["x", "y"], [1, 2]),
      new OLRecord("p", ["x", "y"], [1, 2]),
      "records with equal type and fields",
    ],
    [new OLTurtle(1), new OLTurtle(1), "the same turtle"],
    [{ a: 1, b: 2 }, { b: 2, a: 1 }, "key order is not identity"],
  ]) {
    assert.equal(survivors(left, right), 1, why);
  }
});

test("dicts, records and turtles are read through their own accessors", () => {
  // `OLDict`/`OLRecord` keep their contents in a PRIVATE Map, which `Object.keys` reports as empty
  // — so before this every dict canonicalized identically and collapsed onto every other.
  const one = new OLDict();
  one.set("a", 1);
  const two = new OLDict();
  two.set("a", 2);
  assert.equal(survivors(one, two), 2, "dicts differing in a value");

  assert.equal(
    survivors(
      new OLRecord("p", ["x", "y"], [1, 2]),
      new OLRecord("p", ["x", "y"], [1, 3]),
    ),
    2,
    "records differing in a field value",
  );
  assert.equal(
    survivors(
      new OLRecord("p", ["x", "y"], [1, 2]),
      new OLRecord("q", ["x", "y"], [1, 2]),
    ),
    2,
    "records differing only in struct type",
  );
  assert.equal(
    survivors(new OLTurtle(1), new OLTurtle(2)),
    2,
    "spec/execution-model.md:552 makes two turtles == only when they are the same turtle",
  );
});

test("a deep or cyclic value terminates instead of throwing", () => {
  // Both shapes turned the diagnostic a program was owed into whatever the throw became. The
  // traversal is iterative over an explicit stack, so neither consumes the host call stack —
  // 50,000 levels is far past the ~1,500 at which the recursive form raised `RangeError`.
  const cyclic = [];
  cyclic.push(cyclic);
  assert.equal(dedupeDiagnostics([carrying(cyclic)]).length, 1);

  const deep = [];
  let cursor = deep;
  for (let level = 0; level < 50_000; level++) {
    const next = [];
    cursor.push(next);
    cursor = next;
  }
  assert.equal(dedupeDiagnostics([carrying(deep)]).length, 1);
});

test("a large collection is canonicalized once, not once per entry", () => {
  // Asking `values()` per key rebuilt the whole collection per entry: quadratic, ~280 ms at 8,000
  // entries. This is a generous ceiling — it is guarding the complexity class, not a millisecond
  // budget, so it will not flake on a slow machine while still failing loudly if the quadratic
  // shape returns.
  const big = new OLDict();
  for (let index = 0; index < 8_000; index++) {
    big.set(`k${index}`, index);
  }
  const started = Date.now();
  dedupeDiagnostics([carrying(big)]);
  assert.ok(
    Date.now() - started < 2_000,
    "de-duplicating one 8,000-entry dict must not be quadratic in its size",
  );
});
