# 13. Studio editor component: CodeMirror 6 for the rich editor surface

- Status: Accepted
- Date: 2026-07-21 (proposed); 2026-07-22 (accepted, delegated ratification — see "Checkpoint
  before build")
- Deciders: OpenLogo maintainer (@pmalarme) — in-session CM6 approval + implement-everything
  directive; ratified for build under the M11 orchestrator's delegated authority while the
  maintainer was unavailable for a second sign-off. Final maintainer ratification of the shipped
  implementation is still expected at PR review.
- Related: [ADR-0001](0001-tech-stack.md) (defers the studio shell/editor-widget sub-decision this
  ADR resolves); [ADR-0011](0011-studio-app-bundler.md) (Vite hosts the browser app this editor
  mounts into); `editor.ts`'s own DOM/mount-integration doc comment (already anticipates this
  decision — see Context); issue #279 (the `REPL_FOCUS_ORDER`/`REPL_LANDMARK_ROLES` a11y contracts
  this ADR must not regress); issue #315 (this slice); epic #290; milestone #11.

## Context

`packages/studio/src/editor.ts` (issue #124) is a **headless** editor-pane controller: it owns the
document text and selection through the shared `StudioStateStore`, exposes a pluggable
`HighlightProvider` seam (`noopHighlighter` today; `@openlogo/parser`'s `semanticTokens` lands in
#285), and its own doc comment already says a later slice "introduces a real
`<textarea>`/CodeMirror/Monaco widget" bound to it via `insertText`/`deleteBackward`/
`setSelection`/`getTokens` — this ADR is that later slice's component decision. Today the actual
browser page (`packages/studio/web/main.ts`, ADR-0011) wires that controller to a plain
`<textarea>`, which has no gutter and cannot fold `[ ... ]` / `... end` blocks.

Issue #315 asks for three things: (1) replace the `<textarea>` with an a11y-friendly editor
surface, (2) show a line-number gutter, (3) support folding `[ ... ]` and `... end` blocks — and
requires the component choice be recorded in a new ADR **before** the dependency is added, per the
issue's own Definition of Done ("Any new dependency = ADR + `package-lock.json` change"). #315 is
also the foundation #285 (real highlighting) and the later inline-error-markers slice build on, so
the choice must not be a throwaway that gets replaced when those land.

The maintainer additionally reserved the dependency decision itself: this ADR was drafted **first,
as a draft only** — no dependency installed, no `package.json`/`package-lock.json` change, and no
code under `packages/studio/src/editor.ts` or `packages/studio/web/` touched as part of drafting it
— and implementation began only after ratification (see "Checkpoint before build" below for how
that ratification was recorded).

`@openlogo/studio` had never shipped a production bundle before this slice: `packages/studio/web-dist/`
was not committed and no `vite build` artifact existed in this tree prior to #315
(ADR-0011 only just added `vite build` as a script; issue #277's slices had stayed dev-server-only
so far). There was therefore **no pre-existing `web-dist/` baseline to measure against** — the
honest starting point was that the shipped JS for the editor pane was whatever `tsc -b` emits for
`editor.ts` itself (a few KB of plain TypeScript, no
runtime dependency), plus the `<textarea>` element the browser provides for free. Any editor
dependency this ADR adds is measured as an **absolute addition** against that near-zero baseline,
not as a multiplier against a shipped bundle.

### The two options to evaluate

1. **CodeMirror 6** (`@codemirror/*` scoped packages) — a mature, modular, `contenteditable`-based
   code-editor toolkit.
2. **A lightweight custom editor surface** — keep (or lightly extend) a native host element
   (`<textarea>` or a hand-rolled `contenteditable`) and hand-write gutter rendering, fold
   state, and interaction ourselves on top of the existing headless `EditorController`.

## Decision

**Recommendation: adopt CodeMirror 6**, imported as a small set of modular `@codemirror/*`
packages (not the `codemirror`/`basicSetup` convenience bundle), wired underneath the existing
headless `EditorController` exactly as `editor.ts`'s own doc comment already anticipates. A custom
surface is rejected primarily on accessibility grounds (criterion 1 is disqualifying), not on KISS
grounds — see the trade-off analysis below.

### 1. Accessibility — the disqualifying criterion

**Today's baseline (must not regress):** a native `<textarea>` is a natively focusable, natively
labeled, natively editable host element. Keyboard operability (Tab in/out, arrow keys, Home/End,
selection, native undo) and screen-reader exposure (`role=textbox`, live text content, cursor
position) come for free from the browser. `a11y.ts`'s `REPL_FOCUS_ORDER` models the editor as a
single `textbox` focus stop; `REPL_LANDMARK_ROLES` models its container the same way. Neither
contract depends on the `<textarea>` specifically — they depend on the editor region behaving like
a `textbox` at the DOM level.

**CodeMirror 6:**
- Renders into a `contenteditable` host, not a `<textarea>`, but CM6 was written from the ground up
  (unlike CM5) to make that host behave like a native text field to assistive technology: it sets
  `role="textbox"`, `aria-multiline="true"`, and keeps the DOM's visible text content and cursor
  position synchronized with its internal document so screen readers read real content rather than
  a canvas-painted illusion (unlike Monaco's canvas-based renderer, which is a much worse a11y
  starting point and was not one of the two options the maintainer asked us to evaluate).
- Known, *addressable* gaps exist and must be closed explicitly in the implementation slice, not
  assumed away: CM6 does **not** supply an accessible name for its content host by default — the
  integrator must set one (we will pass `REPL_FOCUS_ORDER`'s existing `"OpenLogo source editor"`
  label straight into CM6's `contentAttributes`/`aria-label` facet, so the a11y contract's label
  text does not even change). Community reports (CodeMirror's own discussion forum, 2024-2025) also
  flag that a visual placeholder must not carry a stray `aria-label` on a non-interactive node; we
  have no placeholder requirement in #315, so that specific trap does not apply to this slice.
  **Correction from initial draft:** the two chrome surfaces are *not* uniformly `aria-hidden`.
  The **gutters** (line-number gutter, fold-toggle gutter) are outside the document-text flow and
  CM6's `@codemirror/view` gutter API marks their DOM nodes `aria-hidden`, which is correct — a
  screen reader must not read gutter numbers/icons as document content. The **folded-range
  placeholder** — the inline marker CM6 substitutes into the document flow for a collapsed range —
  is the opposite: it is a real, unhidden inline node (CM6's default is a clickable `<span>` with
  `aria-label="folded code"`) so a screen reader reading through the document encounters an
  explicit "folded code" announcement instead of silently skipping text. We must not make this
  placeholder `aria-hidden`; doing so would make collapsed regions invisible to assistive tech
  while still visible (as a fold marker) to sighted users — worse than today, not neutral.
- **Keyboard parity requires an explicit extension set, not just `defaultKeymap`.**
  `foldGutter()`'s built-in interaction is pointer/click-driven only; keyboard-only users need
  `@codemirror/language`'s `foldKeymap` (fold/unfold-at-cursor bindings) wired in explicitly, or
  folding becomes mouse-only and regresses keyboard parity. Likewise, `@codemirror/commands`'
  `defaultKeymap` does **not** include undo/redo bindings — those come from `history()` (state
  effect) plus `historyKeymap`. The implementation's keymap must therefore be
  `keymap.of([...defaultKeymap, ...historyKeymap, ...foldKeymap])` with the `history()` extension
  also installed, or the "native-textarea-equivalent keyboard behavior" claim below is false. The
  implementation slice must also give a screen-reader-discoverable way to learn the fold shortcut
  (e.g. a documented keybinding surfaced in the lesson pane or a `title`/help text), since it has no
  native-`<textarea>` precedent to fall back on.
- Net verdict: CM6 can meet — and with explicit labeling, the extension set above, and
  reduced-motion (no animated scroll/fold transitions) configuration, does meet — a11y parity with
  the current `<textarea>` and the #279 contracts. This requires deliberate configuration in the
  implementation slice (tracked as explicit acceptance sub-items below, not assumed for free); it is
  not automatic, and the implementation PR must manually verify (keyboard-only and with a
  screen reader) fold, unfold, the "folded code" announcement, Tab-in/Tab-out of the editor, and
  undo/redo before claiming parity.

**Custom surface:**
- A hand-rolled gutter + fold overlay on top of a `<textarea>` cannot render folded regions inside
  the textarea's own text content — a `<textarea>` cannot hide substrings of its value while
  keeping the rest editable and keyboard-navigable; folding a `<textarea>`-based surface means
  either (a) faking it with an overlay `<div>` that visually hides lines while the underlying
  `<textarea>` keeps the full unfolded text (a11y and visual state diverge — a screen reader would
  read collapsed text a sighted user cannot see, which is worse than today, not neutral), or (b) a
  hand-built `contenteditable` document model — technically viable in principle (a `contenteditable`
  block-model *can* represent folded regions natively), but one that reimplements exactly the
  DOM-sync, cursor-mapping, and ARIA-liveness work CodeMirror 6 has already solved and hardened
  across browsers/screen readers for years.
- Building that ourselves means every one of the addressable-but-solved CM6 gaps above (accessible
  name, cursor/selection sync under folding, `aria-multiline`, keyboard mapping across
  Firefox/Chrome/Safari/VoiceOver/NVDA/JAWS) becomes **our** bug surface, discovered by learners and
  screen-reader users in production, instead of an upstream project's already-triaged issue
  tracker. The rejection here is on **implementation, cross-browser, and IME/a11y-validation risk
  for a one-slice delivery** — not a claim that a custom `contenteditable` surface is technically
  impossible in the abstract. Per the maintainer's own framing: "if a custom editor cannot hold
  a11y parity, that is disqualifying" — a first attempt at genuine parity, with folding, validated
  across browsers/screen readers, in one slice, with no upstream triage base, is not a credible risk
  to accept when a hardened option exists.
- **Verdict: disqualified for the folding requirement specifically**, not for line numbers alone
  (a static gutter over a `<textarea>` is tractable and a11y-neutral). Because #315 requires both
  line numbers *and* folding in the same surface, and the safer, well-trodden path for both is one
  component, splitting the two (custom gutter now, CodeMirror later for folding) would mean
  replacing the "custom" work in the very next slice — the throwaway architecture #315's write-set
  note is explicit we must avoid.

### 2. KISS

KISS does not mean "fewest dependencies" in isolation — it means the least code *we* have to write,
own, and keep correct. A custom `contenteditable` document model with real folding and a11y parity
is **more** code than importing CM6's modular core, because CM6 is precisely engineered to be used
in pieces:

- We do **not** import the `codemirror` convenience package or `basicSetup` (which bundles
  autocomplete, search, lint gutter UI, and multiple keymaps we don't need yet). We import only:
  - `@codemirror/state` — the immutable editor state (document, selection, transactions).
  - `@codemirror/view` — the `EditorView` DOM binding, decorations, and the `lineNumbers()` gutter
    extension (satisfies the line-number requirement directly).
  - `@codemirror/language` — `foldGutter()`, `foldService`/`foldNodeProp`, and
    `syntaxHighlighting()` (the last one is the seam #285's real highlighter plugs into later — we
    do **not** wire it in this slice, keeping #315 highlighter-free exactly as `editor.ts` is
    today).
  - `@codemirror/commands` — the minimal default keymap (arrow keys, Home/End, word-wise
    delete/move) so the editor is keyboard-operable without us hand-writing key bindings.
  - No `@codemirror/lang-*` language package: OpenLogo is not one of CodeMirror's bundled
    languages, and #285 owns real tokenization via `@openlogo/parser`'s own `semanticTokens`, not a
    CodeMirror `StreamLanguage`/Lezer grammar.
  - **Fold-range source of truth, corrected from initial draft:** a naive text-level bracket
    matcher is **not** grammar-safe — OpenLogo's `[ ... ]` delimits five distinct grammatical
    constructs (`@openlogo/parser`'s own `OL_BRACKET_ROLES`: `list`, `instruction-block`,
    `selector`, `pattern`, `field-list` — see `packages/parser/src/highlight.ts`), and only
    `instruction-block` should ever fold; folding a list literal, a selector's index brackets, or
    brackets inside a comment/string would be visually confusing and grammatically wrong. The
    implementation must **not** hand-roll bracket scanning. Instead it derives fold ranges from
    `@openlogo/parser`'s already-public, already-tested AST: every node with a `BlockNode` body
    (`If`/`While`/`Repeat`/`Forever`/`ForIn`/`ForRange`/`Comprehension`/`ProcedureDef` — see
    `packages/parser/src/ast.ts`) carries `body.source_span`, and — critically — this span is
    **identical in shape whether the source used `[ ... ]` or `define ... end` surface syntax**
    (confirmed in `highlight.ts`: `markBracketPair(node.body.source_span, "instruction-block")` is
    called uniformly for every such node). A single `foldService` helper therefore: (1) calls
    `parse(source)` (re-parsing on each relevant document change, debounced to avoid doing this on
    every keystroke), (2) walks the AST via the already-exported `walk()` visitor for nodes with a
    `body: BlockNode`, (3) emits one CM6 fold range per body `source_span`, trimmed to the interior
    (excluding the node's own opening delimiter/keyword line so the first line stays visible when
    collapsed, matching CM6's usual fold UX). If the source does not currently parse (mid-edit
    invalid state), the service falls back to **no folds** for the unparseable region rather than
    guessing from raw text — never folding malformed or incomplete input. This reuses the same
    tokenizer/AST already exercised by `semanticTokens`/`highlight`, so it inherits their existing
    test coverage for nesting, labeled `end`s, comments, and strings instead of re-deriving that
    logic. It is implemented as a tested `src/` helper (`fold-ranges.ts` or similar) with its own
    `.test.mjs` covering nested blocks, malformed/incomplete source, comments/strings containing
    `[`/`]`, `list`/`selector`/`pattern`/`field-list` brackets (must **not** fold), and Unicode
    source text.
- This keeps the existing headless/DOM-binding architecture intact: `EditorController` stays the
  single source of truth (`StudioStateStore`); the CM6 `EditorView` becomes the "later real-widget
  slice" `editor.ts`'s doc comment already describes. **The exact synchronization mechanism is
  specified in its own subsection below ("Synchronization protocol")** rather than left as "call
  `insertText`/`setSelection`", because naive event-forwarding between two independently-stateful
  editors (CM6's own transactional `EditorState` and the store's `commit`-per-`set*` model) is a
  known source of cursor-jump and infinite-update-loop bugs if left unspecified.
- **Estimated bundle-size cost (at ratification time):** modular CM6 (`state` + `view` + `commands`
  + `language`, no language package, no autocomplete/search/lint) was reported by the CodeMirror
  community as **roughly 50-80 KB gzipped** for a working editor with a keymap — well below the
  ~250-300 KB gzipped figure often cited for the full `basicSetup`/all-languages bundle, because we
  deliberately exclude everything we don't use and Vite's Rollup-based production build (ADR-0011)
  tree-shakes unused exports. This was an estimate from public reporting, not a measurement of our
  own tree, made explicitly conditional on the implementation PR recording the real number.
- **Actual measured bundle-size cost (implementation PR, `vite build` on Node 22.14.0):**

  | Build | `web-dist/assets/*.js` (raw) | gzip |
  |---|---|---|
  | Before #315 (plain `<textarea>`, this repo's actual pre-existing code) | 171.86 KB | 46.11 KB |
  | After #315 (CM6 `state`+`view`+`commands`+`language`, no highlighter) | 461.55 KB | 141.01 KB |
  | **CM6's own delta** | **+289.69 KB** | **+94.90 KB** |

  The real CM6-attributable delta (**~95 KB gzipped**) is above the ~50-80 KB estimate above, not
  within it — recorded honestly rather than adjusted after the fact. The gap is explained by
  `@codemirror/language`'s own transitive dependencies (`@lezer/common`, `@lezer/highlight`,
  `@lezer/lr`, `style-mod`, `crelt`, `w3c-keyname`) needed for `foldService`/`foldNodeProp` and the
  `syntaxHighlighting()` seam #285 will use later — the public "50-80 KB" figure usually describes
  `state`+`view`+`commands` alone (a plain, unfoldable, unhighlightable editor), not `language` on
  top. ~95 KB gzip is still a modest, one-time, tree-shaken addition against a servable-studio
  budget (the whole `web-dist/` after #315 is **141 KB gzip for JS** — ~145 KB including CSS/HTML),
  and it is the price of real AST-derived folding rather than a throwaway textarea overlay
  (criterion 2). This does not change the recommendation, but the estimate above is superseded by
  this measured number for any future bundle-budget decision. (These figures shift by a fraction of
  a KB on every rebase onto `origin/main`, since the studio barrel re-export transitively pulls in
  other packages' code; the number above is the one measured against this PR's actual merge base.)
- A custom surface has a smaller dependency graph but a **larger and riskier code surface** (our
  own fold/selection/a11y logic, tested only by us, with no upstream triage). KISS favors the
  option with less code *we* are responsible for, which is CodeMirror 6 here.

### 3. Synchronization protocol (CM6 `EditorView` ↔ `StudioStateStore`)

Added in response to review: forwarding CM6's `updateListener` events into
`insertText`/`deleteBackward`/`setSelection` one call at a time cannot faithfully represent paste,
multi-range replace, undo/redo, or IME composition, and naively mirroring `state.subscribe` back
into CM6 risks an infinite local⇄store⇄local loop and cursor jumps (the store's `commit` notifies
synchronously per `set*` call, and `setText` collapses selection). The implementation must follow
an **origin-tagged, atomic** protocol, not ad hoc event forwarding:

- **`StudioStateStore` gains one new atomic setter** (in addition to today's `setSource`/
  `setSelection`), e.g. `setSourceAndSelection(source, selection)`, that performs a single
  `commit`/notify for a combined text+selection change. This is what CM6's local edits call,
  instead of decomposing an edit into a source-only `setSource` followed by a separate
  `setSelection` (two notifications, two renders, and a window where the store's selection is
  briefly stale relative to its own source — the exact cursor-jump risk flagged in review).
- **Local → store (user types in CM6):** on `EditorView`'s `updateListener`, if
  `update.docChanged || update.selectionSet`, read the *whole* resulting `update.state.doc`/
  selection once and call the new atomic setter — not per-keystroke `insertText` calls — so paste,
  multi-cursor edits, and programmatic replacements are represented as one state transition,
  matching however many CM6 transactions produced them.
- **Store → local (external change: persistence restore, another pane, undo at the store level):**
  the existing `state.subscribe` callback compares the incoming `source`/`selection` against the
  view's *current* document/selection; if they differ, it dispatches one CM6 transaction built via
  `view.state.update({ changes: { from: 0, to: doc.length, insert: nextSource }, selection: ...,
  annotations: externalSync.of(true) })`, where `externalSync` is a custom CM6 `Annotation` defined
  for this purpose.
- **Loop prevention:** the `updateListener` above checks
  `update.transactions.some(tr => tr.annotation(externalSync))` and **skips** calling back into the
  store for any transaction that carries that annotation — an externally-applied sync transaction
  never re-triggers a store write, breaking the cycle. This is the standard CM6 pattern for
  external-state binding (annotate transactions by origin, filter on origin in the listener), not a
  bespoke reinvention.
- **IME composition:** store → CM6 sync transactions are suppressed while `view.composing` is true,
  so an external update never interrupts an in-progress composition; local → store sync continues
  to fire on `docChanged` as normal once composition commits characters into the document (CM6 owns
  composition-safety for its own DOM already; we only need to avoid *injecting* competing
  transactions mid-composition).
- **Required tests** (in the new `src/` helper's `.test.mjs`, using CM6's headless `EditorState`
  APIs — no real DOM/browser needed): paste (multi-char single transaction), undo/redo round-trip,
  an external store update while the view is mounted (e.g. simulated persistence restore),
  a selection-only change with no text change, and a documented (best-effort, manually verified)
  IME composition case.

### 4. Security / supply chain

- **Packages to pin (exact versions, via `package-lock.json`):** `@codemirror/state`,
  `@codemirror/view`, `@codemirror/commands`, `@codemirror/language`, added as
  `dependencies` of `@openlogo/studio` (they ship to the learner's browser, unlike Vite which is a
  `devDependency`).
- **Versions to pin at time of writing** (the implementation PR must re-resolve exact current
  patch versions with `npm view <pkg> version` at install time and record the resolved
  `package-lock.json` versions — do not assume these stay current):
  `@codemirror/state@6.7.1`, `@codemirror/view@6.43.6`, `@codemirror/commands@6.10.4`,
  `@codemirror/language@6.12.4`.
- **License:** all four packages are MIT-licensed (same family as `@openlogo/studio` itself — see
  `package.json`'s `"license": "MIT"`), so no license-compatibility gate is at risk.
- **Maintenance status:** CodeMirror 6 is maintained by Marijn Haverbeke (also the author of Acorn,
  ProseMirror, and CodeMirror 5), with a multi-year release cadence (v6 first shipped 2020, still
  receiving regular patch releases as of 2026 — `@codemirror/view` 6.43.6 shipped 2026-07-06,
  `@codemirror/state` 6.7.1 shipped 2026-07-05). It is one of the two most widely deployed browser
  code editors (alongside Monaco), used in production by GitHub's own web editor surfaces among
  many others — a well-known, well-audited supply-chain profile, not an obscure or recently
  abandoned package. **Source hosting note:** as of mid-2026 the project migrated its source and
  issue tracker off GitHub to Haverbeke's self-hosted Forgejo instance
  (`code.haverbeke.berlin/codemirror/*`); the former `github.com/codemirror/*` repositories are now
  stub redirects (confirmed by checking `github.com/codemirror/view` and `github.com/codemirror/dev`
  directly), not a fork or a new major version — issue numbers and GitHub URLs were preserved across
  the move (per the maintainer's own migration announcement on `discuss.codemirror.net`). This is a
  **hosting change only**: the `dev` repo's own README is explicit that "if you want to **use**
  CodeMirror, install the separate packages from npm, and ignore the contents of this repository" —
  npm (`https://www.npmjs.com/package/@codemirror/*`) remains the canonical distribution channel,
  so this ADR's pin-via-`package-lock.json` plan and the exact versions above are unaffected. It is
  a single-maintainer project both before and after the move (the GitHub org was also
  Haverbeke's own), so this does not change the project's human bus-factor risk profile — but it
  does add **source-availability risk**: incident response, source-diffing, and any GitHub-native
  supply-chain tooling (Dependency Graph advisories, OpenSSF Scorecard, `github.com` URLs in
  existing audit tooling) that assumes a GitHub-hosted repo may not resolve or may need
  reconfiguring against the Forgejo host. This is a **residual risk to record, not a risk this ADR
  can eliminate**: we depend on `code.haverbeke.berlin` remaining available for source audit if the
  npm-published artifact is ever questioned.
- **Transitive footprint:** the `@codemirror/*` packages are designed with minimal cross-dependency
  bloat — `@codemirror/view` depends on `@codemirror/state` and `style-mod`/`w3c-keyname` (small,
  single-purpose helper packages from the same maintainer); `@codemirror/commands` and
  `@codemirror/language` depend on `@codemirror/state`/`@codemirror/view` and (for `language`)
  `@lezer/common`/`@lezer/highlight` (the Lezer parsing runtime, used only for its
  `syntaxHighlighting`/fold-related types here, not for a full grammar since we bring no
  `@codemirror/lang-*` package). This is a small, well-known dependency cluster, not a large or
  surprising transitive tree.
- **Correction from initial draft — what pinning actually verifies:** `package-lock.json`'s
  integrity hashes verify that the exact bytes downloaded from the npm registry match what was
  resolved at install time (tarball integrity/reproducibility across installs) — they do **not**
  prove that the published npm artifact corresponds to any particular Forgejo source commit/tag;
  npm-registry provenance attestations (`npm audit signatures`) are a separate, optional check.
  **Attempted in the implementation PR:** `npm audit signatures` returned "found no dependencies to
  audit that were installed from a supported registry" in this build environment, because installs
  here resolve through an internal package-feed proxy
  (`packagefeedproxy.microsoft.io`) rather than directly against `registry.npmjs.org`, and the proxy
  does not support the Sigstore/TUF-based provenance check. This is a stated environment limitation,
  not a finding about the four packages themselves — provenance attestation could not be confirmed
  either way from this machine. If a future run against the public registry succeeds, its result
  should replace this note; until then this is a residual, honestly-recorded gap, consistent with
  most of this repo's existing dependencies today.
- **Correction from initial draft — CI gate is conditional, not unconditional, today:** this repo's
  `dependency-review.yml` workflow runs `dependency-review-action` with
  `continue-on-error: ${{ github.event.repository.private }}` and `fail-on-severity: high` — i.e.
  it is currently **advisory only** while `pmalarme/open-logo` is a private repository (GitHub's
  Dependency Graph, which the action needs, requires GitHub Advanced Security on private repos),
  and becomes a **hard, blocking gate automatically** once the repo is public. The four pinned
  packages must still pass it in whichever mode is active; this ADR does not request or introduce
  any exception, but the "gate compliance" claim must not overstate today's enforcement level.
  There is no separate versioned "secret-scanning workflow" file in `.github/workflows/` — secret
  scanning + push protection are repository-level GitHub settings (see
  `security-and-release/SKILL.md`), not a CI job this PR runs; the new dependency introduces no new
  secrets, so this gate is unaffected either way.
- **Gate compliance:** the exact pinned versions land in `package-lock.json` in the implementation
  PR, which must pass whatever mode of the dependency-review workflow is active (see above)
  unmodified — this ADR introduces no exception to that gate, and introduces no secrets for
  secret-scanning/push-protection to flag.

### 5. Checkpoint before build

This ADR was drafted with Status **Proposed**, per the maintainer's explicit reservation of this
decision: no dependency was installed, no `package.json`/`package-lock.json` file was changed, and
no code under `packages/studio/src/editor.ts` or `packages/studio/web/` was written until
ratification. The learner-experience agent that drafted it stopped after delivering the draft and
awaited an explicit go/no-go before starting the implementation slice.

**Ratification record:** the maintainer (@pmalarme) approved CodeMirror 6 in-session ("ok for
CodeMirror 6") and separately directed that the remaining Studio UX slices be implemented. The M11
orchestrator formally ratified this ADR under delegated authority on that basis while the
maintainer was unavailable for a second, PR-time sign-off, and issued the go-ahead to build #315
end to end. **Final maintainer ratification is still expected at PR review** — this delegated
ratification unblocks implementation; it does not substitute for the maintainer's own review of the
shipped PR. Status is set to **Accepted** in this same PR that lands the ADR alongside the
implementation, with the full Definition of Done and non-author review gate (rubber-duck +
`@testing` clean-tree DoD) applied to that PR as normal.

## Consequences

- The implementation slice added `@codemirror/state`, `@codemirror/view`, `@codemirror/commands`,
  and `@codemirror/language` as pinned runtime `dependencies` of `@openlogo/studio` (shipped to the
  learner's browser via the Vite bundle, ADR-0011), changing `package-lock.json`.
- `packages/studio/src/editor.ts`'s existing headless `EditorController`/`HighlightProvider`
  contract is preserved; CodeMirror 6 is the DOM-binding layer the doc comment already anticipated,
  not a replacement for the state model.
- `web/main.ts` gained a small, thin CM6 `EditorView` construction (line numbers via
  `lineNumbers()`, folding via `foldGutter()` + the AST-derived `foldService` helper described
  under "Synchronization protocol"/"2. KISS" above, plus the default/history/fold keymaps) that
  binds to the existing controller via the origin-tagged sync protocol (`buildStoreSyncSpec`,
  `handleViewUpdate`) — kept thin per `studio.instructions.md` and ADR-0011's "thin wiring, logic in
  tested `src/` helpers" rule; all branching/projection logic (fold-range computation, the CM6↔store
  sync decision logic) lives in tested `src/` helpers (`fold-ranges.ts`, `editor-cm6.ts`), not
  inline in `web/main.ts`.
- **`packages/studio/index.html` changed**, not just `main.ts`: the `<textarea id="editor">` host
  element was replaced by a plain `<div id="editor-host"></div>` container that CM6's `EditorView`
  mounts into, carrying no static `role`/`aria-label` of its own (CM6's own content-editable sets
  those dynamically — see the a11y bullet below) — `main.ts`'s `assertPresent(...HTMLTextAreaElement...)`
  cast was replaced with a plain `HTMLElement` lookup, since CM6 does not render into a `<textarea>`.
- **`packages/studio/vite.config.ts`**: no change was needed — the four `@codemirror/*` packages
  are plain ESM with no special loader requirements, and `vite build`/`vite dev` both worked
  against the existing config unmodified. Recorded here (rather than left silently unused) since
  the file was in #315's declared write-set.
- **WCAG AA contrast + non-color-only fold affordance** (#315 DoD): CM6's default `foldGutter()`
  marker is a chevron/triangle glyph (open vs. closed shape), not a color-only affordance, and this
  slice uses that default marker unmodified — so fold state is conveyed by shape out of the box.
  `web/styles.css`'s `.cm-editor`/gutter colors reuse the studio's existing theme tokens (the same
  ones the pre-#315 textarea and every other pane already meet WCAG AA contrast with); no new color
  pairs were introduced by this slice.
- **README/docs note**: `packages/studio/README.md` gained a "Rich editor surface — CodeMirror 6
  (#315)" section describing the new editor surface (line numbers, folding, a11y, bundle cost) in
  the same PR (no drift).
- The #279 `REPL_FOCUS_ORDER`/`REPL_LANDMARK_ROLES` contracts are unchanged (the editor remains one
  `textbox` focus stop / landmark) — CM6's `contentAttributes` facet reuses the existing
  `"OpenLogo source editor"` label so the contract's label text does not drift from what a screen
  reader actually announces; `src/a11y.test.mjs` cross-checks this directly against
  `editor-cm6.ts`'s exported constants so the two can never silently diverge.
- #285 (real highlighting) and the later inline-error-markers slice will plug into
  `@codemirror/language`'s `syntaxHighlighting()`/decoration API instead of a throwaway textarea
  overlay, avoiding a second editor-surface rewrite. This slice deliberately leaves that seam
  documented but unused — `editor-cm6.ts` stays highlighter-free, exactly as `editor.ts` was before.
- The estimated ~50-80 KB gzipped bundle cost was checked against a real `vite build` in the
  implementation PR and found to be an underestimate — the actual CM6-attributable delta is
  **~95 KB gzip** (46.11 KB → 141.01 KB gzip total `web-dist/` JS). See the "2. KISS" section above
  for the full before/after table and the explanation for the gap (the `language` package's
  `@lezer/*` transitive dependencies, not present in the simpler public estimate).
- Monaco was not evaluated in depth because it was not one of the two options the maintainer asked
  us to compare; for the record, its canvas-based rendering model makes it a strictly worse
  accessibility starting point than CodeMirror 6's `contenteditable` model, so it would not have
  changed this recommendation.

## Alternatives considered

- **Lightweight custom editor surface** — rejected. Disqualified by criterion 1 (accessibility):
  folding cannot be implemented on a native `<textarea>` without either faking visual state that
  diverges from what a screen reader reads, or hand-building a `contenteditable` document model
  that reimplements — with a much smaller testing/triage base than CodeMirror 6 — the exact DOM
  sync, cursor mapping, and ARIA-liveness problems CM6 has already solved. See the full analysis
  under "1. Accessibility" above.
- **Monaco editor** — not one of the two options in scope for this decision (per the issue and the
  orchestrator's framing), and not further evaluated beyond the note in Consequences: its
  canvas-rendered model is accessibility-hostile compared to CodeMirror 6's `contenteditable`
  model, so it would not be preferred even if in scope.
- **`codemirror`/`basicSetup` convenience bundle instead of modular `@codemirror/*` imports** —
  rejected in favor of the modular imports under "2. KISS": `basicSetup` pulls in autocomplete,
  search, and multiple keymaps #315 does not need, working directly against the bundle-size
  criterion for no benefit this slice requires.
