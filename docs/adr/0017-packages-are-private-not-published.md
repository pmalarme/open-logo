# 17. The `@openlogo/*` packages are private and never published to npmjs

- Status: Accepted
- Date: 2026-08-01
- Deciders: OpenLogo maintainer (@pmalarme)
- Related: refines [ADR-0003](0003-versioning-and-release.md) (versioning + release-as-a-conformant-tuple);
  mechanics in
  [`../../.github/skills/devops/security-and-release/SKILL.md`](../../.github/skills/devops/security-and-release/SKILL.md)

## Context

ADR-0003 defined a release as a **validated, conformant tuple** of `@openlogo/*` package versions
and left the distribution channel implicit. The prose that grew around it ("tag once and
**publish**") read as a commitment to push the tuple to the public npm registry, and the release
skill and the `@devops` agent both repeated that wording. Nothing in the repository actually
enforced or contradicted it: the root `package.json` is `private`, but each workspace package
carried publishable metadata (`files`, `main`, `types`, `exports`) with no `private` flag, so a
stray `npm publish -ws` would have succeeded.

Two things made the ambiguity worth settling now:

- **The maintainer's intent is that the packages stay private.** OpenLogo is consumed inside this
  monorepo (and by the studio web app it builds); there is no external consumer waiting on an npm
  artifact, and a public registry name is a commitment we do not want to make at `0.x`.
- **Registry assumptions have already cost us.** Issue #642 — the lockfile resolved against private
  Azure Artifacts mirrors, breaking `npm ci` in every agent sandbox — showed how much implicit
  registry configuration can drift unnoticed. Being explicit about which direction packages flow
  (in from the public registry, never out) removes a whole class of that drift.

ADRs are immutable once Accepted, so this is recorded as a new ADR rather than an edit to ADR-0003.

## Decision

**Every `@openlogo/*` package is private and is never published to npmjs.**

- Each `packages/*/package.json` carries `"private": true`, so `npm publish` refuses it by
  construction — the guarantee is in the manifest, not only in prose.
- A **release stays exactly what ADR-0003 defined**: a conformance-gated, lockstep tuple, published
  as a **git tag plus GitHub release artifacts**. Only the registry upload is removed; versioning,
  the feature-detection compatibility contract, and the conformance gate are unchanged.
- Release automation MUST NOT run `npm publish`, and no npm registry credential is added to the
  repository's secrets.
- Consumption is unchanged: packages resolve through npm workspaces inside the monorepo, and
  third-party dependencies continue to install from the **public** npm registry (the CI guard
  against non-public `resolved` URLs from #642 stays in force).

If public distribution is ever wanted, it arrives via a follow-up ADR that supersedes this one —
together with a decision on scope ownership, provenance, and support expectations.

## Consequences

- A stray or automated `npm publish` cannot leak an unreleased package; the failure is immediate and
  local rather than an irreversible registry write.
- The release workflow is simpler: tag, attach artifacts, done — no registry auth, no 2FA/token
  rotation, no unpublish window to reason about.
- External consumers cannot `npm install @openlogo/*`. That is intentional at `0.x`; anyone
  integrating today builds from the monorepo.
- The `@openlogo/*` names remain unclaimed on npmjs. If the project later goes public, name
  squatting is a risk the superseding ADR must address.
- Docs that described publishing (`devops/security-and-release`, `.github/agents/devops.agent.md`)
  are updated to point here; ADR-0003's decision text stays untouched, as immutability requires —
  it receives only the `refined by ADR-0017` cross-link on its `Related:` line.
