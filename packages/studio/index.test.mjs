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

test("index.html maps every REPL_LANDMARK_ROLES role/label pair onto the same element, except the editor (#315: CM6 sets its own role/label dynamically — see the dedicated editor test below)", () => {
  for (const landmark of OL.REPL_LANDMARK_ROLES) {
    if (landmark.region === "editor") {
      continue;
    }
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

test("#315: index.html declares a plain editor-host container with no static role/aria-label, so CM6's own content-editable (set via editor-cm6.ts's contentAttributes facet) is the only textbox landmark — never a duplicate", () => {
  const hostTag = openingTags.find((tag) => tag.includes('id="editor-host"'));
  assert.ok(hostTag, "expected a #editor-host element for CM6 to mount into");
  assert.doesNotMatch(
    hostTag,
    /role="/,
    'the static host container must not itself declare role="textbox" — CM6\'s real ' +
      "content-editable child does, via editor-cm6.ts's EDITOR_ARIA_ROLE/EDITOR_ARIA_LABEL",
  );
  assert.doesNotMatch(
    hostTag,
    /aria-label="/,
    "the static host container must not itself declare aria-label — see above",
  );
  assert.doesNotMatch(
    indexHtml,
    /<textarea/,
    "the plain <textarea> editor was replaced by CM6 (#315)",
  );
  // The role/label CM6 actually applies (via web/main.ts's createEditorExtensions) must still
  // match the #279 REPL_FOCUS_ORDER/REPL_LANDMARK_ROLES contract exactly.
  const editorStop = OL.REPL_FOCUS_ORDER.find(
    (stop) => stop.region === "editor",
  );
  assert.equal(OL.EDITOR_ARIA_ROLE, editorStop.role);
  assert.equal(OL.EDITOR_ARIA_LABEL, editorStop.label);
});

test("index.html's focusable elements appear in exactly REPL_FOCUS_ORDER's DOM order", () => {
  const elementIdByStopId = {
    "lesson-pane": "lesson-pane",
    editor: "editor-host",
    "run-toggle-button": "run-toggle-button",
    "reset-button": "reset-button",
    "speed-slider": "speed-slider",
    "run-log": "run-log",
    canvas: "turtle-canvas",
    "turtle-state": "turtle-state",
    output: "output",
    "diagnostics-list": "diagnostics-list",
    "tutor-output": "tutor-output",
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

test("index.html gives the lesson pane, Canvas, run log, turtle state, output, and diagnostics list a tabindex (none is natively focusable) (#410)", () => {
  assert.match(
    indexHtml,
    /id="lesson-pane"[\s\S]*?tabindex="0"/,
    "the lesson pane must be focusable to be a REPL_FOCUS_ORDER stop",
  );
  assert.match(
    indexHtml,
    /id="turtle-canvas"[\s\S]*?tabindex="0"/,
    "the turtle canvas must be focusable to be a REPL_FOCUS_ORDER stop",
  );
  assert.match(
    indexHtml,
    /id="run-log"[\s\S]*?tabindex="0"/,
    "the run log must be focusable to be a REPL_FOCUS_ORDER stop (#410)",
  );
  assert.match(
    indexHtml,
    /id="turtle-state"[\s\S]*?tabindex="0"/,
    "the non-visual turtle-state text must be focusable to be a REPL_FOCUS_ORDER stop (#410)",
  );
  assert.match(
    indexHtml,
    /id="output"[\s\S]*?tabindex="0"/,
    "the program output pane must be focusable to be a REPL_FOCUS_ORDER stop (#410)",
  );
  assert.match(
    indexHtml,
    /id="diagnostics-list"[\s\S]*?tabindex="0"/,
    "the diagnostics list must be focusable to be a REPL_FOCUS_ORDER stop",
  );
});

test("index.html does not render a 'Next step' control (#305) — the headless step() machinery stays for Wave 1 (#302) to rebuild a UI on", () => {
  assert.doesNotMatch(
    indexHtml,
    /id="step-button"/,
    "the step button was removed from the 0.1.0 studio UI",
  );
});

test("index.html's lesson pane starts hidden by default (freeform/sandbox mode) (#127)", () => {
  assert.match(
    indexHtml,
    /id="lesson-pane"[\s\S]*?hidden/,
    "the lesson pane must start hidden until a lesson is loaded",
  );
});

test("index.html collapses Run/Stop into a single Start/Stop toggle button (#316, relabeled by #410), with no separate Run/Stop buttons", () => {
  assert.match(indexHtml, /id="run-toggle-button"/);
  assert.doesNotMatch(
    indexHtml,
    /id="run-button"/,
    "the separate Run button was replaced by the Start/Stop toggle",
  );
  assert.doesNotMatch(
    indexHtml,
    /id="stop-button"/,
    "the separate Stop button was replaced by the Start/Stop toggle",
  );
});

test("index.html's Start/Stop toggle has an accessible name, but no aria-pressed (#410: a one-shot Stop action is not a toggle)", () => {
  const toggleTag = openingTags.find((tag) =>
    tag.includes('id="run-toggle-button"'),
  );
  assert.ok(toggleTag, "expected a #run-toggle-button element");
  assert.match(toggleTag, /aria-label="[^"]+"/);
  assert.doesNotMatch(
    toggleTag,
    /aria-pressed/,
    'the run-toggle-button must not declare aria-pressed at all — even "false" tells ' +
      "assistive technology this is a toggle button with a resumable pressed state, which #410 " +
      "explicitly disavows (the button only ever performs a one-shot Start or Stop action)",
  );
  assert.match(toggleTag, /data-icon="(play|stop)"/);
  assert.match(
    indexHtml,
    /id="run-toggle-button"[\s\S]*?class="control-icon" aria-hidden="true"/,
    "the toggle's icon must be aria-hidden, since the button's own aria-label already supplies the accessible name",
  );
});

test("index.html's Reset button has an icon and an accessible name", () => {
  const resetTag = openingTags.find((tag) => tag.includes('id="reset-button"'));
  assert.ok(resetTag, "expected a #reset-button element");
  assert.match(resetTag, /aria-label="Reset"/);
  assert.match(resetTag, /data-icon="reset"/);
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

test("index.html declares the run-log and program-output panes as keyboard-reachable landmarks (#410)", () => {
  assert.match(
    indexHtml,
    /id="run-log"[\s\S]*?role="log"[\s\S]*?aria-label="Run log"/,
  );
  assert.match(
    indexHtml,
    /id="output"[\s\S]*?role="status"[\s\S]*?aria-live="polite"[\s\S]*?aria-label="Program output"/,
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

test("#315: web/main.ts syncs CM6 from the store via the tested decideExternalSync + editorView.dispatch, not a manual textarea equality check", () => {
  assert.match(
    mainTs,
    /decideExternalSync\(\s*externalSyncQueue,\s*editorView\.state,\s*editorView\.composing,\s*next\.source,\s*next\.selection,?\s*\)/,
  );
  assert.match(
    mainTs,
    /if\s*\(\s*spec\s*\)\s*\{\s*editorView\.dispatch\(spec\);/,
  );
  assert.doesNotMatch(mainTs, /if\s*\(\s*editorElement\.value/);
  assert.doesNotMatch(
    mainTs,
    /editorElement/,
    "the plain <textarea> editor element was replaced by editorHostElement + a real CM6 EditorView (#315)",
  );
});

test("#315: web/main.ts reconciles a deferred external sync via a real compositionend DOM event, not a guessed timeout", () => {
  assert.match(
    mainTs,
    /editorView\.dom\.addEventListener\(\s*"compositionend",/,
  );
  assert.match(
    mainTs,
    /reconcileExternalSyncQueue\(\s*externalSyncQueue,\s*editorView\.state\s*\)/,
  );
});

test("#315: web/main.ts constructs a real CM6 EditorView with createEditorExtensions and mounts it into #editor-host", () => {
  assert.match(
    mainTs,
    /import\s*\{\s*EditorState\s*\}\s*from\s*"@codemirror\/state"/,
  );
  assert.match(
    mainTs,
    /import\s*\{[^}]*\bEditorView\b[^}]*\}\s*from\s*"@codemirror\/view"/,
  );
  assert.match(mainTs, /createEditorExtensions\(\{/);
  assert.match(mainTs, /onLocalChange:/);
  assert.match(mainTs, /onLocalSelectionChange:/);
  assert.match(
    mainTs,
    /new EditorView\(\{\s*\n?\s*state:\s*initialEditorState,\s*\n?\s*parent:\s*editorHostElement,?\s*\n?\s*\}\)/,
  );
});

test("#315: web/main.ts toggles a reduced-motion class on the CM6 host from the same matchMedia read used for the run scheduler", () => {
  assert.match(
    mainTs,
    /editorHostElement\.classList\.toggle\(\s*"reduced-motion",\s*prefersReducedMotion\s*\)/,
  );
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

test("web/main.ts mounts the lesson pane via createLessonPaneController + mountLessonPane and renders its view on every state change (#127)", () => {
  assert.match(mainTs, /createLessonPaneController\(state\)/);
  assert.match(mainTs, /mountLessonPane\(shell, lessonPane\)/);
  assert.match(
    mainTs,
    /renderLessonPane\(lessonPaneElement, lessonPane\.getView\(\)\)/,
  );
  assert.match(mainTs, /element\.hidden\s*=\s*!view\.isVisible/);
});

test("web/main.ts wires the Start/Stop toggle via the tested mapRunStatusToRunToggleViewModel, not a branch on runStatus (#316)", () => {
  assert.match(mainTs, /mapRunStatusToRunToggleViewModel\(/);
  assert.match(mainTs, /runToggleButton\.addEventListener\(\s*"click"/);
  assert.doesNotMatch(
    mainTs,
    /if\s*\(\s*(state\.getState\(\)\.)?runStatus\s*===/,
    "the toggle's run()-vs-stop() dispatch must be an indexed lookup, not an if/else branch",
  );
});

test("web/main.ts renders the toggle's icon/aria-label/label from the view model on every state change, and never sets aria-pressed (#410)", () => {
  assert.match(mainTs, /renderRunToggleButton\(/);
  assert.match(mainTs, /runToggleButton\.dataset\.icon\s*=\s*viewModel\.icon/);
  assert.match(
    mainTs,
    /runToggleButton\.setAttribute\(\s*"aria-label",\s*viewModel\.ariaLabel\s*\)/,
  );
  assert.doesNotMatch(
    mainTs,
    /aria-pressed/,
    "#410: the toggle is a one-shot Start/Stop action, not a resumable pause toggle — it must " +
      "never set aria-pressed",
  );
  assert.match(
    mainTs,
    /runToggleLabelElement\.textContent\s*=\s*viewModel\.label/,
  );
});

test("web/main.ts still calls runController.reset() directly from the Reset button (unchanged run-controller semantics, #316)", () => {
  assert.match(mainTs, /resetButton\.addEventListener\(\s*"click"/);
  assert.match(mainTs, /runController\.reset\(\)/);
});
