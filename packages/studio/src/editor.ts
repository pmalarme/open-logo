/**
 * The editor pane (#124) — a headless, fully-testable editing controller bound to the single
 * studio state model (#123). Every editing operation reads and writes straight through the
 * shared {@link StudioStateStore}; there is **no private text buffer**, so this pane can never
 * hold a stale/forked copy of the document (the #123 single-source-of-truth contract).
 *
 * ## DOM/mount integration contract
 * ADR-0001 leaves the studio shell framework undecided, so this controller stays headless: plain
 * data + functions, no DOM of its own. #315 (`docs/adr/0013-studio-editor-component.md`) picks
 * CodeMirror 6 for the real widget and wires it to {@link EditorController} like this
 * (`web/main.ts` is the only place that constructs the real `EditorView` — this module never
 * imports `@codemirror/view`):
 * - On every native edit, call `controller.setTextAndSelection(...)` once with the resulting text
 *   *and* selection together (not `setText`/`insertText` then `setSelection` separately) — a CM6
 *   `ViewUpdate` already reports both post-edit, and one call keeps the state model's single
 *   `commit` in sync with CM6's own single transaction instead of raising two separate
 *   notifications per keystroke.
 * - On every native selection-only change (no doc edit), call `controller.setSelection(...)`.
 * - Subscribe to `state.subscribe(...)` and reflect `state.getState().source` / `.selection` back
 *   into CM6 (via a tagged, loop-safe transaction — see `editor-cm6.ts`'s `externalSync`
 *   annotation) when they change from elsewhere (e.g. persistence #128 restoring a document) —
 *   this one-way bind-back is what keeps CM6 and the store from ever drifting apart.
 * - Render `controller.getTokens()` for syntax coloring — #285 wires the real
 *   `@openlogo/parser`-backed `HighlightProvider` (`highlighter.ts`'s `createParserHighlighter`)
 *   into both this controller and, separately, `editor-cm6.ts`'s decoration extension, which is
 *   what actually paints CM6's colors (this controller's own `getTokens()` stays available for
 *   any future non-CM6 consumer). Call `mountEditorPane(shell, controller)` to compose the
 *   controller into the shell's `editor` region (see `app-shell.ts`).
 * - Keyboard operability/screen-reader labeling (#129) falls out of CM6's own natively focusable,
 *   editable `contenteditable` host, with `role="textbox"`/`aria-label` set via CM6's
 *   `contentAttributes` facet (`editor-cm6.ts`) — this headless module has no DOM to regress.
 * - `editor-cm6.ts` builds the CM6 `Extension[]` (line numbers, AST-derived code folding, history,
 *   keymap) and the sync-protocol helpers as plain, DOM-free `@codemirror/state` data, so they stay
 *   inside the 100% coverage gate; only the final `new EditorView({ state, parent })` call and its
 *   native event wiring live in `web/main.ts`, matching `canvas-view.ts`'s untested-DOM-glue split.
 *
 * ## Highlighting integration point
 * {@link HighlightProvider} is the pluggable syntax-highlighting seam. The default,
 * {@link noopHighlighter}, returns no tokens (plain text), keeping this module itself free of any
 * hard dependency on a highlighter (epic #118). #285's `highlighter.ts` (`@openlogo/studio`, not
 * this module) supplies the real one — `createParserHighlighter()`, backed by
 * `@openlogo/parser`'s own grammar-derived `highlight()` — without this module ever
 * re-implementing token classification itself.
 */

import type { Position } from "@openlogo/core";
import type { AppShell } from "./app-shell.js";
import type { Selection, StudioStateStore } from "./state-model.js";

/** One highlighted span the editor can render for syntax coloring. */
export interface HighlightToken {
  readonly text: string;
  readonly class: string;
  readonly start: Position;
  readonly end: Position;
}

/** The pluggable syntax-highlighting seam: classify source text into highlight tokens. */
export type HighlightProvider = (source: string) => readonly HighlightToken[];

/** The default highlighter: no tokens, i.e. plain text. Keeps this slice highlighter-free. */
export const noopHighlighter: HighlightProvider = () => [];

/** Options for {@link createEditorController}. */
export interface EditorControllerOptions {
  /** Syntax highlighter to classify tokens with; defaults to {@link noopHighlighter}. */
  readonly highlighter?: HighlightProvider;
}

/** The headless editor pane controller. Every method reads/writes the shared state model. */
export interface EditorController {
  /** The current document text, read straight from the shared state model. */
  getText(): string;
  /** The current cursor/selection, read straight from the shared state model. */
  getSelection(): Selection;
  /** Replace the whole document text; collapses the cursor to the end. */
  setText(text: string): void;
  /** Move the cursor/selection without changing the text. */
  setSelection(selection: Selection): void;
  /**
   * Replace the document text and cursor/selection together in one notification (#315) — the
   * seam a real widget's native edit (which already knows its own post-edit selection) binds
   * through, so the shared store never sees a stale selection against the new text (see
   * {@link StudioStateStore.setSourceAndSelection}).
   */
  setTextAndSelection(text: string, selection: Selection): void;
  /** Insert text at the current selection, replacing it, and collapse the cursor after it. */
  insertText(text: string): void;
  /** Delete the current selection, or the character before a collapsed cursor. */
  deleteBackward(): void;
  /** Delete the current selection, or the character after a collapsed cursor. */
  deleteForward(): void;
  /** Classify the current document text via the configured {@link HighlightProvider}. */
  getTokens(): readonly HighlightToken[];
}

/** Convert a 1-based `[line, column]` {@link Position} into a 0-based string offset into `text`. */
export function offsetFromPosition(text: string, position: Position): number {
  const [line, column] = position;
  const priorLines = text.split("\n").slice(0, line - 1);
  const priorLength = priorLines.reduce(
    (sum, priorLine) => sum + priorLine.length + 1,
    0,
  );
  return priorLength + (column - 1);
}

/** Convert a 0-based string offset into `text` back into a 1-based `[line, column]` {@link Position}. */
export function positionFromOffset(text: string, offset: number): Position {
  const before = text.slice(0, offset).split("\n");
  // `String.prototype.split` always returns at least one element, so this index is always in range.
  const lastLine = before[before.length - 1] as string;
  return [before.length, lastLine.length + 1];
}

/** The `[start, end)` offset range a {@link Selection} covers, ordered regardless of direction. */
function rangeOffsets(
  text: string,
  selection: Selection,
): { start: number; end: number } {
  const anchorOffset = offsetFromPosition(text, selection.anchor);
  const headOffset = offsetFromPosition(text, selection.head);
  return anchorOffset <= headOffset
    ? { start: anchorOffset, end: headOffset }
    : { start: headOffset, end: anchorOffset };
}

/** Construct the editor pane controller bound to the shared studio state model. */
export function createEditorController(
  state: StudioStateStore,
  options: EditorControllerOptions = {},
): EditorController {
  const highlighter = options.highlighter ?? noopHighlighter;

  function replaceRange(start: number, end: number, replacement: string): void {
    const source = state.getState().source;
    const nextSource = source.slice(0, start) + replacement + source.slice(end);
    const cursor = positionFromOffset(nextSource, start + replacement.length);
    state.setSource(nextSource);
    state.setSelection({ anchor: cursor, head: cursor });
  }

  return {
    getText() {
      return state.getState().source;
    },
    getSelection() {
      return state.getState().selection;
    },
    setText(text) {
      const cursor = positionFromOffset(text, text.length);
      state.setSource(text);
      state.setSelection({ anchor: cursor, head: cursor });
    },
    setSelection(selection) {
      state.setSelection(selection);
    },
    setTextAndSelection(text, selection) {
      state.setSourceAndSelection(text, selection);
    },
    insertText(text) {
      const { source, selection } = state.getState();
      const { start, end } = rangeOffsets(source, selection);
      replaceRange(start, end, text);
    },
    deleteBackward() {
      const { source, selection } = state.getState();
      const { start, end } = rangeOffsets(source, selection);
      if (start !== end) {
        replaceRange(start, end, "");
        return;
      }
      if (start === 0) {
        return;
      }
      replaceRange(start - 1, start, "");
    },
    deleteForward() {
      const { source, selection } = state.getState();
      const { start, end } = rangeOffsets(source, selection);
      if (start !== end) {
        replaceRange(start, end, "");
        return;
      }
      if (end >= source.length) {
        return;
      }
      replaceRange(start, start + 1, "");
    },
    getTokens() {
      return highlighter(state.getState().source);
    },
  };
}

/** Compose the editor controller into the app shell's `editor` region. */
export function mountEditorPane(
  shell: AppShell,
  controller: EditorController,
): void {
  shell.mount("editor", controller);
}
