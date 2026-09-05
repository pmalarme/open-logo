// Direct tests for `dedupeDiagnostics`, the **de-duplication** half of *one fault, one diagnostic*
// (`spec/execution-model.md:741-748`).
//
// The identity it implements is `code` + `params` + `source_span`, with `stage` deliberately
// excluded — the spec says outright that `stage` "records when the fault was found, not which fault
// it is". These tests exist because `params` is an arbitrary object and its *serialization* decides
// identity, so the canonicalization is load-bearing rather than incidental.

import assert from "node:assert/strict";
import test from "node:test";

import {
  dedupeDiagnostics,
  diagnosticIdentity,
  OLDict,
  OLRecord,
  OLTurtle,
} from "@openlogo/core";

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

test("a large collection is snapshotted once, not once per entry", () => {
  // This guard is deliberately weaker than the one it replaces, and the comment says so rather
  // than overstating it.
  //
  // The STRONG guarantee is now structural: the two reads sit outside any loop, and they go
  // through references captured at module load, so nothing — not a subclass, not a monkey-patched
  // prototype, not a test — can intercept them. The counting test that used to live here counted
  // through a `CountingDict` SUBCLASS, which the encoder now refuses to consult; it would have kept
  // passing while measuring nothing at all. That is the third time in this slice a test survived a
  // change that made it meaningless.
  //
  // What remains observable is cost, so the backstop is a timing one — but chosen from measurement
  // rather than from caution. At 16,000 entries this machine runs the correct shape in 6-10 ms and
  // the per-entry shape in ~1,690 ms: a ~200x separation. A 300 ms ceiling therefore leaves the
  // correct shape 30-50x of headroom while the defect overshoots by 5.6x. The previous ceiling
  // failed precisely because its margin was 5x and the defect fitted inside it.
  const large = new OLDict();
  for (let index = 0; index < 16_000; index++) {
    large.set(`k${index}`, index);
  }
  const started = process.hrtime.bigint();
  dedupeDiagnostics([carrying(large)]);
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
  assert.ok(
    elapsedMs < 300,
    `de-duplicating one 16,000-entry dict took ${elapsedMs.toFixed(1)} ms; the per-entry shape measures ~1,690 ms`,
  );
});

test("the captured readers cannot be replaced by patching the prototype", () => {
  // `OLDict.prototype.keys` looked up at call time is a mutable slot: patching it to return `[]`
  // collapsed two different populated dicts into one fault. The references are captured at module
  // load, before any host code can run.
  const realKeys = OLDict.prototype.keys;
  const realValues = OLDict.prototype.values;
  const populated = (marker) => {
    const dictionary = new OLDict();
    dictionary.set("a", marker);
    return dictionary;
  };
  const one = populated(1);
  const two = populated(2);
  OLDict.prototype.keys = () => [];
  OLDict.prototype.values = () => [];
  try {
    assert.deepEqual(one.keys(), [], "the patch is live");
    assert.deepEqual(one.values(), [], "on both readers");
    assert.equal(survivors(one, two), 2);
  } finally {
    OLDict.prototype.keys = realKeys;
    OLDict.prototype.values = realValues;
  }
});

test("a proxy that hides its contents from the reader is opaque, not a collision", () => {
  // The backing state is a genuine `#private` field, and a private-field brand check happens
  // BEFORE any `get` trap can answer — so the captured reader rejects the proxy outright rather
  // than being lied to. The distinction matters: an earlier version of this comment credited the
  // trap, and coverage showed the trap is never consulted at all. The assertion below pins that
  // the deception is live when the proxy is asked publicly, so the test cannot pass merely because
  // there was nothing to deceive with.
  const hiding = (marker) => {
    const dictionary = new OLDict();
    dictionary.set("a", marker);
    return new Proxy(dictionary, {
      get(target, key) {
        return key === "entries" ? new Map() : Reflect.get(target, key, target);
      },
    });
  };
  const one = hiding(1);
  assert.equal(
    one.entries.size,
    0,
    "the deception is live when asked publicly",
  );
  assert.throws(
    () => one.keys(),
    /private member/,
    "and the brand check rejects the proxy as a receiver, whoever asks",
  );
  assert.equal(survivors(one, hiding(2)), 2);
});

test("an identity slot that is not the type it must be makes the value opaque", () => {
  // `String()` erased both type and equality. Two `OLTurtle(NaN)` rendered alike although
  // `NaN !== NaN` makes them different turtles; turtle id `1` collapsed onto the word `"1"`; and
  // record type `1` onto `"1"`.
  assert.equal(
    survivors(new OLTurtle(Number.NaN), new OLTurtle(Number.NaN)),
    2,
    "an id that is not a finite number identifies nothing",
  );

  const stringId = new OLTurtle(1);
  Object.defineProperty(stringId, "id", {
    value: "1",
    writable: true,
    configurable: true,
    enumerable: true,
  });
  assert.equal(survivors(new OLTurtle(1), stringId), 2);

  const numericType = new OLRecord("p", [], []);
  Object.defineProperty(numericType, "type", {
    value: 1,
    writable: true,
    configurable: true,
    enumerable: true,
  });
  assert.equal(survivors(numericType, new OLRecord("1", [], [])), 2);
});

test("a wide value does not overflow the host stack", () => {
  // The deep-nesting defect through a different door: `push(...children)` passes every element as
  // an argument, which threw `RangeError` at ~150,000. Children are pushed one at a time.
  assert.equal(
    dedupeDiagnostics([carrying(new Array(300_000).fill(1))]).length,
    1,
  );
});

test("a value this encoder cannot describe gets per-instance identity, never a collision", () => {
  // `String()` renders two `Symbol("x")` identically and `Object.keys()` flattens a Date, a Map, a
  // Set and a RegExp all to an empty object — so encoding them by printed form collided them.
  // None is an `OLValue`; the conservative answer is an opaque serial, which may FALSE SPLIT two
  // equal exotic values. That direction is visible; a collision is not.
  const oneWay = () => 1;
  const theOtherWay = () => 1;
  assert.equal(
    oneWay(),
    theOtherWay(),
    "the two closures are behaviourally identical — that is the point of the case below",
  );

  for (const [left, right, why] of [
    [Symbol("x"), Symbol("x"), "two symbols with the same description"],
    [oneWay, theOtherWay, "two closures with identical source and behaviour"],
    [new Date(0), new Date(1), "two dates"],
    [new Map([["a", 1]]), new Map([["a", 2]]), "two maps"],
    [new Set([1]), new Set([2]), "two sets"],
    [/a/, /b/, "two regular expressions"],
  ]) {
    assert.equal(survivors(left, right), 2, why);
  }

  const symbol = Symbol("stable");
  assert.equal(
    survivors(symbol, symbol),
    1,
    "the SAME instance must keep one identity, or nothing would ever de-duplicate",
  );
});

test("an array hole is not a stored undefined", () => {
  // Same length, same element reads, different values. Encoded alike they collided.
  // biome-ignore lint/suspicious/noSparseArray: the hole is the subject of this assertion.
  const sparse = [,];
  assert.equal(survivors(sparse, [undefined]), 2);
});

test("a registered symbol is identified by its key, not by a weak-map slot", () => {
  // `Symbol.for("x")` cannot be a `WeakMap` key — it throws `TypeError: Invalid value used as weak
  // map key` — and it is globally identified by its key anyway, so two of them ARE one symbol.
  assert.equal(
    survivors(Symbol.for("ol-test-x"), Symbol.for("ol-test-x")),
    1,
    "two Symbol.for with the same key are the same symbol",
  );
  assert.equal(survivors(Symbol.for("ol-test-x"), Symbol.for("ol-test-y")), 2);
  assert.equal(
    survivors(Symbol.for("ol-test-x"), Symbol("ol-test-x")),
    2,
    "a registered symbol is not the unregistered one that prints alike",
  );
});

test("an object is structural only when its own properties describe it safely", () => {
  // Prototype alone was not enough, and all three of these were measured: symbol-keyed and
  // non-enumerable properties are invisible to `Object.keys`, so objects differing only in one
  // COLLIDED; and an enumerable getter that raises made de-duplication itself THROW.
  const withSymbolKey = (marker) => {
    const object = { a: 1 };
    object[Symbol("s")] = marker;
    return object;
  };
  assert.equal(
    survivors(withSymbolKey(1), withSymbolKey(2)),
    2,
    "a symbol-keyed property is part of the value",
  );

  const withHidden = (marker) => {
    const object = { a: 1 };
    Object.defineProperty(object, "hidden", {
      value: marker,
      enumerable: false,
    });
    return object;
  };
  assert.equal(
    survivors(withHidden(1), withHidden(2)),
    2,
    "a non-enumerable property is part of the value",
  );

  const throwingGetter = {
    get boom() {
      throw new Error("this getter must never be called");
    },
  };
  assert.throws(
    () => throwingGetter.boom,
    /must never be called/,
    "the hazard is real: reading this property raises",
  );
  assert.equal(
    survivors(throwingGetter, { a: 1 }),
    2,
    "an accessor is never invoked, so de-duplication cannot be made to throw",
  );

  const throwingElement = [];
  Object.defineProperty(throwingElement, 0, {
    get() {
      throw new Error("this element getter must never be called");
    },
    enumerable: true,
    configurable: true,
  });
  assert.throws(
    () => throwingElement[0],
    /must never be called/,
    "the same hazard, in an array slot",
  );
  assert.equal(
    survivors(throwingElement, [1]),
    2,
    "an array of accessors is opaque too — the risk is identical",
  );

  // An array can also carry properties beside its indices, and they are as invisible to a
  // length-and-index walk as a symbol key is to `Object.keys`.
  const arrayWithSymbolKey = (marker) => {
    const array = [1];
    array[Symbol("s")] = marker;
    return array;
  };
  assert.equal(
    survivors(arrayWithSymbolKey(1), arrayWithSymbolKey(2)),
    2,
    "a symbol-keyed property on an array is part of the value",
  );

  const arrayWithNamedProperty = (marker) => {
    const array = [1];
    array.label = marker;
    return array;
  };
  assert.equal(
    survivors(arrayWithNamedProperty("a"), arrayWithNamedProperty("b")),
    2,
    "a named own property on an array is part of the value",
  );
});

test("the ordinary shapes diagnostics really carry are still structural", () => {
  // The domain restriction must not push a normal `params` value onto the opaque path, where two
  // separately-built but equal spans would false-split into two findings.
  assert.equal(
    survivors(
      { document: "d.logo", start: [1, 1], end: [1, 2] },
      { end: [1, 2], start: [1, 1], document: "d.logo" },
    ),
    1,
    "an `original_span` built in a different key order is one fault",
  );
  assert.equal(survivors({ a: 1 }, { a: 2 }), 2);
});

test("a numeric-LOOKING array property is not an index", () => {
  // `/^\d+$/` matches `"01"`, but `"01"` is an ordinary named property that no index walk visits,
  // so two arrays differing only in it collided. An index is a non-negative integer below
  // 2^32 - 1 whose canonical decimal spelling is the name itself.
  const withOhOne = (marker) => {
    const array = [1];
    array["01"] = marker;
    return array;
  };
  assert.equal(survivors(withOhOne("x"), withOhOne("y")), 2);

  const withMaxUint = (marker) => {
    const array = [1];
    array["4294967295"] = marker;
    return array;
  };
  assert.equal(
    survivors(withMaxUint("x"), withMaxUint("y")),
    2,
    "2^32 - 1 is one past the last valid index",
  );

  assert.equal(survivors([1, 2], [1, 2]), 1, "ordinary arrays still collapse");
  assert.equal(survivors([1, 2], [1, 3]), 2);
});

test("reflection that raises makes a value opaque, never a crash", () => {
  // Every one of these was measured crashing de-duplication. `instanceof` admits host subclasses
  // and modified instances, so the trusted-class exemption is trusted about the CLASS, not about
  // the instance — and reflection on a Proxy can raise before any class is even determined. One
  // guard covers the family; patching the four known cases would have left the fifth.
  const throwingOwnKeys = new Proxy(
    {},
    {
      ownKeys() {
        throw new Error("ownKeys must not crash de-duplication");
      },
    },
  );
  const throwingPrototype = new Proxy(
    {},
    {
      getPrototypeOf() {
        throw new Error("getPrototypeOf must not crash de-duplication");
      },
    },
  );

  class DictWithThrowingKeys extends OLDict {
    keys() {
      throw new Error("keys() must not crash de-duplication");
    }
  }
  class RecordWithThrowingFields extends OLRecord {
    fields() {
      throw new Error("fields() must not crash de-duplication");
    }
  }
  const turtleWithThrowingId = new OLTurtle(1);
  Object.defineProperty(turtleWithThrowingId, "id", {
    get() {
      throw new Error("id must not crash de-duplication");
    },
  });

  // The three overrides are live hazards — asking the instance really does throw — but since the
  // encoder reads dicts and records through the BASE prototype and a turtle's `id` as a data
  // descriptor, they are now closed TWICE: never invoked, and caught if they somehow were. The
  // proxies are the cases that still reach the catch, since reflection precedes any classification.
  assert.throws(() => new DictWithThrowingKeys().keys(), /must not crash/);
  assert.throws(
    () => new RecordWithThrowingFields("p", [], []).fields(),
    /must not crash/,
  );
  assert.throws(() => turtleWithThrowingId.id, /must not crash/);

  for (const [hostile, why] of [
    [throwingOwnKeys, "a Proxy that throws from ownKeys"],
    [throwingPrototype, "a Proxy that throws from getPrototypeOf"],
    [new DictWithThrowingKeys(), "an OLDict subclass that throws from keys()"],
    [
      new RecordWithThrowingFields("p", [], []),
      "an OLRecord subclass that throws from fields()",
    ],
    [turtleWithThrowingId, "an OLTurtle whose id accessor throws"],
  ]) {
    assert.equal(survivors(hostile, { a: 1 }), 2, why);
  }
});

test("the trusted classes are still read structurally when they behave", () => {
  // The guard must not quietly make every OL value opaque: that would false-split every real
  // duplicate, trading a crash for silence of a different kind.
  const first = new OLDict();
  first.set("a", 1);
  const second = new OLDict();
  second.set("a", 1);
  assert.equal(survivors(first, second), 1);
  assert.equal(
    survivors(new OLRecord("p", ["x"], [1]), new OLRecord("p", ["x"], [1])),
    1,
  );
  assert.equal(survivors(new OLTurtle(1), new OLTurtle(1)), 1);
  assert.equal(survivors(new OLTurtle(1), new OLTurtle(2)), 2);
});

test("a subclass that LIES about its contents cannot collide two values", () => {
  // The guard that catches a throwing override does not see a successful misdescription: an
  // `OLDict` subclass whose `keys()` returns `[]` made two dicts with different contents into one
  // fault, and a populated liar collapse onto a genuinely empty dict. Misdescription never raises,
  // so it never reaches the catch. Contents are read through the BASE implementation instead.
  class LyingDict extends OLDict {
    keys() {
      return [];
    }
    values() {
      return [];
    }
  }
  const oneValue = new LyingDict();
  oneValue.set("a", 1);
  const anotherValue = new LyingDict();
  anotherValue.set("a", 2);
  assert.deepEqual(
    oneValue.keys(),
    [],
    "the lie is live: asking the instance reports nothing",
  );
  assert.deepEqual(oneValue.values(), []);
  assert.equal(survivors(oneValue, anotherValue), 2, "different contents");
  assert.equal(
    survivors(oneValue, new OLDict()),
    2,
    "a populated liar is not an empty dict",
  );

  // A MODIFIED INSTANCE is the same attack without a subclass, and `instanceof` admits it equally.
  const shadowed = (marker) => {
    const dictionary = new OLDict();
    dictionary.set("a", marker);
    dictionary.keys = () => [];
    dictionary.values = () => [];
    return dictionary;
  };
  const shadowedOne = shadowed(1);
  assert.deepEqual(shadowedOne.keys(), [], "the shadowing is live too");
  assert.deepEqual(shadowedOne.values(), []);
  assert.equal(survivors(shadowedOne, shadowed(2)), 2);

  class LyingRecord extends OLRecord {
    fields() {
      return [];
    }
  }
  const lyingRecord = new LyingRecord("p", ["x"], [1]);
  assert.deepEqual(lyingRecord.fields(), [], "and here");
  assert.equal(survivors(lyingRecord, new LyingRecord("p", ["x"], [2])), 2);
  assert.equal(survivors(lyingRecord, new OLRecord("p", [], [])), 2);

  // A turtle's `id` is read as DATA, so an accessor installed over it describes nothing
  // trustworthy and the value becomes opaque rather than impersonating turtle 99.
  const impostor = new OLTurtle(1);
  Object.defineProperty(impostor, "id", {
    get() {
      return 99;
    },
  });
  assert.equal(impostor.id, 99, "the impersonation is live");
  assert.equal(survivors(impostor, new OLTurtle(99)), 2);
});

test("core's fault identity deliberately ignores stage and severity", () => {
  // The reciprocal half of studio's announcer contract, pinned on this side too so the two cannot
  // drift apart: `spec/execution-model.md:741-748` says `stage` "records when the fault was found,
  // not which fault it is", so the same fault at two stages is ONE fault here. A caller that must
  // distinguish them — the screen-reader announcer does — compares those fields beside this.
  const at = (stage, severity) => ({
    code: "ol-no-output",
    source_span: { document: "d.logo", start: [1, 1], end: [1, 2] },
    params: { procedure: "forward" },
    message: "m",
    stage,
    severity,
  });
  assert.equal(
    diagnosticIdentity(at("semantic", "error")),
    diagnosticIdentity(at("runtime", "error")),
    "stage is not part of a fault's identity",
  );
  assert.equal(
    diagnosticIdentity(at("semantic", "error")),
    diagnosticIdentity(at("semantic", "warning")),
    "nor is severity",
  );
  assert.notEqual(
    diagnosticIdentity(at("semantic", "error")),
    diagnosticIdentity({ ...at("semantic", "error"), code: "ol-no-value" }),
    "but the code is",
  );
});
