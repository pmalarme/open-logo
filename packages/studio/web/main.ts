/**
 * The browser entry (#277, extended by #278 and #279) — a thin, logic-free wiring layer only. It
 * composes the published `@openlogo/studio` seams (state model, app shell, editor/canvas/run/
 * diagnostics/a11y/persistence controllers) onto the real DOM `index.html` declares; it never
 * reimplements them and holds no non-trivial logic of its own (that lives in
 * `../src/web-bootstrap.ts`, which has its own `.test.mjs` and stays inside the 100% coverage
 * gate — this file is outside `tsconfig.json`'s `src` build graph and is never imported by a
 * test, so it does not need to be, and does not count toward, that gate). Every decision this
 * file would otherwise have to branch on — which scheduler to pace a run through, which
 * `aria-live` region an announcement belongs in — is made by a tested `src/web-bootstrap.ts`
 * helper instead; this file only reads the raw browser input (`matchMedia`, `localStorage`,
 * `document.getElementById`) and forwards it.
 */

import "./styles.css";
import {
  ANNOUNCER_ASSERTIVE_ELEMENT_ID,
  ANNOUNCER_POLITE_ELEMENT_ID,
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
  toDiagnosticListItems,
} from "../src/index.js";
import type { DiagnosticListItem } from "../src/index.js";
import type { Diagnostic } from "@openlogo/core";
import { IMMEDIATE_SCHEDULER } from "@openlogo/turtle";

/** Fixed pace (ms/step) the turtle animation plays back at — see `createTimeoutScheduler`'s doc
 * comment in `web-bootstrap.ts` for why a single fixed delay is the right call for this slice. */
const ANIMATION_STEP_DELAY_MS = 100;

const editorElement = document.getElementById("editor");
const canvasElement = document.getElementById("turtle-canvas");
const runButton = document.getElementById("run-button");
const stopButton = document.getElementById("stop-button");
const resetButton = document.getElementById("reset-button");
const stepButton = document.getElementById("step-button");
const runStatusElement = document.getElementById("run-status");
const outputElement = document.getElementById("output");
const diagnosticsListElement = document.getElementById("diagnostics-list");
const turtleStateElement = document.getElementById("turtle-state");
const announcerPoliteElement = document.getElementById("announcer-polite");
const announcerAssertiveElement = document.getElementById(
  "announcer-assertive",
);

if (
  !(editorElement instanceof HTMLTextAreaElement) ||
  !(canvasElement instanceof HTMLCanvasElement) ||
  !(runButton instanceof HTMLButtonElement) ||
  !(stopButton instanceof HTMLButtonElement) ||
  !(resetButton instanceof HTMLButtonElement) ||
  !(stepButton instanceof HTMLButtonElement) ||
  runStatusElement === null ||
  outputElement === null ||
  diagnosticsListElement === null ||
  turtleStateElement === null ||
  announcerPoliteElement === null ||
  announcerAssertiveElement === null
) {
  throw new Error("index.html is missing an expected element.");
}

const canvasContext = canvasElement.getContext("2d");
if (canvasContext === null) {
  throw new Error("2-D canvas context unavailable.");
}

/** Looks up the always-live region a {@link selectAnnouncerElementId} result names — an indexed
 * lookup, not a branch, so this stays a straight-line wiring statement (see this module's doc
 * comment). */
const announcerElementsById: Readonly<Record<string, HTMLElement>> = {
  [ANNOUNCER_POLITE_ELEMENT_ID]: announcerPoliteElement,
  [ANNOUNCER_ASSERTIVE_ELEMENT_ID]: announcerAssertiveElement,
};

const state = createStudioState({ source: DEFAULT_RUN_PROGRAM });

attachPersistence(state, {
  adapter: createKeyValueStorageAdapter(window.localStorage),
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

function renderDiagnosticItem(
  list: HTMLElement,
  item: DiagnosticListItem,
): void {
  const listItem = document.createElement("li");
  listItem.textContent = item.label;
  listItem.dataset.severity = item.severity;
  list.appendChild(listItem);
}

function renderDiagnostics(
  list: HTMLElement,
  diagnostics: readonly Diagnostic[],
): void {
  list.replaceChildren();
  for (const item of toDiagnosticListItems(diagnostics)) {
    renderDiagnosticItem(list, item);
  }
}

state.subscribe((next) => {
  if (editorElement.value !== next.source) {
    editorElement.value = next.source;
  }
  runStatusElement.textContent = next.runStatus;
  outputElement.textContent = formatOutput(next.output);
  renderDiagnostics(diagnosticsListElement, next.diagnostics);
});
runStatusElement.textContent = state.getState().runStatus;
outputElement.textContent = formatOutput(state.getState().output);
renderDiagnostics(diagnosticsListElement, state.getState().diagnostics);
