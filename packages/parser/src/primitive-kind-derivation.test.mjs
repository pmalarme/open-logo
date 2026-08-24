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

/**
 * **The oracle.** Every registered primitive's Kind, read off the spec BY HAND — not from the
 * registry under test — so a wrong Kind fails here instead of being agreed with by every sweep
 * that derives its expectation from the lookup it is testing. QA's mutation probe on issue #932
 * measured exactly that gap: flipping `stamp` to `reporter`, contradicting `spec/commands.md:1593`,
 * passed 4203 tests and 898 fixtures. This table is what closes it.
 *
 * Sources, one per profile: `spec/commands.md`'s per-primitive `- **Kind:**` lines (Core and
 * Turtle & Rendering); `spec/data-structures.md`'s `R` rows; `spec/geometry-module.md`'s overlay
 * table (`C`); `spec/turtles-and-sprites.md`'s "Canonical forms" (`R`);
 * `spec/interaction-events.md`'s `### input`/`### wait` and Sound entries; and
 * `spec/conformance.md`'s Educational and Tutor (AI) signature tables (`Command`). The five
 * Turtle & Rendering one-word alias spellings carry their canonical's Kind because
 * `spec/commands.md` documents them on that primitive's own **Aliases** row, and Kind is a
 * property of the primitive, not of the spelling.
 */
const SPEC_PRIMITIVE_KIND = new Map([
  // Core Language — `spec/commands.md`: `print`, `show`, and `randomize` are the only Commands.
  ["print", "command"],
  ["show", "command"],
  ["randomize", "command"],
  ["thing", "reporter"],
  ["abs", "reporter"],
  ["sqrt", "reporter"],
  ["int", "reporter"],
  ["round", "reporter"],
  ["power", "reporter"],
  ["random", "reporter"],
  ["sin", "reporter"],
  ["cos", "reporter"],
  ["tan", "reporter"],
  ["pi", "reporter"],
  ["empty?", "reporter"],
  ["member?", "reporter"],
  ["is_a?", "reporter"],
  ["repcount", "reporter"],
  ["word", "reporter"],
  ["sentence", "reporter"],
  ["first", "reporter"],
  ["last", "reporter"],
  ["butfirst", "reporter"],
  ["butlast", "reporter"],
  ["fput", "reporter"],
  ["lput", "reporter"],
  ["count", "reporter"],
  ["uppercase", "reporter"],
  ["lowercase", "reporter"],
  // Turtle & Rendering — movement and pen/screen Commands, position/heading Reporters.
  ["forward", "command"],
  ["back", "command"],
  ["left", "command"],
  ["right", "command"],
  ["home", "command"],
  ["set_xy", "command"],
  ["setxy", "command"],
  ["set_heading", "command"],
  ["seth", "command"],
  ["show_turtle", "command"],
  ["hide_turtle", "command"],
  ["pen_up", "command"],
  ["pen_down", "command"],
  ["clear_screen", "command"],
  ["clean", "command"],
  ["set_color", "command"],
  ["setcolor", "command"],
  ["set_background", "command"],
  ["setbg", "command"],
  ["set_width", "command"],
  ["setwidth", "command"],
  ["fill", "command"],
  ["stamp", "command"],
  ["set_shape", "command"],
  ["xcor", "reporter"],
  ["ycor", "reporter"],
  ["heading", "reporter"],
  ["pos", "reporter"],
  ["towards", "reporter"],
  ["distance", "reporter"],
  // Data — every row of the list/dict/record tables is `R`.
  ["reverse", "reporter"],
  ["pick", "reporter"],
  ["sort", "reporter"],
  ["list", "reporter"],
  ["dict", "reporter"],
  ["keys", "reporter"],
  ["values", "reporter"],
  ["type_of", "reporter"],
  // Geometry — the three renderer-backed overlay primitives are `C`.
  ["grid", "command"],
  ["axes", "command"],
  ["measure", "command"],
  // Sprites — the three turtle-identity reporters are `R`.
  ["new_turtle", "reporter"],
  ["who", "reporter"],
  ["turtles", "reporter"],
  // Interaction & Events — `wait` is a command, `input` a reporter.
  ["wait", "command"],
  ["input", "reporter"],
  // Sound — all five are commands.
  ["set_tempo", "command"],
  ["beep", "command"],
  ["note", "command"],
  ["rest", "command"],
  ["play", "command"],
  // Educational and Tutor (AI) — every meta-command is `Command`, arity 0.
  ["explain", "command"],
  ["why", "command"],
  ["hint", "command"],
  ["debug", "command"],
  ["challenge", "command"],
]);

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

test("every registered primitive's Kind matches the spec, in both directions (issue #932)", () => {
  // The oracle test. Unlike the sweeps below it does NOT ask the implementation what a name's kind
  // is — it asserts the spec's answer, so flipping any single row of any profile's table fails
  // here. Both directions: every registered name is covered by the oracle, and every oracle entry
  // is a name some profile actually registers (so the table cannot rot into stale rows either).
  const registered = new Set();
  for (const profile of OL.OL_CHECK_PROFILES) {
    for (const name of OL.profilePrimitiveNames(profile)) {
      registered.add(name);
      const expected = SPEC_PRIMITIVE_KIND.get(name);
      assert.notEqual(
        expected,
        undefined,
        `${name} (registered by ${profile}) has no spec-derived Kind in this test's oracle`,
      );
      assert.equal(
        OL.isPrimitiveCommandName(name) ? "command" : "reporter",
        expected,
        `${name} (registered by ${profile}) is classified against the spec's Kind`,
      );
    }
  }
  for (const name of SPEC_PRIMITIVE_KIND.keys()) {
    assert.ok(
      registered.has(name),
      `the oracle lists ${name}, which no profile registers — stale row`,
    );
  }
  assert.equal(
    registered.size,
    SPEC_PRIMITIVE_KIND.size,
    "the oracle and the registry must cover exactly the same names",
  );
});

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
  // spellings only, no new semantics" (`spec/conformance.md:150`), so an alias must not carry a
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

test("the Data, Interaction & Events and Tutor profiles are classified too (issue #932)", () => {
  // The three profiles the first round of these tests left unpinned by name. `wait`/`input` are
  // the sharpest pair in the registry: one profile, one command, one reporter, so swapping them
  // is invisible to any sweep that asks the implementation what they are.
  const profiles = [
    "core-language",
    "data",
    "interaction-events",
    "educational",
    "tutor-ai",
  ];
  for (const body of ["wait 1", "explain", "hint", "debug", "why"]) {
    assert.deepEqual(
      checkCodes(`:x = map n in [1 2 3] [ ${body} ]`, profiles),
      ["ol-no-value"],
      `expected exactly ol-no-value for a body ending in ${body}`,
    );
  }
  for (const body of ["input 1", "reverse [1 2]", "keys :d", "sort [2 1]"]) {
    assert.deepEqual(
      checkCodes(`:d = {}\n:x = map n in [1 2 3] [ ${body} ]`, profiles),
      [],
      `expected a clean check for a body ending in ${body}`,
    );
  }
});

test("challenge is classified a command even though it has no checker visibility yet (issue #932)", () => {
  // `challenge` is the one registered primitive `checker-names.ts` deliberately withholds
  // visibility from — it has no runtime, so a program using it must still be told
  // `ol-unknown-command`. Its Kind is registered nonetheless, so a comprehension body ending in it
  // now reports BOTH codes where before issue #932 it reported only the first. Pinned as measured
  // rather than left to be discovered: the two rules answer different questions (is this name
  // visible? does this statement produce a value?), and `spec/tooling.md:179-192` gives them
  // separate rows.
  assert.deepEqual(
    checkCodes(":x = map n in [1 2 3] [ challenge ]", [
      "core-language",
      "tutor-ai",
    ]),
    ["ol-unknown-command", "ol-no-value"],
  );
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
