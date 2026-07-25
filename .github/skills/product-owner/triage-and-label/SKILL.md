---
name: triage-and-label
description: >-
  How @product-owner (the "labeler") maintains and applies the OpenLogo issue label taxonomy —
  agent/type/profile/area/level — and keeps it in sync with .github/labels.yml. Use when triaging a new
  issue, creating labels, or relabeling. Pairs with github-project and sagas-epics-and-issues.
created: 2026-07-17T00:00
updated: 2026-07-18T00:00
---

## Purpose

Every issue must be findable and routable: which agent owns it, what kind of work it is, which profile
and (for curriculum) which level. You are the labeler — you keep the taxonomy consistent so parallel
tracks can pull their own work.

## The taxonomy (source of truth: [`.github/labels.yml`](../../../labels.yml))

- **`agent:*`** — one owner: `orchestrator`, `product-owner`, `language-designer`, `interpreter`,
  `turtle-engine`, `learner-experience`, `geometry-teacher`, `ai-tutor`, `curriculum`, `testing`,
  `documentation`, `devops`.
- **`type:*`** — `feature-request`, `saga`, `epic`, `spec`, `slice`, `bug`, `conformance`,
  `foundation`, `docs`, `chore`.
- **`profile:*`** — `core`, `turtle-rendering`, `data`, `geometry`, `heritage`, `sprites`,
  `interaction`, `sound`, `modules`, `localization`, `educational`, `tutor-ai`.
- **`area:*`** — `grammar`, `highlighter`, `checker`, `core`, `runtime`, `rendering`, `studio`, `edu`,
  `ci`, `docs` (the cross-cutting domain, orthogonal to the owning agent).
- **`level:*`** — `1`–`8` for curriculum items (progression, not a profile).

## Rules

- **Exactly one `agent:*` and one `type:*`** per issue; add `profile:*`/`area:*`/`level:*` as they apply.
- **Hierarchy ≠ label:** an issue's place in the DAG is its **native sub-issue parent** (epic → saga,
  work issue → epic), **not** a `profile:*` label (the label says which profile the work touches; the
  sub-issue link says where it lands). GitHub milestones are **no longer used** — sagas replace them.
- `type:saga` and `type:spec` are **maintainer-owned, non-delegable**; agents may draft/propose but
  only the maintainer creates/closes them.
- Issue **forms apply only their static `labels:` defaults** (`type:*`, sometimes `area:*`).
  **Dropdown/checkbox answers inside a form do _not_ become labels** — e.g. a "Profile" dropdown
  selection never creates `profile:*`. Triage reads those answers and adds `agent:*` + `profile:*`
  + `level:*` and the milestone by hand. Treat every new issue as needing a manual triage pass.
- Labels are data — keep `.github/labels.yml` the source of truth; don't hand-create ad-hoc labels.

## Procedure

### 1. Sync labels from the manifest

In CI this is automated by `@devops`'s `label-sync` workflow on any change to `.github/labels.yml`;
you just edit the manifest. To apply locally (idempotent):

```bash
# requires yq; iterate name/color/description from .github/labels.yml
yq -r '.[] | [.name,.color,.description] | @tsv' .github/labels.yml | while IFS=$'\t' read -r n c d; do
  gh label create "$n" --color "$c" --description "$d" 2>/dev/null \
    || gh label edit "$n" --color "$c" --description "$d"
done
```

### 2. Triage a new issue — the full checklist

**Every** newly-created or triaged issue goes through this **ordered checklist**, whether created from
a template or not:

#### (a) Labels

Confirm or add the required labels:

- **Exactly one `agent:*`** — the owning agent from `.github/labels.yml` (e.g. `agent:interpreter`,
  `agent:product-owner`, `agent:testing`).
- **Exactly one `type:*`** — the kind of work (e.g. `type:slice`, `type:bug`, `type:chore`). Issue
  templates apply this automatically; non-template creation (e.g. `create_issue`, GitHub MCP,
  `gh issue create`) must add it by hand.
- Add applicable **`profile:*`**, **`area:*`**, and **`level:*`** labels as the work touches them.

```bash
gh issue edit <n> --add-label "agent:interpreter,profile:core,area:runtime"
```

#### (b) Sub-issue link (replaces the milestone field)

Attach the issue to its **parent in the hierarchy** as a **native GitHub sub-issue** — this is what
places the work on the profile DAG (milestones are retired). An **epic** becomes a sub-issue of its
**saga**; a **work issue** (slice/bug/spec/task) becomes a sub-issue of its **epic** (or, when no epic
fits, directly under a saga). See [`github-project`](../github-project/SKILL.md#native-sub-issues) for
the `addSubIssue` GraphQL mechanics:

```bash
# link child issue <child#> under parent issue <parent#> (numeric database IDs, see github-project)
gh api graphql -f query='mutation($p:ID!,$c:ID!){addSubIssue(input:{issueId:$p,subIssueId:$c}){issue{number}}}' \
  -f p=<parent-node-id> -f c=<child-node-id>
```

#### (c) Board membership (required manual step)

Add the issue to the **OpenLogo Project board** and set its **Status** (default `Todo`) and **Agent**
fields. This is **not automatic** — the `create_issue` tool, the GitHub MCP, and `gh issue create`
do **not** add issues to the board. See [`github-project`](../github-project/SKILL.md) for the
`gh project item-add` / `item-edit` mechanics:

```bash
gh project item-add 5 --owner pmalarme --url https://github.com/pmalarme/open-logo/issues/<n>
# Then set the Status and Agent fields via item-edit (see github-project for field IDs)
```

#### (d) Title prefix

Issue titles use a bracketed **`[<type>]:`** prefix that mirrors the `type:*` label. Issue templates
apply this automatically; **non-template creation must add the prefix by hand**. The mapping:

| Type label | Title prefix | Template |
|---|---|---|
| `type:saga` | `[saga]:` | saga.yml |
| `type:epic` | `[epic]:` | epic.yml |
| `type:spec` | `[spec]:` | spec.yml |
| `type:bug` | `[bug]:` | bug.yml |
| `type:conformance` | `[conformance]:` | conformance-task.yml |
| `type:docs` | `[docs]:` | docs.yml |
| `type:feature-request` | `[request]:` | feature-request.yml |
| `type:slice` | `[slice]:` | feature-slice.yml |
| `type:foundation` | `[foundation]:` | foundation.yml |
| `type:chore` | `[chore]:` | _(none — derived)_ |

Note the two non-identity cases: **`type:feature-request` → `[request]:`** (not `[feature-request]:`)
and the template-less **`type:chore` → `[chore]:`**.

### 3. Audit periodically

List issues missing an `agent:*` or `type:*` and fix them:

```bash
gh issue list --search 'no:label' --json number,title
```

### 4. Audit epic and saga Status on every pass

**Every triage/dispatch/merge pass, check every `type:epic` and `type:saga` issue's board Status
against its children:** any child (sub-issue) that is `In Progress` or `Done` means the parent must be
`In Progress` too; `Done` only once **every** child is `Done` **and** the parent has passed its gate
(Epic Gate / Saga Gate — see `shared/epic-gate` and `shared/definition-of-done`). This is not a
one-off cleanup — parent Status drifts constantly as children move, so re-check it every time you
touch the board. Full mechanics (finding children via sub-issues, board field IDs) are in
[`github-project`](../github-project/SKILL.md#epic-status-must-reflect-its-children).

## Checklist
- [ ] `.github/labels.yml` is the single source; labels synced from it.
- [ ] Every issue has exactly one `agent:*` + one `type:*`; extras added as applicable.
- [ ] Hierarchy set via a **native sub-issue** link (epic→saga, work→epic), not a milestone/profile label.
- [ ] Issue added to the Project board with Status (default `Todo`) and Agent fields set.
- [ ] Title prefix `[<type>]:` matches the `type:*` label (applied automatically by templates;
      manual for non-template creation).
- [ ] No ad-hoc labels outside the manifest.
- [ ] Every `type:epic` / `type:saga` issue's Status reflects its children (any child In Progress/Done
      → parent In Progress; all Done + gate passed → parent Done).
