import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import * as OL from "@openlogo/studio";

/**
 * `key-words.ts` (#952) — the studio's documented `on_key` vocabulary and the normalization
 * `spec/interaction-events.md:194-198` asks for ("Implementations SHOULD document their supported
 * key words and SHOULD normalize physical keyboard input to those lowercase words **for
 * accessibility**").
 */

/**
 * The key words a source declares, ignoring position — the shape most of these tests care about.
 * `null` (a non-literal key word) is passed straight through.
 */
function declaredKeyWordsOf(source) {
  const declared = OL.collectDeclaredKeyHandlers(source);
  return declared === null
    ? null
    : new Set(declared.map((entry) => entry.keyWord));
}

test("#952: the four arrows normalize to the spec's own examples", () => {
  assert.equal(OL.normalizeKeyWord("ArrowLeft"), "left");
  assert.equal(OL.normalizeKeyWord("ArrowRight"), "right");
  assert.equal(OL.normalizeKeyWord("ArrowUp"), "up");
  assert.equal(OL.normalizeKeyWord("ArrowDown"), "down");
});

test("#952: the named keys spec/interaction-events.md:195-197 lists are reachable by their spelled word", () => {
  assert.equal(OL.normalizeKeyWord(" "), "space");
  assert.equal(OL.normalizeKeyWord("Enter"), "enter");
});

test("#952: every key word this module reports is lowercase, as the spec requires", () => {
  for (const key of [
    "ArrowLeft",
    " ",
    "Enter",
    "Escape",
    "Tab",
    "Backspace",
    "Delete",
    "Home",
    "End",
    "PageUp",
    "PageDown",
    "A",
    "Z",
    "F1",
  ]) {
    const word = OL.normalizeKeyWord(key);
    assert.ok(word !== null, `expected ${key} to normalize to a key word`);
    assert.equal(word, word.toLowerCase(), `${key} normalized to "${word}"`);
  }
});

test('#952: a single printable character normalizes to its lowercase word, so on_key "a" fires with Shift down', () => {
  assert.equal(OL.normalizeKeyWord("a"), "a");
  assert.equal(OL.normalizeKeyWord("A"), "a");
  assert.equal(OL.normalizeKeyWord("7"), "7");
});

test("#952: two-word keys use OpenLogo's own underscored spelling", () => {
  assert.equal(OL.normalizeKeyWord("PageUp"), "page_up");
  assert.equal(OL.normalizeKeyWord("PageDown"), "page_down");
});

test("#952: legacy browser key spellings normalize to the same word as their modern name", () => {
  for (const [legacy, modern] of [
    ["Spacebar", " "],
    ["Left", "ArrowLeft"],
    ["Right", "ArrowRight"],
    ["Up", "ArrowUp"],
    ["Down", "ArrowDown"],
    ["Del", "Delete"],
    ["Esc", "Escape"],
  ]) {
    assert.equal(
      OL.normalizeKeyWord(legacy),
      OL.normalizeKeyWord(modern),
      `${legacy} must reach the same key word as ${modern}`,
    );
  }
});

test("#952: a bare modifier is not a key press — it reports null rather than spending a delivery", () => {
  for (const modifier of OL.MODIFIER_KEY_NAMES) {
    assert.equal(
      OL.normalizeKeyWord(modifier),
      null,
      `${modifier} must not become a key word`,
    );
  }
  assert.ok(OL.MODIFIER_KEY_NAMES.includes("Shift"));
  assert.ok(OL.MODIFIER_KEY_NAMES.includes("Unidentified"));
  assert.ok(OL.MODIFIER_KEY_NAMES.includes("Dead"));
});

test("#952: the empty key reports null — no on_key could ever match the empty word", () => {
  assert.equal(OL.normalizeKeyWord(""), null);
});

test("#952: an unlisted key still reaches the program, lowercased, rather than being dropped", () => {
  assert.equal(OL.normalizeKeyWord("F1"), "f1");
  assert.equal(OL.normalizeKeyWord("MediaPlayPause"), "mediaplaypause");
});

test("#952: KEY_WORD_BY_BROWSER_KEY only renames keys whose lowercase form is not already right", () => {
  for (const [browserKey, keyWord] of Object.entries(
    OL.KEY_WORD_BY_BROWSER_KEY,
  )) {
    assert.notEqual(
      browserKey.toLowerCase(),
      keyWord,
      `${browserKey} needs no entry: lowercasing already produces "${keyWord}"`,
    );
  }
});

test("#952 (review round 3): each declaration carries the source position the runtime stamps its registration with, so an unreached one can be told apart", () => {
  const declared = OL.collectDeclaredKeyHandlers(
    [
      'on_key "down" [',
      '  print "d"',
      "]",
      "if false [",
      '  on_key "up" [',
      '    print "u"',
      "  ]",
      "]",
      "wait 3",
    ].join("\n"),
  );

  assert.deepEqual(declared, [
    { keyWord: "down", line: 1, column: 1 },
    { keyWord: "up", line: 5, column: 3 },
  ]);
});

test("#952 (review round 2): collectDeclaredKeyHandlers reads the key words a program's on_key statements name", () => {
  const declared = declaredKeyWordsOf(
    [
      'on_key "left" [',
      "  left 15",
      "]",
      'on_key "space" [',
      "  stamp",
      "]",
      "wait 30",
    ].join("\n"),
  );

  assert.deepEqual([...declared].sort(), ["left", "space"]);
});

test("#952: a program with no on_key declares no key words", () => {
  assert.deepEqual([...declaredKeyWordsOf("forward 100")], []);
});

test("#952: on_key nested inside a block or a procedure is still found", () => {
  const declared = declaredKeyWordsOf(
    [
      "define setup",
      '  on_key "up" [',
      "    forward 10",
      "  ]",
      "end",
      "repeat 1 [",
      '  on_key "down" [',
      "    back 10",
      "  ]",
      "]",
      "setup",
      "wait 10",
    ].join("\n"),
  );

  assert.deepEqual([...declared].sort(), ["down", "up"]);
});

test("#952: a non-literal key word collapses the whole set to null — the safe direction, so nothing is suppressed", () => {
  assert.equal(
    declaredKeyWordsOf(
      [
        ':chosen = "left"',
        "on_key :chosen [",
        "  left 15",
        "]",
        "wait 10",
      ].join("\n"),
    ),
    null,
    "the key word is not knowable before the run, so it must not be silently under-reported",
  );
});

test("#952: the real spec/examples/10-game.logo declares exactly the three keys it names", () => {
  const source = readFileSync(
    fileURLToPath(
      new URL("../../../spec/examples/10-game.logo", import.meta.url),
    ),
    "utf8",
  );

  assert.deepEqual([...declaredKeyWordsOf(source)].sort(), [
    "left",
    "right",
    "up",
  ]);
});
