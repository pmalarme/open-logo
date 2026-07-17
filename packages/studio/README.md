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
- **Depends on:** `@openlogo/parser`, `@openlogo/runtime`, `@openlogo/robot`, `@openlogo/edu`,
  `@openlogo/core`.
