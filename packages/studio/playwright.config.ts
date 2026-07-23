import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright visual-regression config for `@openlogo/studio` (#475, epic #473).
 *
 * This is the browser-rendered counterpart to `web/layout.test.mjs`, which can only assert the
 * *text* of `web/styles.css` because the monorepo's `node:test` runner has no CSS engine or
 * browser. Here a real headless Chromium renders the studio at a **narrow** (< 48rem) and a
 * **wide** (>= 48rem) viewport and proves the responsive drawing-pane layout from slices A (#472)
 * and B (#474) actually lays out — the turtle/drawing pane keeps a usable size and is never
 * squeezed to a thumbnail by the editor column.
 *
 * Deliberately kept OUT of the Node-22 `node:test` coverage gate: these `e2e/*.spec.ts` files are
 * TypeScript and do not match `node --test`'s `*.test.{js,mjs,cjs}` discovery globs, and the `e2e/`
 * directory holds no `.test.mjs`, so the 100% line/branch/function denominator is unchanged. Run it
 * with `npm run test:visual -w @openlogo/studio`.
 *
 * ## Baselines are Linux-only
 * `snapshotPathTemplate` keeps the `{platform}` token in every baseline filename, so a snapshot
 * generated on Linux is `…-linux.png` and one accidentally generated on Windows/macOS is a
 * distinct `…-win32.png`/`…-darwin.png`. Only the `-linux.png` files are committed; the others are
 * git-ignored (see `.gitignore`). CI runs inside the matching
 * `mcr.microsoft.com/playwright:v1.61.1-jammy` container, so committed baselines must be generated
 * in that same image — locally:
 *
 *   docker run --rm -v "${PWD}:/work" -w /work mcr.microsoft.com/playwright:v1.61.1-jammy \
 *     bash -c "npm ci && npm run test:visual -w @openlogo/studio -- --update-snapshots"
 *
 * ## Flaky-run guidance
 * Pixel snapshots tolerate tiny anti-aliasing differences via `maxDiffPixelRatio`; the volatile
 * CodeMirror editor pane (blinking caret, text rendering) is masked in the spec so only the layout
 * geometry is compared. If a legitimate layout change lands, regenerate the baselines with the
 * Docker command above and commit the updated `-linux.png` files in the same PR.
 */

const PORT = 4173;
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  // A committed baseline must never be silently created by a normal CI run: `--update-snapshots`
  // is an explicit, local/Docker action. `.only` left in a spec fails the CI run rather than
  // quietly skipping the rest.
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI
    ? [["github"], ["html", { open: "never" }]]
    : [["html", { open: "never" }]],
  // Keep the platform token so only Linux baselines are committed (see the file header).
  snapshotPathTemplate:
    "{testDir}/__screenshots__/{arg}-{projectName}-{platform}{ext}",
  expect: {
    toHaveScreenshot: {
      // Tolerate sub-pixel anti-aliasing noise; the layout geometry is what we regress on.
      maxDiffPixelRatio: 0.02,
      animations: "disabled",
      caret: "hide",
    },
  },
  use: {
    baseURL: BASE_URL,
    // Deterministic rendering: fixed device pixel ratio and light scheme (the studio has no dark
    // mode) so the backing PNGs are stable across the Docker/CI runs that generate and check them.
    deviceScaleFactor: 1,
    colorScheme: "light",
  },
  projects: [
    {
      name: "narrow",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 390, height: 900 },
      },
    },
    {
      name: "wide",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
      },
    },
  ],
  webServer: {
    // Serve a production build (not the dev server) so no Vite HMR client or dev overlay leaks
    // into the snapshot. `build:web`'s `prebuild:web` runs `tsc -b` first, so the workspace
    // packages the studio composes are built before preview serves them.
    command: `npm run build:web && npm run preview -- --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
