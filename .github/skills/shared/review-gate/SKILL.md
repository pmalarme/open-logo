---
name: review-gate
description: >-
  The OpenLogo pre-merge review gate — how the implementing agent runs at least two independent,
  non-author reviews as sub-agents (a logic/spec reviewer — rubber-duck or a named fallback — and
  every domain-adaptive QA that re-runs the Definition of Done from a clean tree), resolves *every*
  finding — blocking and non-blocking alike — over at most 10 iterations, and attaches all verdicts
  before opening the PR. A verdict certifies a commit, so the tree must be clean and pushed before
  each dispatch, the dispatched SHA tagged, and the branch frozen once every verdict stamps one SHA.
  The orchestrator then does a final verification and merges.
created: 2026-07-17T00:00
updated: 2026-08-25T00:00
---

## Purpose

CI-green and the author's own say-so are **not** enough to merge. An implementer must never be the
sole attester that their change is done: green checks can hide real defects. A stale `.tsbuildinfo`
makes `tsc -b` exit `0` without emitting anything, and a `typescript-eslint` peer-cap can pin the
compiler below TypeScript 7 — both the kind of thing a second reviewer catches and a passing
pipeline does not.

So the review runs **inside the implementing session, before the PR is opened.** The implementing
agent does not review its own work: it **dispatches at least two review sub-agents**, hands them the diff,
fixes what they find, and re-runs them until all return `pass`. Only then does it open an
already-green PR with all verdicts attached. This keeps the whole review in one session instead of a
slow, round-by-round hand-off through the orchestrator, while keeping the "implementer is never the
sole attester" rule intact — the agents doing the reviewing are **not** the author.

It extends `shared/definition-of-done` (the checklist the author self-runs) with two _independent_
re-runs, and is the closing step of every `shared/vertical-slice`.

## When to use

On **every** change before its PR is opened — feature slice, fix, docs, or foundation. Run it once
the author believes the Definition of Done is met, as the last step of the implementing session.

## Who runs it — the implementer, via at least two non-author sub-agents

The implementing agent spawns these as **sub-agents** (it can — no `tools:` allowlist restricts the
delivery agents). The agent doing the reviewing is **never the author**:

| Sub-agent           | Looks at                                                                                                                                                                                                                                                                                                          |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **logic/spec reviewer** — `rubber-duck`, or a **named non-author fallback** agent | Logic, design, **spec-fidelity**, and the **diff** itself — does it do the right thing the OpenLogo way, within package boundaries, KISS/Boy-Scout, no scope creep?                                                                                                                                               |
| **QA** (a domain expert) | Re-runs the Definition of Done from a clean tree and checks the change's domain. **Domain-adaptive:** `@testing` by default (conformance + coverage + clean-tree DoD), plus/instead the owner of the changed area — `@language-designer` (grammar/AST), `@turtle-engine` (rendering), `@geometry-teacher` (geometry), `@learner-experience` (studio), `@ai-tutor` (tutor), `@curriculum` (lessons), `@documentation` (docs). |

- **QA is domain-adaptive:** dispatch the expert(s) the change actually needs, and more than one for
  a cross-cutting change (e.g. `@testing` **and** `@language-designer` for a grammar+fixtures slice).
- **QA expert ≠ author.** When the author *is* the natural QA owner (e.g. `@testing` authoring
  fixtures, `@language-designer` authoring the grammar), recruit a different non-author expert
  (`@interpreter`, `@testing`, or the relevant peer) so the reviewer stays independent.
- `rubber-duck` is a Copilot CLI built-in reviewer; the QA experts are the OpenLogo agents. Reuse
  them rather than inventing a new persona (KISS). What matters is the role: **at least two**
  independent, non-author reviews — the **logic/spec reviewer** plus **every** dispatched QA expert.
- **`rubber-duck` needs a compatible session model.** It is a built-in critic that deliberately runs
  on a _different_ model from the session, and is only available when the implementing session uses a
  **Claude or GPT large model**. Run implementing sessions on such a model; if `rubber-duck` is
  unavailable, substitute a **named second non-author domain agent** as the logic/spec reviewer and
  **record which agent stood in and why** (so the fallback is auditable) — there are still **two**
  independent reviews.
- **Reviewers never edit the branch.** `rubber-duck` is read-only by design; the QA experts _can_
  edit but must not — a reviewer who changes the branch becomes an **author** and voids their own
  verdict. Reviewers report findings; the **author** fixes them. This includes **scratch probes**:
  write them outside the repository (`$TMPDIR` / `$env:TEMP`), never into the worktree. A reviewer
  who dirties the tree while measuring it has voided its own verdict and everyone else's.

## A verdict certifies a commit, not the disk

The same-SHA rule below assumes something it never checks: **that the SHA describes what the
reviewer actually read.** A dirty working tree breaks that assumption invisibly — a reviewer
dispatched while the author has uncommitted changes reads the **disk** and stamps a **commit**, and
the two differ. It fails in both directions, and neither is detectable afterwards from the verdict,
because the verdict names a SHA and a SHA looks authoritative:

- **False pass** — the reviewer reads a fix that never landed, and stamps the commit that lacks it.
- **False block** — the reviewer reads a defect already fixed on disk, and stamps a finding against
  a commit that is fine.

Both have happened here; issue **#884** records the instances. Four rules, in order. They are
**mechanical on purpose**: two discipline-based remedies ("remember not to edit mid-round") failed
in the same slice before the mechanical one held.

1. **Commit before dispatching a reviewer.** `git status --porcelain` must be empty — no
   uncommitted edits, no untracked scratch files. Push it too, so the SHA exists somewhere other
   than your disk.
2. **Verify every reviewer is idle before editing anything.** Not "try to remember not to edit
   mid-round" — *check*, every time, and only then touch the tree. This is the rule that actually
   worked.
3. **Freeze once every verdict stamps one SHA — with a tag, not a declaration.** Between the last
   `pass` and opening the PR, the branch does not move. Any later commit — including a "quiet"
   formatting push — **voids every verdict** and requires a full re-dispatch (see the round rules
   below). Make it mechanical: **tag the SHA you dispatch, and dispatch the tag.** A tag names one
   commit; a branch name names whatever happens to be at its tip when the reviewer reads it, so a
   later push silently moves what is under review. **A freeze declaration is not a mechanism.** On
   **#952** the author touched the tree during reviewer measurement **four times in ten rounds** —
   recorded in PR **#982**'s own summary. That is why this has to be a mechanism rather than a
   promise: a declaration is only as good as every subsequent decision to honour it.
4. **Reviewers assert cleanliness themselves.** Do not take it on trust from the author's report:
   run `git status --porcelain` and `git rev-parse HEAD` yourself, at the start **and** at the end
   of the review, and record both. If they differ, or the tree was dirty, say so and stamp nothing —
   that is the same standard this gate applies to every other claim.

### A clean tree is not enough — say *which artifacts* you measured

A tree can be `git status`-clean and still be measured wrong, because the **build** can diverge from
the SHA while the working tree looks fine. #897 already proved the same tree measures differently on
different platforms; the rules below keep it from measuring differently on the *same* platform.
Issue **#884** records the observed instances. A reviewer must be able to state which **artifacts**
it measured, not merely which SHA:

1. **Serialize — never mutate the tree while a reviewer is measuring it.** A session that dispatches
   QA reviewers into its own worktree has **two writers on one `dist`**: the reviewer rebuilds while
   the author is still working, or two reviewers rebuild concurrently, and the measured artifacts
   belong to neither party's intended tree. This is a *concurrency* rule, distinct from rule 1
   above — a tree can be clean and mid-rebuild. It produces false verdicts in **both** directions: a
   red gate that is really the other reviewer's mutation still applied, or a mutation that looks
   uncaught because the other reviewer reverted it mid-measurement. Order: reviewers finish →
   author re-verifies → freeze → PR.
2. **Do write-capable checks in a disposable checkout, never in the implementing worktree.** This is
   how rule 1 and "reviewers never edit the branch" hold together: a clean `npm ci`, a forced
   rebuild, and a mutation probe all have to write something. Clone the **exact SHA** to a scratch
   directory outside the repository and work there; nothing in it is ever committed or pushed, and
   no other actor writes to it. **Read source the same way** — `git show <sha>:<path>`, or from that
   checkout. Never read a mutable implementing worktree and treat it as the commit: a transient edit
   made and reverted between your two `git status` checks is invisible to both, so you would have
   read something that exists in no commit at all. #884 records exactly that — tracked files
   transiently modified and reverted, and a transient `lint` failure clean on two immediate re-runs
   — observed by a reviewer who re-checked `git status` around every measurement.
3. **Confirm a mutation actually applied before believing its result.** A string-replace mutation
   that silently matched nothing (a CRLF mismatch) once left an all-green suite reading as "my test
   is not load-bearing". `git diff` the file to confirm the change is present, then confirm it
   reached `dist`. **A mutation you did not verify applied is not a mutation test.**

### The instrument may be measuring something other than what you think

The rules above make the **tree** trustworthy. This one makes your **measurement of it** trustworthy
— a different question, and the one that fails silently.

The principle: **an instrument inherits the blind spots of whatever it is built on, and reports
success from inside them.** Several mechanisms recur — not the only ones, but the ones that keep
costing work here — and all of them return plausible output rather than an error. (This sentence
used to carry a count. It was wrong in three consecutive review rounds, twice falsified by the very
edit that corrected it, because every new instance has to remember to increment a number nothing
re-derives. The number is the defect, not its value; the list below is the enumeration.)

**1. The instrument enumerates a narrower set than the truth.** A tool that enumerates the repository
through git cannot see an untracked file, so a green run over unstaged work certifies a tree that
does not contain the work. The worked example is the gate built in **#934**:
`scripts/spec-citations-gate.mjs` walks the **tracked** set via `git ls-files`, and its verification
run happened **before `git add`**. The gate had therefore never read its own source, and reported
green. Its own reviewers caught it. (Note it is a library module — the runner is
`scripts/check-spec-citations.mjs`; executing the module directly exits `0` with no output, which is
a silent green measuring nothing, and an instance of this very rule.)

**2. The verifier shares the parser of the thing it verifies.** Then it cannot see the defect by
construction. A citation re-pointing tool reported *"each verified byte-identical"* — **false for 2 of
48**: its shift regex matched only the **first** range of a citation, so a citation carrying a second
range after a comma had its head moved and its tail left stranded on unrelated prose. The verifier
used the same regex, so it confirmed the move it had itself mis-parsed. **A verifier built from the
subject's own parser is a second opinion in name only.** (Commit `499da987` records the 48; its diff
carries the two comma-tailed citations whose head moved while the tail did not.)

**3. The reporter suppresses the signal you are filtering for.** The instrument runs, the subject
really does fail, and your filter reports success — because it is matching a string the reporter
never emits. `node --test`'s default reporter does **not** print TAP `not ok`, so a perturbation
harness grepping for `not ok` concludes "my test is not load-bearing" no matter what happened; pass
`--test-reporter=tap`. The same shape caught a reviewer from the other direction: `[System.IO.File]::WriteAllText`
resolves relative paths against **.NET's** working directory, which PowerShell's `cd` does not
change, so three perturbations were written into a different checkout than the one being built and
tested (set `[System.Environment]::CurrentDirectory = $pwd`). Both cost multiple false conclusions
in one slice. **Attribute a failure to a test by NAME, and make every perturbation carry a
behavioural control proving the mutation reached the artifact you are measuring** — a fail *count*
tells you something changed, not that the thing you meant to break is what broke.

**And the authoring counterpart, which writes the wrong artifact rather than measuring one.** A
shell escape can silently put a *control character* into source: PowerShell's backtick turns
`` `value` `` into `<VT>alue`, `` `false` `` into `<FF>alse`, and `` `events` `` into `<ESC>vents`,
destroying the code span around it. Four instances were found by hand in one slice and **one had
already reached `main`**, because build, typecheck, lint, format, the full test suite, conformance
and 100% coverage are all blind to it — reading a file as text hides the byte. There is no gate;
`#1130` specifies one. Until it lands, sweep raw bytes yourself after any here-string edit.

**Another door onto the same room, which that remedy does *not* close: the whole module graph
resolving into a different checkout.** In an npm workspace, `node_modules/@scope/*` are links into
`packages/*`, and `npm` repoints them at whatever directory it last ran in. A disposable clone that
reuses the implementing worktree's `node_modules` therefore **steals** those links, and deleting the
clone leaves them dangling — so a perturbation is edited and built in one tree and *measured* in
another. Both reviewers on one slice hit it independently: one drew a confident false performance
conclusion, the other a false `95.19%` coverage reading it nearly reported as contradicting the
author's claim, and the author's own build then failed with `Cannot find module '@openlogo/core'`
because the links were gone. Per-test behavioural controls all pass throughout, because each test
really did run — against the wrong artifacts. **Give a disposable checkout its own `npm ci`, and
assert the resolved module URL lives under the tree you are measuring** (`import.meta.resolve`, or
just print the realpath). Recovery in the implementing worktree is `npm install`.

**The operational form — and the only reliable check.** An instrument cannot detect its own blind
spot, so the remedy is never a more careful pass with the same one: it is **a second,
differently-shaped instrument**. Re-running your own sweep more attentively re-measures the same set.
Change the *shape* — a different enumerator, a different parser, a hand-audited sample, an external
oracle such as issue state, or the artifact the claim is ultimately about.

Saga #572 produced at least five instances:

| trap | what was actually measured |
| --- | --- |
| `git ls-files` before `git add` | a tree without the new file |
| a re-pointing tool verified by its own regex | only each citation's first range; comma-appended tails unchecked |
| `tsc -b` mtime after a `Copy-Item` restore | a stale `dist/`, while `git status` reads clean |
| `node` v26 coverage | a report with **zero** `*.test.mjs` rows, printing 100% |
| `highlight(src, {profiles})` (**#951**) | Core-only profiles — the options were bound to `document` |

Each cost real work: the coverage one would have shipped a false 100%, and the `highlight` one
produced **two** false issues (#832, #840) and a withdrawn Epic Gate PASS.

So, before believing any green measurement: **state what the instrument enumerated** — which files,
which profiles, which artifacts, which runtime — and confirm the thing you changed is inside that
set. Name the oracle you checked it against (`git ls-files '*.test.mjs'` for the coverage case), and
make sure that oracle does not share the instrument's own blind spot. A reviewer meeting a sixth
variant should recognise the shape rather than the instance.

**This is discipline, not a gate.** Nothing in CI enforces it, and per AGENTS.md *"Policies,
instructions, and hooks are guidance; CI is the gate."* Claiming otherwise here would be the very
defect the rule exists to prevent.

## The checklist

The **logic/spec reviewer** (`rubber-duck`, or a named fallback) owns logic, design, and
spec-fidelity; the **QA** sub-agent(s) re-prove items (a)–(f) below from a clean tree. Every
dispatched reviewer must clear every item before the PR is opened.

### (a) Clean-tree Definition-of-Done re-run

Do not trust the author's report or cached CI. From a clean checkout:

- Run `npm ci` (a clean install, not `npm install`), then every DoD script the change touches:
  `build`, `typecheck`, `lint`, `format:check`, `test`, `conformance`, `examples`.
- **Verify the build actually emitted artifacts** — do not accept a `0` exit code as proof. Confirm
  real `dist/*.js` **and** `*.d.ts` outputs exist and are fresh.
- **Beware the incremental no-op trap:** a stale `.tsbuildinfo` can make `tsc -b` report success
  while emitting nothing. **mtime is the gate** — when the timestamp check says "up to date" the
  content is never read at all, so a file restored from a backup (older mtime than `dist`) is
  silently skipped and the next run re-measures the *previous* content. A restored file with an
  older mtime once produced a reported regression that did not exist; the mirror image is worse, a
  stale build leaving a test **green** under a change it never compiled. Force a clean build (delete
  `dist/` + `*.tsbuildinfo`, or build with `--force`) and confirm the artifacts are regenerated —
  **in `dist`, not `src`**.
- Sanity-check the toolchain itself: the compiler resolves to **TypeScript 7** — peer-caps or
  transitive pins must not silently downgrade it.

> For a **docs/skills-only** change with no touched package, these build steps are N/A — the QA
> sub-agent still runs the rest of the checklist against the docs, skills, and spec.

### (b) Spec-fidelity

- Canonical OpenLogo vocabulary, not classic Logo (`shared/spec-fidelity`).
- Diagnostics use stable `ol-*` codes **with source spans** — no ad-hoc error strings.
- The feature sits in exactly one **profile** and respects the dependency DAG / minimal path.

### (c) Conformance fixtures

- Stack-neutral fixtures exist under `tests/conformance/` for the feature and are **green**
  (`shared/conformance-fixture`) — positive **and** negative (`ol-*`) cases, tagged with the right
  profile. Fixtures were extended, never weakened.

### (d) Runnable examples

- `spec/examples/*.logo` and doc snippets still **parse and run**.

### (e) Accessibility / pedagogy (where applicable)

- Reduced-motion, keyboard access, and non-visual descriptions (`spec/rendering.md`); progressive
  hints / no-spoilers for educational commands (`spec/educational-model.md`).

### (f) Instructions / skills / docs / spec drift

Ask: does this change require updating any of —

- `AGENTS.md`
- `.github/instructions/*.instructions.md`
- `.github/skills/**`
- `docs/**` (including ADRs)
- `spec/` cross-links

If yes, the update **must be in the same PR**. A behavior change that leaves its guidance stale is a
**block**, even when code and tests are green.

**Re-derive, don't re-read.** Every number and every `file:line` citation the change adds or touches
is an **unverified assertion** — nothing recomputes it (see
[`shared/definition-of-done`](../definition-of-done/SKILL.md)'s "Derived counts in prose"). A
reviewer checks them by measuring against the current tree, not by trusting the PR body: counts,
file lengths, and `spec/*.md:<line>` ranges all drift silently, and this saga renumbered
`spec/grammar.md` under existing citations.

## Findings — every finding gets resolved, blocking or not

Reviewers raise findings at different severities: a `block` (the change is wrong, unproven, or
drifted) and **non-blocking** ones (nits, suggestions, "consider…", follow-ups). **Both must be
resolved before the PR is opened** — "it was only a nit" is not a disposition. Each finding ends in
exactly one of two states, recorded on the PR:

- **Fixed** — the default. Non-blocking findings inside the task's declared write-set are simply
  fixed; that is the Boy Scout rule (team instructions §11) doing its job.
- **Declined, with a one-line rationale** — allowed only when the fix would leave the declared
  write-set, belongs to another package/owner, or contradicts the spec or KISS. Real work that is
  merely out of scope is **filed as a follow-up issue** and the issue number is recorded next to the
  rationale. A finding that is silently dropped, deferred without an issue, or answered with "will
  do later" counts as **unresolved**, and the PR is not ready.

The reviewer does not get a veto over the disposition, and the author does not get to ignore
findings: the audit trail (fixed, or declined with a rationale/issue) is what makes the choice
reviewable by `@orchestrator` and the maintainer.

**When you fix false prose, delete rather than rewrite — but delete-don't-rewrite applies to a
*claim*, not to a *sentence*.** A replacement sentence acquires a new false claim remarkably often:
one slice produced one in four consecutive review rounds, including a source file misquoted inside
quotation marks and a fabricated citation replaced by a false inference from a real one. Deletion has
no such failure mode. But a sentence carrying three claims needs each measured **separately** —
deleting all three because two are false discards a true one and replaces a compound claim with a
compound omission, and any surviving forward-looking claim still owes a tracking issue. Measure per
claim; delete the false ones; leave the true ones alone.

## Iterate until everything passes — at most 10 rounds

One **round** = **verify every reviewer is idle** → dispatch reviewers on a clean, committed,
pushed HEAD → collect findings → fix/decline → commit. Repeat until **every**
reviewer returns `pass` on the same final HEAD **and** every finding of every severity is fixed or
declined-with-rationale. The loop is **bounded at 10 rounds** on one change.

If round 10 ends with anything still open, **stop — do not open (or mark ready) the PR** and escalate
to `@orchestrator` (or the maintainer) with: the outstanding findings, the SHA reviewed in each
round, and why the change is not converging. Not converging in 10 rounds is a signal about the
*slice*, not the reviewers — usually it is too big, its spec basis is ambiguous, or it needs a
contract change first, and it should be re-cut (`orchestrator/decompose-and-dispatch`) rather than
ground out.

## Output — iterate to green, then hand over

- **Review a clean, committed HEAD.** Commit **and push** the work first — `git status --porcelain`
  empty — so the reviewers read exactly what the PR will contain and the SHA they stamp exists in
  history (see "A verdict certifies a commit, not the disk"). Each sub-agent records findings tied
  to the checklist item it
  fails, **marks each finding `block` or `non-blocking`**, **names the base + head commit SHA it
  reviewed** and confirms the tree was clean at both ends of its run, and ends with an explicit
  **verdict**: `pass` or `block` (with the specific items to
  fix). A `pass` that carries non-blocking findings is **not** a licence to open the PR — those
  findings are resolved first (see above).
- On any `block` **or any unresolved finding of any severity**, the implementer **fixes (or declines
  with a recorded rationale), commits, and re-dispatches**. **Any new commit after a
  `pass` invalidates that `pass`:** re-run **all** reviewers on the new HEAD so every verdict
  describes the *same* final SHA. The PR is opened only once **every** reviewer — the **logic/spec
  reviewer** (`rubber-duck` or its named fallback) **and each** dispatched QA expert — returns `pass`
  on that HEAD with **zero** findings left open, within the **10-round cap**.
- **Attach every verdict to the PR** (body or comments), each stamped with the reviewed head SHA, so
  the audit trail shows two (or more) independent, non-author reviews of the revision being merged.
- **No self-merge.** The implementer does not merge. Once the PR is open with every verdict and
  required CI is green, the **`@orchestrator` does a final verification** — every verdict present,
  from non-authors, and **stamped with a SHA matching PR HEAD** (a later commit voids an earlier
  `pass`), CI green, a light sanity check — and merges under maintainer-delegated authority
  (team instructions §5), or a human merges. The gate itself never merges, and the implementer is
  never the sole attester.

## Checklist (record on the PR)

- [ ] All required reviews run as sub-agents, **all ≠ author** (at least two): the **logic/spec reviewer** — `rubber-duck` (Claude/GPT large session model) **or a named non-author fallback** — plus **every** dispatched domain QA expert; reviewers stayed read-only.
- [ ] **Every reviewer read the commit its verdict names**: tree clean (`git status --porcelain` empty) and pushed before each dispatch, **the dispatched SHA tagged and the tag dispatched**, every reviewer idle before any edit, reviewers asserted cleanliness themselves, and the branch was **frozen** once all verdicts landed on one SHA.
- [ ] **The instrument measured what you think**: each green run states what it enumerated (files, profiles, artifacts, runtime) and the work under review is inside that set — a `git ls-files` walk cannot see untracked work, and a verifier sharing its subject's parser inherits its blind spot.
- [ ] **Artifacts, not just a SHA**: the tree was never mutated while a reviewer was measuring it (no two writers on one `dist`); write-capable checks ran in a disposable checkout of the exact SHA outside the worktree; any mutation was confirmed applied via `git diff` and confirmed in `dist` before its result was believed.
- [ ] Clean-tree DoD re-run — build **emits** verified (no stale-`.tsbuildinfo` no-op; TS 7 confirmed).
- [ ] Spec-fidelity — canonical vocabulary; `ol-*` codes with spans; profile boundaries.
- [ ] Conformance fixtures present, green, and extended.
- [ ] Runnable `spec/examples/*.logo` and doc snippets parse/run.
- [ ] A11y / pedagogy checked where applicable.
- [ ] Instructions / skills / docs / spec drift checked (in-PR if needed); every count and `file:line` citation the change touches was **re-derived**, not trusted.
- [ ] **Every finding resolved — blocking *and* non-blocking**: each one fixed, or declined with a one-line rationale (+ follow-up issue number when it is real work outside the write-set).
- [ ] Converged within the **10-round cap** (otherwise: not opened — escalated to `@orchestrator`/maintainer with the open findings and per-round SHAs).
- [ ] All verdicts `pass` on the **same final HEAD** (SHA-stamped) and attached; any later commit re-ran every reviewer; no self-merge.
