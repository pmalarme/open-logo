# We didn't build a programming language with one AI agent. We built an AI *company* — and let it ship.

*How OpenLogo — a new educational programming language with turtle graphics, geometry, and an AI
tutor — was built by a multi-layer fleet of GitHub Copilot agents, and what actually happened when
we let them merge their own work.*

---

Here's a number to sit with: **from an empty repository to a tagged, test-backed `v0.1.0` of a brand-new
programming language in about four days.** Not a toy. A real language — lexer, parser, evaluator,
turtle graphics that draw to a canvas, a syntax highlighter, an error checker, and 397 conformance
tests proving it behaves.

The twist: almost none of it was typed by a human. It was built by a **team of AI agents** organized
like a small software company — a product owner, a language designer, an interpreter engineer, a
turtle-graphics engineer, testers, docs writers, a DevOps engineer, and a tech-lead orchestrator
coordinating them all. A human owned exactly one thing — the language *specification* — and delegated
the rest.

This is the story of how that worked, the structure that made it possible, and the genuinely hard
parts nobody warns you about.

## Why not just one big agent?

The obvious approach is to prompt one powerful model: "build me a programming language." Try it and
you'll watch it drift. It invents a syntax on page one and forgets it by page ten. It re-derives the
same semantics three inconsistent ways. It has no durable idea of *done*, so it declares victory on
code that doesn't compile.

A programming language is not a snippet. It's hundreds of interlocking decisions that all have to
agree with each other — forever. One agent holding all of that in a single context window is a recipe
for incoherence.

So we did the opposite of "one big brain." We built an **org chart.**

## The agent factory

Twelve specialized agents live in the repo as `*.agent.md` files. Seven own a slice of the code:

- **language-designer** — the grammar and keywords
- **interpreter** — the lexer, the syntax tree, the evaluator, the runtime
- **turtle-engine** — everything that moves and draws
- **learner-experience** — the browser app you actually type into
- **geometry-teacher**, **curriculum**, **ai-tutor** — the teaching layer

Five more own no code but hold the team together: **orchestrator** (the tech lead), **product-owner**
(the backlog and the spec), **testing** (proves it works), **documentation**, and **devops** (the CI
pipelines and releases).

But here's the part people get wrong. A good agent is **not a thin persona.** "Act like a tech lead"
is useless. What actually works is giving each agent three things:

1. **Skills** — 29 concrete, step-by-step playbooks (`SKILL.md` files). Not vibes — numbered
   procedures with checklists. "How this team decomposes a milestone." "How to implement a primitive
   end to end." "How to run the review gate." An agent doesn't *improvise* the workflow; it *follows*
   one.
2. **Layered instructions** — an always-on team charter (ownership, the definition of done, the coding
   rules) plus per-package rules that switch on automatically when an agent touches that package.
3. **Memory** — a persistent, cross-session store of hard-won lessons. When one session learns that
   the coverage gate only behaves under a specific Node version, or that the board status has to be
   moved by hand, the *next* session already knows. That's what turns a swarm of forgetful sessions
   into an organization that accumulates experience.

Skills + instructions + memory is the difference between "an LLM that writes code" and "a teammate who
knows how *this* team ships."

## Spec-first: the one thing a human refused to delegate

Before a single line of code, the team wrote a **normative specification** — the grammar, the commands,
the execution model, the error codes, the rendering rules, the conformance profiles, the teaching
model. Every `MUST` and `SHOULD` spelled out.

Here's the twist: the spec itself was built by the *same* agent factory. A fleet of author sessions,
roughly one per document, drafted the seventeen files; an integration session reconciled them; and
independent reviewers re-read the actual text until zero blocking issues remained. Then the human
maintainer did the one thing no agent was allowed to do — reviewed it and merged it. (PR #2:
seventeen documents plus twelve runnable examples, ~7,500 lines.) The humans didn't type the whole
contract; they *owned* it.

That spec is the **single source of truth.** When code and spec disagree, the spec wins — full stop. An
agent that spots a conflict files an issue; it does not quietly "fix" the language. And critically:
**no agent may edit the spec.** Only the product-owner can *propose* a change, as a pull request a human
reviews and merges.

This one rule is load-bearing. It means hundreds of parallel changes can fly by, and the maintainer can
still guarantee the *contract* never moved without a human saying so. It converts a fuzzy instruction
("write good code") into a checkable one ("implement clause 4.2"). Agents stop negotiating meaning and
start implementing it.

## The layered orchestra

Here's the shape of the whole thing:

```mermaid
flowchart TD
  L0["Layer 0 — Human maintainer<br/>owns the spec, delegates merges"]
  L1["Layer 1 — Root orchestrator<br/>spec → milestones → slices, owns integration + the merge queue"]
  L2["Layer 2 — Milestone orchestrators<br/>one per active milestone"]
  L3["Layer 3 — Author sessions<br/>one per task, build a feature end to end, open a PR"]
  L4["Layer 4 — Reviewers<br/>rubber-duck + testing = two non-author sign-offs"]
  L0 --> L1 --> L2 --> L3 --> L4
  L4 -. "verdicts (bound to a commit)" .-> L3
  L3 -. "merge-ready" .-> L2
  L2 -. "status" .-> L1
  L1 -. "spec questions / release sign-off" .-> L0
```

Work flows **down** as decomposition; results flow **up** as "this is ready to merge." The root
orchestrator turns the spec into *milestones* (grouped by capability profile) and each milestone into
*vertical slices* — one feature built all the way through: grammar → tree → evaluator → drawing → tests
→ docs. Not "all the parsing, then all the running." One whole cupcake at a time, not a tray of batter.

Each slice becomes its own **isolated Copilot session** — a dedicated git worktree with its own branch
and its own agent process, kicked off with a prompt and left to run in autopilot on Claude Sonnet 5.
Dozens of these run at once without stepping on each other, because each lives on its own branch.
They coordinate by sending each other messages, which land as new turns in the other session's
conversation. (This very post was written by one such session, dispatched by the orchestrator and
reporting back to it.)

## The gate: nobody merges their own unreviewed work

Speed is worthless if `main` breaks. So every change has to clear a **Definition of Done** and an
**independent two-reviewer gate** before it can merge.

```mermaid
flowchart LR
  A["Author builds<br/>the slice, commits"] --> B{"Two non-author reviews"}
  B --> C["rubber-duck<br/>logic + spec fidelity"]
  B --> D["testing<br/>clean-tree re-run: build, 100% coverage, conformance"]
  C & D --> E{"both pass on the<br/>same commit?"}
  E -- no --> A
  E -- yes --> F["Open PR, CI runs"]
  F --> G{"Orchestrator verifies<br/>verdicts + green CI"}
  G -- green --> H["Merge (delegated) → verify → tidy up"]
  G -- drift --> A
```

The Definition of Done is strict: it builds and type-checks, lint and format pass, **100% test
coverage**, the stack-neutral conformance fixtures pass, the runnable examples still run, and the docs
are updated *in the same PR*. All CI-enforced.

Then two **independent** agents review — and neither is the author. One (`rubber-duck`) checks the
logic and spec fidelity. The other (`testing`) re-runs the *entire* Definition of Done **from a clean
checkout**, because a green pipeline can lie — a stale build cache can make "build" a silent no-op, and
coverage can read 100% only because tests cheated past the public API. A fresh, artifact-emitting re-run
by a second pair of eyes catches exactly that.

One detail matters more than it looks: **verdicts are bound to a specific commit.** A "pass" approves
*one* 40-character commit SHA. Push one more commit and the approval is void — you review again. The
implementer is *never* the only one attesting that the work is good.

Only then does the orchestrator merge — under authority the maintainer explicitly delegated: *"You can
merge and move ahead. I delegate to you until it is spec related."* Anything touching the spec goes back
to the human. Everything else, the machine ships.

## The honest hard parts

If I stopped here it'd be a commercial. The real story includes the failures — and they're the most
useful part.

**Stale-crossing.** This was the big one. Sessions talk asynchronously, and each one acts on a
*snapshot* of the world. So messages cross in flight and agents act on a past that's already gone. We
watched an orchestrator track *its own already-merged work* as still-pending, because a "done" message
and a status check passed each other on the wire. We watched review sign-offs get silently voided
because someone pushed "one more small commit" after the reviewers had started. We watched the app
report a session as idle while its worktree was, in fact, busy.

The fix isn't cleverer prompts — it's **classic distributed-systems discipline**:

- **Live-verify before you act.** Never trust a remembered state; re-check ground truth with `git` and
  `gh` first. The truth was always the actual branch, never a cached status field.
- **Freeze the commit and bind decisions to it.** Wait for one final push, *then* review; a moving head
  invalidates everything downstream.
- **Keep one authoritative record.** The orchestrator tracks its merge queue in a structured store it
  owns, so "what's merged vs. pending" has a single answer that doesn't depend on which message arrived
  when.

**Manual board hygiene.** The GitHub project board's automation needs a secret that wasn't always set,
so moving cards from Todo → In Progress → Done was *manual* — and busy orchestrators forgot. The lesson
is dull but real: a step you *think* is automated but actually isn't is a reliable source of drift.
Automate it or checklist it.

**Over-eager cleaners.** One sharp edge: never point a "clean-tree" reviewer at a worktree the author is
still editing — a reviewer that tidies up "stray" changes can `git checkout` away the author's
in-progress fix. Reviews run against committed, isolated state, always.

Notice the pattern: none of these are *reasoning* failures. They're *coordination* failures — the exact
bugs distributed systems have had for decades, now wearing an LLM costume.

## What actually shipped

Measured straight from the repo:

- **6** packages, **12** agents, **29** skill playbooks, **12** architecture decision records, **6** CI
  workflows.
- **146** merged pull requests and **397** conformance fixtures.
- Merge throughput once the shared contracts were frozen: **12 → 45 → 56 → 26** PRs a day.
- A tagged, minimally conformant **`v0.1.0`** — Core language + turtle graphics that really draws — with
  Educational, Data, and Geometry profiles now building *in parallel* on top.

The burst is the tell. It only happened *after* the team froze four cross-cutting contracts — the syntax
tree, the event stream, the error codes, and the highlighter's token classes — up front. Agree the seams
first, and a dozen agents can build behind them at once without colliding.

## The takeaway for anyone building with agent fleets

The seductive idea is that a smarter model is all you need. OpenLogo's lesson is the opposite: **the
model was the easy part.** The leverage came from *structure* —

- a **human-owned contract** so "good code" becomes "implements the spec,"
- an **org chart** of specialist agents with real playbooks, not thin personas,
- a **hard definition of done** and an **independent review gate** so speed never costs correctness,
- and treating **shared state as a distributed-systems problem**, because that's exactly what it is once
  your agents run in parallel.

Prompt engineering gets you a patch. *Coordination* engineering gets you a language that runs. If you're
assembling an agent fleet, spend your time on the contract, the gate, and the org chart — and respect the
seams between your autonomous processes, because that's where the bugs live.

OpenLogo is open source. Go read the `.github/agents/` folder and count the specialists — then see if you
can match each one to the part of the language it owns.

---

*Built by the OpenLogo agent fleet on GitHub Copilot. Numbers are a snapshot from a live repo and will
keep moving — which, honestly, is the point.*
