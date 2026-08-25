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
  STDLIB_DIR,
  TOOLING_PATH,
  accessorFindings,
  aliasFindings,
  backtickedWords,
  carveOutFindings,
  controlCharacterFindings,
  codeOnly,
  contextualCarveOutFindings,
  definesProcedure,
  deriveSummary,
  describeAccessor,
  directionAgreementFindings,
  duplicateRegistrationFindings,
  duplicatedNames,
  entryFindings,
  extractConformanceProfiles,
  extractContextualKeywords,
  extractGrammarKeywordBlock,
  extractToolingC19Mirror,
  extractToolingKeywordRow,
  hasAccessorShape,
  implementationFindings,
  isCanonicalName,
  isStdlibSource,
  loadManifest,
  logoFilesUnder,
  narrativeFindings,
  noteRestatementFindings,
  parseArgs,
  profileCoverageFindings,
  profileInventoryFindings,
  procedureNamesIn,
  profilePrimitiveSweepFindings,
  proseFindings,
  registryHas,
  registryMembers,
  resolveAccessor,
  rowFingerprintFindings,
  runBuiltInNamesGate,
  stdlibCarveOutFindings,
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
        note: "a tiny fixture",
        profile: "core-language",
        lookup: { accessor: "WORDS", kind: "array", status: "present" },
        enumerate: { accessor: "WORDS", kind: "array", status: "present" },
      },
      "core-primitive": {
        category: "primitive",
        note: "a tiny fixture",
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
    profiles: {
      about: "a tiny fixture",
      ids: { "core-language": "Core Language" },
    },
    tokenClassKeyword: {
      about: "a tiny fixture",
      rowFingerprintReason: "x",
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
    // No profile-keyed primitive table: this fixture's `core-primitive` enumerates through its own
    // `coreNames`, so declaring one here would claim a registry the manifest defines no tag for.
    profilePrimitiveNames: () => [],
    // The contextual carve-outs' claim is "not a built-in name", and this fixture's language owns
    // only `define`/`print`, so its two contextual words are genuinely unowned.
    isBuiltInName: (name) => name === "define" || name === "print",
  };
  return { manifest, api };
}

/** An `io` port backed by an in-memory `{ path: text }` map plus an explicit existence set. */
function fakeIo(files, existing = Object.keys(files)) {
  return {
    readText: (path) => files[path],
    exists: (path) => existing.includes(path),
    isStdlibFile: (path) => existing.includes(path),
    // Whatever the fixture put under `stdlib/`, which for most fixtures is nothing. A whole-gate
    // fixture (one driven through `runBuiltInNamesGate`) must therefore declare a `stdlib/*.logo`
    // file of its own, because an EMPTY scan is itself a finding since issue #964 — a bijection
    // between two empty sets would otherwise certify the library's absence.
    listStdlibFiles: () =>
      Object.keys(files).filter(
        (path) => path.startsWith("stdlib/") && path.endsWith(".logo"),
      ),
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
  // The carve-out total is broken out by reason, and the stdlib file count is printed, because
  // those are this gate's SCAN SURFACES: the two halves are bound to different authorities (a walk
  // of `stdlib/**.logo`, and `spec/grammar.md`'s own enumeration), and one number would hide which
  // of them a green run asserted (epic #900's "did the instrument audit itself?").
  const byReason = REAL_MANIFEST.excluded.reduce((counts, entry) => {
    counts[entry.reason] = (counts[entry.reason] ?? 0) + 1;
    return counts;
  }, {});
  const breakdown = Object.keys(byReason)
    .sort()
    .map((reason) => `${byReason[reason]} ${reason}`)
    .join(" + ");
  assert.equal(
    summary,
    `built-in-names: ${REAL_MANIFEST.names.length} names, ${REAL_MANIFEST.excluded.length} carve-outs (${breakdown}) over ${REAL_IO.listStdlibFiles().length} stdlib file(s), ${Object.keys(REAL_MANIFEST.registries).length} registries, spec version ${REAL_MANIFEST.specVersion} — 0 finding(s)`,
  );
  // Both reasons must actually appear, or the breakdown is describing a set that no longer exists.
  assert.deepEqual(Object.keys(byReason).sort(), [
    "contextual-keyword",
    "library",
  ]);
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

test("every Turtle & Rendering one-word spelling resolves to a canonical of equal arity", () => {
  // The title names only what this body can prove: the observable outputs. That the two maps are
  // `flatMap`ped from one `TURTLE_PRIMITIVES` row — so the canonical and the alias share a single
  // arity binding — is why they cannot diverge, but it is an implementation detail this test cannot
  // falsify: two independently built maps holding identical values would pass it. An earlier title
  // claimed the arity lookup resolves THROUGH the canonical map, and `turtlePrimitiveArity` does
  // not do that; it reads the arity map directly.
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

// ---------------------------------------------------------------------------------------------
// The carve-out set is bound to `stdlib/**.logo` in BOTH directions (issue #964).
//
// Before this, `definesProcedure` bound a carve-out's name to a file and NOTHING walked `stdlib/`,
// so the binding ran one way only. Measured at tip `0277d5ff`: emptying `excluded` printed
// `148 names, 0 carve-outs` and exited **0**. The gate reported its own emptiness and passed. The
// tests below are that mutation and its neighbours, asserted rather than described.
// ---------------------------------------------------------------------------------------------

test("INJECTED DRIFT: emptying excluded leaves every stdlib procedure uncarved", () => {
  // THE headline mutant. `spec/conformance.md:88-91` makes the Geometry procedures "library
  // procedures rather than built-in names", and these carve-outs are the reason those six names are
  // absent from the built-in list — absent reasons are what a completeness pass "fixes".
  const manifest = manifestCopy();
  manifest.excluded = [];
  const result = runBuiltInNamesGate({ manifest });
  assert.equal(result.ok, false);
  const uncarved = result.findings.filter((finding) =>
    finding.includes('records no "library" carve-out'),
  );
  // One finding per PROCEDURE the walk discovers, not per file: a file lawfully defining two would
  // make a file-count comparison wrong while the gate was right.
  const definedNames = new Set(
    REAL_IO.listStdlibFiles().flatMap((file) =>
      procedureNamesIn(REAL_IO.readText(file)),
    ),
  );
  assert.equal(uncarved.length, definedNames.size, result.findings.join("\n"));
  assert.ok(
    definedNames.size > 0,
    "nothing was scanned, so nothing was proven",
  );
});

test("INJECTED DRIFT: a new stdlib procedure with no carve-out is a finding", () => {
  // This issue's original direction: a seventh stdlib procedure needed no carve-out and the gate
  // kept reporting the same total. Driven through the `io` port so no file is written to disk.
  const io = {
    ...REAL_IO,
    listStdlibFiles: () => [
      ...REAL_IO.listStdlibFiles(),
      "stdlib/geometry/hexagon.logo",
    ],
    readText: (path) =>
      path === "stdlib/geometry/hexagon.logo"
        ? "define hexagon :size\n  repeat 6 [ forward :size right 60 ]\nend\n"
        : REAL_IO.readText(path),
  };
  const result = runBuiltInNamesGate({ manifest: manifestCopy(), io });
  assert.equal(result.ok, false);
  assert.equal(
    result.findings.includes(
      `stdlib/geometry/hexagon.logo defines "hexagon" but ${MANIFEST_PATH} records no "library" carve-out for it — a stdlib procedure absent from both names and excluded is indistinguishable from a name nobody has noticed is missing`,
    ),
    true,
    result.findings.join("\n"),
  );
});

test("INJECTED DRIFT: a library carve-out no stdlib file defines is a finding", () => {
  // The manifest→stdlib direction, which already existed through `isStdlibSource` +
  // `definesProcedure` and is asserted here as the other half of the bijection: both directions
  // named in one place, so a later reader can see the pair rather than infer it.
  const manifest = manifestCopy();
  manifest.excluded = manifest.excluded.filter(
    (entry) => entry.name !== "polygon",
  );
  manifest.excluded.push({
    name: "dodecagon",
    reason: "library",
    source: "stdlib/geometry/polygon.logo",
    rationale: "invented for this test",
  });
  const result = runBuiltInNamesGate({ manifest });
  assert.equal(result.ok, false);
  assert.equal(
    result.findings.includes(
      `excluded dodecagon: reason "library" but no ${STDLIB_DIR}/**.logo file defines a procedure of that name`,
    ),
    true,
    result.findings.join("\n"),
  );
});

test("an empty stdlib scan is a finding, not a bijection between two empty sets", () => {
  // The anti-vacuity clause, and the reason this gate is not itself an instance of the defect it
  // now catches: with `stdlib/` gone the two sets agree trivially, so the check written to protect
  // the library would certify its absence. Everything else that mentions `stdlib` is driven by
  // manifest entries that would be gone too, so nothing else would notice either.
  const manifest = manifestCopy();
  manifest.excluded = manifest.excluded.filter(
    (entry) => entry.reason !== "library",
  );
  const io = { ...REAL_IO, listStdlibFiles: () => [] };
  const result = runBuiltInNamesGate({ manifest, io });
  assert.equal(result.ok, false);
  assert.equal(
    result.findings.some((finding) =>
      finding.startsWith(`${STDLIB_DIR}/ defines no OpenLogo procedure`),
    ),
    true,
    result.findings.join("\n"),
  );
});

test("a stdlib holding files but no procedure is the same finding", () => {
  // The version that matters, and the one a file-count guard passed. Keying anti-vacuity on
  // *files walked* rather than *procedures found* leaves an escape: delete the six geometry
  // procedures and their six carve-outs, leave any one header-free `.logo` file behind, and both
  // sets are empty again while the count is not — the countermeasure passing on precisely the
  // input it exists to reject, which is this epic's own defect one level up.
  const manifest = manifestCopy();
  manifest.excluded = manifest.excluded.filter(
    (entry) => entry.reason !== "library",
  );
  const io = {
    ...REAL_IO,
    listStdlibFiles: () => ["stdlib/readme-sample.logo"],
    readText: () => "# a sample with no define header\nforward 100\n",
  };
  const result = runBuiltInNamesGate({ manifest, io });
  assert.equal(result.ok, false);
  assert.equal(
    result.findings.some((finding) =>
      finding.startsWith(
        `${STDLIB_DIR}/ defines no OpenLogo procedure across 1 .logo file(s)`,
      ),
    ),
    true,
    result.findings.join("\n"),
  );
});

test("a stdlib walk that throws is a finding, not a crash", () => {
  // The port boundary is where the guarantee has to hold. `logoFilesUnder` catches internally, but
  // `io` is injectable, so a throwing walk crashed the gate rather than producing the very
  // "defines no OpenLogo procedure" finding written for a stdlib nothing could scan.
  const io = {
    ...REAL_IO,
    listStdlibFiles: () => {
      throw new Error("walker exploded");
    },
  };
  const result = runBuiltInNamesGate({ manifest: manifestCopy(), io });
  assert.equal(result.ok, false);
  assert.equal(
    result.findings.some((finding) =>
      finding.startsWith(`${STDLIB_DIR}/ defines no OpenLogo procedure`),
    ),
    true,
    result.findings.join("\n"),
  );
  // And the summary still renders, reporting the empty scan surface rather than throwing.
  assert.equal(
    result.lines.some((line) => line.includes(`over 0 ${STDLIB_DIR} file(s)`)),
    true,
    result.lines.join("\n"),
  );
});

test("the stdlib is walked once per run, so the report cites the scan the checks used", () => {
  // A non-idempotent port must not be able to make the two disagree. With the walk done twice, a
  // second call that threw left validation seeing the library while the summary line reported
  // `over 0 stdlib file(s)` beside `0 finding(s)` — a green run describing a tree it did not check.
  //
  // The counter alone is the assertion. A `throw` on the second call would read as a stronger
  // guard and is strictly weaker: it can only ever be dead code while the fix holds, which is the
  // unreachable-clause class this file has now produced three times.
  let calls = 0;
  const io = {
    ...REAL_IO,
    listStdlibFiles: () => {
      calls += 1;
      return REAL_IO.listStdlibFiles();
    },
  };
  const result = runBuiltInNamesGate({ manifest: manifestCopy(), io });
  assert.equal(calls, 1, `the stdlib was walked ${calls} times, expected once`);
  assert.deepEqual(result.findings, []);
  assert.equal(
    result.lines.some((line) =>
      line.includes(
        `over ${REAL_IO.listStdlibFiles().length} ${STDLIB_DIR} file(s)`,
      ),
    ),
    true,
    result.lines.join("\n"),
  );
});

test("every document is read once per run, so no check judges a different version", () => {
  // The "Frankenstein document": `spec/grammar.md` is consulted twice — for the contextual-keyword
  // enumeration and for the normative keyword block — so a non-idempotent port could hand one check
  // a valid document and the other a doctored one, and the gate would report 0 findings on a
  // document that never existed. Every check would have passed against *a* version and none
  // against *the same* version.
  const real = REAL_IO.readText(GRAMMAR_PATH);
  const lines = real.split(/\r?\n/);
  const anchored = lines.findIndex((line) =>
    line.includes("contextual keywords are exactly these"),
  );
  const doctored = [...lines];
  doctored[anchored] +=
    " By contrast, `quux` are **not** keywords and **not** built-in names.";
  let reads = 0;
  const io = {
    ...REAL_IO,
    readText: (path) => {
      if (path !== GRAMMAR_PATH) {
        return REAL_IO.readText(path);
      }
      reads += 1;
      // A port that alternates: valid first, contradictory second.
      return reads === 1 ? real : doctored.join("\n");
    },
  };
  const result = runBuiltInNamesGate({ manifest: manifestCopy(), io });
  assert.equal(
    reads,
    1,
    `${GRAMMAR_PATH} was read ${reads} times, expected once`,
  );
  assert.deepEqual(result.findings, []);
});

test("a document that cannot be read stays unreadable for every check in the run", () => {
  // The failure half of the same guarantee. A port that throws once and succeeds afterwards must
  // not let one check call a document missing while another validates it.
  let reads = 0;
  const io = {
    ...REAL_IO,
    readText: (path) => {
      if (path !== GRAMMAR_PATH) {
        return REAL_IO.readText(path);
      }
      reads += 1;
      if (reads === 1) {
        throw new Error("EACCES");
      }
      return REAL_IO.readText(path);
    },
  };
  const result = runBuiltInNamesGate({ manifest: manifestCopy(), io });
  assert.equal(
    reads,
    1,
    `${GRAMMAR_PATH} was read ${reads} times, expected once`,
  );
  assert.equal(result.ok, false);
  assert.equal(
    result.findings.filter((finding) =>
      finding.startsWith(`${GRAMMAR_PATH}: could not be read`),
    ).length,
    1,
    result.findings.join("\n"),
  );
});

test("a spec document that cannot be read is a finding, not a crash", () => {
  // Every prose anchor lives in a `spec/` document opened by path, and each read was unguarded:
  // a permissions change or a race with a checkout threw out of the gate instead of reporting
  // (issue #988). Each document is asserted separately so a guard added to one does not read as
  // covering all three.
  for (const path of [GRAMMAR_PATH, TOOLING_PATH, CONFORMANCE_PATH]) {
    const io = {
      ...REAL_IO,
      readText: (candidate) => {
        if (candidate === path) {
          throw new Error("EACCES");
        }
        return REAL_IO.readText(candidate);
      },
    };
    const result = runBuiltInNamesGate({ manifest: manifestCopy(), io });
    assert.equal(result.ok, false, `${path} must fail the run`);
    assert.equal(
      result.findings.some((finding) =>
        finding.startsWith(`${path}: could not be read`),
      ),
      true,
      `${path}: ${result.findings.join("\n")}`,
    );
    // And it must not become a silent pass: the anchors that went unchecked say so too.
    assert.equal(
      result.findings.some((finding) =>
        finding.startsWith(`${path}: could not find`),
      ),
      true,
      `${path} reported the read failure but not the unchecked anchor`,
    );
  }
});

test("every prose extractor fails closed on a non-string input", () => {
  // What makes the read guard above safe with no extra branch at each call site: an unreadable
  // document yields `undefined`, and each extractor answers `null` rather than throwing, so the
  // existing "anchor has moved" finding fires.
  for (const extract of [
    extractGrammarKeywordBlock,
    extractToolingC19Mirror,
    extractToolingKeywordRow,
    extractConformanceProfiles,
    extractContextualKeywords,
  ]) {
    assert.equal(extract(undefined), null, extract.name);
  }
});

test("contextualCarveOutFindings reports rather than throws when its document is unreadable", () => {
  // The unit-level counterpart of the gate-wide assertion above: the check this slice added
  // reports on its own, independent of the shared `readDocument` guard in `proseFindings`.
  const findings = contextualCarveOutFindings(REAL_MANIFEST, realParserApi, {
    ...REAL_IO,
    readText: () => {
      throw new Error("EACCES");
    },
  });
  assert.equal(findings.length, 1);
  assert.equal(
    findings[0].includes("could not derive the contextual keywords"),
    true,
    findings.join("\n"),
  );
});

test("a stdlib file that cannot be read is a finding, not a crash", () => {
  // `logoFilesUnder` catches so "the library is gone" arrives as a finding; every per-file read has
  // to do the same, or a permissions change or a broken symlink throws out of the gate and reads
  // like a broken gate rather than the unchecked file it is. Both carve-out directions read
  // `stdlib/`, so both are asserted here — the guarantee is the gate's, not one function's.
  const io = {
    ...REAL_IO,
    readText: (path) => {
      if (path === "stdlib/geometry/polygon.logo") {
        throw new Error("EACCES");
      }
      return REAL_IO.readText(path);
    },
  };
  const result = runBuiltInNamesGate({ manifest: manifestCopy(), io });
  assert.equal(result.ok, false);
  assert.equal(
    result.findings.some((finding) =>
      finding.startsWith(
        "stdlib/geometry/polygon.logo was listed under stdlib/ but could not be read",
      ),
    ),
    true,
    result.findings.join("\n"),
  );
  assert.equal(
    result.findings.some((finding) =>
      finding.startsWith(
        "excluded polygon: stdlib/geometry/polygon.logo was named as its library source but could not be read",
      ),
    ),
    true,
    result.findings.join("\n"),
  );
});

test("INJECTED DRIFT: one procedure name defined by two stdlib files is ambiguous", () => {
  // A carve-out names ONE source file. Two files defining the same procedure would make the
  // manifest→stdlib binding satisfiable by either, so the pair stops meaning what it says.
  const io = {
    ...REAL_IO,
    listStdlibFiles: () => [
      ...REAL_IO.listStdlibFiles(),
      "stdlib/geometry/polygon-again.logo",
    ],
    readText: (path) =>
      path === "stdlib/geometry/polygon-again.logo"
        ? "define polygon :sides :size\nend\n"
        : REAL_IO.readText(path),
  };
  const result = runBuiltInNamesGate({ manifest: manifestCopy(), io });
  assert.equal(result.ok, false);
  assert.equal(
    result.findings.some(
      (finding) =>
        finding.includes('defines "polygon" in both') &&
        finding.includes("polygon-again.logo"),
    ),
    true,
    result.findings.join("\n"),
  );
});

test("stdlibCarveOutFindings reads headers, not prose that merely mentions define", () => {
  // `procedureNamesIn` is the one header scan both directions use, so its blind spots are the
  // bijection's blind spots. Comments and string literals are blanked before the scan (`codeOnly`),
  // which is what keeps a doc-comment example from registering a procedure nobody wrote.
  assert.deepEqual(
    procedureNamesIn(
      '# define ghost\ndefine real :x\nend\n"define quoted"\n  define indented\nend\n',
    ),
    ["real", "indented"],
  );
  // A bare `define` with no name registers nothing rather than `undefined`.
  assert.deepEqual(procedureNamesIn("define\n"), []);
  assert.deepEqual(procedureNamesIn(undefined), []);
  // Case-folded, because `spec/grammar.md:13` makes keywords and identifiers case-insensitive:
  // `DEFINE Hexagon` declares the same procedure as `define hexagon`. A scanner anchored on the
  // lowercase spelling would read a real stdlib procedure as absent — and since this walk reports
  // an ABSENT carve-out, that blind spot would become the gate's.
  assert.deepEqual(procedureNamesIn("DEFINE Hexagon :size\nend\n"), [
    "hexagon",
  ]);
  assert.deepEqual(procedureNamesIn("DeFiNe HEXAGON\n"), ["hexagon"]);
  // The two directions agree by construction because they are one scan.
  assert.equal(definesProcedure("define real :x\nend\n", "real"), true);
  assert.equal(definesProcedure("DEFINE REAL :x\nend\n", "real"), true);
  assert.equal(definesProcedure("define real :x\nend\n", "ghost"), false);
});

test("INJECTED DRIFT: an uncarved stdlib procedure written in upper case", () => {
  // The mutation the case-sensitive scanner passed: a real procedure, no carve-out, invisible.
  const io = {
    ...REAL_IO,
    listStdlibFiles: () => [
      ...REAL_IO.listStdlibFiles(),
      "stdlib/geometry/hexagon.logo",
    ],
    readText: (path) =>
      path === "stdlib/geometry/hexagon.logo"
        ? "DEFINE HEXAGON :size\n  repeat 6 [ forward :size right 60 ]\nend\n"
        : REAL_IO.readText(path),
  };
  const result = runBuiltInNamesGate({ manifest: manifestCopy(), io });
  assert.equal(result.ok, false);
  assert.equal(
    result.findings.some(
      (finding) =>
        finding.includes("hexagon.logo") && finding.includes('"hexagon"'),
    ),
    true,
    result.findings.join("\n"),
  );
});

test("stdlibCarveOutFindings is clean on the shipped tree, and says over how many files", () => {
  // The control for the five mutants above: they only mean something because this is empty.
  assert.deepEqual(stdlibCarveOutFindings(REAL_MANIFEST, REAL_IO), []);
  const stdlibFiles = REAL_IO.listStdlibFiles();
  const libraryCarveOuts = REAL_MANIFEST.excluded.filter(
    (entry) => entry.reason === "library",
  );
  // Cross-derived: the carve-out set and the set of procedures the walk finds are produced by
  // different instruments (a JSON read and a directory walk + header scan) and must reconcile
  // exactly. Reconciled on PROCEDURE NAMES, not on file count — the bijection is names-to-names,
  // and one file lawfully defining two procedures would fail a file-count comparison while being
  // perfectly correct. The file count is reported separately, as scan-surface evidence.
  const defined = stdlibFiles.flatMap((file) =>
    procedureNamesIn(REAL_IO.readText(file)),
  );
  assert.deepEqual(
    [...new Set(defined)].sort(),
    libraryCarveOuts.map((entry) => entry.name).sort(),
  );
  assert.equal(
    defined.length,
    new Set(defined).size,
    "a procedure defined twice would make the carve-out binding ambiguous",
  );
  assert.ok(stdlibFiles.length > 0, "the scan surface must not be empty");
  assert.deepEqual(
    stdlibFiles.filter((path) => !path.endsWith(".logo")),
    [],
    "the scan surface must be .logo files only",
  );
});

test("logoFilesUnder normalises separators, sorts, and reports a missing directory as empty", () => {
  // The scan surface itself. A missing directory must read as EMPTY rather than throw, because
  // "the library is gone" is a finding this gate words for a human — a stack trace out of the
  // walker would fail the run while reading like the gate itself was broken.
  assert.deepEqual(logoFilesUnder("no/such/directory"), []);
  const files = logoFilesUnder(STDLIB_DIR);
  assert.deepEqual(files, [...files].sort(), "not sorted");
  assert.deepEqual(
    files.filter((path) => path.includes("\\")),
    [],
    "a Windows-separated path would not match a manifest source",
  );
  assert.equal(
    files.includes("stdlib/geometry/polygon.logo"),
    true,
    "the walk must reach a nested .logo file",
  );
});

// ---------------------------------------------------------------------------------------------
// The CONTEXTUAL carve-outs are bound to spec/grammar.md's own enumeration, both ways (issue #964).
//
// The library half above was only half the hole. Deleting the `of` carve-out left the gate at
// `0 finding(s)`, exit 0, while the summary still presented every carve-out as asserted — a
// per-entry validator cannot notice a MISSING entry, whatever the reason.
// ---------------------------------------------------------------------------------------------

test("the contextual carve-outs are exactly the four words spec/grammar.md names", () => {
  // The control, and the cross-derivation: the manifest's set and the spec's sentence are produced
  // by different instruments (a JSON read and a prose extraction) and must reconcile exactly.
  assert.deepEqual(
    contextualCarveOutFindings(REAL_MANIFEST, realParserApi, REAL_IO),
    [],
  );
  const declared = extractContextualKeywords(REAL_IO.readText(GRAMMAR_PATH));
  assert.deepEqual([...declared].sort(), ["a", "empty", "member", "of"]);
  assert.deepEqual(
    REAL_MANIFEST.excluded
      .filter((entry) => entry.reason === "contextual-keyword")
      .map((entry) => entry.name)
      .sort(),
    [...declared].sort(),
  );
});

test("INJECTED DRIFT: deleting the `of` contextual carve-out is a finding", () => {
  // The exact mutation that passed green before this check existed.
  const manifest = manifestCopy();
  manifest.excluded = manifest.excluded.filter((entry) => entry.name !== "of");
  const result = runBuiltInNamesGate({ manifest });
  assert.equal(result.ok, false);
  assert.equal(
    result.findings.some(
      (finding) =>
        finding.includes('names "of" a contextual keyword') &&
        finding.includes("records no"),
    ),
    true,
    result.findings.join("\n"),
  );
});

test("INJECTED DRIFT: a contextual carve-out the spec does not name is a finding", () => {
  // The manifest->spec direction. `spec/grammar.md` closes the set ("exactly these four"), so an
  // invented fifth is drift rather than an addition.
  const manifest = manifestCopy();
  manifest.excluded.push({
    name: "beside",
    reason: "contextual-keyword",
    positions: ["is-predicate"],
    rationale: "invented for this test",
  });
  const result = runBuiltInNamesGate({ manifest });
  assert.equal(result.ok, false);
  assert.equal(
    result.findings.some((finding) =>
      finding.startsWith('excluded beside: reason "contextual-keyword" but'),
    ),
    true,
    result.findings.join("\n"),
  );
});

test("INJECTED DRIFT: a contextual word the implementation starts owning is a finding", () => {
  // The implementation->manifest direction, and the substance of the carve-out: these words are
  // structural by position *and* not built-in names. A later slice registering one as a keyword or
  // a primitive refutes the entry, and this is what says so.
  const api = { ...realParserApi, isBuiltInName: (name) => name === "of" };
  const result = runBuiltInNamesGate({ manifest: manifestCopy(), api });
  assert.equal(result.ok, false);
  assert.equal(
    result.findings.some(
      (finding) =>
        finding.startsWith("excluded of: carved out as a contextual keyword") &&
        finding.includes("isBuiltInName says OpenLogo owns the name"),
    ),
    true,
    result.findings.join("\n"),
  );
});

test("the contextual extractor fails closed on a reworded, contradicted or miscounted sentence", () => {
  // Fail closed, never silently skip: `spec/` is maintainer-owned, so this gate anchors on prose
  // already there and a reworded paragraph must fail loudly rather than check nothing.
  assert.equal(extractContextualKeywords(""), null);
  assert.equal(extractContextualKeywords(undefined), null);
  assert.deepEqual(
    extractContextualKeywords(
      "By contrast, `empty`, `member`, `of`, and `a` are **not** keywords and **not** built-in names. The contextual keywords are exactly these four;",
    ),
    ["empty", "member", "of", "a"],
  );
  // The enumeration without its closing claim: the list could grow a fifth word unobserved.
  assert.equal(
    extractContextualKeywords(
      "By contrast, `empty`, `member` are **not** keywords and **not** built-in names.",
    ),
    null,
  );
  // The closing claim without the enumeration: names no words at all.
  assert.equal(
    extractContextualKeywords(
      "The contextual keywords are exactly these four;",
    ),
    null,
  );
  // Present but empty of backticked words.
  assert.equal(
    extractContextualKeywords(
      "By contrast, those words are **not** keywords and **not** built-in names. The contextual keywords are exactly these four;",
    ),
    null,
  );
  // THE INVERTED CLAIM. Matching only `are **not** keywords` accepted a sentence saying these words
  // ARE built-in names — the exact opposite of what a carve-out asserts — and still derived them.
  assert.equal(
    extractContextualKeywords(
      "By contrast, `empty`, `member`, `of`, and `a` are **not** keywords but **are** built-in names. The contextual keywords are exactly these four;",
    ),
    null,
  );
  // THE MISCOUNT. Five enumerated words beneath prose still claiming four: matching the anchor
  // without reading its number derived the wrong set and then forced the manifest to follow it.
  assert.equal(
    extractContextualKeywords(
      "By contrast, `empty`, `member`, `of`, `a`, and `beside` are **not** keywords and **not** built-in names. The contextual keywords are exactly these four;",
    ),
    null,
  );
  // A count word outside the bounded map is unrecognised rather than assumed.
  assert.equal(
    extractContextualKeywords(
      "By contrast, `empty`, `member`, `of`, and `a` are **not** keywords and **not** built-in names. The contextual keywords are exactly these several;",
    ),
    null,
  );
  // TWO ANCHOR PAIRS IN DIFFERENT PARAGRAPHS. Returning on the first left a second, contradictory
  // paragraph unread, so the document could disagree with itself while the gate reported nothing.
  assert.equal(
    extractContextualKeywords(
      "By contrast, `empty`, `member`, `of`, and `a` are **not** keywords and **not** built-in names. The contextual keywords are exactly these four;\n\nBy contrast, `beside` are **not** keywords and **not** built-in names. The contextual keywords are exactly these one;",
    ),
    null,
  );
  // TWO CLOSING CLAIMS IN THE SAME PARAGRAPH. Matching once per paragraph left the second unread
  // too — the same false pass one scope down, which is why both anchors are now counted
  // document-wide rather than per paragraph.
  assert.equal(
    extractContextualKeywords(
      "By contrast, `empty`, `member`, `of`, and `a` are **not** keywords and **not** built-in names. The contextual keywords are exactly these four; the contextual keywords are exactly these one;",
    ),
    null,
  );
  // TWO ENUMERATIONS IN THE SAME PARAGRAPH, likewise.
  assert.equal(
    extractContextualKeywords(
      "By contrast, `empty` are **not** keywords and **not** built-in names. By contrast, `beside` are **not** keywords and **not** built-in names. The contextual keywords are exactly these one;",
    ),
    null,
  );
  // ORPHANED ANCHORS: one of each, but in different paragraphs, so neither closes the other.
  assert.equal(
    extractContextualKeywords(
      "By contrast, `empty` are **not** keywords and **not** built-in names.\n\nThe contextual keywords are exactly these one;",
    ),
    null,
  );
  // And an agreeing five-word form IS derived, so the count is reconciled rather than hardcoded.
  assert.deepEqual(
    extractContextualKeywords(
      "By contrast, `empty`, `member`, `of`, `a`, and `beside` are **not** keywords and **not** built-in names. The contextual keywords are exactly these five;",
    ),
    ["empty", "member", "of", "a", "beside"],
  );
  // DUPLICATES. Four backticked words of which two are the same spelling satisfies a count of four
  // while naming three, so the derived set would be smaller than the sentence claims.
  assert.equal(
    extractContextualKeywords(
      "By contrast, `empty`, `empty`, `of`, and `a` are **not** keywords and **not** built-in names. The contextual keywords are exactly these four;",
    ),
    null,
  );
  // A COMPOUND COUNT. A bare `\\w+` capture matched the `four` of "four hundred", so the count word
  // must be followed immediately by punctuation.
  assert.equal(
    extractContextualKeywords(
      "By contrast, `empty`, `member`, `of`, and `a` are **not** keywords and **not** built-in names. The contextual keywords are exactly these four hundred;",
    ),
    null,
  );
  // `contextualCarveOutFindings` reads exactly one document, so the double answers for that one
  // and nothing else — a ternary falling back to the real reader would be a branch no test can
  // reach, which is precisely the kind of unreachable clause this file warns about elsewhere.
  const findings = contextualCarveOutFindings(REAL_MANIFEST, realParserApi, {
    ...REAL_IO,
    readText: () => "",
  });
  assert.equal(findings.length, 1);
  assert.equal(
    findings[0].includes("could not derive the contextual keywords"),
    true,
    findings.join("\n"),
  );
});

test("a missing isBuiltInName accessor is a finding, not a crash", () => {
  // Fail closed rather than throw: an implementation that stops exposing the predicate leaves the
  // carve-outs' actual claim unchecked, and a stack trace out of the gate reads like a broken gate
  // rather than the unchecked direction it is.
  const findings = contextualCarveOutFindings(REAL_MANIFEST, {}, REAL_IO);
  assert.deepEqual(findings, [
    "the implementation exposes no isBuiltInName accessor, so the claim each contextual carve-out makes — structural by position, and yet NOT a built-in name — cannot be checked against it",
  ]);
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

// ---------------------------------------------------------------------------------------------
// Round 9: cardinality, and one registry's two accessors agreeing.
//
// Every check below kills a mutation that was measured LIVE on the previous revision — a check
// whose mutation was never run is a check being hoped about.
// ---------------------------------------------------------------------------------------------

test("duplicatedNames reports each repeat once, in first-appearance order", () => {
  assert.deepEqual(duplicatedNames(["a", "b", "a", "c", "b", "a"]), ["a", "b"]);
  assert.deepEqual(duplicatedNames(["a", "b"]), []);
  assert.deepEqual(duplicatedNames([]), []);
});

test("INJECTED DRIFT: a lookup that still answers while its enumerator dropped the name", () => {
  // Measured green before this check existed: `corePrimitiveArity("print")` resolved, so
  // entryFindings matched; the sweep and implementationFindings walk the enumerator, so neither
  // saw an absence. One registry, two sources, no comparison between them.
  const api = {
    ...realParserApi,
    profilePrimitiveNames: (profile) =>
      realParserApi
        .profilePrimitiveNames(profile)
        .filter((name) => !(profile === "core-language" && name === "print")),
  };
  assert.equal(realParserApi.corePrimitiveArity("print") !== undefined, true);
  assert.equal(
    api.profilePrimitiveNames("core-language").includes("print"),
    false,
  );
  const findings = directionAgreementFindings(REAL_MANIFEST, api);
  assert.deepEqual(findings, [
    "print: registry core-primitive's lookup (corePrimitiveArity) holds it but its enumerator (profilePrimitiveNames) does not list it — one registry's two directions disagree, and every other check here reads only one of them",
  ]);
});

test("INJECTED DRIFT: an enumerator that lists a name its own lookup does not hold", () => {
  const api = {
    ...realParserApi,
    profilePrimitiveNames: (profile) =>
      profile === "sound"
        ? [...realParserApi.profilePrimitiveNames(profile), "print"]
        : realParserApi.profilePrimitiveNames(profile),
  };
  assert.equal(realParserApi.soundPrimitiveArity("print"), undefined);
  const findings = directionAgreementFindings(REAL_MANIFEST, api);
  assert.deepEqual(findings, [
    "print: registry sound-primitive's lookup (soundPrimitiveArity) does not hold it but its enumerator (profilePrimitiveNames) lists it — one registry's two directions disagree, and every other check here reads only one of them",
  ]);
});

test("agreement is unclaimed where a registry cannot be read from either side", () => {
  // Both halves of the guard, on the two shapes that produce them: an unreachable ENUMERATOR skips
  // the registry, and an unreachable LOOKUP stops it — the latter is name-independent, so it is one
  // decision for the whole registry rather than 158 identical ones.
  const noEnumerate = manifestCopy();
  noEnumerate.registries["core-primitive"].enumerate.status = "declared";
  assert.deepEqual(
    directionAgreementFindings(noEnumerate, {
      ...realParserApi,
      profilePrimitiveNames: undefined,
    }),
    [],
  );

  const noLookup = manifestCopy();
  noLookup.registries["core-primitive"].lookup.status = "declared";
  assert.deepEqual(directionAgreementFindings(noLookup, realParserApi), []);
});

test("INJECTED DRIFT: a profile enumerating primitives the manifest defines no registry tag for", () => {
  // Matching `entry.profile` alone was not enough: `fd` is already filed under `heritage` through
  // `heritage-alias`, so a bogus heritage primitive table passed every check.
  const api = {
    ...realParserApi,
    profilePrimitiveNames: (profile) =>
      profile === "heritage"
        ? ["fd"]
        : realParserApi.profilePrimitiveNames(profile),
  };
  assert.deepEqual(realParserApi.profilePrimitiveNames("heritage"), []);
  assert.equal(entryFor(REAL_MANIFEST, "fd").profile, "heritage");
  assert.deepEqual(profilePrimitiveSweepFindings(REAL_MANIFEST, api), [
    `profile heritage: profilePrimitiveNames enumerates 1 name(s) for it, but ${MANIFEST_PATH} defines no primitive registry tag for that profile — a table the file does not know about is one nothing compares`,
  ]);
});

test("INJECTED DRIFT: an enumerated primitive whose entry does not record that primitive tag", () => {
  const manifest = manifestCopy();
  const entry = entryFor(manifest, "beep");
  entry.registries = ["heritage-alias"];
  entry.profile = "sound";
  const findings = profilePrimitiveSweepFindings(manifest, realParserApi);
  assert.deepEqual(findings, [
    "beep: the sound primitive registry holds it but its entry records heritage-alias — not sound-primitive",
  ]);
});

test("INJECTED DRIFT: a duplicate registration, on every accessor kind that can hold one", () => {
  // Round 8 fixed this for `record` alone — one registry of fourteen. The other three kinds shipped
  // the same defect green, each measured at N entries / N-1 unique.
  const cases = [
    [
      "array",
      { OL_KEYWORDS: [...realParserApi.OL_KEYWORDS, "define"] },
      "define: OL_KEYWORDS lists it 2 times under core-language — every other comparison here is set-based, so a duplicate is invisible to all of them",
    ],
    [
      "enumerator",
      {
        heritageAliasNames: () => [...realParserApi.heritageAliasNames(), "fd"],
      },
      "fd: heritageAliasNames lists it 2 times under heritage — every other comparison here is set-based, so a duplicate is invisible to all of them",
    ],
    [
      "profile-enumerator",
      {
        profilePrimitiveNames: (profile) =>
          profile === "turtle-rendering"
            ? [...realParserApi.profilePrimitiveNames(profile), "forward"]
            : realParserApi.profilePrimitiveNames(profile),
      },
      "forward: profilePrimitiveNames lists it 2 times under turtle-rendering — every other comparison here is set-based, so a duplicate is invisible to all of them",
    ],
    [
      "record, same key twice",
      {
        OL_PROFILE_KEYWORDS: {
          ...realParserApi.OL_PROFILE_KEYWORDS,
          sprites: [
            ...realParserApi.OL_PROFILE_KEYWORDS.sprites,
            realParserApi.OL_PROFILE_KEYWORDS.sprites[0],
          ],
        },
      },
      `${realParserApi.OL_PROFILE_KEYWORDS.sprites[0]}: OL_PROFILE_KEYWORDS lists it 2 times under sprites — every other comparison here is set-based, so a duplicate is invisible to all of them`,
    ],
  ];
  for (const [kind, override, expected] of cases) {
    const api = { ...realParserApi, ...override };
    assert.deepEqual(
      duplicateRegistrationFindings(REAL_MANIFEST, api),
      [expected],
      kind,
    );
  }
});

test("the duplicate check skips a registry it cannot read, instead of throwing on it", () => {
  // Round 8 omitted this guard on the argument that `accessorFindings` already reports an
  // unresolvable accessor. It does — but the findings list is an EAGER array literal, so computing
  // that finding never prevented the next call dereferencing `undefined`. Both shapes below threw.
  const declared = manifestCopy();
  declared.registries["profile-reserved"].enumerate = {
    accessor: "futureProfileKeywords",
    kind: "record",
    status: "declared",
  };
  assert.deepEqual(duplicateRegistrationFindings(declared, realParserApi), []);

  for (const absent of [undefined, null]) {
    assert.deepEqual(
      duplicateRegistrationFindings(REAL_MANIFEST, {
        ...realParserApi,
        OL_PROFILE_KEYWORDS: absent,
      }),
      [],
    );
  }
});

test("an accessor exported as null reads as unreachable, not as an empty registry", () => {
  const registry = REAL_MANIFEST.registries["profile-reserved"];
  const api = { ...realParserApi, OL_PROFILE_KEYWORDS: null };
  assert.equal(registryHas(registry, api, "ask"), null);
  assert.equal(registryMembers(registry, api), null);
  // And the run reports rather than crashes.
  const result = runBuiltInNamesGate({ api });
  assert.equal(result.ok, false);
});

test("INJECTED DRIFT: a profile section spec/conformance.md names twice", () => {
  const text = REAL_IO.readText(CONFORMANCE_PATH).replace(
    "### Core Language",
    "### Core Language\n\nplaceholder\n\n### Core Language",
  );
  const io = {
    ...REAL_IO,
    readText: (path) => {
      // Pins WHICH file the check reads: another path would fail loudly here rather than quietly
      // fall through to real content and pass for the wrong reason.
      assert.equal(path, CONFORMANCE_PATH);
      return text;
    },
  };
  // The mutation must reach what the check READS, not merely change the file's text.
  assert.deepEqual(duplicatedNames(extractConformanceProfiles(text)), [
    "Core Language",
  ]);
  const findings = profileInventoryFindings(REAL_MANIFEST, realParserApi, io);
  assert.deepEqual(findings, [
    `${CONFORMANCE_PATH}: profile section(s) Core Language appear more than once — 13 sections, 12 unique`,
  ]);
});

test("INJECTED DRIFT: a control character hidden in any string value", () => {
  // The defect that shipped into a normative spec/ artefact and every gate stayed green: authoring
  // notes through a shell whose escape character is a backtick turned `note`, `aliasOf`, `reserved`
  // and `excluded` into LF, BEL, CR and ESC. Valid JSON, Prettier-clean, zero findings.
  assert.deepEqual(controlCharacterFindings(REAL_MANIFEST), []);
  const carveOutWithPositions = REAL_MANIFEST.excluded.findIndex(
    (entry) => Array.isArray(entry.positions) && entry.positions.length > 0,
  );
  for (const [path, mutate] of [
    ["about", (manifest) => (manifest.about = "x\u0007y")],
    [
      "invariants.precedence",
      (manifest) => (manifest.invariants.precedence = "a\u001bb"),
    ],
    [
      "registries.reserved.note",
      (manifest) => (manifest.registries.reserved.note = "a\u000ab"),
    ],
    [
      "excluded.0.rationale",
      (manifest) => (manifest.excluded[0].rationale = "a\u000db"),
    ],
    // Bare strings INSIDE arrays, which is where a walker that recurses into objects but never
    // visits array elements silently stops. `Object.entries` yields indexed pairs, so these are
    // reached — and `names[].registries[]` is the most load-bearing array in the file.
    [
      "names.0.registries.0",
      (manifest) => (manifest.names[0].registries[0] = "a\u0007b"),
    ],
    [
      `excluded.${carveOutWithPositions}.positions.0`,
      (manifest) =>
        (manifest.excluded[carveOutWithPositions].positions[0] = "a\u0007b"),
    ],
    // `Cc` is wider than C0: DEL and the C1 block are control characters too, and the finding says
    // "control character" without qualification.
    ["about", (manifest) => (manifest.about = "x\u007fy")],
    ["about", (manifest) => (manifest.about = "x\u0085y")],
  ]) {
    const manifest = manifestCopy();
    mutate(manifest);
    const findings = controlCharacterFindings(manifest);
    assert.equal(findings.length, 1, path);
    assert.equal(
      findings[0].startsWith(
        `${MANIFEST_PATH}: ${path} contains control character(s)`,
      ),
      true,
      findings[0],
    );
    // And it reaches the run, not just the helper.
    assert.equal(runBuiltInNamesGate({ manifest }).ok, false, path);
  }
});

test("INJECTED DRIFT: a registry note naming any accessor the manifest declares", () => {
  // `about` forbids a note restating data the file carries. This is the derivable half, compared
  // against the accessor values the file itself carries, so there is no word list to maintain.
  assert.deepEqual(noteRestatementFindings(REAL_MANIFEST), []);
  const own = manifestCopy();
  own.registries.reserved.note = `The tree's accessor is ${own.registries.reserved.lookup.accessor}.`;
  assert.deepEqual(noteRestatementFindings(own), [
    `${MANIFEST_PATH}: registries.reserved.note names the accessor(s) OL_KEYWORDS — the value is carried structurally, so the prose is a second copy that the next rename drifts`,
  ]);

  // A FOREIGN accessor is exactly as much "a second copy that the next rename drifts", so the
  // comparison is manifest-wide rather than per-tag. Scoping it to the tag's own accessors bought
  // nothing: the whole set is equally derived from the file, with no list to maintain either way.
  const foreign = manifestCopy();
  foreign.registries["data-primitive"].note =
    "It behaves like OL_KEYWORDS in this respect.";
  assert.deepEqual(noteRestatementFindings(foreign), [
    `${MANIFEST_PATH}: registries.data-primitive.note names the accessor(s) OL_KEYWORDS — the value is carried structurally, so the prose is a second copy that the next rename drifts`,
  ]);

  // Edge accessors count too, and a note may echo more than one.
  const alias = manifestCopy();
  const registry = alias.registries["heritage-alias"];
  registry.note = `${registry.aliasEnumerator} and ${registry.canonicalAccessor} carry the edge.`;
  assert.deepEqual(noteRestatementFindings(alias), [
    `${MANIFEST_PATH}: registries.heritage-alias.note names the accessor(s) ${registry.aliasEnumerator}, ${registry.canonicalAccessor} — the value is carried structurally, so the prose is a second copy that the next rename drifts`,
  ]);

  // A note that is not a string is the presence check's business, not this one's.
  const absent = manifestCopy();
  absent.registries.reserved.note = undefined;
  assert.deepEqual(noteRestatementFindings(absent), []);
});

test("a note containing a count passes the gate, and `about` does not claim it is caught", () => {
  // Round 4 shipped `about` enumerating "no counting word" among the checks the gate applies, in
  // the same PR as the docstring saying that half is deliberately unenforced. A count in a note
  // passes; the file must not say otherwise.
  const counted = manifestCopy();
  counted.registries["data-primitive"].note = "There are three of them.";
  assert.deepEqual(runBuiltInNamesGate({ manifest: counted }).findings, []);

  // That empty result has to mean "checked and clean", not "nothing checked". An absence assertion
  // cannot tell those apart on its own — it survives a gate whose every check returns `[]`, which
  // is how this test read before. Proving the same note reds when it carries a control character
  // makes the emptiness above discriminating.
  const live = manifestCopy();
  live.registries["data-primitive"].note = "There are three of them.\u0007";
  assert.equal(runBuiltInNamesGate({ manifest: live }).ok, false);

  // The exact round-4 phrasing cannot return, and the honest limit is stated.
  assert.equal(/and no counting word/.test(REAL_MANIFEST.about), false);
  assert.equal(
    REAL_MANIFEST.about.includes("deliberately NOT checked"),
    true,
    REAL_MANIFEST.about,
  );
});

test("INJECTED DRIFT: a declared-empty profile whose rationale is blanked to whitespace", () => {
  // `reason.length` is satisfied by "   ", so the gate asserted a reason it did not check — the
  // same data-shaped off switch as `row.includes("")`.
  const manifest = manifestCopy();
  const profile = Object.keys(manifest.profilesWithoutPrimitives)[0];
  manifest.profilesWithoutPrimitives[profile] = "   ";
  assert.deepEqual(profileCoverageFindings(manifest, realParserApi), [
    `profile ${profile}: ships no primitive entry and is not declared in profilesWithoutPrimitives with a reason`,
  ]);
});

// ---------------------------------------------------------------------------------------------
// Round 10: the remaining set-valued lists, accessor SHAPE, and canonical spelling.
// ---------------------------------------------------------------------------------------------

test("INJECTED DRIFT: cardinality on the three set-valued lists that were still uncounted", () => {
  const withRepeatedTag = manifestCopy();
  const entry = entryFor(withRepeatedTag, "print");
  entry.registries = [...entry.registries, entry.registries[0]];
  assert.deepEqual(entryFindings(withRepeatedTag, realParserApi), [
    "print: records registry core-primitive more than once — 2 entries, 1 unique; the set comparison below cannot see the difference",
  ]);

  const withRepeatedPosition = manifestCopy();
  const carveOut = withRepeatedPosition.excluded.find(
    (candidate) => candidate.reason === "contextual-keyword",
  );
  carveOut.positions = [...carveOut.positions, carveOut.positions[0]];
  assert.equal(
    carveOutFindings(withRepeatedPosition, REAL_IO).includes(
      `excluded ${carveOut.name}: position(s) ${carveOut.positions[0]} recorded more than once — 2 entries, 1 unique`,
    ),
    true,
  );

  const repeatedProfiles = [
    ...realParserApi.OL_CHECK_PROFILES,
    "core-language",
  ];
  assert.equal(
    profileInventoryFindings(
      REAL_MANIFEST,
      { ...realParserApi, OL_CHECK_PROFILES: repeatedProfiles },
      REAL_IO,
    ).includes(
      `OL_CHECK_PROFILES lists core-language more than once — ${repeatedProfiles.length} entries, ${new Set(repeatedProfiles).size} unique`,
    ),
    true,
  );
});

test("INJECTED DRIFT: two profile ids claiming one display name", () => {
  // `profiles.ids` is a Record, so a duplicate KEY is inexpressible — but two ids mapping to one
  // name collapses the section comparison, which is a set comparison on the values.
  const manifest = manifestCopy();
  const [first, second] = Object.keys(manifest.profiles.ids);
  manifest.profiles.ids[second] = manifest.profiles.ids[first];
  assert.equal(
    profileInventoryFindings(manifest, realParserApi, REAL_IO).includes(
      `${MANIFEST_PATH}: profile name(s) ${manifest.profiles.ids[first]} are claimed by more than one id — a profile has one name`,
    ),
    true,
  );
});

test("an accessor's SHAPE is checked, not merely its presence", () => {
  assert.equal(hasAccessorShape([], "array"), true);
  assert.equal(hasAccessorShape({}, "array"), false);
  assert.equal(hasAccessorShape({}, "record"), true);
  assert.equal(hasAccessorShape([], "record"), false);
  assert.equal(hasAccessorShape(null, "record"), false);
  for (const kind of ["arity", "enumerator", "profile-enumerator"]) {
    // An imported function rather than a fresh arrow: `hasAccessorShape` only inspects the type and
    // never calls it, so a literal here would be an uninvoked function this file declares — the
    // Node 22 coverage gate counts those, and rightly.
    assert.equal(hasAccessorShape(duplicatedNames, kind), true);
    assert.equal(hasAccessorShape(null, kind), false);
  }
  // An unknown kind has no verifiable shape, so nothing is assumed usable and consumers skip it
  // rather than calling it.
  assert.equal(hasAccessorShape(null, "not-a-kind"), false);
  assert.equal(hasAccessorShape(duplicatedNames, "not-a-kind"), false);

  assert.equal(describeAccessor(null), "exported as null");
  assert.equal(describeAccessor([]), "an array");
  assert.equal(describeAccessor({}), "an object");
  assert.equal(describeAccessor(7), "a number");
});

test("INJECTED DRIFT: an export of the wrong shape is a finding, and never a crash", () => {
  // Measured before this landed: `corePrimitiveArity: null` reported ZERO findings, while
  // `profilePrimitiveNames: null` and `canonicalOfTurtleAlias: null` threw TypeErrors from
  // consumers that call them directly. One broken export, three outcomes, no clear finding.
  const shapes = [
    [
      "corePrimitiveArity",
      null,
      'registry core-primitive.lookup: corePrimitiveArity is declared "present" with kind "arity", but it is exported as null rather than a function',
    ],
    [
      "OL_KEYWORDS",
      null,
      'registry reserved.lookup: OL_KEYWORDS is declared "present" with kind "array", but it is exported as null rather than an array',
    ],
    [
      "OL_KEYWORDS",
      {},
      'registry reserved.lookup: OL_KEYWORDS is declared "present" with kind "array", but it is an object rather than an array',
    ],
    [
      "OL_PROFILE_KEYWORDS",
      [],
      'registry profile-reserved.lookup: OL_PROFILE_KEYWORDS is declared "present" with kind "record", but it is an array rather than an object keyed by profile',
    ],
    [
      "heritageAliasNames",
      null,
      'registry heritage-alias.lookup: heritageAliasNames is declared "present" with kind "enumerator", but it is exported as null rather than a function',
    ],
  ];
  for (const [accessor, value, expected] of shapes) {
    const result = runBuiltInNamesGate({
      api: { ...realParserApi, [accessor]: value },
    });
    assert.equal(result.ok, false, `${accessor} = ${JSON.stringify(value)}`);
    assert.equal(
      result.findings.includes(expected),
      true,
      result.findings.join("\n"),
    );
  }
});

test("INJECTED DRIFT: a non-canonical name both sides agree on", () => {
  // The hole every membership comparison here shares: agreement is not correctness when both sides
  // can move together. `spec/grammar.md` permits lowercase ASCII only.
  assert.deepEqual(
    ["abs", "set_xy", "empty?", "clear_screen"].filter(
      (name) => !isCanonicalName(name),
    ),
    [],
  );
  assert.deepEqual(
    ["ABS", "1x", "set-xy", "", "Forward"].filter(isCanonicalName),
    [],
  );

  const manifest = manifestCopy();
  entryFor(manifest, "abs").name = "ABS";
  const api = {
    ...realParserApi,
    corePrimitiveArity: (name) =>
      realParserApi.corePrimitiveArity(name === "ABS" ? "abs" : name),
    profilePrimitiveNames: (profile) =>
      realParserApi
        .profilePrimitiveNames(profile)
        .map((name) => (name === "abs" ? "ABS" : name)),
  };
  // Both sides genuinely agree — that is the point.
  assert.equal(api.corePrimitiveArity("ABS") !== undefined, true);
  assert.equal(
    api.profilePrimitiveNames("core-language").includes("ABS"),
    true,
  );
  assert.equal(
    entryFindings(manifest, api).some((finding) =>
      finding.startsWith("ABS: is not a canonical OpenLogo name"),
    ),
    true,
  );
});

test("INJECTED DRIFT: a library carve-out whose name its source does not define", () => {
  // `isStdlibSource` validates the PATH and never reads the file, so the one field the carve-out is
  // about was bound to nothing: renaming it while keeping a real source shipped green.
  const renamed = manifestCopy();
  const carveOut = renamed.excluded.find(
    (candidate) => candidate.reason === "library",
  );
  const source = carveOut.source;
  const original = carveOut.name;
  carveOut.name = "zzz_not_a_real_procedure";
  assert.equal(
    carveOutFindings(renamed, REAL_IO).includes(
      `excluded zzz_not_a_real_procedure: ${source} is a real ${STDLIB_DIR} file but defines no procedure named "zzz_not_a_real_procedure" — the carve-out claims this name IS that library source, so the path alone proves nothing`,
    ),
    true,
  );

  // And the other direction: the source stops defining the name it is carved out for.
  const text = REAL_IO.readText(source).replace(
    `define ${original}`,
    "define zzz_other",
  );
  assert.equal(definesProcedure(REAL_IO.readText(source), original), true);
  assert.equal(definesProcedure(text, original), false);
});

test("INJECTED DRIFT: a carve-out spelled non-canonically", () => {
  const manifest = manifestCopy();
  manifest.excluded[0].name = "Polygon";
  assert.equal(
    carveOutFindings(manifest, REAL_IO).includes(
      "excluded Polygon: is not a canonical OpenLogo name — spec/grammar.md:15's ASCII core form is `[a-z_][a-z0-9_]*[?!]?`, and built-in keywords and primitives are lowercase ASCII",
    ),
    true,
  );
});

test("a registry missing EITHER role is reported, and read as unreachable rather than dereferenced", () => {
  // The earlier version of this test deleted only `lookup` while its title said "a whole role" —
  // a title claiming more than its body. Deleting `enumerate` crashed.
  for (const role of ["lookup", "enumerate"]) {
    const manifest = manifestCopy();
    const registry = manifest.registries["core-primitive"];
    registry[role] = undefined;
    assert.equal(
      role === "lookup"
        ? registryHas(registry, realParserApi, "print")
        : registryMembers(registry, realParserApi),
      null,
      role,
    );
    const result = runBuiltInNamesGate({ manifest });
    assert.equal(result.ok, false, role);
    assert.equal(
      result.findings.includes(
        `registry core-primitive: no ${role} accessor — each tag must name both, because the two comparison directions need different shapes`,
      ),
      true,
      result.findings.join("\n"),
    );
  }
});

test("INJECTED DRIFT: a registry profile that is not one of the manifest's own profile ids", () => {
  // Most tags are caught incidentally, through an entry whose derived profile stops matching. The
  // two Heritage form-head tags currently win precedence for no entry, so nothing read their
  // `profile` and any value passed — a check that looks universal but is conditional on data.
  for (const tag of [
    "heritage-form-head",
    "heritage-worded-form-head",
    "reserved",
  ]) {
    const manifest = manifestCopy();
    manifest.registries[tag].profile = "zzz-not-a-profile";
    const result = runBuiltInNamesGate({ manifest });
    assert.equal(result.ok, false, tag);
    assert.equal(
      result.findings.some((finding) =>
        finding.startsWith(
          `registry ${tag}: profile "zzz-not-a-profile" is not one of the ids in profiles.ids`,
        ),
      ),
      true,
      result.findings.join("\n"),
    );
  }
  // A valid id that is simply the wrong one is equally invisible without this check.
  const wrong = manifestCopy();
  wrong.registries["heritage-form-head"].profile = "geometry";
  assert.deepEqual(
    accessorFindings(wrong, realParserApi),
    [],
    "a real id passes the vocabulary check — that limit is deliberate and stated",
  );

  // Only a Record registry may omit `profile`, because it supplies one per key. Any other tag with
  // no profile has no source for it at all.
  const noProfile = manifestCopy();
  noProfile.registries["heritage-form-head"].profile = undefined;
  assert.deepEqual(accessorFindings(noProfile, realParserApi), [
    "registry heritage-form-head: no profile, and its enumerate kind is not `record` — only a Record registry supplies a profile per key, so this tag has no profile source at all",
  ]);
  // The one that legitimately has none stays quiet.
  assert.equal(REAL_MANIFEST.registries["profile-reserved"].profile, undefined);
  assert.deepEqual(accessorFindings(REAL_MANIFEST, realParserApi), []);
});

test("INJECTED DRIFT: a registry note deleted, not merely blanked", () => {
  // Gating only notes that are present left all of them deletable. Every registry carries one now,
  // so there is no optional case and no count of the exceptions.
  assert.equal(
    Object.values(REAL_MANIFEST.registries).every(
      (registry) => typeof registry.note === "string",
    ),
    true,
  );
  const manifest = manifestCopy();
  manifest.registries.reserved.note = undefined;
  assert.deepEqual(narrativeFindings(manifest), [
    `${MANIFEST_PATH}: registries.reserved.note is missing or empty — this file is normative, and a claim it makes about itself that nothing states cannot be reviewed`,
  ]);
});

test("codeOnly blanks comments and string literals, and keeps the line count", () => {
  const triple = '"""';
  const cases = [
    ["# define arc\n", false],
    ["// define arc\n", false],
    ["/* define arc */\n", false],
    ["/* define arc */\ndefine arc :a", true],
    [`:d = ${triple}\ndefine arc\n${triple}\n`, false],
    [`:d = ${triple}\nx\n${triple}\ndefine arc :a`, true],
    // A comment marker inside a string is literal text (spec/grammar.md:32) …
    ['print "# not a comment"\ndefine arc :a', true],
    // … and a quote inside a comment does not open a string.
    [`# see ${triple} below\ndefine arc :a`, true],
    // An escaped delimiter does not close the literal it sits in — single-line …
    ['print "a \\" define arc"\n', false],
    // … and multi-line, which is the case the earlier comment claimed and did not exercise.
    [`:d = ${triple}\n\\${triple} define arc\n${triple}\n`, false],
    [`:d = ${triple}\n\\${triple} x\n${triple}\ndefine arc :a`, true],
    // Unterminated constructs swallow the rest, which fails closed.
    [`:d = ${triple}\ndefine arc\n`, false],
    ["/* x\ndefine arc\n", false],
  ];
  for (const [source, expected] of cases) {
    assert.equal(definesProcedure(source, "arc"), expected, source);
    assert.equal(
      codeOnly(source).split("\n").length,
      source.split("\n").length,
      `line count preserved: ${source}`,
    );
  }
});

test("definesProcedure reads a Core define header, and only that", () => {
  assert.equal(definesProcedure("define arc :angle :radius\nend", "arc"), true);
  assert.equal(definesProcedure("  define arc :a\nend", "arc"), true);
  // A Heritage `to` header does not satisfy it — stdlib/ is Core-profile source.
  assert.equal(definesProcedure("to arc :a\nend", "arc"), false);
  // Not a prefix match, and not a call site.
  assert.equal(definesProcedure("define arcs :a\nend", "arc"), false);
  assert.equal(definesProcedure("arc 90 10", "arc"), false);
  assert.equal(definesProcedure(undefined, "arc"), false);
});

test("INJECTED DRIFT: a define header that is only prose inside a multi-line string literal", () => {
  // `"""…"""` is a real OpenLogo literal (spec/grammar.md:19), so a header written inside one is
  // documentation, not a declaration. Scanning raw lines read it as source.
  const documented = ':doc = """\ndefine arc :angle :radius\n"""\n';
  assert.equal(definesProcedure(documented, "arc"), false);
  // The real header outside the literal still counts.
  assert.equal(
    definesProcedure(`${documented}define arc :a\nend`, "arc"),
    true,
  );
});

test("INJECTED DRIFT: an alias enumerator listing one name twice", () => {
  const api = {
    ...realParserApi,
    turtleAliasNames: () => [...realParserApi.turtleAliasNames(), "setxy"],
  };
  assert.equal(api.turtleAliasNames().length, 6);
  assert.equal(new Set(api.turtleAliasNames()).size, 5);
  assert.equal(
    aliasFindings(REAL_MANIFEST, api).includes(
      "turtleAliasNames lists setxy more than once — 6 entries, 5 unique",
    ),
    true,
  );
});

test("INJECTED DRIFT: an accessor kind this module does not know is a finding, never a crash", () => {
  // `hasAccessorShape` used to answer `true` for an unknown kind, so `registryHas` fell to its
  // default arm and called whatever was there. Three of four registries threw, replacing
  // `accessorFindings`' own correct vocabulary finding with a stack trace.
  for (const [tag, role] of [
    ["reserved", "lookup"],
    ["profile-reserved", "lookup"],
    ["core-primitive", "lookup"],
    ["heritage-alias", "enumerate"],
  ]) {
    const manifest = manifestCopy();
    manifest.registries[tag][role].kind = "typo-kind";
    const result = runBuiltInNamesGate({ manifest });
    assert.equal(result.ok, false, `${tag}.${role}`);
    assert.equal(
      result.findings.includes(
        `registry ${tag}.${role}: kind "typo-kind" is outside the closed vocabulary [${ACCESSOR_KINDS.join(", ")}]`,
      ),
      true,
      result.findings.join("\n"),
    );
  }
});

test("precedence is two-level: category first, then the declared key order within a category", () => {
  // `invariants.precedence` states both halves, and both are load-bearing on the shipped tree:
  // `thing` is decided by category; the five Heritage-spelled keywords by key order.
  assert.equal(entryFor(REAL_MANIFEST, "thing").category, "keyword");
  assert.deepEqual(entryFor(REAL_MANIFEST, "thing").registries, [
    "reserved",
    "core-primitive",
  ]);
  for (const name of ["to", "make", "op", "output", "value"]) {
    const entry = entryFor(REAL_MANIFEST, name);
    assert.equal(entry.category, "keyword", name);
    assert.equal(entry.profile, "core-language", name);
  }

  // Category beats key order: reordering so the primitive tag comes first must NOT reclassify.
  const moveFirst = (manifest, tag) => {
    const { [tag]: moved, ...rest } = manifest.registries;
    manifest.registries = { [tag]: moved, ...rest };
    return manifest;
  };
  const reordered = moveFirst(manifestCopy(), "core-primitive");
  assert.equal(Object.keys(reordered.registries)[0], "core-primitive");
  assert.deepEqual(entryFindings(reordered, realParserApi), []);

  // Key order decides among same-category tags: putting the Heritage keyword registry first
  // re-files the Heritage-spelled keywords, so the manifest's own `profile` becomes wrong.
  const heritageFirst = moveFirst(manifestCopy(), "heritage-form-head");
  assert.equal(Object.keys(heritageFirst.registries)[0], "heritage-form-head");
  assert.equal(
    entryFindings(heritageFirst, realParserApi).some((finding) =>
      finding.startsWith('to: profile "core-language"'),
    ),
    true,
  );
});

test("one registry's two alias accessors disagreeing is reported exactly once", () => {
  // Both loops used to fire, producing two findings differing only in wording. The reverse loop
  // walks a universe containing every manifest entry, so it already sees everything the forward
  // loop could — the forward loop's copy was redundant, not additive.
  const api = {
    ...realParserApi,
    turtleAliasNames: () =>
      realParserApi.turtleAliasNames().filter((name) => name !== "setxy"),
  };
  const disagreements = aliasFindings(REAL_MANIFEST, api).filter(
    (finding) => finding.startsWith("setxy:") && finding.includes("disagree"),
  );
  assert.deepEqual(disagreements, [
    "setxy: canonicalOfTurtleAlias resolves an edge for it but turtleAliasNames does not list it — the registry's two accessors disagree",
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
        `${TOOLING_PATH}: the C19 mirror (43 words) does not carry the same words in the same order`,
      ),
    ),
    true,
    findings.join("\n"),
  );
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
      // Since issue #964 the relabel is caught from a third direction as well: `spec/grammar.md`
      // closes the contextual set at four words, so relabelling a seventh name into it is drift
      // whatever its positions say. The escape route this test names is now shut from both ends —
      // the stdlib walk notices `arc` lost its library carve-out, and this notices it gained a
      // contextual one it is not entitled to.
      `excluded arc: reason "contextual-keyword" but ${GRAMMAR_PATH} does not name it among the contextual keywords, which it declares to be exactly "empty", "member", "of", "a"`,
    ],
  );
  assert.equal(
    result.findings.some((finding) => finding.includes('defines "arc" but')),
    true,
    "the stdlib walk must also notice the library carve-out disappeared",
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
    `${MANIFEST_PATH}: about is missing or empty — this file is normative, and a claim it makes about itself that nothing states cannot be reviewed`,
    `${MANIFEST_PATH}: invariants.precedence is missing or empty — this file is normative, and a claim it makes about itself that nothing states cannot be reviewed`,
  ]);
});

test("INJECTED DRIFT: a registry's alias enumerator and resolver disagreeing with each other", () => {
  // Measured live: making `turtleAliasNames()` omit `setxy` while `canonicalOfTurtleAlias("setxy")`
  // still resolved was GREEN — the forward loop asks only the resolver, the reverse loop walks only
  // the enumerator, so the two accessors could contradict each other unobserved. The forward loop's
  // copy of this check has since been removed as redundant; the reverse loop's universe already
  // contains every manifest entry, and reporting it twice in two wordings helped nobody.
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
      "setxy: canonicalOfTurtleAlias resolves an edge for it but turtleAliasNames does not list it — the registry's two accessors disagree",
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

test("INJECTED DRIFT: narrative fields blanked with a single space, including a registry note", () => {
  const manifest = manifestCopy();
  manifest.about = " ";
  manifest.invariants.bothDirections = " ";
  manifest.tokenClassKeyword.rowFingerprintReason = " ";
  manifest.profiles.about = " ";
  manifest.registries.reserved.note = " ";
  const findings = narrativeFindings(manifest);
  assert.deepEqual(findings, [
    `${MANIFEST_PATH}: about is missing or empty — this file is normative, and a claim it makes about itself that nothing states cannot be reviewed`,
    `${MANIFEST_PATH}: profiles.about is missing or empty — this file is normative, and a claim it makes about itself that nothing states cannot be reviewed`,
    `${MANIFEST_PATH}: invariants.bothDirections is missing or empty — this file is normative, and a claim it makes about itself that nothing states cannot be reviewed`,
    `${MANIFEST_PATH}: tokenClassKeyword.rowFingerprintReason is missing or empty — this file is normative, and a claim it makes about itself that nothing states cannot be reviewed`,
    `${MANIFEST_PATH}: registries.reserved.note is missing or empty — this file is normative, and a claim it makes about itself that nothing states cannot be reviewed`,
  ]);
});

test("INJECTED DRIFT: any edit to the token-class row is detected, and a non-digest is a finding", () => {
  // The change detector's whole contract. It kills every mutation both reviewers raised across six
  // rounds — including several they and I had declined as illustrative prose, and a whitespace-only
  // edit no clause anchor could have caught — because it reads the row's bytes and nothing else.
  // What it does NOT do is say whether the new row is correct; see rowFingerprintFindings.
  for (const [label, from, to] of [
    ["polarity inverted", "are **not** in this class", "are in this class"],
    [
      "profile activation qualifier removed",
      "while their profile is active,",
      "whether or not their profile is active,",
    ],
    [
      "delta counts drift",
      "it omits four reserved words",
      "it omits five reserved words",
    ],
    [
      "independence claim inverted",
      "This class is **not derived from**",
      "This class is **derived from**",
    ],
    [
      "paint independence inverted",
      "membership never decides how a token is painted",
      "membership always decides how a token is painted",
    ],
    [
      "a member removed from the enumeration",
      "`struct`, `alias`, `import`, `export`;",
      "`struct`, `alias`, `import`;",
    ],
    [
      "a non-member added to the enumeration",
      "`struct`, `alias`, `import`, `export`;",
      "`struct`, `alias`, `import`, `export`, `polygon`;",
    ],
    [
      "a whitespace-only edit",
      "The word-spelled operators",
      "The  word-spelled operators",
    ],
  ]) {
    const io = proseIo(TOOLING_PATH, (text) => {
      assert.equal(text.includes(from), true, `${label}: needle absent`);
      return text.replace(from, to);
    });
    const findings = proseFindings(REAL_MANIFEST, io);
    assert.equal(
      findings.some((finding) =>
        finding.includes("token-class row has changed"),
      ),
      true,
      `${label} survived: ${findings.join("\n")}`,
    );
  }
  // And the digest itself must be a digest: a missing or malformed one leaves the row unwatched.
  for (const value of [undefined, "", "   ", "nope", "ABC123"]) {
    assert.deepEqual(
      rowFingerprintFindings(
        { tokenClassKeyword: { rowFingerprint: value } },
        "x",
      ),
      [
        `${MANIFEST_PATH}: tokenClassKeyword.rowFingerprint is not a sha256 digest — without it a change to the token-class row passes unseen`,
      ],
    );
  }
});

test("the token-class failure states what it does NOT guarantee", () => {
  // The honest half. A change detector whose message implies it verified correctness is the
  // overstatement this surface produced three times; the message has to carry its own limit.
  const findings = rowFingerprintFindings(REAL_MANIFEST, "| `keyword` | x |");
  assert.equal(findings.length, 1);
  assert.equal(
    findings[0].includes("Nothing here verifies the new row is CORRECT"),
    true,
  );
  assert.equal(
    findings[0].includes("maintainer-reviewed under CODEOWNERS"),
    true,
  );
  assert.equal(findings[0].includes("Re-derive the token class"), true);
});

test("INJECTED DRIFT: a name a Record registry lists under two profiles at once", () => {
  // `registryMembers` flattens a Record into a Map, which is last-write-wins, so a name under two
  // profiles collapsed silently and every entry still matched — the flattened map only remembered
  // one owner. Found by attacking the part that had been clean for six rounds.
  const api = {
    ...realParserApi,
    OL_PROFILE_KEYWORDS: {
      ...realParserApi.OL_PROFILE_KEYWORDS,
      sprites: [...realParserApi.OL_PROFILE_KEYWORDS.sprites, "when"],
    },
  };
  assert.equal(api.OL_PROFILE_KEYWORDS.sprites.includes("when"), true);
  assert.equal(
    api.OL_PROFILE_KEYWORDS["interaction-events"].includes("when"),
    true,
  );
  const result = runBuiltInNamesGate({ api });
  assert.equal(result.ok, false);
  assert.equal(
    result.findings.includes(
      "when: OL_PROFILE_KEYWORDS lists it under sprites and interaction-events — a name has one owning profile, and flattening two of them keeps only the last",
    ),
    true,
    result.findings.join("\n"),
  );
});

test("INJECTED DRIFT: a keyword duplicated in BOTH normative lists at once", () => {
  // `missing`/`extra` are set semantics and the mirror compares joined strings, so duplicating a
  // word in the grammar block AND the C19 mirror satisfied all three checks: the normative keyword
  // list shipped 45 entries with 44 unique and the gate said nothing. That is this module's own
  // founding defect with the opposite sign — the mirror silently standing at 43 words.
  const grammar = REAL_IO.readText(GRAMMAR_PATH).replace(
    "is between strictly",
    "is between strictly strictly",
  );
  const tooling = REAL_IO.readText(TOOLING_PATH).replace(
    "`is`, `between`, `strictly`, `struct`",
    "`is`, `between`, `strictly`, `strictly`, `struct`",
  );
  const both = {
    readText: (path) => (path === GRAMMAR_PATH ? grammar : tooling),
    exists: REAL_IO.exists,
    isStdlibFile: REAL_IO.isStdlibFile,
  };
  // Sanity: both lists really are 45-with-44-unique, or this proves nothing.
  assert.equal(extractGrammarKeywordBlock(grammar).length, 45);
  assert.equal(new Set(extractGrammarKeywordBlock(grammar)).size, 44);
  assert.equal(extractToolingC19Mirror(tooling).length, 45);
  const findings = proseFindings(REAL_MANIFEST, both);
  assert.equal(
    findings.includes(
      `${GRAMMAR_PATH}: the keyword list names strictly more than once — 45 entries, 44 unique`,
    ),
    true,
    findings.join("\n"),
  );
  assert.equal(
    findings.includes(
      `${TOOLING_PATH}: the keyword list names strictly more than once — 45 entries, 44 unique`,
    ),
    true,
    findings.join("\n"),
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
    `${TOOLING_PATH}: could not find exactly one \`keyword\` token-class row — the row this gate fingerprints has moved or been duplicated`,
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
    profiles: { ids: { "core-language": "Core Language" } },
    registries: {
      bad: {
        category: "colour",
        profile: "core-language",
        lookup: { accessor: "x", kind: "telepathy", status: "maybe" },
        enumerate: { accessor: "y", kind: "arity", status: "present" },
      },
      halfway: {
        category: "keyword",
        profile: "core-language",
        lookup: { accessor: "z", kind: "array", status: "present" },
      },
    },
  };
  const findings = accessorFindings(manifest, { y: [], z: [] });
  assert.deepEqual(findings, [
    'registry bad: category "colour" is outside the closed vocabulary [keyword, primitive]',
    'registry bad.lookup: kind "telepathy" is outside the closed vocabulary [array, record, arity, enumerator, profile-enumerator]',
    'registry bad.lookup: status "maybe" is outside the closed vocabulary [present, declared]',
    'registry bad.enumerate: y is declared "present" with kind "arity", but it is an array rather than a function',
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

test("deriveSummary puts category before key order, and uses key order within a category", () => {
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
    "registry core-primitive: names goneNames / goneCanonical for its alias edges, and at least one is not a usable export of @openlogo/parser",
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
      'excluded star: stdlib/star.logo is a real stdlib file but defines no procedure named "star" — the carve-out claims this name IS that library source, so the path alone proves nothing',
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
  assert.equal(extractToolingKeywordRow("| `primitive` | x |"), null);
  assert.equal(
    extractToolingKeywordRow("| `keyword` | x |"),
    "| `keyword` | x |",
  );
  assert.equal(
    extractToolingKeywordRow("| `keyword` | a |\n| `keyword` | b |"),
    null,
    "two rows means there is nothing unambiguous to fingerprint",
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
  // The fixture ships one stdlib procedure and its carve-out, because since issue #964 an EMPTY
  // `stdlib/` scan is itself a finding — a bijection between two empty sets would otherwise let
  // this whole-gate run pass while the check protecting the library certified its absence. It also
  // carries the two contextual carve-outs its own grammar text enumerates, for the same reason in
  // the other half: the contextual set is derived from `spec/grammar.md`'s sentence, so a fixture
  // whose grammar text names words it does not carve out is drift.
  manifest.excluded = [
    {
      name: "square",
      reason: "library",
      source: "stdlib/square.logo",
      rationale: "OpenLogo source, not a primitive",
    },
    {
      name: "empty",
      reason: "contextual-keyword",
      positions: ["is-predicate"],
      rationale: "structural by position only",
    },
    {
      name: "member",
      reason: "contextual-keyword",
      positions: ["is-predicate"],
      rationale: "structural by position only",
    },
  ];
  const io = fakeIo({
    "stdlib/square.logo": "define square :size\nend\n",
    [GRAMMAR_PATH]:
      "The normative OpenLogo keyword list is:\n\n```logo\ndefine\n```\n\nBy contrast, `empty` and `member` are **not** keywords and **not** built-in names. The contextual keywords are exactly these two.\n",
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
});
