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
one row" — reading `v0.2.0` as a version string rather than placing it by its tagged tree — yielded
`0.3.0` for a tuple the ladder then numbered `0.4.0`. Re-derive from the repo; never reuse this
number. **This exact gap was resolved on 2026-09-04**: `v0.2.0`'s tree already declared M4's full
profile set (M3 + M4 shipped together under one tag), so the maintainer chose to renumber the ladder
from M5 onward rather than leave a permanent `0.3.0` gap — see the current mapping in step 2 below and
[`docs/delivery.md`](../../../../docs/delivery.md) §3, which is now the **sole** authoritative source;
do not recompute a ladder version from this paragraph's numbers.

**Read every input from `origin/main`, after fetching.** A worktree's local `main` is routinely stale
— when this procedure was written it sat 3 commits behind, declaring 5 profiles instead of 9, which at
the time mapped onto M4 and would have handed the reader a stale version while every other cross-check
below still passed. That is why step 1 reads `origin/main` directly and step 3 carries an explicit
staleness check: a stale ref is a failure mode that otherwise produces a confident wrong number in
silence.

1. Read the **delivered profile set** from `origin/main`: `git fetch origin`, then
   `git show origin/main:packages/core/src/host-metadata.ts` and take `SUPPORTED_PROFILES` — the
   feature-detection metadata that
   [ADR-0003](../../../../docs/adr/0003-versioning-and-release.md) makes the compatibility contract.
   **By policy** a profile may appear there only once its conformance is green; that linkage is a
   convention, not a gate (no check derives required fixture coverage from this list), so treat it as
   the repository's *declared* shipped set and verify the claim independently in step 4.
2. Map it onto the saga ladder in [`docs/delivery.md`](../../../../docs/delivery.md) §3 ("The saga
   ladder"): take the **highest saga whose profiles are all present**, and its row gives the version.
   **Always read the version off that table directly** — do not memoize the mapping here, because the
   maintainer renumbers rows when an earlier release compressed two rows into one tag (see the M4
   footnote in that table, resolved 2026-09-04: M3 + M4 shipped together under `v0.2.0`, so M5 onward
   were renumbered down by one — `0.1.0-core` → `0.1.0` → `0.2.0` → `0.2.0` → `0.3.0` → `0.4.0` is the
   mapping as of that renumbering, but the table is the source of truth, not this sentence). The
   number is driven by the **saga's profile set**, not by Conventional Commit types — a `feat:` inside
   an already-released saga does not move it.
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
   - **Number settled, sequencing unsettled** — the tag lags the ladder by more than one row. Place
     the tag on the ladder by reading `SUPPORTED_PROFILES` from the **tagged tree**, not from its
     version string; the two can diverge, as they did when `v0.2.0` was found to declare M4's profile
     set although the ladder of the day numbered M4 `0.3.0` (resolved 2026-09-04 by renumbering the
     ladder — see the M4 footnote in `docs/delivery.md` §3). Report the mapped row's version, then ask
     how to number the gap — but do **not** offer to backfill a version whose profiles already shipped
     under an earlier tag: that tag would contain nothing new and would contradict its own manifests.
     The normative sources do not settle the sequencing, so it is a maintainer call — renumbering the
     ladder going forward (as happened 2026-09-04) is one valid resolution; leaving a documented,
     permanent gap is another.
   - **No new ladder version** — the derived version does not exceed the tag floor, **or** the tagged
     tree already declares the same ladder row as `origin/main`, so no new ladder row has shipped even
     though the ladder numbers that row above the tag's version string. In **that** case — same row,
     derived version above the floor — report that the row already shipped under the earlier tag and
     that the difference is the tag's under-numbering, not a new ladder row; do not propose the
     derived version, and leave the renumbering to the maintainer. Otherwise compare against the floor. If it
     is **equal** and the tag points at the current `origin/main` tree, the delivered profile set is
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

### Three artifacts the maintainer must approve

Deriving a release produces **three** artifacts, and **all three are proposals** until the maintainer
approves them. Never tag, publish a release, or push notes on the strength of your own derivation.

| Artifact | Derived from | Why it needs a human |
|---|---|---|
| **Version** | delivered profile set → ladder row (above) | ladder gaps and how to number them are its calls |
| **Release message** | the saga's epics/issues + the DoD run | the project's public claim of what works |
| **Changelog URL** | previous tag → new tag | wrong endpoints render an empty or misleading diff |

Approval comes in **two phases**, because two of the three cannot be finished before the tag exists —
a compare URL has nothing to resolve against and the DoD figures must come from the tagged SHA:

1. **Before tagging** — present the version with its derivation evidence, the *draft* message, and
   the *intended* URL. The maintainer approves the version and the candidate SHA, and authorizes the
   tag. Nothing is published.
2. **After tagging** — confirm the tag points at the approved SHA, **then** push it (a local tag is
   deleted silently; a pushed one is not). Re-run the DoD on it and replace the draft's figures with
   the measured ones, then **open** the changelog URL and check it shows the expected range. Present
   the finished message and URL for final approval, and only then publish the GitHub release.

The message is the riskiest of the three: it asserts capabilities to learners. Every claim in it must
be **measured on the tagged SHA**, not inferred from issue titles — an unproven line here is the
"ungated prose" failure the Definition of Done exists to prevent.

#### Release-message template

Follow the shipped `v0.2.0` notes — that is the current shape; `v0.1.0` predates it and is structured
differently. Fill every placeholder. Delete sections that do not apply, and **add** the conditional
ones below when they do.

```text
# OpenLogo <X.Y.Z> — <saga title, e.g. "Heritage · Sprites · Interaction & Events · Sound">

<One paragraph: what this release is. State that it advances the @openlogo/* monorepo tuple from
<previous> to <X.Y.Z> in lockstep, and which saga(s)/profiles it adds on top of what.>

## Highlights since <previous version>

**<Saga or profile name>**
- <Capability, in learner-facing terms. Name the commands/primitives it adds.>

## Compatibility

A release is a **validated tuple**, not a single package version. All `@openlogo/*` packages share
release version `<X.Y.Z>` and target the **same spec version**:
- `openlogo.version` (feature-detection / spec-compat contract) stays **`<spec version>`** —
  <state plainly whether this is a new spec version or more of the same one>.
- Declared profiles: <the SUPPORTED_PROFILES set, in prose>.
- Conformance is green across the full profile DAG.

## Known issues

<Conditional — include whenever something ships incomplete. Anything that parses but does not
run, or works only partially, with its tracking issue. Omit only if there are genuinely none.>

## Definition of Done (Node 22)

build · typecheck · lint · format · coverage <L/B/F> · conformance <passed/failed/skipped>
(full DAG) · examples <ran/skipped/failed>.

**Full changelog:** <changelog URL — see below>
```

Two rules the template cannot enforce for you. Keep the **release version** and `openlogo.version`
visibly distinct — `0.2.0` shipped against spec `0.1.0`, and collapsing the two would misstate the
compatibility contract. And quote the **DoD numbers actually produced by the tagged SHA**; copying
the previous release's figures is how a stale claim ships.

**Do not drop the Known-issues section to make a release look cleaner.** `v0.1.0` shipped one
declaring that `sin`/`cos`/`tan`/`pi` parse but are not evaluated at runtime (#323) — precisely the
kind of gap a learner hits first. Suppressing a known limitation is the same ungated-prose failure as
asserting an unproven capability, in the opposite direction.

#### Changelog URL template

Two forms, and the choice is not stylistic — a compare URL needs a predecessor to diff against:

```text
Subsequent release:  https://github.com/pmalarme/open-logo/compare/v<previous>...v<X.Y.Z>
First release only:  https://github.com/pmalarme/open-logo/commits/v<X.Y.Z>
```

Both endpoints must be **pushed tags** before the URL resolves: a compare against a tag that exists
only locally returns 404, and `commits/<missing tag>` is worse — it renders a plausible-looking but
empty history rather than an error. So build the URL after pushing the tag and **open it** to confirm
it shows the expected range. Ladder rows and shipped tags are not necessarily one-to-one — `v0.2.0`
shipped M3 *and* M4 together (which is why the ladder was renumbered 2026-09-04, see the M4 footnote
in `docs/delivery.md` §3) — so never infer from the version numbers alone what a diff contains, and if
a future renumbering ever leaves a real gap between two tags, explain it in the notes. Determine what
a range actually spans by inspecting the two tagged trees, not by reading their version strings.

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
- **Version, release message, and changelog URL are all proposals.** Draft all three and present them
  together for approval **before tagging**; after tagging, re-present the message with its measured
  figures and the opened changelog URL for final approval (the two phases above). Every capability
  claim in the message is measured on the tagged SHA, never carried over from the previous release.
- Release runs off a tag; the release workflow re-runs conformance as a gate — never tag on red.
- **Never auto-assign issues to a cloud coding agent** as part of automation without explicit
  maintainer approval.

## Checklist
- [ ] CodeQL + dependency review + Dependabot + secret scanning active; least-privilege tokens; actions pinned.
- [ ] Version **derived** from the delivered profile set + ladder — not asked for, not read off the tag.
- [ ] Saga Gate recorded, `saga/*` RC promoted to `main`, and maintainer authorization to cut the tag obtained.
- [ ] Version, release message, and changelog URL drafted from the templates and **maintainer-approved**.
- [ ] Release-message claims measured on the tagged SHA; changelog URL opened and showing the right range.
- [ ] Release tags a single lockstep tuple; all packages share one spec version + profiles.
- [ ] No `npm publish` anywhere; every `@openlogo/*` manifest keeps `"private": true`.
- [ ] Conformance (profile + DAG deps) green before tag **and** re-checked in the release job.
- [ ] Highlighter/tooling shipped with the grammar change it tracks.
