// Unit tests for the **tooling** view of the Sound profile's five commands — `set_tempo`, `beep`,
// `note`, `rest`, `play` (issue #692, slice S4 of the Sound epic #662; `spec/tooling.md`'s token
// classes + three checker layers, `spec/interaction-events.md`'s "Sound primitives" section). The
// The executable behavior (reader arity grouping + Layer-2 recognition, arity, and reserved-word
// collision checking) already shipped in S1–S3 and is exercised by `sound-arity.test.mjs`; this
// file locks the grammar-derived *tooling* contract those slices left implicit:
//
//   1. Highlighting — a Sound command name is an ordinary primitive call, not a block-head, so
//      `highlight()` classifies it `primitive` (`spec/tooling.md:28-44`) and `semanticTokens()`
//      layers `defaultLibrary` on it (`spec/tooling.md:280-282`), exactly as a Core command like
//      `forward` is treated. Since issue #740 the highlighter DOES take an active-profile set, and
//      that is precisely why this file matters: `spec/tooling.md:30` moves only "a profile's
//      block-heads and its mode-switch commands" into `keyword` while
//      their profile is active, and `:31` keeps "profile primitives when enabled" in `primitive`.
//      Sound has no block-heads at all, so all five commands must be unmoved in BOTH directions —
//      this file is the control case that separates "classify by block-head-ness" from the wrong
//      rule "classify by profile membership".
//   2. Checker recognition — under an active `sound` profile a Sound program checks clean, and
//      under Core-only the same program is `ol-unknown-command`. Legality gating is the checker's
//      job, never the reader's or the highlighter's: `spec/interaction-events.md:47` says "`input`
//      and `wait` are ordinary primitives rather than block-heads, as are the Sound command names;
//      all of them are built-in names on the same unconditional terms, and their profile decides
//      only whether they work" — so declaring one IS blocked, while its token class stays
//      `primitive`. Those are different questions and this file answers only the second.
//
// These are proven in **awkward positions** — inside a `[ … ]` instruction block, inside `repeat`,
// and nested in a procedure body — not just at top level, so a future regression that (say) only
// recognized a Sound command as a top-level statement cannot slip through. This is the reusable
// shape the sibling M5 tooling slices (#671 Heritage, #678 Sprites, #687 Interaction) follow.

import assert from "node:assert/strict";
import { test } from "node:test";
import * as OL from "@openlogo/parser";

const doc = "sound-tooling.logo";

/** Every canonical Sound command name (case-insensitive), one representative correct call each. */
const SOUND_CALLS = Object.freeze({
  set_tempo: "set_tempo 90",
  beep: "beep",
  note: 'note "c4" 1',
  rest: "rest 1",
  play: 'play ["c4" 1]',
});

const SOUND_PROFILES = ["core-language", "sound"];

/**
 * A whole Sound program that places every one of the five commands in an awkward position — a
 * procedure body (`set_tempo`, `beep`), inside a `repeat` (`note`, `rest`), and with a list-literal
 * argument (`play`) — so a regression that only handled top-level Sound calls cannot pass. Shared
 * by the nested highlighting/semantic-token assertions and the nested checker assertions below.
 */
const NESTED_SOUND_PROGRAM = [
  "define melody",
  "  set_tempo 120",
  '  repeat 2 [ note "c4" 1 rest 1 ]',
  '  play ["e4" 1]',
  "  beep",
  "end",
  "melody",
].join("\n");

/** The `class`/`text` of the token whose text is `name`, from `highlight()` over `source`. */
function classOf(source, name) {
  const token = OL.highlight(source, doc).find((t) => t.text === name);
  assert.ok(
    token,
    `expected a token spelled ${JSON.stringify(name)} in ${JSON.stringify(source)}`,
  );
  return token.class;
}

// --- Highlighting: Sound command names classify as `primitive` -------------------------------

test("highlight: each Sound command name classifies as primitive under Core-only", () => {
  for (const [name, source] of Object.entries(SOUND_CALLS)) {
    assert.equal(
      classOf(source, name),
      "primitive",
      `${name} should highlight as primitive`,
    );
  }
});

test("highlight: every Sound command stays primitive nested in a whole program under Core-only", () => {
  // A Sound command is an ordinary primitive call wherever a statement is legal — the highlighter
  // classifies it by name, not by syntactic position, so nesting must not change its class. Assert
  // ALL FIVE at once inside NESTED_SOUND_PROGRAM (set_tempo/beep in the body, note/rest inside
  // `repeat [ … ]`, play with a list-literal arg) — not just a representative subset.
  const tokens = OL.highlight(NESTED_SOUND_PROGRAM, doc);
  for (const name of Object.keys(SOUND_CALLS)) {
    const commandTokens = tokens.filter((t) => t.text === name);
    assert.equal(
      commandTokens.length,
      1,
      `expected exactly one ${name} token in the nested program`,
    );
    assert.equal(
      commandTokens[0].class,
      "primitive",
      `${name} should highlight as primitive even when nested`,
    );
  }
});

test("highlight: a Sound command name is never a keyword — a same-named procedure highlights as procedure-name", () => {
  // Block-heads (`if`/`repeat`/`define`, and an active profile's own heads) reach the `keyword`
  // class; Sound commands never do, so a user procedure literally named `note` resolves to
  // `procedure-name` at its call site via symbol discovery (`spec/tooling.md:30`'s demotion
  // clause). This is a *token-class* claim only: `spec/interaction-events.md:47` makes the Sound
  // names built-in unconditionally, so the checker separately rejects this very declaration —
  // legality is not what the highlighter answers.
  const source = "define note\nend\nnote";
  const tokens = OL.highlight(source, doc).filter((t) => t.text === "note");
  assert.equal(tokens.length, 2);
  assert.ok(tokens.every((t) => t.class === "procedure-name"));
});

// --- Semantic tokens: Sound command names carry `defaultLibrary` ------------------------------

test("semanticTokens: each Sound command call carries the defaultLibrary modifier", () => {
  for (const [name, source] of Object.entries(SOUND_CALLS)) {
    const token = OL.semanticTokens(source, doc).find((t) => t.text === name);
    assert.ok(token, `expected a semantic token for ${name}`);
    assert.equal(token.class, "primitive");
    assert.ok(
      token.modifiers.includes("defaultLibrary"),
      `${name} should be a defaultLibrary primitive`,
    );
  }
});

test("semanticTokens: every Sound command carries defaultLibrary when nested in a whole program", () => {
  // The nested counterpart of the top-level check above: all five commands, in awkward positions,
  // must still surface as `primitive` + `defaultLibrary` semantic tokens (spec/tooling.md:280-282).
  const tokens = OL.semanticTokens(NESTED_SOUND_PROGRAM, doc);
  for (const name of Object.keys(SOUND_CALLS)) {
    const token = tokens.find((t) => t.text === name);
    assert.ok(token, `expected a semantic token for nested ${name}`);
    assert.equal(token.class, "primitive");
    assert.ok(
      token.modifiers.includes("defaultLibrary"),
      `nested ${name} should be a defaultLibrary primitive`,
    );
  }
});

// --- The control case for #740: an ACTIVE profile must NOT move a Sound command ---------------

test("highlight: every Sound command stays primitive with the sound profile ACTIVE", () => {
  // `spec/tooling.md:30` moves only "a profile's block-heads and its mode-switch
  // commands" into `keyword` while their profile is active; `:31` keeps "profile primitives
  // when enabled" in `primitive`. `spec/interaction-events.md:47` says the same in words:
  // "`input` and `wait` are ordinary primitives rather than block-heads, as are the Sound command
  // names".
  //
  // Sound has no block-heads at all, so ALL FIVE commands are the control: if a future change
  // classified profile words by profile membership instead of by block-head-ness, these rows go
  // red and the Sprites/Interaction rows stay green. Asserted in both directions and nested, so
  // the control cannot pass merely because the profile was never switched on.
  for (const profiles of [SOUND_PROFILES, ["core-language"]]) {
    const label = profiles.includes("sound") ? "ACTIVE" : "INACTIVE";
    for (const [name, source] of Object.entries(SOUND_CALLS)) {
      const token = OL.highlight(source, doc, { profiles }).find(
        (t) => t.text === name,
      );
      assert.ok(token, `expected a ${name} token (sound ${label})`);
      assert.equal(token.class, "primitive", `${name} (sound ${label})`);
    }
    const nested = OL.highlight(NESTED_SOUND_PROGRAM, doc, { profiles });
    for (const name of Object.keys(SOUND_CALLS)) {
      const commandTokens = nested.filter((t) => t.text === name);
      assert.equal(
        commandTokens.length,
        1,
        `expected exactly one nested ${name} token (sound ${label})`,
      );
      assert.equal(
        commandTokens[0].class,
        "primitive",
        `nested ${name} (sound ${label})`,
      );
    }
  }
});

test("semanticTokens: a Sound command keeps defaultLibrary with the sound profile ACTIVE", () => {
  // The modifier follows the class, so the control case has to hold here too: an active Sound
  // profile must not strip `defaultLibrary` the way it legitimately does for an active
  // Sprites/Interaction block-head, which sheds it by becoming `keyword`.
  for (const [name, source] of Object.entries(SOUND_CALLS)) {
    const token = OL.semanticTokens(source, doc, {
      profiles: SOUND_PROFILES,
    }).find((t) => t.text === name);
    assert.ok(token, `expected a semantic token for ${name}`);
    assert.equal(token.class, "primitive");
    assert.ok(
      token.modifiers.includes("defaultLibrary"),
      `${name} should stay a defaultLibrary primitive under an active profile`,
    );
  }
});

// --- Checker recognition: active `sound` clean; Core-only unknown -----------------------------

/** `check()` diagnostics for `source` under the given profiles (parse must be clean first). */
function checkDiagnostics(source, profiles) {
  const { ast, diagnostics: parseDiagnostics } = OL.parse(source, doc);
  assert.deepEqual(
    parseDiagnostics,
    [],
    `expected a clean parse for ${JSON.stringify(source)}`,
  );
  return OL.check(ast, { profiles }).diagnostics;
}

test("check: with the sound profile active, every Sound command is a known callee (checks clean)", () => {
  for (const source of Object.values(SOUND_CALLS)) {
    assert.deepEqual(
      checkDiagnostics(source, SOUND_PROFILES),
      [],
      `${JSON.stringify(source)} should check clean under an active sound profile`,
    );
  }
});

test("check: without the sound profile, every Sound command is ol-unknown-command", () => {
  for (const [name, source] of Object.entries(SOUND_CALLS)) {
    const diagnostics = checkDiagnostics(source, ["core-language"]);
    assert.equal(
      diagnostics.length,
      1,
      `${name} should raise exactly one diagnostic`,
    );
    assert.equal(diagnostics[0].code, "ol-unknown-command");
    assert.equal(diagnostics[0].params.name, name);
    assert.equal(diagnostics[0].stage, "semantic");
  }
});

test("check: a whole Sound program in awkward positions checks clean under an active sound profile", () => {
  assert.deepEqual(checkDiagnostics(NESTED_SOUND_PROGRAM, SOUND_PROFILES), []);
});

test("check: that same Sound program under Core-only flags each Sound command as unknown, once each", () => {
  // Nesting must not hide a Sound command from the checker: every Sound callee — inside the block,
  // inside `repeat`, and in the procedure body — is reported, and only the Sound names are (the
  // user procedure `melody` and its call are known).
  const source = NESTED_SOUND_PROGRAM;
  const diagnostics = checkDiagnostics(source, ["core-language"]);
  const unknownNames = diagnostics
    .filter((d) => d.code === "ol-unknown-command")
    .map((d) => d.params.name)
    .sort();
  assert.deepEqual(unknownNames, ["beep", "note", "play", "rest", "set_tempo"]);
  assert.equal(diagnostics.length, 5, "only the five Sound calls are unknown");
});
