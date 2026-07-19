# `@openlogo/studio`

**The OpenLogo UI that runs in a browser.** A TypeScript web app hosting the code editor/REPL, the
**Canvas** turtle view, the diagnostics UI, and the lesson/tutor pane, with Run/Stop/Reset/Step,
persistence, and accessibility. It composes the other packages and owns no language logic.

- **Source root:** `src/` — app entry `src/index.ts`; keep a headless `run-controller.ts` + state
  model separate from the view/DOM so it is testable without a browser.
- **Owner:** [`@learner-experience`](../../.github/agents/learner-experience.agent.md).
- **Working rules:** [`studio.instructions.md`](../../.github/instructions/studio.instructions.md).
- **Spec:** [`rendering.md`](../../spec/rendering.md) (Canvas target + controls + a11y),
  [`tooling.md`](../../spec/tooling.md) (LSP integration),
  [`interaction-events.md`](../../spec/interaction-events.md).
- **Depends on:** `@openlogo/parser`, `@openlogo/runtime`, `@openlogo/turtle`, `@openlogo/edu`,
  `@openlogo/core`.

## State model + app shell (#123)

Every pane composes over **one** shared instance — never a per-pane copy:

- `createStudioState()` (`src/state-model.ts`) — the single source of truth: `source`
  (document text), `selection` (cursor/selection), `runStatus`
  (`"idle" | "running" | "stopped"`), `diagnostics` (`@openlogo/core` `Diagnostic[]`), and
  `lesson` (lesson context for `@openlogo/edu` content). State changes only through its `set*`
  methods; `getState()` is stable by reference between changes, and `subscribe` notifies
  listeners synchronously after every change — see the doc comment in `state-model.ts` for the
  full contract.
- `createAppShell(state)` (`src/app-shell.ts`) — a composable region registry (`editor`,
  `turtle`, `diagnostics`, `lesson`, `repl`), each starting as an empty placeholder. Later panes
  (#124 editor, #125 diagnostics, #126 run/stop, #127 lesson, #128 persistence, #129 a11y) call
  `shell.mount(region, pane)` to compose themselves in, and read/write state via `shell.state`
  (the same store instance, not a copy).

No studio shell framework/bundler is pinned yet (deferred in ADR-0001), so this slice models the
shell headlessly (plain objects, no DOM) to stay simple and testable under `node:test`; a later
slice may swap in a real renderer without changing this contract.

## Editor pane (#124)

- `createEditorController(state, options?)` (`src/editor.ts`) — the headless editing controller:
  `getText`/`getSelection` read straight from the shared state model; `setText`/`setSelection`/
  `insertText`/`deleteBackward`/`deleteForward` write straight through it. There is no private
  text buffer, so two controllers over the same store always agree — the #123 single-source-of-
  truth contract holds through editing.
- `mountEditorPane(shell, controller)` composes the controller into the shell's `editor` region.
- Syntax coloring is a pluggable seam: `getTokens()` delegates to a `HighlightProvider` (default
  `noopHighlighter`, i.e. plain text). This slice has no hard dependency on the epic #118
  highlighter — pass a provider built from `@openlogo/parser`'s `semanticTokens` once you want
  real coloring; this module never re-implements token classification itself.
- See `editor.ts`'s doc comment for the DOM/mount integration contract a later real-widget slice
  (e.g. a `<textarea>`/CodeMirror/Monaco host) should follow to stay headless-first and avoid
  ever forking the document text or regressing keyboard operability.

