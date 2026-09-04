// Unit tests for the profile keyword registry (C1, issue #663), per
// spec/turtles-and-sprites.md#reserved-words-in-this-profile,
// spec/interaction-events.md#profiles-and-reservation, and
// spec/grammar.md#keywords-primitives-and-built-in-names. This slice is contract-first: it delivers
// the registry and the profile-aware `isKeyword`/`isProfileKeyword` API that the checker,
// highlighter, and downstream profile grammar slices (C2 #664) consume. The three acceptance
// criteria are proven here against the public `@openlogo/parser` surface:
//   - Sprites active  → ask/each/tell are keywords.
//   - Interaction active → when/every/on_key/on_click are keywords.
//   - Core only        → ask/when do not PAINT as keywords, and the Core list is unchanged
//                        (non-regression) — but they are still built-in names a program may not
//                        declare, which is the axis #841 separated out.
//
// **Two axes read this registry and answer differently.** `spec/grammar.md:412` — "what a profile
// decides is whether a name *works*, never whether a program may declare it" — makes the
// DECLARATION assertions below answer the same way for every profile set. The PAINT assertions stay
// profile-gated, because `spec/tooling.md:30` asks for that gate. So the "Core only" row above
// reads: `ask`/`when` do not paint as keywords there, yet are still names a program may not
// declare. The section citations are to the sections that define these words; no spec text states a
// profile-conditional reservation.
//
// Runs under `node --test` against the built `@openlogo/parser` package.

import assert from "node:assert/strict";
import { test } from "node:test";
import * as OL from "@openlogo/parser";

const SPRITES_WORDS = ["ask", "each", "tell"];
const INTERACTION_WORDS = ["when", "every", "on_key", "on_click"];

// The exact Core keyword list, so a regression that leaks a profile block-head into OL_KEYWORDS (or
// drops a Core word) fails loudly. spec/grammar.md:370-378, in the registry's grouping order.
// `mod` joined the list with maintainer ruling #833 (issue #837): it is a word-spelled operator of
// the expression grammar exactly as `and`/`or`/`not` are, and was the only one of the four missing.
const EXPECTED_CORE_KEYWORDS = [
  "define",
  "to",
  "end",
  "return",
  "output",
  "op",
  "stop",
  "throw",
  "set",
  "make",
  "local",
  "thing",
  "if",
  "else",
  "while",
  "repeat",
  "for",
  "forever",
  "in",
  "from",
  "at",
  "by",
  "key",
  "value",
  "add",
  "remove",
  "insert",
  "clear",
  "map",
  "filter",
  "reduce",
  "and",
  "or",
  "not",
  "mod",
  "true",
  "false",
  "is",
  "between",
  "strictly",
  "struct",
  "alias",
  "import",
  "export",
];

// --- Non-regression: the Core keyword list is unchanged apart from `mod` (AC 3, strict). ---

test("OL_KEYWORDS is exactly the Core list, in order — no profile block-head leaked in", () => {
  assert.deepEqual([...OL.OL_KEYWORDS], EXPECTED_CORE_KEYWORDS);
});

test("no profile word is present in the Core keyword list", () => {
  for (const word of [...SPRITES_WORDS, ...INTERACTION_WORDS]) {
    assert.equal(
      OL.OL_KEYWORDS.includes(word),
      false,
      `${word} must not be a Core keyword`,
    );
  }
});

// --- Backward compatibility: profile-independent isKeyword is unchanged. ---

test("isKeyword with no profiles matches every Core word and rejects non-words", () => {
  for (const word of EXPECTED_CORE_KEYWORDS) {
    assert.ok(OL.isKeyword(word), `${word} should be a keyword`);
  }
  assert.equal(OL.isKeyword("wibble"), false);
});

test("isKeyword stays case-insensitive for Core words", () => {
  assert.ok(OL.isKeyword("REPEAT"));
  assert.ok(OL.isKeyword("Define"));
});

test("Core-only callers do not match any profile block-head (AC 3)", () => {
  // The PAINT axis only. `isKeyword` answers "does this word classify as a keyword right now" —
  // it is what `highlight.ts` consults for the `keyword` token class — and under Core alone the
  // answer is no, which is `spec/tooling.md:30`'s "while their profile is active" clause. The
  // reader never calls it: `parser.ts` is profile-blind by design. Nor is a `false` here a
  // statement that the word is an ordinary name — since issue #841 `define ask` is
  // `ol-reserved-word` under Core too, and `isKeywordInAnyProfile` is the predicate that says so.
  for (const word of [...SPRITES_WORDS, ...INTERACTION_WORDS]) {
    assert.equal(
      OL.isKeyword(word),
      false,
      `${word} must not paint as a keyword in Core`,
    );
    assert.equal(
      OL.isKeyword(word, ["core-language"]),
      false,
      `${word} must not paint as a keyword with only core-language active`,
    );
    assert.equal(
      OL.isKeywordInAnyProfile(word),
      true,
      `${word} is still a name Core-only programs may not declare`,
    );
  }
});

// --- AC 1: Sprites active contributes ask/each/tell. ---

test("Sprites active makes ask, each, and tell keywords (AC 1)", () => {
  for (const word of SPRITES_WORDS) {
    assert.ok(
      OL.isKeyword(word, ["sprites"]),
      `${word} should be a keyword when sprites is active`,
    );
    assert.ok(OL.isProfileKeyword(word, ["sprites"]));
  }
});

test("Sprites keyword matching is case-insensitive", () => {
  assert.ok(OL.isKeyword("ASK", ["sprites"]));
  assert.ok(OL.isProfileKeyword("Tell", ["sprites"]));
});

test("Sprites active does not match the Interaction block-heads", () => {
  for (const word of INTERACTION_WORDS) {
    assert.equal(OL.isKeyword(word, ["sprites"]), false);
    assert.equal(OL.isProfileKeyword(word, ["sprites"]), false);
  }
});

// --- AC 2: Interaction & Events active contributes when/every/on_key/on_click. ---

test("Interaction & Events active makes when, every, on_key, and on_click keywords (AC 2)", () => {
  for (const word of INTERACTION_WORDS) {
    assert.ok(
      OL.isKeyword(word, ["interaction-events"]),
      `${word} should be a keyword when interaction-events is active`,
    );
    assert.ok(OL.isProfileKeyword(word, ["interaction-events"]));
  }
});

test("Interaction active does not match the Sprites block-heads", () => {
  for (const word of SPRITES_WORDS) {
    assert.equal(OL.isKeyword(word, ["interaction-events"]), false);
    assert.equal(OL.isProfileKeyword(word, ["interaction-events"]), false);
  }
});

// --- Both profiles / mixed sets. ---

test("both profiles active matches every profile block-head, still with the Core words", () => {
  const active = ["core-language", "sprites", "interaction-events"];
  for (const word of [...SPRITES_WORDS, ...INTERACTION_WORDS]) {
    assert.ok(OL.isKeyword(word, active));
  }
  assert.ok(OL.isKeyword("repeat", active));
});

test("isProfileKeyword ignores unrelated active profiles", () => {
  assert.equal(OL.isProfileKeyword("ask", ["data", "geometry"]), false);
  assert.equal(OL.isProfileKeyword("ask", []), false);
});

test("a Core keyword is not counted as a profile keyword", () => {
  // `repeat` is a Core word, not owned by any profile registry.
  assert.equal(OL.isProfileKeyword("repeat", ["sprites"]), false);
});

// --- The registry itself. ---

test("OL_PROFILE_KEYWORDS maps exactly the two contributing profiles to their spec words", () => {
  assert.deepEqual(Object.keys(OL.OL_PROFILE_KEYWORDS).sort(), [
    "interaction-events",
    "sprites",
  ]);
  assert.deepEqual([...OL.OL_PROFILE_KEYWORDS.sprites], SPRITES_WORDS);
  assert.deepEqual(
    [...OL.OL_PROFILE_KEYWORDS["interaction-events"]],
    INTERACTION_WORDS,
  );
});

// --- Checker-level end-to-end proof of the three acceptance criteria (issue #663). ---
// A profile block-head declared by `define`/`struct` raises `ol-reserved-word` under EVERY profile
// set: `spec/grammar.md:412` makes profile words built-in names unconditionally, and issue #841
// removed the gate that once made this answer depend on the active profile. Verified through the
// public `check()` surface, mirroring name-resolution's `checkSource` shape.

function checkSource(source, profiles = ["core-language"]) {
  const { ast, diagnostics: parseDiagnostics } = OL.parse(source, "unit.logo");
  assert.deepEqual(
    parseDiagnostics,
    [],
    `expected a clean parse for ${JSON.stringify(source)}`,
  );
  return OL.check(ast, { profiles, source }).diagnostics;
}

const isReservedWordFinding = (d) => d.code === "ol-reserved-word";

test("Sprites active: define ask/each/tell raises ol-reserved-word (AC 1)", () => {
  for (const word of SPRITES_WORDS) {
    const [finding] = checkSource(`define ${word} :x\n  print :x\nend\n`, [
      "core-language",
      "sprites",
    ]).filter(isReservedWordFinding);
    assert.ok(finding, `${word} should be flagged when sprites is active`);
    assert.deepEqual(finding.params, { name: word });
    assert.equal(finding.stage, "semantic");
    assert.equal(finding.severity, "error");
  }
});

test("Sprites active: struct tell raises ol-reserved-word, while local tell does not", () => {
  // `struct` is the other declaration slot, so it must agree with `define`. `local` is a BINDING
  // (issue #837 / ruling #833, spec/grammar.md:390), so the same word in the same program is free
  // there — this test pins both halves at once so neither can drift.
  const [finding] = checkSource("struct tell [ x ]\n", [
    "core-language",
    "data",
    "sprites",
  ]).filter(isReservedWordFinding);
  assert.deepEqual(finding.params, { name: "tell" });
  assert.deepEqual(
    checkSource("define g :y\n  local tell\n  print :y\nend\n", [
      "core-language",
      "sprites",
    ]),
    [],
    "local is a binding form and must accept a profile keyword",
  );
});

test("Interaction & Events active: define when/every/on_key/on_click raises ol-reserved-word (AC 2)", () => {
  for (const word of INTERACTION_WORDS) {
    const [finding] = checkSource(`define ${word} :x\n  print :x\nend\n`, [
      "core-language",
      "interaction-events",
    ]).filter(isReservedWordFinding);
    assert.ok(
      finding,
      `${word} should be flagged when interaction-events is active`,
    );
    assert.deepEqual(finding.params, { name: word });
  }
});

test("#841: Core only, ask/each/tell/when/every/on_key/on_click are still built-in names", () => {
  // `spec/grammar.md:412`: "a program cannot declare which profiles it requires … so a name that
  // could be declared in one implementation but not in another would be invisible and unpredictable
  // to a learner". The word's own profile is therefore irrelevant to the declaration question, and
  // this test must agree word for word with the sibling above that checks each with its profile
  // ACTIVE.
  for (const word of [...SPRITES_WORDS, ...INTERACTION_WORDS]) {
    const findings = checkSource(`define ${word} :x\n  print :x\nend\n`).filter(
      isReservedWordFinding,
    );
    assert.equal(
      findings.length,
      1,
      `${word} is a built-in name in a Core-only program too`,
    );
    assert.deepEqual(findings[0].params, { name: word });
  }
});

test("#841: an unrelated active profile does not change the answer either", () => {
  // The third point on the same axis, and the one that makes it a rule rather than a pair of
  // cases: the Interaction words are checked with `sprites` active — a profile that contributes
  // keywords, but not THESE keywords. Under the retired gate the answer depended on which profile
  // was claimed; now no profile set changes it, so all three settings agree.
  for (const word of INTERACTION_WORDS) {
    const findings = checkSource(`define ${word} :x\n  print :x\nend\n`, [
      "core-language",
      "sprites",
    ]).filter(isReservedWordFinding);
    assert.equal(
      findings.length,
      1,
      `${word} must raise under any profile set`,
    );
    assert.deepEqual(findings[0].params, { name: word });
  }
});

test("a Core reserved-word collision is unaffected by an active profile", () => {
  const [finding] = checkSource("define repeat :x\n  print :x\nend\n", [
    "core-language",
    "sprites",
  ]).filter(isReservedWordFinding);
  assert.deepEqual(finding.params, { name: "repeat" });
});
