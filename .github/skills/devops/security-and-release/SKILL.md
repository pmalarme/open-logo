---
name: security-and-release
description: >-
  How @devops keeps the OpenLogo supply chain safe (CodeQL, dependency review, secret scanning) and
  automates releases of the lockstep @openlogo/* tuple per delivery.md — tagging only conformance-green,
  single-spec-version, declared-profile sets. Use for security scanning or cutting a release.
created: 2026-07-17T00:00
updated: 2026-07-17T00:00
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
  — active on every PR; blocks known-vulnerable/deny-listed dependencies (`fail-on-severity: high`).
- **Secret scanning + push protection** enabled; **no secrets or tokens** in code, fixtures, or
  workflows (matches the team no-secrets rule). Use `GITHUB_TOKEN` with least-privilege `permissions:`.
- Keep signal high: triage/suppress false positives explicitly; don't let the dashboard rot.

## Release automation (lockstep tuple)

A release is a **validated tuple**, not one package version:

1. All target `@openlogo/*` packages advertise the **same** `openlogo.version` + declared profiles
   (feature-detection metadata is the compat contract, not npm semver).
2. **Conformance is green** for every claimed profile **and its DAG dependencies**.
3. The **highlighter/tooling** shipped in the same milestone as any grammar change it tracks.
4. Then tag once (all packages lockstep) and publish; the first release is **M2** (Turtle &
   Rendering = minimal conformance), `0.1.0`.

## Rules

- **Do not release** if any target package is on a different spec version or a claimed profile's
  conformance is red. KISS: one version line for all packages until there's a real reason to split.
- Release runs off a tag; the release workflow re-runs conformance as a gate — never publish on red.
- **Never auto-assign issues to a cloud coding agent** as part of automation without explicit
  maintainer approval.

## Checklist
- [ ] CodeQL + dependency review + secret scanning active; least-privilege tokens; actions pinned.
- [ ] Release tags a single lockstep tuple; all packages share one spec version + profiles.
- [ ] Conformance (profile + DAG deps) green before tag **and** re-checked in the release job.
- [ ] Highlighter/tooling shipped with the grammar change it tracks.
