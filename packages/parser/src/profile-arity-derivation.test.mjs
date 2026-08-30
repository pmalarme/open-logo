import assert from "node:assert/strict";
import { test } from "node:test";
import * as OL from "@openlogo/parser";

/**
 * Issue #874 — **the static arity checker must cover every profile that registers primitives, by
 * derivation rather than by enumeration.**
 *
 * The defect: `checker-arity.ts` hand-wrote one `if (<profile>Active) { … }` branch per profile,
 * and Turtle & Rendering, Educational, Sprites, and Tutor had none. `(home 10)` and
 * `(clear_screen 10)` checked completely clean while `execute()` raised `ol-too-many-inputs` for
 * the very same call — the two stages disagreeing about one program, on two of the first commands
 * a learner types. It was the third instance of one recurring shape (#783 `checker-reserved-word`,
 * #854 `checker-style`, this) in which a checker component enumerates one profile's names by hand
 * and silently skips the rest, which is the shape epic #900 exists to retire.
 *
 * The fix is a profile-keyed registry in `signatures.ts` that the reader and the checker both read,
 * so a registered table is arity-checked automatically. **These tests are written to match**: the
 * sweeps below walk `OL_CHECK_PROFILES` and `profilePrimitiveNames()` and therefore restate no
 * profile-specific command name at all. They assert `towards`, `stamp`, `set_shape`, `new_turtle`,
 * and every other registered primitive — none of which appears in the fix's diff — and they extend
 * to a future profile's primitives with no edit here. A test naming the wired commands would pass
 * just as well for a hand-appended table, which is precisely the distinction that was missed four
 * times.
 *
 * Behavior is verified against the built `@openlogo/parser` entry point per the shared black-box
 * test convention.
 */

/** Every profile, always paired with Core so keywords and Core primitives stay visible. */
function activeSet(profile) {
  return profile === "core-language" ? [profile] : ["core-language", profile];
}

function parseClean(source) {
  const { ast, diagnostics } = OL.parse(source, "profile-arity.logo");
  assert.deepEqual(
    diagnostics,
    [],
    `expected a clean parse for ${JSON.stringify(source)}`,
  );
  return ast;
}

function checkCodes(source, profiles) {
  return OL.check(parseClean(source), { profiles }).diagnostics;
}

/** `(name a b …)` with `count` numeric arguments — the only call form that can over-supply. */
function parenCall(name, count) {
  const args = Array.from({ length: count }, (_, index) => String(index + 1));
  return `(${[name, ...args].join(" ")})`;
}

// --- the derived sweeps -------------------------------------------------------
//
// These name no command. Their subject is "every primitive of every profile in the DAG".

test("every registered primitive of every profile is arity-checked when its profile is active", () => {
  // Tutor's `challenge` is the one registered primitive with no checker visibility yet: it has no
  // runtime, and `checker-names.ts` deliberately withholds visibility from a name nothing can run,
  // so it is reported `ol-unknown-command` — alone, never alongside an arity finding. Asserting the
  // exception as an exact set rather than a skip is what keeps a SECOND withheld name from being
  // added unremarked. Since issue #966 `collectVisibleNames` is derived from the same profile-keyed
  // registry, so a profile registered in `PROFILE_PRIMITIVES` — which TypeScript forces — is made
  // visible with no edit there; what stays hand-written is the withholding itself
  // (`namesAwaitingAnEvaluator()`), and this is the assertion that prices it. Note what neither
  // this test nor any other in this package can detect: that Tutor's evaluator has SHIPPED and the
  // entry is now stale. That is a fact about `@openlogo/runtime`, which the parser must not depend
  // on, so retiring the entry is a human step.
  const notYetVisible = [];
  const openVariadics = [];
  let registered = 0;
  let checked = 0;

  for (const profile of OL.OL_CHECK_PROFILES) {
    const profiles = activeSet(profile);
    for (const name of OL.profilePrimitiveNames(profile)) {
      registered += 1;
      const range = OL.activeProfilePrimitiveArityRange(name, profiles);
      assert.notEqual(
        range,
        undefined,
        `${name} is registered by ${profile} but the active-profile lookup does not see it`,
      );
      assert.ok(
        range.max >= range.min,
        `${name}'s ceiling (${range.max}) is below its floor (${range.min})`,
      );
      if (range.max === Number.POSITIVE_INFINITY) {
        // An open variadic (`(print …)`, `(list …)`) can never be over-supplied — by design.
        openVariadics.push(name);
        continue;
      }
      if (range.max > range.min) {
        // A BOUNDED alternate (`(random a b)`, `(randomize seed)`): supplying exactly the ceiling
        // is legal and must stay clean, which is the half a too-many-only sweep never exercises.
        assert.deepEqual(
          checkCodes(parenCall(name, range.max), profiles),
          [],
          `${name} must accept its ceiling of ${range.max} inputs`,
        );
      }
      const source = parenCall(name, range.max + 1);
      const diagnostics = checkCodes(source, profiles);
      assert.equal(
        diagnostics.length,
        1,
        `${source} under ${profiles.join("+")} must raise exactly one diagnostic, got ${JSON.stringify(
          diagnostics.map((finding) => finding.code),
        )}`,
      );
      const [finding] = diagnostics;
      if (finding.code === "ol-unknown-command") {
        notYetVisible.push(name);
        continue;
      }
      assert.equal(
        finding.code,
        "ol-too-many-inputs",
        `${source} under ${profiles.join("+")}`,
      );
      assert.equal(finding.stage, "semantic");
      assert.deepEqual(finding.params, {
        callable: name,
        expected: range.max,
        actual: range.max + 1,
      });
      checked += 1;
    }
  }

  assert.deepEqual([...new Set(notYetVisible)].sort(), ["challenge"]);
  // The anti-vacuity guard, and the whole of it: 85 is the DAG's exact registered count today, not
  // a conservative bound, so removing or emptying any entry trips this deliberately. If you are
  // reading this because it failed, the question to answer is "was a primitive meant to disappear?"
  // — not "is this bound stale?".
  assert.ok(
    registered >= 85,
    `the DAG registers exactly 85 primitives today; this sweep saw only ${registered}, so a registry entry was emptied or dropped`,
  );
  // Every registered name was accounted for by exactly one of the three buckets. This is a loop
  // invariant, not a property of the checker — as the loop is written today it cannot fail — and is
  // kept only so a future edit that adds a fourth path through the body has to say which bucket it
  // belongs to. The assertions above and below are what actually carry this test.
  assert.equal(
    checked + openVariadics.length + notYetVisible.length,
    registered,
  );
  // The ceiling half, as a tripwire rather than a tautology: exactly these four names are open
  // variadics across the whole DAG. A `maxArity` table wired to the wrong profile shows up here
  // immediately — give `data` Core's ceiling table and `list` drops out of this set; give Core
  // Data's and `print`/`word`/`sentence` do.
  assert.deepEqual(openVariadics.sort(), ["list", "print", "sentence", "word"]);
});

test("a registered primitive is NOT arity-checked when its own profile is inactive", () => {
  // The other half of `spec/tooling.md:175-176`: visibility is per active profile, so with the
  // owning profile switched off the callee is unknown and belongs to `ol-unknown-command` — one
  // finding, never an arity one too. Core is excluded: it is the profile left active throughout.
  for (const profile of OL.OL_CHECK_PROFILES) {
    if (profile === "core-language") {
      continue;
    }
    for (const name of OL.profilePrimitiveNames(profile)) {
      assert.equal(
        OL.activeProfilePrimitiveArityRange(name, ["core-language"]),
        undefined,
        `${name} belongs to ${profile} and must be invisible under Core alone`,
      );
      const source = parenCall(name, 1);
      const diagnostics = checkCodes(source, ["core-language"]);
      assert.equal(diagnostics.length, 1, source);
      assert.equal(diagnostics[0].code, "ol-unknown-command", source);
    }
  }
});

test("each profile's registry entry points at that profile's own source-of-truth table", () => {
  // Guards a registry entry being dropped, emptied, or wired to the wrong profile's table: every
  // name the registry attributes to a profile must also be recognized by that profile's own
  // long-standing public arity accessor, and every arity-bearing profile must be non-empty.
  const accessors = [
    ["core-language", OL.corePrimitiveArity],
    ["turtle-rendering", OL.turtlePrimitiveArity],
    ["geometry", OL.geometryPrimitiveArity],
    ["sprites", OL.spritesPrimitiveArity],
    ["data", OL.dataPrimitiveArity],
    ["interaction-events", OL.interactionPrimitiveArity],
    ["sound", OL.soundPrimitiveArity],
    ["educational", OL.educationalPrimitiveArity],
    ["tutor-ai", OL.tutorPrimitiveArity],
  ];
  for (const [profile, arityOf] of accessors) {
    const names = OL.profilePrimitiveNames(profile);
    assert.ok(names.length > 0, `${profile} registers no primitive`);
    for (const name of names) {
      const range = OL.activeProfilePrimitiveArityRange(name, [profile]);
      assert.equal(
        arityOf(name),
        range.min,
        `${profile}'s registry entry disagrees with ${profile}'s own arity table for ${name}`,
      );
      // Both reviewers flagged the comment that used to sit here as overpromising, and they were
      // right: this does NOT catch a `maxArity` table wired to the wrong profile. A ceiling entry
      // only fires when the name is also in the SAME entry's `arity` map, so a misrouted ceiling
      // table is silently orphaned and both lookups return the same (wrongly flattened) range.
      // What it does catch is a name whose range differs between its own profile and the whole DAG
      // — i.e. a disjointness violation that shifts a name's range. That is belt-and-braces with
      // the disjointness test below, which reports it more directly. The real ceiling guards are
      // the open-variadic exact set and the bounded-alternate clean-at-ceiling probe in the sweep.
      assert.deepEqual(
        OL.activeProfilePrimitiveArityRange(name, OL.OL_CHECK_PROFILES),
        range,
        `${name} resolves to a different range under the whole DAG than under ${profile} alone`,
      );
    }
  }
  // The three profiles that register none — a claim the registry makes, not an omission: Heritage
  // aliases resolve to their canonical's arity, and Modules/Localization define grammar forms
  // (`import`/`export`/`alias`), not bare-call primitives.
  for (const profile of ["heritage", "modules", "localization"]) {
    assert.deepEqual(OL.profilePrimitiveNames(profile), []);
  }
});

test("no two profiles register the same primitive name, so registry lookup order cannot matter", () => {
  const owner = new Map();
  for (const profile of OL.OL_CHECK_PROFILES) {
    for (const name of OL.profilePrimitiveNames(profile)) {
      assert.equal(
        owner.get(name),
        undefined,
        `${name} is registered by both ${owner.get(name)} and ${profile}`,
      );
      owner.set(name, profile);
    }
  }
  assert.ok(owner.size >= 80);
});

// --- the issue's own reproduction, spelled out --------------------------------

test("#874's reported symptom: (home 10) and (clear_screen 10) are no longer silent", () => {
  for (const source of ["(home 10)", "(clear_screen 10)"]) {
    const [finding, ...rest] = checkCodes(source, [
      "core-language",
      "turtle-rendering",
    ]);
    assert.deepEqual(rest, [], source);
    assert.equal(finding.code, "ol-too-many-inputs", source);
    assert.equal(finding.stage, "semantic");
    assert.equal(finding.params.expected, 0);
    assert.equal(finding.params.actual, 1);
    // points at the callee, not the whole parenthesized call
    assert.deepEqual(finding.source_span.start, [1, 2]);
  }
});

test("a bare turtle command short of its input raises ol-not-enough-inputs at check time", () => {
  // The bare form is the only one that can be *short*: the reader caps a bare call at the default
  // arity, so a missing argument leaves a zero-argument Call rather than a parse error.
  const [finding, ...rest] = checkCodes("forward", [
    "core-language",
    "turtle-rendering",
  ]);
  assert.deepEqual(rest, []);
  assert.equal(finding.code, "ol-not-enough-inputs");
  assert.deepEqual(finding.params, {
    callable: "forward",
    expected: 1,
    actual: 0,
  });
});

test("an exactly-right call stays clean in either form, for every profile the fix wired", () => {
  const clean = [
    ["home", ["core-language", "turtle-rendering"]],
    ["(clear_screen)", ["core-language", "turtle-rendering"]],
    ["set_xy 1 2", ["core-language", "turtle-rendering"]],
    ["(set_xy 1 2)", ["core-language", "turtle-rendering"]],
    ["explain", ["core-language", "educational"]],
    ["(hint)", ["core-language", "educational"]],
    ["who", ["core-language", "sprites"]],
    ["(new_turtle)", ["core-language", "sprites"]],
  ];
  for (const [source, profiles] of clean) {
    assert.deepEqual(
      checkCodes(source, profiles),
      [],
      `expected a clean check for ${JSON.stringify(source)}`,
    );
  }
});

// --- the contracts the derivation must not break ------------------------------

test("a Heritage alias is arity-checked as the canonical command it spells", () => {
  // `fd` resolves to `forward`, whose arity lives in the Turtle & Rendering table — so the check
  // needs BOTH profiles, and the finding's identity is the canonical name, never the alias
  // (`spec/conformance.md:146`, `spec/error-model.md:254-259`).
  const [finding, ...rest] = checkCodes("(fd 1 2)", [
    "core-language",
    "turtle-rendering",
    "heritage",
  ]);
  assert.deepEqual(rest, []);
  assert.equal(finding.code, "ol-too-many-inputs");
  assert.deepEqual(finding.params, {
    callable: "forward",
    expected: 1,
    actual: 2,
  });
  // Without Turtle & Rendering the canonical is not visible, so nothing statically knows `fd`'s
  // arity and the runtime check owns it — no false positive from the alias alone.
  assert.deepEqual(checkCodes("(fd 1 2)", ["core-language", "heritage"]), []);
});

test("params.callable is the canonical lowercase name for every profile, not the surface spelling", () => {
  // `spec/error-model.md:254-259` — diagnostic identity is `code` plus `params`, and the same
  // condition must carry the same params; `:199` prefers the canonical lowercase spelling for
  // display. OpenLogo identifiers are case-insensitive, so `(REVERSE 1 2)` and `(reverse 1 2)` are
  // one condition. Pinned as a unit assertion because the conformance harness excludes `message`
  // from comparison, so no fixture can fail on the prose half of this.
  const cases = [
    ["(FIRST 1 2)", ["core-language"], "first"],
    ["(REVERSE 1 2)", ["core-language", "data"], "reverse"],
    ["(GRID 5)", ["core-language", "geometry"], "grid"],
    ["(BEEP 1)", ["core-language", "sound"], "beep"],
    ["(HOME 1)", ["core-language", "turtle-rendering"], "home"],
    ["(WHY 1)", ["core-language", "educational"], "why"],
    ["(WHO 1)", ["core-language", "sprites"], "who"],
  ];
  for (const [source, profiles, canonical] of cases) {
    const [finding, ...rest] = checkCodes(source, profiles);
    assert.deepEqual(rest, [], source);
    assert.equal(finding.params.callable, canonical, source);
    assert.match(finding.message, new RegExp(`^${canonical} takes `), source);
  }
});

test("a user procedure keeps its own arity and its canonical name, whatever the profile", () => {
  const [finding, ...rest] = checkCodes("define home :a\nend\n(home)", [
    "core-language",
    "turtle-rendering",
  ]);
  // The procedure table is consulted before any profile registry, so the learner's own `define`
  // wins the arity check; the name collision itself is `ol-reserved-word`'s finding.
  const codes = [finding, ...rest].map((diagnostic) => diagnostic.code).sort();
  assert.deepEqual(codes, ["ol-not-enough-inputs", "ol-reserved-word"]);
  const arity = [finding, ...rest].find(
    (diagnostic) => diagnostic.code === "ol-not-enough-inputs",
  );
  assert.deepEqual(arity.params, { callable: "home", expected: 1, actual: 0 });
});

test("a user procedure's and a struct constructor's params.callable is the DECLARED spelling, not the call site's", () => {
  // The declaration-side counterpart of the primitive table above, and a different rule from it.
  //
  // `params` is compared by the conformance harness (unlike `message`), so this is diagnostic
  // IDENTITY. Identifiers are case-insensitive, so `Sq`, `SQ`, and `sq` name one procedure — one
  // condition, which `spec/error-model.md:254-259` requires to carry one set of params. The call
  // site's spelling therefore cannot be the identity. What supplies it is the name's *definition*:
  // for a built-in that is the canonical lowercase name (asserted above); for a learner's own
  // `define`/`struct` it is whatever they wrote. `define MyProc` reports `MyProc` however it is
  // called — lowercasing would show a learner a name they never wrote, and echoing the call site
  // would give one condition three identities (which is what the pre-#874 code did).
  //
  // Every case below spells the CALL SITE differently from the DECLARATION, so an implementation
  // that echoed the call site fails all of them, and one that lowercased fails all of them too.
  const procedureCases = [
    ["define Sq :a\nend\nSQ", "Sq", 1, 0],
    ["define Sq :a\nend\n(sQ 1 2)", "Sq", 1, 2],
    ["define Sq :a\nend\n(sq)", "Sq", 1, 0],
    ["define lowerCased :a\nend\n(LOWERCASED 1 2)", "lowerCased", 1, 2],
  ];
  for (const [source, declared, expected, actual] of procedureCases) {
    const findings = checkCodes(source, ["core-language", "turtle-rendering"]);
    assert.equal(findings.length, 1, source);
    assert.equal(findings[0].params.callable, declared, source);
    assert.equal(findings[0].params.expected, expected, source);
    assert.equal(findings[0].params.actual, actual, source);
    assert.ok(
      findings[0].message.startsWith(`${declared} `),
      `${source}: message should open with the declared spelling, got ${JSON.stringify(findings[0].message)}`,
    );
  }

  // A struct constructor is exact-arity in either call form, and takes the identical treatment —
  // the second callable reached through `checkExactArity`.
  const structCases = [
    ["struct Point [ x y ]\n(POINT 1)", "Point", 2, 1],
    ["struct Point [ x y ]\n(pOiNt 1 2 3)", "Point", 2, 3],
  ];
  for (const [source, declared, expected, actual] of structCases) {
    const findings = checkCodes(source, ["core-language", "data"]);
    assert.equal(findings.length, 1, source);
    assert.equal(findings[0].params.callable, declared, source);
    assert.equal(findings[0].params.expected, expected, source);
    assert.equal(findings[0].params.actual, actual, source);
    // Symmetry with the procedure loop above: the struct constructor is the second callable
    // reached through `checkExactArity`, and its prose must carry the declared spelling too.
    assert.ok(
      findings[0].message.startsWith(`${declared} `),
      `${source}: message should open with the declared spelling, got ${JSON.stringify(findings[0].message)}`,
    );
  }

  // And the property that motivates all of it: one defect, one identity, however it is spelled.
  const [lower] = checkCodes("define Sq :a\nend\n(sq 1 2)", ["core-language"]);
  const [upper] = checkCodes("define Sq :a\nend\n(SQ 1 2)", ["core-language"]);
  assert.deepEqual(lower.params, upper.params);
  assert.equal(lower.params.callable, "Sq");
});

test("an unrecognized profile identifier registers nothing and breaks nothing", () => {
  // The lookup walks the registry and intersects with the caller's set, so a profile string that
  // names no entry simply contributes no primitive rather than throwing.
  assert.deepEqual(OL.profilePrimitiveNames("not-a-profile"), []);
  assert.equal(
    OL.activeProfilePrimitiveArityRange("forward", ["not-a-profile"]),
    undefined,
  );
  assert.deepEqual(
    checkCodes("(home 10)", ["core-language", "turtle-rendering", "nonsense"])
      .map((diagnostic) => diagnostic.code)
      .sort(),
    ["ol-too-many-inputs"],
  );
});

test("activeProfilePrimitiveArityRange reports the ceiling of a variadic and matches case-insensitively", () => {
  assert.deepEqual(
    OL.activeProfilePrimitiveArityRange("PRINT", ["core-language"]),
    { min: 1, max: Number.POSITIVE_INFINITY },
  );
  assert.deepEqual(
    OL.activeProfilePrimitiveArityRange("random", ["core-language"]),
    {
      min: 1,
      max: 2,
    },
  );
  assert.deepEqual(
    OL.activeProfilePrimitiveArityRange("Forward", ["turtle-rendering"]),
    { min: 1, max: 1 },
  );
  assert.equal(
    OL.activeProfilePrimitiveArityRange("nosuchthing", ["core-language"]),
    undefined,
  );
  assert.equal(OL.activeProfilePrimitiveArityRange("forward", []), undefined);
});
