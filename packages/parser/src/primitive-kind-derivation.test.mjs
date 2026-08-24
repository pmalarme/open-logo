import assert from "node:assert/strict";
import { test } from "node:test";
import * as OL from "@openlogo/parser";

/**
 * Issue #932 — **command-vs-reporter classification must cover every profile that registers
 * primitives, by derivation rather than by enumeration.**
 *
 * The defect: `checker-control-flow.ts` hand-listed three names (`print`/`show`/`randomize`) as
 * "the commands", and `@openlogo/runtime`'s `evaluate.ts` carried a verbatim second copy. Both
 * halves were wrong in both directions at once — `:x = map n in [1 2 3] [ forward :n ]` was silent
 * in `check()` AND in `execute()` where `print` raised `ol-no-value`, while
 * `repeat 4 [ forward 100 right 90 ]` — `spec/grammar.md:271` and `:294`, the specification's own
 * instruction-block example — earned `ol-style-useless-value` with the style layer on.
 *
 * The fix makes each primitive's **Kind** a mandatory column of its registration row in
 * `signatures.ts`, so a profile's command-name set and its arity table are two derivations of the
 * same rows. **These tests are written to match**: the sweeps below walk `OL_CHECK_PROFILES` and
 * `profilePrimitiveNames()` and restate no profile-specific name, so they assert `stamp`, `beep`,
 * `measure`, `new_turtle` and every other registered primitive — and extend to a future profile's
 * primitives with no edit here. A test naming only the newly-classified commands would pass just
 * as well for a hand-appended list, which is the distinction the three-name list kept missing.
 *
 * Behavior is verified against the built `@openlogo/parser` entry point per the shared black-box
 * test convention.
 */

const document = "primitive-kind.logo";

/** Every profile, always paired with Core so keywords and Core primitives stay visible. */
function activeSet(profile) {
  return profile === "core-language" ? [profile] : ["core-language", profile];
}

function parseClean(source) {
  const { ast, diagnostics } = OL.parse(source, document);
  assert.deepEqual(
    diagnostics,
    [],
    `expected a clean parse for ${JSON.stringify(source)}`,
  );
  return ast;
}

function checkCodes(source, profiles, style = false) {
  return OL.check(parseClean(source), {
    profiles,
    style,
    source,
  }).diagnostics.map((finding) => finding.code);
}

/** `name a b …` with as many numeric arguments as its bare call form takes. */
function bareCall(name, arity) {
  return [name, ...Array.from({ length: arity }, (_, index) => index + 1)].join(
    " ",
  );
}

// --- the derived sweeps -------------------------------------------------------
//
// These name no command. Their subject is "every primitive of every profile in the DAG".

test("every registered primitive is classified as a command or a reporter, and the two lookups agree", () => {
  let registered = 0;
  let commands = 0;

  for (const profile of OL.OL_CHECK_PROFILES) {
    const profiles = activeSet(profile);
    for (const name of OL.profilePrimitiveNames(profile)) {
      registered += 1;
      const active = OL.isActiveProfileCommandName(name, profiles);
      assert.equal(
        typeof active,
        "boolean",
        `${name} (${profile}) must have a classification`,
      );
      // The profile-blind lookup `@openlogo/runtime` uses and the profile-aware lookup the checker
      // uses read the same rows, so they cannot disagree about a registered name — which is what
      // makes `check()` and `execute()` agree on a comprehension body without a second list.
      assert.equal(
        OL.isPrimitiveCommandName(name),
        active,
        `${name} (${profile}) is classified differently by the blind and profile-aware lookups`,
      );
      if (active) {
        commands += 1;
      }
    }
  }

  assert.ok(
    registered > 50,
    `expected the registry to carry every profile's primitives, got ${registered}`,
  );
  assert.ok(
    commands > 3,
    `expected commands beyond the three Core ones, got ${commands}`,
  );
});

test("a comprehension body ending in a registered command raises ol-no-value, and one ending in a reporter does not", () => {
  for (const profile of OL.OL_CHECK_PROFILES) {
    const profiles = activeSet(profile);
    for (const name of OL.profilePrimitiveNames(profile)) {
      const arity = OL.activeProfilePrimitiveArityRange(name, profiles).min;
      const source = `:x = map n in [1 2 3] [ ${bareCall(name, arity)} ]`;
      const codes = checkCodes(source, profiles);
      assert.equal(
        codes.includes("ol-no-value"),
        OL.isActiveProfileCommandName(name, profiles),
        `${source} under ${profiles.join("+")} reported ${JSON.stringify(codes)}`,
      );
    }
  }
});

test("a control body ending in a registered command is style-clean, and one ending in a reporter warns", () => {
  for (const profile of OL.OL_CHECK_PROFILES) {
    const profiles = activeSet(profile);
    for (const name of OL.profilePrimitiveNames(profile)) {
      const arity = OL.activeProfilePrimitiveArityRange(name, profiles).min;
      const source = `repeat 4 [ ${bareCall(name, arity)} ]`;
      const codes = checkCodes(source, profiles, true);
      assert.equal(
        codes.includes("ol-style-useless-value"),
        !OL.isActiveProfileCommandName(name, profiles),
        `${source} under ${profiles.join("+")} reported ${JSON.stringify(codes)}`,
      );
    }
  }
});

// --- the classification lookups ----------------------------------------------

test("a primitive of an inactive profile is not a known command", () => {
  assert.equal(
    OL.isActiveProfileCommandName("forward", ["core-language"]),
    false,
  );
  assert.equal(
    OL.isActiveProfileCommandName("forward", [
      "core-language",
      "turtle-rendering",
    ]),
    true,
  );
});

test("a name no profile registers is not a command, under either lookup", () => {
  assert.equal(OL.isPrimitiveCommandName("my_procedure"), false);
  assert.equal(
    OL.isActiveProfileCommandName("my_procedure", OL.OL_CHECK_PROFILES),
    false,
  );
});

test("classification is case-insensitive, like every other name lookup", () => {
  assert.equal(OL.isPrimitiveCommandName("FORWARD"), true);
  assert.equal(
    OL.isActiveProfileCommandName("FoRwArD", [
      "core-language",
      "turtle-rendering",
    ]),
    true,
  );
});

test("a Heritage alias is classified as the canonical it is a spelling of", () => {
  // `fd` → `forward` (a command) and `se` → `sentence` (a reporter): Heritage is "alternate
  // spellings only, no new semantics" (`spec/conformance.md:146`), so an alias must not carry a
  // classification of its own.
  assert.equal(OL.isPrimitiveCommandName("fd"), true);
  assert.equal(OL.isPrimitiveCommandName("se"), false);
  for (const alias of OL.heritageAliasNames()) {
    assert.equal(
      OL.isPrimitiveCommandName(alias),
      OL.isPrimitiveCommandName(OL.canonicalOfHeritageAlias(alias)),
      `${alias} must classify as ${OL.canonicalOfHeritageAlias(alias)} does`,
    );
  }
});

test("a Heritage alias needs both its own profile and its canonical's to be a known command", () => {
  // Heritage inactive: the alias is not a visible spelling at all.
  assert.equal(
    OL.isActiveProfileCommandName("fd", ["core-language", "turtle-rendering"]),
    false,
  );
  // Heritage active but the canonical's profile is not: `fd` resolves to `forward`, which no
  // active profile registers, so its kind is not statically known.
  assert.equal(
    OL.isActiveProfileCommandName("fd", ["core-language", "heritage"]),
    false,
  );
  assert.equal(
    OL.isActiveProfileCommandName("fd", [
      "core-language",
      "turtle-rendering",
      "heritage",
    ]),
    true,
  );
  // `pr` → `print`, whose profile is Core, so Heritage plus Core is enough.
  assert.equal(
    OL.isActiveProfileCommandName("pr", ["core-language", "heritage"]),
    true,
  );
  // A name that is not an alias at all still resolves to `false` with Heritage active.
  assert.equal(
    OL.isActiveProfileCommandName("my_procedure", [
      "core-language",
      "heritage",
    ]),
    false,
  );
});

// --- the two measured regressions of issue #932 -------------------------------

test("ol-no-value covers a non-Core command in a value-position comprehension (issue #932)", () => {
  const profiles = [
    "core-language",
    "turtle-rendering",
    "sound",
    "heritage",
    "educational",
  ];
  for (const body of ["forward :n", "beep", "fd :n", "explain", "print :n"]) {
    const source = `:x = map n in [1 2 3] [ ${body} ]`;
    assert.deepEqual(
      checkCodes(source, profiles),
      ["ol-no-value"],
      `expected exactly ol-no-value for ${source}`,
    );
  }
});

test("a value-producing comprehension body stays clean (regression control)", () => {
  const profiles = ["core-language", "turtle-rendering", "sprites"];
  for (const body of [":n * 2", "xcor", "new_turtle", "count [1 2]"]) {
    assert.deepEqual(
      checkCodes(`:x = map n in [1 2 3] [ ${body} ]`, profiles),
      [],
      `expected a clean check for a body ending in ${body}`,
    );
  }
});

test("the spec's own instruction-block example is style-clean (issue #932)", () => {
  // `repeat 4 [ forward 100 right 90 ]` is `spec/grammar.md:271` and `:294`.
  const profiles = ["core-language", "turtle-rendering", "heritage"];
  assert.deepEqual(
    checkCodes("repeat 4 [ forward 100 right 90 ]", profiles, true),
    [],
  );
  assert.deepEqual(checkCodes("repeat 4 [ fd 100 rt 90 ]", profiles, true), []);
  assert.deepEqual(checkCodes("repeat 3 [ print 1 ]", profiles, true), []);
});

test("ol-style-useless-value still fires for a control body ending in a reporter", () => {
  // The half a blanket "treat every call as a command" fix would have silently destroyed.
  assert.deepEqual(
    checkCodes("repeat 3 [ pos ]", ["core-language", "turtle-rendering"], true),
    ["ol-style-useless-value"],
  );
  assert.deepEqual(
    checkCodes("repeat 3 [ count [1 2] ]", ["core-language"], true),
    ["ol-style-useless-value"],
  );
});
