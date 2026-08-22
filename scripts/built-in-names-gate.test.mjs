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
  corePrimitiveNames,
  dataPrimitiveNames,
  educationalPrimitiveNames,
  geometryPrimitiveNames,
  interactionPrimitiveNames,
  soundPrimitiveNames,
  spritesPrimitiveNames,
  turtlePrimitiveNames,
} from "@openlogo/parser";
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
  loadManifest,
  parseArgs,
  profileCoverageFindings,
  profileInventoryFindings,
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
      omitsKeywords: [],
      addsExcluded: [],
      addsProfileKeywords: false,
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
  };
  return { manifest, api };
}

/** An `io` port backed by an in-memory `{ path: text }` map plus an explicit existence set. */
function fakeIo(files, existing = Object.keys(files)) {
  return {
    readText: (path) => files[path],
    exists: (path) => existing.includes(path),
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

test("an unenumerable registry is reported as a limit of the run, never passed over silently", () => {
  const note = runBuiltInNamesGate().lines.find((line) =>
    line.includes("NOTE"),
  );
  assert.equal(
    note,
    "built-in-names: NOTE tutor-primitive cannot be enumerated yet, so the implementation->file direction is unchecked for names reachable only through them",
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

test("the enumerable name accessors are exported from the parser's public entry", () => {
  // Named imports rather than a loop over the namespace: these eight are the public-API addition
  // ADR-0021 §4 requires, so naming each one here is the assertion, and a missing export becomes a
  // build failure in this file rather than a runtime lookup that quietly reads `undefined`.
  for (const [name, accessor] of [
    ["corePrimitiveNames", corePrimitiveNames],
    ["turtlePrimitiveNames", turtlePrimitiveNames],
    ["dataPrimitiveNames", dataPrimitiveNames],
    ["educationalPrimitiveNames", educationalPrimitiveNames],
    ["geometryPrimitiveNames", geometryPrimitiveNames],
    ["interactionPrimitiveNames", interactionPrimitiveNames],
    ["soundPrimitiveNames", soundPrimitiveNames],
    ["spritesPrimitiveNames", spritesPrimitiveNames],
  ]) {
    assert.equal(typeof accessor, "function", name);
    assert.equal(accessor().length > 0, true, name);
  }
  // The one enumerator the manifest files as `declared`. When it appears, the manifest's status
  // must move with it — which the gate enforces, and this pins the premise.
  assert.equal(
    REAL_MANIFEST.registries["tutor-primitive"].enumerate.status,
    "declared",
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

test("INJECTED DRIFT: a turtle alias whose target has a different arity is caught", () => {
  const manifest = manifestCopy();
  entryFor(manifest, "setxy").aliasOf = "set_color";
  const result = runBuiltInNamesGate({ manifest });
  assert.equal(result.ok, false);
  assert.equal(
    result.findings.includes(
      'setxy: arity 2 but its aliasOf target "set_color" has arity 1',
    ),
    true,
    result.findings.join("\n"),
  );
});

test("INJECTED DRIFT: deleting a stdlib/*.logo file breaks the Geometry carve-out", () => {
  const manifest = manifestCopy();
  const io = {
    readText: REAL_IO.readText,
    exists: (path) =>
      path === "stdlib/geometry/polygon.logo" ? false : REAL_IO.exists(path),
  };
  const result = runBuiltInNamesGate({ manifest, io });
  assert.equal(result.ok, false);
  assert.equal(
    result.findings.includes(
      'excluded polygon: reason "library" names stdlib/geometry/polygon.logo, which does not exist — the carve-out only holds while the OpenLogo source does',
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
  const api = { ...realParserApi, tutorPrimitiveArity: () => undefined };
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

test("INJECTED DRIFT: a declared-not-yet-built accessor that quietly appears is caught", () => {
  const api = { ...realParserApi, tutorPrimitiveNames: () => ["challenge"] };
  assert.deepEqual(api.tutorPrimitiveNames(), ["challenge"]);
  const result = runBuiltInNamesGate({ api });
  assert.equal(result.ok, false);
  assert.equal(
    result.findings.includes(
      `registry tutor-primitive.enumerate: tutorPrimitiveNames is declared "declared" (decided, not yet created) but now resolves — flip its status to "present" in ${MANIFEST_PATH}`,
    ),
    true,
    result.findings.join("\n"),
  );
});

test("INJECTED DRIFT: an accessor that stops being exported is caught", () => {
  const api = { ...realParserApi, corePrimitiveNames: undefined };
  const result = runBuiltInNamesGate({ api });
  assert.equal(result.ok, false);
  assert.equal(
    result.findings.includes(
      'registry core-primitive.enumerate: corePrimitiveNames is declared "present" but is not exported from @openlogo/parser',
    ),
    true,
    result.findings.join("\n"),
  );
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
      `${TOOLING_PATH}: the \`keyword\` token-class row does not name mod as excluded from the class — an omission the row never mentions is indistinguishable from a forgotten member`,
    ),
    true,
    findings.join("\n"),
  );
});

test("INJECTED DRIFT: deleting the clause that admits the profile words into the token class", () => {
  const io = proseIo(TOOLING_PATH, (text) =>
    text.replace(
      "the profile block-heads together with the Sprites mode-switch command `tell`",
      "the profile words",
    ),
  );
  const findings = proseFindings(REAL_MANIFEST, io);
  assert.equal(
    findings.some((finding) =>
      finding.includes("the clause that admits the 7 profile words"),
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
    `${TOOLING_PATH}: could not find the \`keyword\` token-class row — the anchor this gate reads has moved`,
  ]);
});

// ---------------------------------------------------------------------------------------------
// Unit coverage of each check's own branches.
// ---------------------------------------------------------------------------------------------

test("the closed vocabularies are the ones ADR-0021 states", () => {
  assert.deepEqual(ACCESSOR_STATUSES, ["present", "declared"]);
  assert.deepEqual(ACCESSOR_KINDS, ["array", "record", "arity", "enumerator"]);
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
    'registry bad.lookup: kind "telepathy" is outside the closed vocabulary [array, record, arity, enumerator]',
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
  };
  const at = (kind, accessor, status = "present") => ({
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

test("aliasFindings rejects a dangling target and an uncheckable edge", () => {
  const { manifest, api } = tinyFixture();
  entryFor(manifest, "print").aliasOf = "nowhere";
  entryFor(manifest, "define").aliasOf = "print";
  assert.deepEqual(aliasFindings(manifest, api), [
    `define: aliasOf "print" but the two share no registry, so the edge cannot be checked at all`,
    `print: aliasOf "nowhere" is not an entry in ${MANIFEST_PATH}`,
  ]);
});

test("aliasFindings leaves an edge alone when the shared registry cannot report arity", () => {
  const { manifest, api } = tinyFixture();
  api.WORDS = ["define", "end"];
  manifest.names.push({
    name: "end",
    category: "keyword",
    profile: "core-language",
    registries: ["reserved"],
    aliasOf: "define",
  });
  assert.deepEqual(aliasFindings(manifest, api), []);
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

test("proseFindings rejects a profile-word clause the manifest forgot to record", () => {
  const manifest = manifestCopy();
  manifest.tokenClassKeyword.addsProfileKeywordsPhrase = "";
  const findings = proseFindings(manifest, REAL_IO);
  assert.equal(
    findings.includes(
      `${MANIFEST_PATH}: tokenClassKeyword.addsProfileKeywords is true but no addsProfileKeywordsPhrase records the clause the row must carry`,
    ),
    true,
    findings.join("\n"),
  );
});

test("proseFindings skips the profile-word clause when the class does not add them", () => {
  const manifest = manifestCopy();
  manifest.tokenClassKeyword.addsProfileKeywords = false;
  assert.deepEqual(proseFindings(manifest, REAL_IO), []);
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
      "x this is the C19 registry repeated y:\n\n`define`.\n\n| `keyword` | `define` |\n",
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
