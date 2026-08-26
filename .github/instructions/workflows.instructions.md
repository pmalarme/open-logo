---
applyTo: ".github/workflows/**"
---

# CI/CD workflows — working rules (DevSecOps)

Scoped rules for GitHub Actions under `.github/workflows/`. Read the always-on
[team agreement](openlogo-team.instructions.md) and [`docs/delivery.md`](../../docs/delivery.md) first.

**Owner:** [`@devops`](../agents/devops.agent.md) ·
**Skills:** [ci-pipeline](../skills/devops/ci-pipeline/SKILL.md),
[labeler-and-labels](../skills/devops/labeler-and-labels/SKILL.md),
[security-and-release](../skills/devops/security-and-release/SKILL.md),
[branching-and-commits](../skills/devops/branching-and-commits/SKILL.md),
[agent-policy](../skills/devops/agent-policy/SKILL.md)

## Responsibility
The pipelines that turn the [Definition of Done](openlogo-team.instructions.md) into enforced gates,
keep the supply chain safe, drive the labeler + label sync, and cut releases. `@testing` authors the
suites these workflows run; you wire and secure them.

## Files here
- `ci.yml` — DoD gates: an always-on **meta** job (labels/issue-forms/workflows validation via
  `.github/scripts/validate-meta.py`, a `.github/scripts/validate-workflow-lockfiles.py` guard
  against orphaned `.md`/`.lock.yml` pairs — scoped to only the `.md` files gh-aw actually
  compiles (frontmatter opener + top-level `on:` trigger, matched exactly the way gh-aw matches
  them), never a `README.md`, plain doc, import fragment, or subdirectory file), a path-scoped
  **`workflows-compile`** job that recompiles every `gh-aw` agentic-workflow source
  with the pinned `gh-aw compile` and fails on any diff (issue #597 — see
  [ci-pipeline](../skills/devops/ci-pipeline/SKILL.md); rationale for adopting `gh-aw` itself,
  its guardrails, governance boundary, and kill-switch:
  [ADR-0019](../../docs/adr/0019-adopt-agentic-workflows.md)). Do **not** use
  `hashFiles()` in a job-level `if` — it evaluates before checkout. The **build/lint/test** jobs
  used to be gated on `if: ${{ needs.meta.outputs.has_toolchain == 'true' }}`; `package.json` has
  existed since M0, so that condition could no longer be false and the guard was **dead code in a
  gate** — a claim about a case that cannot happen. It was deleted, which is why **no** job-level
  condition on a gate job is permitted any more (`PERMITTED_JOB_CONDITIONS` is empty).
- **Gate wiring is itself gated.** `validate-meta.py`'s `check_gate_wiring` asserts that every
  Definition-of-Done gate — the npm scripts derived from `package.json` **and** the Python metadata
  gates derived from `.github/scripts/{validate,test-validate}-*.py` — is invoked by an
  unconditional step **in `ci.yml`**, and that no job or step in any workflow is fail-open or
  skippable. Note the asymmetry deliberately: the *fail-open* sweep reads every workflow, but the
  *wiring* half reads `ci.yml` only. That limit is narrower than it first appears, and the
  disclosure should not under-sell it: the two scripts declared in `PYTHON_GATE_EXCEPTIONS` **are**
  covered, because `test-validate-meta.py` asserts each declared exception really appears in the
  workflow its reason names — deleting the `validate-commits.py` steps from `commitlint.yml` leaves
  `validate-meta.py` at exit 0 but fails the self-test. The genuine residual is a gate that lives in
  a workflow other than `ci.yml` **and** is not a declared exception; there is none today.
  Nine ways to silently disable a gate were found in review (issue #978): swapping
  `npm run -s lint` for a second `format:check`; `continue-on-error` in any spelling, including
  `${{ … }}` expressions; an `if:` on a gate **step**; an `if:` on a gate **job** (which switched
  off the whole lint job while the guard stayed green); deleting the Python gates, which had no npm
  script and so were never derived; **emptying the inventory itself** — the Python set was once
  a hand-written tuple whose self-test iterated over that same tuple, so clearing it produced zero
  mutants and a vacuous pass (issue #964's defect); burying a gate command inside a **multiline
  `run:` block** (`run: |` + `if false; then npm run -s lint; fi`), which every line-wise reader
  accepts; running it under a custom **`shell:`**; and pointing a gate job's **`needs`** at a job
  that is itself skipped, which GitHub then skips too while the gate job's own `if:` stays clean.
- **Forbid what you cannot analyse.** *"Is this step reached?"* is unbounded in GitHub Actions —
  step `if`, job `if`, `needs`, shell control flow, `continue-on-error`, triggers, `strategy`,
  `container`. Deciding it by parsing is undecidable, which is why three successive readers were
  defeated: a substring check (beaten by an `echo` prefix), a shell tokeniser (beaten by `|| true`
  and `if false; then … fi`), and a line-wise scalar reader (beaten by a multiline `run:`).
  *"Is this step written in the one permitted shape?"* is a **closed** question, so that is what is
  checked instead. A gate step is a **single-line `run:` scalar whose complete trimmed text equals
  the approved command**, with no `shell:`, no step `if:`, no job `if:`
  (`PERMITTED_JOB_CONDITIONS` is empty), and `needs` drawn only from `PERMITTED_GATE_JOB_NEEDS` —
  a **set membership test**, not a graph traversal. `check_gate_wiring` additionally asserts each
  permitted anchor exists, carries no `if:`, and has no `needs:` of its own, so the whitelist cannot
  be satisfied by an anchor that is itself dormant. Non-gate steps are unaffected: a multiline
  `run:` remains ordinary CI authoring.
- **A verifier must not share the parser of the thing it verifies.** `test-validate-meta.py` used to
  read `ci.yml` with PyYAML and split each `run:` into lines — exactly what the production side did
  — so it inherited that reader's blind spot and reported nothing when the reader was wrong. It now
  reads `ci.yml` as **text** and counts only single-line `run:` commands, skipping block-scalar
  bodies by indentation. The two sides share no code: a mutant that weakens the gate's reader to
  substring matching is still caught by the test.
- **One documented spelling for a gate step, so the two readers cannot disagree.** Write it as:

  ```yaml
  - run: npm run -s lint            # a trailing comment is fine
  - run: "npm run -s lint"          # quoting is fine
  ```

  and **not** as a block scalar — `|`, `|-`, `>` or `>-` — even one holding a single command. Be
  precise about why, because the obvious statement is false: **a block scalar containing the command
  DOES run it.** It is unsupported because the two readers do not agree on it. The textual reader
  skips block bodies (it must, or it would match a `run:`-looking line inside one), while PyYAML
  hands production the string — and for the **chomped** forms `|-` and `>-` it strips the trailing
  newline, so production sees an ordinary single-line command and accepts it. So `|` and `>` are
  rejected by both readers; `|-` and `>-` are rejected by the textual reader alone. **All four are
  closed by the combination**, which is the independent reader doing exactly what it exists for:
  the two instruments have genuinely different shapes, and they disagree precisely where those
  shapes differ. A form only one reader accepts is a false red waiting to happen, so the supported
  spelling is the one they both accept.

  Inline comments and quotes are **stripped, never forbidden**, and the two must be handled in the
  right order: an earlier reader required the command to end the line, so
  `run: npm run -s lint # required gate` failed the self-test while production passed; a later one
  dequoted *after* comment-stripping, so `run: "npm run -s lint" # required gate` — the form the
  block above documents — failed while production passed. **A false red is worse than a missed
  bypass** (a gate that cries wolf gets deleted by the next maintainer), and worse still is a gate
  whose own documentation promises a form its reader rejects. The legal shapes are therefore locked
  by fixtures asserting they are *accepted*, alongside the mutants asserting bypasses are *caught*:
  a gate is falsifiable in two directions and only one of them used to be tested. Non-gate steps are
  unaffected: a multiline `run:` there remains ordinary CI authoring.
- **Presence is not execution, in every workflow.** `PYTHON_GATE_EXCEPTIONS` declares the gates that
  legitimately run outside `ci.yml`, and each declared entry must be invoked by a **complete
approved `run:` command** in `commitlint.yml`, which this check names as a **literal** — it does
**not** parse the entry's prose reason, so rewriting that reason to say "runs in label-sync.yml"
changes nothing and the check stays green. The reason is documentation for a human; the workflow
it is checked against is hard-coded alongside the approved command. Asserting the script's
*filename* appeared there was defeated by `echo python .github/scripts/validate-commits.py` — the
filename survived in a comment and in the neighbouring self-test step, so the substring was intact
while nothing ran. That is the round-1 `echo` defeat resurfacing in the one file the fix had not
reached.
- **`label-drift.yml`'s triggers are pinned as complete mappings, not merely present.**
  `REQUIRED_DRIFT_TRIGGERS` fixes the whole trigger set and each trigger's configuration:
  `schedule` (with its cron), `workflow_dispatch`, `workflow_run` (workflow name and types), and
  `pull_request` (its `paths`). Deleting the first three left everything green while removing
  detection of a label created ad hoc **through the API**. Worse, adding
  `branches: ["release-please--*"]` to `pull_request` also passed with every other pin
  byte-identical — and that is the severe one, because on a **non-default branch the other three
  triggers are dormant**, so `pull_request` on those paths is the *entire* live #972 coverage that
  exists today. Adding `branches: [main]`, or dropping a cron to save Actions minutes, is routine
  maintenance, which is what makes this a plausible accident rather than a hostile one.
- **A mutation loop needs a clean control, or every mutant passes for free.** Round 4 taught
  `check_gate_wiring` to require the permitted anchor to exist, and the drop-loop scratch trees
  named their job `all` — so they always produced an error, `if not dropped_errors:` became dead,
  and **18 mutation cases silently went vacuous**: the #964 class, inside the fix for the #964
  class, introduced by the fix. Nothing reported it, because a mutation loop that never fires looks
  exactly like a mutation loop where every mutant is caught. `test-validate-meta.py` now asserts the
  **unmutated** scratch tree produces zero errors, counts the mutants that actually fired, and
  **prints that count** — a collapse to zero is now visible rather than inferred.
  Both derived counts are printed so a collapse to zero is visible, and `test-validate-meta.py`
  holds an **independent** expected list that the derivation, `package.json`, and `ci.yml` must all
  agree with. A deliberate fail-open — `dependency-review.yml` is advisory while the repo is private
  — is declared in `FAIL_OPEN_EXCEPTIONS` with its reason, so a **new** one cannot appear silently;
  the two Python scripts that legitimately run outside `ci.yml` are declared the same way in
  `PYTHON_GATE_EXCEPTIONS`.
- **Match whole steps, not fragments.** `test-validate-labels.py` requires each `label-drift.yml`
  step that mentions `validate-labels.py` to be an exact approved **`(run, if)` pair** in
  `REQUIRED_DRIFT_STEPS`, and pins the job's own `if:` and its absence of `needs:`. Those two steps
  genuinely need a condition (the PR branch passes `--proposed`, the non-PR branch does not), so
  they cannot be required unconditional the way `ci.yml`'s gate steps are — and review switched both
  off with `if: false` while every exact command stayed intact. Pinning the pair closes that with no
  new analysis: the same allow-list mechanism, one field wider. This checks invocation **shape** —
  that the workflow can only invoke the command in an approved form — it does not prove the step is
  reached at runtime.
- `codeql.yml` — CodeQL JS/TS scan (PRs, `main`, weekly); guarded by its own `detect` job so it
  activates when `package.json` lands.
- `dependency-review.yml` — blocks new high-severity/deny-listed dependencies on every PR. Needs the
  Dependency Graph (GHAS on private repos), so it is advisory while the repo is private and a hard
  gate once public.
- `labeler.yml` — path→label PR labeling from [`.github/labeler.yml`](../labeler.yml).
- `label-sync.yml` — reconciles repo labels from [`.github/labels.yml`](../labels.yml) via
  `.github/scripts/sync-labels.py` when the manifest changes. **Additive by decision** — it never
  deletes, because deleting a label deletes it off every live issue and GitHub does not restore
  those applications (issue #972).
- `label-drift.yml` — the detector that additive sync cannot be: compares the manifest against the
  repository **in both directions** via `.github/scripts/validate-labels.py --live`, failing when a
  label in use on an open issue/PR is unmanifested, or when a label **containing a colon** is in
  neither `.github/labels.yml` nor `.github/labels-retired.yml`. Scheduled, dispatchable, run on
  manifest PRs (with `--proposed`, since the sync only runs after merge) and after a successful
  `Label sync` via `workflow_run` — not `push`, which would race the sync. It is deliberately not a
  per-PR blocking gate, because its result depends on mutable repository state. The deterministic
  half (`area:*`/`profile:*` against `validate-commits.py`'s `AREAS`/`PROFILES`) runs in `ci.yml`'s
  `meta` job on every PR.
- `commitlint.yml` — Conventional Commits via `.github/scripts/validate-commits.py` (self-tested by
  `test-validate-commits.py`). The **PR title is blocking** (it is the squash-merge subject); commit
  subjects are **advisory** warning annotations, because a cloud agent cannot rewrite the bootstrap
  commit the platform creates before its first turn. See
  [branching-and-commits](../skills/devops/branching-and-commits/SKILL.md) and
  [ADR-0016](../../docs/adr/0016-commit-convention-and-agent-policy.md).
- `copilot-setup-steps.yml` — prepares the GitHub Copilot Agent environment by installing the
  pinned `gh-aw` CLI via `.github/aw/install.sh`. The job **must** stay named
  `copilot-setup-steps` to be recognized. Generated by `gh aw init`, then adapted (install step +
  `actions/checkout@v7`); the deviations are documented in the file header.

## Also owned by @devops (outside this folder)
- [`.github/aw/`](../aw) — `version` is the single authoritative `gh-aw` version pin (upgrade =
  edit this one line, re-run the installer, then recompile lock files); `install.sh` is the shared
  platform-aware, checksum-verified installer used by CI, contributors, and agents alike. Rationale
  in [ADR-0017](../../docs/adr/0017-gh-aw-toolchain-bootstrap.md).
- [`.github/mcp.json`](../mcp.json) — MCP server registration for the agentic-workflows tooling.
  It launches the **standalone** `gh-aw mcp-server` binary, not the `gh aw` extension (`gh` does
  not resolve extensions from `PATH`).
- [`.github/agent-policy.md`](../agent-policy.md) — the one-page briefing every Copilot cloud agent
  session reads before its first commit; it links out to the owning SKILLs rather than restating
  rules. Governance model in [agent-policy](../skills/devops/agent-policy/SKILL.md), including where
  admin-applied org/enterprise Copilot agent policies are recorded.
- [`.githooks/`](../../.githooks) — local `commit-msg` check, wired by the root `prepare` npm script.
  **Guidance, not a gate**: bypassable with `--no-verify` and never a required check.

## Conventions
- **Least privilege:** set explicit `permissions:` per workflow; default to `contents: read` and add
  only what a job needs (`pull-requests: write` for labeler, `issues: write` for label sync).
- **Pin actions by version** (`@v5`, `@v4`); prefer first-party/official actions.
- **Deterministic + fast:** cache deps, no wall-clock/frame dependence; conformance runs by profile
  along the DAG (a profile job needs its dependencies green).
- **Guidance vs. gate:** policies, instructions, and hooks are guidance; **CI is the only gate**.
  Never add a hook or an agent policy to the required-status-check list.
- **Never bypass review:** CI gates merges; no auto-merge, no self-approval. Never commit secrets;
  never auto-assign a cloud agent without maintainer approval.
- Keep the labeler map + labels manifest in step with package renames — update them in the same PR.
