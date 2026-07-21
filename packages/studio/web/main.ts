/**
 * The browser entry (#277, extended by #278, #279, #310, #311, #127, and #316) — a thin,
 * logic-free,
 * branch-free wiring layer only. It composes the published `@openlogo/studio` seams (state model,
 * app shell, editor/canvas/run/diagnostics/lesson-pane/a11y/persistence controllers) onto the real
 * DOM `index.html` declares; it never reimplements them and holds no non-trivial logic of its own
 * (that lives in `../src/web-bootstrap.ts`, which has its own `.test.mjs` and stays inside the
 * 100% coverage gate — this file is outside `tsconfig.json`'s `src` build graph and is never
 * imported by a test, so it does not need to be, and does not count toward, that gate, and any
 * untested branch here would be invisible to it). Every decision this file would otherwise have to
 * branch on — which scheduler to pace a run through, which `aria-live` region an announcement
 * belongs in, whether a looked-up element is missing, whether the editor's value actually needs
 * rewriting, how a turtle-speed slider position maps to a tick delay or a learner-facing
 * description, which learner-facing label a `runStatus` value maps to, which icon/label/aria state
 * the Start/Pause toggle button shows and which of `run()`/`stop()` a click invokes, whether a
 * lesson is loaded and what its objective/worked-examples/exercise-prompt content is — is made by a
 * tested `src/` helper instead (`selectScheduler`, `selectAnnouncerElementId`, `assertPresent`,
 * `syncTextValue`, #310's `mapSpeedSliderValueToTickDelayMs` / `describeSpeedTickDelayMs` in
 * `turtle-speed.ts`, #311's `mapRunStatusToLabel` in `run-status-label.ts`, #127's
 * `createLessonPaneController` / `LessonPaneView` in `lesson-pane.ts`, and #316's
 * `mapRunStatusToRunToggleViewModel` in `run-controls.ts`); this file only reads the raw browser
 * input (`matchMedia`, `localStorage`, `document.getElementById`, the slider's `input` event) and
 * forwards it. The turtle-speed slider (`#speed-slider`) writes straight to the shared state
 * model via `setSpeedSliderValue` on every `input` event — `run-controller.ts`'s `prepare()`
 * reads that value on the next `run()`/`step()`, so no scheduler is rebuilt here. `runToggleActionHandlers`
 * and `renderRunToggleButton` (#316) apply an already-decided `RunToggleViewModel` onto the single
 * `#run-toggle-button` via an indexed lookup and plain attribute assignment — never a branch on
 * `runStatus` itself, matching every other mapping this file consumes. The remaining loop-shaped
 * statements (`.map(createDiagnosticListItemElement)`, `.map(createRunLogEntryElement)`,
 * `.map(createWorkedExampleElement)`, each building one element per already-computed view item)
 * have no decision left to make — the label/severity/empty-state/heading/explanation choices were
 * already made by `toDiagnosticListItems` / `toRunLogListItems` / `lesson-pane.ts`'s `toView` — and
 * can't be moved into `web-bootstrap.ts` either, since `document.createElement` needs a real DOM
 * this repository's jsdom-free `node:test` suite doesn't have.
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
  createTutorOutputController,
  DEFAULT_RUN_PROGRAM,
  describeSpeedTickDelayMs,
  formatOutput,
  mapRunStatusToLabel,
  mapRunStatusToRunToggleViewModel,
  mapSpeedSliderValueToTickDelayMs,
  mountCanvasView,
  mountDiagnosticsPane,
  mountEditorPane,
  mountLessonPane,
  mountRunController,
  mountTutorOutputPane,
  selectAnnouncerElementId,
  selectScheduler,
  SPEED_SLIDER_MAX,
  SPEED_SLIDER_MIN,
  syncTextValue,
  toDiagnosticListItems,
  toRunLogListItems,
  toTutorOutputListItems,
} from "../src/index.js";
import type {
  DiagnosticListItem,
  Canvas2DContext,
  LessonPaneView,
  RunLogEntry,
  RunLogEntryViewItem,
  TutorOutputEntry,
  TutorOutputViewItem,
  WorkedExampleViewItem,
  RunStatus,
  RunToggleAction,
} from "../src/index.js";
import type { Diagnostic } from "@openlogo/core";
import { IMMEDIATE_SCHEDULER } from "@openlogo/turtle";

const lessonPaneElement = assertPresent<HTMLElement>(
  document.getElementById("lesson-pane"),
  "lesson-pane",
);
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
const runToggleButton = assertPresent(
  document.getElementById("run-toggle-button"),
  "run-toggle-button",
  (value): value is HTMLButtonElement => value instanceof HTMLButtonElement,
);
const runToggleLabelElement = assertPresent<HTMLElement>(
  document.getElementById("run-toggle-label"),
  "run-toggle-label",
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
const tutorOutputElement = assertPresent<HTMLElement>(
  document.getElementById("tutor-output"),
  "tutor-output",
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

const lessonPane = createLessonPaneController(state);
mountLessonPane(shell, lessonPane);

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

const tutorOutput = createTutorOutputController(state);
mountTutorOutputPane(shell, tutorOutput);

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

/** Looks up the `RunController` method a Start/Pause toggle click should invoke for the
 * `RunToggleAction` `mapRunStatusToRunToggleViewModel` already decided — an indexed lookup, not a
 * branch on `runStatus` itself (see this module's doc comment). */
const runToggleActionHandlers: Readonly<Record<RunToggleAction, () => void>> = {
  run: () => runController.run(),
  stop: () => runController.stop(),
};

editorElement.value = state.getState().source;
editorElement.addEventListener("input", () => {
  shell.state.setSource(editorElement.value);
});
runToggleButton.addEventListener("click", () => {
  const { action } = mapRunStatusToRunToggleViewModel(
    state.getState().runStatus,
  );
  runToggleActionHandlers[action]();
});
resetButton.addEventListener("click", () => {
  runController.reset();
});
speedSliderElement.addEventListener("input", () => {
  shell.state.setSpeedSliderValue(speedSliderElement.valueAsNumber);
});

/** Applies the Start/Pause toggle button's already-decided presentation
 * ({@link mapRunStatusToRunToggleViewModel}) onto the real DOM button — plain attribute/text
 * assignment, no decision of its own (#316). */
function renderRunToggleButton(runStatus: RunStatus): void {
  const viewModel = mapRunStatusToRunToggleViewModel(runStatus);
  runToggleButton.dataset.icon = viewModel.icon;
  runToggleButton.setAttribute("aria-label", viewModel.ariaLabel);
  runToggleButton.setAttribute("aria-pressed", String(viewModel.ariaPressed));
  runToggleLabelElement.textContent = viewModel.label;
}

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

/** Builds one `<li>` per already-projected {@link TutorOutputViewItem} — plain DOM element
 * creation with no decision of its own (the heading/segment text was already decided by
 * {@link toTutorOutputListItems}), matching {@link createRunLogEntryElement} above. */
function createTutorOutputEntryElement(
  item: TutorOutputViewItem,
): HTMLLIElement {
  const listItem = document.createElement("li");

  const heading = document.createElement("p");
  heading.className = "tutor-output-heading";
  heading.textContent = item.heading;

  const segments = document.createElement("div");
  segments.className = "tutor-output-segments";
  segments.replaceChildren(
    ...item.segments.map((segment) => {
      const paragraph = document.createElement("p");
      paragraph.textContent = segment;
      return paragraph;
    }),
  );

  listItem.replaceChildren(heading, segments);
  return listItem;
}

/** Renders the tutor-output pane: hidden until `explain`/`why`/`hint`/`debug` has ever run (per
 * {@link TutorOutputController.getView}'s `isVisible`, matching {@link renderLessonPane}'s direct
 * `hidden` read), then one `<li>` per recorded entry via {@link createTutorOutputEntryElement}. */
function renderTutorOutput(
  list: HTMLElement,
  entries: readonly TutorOutputEntry[],
): void {
  list.hidden = entries.length === 0;
  list.replaceChildren(
    ...toTutorOutputListItems(entries).map(createTutorOutputEntryElement),
  );
}

/** Builds one worked-example block per already-projected {@link WorkedExampleViewItem} — plain DOM
 * element creation with no decision of its own (`lesson-pane.ts`'s `toView` already picked which
 * worked examples exist and in what order), matching {@link createRunLogEntryElement} above. */
function createWorkedExampleElement(
  item: WorkedExampleViewItem,
): HTMLDivElement {
  const container = document.createElement("div");
  container.className = "worked-example";

  const heading = document.createElement("h3");
  heading.textContent = "Worked example";

  const source = document.createElement("pre");
  source.className = "worked-example-source";
  source.textContent = item.source;

  const explanation = document.createElement("p");
  explanation.className = "worked-example-explanation";
  explanation.textContent = item.explanation;

  container.replaceChildren(heading, source, explanation);
  return container;
}

/** Renders the lesson pane's whole heading structure (`<h2>` title, `<h3>` Objective, one worked
 * example block per {@link createWorkedExampleElement}, `<h3>` exercise prompt) from an already
 * fully-formed {@link LessonPaneView} — `lesson-pane.ts`'s `toView`/`NO_LESSON_VIEW` made every
 * content decision, so the only branch-shaped statement left is the direct `hidden` assignment
 * (not a decision — a straight read of an already-computed boolean, per this module's doc
 * comment), plus the one tolerated loop mapping worked examples to elements. */
function renderLessonPane(element: HTMLElement, view: LessonPaneView): void {
  element.hidden = !view.isVisible;

  const title = document.createElement("h2");
  title.textContent = view.title;

  const objectiveHeading = document.createElement("h3");
  objectiveHeading.textContent = "Objective";
  const objective = document.createElement("p");
  objective.textContent = view.objective;

  const exercisePromptHeading = document.createElement("h3");
  exercisePromptHeading.textContent = "Try it";
  const exercisePrompt = document.createElement("p");
  exercisePrompt.textContent = view.exercisePrompt;

  element.replaceChildren(
    title,
    objectiveHeading,
    objective,
    ...view.workedExamples.map(createWorkedExampleElement),
    exercisePromptHeading,
    exercisePrompt,
  );
}

state.subscribe((next) => {
  syncTextValue(editorElement, next.source);
  runStatusElement.textContent = mapRunStatusToLabel(next.runStatus);
  renderRunToggleButton(next.runStatus);
  outputElement.textContent = formatOutput(next.output);
  renderDiagnostics(diagnosticsListElement, next.diagnostics);
  syncTextValue(speedSliderElement, String(next.speedSliderValue));
  speedDescriptionElement.textContent = describeSpeedTickDelayMs(
    mapSpeedSliderValueToTickDelayMs(next.speedSliderValue),
  );
  renderLessonPane(lessonPaneElement, lessonPane.getView());
});
runLog.subscribeEntries(() => {
  renderRunLog(runLogElement, runLog.getEntries());
});
tutorOutput.subscribeEntries(() => {
  renderTutorOutput(tutorOutputElement, tutorOutput.getEntries());
});
runStatusElement.textContent = mapRunStatusToLabel(state.getState().runStatus);
renderRunToggleButton(state.getState().runStatus);
outputElement.textContent = formatOutput(state.getState().output);
renderDiagnostics(diagnosticsListElement, state.getState().diagnostics);
renderRunLog(runLogElement, runLog.getEntries());
renderTutorOutput(tutorOutputElement, tutorOutput.getEntries());
syncTextValue(speedSliderElement, String(state.getState().speedSliderValue));
speedDescriptionElement.textContent = describeSpeedTickDelayMs(
  mapSpeedSliderValueToTickDelayMs(state.getState().speedSliderValue),
);
renderLessonPane(lessonPaneElement, lessonPane.getView());
