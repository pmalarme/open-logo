# 33. The contract version moves with the contract, not with the release

- Status: Accepted
- Date: 2026-09-07
- Deciders: OpenLogo maintainer (@pmalarme)
- Related: refines [ADR-0003](0003-versioning-and-release.md) (versioning and release strategy);
  [ADR-0018](0018-packages-are-private-not-published.md) (packages are private, never published);
  [ADR-0021](0021-built-in-names-list-and-ci-gate.md) (the built-in names list is versioned WITH the
  specification); rule text in [`../delivery.md`](../delivery.md) §1

## Context

[ADR-0003](0003-versioning-and-release.md) already decided **what** the compatibility contract is:
the feature-detection pair **(`openlogo.version`, profile list)** from `spec/conformance.md` — "that
metadata — not npm version numbers — is the compatibility contract". `docs/delivery.md` §1 says the
same. Both are correct and neither changes here.

What neither said is **when `openlogo.version` moves**. That gap was not theoretical:

**The contract version never moved.** Package tags went `v0.1.0` → `v0.2.0` → `v0.3.0` while
`openlogo.version` stayed `0.1.0` across all three. Nobody bumped it during development because
everyone read it as a release artifact and waited for "release time"; release time then only ever
bumped the thing release automation actually touches, which is `package.json`. A version that is
everyone's responsibility at a moment that never arrives is nobody's.

**The result is the defect recorded in #1100:** three released tags all claim spec `0.1.0` and do not
implement the same language. The reserved-word treatment of `end` is the sharp case —

```text
:end = 1        # at tag v0.1.0: REJECTED (ol-reserved-word)
                # today:          explicitly conforming
```

— so "conformant to Core `0.1.0`" does not identify a language. That is precisely the property a
contract identifier exists to have.

**Saga #819 forces the decision rather than merely illustrating it.** It changed Core Language
semantics (the sealed procedure boundary and block lifetime) while the **profile set is byte-for-byte
identical**. The contract is the *pair*; when the profile list cannot move, the version is the only
component left that can distinguish the old contract from the new one. Leaving it at `0.1.0` would
make the ambiguity structural rather than accidental.

**Nothing gates this.** The four constants that carry the version are cross-checked against each
other — `assertGrammarVersionInSync()` throws at module import, and `versionFindings()` in
`scripts/built-in-names-gate.mjs` fails unless `manifest.specVersion === api.OPENLOGO_VERSION` — but
those prove only that the four agree, never that the value is *right for the contract they
describe*. Four files agreeing on a stale number is exactly what shipped three times. No gate reads a
`> OpenLogo Specification vX` stamp at all.

## Decision

**The spec version is a contract identifier, not a release artifact. It MUST move in the pull request
that changes the normative contract — on the branch, not at release time. Package versions stay
independent and are set at release.**

Three parts, each testable by a human reviewer:

**1. What moves it.** A change to the normative contract, i.e. anything that changes a conformance
verdict — a program's accept/reject status, its diagnostics, or its observable behaviour. Concretely:

- a normative Core (or any profile) **behaviour change**, including scoping and lifetime rules;
- a **new or removed reserved word / built-in name**, or a change to an existing one's spelling,
  arity, or profile;
- a **new, removed, or re-specified `ol-*` diagnostic code**;
- a **grammar change** that accepts or rejects a program it previously did not;
- a **profile-membership change** for an existing feature.

**2. What does not move it.** Editorial changes that leave every conformance verdict unchanged: typo
and link fixes, clarifications and rewordings that add no requirement, formatting, examples that
merely restate settled behaviour, and non-normative rationale. If a reviewer cannot name a program
whose verdict changes, the version does not move.

**3. When it moves.** In the **same PR** as the change, never later. The bump is **atomic across all
four coupled constants** — `spec/conformance.md`'s `openlogo.version`, `spec/built-in-names.json`'s
`specVersion`, `@openlogo/core`'s `OPENLOGO_VERSION`, `@openlogo/parser`'s `OL_GRAMMAR_VERSION` —
and additionally updates every **prose statement** of the version in `spec/` (the per-file
`> OpenLogo Specification vX — Draft` stamps and the sentences in `README.md`, `conformance.md`, and
`commands.md`). The coupled four are mechanically enforced; the prose is not, which is why it is
named here explicitly rather than left to be noticed.

**The two version lines are independent and MUST NOT be aligned.** The contract line and the
`package.json` line are different numbers that may coincide — as they do at the moment this ADR is
written, both reading `0.2.0`. Coincidence is not identity: a release that changes no normative
behaviour bumps only the package line, and a contract change on a branch bumps only the contract
line. Never "tidy" one to match the other.

**Past tags are not renumbered.** #1100 evaluated retroactive renumbering and rejected it; released
artifacts are immutable. This decision fixes the going-forward identity, and #1100 remains the record
of the three tags that share `0.1.0`.

## Consequences

- **`openlogo.version` becomes a real identifier again.** Two implementations reporting the same
  version and profile set now make a claim that can be true or false, rather than one that is
  vacuous.
- **The bump lands where the evidence is.** The PR that changes the contract is the only place where
  a reviewer can see *both* the behaviour change and the version move, and judge whether rule 1 or
  rule 2 applies. Deferring it to release time separates the decision from its evidence, which is how
  it came to be skipped three times.
- **Release automation gets simpler, not harder.** It owns one line — the package versions — and no
  longer carries an unwritten obligation to notice that the contract changed months earlier.
- **Consequently the version moves more often, and that is the point.** `0.x` minor bumps are cheap;
  an ambiguous contract identifier is not. This is a `0.x` draft specification, so the version
  ratchets per contract change, and `spec/conformance.md`'s own Versioning section already permits
  minor versions to add, remove, or change profile requirements.
- **The prose half stays unenforced for now.** Nothing reads the `> OpenLogo Specification vX` stamps,
  so a future contract change can still bump the four constants, go green, and leave 25 stale prose
  sites behind — the same "validated by nothing" shape as an unchecked fixture `description`. This
  ADR states the rule; gating it is left to a follow-up rather than asserted here, so that no one
  reads a green CI run as proof the rule was followed.
- Rule 1 versus rule 2 still needs human judgement at the margin. That is deliberate: "name a program
  whose verdict changes" is a cheap, concrete test a reviewer can actually apply, and a wrong call in
  the conservative direction (bumping when unsure) costs a version number, while the other direction
  costs a contract identity.
