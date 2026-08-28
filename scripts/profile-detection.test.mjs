// Reachability + exhaustiveness tests for scripts/profile-detection.mjs (issue #701).
//
// `detectUsedProfiles` attributes optional-profile usage by AST SHAPE (node kinds, `form`/`keyword`
// discriminants) and by callee NAME. Both keying strategies fail *silently*: when the AST changes
// underneath a rule the rule simply stops matching, the program is no longer attributed to its
// profile, and nothing turns red. That already happened once — issue #151, where Heritage `make`
// began parsing as `Assign{form:"make"}` instead of a `Call` — and it had to be fixed in the same PR
// by hand, because no test asked the question.
//
// Measured on the parent commit, deleting one entry from a detection table left
// `node --test scripts/check-examples.test.mjs scripts/check-markdown-examples.test.mjs` GREEN for
// 25 of the 46 entries probed: over half the detector's rules could stop matching in silence.
//
// These tests close that class rather than one instance:
//
//   (A) REACHABILITY — every probe below must still be attributed to its profile. A rule that stops
//       matching fails here, loudly, naming the rule.
//   (B) EXHAUSTIVENESS — the probe set is checked against the LIVE tables in both directions, so a
//       name added to a table without a probe fails, and a probe left behind for a deleted entry
//       fails too. The probe list cannot drift away from what it is supposed to cover.
//   (C) DAG COVERAGE — every optional profile in `PROFILE_DEPS` is reached by at least one probe, so
//       a profile added to the spec's DAG with no detection rule at all fails here.

import assert from "node:assert/strict";
import { test } from "node:test";
import { PROFILE_DEPS } from "./harness/index.mjs";
import {
  AST_SHAPE_RULE_IDS,
  PROFILE_DETECTION_TABLES,
  detectUsedProfiles,
} from "./profile-detection.mjs";

/**
 * The tables whose entries are enumerable names, each paired with the id prefix its probes carry —
 * taken straight from `scripts/profile-detection.mjs`'s own export, never re-listed here. A local
 * copy could drift from the module it is supposed to police, which is the very failure mode these
 * tests exist to catch.
 */
const NAME_TABLES = PROFILE_DETECTION_TABLES;

/** A minimal source per Heritage short alias, since they differ in arity/position. */
const HERITAGE_ALIAS_SOURCES = {
  fd: "fd 1",
  bk: "bk 1",
  lt: "lt 1",
  rt: "rt 1",
  pu: "pu",
  pd: "pd",
  st: "st",
  ht: "ht",
  cs: "cs",
  pr: "pr 1",
  bf: "print bf [1 2]",
  bl: "print bl [1 2]",
  se: "print se 1 2",
};

/**
 * One probe per detection rule: the minimal source that exercises it, and the profile(s) that
 * source must be attributed to. `id` is `<TABLE_NAME>:<entry>` for a table entry, or the rule id
 * from {@link AST_SHAPE_RULE_IDS} for a shape rule.
 */
const PROBES = [
  // --- SOUND_CALLEE_NAMES -----------------------------------------------------------------------
  ...["note", "play", "beep", "rest", "set_tempo"].map((name) => ({
    id: `SOUND_CALLEE_NAMES:${name}`,
    source: `${name} 1`,
    profiles: ["sound"],
  })),
  // --- INTERACTION_EVENTS_CALLEE_NAMES ----------------------------------------------------------
  {
    id: "INTERACTION_EVENTS_CALLEE_NAMES:input",
    source: `print input "name"`,
    profiles: ["interaction-events"],
  },
  {
    id: "INTERACTION_EVENTS_CALLEE_NAMES:wait",
    source: "wait 1",
    profiles: ["interaction-events"],
  },
  {
    id: "INTERACTION_EVENTS_CALLEE_NAMES:when",
    source: `when "stop" [ print 1 ]`,
    profiles: ["interaction-events"],
  },
  {
    id: "INTERACTION_EVENTS_CALLEE_NAMES:every",
    source: "every 10 [ print 1 ]",
    profiles: ["interaction-events"],
  },
  {
    id: "INTERACTION_EVENTS_CALLEE_NAMES:on_key",
    source: `on_key "a" [ print 1 ]`,
    profiles: ["interaction-events"],
  },
  {
    id: "INTERACTION_EVENTS_CALLEE_NAMES:on_click",
    source: "on_click [ print 1 ]",
    profiles: ["interaction-events"],
  },
  // --- SPRITES_CALLEE_NAMES ---------------------------------------------------------------------
  {
    id: "SPRITES_CALLEE_NAMES:new_turtle",
    source: ":a = new_turtle",
    profiles: ["sprites"],
  },
  {
    id: "SPRITES_CALLEE_NAMES:tell",
    source: "tell [ :a ]",
    profiles: ["sprites"],
  },
  {
    id: "SPRITES_CALLEE_NAMES:ask",
    source: "ask :a [ print 1 ]",
    profiles: ["sprites"],
  },
  {
    id: "SPRITES_CALLEE_NAMES:each",
    source: "each [ print 1 ]",
    profiles: ["sprites"],
  },
  {
    id: "SPRITES_CALLEE_NAMES:turtles",
    source: "print turtles",
    profiles: ["sprites"],
  },
  {
    id: "SPRITES_CALLEE_NAMES:who",
    source: "print who",
    profiles: ["sprites"],
  },
  // --- TUTOR_AI_CALLEE_NAMES --------------------------------------------------------------------
  {
    id: "TUTOR_AI_CALLEE_NAMES:challenge",
    source: "challenge",
    profiles: ["tutor-ai"],
  },
  // --- HERITAGE_CALLEE_NAMES --------------------------------------------------------------------
  ...Object.entries(HERITAGE_ALIAS_SOURCES).map(([name, source]) => ({
    id: `HERITAGE_CALLEE_NAMES:${name}`,
    source,
    profiles: ["heritage"],
  })),
  // --- GEOMETRY_STDLIB_CALLEE_NAMES -------------------------------------------------------------
  ...["polygon", "star", "circle", "arc"].map((name) => ({
    id: `GEOMETRY_STDLIB_CALLEE_NAMES:${name}`,
    source: `${name} 3 50`,
    profiles: ["geometry"],
  })),
  // `area`/`perimeter` also add `data` (spec/conformance.md:265), which is the whole reason
  // GEOMETRY_STDLIB_ALSO_DATA_NAMES exists — so their probes assert both profiles, and deleting
  // either name from that second table fails test (A), not just test (B).
  ...["area", "perimeter"].map((name) => ({
    id: `GEOMETRY_STDLIB_CALLEE_NAMES:${name}`,
    source: `print ${name} [1 2]`,
    profiles: ["geometry", "data"],
  })),
  ...["area", "perimeter"].map((name) => ({
    id: `GEOMETRY_STDLIB_ALSO_DATA_NAMES:${name}`,
    source: `print ${name} [1 2]`,
    profiles: ["geometry", "data"],
  })),
  // --- DATA_NODE_KINDS --------------------------------------------------------------------------
  {
    id: "DATA_NODE_KINDS:DictLit",
    source: `:d = { "a": 1 }`,
    profiles: ["data"],
  },
  {
    id: "DATA_NODE_KINDS:StructDef",
    source: "struct point [ x y ]",
    profiles: ["data"],
  },
  { id: "DATA_NODE_KINDS:Add", source: "add 1 to :xs", profiles: ["data"] },
  {
    id: "DATA_NODE_KINDS:Remove",
    source: "remove 1 from :xs",
    profiles: ["data"],
  },
  {
    id: "DATA_NODE_KINDS:RemoveKey",
    source: `remove key "a" from :d`,
    profiles: ["data"],
  },
  {
    id: "DATA_NODE_KINDS:Insert",
    source: "insert 1 in :xs at 1",
    profiles: ["data"],
  },
  { id: "DATA_NODE_KINDS:Clear", source: "clear :xs", profiles: ["data"] },
  // --- RESERVED_WORD_PROFILES (no AST production; detected from parse diagnostics) ---------------
  {
    id: "RESERVED_WORD_PROFILES:import",
    source: `import "m"`,
    profiles: ["modules"],
  },
  {
    id: "RESERVED_WORD_PROFILES:export",
    source: `export "m"`,
    profiles: ["modules"],
  },
  {
    id: "RESERVED_WORD_PROFILES:alias",
    source: "alias av forward",
    profiles: ["localization"],
  },
  // --- AST_SHAPE_RULE_IDS -----------------------------------------------------------------------
  // Every rule here detects a form that GAINED its current AST production in a specific slice
  // (#151, #667, #664) — precisely the change that silently breaks a shape-keyed rule.
  {
    id: "Assign.form=make",
    source: `make "x" 1`,
    profiles: ["heritage"],
  },
  {
    id: "ProcedureDef.keyword=to",
    source: "to f\nend",
    profiles: ["heritage"],
  },
  {
    id: "Return.keyword=output",
    source: "define f\n  output 1\nend",
    profiles: ["heritage"],
  },
  {
    id: "Return.keyword=op",
    source: "define f\n  op 1\nend",
    profiles: ["heritage"],
  },
  {
    id: "ValueOfKey",
    source: `print value of :d for key "k"`,
    profiles: ["heritage", "data"],
  },
  {
    id: "Place.segment=index",
    source: ":xs = [1 2]\nprint :xs[1]",
    profiles: ["data"],
  },
  {
    id: "Place.segment=field",
    source: "print :person.age",
    profiles: ["data"],
  },
  {
    id: "ProfileStatement.sprites",
    source: "tell [ :a ]",
    profiles: ["sprites"],
  },
  {
    id: "ProfileStatement.interaction-events",
    source: "on_click [ print 1 ]",
    profiles: ["interaction-events"],
  },
  {
    id: "dataPrimitiveArity",
    source: "print keys :d",
    profiles: ["data"],
  },
  {
    id: "geometryPrimitiveArity",
    source: "grid 10",
    profiles: ["geometry"],
  },
  {
    id: "educationalPrimitiveArity",
    source: "explain",
    profiles: ["educational"],
  },
];

// --- (A) reachability ----------------------------------------------------------------------------

for (const probe of PROBES) {
  test(`profile detection rule ${probe.id} still matches`, () => {
    const detected = detectUsedProfiles(probe.source);
    for (const profile of probe.profiles) {
      assert.ok(
        detected.includes(profile),
        `rule ${probe.id} no longer attributes ${JSON.stringify(probe.source)} to "${profile}" ` +
          `(detected ${JSON.stringify(detected)}). A detection rule that matches nothing is ` +
          `indistinguishable from a profile that is not used, so it must fail here rather than ` +
          `silently mis-attribute an example or a fixture (issue #701).`,
      );
    }
  });
}

// --- (B) exhaustiveness, in both directions ------------------------------------------------------

/** Every rule id the live tables and shape-rule list define, as `<TABLE>:<entry>` or a bare rule id. */
function liveRuleIds() {
  return [
    ...NAME_TABLES.flatMap(([table, entries]) =>
      [...entries].map((entry) => `${table}:${entry}`),
    ),
    ...AST_SHAPE_RULE_IDS,
  ];
}

test("every live detection-table entry has a probe", () => {
  const probed = new Set(PROBES.map((probe) => probe.id));
  const missing = liveRuleIds().filter((id) => !probed.has(id));
  assert.deepEqual(
    missing,
    [],
    `these detection rules have no probe, so nothing would notice if they stopped matching — ` +
      `add one to PROBES above (issue #701)`,
  );
});

test("every probe still names a live detection rule (no stale probes)", () => {
  const live = new Set(liveRuleIds());
  const stale = [...new Set(PROBES.map((probe) => probe.id))].filter(
    (id) => !live.has(id),
  );
  assert.deepEqual(
    stale,
    [],
    "these probes name a rule that no longer exists — remove them, or restore the rule",
  );
});

// --- (C) DAG coverage ----------------------------------------------------------------------------

test("every optional profile in the spec DAG is reached by at least one probe", () => {
  // Core Language is not optional, and Turtle & Rendering is deliberately not detected (every
  // program needs it, so its usage can never contradict a declaration) — see
  // `detectUsedProfiles`'s exhaustiveness audit. Every other DAG node must be detectable, or a
  // program could depend on it while declaring nothing and no gate would notice.
  const NOT_DETECTED = new Set(["core-language", "turtle-rendering"]);
  const covered = new Set(PROBES.flatMap((probe) => probe.profiles));
  const undetectable = Object.keys(PROFILE_DEPS)
    .filter((profile) => !NOT_DETECTED.has(profile))
    .filter((profile) => !covered.has(profile));
  assert.deepEqual(
    undetectable,
    [],
    `these profiles are in spec/conformance.md's DAG but no probe reaches them, so ` +
      `detectUsedProfiles cannot see a program that depends on one (issue #701)`,
  );
});

test("probe ids are unique per rule and source", () => {
  const keys = PROBES.map((probe) => `${probe.id}|${probe.source}`);
  const duplicates = keys.filter((key, index) => keys.indexOf(key) !== index);
  assert.deepEqual(duplicates, []);
});
