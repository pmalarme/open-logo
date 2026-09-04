// Unit tests for `checker-names.ts`'s profile derivation (issue #966) — the half of epic #900 that
// says *no component enumerates built-in names by hand*, applied to the checker's own name model.
//
// The defect these pin: `OPTIONAL_PROFILE_NAMES` was a hand-written ladder of `...someNames()`
// spreads and `collectVisibleNames` a nine-branch `if (active.has(<profile>))` chain, each extended
// one slice at a time. The ladder never grew a Tutor arm when issue #838 registered
// `TUTOR_PRIMITIVE_ARITY`, so `isOptionalProfileName("challenge")` answered `false` — `challenge`
// ranked as a Core word in the did-you-mean tie-break — while `checker-style.ts`'s *derived* rule
// had absorbed the same registration with no edit at all. Same registry, two consumers, and only
// the hand-maintained one drifted.
//
// Everything below is derived from the registries rather than restated, so a profile that gains a
// table is covered without editing this file — which is the property under test, not a convenience.

import assert from "node:assert/strict";
import { test } from "node:test";
import * as OL from "@openlogo/parser";

/** Every profile except Core — the ones `isOptionalProfileName` must answer `true` for. */
const OPTIONAL_PROFILES = OL.OL_CHECK_PROFILES.filter(
  (profile) => profile !== "core-language",
);

/** Every name an optional profile registers, from the profile-keyed registries themselves. */
function optionalProfileRegisteredNames() {
  return [
    ...OPTIONAL_PROFILES.flatMap((profile) =>
      OL.profilePrimitiveNames(profile),
    ),
    ...OPTIONAL_PROFILES.flatMap(
      (profile) => OL.OL_PROFILE_KEYWORDS[profile] ?? [],
    ),
    // Heritage's aliases carry no arity, so `PROFILE_PRIMITIVES.heritage` is `null` by design and
    // `profilePrimitiveNames("heritage")` is correctly empty. They are still that profile's names.
    ...OL.heritageAliasNames(),
  ];
}

test("the registries are non-empty, so nothing below can pass vacuously", () => {
  const names = optionalProfileRegisteredNames();
  assert.ok(
    names.length > 50,
    `expected the optional profiles to register their tables, got ${names.length}`,
  );
  assert.ok(OPTIONAL_PROFILES.length > 5, "the profile DAG is not enumerating");
});

test("every name an optional profile registers is classified as an optional-profile name", () => {
  const missed = optionalProfileRegisteredNames().filter(
    (name) => !OL.isOptionalProfileName(name),
  );
  assert.deepEqual(
    [...new Set(missed)].sort(),
    [],
    "optional-profile names the tie-break would rank as Core",
  );
});

test("challenge is an optional-profile word, not a Core one", () => {
  // The regression this slice fixes, named rather than left to the sweep above. On the tree that
  // filed issue #966 this answered `false` — `challenge` was 1 of 56 non-Core primitives by the
  // registry's count (1 of 69 by `spec/built-in-names.json`'s, which additionally classifies the
  // 13 Heritage aliases as `profile: heritage` primitives), and the only one missing.
  assert.equal(OL.isOptionalProfileName("challenge"), true);
  assert.equal(
    OL.profilePrimitiveNames("tutor-ai").includes("challenge"),
    true,
    "challenge must still be what the Tutor profile registers",
  );
});

test("a Core primitive and a Core keyword are not optional-profile names", () => {
  // The false-positive half. Without it the sweep above passes for a predicate that returns `true`
  // for everything, which would silently invert the tie-break instead of fixing it.
  const coreOnly = [
    ...OL.profilePrimitiveNames("core-language"),
    ...OL.OL_KEYWORDS,
  ].filter((name) => !optionalProfileRegisteredNames().includes(name));
  assert.ok(coreOnly.length > 20, `only ${coreOnly.length} Core-only names`);
  const misclassified = coreOnly.filter((name) =>
    OL.isOptionalProfileName(name),
  );
  assert.deepEqual(
    [...new Set(misclassified)].sort(),
    [],
    "Core names the tie-break would demote beneath an optional-profile word",
  );
});

test("an ordinary learner name belongs to no profile", () => {
  for (const name of ["square", "my_shape", "spiral", "challenger"]) {
    assert.equal(OL.isOptionalProfileName(name), false, name);
  }
});

test("matching is case-insensitive, like every other identifier lookup", () => {
  for (const spelling of ["CHALLENGE", "Forward", "fD", "ASK"]) {
    assert.equal(
      OL.isOptionalProfileName(spelling),
      true,
      `${spelling} must classify as its lowercase canonical does`,
    );
  }
  assert.equal(OL.isOptionalProfileName("PRINT"), false, "print is Core");
});

// --- visibility, which reads the same registries and differs only by callability ------------------

/** `check()`'s diagnostics for `source` under `profiles`. */
function checkCodes(source, profiles) {
  const { ast, diagnostics } = OL.parse(source);
  assert.deepEqual(
    diagnostics,
    [],
    `expected a clean parse for ${JSON.stringify(source)}`,
  );
  return OL.check(ast, { profiles }).diagnostics.map((finding) => finding.code);
}

test("every registered primitive of an active profile is callable without ol-unknown-command", () => {
  // The visibility half of the same derivation: `collectVisibleNames` sweeps the same registries,
  // so a profile registered later is visible with no edit — and since issue #815 it withholds
  // NOTHING. `spec/error-model.md:131` forbids withholding a registered name so that its call
  // reads as unknown: the name is known, and a call to one this implementation cannot evaluate is
  // `ol-not-implemented` at the layer that knows, never `ol-unknown-command` here. So the exact
  // expectation is now the empty set, and any name that stops being visible fails naming itself.
  const notVisible = [];
  for (const profile of OL.OL_CHECK_PROFILES) {
    const profiles = ["core-language", profile];
    for (const name of OL.profilePrimitiveNames(profile)) {
      if (checkCodes(name, profiles).includes("ol-unknown-command")) {
        notVisible.push(name);
      }
    }
  }
  assert.deepEqual([...new Set(notVisible)].sort(), []);
});

test("a profile's callable names are invisible while the profile is inactive", () => {
  // The gate `spec/tooling.md:175-176` requires. The sweep above would also pass for a model that
  // ignored `profiles` entirely and made every name visible always; this is what rules that out.
  //
  // Covers every **callable** name an optional profile contributes — its primitives and, for
  // Heritage, its short aliases — so the alias leg is exercised rather than primitives alone. The
  // profile **keywords** (`ask`/`each`/`tell`, the four event heads) are deliberately excluded and
  // the title says so: they are statement heads that take an argument and a block, so a bare `ask`
  // does not parse at all and could not reach the visibility question this test asks. Their
  // profile-gated behaviour is covered by `sprites-tooling.test.mjs` and
  // `interaction-tooling.test.mjs`, which write the whole form.
  for (const profile of OPTIONAL_PROFILES) {
    const callable = [
      ...OL.profilePrimitiveNames(profile),
      ...(profile === "heritage" ? OL.heritageAliasNames() : []),
    ];
    for (const name of callable) {
      assert.equal(
        checkCodes(name, ["core-language"]).includes("ol-unknown-command"),
        true,
        `${name} belongs to ${profile} and must be unknown under Core alone`,
      );
    }
  }
});
