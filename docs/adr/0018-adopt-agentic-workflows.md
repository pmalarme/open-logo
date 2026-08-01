# 18. Adopt GitHub Agentic Workflows (gh-aw): rationale, guardrails, kill-switch

- Status: Accepted
- Date: 2026-08-01
- Deciders: OpenLogo maintainer (@pmalarme)
- Related: builds on [ADR-0017](0017-gh-aw-toolchain-bootstrap.md) (how `gh-aw` the CLI is pinned,
  installed, and verified — this ADR is about *why* we run its output in Actions and under what
  constraints); mechanics in
  [`../../.github/instructions/workflows.instructions.md`](../../.github/instructions/workflows.instructions.md)
  and [`../../AGENTS.md`](../../AGENTS.md) §"gh-aw bootstrap".

## Context

OpenLogo is built by a team of specialized agents already invoked by hand — a human or the
orchestrator starts `@testing`, `@devops`, `@interpreter`, and so on, one session at a time. That
model works for feature slices with a clear owner and a PR to review, but a growing slice of work is
recurring and unattended by nature: dependency hygiene (are lockfiles and pins stale?), a daily
repository health check (do the ADR index, labels, and issue forms still agree with reality?), and a
daily report to the maintainer (what shipped, what's red, what's blocked). None of that needs a
human to type `@agent` every morning, but all of it needs to run *somewhere* — and "somewhere" has to
be Actions, because that is where the repository's identity, secrets, and required checks already
live.

Two paths existed to get scheduled agent runs into Actions: write bespoke YAML that shells out to an
LLM API by hand, or adopt a purpose-built compiler for exactly this. We chose the latter.

## Decision

We adopt [**GitHub Agentic Workflows (`gh-aw`)**](https://github.com/github/gh-aw): agentic
workflows are authored as markdown files under `.github/workflows/*.md` (frontmatter for triggers,
permissions, and tool access; prose for the agent's instructions) and compiled with the pinned
`gh-aw compile` (ADR-0017) into a committed `*.lock.yml` — an ordinary GitHub Actions workflow that
Actions runs exactly as written, with no runtime interpretation step. The `.md` is the reviewable
source; the `.lock.yml` is the generated artifact that actually executes, and the two are kept in
lockstep by CI (see Guardrails below).

As of this ADR, **zero agentic workflows exist in this repository** — this decision, its guardrails,
and its kill-switch are deliberately being defined *before* the first one is authored, not
retrofitted after. Authoring the first workflows (dependency hygiene, daily health, daily reporting)
is out of scope for this ADR; it is tracked in follow-up issues under epic #590 / saga #589.

### Alternatives considered

- **Hand-written YAML Actions calling an LLM API directly.** No compiled lock-file/source pairing
  discipline, no shared `safe-outputs` sanitization layer, and every workflow author reinvents
  prompt assembly, permission scoping, and output handling from scratch. Rejected: more surface
  area to get wrong, for a problem `gh-aw` already solves.
- **A dedicated GitHub App / bot account.** Buys nothing over Actions' own identity and secrets for
  our scale, adds an app to register, install, and rotate credentials for, and still needs something
  to invoke — we would still be writing the same workflows against a different runner identity.
  Rejected: added operational surface with no corresponding guardrail benefit.
- **Scheduled Copilot cloud-agent sessions** (the same mechanism used for on-demand feature work,
  just cron-triggered). These are full read/write coding sessions with the entire toolset; running
  them unattended on a schedule is a materially larger blast radius than a workflow whose frontmatter
  declares a fixed permission set and tool list up front. Rejected for recurring/unattended work;
  still the right tool for on-demand feature slices.
- **Do nothing — keep every recurring check manual.** No adoption cost, but the checks that most
  need to run reliably (staleness, drift) are exactly the ones a human forgets to run by hand.
  Rejected: the whole point is unattended execution.

## Guardrails

Every guardrail below is either **enforced today** (with the file that enforces it) or explicitly
**aspirational**, with the follow-up issue that will land it. None is claimed as enforced unless a
real file backs it.

- **Enforced — compiled-vs-source drift is caught in CI.** The `workflows-compile` job in
  [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) recompiles every `.github/workflows/*.md`
  with the pinned `gh-aw compile` and fails the PR on any diff against the committed `.lock.yml`, so
  what runs in Actions can never silently diverge from the reviewed markdown source (issue #597,
  landed).
- **Enforced — orphaned source/lock pairs are caught in CI.** `.github/scripts/validate-workflow-lockfiles.py`
  (self-tested by `test-validate-workflow-lockfiles.py`) checks every `.md` gh-aw would actually
  compile (a frontmatter opener plus a top-level `on:` trigger) has exactly one `.lock.yml`, and
  every `.lock.yml` has exactly one `.md` of the same basename (compilable or not), in the
  always-on `meta` job. Neither half-deletion can slip through: a lock file left behind after its
  source was deleted would otherwise keep running with nothing to review it against, and a source
  that was never compiled would silently never run (issue #597, landed).
- **Enforced — the pinned toolchain is verified before it runs.** `.github/aw/version` is the single
  version pin; `.github/aw/install.sh` downloads the matching release asset and checksum-verifies it
  before making it executable, fail-closed (ADR-0017, landed).
- **Enforced — governance boundaries are structural, not advisory, for the surfaces that matter
  most.** `CODEOWNERS` requires `@pmalarme`'s review on `/spec/`, the saga/spec issue templates, and
  `CODEOWNERS` itself; combined with required code-owner review on the target branch's ruleset, no
  workflow — agentic or otherwise — can merge a `[spec]`/`[saga]` change or edit its own governance
  file without maintainer approval (existing mechanism, not new for this ADR). As
  [`branching-and-commits`](../../.github/skills/devops/branching-and-commits/SKILL.md) already
  notes, the branch ruleset's "Require review from Code Owners" setting is a GitHub setting, not
  something visible or verifiable from the repository content itself — CODEOWNERS "only has teeth"
  while that setting stays on; if it were ever turned off, this rule would silently become advisory.
- **Enforced — third-party actions inside generated lock files are SHA-pinned.** Verified
  empirically against the pinned gh-aw v0.83.1: `gh-aw compile`'s output SHA-pins third-party
  actions by default (e.g. `actions/checkout@9c091bb2…` with the version as a trailing comment),
  so this guardrail is a property of the toolchain itself, not something this repository has to
  configure — and its continued truth is what the `workflows-compile` compile-drift gate (issue
  #597, landed) enforces artifact-by-artifact on every PR. The one exception is gh-aw's own setup
  action, `github/gh-aw-actions/setup`, which the compiler pins by version tag (`@v0.83.1`,
  tracking `.github/aw/version` — ADR-0017) rather than by SHA; hand-written workflows elsewhere in
  this repository (`ci.yml`, `codeql.yml`, etc.) also still pin by major version tag (`@v7`), not
  SHA — see [`workflows.instructions.md`](../../.github/instructions/workflows.instructions.md).
  (Previously listed here as aspirational under **issue #604**; corrected once actually verified.)
- **Aspirational — read-only by default, writes only through sanitized `safe-outputs`.** `gh-aw`
  ships a `safe-outputs` mechanism (structured, sanitized proposals — e.g. "open this issue," "post
  this comment" — turned into real GitHub API calls by a trusted post-processing step, rather than
  the workflow's own token calling the API directly) precisely so an unattended workflow's blast
  radius is a *reviewable proposal*, never a direct write. No workflow exists yet to configure this
  in, so nothing enforces it today. Tracked in **issue #604** (combiner never merges directly / write
  scope is least-privilege / all writes route through `safe-outputs`).
- **Aspirational — least-privilege `permissions:` per workflow.** The `.lock.yml` `permissions:`
  block for each future workflow must be scoped to exactly what it needs (mirroring the convention
  [`workflows.instructions.md`](../../.github/instructions/workflows.instructions.md) already states
  for hand-written workflows), reviewed at authoring time. No agentic workflow exists yet to audit.
  Tracked in **issue #604**.
- **Aspirational — cost and rate-limit ceilings.** Nothing in the repository today caps token spend
  or run frequency for agentic workflows; the guardrails-and-reviewer-checklist work in **issue
  #600** is where a concrete ceiling (and what happens when a workflow hits it) gets defined,
  informed by whatever the first workflows actually cost to run.
- **Aspirational — the day-to-day operating rules for authoring/reviewing a workflow.**
  [`.github/instructions/workflows.instructions.md`](../../.github/instructions/workflows.instructions.md)
  today documents the *compiled-CI* side of `gh-aw` (the `workflows-compile` job, the pairing guard)
  but not yet a reviewer checklist for the markdown source itself (prompt-injection posture, tool
  allowlist, `safe-outputs` usage). That rewrite is **issue #598**; this ADR links to it rather than
  duplicating its content.

## Governance boundary — workflows propose, humans dispose

An agentic workflow is bound by exactly the same rules as every other contributor, human or agent,
in this repository, with no special exception:

- It **never merges to `main` or a `saga/*` branch**. The Definition of Done
  ([`openlogo-team.instructions.md`](../../.github/instructions/openlogo-team.instructions.md) §5)
  requires at least two non-author review verdicts and green required CI before anything merges;
  nothing about running unattended in Actions grants a workflow (or the identity it runs as) an
  exception to that gate.
- It **never touches `spec/`.** `CODEOWNERS` names `/spec/` maintainer-owned (`@pmalarme`); a
  workflow proposing a spec change still has to clear the same code-owner review as a human would,
  and per team convention should not even attempt it — spec change requests go through
  `@product-owner`, not an automated PR.
- It **never bypasses the Definition of Done.** A workflow that opens a PR is a PR like any other:
  the same required CI checks in `ci.yml`, `codeql.yml`, and `dependency-review.yml` run against it,
  and the same non-author review gate applies before it can merge.
- `[spec]` and `[saga]` issue/PR templates and the closing of `[saga]` issues **stay maintainer-only
  and non-delegable** — this was already true for every agent (`openlogo-team.instructions.md` §5)
  and an agentic workflow is not a loophole around it.

In short: whatever an agentic workflow produces — an issue, a PR, a comment, a report — is a
*proposal*. A human (or the review-gate-verified agent process the maintainer already trusts for
that surface) decides whether it lands.

## Kill-switch

Today, before the first agentic workflow is authored, the kill-switch is a statement of the
mechanisms that already exist in this repository/GitHub Actions, not a new file:

- **Stop one workflow in under a minute:** `gh workflow disable <workflow-file-or-id>` (or the
  Actions tab → the workflow → "..." → "Disable workflow" in the UI) stops future scheduled/triggered
  runs immediately; a currently-running job can additionally be cancelled with
  `gh run cancel <run-id>` (Actions tab → the run → "Cancel workflow"). Both are available to anyone
  with write access to the repository — no code change or PR required.
- **Stop everything at once:** the repository-wide Actions toggle, **Settings → Actions → General →
  "Disable actions"**, stops *all* workflows (agentic and hand-written) from running — the correct
  choice if the concern is "something is misbehaving and I don't yet know which workflow."
- **Stop it permanently:** delete the `.md` source and its `.lock.yml` from `.github/workflows/` in a
  normal PR; `validate-workflow-lockfiles.py` (issue #597) fails the PR if only one half of the pair
  is removed, so a permanent removal cannot leave an orphaned lock file running.
- **See what is currently running or has run recently:** the repository's Actions tab (or
  `gh run list --workflow <file>` / `gh run list` for everything) lists in-progress and completed
  runs, including the one that triggered each and its current status — this is how a maintainer
  confirms a workflow is (or isn't) active before deciding whether to disable it.

None of this is `gh-aw`-specific tooling; it is the standard GitHub Actions kill-switch, called out
explicitly here because it is normally invisible until the day someone urgently needs it.

## Consequences

- **Positive.** Recurring, unattended work (dependency hygiene, daily health, daily reporting) gets a
  home that does not require a human to remember to start it, without inventing a new execution
  identity or bespoke API-calling YAML — `gh-aw` supplies the markdown-to-lock-file compiler and
  its `safe-outputs` model once authoring begins. The compile-drift and pairing guards (issue #597)
  mean the reviewed source and the executing lock file can never quietly disagree, which is the
  single most important property of this class of automation.
- **Negative — accepted new failure modes.**
  - *Spurious PRs or issues.* An unattended workflow with a flawed prompt or a misread trigger can
    open noise at 3am with no human in the loop to catch it before it's public. Mitigated by the
    review gate (nothing merges unreviewed) but not prevented at creation time until issue #600's
    checklist and issue #604's `safe-outputs` routing land.
  - *Token/cost spend.* Every run costs LLM tokens and Actions minutes; a mis-scheduled or
    infinite-loop-triggering workflow can spend both with no ceiling today. Tracked in issue #600.
  - *Prompt injection from issue/PR text.* A workflow that reads issue bodies, comments, or PR
    diffs as part of its prompt is reading attacker-controlled text if the repository is public or
    accepts external contributions; a crafted comment could attempt to redirect the workflow's
    behavior. The `safe-outputs` sanitization boundary (issue #604) and least-privilege permissions
    are the primary mitigations, and are explicitly not yet implemented — this is the sharpest
    edge of adopting `gh-aw` before those land, and no workflow that reads untrusted external text
    should be authored until they do.
- **Neutral.** This ADR intentionally defines governance ahead of content: it constrains what any
  future agentic workflow may do before the first one exists, rather than writing rules to fit
  workflows already in production.
