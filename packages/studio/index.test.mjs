import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { test } from "node:test";
import * as OL from "@openlogo/studio";

/**
 * A headless smoke test proving `index.html`/`web/main.ts` (#279) actually wire the published,
 * fully `node:test`-covered `@openlogo/studio` a11y/persistence/reduced-motion contracts onto
 * real DOM markup — since this monorepo has no `lib.dom`/browser test runner (no jsdom or
 * similar dependency), this reads the two files as plain text and asserts on their literal
 * markup/source rather than executing them. This is intentionally the *only* place either file's
 * textual content is asserted on: `web/main.ts` itself stays outside the coverage gate by design
 * (see its own doc comment), and this test does not change that — it never executes the file, so
 * it adds no coverage and proves no runtime behavior, only that the expected wiring is present in
 * source. A future browser-based (e.g. Playwright) test would be the real end-to-end proof; this
 * is the documented, honest substitute the issue's DoD asks for "since no browser is available
 * in-env."
 */

const packageDir = path.dirname(fileURLToPath(import.meta.url));
const indexHtml = readFileSync(path.join(packageDir, "index.html"), "utf8");
const mainTs = readFileSync(path.join(packageDir, "web", "main.ts"), "utf8");

/** Every opening tag `<...>` in `index.html`, so role/label assertions can check both attributes
 * are declared on the *same* element rather than merely appearing somewhere in the file. */
const openingTags = indexHtml.match(/<[a-zA-Z][^>]*>/g);
assert.ok(
  openingTags,
  "index.html should contain at least one opening HTML tag",
);

test("index.html maps every REPL_LANDMARK_ROLES role/label pair onto the same element", () => {
  for (const landmark of OL.REPL_LANDMARK_ROLES) {
    const matchingTag = openingTags.find(
      (tag) =>
        tag.includes(`role="${landmark.role}"`) &&
        tag.includes(`aria-label="${landmark.label}"`),
    );
    assert.ok(
      matchingTag,
      `expected a single element with role="${landmark.role}" AND aria-label="${landmark.label}" for the ${landmark.region} region`,
    );
  }
});

test("index.html's #lesson-pane wrapper section carries no aria-label of its own — only its nested <nav>/<article> declare the pane's two REPL_LANDMARK_ROLES landmarks, so the pane exposes exactly two accessible landmarks, not three", () => {
  const lessonPaneTag = openingTags.find((tag) =>
    tag.includes('id="lesson-pane"'),
  );
  assert.ok(lessonPaneTag, 'expected an element with id="lesson-pane"');
  assert.doesNotMatch(
    lessonPaneTag,
    /aria-label=/,
    '#lesson-pane must not carry its own aria-label — a <section> with an accessible name is itself an implicit region landmark, which would duplicate the nested <nav aria-label="Lessons"> landmark this pane already declares explicitly',
  );
});

test("index.html's focusable elements appear in exactly REPL_FOCUS_ORDER's DOM order", () => {
  const elementIdByStopId = {
    "lesson-nav-list": "lesson-nav-list",
    editor: "editor",
    "run-button": "run-button",
    "stop-button": "stop-button",
    "reset-button": "reset-button",
    "speed-slider": "speed-slider",
    canvas: "turtle-canvas",
    "diagnostics-list": "diagnostics-list",
  };

  const positions = OL.REPL_FOCUS_ORDER.map((stop) => {
    const elementId = elementIdByStopId[stop.id];
    assert.ok(
      elementId,
      `no DOM element id mapped for focus stop "${stop.id}"`,
    );
    const position = indexHtml.indexOf(`id="${elementId}"`);
    assert.ok(
      position >= 0,
      `expected index.html to contain an element with id="${elementId}"`,
    );
    return position;
  });

  const sorted = [...positions].sort((a, b) => a - b);
  assert.deepEqual(
    positions,
    sorted,
    "focusable elements must appear in index.html in exactly REPL_FOCUS_ORDER's order",
  );
});

test("index.html gives the Canvas and diagnostics list a tabindex (neither is natively focusable)", () => {
  assert.match(
    indexHtml,
    /id="turtle-canvas"[\s\S]*?tabindex="0"/,
    "the turtle canvas must be focusable to be a REPL_FOCUS_ORDER stop",
  );
  assert.match(
    indexHtml,
    /id="diagnostics-list"[\s\S]*?tabindex="0"/,
    "the diagnostics list must be focusable to be a REPL_FOCUS_ORDER stop",
  );
});

test("index.html does NOT give lesson-nav-list its own tabindex — its REPL_FOCUS_ORDER stop is the entry point into its real, natively-focusable per-lesson <button> children (#127), unlike the canvas/diagnostics-list stops above whose containers hold no interactive children of their own", () => {
  const lessonNavListTag = openingTags.find((tag) =>
    tag.includes('id="lesson-nav-list"'),
  );
  assert.ok(lessonNavListTag, 'expected an element with id="lesson-nav-list"');
  assert.doesNotMatch(
    lessonNavListTag,
    /tabindex=/,
    "lesson-nav-list must stay out of the tab order itself so Tab lands directly on its first lesson <button>, not an empty intermediate stop",
  );
});

test("index.html does not render a 'Next step' control (#305) — the headless step() machinery stays for Wave 1 (#302) to rebuild a UI on", () => {
  assert.doesNotMatch(
    indexHtml,
    /id="step-button"/,
    "the step button was removed from the 0.1.0 studio UI",
  );
});

test("index.html declares both always-live aria-live regions createA11yAnnouncer's announcements render into", () => {
  assert.match(
    indexHtml,
    new RegExp(
      `id="${OL.ANNOUNCER_POLITE_ELEMENT_ID}"[\\s\\S]*?aria-live="polite"`,
    ),
  );
  assert.match(
    indexHtml,
    new RegExp(
      `id="${OL.ANNOUNCER_ASSERTIVE_ELEMENT_ID}"[\\s\\S]*?aria-live="assertive"`,
    ),
  );
});

test("index.html declares the non-visual turtle-state status region createTurtleStateRegion feeds", () => {
  assert.match(
    indexHtml,
    /id="turtle-state"[\s\S]*?role="status"[\s\S]*?aria-live="polite"/,
  );
});

test("index.html links the branding stylesheet and renders the DRAW · LEARN · CREATE tagline", () => {
  assert.match(indexHtml, /<link rel="stylesheet" href="\/web\/styles\.css"/);
  assert.match(indexHtml, />DRAW</);
  assert.match(indexHtml, />LEARN</);
  assert.match(indexHtml, />CREATE</);
});

test("web/main.ts wires reduced motion via matchMedia and selectScheduler, never a hardcoded scheduler", () => {
  assert.match(mainTs, /prefers-reduced-motion:\s*reduce/);
  assert.match(mainTs, /window\.matchMedia/);
  assert.match(mainTs, /selectScheduler\(/);
  assert.match(mainTs, /reducedMotion:\s*prefersReducedMotion/);
});

test("web/main.ts wires localStorage persistence via attachPersistence + createKeyValueStorageAdapter", () => {
  assert.match(mainTs, /attachPersistence\(/);
  assert.match(
    mainTs,
    /createKeyValueStorageAdapter\(\s*\(\)\s*=>\s*window\.localStorage\)/,
  );
});

test("web/main.ts wires the screen-reader announcer and the non-visual turtle-state region", () => {
  assert.match(mainTs, /createA11yAnnouncer\(/);
  assert.match(mainTs, /\.subscribeAnnouncements\(/);
  assert.match(mainTs, /selectAnnouncerElementId\(/);
  assert.match(
    mainTs,
    /announcerElementsById\[elementId\]\.textContent\s*=\s*announcement\.message/,
  );
  assert.match(mainTs, /createTurtleStateRegion\(/);
  assert.match(mainTs, /turtleStateRegion\.getText\(\)/);
  assert.match(mainTs, /turtleStateRegion\.subscribeText\(/);
});

test("web/main.ts imports the branding stylesheet", () => {
  assert.match(mainTs, /import\s+"\.\/styles\.css"/);
});

test("web/main.ts asserts every DOM element lookup via the tested assertPresent helper, not a manual if/throw", () => {
  assert.match(mainTs, /assertPresent[<(]/);
  assert.doesNotMatch(
    mainTs,
    /throw new Error\(\s*"index\.html is missing an expected element/,
  );
});

test("web/main.ts syncs the editor's value via the tested syncTextValue helper, not a manual equality check", () => {
  assert.match(mainTs, /syncTextValue\(editorElement, next\.source\)/);
  assert.doesNotMatch(mainTs, /if\s*\(\s*editorElement\.value/);
});

test("index.html declares a labeled #speed-slider range input for the turtle-speed control (#310)", () => {
  assert.match(indexHtml, /id="speed-slider"[\s\S]*?type="range"/);
  assert.match(indexHtml, /<label for="speed-slider">Turtle speed<\/label>/);
});

test("web/main.ts wires the speed slider straight to setSpeedSliderValue on input, with no hardcoded animation delay (#310)", () => {
  assert.match(mainTs, /speedSliderElement\.addEventListener\(\s*"input"/);
  assert.match(mainTs, /shell\.state\.setSpeedSliderValue\(/);
  assert.doesNotMatch(mainTs, /ANIMATION_STEP_DELAY_MS/);
});

test("web/main.ts mirrors the slider's position and its learner-facing description via describeSpeedTickDelayMs, not raw ms (#310)", () => {
  assert.match(mainTs, /describeSpeedTickDelayMs\(/);
  assert.match(mainTs, /mapSpeedSliderValueToTickDelayMs\(/);
  assert.match(
    mainTs,
    /syncTextValue\(speedSliderElement, String\(next\.speedSliderValue\)\)/,
  );
});
