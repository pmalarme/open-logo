---
applyTo: "packages/turtle/**"
---

# `@openlogo/turtle` — working rules

Scoped rules for files under `packages/turtle/`. Read the always-on
[team agreement](openlogo-team.instructions.md) and the
[architecture](../../docs/architecture.md) first.

**Owner:** [`@turtle-engine`](../agents/turtle-engine.agent.md) ·
**Skills:** [turtle-event-contract](../skills/turtle-engine/turtle-event-contract/SKILL.md),
[conformance-fixture](../skills/shared/conformance-fixture/SKILL.md)

## Responsibility
The turtle/sprite engine and renderer. Owns turtle/sprite **state** (`x`, `y`, `heading`, `penDown`,
`color`, `width`, `shape`, `visible`), the **background** and retained **drawing scene** (scene/
background are separate from per-turtle state), **pen/heading/shape**, and the **Canvas / SVG / PNG**
targets with animation, export, and rendering accessibility.

## Spec (normative)
- [`spec/rendering.md`](../../spec/rendering.md) — rendering targets, drawing model, coordinate mapping,
  Canvas controls, deterministic export, and rendering a11y.
- [`spec/turtles-and-sprites.md`](../../spec/turtles-and-sprites.md) — turtle/sprite model.
- [`spec/execution-model.md`](../../spec/execution-model.md) — the trace events it consumes.

## Source layout
- `packages/turtle/src/index.ts` — the only public entry (reduce events → frames; Canvas/SVG/PNG).
- Suggested modules: `state.ts`, `scene.ts`, `canvas.ts`, `svg.ts`, `png.ts`, `a11y.ts`.

## Boundaries
- Consumes the **runtime trace/event stream** + `core` event types; never reads `runtime` internals.
- **State is deterministic and headless first**; animation/timing is layered on top so
  `repeat 10000 [ forward 1 ]` is validated as state, not frames.
- Geometry shapes are `.logo` source (owned by `@openlogo/edu`); only `grid`/`axes`/`measure` are
  renderer-backed — no hidden drawing shortcuts.

## Conventions
- Identical event input → identical frames and byte/image-stable exports (snapshot fixtures).
- Provide the normative textual state description and honor reduced-motion.
