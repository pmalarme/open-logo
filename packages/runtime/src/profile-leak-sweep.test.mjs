// **No name of a profile the run does not claim may act.**
//
// This file exists because the guard that enforces that had to be added in five separate places —
// statement dispatch, expression dispatch (before it, not after), profile forms, and Data
// declarations — and every one of them after the first was found by a reviewer rather than by the
// author. Four inspections, four misses. A fifth list of places found by inspection would inherit
// the same weakness and go stale the next time someone adds a dispatch site.
//
// So this asserts the **invariant over the name space** instead of the code paths. The name space
// is finite, versioned, and already authoritative: `spec/built-in-names.json` is the manifest
// ADR-0021 made a CI gate, carrying a `profile` for every built-in. Sweeping it tests the property
// directly — a name either acts or it does not — without any claim about where the guards live.
//
// ## The control is part of the assertion
//
// A sweep answering "nothing leaked" is worthless if nothing *could* have leaked. The first version
// of this swept bare calls and returned a clean `0 of 76` that meant almost nothing, because most
// names hit an arity fault before they could act. So the **acting set** is asserted too: names are
// called with registry-derived arity, and the sweep fails if the set of names demonstrably able to
// act collapses. Both directions must hold, or the file is not measuring anything.
//
// ## What it does not reach, stated plainly
//
// The primitive half is **derived** from the manifest. The seven profile forms (`when`, `every`,
// `on_key`, `on_click`, `tell`, `ask`, `each`) and the `struct` declaration are
// `category: "keyword"`, carry no arity, and cannot be synthesised — so they are a **hand-written
// table**, found by inspection. No completeness is claimed across that join.
//
// **What would falsify this**: a name that can act but is not in the manifest. The `built-in-names`
// gate asserts the manifest against the parser's registries in both directions, so such a name is
// already a gate failure — but that is where the frame breaks if it breaks.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { activeProfilePrimitiveArityRange } from "@openlogo/parser";
import { execute } from "@openlogo/runtime";

const REPO_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);

/**
 * The profile DAG of `spec/conformance.md`, as dependency closures.
 *
 * Needed because "every profile except this one" is not simply the complement: dropping `data` must
 * also drop `geometry` and `heritage`, or the name would be re-admitted through a dependent's
 * closure and the negative control would be testing nothing.
 */
const PROFILE_DEPENDENCIES = {
  "core-language": [],
  "turtle-rendering": ["core-language"],
  sprites: ["core-language", "turtle-rendering"],
  geometry: ["core-language", "turtle-rendering", "data"],
  data: ["core-language"],
  heritage: ["core-language", "data"],
  "interaction-events": ["core-language"],
  sound: ["core-language"],
  educational: ["core-language"],
  "tutor-ai": ["core-language", "educational"],
};

const ALL_PROFILES = Object.keys(PROFILE_DEPENDENCIES);

const closureOf = (profile) => [
  ...new Set([...PROFILE_DEPENDENCIES[profile], profile]),
];

/** Every profile whose closure contains `profile` — itself plus its dependents. */
const withDependents = (profile) =>
  ALL_PROFILES.filter((candidate) => closureOf(candidate).includes(profile));

const BUILT_INS = JSON.parse(
  readFileSync(join(REPO_ROOT, "spec", "built-in-names.json"), "utf8"),
).names;

/** Argument spellings tried in turn until one lets the name act. */
const CANDIDATE_ARGUMENTS = ["1", '"red"', "[1 2]", '"a"'];

/**
 * The side effects a program produces under `profiles`, excluding the `instruction` marker — which
 * is emitted for a statement that is merely *reached*, so it is not evidence that anything acted.
 */
function effectsOf(source, profiles) {
  const result = execute(source, "profile-leak-sweep.logo", {
    profiles,
    runUnchecked: true,
  });
  return result.events
    .map((event) => event.kind)
    .filter((kind) => kind !== "instruction");
}

/**
 * Every non-Core primitive paired with a call that demonstrably makes it act under its own profile
 * closure. A name with no such call is excluded rather than counted as a pass — it would be a
 * silent zero.
 */
function actingSet() {
  const acting = [];
  for (const entry of BUILT_INS) {
    if (entry.profile === "core-language" || entry.category !== "primitive") {
      continue;
    }
    const own = closureOf(entry.profile);
    const range = activeProfilePrimitiveArityRange(entry.name, own);
    const arity = range ? range.min : 0;
    for (const argument of CANDIDATE_ARGUMENTS) {
      const source =
        entry.name +
        (arity > 0 ? ` ${Array(arity).fill(argument).join(" ")}` : "") +
        "\n";
      if (effectsOf(source, own).length > 0) {
        acting.push({ ...entry, source, own });
        break;
      }
    }
  }
  return acting;
}

const ACTING = actingSet();

test("the sweep has something to measure: non-Core primitives do act under their own profile", () => {
  // The control. If this collapses, every negative below passes for free and asserts nothing —
  // which is exactly what an earlier version of this file did.
  assert.ok(
    ACTING.length >= 30,
    `only ${ACTING.length} non-Core primitives could be made to act; the sweep has gone vacuous`,
  );
});

test("the leak detector fires when nothing is banned", () => {
  // Falsify the instrument before trusting its silence. With every profile claimed, every member of
  // the acting set must act — so a detector that has quietly stopped detecting fails here rather
  // than reporting a clean zero below.
  const silent = ACTING.filter(
    (entry) => effectsOf(entry.source, ALL_PROFILES).length === 0,
  );
  // Asserted as entries rather than mapped to names: on success these arrays are empty, so a
  // `.map()` here is a function that never runs — an uncovered branch whose only purpose is to
  // format a failure that did not happen. The entries carry `name` and `profile`, so a real
  // failure still prints what a reader needs.
  assert.deepEqual(
    silent,
    [],
    "these names act under their own profile but not under the full set — the detector is broken",
  );
});

test("no non-Core primitive acts under a Core-only claim", () => {
  const leaked = ACTING.filter(
    (entry) => effectsOf(entry.source, ["core-language"]).length > 0,
  );
  assert.deepEqual(leaked, []);
});

test("no non-Core primitive acts under every profile EXCEPT its own", () => {
  // The adversarial negative, and the one that tests the lattice rather than two points on it. A
  // Core-only claim would not catch a Sound primitive leaking into a run claiming Turtle &
  // Rendering; this does. Dependents are banned alongside the profile itself, so the name cannot be
  // re-admitted through a dependent's closure.
  const leaked = ACTING.filter((entry) => {
    const banned = new Set(withDependents(entry.profile));
    const everythingElse = ALL_PROFILES.filter(
      (profile) => !banned.has(profile),
    );
    return effectsOf(entry.source, everythingElse).length > 0;
  });
  assert.deepEqual(leaked, []);
});

// The hand-written half. These are `category: "keyword"`, so they carry no arity and cannot be
// synthesised from the manifest — found by inspection, listed explicitly rather than implied to be
// covered by the sweep above.
//
// Each case carries a **preamble** and is measured by the effects the form adds *beyond* it. That
// is not tidiness: the sprites forms need a turtle to address, and `new_turtle` emits
// `spawn-turtle` whether or not the form under test does anything — so measuring the whole
// program's effects would let a form pass its own control on an effect its preamble produced.
// Measured while writing this: `ask` with a bad operand still yielded `spawn-turtle` and acted on
// nothing.
const KEYWORD_FORMS = [
  {
    head: "when",
    profile: "interaction-events",
    preamble: "",
    source: 'when "start" [ print 1 ]\n',
  },
  {
    head: "every",
    profile: "interaction-events",
    preamble: "",
    source: "every 10 [ print 1 ]\nwait 30\n",
  },
  {
    head: "on_key",
    profile: "interaction-events",
    preamble: "",
    source: 'on_key "a" [ print 1 ]\n',
  },
  {
    head: "on_click",
    profile: "interaction-events",
    preamble: "",
    source: "on_click [ print 1 ]\n",
  },
  {
    head: "tell",
    profile: "sprites",
    preamble: ":a = new_turtle\n",
    source: ":a = new_turtle\ntell :a\nforward 1\n",
  },
  {
    head: "ask",
    profile: "sprites",
    preamble: ":a = new_turtle\n",
    source: ":a = new_turtle\nask :a [ forward 1 ]\n",
  },
  {
    head: "each",
    profile: "sprites",
    preamble: ":a = new_turtle\ntell [ :a ]\n",
    source: ":a = new_turtle\ntell [ :a ]\neach [ forward 1 ]\n",
  },
  {
    head: "struct",
    profile: "data",
    preamble: "",
    source: "struct point [ x y ]\nprint (point 1 2).x\n",
  },
];

/** Effects the form adds beyond its preamble, under `profiles`. */
function effectsBeyondPreamble({ preamble, source }, profiles) {
  const base = effectsOf(preamble, profiles).length;
  return effectsOf(source, profiles).slice(base);
}

for (const form of KEYWORD_FORMS) {
  const { head, profile } = form;
  test(`the ${head} form does not act unless ${profile} is claimed`, () => {
    const banned = new Set(withDependents(profile));
    const withoutIt = ALL_PROFILES.filter(
      (candidate) => !banned.has(candidate),
    );
    assert.deepEqual(
      effectsBeyondPreamble(form, withoutIt),
      [],
      `${head} acted under a run that does not claim ${profile}`,
    );
    // And the control, per form: it must act when the profile IS claimed, or the negative above is
    // satisfied by a program that never worked.
    assert.notDeepEqual(
      effectsBeyondPreamble(form, closureOf(profile)),
      [],
      `${head} does not act even under ${profile} — this case proves nothing`,
    );
  });
}
