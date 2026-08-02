# 20. Resolve every review finding, bounded to 10 review rounds

- Status: Accepted
- Date: 2026-08-02
- Deciders: OpenLogo maintainer (@pmalarme) + team
- Related: refines [ADR-0008](0008-implementer-run-self-review.md) (implementer-run self-review),
  which itself amends [ADR-0004](0004-independent-review-gate.md) (independent review gate)

## Context

[ADR-0008](0008-implementer-run-self-review.md) put the review gate inside the implementing session:
before opening a PR the author dispatches at least two non-author reviewers and **iterates until each
returns `pass`**. That wording left two gaps that showed up in practice:

- **Severity leakage.** Reviewers raise more than `block`s — nits, "consider…", small clean-ups,
  missing test names, stale comments. Because only a `block` stopped the PR, a `pass` could arrive
  carrying a list of non-blocking findings that nobody ever acted on. Those findings then either
  rotted or came back as review comments on the PR, defeating the point of reviewing *before* the PR
  opens, and quietly undercutting the Boy Scout rule (team instructions §11), which exists precisely
  to make small in-scope improvements land while the author is already in the file.
- **Unbounded iteration.** "Iterate until each returns `pass`" has no stop condition. A slice whose
  spec basis is ambiguous, or which is simply too big, can loop indefinitely, burning session budget
  and hiding the real signal — that the *slice* is wrong, not the code.

## Decision

The Definition of Done gains a tenth item, and the review gate two rules:

1. **Every finding is resolved, blocking and non-blocking alike.** Each finding ends in exactly one
   recorded state: **fixed**, or **declined with a one-line rationale** — the latter allowed only
   when the fix would leave the task's declared write-set, belongs to another owner, or contradicts
   the spec/KISS. Real work that is merely out of scope is **filed as a follow-up issue** and the
   issue number is recorded beside the rationale. A silently dropped finding means the change is
   **not done**; a `pass` carrying an undispositioned suggestion is not a pass.
2. **The loop is capped at 10 rounds.** One round = dispatch reviewers → collect findings →
   fix/decline → commit. If anything is still open after round 10, the author **does not open the
   PR**: it escalates to `@orchestrator`/the maintainer with the outstanding findings and the SHA
   reviewed in each round, and the slice is normally re-cut
   (`orchestrator/decompose-and-dispatch`) instead of ground out.

`@orchestrator`'s pre-merge verification (`orchestrator/integrate-and-merge` step 1) additionally
checks the findings ledger: everything fixed or declined-with-rationale, converged inside the cap.

This **refines** ADR-0008 — the who (non-author sub-agents), the when (in-session, before the PR),
and the SHA-binding of verdicts are unchanged; only the exit condition of the loop is sharpened.

## Consequences

- **Reviews finish in the session that created them.** Non-blocking feedback is acted on while the
  author still has context, instead of reappearing as PR comments after the gate has "passed".
- **Declining stays legitimate but auditable.** The author still controls scope — the Boy Scout rule
  is bounded by the declared write-set — but a decline now costs one line of rationale and, where the
  work is real, a follow-up issue, so scope decisions are reviewable rather than invisible.
- **Non-convergence becomes a visible signal.** The 10-round cap turns a silent grind into an
  explicit escalation with evidence (open findings + per-round SHAs), which usually results in a
  smaller slice or a spec clarification.
- **A slightly longer pre-PR loop, deliberately.** Fixing nits before opening costs rounds; the trade
  is fewer post-open review cycles and less follow-up drift, which is the same bet ADR-0008 already
  made.
- Guidance updated in the same change: team instructions §5 (now a **10-point** DoD),
  `shared/definition-of-done`, `shared/review-gate`, `shared/vertical-slice`,
  `orchestrator/decompose-and-dispatch`, `orchestrator/integrate-and-merge`, `AGENTS.md`, and the
  pull-request template's self-review checklist.
