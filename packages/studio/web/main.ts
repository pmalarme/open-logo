/**
 * The browser entry (#277) — a thin, logic-free wiring layer only. It composes the published
 * `@openlogo/studio` seams (state model, app shell, editor/canvas/run controllers) onto a real
 * `<textarea>`/`<canvas>`/Run button; it never reimplements them and holds no non-trivial logic of
 * its own (that lives in `../src/web-bootstrap.ts`, which has its own `.test.mjs` and stays inside
 * the 100% coverage gate — this file is outside `tsconfig.json`'s `src` build graph and is never
 * imported by a test, so it does not need to be, and does not count toward, that gate).
 */

import {
  createAppShell,
  createCanvasRenderTarget,
  createCanvasViewController,
  createEditorController,
  createRunController,
  createStudioState,
  DEFAULT_RUN_PROGRAM,
  formatDiagnosticsSummary,
  mountCanvasView,
  mountEditorPane,
  mountRunController,
} from "../src/index.js";

const editorElement = document.getElementById("editor");
const canvasElement = document.getElementById("turtle-canvas");
const runButton = document.getElementById("run-button");
const diagnosticsElement = document.getElementById("diagnostics");

if (
  !(editorElement instanceof HTMLTextAreaElement) ||
  !(canvasElement instanceof HTMLCanvasElement) ||
  !(runButton instanceof HTMLButtonElement) ||
  diagnosticsElement === null
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

const runController = createRunController(state, { canvasView });
mountRunController(shell, runController);

editorElement.value = state.getState().source;
editorElement.addEventListener("input", () => {
  shell.state.setSource(editorElement.value);
});
runButton.addEventListener("click", () => {
  runController.run();
});

state.subscribe((next) => {
  if (editorElement.value !== next.source) {
    editorElement.value = next.source;
  }
  diagnosticsElement.textContent = formatDiagnosticsSummary(next.diagnostics);
});
diagnosticsElement.textContent = formatDiagnosticsSummary(
  state.getState().diagnostics,
);
