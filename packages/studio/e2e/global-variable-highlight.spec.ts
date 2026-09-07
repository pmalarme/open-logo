import { expect, test } from "@playwright/test";

/**
 * Browser-real proof that a learner can actually SEE which `:name` reaches shared state (#1106,
 * epic #820, saga #819).
 *
 * `src/highlighter.test.mjs` and `src/editor-cm6.test.mjs` prove the `ol-mod-global` class is
 * computed and lands on the right CM6 decoration; neither can prove it *renders*, because the
 * monorepo's `node:test` runner has no CSS engine. And `layout.spec.ts` — the only other browser
 * spec — deliberately **masks `.pane-editor`**, so its pixel snapshot is structurally blind to
 * everything this slice changes. This file closes both gaps: a real headless Chromium renders the
 * studio, the assertions read `getComputedStyle` off the actual painted spans, and the two
 * snapshots below are of the editor pane *unmasked*.
 *
 * ## What is asserted, and why each half matters
 * The fixture is the maintainer's own program from issue #1106. `:score = :score + 1` is
 * byte-identical whether or not the `local score = 5` line above it exists, and the two versions
 * print `6`/`0` and `1`/`1` respectively — the line means opposite things and looks the same. So:
 *
 *  - the **root-scope** `print :score`, which reaches the shared binding, must be painted;
 *  - the three uses **inside `f`**, which reach the shadowing `local`, must NOT be — the paint
 *    follows the parser's resolution, never the spelling.
 *
 * ## The accessibility assertion is the strict one
 * `spec/rendering.md` forbids conveying anything by color alone. Rather than assert "a second cue
 * exists", this spec asserts that the painted and unpainted spans have the **same computed
 * `color`** — so the distinction provably cannot be carried by color at all — and then that it *is*
 * carried by two channels that survive greyscale and a forced-colors theme: font weight, and a
 * dotted underline (dotted, never `wavy`, so it can never read as a #317 error squiggle).
 */

/** The maintainer's program from issue #1106; the `local` on line 3 shadows the global. */
const SHADOWING_PROGRAM = [
  "global score = 0",
  "define f",
  "  local score = 5",
  "  :score = :score + 1",
  "  print :score",
  "end",
  "f",
  "print :score",
].join("\n");

/**
 * The same program with only the `local score = 5` line deleted, followed by the other two
 * assignment spellings. `spec/execution-model.md:478-481` makes `:x = …`, `set x to …` and
 * `make "x" …` resolve identically, so all three are painted — which is what makes the second
 * snapshot worth committing: it shows the treatment on a `:variable`, on a `primitive` place head,
 * and on a `word/string` literal at once.
 */
const SHARED_PROGRAM = [
  "global score = 0",
  "define f",
  "  :score = :score + 1",
  "  print :score",
  "end",
  "f",
  "set score to 10",
  'make "score" 20',
  "print :score",
].join("\n");

/** The `localStorage` key the studio's browser persistence adapter restores `source` from. */
const PERSISTENCE_KEY = "openlogo.studio.source";

/** The computed styles this spec compares, read off one rendered `:score` span. */
interface PaintedStyle {
  readonly line: number;
  readonly painted: boolean;
  readonly title: string | null;
  readonly color: string;
  readonly fontWeight: string;
  readonly textDecorationLine: string;
  readonly textDecorationStyle: string;
}

/** Seed `program` into persistence, load the studio, and wait for the editor to render it. */
async function openStudioWith(
  page: import("@playwright/test").Page,
  program: string,
): Promise<void> {
  await page.addInitScript(
    ([key, value]) => {
      window.localStorage.setItem(key, value);
    },
    [PERSISTENCE_KEY, program] as const,
  );
  await page.goto("/");
  await expect(page.locator(".cm-content")).toContainText("global score = 0");
}

/**
 * Every rendered `:score` span in the editor, in document order, with the computed styles that
 * decide what a learner sees. Read in one `evaluate` so all of them are measured against the same
 * layout.
 */
async function scoreSpans(
  page: import("@playwright/test").Page,
): Promise<PaintedStyle[]> {
  return page.evaluate(() => {
    const lines = [...document.querySelectorAll(".cm-content .cm-line")];
    const spans: PaintedStyle[] = [];
    for (const [index, line] of lines.entries()) {
      for (const span of line.querySelectorAll("span")) {
        if (span.textContent !== ":score") {
          continue;
        }
        const style = window.getComputedStyle(span);
        spans.push({
          line: index + 1,
          painted: span.classList.contains("ol-mod-global"),
          title: span.getAttribute("title"),
          color: style.color,
          fontWeight: style.fontWeight,
          textDecorationLine: style.textDecorationLine,
          textDecorationStyle: style.textDecorationStyle,
        });
      }
    }
    return spans;
  });
}

test("paints only the `:score` that reaches the shared variable, never the one a local shadows", async ({
  page,
}) => {
  await openStudioWith(page, SHADOWING_PROGRAM);
  const spans = await scoreSpans(page);

  // Four uses: two on the assignment line, one in the procedure's `print`, one at the root.
  expect(spans.map((span) => span.line)).toEqual([4, 4, 5, 8]);
  expect(spans.map((span) => span.painted)).toEqual([
    false,
    false,
    false,
    true,
  ]);

  // Every one of them still carries its ordinary variable class — the modifier is additive.
  const variableSpans = await page
    .locator(".cm-content span.ol-tok-variable", { hasText: ":score" })
    .count();
  expect(variableSpans).toBe(4);
});

test("paints every `:score` once nothing shadows the shared variable", async ({
  page,
}) => {
  // The other half of the maintainer's comparison: with the `local` line gone, the identical
  // `:score = :score + 1` now changes shared state — and now it is painted.
  await openStudioWith(page, SHARED_PROGRAM);
  const spans = await scoreSpans(page);

  expect(spans.map((span) => span.line)).toEqual([3, 3, 4, 9]);
  expect(spans.map((span) => span.painted)).toEqual([true, true, true, true]);

  // The worded spellings resolve to the same binding, so they are painted too, each keeping its
  // own token class (`primitive` for the `set` place head, `word/string` for `make`'s literal).
  await expect(
    page.locator(".cm-content span.ol-tok-primitive.ol-mod-global"),
  ).toHaveText("score");
  await expect(
    page.locator(".cm-content span.ol-tok-string.ol-mod-global"),
  ).toHaveText('"score"');
});

test("the difference is visible without color: same color, different weight and underline", async ({
  page,
}) => {
  await openStudioWith(page, SHADOWING_PROGRAM);
  const spans = await scoreSpans(page);
  const shadowed = spans[0];
  const shared = spans[3];

  expect(shadowed.painted).toBe(false);
  expect(shared.painted).toBe(true);

  // The a11y hard gate: identical color, so nothing here can be conveyed by color alone.
  expect(shared.color).toBe(shadowed.color);

  // Channel 1 — weight. Channel 2 — a dotted underline (never `wavy`: that is #317's error
  // squiggle, and a shared variable is not an error).
  expect(shadowed.fontWeight).toBe("400");
  expect(shared.fontWeight).toBe("700");
  expect(shadowed.textDecorationLine).toBe("none");
  expect(shared.textDecorationLine).toContain("underline");
  expect(shared.textDecorationStyle).toBe("dotted");
});

test("the shared variable carries a plain-language description as its accessible title", async ({
  page,
}) => {
  await openStudioWith(page, SHADOWING_PROGRAM);
  const spans = await scoreSpans(page);

  expect(spans[3].title).toContain("Shared variable");
  expect(spans[3].title).toContain("whole program");
  // Only the painted span: a tooltip on every variable would be noise, not information.
  expect(spans.slice(0, 3).map((span) => span.title)).toEqual([
    null,
    null,
    null,
  ]);
});

test.describe("approved editor snapshots", () => {
  // Wide project only: one baseline per program, at the viewport a learner reads code in. Unlike
  // `layout.spec.ts`, the editor pane is emphatically NOT masked here — the point of these
  // snapshots is the editor's text rendering, so a diff on a treatment change is the evidence.
  test("a local shadowing a global: only the root-scope use is marked", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "wide", "wide-viewport project only");
    await openStudioWith(page, SHADOWING_PROGRAM);
    await expect(page.locator(".pane-editor")).toHaveScreenshot(
      "global-variable-shadowed.png",
    );
  });

  test("nothing shadowing it: every use, in all three spellings, is marked", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "wide", "wide-viewport project only");
    await openStudioWith(page, SHARED_PROGRAM);
    await expect(page.locator(".pane-editor")).toHaveScreenshot(
      "global-variable-shared.png",
    );
  });
});
