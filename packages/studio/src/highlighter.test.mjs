// Unit tests for #285's real syntax-highlighting `HighlightProvider`
// (packages/studio/src/highlighter.ts): the `@openlogo/parser`-backed classifier that maps every
// normative token class onto a stable `ol-tok-*` CSS class, plus the a11y color-contrast
// assertion the #285 hard gate requires.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { OL_TOKEN_CLASSES } from "@openlogo/parser";
import * as OL from "@openlogo/studio";

const {
  OL_HIGHLIGHT_CSS_CLASS,
  OL_HIGHLIGHT_CSS_CLASS_PREFIX,
  createParserHighlighter,
} = OL;

test("OL_HIGHLIGHT_CSS_CLASS maps every one of the 15 normative token classes", () => {
  assert.equal(
    Object.keys(OL_HIGHLIGHT_CSS_CLASS).length,
    OL_TOKEN_CLASSES.length,
  );
  for (const tokenClass of OL_TOKEN_CLASSES) {
    const cssClass = OL_HIGHLIGHT_CSS_CLASS[tokenClass];
    assert.equal(typeof cssClass, "string");
    assert.ok(cssClass.startsWith(OL_HIGHLIGHT_CSS_CLASS_PREFIX));
    // A CSS class must be a valid bare identifier — no `/` or `:` left over from the spec's own
    // "word/string" / ":variable" / "index/dot" spellings.
    assert.match(cssClass, /^[a-z][a-z-]*$/);
  }
});

test("createParserHighlighter classifies keywords, primitives, numbers, strings, and variables", () => {
  const highlighter = createParserHighlighter();
  const tokens = highlighter('define go :n\n  forward :n\nend\nprint "done"');

  const byText = (text) => tokens.find((token) => token.text === text);

  assert.equal(byText("define").class, "ol-tok-keyword");
  assert.equal(byText("end").class, "ol-tok-keyword");
  assert.equal(byText("forward").class, "ol-tok-primitive");
  assert.equal(byText(":n").class, "ol-tok-variable");
  assert.equal(byText("go").class, "ol-tok-procedure-name");
  assert.equal(byText('"done"').class, "ol-tok-string");
});

test("createParserHighlighter classifies numbers, comments, and delimiters", () => {
  const highlighter = createParserHighlighter();
  const tokens = highlighter("repeat 4 [\n  forward 100 # go\n]");

  const byText = (text) => tokens.filter((token) => token.text === text);

  assert.equal(byText("4")[0].class, "ol-tok-number");
  assert.equal(byText("100")[0].class, "ol-tok-number");
  assert.equal(byText("# go")[0].class, "ol-tok-comment");
  assert.ok(byText("[").every((token) => token.class === "ol-tok-bracket"));
  assert.ok(byText("]").every((token) => token.class === "ol-tok-bracket"));
});

test("createParserHighlighter classifies dict braces, operators, and dict keys", () => {
  const highlighter = createParserHighlighter();
  const tokens = highlighter(":ages = { tom: 8 }\nprint :ages.tom");

  const byText = (text) => tokens.find((token) => token.text === text);

  assert.equal(byText("{").class, "ol-tok-brace");
  assert.equal(byText("}").class, "ol-tok-brace");
  assert.equal(byText("=").class, "ol-tok-operator");
  assert.equal(byText("tom").class, "ol-tok-dict-key");
  assert.equal(byText(".").class, "ol-tok-index-dot");
});

test("createParserHighlighter classifies struct type/field names and parens", () => {
  const highlighter = createParserHighlighter();
  const tokens = highlighter(
    "struct point [ x y ]\ndefine move :p\n  set_xy (:p.x) (:p.y)\nend",
  );

  const byText = (text) => tokens.filter((token) => token.text === text);

  assert.equal(byText("point")[0].class, "ol-tok-type-name");
  assert.ok(byText("x").some((token) => token.class === "ol-tok-field-name"));
  assert.ok(byText("y").some((token) => token.class === "ol-tok-field-name"));
  assert.ok(byText("(").every((token) => token.class === "ol-tok-paren"));
  assert.ok(byText(")").every((token) => token.class === "ol-tok-paren"));
});

test("createParserHighlighter never throws on malformed/mid-edit input", () => {
  const highlighter = createParserHighlighter();
  assert.doesNotThrow(() => highlighter("repeat 4 forward"));
  assert.doesNotThrow(() => highlighter(""));
  assert.doesNotThrow(() => highlighter(":ages = { tom"));
});

test("every token's start/end positions round-trip onto the exact source substring", () => {
  const highlighter = createParserHighlighter();
  const source = "forward 100\nright 90";
  const tokens = highlighter(source);
  const lines = source.split("\n");

  // Every token in this fixture is single-line (no multi-line strings/comments), so a same-line
  // slice is sufficient to prove start/end positions round-trip onto the token's own text.
  function slice(start, end) {
    return lines[start[0] - 1].slice(start[1] - 1, end[1] - 1);
  }

  assert.ok(tokens.length > 0);
  for (const token of tokens) {
    assert.equal(token.start[0], token.end[0]);
    assert.equal(slice(token.start, token.end), token.text);
  }
});

// #285 a11y hard gate: coloring must never rely on color alone and must meet WCAG AA (4.5:1)
// contrast for normal text. This reads the exact shipped `web/styles.css` (no duplicated color
// table to drift out of sync) and computes the contrast ratio of every `.ol-tok-*` rule's `color`
// against the editor's white background.
function srgbToLinear(channel) {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(hex) {
  const value = hex.replace("#", "");
  const r = Number.parseInt(value.slice(0, 2), 16);
  const g = Number.parseInt(value.slice(2, 4), 16);
  const b = Number.parseInt(value.slice(4, 6), 16);
  return (
    0.2126 * srgbToLinear(r) +
    0.7152 * srgbToLinear(g) +
    0.0722 * srgbToLinear(b)
  );
}

/**
 * WCAG contrast ratio of a foreground `hex` color against a fixed white (`#ffffff`) background
 * (the `.cm-editor`/`.pane-editor` surface color) — every `.ol-tok-*` rule sets only a text
 * `color`, never a background, so white is always the relevant comparison. `relativeLuminance`
 * of any real (non-white) foreground color is always below white's `1`, so this only ever needs
 * the one fixed ordering, unlike a general-purpose two-color contrast helper.
 */
function contrastAgainstWhite(hex) {
  return (1 + 0.05) / (relativeLuminance(hex) + 0.05);
}

test("every .ol-tok-* rule in web/styles.css meets 4.5:1 contrast against white", () => {
  const stylesPath = fileURLToPath(
    new URL("../web/styles.css", import.meta.url),
  );
  const css = readFileSync(stylesPath, "utf8");
  const ruleRe = /\.ol-tok-([a-z-]+)\s*\{([^}]*)\}/g;
  const found = new Map();
  for (const match of css.matchAll(ruleRe)) {
    const [, name, body] = match;
    const colorMatch = /color:\s*(#[0-9a-fA-F]{6})/.exec(body);
    assert.ok(colorMatch, `.ol-tok-${name} must set a color`);
    found.set(name, colorMatch[1]);
  }

  // Every CSS class this module produces must actually be styled in the shipped stylesheet.
  const expectedNames = new Set(
    Object.values(OL_HIGHLIGHT_CSS_CLASS).map((cssClass) =>
      cssClass.slice(OL_HIGHLIGHT_CSS_CLASS_PREFIX.length),
    ),
  );
  assert.equal(found.size, expectedNames.size);
  for (const name of expectedNames) {
    assert.ok(found.has(name), `web/styles.css is missing .ol-tok-${name}`);
    const ratio = contrastAgainstWhite(found.get(name));
    assert.ok(
      ratio >= 4.5,
      `.ol-tok-${name} (${found.get(name)}) only has ${ratio.toFixed(2)}:1 contrast against white`,
    );
  }
});
