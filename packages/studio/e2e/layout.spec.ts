import { expect, test } from "@playwright/test";

/**
 * Browser visual-regression for the responsive studio layout (#475, epic #473).
 *
 * `web/layout.test.mjs` proves the #313/#472 grid *rules* exist in `web/styles.css` by reading the
 * file as text — it cannot prove they actually lay out, because the monorepo's `node:test` runner
 * has no browser. This spec closes that gap: a real headless Chromium renders the studio and
 * asserts the drawing (turtle) pane's real geometry plus a pixel snapshot, at a narrow (< 48rem)
 * and a wide (>= 48rem) viewport (the two Playwright projects in `playwright.config.ts`).
 *
 * The core regression this epic fixes is the drawing pane being squeezed to a thumbnail by the
 * editor column (#472). The geometry assertions below fail exactly in that case — e.g. if
 * `main section { min-width: 0 }` is dropped so a long, non-wrapping editor line inflates the
 * editor track, or if the turtle track loses its weighted/floored width — which the seeded
 * long-line program deliberately provokes.
 */

/**
 * A program whose second line is long and non-wrapping. CodeMirror does not wrap, so without the
 * `min-width: 0` floor on the grid items this line would stretch the editor column and steal width
 * from the turtle track — precisely the #472 regression the geometry checks guard against.
 */
const LONG_LINE_PROGRAM = [
  "repeat 4 [ forward 100 right 90 ]",
  `# ${"a-really-long-non-wrapping-comment-line ".repeat(12)}`,
].join("\n");

/** The `localStorage` key the studio's browser persistence adapter restores `source` from. */
const PERSISTENCE_KEY = "openlogo.studio.source";

/** Read an element's rendered box, failing loudly if it is not laid out. */
async function boundingBox(
  page: import("@playwright/test").Page,
  selector: string,
) {
  const box = await page.locator(selector).boundingBox();
  expect(box, `expected a rendered box for "${selector}"`).not.toBeNull();
  return box!;
}

test.beforeEach(async ({ page }) => {
  // Seed the editor with the long-line program before any page script runs, so persistence
  // restores it into the editor on load (mirrors a learner returning to saved, wide work).
  await page.addInitScript(
    ([key, value]) => {
      window.localStorage.setItem(key, value);
    },
    [PERSISTENCE_KEY, LONG_LINE_PROGRAM] as const,
  );
  await page.goto("/");
  // The canvas-view controller writes the initial turtle description once it has rendered the
  // first frame — a reliable, render-agnostic signal that the drawing pane is laid out.
  await expect(page.locator("#turtle-canvas")).toBeVisible();
  await expect(page.locator("#turtle-state")).not.toBeEmpty();
});

test.describe("narrow viewport (< 48rem): panes stack, drawing pane stays usable", () => {
  test("stacks editor, controls and turtle in a single column with a usably-sized canvas", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "narrow",
      "narrow-viewport project only",
    );

    const viewport = page.viewportSize()!;
    const editor = await boundingBox(page, ".pane-editor");
    const controls = await boundingBox(page, ".pane-controls");
    const turtle = await boundingBox(page, ".pane-turtle");
    const canvas = await boundingBox(page, "#turtle-canvas");

    // Single column: every pane shares the same left edge (within sub-pixel rounding).
    expect(Math.abs(turtle.x - editor.x)).toBeLessThan(4);
    expect(Math.abs(controls.x - editor.x)).toBeLessThan(4);

    // Stacked in DOM/focus order: editor, then controls, then turtle, top to bottom.
    expect(controls.y).toBeGreaterThan(editor.y + editor.height - 4);
    expect(turtle.y).toBeGreaterThan(controls.y + controls.height - 4);

    // The canvas keeps a usable minimum size (never collapsed to a thumbnail) and still fits
    // inside the narrow viewport rather than overflowing it.
    expect(canvas.width).toBeGreaterThanOrEqual(240);
    expect(canvas.width).toBeLessThanOrEqual(viewport.width);
    // It stays square, matching its 1:1 aspect-ratio / 500x500 backing store.
    expect(Math.abs(canvas.width - canvas.height)).toBeLessThan(2);
  });
});

test.describe("wide viewport (>= 48rem): drawing pane takes its intended share", () => {
  test("places the turtle canvas beside the editor and keeps it larger, not squeezed", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "wide", "wide-viewport project only");

    const main = await boundingBox(page, "main");
    const editor = await boundingBox(page, ".pane-editor");
    const turtle = await boundingBox(page, ".pane-turtle");
    const canvas = await boundingBox(page, "#turtle-canvas");

    // Two columns: the turtle pane sits to the right of the editor, sharing the top row.
    expect(turtle.x).toBeGreaterThan(editor.x + editor.width - 4);
    expect(Math.abs(turtle.y - editor.y)).toBeLessThan(4);

    // The drawing pane keeps its intended, weighted-larger share — the long editor line scrolls
    // inside the editor (min-width: 0) instead of squeezing the turtle track. If a regression let
    // the editor column steal width, the turtle pane would become the narrower one and this fails.
    expect(turtle.width).toBeGreaterThan(editor.width);

    // And in absolute terms the canvas is a real drawing surface, not a thumbnail: a large fixed
    // floor plus a healthy fraction of the overall layout width.
    expect(canvas.width).toBeGreaterThanOrEqual(380);
    expect(canvas.width).toBeGreaterThanOrEqual(main.width * 0.35);
    expect(Math.abs(canvas.width - canvas.height)).toBeLessThan(2);
  });
});

test("matches the approved layout snapshot", async ({ page }) => {
  // Screenshot the whole layout region. The editor pane is masked: its blinking caret and text
  // rendering are volatile and irrelevant to the layout contract this snapshot guards — the
  // turtle/drawing pane's size and position are what must stay stable.
  await expect(page.locator("main")).toHaveScreenshot("studio-layout.png", {
    mask: [page.locator(".pane-editor")],
  });
});
