/**
 * The browser entry (#277, extended by #278, #279, #310, and #311) — a thin, logic-free,
 * branch-free wiring layer only. It composes the published `@openlogo/studio` seams (state model,
 * app shell, editor/canvas/run/diagnostics/a11y/persistence controllers) onto the real DOM
 * `index.html` declares; it never reimplements them and holds no non-trivial logic of its own
 * (that lives in `../src/web-bootstrap.ts`, which has its own `.test.mjs` and stays inside the
 * 100% coverage gate — this file is outside `tsconfig.json`'s `src` build graph and is never
 * imported by a test, so it does not need to be, and does not count toward, that gate, and any
 * untested branch here would be invisible to it). Every decision this file would otherwise have to
 * branch on — which scheduler to pace a run through, which `aria-live` region an announcement
 * belongs in, whether a looked-up element is missing, whether the editor's value actually needs
 * rewriting, how a turtle-speed slider position maps to a tick delay or a learner-facing
 * description, which learner-facing label a `runStatus` value maps to — is made by a tested `src/`
 * helper instead (`selectScheduler`, `selectAnnouncerElementId`, `assertPresent`, `syncTextValue`,
 * #310's `mapSpeedSliderValueToTickDelayMs` / `describeSpeedTickDelayMs` in `turtle-speed.ts`, and
 * #311's `mapRunStatusToLabel` in `run-status-label.ts`); this file only reads the raw browser
 * input (`matchMedia`, `localStorage`, `document.getElementById`, the slider's `input` event) and
 * forwards it. The turtle-speed slider (`#speed-slider`) writes straight to the shared state
 * model via `setSpeedSliderValue` on every `input` event — `run-controller.ts`'s `prepare()`
 * reads that value on the next `run()`/`step()`, so no scheduler is rebuilt here. The one
 * remaining loop-shaped statement (`.map(createDiagnosticListItemElement)`, building one `<li>`
 * per already-computed {@link DiagnosticListItem}) has no decision left to make — the
 * label/severity/empty-state choices were already made by `toDiagnosticListItems` — and can't be
 * moved into `web-bootstrap.ts` either, since `document.createElement` needs a real DOM this
 * repository's jsdom-free `node:test` suite doesn't have.
 */

import "./styles.css";
import {
  ANNOUNCER_ASSERTIVE_ELEMENT_ID,
  ANNOUNCER_POLITE_ELEMENT_ID,
  assertPresent,
  attachPersistence,
  createA11yAnnouncer,
  createAppShell,
  createCanvasRenderTarget,
  createCanvasViewController,
  createDiagnosticsController,
  createEditorController,
  createKeyValueStorageAdapter,
  createLessonPaneController,
  createRunController,
  createRunLogController,
  createStudioState,
  createTimeoutScheduler,
  createTurtleStateRegion,
  DEFAULT_RUN_PROGRAM,
  describeSpeedTickDelayMs,
  formatOutput,
  mapRunStatusToLabel,
  mapSpeedSliderValueToTickDelayMs,
  mountCanvasView,
  mountDiagnosticsPane,
  mountEditorPane,
  mountLessonPane,
  mountRunController,
  selectAnnouncerElementId,
  selectScheduler,
  SPEED_SLIDER_MAX,
  SPEED_SLIDER_MIN,
  syncTextValue,
  toDiagnosticListItems,
  toLessonDetailViewItem,
  toLessonNavItems,
  toRunLogListItems,
} from "../src/index.js";
import type {
  DiagnosticListItem,
  Canvas2DContext,
  LessonDetailViewItem,
  LessonNavItem,
  RunLogEntry,
  RunLogEntryViewItem,
} from "../src/index.js";
import type { Diagnostic } from "@openlogo/core";
import { IMMEDIATE_SCHEDULER } from "@openlogo/turtle";

const editorElement = assertPresent(
  document.getElementById("editor"),
  "editor",
  (value): value is HTMLTextAreaElement => value instanceof HTMLTextAreaElement,
);
const canvasElement = assertPresent(
  document.getElementById("turtle-canvas"),
  "turtle-canvas",
  (value): value is HTMLCanvasElement => value instanceof HTMLCanvasElement,
);
const runButton = assertPresent(
  document.getElementById("run-button"),
  "run-button",
  (value): value is HTMLButtonElement => value instanceof HTMLButtonElement,
);
const stopButton = assertPresent(
  document.getElementById("stop-button"),
  "stop-button",
  (value): value is HTMLButtonElement => value instanceof HTMLButtonElement,
);
const resetButton = assertPresent(
  document.getElementById("reset-button"),
  "reset-button",
  (value): value is HTMLButtonElement => value instanceof HTMLButtonElement,
);
const speedSliderElement = assertPresent(
  document.getElementById("speed-slider"),
  "speed-slider",
  (value): value is HTMLInputElement => value instanceof HTMLInputElement,
);
const speedDescriptionElement = assertPresent<HTMLElement>(
  document.getElementById("speed-description"),
  "speed-description",
);
speedSliderElement.min = String(SPEED_SLIDER_MIN);
speedSliderElement.max = String(SPEED_SLIDER_MAX);
const runStatusElement = assertPresent<HTMLElement>(
  document.getElementById("run-status"),
  "run-status",
);
const outputElement = assertPresent<HTMLElement>(
  document.getElementById("output"),
  "output",
);
const diagnosticsListElement = assertPresent<HTMLElement>(
  document.getElementById("diagnostics-list"),
  "diagnostics-list",
);
const runLogElement = assertPresent<HTMLElement>(
  document.getElementById("run-log"),
  "run-log",
);
const lessonNavListElement = assertPresent<HTMLElement>(
  document.getElementById("lesson-nav-list"),
  "lesson-nav-list",
);
const lessonDetailElement = assertPresent<HTMLElement>(
  document.getElementById("lesson-detail"),
  "lesson-detail",
);
const turtleStateElement = assertPresent<HTMLElement>(
  document.getElementById("turtle-state"),
  "turtle-state",
);
const announcerPoliteElement = assertPresent<HTMLElement>(
  document.getElementById("announcer-polite"),
  "announcer-polite",
);
const announcerAssertiveElement = assertPresent<HTMLElement>(
  document.getElementById("announcer-assertive"),
  "announcer-assertive",
);

const canvasContext = assertPresent<Canvas2DContext>(
  canvasElement.getContext("2d"),
  "2-D canvas context",
);

/** Looks up the always-live region a {@link selectAnnouncerElementId} result names — an indexed
 * lookup, not a branch, so this stays a straight-line wiring statement (see this module's doc
 * comment). */
const announcerElementsById: Readonly<Record<string, HTMLElement>> = {
  [ANNOUNCER_POLITE_ELEMENT_ID]: announcerPoliteElement,
  [ANNOUNCER_ASSERTIVE_ELEMENT_ID]: announcerAssertiveElement,
};

const state = createStudioState({ source: DEFAULT_RUN_PROGRAM });

attachPersistence(state, {
  adapter: createKeyValueStorageAdapter(() => window.localStorage),
});

const shell = createAppShell(state);

mountEditorPane(shell, createEditorController(state));

const canvasView = createCanvasViewController(state, {
  target: createCanvasRenderTarget(canvasContext),
  viewport: { width: canvasElement.width, height: canvasElement.height },
});
mountCanvasView(shell, canvasView);

mountDiagnosticsPane(shell, createDiagnosticsController(state));

const prefersReducedMotion = window.matchMedia(
  "(prefers-reduced-motion: reduce)",
).matches;
const timeoutScheduler = createTimeoutScheduler({
  setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  clearTimeout: (handle) => globalThis.clearTimeout(handle),
});
const scheduler = selectScheduler(
  prefersReducedMotion,
  timeoutScheduler,
  IMMEDIATE_SCHEDULER,
);
const runController = createRunController(state, {
  canvasView,
  scheduler,
  reducedMotion: prefersReducedMotion,
});
mountRunController(shell, runController);

const runLog = createRunLogController(state);

const lessonPane = createLessonPaneController(state);
mountLessonPane(shell, lessonPane);

const announcer = createA11yAnnouncer(state);
announcer.subscribeAnnouncements((announcement) => {
  const elementId = selectAnnouncerElementId(announcement.politeness);
  announcerElementsById[elementId].textContent = announcement.message;
});

const turtleStateRegion = createTurtleStateRegion(state);
turtleStateElement.textContent = turtleStateRegion.getText();
turtleStateRegion.subscribeText((text) => {
  turtleStateElement.textContent = text;
});

editorElement.value = state.getState().source;
editorElement.addEventListener("input", () => {
  shell.state.setSource(editorElement.value);
});
runButton.addEventListener("click", () => {
  runController.run();
});
stopButton.addEventListener("click", () => {
  runController.stop();
});
resetButton.addEventListener("click", () => {
  runController.reset();
});
speedSliderElement.addEventListener("input", () => {
  shell.state.setSpeedSliderValue(speedSliderElement.valueAsNumber);
});

/** Builds one `<li>` per already-formatted {@link DiagnosticListItem} — plain DOM element
 * creation with no decision of its own (the label/severity/empty-state DECISIONS were already
 * made by {@link toDiagnosticListItems}), so it stays a one-line-per-item mapping rather than an
 * `if`/`for` block. It can't be unit-tested directly (this repository has no jsdom, and
 * `document.createElement` doesn't exist outside a real DOM), unlike every other helper this
 * module calls. */
function createDiagnosticListItemElement(
  item: DiagnosticListItem,
): HTMLLIElement {
  const listItem = document.createElement("li");
  listItem.textContent = item.label;
  listItem.dataset.severity = item.severity;
  return listItem;
}

function renderDiagnostics(
  list: HTMLElement,
  diagnostics: readonly Diagnostic[],
): void {
  list.replaceChildren(
    ...toDiagnosticListItems(diagnostics).map(createDiagnosticListItemElement),
  );
}

/** Builds one `<li>` per already-projected {@link RunLogEntryViewItem} — again plain DOM element
 * creation with no decision of its own (heading/output/diagnostic-label/empty-state DECISIONS were
 * already made by {@link toRunLogListItems}), so this stays a one-line-per-item mapping rather than
 * an `if`/`for` block, matching {@link createDiagnosticListItemElement} above. */
function createRunLogEntryElement(item: RunLogEntryViewItem): HTMLLIElement {
  const listItem = document.createElement("li");
  listItem.dataset.hasErrors = String(item.hasErrors);

  const heading = document.createElement("p");
  heading.className = "run-log-heading";
  heading.textContent = item.heading;

  const output = document.createElement("pre");
  output.className = "run-log-output";
  output.textContent = item.outputText;

  const diagnosticsList = document.createElement("ul");
  diagnosticsList.className = "run-log-diagnostics";
  diagnosticsList.replaceChildren(
    ...item.diagnosticLabels.map((label) => {
      const diagnosticItem = document.createElement("li");
      diagnosticItem.textContent = label;
      return diagnosticItem;
    }),
  );

  listItem.replaceChildren(heading, output, diagnosticsList);
  return listItem;
}

function renderRunLog(
  list: HTMLElement,
  entries: readonly RunLogEntry[],
): void {
  list.replaceChildren(
    ...toRunLogListItems(entries).map(createRunLogEntryElement),
  );
}

/** Builds one clickable `<li>`/`<button>` per already-projected {@link LessonNavItem} — plain DOM
 * element creation with no decision of its own (the label/selection DECISION was already made by
 * {@link toLessonNavItems}); clicking a button just forwards its id to
 * {@link LessonPaneController.selectLesson}, which republishes through the shared state model, so
 * this stays a thin, branch-free wiring layer like every other `create*Element` helper above. */
function createLessonNavItemElement(item: LessonNavItem): HTMLLIElement {
  const listItem = document.createElement("li");

  const button = document.createElement("button");
  button.type = "button";
  button.className = "lesson-nav-item";
  button.textContent = `${item.title} (Level ${item.level})`;
  button.setAttribute("aria-current", String(item.isSelected));
  button.addEventListener("click", () => {
    lessonPane.selectLesson(item.id);
  });

  listItem.replaceChildren(button);
  return listItem;
}

function renderLessonNav(
  list: HTMLElement,
  selectedLessonId: string | null,
): void {
  list.replaceChildren(
    ...toLessonNavItems(lessonPane.getLessons(), selectedLessonId).map(
      createLessonNavItemElement,
    ),
  );
}

/** Builds one worked-example `<div>` per already-projected item — verbatim `source`/`explanation`
 * text from `@openlogo/edu`'s #189 contract, no reformatting. */
function createLessonWorkedExampleElement(item: {
  readonly source: string;
  readonly explanation: string;
}): HTMLDivElement {
  const container = document.createElement("div");
  container.className = "lesson-detail-worked-example";

  const source = document.createElement("pre");
  source.textContent = item.source;

  const explanation = document.createElement("p");
  explanation.textContent = item.explanation;

  container.replaceChildren(source, explanation);
  return container;
}

/** Renders the lesson detail article from an already-projected {@link LessonDetailViewItem} —
 * the `hasLesson`/empty-state DECISION was already made by {@link toLessonDetailViewItem}; this
 * only branches on that precomputed flag to choose which fixed set of nodes to build. */
function renderLessonDetail(
  article: HTMLElement,
  item: LessonDetailViewItem,
): void {
  if (!item.hasLesson) {
    const empty = document.createElement("p");
    empty.textContent = item.emptyStateLabel;
    article.replaceChildren(empty);
    return;
  }

  const heading = document.createElement("h2");
  heading.textContent = item.title;

  const level = document.createElement("p");
  level.textContent = `Level ${item.level}`;

  const objective = document.createElement("p");
  objective.textContent = item.objective;

  const workedExamplesHeading = document.createElement("h3");
  workedExamplesHeading.textContent = "Worked examples";

  const workedExamples = document.createElement("div");
  workedExamples.replaceChildren(
    ...item.workedExamples.map(createLessonWorkedExampleElement),
  );

  const exercisePromptHeading = document.createElement("h3");
  exercisePromptHeading.textContent = "Your turn";

  const exercisePrompt = document.createElement("p");
  exercisePrompt.textContent = item.exercisePrompt;

  article.replaceChildren(
    heading,
    level,
    objective,
    workedExamplesHeading,
    workedExamples,
    exercisePromptHeading,
    exercisePrompt,
  );
}

state.subscribe((next) => {
  syncTextValue(editorElement, next.source);
  runStatusElement.textContent = mapRunStatusToLabel(next.runStatus);
  outputElement.textContent = formatOutput(next.output);
  renderDiagnostics(diagnosticsListElement, next.diagnostics);
  syncTextValue(speedSliderElement, String(next.speedSliderValue));
  speedDescriptionElement.textContent = describeSpeedTickDelayMs(
    mapSpeedSliderValueToTickDelayMs(next.speedSliderValue),
  );
  renderLessonNav(lessonNavListElement, next.lesson.lessonId);
  renderLessonDetail(
    lessonDetailElement,
    toLessonDetailViewItem(lessonPane.getSelectedLesson()),
  );
});
runLog.subscribeEntries(() => {
  renderRunLog(runLogElement, runLog.getEntries());
});
runStatusElement.textContent = mapRunStatusToLabel(state.getState().runStatus);
outputElement.textContent = formatOutput(state.getState().output);
renderDiagnostics(diagnosticsListElement, state.getState().diagnostics);
renderRunLog(runLogElement, runLog.getEntries());
syncTextValue(speedSliderElement, String(state.getState().speedSliderValue));
speedDescriptionElement.textContent = describeSpeedTickDelayMs(
  mapSpeedSliderValueToTickDelayMs(state.getState().speedSliderValue),
);
renderLessonNav(lessonNavListElement, state.getState().lesson.lessonId);
renderLessonDetail(
  lessonDetailElement,
  toLessonDetailViewItem(lessonPane.getSelectedLesson()),
);
