/**
 * The CodeMirror 6 integration for #315 (`docs/adr/0013-studio-editor-component.md`): the
 * `Extension[]` bundle (line numbers, AST-derived code folding, undo/redo history, keymap, the
 * `role`/`aria-label` content attributes) and the sync-protocol helpers that keep a real CM6
 * `EditorView` and the shared {@link StudioStateStore} (via `editor.ts`'s
 * {@link EditorController}) from ever drifting apart.
 *
 * Despite the name, this module imports only `@codemirror/state`, `@codemirror/language`, and
 * `@codemirror/commands` — never `@codemirror/view`'s `EditorView` *constructor* (only its static
 * facets, which need no DOM to build). Every export here is exercised purely through
 * `EditorState.create`/`state.update(...)` in `editor-cm6.test.mjs`; only the actual
 * `new EditorView({ state, parent })` call and native DOM event registration live in
 * `web/main.ts`, matching `canvas-view.ts`'s untested-DOM-glue split (see `editor.ts`'s doc
 * comment for the full integration contract).
 *
 * ## The sync protocol
 * A real edit inside CM6 fires `EditorView.updateListener`; this module's
 * {@link createEditorExtensions} turns that into exactly one `controller.setTextAndSelection(...)`
 * (a doc edit) or `controller.setSelection(...)` (a selection-only move) call. The *other*
 * direction — the store changing from elsewhere (persistence #128 restoring a document, or any
 * other pane) and CM6 needing to catch up — is a `web/main.ts`-dispatched transaction built by
 * {@link buildStoreSyncSpec} and tagged with the {@link externalSync} annotation, so the same
 * `updateListener` can recognize and ignore it ({@link isExternalSyncTransaction}) instead of
 * bouncing the change straight back into the store it just came from.
 */

import {
  Annotation,
  EditorSelection,
  type EditorState,
  type Extension,
  type Transaction,
  type TransactionSpec,
} from "@codemirror/state";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import {
  codeFolding,
  foldGutter,
  foldKeymap,
  foldService,
} from "@codemirror/language";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { REPL_FOCUS_ORDER, type FocusStop } from "./a11y.js";
import { offsetFromPosition, positionFromOffset } from "./editor.js";
import { computeFoldRanges, type FoldRange } from "./fold-ranges.js";
import type { Selection } from "./state-model.js";

/**
 * Tags a transaction as a programmatic sync FROM the shared store INTO CM6 (see
 * {@link buildStoreSyncSpec}), so {@link createEditorExtensions}'s `updateListener` can recognize
 * and skip re-reporting it as if it were a fresh local edit — the loop-prevention half of the
 * sync protocol described in this module's doc comment.
 */
export const externalSync = Annotation.define<true>();

/** Whether `transaction` was produced by {@link buildStoreSyncSpec} rather than a local edit. */
export function isExternalSyncTransaction(transaction: Transaction): boolean {
  return transaction.annotation(externalSync) === true;
}

/**
 * Finds the `"editor"` stop in a {@link FocusStop} list — defaults to `a11y.ts`'s real
 * {@link REPL_FOCUS_ORDER}, but accepts an injected list so `editor-cm6.test.mjs` can exercise the
 * "missing stop" guard directly without mutating the real, always-correct export.
 */
export function editorFocusStop(
  focusOrder: readonly FocusStop[] = REPL_FOCUS_ORDER,
): FocusStop {
  const stop = focusOrder.find((candidate) => candidate.id === "editor");
  if (!stop) {
    throw new Error(
      "a11y.ts's REPL_FOCUS_ORDER is missing its 'editor' stop — editor-cm6.ts derives its " +
        "aria-label/role from it so the two can never drift apart.",
    );
  }
  return stop;
}

/**
 * The editor's ARIA role, read from `a11y.ts`'s {@link REPL_FOCUS_ORDER} rather than duplicated
 * as a literal, so CM6's `contentAttributes` and the #279 a11y contracts can never drift apart.
 */
export const EDITOR_ARIA_ROLE: string = editorFocusStop().role;

/** The editor's ARIA label — see {@link EDITOR_ARIA_ROLE}'s doc comment. */
export const EDITOR_ARIA_LABEL: string = editorFocusStop().label;

let lastFoldSource: string | undefined;
let lastFoldRanges: readonly FoldRange[] = [];

/**
 * Recompute {@link computeFoldRanges} only when `source` actually changed since the last call —
 * `foldGutter()`/`foldable()` query the fold service once per visible line, so without this memo
 * a single render pass would re-parse the whole document once per line. Safe because the cache
 * key is exact content equality, not object identity: any caller passing the same source string
 * gets the same (pure) answer regardless of call history.
 */
function cachedFoldRanges(source: string): readonly FoldRange[] {
  if (source !== lastFoldSource) {
    lastFoldSource = source;
    lastFoldRanges = computeFoldRanges(source);
  }
  return lastFoldRanges;
}

/**
 * The AST-derived fold service (see `fold-ranges.ts`): for the queried line range, returns the
 * first computed fold range that *starts* on one of those lines, exactly matching
 * `@codemirror/language`'s `foldService` contract.
 */
export const openLogoFoldService = foldService.of(
  (state, lineStart, lineEnd) => {
    const ranges = cachedFoldRanges(state.doc.toString());
    const match = ranges.find(
      (range) => range.start >= lineStart && range.start <= lineEnd,
    );
    return match ? { from: match.start, to: match.end } : null;
  },
);

/** Read the current cursor/selection out of a CM6 {@link EditorState} as this repo's {@link Selection}. */
export function selectionFromEditorState(state: EditorState): Selection {
  const text = state.doc.toString();
  const range = state.selection.main;
  return {
    anchor: positionFromOffset(text, range.anchor),
    head: positionFromOffset(text, range.head),
  };
}

/**
 * Build the `TransactionSpec` that syncs the shared store's `{source, selection}` INTO a CM6
 * `EditorState`, tagged with {@link externalSync} so the resulting update is never mistaken for a
 * fresh local edit. Only replaces the document text when it actually differs (an editor-only
 * cursor move from elsewhere would otherwise re-set identical text on every store notification).
 */
export function buildStoreSyncSpec(
  state: EditorState,
  source: string,
  selection: Selection,
): TransactionSpec {
  const currentText = state.doc.toString();
  const changes =
    currentText === source
      ? undefined
      : { from: 0, to: state.doc.length, insert: source };
  const clampToDoc = (offset: number) =>
    Math.max(0, Math.min(offset, source.length));
  const anchor = clampToDoc(offsetFromPosition(source, selection.anchor));
  const head = clampToDoc(offsetFromPosition(source, selection.head));
  return {
    changes,
    selection: EditorSelection.single(anchor, head),
    annotations: externalSync.of(true),
  };
}

/**
 * Whether an incoming `{source, selection}` from the shared store actually differs from `state`'s
 * current document/selection — i.e. whether a {@link buildStoreSyncSpec} transaction would have
 * anything real to apply. `web/main.ts`'s `state.subscribe` callback fires on *every* store
 * change (turtle animation, run status, diagnostics, the speed slider, …), not only document or
 * selection edits, so it must call this **before** dispatching — otherwise it would push a
 * same-content sync transaction into CM6 on every one of those unrelated notifications, per
 * ADR-0013's "if they differ, it dispatches" synchronization protocol.
 */
export function needsExternalSync(
  state: EditorState,
  source: string,
  selection: Selection,
): boolean {
  if (state.doc.toString() !== source) {
    return true;
  }
  const current = selectionFromEditorState(state);
  return (
    current.anchor[0] !== selection.anchor[0] ||
    current.anchor[1] !== selection.anchor[1] ||
    current.head[0] !== selection.head[0] ||
    current.head[1] !== selection.head[1]
  );
}

/**
 * Holds at most one deferred external-sync snapshot: the `{source, selection}` a store
 * notification carried while `EditorView.composing` was true. ADR-0013 requires store→CM6 sync to
 * be *suppressed* mid-composition, not dropped — so {@link decideExternalSync} remembers the
 * latest such snapshot here instead of applying it immediately, and
 * {@link reconcileExternalSyncQueue} applies it once composition ends. A newer deferred snapshot
 * always supersedes an older one; only the most recent external state matters once composition
 * finishes.
 */
export interface ExternalSyncQueue {
  pending:
    { readonly source: string; readonly selection: Selection } | undefined;
}

/** A fresh, empty {@link ExternalSyncQueue} — `web/main.ts` holds exactly one per `EditorView`. */
export function createExternalSyncQueue(): ExternalSyncQueue {
  return { pending: undefined };
}

/**
 * The store→CM6 half of ADR-0013's synchronization protocol, called on every store notification.
 * While `composing` is true, this never returns a transaction to dispatch — it records
 * `{source, selection}` in `queue` (superseding any earlier deferred snapshot) so
 * {@link reconcileExternalSyncQueue} can apply it once composition ends, rather than silently
 * losing an external update that arrived mid-IME. Once not composing, it clears any stale deferred
 * snapshot and returns the {@link buildStoreSyncSpec} transaction to dispatch — or `undefined` if
 * {@link needsExternalSync} finds `state` already matches, so unrelated store notifications never
 * provoke a redundant transaction.
 */
export function decideExternalSync(
  queue: ExternalSyncQueue,
  state: EditorState,
  composing: boolean,
  source: string,
  selection: Selection,
): TransactionSpec | undefined {
  if (composing) {
    queue.pending = { source, selection };
    return undefined;
  }
  queue.pending = undefined;
  return needsExternalSync(state, source, selection)
    ? buildStoreSyncSpec(state, source, selection)
    : undefined;
}

/**
 * Called once IME composition ends (the real browser `compositionend` event — see
 * `web/main.ts`): applies whatever external snapshot {@link decideExternalSync} deferred while
 * composing was true, clearing it from `queue` either way. Returns `undefined` if nothing was
 * deferred (composition ended with no external update pending), or if the deferred snapshot turns
 * out to already match `state` (e.g. the composition's own edit happened to land on the same text).
 */
export function reconcileExternalSyncQueue(
  queue: ExternalSyncQueue,
  state: EditorState,
): TransactionSpec | undefined {
  const pending = queue.pending;
  queue.pending = undefined;
  if (!pending) {
    return undefined;
  }
  return needsExternalSync(state, pending.source, pending.selection)
    ? buildStoreSyncSpec(state, pending.source, pending.selection)
    : undefined;
}

/** Callbacks {@link createEditorExtensions} invokes for a real local (non-synced) CM6 edit. */
export interface EditorExtensionsOptions {
  /** Called once per local doc edit, with the resulting text *and* selection together. */
  readonly onLocalChange?: (text: string, selection: Selection) => void;
  /** Called once per local selection-only move (no doc edit). */
  readonly onLocalSelectionChange?: (selection: Selection) => void;
}

/**
 * The exact subset of `@codemirror/view`'s `ViewUpdate` that {@link handleViewUpdate} reads.
 * Kept as a standalone, DOM-free interface (rather than importing `ViewUpdate` itself) so this
 * module's decision logic can be exercised in `editor-cm6.test.mjs` with a plain object literal —
 * a real `ViewUpdate` satisfies it structurally, since TypeScript interfaces are structural.
 * `EditorView.updateListener` only ever fires through a real `EditorView`'s dispatch loop (a bare
 * `EditorState.update(...)` never invokes it — confirmed empirically), so this split is what
 * makes the sync-protocol *decision* testable without DOM, leaving only the one-line
 * `EditorView.updateListener.of(...)` wiring itself as untested glue in `createEditorExtensions`,
 * matching `editor.ts`'s untested-DOM-glue convention.
 */
export interface ViewUpdateLike {
  readonly docChanged: boolean;
  readonly selectionSet: boolean;
  readonly transactions: readonly Transaction[];
  readonly state: EditorState;
}

/**
 * The sync-protocol decision for one CM6 update: skip synthetic {@link externalSync} transactions
 * and no-op updates, otherwise report a doc edit (text + selection) or a selection-only move to
 * `options`. Extracted from {@link createEditorExtensions} so it can be unit-tested directly
 * against a {@link ViewUpdateLike} without constructing a real `EditorView` (see that type's doc
 * comment for why).
 */
export function handleViewUpdate(
  update: ViewUpdateLike,
  options: EditorExtensionsOptions,
): void {
  if (!update.docChanged && !update.selectionSet) {
    return;
  }
  if (update.transactions.some(isExternalSyncTransaction)) {
    return;
  }
  const selection = selectionFromEditorState(update.state);
  if (update.docChanged) {
    options.onLocalChange?.(update.state.doc.toString(), selection);
  } else {
    options.onLocalSelectionChange?.(selection);
  }
}

/**
 * Build the `updateListener` callback {@link createEditorExtensions} registers — a thin forward to
 * {@link handleViewUpdate}, pulled into its own named export so a test can invoke the returned
 * function directly against a {@link ViewUpdateLike}, exercising it without a real `EditorView`'s
 * dispatch loop (the same DOM-free split {@link handleViewUpdate} itself already uses).
 */
export function createUpdateListener(
  options: EditorExtensionsOptions,
): (update: ViewUpdateLike) => void {
  return (update) => handleViewUpdate(update, options);
}

/**
 * Build the full CM6 `Extension[]` for the OpenLogo editor surface: line-number gutter, AST-derived
 * code folding (gutter + keyboard `foldKeymap` + click-to-toggle), undo/redo history (`defaultKeymap`
 * has no undo/redo of its own), and the `role`/`aria-label` content attributes the #279 a11y
 * contracts require. Highlighter-free by design (#285 wires real syntax highlighting later — see
 * `editor.ts`'s doc comment); no `@codemirror/lang-*`/`basicSetup`/autocomplete/search/lint
 * packages, matching ADR-0013's modular/tree-shaken import plan.
 */
export function createEditorExtensions(
  options: EditorExtensionsOptions = {},
): Extension[] {
  const extensions: Extension[] = [
    lineNumbers(),
    codeFolding(),
    foldGutter(),
    openLogoFoldService,
    history(),
    keymap.of([...defaultKeymap, ...historyKeymap, ...foldKeymap]),
    EditorView.contentAttributes.of({
      role: EDITOR_ARIA_ROLE,
      "aria-label": EDITOR_ARIA_LABEL,
    }),
  ];

  if (options.onLocalChange || options.onLocalSelectionChange) {
    extensions.push(
      EditorView.updateListener.of(createUpdateListener(options)),
    );
  }

  return extensions;
}
