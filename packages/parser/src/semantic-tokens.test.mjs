// Unit tests for `semanticTokens()` (issue #121): the LSP `textDocument/semanticTokens`-shaped
// contract layered over `highlight()`'s token-class + delimiter-role output
// (`spec/tooling.md:274-280`). Coverage mirrors that section's exact modifier vocabulary —
// `declaration`, `reference`, `readonly`, `defaultLibrary`, `listRole`, `blockRole`,
// `selectorRole` — plus one end-to-end corpus fixture exercising every one of `highlight()`'s 15
// token classes and 5 bracket delimiter roles at once (integrating issues #119 and #120).

import assert from "node:assert/strict";
import { test } from "node:test";
import * as OL from "@openlogo/parser";
// Package-internal; see the note on the same import in `highlight.test.mjs`.
import { ADVICE_BY_ARM, ARM_FOR_KIND } from "../dist/highlight.js";

const doc = "semantic-tokens.logo";

/** The token whose `text` first equals `text`, or `undefined`. */
function find(tokens, text) {
  return tokens.find((token) => token.text === text);
}

test("modifiers field: every token carries a modifiers array, even when empty", () => {
  const tokens = OL.semanticTokens("print 42", doc);
  assert.ok(tokens.every((token) => Array.isArray(token.modifiers)));
  // `print` is a Core primitive: defaultLibrary only. `42` is a plain number literal: no
  // declaration/reference/role modifier applies to a literal.
  assert.deepEqual(find(tokens, "print").modifiers, ["defaultLibrary"]);
  assert.deepEqual(find(tokens, "42").modifiers, []);
});

test("declaration: a `define` target at its declaration site gets declaration, not reference", () => {
  const tokens = OL.semanticTokens("define go\nend", doc);
  const name = find(tokens, "go");
  assert.equal(name.class, "procedure-name");
  assert.deepEqual(name.modifiers, ["declaration"]);
});

test("reference: a resolved procedure call site gets reference, not declaration", () => {
  const tokens = OL.semanticTokens("define go\nend\ngo", doc);
  const call = tokens.filter((token) => token.text === "go").at(-1);
  assert.equal(call.class, "procedure-name");
  assert.deepEqual(call.modifiers, ["reference"]);
});

test("declaration/reference: a struct type name is declaration at `struct`, reference at a constructor call", () => {
  const tokens = OL.semanticTokens("struct point [ x y ]\npoint 1 2", doc);
  const typeTokens = tokens.filter((token) => token.text === "point");
  assert.deepEqual(
    typeTokens.map((token) => token.modifiers),
    [["declaration"], ["reference"]],
  );
});

test("declaration/reference: a struct field name is declaration in the field list, reference at `.field` access", () => {
  const tokens = OL.semanticTokens(
    "struct point [ x y ]\ndefine move_to_point :p\n  set_xy :p.x :p.y\nend",
    doc,
  );
  const xTokens = tokens.filter((token) => token.text === "x");
  assert.equal(xTokens.length, 2);
  assert.deepEqual(xTokens[0].modifiers, ["declaration"]);
  assert.deepEqual(xTokens[1].modifiers, ["reference"]);
});

test("declaration/reference: a procedure's own `:param` is declaration at the header, reference in the body", () => {
  const tokens = OL.semanticTokens(
    "define go :speed\n  forward :speed\nend",
    doc,
  );
  const paramTokens = tokens.filter((token) => token.text === ":speed");
  assert.equal(paramTokens.length, 2);
  assert.equal(paramTokens[0].class, ":variable");
  assert.deepEqual(paramTokens[0].modifiers, ["declaration"]);
  assert.deepEqual(paramTokens[1].modifiers, ["reference"]);
});

test("reference: a plain `:variable` read with no resolvable binding site is reference, not declaration", () => {
  const tokens = OL.semanticTokens("print :count", doc);
  const variable = find(tokens, ":count");
  assert.deepEqual(variable.modifiers, ["reference"]);
});

test("readonly: a `map` binder read inside its own body is readonly (and still reference)", () => {
  const tokens = OL.semanticTokens(
    ":doubled = map num in :nums [ :num * 2 ]",
    doc,
  );
  const read = find(tokens, ":num");
  assert.equal(read.class, ":variable");
  assert.deepEqual(read.modifiers, ["reference", "readonly"]);
});

test("readonly: a `reduce` accumulator read inside its own body is readonly", () => {
  const tokens = OL.semanticTokens(
    ":total = reduce sum num in :nums from 0 [ :sum + :num ]",
    doc,
  );
  assert.deepEqual(find(tokens, ":sum").modifiers, ["reference", "readonly"]);
  assert.deepEqual(find(tokens, ":num").modifiers, ["reference", "readonly"]);
});

test("readonly: every name in a `map` destructuring `[:x :y]` binder read inside its own body is readonly (issue #72)", () => {
  const tokens = OL.semanticTokens(
    ":sums = map [:x :y] in :pairs [ :x + :y ]",
    doc,
  );
  // Each name appears twice: once inside the `[:x :y]` binder pattern itself (not a body read,
  // so no `readonly`), and once as a read inside the comprehension's own body.
  const xTokens = tokens.filter((token) => token.text === ":x");
  const yTokens = tokens.filter((token) => token.text === ":y");
  assert.deepEqual(xTokens[0].modifiers, ["reference"]);
  assert.deepEqual(xTokens[1].modifiers, ["reference", "readonly"]);
  assert.deepEqual(yTokens[0].modifiers, ["reference"]);
  assert.deepEqual(yTokens[1].modifiers, ["reference", "readonly"]);
});

test("readonly: a binder read through a place (`.field`/`[index]`) is also readonly, not just a bare `:name` read", () => {
  const tokens = OL.semanticTokens(
    "struct point [ x y ]\n:xs = map p in :points [ :p.x ]",
    doc,
  );
  const base = tokens.find(
    (token) => token.text === ":p" && token.class === ":variable",
  );
  assert.deepEqual(base.modifiers, ["reference", "readonly"]);
});

test("readonly: a `:variable` read outside any comprehension body is never marked readonly, even with the same spelling", () => {
  const tokens = OL.semanticTokens(
    "print :num\n:total = reduce sum num in :nums from 0 [ :sum + :num ]",
    doc,
  );
  const reads = tokens.filter((token) => token.text === ":num");
  // The plain read outside the comprehension is a reference only; the comprehension binder
  // read (same spelling) is reference + readonly.
  assert.deepEqual(reads[0].modifiers, ["reference"]);
  assert.deepEqual(reads[1].modifiers, ["reference", "readonly"]);
});

test("defaultLibrary: a Core primitive call gets defaultLibrary", () => {
  const tokens = OL.semanticTokens("forward 100", doc);
  assert.deepEqual(find(tokens, "forward").modifiers, ["defaultLibrary"]);
});

test("defaultLibrary: a Heritage alias primitive also gets defaultLibrary", () => {
  const tokens = OL.semanticTokens("fd 100", doc);
  assert.deepEqual(find(tokens, "fd").modifiers, ["defaultLibrary"]);
});

test("listRole: a list literal's brackets get listRole", () => {
  const tokens = OL.semanticTokens(":nums = [1 2 3]", doc);
  const brackets = tokens.filter(
    (token) => token.text === "[" || token.text === "]",
  );
  assert.deepEqual(
    brackets.map((token) => token.modifiers),
    [["listRole"], ["listRole"]],
  );
});

test("blockRole: an instruction block's brackets get blockRole", () => {
  const tokens = OL.semanticTokens("repeat 4 [ forward 10 ]", doc);
  const brackets = tokens.filter(
    (token) => token.text === "[" || token.text === "]",
  );
  assert.deepEqual(
    brackets.map((token) => token.modifiers),
    [["blockRole"], ["blockRole"]],
  );
});

test("selectorRole: a selector's brackets classify index/dot and get selectorRole", () => {
  const tokens = OL.semanticTokens("print :nums[1]", doc);
  const brackets = tokens.filter(
    (token) => token.text === "[" || token.text === "]",
  );
  for (const bracket of brackets) {
    assert.equal(bracket.class, "index/dot");
    assert.deepEqual(bracket.modifiers, ["selectorRole"]);
  }
});

test("no role modifier: pattern and field-list brackets get no listRole/blockRole/selectorRole modifier", () => {
  const patternTokens = OL.semanticTokens(
    "for [:x :y] in :pairs\n  print :x\nend",
    doc,
  );
  const patternBrackets = patternTokens.filter(
    (token) => token.text === "[" || token.text === "]",
  );
  assert.deepEqual(
    patternBrackets.map((token) => token.modifiers),
    [[], []],
  );

  const fieldListTokens = OL.semanticTokens("struct point [ x y ]", doc);
  const fieldListBrackets = fieldListTokens.filter(
    (token) => token.text === "[" || token.text === "]",
  );
  assert.deepEqual(
    fieldListBrackets.map((token) => token.modifiers),
    [[], []],
  );
});

test("no declaration/reference modifier: literal, delimiter, and operator classes never get one", () => {
  const tokens = OL.semanticTokens('if :x == 1 [ print "hi" ] # note', doc);
  const nonDeclarable = tokens.filter(
    (token) =>
      !["procedure-name", "type-name", "field-name", ":variable"].includes(
        token.class,
      ),
  );
  for (const token of nonDeclarable) {
    assert.ok(!token.modifiers.includes("declaration"));
    assert.ok(!token.modifiers.includes("reference"));
  }
});

test("never throws on malformed input, matching highlight()'s own never-throw contract", () => {
  assert.doesNotThrow(() => OL.semanticTokens("struct\ndefine\n[", doc));
});

test("corpus: one source exercises all 15 token classes and all 5 bracket delimiter roles end to end", () => {
  const source = [
    "struct point [ x y ]",
    "",
    "define move_to_point :p",
    "  # move the turtle onto a known point",
    "  set_xy :p.x :p.y",
    "end",
    "",
    ":nums = [1 2 3]",
    ":total = reduce sum num in :nums from 0 [ :sum + :num ]",
    "",
    "if :total > 0 and not :total is empty [",
    "  forward :total",
    '  (print "done")',
    "]",
    "",
    "print :nums[repeat]",
    "move_to_point point 1 2",
    "",
    "for [:a :b] in :nums",
    "  print :a",
    "end",
    "",
    "print { note: 1 }",
  ].join("\n");

  const tokens = OL.semanticTokens(source, doc);
  const classesSeen = new Set(tokens.map((token) => token.class));
  for (const tokenClass of OL.OL_TOKEN_CLASSES) {
    assert.ok(
      classesSeen.has(tokenClass),
      `expected corpus to exercise token class "${tokenClass}"`,
    );
  }

  const rolesSeen = new Set(
    tokens.map((token) => token.role).filter((role) => role !== undefined),
  );
  for (const role of OL.OL_BRACKET_ROLES) {
    assert.ok(
      rolesSeen.has(role),
      `expected corpus to exercise role "${role}"`,
    );
  }

  // Spot-check a representative modifier from each category on this single corpus.
  assert.deepEqual(find(tokens, "point").modifiers, ["declaration"]);
  assert.deepEqual(find(tokens, "forward").modifiers, ["defaultLibrary"]);
  assert.deepEqual(find(tokens, ":sum").modifiers, ["reference", "readonly"]);
});

// --- The `document` argument may not swallow the options object (issue #951) -------------------

// `semanticTokens()` has `highlight()`'s exact signature and uses the same `HighlightOptions`
// type, so it carried the identical defect: `semanticTokens(src, { profiles })` bound the options
// object to `document`, silently read the DEFAULT profile set, and wrote a non-string into every
// token's `source_span.document`. #951 fixed both together — fixing one and leaving the other
// would leave half the trap standing behind a signature that looks fixed.
//
// That parity claim is PINNED here, not asserted: the enumeration below includes the `undefined`
// row, and a true one-argument assertion follows it. Either alone catches a revert of
// `semantic-tokens.ts`'s `document: string` to `document = "<input>"` — half of #951 silently
// undone, every gate green. Before both existed, that revert passed the whole suite; measured,
// twice, by mutation.
//
// The `callee` assertions below cover all three message branches, not just the object one. That is
// the same shape as the gap above: an assertion covering one (function, branch) pair while the
// parallel pair goes unpinned. A mutation hard-coding `highlight` into the omitted-argument branch
// was undetected until the `undefined`-branch assertion was added, and it would have told a
// `semanticTokens` caller to go call a different function. The mirror sweep in
// `highlight.test.mjs` covers the same three arms from the other side.
//
// The control below is what makes the rest non-vacuous: it proves the three-argument form
// discriminates, using a profile set that DIFFERS from `DEFAULT_CHECK_PROFILES` (one that happens
// to equal the default gets the right answer by coincidence and proves nothing).

/**
 * Interaction's `when` is `keyword` while its profile is active and `primitive` while it is not
 * (`spec/tooling.md:30-31` — `:30` states the active half, `:31` the inactive one).
 */
const PROFILE_HEAD_SOURCE = 'when "start" [ print 1 ]\n';

/** A profile set that DIFFERS from `DEFAULT_CHECK_PROFILES`, so it can discriminate. */
const DISCRIMINATING_PROFILES = [
  "core-language",
  "turtle-rendering",
  "interaction-events",
];

test("control: semanticTokens' profile set differs from the default AND changes a class", () => {
  const classOf = (profiles) =>
    find(OL.semanticTokens(PROFILE_HEAD_SOURCE, doc, { profiles }), "when")
      ?.class;
  assert.notDeepEqual(DISCRIMINATING_PROFILES, [...OL.DEFAULT_CHECK_PROFILES]);
  assert.equal(classOf(OL.DEFAULT_CHECK_PROFILES), "primitive");
  assert.equal(classOf(DISCRIMINATING_PROFILES), "keyword");
});

test("semanticTokens: an options object in the document slot throws instead of being mis-bound", () => {
  assert.throws(
    () =>
      OL.semanticTokens(PROFILE_HEAD_SOURCE, {
        profiles: DISCRIMINATING_PROFILES,
      }),
    (error) => {
      assert.ok(error instanceof TypeError);
      // Named for the function the caller actually invoked, not for the `highlight()` it
      // delegates to — otherwise the message sends them to the wrong call site. Unanchored, so it
      // rules out the delegate being named anywhere in the message, not merely first.
      assert.match(
        error.message,
        /semanticTokens\(source, document, options\)/,
      );
      assert.doesNotMatch(error.message, /highlight\(/);
      assert.match(error.message, /received object/);
      return true;
    },
  );
});

test("semanticTokens: EVERY message branch names semanticTokens, never the delegate", () => {
  // The omitted-argument branch was unpinned for `callee` until this test existed: a mutation
  // hard-coding `highlight` into it survived the whole suite. `semanticTokens(src)` is the most
  // likely mistake against this API, and sending that caller to `highlight()` — a different
  // function — is exactly the misdirection this guards.
  //
  // Whole-message equality, and every `ArgumentKind` the caller can reach. Both matter and both
  // were learned the hard way: a suffix match let text be *prepended*, and a sweep that omitted
  // `symbol` let a `callee`-specific arm for symbols ship green on this side alone — the mirror in
  // `highlight.test.mjs` cannot see a `semanticTokens`-side bug in this region.
  const tail = {
    required:
      '`document` is required: name the source, e.g. semanticTokens(source, "<input>").',
    object:
      'An options object belongs in the THIRD argument — semanticTokens(source, "<input>", { profiles }). ' +
      "Passed second it would bind to `document`, which is why this is rejected rather than " +
      "silently discarding your options.",
    generic:
      'Pass a string naming the source, e.g. semanticTokens(source, "<input>").',
  };
  const cases = [
    [undefined, "undefined", "required"],
    [{ profiles: DISCRIMINATING_PROFILES }, "object", "object"],
    // The empty bag: the object row the `adviceFor` JSDoc names as the decisive cost of the
    // deferred shape test, so its advice is swept rather than only its kind.
    [{}, "object", "object"],
    [new Date(0), "object", "object"],
    [new Map(), "object", "object"],
    [/x/, "object", "object"],
    [new String("x"), "object", "object"],
    // The null-prototype bag carries the object arm's central justification (a prototype-narrowed
    // predicate would misroute the real mistake shape), so it is swept on both sides, not one.
    [
      Object.assign(Object.create(null), { profiles: DISCRIMINATING_PROFILES }),
      "object",
      "object",
    ],
    [null, "null", "generic"],
    [["core-language"], "array", "generic"],
    [42, "number", "generic"],
    [true, "boolean", "generic"],
    [Math.max, "function", "generic"],
    [Symbol("s"), "symbol", "generic"],
    [1n, "bigint", "generic"],
  ];
  const expected = (kind, arm) =>
    "semanticTokens(source, document, options): `document` must be a string naming the source, " +
    `but received ${kind}. ${tail[arm]}`;

  for (const [value, kind, arm] of cases) {
    let message;
    assert.throws(
      () => OL.semanticTokens("print 1", value),
      (error) => {
        message = error.message;
        return error instanceof TypeError;
      },
    );
    assert.equal(message, expected(kind, arm), `${kind} → ${arm} arm`);
  }
  // The true one-argument arity, not just an explicit `undefined`.
  let omitted;
  assert.throws(
    () => OL.semanticTokens("print 1"),
    (error) => {
      omitted = error.message;
      return error instanceof TypeError;
    },
  );
  assert.equal(omitted, expected("undefined", "required"));

  // Every kind is either swept above or explicitly excepted, plus three further claims the review
  // gate found unpinned in earlier rounds: the EXCEPTION (stated as a partition, so there is no
  // filter predicate left to widen — a `filter(k => !excepted.includes(k))` form let a kind be
  // hidden by appending a conjunct), the ROUTING (keys being total says nothing about the values —
  // changing a kind's arm and co-editing its row ships wrong advice green), and arm LIVENESS (an
  // arm written but reached by no kind is otherwise caught only by the coverage gate). The oracles
  // are the shipped `ARM_FOR_KIND`/`ADVICE_BY_ARM`, total by their `Record` types. The mirror of
  // this check lives in `highlight.test.mjs` and reads the same oracles.
  const withoutAdvice = ["string"];
  assert.deepEqual(
    withoutAdvice,
    ["string"],
    "widening this exception hides a kind's advice",
  );
  assert.deepEqual(
    [...new Set(cases.map(([, kind]) => kind)), ...withoutAdvice].sort(),
    Object.keys(ARM_FOR_KIND).sort(),
  );
  const kindsRoutedTo = (arm) =>
    Object.keys(ARM_FOR_KIND)
      .filter((kind) => ARM_FOR_KIND[kind] === arm)
      .sort();
  assert.deepEqual(kindsRoutedTo("required"), ["undefined"]);
  assert.deepEqual(kindsRoutedTo("object"), ["object"]);
  assert.deepEqual(
    [...new Set(Object.values(ARM_FOR_KIND))].sort(),
    Object.keys(ADVICE_BY_ARM).sort(),
    "every advice arm must be reached by at least one kind, and vice versa",
  );
});

test("semanticTokens: a fixed set of non-string documents is rejected — tripwire, not an oracle", () => {
  // The mirror of `highlight.test.mjs`'s tripwire, and it must exist on BOTH sides: the probe it
  // guards against changes the shared guard, but this file's own sweep is what caught it, and a
  // `semanticTokens`-side gap is invisible from the other file.
  //
  // Deliberately hard-coded and deliberately redundant with `cases` above, reading NEITHER
  // `ARM_FOR_KIND` nor the exception. The list this replaces was deleted as a duplicate — true of
  // its stated purposes, false of its unstated one: it was the only thing outside the exception
  // machinery, so widening that machinery could not move it. Do not delete it as dead again.
  for (const value of [
    true,
    42,
    null,
    ["core-language"],
    {},
    Symbol("s"),
    1n,
    Math.max,
    undefined,
  ]) {
    assert.throws(
      () => OL.semanticTokens("print 1", value),
      TypeError,
      `document = ${Object.prototype.toString.call(value)}`,
    );
  }
  assert.throws(() => OL.semanticTokens("print 1"), TypeError);
  // The other half: a guard that rejected everything would pass the loop above.
  assert.doesNotThrow(() => OL.semanticTokens("print 1", "doc.logo"));
});

test("semanticTokens: a string document still labels every span and never throws on bad source", () => {
  const tokens = OL.semanticTokens("define [ 3 +", doc);
  assert.ok(tokens.length > 0);
  for (const token of tokens) {
    assert.equal(token.source_span.document, doc);
    assert.ok(Array.isArray(token.modifiers));
  }
});
