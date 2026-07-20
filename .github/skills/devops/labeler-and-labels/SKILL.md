---
name: labeler-and-labels
description: >-
  How @devops wires automatic issue/PR labeling for OpenLogo — path-based PR labels via
  .github/labeler.yml and the labeler workflow, plus syncing the repo's labels from the
  .github/labels.yml taxonomy. Use when changed paths should imply labels or labels drift from the manifest.
created: 2026-07-17T00:00
updated: 2026-07-17T00:00
---

## Purpose

Two automations, one taxonomy. `@product-owner` owns the label **content** in
[`.github/labels.yml`](../../../labels.yml); you own the **automation** that (a) keeps repo labels in
sync with that manifest and (b) auto-applies path-derived labels to PRs.

## Label sync (manifest → repo)

- The `.github/workflows/label-sync.yml` workflow reconciles repo labels with `.github/labels.yml` on
  every push to `main` that touches the manifest (and on manual dispatch).
- It is **idempotent**: create missing labels, update color/description on existing ones. Prefer an
  official/first-party label-sync action, pinned by version, or the `gh label create/edit` loop.
- Never hand-edit labels in the UI — change the manifest and let sync apply it.

## PR labeling (paths → labels)

- `.github/labeler.yml` maps changed paths to labels using `actions/labeler`. **Policy:** apply
  `area:*` for every surface (owner-neutral), but `agent:*` **only for single-owner surfaces**.
  Co-owned surfaces (`packages/parser` = language-designer + interpreter; `packages/edu` =
  geometry-teacher + ai-tutor + curriculum) get their `area:*` label only — a human assigns the
  specific owner in triage. Keep the map aligned with the package → owner table in
  [`architecture.md`](../../../../docs/architecture.md):

  | Path glob | Labels |
  |---|---|
  | `packages/core/**` | `agent:interpreter`, `area:core` |
  | `packages/runtime/**` | `agent:interpreter`, `area:runtime` |
  | `packages/parser/**` | `area:grammar` (co-owned → owner set in triage) |
  | `packages/turtle/**` | `agent:turtle-engine`, `area:rendering` |
  | `packages/studio/**` | `agent:learner-experience`, `area:studio` |
  | `packages/edu/**` | `area:edu` (co-owned → owner set in triage) |
  | `tests/conformance/**` | `agent:testing` |
  | `.github/workflows/**`, `.github/labeler.yml`, `.github/scripts/**` | `agent:devops`, `area:ci` |
  | `spec/**`, `.github/ISSUE_TEMPLATE/**`, `.github/labels.yml` | `agent:product-owner` |
  | `docs/**` | `agent:documentation`, `area:docs` |

- Labeler is a **hint**, not the final word: it seeds `agent:*`/`area:*` from paths; `@product-owner`
  triage still confirms exactly one `agent:*` + one `type:*` and sets the milestone.

## Rules

- One source of truth: `.github/labels.yml`. The labeler must only emit labels that exist there.
- Keep the path map in step with the package rename/rehome — update it in the same PR.
- Pin actions by version; least-privilege `permissions:` (`labeler` needs `pull-requests: write`).

## Checklist
- [ ] `label-sync.yml` reconciles from `labels.yml` (idempotent), triggered on manifest change.
- [ ] `labeler.yml` covers every package + spec/docs/workflows path; emits only manifest labels.
- [ ] No label is created outside the manifest; no hand-editing in the UI.
