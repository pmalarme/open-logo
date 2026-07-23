import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { test } from "node:test";

/**
 * #410 finding 4 — a holistic-audit review found the studio's DOM tests asserted only that
 * `index.html` declares the right element ids/roles/labels (see `../index.test.mjs`), but no test
 * ever loaded `web/styles.css` itself. That meant a change that silently broke the #313
 * side-by-side grid layout — e.g. deleting `main { display: grid; }`, dropping a `grid-area`
 * declaration, or removing the `@media (min-width: 48rem)` two-column breakpoint — would pass the
 * full test suite untouched: a textbook false-green. This file is the first (and, deliberately,
 * only) place `web/styles.css` is read and asserted on, closing that gap by proving the real
 * layout contract described in the file's own `#313` doc comment: every pane the markup declares
 * has a `grid-area`, the mobile (default) layout stacks all panes in a single column, and the
 * `48rem` breakpoint switches to the two-column grid with the turtle canvas spanning both rows
 * beside the editor/controls column. As with `../index.test.mjs`, this is a textual/source
 * assertion (no CSS engine or browser is available in this monorepo's `node:test` runner), which
 * is enough to catch the exact class of regression the audit found — a real browser-based
 * (e.g. Playwright) visual test would still be the strongest possible proof.
 */

const webDir = path.dirname(fileURLToPath(import.meta.url));
const packageDir = path.dirname(webDir);
const stylesCss = readFileSync(path.join(webDir, "styles.css"), "utf8");
const indexHtml = readFileSync(path.join(packageDir, "index.html"), "utf8");

/** The `.pane-*` classes the #313 grid layout is built from, and the `grid-area` name each one
 * must occupy — mirrors the `main`/`main:has(...)` rules in `styles.css` exactly. */
const PANE_GRID_AREAS = {
  "pane-lesson": "lesson",
  "pane-editor": "editor",
  "pane-controls": "controls",
  "pane-turtle": "turtle",
  "pane-output": "output",
  "pane-diagnostics": "diagnostics",
  "pane-tutor": "tutor",
};

test("web/styles.css declares main as a CSS grid container", () => {
  assert.match(
    stylesCss,
    /main\s*\{[^}]*display:\s*grid;/,
    "the #313 side-by-side layout depends on `main` being a grid container",
  );
});

test("web/styles.css assigns every pane class its own grid-area, matching index.html's markup (#410)", () => {
  for (const [paneClass, gridArea] of Object.entries(PANE_GRID_AREAS)) {
    const ruleMatch = stylesCss.match(
      new RegExp(`\\.${paneClass}\\s*\\{([^}]*)\\}`),
    );
    assert.ok(ruleMatch, `expected a .${paneClass} rule in styles.css`);
    assert.match(
      ruleMatch[1],
      new RegExp(`grid-area:\\s*${gridArea};`),
      `.${paneClass} must occupy the "${gridArea}" grid-area`,
    );
    assert.match(
      indexHtml,
      new RegExp(`class="${paneClass}"`),
      `expected index.html to have an element with class="${paneClass}"`,
    );
  }
});

test("web/styles.css keeps the narrow (default) layout single-column with every visible pane stacked in DOM/focus order (#410)", () => {
  const mainRuleMatch = stylesCss.match(/main\s*\{([^}]*)\}/);
  assert.ok(mainRuleMatch, "expected a `main { ... }` rule in styles.css");
  assert.match(
    mainRuleMatch[1],
    /grid-template-columns:\s*1fr;/,
    "the default/mobile layout must be a single column",
  );
  const areasMatch = mainRuleMatch[1].match(
    /grid-template-areas:\s*((?:"[^"]*"\s*)+)/,
  );
  assert.ok(
    areasMatch,
    "expected `main` to declare grid-template-areas for the default layout",
  );
  const rows = [...areasMatch[1].matchAll(/"([^"]*)"/g)].map(
    (match) => match[1],
  );
  assert.deepEqual(
    rows,
    ["editor", "controls", "turtle", "output", "diagnostics"],
    "the default single-column layout must stack editor, controls, turtle, output, then diagnostics",
  );
});

test("web/styles.css switches to a two-column grid at the 48rem breakpoint, with the turtle canvas spanning both rows beside editor/controls (#410)", () => {
  const mediaStart = stylesCss.indexOf("@media (min-width: 48rem)");
  assert.ok(
    mediaStart >= 0,
    "expected a `@media (min-width: 48rem)` breakpoint in styles.css",
  );
  // The 48rem breakpoint's `main { ... }` rule is the first one after the media query opens.
  const mediaBody = stylesCss.slice(mediaStart);

  const mainRuleMatch = mediaBody.match(/main\s*\{([^}]*)\}/);
  assert.ok(
    mainRuleMatch,
    "expected the 48rem breakpoint to redeclare `main`'s grid",
  );
  assert.match(
    mainRuleMatch[1],
    /grid-template-columns:\s*minmax\(0,\s*1fr\)\s+minmax\(\s*[1-9][\d.]*rem\s*,\s*[1-9][\d.]*fr\s*\);/,
    "the 48rem two-column grid must floor the editor track at 0 (`minmax(0, 1fr)`) so long, " +
      "non-wrapping lines scroll inside the editor instead of stealing width, and give the " +
      "turtle track a NON-ZERO rem-based minimum floor (not `0rem`/`0fr`) so the drawing pane " +
      "keeps a usable minimum size (#472)",
  );
  const areasMatch = mainRuleMatch[1].match(
    /grid-template-areas:\s*((?:"[^"]*"\s*)+)/,
  );
  assert.ok(
    areasMatch,
    "expected the 48rem `main` rule to redeclare grid-template-areas",
  );
  const rows = [...areasMatch[1].matchAll(/"([^"]*)"/g)].map(
    (match) => match[1],
  );
  assert.deepEqual(
    rows,
    [
      "editor turtle",
      "controls turtle",
      "output output",
      "diagnostics diagnostics",
    ],
    "the two-column layout must place editor above controls in the left column, with the turtle " +
      "canvas spanning both rows in the right column, and output/diagnostics full-width below",
  );
});

test("web/styles.css floors every grid item's min-width at 0 so a long editor line can't inflate its column (#472)", () => {
  const sectionRuleMatch = stylesCss.match(/main section\s*\{([^}]*)\}/);
  assert.ok(
    sectionRuleMatch,
    "expected a `main section { ... }` rule in styles.css",
  );
  assert.match(
    sectionRuleMatch[1],
    /min-width:\s*0;/,
    "grid items must set `min-width: 0` — a grid item's default `auto` (min-content) minimum " +
      "would otherwise let a long, non-wrapping CodeMirror line stretch the editor track and " +
      "squeeze the turtle track (#472)",
  );
});

test("web/styles.css makes the turtle canvas grow to its column width and stay square with a usable minimum-size floor (#472)", () => {
  const canvasRuleMatch = stylesCss.match(/#turtle-canvas\s*\{([^}]*)\}/);
  assert.ok(
    canvasRuleMatch,
    "expected a `#turtle-canvas { ... }` rule in styles.css",
  );
  const canvasRule = canvasRuleMatch[1];
  assert.match(
    canvasRule,
    /width:\s*100%;/,
    "the canvas must grow to fill the width available to its column",
  );
  assert.match(
    canvasRule,
    /aspect-ratio:\s*1\s*\/\s*1;/,
    "the canvas must keep a 1:1 aspect ratio as it scales, matching its square backing store",
  );
  assert.match(
    canvasRule,
    /min-width:\s*min\(\s*100%\s*,\s*[1-9][\d.]*rem\s*\);/,
    "the canvas needs a usable minimum size (never a thumbnail), capped at 100% of its pane so a " +
      "very narrow column still scales it down to fit instead of overflowing (#472)",
  );
});

test("web/styles.css keeps the turtle track floored in the lesson-pane :has() three-column layouts too, so the canvas never collapses there (#472)", () => {
  const mediaStart = stylesCss.indexOf("@media (min-width: 48rem)");
  assert.ok(
    mediaStart >= 0,
    "expected a `@media (min-width: 48rem)` breakpoint in styles.css",
  );
  const mediaBody = stylesCss.slice(mediaStart);
  // The lesson-only and lesson+tutor rules both override grid-template-columns with a third
  // (turtle) track; each must keep a non-zero rem floor rather than a bare `1fr`.
  const lessonSelectors = [
    "main:has(.pane-lesson:not([hidden]))",
    "main:has(.pane-lesson:not([hidden])):has(.pane-tutor:not([hidden]))",
  ];
  for (const selector of lessonSelectors) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const ruleMatch = mediaBody.match(
      new RegExp(`${escaped}\\s*\\{([^}]*)\\}`),
    );
    assert.ok(
      ruleMatch,
      `expected a 48rem-breakpoint \`${selector}\` rule in styles.css`,
    );
    const columnsMatch = ruleMatch[1].match(
      /grid-template-columns:\s*([^;]*);/,
    );
    assert.ok(
      columnsMatch,
      `expected \`${selector}\` to declare grid-template-columns`,
    );
    assert.match(
      columnsMatch[1],
      /minmax\(\s*[1-9][\d.]*rem\s*,\s*[1-9][\d.]*fr\s*\)\s*$/,
      `the turtle track (last column) in \`${selector}\` must keep a non-zero rem-based minimum ` +
        `floor so the drawing pane never collapses to a thumbnail when the lesson pane is visible (#472)`,
    );
  }
});

test("web/styles.css keeps the turtle canvas 500x500 backing resolution unchanged — Slice B (#474), not this slice (#472)", () => {
  const canvasTagMatch = indexHtml.match(
    /<canvas\b[^>]*\bid="turtle-canvas"[^>]*>/,
  );
  assert.ok(
    canvasTagMatch,
    'expected a `<canvas id="turtle-canvas" ...>` opening tag in index.html',
  );
  const canvasTag = canvasTagMatch[0];
  assert.match(
    canvasTag,
    /\bwidth="500"/,
    "the canvas backing width attribute must stay 500 (drawing resolution is Slice B #474)",
  );
  assert.match(
    canvasTag,
    /\bheight="500"/,
    "the canvas backing height attribute must stay 500 (drawing resolution is Slice B #474)",
  );
});
