---
name: write-a-user-story
description: >-
  How @product-owner turns a spec area into an epic → user stories → Given/When/Then acceptance
  criteria grounded in spec vocabulary. Use when breaking down a feature for the team or clarifying
  ambiguity. Non-owners propose spec changes via change-request; the PO stewards, not rewrites.
created: 2026-07-17T00:00
updated: 2026-07-17T00:00
---

## Purpose

Give the factory unambiguous, testable work items that map straight to conformance fixtures — so
"done" is objective and every story traces back to the spec.

## Procedure

1. **Anchor to the spec.** Cite the exact `spec/` sections (e.g. `commands.md` C3 signature,
   `execution-model.md` behavior). If the spec is ambiguous, raise a change-request to the maintainer;
   don't invent behavior.
2. **Write the epic** (the profile/feature) and slice it into **vertical-slice stories** (one behavior
   each, end to end).
3. **Acceptance criteria as Given/When/Then**, using exact OpenLogo vocabulary (`shared/spec-fidelity`):

   ```text
   Story: forward moves the turtle
   Given a turtle at x=0 y=0 heading=0
   When  forward 100 is executed
   Then  the turtle is at x=0 y=100 and a line segment (0,0)->(0,100) is drawn
   ```

4. **Make each AC fixture-ready** — phrase it so `@testing` can turn it into a source→events/diagnostics
   fixture (`shared/conformance-fixture`) with no reinterpretation.
5. **Tag** the story with its profile + owning agent for the parallel tracks.

## Critical rules

- Use canonical lowercase keywords and correct profile placement; never classic-Logo defaults
  (`forward`/`define…end` are Core; `fd`/`to`/`make` are Heritage).
- One observable behavior per story; no "and also" stories.
- Stories are the interface to conformance — if it can't become a fixture, it isn't done being written.

## Checklist
- [ ] Cites exact spec sections; ambiguity raised as a change-request, not guessed.
- [ ] Given/When/Then in spec vocabulary; one behavior per story.
- [ ] Fixture-ready ACs; profile + agent labels attached.
