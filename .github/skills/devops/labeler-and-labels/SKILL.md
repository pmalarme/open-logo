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
- It is **additive by decision, not by omission** (issue #972): it never deletes a label missing from
  the manifest, because deleting one deletes it off every live issue and GitHub does not restore
  those applications when it is re-created — so a typo in a manifest PR would silently strip triage
  data at merge. Do **not** "fix" this by making the sync destructive.

## Label drift (repo → manifest) — the direction sync cannot check

- An additive sync can never notice a label created ad hoc through the API, so the manifest quietly
  became a *subset* of reality. Measured at `0277d5ff`: **10** `area:*` declared, **14** in use,
  **15** existing on the repository; across all namespaces **9 labels in use spanned 3 namespaces**
  without being manifested, on **37** open issues/PRs. Only the `10` is re-derivable
  (`git show 0277d5ff:.github/labels.yml`) — the rest counted live repository state at that moment
  and will not reproduce today. `validate-labels.py --live` prints each direction's **current**
  count on every run; that is the number to trust.
- `.github/scripts/validate-labels.py` closes it by comparing manifest and repository **in both
  directions**, the same shape `built-in-names` uses for primitives:
  - **fails** when a label on an open issue/PR is not in the manifest; when a manifested label does
    not exist on the repo (downgraded to a report under `--proposed`, which the pull-request run
    uses because the sync only runs after merge); and when a label **containing a colon** is in
    neither `labels.yml` nor `.github/labels-retired.yml` — "contains a colon", not "starts with a
    namespace the manifest defines", because the narrower test let a label in an entirely new
    namespace (`infra:runner`) pass as a stock label;
  - **reports** GitHub's **unnamespaced** stock labels (`bug`/`wontfix`/…), which exist on every
    repository, and manifested labels nobody uses yet (`level:1`, `profile:localization`);
  - **fails offline** when `area:*`/`profile:*` and `validate-commits.py`'s `AREAS`/`PROFILES` stop
    mirroring each other — a label with no matching commit scope makes every PR title from those
    issues fail the blocking check.
- **Retiring a label is a declaration, not a deletion.** `.github/labels-retired.yml` records each
  namespaced label kept on the repository but never to be applied again, with a reason and its
  replacement. Nothing is deleted: a deletion strips the label from every issue that ever carried it,
  closed ones included, and GitHub does not restore those applications.
- Live directions run in `label-drift.yml` (schedule + dispatch + manifest PRs + after a successful
  `Label sync`, via `workflow_run` rather than `push`, which would race the sync); the offline
  mirrors run in `ci.yml`'s `meta` job on every PR. `test-validate-labels.py` mutation-tests both.
  All four triggers are **pinned** there (`REQUIRED_DRIFT_TRIGGERS`) as complete mappings — cron,
  `workflow_run` target, and `pull_request`'s `paths` included. Review deleted `schedule`,
  `workflow_dispatch` and `workflow_run` and everything stayed green; QA then added
  `branches: ["release-please--*"]` to `pull_request`, which also passed. That second one is the
  severe case: on a non-default branch the other three are dormant, so **`pull_request` is the only
  live coverage there is**, and a branch filter switches it off with every other pin unchanged.
- **Which direction runs where — and the gap, stated rather than implied.** This matters more than
  it looks: the direction that detects #972's actual defect is **not** in the per-PR gate.

  | direction | needs | runs in | on a `saga/*` branch |
  |---|---|---|---|
  | `area:*`/`profile:*` ↔ commit scopes | nothing | `ci.yml` meta job, every PR | ✅ active |
  | retired-list well-formedness | nothing | `ci.yml` meta job, every PR | ✅ active |
  | **label in use but unmanifested** | `gh` + token | `label-drift.yml` | ⚠️ **manifest PRs only** |
  | manifested but missing on repo | `gh` + token | `label-drift.yml` | ⚠️ **manifest PRs only** |
  | namespaced but undeclared | `gh` + token | `label-drift.yml` | ⚠️ **manifest PRs only** |

  GitHub registers `schedule` and `workflow_run` **only from the default branch**, so until the
  saga promotes to `main` the daily sweep and the post-sync run do not exist; only
  `pull_request` (taken from the PR head) fires, and only on manifest changes. **A green
  `validate-labels.py` in CI therefore does not mean "no label drift"** — it means the mirrors
  agree. The script prints that caveat on every offline run rather than leaving it to this table.
- **What re-checks it after promotion:** the daily `schedule` and the `workflow_run` after `Label
  sync` both activate the moment this lands on `main`, and the first run **reports** whatever
  drifted in the interim — it exits 1 and names the offenders; it never mutates labels, so someone
  still has to grow the manifest or relabel. Wiring `--live` into the per-PR job instead was
  considered and **not** taken: it
  needs a token, and it makes an unrelated PR go red because somebody else mislabelled an issue.
- **Adding an `area:*` or `profile:*` label is a two-file change** — the manifest and
  `validate-commits.py`'s `AREAS`/`PROFILES` — and the gate is the half that fails until both land.
- **Known residual, measured:** the per-PR (offline) half only checks the namespace mirrors, so
  *removing* a manifested label that no scope, issue form or labeler rule references — `type:task`,
  say — passes `validate-meta.py`, offline `validate-labels.py` and the self-test. It does **not**
  escape the PR, though: `label-drift.yml` triggers on `.github/labels.yml`, and the
  `--live --proposed` run CI performs there exits 1 on it. The genuine residual is therefore
  narrower than "caught only by the daily job": it is drift introduced **outside** a manifest PR,
  which the schedule catches within a day. Closing even that would mean querying the live repository
  on every unrelated PR — the mutable-state dependency `label-drift.yml` exists to keep out of the
  blocking gate.

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
  | `packages/parser/**` | `area:parser` (co-owned → owner set in triage; narrow to `area:grammar`/`highlighter`/`checker` in triage) |
  | `packages/turtle/**` | `agent:turtle-engine`, `area:rendering` |
  | `packages/studio/**` | `agent:learner-experience`, `area:studio` |
  | `packages/edu/**` | `area:edu` (co-owned → owner set in triage) |
  | `tests/**` | `area:testing`; `tests/conformance/**` also `agent:testing` |
  | `scripts/**`, `.github/scripts/**` | `area:tooling` (+ `agent:devops`) |
  | `.github/workflows/**`, `.github/labeler.yml`, `.github/scripts/**`, build manifests | `agent:devops`, `area:ci` |
  | `spec/**`, `.github/ISSUE_TEMPLATE/**`, `.github/labels.yml` | `agent:product-owner` |
  | `docs/**` | `agent:documentation`, `area:docs` |

  `area:diagnostics` has **no path rule on purpose**: the `ol-*` diagnostic surface spans parser,
  runtime and core, so no changed path implies it. It is applied in triage.

- Labeler is a **hint**, not the final word: it seeds `agent:*`/`area:*` from paths; `@product-owner`
  triage still confirms exactly one `agent:*` + one `type:*` and links the native sub-issue parent.

## Rules

- One source of truth: `.github/labels.yml`. The labeler must only emit labels that exist there.
- Keep the path map in step with the package rename/rehome — update it in the same PR.
- Pin actions by version; least-privilege `permissions:` (`labeler` needs `pull-requests: write`).

## Checklist
- [ ] `label-sync.yml` reconciles from `labels.yml` (idempotent), triggered on manifest change.
- [ ] `label-drift.yml` compares the manifest against the repo **in both directions** and fails on a
      label in use that the manifest does not declare, or a namespaced label that is neither
      manifested nor declared in `.github/labels-retired.yml`.
- [ ] Every new `area:*`/`profile:*` label also lands in `validate-commits.py`'s `AREAS`/`PROFILES`
      (the offline mirror gate in `ci.yml`'s `meta` job fails until it does).
- [ ] `labeler.yml` covers every package + spec/docs/workflows path; emits only manifest labels.
- [ ] No label is created outside the manifest; no hand-editing in the UI.
