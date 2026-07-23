/**
 * The browser entry (#277, extended by #278, #279, #310, #311, #127, #316, and #315) — a thin,
 * logic-free,
 * branch-free wiring layer only. It composes the published `@openlogo/studio` seams (state model,
 * app shell, editor/canvas/run/diagnostics/lesson-pane/a11y/persistence controllers) onto the real
 * DOM `index.html` declares; it never reimplements them and holds no non-trivial logic of its own
 * (that lives in `../src/web-bootstrap.ts`, which has its own `.test.mjs` and stays inside the
 * 100% coverage gate — this file is outside `tsconfig.json`'s `src` build graph and is never
 * imported by a test, so it does not need to be, and does not count toward, that gate, and any
 * untested branch here would be invisible to it). Every decision this file would otherwise have to
 * branch on — which scheduler to pace a run through, which `aria-live` region an announcement
 * belongs in, whether a looked-up element is missing, whether the CM6 editor's doc/selection
 * actually needs re-syncing from the store, how a turtle-speed slider position maps to a tick
 * delay or a learner-facing description, which learner-facing label a `runStatus` value maps to,
 * which icon/label/aria state the Start/Stop toggle button shows and which of `run()`/`stop()` a
 * click invokes, whether a lesson is loaded and what its objective/worked-examples/exercise-prompt
 * content is — is made by a tested `src/` helper instead (`selectScheduler`,
 * `selectAnnouncerElementId`, `assertPresent`, `syncTextValue`, #315's `createEditorExtensions` /
 * `buildStoreSyncSpec` / `decideExternalSync` / `reconcileExternalSyncQueue` in `editor-cm6.ts`,
 * #310's `mapSpeedSliderValueToTickDelayMs` /
 * `describeSpeedTickDelayMs` in `turtle-speed.ts`, #311's `mapRunStatusToLabel` in
 * `run-status-label.ts`, #127's `createLessonPaneController` / `LessonPaneView` in
 * `lesson-pane.ts`, and #316's `mapRunStatusToRunToggleViewModel` in `run-controls.ts`); this file
 * only reads the raw browser input (`matchMedia`, `localStorage`, `document.getElementById`, CM6's
 * own `updateListener`, the `compositionend` DOM event, the slider's `input` event) and forwards
 * it. #315's `new EditorView({
 * state, parent })` construction and its `onLocalChange`/`onLocalSelectionChange` wiring is the one
 * piece of DOM-only glue `editor-cm6.ts` cannot hold itself (that module is DOM-free by design —
 * see its own doc comment), matching `canvas-view.ts`'s existing untested-DOM-glue split. The
 * turtle-speed slider (`#speed-slider`) writes straight to the shared state model via
 * `setSpeedSliderValue` on every `input` event — `run-controller.ts`'s `prepare()` reads that value
 * on the next `run()`/`step()`, so no scheduler is rebuilt here. `runToggleActionHandlers` and
 * `renderRunToggleButton` (#316) apply an already-decided `RunToggleViewModel` onto the single
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
import { EditorState } from "@codemirror/state";
import { EditorView, gutter, GutterMarker } from "@codemirror/view";
import {
  ANNOUNCER_ASSERTIVE_ELEMENT_ID,
  ANNOUNCER_POLITE_ELEMENT_ID,
  assertPresent,
  attachPersistence,
  buildStoreSyncSpec,
  computeDiagnosticGutterLines,
  createA11yAnnouncer,
  createAppShell,
  createCanvasRenderTarget,
  createCanvasViewController,
  createDiagnosticsController,
  createEditorController,
  createEditorExtensions,
  createExternalSyncQueue,
  createKeyValueStorageAdapter,
  createLessonPaneController,
  createParserHighlighter,
  createRunController,
  createRunLogController,
  createRunToggleActionHandlers,
  createStudioState,
  createTimeoutScheduler,
  createTurtleStateRegion,
  createTutorOutputController,
  decideExternalSync,
  DEFAULT_RUN_PROGRAM,
  describeSpeedTickDelayMs,
  diagnosticsField,
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
  reconcileExternalSyncQueue,
  selectAnnouncerElementId,
  selectScheduler,
  setDiagnosticsEffect,
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
} from "../src/index.js";
import type { Diagnostic, DiagnosticSeverity } from "@openlogo/core";
import { IMMEDIATE_SCHEDULER } from "@openlogo/turtle";

const lessonPaneElement = assertPresent<HTMLElement>(
  document.getElementById("lesson-pane"),
  "lesson-pane",
);
const editorHostElement = assertPresent<HTMLElement>(
  document.getElementById("editor-host"),
  "editor-host",
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
const tutorOutputPaneElement = assertPresent<HTMLElement>(
  document.getElementById("tutor-output-pane"),
  "tutor-output-pane",
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

/**
 * #315 — the CM6 `EditorView`. `editorController` is the same headless seam every other pane
 * binds through (`editor.ts`); its `onLocalChange`/`onLocalSelectionChange` callbacks below are
 * the *only* place a real CM6 edit reaches the shared store, and the `state.subscribe` sync below
 * is the *only* place the store reaches back into CM6 — matching `editor.ts`'s doc comment. #285
 * wires the real `@openlogo/parser`-backed highlighter (`highlighter.ts`'s
 * `createParserHighlighter`) into both the controller (`getTokens()`, for any future non-CM6
 * consumer) and the CM6 extension list (the actual painted decorations) — one shared instance, so
 * both read the exact same classification.
 */
const highlighter = createParserHighlighter();
const editorController = createEditorController(state, { highlighter });
mountEditorPane(shell, editorController);

const prefersReducedMotion = window.matchMedia(
  "(prefers-reduced-motion: reduce)",
).matches;

/**
 * #317 — the gutter half of the inline error markers: a `GutterMarker` per line that has at least
 * one diagnostic, glyphed by severity (a non-color cue distinct from the squiggle's — see
 * `web/styles.css`) with the combined `message`(s) as its hover `title`. `toDOM()` needs
 * `document.createElement`, so — like `createDiagnosticListItemElement` above — this class lives
 * here rather than in `editor-cm6.ts`, matching this repo's no-jsdom untested-DOM-glue convention;
 * `computeDiagnosticGutterLines` (the DOM-free, unit-tested decision of *which* line gets *which*
 * severity/messages) is the only thing this class reads from that module.
 */
class DiagnosticGutterMarker extends GutterMarker {
  constructor(
    private readonly severity: DiagnosticSeverity,
    private readonly messages: readonly string[],
  ) {
    super();
  }

  override eq(other: DiagnosticGutterMarker): boolean {
    return (
      other.severity === this.severity &&
      other.messages.length === this.messages.length &&
      other.messages.every((message, index) => message === this.messages[index])
    );
  }

  override toDOM(): HTMLElement {
    const element = document.createElement("span");
    element.className = `ol-diagnostic-gutter-marker ol-diagnostic-gutter-marker-${this.severity}`;
    element.title = this.messages.join("\n");
    return element;
  }
}

/** The gutter `Extension` itself: for each visible line, ask {@link computeDiagnosticGutterLines}
 * (reading the live diagnostics `diagnosticsField` holds — the same list the squiggle decorations
 * and the diagnostics pane already render) whether that line has a diagnostic, and if so return
 * its marker. `lineMarkerChange: () => true` keeps this simple and correct rather than
 * fast-pathing an equality check CM6 already performs marker-by-marker via `eq()` above. */
const diagnosticGutterExtension = gutter({
  class: "ol-diagnostic-gutter",
  lineMarker(view, line) {
    const { diagnostics } = view.state.field(diagnosticsField);
    const lineNumber = view.state.doc.lineAt(line.from).number;
    const match = computeDiagnosticGutterLines(view.state, diagnostics).find(
      (entry) => entry.line === lineNumber,
    );
    return match
      ? new DiagnosticGutterMarker(match.severity, match.messages)
      : null;
  },
  lineMarkerChange: () => true,
});

let initialEditorState = EditorState.create({
  doc: state.getState().source,
  extensions: [
    ...createEditorExtensions({
      highlighter,
      onLocalChange: (text, selection) => {
        editorController.setTextAndSelection(text, selection);
      },
      onLocalSelectionChange: (selection) => {
        editorController.setSelection(selection);
      },
    }),
    diagnosticGutterExtension,
  ],
});
// Reuse buildStoreSyncSpec (rather than re-deriving the initial cursor offset here) so the
// initial selection is positioned exactly the same way every later store-driven sync is.
initialEditorState = initialEditorState.update(
  buildStoreSyncSpec(
    initialEditorState,
    state.getState().source,
    state.getState().selection,
  ),
).state;
const editorView = new EditorView({
  state: initialEditorState,
  parent: editorHostElement,
});
// #315 IME-composition safety: ADR-0013 requires store→CM6 sync to be suppressed while the user is
// mid-composition, and the deferred snapshot reconciled once composition genuinely ends — the real
// `compositionend` DOM event is that signal (there is no CM6 `ViewUpdate` field for it). The
// `externalSyncQueue`/`decideExternalSync`/`reconcileExternalSyncQueue` decision logic itself is
// DOM-free and unit-tested in `editor-cm6.test.mjs`; only this event registration is untested glue.
const externalSyncQueue = createExternalSyncQueue();
editorView.dom.addEventListener("compositionend", () => {
  const spec = reconcileExternalSyncQueue(externalSyncQueue, editorView.state);
  if (spec) {
    editorView.dispatch(spec);
  }
});
// #315 a11y acceptance: reduced-motion disables fold/scroll animation. CM6's fold/unfold itself
// is instant (state-driven, no JS animation to disable — confirmed against `foldGutter`'s
// source); this class only suppresses the CSS transitions `web/styles.css` adds for the fold
// gutter's own hover/appearance chrome.
editorHostElement.classList.toggle("reduced-motion", prefersReducedMotion);

const canvasView = createCanvasViewController(state, {
  target: createCanvasRenderTarget(canvasContext),
  viewport: { width: canvasElement.width, height: canvasElement.height },
});
mountCanvasView(shell, canvasView);

mountDiagnosticsPane(shell, createDiagnosticsController(state));

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

/** Looks up the `RunController` method(s) a Start/Stop toggle click should invoke for the
 * `RunToggleAction` `mapRunStatusToRunToggleViewModel` already decided — this file only builds the
 * handler map via `run-controls.ts`'s `createRunToggleActionHandlers` (the actual `"restart"`
 * composition — #432 finding 1 — lives there, fully tested; this file makes no decision of its
 * own, matching this module's doc comment). */
const runToggleActionHandlers = createRunToggleActionHandlers(runController);

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

/** Applies the Start/Stop toggle button's already-decided presentation
 * ({@link mapRunStatusToRunToggleViewModel}) onto the real DOM button — plain attribute/text
 * assignment, no decision of its own (#316). */
function renderRunToggleButton(runStatus: RunStatus): void {
  const viewModel = mapRunStatusToRunToggleViewModel(runStatus);
  runToggleButton.dataset.icon = viewModel.icon;
  runToggleButton.setAttribute("aria-label", viewModel.ariaLabel);
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

/** Renders the tutor-output pane: the whole `.pane-tutor` section (not just the `<ul>`) stays
 * hidden until `explain`/`why`/`hint`/`debug` has ever run — matching {@link renderLessonPane}'s
 * direct `hidden` toggle on its mount element, so `web/styles.css`'s
 * `main:has(.pane-tutor:not([hidden]))` extension-slot rules only reserve grid space once the
 * pane is truly visible — then one `<li>` per recorded entry via
 * {@link createTutorOutputEntryElement}. */
function renderTutorOutput(
  pane: HTMLElement,
  list: HTMLElement,
  entries: readonly TutorOutputEntry[],
): void {
  pane.hidden = entries.length === 0;
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

/** #317 — tracks the diagnostics list last synced into CM6's {@link diagnosticsField}, so the
 * `state.subscribe` callback below only dispatches a fresh {@link setDiagnosticsEffect} when the
 * store's `diagnostics` reference actually changed — mirroring `needsExternalSync`'s guard against
 * redundant transactions on unrelated store notifications (turtle animation, run status, …). */
let lastSyncedDiagnostics: readonly Diagnostic[] = state.getState().diagnostics;

state.subscribe((next) => {
  // `state.subscribe` fires on every store change (turtle animation, run status, diagnostics, the
  // speed slider, …), not just document/selection edits — `decideExternalSync` is the tested
  // decision (`editor-cm6.ts`) for whether this notification needs a real CM6 sync transaction, a
  // deferred one (mid IME composition — reconciled on `compositionend`, registered above), or
  // nothing at all, per ADR-0013's synchronization protocol.
  const spec = decideExternalSync(
    externalSyncQueue,
    editorView.state,
    editorView.composing,
    next.source,
    next.selection,
  );
  // #317 — the diagnostics half: `next.diagnostics` is a fresh array reference every time the
  // diagnostics pipeline re-checks (`diagnostics.ts`'s `runChecks`), so a reference comparison is
  // exactly the "did diagnostics actually change" signal `setDiagnosticsEffect` needs.
  const diagnosticsChanged = next.diagnostics !== lastSyncedDiagnostics;
  if (diagnosticsChanged) {
    lastSyncedDiagnostics = next.diagnostics;
  }
  const diagnosticsEffects = diagnosticsChanged
    ? [setDiagnosticsEffect.of(next.diagnostics)]
    : [];
  if (spec) {
    editorView.dispatch({ ...spec, effects: diagnosticsEffects });
  } else if (diagnosticsEffects.length > 0) {
    editorView.dispatch({ effects: diagnosticsEffects });
  }
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
  renderTutorOutput(
    tutorOutputPaneElement,
    tutorOutputElement,
    tutorOutput.getEntries(),
  );
});
runStatusElement.textContent = mapRunStatusToLabel(state.getState().runStatus);
renderRunToggleButton(state.getState().runStatus);
outputElement.textContent = formatOutput(state.getState().output);
renderDiagnostics(diagnosticsListElement, state.getState().diagnostics);
// #317 — seed CM6's diagnosticsField with whatever the diagnostics controller already computed
// before this subscription was registered (`createDiagnosticsController`, mounted above, runs its
// first `refresh()` synchronously at construction — before `editorView` even had a chance to
// subscribe), matching the other initial-paint calls in this block.
editorView.dispatch({
  effects: setDiagnosticsEffect.of(state.getState().diagnostics),
});
renderRunLog(runLogElement, runLog.getEntries());
renderTutorOutput(
  tutorOutputPaneElement,
  tutorOutputElement,
  tutorOutput.getEntries(),
);
syncTextValue(speedSliderElement, String(state.getState().speedSliderValue));
speedDescriptionElement.textContent = describeSpeedTickDelayMs(
  mapSpeedSliderValueToTickDelayMs(state.getState().speedSliderValue),
);
renderLessonPane(lessonPaneElement, lessonPane.getView());
