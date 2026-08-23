// Unit + regression tests for the built-in-names DoD gate (issue #841, ADR-0021). These import
// scripts/built-in-names-gate.mjs's logic directly (for 100% coverage) plus a subprocess test for
// the CLI shell (scripts/check-built-in-names.mjs).
//
// The gate is driven through injected `api` and `io` ports rather than the real filesystem, so
// every failure branch can be exercised without writing to disk — and so a test can present an
// implementation that DISAGREES with the manifest, which is the only way to prove the comparison
// is real.
//
// The INJECTED DRIFT block is the gate's own proof that it can go red — the same discipline as
// tests/conformance/_harness-selftest/, whose fixtures deliberately declare expect: "mismatch". A
// gate that passes because it checks nothing is worse than no gate: it also removes the human who
// was checking. So every way this one is supposed to fail has a test that asserts it actually
// fails — a name dropped from a registry, a name added to one, a lost SECOND registration, a
// mis-filed category or profile, an alias edge pointing at the wrong canonical, a deleted
// stdlib/*.logo, a profile that ships a primitive nobody registered, an accessor that was declared
// not-yet-built and then quietly appeared, and drift in each of the three prose lists.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import * as realParserApi from "@openlogo/parser";
import {
  ACCESSOR_KINDS,
  ACCESSOR_STATUSES,
  CATEGORIES,
  CONFORMANCE_PATH,
  GRAMMAR_PATH,
  MANIFEST_PATH,
  REAL_IO,
  TOOLING_PATH,
  accessorFindings,
  aliasFindings,
  backtickedWords,
  carveOutFindings,
  deriveSummary,
  entryFindings,
  extractConformanceProfiles,
  extractGrammarKeywordBlock,
  extractToolingC19Mirror,
  extractToolingKeywordRow,
  implementationFindings,
  isStdlibSource,
  loadManifest,
  currentRowFingerprint,
  narrativeFindings,
  numberWord,
  parseArgs,
  profileCoverageFindings,
  rowFingerprint,
  rowFingerprintFindings,
  profileInventoryFindings,
  profilePrimitiveSweepFindings,
  proseFindings,
  registryHas,
  registryMembers,
  resolveAccessor,
  runBuiltInNamesGate,
  versionFindings,
} from "./built-in-names-gate.mjs";

const REAL_MANIFEST = loadManifest();

/** A deep, independent copy of the shipped manifest, so a test can mutate it freely. */
function manifestCopy() {
  return structuredClone(REAL_MANIFEST);
}

/** The entry for `name` inside `manifest`. */
function entryFor(manifest, name) {
  return manifest.names.find((candidate) => candidate.name === name);
}

/**
 * A minimal manifest + matching fake implementation, small enough to reason about. Two registries:
 * `reserved` (an array, keyword) and `core-primitive` (an arity lookup + an enumerator).
 */
function tinyFixture() {
  const manifest = {
    specVersion: "9.9.9",
    about: "a tiny fixture",
    invariants: {
      unconditional: "x",
      precedence: "x",
      bothDirections: "x",
      accessorStatus: "x",
      derivedEnumeration: "x",
    },
    registries: {
      reserved: {
        category: "keyword",
        profile: "core-language",
        lookup: { accessor: "WORDS", kind: "array", status: "present" },
        enumerate: { accessor: "WORDS", kind: "array", status: "present" },
      },
      "core-primitive": {
        category: "primitive",
        profile: "core-language",
        lookup: { accessor: "coreArity", kind: "arity", status: "present" },
        enumerate: {
          accessor: "coreNames",
          kind: "enumerator",
          status: "present",
        },
      },
    },
    profilesWithoutPrimitives: {},
    profiles: { ids: { "core-language": "Core Language" } },
    tokenClassKeyword: {
      about: "a tiny fixture",
      omitsReason: "x",
      addsExcludedReason: "x",
      addsProfileKeywordsReason: "x",
      addsProfileKeywordsCoverageReason: "x",
      rowSplitAnchorReason: "x",
      rowFingerprintReason: "x",
      omitsKeywords: [],
      addsExcluded: [],
      addsProfileKeywords: false,
      addsProfileKeywordsNamedIndividually: [],
      addsProfileKeywordsCoveredByClause: [],
      rowSplitAnchor: "The word-spelled operators",
      rowExclusionEndAnchor: "are **not** in this class",
      deltaSentence: "omits {omits}, adds {adds}",
      independenceClause: "independent",
      paintIndependenceClause: "never paints",
      rowTableHeader: "| H |",
      rowFingerprint:
        "a889cdb4032e110d26522de4e3b980dbd26c82dde364fb471da1066825f61f2d",
    },
    names: [
      {
        name: "define",
        category: "keyword",
        profile: "core-language",
        registries: ["reserved"],
      },
      {
        name: "print",
        category: "primitive",
        profile: "core-language",
        registries: ["core-primitive"],
      },
    ],
    excluded: [],
  };
  const api = {
    OPENLOGO_VERSION: "9.9.9",
    OL_CHECK_PROFILES: ["core-language"],
    WORDS: ["define"],
    coreArity: (name) => (name === "print" ? 1 : undefined),
    coreNames: () => ["print"],
    profilePrimitiveNames: () => ["print"],
  };
  return { manifest, api };
}

/** An `io` port backed by an in-memory `{ path: text }` map plus an explicit existence set. */
function fakeIo(files, existing = Object.keys(files)) {
  return {
    readText: (path) => files[path],
    exists: (path) => existing.includes(path),
    isStdlibFile: (path) => existing.includes(path),
  };
}

// ---------------------------------------------------------------------------------------------
// The shipped tree: the gate must be green, and green for the right reasons.
// ---------------------------------------------------------------------------------------------

test("the shipped manifest and the shipped implementation agree, in both directions", () => {
  const result = runBuiltInNamesGate();
  assert.deepEqual(result.findings, []);
  assert.equal(result.ok, true);
});

test("the report names the totals it checked, so a green run is evidence rather than a bare OK", () => {
  const result = runBuiltInNamesGate();
  const summary = result.lines.find((line) => line.includes("0 finding(s)"));
  assert.equal(
    summary,
    `built-in-names: ${REAL_MANIFEST.names.length} names, ${REAL_MANIFEST.excluded.length} carve-outs, ${Object.keys(REAL_MANIFEST.registries).length} registries, spec version ${REAL_MANIFEST.specVersion} — 0 finding(s)`,
  );
});

test("every registry is enumerable, so the run reports no unreachable direction", () => {
  const result = runBuiltInNamesGate();
  assert.equal(
    result.lines.some((line) => line.includes("NOTE")),
    false,
    result.lines.join("\n"),
  );
});

test("the manifest ships with the spec version it claims", () => {
  assert.equal(REAL_MANIFEST.specVersion, realParserApi.OPENLOGO_VERSION);
});

test("the six dual-registered names are each filed once, with both memberships recorded", () => {
  const dual = REAL_MANIFEST.names.filter(
    (entry) => entry.registries.length > 1,
  );
  assert.deepEqual(
    dual.map((entry) => `${entry.name}:${entry.registries.join("+")}`).sort(),
    [
      "make:reserved+heritage-form-head",
      "op:reserved+heritage-form-head",
      "output:reserved+heritage-form-head",
      "thing:reserved+core-primitive",
      "to:reserved+heritage-form-head",
      "value:reserved+heritage-worded-form-head",
    ].sort(),
  );
  for (const entry of dual) {
    assert.equal(entry.category, "keyword", `${entry.name} category`);
  }
  assert.equal(entryFor(REAL_MANIFEST, "to").profile, "core-language");
});

test("every Heritage short alias is a primitive of the heritage profile, in no arity table", () => {
  for (const alias of realParserApi.heritageAliasNames()) {
    const entry = entryFor(REAL_MANIFEST, alias);
    assert.deepEqual(entry.registries, ["heritage-alias"], alias);
    assert.equal(entry.category, "primitive", alias);
    assert.equal(entry.profile, "heritage", alias);
    assert.equal(
      entry.aliasOf,
      realParserApi.canonicalOfHeritageAlias(alias),
      alias,
    );
  }
});

test("the five Turtle & Rendering one-word spellings record their canonical target", () => {
  const spellings = REAL_MANIFEST.names.filter(
    (entry) =>
      entry.aliasOf !== undefined &&
      entry.registries.includes("turtle-primitive"),
  );
  assert.deepEqual(
    spellings.map((entry) => `${entry.name}->${entry.aliasOf}`).sort(),
    [
      "setbg->set_background",
      "setcolor->set_color",
      "seth->set_heading",
      "setwidth->set_width",
      "setxy->set_xy",
    ],
  );
});

test("the Geometry standard library is excluded with a path into stdlib, never listed as built in", () => {
  const library = REAL_MANIFEST.excluded.filter(
    (entry) => entry.reason === "library",
  );
  assert.deepEqual(library.map((entry) => entry.name).sort(), [
    "arc",
    "area",
    "circle",
    "perimeter",
    "polygon",
    "star",
  ]);
  for (const entry of library) {
    assert.equal(REAL_IO.exists(entry.source), true, entry.source);
    assert.equal(entryFor(REAL_MANIFEST, entry.name), undefined, entry.name);
  }
  for (const overlay of ["grid", "axes", "measure"]) {
    assert.equal(entryFor(REAL_MANIFEST, overlay).profile, "geometry");
  }
});

test("the four contextual keywords are excluded with the positions that make them structural", () => {
  const contextual = REAL_MANIFEST.excluded.filter(
    (entry) => entry.reason === "contextual-keyword",
  );
  assert.deepEqual(contextual.map((entry) => entry.name).sort(), [
    "a",
    "empty",
    "member",
    "of",
  ]);
  assert.deepEqual(entryFor(REAL_MANIFEST, "of"), undefined);
  assert.deepEqual(contextual.find((entry) => entry.name === "of").positions, [
    "is-predicate",
    "value-of-reader",
  ]);
  // `member?` is a Core reporter and IS a built-in name; the contextual `member` is not. The two
  // spellings are different names and the file must not conflate them.
  assert.equal(entryFor(REAL_MANIFEST, "member?").category, "primitive");
});

test("Tutor (AI) has its own registry and challenge is in it, not in Educational's table", () => {
  assert.equal(realParserApi.tutorPrimitiveArity("challenge"), 0);
  assert.equal(realParserApi.educationalPrimitiveArity("challenge"), undefined);
  const entry = entryFor(REAL_MANIFEST, "challenge");
  assert.deepEqual(entry.registries, ["tutor-primitive"]);
  assert.equal(entry.profile, "tutor-ai");
});

test("the nine primitive registries enumerate through one derived accessor, not nine hand-written ones", () => {
  let total = 0;
  const withTables = [];
  for (const profile of realParserApi.OL_CHECK_PROFILES) {
    const names = realParserApi.profilePrimitiveNames(profile);
    total += names.length;
    if (names.length > 0) {
      withTables.push(profile);
    }
  }
  assert.equal(total, 85);
  assert.deepEqual(withTables.sort(), [
    "core-language",
    "data",
    "educational",
    "geometry",
    "interaction-events",
    "sound",
    "sprites",
    "turtle-rendering",
    "tutor-ai",
  ]);
  // Heritage registers no bare-call primitive of its own: its 13 contributions are alias SPELLINGS
  // of primitives owned elsewhere, carried by `heritage-alias`. `[]` here rather than the 13 is what
  // keeps the two registries from absorbing each other.
  assert.deepEqual(realParserApi.profilePrimitiveNames("heritage"), []);
  // 85 registry names, minus `thing` (in corePrimitiveArity but filed `keyword` under the
  // precedence rule), plus the 13 Heritage aliases that are in no arity table at all.
  assert.equal(
    REAL_MANIFEST.names.filter((entry) => entry.category === "primitive")
      .length,
    85 - 1 + 13,
  );
  // Every tag reaches both directions now: ADR-0021's ten `declared` accessors are all `present`.
  assert.deepEqual(
    Object.entries(REAL_MANIFEST.registries).map(
      ([tag, registry]) =>
        `${tag}:${registry.lookup.status}/${registry.enumerate.status}`,
    ),
    Object.keys(REAL_MANIFEST.registries).map(
      (tag) => `${tag}:present/present`,
    ),
  );
});

// ---------------------------------------------------------------------------------------------
// INJECTED DRIFT — the gate's proof that it can go red.
// ---------------------------------------------------------------------------------------------

test("INJECTED DRIFT: a name dropped from the manifest is caught from the implementation side", () => {
  const manifest = manifestCopy();
  manifest.names = manifest.names.filter((entry) => entry.name !== "forward");
  const result = runBuiltInNamesGate({ manifest });
  assert.equal(result.ok, false);
  assert.equal(
    result.findings.includes(
      `forward: the implementation registers it in turtle-primitive (profile turtle-rendering) but it is absent from ${MANIFEST_PATH}`,
    ),
    true,
    result.findings.join("\n"),
  );
});

test("INJECTED DRIFT: a name in the manifest that no registry holds is caught from the file side", () => {
  const manifest = manifestCopy();
  manifest.names.push({
    name: "teleport",
    category: "primitive",
    profile: "turtle-rendering",
    registries: ["turtle-primitive"],
  });
  const result = runBuiltInNamesGate({ manifest });
  assert.equal(result.ok, false);
  assert.equal(
    result.findings.includes(
      "teleport: claims registry turtle-primitive but the implementation's lookup says no",
    ),
    true,
    result.findings.join("\n"),
  );
});

test("INJECTED DRIFT: a LOST SECOND registration is caught — the failure a flat name set would miss", () => {
  // `thing` is in OL_KEYWORDS *and* corePrimitiveArity. Drop the primitive half and a
  // precedence-based check would still see a matching keyword entry and report green.
  const manifest = manifestCopy();
  entryFor(manifest, "thing").registries = ["reserved"];
  const result = runBuiltInNamesGate({ manifest });
  assert.equal(result.ok, false);
  assert.equal(
    result.findings.some((finding) =>
      finding.startsWith(
        "thing: the implementation also holds it in core-primitive",
      ),
    ),
    true,
    result.findings.join("\n"),
  );
});

test("INJECTED DRIFT: a registration the implementation no longer has is caught", () => {
  const manifest = manifestCopy();
  entryFor(manifest, "print").registries = ["core-primitive", "data-primitive"];
  const result = runBuiltInNamesGate({ manifest });
  assert.equal(result.ok, false);
  assert.equal(
    result.findings.includes(
      "print: claims registry data-primitive but the implementation's lookup says no",
    ),
    true,
    result.findings.join("\n"),
  );
});

test("INJECTED DRIFT: mod filed as a primitive rather than a keyword is caught", () => {
  const manifest = manifestCopy();
  entryFor(manifest, "mod").category = "primitive";
  const result = runBuiltInNamesGate({ manifest });
  assert.equal(result.ok, false);
  assert.equal(
    result.findings.includes(
      'mod: category "primitive" but its registries derive "keyword"',
    ),
    true,
    result.findings.join("\n"),
  );
});

test("INJECTED DRIFT: forward filed under the wrong profile is caught", () => {
  const manifest = manifestCopy();
  entryFor(manifest, "forward").profile = "core-language";
  const result = runBuiltInNamesGate({ manifest });
  assert.equal(result.ok, false);
  assert.equal(
    result.findings.includes(
      'forward: profile "core-language" but its precedence-winning registry owns "turtle-rendering"',
    ),
    true,
    result.findings.join("\n"),
  );
});

test("INJECTED DRIFT: an alias edge pointing at the wrong canonical is caught", () => {
  const manifest = manifestCopy();
  entryFor(manifest, "fd").aliasOf = "back";
  const result = runBuiltInNamesGate({ manifest });
  assert.equal(result.ok, false);
  assert.equal(
    result.findings.includes(
      'fd: aliasOf "back" but canonicalOfHeritageAlias resolves "forward"',
    ),
    true,
    result.findings.join("\n"),
  );
});

test("INJECTED DRIFT: a turtle alias pointing at the wrong canonical is caught", () => {
  // Before the canonical map existed this was GREEN: `setxy` and `distance` are both
  // `turtle-primitive` with arity 2, and "a real entry of equal arity" was the strongest check
  // available. `rubber-duck` broke it with exactly this mutation.
  const manifest = manifestCopy();
  entryFor(manifest, "setxy").aliasOf = "distance";
  const result = runBuiltInNamesGate({ manifest });
  assert.equal(result.ok, false);
  assert.equal(
    result.findings.includes(
      'setxy: aliasOf "distance" but canonicalOfTurtleAlias resolves "set_xy"',
    ),
    true,
    result.findings.join("\n"),
  );
});

test("INJECTED DRIFT: an aliasOf on a registry that carries no alias edges is caught", () => {
  const manifest = manifestCopy();
  entryFor(manifest, "define").aliasOf = "end";
  const result = runBuiltInNamesGate({ manifest });
  assert.equal(result.ok, false);
  assert.equal(
    result.findings.includes(
      'define: records aliasOf "end" but none of its registries (reserved) carries alias edges',
    ),
    true,
    result.findings.join("\n"),
  );
});

test("INJECTED DRIFT: deleting every alias edge is caught — the direction aliasOf's optionality hides", () => {
  const manifest = manifestCopy();
  let deleted = 0;
  for (const entry of manifest.names) {
    if (entry.aliasOf !== undefined) {
      delete entry.aliasOf;
      deleted += 1;
    }
  }
  assert.equal(deleted, 18, "13 Heritage + 5 Turtle & Rendering");
  const result = runBuiltInNamesGate({ manifest });
  assert.equal(result.ok, false);
  const dropped = result.findings.filter((finding) =>
    finding.includes("its entry records no aliasOf"),
  );
  assert.equal(dropped.length, 18, result.findings.join("\n"));
  assert.equal(
    dropped.includes(
      'fd: canonicalOfHeritageAlias resolves it to "forward" but its entry records no aliasOf — a dropped edge is drift, not an absent one',
    ),
    true,
  );
  assert.equal(
    dropped.includes(
      'setxy: canonicalOfTurtleAlias resolves it to "set_xy" but its entry records no aliasOf — a dropped edge is drift, not an absent one',
    ),
    true,
  );
});

test("the Turtle & Rendering alias map is consumed by the resolver, not kept beside it", () => {
  // "Consumed" is what makes the edge unable to drift: `turtlePrimitiveArity` resolves an alias
  // THROUGH the map to its canonical's arity, so the two spellings share one number rather than
  // holding two that could diverge. ADR-0021 §3 requires exactly this of #841.
  assert.deepEqual(realParserApi.turtleAliasNames(), [
    "setbg",
    "setcolor",
    "seth",
    "setwidth",
    "setxy",
  ]);
  for (const alias of realParserApi.turtleAliasNames()) {
    const canonical = realParserApi.canonicalOfTurtleAlias(alias);
    assert.equal(
      realParserApi.turtlePrimitiveArity(alias),
      realParserApi.turtlePrimitiveArity(canonical),
      `${alias} -> ${canonical}`,
    );
  }
  assert.equal(realParserApi.canonicalOfTurtleAlias("SETXY"), "set_xy");
  assert.equal(realParserApi.canonicalOfTurtleAlias("forward"), undefined);
  assert.equal(realParserApi.canonicalOfTurtleAlias("fd"), undefined);
  // Both spellings still enumerate: `spec/grammar.md:414` makes every alias spelling a built-in
  // name, so a consumer asking what the profile registers must be told about `setxy` too.
  const names = realParserApi.profilePrimitiveNames("turtle-rendering");
  assert.equal(names.includes("setxy"), true);
  assert.equal(names.includes("set_xy"), true);
  assert.equal(names.length, 30);
});

test("INJECTED DRIFT: deleting a stdlib/*.logo file breaks the Geometry carve-out", () => {
  const manifest = manifestCopy();
  const io = {
    ...REAL_IO,
    isStdlibFile: (path) =>
      path === "stdlib/geometry/polygon.logo"
        ? false
        : REAL_IO.isStdlibFile(path),
  };
  const result = runBuiltInNamesGate({ manifest, io });
  assert.equal(result.ok, false);
  assert.equal(
    result.findings.includes(
      'excluded polygon: reason "library" names "stdlib/geometry/polygon.logo", which is not a real stdlib/*.logo file — the carve-out is that the name is OpenLogo SOURCE (ADR-0012), so any other path would prove nothing',
    ),
    true,
    result.findings.join("\n"),
  );
});

test("INJECTED DRIFT: promoting polygon to a built-in name breaks the carve-out", () => {
  const manifest = manifestCopy();
  manifest.names.push({
    name: "polygon",
    category: "primitive",
    profile: "geometry",
    registries: ["geometry-primitive"],
  });
  const result = runBuiltInNamesGate({ manifest });
  assert.equal(result.ok, false);
  assert.equal(
    result.findings.includes(
      "excluded polygon: also appears in names — a name is either a built-in name or a deliberate omission, never both",
    ),
    true,
    result.findings.join("\n"),
  );
});

test("INJECTED DRIFT: a profile that ships a primitive nobody registered is caught", () => {
  // The state Tutor (AI) was in before #838: `challenge` normative in spec/conformance.md and in
  // no registry at all. A gate that only diffed the tables that happen to exist would see an empty
  // set matching an empty set and report green.
  const manifest = manifestCopy();
  manifest.names = manifest.names.filter((entry) => entry.name !== "challenge");
  const api = {
    ...realParserApi,
    tutorPrimitiveArity: () => undefined,
    profilePrimitiveNames: (profile) =>
      profile === "tutor-ai"
        ? []
        : realParserApi.profilePrimitiveNames(profile),
  };
  const result = runBuiltInNamesGate({ manifest, api });
  assert.equal(result.ok, false);
  assert.equal(
    result.findings.includes(
      "profile tutor-ai: ships no primitive entry and is not declared in profilesWithoutPrimitives with a reason",
    ),
    true,
    result.findings.join("\n"),
  );
});

test("INJECTED DRIFT: an accessor the manifest declares not-yet-built that in fact resolves", () => {
  const manifest = manifestCopy();
  manifest.registries["tutor-primitive"].enumerate.status = "declared";
  const result = runBuiltInNamesGate({ manifest });
  assert.equal(result.ok, false);
  assert.equal(
    result.findings.includes(
      `registry tutor-primitive.enumerate: profilePrimitiveNames is declared "declared" (decided, not yet created) but now resolves — flip its status to "present" in ${MANIFEST_PATH}`,
    ),
    true,
    result.findings.join("\n"),
  );
});

test("INJECTED DRIFT: an accessor that stops being exported is caught", () => {
  const manifest = manifestCopy();
  manifest.registries["core-primitive"].enumerate.accessor =
    "gonePrimitiveNames";
  const result = runBuiltInNamesGate({ manifest });
  assert.equal(result.ok, false);
  assert.equal(
    result.findings.includes(
      'registry core-primitive.enumerate: gonePrimitiveNames is declared "present" but is not exported from @openlogo/parser',
    ),
    true,
    result.findings.join("\n"),
  );
});

test("INJECTED DRIFT: a profile primitive absent from the manifest, found by the profile sweep", () => {
  const manifest = manifestCopy();
  manifest.names = manifest.names.filter((entry) => entry.name !== "beep");
  const findings = profilePrimitiveSweepFindings(manifest, realParserApi);
  assert.deepEqual(findings, [
    `beep: the sound primitive registry holds it but it is absent from ${MANIFEST_PATH}`,
  ]);
});

test("INJECTED DRIFT: a primitive filed under a profile whose registry does not hold it", () => {
  const manifest = manifestCopy();
  entryFor(manifest, "beep").profile = "sprites";
  const findings = profilePrimitiveSweepFindings(manifest, realParserApi);
  assert.deepEqual(findings, [
    'beep: filed under profile "sprites" but it is the sound registry that holds it',
  ]);
});

test("the profile sweep reports a missing derived accessor rather than throwing", () => {
  const api = { ...realParserApi, profilePrimitiveNames: undefined };
  assert.deepEqual(profilePrimitiveSweepFindings(REAL_MANIFEST, api), [
    "profilePrimitiveNames is not exported from @openlogo/parser, so the profile-keyed registry cannot be swept at all — every primitive tag's enumerate direction is unreachable",
  ]);
});

test("INJECTED DRIFT: a specVersion that no longer matches openlogo.version is caught", () => {
  const manifest = manifestCopy();
  manifest.specVersion = "0.2.0";
  const result = runBuiltInNamesGate({ manifest });
  assert.equal(result.ok, false);
  assert.equal(
    result.findings.includes(
      'specVersion "0.2.0" does not match openlogo.version "0.1.0" — the list is versioned WITH the specification',
    ),
    true,
    result.findings.join("\n"),
  );
});

// --- prose drift, all three lists -------------------------------------------------------------

/** The real spec text, with `mutate` applied to the named file. */
function proseIo(path, mutate) {
  const grammar = readFileSync(GRAMMAR_PATH, "utf8");
  const tooling = readFileSync(TOOLING_PATH, "utf8");
  const files = {
    [GRAMMAR_PATH]: path === GRAMMAR_PATH ? mutate(grammar) : grammar,
    [TOOLING_PATH]: path === TOOLING_PATH ? mutate(tooling) : tooling,
  };
  return {
    readText: (candidate) => files[candidate],
    exists: REAL_IO.exists,
  };
}

test("INJECTED DRIFT: a keyword missing from spec/grammar.md's normative block is caught", () => {
  const io = proseIo(GRAMMAR_PATH, (text) =>
    text.replace("and or not mod true false", "and or not true false"),
  );
  const findings = proseFindings(REAL_MANIFEST, io);
  assert.equal(
    findings.includes(
      `${GRAMMAR_PATH}: keyword block is missing mod — present in ${MANIFEST_PATH}`,
    ),
    true,
    findings.join("\n"),
  );
});

test("INJECTED DRIFT: a keyword in the block that the manifest does not list is caught", () => {
  const io = proseIo(GRAMMAR_PATH, (text) =>
    text.replace(
      "struct alias import export",
      "struct alias import export xor",
    ),
  );
  const findings = proseFindings(REAL_MANIFEST, io);
  assert.equal(
    findings.includes(
      `${GRAMMAR_PATH}: keyword block lists xor, absent from ${MANIFEST_PATH}`,
    ),
    true,
    findings.join("\n"),
  );
});

test("INJECTED DRIFT: the exact regression that already happened — the C19 mirror losing `mod`", () => {
  // spec/tooling.md's mirror had silently drifted to 43 words before issue #855 restored it. This
  // is that drift, replayed against the gate.
  const io = proseIo(TOOLING_PATH, (text) =>
    text.replace(
      "`and`, `or`, `not`, `mod`, `true`, `false`,",
      "`and`, `or`, `not`, `true`, `false`,",
    ),
  );
  const findings = proseFindings(REAL_MANIFEST, io);
  assert.equal(
    findings.some((finding) =>
      finding.startsWith(
        `${TOOLING_PATH}: the C19 mirror (43 words) is not byte-order-identical`,
      ),
    ),
    true,
    findings.join("\n"),
  );
});

test("INJECTED DRIFT: the SECOND list — a member missing from the `keyword` token-class row", () => {
  const io = proseIo(TOOLING_PATH, (text) =>
    text.replace(
      "`struct`, `alias`, `import`, `export`;",
      "`struct`, `alias`, `import`;",
    ),
  );
  const findings = proseFindings(REAL_MANIFEST, io);
  assert.equal(
    findings.includes(
      `${TOOLING_PATH}: the \`keyword\` token-class row does not name export — the class is an enumeration, so every member has to appear in it`,
    ),
    true,
    findings.join("\n"),
  );
});

test("INJECTED DRIFT: a word-operator the token-class row stops excluding", () => {
  const io = proseIo(TOOLING_PATH, (text) =>
    text.replace(
      "The word-spelled operators `and`, `or`, `not`, and `mod` are **not** in this class",
      "The word-spelled operators `and`, `or`, and `not` are **not** in this class",
    ),
  );
  const findings = proseFindings(REAL_MANIFEST, io);
  assert.equal(
    findings.includes(
      `${TOOLING_PATH}: the row's exclusion clause does not name mod — an omission the row never mentions is indistinguishable from a forgotten member`,
    ),
    true,
    findings.join("\n"),
  );
});

test("INJECTED DRIFT: the token-class row gains a word the class does not contain", () => {
  // The regression lock. A one-directional check — "every expected word appears somewhere in the
  // row" — was GREEN against this, because it could see a missing member but never an extra one.
  const io = proseIo(TOOLING_PATH, (text) =>
    text.replace(
      "`struct`, `alias`, `import`, `export`;",
      "`struct`, `alias`, `import`, `export`, `polygon`;",
    ),
  );
  const findings = proseFindings(REAL_MANIFEST, io);
  assert.equal(
    findings.includes(
      `${TOOLING_PATH}: the \`keyword\` token-class row names polygon, which ${MANIFEST_PATH} does not put in the class — an enumeration is wrong when it says too much, not only when it says too little`,
    ),
    true,
    findings.join("\n"),
  );
});

test("INJECTED DRIFT: a delta the manifest stops declaring is caught by set equality", () => {
  // Each of these three was GREEN under the one-directional check.
  for (const [label, mutate, expected] of [
    [
      "omitsKeywords loses mod",
      (deltas) => {
        deltas.omitsKeywords = deltas.omitsKeywords.filter(
          (word) => word !== "mod",
        );
      },
      `${TOOLING_PATH}: the \`keyword\` token-class row does not name mod — the class is an enumeration, so every member has to appear in it`,
    ],
    [
      "addsExcluded loses a",
      (deltas) => {
        deltas.addsExcluded = deltas.addsExcluded.filter(
          (word) => word !== "a",
        );
      },
      `${TOOLING_PATH}: the \`keyword\` token-class row names a, which ${MANIFEST_PATH} does not put in the class — an enumeration is wrong when it says too much, not only when it says too little`,
    ],
    [
      "addsProfileKeywords turned off",
      (deltas) => {
        deltas.addsProfileKeywords = false;
      },
      `${TOOLING_PATH}: the \`keyword\` token-class row names tell, which ${MANIFEST_PATH} does not put in the class — an enumeration is wrong when it says too much, not only when it says too little`,
    ],
  ]) {
    const manifest = manifestCopy();
    mutate(manifest.tokenClassKeyword);
    const findings = proseFindings(manifest, REAL_IO);
    assert.equal(
      findings.includes(expected),
      true,
      `${label}: ${findings.join("\n")}`,
    );
  }
});

test("INJECTED DRIFT: a library carve-out pointed at a file that is not OpenLogo source", () => {
  const manifest = manifestCopy();
  manifest.excluded.find((entry) => entry.name === "polygon").source =
    "package.json";
  const result = runBuiltInNamesGate({ manifest });
  assert.equal(result.ok, false);
  assert.equal(
    result.findings.includes(
      'excluded polygon: reason "library" names "package.json", which is not a real stdlib/*.logo file — the carve-out is that the name is OpenLogo SOURCE (ADR-0012), so any other path would prove nothing',
    ),
    true,
    result.findings.join("\n"),
  );
});

test("INJECTED DRIFT: a carve-out relabelled to escape its stdlib check", () => {
  const manifest = manifestCopy();
  const arc = manifest.excluded.find((entry) => entry.name === "arc");
  arc.reason = "contextual-keyword";
  arc.positions = ["bogus"];
  const result = runBuiltInNamesGate({ manifest });
  assert.equal(result.ok, false);
  assert.deepEqual(
    result.findings.filter((finding) => finding.startsWith("excluded arc:")),
    [
      'excluded arc: reason "contextual-keyword" carries a source (stdlib/geometry/arc.logo) that nothing checks — only a "library" carve-out has one',
      "excluded arc: position(s) bogus are outside the closed vocabulary [is-predicate, value-of-reader]",
    ],
  );
});

test("INJECTED DRIFT: an accessor entry with a status but no accessor name", () => {
  // Measured GREEN before: `resolveAccessor(api, undefined)` reads `api[undefined]`, which is
  // `undefined`, which is exactly what a `declared` accessor is supposed to look like — so the
  // direction was silently disabled while the gate reported zero findings.
  const manifest = manifestCopy();
  manifest.registries["core-primitive"].enumerate = {
    kind: "profile-enumerator",
    status: "declared",
  };
  const result = runBuiltInNamesGate({ manifest });
  assert.equal(result.ok, false);
  assert.equal(
    result.findings.includes(
      "registry core-primitive.enumerate: no accessor named — a status is a claim about an accessor, so an entry with no name silently disables this direction",
    ),
    true,
    result.findings.join("\n"),
  );
});

test("INJECTED DRIFT: the file's own contract statement blanked", () => {
  const manifest = manifestCopy();
  manifest.about = "";
  manifest.invariants.precedence = "";
  const result = runBuiltInNamesGate({ manifest });
  assert.equal(result.ok, false);
  assert.deepEqual(narrativeFindings(manifest), [
    `${MANIFEST_PATH}: no \`about\` — the file is normative, so what it claims to be is part of the contract`,
    `${MANIFEST_PATH}: invariants.precedence is missing or empty — ADR-0021 §2's invariants are the normative part, and an unstated one cannot be reviewed`,
  ]);
});

test("INJECTED DRIFT: a registry's alias enumerator and resolver disagreeing with each other", () => {
  // Measured live: making `turtleAliasNames()` omit `setxy` while `canonicalOfTurtleAlias("setxy")`
  // still resolved was GREEN — the forward loop asks only the resolver, the reverse loop walks only
  // the enumerator, so the two accessors could contradict each other unobserved.
  const api = {
    ...realParserApi,
    turtleAliasNames: () =>
      realParserApi.turtleAliasNames().filter((name) => name !== "setxy"),
  };
  assert.equal(api.turtleAliasNames().includes("setxy"), false);
  assert.equal(realParserApi.canonicalOfTurtleAlias("setxy"), "set_xy");
  const result = runBuiltInNamesGate({ api });
  assert.equal(result.ok, false);
  assert.equal(
    result.findings.includes(
      "setxy: canonicalOfTurtleAlias resolves its edge but turtleAliasNames does not list it — the registry's two accessors disagree",
    ),
    true,
    result.findings.join("\n"),
  );
});

test("INJECTED DRIFT: a library carve-out escaping stdlib by path traversal", () => {
  // The round-1 fix for "any file that exists" was "any file whose STRING starts with stdlib/",
  // which is a prefix test wearing a containment test's clothes. This path is real: it exists, it
  // ends `.logo`, it starts with `stdlib/`, and it is not OpenLogo standard-library source.
  assert.equal(
    REAL_IO.exists("stdlib/../spec/examples/01-movement.logo"),
    true,
  );
  assert.equal(
    isStdlibSource("stdlib/../spec/examples/01-movement.logo", REAL_IO),
    false,
  );
  const manifest = manifestCopy();
  manifest.excluded.find((entry) => entry.name === "polygon").source =
    "stdlib/../spec/examples/01-movement.logo";
  const result = runBuiltInNamesGate({ manifest });
  assert.equal(result.ok, false);
  assert.equal(
    result.findings.some((finding) =>
      finding.startsWith(
        'excluded polygon: reason "library" names "stdlib/../spec/examples/01-movement.logo"',
      ),
    ),
    true,
    result.findings.join("\n"),
  );
});

test("aliasFindings rejects an entry carrying two edge registries, whose verdict would be order-dependent", () => {
  const manifest = manifestCopy();
  entryFor(manifest, "fd").registries = ["heritage-alias", "turtle-primitive"];
  assert.deepEqual(
    aliasFindings(manifest, realParserApi).filter((finding) =>
      finding.startsWith("fd:"),
    ),
    [
      "fd: is in 2 registries that each carry alias edges (heritage-alias, turtle-primitive) — one name has one canonical, so this is ambiguous rather than merely unusual",
    ],
  );
});

test("the grammar keyword block is found by structure, not by its fence's info string", () => {
  // Issue #888 re-fenced the block from ```logo to ```text — it is a word list, not a runnable
  // program. An info-string-specific search silently walked past it to the NEXT ```logo block and
  // compared the wrong text, which is how this was found: the gate reported 39 missing keywords
  // rather than failing to locate its anchor.
  assert.deepEqual(
    extractGrammarKeywordBlock(
      "The normative OpenLogo keyword list is:\n\n```text\ndefine to\nend\n```\n\n```logo\nprint 1\n```\n",
    ),
    ["define", "to", "end"],
  );
  assert.deepEqual(
    extractGrammarKeywordBlock(
      "The normative OpenLogo keyword list is:\n\n```logo\ndefine\n```\n",
    ),
    ["define"],
  );
});

test("INJECTED DRIFT: a new profile keyword that no prose treatment accounts for", () => {
  // Measured live: adding `broadcast` to OL_PROFILE_KEYWORDS.sprites AND to `names` — with no
  // spec/tooling.md edit at all — was a GREEN 149-name gate. The row's clause covers "the profile
  // block-heads" generically, and nothing checked that a new word was one.
  const manifest = manifestCopy();
  manifest.names.push({
    name: "broadcast",
    category: "keyword",
    profile: "sprites",
    registries: ["profile-reserved"],
  });
  const findings = proseFindings(manifest, REAL_IO);
  assert.equal(
    findings.includes(
      `${MANIFEST_PATH}: profile keyword(s) broadcast are in neither addsProfileKeywordsNamedIndividually nor addsProfileKeywordsCoveredByClause — every one must be accounted for in the row, individually or by the clause`,
    ),
    true,
    findings.join("\n"),
  );
});

test("INJECTED DRIFT: a profile-word treatment that names something that is not one", () => {
  const manifest = manifestCopy();
  manifest.tokenClassKeyword.addsProfileKeywordsCoveredByClause = [
    ...manifest.tokenClassKeyword.addsProfileKeywordsCoveredByClause,
    "repeat",
  ];
  const findings = proseFindings(manifest, REAL_IO);
  assert.equal(
    findings.includes(
      `${MANIFEST_PATH}: repeat is recorded as a profile keyword of the token-class row but is not a profile keyword`,
    ),
    true,
    findings.join("\n"),
  );
});

test("INJECTED DRIFT: a profile word given two prose treatments at once", () => {
  const manifest = manifestCopy();
  manifest.tokenClassKeyword.addsProfileKeywordsCoveredByClause = [
    ...manifest.tokenClassKeyword.addsProfileKeywordsCoveredByClause,
    "tell",
  ];
  const findings = proseFindings(manifest, REAL_IO);
  assert.equal(
    findings.includes(
      `${MANIFEST_PATH}: tell is both named individually and covered by the clause — one word, one treatment`,
    ),
    true,
    findings.join("\n"),
  );
});

test("INJECTED DRIFT: an alias edge the resolver invents that neither list knows about", () => {
  // Measured live: `canonicalOfTurtleAlias("forward") → "back"` while `turtleAliasNames()` omitted
  // `forward` was GREEN — the forward loop visits only entries that already claim an edge, and the
  // reverse loop only names the enumerator already lists, so an edge in neither was seen by neither.
  const api = {
    ...realParserApi,
    canonicalOfTurtleAlias: (name) =>
      name === "forward" ? "back" : realParserApi.canonicalOfTurtleAlias(name),
  };
  assert.equal(api.canonicalOfTurtleAlias("forward"), "back");
  assert.equal(api.turtleAliasNames().includes("forward"), false);
  const result = runBuiltInNamesGate({ api });
  assert.equal(result.ok, false);
  assert.equal(
    result.findings.includes(
      "forward: canonicalOfTurtleAlias resolves an edge for it but turtleAliasNames does not list it — the registry's two accessors disagree",
    ),
    true,
    result.findings.join("\n"),
  );
});

test("INJECTED DRIFT: a library carve-out pointed at a directory, or outside stdlib", () => {
  // Third attempt at this check. Round 1 accepted any file that existed; round 2 accepted any path
  // whose STRING started with `stdlib/`. It now resolves the real path and requires a real file.
  const io = {
    ...REAL_IO,
    isStdlibFile: (path) => path === "stdlib/geometry/polygon.logo",
  };
  assert.equal(isStdlibSource("stdlib/geometry/polygon.logo", io), true);
  assert.equal(isStdlibSource("stdlib/geometry/polygon.txt", io), false);
  assert.equal(isStdlibSource(undefined, io), false);
  // A directory named `<something>.logo` satisfies "exists" and every string test; it is not source.
  assert.equal(REAL_IO.isStdlibFile("stdlib/geometry"), false);
  assert.equal(REAL_IO.isStdlibFile("stdlib"), false);
  assert.equal(REAL_IO.isStdlibFile("package.json"), false);
  assert.equal(REAL_IO.isStdlibFile("stdlib/../package.json"), false);
  assert.equal(
    REAL_IO.isStdlibFile("stdlib/../spec/examples/01-movement.logo"),
    false,
  );
  assert.equal(REAL_IO.isStdlibFile("stdlib/nope.logo"), false, "missing file");
  assert.equal(REAL_IO.isStdlibFile("stdlib/geometry/polygon.logo"), true);
});

test("the extractors bind to the block their anchor introduces, not to a plausible one", () => {
  // Every one of these was a live way to match the wrong thing and misdiagnose it as drift.
  assert.equal(
    extractGrammarKeywordBlock(
      "The normative OpenLogo keyword list is:\n\n```logo\nnot the list at all\n```\n\n```text\ndefine\n```\n",
    ).join(" "),
    "not the list at all",
    "the block after the anchor is the block, decoy or not — but it must be THAT block",
  );
  assert.equal(
    extractGrammarKeywordBlock(
      "The normative OpenLogo keyword list is:\n\nan editorial note\n\n```text\ndefine\n```\n",
    ),
    null,
    "a note between the anchor and the fence fails closed rather than skipping ahead",
  );
  assert.equal(
    extractToolingC19Mirror(
      "x this is the C19 registry repeated y:\n\nan editorial note.\n\n`define`.\n",
    ),
    null,
    "a paragraph that is not a word list is not the word list",
  );
  assert.deepEqual(
    extractToolingC19Mirror(
      "x this is the C19 registry repeated y:\n\n`define`, `to`,\n`end`.\n",
    ),
    ["define", "to", "end"],
  );
  assert.equal(
    extractToolingKeywordRow(
      "| `keyword` | decoy |\n| `keyword` | the real one |\n",
    ),
    null,
    "two rows with the same prefix means there is no single row to compare",
  );
});

// --- the fingerprint, and the mutations it replaced twelve hand-written anchors with ------------

test("INJECTED DRIFT: every edit to the token-class row, of any kind, is caught by the fingerprint", () => {
  // This one test replaces twelve hand-written anchor checks. Gating `spec/tooling.md:30` clause by
  // clause did not converge across five review rounds: each round declared anchors for the claims
  // the last round missed, and each round the reviewers found more — an ungated qualifier, a count
  // in the tail, a third polarity claim, then a fourth, then 697 characters still unread, then
  // anchors that could be blanked (or set to a single space) to switch their own checks off.
  //
  // Every mutation below was LIVE at some point in rounds 1–4, and eight of them survived the
  // anchor design. The list is the reviewers' own, not one invented to fit.
  const mutations = [
    ["polarity inverted", "are **not** in this class", "are in this class"],
    [
      "profile activation qualifier removed",
      "while their profile is active, the profile block-heads",
      "whether or not their profile is active, the profile block-heads",
    ],
    [
      "contextual positional qualifier removed",
      "in the structural positions described under [Reserved words](#reserved-words-for-tooling), none of which is a reserved word",
      "in every position, all of which are reserved words",
    ],
    [
      "delta counts drift from the manifest",
      "it omits four reserved words, adds four non-reserved ones",
      "it omits five reserved words, adds four non-reserved ones",
    ],
    [
      "independence claim inverted",
      "This class is **not derived from** the reserved list",
      "This class is **derived from** the reserved list",
    ],
    [
      "contextual carve-out count drifts",
      "other than the four contextual ones",
      "other than the five contextual ones",
    ],
    [
      "paint-independence claim inverted",
      "reserved-list membership never decides how a token is painted",
      "reserved-list membership always decides how a token is painted",
    ],
    [
      "a consequence of the contextual rule inverted",
      "so `local empty` is not a keyword",
      "so `local empty` is a keyword",
    ],
    [
      "contextual words made unconditional",
      "and are ordinary names elsewhere",
      "and are keywords everywhere",
    ],
    [
      "a bare dict key reclassified",
      "is `dict-key` on grammatical grounds alone",
      "is `keyword` on grammatical grounds alone",
    ],
    [
      "the profile-word delta deleted from the tail",
      ", and adds the profile words",
      "",
    ],
    [
      "the word-operators' actual class changed",
      "they are `operator` below",
      "they are `keyword` below",
    ],
    [
      "the lexical first pass denied",
      "The lexical first pass paints the words named above",
      "The lexical first pass paints no words at all",
    ],
    [
      "the normative cross-reference retargeted",
      "grammar.md#keywords-primitives-and-built-in-names",
      "grammar.md#no-such-anchor",
    ],
    [
      "a whitespace-only edit",
      "The word-spelled operators",
      "The  word-spelled operators",
    ],
  ];
  for (const [label, from, to] of mutations) {
    const io = proseIo(TOOLING_PATH, (text) => {
      assert.equal(text.includes(from), true, `${label}: needle absent`);
      return text.replace(from, to);
    });
    const findings = proseFindings(REAL_MANIFEST, io);
    assert.equal(
      findings.some((finding) =>
        finding.includes("This is not a request to update a hash"),
      ),
      true,
      `${label} survived: ${findings.join("\n")}`,
    );
  }
});

test("the fingerprint failure names the obligation, not a value to paste in", () => {
  // A hash gate whose failure mode is "update the hash" is a rubber stamp with extra steps: CI goes
  // red, the digest is replaced, and the gate has certified nothing while looking rigorous.
  const findings = rowFingerprintFindings(
    { ...REAL_MANIFEST.tokenClassKeyword },
    "| `keyword` | changed |",
  );
  assert.equal(findings.length, 1);
  assert.equal(
    findings[0].includes("This is not a request to update a hash"),
    true,
  );
  assert.equal(findings[0].includes("re-derive the class"), true);
  assert.equal(findings[0].includes("confirm every claim the row makes"), true);
});

test("a fingerprint that is not a digest is itself a finding", () => {
  for (const value of [undefined, "", "nope", "ABC123"]) {
    assert.deepEqual(rowFingerprintFindings({ rowFingerprint: value }, "x"), [
      `${MANIFEST_PATH}: tokenClassKeyword.rowFingerprint is not a sha256 digest — without it every claim in the row that this gate does not derive is unguarded`,
    ]);
  }
});

test("INJECTED DRIFT: a blank or duplicated split anchor, which would make the split arbitrary", () => {
  for (const anchor of ["", "   "]) {
    const manifest = manifestCopy();
    manifest.tokenClassKeyword.rowSplitAnchor = anchor;
    const findings = proseFindings(manifest, REAL_IO);
    assert.equal(
      findings.some((finding) => finding.includes("rowSplitAnchor is empty")),
      true,
      `${JSON.stringify(anchor)}: ${findings.join("\n")}`,
    );
  }
  const manifest = manifestCopy();
  manifest.tokenClassKeyword.rowSplitAnchor = "`";
  const findings = proseFindings(manifest, REAL_IO);
  assert.equal(
    findings.some((finding) => finding.includes("must occur exactly once")),
    true,
    findings.join("\n"),
  );
});

test("INJECTED DRIFT: a duplicate in a set-valued delta, which corrupts every count derived from it", () => {
  const manifest = manifestCopy();
  manifest.tokenClassKeyword.omitsKeywords = [
    ...manifest.tokenClassKeyword.omitsKeywords,
    "mod",
  ];
  const findings = proseFindings(manifest, REAL_IO);
  assert.equal(
    findings.includes(
      `${MANIFEST_PATH}: tokenClassKeyword.omitsKeywords lists mod more than once — these are sets, and a duplicate corrupts every count and difference derived from them`,
    ),
    true,
    findings.join("\n"),
  );
});

test("INJECTED DRIFT: a contextual carve-out the deltas forget, the reverse of the stray-addition check", () => {
  const manifest = manifestCopy();
  manifest.tokenClassKeyword.addsExcluded =
    manifest.tokenClassKeyword.addsExcluded.filter((word) => word !== "of");
  const findings = proseFindings(manifest, REAL_IO);
  assert.equal(
    findings.includes(
      `${MANIFEST_PATH}: contextual carve-out(s) of are not in tokenClassKeyword.addsExcluded — the token class admits the contextual words, so one the deltas forget is one the row is never checked for`,
    ),
    true,
    findings.join("\n"),
  );
});

test("INJECTED DRIFT: a C19 mirror paragraph carrying a span that is not a keyword", () => {
  // Removing every code span and checking the residue accepted a span that is not a word at all:
  // appending `not a complete list` left extraction at 44 words and the gate green.
  assert.equal(
    extractToolingC19Mirror(
      "x this is the C19 registry repeated y:\n\n`define`, `not a complete list`.\n",
    ),
    null,
  );
  assert.deepEqual(
    extractToolingC19Mirror(
      "x this is the C19 registry repeated y:\n\n`define`, `to`.\n",
    ),
    ["define", "to"],
  );
});

test("INJECTED DRIFT: an alias edge on a name outside the registry it is invented for", () => {
  // `members ∪ enumerated` was not the right universe: `canonicalOfTurtleAlias("print") → "forward"`
  // was green, because `print` is in the manifest but in neither the turtle registry nor its alias
  // enumerator, so neither loop ever probed it.
  const api = {
    ...realParserApi,
    canonicalOfTurtleAlias: (name) =>
      name === "print" ? "forward" : realParserApi.canonicalOfTurtleAlias(name),
  };
  assert.equal(api.canonicalOfTurtleAlias("print"), "forward");
  const result = runBuiltInNamesGate({ api });
  assert.equal(result.ok, false);
  assert.equal(
    result.findings.includes(
      "print: canonicalOfTurtleAlias resolves an edge for it but turtleAliasNames does not list it — the registry's two accessors disagree",
    ),
    true,
    result.findings.join("\n"),
  );
});

test("the stdlib check is case-sensitive, so its verdict does not depend on the host filesystem", () => {
  // `realpathSync` does not canonicalise case on Windows, so a case-INsensitive extension test made
  // `stdlib/x.LOGO` green here and red on CI's ubuntu-latest. A gate whose answer for a fixed
  // manifest changes with the filesystem is worse than one that is strict everywhere.
  assert.equal(isStdlibSource("stdlib/geometry/polygon.logo", REAL_IO), true);
  assert.equal(isStdlibSource("stdlib/geometry/polygon.LOGO", REAL_IO), false);
  assert.equal(isStdlibSource("STDLIB/geometry/polygon.logo", REAL_IO), false);
});

test("INJECTED DRIFT: the row kept verbatim but no longer a live normative table row", () => {
  // The digest covers the row's BYTES, not its CONTEXT. Measured green before this: the row wrapped
  // in an HTML comment, moved into a code fence, or relocated verbatim under a fabricated
  // "no longer normative" heading with a different table header — all with the digest intact.
  const header = REAL_MANIFEST.tokenClassKeyword.rowTableHeader;
  for (const [label, mutate] of [
    [
      "commented out",
      (text) => text.replace(/^(\| `keyword` \|.*)$/m, "<!--\n$1\n-->"),
    ],
    [
      "fenced",
      (text) => text.replace(/^(\| `keyword` \|.*)$/m, "```\n$1\n```"),
    ],
    [
      "table header deprecated",
      (text) => text.replace(header, "| Class (DEPRECATED) | Meaning |"),
    ],
  ]) {
    const io = proseIo(TOOLING_PATH, (text) => {
      const next = mutate(text);
      assert.notEqual(next, text, `${label}: probe did nothing`);
      return next;
    });
    const findings = proseFindings(REAL_MANIFEST, io);
    assert.equal(
      findings.some((finding) =>
        finding.includes("stopped being a live table row"),
      ),
      true,
      `${label} survived: ${findings.join("\n")}`,
    );
  }
});

test("INJECTED DRIFT: a contradicted claim survives the digest being bumped", () => {
  // This is what the fingerprint alone cannot do. It detects that the row CHANGED, and its remedy is
  // "re-derive and record the new digest" — a green button if taken carelessly. The three derived
  // claims compute their expectation from the manifest, so they still fire on a bumped digest.
  for (const [label, from, to] of [
    [
      "delta counts",
      "it omits four reserved words, adds four non-reserved ones",
      "it omits seven reserved words, adds nine non-reserved ones",
    ],
    [
      "independence polarity",
      "This class is **not derived from** the reserved list",
      "This class is **derived from** the reserved list",
    ],
    [
      "paint polarity",
      "reserved-list membership never decides how a token is painted",
      "reserved-list membership always decides how a token is painted",
    ],
  ]) {
    const manifest = manifestCopy();
    let mutated;
    const io = proseIo(TOOLING_PATH, (text) => {
      assert.equal(text.includes(from), true, `${label}: needle absent`);
      mutated = text.replace(from, to);
      return mutated;
    });
    // Bump the digest exactly as a careless contributor would, so the fingerprint is satisfied.
    manifest.tokenClassKeyword.rowFingerprint = rowFingerprint(
      extractToolingKeywordRow(
        io.readText(TOOLING_PATH),
        manifest.tokenClassKeyword.rowTableHeader,
      ),
    );
    const findings = proseFindings(manifest, io);
    assert.equal(
      findings.some((finding) =>
        finding.includes("This is not a request to update a hash"),
      ),
      false,
      `${label}: the digest should be satisfied, or this proves nothing`,
    );
    assert.equal(
      findings.length > 0,
      true,
      `${label} survived a bumped digest: ${findings.join("\n")}`,
    );
  }
});

test("the fingerprint failure hands out no digest to paste", () => {
  const findings = rowFingerprintFindings(
    { ...REAL_MANIFEST.tokenClassKeyword },
    "| `keyword` | changed |",
  );
  assert.equal(findings.length, 1);
  assert.equal(findings[0].includes("re-derive the class"), true);
  assert.equal(findings[0].includes("--print-fingerprint"), true);
  assert.equal(
    /[0-9a-f]{64}/.test(findings[0]),
    false,
    "a diagnostic that hands out the value invites pasting it",
  );
});

test("INJECTED DRIFT: an exclusion clause naming a word the manifest does not omit", () => {
  const io = proseIo(TOOLING_PATH, (text) =>
    text.replace(
      "`and`, `or`, `not`, and `mod` are **not** in this class",
      "`and`, `or`, `not`, `mod`, and `repeat` are **not** in this class",
    ),
  );
  const manifest = manifestCopy();
  manifest.tokenClassKeyword.rowFingerprint = rowFingerprint(
    extractToolingKeywordRow(
      io.readText(TOOLING_PATH),
      manifest.tokenClassKeyword.rowTableHeader,
    ),
  );
  const findings = proseFindings(manifest, io);
  assert.equal(
    findings.includes(
      `${TOOLING_PATH}: the row's exclusion clause names repeat, which ${MANIFEST_PATH} does not omit from the class`,
    ),
    true,
    findings.join("\n"),
  );
});

test("INJECTED DRIFT: a split anchor that does not bound the exclusion names", () => {
  const manifest = manifestCopy();
  manifest.tokenClassKeyword.rowSplitAnchor = "which takes no block";
  const findings = proseFindings(manifest, REAL_IO);
  assert.equal(
    findings.some(
      (finding) =>
        finding.includes("does not close the exclusion clause") ||
        finding.includes("is not bounding the words the clause excludes") ||
        finding.includes("not a bare list of names"),
    ),
    true,
    findings.join("\n"),
  );
});

test("INJECTED DRIFT: narrative fields blanked with a single space", () => {
  const manifest = manifestCopy();
  manifest.about = " ";
  manifest.invariants.bothDirections = " ";
  manifest.tokenClassKeyword.rowFingerprintReason = " ";
  const findings = narrativeFindings(manifest);
  assert.deepEqual(findings, [
    `${MANIFEST_PATH}: no \`about\` — the file is normative, so what it claims to be is part of the contract`,
    `${MANIFEST_PATH}: invariants.bothDirections is missing or empty — ADR-0021 §2's invariants are the normative part, and an unstated one cannot be reviewed`,
    `${MANIFEST_PATH}: tokenClassKeyword.rowFingerprintReason is missing or empty — it records why a delta or an anchor is what it is, which nothing else in the file says`,
  ]);
});

test("INJECTED DRIFT: a derived claim blanked, or a template that cannot interpolate", () => {
  const manifest = manifestCopy();
  manifest.tokenClassKeyword.independenceClause = "  ";
  manifest.tokenClassKeyword.deltaSentence = "it omits some words";
  const findings = proseFindings(manifest, REAL_IO);
  assert.equal(
    findings.includes(
      `${MANIFEST_PATH}: tokenClassKeyword.independenceClause is empty — an empty claim matches everything, so the check it guards is switched off rather than satisfied`,
    ),
    true,
    findings.join("\n"),
  );
  for (const placeholder of ["{omits}", "{adds}"]) {
    assert.equal(
      findings.includes(
        `${MANIFEST_PATH}: tokenClassKeyword.deltaSentence must contain ${placeholder} exactly once, or the count it claims is not the count this file holds`,
      ),
      true,
      findings.join("\n"),
    );
  }
});

test("numberWord spells small counts and falls back to digits", () => {
  assert.equal(numberWord(0), "zero");
  assert.equal(numberWord(4), "four");
  assert.equal(numberWord(12), "twelve");
  assert.equal(numberWord(13), "13");
});

test("--print-fingerprint is a deliberate act, and reports a missing row rather than a digest", () => {
  assert.equal(parseArgs(["--print-fingerprint"]).printFingerprint, true);
  assert.equal(parseArgs([]).printFingerprint, undefined);
  assert.equal(
    currentRowFingerprint(),
    REAL_MANIFEST.tokenClassKeyword.rowFingerprint,
  );
  const io = {
    ...REAL_IO,
    readText: (path) => (path === TOOLING_PATH ? "" : REAL_IO.readText(path)),
  };
  assert.equal(
    currentRowFingerprint({ io }),
    `no single live \`keyword\` row found under ${REAL_MANIFEST.tokenClassKeyword.rowTableHeader}`,
  );
});

test("a moved prose anchor is a finding, never a silent skip", () => {
  const grammarless = proseFindings(
    REAL_MANIFEST,
    fakeIo({ [GRAMMAR_PATH]: "no anchor here", [TOOLING_PATH]: "" }),
  );
  assert.deepEqual(grammarless, [
    `${GRAMMAR_PATH}: could not find the fenced keyword block after "The normative OpenLogo keyword list is:" — the anchor this gate reads has moved`,
    `${TOOLING_PATH}: could not find the C19 mirror paragraph after "this is the C19 registry repeated" — the anchor this gate reads has moved`,
    `${TOOLING_PATH}: could not find exactly one \`keyword\` token-class row under the declared table header, outside any code fence or HTML comment — the row this gate reads has moved, been duplicated, or stopped being a live table row`,
  ]);
});

// ---------------------------------------------------------------------------------------------
// Unit coverage of each check's own branches.
// ---------------------------------------------------------------------------------------------

test("the closed vocabularies are the ones ADR-0021 states", () => {
  assert.deepEqual(ACCESSOR_STATUSES, ["present", "declared"]);
  assert.deepEqual(ACCESSOR_KINDS, [
    "array",
    "record",
    "arity",
    "enumerator",
    "profile-enumerator",
  ]);
  assert.deepEqual(CATEGORIES, ["keyword", "primitive"]);
});

test("resolveAccessor reads a public export and reports a missing one as undefined", () => {
  assert.equal(resolveAccessor({ a: 1 }, "a"), 1);
  assert.equal(resolveAccessor({}, "a"), undefined);
});

test("accessorFindings rejects every value outside the closed vocabularies", () => {
  const manifest = {
    registries: {
      bad: {
        category: "colour",
        lookup: { accessor: "x", kind: "telepathy", status: "maybe" },
        enumerate: { accessor: "y", kind: "arity", status: "present" },
      },
      halfway: {
        category: "keyword",
        lookup: { accessor: "z", kind: "array", status: "present" },
      },
    },
  };
  const findings = accessorFindings(manifest, { y: [], z: [] });
  assert.deepEqual(findings, [
    'registry bad: category "colour" is outside the closed vocabulary [keyword, primitive]',
    'registry bad.lookup: kind "telepathy" is outside the closed vocabulary [array, record, arity, enumerator, profile-enumerator]',
    'registry bad.lookup: status "maybe" is outside the closed vocabulary [present, declared]',
    "registry bad.enumerate: y is an arity lookup and cannot enumerate — naming it here would satisfy the per-name direction while leaving the whole-list direction unreachable",
    "registry halfway: no enumerate accessor — each tag must name both, because the two comparison directions need different shapes",
  ]);
});

test("registryHas answers through each accessor kind, and null when the answer is unavailable", () => {
  const api = {
    words: ["end"],
    byProfile: { sprites: ["ask"] },
    arity: (name) => (name === "print" ? 1 : undefined),
    names: () => ["fd"],
    byProfileName: (profile) => (profile === "sound" ? ["beep"] : []),
  };
  const at = (kind, accessor, status = "present", profile = "sound") => ({
    profile,
    lookup: { accessor, kind, status },
  });
  assert.equal(registryHas(at("array", "words"), api, "end"), true);
  assert.equal(registryHas(at("array", "words"), api, "if"), false);
  assert.equal(registryHas(at("record", "byProfile"), api, "ask"), true);
  assert.equal(registryHas(at("record", "byProfile"), api, "if"), false);
  assert.equal(registryHas(at("arity", "arity"), api, "print"), true);
  assert.equal(registryHas(at("arity", "arity"), api, "if"), false);
  assert.equal(registryHas(at("enumerator", "names"), api, "fd"), true);
  assert.equal(
    registryHas(at("profile-enumerator", "byProfileName"), api, "beep"),
    true,
    "a profile-enumerator is asked with the registry's own profile",
  );
  assert.equal(
    registryHas(
      at("profile-enumerator", "byProfileName", "present", "sprites"),
      api,
      "beep",
    ),
    false,
  );
  assert.equal(
    registryHas(at("array", "words", "declared"), api, "end"),
    null,
    "a declared accessor has no answer to give",
  );
  assert.equal(registryHas(at("array", "gone"), api, "end"), null);
});

test("registryMembers enumerates, taking a Record's profile from its own key", () => {
  const api = {
    words: ["end"],
    byProfile: { sprites: ["ask"], "interaction-events": ["when"] },
    names: () => ["fd"],
    byProfileName: (profile) => [`${profile}-only`],
  };
  const at = (
    kind,
    accessor,
    status = "present",
    profile = "core-language",
  ) => ({
    profile,
    enumerate: { accessor, kind, status },
  });
  assert.deepEqual(
    [...registryMembers(at("array", "words"), api)],
    [["end", "core-language"]],
  );
  assert.deepEqual(
    [...registryMembers(at("record", "byProfile"), api)],
    [
      ["ask", "sprites"],
      ["when", "interaction-events"],
    ],
  );
  assert.deepEqual(
    [...registryMembers(at("enumerator", "names", "present", "heritage"), api)],
    [["fd", "heritage"]],
  );
  assert.deepEqual(
    [
      ...registryMembers(
        at("profile-enumerator", "byProfileName", "present", "sound"),
        api,
      ),
    ],
    [["sound-only", "sound"]],
  );
  assert.equal(registryMembers(at("array", "words", "declared"), api), null);
  assert.equal(registryMembers(at("array", "gone"), api), null);
});

test("deriveSummary applies keyword-before-primitive in the registries' own key order", () => {
  const manifest = {
    registries: {
      reserved: { category: "keyword", profile: "core-language" },
      "core-primitive": { category: "primitive", profile: "core-language" },
      "heritage-alias": { category: "primitive", profile: "heritage" },
      "heritage-form-head": { category: "keyword", profile: "heritage" },
    },
  };
  assert.deepEqual(
    deriveSummary(manifest, ["heritage-form-head", "reserved"], new Map()),
    { category: "keyword", profile: "core-language" },
  );
  assert.deepEqual(deriveSummary(manifest, ["heritage-alias"], new Map()), {
    category: "primitive",
    profile: "heritage",
  });
  assert.deepEqual(
    deriveSummary(manifest, ["reserved"], new Map([["reserved", "sprites"]])),
    { category: "keyword", profile: "sprites" },
    "a Record registry's per-name profile wins over the tag's own",
  );
});

test("entryFindings rejects a duplicate entry and an undefined registry tag", () => {
  const { manifest, api } = tinyFixture();
  manifest.names.push({ ...manifest.names[0] });
  manifest.names.push({
    name: "beep",
    category: "primitive",
    profile: "sound",
    registries: ["sound-primitive"],
  });
  assert.deepEqual(entryFindings(manifest, api), [
    "define: listed twice in names — a name is filed once, with its full membership in `registries`",
    `beep: names registry tag(s) sound-primitive that ${MANIFEST_PATH} does not define`,
  ]);
});

test("entryFindings skips a registry the file itself says does not exist yet", () => {
  const { manifest, api } = tinyFixture();
  manifest.registries["core-primitive"].lookup.status = "declared";
  manifest.registries["core-primitive"].enumerate.status = "declared";
  delete api.coreArity;
  delete api.coreNames;
  assert.deepEqual(entryFindings(manifest, api), []);
});

test("implementationFindings reports a registered name the file excludes as a carve-out", () => {
  const { manifest, api } = tinyFixture();
  manifest.names = manifest.names.filter((entry) => entry.name !== "print");
  manifest.excluded.push({
    name: "print",
    reason: "library",
    source: "stdlib/print.logo",
    rationale: "wrong, on purpose",
  });
  assert.deepEqual(implementationFindings(manifest, api), [
    `print: the implementation registers it in core-primitive, but ${MANIFEST_PATH} excludes it as "library" — a carve-out and a registration cannot both be true`,
  ]);
});

test("implementationFindings reports an entry that omits a registry it is actually in", () => {
  const { manifest, api } = tinyFixture();
  api.WORDS = ["define", "print"];
  entryFor(manifest, "print").registries = ["core-primitive"];
  assert.equal(
    implementationFindings(manifest, api).includes(
      "print: the implementation registers it in reserved but its entry records only core-primitive",
    ),
    true,
  );
});

test("aliasFindings rejects an edge on a registry that carries none, and a dangling target", () => {
  const { manifest, api } = tinyFixture();
  manifest.registries["core-primitive"].canonicalAccessor = "canonicalOfCore";
  manifest.registries["core-primitive"].aliasEnumerator = "coreAliasNames";
  api.canonicalOfCore = (name) => (name === "print" ? "define" : undefined);
  api.coreAliasNames = () => ["print"];
  assert.equal(api.canonicalOfCore("print"), "define");
  assert.equal(api.canonicalOfCore("other"), undefined);
  entryFor(manifest, "print").aliasOf = "nowhere";
  entryFor(manifest, "define").aliasOf = "print";
  assert.deepEqual(aliasFindings(manifest, api), [
    'define: records aliasOf "print" but none of its registries (reserved) carries alias edges',
    `print: aliasOf "nowhere" is not an entry in ${MANIFEST_PATH}`,
  ]);
});

test("aliasFindings reports an alias the implementation resolves that has no entry at all", () => {
  const manifest = manifestCopy();
  manifest.names = manifest.names.filter((entry) => entry.name !== "seth");
  const findings = aliasFindings(manifest, realParserApi);
  assert.equal(
    findings.includes(
      `seth: turtleAliasNames lists it as an alias of "set_heading" but it has no entry in ${MANIFEST_PATH}`,
    ),
    true,
    findings.join("\n"),
  );
});

test("aliasFindings reports an alias resolver that is not exported", () => {
  const { manifest, api } = tinyFixture();
  manifest.registries["core-primitive"].canonicalAccessor = "goneCanonical";
  manifest.registries["core-primitive"].aliasEnumerator = "goneNames";
  entryFor(manifest, "print").aliasOf = "define";
  assert.deepEqual(aliasFindings(manifest, api), [
    "print: goneCanonical is not exported from @openlogo/parser, so its alias edge cannot be verified",
    "registry core-primitive: names goneNames / goneCanonical for its alias edges, and at least one is not exported from @openlogo/parser",
  ]);
});

test("carveOutFindings rejects a duplicate, a missing rationale, and an unknown reason", () => {
  const manifest = {
    names: [],
    excluded: [
      {
        name: "of",
        reason: "contextual-keyword",
        positions: [],
        rationale: "x",
      },
      { name: "of", reason: "contextual-keyword", positions: ["is-predicate"] },
      { name: "polygon", reason: "vibes", rationale: "x" },
      {
        name: "star",
        reason: "library",
        source: "stdlib/star.logo",
        rationale: "",
      },
    ],
  };
  assert.deepEqual(
    carveOutFindings(manifest, fakeIo({ "stdlib/star.logo": "" })),
    [
      'excluded of: reason "contextual-keyword" records no positions — the positions are what make the word structural without OpenLogo owning the name',
      "excluded of: listed twice",
      'excluded polygon: reason "vibes" is outside the closed vocabulary [library, contextual-keyword]',
      "excluded star: no rationale — a carve-out with no stated reason is indistinguishable from an oversight",
    ],
  );
});

test("profileCoverageFindings rejects a declared-empty profile that now ships a primitive", () => {
  const { manifest, api } = tinyFixture();
  manifest.profilesWithoutPrimitives = { "core-language": "surely not" };
  assert.deepEqual(profileCoverageFindings(manifest, api), [
    `profile core-language: declared to ship no primitives, but ${MANIFEST_PATH} lists at least one — remove the declaration`,
  ]);
});

test("profileCoverageFindings rejects a declared-empty profile the checker does not know", () => {
  const { manifest, api } = tinyFixture();
  manifest.profilesWithoutPrimitives = { telepathy: "not a profile" };
  assert.deepEqual(profileCoverageFindings(manifest, api), [
    "profilesWithoutPrimitives names telepathy, which is not a profile the checker knows",
  ]);
});

test("profileCoverageFindings treats an absent declaration block as empty", () => {
  const { manifest, api } = tinyFixture();
  delete manifest.profilesWithoutPrimitives;
  assert.deepEqual(profileCoverageFindings(manifest, api), []);
});

test("the profile inventory ties spec/conformance.md, the manifest and the checker together", () => {
  assert.deepEqual(
    Object.keys(REAL_MANIFEST.profiles.ids).sort(),
    [...realParserApi.OL_CHECK_PROFILES].sort(),
  );
  assert.deepEqual(
    profileInventoryFindings(REAL_MANIFEST, realParserApi, REAL_IO),
    [],
  );
});

test("INJECTED DRIFT: a profile spec/conformance.md ships that the gate has never heard of", () => {
  const manifest = manifestCopy();
  delete manifest.profiles.ids.sound;
  const findings = profileInventoryFindings(manifest, realParserApi, REAL_IO);
  assert.deepEqual(findings, [
    `${CONFORMANCE_PATH}: profile section(s) Sound have no id in ${MANIFEST_PATH} — a profile the spec ships and the gate has never heard of is unchecked`,
    `${MANIFEST_PATH}: the checker knows profile(s) sound that the manifest does not map to a ${CONFORMANCE_PATH} section`,
  ]);
});

test("INJECTED DRIFT: a manifest profile with no section and no checker id", () => {
  const manifest = manifestCopy();
  manifest.profiles.ids.telepathy = "Telepathy";
  const findings = profileInventoryFindings(manifest, realParserApi, REAL_IO);
  assert.deepEqual(findings, [
    `${MANIFEST_PATH}: profile name(s) Telepathy have no section in ${CONFORMANCE_PATH}`,
    `${MANIFEST_PATH}: profile id(s) telepathy are not in the checker's OL_CHECK_PROFILES`,
  ]);
});

test("the conformance profile-section extractor fails closed on a moved anchor", () => {
  assert.equal(extractConformanceProfiles("nothing"), null);
  assert.equal(
    extractConformanceProfiles(
      "## Feature to profile table\n## Required profiles\n",
    ),
    null,
    "the two anchors in the wrong order",
  );
  assert.deepEqual(
    extractConformanceProfiles(
      "## Required profiles\n### Core Language\n## Optional profiles\n### Sound\n## Feature to profile table\n### Not a profile\n",
    ),
    ["Core Language", "Sound"],
  );
  const findings = profileInventoryFindings(
    REAL_MANIFEST,
    realParserApi,
    fakeIo({ [CONFORMANCE_PATH]: "nothing" }),
  );
  assert.deepEqual(findings, [
    `${CONFORMANCE_PATH}: could not find the profile sections between "## Required profiles" and "## Feature to profile table" — the anchor this gate reads has moved`,
  ]);
});

test("proseFindings rejects a delta that does not correspond to real data", () => {
  const manifest = manifestCopy();
  manifest.tokenClassKeyword.omitsKeywords = ["mod", "banana"];
  manifest.tokenClassKeyword.addsExcluded = ["of", "kumquat"];
  const findings = proseFindings(manifest, REAL_IO);
  assert.equal(
    findings.includes(
      `${MANIFEST_PATH}: tokenClassKeyword.omitsKeywords names banana, which is not a keyword — a delta can only omit something the list holds`,
    ),
    true,
    findings.join("\n"),
  );
  assert.equal(
    findings.includes(
      `${MANIFEST_PATH}: tokenClassKeyword.addsExcluded names kumquat, which is not an excluded contextual keyword`,
    ),
    true,
    findings.join("\n"),
  );
});

test("the prose extractors fail closed on a truncated document", () => {
  assert.equal(extractGrammarKeywordBlock("nothing"), null);
  assert.equal(
    extractGrammarKeywordBlock("The normative OpenLogo keyword list is:\n"),
    null,
    "no opening fence",
  );
  assert.equal(
    extractGrammarKeywordBlock(
      "The normative OpenLogo keyword list is:\n\n```logo\ndefine\n",
    ),
    null,
    "no closing fence",
  );
  assert.deepEqual(
    extractGrammarKeywordBlock(
      "The normative OpenLogo keyword list is:\n\n```logo\ndefine to\nend\n```\n",
    ),
    ["define", "to", "end"],
  );
  assert.equal(extractToolingC19Mirror("nothing"), null);
  assert.equal(
    extractToolingC19Mirror("this is the C19 registry repeated\n"),
    null,
    "the sentence is there but the paragraph is not",
  );
  assert.deepEqual(
    extractToolingC19Mirror(
      "x this is the C19 registry repeated y:\n\n`define`, `to`,\n`end`.\n\nnext\n",
    ),
    ["define", "to", "end"],
  );
  assert.equal(extractToolingKeywordRow("| `primitive` | x |", "| H |"), null);
  assert.equal(
    extractToolingKeywordRow("| H |\n|---|\n| `keyword` | x |", "| H |"),
    "| `keyword` | x |",
  );
  assert.equal(
    extractToolingKeywordRow("| Other |\n|---|\n| `keyword` | x |", "| H |"),
    null,
    "a row under a different table header is not this table's row",
  );
  assert.equal(
    extractToolingKeywordRow(
      "| H |\n|---|\n<!--\n| `keyword` | x |\n-->\n",
      "| H |",
    ),
    null,
    "a row commented out is not a live row",
  );
  assert.equal(
    extractToolingKeywordRow(
      "| H |\n|---|\n```\n| `keyword` | x |\n```\n",
      "| H |",
    ),
    null,
    "a row inside a fence is not a live row",
  );
  assert.equal(
    extractToolingKeywordRow(
      "| H |\n|---|\n| `keyword` | a |\n| `keyword` | b |",
      "| H |",
    ),
    null,
    "two rows means there is no single row to compare",
  );
});

test("backtickedWords takes bare lowercase identifiers and leaves phrases alone", () => {
  assert.deepEqual(
    backtickedWords(
      "`define` `local end` `dict-key` `empty?` `on_key` `:p.end`",
    ),
    ["define", "empty?", "on_key"],
  );
});

test("versionFindings is quiet when the versions agree", () => {
  assert.deepEqual(
    versionFindings({ specVersion: "1" }, { OPENLOGO_VERSION: "1" }),
    [],
  );
});

test("the gate reports a missing manifest rather than throwing", () => {
  const result = runBuiltInNamesGate({
    manifestPath: "spec/nope.json",
    io: fakeIo({}, []),
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.lines, [
    "built-in-names: spec/nope.json does not exist — it is the authoritative source (ADR-0021)",
  ]);
  assert.deepEqual(result.findings, result.lines);
});

test("the gate reads the manifest from disk when one is not supplied", () => {
  const result = runBuiltInNamesGate({ manifestPath: MANIFEST_PATH });
  assert.equal(result.ok, true);
});

test("a run with every registry enumerable prints no unenumerable note", () => {
  const { manifest, api } = tinyFixture();
  const io = fakeIo({
    [GRAMMAR_PATH]:
      "The normative OpenLogo keyword list is:\n\n```logo\ndefine\n```\n",
    [TOOLING_PATH]:
      "x this is the C19 registry repeated y:\n\n`define`.\n\n| H |\n|---|\n| `keyword` | `define` The word-spelled operators are **not** in this class. omits zero, adds zero. independent. never paints. |\n",
    [CONFORMANCE_PATH]:
      "## Required profiles\n### Core Language\n## Feature to profile table\n",
  });
  const result = runBuiltInNamesGate({ manifest, api, io });
  assert.deepEqual(result.findings, []);
  assert.equal(
    result.lines.some((line) => line.includes("NOTE")),
    false,
  );
});

test("parseArgs reads --manifest and ignores an incomplete one", () => {
  assert.deepEqual(parseArgs([]), {});
  assert.deepEqual(parseArgs(["--manifest", "a.json"]), {
    manifestPath: "a.json",
  });
  assert.deepEqual(parseArgs(["--manifest"]), {});
});

test("the CLI shell exits 0 on the shipped tree and non-zero on injected drift", () => {
  const green = spawnSync(
    process.execPath,
    ["scripts/check-built-in-names.mjs"],
    { encoding: "utf8" },
  );
  assert.equal(green.status, 0, green.stdout + green.stderr);
  assert.equal(green.stdout.includes("0 finding(s)"), true);

  const red = spawnSync(
    process.execPath,
    [
      "scripts/check-built-in-names.mjs",
      "--manifest",
      "spec/does-not-exist.json",
    ],
    { encoding: "utf8" },
  );
  assert.equal(red.status, 1);
  assert.equal(red.stdout.includes("does not exist"), true);

  // The deliberate act. It prints the digest and nothing else, and exits 0 — it is a tool you reach
  // for after re-deriving the class, not a value the failure diagnostic hands you.
  const printed = spawnSync(
    process.execPath,
    ["scripts/check-built-in-names.mjs", "--print-fingerprint"],
    { encoding: "utf8" },
  );
  assert.equal(printed.status, 0, printed.stdout + printed.stderr);
  assert.equal(
    printed.stdout.trim(),
    REAL_MANIFEST.tokenClassKeyword.rowFingerprint,
  );
});
