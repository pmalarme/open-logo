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
// names hit an arity fault before they could act. So the **acting set** is asserted too: each name
// is called through the shapes `candidateCalls` brute-forces — see its own note for why registry
// arity was tried and abandoned — and the sweep fails if the set of names demonstrably able to act
// collapses. Both directions must hold, or the file is not measuring anything.
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

import { OL_CHECK_PROFILES } from "@openlogo/parser";
import { execute } from "@openlogo/runtime";

const REPO_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);

/**
 * The profile DAG of `spec/conformance.md:288-305`, as dependency closures.
 *
 * Needed because "every profile except this one" is not simply the complement: dropping `data` must
 * also drop `geometry` and `heritage`, or the name would be re-admitted through a dependent's
 * closure and the negative control would be testing nothing.
 *
 * **Transcribed from the normative tree, annotations included.** `:305` makes the `(also depends
 * on …)` edges normative, and getting one wrong silently shrinks the sweep rather than failing it:
 * omitting Heritage's dependency on Turtle & Rendering left all thirteen Heritage aliases unable to
 * act under their "own" closure, so every one of them dropped out of the acting set and was never
 * tested in either direction. The `covers every profile` test below is the guard against that
 * happening again for a profile added later.
 */
const PROFILE_DEPENDENCIES = {
  "core-language": [],
  "turtle-rendering": ["core-language"],
  sprites: ["core-language", "turtle-rendering"],
  geometry: ["core-language", "turtle-rendering", "data"],
  data: ["core-language"],
  heritage: ["core-language", "data", "turtle-rendering"],
  "interaction-events": ["core-language"],
  sound: ["core-language"],
  modules: ["core-language"],
  localization: ["core-language", "modules"],
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
 * Candidate call shapes for `name`, in both statement and value position.
 *
 * Registry arity is not enough on its own, and both gaps were measured. A **Heritage alias** has no
 * registry entry of its own, so `activeProfilePrimitiveArityRange` returns `undefined` and an
 * arity-derived call is the bare word — which raises an arity fault before it can act, silently
 * dropping all thirteen aliases out of the acting set. And a **reporter** produces a value rather
 * than an event, so a statement-position call shows no effect even when it evaluates perfectly;
 * wrapping it in `print` turns evaluation into an observable `print` event. Widening to arities 0-2
 * in both positions took the acting set from 35 of 69 to 61 of 69.
 */
function candidateCalls(name) {
  const shapes = [];
  for (let arity = 0; arity <= 2; arity += 1) {
    for (const argument of CANDIDATE_ARGUMENTS) {
      const args = arity > 0 ? ` ${Array(arity).fill(argument).join(" ")}` : "";
      shapes.push(`${name}${args}\n`, `print ${name}${args}\n`);
      if (arity === 0) break;
    }
  }
  return shapes;
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
    const source = candidateCalls(entry.name).find(
      (candidate) => effectsOf(candidate, own).length > 0,
    );
    if (source !== undefined) {
      acting.push({ ...entry, source, own });
    }
  }
  return acting;
}

/**
 * The non-Core primitives no call this file can synthesise makes act, and which the negatives below
 * therefore do NOT test. Pinned as a set rather than a count so a name joining them appears in the
 * diff by name.
 *
 * Each is excluded because its operand shape is outside the four candidate arguments, not because
 * it is uninteresting: `challenge` has no evaluator at all (issue #815's third fault class);
 * `input` needs host input; `keys`, `values` and `type_of` need a dict or a typed operand; `note`
 * and `play` need note/melody words; `set_shape` needs a registered shape word.
 */
const EXCLUDED_NAMES = [
  "challenge",
  "input",
  "keys",
  "note",
  "play",
  "set_shape",
  "type_of",
  "values",
];

const ACTING = actingSet();

/** Every non-Core primitive in the manifest — the denominator the sweep is accountable to. */
const NON_CORE_PRIMITIVES = BUILT_INS.filter(
  (entry) =>
    entry.profile !== "core-language" && entry.category === "primitive",
);

test("the dependency table covers every profile the checker knows", () => {
  // Guards the failure that shrank this sweep silently: a profile missing from the table gets an
  // empty closure, so its names cannot act under their "own" profile and drop out of the acting set
  // without any test failing. Keyed off `OL_CHECK_PROFILES` so a profile added to the language
  // fails here rather than quietly narrowing the sweep.
  assert.deepEqual(
    [...OL_CHECK_PROFILES].filter(
      (profile) => PROFILE_DEPENDENCIES[profile] === undefined,
    ),
    [],
  );
});

test("the sweep has something to measure: non-Core primitives do act under their own profile", () => {
  // The control. If this collapses, every negative below passes for free and asserts nothing —
  // which is exactly what an earlier version of this file did.
  assert.ok(
    ACTING.length >= 45,
    `only ${ACTING.length} non-Core primitives could be made to act; the sweep has gone vacuous`,
  );
});

test("every non-Core primitive is either swept or accounted for", () => {
  // The honest denominator. A name is excluded only because no call this file can synthesise makes
  // it act — a reporter needing a live turtle, a command whose effect is not an event, an operand
  // shape the four candidate arguments do not cover. Excluded names are NOT tested by the negatives
  // below, and saying so here is the difference between a sweep and a claim of completeness.
  const excluded = NON_CORE_PRIMITIVES.filter(
    (entry) => !ACTING.some((acting) => acting.name === entry.name),
  );
  assert.equal(
    ACTING.length + excluded.length,
    NON_CORE_PRIMITIVES.length,
    "every non-Core primitive must be in exactly one of the two buckets",
  );
  // Pinned as a set, not a count, so adding a primitive that cannot be exercised shows up as a
  // named addition in the diff rather than as a number nobody re-derives.
  assert.deepEqual(excluded.map((entry) => entry.name).sort(), EXCLUDED_NAMES);
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
