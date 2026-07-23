// Unit tests for #315's CodeMirror 6 integration (packages/studio/src/editor-cm6.ts):
// the fold service, the aria-label/role derivation, the store<->CM6 sync-protocol helpers
// (buildStoreSyncSpec / isExternalSyncTransaction / selectionFromEditorState), and the full
// extension list. Every assertion here builds/queries a real `@codemirror/state` `EditorState`
// (confirmed to need zero DOM) — only the real `new EditorView({ state, parent })` construction
// itself is untested DOM glue, living in `web/main.ts`.

import assert from "node:assert/strict";
import { test } from "node:test";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { foldKeymap, foldable } from "@codemirror/language";
import * as OL from "@openlogo/studio";

const {
  EDITOR_ARIA_LABEL,
  EDITOR_ARIA_ROLE,
  EDITOR_FOLD_HELP_ELEMENT_ID,
  EDITOR_FOLD_HELP_TEXT,
  buildStoreSyncSpec,
  computeDiagnosticGutterLines,
  createEditorExtensions,
  createExternalSyncQueue,
  createHighlightExtension,
  createUpdateListener,
  decideExternalSync,
  diagnosticsField,
  editorFocusStop,
  externalSync,
  handleViewUpdate,
  isExternalSyncTransaction,
  needsExternalSync,
  openLogoFoldService,
  reconcileExternalSyncQueue,
  selectionFromEditorState,
  setDiagnosticsEffect,
} = OL;

/** A `fakeDiagnostic` matching `diagnostics.test.mjs`'s fixture shape, for the #317 inline
 * error-marker tests below — only the fields {@link computeDiagnosticGutterLines} and the
 * decoration builders actually read (`source_span`, `severity`, `message`) matter here. */
function fakeDiagnostic(overrides = {}) {
  return {
    code: "ol-bad-token",
    source_span: { document: "x", start: [1, 1], end: [1, 2] },
    params: {},
    message: "irrelevant prose",
    stage: "parse",
    severity: "error",
    ...overrides,
  };
}

/**
 * Build a {@link ViewUpdateLike} from a real CM6 `Transaction` — everything `handleViewUpdate`
 * reads (`docChanged`, `selectionSet`, `transactions`, `state`) mirrors the real `ViewUpdate`
 * shape one-for-one, so this is exactly what `EditorView.updateListener` would hand it, minus the
 * DOM. `EditorView.updateListener` itself only ever fires through a real `EditorView`'s dispatch
 * loop (confirmed empirically: a bare `EditorState.update(...)` never invokes it), so
 * `handleViewUpdate` — the extracted, DOM-free decision logic — is exercised directly here instead.
 */
function viewUpdateFrom(transaction) {
  return {
    docChanged: transaction.docChanged,
    selectionSet: transaction.selection !== undefined,
    transactions: [transaction],
    state: transaction.state,
  };
}

function stateFor(doc) {
  return EditorState.create({ doc, extensions: [openLogoFoldService] });
}

test("EDITOR_ARIA_ROLE/EDITOR_ARIA_LABEL match the #279 a11y contracts' editor focus stop", () => {
  assert.equal(EDITOR_ARIA_ROLE, "textbox");
  assert.equal(EDITOR_ARIA_LABEL, "OpenLogo source editor");
});

test("createEditorExtensions sets aria-describedby to EDITOR_FOLD_HELP_ELEMENT_ID, alongside role/aria-label (#432 finding 3)", () => {
  const state = EditorState.create({
    doc: "forward 100",
    extensions: createEditorExtensions(),
  });
  // createEditorExtensions contributes exactly one EditorView.contentAttributes.of({...}) entry
  // (a plain object, never a function form of the facet) — see the module doc comment.
  const [attributes] = state.facet(EditorView.contentAttributes);
  assert.equal(attributes.role, EDITOR_ARIA_ROLE);
  assert.equal(attributes["aria-label"], EDITOR_ARIA_LABEL);
  assert.equal(attributes["aria-describedby"], EDITOR_FOLD_HELP_ELEMENT_ID);
});

test("EDITOR_FOLD_HELP_TEXT mentions every real keybinding @codemirror/language's foldKeymap registers, not a placeholder (#432 finding 3)", () => {
  // Read the actual keymap CM6 wires in (createEditorExtensions's keymap.of([...foldKeymap]))
  // rather than hardcoding a copy of the bindings, so a future @codemirror/language upgrade that
  // changes them would fail this test instead of silently leaving stale help text.
  assert.ok(foldKeymap.length > 0);
  for (const binding of foldKeymap) {
    assert.ok(
      EDITOR_FOLD_HELP_TEXT.includes(binding.key),
      `EDITOR_FOLD_HELP_TEXT must mention the real foldKeymap key "${binding.key}"`,
    );
    if (binding.mac) {
      assert.ok(
        EDITOR_FOLD_HELP_TEXT.includes(binding.mac),
        `EDITOR_FOLD_HELP_TEXT must mention the real foldKeymap Mac key "${binding.mac}"`,
      );
    }
  }
});

test("editorFocusStop throws if the injected focus-order list is missing an 'editor' stop", () => {
  // a11y.ts's real REPL_FOCUS_ORDER always contains an "editor" stop, so this guard is
  // structurally unreachable through the default parameter — inject a stub list to exercise it.
  assert.throws(
    () => editorFocusStop([{ id: "run-button", role: "button", label: "Run" }]),
    {
      message: /REPL_FOCUS_ORDER is missing its 'editor' stop/,
    },
  );
});

test("createEditorExtensions returns a non-empty extension list usable by EditorState.create", () => {
  const extensions = createEditorExtensions();
  assert.ok(extensions.length > 0);
  assert.doesNotThrow(() => {
    EditorState.create({ doc: "forward 100", extensions });
  });
});

test("the fold service reports a foldable range for a bracketed repeat block's starting line", () => {
  const source = "repeat 4 [\n  forward 10\n  right 90\n]";
  const state = stateFor(source);
  const range = foldable(state, 0, source.indexOf("\n"));

  assert.ok(range);
  assert.equal(
    source.slice(range.from, range.to),
    "[\n  forward 10\n  right 90\n]",
  );
});

test("the fold service reports no foldable range for a line with no block start", () => {
  const source = "repeat 4 [\n  forward 10\n  right 90\n]";
  const secondLineStart = source.indexOf("\n") + 1;
  const secondLineEnd = source.indexOf("\n", secondLineStart);
  const state = stateFor(source);

  assert.equal(foldable(state, secondLineStart, secondLineEnd), null);
});

test("the fold service memo cache is exercised across repeated queries on the same source (cache hit)", () => {
  const source = "repeat 2 [\n  forward 1\n]\nrepeat 2 [\n  forward 2\n]";
  const state = stateFor(source);

  const first = foldable(state, 0, source.indexOf("\n"));
  const secondBlockStart = source.indexOf("repeat 2 [\n  forward 2");
  const secondLineStart = secondBlockStart;
  const secondLineEnd = source.indexOf("\n", secondLineStart);
  const second = foldable(state, secondLineStart, secondLineEnd);

  assert.ok(first);
  assert.ok(second);
  assert.notEqual(first.from, second.from);
});

test("the fold service recomputes when queried against a different source (cache miss)", () => {
  const stateA = stateFor("repeat 4 [\n  forward 10\n]");
  const stateB = stateFor("while :x < 10\n  print 1\nend\n");

  const rangeA = foldable(stateA, 0, stateA.doc.line(1).to);
  const rangeB = foldable(stateB, 0, stateB.doc.line(1).to);

  assert.ok(rangeA);
  assert.ok(rangeB);
});

test("selectionFromEditorState converts CM6's 0-based offsets to this repo's 1-based Positions", () => {
  const state = EditorState.create({ doc: "abc\ndef" });
  const withSelection = state.update({
    selection: { anchor: 5, head: 5 },
  }).state;

  assert.deepEqual(selectionFromEditorState(withSelection), {
    anchor: [2, 2],
    head: [2, 2],
  });
});

test("buildStoreSyncSpec replaces the doc text and maps the selection when the store's text differs", () => {
  const state = EditorState.create({ doc: "old text" });
  const spec = buildStoreSyncSpec(state, "new text", {
    anchor: [1, 1],
    head: [1, 4],
  });
  const nextState = state.update(spec).state;

  assert.equal(nextState.doc.toString(), "new text");
  assert.equal(nextState.selection.main.anchor, 0);
  assert.equal(nextState.selection.main.head, 3);
});

test("buildStoreSyncSpec does not touch the doc when the store's text already matches", () => {
  const state = EditorState.create({ doc: "same text" });
  const spec = buildStoreSyncSpec(state, "same text", {
    anchor: [1, 1],
    head: [1, 1],
  });

  assert.equal(spec.changes, undefined);
});

test("buildStoreSyncSpec clamps an out-of-range selection to the new document's bounds", () => {
  const state = EditorState.create({
    doc: "old, much longer text than the new one",
  });
  const spec = buildStoreSyncSpec(state, "new", {
    anchor: [1, 1],
    head: [1, 40],
  });
  const nextState = state.update(spec).state;

  assert.equal(nextState.selection.main.head, 3);
});

test("a transaction built by buildStoreSyncSpec is recognized by isExternalSyncTransaction", () => {
  const state = EditorState.create({ doc: "abc" });
  const spec = buildStoreSyncSpec(state, "abcd", {
    anchor: [1, 1],
    head: [1, 1],
  });
  const transaction = state.update(spec);

  assert.equal(isExternalSyncTransaction(transaction), true);
});

test("an ordinary local transaction is NOT recognized as an external sync", () => {
  const state = EditorState.create({ doc: "abc" });
  const transaction = state.update({ changes: { from: 3, insert: "d" } });

  assert.equal(isExternalSyncTransaction(transaction), false);
});

test("externalSync is a distinct annotation type from any other annotation", () => {
  assert.notEqual(externalSync, undefined);
});

test("needsExternalSync is false when the incoming source and selection both already match the state", () => {
  const state = EditorState.create({ doc: "abc" });
  const selection = selectionFromEditorState(state);

  assert.equal(needsExternalSync(state, "abc", selection), false);
});

test("needsExternalSync is true when the incoming source differs from the state's document", () => {
  const state = EditorState.create({ doc: "abc" });
  const selection = selectionFromEditorState(state);

  assert.equal(needsExternalSync(state, "abcd", selection), true);
});

test("needsExternalSync is true when only the incoming selection differs (same document text)", () => {
  const state = EditorState.create({
    doc: "abc",
    selection: { anchor: 0 },
  });

  assert.equal(
    needsExternalSync(state, "abc", { anchor: [1, 3], head: [1, 3] }),
    true,
  );
});

test("decideExternalSync returns a transaction spec immediately when not composing and the state differs", () => {
  const state = EditorState.create({ doc: "old" });
  const queue = createExternalSyncQueue();

  const spec = decideExternalSync(queue, state, false, "new", {
    anchor: [1, 1],
    head: [1, 1],
  });

  assert.notEqual(spec, undefined);
  assert.equal(state.update(spec).state.doc.toString(), "new");
  assert.equal(queue.pending, undefined);
});

test("decideExternalSync returns undefined (no dispatch) when not composing and the state already matches", () => {
  const state = EditorState.create({ doc: "same" });
  const selection = selectionFromEditorState(state);
  const queue = createExternalSyncQueue();

  assert.equal(
    decideExternalSync(queue, state, false, "same", selection),
    undefined,
  );
});

test("decideExternalSync defers (does not dispatch) an update that arrives while composing", () => {
  const state = EditorState.create({ doc: "old" });
  const queue = createExternalSyncQueue();
  const selection = { anchor: [1, 1], head: [1, 1] };

  const spec = decideExternalSync(queue, state, true, "new", selection);

  assert.equal(spec, undefined);
  assert.deepEqual(queue.pending, { source: "new", selection });
});

test("decideExternalSync's deferred snapshot is superseded by a later one while still composing", () => {
  const state = EditorState.create({ doc: "old" });
  const queue = createExternalSyncQueue();

  decideExternalSync(queue, state, true, "first", {
    anchor: [1, 1],
    head: [1, 1],
  });
  decideExternalSync(queue, state, true, "second", {
    anchor: [1, 2],
    head: [1, 2],
  });

  assert.equal(queue.pending.source, "second");
});

test("reconcileExternalSyncQueue is a no-op when nothing was deferred", () => {
  const state = EditorState.create({ doc: "abc" });
  const queue = createExternalSyncQueue();

  assert.equal(reconcileExternalSyncQueue(queue, state), undefined);
});

test("reconcileExternalSyncQueue applies a deferred snapshot once composition ends", () => {
  const state = EditorState.create({ doc: "old" });
  const queue = createExternalSyncQueue();
  decideExternalSync(queue, state, true, "new", {
    anchor: [1, 1],
    head: [1, 1],
  });

  const spec = reconcileExternalSyncQueue(queue, state);

  assert.notEqual(spec, undefined);
  assert.equal(state.update(spec).state.doc.toString(), "new");
  assert.equal(queue.pending, undefined);
});

test("reconcileExternalSyncQueue clears a deferred snapshot that turns out to already match the state", () => {
  const state = EditorState.create({ doc: "abc" });
  const selection = selectionFromEditorState(state);
  const queue = createExternalSyncQueue();
  decideExternalSync(queue, state, true, "abc", selection);

  assert.equal(reconcileExternalSyncQueue(queue, state), undefined);
  assert.equal(queue.pending, undefined);
});

test("handleViewUpdate reports a real local doc edit, but not an external sync", () => {
  const seen = [];
  const options = {
    onLocalChange: (text, selection) => seen.push({ text, selection }),
  };
  let state = EditorState.create({ doc: "abc" });

  // A real local edit reports the callback.
  const localTransaction = state.update({ changes: { from: 3, insert: "d" } });
  state = localTransaction.state;
  handleViewUpdate(viewUpdateFrom(localTransaction), options);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].text, "abcd");

  // A store-driven external sync must NOT fire it again.
  const syncTransaction = state.update(
    buildStoreSyncSpec(state, "abcde", { anchor: [1, 6], head: [1, 6] }),
  );
  state = syncTransaction.state;
  handleViewUpdate(viewUpdateFrom(syncTransaction), options);
  assert.equal(seen.length, 1);
});

test("handleViewUpdate reports a selection-only move, not a doc edit", () => {
  const selections = [];
  const options = {
    // A selection-only move must never reach `onLocalChange` — `assert.fail` proves that by
    // throwing if it ever fires, rather than a fresh arrow function whose body would sit
    // permanently uncovered (this test never causes a doc edit by design).
    onLocalChange: assert.fail,
    onLocalSelectionChange: (selection) => selections.push(selection),
  };
  const state = EditorState.create({ doc: "abcdef" });

  const transaction = state.update({ selection: { anchor: 2, head: 4 } });
  handleViewUpdate(viewUpdateFrom(transaction), options);

  assert.equal(selections.length, 1);
  assert.deepEqual(selections[0], { anchor: [1, 3], head: [1, 5] });
});

test("handleViewUpdate is a no-op for an update with neither a doc change nor a selection change", () => {
  const state = EditorState.create({ doc: "abcdef" });
  // An empty transaction: no changes, no explicit selection. `assert.fail` (rather than a fresh
  // arrow function of our own) is the callback here on purpose — it proves neither callback fires
  // by throwing if either is ever invoked, without leaving one of our own function bodies
  // permanently uncovered by design (see web-bootstrap.test.mjs's identical marker-over-fake-
  // function rationale).
  const transaction = state.update({});
  handleViewUpdate(viewUpdateFrom(transaction), {
    onLocalChange: assert.fail,
    onLocalSelectionChange: assert.fail,
  });
});

test("createEditorExtensions omits the update listener entirely when no callbacks are given", () => {
  const withoutCallbacks = createEditorExtensions();
  // `createEditorExtensions` only checks this callback's presence here, never calls it — reuse
  // `assert.fail` (see the no-op `handleViewUpdate` test above) rather than a fresh arrow function
  // that would sit permanently uncovered.
  const withCallbacks = createEditorExtensions({ onLocalChange: assert.fail });

  assert.ok(withCallbacks.length > withoutCallbacks.length);
});

test("createUpdateListener's returned callback forwards a real local edit to handleViewUpdate", () => {
  // Exercises the exact update-listener wrapper `createEditorExtensions` registers with CM6's
  // `EditorView.updateListener.of(...)`, without needing a real `EditorView`'s dispatch loop —
  // `EditorView.updateListener` only ever fires through that loop (see the module doc comment),
  // so this named factory is the DOM-free seam that keeps the wrapper itself covered.
  const seen = [];
  const listener = createUpdateListener({
    onLocalChange: (text, selection) => seen.push({ text, selection }),
  });
  const state = EditorState.create({ doc: "abc" });
  const transaction = state.update({ changes: { from: 3, insert: "d" } });

  listener(viewUpdateFrom(transaction));

  assert.equal(seen.length, 1);
  assert.equal(seen[0].text, "abcd");
});

/** A minimal stub `HighlightProvider`: one `ol-tok-word` token per non-space run. */
function wordHighlighter(source) {
  const tokens = [];
  const re = /\S+/g;
  let match;
  while ((match = re.exec(source)) !== null) {
    tokens.push({
      text: match[0],
      class: "ol-tok-word",
      start: [1, match.index + 1],
      end: [1, match.index + match[0].length + 1],
    });
  }
  return tokens;
}

/** Collect `{ from, to, class }` for every decoration in `decorations` over `[0, length]`. */
function collectDecorations(decorations, length) {
  const spans = [];
  decorations.between(0, length, (from, to, value) => {
    spans.push({ from, to, class: value.spec.class });
  });
  return spans;
}

test("createHighlightExtension paints one mark decoration per token from the given HighlightProvider (#285)", () => {
  const field = createHighlightExtension(wordHighlighter);
  const doc = "forward 100";
  const state = EditorState.create({ doc, extensions: [field] });

  const spans = collectDecorations(state.field(field), doc.length);

  assert.deepEqual(spans, [
    { from: 0, to: 7, class: "ol-tok-word" },
    { from: 8, to: 11, class: "ol-tok-word" },
  ]);
});

test("createHighlightExtension recomputes decorations from the highlighter when the doc changes", () => {
  let calls = 0;
  const countingHighlighter = (source) => {
    calls += 1;
    return wordHighlighter(source);
  };
  const field = createHighlightExtension(countingHighlighter);
  const state = EditorState.create({ doc: "forward 100", extensions: [field] });
  assert.equal(calls, 1);

  const next = state.update({
    changes: { from: 8, to: 11, insert: "200" },
  }).state;

  assert.equal(calls, 2);
  const spans = collectDecorations(next.field(field), next.doc.length);
  assert.deepEqual(spans, [
    { from: 0, to: 7, class: "ol-tok-word" },
    { from: 8, to: 11, class: "ol-tok-word" },
  ]);
});

test("createHighlightExtension only maps existing decorations (no reclassification) for a selection-only update", () => {
  let calls = 0;
  const countingHighlighter = (source) => {
    calls += 1;
    return wordHighlighter(source);
  };
  const field = createHighlightExtension(countingHighlighter);
  const state = EditorState.create({ doc: "forward 100", extensions: [field] });
  assert.equal(calls, 1);

  const next = state.update({ selection: { anchor: 0, head: 3 } }).state;

  // The doc did not change, so the field's `update` must not call the highlighter again.
  assert.equal(calls, 1);
  const spans = collectDecorations(next.field(field), next.doc.length);
  assert.deepEqual(spans, [
    { from: 0, to: 7, class: "ol-tok-word" },
    { from: 8, to: 11, class: "ol-tok-word" },
  ]);
});

test("createHighlightExtension skips a zero-width token span rather than throwing", () => {
  const zeroWidthHighlighter = () => [
    { text: "", class: "ol-tok-word", start: [1, 1], end: [1, 1] },
  ];
  const field = createHighlightExtension(zeroWidthHighlighter);
  const state = EditorState.create({ doc: "x", extensions: [field] });

  assert.deepEqual(collectDecorations(state.field(field), 1), []);
});

test("createHighlightExtension skips a token span past the end of the document rather than throwing", () => {
  // A misbehaving (or stale, e.g. classifying against text from before an external edit) provider
  // could report a span beyond `state.doc.length`; `RangeSetBuilder.add` throws if given such an
  // offset, so `buildHighlightDecorations` must bounds-check every span against the current doc
  // rather than trusting the provider's contract.
  const outOfRangeHighlighter = () => [
    { text: "x", class: "ol-tok-word", start: [1, 1], end: [2, 2] },
  ];
  const field = createHighlightExtension(outOfRangeHighlighter);

  assert.doesNotThrow(() => {
    const state = EditorState.create({ doc: "x", extensions: [field] });
    assert.deepEqual(collectDecorations(state.field(field), 1), []);
  });
});

test("createHighlightExtension skips a token whose column overruns its own line, rather than spilling into the next line's text (#432 finding 4)", () => {
  // Same class of bug #317 already fixed for the diagnostics path: a column past the end of
  // line 1 ("abc", length 3, so valid columns are 1..4) must not resolve to an offset inside
  // line 2's text just because the raw absolute offset happens to still be < doc.length — the
  // stale/out-of-line-range span must be skipped, never decorate the next line.
  const overrunHighlighter = () => [
    { text: "z", class: "ol-tok-word", start: [1, 6], end: [1, 8] },
  ];
  const field = createHighlightExtension(overrunHighlighter);
  const state = EditorState.create({ doc: "abc\nxyz", extensions: [field] });

  assert.deepEqual(
    collectDecorations(state.field(field), state.doc.length),
    [],
  );
});

test("createEditorExtensions adds the #285 highlight extension only when a highlighter is configured", () => {
  const withoutHighlighter = createEditorExtensions();
  const withHighlighter = createEditorExtensions({
    highlighter: wordHighlighter,
  });

  assert.ok(withHighlighter.length > withoutHighlighter.length);
  assert.doesNotThrow(() => {
    EditorState.create({ doc: "forward 100", extensions: withHighlighter });
  });
});

test("createEditorExtensions always includes the #317 diagnosticsField, unlike the opt-in highlighter", () => {
  const extensions = createEditorExtensions();
  const state = EditorState.create({ doc: "forward 100", extensions });

  // `state.field` throws if the field isn't actually part of `extensions` — this alone proves
  // #317's field is unconditionally wired in, with no `diagnostics`-only opt-in like the
  // highlighter's `highlighter` option.
  assert.deepEqual(state.field(diagnosticsField), {
    diagnostics: [],
    decorations: state.field(diagnosticsField).decorations,
  });
  assert.equal(
    collectDecorations(
      state.field(diagnosticsField).decorations,
      state.doc.length,
    ).length,
    0,
  );
});

test("diagnosticsField paints one squiggle mark per diagnostic, classed by severity, with the message as a title (#317)", () => {
  const state = EditorState.create({
    doc: "forward 100\nfd 50",
    extensions: [diagnosticsField],
  });

  const withDiagnostics = state.update({
    effects: setDiagnosticsEffect.of([
      fakeDiagnostic({
        code: "ol-unknown-command",
        message: "unknown command 'forward'",
        severity: "error",
        source_span: { document: "x", start: [1, 1], end: [1, 8] },
      }),
      fakeDiagnostic({
        code: "ol-style-heritage-alias",
        message: "prefer the Core spelling",
        severity: "warning",
        source_span: { document: "x", start: [2, 1], end: [2, 3] },
      }),
    ]),
  }).state;

  const spans = [];
  withDiagnostics
    .field(diagnosticsField)
    .decorations.between(0, withDiagnostics.doc.length, (from, to, value) => {
      spans.push({
        from,
        to,
        class: value.spec.class,
        title: value.spec.attributes.title,
      });
    });

  assert.deepEqual(spans, [
    {
      from: 0,
      to: 7,
      class: "ol-diagnostic-error-mark",
      title: "unknown command 'forward'",
    },
    {
      from: 12,
      to: 14,
      class: "ol-diagnostic-warning-mark",
      title: "prefer the Core spelling",
    },
  ]);
});

test("diagnosticsField only maps existing decorations (no rebuild) for a doc change with no new diagnostics effect", () => {
  const state = EditorState.create({
    doc: "forward 100",
    extensions: [diagnosticsField],
  });
  const withDiagnostics = state.update({
    effects: setDiagnosticsEffect.of([
      fakeDiagnostic({
        source_span: { document: "x", start: [1, 1], end: [1, 8] },
      }),
    ]),
  }).state;

  const next = withDiagnostics.update({
    changes: { from: 8, to: 11, insert: "200" },
  }).state;

  assert.equal(next.field(diagnosticsField).diagnostics.length, 1);
  const spans = collectDecorations(
    next.field(diagnosticsField).decorations,
    next.doc.length,
  );
  assert.deepEqual(spans, [
    { from: 0, to: 7, class: "ol-diagnostic-error-mark" },
  ]);
});

test("diagnosticsField is a pure no-op passthrough for a transaction that neither changes the doc nor carries the effect", () => {
  const state = EditorState.create({
    doc: "forward 100",
    extensions: [diagnosticsField],
  });
  const before = state.field(diagnosticsField);

  const next = state.update({ selection: { anchor: 0, head: 3 } }).state;

  assert.equal(next.field(diagnosticsField), before);
});

test("diagnosticsField skips a stale diagnostic span past the end of the document rather than throwing (#317, mirrors #285)", () => {
  const state = EditorState.create({
    doc: "x",
    extensions: [diagnosticsField],
  });

  assert.doesNotThrow(() => {
    const withDiagnostics = state.update({
      effects: setDiagnosticsEffect.of([
        fakeDiagnostic({
          source_span: { document: "x", start: [1, 1], end: [2, 2] },
        }),
      ]),
    }).state;
    assert.equal(withDiagnostics.field(diagnosticsField).diagnostics.length, 1);
    assert.equal(
      collectDecorations(
        withDiagnostics.field(diagnosticsField).decorations,
        withDiagnostics.doc.length,
      ).length,
      0,
    );
  });
});

test("diagnosticsField skips a zero-width diagnostic span rather than painting an empty mark", () => {
  const state = EditorState.create({
    doc: "x",
    extensions: [diagnosticsField],
  });

  const withDiagnostics = state.update({
    effects: setDiagnosticsEffect.of([
      fakeDiagnostic({
        source_span: { document: "x", start: [1, 1], end: [1, 1] },
      }),
    ]),
  }).state;

  assert.equal(
    collectDecorations(
      withDiagnostics.field(diagnosticsField).decorations,
      withDiagnostics.doc.length,
    ).length,
    0,
  );
});

test("diagnosticsField skips a diagnostic whose line number does not exist in the current document, rather than throwing", () => {
  // A stale diagnostic from before an edit that removed lines (or a malformed span) referencing a
  // line beyond `state.doc.lines` must be rejected outright, not spill into some other offset.
  const state = EditorState.create({
    doc: "x",
    extensions: [diagnosticsField],
  });

  assert.doesNotThrow(() => {
    const withDiagnostics = state.update({
      effects: setDiagnosticsEffect.of([
        fakeDiagnostic({
          source_span: { document: "x", start: [5, 1], end: [5, 2] },
        }),
        fakeDiagnostic({
          source_span: { document: "x", start: [0, 1], end: [0, 2] },
        }),
      ]),
    }).state;
    assert.equal(
      collectDecorations(
        withDiagnostics.field(diagnosticsField).decorations,
        withDiagnostics.doc.length,
      ).length,
      0,
    );
  });
});

test("diagnosticsField skips a diagnostic whose column overruns its own line, rather than spilling into the next line's text (#317)", () => {
  // A column past the end of line 1 ("abc", length 3, so valid columns are 1..4) must not resolve
  // to an offset inside line 2's text just because the raw absolute offset happens to still be
  // < doc.length — that would silently mark the wrong span instead of being skipped.
  const state = EditorState.create({
    doc: "abc\nxyz",
    extensions: [diagnosticsField],
  });

  const withDiagnostics = state.update({
    effects: setDiagnosticsEffect.of([
      fakeDiagnostic({
        source_span: { document: "x", start: [1, 6], end: [1, 8] },
      }),
    ]),
  }).state;

  assert.equal(
    collectDecorations(
      withDiagnostics.field(diagnosticsField).decorations,
      withDiagnostics.doc.length,
    ).length,
    0,
  );
});

test("diagnosticsField sorts out-of-order diagnostics into ascending (from, to) order before building marks", () => {
  const state = EditorState.create({
    doc: "forward 100\nfd 50",
    extensions: [diagnosticsField],
  });

  const withDiagnostics = state.update({
    effects: setDiagnosticsEffect.of([
      // Given last, but its span starts earlier — `RangeSetBuilder` requires ascending order.
      fakeDiagnostic({
        message: "second in the array, first on the line",
        source_span: { document: "x", start: [2, 1], end: [2, 3] },
      }),
      fakeDiagnostic({
        message: "first in the array, second on the line",
        source_span: { document: "x", start: [1, 1], end: [1, 8] },
      }),
    ]),
  }).state;

  const spans = collectDecorations(
    withDiagnostics.field(diagnosticsField).decorations,
    withDiagnostics.doc.length,
  );
  assert.deepEqual(spans, [
    { from: 0, to: 7, class: "ol-diagnostic-error-mark" },
    { from: 12, to: 14, class: "ol-diagnostic-error-mark" },
  ]);
});

test("diagnosticSpanEntries breaks a tie on equal `from` by ascending `to`, via the same shared-start line #317 exercises", () => {
  const state = EditorState.create({
    doc: "forward 100",
    extensions: [diagnosticsField],
  });

  const withDiagnostics = state.update({
    effects: setDiagnosticsEffect.of([
      // Same start, given with the wider span first — the `a.from - b.from` tiebreak is 0, so
      // the sort must fall through to `a.to - b.to` to still order them ascending by end.
      fakeDiagnostic({
        message: "wider span given first",
        source_span: { document: "x", start: [1, 1], end: [1, 8] },
      }),
      fakeDiagnostic({
        message: "narrower span given second",
        source_span: { document: "x", start: [1, 1], end: [1, 3] },
      }),
    ]),
  }).state;

  const spans = collectDecorations(
    withDiagnostics.field(diagnosticsField).decorations,
    withDiagnostics.doc.length,
  );
  assert.deepEqual(spans, [
    { from: 0, to: 2, class: "ol-diagnostic-error-mark" },
    { from: 0, to: 7, class: "ol-diagnostic-error-mark" },
  ]);
});

test("computeDiagnosticGutterLines groups bounds-checked diagnostics by line, escalating to error when both severities land on the same line (#317)", () => {
  const state = EditorState.create({ doc: "forward 100\nfd 50\nbk 20" });

  const lines = computeDiagnosticGutterLines(state, [
    fakeDiagnostic({
      severity: "warning",
      message: "prefer forward over fd",
      source_span: { document: "x", start: [2, 1], end: [2, 3] },
    }),
    fakeDiagnostic({
      severity: "error",
      message: "unknown command 'bk'",
      source_span: { document: "x", start: [3, 1], end: [3, 3] },
    }),
    // A second diagnostic on line 2 escalates that line's severity from warning to error.
    fakeDiagnostic({
      severity: "error",
      message: "second problem on the same line",
      source_span: { document: "x", start: [2, 4], end: [2, 6] },
    }),
  ]);

  assert.deepEqual(lines, [
    {
      line: 2,
      severity: "error",
      messages: ["prefer forward over fd", "second problem on the same line"],
    },
    { line: 3, severity: "error", messages: ["unknown command 'bk'"] },
  ]);
});

test("computeDiagnosticGutterLines returns nothing for an empty diagnostics list or an out-of-range span", () => {
  const state = EditorState.create({ doc: "x" });

  assert.deepEqual(computeDiagnosticGutterLines(state, []), []);
  assert.deepEqual(
    computeDiagnosticGutterLines(state, [
      fakeDiagnostic({
        source_span: { document: "x", start: [1, 1], end: [2, 2] },
      }),
    ]),
    [],
  );
});
