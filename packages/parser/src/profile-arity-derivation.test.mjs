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
  // exception as an exact set rather than a skip makes this sweep the tripwire for the ONE way the
  // derivation can still degrade: `collectVisibleNames` is not yet derived from the same registry
  // (it hand-writes a branch per profile), so a future profile registered in `PROFILE_PRIMITIVES`
  // — which TypeScript forces — but not made visible there would silently fall back to
  // `ol-unknown-command` instead of being arity-checked. That failure is graceful, not wrong, but
  // it is not silent: its name lands in `notYetVisible` and this assertion fails naming it.
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
  // Account for every registered name exactly, rather than asserting a magic minimum: each is
  // either arity-checked, an open variadic that cannot be over-supplied, or a not-yet-visible
  // exception. A registry entry emptied or dropped shrinks `registered` without breaking the
  // identity, so the floor below — deliberately just under today's exact count of 85 — is what
  // stops the sweep going vacuous. Both must hold.
  assert.equal(
    checked + openVariadics.length + notYetVisible.length,
    registered,
  );
  assert.ok(
    registered >= 85,
    `the DAG registers 85 primitives today; this sweep saw only ${registered}, so a registry entry was emptied or dropped`,
  );
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
      // The ceiling half. A `maxArity` table wired to the wrong profile shows up here as a name
      // whose ceiling is not reachable from its own profile alone, or as a whole-DAG lookup that
      // resolves differently from the single-profile one — neither of which the `.min` comparison
      // above can see, since only `core-language` and `data` register a ceiling table at all.
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
  // (`spec/conformance.md:146`, `spec/error-model.md:253-256`).
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
  // `spec/error-model.md:253-256` — diagnostic identity is `code` plus `params`, and the same
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

test("a user procedure's and a struct constructor's params.callable is canonical too, not the call site's spelling", () => {
  // The declaration-side counterpart of the primitive table above, and the reason it needs its own
  // test: a procedure named in all-lowercase makes `raw === lower`, so an assertion written that
  // way cannot tell canonical from surface and would pass either way. These cases are deliberately
  // MIXED CASE, and the call sites deliberately spell the name differently from the declaration.
  //
  // `params` is compared by the conformance harness (unlike `message`), so this is diagnostic
  // IDENTITY, not prose. OpenLogo identifiers are case-insensitive, so `Sq`, `SQ`, and `sq` name
  // one procedure — hence one condition, which `spec/error-model.md:253-256` requires to carry one
  // set of params, in the canonical lowercase spelling `:199` prefers for display. Reporting the
  // call site's spelling would make the same defect produce two different structured identities.
  const procedureCases = [
    ["define Sq :a\nend\nSQ", "sq", 1, 0],
    ["define Sq :a\nend\n(sQ 1 2)", "sq", 1, 2],
    ["define Sq :a\nend\n(Sq)", "sq", 1, 0],
  ];
  for (const [source, canonical, expected, actual] of procedureCases) {
    const findings = checkCodes(source, ["core-language", "turtle-rendering"]);
    assert.equal(findings.length, 1, source);
    assert.equal(findings[0].params.callable, canonical, source);
    assert.equal(findings[0].params.expected, expected, source);
    assert.equal(findings[0].params.actual, actual, source);
    assert.match(findings[0].message, new RegExp(`^${canonical} `), source);
  }

  // A struct constructor is exact-arity in either call form, and takes the identical canonical
  // treatment — the second callable reached through `checkExactArity`.
  const structCases = [
    ["struct Point [ x y ]\n(POINT 1)", "point", 2, 1],
    ["struct Point [ x y ]\n(pOiNt 1 2 3)", "point", 2, 3],
  ];
  for (const [source, canonical, expected, actual] of structCases) {
    const findings = checkCodes(source, ["core-language", "data"]);
    assert.equal(findings.length, 1, source);
    assert.equal(findings[0].params.callable, canonical, source);
    assert.equal(findings[0].params.expected, expected, source);
    assert.equal(findings[0].params.actual, actual, source);
  }

  // And the property that motivates all of it: one defect, one identity, whatever the spelling.
  const [lower] = checkCodes("define Sq :a\nend\n(sq 1 2)", ["core-language"]);
  const [upper] = checkCodes("define Sq :a\nend\n(SQ 1 2)", ["core-language"]);
  assert.deepEqual(lower.params, upper.params);
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
