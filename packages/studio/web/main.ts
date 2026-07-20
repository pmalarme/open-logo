/**
 * The browser entry (#277, extended by #278 and #279) — a thin, logic-free, branch-free wiring
 * layer only. It composes the published `@openlogo/studio` seams (state model, app shell,
 * editor/canvas/run/diagnostics/a11y/persistence controllers) onto the real DOM `index.html`
 * declares; it never reimplements them and holds no non-trivial logic of its own (that lives in
 * `../src/web-bootstrap.ts`, which has its own `.test.mjs` and stays inside the 100% coverage
 * gate — this file is outside `tsconfig.json`'s `src` build graph and is never imported by a
 * test, so it does not need to be, and does not count toward, that gate, and any untested branch
 * here would be invisible to it). Every decision this file would otherwise have to branch on —
 * which scheduler to pace a run through, which `aria-live` region an announcement belongs in,
 * whether a looked-up element is missing, whether the editor's value actually needs rewriting —
 * is made by a tested `src/web-bootstrap.ts` helper instead (`selectScheduler`,
 * `selectAnnouncerElementId`, `assertPresent`, `syncTextValue`); this file only reads the raw
 * browser input (`matchMedia`, `localStorage`, `document.getElementById`) and forwards it. The
 * one remaining loop-shaped statement (`.map(createDiagnosticListItemElement)`, building one
 * `<li>` per already-computed {@link DiagnosticListItem}) has no decision left to make — the
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
  createRunController,
  createStudioState,
  createTimeoutScheduler,
  createTurtleStateRegion,
  DEFAULT_RUN_PROGRAM,
  formatOutput,
  mountCanvasView,
  mountDiagnosticsPane,
  mountEditorPane,
  mountRunController,
  selectAnnouncerElementId,
  selectScheduler,
  syncTextValue,
  toDiagnosticListItems,
} from "../src/index.js";
import type { DiagnosticListItem, Canvas2DContext } from "../src/index.js";
import type { Diagnostic } from "@openlogo/core";
import { IMMEDIATE_SCHEDULER } from "@openlogo/turtle";

/** Fixed pace (ms/step) the turtle animation plays back at — see `createTimeoutScheduler`'s doc
 * comment in `web-bootstrap.ts` for why a single fixed delay is the right call for this slice. */
const ANIMATION_STEP_DELAY_MS = 100;

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
const stepButton = assertPresent(
  document.getElementById("step-button"),
  "step-button",
  (value): value is HTMLButtonElement => value instanceof HTMLButtonElement,
);
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
const timeoutScheduler = createTimeoutScheduler(ANIMATION_STEP_DELAY_MS, {
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
stepButton.addEventListener("click", () => {
  runController.step();
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

state.subscribe((next) => {
  syncTextValue(editorElement, next.source);
  runStatusElement.textContent = next.runStatus;
  outputElement.textContent = formatOutput(next.output);
  renderDiagnostics(diagnosticsListElement, next.diagnostics);
});
runStatusElement.textContent = state.getState().runStatus;
outputElement.textContent = formatOutput(state.getState().output);
renderDiagnostics(diagnosticsListElement, state.getState().diagnostics);
