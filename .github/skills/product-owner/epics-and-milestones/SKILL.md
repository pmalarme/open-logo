---
name: epics-and-milestones
description: >-
  How @product-owner structures OpenLogo work into epics, user stories, tasks, and milestones — and
  maps them onto the spec's profile DAG and 8 learner levels. Use when planning the backlog, defining
  a milestone, or deciding what an epic is. Pairs with github-project (ops) and triage-and-label.
created: 2026-07-17T00:00
updated: 2026-07-18T00:00
---

## Purpose

Give the factory a clear, spec-anchored hierarchy so parallel tracks know what they're building and
when it's "done." This skill defines the *vocabulary*; `github-project` is how you *operate* it.

## The hierarchy

- **Feature request** — an **inbound idea** ("I wish OpenLogo could…"), before triage. Anyone can file
  one; you accept it into an epic/story or decline with a reason. Label `type:feature-request`.
- **Epic** — a large capability, usually **one spec profile or a major feature** (e.g. "Core Language",
  "Turtle & Rendering", "Educational baseline", "Syntax checker"). An epic spans multiple slices and
  usually multiple agents. Label `type:epic`.
- **User story / feature slice** — one observable behavior delivered **end to end** (a vertical slice:
  semantics → runtime/events → render/UI → tests → teaching → docs). Has Given/When/Then acceptance
  criteria. Label `type:slice`. This is the unit agents pull.
- **Task / chore** — a smaller unit under a story (foundation, CI, docs, conformance fixture). Labels
  `type:foundation`/`type:conformance`/`type:docs`/`type:chore`.
- **Bug** — a defect with a reproduction; gains a regression fixture. Label `type:bug`.

## How the issue templates relate

Each [issue template](../../../ISSUE_TEMPLATE) maps to one rung, so the backlog reads top-down:

```text
feature-request        (inbound idea)
   └─ PO accepts → epic                         (one profile / major feature)
          └─ user story / feature slice         (vertical slice, Given/When/Then)
                 ├─ conformance-task            (stack-neutral fixtures)
                 ├─ foundation                  (toolchain / CI / monorepo)
                 └─ docs                         (reference / tutorial / examples)
   bug = a defect found against any of the above → regression fixture
```

A feature request is the only *pre-scheduled* type; everything below it is planned work with an owner
(`agent:*`), a kind (`type:*`), and a milestone. Foundation/conformance/docs tasks usually hang off a
story but can stand alone under an epic (e.g. M0 foundation before any story exists).

## Milestones = profile-DAG sync points

Milestones are **not** buckets of unrelated work; each is a point on the spec DAG where a **profile
set reaches conformance across all domains** (see [`docs/delivery.md`](../../../../docs/delivery.md)):

| Milestone | Profile(s) reached | Release |
|---|---|---|
| M0 Foundation | — (toolchain, CI, conformance harness, contracts) | internal |
| M1 Core Language | Core Language | `0.1.0-core` |
| M2 Turtle & Rendering | + Turtle & Rendering = **minimal conformance** | **`0.1.0`** |
| M3 Educational | + Educational | `0.2.0` |
| M4 Data & Geometry | + Data, + Geometry | `0.3.0` |
| M5 Heritage · Sprites · Interaction & Events · Sound | those four | `0.4.0` |
| M6 Modules · Localization · Tutor (AI) | those | `0.5.0` |

The **8 learner levels** (`spec/educational-model.md`) drive curriculum epics/stories; tag with
`level:*`. Levels are progression, **not** profiles — keep them distinct.

## Procedure

1. Turn a spec area into an **epic**; confirm its profile + DAG position.
2. Break the epic into **feature slices** with Given/When/Then ACs (`product-owner/write-a-user-story`).
3. Assign each item to the **milestone** whose profile it belongs to; note cross-item dependencies.
4. Open the milestone **contract-first** (AST/events/diagnostics/token-classes) before slices fan out.
5. Hand the structure to `github-project` to create it and **`triage-and-label`** to apply the full
   triage checklist (labels + milestone + board membership + title prefix).

## Checklist
- [ ] Epics map to profiles/major features; slices are one end-to-end behavior.
- [ ] Each item lands in the milestone matching its profile on the DAG.
- [ ] Levels used for curriculum, kept separate from profiles.
- [ ] Dependencies noted; contracts fixed before parallel work.
