---
name: triage-and-label
description: >-
  How @product-owner (the "labeler") maintains and applies the OpenLogo issue label taxonomy —
  agent/type/profile/area/level — and keeps it in sync with .github/labels.yml. Use when triaging a new
  issue, creating labels, or relabeling. Pairs with github-project and epics-and-milestones.
created: 2026-07-17T00:00
updated: 2026-07-17T00:00
---

## Purpose

Every issue must be findable and routable: which agent owns it, what kind of work it is, which profile
and (for curriculum) which level. You are the labeler — you keep the taxonomy consistent so parallel
tracks can pull their own work.

## The taxonomy (source of truth: [`.github/labels.yml`](../../../labels.yml))

- **`agent:*`** — one owner: `orchestrator`, `product-owner`, `language-designer`, `interpreter`,
  `turtle-engine`, `learner-experience`, `geometry-teacher`, `ai-tutor`, `curriculum`, `testing`,
  `documentation`, `devops`.
- **`type:*`** — `feature-request`, `epic`, `slice`, `bug`, `conformance`, `foundation`, `docs`, `chore`.
- **`profile:*`** — `core`, `turtle-rendering`, `data`, `geometry`, `heritage`, `sprites`,
  `interaction`, `sound`, `modules`, `localization`, `educational`, `tutor-ai`.
- **`area:*`** — `grammar`, `highlighter`, `checker`, `runtime`, `rendering`, `studio`, `edu`, `ci`,
  `docs` (the cross-cutting domain, orthogonal to the owning agent).
- **`level:*`** — `1`–`8` for curriculum items (progression, not a profile).

## Rules

- **Exactly one `agent:*` and one `type:*`** per issue; add `profile:*`/`area:*`/`level:*` as they apply.
- **Milestone ≠ label:** the profile-DAG milestone is set via the milestone field, not a `profile:*`
  label (the label says which profile the work touches; the milestone says where it lands).
- Issue **forms apply only their static `labels:` defaults** (`type:*`, sometimes `area:*`).
  **Dropdown/checkbox answers inside a form do _not_ become labels** — e.g. a "Profile" dropdown
  selection never creates `profile:*`. Triage reads those answers and adds `agent:*` + `profile:*`
  + `level:*` and the milestone by hand. Treat every new issue as needing a manual triage pass.
- Labels are data — keep `.github/labels.yml` the source of truth; don't hand-create ad-hoc labels.

## Procedure

1. **Sync labels** from the manifest. In CI this is automated by `@devops`'s `label-sync` workflow on
   any change to `.github/labels.yml`; you just edit the manifest. To apply locally (idempotent):

   ```bash
   # requires yq; iterate name/color/description from .github/labels.yml
   yq -r '.[] | [.name,.color,.description] | @tsv' .github/labels.yml | while IFS=$'\t' read -r n c d; do
     gh label create "$n" --color "$c" --description "$d" 2>/dev/null \
       || gh label edit "$n" --color "$c" --description "$d"
   done
   ```

2. **Triage a new issue:** confirm/added the default `type:*`; add the owning `agent:*`, any
   `profile:*`/`area:*`/`level:*`, and the milestone:

   ```bash
   gh issue edit <n> --add-label "agent:interpreter,profile:core,area:runtime" \
     --milestone "M1 Core Language"
   ```

3. **Audit** periodically: list issues missing an `agent:*` or `type:*` and fix them.

   ```bash
   gh issue list --search 'no:label' --json number,title
   ```

## Checklist
- [ ] `.github/labels.yml` is the single source; labels synced from it.
- [ ] Every issue has exactly one `agent:*` + one `type:*`; extras added as applicable.
- [ ] Milestone set via the milestone field, not a profile label.
- [ ] No ad-hoc labels outside the manifest.
