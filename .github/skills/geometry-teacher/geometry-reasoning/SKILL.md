---
name: geometry-reasoning
description: >-
  How @geometry-teacher produces deterministic geometric reasoning and misconception signals as
  structured data in @openlogo/edu — exterior angles, polygon closure, headings — grounded in
  spec/geometry-module.md. Use for geometry explanations and math feedback. Output data, not prose.
created: 2026-07-17T00:00
updated: 2026-07-17T00:00
---

## Purpose

Geometry is OpenLogo's first-class idea (the "Papert" value). Turn turtle geometry into **deterministic,
inspectable reasoning** other agents render — so a pentagon isn't just drawn, it's understood.

## Procedure

1. **Read** `spec/geometry-module.md` and `spec/educational-model.md` (L6 geometry/math). Geometry
   content is discoverable OpenLogo `.logo` source — never hidden engine shortcuts.
2. **Compute reasoning deterministically:** e.g. exterior angle = 360 ÷ n; interior = 180 − exterior;
   closure requires total turning = 360. No AI, no randomness — pure functions with fixed output.
3. **Emit structured signals**, not sentences:

   ```json
   { "concept": "exterior-angle", "sides": 5, "value": 72,
     "relation": "360 / sides", "misconception": "used-interior-angle" }
   ```

4. **Detect misconceptions** from the program/turtle state (e.g. turned by interior not exterior, path
   didn't close) and label them with stable concept ids.
5. **Hand off** the signals to `@ai-tutor` (conversational delivery) and `@curriculum` (exercises);
   feed geometry stdlib procedures to `@interpreter`/`@turtle-engine` as `.logo`.

## Critical rules

- Deterministic and offline — same input, same reasoning, always.
- Produce data (concept + values + relation + misconception ids); let the tutor phrase it.
- Angles in degrees; reuse the runtime's geometry, don't reinvent turtle math.

## Checklist
- [ ] Reasoning grounded in `geometry-module.md`; degrees; deterministic.
- [ ] Output is structured signals, not prose.
- [ ] Misconceptions labeled with stable ids; geometry stays `.logo` source.
