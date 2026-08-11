// Unit tests for the profile-conditional reserved-word registry (C1, issue #663), per
// spec/turtles-and-sprites.md#reserved-words-in-this-profile,
// spec/interaction-events.md#profiles-and-reservation, and
// spec/grammar.md#reserved-words-and-namespaces ("Profile-specific reserved words are recognized
// only when their profile is active"). This slice is contract-first: it delivers the registry and
// the profile-aware `isReservedWord`/`isProfileReservedWord` API that the checker, highlighter, and
// downstream profile grammar slices (C2 #664) consume. The three acceptance criteria are proven
// here against the public `@openlogo/parser` surface:
//   - Sprites active  → ask/each/tell are reserved.
//   - Interaction active → when/every/on_key/on_click are reserved.
//   - Core only        → ask/when are ordinary names AND the Core list is unchanged (non-regression).
//
// Runs under `node --test` against the built `@openlogo/parser` package.

import assert from "node:assert/strict";
import { test } from "node:test";
import * as OL from "@openlogo/parser";

const SPRITES_WORDS = ["ask", "each", "tell"];
const INTERACTION_WORDS = ["when", "every", "on_key", "on_click"];

// The exact Core reserved-word list as of before this slice, so a regression that leaks a
// profile block-head into OL_RESERVED_WORDS (or drops a Core word) fails loudly. spec/grammar.md's
// C19 reserved-word list, in the registry's grouping order.
const EXPECTED_CORE_RESERVED_WORDS = [
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

// --- Non-regression: the Core reserved-word list is unchanged (AC 3, strict requirement). ---

test("OL_RESERVED_WORDS is exactly the Core list, in order — no profile block-head leaked in", () => {
  assert.deepEqual([...OL.OL_RESERVED_WORDS], EXPECTED_CORE_RESERVED_WORDS);
});

test("no profile-conditional word is present in the Core reserved-word list", () => {
  for (const word of [...SPRITES_WORDS, ...INTERACTION_WORDS]) {
    assert.equal(
      OL.OL_RESERVED_WORDS.includes(word),
      false,
      `${word} must not be a Core reserved word`,
    );
  }
});

// --- Backward compatibility: profile-independent isReservedWord is unchanged. ---

test("isReservedWord with no profiles reserves every Core word and rejects non-words", () => {
  for (const word of EXPECTED_CORE_RESERVED_WORDS) {
    assert.ok(OL.isReservedWord(word), `${word} should be reserved`);
  }
  assert.equal(OL.isReservedWord("wibble"), false);
});

test("isReservedWord stays case-insensitive for Core words", () => {
  assert.ok(OL.isReservedWord("REPEAT"));
  assert.ok(OL.isReservedWord("Define"));
});

test("Core-only callers do not reserve any profile block-head (AC 3)", () => {
  for (const word of [...SPRITES_WORDS, ...INTERACTION_WORDS]) {
    assert.equal(
      OL.isReservedWord(word),
      false,
      `${word} must be an ordinary name in Core`,
    );
    assert.equal(
      OL.isReservedWord(word, ["core-language"]),
      false,
      `${word} must be an ordinary name with only core-language active`,
    );
  }
});

// --- AC 1: Sprites active reserves ask/each/tell. ---

test("Sprites active reserves ask, each, and tell (AC 1)", () => {
  for (const word of SPRITES_WORDS) {
    assert.ok(
      OL.isReservedWord(word, ["sprites"]),
      `${word} should be reserved when sprites is active`,
    );
    assert.ok(OL.isProfileReservedWord(word, ["sprites"]));
  }
});

test("Sprites reservation is case-insensitive", () => {
  assert.ok(OL.isReservedWord("ASK", ["sprites"]));
  assert.ok(OL.isProfileReservedWord("Tell", ["sprites"]));
});

test("Sprites active does not reserve the Interaction block-heads", () => {
  for (const word of INTERACTION_WORDS) {
    assert.equal(OL.isReservedWord(word, ["sprites"]), false);
    assert.equal(OL.isProfileReservedWord(word, ["sprites"]), false);
  }
});

// --- AC 2: Interaction & Events active reserves when/every/on_key/on_click. ---

test("Interaction & Events active reserves when, every, on_key, and on_click (AC 2)", () => {
  for (const word of INTERACTION_WORDS) {
    assert.ok(
      OL.isReservedWord(word, ["interaction-events"]),
      `${word} should be reserved when interaction-events is active`,
    );
    assert.ok(OL.isProfileReservedWord(word, ["interaction-events"]));
  }
});

test("Interaction active does not reserve the Sprites block-heads", () => {
  for (const word of SPRITES_WORDS) {
    assert.equal(OL.isReservedWord(word, ["interaction-events"]), false);
    assert.equal(OL.isProfileReservedWord(word, ["interaction-events"]), false);
  }
});

// --- Both profiles / mixed sets. ---

test("both profiles active reserves every profile block-head, still with the Core words", () => {
  const active = ["core-language", "sprites", "interaction-events"];
  for (const word of [...SPRITES_WORDS, ...INTERACTION_WORDS]) {
    assert.ok(OL.isReservedWord(word, active));
  }
  assert.ok(OL.isReservedWord("repeat", active));
});

test("isProfileReservedWord ignores unrelated active profiles", () => {
  assert.equal(OL.isProfileReservedWord("ask", ["data", "geometry"]), false);
  assert.equal(OL.isProfileReservedWord("ask", []), false);
});

test("a Core reserved word is not counted as a profile-conditional word", () => {
  // `repeat` is a Core word, not owned by any profile registry.
  assert.equal(OL.isProfileReservedWord("repeat", ["sprites"]), false);
});

// --- The registry itself. ---

test("OL_PROFILE_RESERVED_WORDS maps exactly the two reserving profiles to their spec words", () => {
  assert.deepEqual(Object.keys(OL.OL_PROFILE_RESERVED_WORDS).sort(), [
    "interaction-events",
    "sprites",
  ]);
  assert.deepEqual([...OL.OL_PROFILE_RESERVED_WORDS.sprites], SPRITES_WORDS);
  assert.deepEqual(
    [...OL.OL_PROFILE_RESERVED_WORDS["interaction-events"]],
    INTERACTION_WORDS,
  );
});

// --- Checker-level end-to-end proof of the three acceptance criteria (issue #663). ---
// A profile block-head redefined by `define`/`local` raises `ol-reserved-word` only when its
// profile is active. Verified through the public `check()` surface, mirroring name-resolution's
// `checkSource` shape.

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
    assert.deepEqual(finding.params, { name: word, namespace: "reserved" });
    assert.equal(finding.stage, "semantic");
    assert.equal(finding.severity, "error");
  }
});

test("Sprites active: local tell inside a body raises ol-reserved-word", () => {
  const [finding] = checkSource(
    "define g :y\n  local tell\n  print :y\nend\n",
    ["core-language", "sprites"],
  ).filter(isReservedWordFinding);
  assert.deepEqual(finding.params, { name: "tell", namespace: "reserved" });
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
    assert.deepEqual(finding.params, { name: word, namespace: "reserved" });
  }
});

test("Core only: ask/each/tell/when/every/on_key/on_click are ordinary procedure names (AC 3)", () => {
  for (const word of [...SPRITES_WORDS, ...INTERACTION_WORDS]) {
    assert.deepEqual(
      checkSource(`define ${word} :x\n  print :x\nend\n`).filter(
        isReservedWordFinding,
      ),
      [],
      `${word} must be a legal name in a Core-only program`,
    );
  }
});

test("Sprites active still does not reserve the Interaction block-heads at the checker level", () => {
  for (const word of INTERACTION_WORDS) {
    assert.deepEqual(
      checkSource(`define ${word} :x\n  print :x\nend\n`, [
        "core-language",
        "sprites",
      ]).filter(isReservedWordFinding),
      [],
    );
  }
});

test("a Core reserved-word collision is unaffected by an active profile", () => {
  const [finding] = checkSource("define repeat :x\n  print :x\nend\n", [
    "core-language",
    "sprites",
  ]).filter(isReservedWordFinding);
  assert.deepEqual(finding.params, { name: "repeat", namespace: "reserved" });
});
