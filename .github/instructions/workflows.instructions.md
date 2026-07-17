---
applyTo: ".github/workflows/**"
---

# CI/CD workflows — working rules (DevSecOps)

Scoped rules for GitHub Actions under `.github/workflows/`. Read the always-on
[team agreement](openlogo-team.instructions.md) and [`docs/delivery.md`](../../docs/delivery.md) first.

**Owner:** [`@devops`](../agents/devops.agent.md) ·
**Skills:** [ci-pipeline](../skills/devops/ci-pipeline/SKILL.md),
[labeler-and-labels](../skills/devops/labeler-and-labels/SKILL.md),
[security-and-release](../skills/devops/security-and-release/SKILL.md)

## Responsibility
The pipelines that turn the [Definition of Done](openlogo-team.instructions.md) into enforced gates,
keep the supply chain safe, drive the labeler + label sync, and cut releases. `@testing` authors the
suites these workflows run; you wire and secure them.

## Files here
- `ci.yml` — DoD gates: an always-on **meta** job (labels/issue-forms/workflows validation via
  `.github/scripts/validate-meta.py`) plus **build/lint/test** jobs guarded by
  `if: ${{ hashFiles('package.json') != '' }}` until the toolchain lands.
- `labeler.yml` — path→label PR labeling from [`.github/labeler.yml`](../labeler.yml).
- `label-sync.yml` — reconciles repo labels from [`.github/labels.yml`](../labels.yml) via
  `.github/scripts/sync-labels.py` when the manifest changes.

## Conventions
- **Least privilege:** set explicit `permissions:` per workflow; default to `contents: read` and add
  only what a job needs (`pull-requests: write` for labeler, `issues: write` for label sync).
- **Pin actions by version** (`@v5`, `@v4`); prefer first-party/official actions.
- **Deterministic + fast:** cache deps, no wall-clock/frame dependence; conformance runs by profile
  along the DAG (a profile job needs its dependencies green).
- **Never bypass review:** CI gates merges; no auto-merge, no self-approval. Never commit secrets;
  never auto-assign a cloud agent without maintainer approval.
- Keep the labeler map + labels manifest in step with package renames — update them in the same PR.
