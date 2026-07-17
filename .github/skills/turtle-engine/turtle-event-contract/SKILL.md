---
name: turtle-event-contract
description: >-
  How @turtle-engine defines and evolves the deterministic turtle/sprite event contract in
  @openlogo/robot — consuming the runtime trace stream and producing render-agnostic state so studio,
  Canvas/SVG/PNG export, and a11y all agree. Use for turtle state, pen, heading, shapes, rendering.
created: 2026-07-17T00:00
updated: 2026-07-17T00:00
---

## Purpose

The turtle is a **deterministic state machine first, pixels second.** A clean event/state contract is
what lets rendering, export, studio, and accessibility all stay in sync and testable headlessly.

## Procedure

1. **Read** `spec/rendering.md` (coordinate system, pen, color, export, a11y) and the trace events in
   `spec/execution-model.md`. The runtime is the source of effects; you turn them into turtle state.
2. **Model state** `{ x, y, heading, penDown, color, shape, visible }` and reduce the runtime event
   stream into ordered, deterministic turtle frames — no randomness, no wall-clock.
3. **Separate state from animation.** Frames are semantic; animation/timing is a render concern layered
   on top, so `repeat 10000 [ forward 1 ]` is validated as state, not frames.
4. **Render from frames**, not from source: Canvas for live view, SVG/PNG for deterministic export.
   Same frames → same output (golden-image / snapshot fixtures).
5. **Accessibility:** produce the non-visual description of the drawing and honor reduced-motion, so
   `@learner-experience` can surface it.
6. **Publish the contract** (event/frame types) as the interface `@openlogo/studio` consumes; changes
   are serialized, owner-reviewed PRs.

## Critical rules

- Deterministic + headless: identical input events produce identical frames and exports.
- Never reach into runtime internals — consume the published trace/event stream only.
- Geometry shapes are OpenLogo `.logo` source (Geometry profile); only `grid`/`axes`/`measure` are
  renderer-backed — don't add hidden drawing shortcuts.

## Checklist
- [ ] State reduced deterministically from the runtime event stream.
- [ ] State vs animation separated; export is reproducible (snapshot fixtures).
- [ ] Non-visual description + reduced-motion provided.
- [ ] Event/frame contract published; changes serialized.
