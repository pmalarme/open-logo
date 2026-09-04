import assert from "node:assert/strict";
import { test } from "node:test";
import * as OL from "@openlogo/studio";

/**
 * `key-words.ts` (#952) — the studio's documented `on_key` vocabulary and the normalization
 * `spec/interaction-events.md:273-277` asks for ("Implementations SHOULD document their supported
 * key words and SHOULD normalize physical keyboard input to those lowercase words **for
 * accessibility**").
 *
 * The declaration-reading half of this module (`collectDeclaredKeyHandlers`, which paired `on_key`
 * statements to registration events by source position) was deleted at #976, when the runtime began
 * reporting deliveries directly. Its tests went with it. Normalization stays: it maps a browser
 * `KeyboardEvent.key` onto the spec's vocabulary and is not reconstruction.
 */

test("#952: the four arrows normalize to the spec's own examples", () => {
  assert.equal(OL.normalizeKeyWord("ArrowLeft"), "left");
  assert.equal(OL.normalizeKeyWord("ArrowRight"), "right");
  assert.equal(OL.normalizeKeyWord("ArrowUp"), "up");
  assert.equal(OL.normalizeKeyWord("ArrowDown"), "down");
});

test("#952: the named keys spec/interaction-events.md:274-276 lists are reachable by their spelled word", () => {
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
