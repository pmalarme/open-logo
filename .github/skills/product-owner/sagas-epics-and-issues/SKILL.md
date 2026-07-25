---
name: sagas-epics-and-issues
description: >-
  How @product-owner structures OpenLogo work into sagas, epics, and issues (slices, bugs, specs,
  tasks) using native GitHub sub-issues — and maps them onto the spec's profile DAG and 8 learner
  levels. Use when planning the backlog, defining a saga or epic, or deciding what an epic is. Pairs
  with github-project (ops) and triage-and-label.
created: 2026-07-17T00:00
updated: 2026-07-22T00:00
---

## Purpose

Give the factory a clear, spec-anchored hierarchy so parallel tracks know what they're building and
when it's "done." This skill defines the *vocabulary*; `github-project` is how you *operate* it.

## The hierarchy (saga → epic → issue)

Hierarchy is expressed with **native GitHub sub-issues**, not body checklists. Each level is a real
issue; parents show a live sub-issue progress bar.

- **Saga** — the **top-level release / planning container**, a point on the spec DAG where a **profile
  set reaches conformance across all domains**. Sagas **replace GitHub milestones** so agents can
  create and govern them as ordinary issues. Its children are **epics** (native sub-issues). Label
  `type:saga`. **Maintainer-owned, non-delegable.**
- **Epic** — a large capability, usually **one spec profile or a major feature** (e.g. "Core Language",
  "Turtle & Rendering", "Educational baseline"). An epic is a **sub-issue of a saga** and has **no
  branch** of its own; it spans multiple work issues and agents. Label `type:epic`.
- **Work issues** — **sub-issues of an epic**, each an atomic unit an agent pulls:
  - **User story / feature slice** — one observable behavior delivered **end to end** (semantics →
    runtime/events → render/UI → tests → teaching → docs), with Given/When/Then ACs. Label `type:slice`.
  - **Bug** — a defect with a reproduction; gains a regression fixture. Label `type:bug`.
  - **Spec / design decision** — a language/architecture decision or **any `spec/` change**. Label
    `type:spec`. **Maintainer-owned, non-delegable.**
  - **Task** — foundation, CI, docs, or conformance fixture. Labels
    `type:foundation`/`type:conformance`/`type:docs`/`type:chore`.
- **Feature request** — an **inbound idea** ("I wish OpenLogo could…"), before triage. Anyone can file
  one; you accept it (→ an epic under a saga) or decline with a reason. Label `type:feature-request`.

## Parenting rules

- Every **epic** must be a sub-issue of a **saga** (use the standing **Maintenance** saga for
  continuous/cross-cutting work that isn't tied to a release saga).
- Every **work issue** should be a sub-issue of an **epic** (small foundation/chore work may hang
  directly under a saga when no epic fits).
- **Externally creatable** types are only `feature-request` and `bug`; triage attaches them into the
  hierarchy. A feature-request may point at a saga; a bug at an epic — orphans are tolerated until triage.

## How the issue templates relate

Each [issue template](../../../ISSUE_TEMPLATE) maps to one rung, so the backlog reads top-down:

```text
saga                                             (release / planning container — replaces milestones)
   └─ epic                                        (one profile / major feature; no branch)
          ├─ user story / feature slice          (vertical slice, Given/When/Then)
          ├─ bug                                  (defect + regression fixture)
          ├─ spec / design decision              (maintainer-owned; any spec/ change)
          ├─ conformance-task                    (stack-neutral fixtures)
          ├─ foundation                          (toolchain / CI / monorepo)
          └─ docs                                 (reference / tutorial / examples)
feature-request = inbound idea → PO accepts into an epic under a saga
```

## Sagas = profile-DAG sync points

Sagas are **not** buckets of unrelated work; each is a point on the spec DAG where a **profile set
reaches conformance across all domains** (see [`docs/delivery.md`](../../../../docs/delivery.md)):

| Saga | Profile(s) reached | Release |
|---|---|---|
| M0 Foundation | — (toolchain, CI, conformance harness, contracts) | internal |
| M1 Core Language | Core Language | `0.1.0-core` |
| M2 Turtle & Rendering | + Turtle & Rendering = **minimal conformance** | **`0.1.0`** |
| M3 Educational | + Educational | `0.2.0` |
| M4 Data & Geometry | + Data, + Geometry | `0.3.0` |
| M5 Heritage · Sprites · Interaction & Events · Sound | those four | `0.4.0` |
| M6 Modules · Localization · Tutor (AI) | those | `0.5.0` |
| **Maintenance** | — (continuous: infra, docs, refactors, non-release bugs) | none (→ main) |

The **8 learner levels** (`spec/educational-model.md`) drive curriculum epics/stories; tag with
`level:*`. Levels are progression, **not** profiles — keep them distinct.

## Procedure

1. Turn a spec area into an **epic**; confirm its profile + DAG position, and its **parent saga**.
2. Break the epic into **work issues** (slices with Given/When/Then ACs; `product-owner/write-a-user-story`).
3. Link hierarchy with **native sub-issues** (epic → its saga; each work issue → its epic) — no body
   checklists. `github-project` performs the linking.
4. Open the saga **contract-first** (AST/events/diagnostics/token-classes) before work fans out.
5. Hand the structure to `github-project` to create it and **`triage-and-label`** to apply the full
   triage checklist (labels + sub-issue link + board membership + title prefix).

## Checklist
- [ ] Epics map to profiles/major features; work issues are one atomic unit.
- [ ] Every epic is a sub-issue of a saga; every work issue is a sub-issue of an epic.
- [ ] Each item's saga matches its profile on the DAG (or the Maintenance saga).
- [ ] Levels used for curriculum, kept separate from profiles.
- [ ] Dependencies noted; contracts fixed before parallel work.
