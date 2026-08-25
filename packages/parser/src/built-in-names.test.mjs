// Unit tests for `built-in-names.ts` — the one predicate both `check()` and `execute()` consult for
// *"does OpenLogo own this name?"* (issue #841).
//
// Everything here is derived from the parser's own registries rather than restated, so a profile
// that gains a keyword or a table that gains a primitive is covered without editing this file. The
// separate question of whether those registries match the normative `spec/built-in-names.json` is
// ADR-0021's, and `npm run built-in-names` is what answers it — deliberately not duplicated here,
// since a test drawing its expected value from the implementation cannot check the implementation
// against a normative artifact.

import assert from "node:assert/strict";
import { test } from "node:test";
import * as OL from "@openlogo/parser";

/** Every primitive every registered profile contributes, straight off the profile registry. */
const ALL_PROFILE_PRIMITIVES = OL.OL_CHECK_PROFILES.flatMap((profile) =>
  OL.profilePrimitiveNames(profile),
);

test("the registries are non-empty, so nothing below can pass vacuously", () => {
  assert.ok(
    ALL_PROFILE_PRIMITIVES.length > 50,
    `expected the profile registry to carry the primitive tables, got ${ALL_PROFILE_PRIMITIVES.length}`,
  );
  assert.ok(OL.heritageAliasNames().length > 0, "no Heritage aliases");
  assert.ok(OL.OL_KEYWORDS.length > 0, "no Core keywords");
});

test("every registered primitive of every profile is a built-in name", () => {
  const missed = ALL_PROFILE_PRIMITIVES.filter(
    (name) => !OL.isBuiltInName(name),
  );
  assert.deepEqual(missed, [], "registered primitives the predicate misses");
});

test("every Core keyword and every profile keyword is a built-in name", () => {
  const keywords = [
    ...OL.OL_KEYWORDS,
    ...Object.values(OL.OL_PROFILE_KEYWORDS).flat(),
  ];
  const missed = keywords.filter((name) => !OL.isBuiltInName(name));
  assert.deepEqual(missed, [], "keywords the predicate misses");
});

test("an ordinary learner name is not a built-in name", () => {
  // The false-positive guard. The alias recursion must not fire for a non-alias, and no lookup may
  // match by prefix or substring — `asker` and `forward_step` are the cases that would catch it.
  for (const name of [
    "square",
    "my_shape",
    "spiral",
    "greet",
    "forward_step",
    "asker",
    "when_ready",
  ]) {
    assert.equal(
      OL.isBuiltInName(name),
      false,
      `${name} is an ordinary name and must stay declarable`,
    );
  }
});

test("matching is case-insensitive, like every other identifier lookup", () => {
  for (const spelling of ["FORWARD", "Forward", "fOrWaRd", "ASK", "Pr"]) {
    assert.equal(
      OL.isBuiltInName(spelling),
      true,
      `${spelling} must match its lowercase canonical`,
    );
  }
});

test("a Heritage alias is a built-in name exactly when its canonical is", () => {
  // `spec/conformance.md:150` — Heritage is alternate spellings only, no new semantics — so
  // `define pr` must be exactly as illegal as `define print`. The alias leg resolves and re-enters
  // the same lookup rather than consulting a table of its own, which is what makes this hold by
  // construction rather than by a second list kept in step.
  for (const alias of OL.heritageAliasNames()) {
    const canonical = OL.canonicalOfHeritageAlias(alias);
    assert.equal(
      OL.isBuiltInName(alias),
      OL.isBuiltInName(canonical),
      `${alias} and its canonical ${canonical} must answer alike`,
    );
  }
});

test("alias resolution is depth-1, so the recursion terminates by construction", () => {
  // The registry is the thing to guard: an alias whose canonical were itself an alias would loop,
  // and no depth counter inside the predicate would make that language sane. Guard the shape.
  for (const alias of OL.heritageAliasNames()) {
    const canonical = OL.canonicalOfHeritageAlias(alias);
    assert.equal(
      OL.canonicalOfHeritageAlias(canonical),
      undefined,
      `${alias} resolves to ${canonical}, which is itself an alias`,
    );
  }
});

test("the predicate takes no profile set, so supplying one changes nothing", () => {
  // `spec/grammar.md:408`: a profile decides whether a name works, never whether a program may
  // declare it. The extra argument is ignored, which is exactly the property being pinned — there
  // is no profile parameter for a caller to get wrong.
  for (const name of [
    "ask",
    "when",
    "grid",
    "wait",
    "set_tempo",
    "new_turtle",
  ]) {
    assert.equal(OL.isBuiltInName(name), true, `${name} is built in`);
    assert.equal(
      OL.isBuiltInName(name, ["core-language"]),
      true,
      `${name} must not become declarable when a profile set is supplied`,
    );
  }
});

// --- The two keyword axes, which read one registry and answer differently ------------------------

test("isKeywordInAnyProfile is unconditional where isKeyword stays gated", () => {
  // The split issue #841 introduced. `spec/tooling.md:30` gates the PAINT axis on the active
  // profile ("while their profile is active"); `spec/grammar.md:408` refuses to gate the
  // DECLARATION axis. Both read `OL_PROFILE_KEYWORDS`, so this pins that they disagree only about
  // *when* a word counts — never about which words there are.
  for (const [profile, words] of Object.entries(OL.OL_PROFILE_KEYWORDS)) {
    for (const word of words) {
      assert.equal(
        OL.isKeywordInAnyProfile(word),
        true,
        `${word} is a keyword for the declaration axis regardless of profile`,
      );
      assert.equal(
        OL.isKeyword(word, ["core-language"]),
        false,
        `${word} must not paint as a keyword while ${profile} is inactive`,
      );
      assert.equal(
        OL.isKeyword(word, [profile]),
        true,
        `${word} must paint as a keyword while ${profile} is active`,
      );
    }
  }
});

test("isKeywordInAnyProfile still answers for the profile-independent Core keywords", () => {
  // It is `isKeyword` with every keyword-contributing profile supplied, not a profile-only lookup,
  // so the Core list must still match through it.
  for (const keyword of OL.OL_KEYWORDS) {
    assert.equal(
      OL.isKeywordInAnyProfile(keyword),
      true,
      `${keyword} is a Core keyword`,
    );
  }
  assert.equal(OL.isKeywordInAnyProfile("square"), false);
});

// --- the Heritage surface registries, which contributed nothing at all (issue #965) --------------

test("every Heritage surface spelling is a built-in name", () => {
  // `heritageSurfaceSpellings()` is the enumerable definition of "a word that makes the reader take
  // a Heritage spelling": the short aliases, the four form heads (`make`/`to`/`output`/`op`) and
  // the worded reader's head (`value`). Driven off the registry, so a spelling added to any of the
  // three tables is covered here with no edit.
  const missed = OL.heritageSurfaceSpellings().filter(
    (spelling) => !OL.isBuiltInName(spelling),
  );
  assert.deepEqual(
    missed,
    [],
    "Heritage surface spellings the predicate misses",
  );
});

test("the form-head registries reach the predicate, not merely the keyword list", () => {
  // **Read this test for what it does NOT prove today.** Every current form head is also a reserved
  // keyword, so each of these names is true through the keyword leg as well — measured on the tree
  // that closed issue #965: for all five, `primitiveArity` is `undefined` and none is a short
  // alias, so the form-head registries supplied ZERO names the keyword leg had not. This assertion
  // therefore cannot fail today by deleting the surface-spelling leg, and claiming otherwise would
  // be the kind of green signal this epic exists to remove.
  //
  // What it does is fail the moment the registries stop coinciding — a form head registered without
  // also being a reserved keyword, which is the exact case that would have been registered, listed
  // in the manifest, passed `npm run built-in-names`, and still answered `false` at both declaration
  // slots. The guard has to be in place before that slice, because that is the slice in which
  // nothing else would fail.
  const heads = [
    ...OL.heritageFormHeadNames(),
    ...OL.heritageWordedFormHeads(),
  ];
  assert.ok(heads.length > 0, "no form heads registered");
  for (const head of heads) {
    assert.equal(
      OL.isBuiltInName(head),
      true,
      `${head} is a registered Heritage form head, so a program may not declare it`,
    );
    assert.equal(
      OL.heritageSurfaceSpellings().includes(head),
      true,
      `${head} must reach isBuiltInName through the surface-spelling registry, not by luck`,
    );
  }
});

test("a Heritage form head resolves to a Core spelling the predicate also owns", () => {
  // `canonicalOfHeritageFormHead` resolves `to` → `define` and had no caller in this predicate's
  // module (issue #965 item 3). It is consumed here rather than left as an accessor nothing calls:
  // Heritage is "alternate spellings only, no new semantics" (`spec/conformance.md:150`), so
  // `define to` must be exactly as illegal as `define define`, and this is what asserts it.
  for (const head of OL.heritageFormHeadNames()) {
    const canonical = OL.canonicalOfHeritageFormHead(head);
    assert.equal(
      OL.isBuiltInName(head),
      OL.isBuiltInName(canonical),
      `${head} and its canonical ${canonical} must answer alike`,
    );
  }
});
