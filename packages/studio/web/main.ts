/**
 * The browser entry (#277, extended by #278) — a thin, logic-free wiring layer only. It composes
 * the published `@openlogo/studio` seams (state model, app shell, editor/canvas/run/diagnostics
 * controllers) onto a real `<textarea>`/`<canvas>`/Run-Stop-Reset-Step buttons/diagnostics list;
 * it never reimplements them and holds no non-trivial logic of its own (that lives in
 * `../src/web-bootstrap.ts`, which has its own `.test.mjs` and stays inside the 100% coverage
 * gate — this file is outside `tsconfig.json`'s `src` build graph and is never imported by a
 * test, so it does not need to be, and does not count toward, that gate).
 */

import {
  createAppShell,
  createCanvasRenderTarget,
  createCanvasViewController,
  createDiagnosticsController,
  createEditorController,
  createRunController,
  createStudioState,
  createTimeoutScheduler,
  DEFAULT_RUN_PROGRAM,
  mountCanvasView,
  mountDiagnosticsPane,
  mountEditorPane,
  mountRunController,
  NO_DIAGNOSTICS_LABEL,
  toDiagnosticListItems,
} from "../src/index.js";
import type { DiagnosticListItem } from "../src/index.js";
import type { Diagnostic } from "@openlogo/core";

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
const diagnosticsListElement = document.getElementById("diagnostics-list");

if (
  !(editorElement instanceof HTMLTextAreaElement) ||
  !(canvasElement instanceof HTMLCanvasElement) ||
  !(runButton instanceof HTMLButtonElement) ||
  !(stopButton instanceof HTMLButtonElement) ||
  !(resetButton instanceof HTMLButtonElement) ||
  !(stepButton instanceof HTMLButtonElement) ||
  runStatusElement === null ||
  diagnosticsListElement === null
) {
  throw new Error("index.html is missing an expected element.");
}

const canvasContext = canvasElement.getContext("2d");
if (canvasContext === null) {
  throw new Error("2-D canvas context unavailable.");
}

const state = createStudioState({ source: DEFAULT_RUN_PROGRAM });
const shell = createAppShell(state);

mountEditorPane(shell, createEditorController(state));

const canvasView = createCanvasViewController(state, {
  target: createCanvasRenderTarget(canvasContext),
  viewport: { width: canvasElement.width, height: canvasElement.height },
});
mountCanvasView(shell, canvasView);

mountDiagnosticsPane(shell, createDiagnosticsController(state));

const scheduler = createTimeoutScheduler(ANIMATION_STEP_DELAY_MS, {
  setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  clearTimeout: (handle) => globalThis.clearTimeout(handle),
});
const runController = createRunController(state, { canvasView, scheduler });
mountRunController(shell, runController);

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
  const items = toDiagnosticListItems(diagnostics);
  if (items.length === 0) {
    const emptyItem = document.createElement("li");
    emptyItem.textContent = NO_DIAGNOSTICS_LABEL;
    list.appendChild(emptyItem);
    return;
  }
  for (const item of items) {
    renderDiagnosticItem(list, item);
  }
}

state.subscribe((next) => {
  if (editorElement.value !== next.source) {
    editorElement.value = next.source;
  }
  runStatusElement.textContent = next.runStatus;
  renderDiagnostics(diagnosticsListElement, next.diagnostics);
});
runStatusElement.textContent = state.getState().runStatus;
renderDiagnostics(diagnosticsListElement, state.getState().diagnostics);
