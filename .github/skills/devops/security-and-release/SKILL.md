---
name: security-and-release
description: >-
  How @devops keeps the OpenLogo supply chain safe (CodeQL, dependency review, secret scanning) and
  automates releases of the lockstep @openlogo/* tuple per delivery.md — tagging only conformance-green,
  single-spec-version, declared-profile sets. Use for security scanning or cutting a release.
created: 2026-07-17T00:00
updated: 2026-09-03T00:00
---

## Purpose

Two responsibilities that both protect `main`: **shift-left security** on every PR, and **releasing
only validated tuples**. Grounded in [`docs/delivery.md`](../../../../docs/delivery.md) and
[`docs/adr/0003-versioning-and-release.md`](../../../../docs/adr/0003-versioning-and-release.md).

## Security scanning

Two workflows already exist; keep them least-privilege and low-noise:

- **CodeQL** ([`.github/workflows/codeql.yml`](../../../workflows/codeql.yml)) — JS/TS analysis on
  PRs, pushes to `main`, and a weekly schedule; fail on new high-severity alerts. Guarded by a
  `detect` job so it stays dormant until `package.json` lands (nothing to scan before then).
- **Dependency review** ([`.github/workflows/dependency-review.yml`](../../../workflows/dependency-review.yml))
  — runs on every PR; blocks known-vulnerable/deny-listed dependencies (`fail-on-severity: high`).
  It needs the Dependency Graph, which on a **private** repo requires **GitHub Advanced Security**;
  until GHAS is enabled it is **advisory** (`continue-on-error` while private) and becomes a hard
  gate automatically when the repo is public. Enable GHAS + Dependency Graph in *Settings > Code
  security* to enforce it while private.
- **Dependabot** ([`.github/dependabot.yml`](../../../dependabot.yml)) — the remediation half:
  opens grouped update PRs. `github-actions` runs now (keeps pinned actions patched); `npm`
  activates when the workspace manifest lands. dependency-review guards the door, Dependabot patches
  what is already inside — run both.
- **Secret scanning + push protection** enabled; **no secrets or tokens** in code, fixtures, or
  workflows (matches the team no-secrets rule). Use `GITHUB_TOKEN` with least-privilege `permissions:`.
- Keep signal high: triage/suppress false positives explicitly; don't let the dashboard rot.

## Release automation (lockstep tuple)

A release is a **validated tuple**, not one package version:

1. All target `@openlogo/*` packages advertise the **same** `openlogo.version` + declared profiles
   (feature-detection metadata is the compat contract, not npm semver).
2. **Conformance is green** for every claimed profile **and its DAG dependencies**.
3. The **highlighter/tooling** shipped in the same saga as any grammar change it tracks.
4. Then tag once (all packages lockstep); the first release is **M2** (Turtle & Rendering =
   minimal conformance), `0.1.0`.

### Determining the version — derive it, never ask for it

The version is **not an input**; it is a **consequence** of which saga is delivered on `origin/main`.
"Release a new version" is a complete instruction — compute the number, state it with the evidence
below, and hand it to the maintainer. The five-step procedure below says where to stop: deriving the
number and judging it releasable are separate acts, and a report always precedes a question. Never
ask merely because no number was typed.

**Derive from the delivered profile set, not from the latest tag.** A Saga Gate *authorizes* a tag;
it does not produce one, so completed sagas can sit untagged and the highest tag can lag the ladder
by several rows. Anchoring on the tag silently under-numbers the release. Worked example, true as of
commit `2a1888c1` (2026-09-03) and kept here as a **dated illustration**, not a live fact: `v0.2.0`
was the highest tag while `origin/main` already declared the full M5 profile set, so "latest tag plus
one row" yielded `0.3.0` for a tuple the ladder numbers `0.4.0`. Re-derive from the repo; never reuse
this number.

**Read every input from `origin/main`, after fetching.** A worktree's local `main` is routinely stale
— when this procedure was written it sat 3 commits behind, declaring 5 profiles instead of 9, which
maps cleanly onto M4 and would hand the reader `0.3.0` while every other cross-check below still
passed. That is why step 1 reads `origin/main` directly and step 3 carries an explicit staleness
check: a stale ref is a failure mode that otherwise produces a confident wrong number in silence.

1. Read the **delivered profile set** from `origin/main`: `git fetch origin`, then
   `git show origin/main:packages/core/src/host-metadata.ts` and take `SUPPORTED_PROFILES` — the
   feature-detection metadata that
   [ADR-0003](../../../../docs/adr/0003-versioning-and-release.md) makes the compatibility contract.
   **By policy** a profile may appear there only once its conformance is green; that linkage is a
   convention, not a gate (no check derives required fixture coverage from this list), so treat it as
   the repository's *declared* shipped set and verify the claim independently in step 4.
2. Map it onto the saga ladder in [`docs/delivery.md`](../../../../docs/delivery.md) §3 ("The saga
   ladder"): take the **highest saga whose profiles are all present**, and its row gives the version
   (M1 `0.1.0-core` pre-release → M2 `0.1.0` → M3 `0.2.0` → M4 `0.3.0` → M5 `0.4.0` → M6 `0.5.0`).
   The number is driven by the **saga's profile set**, not by Conventional Commit types — a `feat:`
   inside an already-released saga does not move it.
3. Cross-check the **released baseline**: the highest tag reachable from `origin/main`
   (`git tag --list --merged origin/main --sort=-version:refname` — version-sorted, since the
   default order is lexical) plus the root and per-package `package.json` versions, which must
   already agree with each other. The tag is a floor — the new version must exceed it — and a
   disagreement among manifests is a defect to report, not a number to guess. If
   `git rev-list --count main..origin/main` is non-zero your local `main` is behind; re-read step 1
   from `origin/main` rather than trusting the checkout.
4. **Verify the saga actually completed**: its Saga Gate is recorded, conformance is green for its
   profiles and their DAG dependencies, and its `saga/*` RC was promoted to `main` by the
   maintainer. Then **present the number for the maintainer to authorize** — deriving a version is
   not permission to tag (see Rules).
5. Separate **deriving** the number from judging it **releasable**. Step 4 is the default path;
   beyond it, four cases need special handling, and each **reports before it stops**:
   - **Number settled, sequencing unsettled** — the tag lags the ladder by more than one row. Report
     the mapped row's version, then ask whether to skip the intermediate versions or backfill their
     tags; the normative sources do not settle it, so it is a maintainer call.
   - **No new ladder version** — the derived version does not exceed the tag floor. If it is
     **equal** and the tag points at the current `origin/main` tree, the delivered profile set is
     already released: report that and name the next ladder row as the target. If it is equal but
     `origin/main` has advanced since the tag, those are **Maintenance-saga** changes
     ([`docs/delivery.md`](../../../../docs/delivery.md) §4) — they merge straight to `main`, carry
     no ladder row, and the repo defines no version for them, so report the situation and ask rather
     than inventing a number. If it is **lower**, the profile metadata regressed or the repo was
     rolled back — report it as a defect, and do not tag.
   - **Number settled, not releasable** — conformance is red, the manifests disagree, or the Saga
     Gate/RC promotion is missing. Report the candidate version *and* why it cannot be tagged.
   - **Cannot be derived at all** — the profile set matches no ladder row or spans one partially, or
     the ladder is exhausted (past M6). Report what you found rather than picking a plausible number.

   A maintainer who signalled a different target overrides all four.

**Never publish to npmjs.** Every `@openlogo/*` package is `"private": true` and stays off the
public registry — a release is a git tag plus GitHub release artifacts (see
[ADR-0018](../../../../docs/adr/0018-packages-are-private-not-published.md)). Release automation must never run
`npm publish`.

## Rules

- **Do not release** if any target package is on a different spec version or a claimed profile's
  conformance is red. KISS: one version line for all packages until there's a real reason to split.
- **Derive the version, don't request it** (see above), and always state the number *with* the
  evidence it came from — the delivered profile set, the ladder row, the highest merged tag, and the
  saga's gate status — so the maintainer can refute the derivation instead of having to supply the
  input. **Deriving is not authorizing:** the tuple is tagged only after the maintainer promotes the
  `saga/*` RC to `main` and approves cutting the release; an agent never tags on its own initiative.
- Release runs off a tag; the release workflow re-runs conformance as a gate — never tag on red.
- **Never auto-assign issues to a cloud coding agent** as part of automation without explicit
  maintainer approval.

## Checklist
- [ ] CodeQL + dependency review + Dependabot + secret scanning active; least-privilege tokens; actions pinned.
- [ ] Version **derived** from the delivered profile set + ladder — not asked for, not read off the tag.
- [ ] Saga Gate recorded, `saga/*` RC promoted to `main`, and maintainer authorization to cut the tag obtained.
- [ ] Release tags a single lockstep tuple; all packages share one spec version + profiles.
- [ ] No `npm publish` anywhere; every `@openlogo/*` manifest keeps `"private": true`.
- [ ] Conformance (profile + DAG deps) green before tag **and** re-checked in the release job.
- [ ] Highlighter/tooling shipped with the grammar change it tracks.
