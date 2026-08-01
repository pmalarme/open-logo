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
| meta | markdown links, YAML lint (issue forms, labels, workflows), spec-example presence, gh-aw `.md`/`.lock.yml` pairing (orphan guard, scoped to compilable sources) | always |
| **workflows-compile** | pinned `gh-aw compile` on every agentic-workflow source, fails if recompiling changes any committed (or adds any uncommitted) `.lock.yml` (issue #597) | PRs (and pushes to `main`) touching `.github/workflows/**`, `.github/aw/**`, or the pairing-guard scripts |
| build + type-check | `tsc -b` across project references (TS7, strict) | when `package.json` exists |
| lint + format | Biome (lint) + Prettier (format) + OpenLogo style-lint | when `package.json` exists |
| unit | package unit tests | when `package.json` exists |
| **conformance** | stack-neutral `tests/conformance/` fixtures, **by profile along the DAG** | when fixtures exist |
| integration + examples | vertical-slice integration + every `spec/examples/*.logo` still runs | when `package.json` exists |

### gh-aw compile-drift gate (issue #597)

`gh-aw compile` (see AGENTS.md §"gh-aw bootstrap", ADR-0017) turns each `.github/workflows/*.md`
source into a committed `*.lock.yml`; what Actions runs must be exactly that compiled output, never
a hand-edited or stale lock file.

- The always-on `meta` job runs `.github/scripts/validate-workflow-lockfiles.py` (self-tested by
  its `test-validate-workflow-lockfiles.py` pair, the same convention as
  `validate-lockfile-registry.py`) to catch **orphans**: a `.lock.yml` with no matching `.md`, a
  `.lock.yml` whose `.md` still exists but is no longer a workflow gh-aw compiles (its top-level
  `on:` trigger was removed, so nothing will ever recompile the lock — just as stale as a deleted
  source, and reported with its own message), or a
  `.md` gh-aw would actually compile with no `.lock.yml` yet. Only a `.md` whose first line is
  a frontmatter opener (`---`, surrounding whitespace trimmed) *and* whose frontmatter declares a top-level `on:` trigger
  is treated
  as requiring a lock file — verified empirically against gh-aw v0.83.1: a plain doc (e.g. a
  `README.md` dropped into `.github/workflows/`), a frontmatter-only import fragment with no
  `on:`, and anything under a subdirectory (e.g. `shared/`) are all files gh-aw itself never
  compiles, so the guard must not demand a lock file for them either (see `requires_lock()` in
  `validate-workflow-lockfiles.py`, which parses the frontmatter as YAML — with `yaml.BaseLoader`,
  so key spellings are compared exactly as gh-aw's Go YAML parser sees them — and so classifies
  block-style and flow-style frontmatter through the same code path; anything it cannot classify
  fails **closed**, i.e. demands a lock). The `---` delimiter match **mirrors gh-aw** on both
  sides — the guard and the compile job's shell probe both trim surrounding whitespace (so a
  padded ` ---`, or a CRLF line ending, is still an opener, exactly as
  `strings.TrimSpace(firstLine) == "---"` in gh-aw v0.83.1) and both leave a UTF-8 BOM in place
  (Go does not treat U+FEFF as whitespace, so gh-aw skips a BOM-prefixed source and so must we).
  Mirroring the compiler is the point: a stricter rule fails *open* (gh-aw compiles a source the
  guard never demanded a lock for) and a looser one demands a lock no compile can produce.
  `gh-aw compile` never deletes an orphaned lock file and has
  nothing to compile for an uncompiled source, so this check runs *before* compiling, on the
  committed tree.
- `meta` declares job-level `permissions: contents: read` **plus `pull-requests: read`**, which
  `dorny/paths-filter` needs to read a PR's changed-file list; without it the filter step 403s and
  every job gated on its outputs (`workflows-compile`, `studio-visual`) never runs. Scoped to the
  one job that needs it, so the rest of the pipeline keeps the least-privilege default.
- The path-scoped `workflows-compile` job installs the **pinned** `gh-aw` via
  `.github/aw/install.sh` (checksum-verified release download — no `gh extension install`, no
  network beyond the release CDN, no secret), reruns `gh-aw compile`, then stages everything under
  `.github/workflows/` (`git add -A`, not a bare `git diff --exit-code`, so a `.lock.yml` that was
  never committed at all — an untracked file — is also caught) and fails if anything changed,
  naming the drifted file(s) and the fix command (`gh-aw compile && git add
  .github/workflows/*.lock.yml && git commit`).
- Both jobs pass cleanly in **today's actual state** — zero `*.md` sources, zero `*.lock.yml`
  files — rather than silently skipping forever; the pairing check reports "0 pairs" and the
  compile job exits early with an explicit "nothing to compile" message until the first source
  lands.
- **On a `gh-aw` version bump:** the drift diff stages `.github/workflows/` only. If a future
  `gh-aw` emits generated artifacts elsewhere, widen the `git add -A` scope in the same PR as the
  pin bump, or the new artifact drifts unnoticed.
- **Required-check status:** agents cannot edit branch-protection rulesets. This gate should be
  added to the target branch's required status checks by a maintainer once it has run green at
  least once; until then it still fails the PR (red X), it just is not yet a hard block.

## Rules

- **Guard code jobs** so the pipeline is green before any toolchain exists and activates
  automatically once it lands. Detect the manifest in the always-on `meta` job (after checkout) and
  gate code jobs on its output — **not** on `hashFiles()` in a job-level `if`, which evaluates before
  checkout and is unreliable:

  ```yaml
  jobs:
    meta:
      outputs:
        has_toolchain: ${{ steps.detect.outputs.has_toolchain }}
      steps:
        - uses: actions/checkout@v4
        - id: detect
          run: |
            if [ -f package.json ]; then
              echo "has_toolchain=true" >> "$GITHUB_OUTPUT"
            else
              echo "has_toolchain=false" >> "$GITHUB_OUTPUT"
            fi
    build:
      needs: meta
      if: ${{ needs.meta.outputs.has_toolchain == 'true' }}
  ```
- **No `--if-present`.** Once the toolchain lands, each DoD script (`build`, `typecheck`, `lint`,
  `format:check`, `test`, `conformance`, `examples`) MUST exist — call them plainly so a missing gate
  is a real failure, not a silent pass.
- **Conformance is profile-aware:** a profile's job passes only when its fixtures **and its DAG
  dependencies'** fixtures pass (`spec/conformance.md`). Turtle & Rendering ⇒ needs Core green.
- **Fast + deterministic:** headless turtle, no wall-clock/frame dependence, cache dependencies, pin
  action versions. `repeat 10000 [ forward 1 ]` tests semantics, not frames.
- **Testing authors the suites; you wire them.** Don't write test content here — run what `@testing`
  produces.
- You wire the gate; **humans + required checks merge** (or a maintainer-delegated `@orchestrator`,
  only on a non-author review-gate PASS). Never add an auto-merge that bypasses review.

## Procedure

1. Add/adjust the job in `.github/workflows/ci.yml`; keep one concern per job with clear names.
2. Trigger on `pull_request` and `push` to `main`; set `permissions:` to least privilege.
3. Make the new gate a **required check** (repo settings / branch protection) once it is stable.
4. Keep the meta job always-on so docs/label/workflow drift is caught even pre-toolchain.

## Checklist
- [ ] Each DoD item maps to a CI gate; names are clear.
- [ ] Code jobs gated on the `meta` job's `has_toolchain` output; meta job always runs.
- [ ] No `--if-present` — every DoD script is called plainly so a missing gate fails.
- [ ] Conformance runs by profile along the DAG.
- [ ] Actions pinned; permissions least-privilege; no bypass of review.
- [ ] `gh-aw` `.md`/`.lock.yml` pairing + compile-drift gates pass green with **zero** agentic
      workflows present, and go red on both an orphaned lock and an uncompiled/edited source.
