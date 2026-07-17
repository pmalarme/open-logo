# `@openlogo/robot`

The turtle/sprite engine and renderer: turtle state, pen/heading/shape, the retained drawing scene,
and the Canvas / SVG / PNG targets with animation, deterministic export, and rendering accessibility.

- **Source root:** `src/` — public entry `src/index.ts` (suggested: `state.ts`, `scene.ts`,
  `canvas.ts`, `svg.ts`, `png.ts`, `a11y.ts`).
- **Owner:** [`@turtle-engine`](../../.github/agents/turtle-engine.agent.md).
- **Working rules:** [`robot.instructions.md`](../../.github/instructions/robot.instructions.md).
- **Spec:** [`rendering.md`](../../spec/rendering.md),
  [`turtles-and-sprites.md`](../../spec/turtles-and-sprites.md),
  [`execution-model.md`](../../spec/execution-model.md).
- **Depends on:** `@openlogo/core`, `@openlogo/runtime` (consumes the trace/event stream).
