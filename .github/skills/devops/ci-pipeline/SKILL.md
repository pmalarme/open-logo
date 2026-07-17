---
name: ci-pipeline
description: >-
  How @devops builds and extends the OpenLogo CI/CD pipelines in .github/workflows so they encode the
  team Definition of Done — build, type-check, lint, format, unit, conformance, integration, runnable
  examples — with code jobs guarded until the toolchain lands. Use when adding or changing CI gates.
created: 2026-07-17T00:00
updated: 2026-07-17T00:00
---

## Purpose

CI is the executable form of the [Definition of Done](../../../instructions/openlogo-team.instructions.md).
Every merge to `main` must pass the same gates. This skill is how you wire and evolve them.

## The gates (one job per DoD item)

| Gate | Runs | When |
|---|---|---|
| meta | markdown links, YAML lint (issue forms, labels, workflows), spec-example presence | always |
| build + type-check | `tsc -b` across project references (TS7, strict) | when `package.json` exists |
| lint + format | ESLint / formatter + OpenLogo style-lint | when `package.json` exists |
| unit | package unit tests | when `package.json` exists |
| **conformance** | stack-neutral `tests/conformance/` fixtures, **by profile along the DAG** | when fixtures exist |
| integration + examples | vertical-slice integration + every `spec/examples/*.logo` still runs | when `package.json` exists |

## Rules

- **Guard code jobs** so the pipeline is green before any toolchain exists and activates
  automatically once it lands: `if: ${{ hashFiles('package.json') != '' }}`.
- **Conformance is profile-aware:** a profile's job passes only when its fixtures **and its DAG
  dependencies'** fixtures pass (`spec/conformance.md`). Turtle & Rendering ⇒ needs Core green.
- **Fast + deterministic:** headless turtle, no wall-clock/frame dependence, cache dependencies, pin
  action versions. `repeat 10000 [ forward 1 ]` tests semantics, not frames.
- **Testing authors the suites; you wire them.** Don't write test content here — run what `@testing`
  produces.
- You wire the gate; **humans + required checks merge.** Never add an auto-merge that bypasses review.

## Procedure

1. Add/adjust the job in `.github/workflows/ci.yml`; keep one concern per job with clear names.
2. Trigger on `pull_request` and `push` to `main`; set `permissions:` to least privilege.
3. Make the new gate a **required check** (repo settings / branch protection) once it is stable.
4. Keep the meta job always-on so docs/label/workflow drift is caught even pre-toolchain.

## Checklist
- [ ] Each DoD item maps to a CI gate; names are clear.
- [ ] Code jobs guarded on `hashFiles('package.json')`; meta job always runs.
- [ ] Conformance runs by profile along the DAG.
- [ ] Actions pinned; permissions least-privilege; no bypass of review.
