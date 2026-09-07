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
implement the same language. Declaring a procedure named `end` is the sharp case — **measured by
building each tag and running it**, not inferred:

```text
define end
  return 1
end
```

| tag | `package.json` | reports `OPENLOGO_VERSION` | verdict for the program above |
|---|---|---|---|
| `v0.1.0` | `0.1.0` | `0.1.0` | accepted, no diagnostic |
| `v0.2.0` | `0.2.0` | `0.1.0` | accepted, no diagnostic |
| `v0.3.0` | `0.3.0` | `0.1.0` | **rejected — `ol-reserved-word`** |

Three tags, three different `package.json` values, **one** unchanged contract version, and two
different answers to the same program. So "conformant to Core `0.1.0`" does not identify a language.
That is precisely the property a contract identifier exists to have.

> Note what the example is **not**. `:end = 1` is *accepted at every one of the three tags and still
> today* — it is a **binding**, and `spec/grammar.md`'s rule is that a program may not **declare** a
> built-in name while it may **bind** a value to any name. The distinction is easy to lose, and an
> earlier draft of this ADR cited `:end = 1` as rejected at `v0.1.0`; building the tag disproved it.
> The lesson generalises to the rule below: the test is a *verdict*, and a verdict has to be observed.

**Saga #819 forces the decision rather than merely illustrating it.** It changed Core Language
semantics (the sealed procedure boundary and block lifetime) while the **profile set is byte-for-byte
identical**. The contract is the *pair*; when the profile list cannot move, the version is the only
component left that can distinguish the old contract from the new one. Leaving it at `0.1.0` would
make the ambiguity structural rather than accidental. Measured across the same three tags, both
`#819` behaviours are unchanged at `v0.1.0`/`v0.2.0`/`v0.3.0` and differ only on this saga branch:

```text
define f
  print :x
end
:x = 1
f            # all three tags: prints 1 — this branch: ol-var-not-visible

repeat 1 [ :inner = 5 ]
print :inner # all three tags: prints 5 — this branch: ol-undefined-var
```

**Almost nothing gates this, and less than it looks.** Only **three** of the values are mechanically
cross-checked, in two separate pairwise checks: `assertGrammarVersionInSync()` throws at module
import unless `OL_GRAMMAR_VERSION === OPENLOGO_VERSION`, and `versionFindings()` in
`scripts/built-in-names-gate.mjs` fails unless `manifest.specVersion === api.OPENLOGO_VERSION`.

**`spec/conformance.md`'s `openlogo.version` — the normative statement of the contract, and the one
the other three exist to mirror — is compared to nothing.** Verified by mutation: rewriting all seven
of its version sites to `9.9.9` leaves `npm run built-in-names` reporting *"spec version 0.2.0 — 0
finding(s)"* and `npm run spec-citations` green. Nor does any gate read a
`> OpenLogo Specification vX` stamp.

And even the three that *are* coupled prove only that they agree with **each other**, never that the
value is right for the contract they describe. Three files agreeing on a stale number is exactly what
shipped three times.


## Decision

**The spec version is a contract identifier, not a release artifact. It MUST move in the pull request
that changes the normative contract — on the branch, not at release time. Package versions stay
independent and are set at release.**

Three parts, each testable by a human reviewer:

**1. What moves it.** A change to the normative contract — anything that changes a **conformance
obligation or an observable result**, whether or not any program's accept/reject status moves.
Concretely:

- a normative Core (or any profile) **behaviour change**, including scoping and lifetime rules;
- a **new or removed reserved word / built-in name**, or a change to an existing one's spelling,
  arity, or profile;
- a **new, removed, or re-specified `ol-*` diagnostic code**;
- a **grammar change** that accepts or rejects a program it previously did not;
- a **profile-membership change** for an existing feature;
- a change to any other normative surface that no program's verdict reveals — the **trace/event
  stream**, **feature-detection/host metadata**, **token classes** (`spec/tooling.md`), **rendering
  and deterministic export** (`spec/rendering.md`), or the **accessibility** obligations. These are
  normative too, and a test framed only around accept/reject would silently exempt every one of them.

**2. What does not move it.** Editorial changes that leave every conformance obligation unchanged:
typo and link fixes, clarifications and rewordings that add no requirement, formatting, examples that
merely restate settled behaviour, and non-normative rationale.

**The reviewer's test.** *Name the conformance obligation or observable result that changes, and say
how you would observe it* — a program whose verdict differs, an event or metadata field that differs,
a token painted differently, a rendered or exported artifact that differs. If nothing can be named,
the version does not move. A program is the **most common** oracle, not the only one: an earlier
draft of this rule said "name a program whose verdict changes", which would have exempted a rendering
or token-class change from ever moving the version. And the oracle must be **observed** rather than
assumed — see the `:end = 1` note above, where a plausible-sounding verdict turned out to be wrong.

**3. When it moves.** In the **same PR** as the change, never later, across **all four** sites that
carry it — `spec/conformance.md`'s `openlogo.version`, `spec/built-in-names.json`'s `specVersion`,
`@openlogo/core`'s `OPENLOGO_VERSION`, `@openlogo/parser`'s `OL_GRAMMAR_VERSION` — **plus** every
prose statement of the version in `spec/` (the per-file `> OpenLogo Specification vX — Draft` stamps
and the sentences in `README.md`, `conformance.md`, and `commands.md`).

Be precise about how much of that is enforced, because it is less than the symmetry suggests. **Three
of the four are mechanically coupled** — `OPENLOGO_VERSION` ↔ `OL_GRAMMAR_VERSION` at import, and
`specVersion` ↔ `OPENLOGO_VERSION` in the built-in-names gate — so those three cannot drift apart
silently. **`spec/conformance.md`'s value and all the prose are checked by nothing** (see the mutation
above). At the bump that produced this ADR that left **28 of the 29 version statements in `spec/`
hand-maintained**, which is why they are enumerated here rather than left to be noticed.

**The two version lines are independent and MUST NOT be aligned.** The contract line and the
`package.json` line are different numbers that may coincide — and on the branch where this ADR was
written they *appeared* to, both reading `0.2.0`. That was an artifact: this saga branched **before**
the `v0.3.0` release bump, so the same tree that carries contract `0.2.0` carries package `0.2.0`
here and package `0.3.0` on `main`. The two lines separate visibly the moment the saga merges.
Coincidence is not identity: a release that changes no normative behaviour bumps only the package
line, and a contract change on a branch bumps only the contract line. Never "tidy" one to match the
other.

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
- **Most of the bump stays unenforced, and this is the weakest part of the decision.** Only three
  values are mechanically coupled. Nothing reads `spec/conformance.md`'s `openlogo.version` or any
  `> OpenLogo Specification vX` stamp, so a future contract change can bump the three coupled
  constants, go green on every gate, and leave **28 stale version statements** in `spec/` behind —
  the same "validated by nothing" shape as an unchecked fixture `description`, and the shape that
  produced #1100 in the first place. This ADR states the rule; **gating it is deliberately left to a
  follow-up (#1144)** rather than asserted here, so that nobody reads a green CI run as proof the
  rule was followed. Per AGENTS.md, *policies and instructions are guidance; CI is the gate* — and
  this is currently guidance.
- Rule 1 versus rule 2 still needs human judgement at the margin. That is deliberate: "name the
  obligation that changes and say how you would observe it" is a cheap, concrete test a reviewer can
  actually apply, and a wrong call in the conservative direction (bumping when unsure) costs a
  version number, while the other direction costs a contract identity.
