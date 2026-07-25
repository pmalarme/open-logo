---
name: github-project
description: >-
  How @product-owner creates and manipulates the OpenLogo GitHub Project (Projects v2), sagas, and
  issues with the gh CLI — fields, views, adding items, setting status/agent/profile, and linking
  native sub-issues. Use to stand up or update the backlog board. Pairs with sagas-epics-and-issues
  (concepts) and triage-and-label (labels).
created: 2026-07-17T00:00
updated: 2026-07-22T00:00
---

## Purpose

Operate the backlog: a single GitHub **Project** board plus **sagas → epics → issues** linked as
**native sub-issues**, reflecting the structure from `sagas-epics-and-issues`. This skill is the
concrete `gh` mechanics; it assumes `gh auth status` is green for `pmalarme/open-logo`.

GitHub **milestones are retired** — a saga is a normal issue (`type:saga`), not a milestone object.

## Create the sagas (profile-DAG sync points)

Sagas are **issues** created from [`saga.yml`](../../../ISSUE_TEMPLATE/saga.yml). Create the release
sagas (titles stable — mirror the DAG) plus the standing **Maintenance** saga, then link epics to them
as sub-issues:

```bash
# create a saga from its template (or use the app's issue tool / GitHub MCP), then label it
gh issue create --template saga.yml --title "[saga]: M2 Turtle & Rendering"
# titles to keep stable: M0 Foundation, M1 Core Language, M2 Turtle & Rendering, M3 Educational,
# M4 Data & Geometry, M5 Heritage · Sprites · Interaction & Events · Sound,
# M6 Modules · Localization · Tutor (AI), and the standing "Maintenance" saga.
```

## Native sub-issues

Hierarchy is expressed with **native GitHub sub-issues** (an epic is a sub-issue of its saga; a work
issue is a sub-issue of its epic). This is the sole source of truth for parentage — **no body
checklists, no milestone field**. Cloud agents can create these links.

```bash
# 1. Resolve the GraphQL node IDs of parent and child from their issue numbers:
gh api graphql -f query='
  query($owner:String!,$repo:String!,$n:Int!){
    repository(owner:$owner,name:$repo){ issue(number:$n){ id } }
  }' -f owner=pmalarme -f repo=open-logo -F n=<parent-number> --jq '.data.repository.issue.id'

# 2. Link child under parent:
gh api graphql -f query='
  mutation($p:ID!,$c:ID!){ addSubIssue(input:{issueId:$p, subIssueId:$c}){ issue{ number } } }' \
  -f p=<parent-node-id> -f c=<child-node-id>

# List a parent's children (progress bar data):
gh api graphql -f query='
  query($owner:String!,$repo:String!,$n:Int!){
    repository(owner:$owner,name:$repo){ issue(number:$n){
      subIssues(first:100){ nodes{ number title state } } } } }' \
  -f owner=pmalarme -f repo=open-logo -F n=<parent-number>
```

## Create the Project and its fields

```bash
gh project create --owner pmalarme --title "OpenLogo"
gh project list --owner pmalarme                       # note the project <number>
# Single-select fields mirroring our labels so the board can group/filter:
gh project field-create <number> --owner pmalarme --name "Agent"   --data-type SINGLE_SELECT \
  --single-select-options "orchestrator,product-owner,language-designer,interpreter,turtle-engine,learner-experience,geometry-teacher,ai-tutor,curriculum,testing,documentation,devops"
gh project field-create <number> --owner pmalarme --name "Profile" --data-type SINGLE_SELECT \
  --single-select-options "core,turtle-rendering,data,geometry,heritage,sprites,interaction,sound,modules,localization,educational,tutor-ai"
# Saga replaces the retired default Milestone grouping:
gh project field-create <number> --owner pmalarme --name "Saga" --data-type SINGLE_SELECT \
  --single-select-options "M0 Foundation,M1 Core Language,M2 Turtle & Rendering,M3 Educational,M4 Data & Geometry,M5 Heritage · Sprites · Interaction & Events · Sound,M6 Modules · Localization · Tutor (AI),Maintenance"
gh project field-list <number> --owner pmalarme        # Status exists by default
```

Board **views** (group by Saga; group by Agent) are created once in the Project UI — `gh` manages
items/fields, not saved views.

## Add issues to the board and set fields

```bash
gh project item-add <number> --owner pmalarme --url https://github.com/pmalarme/open-logo/issues/<n>
# find the item id, then set a field:
gh project item-list <number> --owner pmalarme --format json
gh project item-edit --id <itemId> --project-id <projectId> \
  --field-id <SagaFieldId> --single-select-option-id <optionId>
```

## Create issues

Create each issue **from a template** in [`.github/ISSUE_TEMPLATE/`](../../../ISSUE_TEMPLATE/) (the
app's issue-creation tool when available, else `gh issue create --template feature-slice.yml`). Issue
forms apply their **default labels**; then link its **sub-issue parent** + add to the project:

```bash
gh issue edit <n> --add-label "agent:interpreter"
gh issue edit <n> --add-project "OpenLogo"
# then link <n> under its epic via addSubIssue (see "Native sub-issues" above)
```

## Lazy saga branch creation

A saga's **`saga/*` branch is created only when the saga moves to `In Progress`**, not up front — see
`devops/branching-and-commits`. The **Maintenance** saga has **no branch** (its work merges straight
to main). Don't pre-create branches for planned-but-not-started release sagas.

## Tooling: `gh` vs the GitHub MCP

- **Issues (incl. sub-issue links)** — you can create/edit them with the **GitHub MCP** (or this app's
  issue-creation tool) instead of `gh issue`; that is often the smoother path for coding agents. Either
  way, create from a **template** so the default labels apply, then set the sub-issue parent + `agent:*`.
- **Projects v2 and labels** — use **`gh`**: MCP coverage of Projects v2 fields/items is thin, and
  `gh project` / `gh label` are the most complete. The commands above use `gh` for that reason.

## Epic Status must reflect its children

An epic's (and a saga's) board **Status** is a derived field — it must always agree with the Status of
its child **sub-issues**:

- **Any child `In Progress` or `Done` → the parent is `In Progress`.** Even one active or completed
  child is enough; don't wait for "most" children to move.
- **All children `Done` (and the gate passed) → the parent is `Done`.**
- **All children `Todo` (none started) → the parent stays `Todo`.**
- This applies **recursively**: a leaf slice moving to `In Progress` propagates up through its epic to
  its saga in the same pass.

Run this check **every time you touch the board** — triage, dispatch, or merge — not just as a one-off
sweep:

```bash
# 1. Find every type:epic AND type:saga issue and its children via native sub-issues.
gh issue list --label "type:epic" --state all --json number,title
gh issue list --label "type:saga" --state all --json number,title
gh api graphql -f query='query($owner:String!,$repo:String!,$n:Int!){repository(owner:$owner,name:$repo){issue(number:$n){subIssues(first:100){nodes{number state}}}}}' \
  -f owner=pmalarme -f repo=open-logo -F n=<parent-number>

# 2. For each parent, check its children's Status on the board.
gh project item-list 5 --owner pmalarme --limit 200 --format json > /tmp/proj.json
jq '.items[] | {number: .content.number, status, title}' /tmp/proj.json

# 3. Correct any parent whose Status doesn't match the rule above.
gh project item-edit --id <parentItemId> --project-id <projectId> \
  --field-id <StatusFieldId> --single-select-option-id <InProgressOptionId>
```

## Board hygiene — every issue must be on the board

Board membership is automated by GitHub's **built-in Project "Auto-add to project" workflow** (Project
#5 → **⋯ → Workflows → Auto-add to project**). Project #5 is **user-owned**, and fine-grained PATs
cannot access user-owned Projects (v2); rather than provision a broad-scoped **classic** PAT just to
run the `actions/add-to-project` action, we use the built-in workflow, which needs **no token at all**.

**Configuration (source of truth — the built-in workflow is NOT version-controlled, so it is recorded
here):**

- **Filter:** `is:issue,pr` — matches **every** new/updated issue and PR (label-agnostic; do **not**
  add a `label:` clause, which would silently skip unlabeled work). Add `is:open` only if you want to
  ignore items updated while closed.
- **Action:** *Add the item to the project* (Status defaults to `Todo` via the board's default column).

> **Activation status (as of this writing): NOT active.** The built-in "Auto-add to project" toggle
> is off, so newly-created issues/PRs do **not** land on the board automatically yet and need the
> manual fallback below. The maintainer enables it once (Project #5 → Workflows → Auto-add to project
> → set filter `is:issue,pr` → Save/enable). See ADR-0015 / issue #225.

Use this **manual fallback** if the automation is off or an issue was created before it was enabled:

```bash
gh project item-add 5 --owner pmalarme --url <issue-or-pr-url>
# find the new item id, then set Status = Todo:
gh project item-list 5 --owner pmalarme --format json | jq '.items[] | select(.content.url == "<issue-or-pr-url>")'
gh project item-edit --project-id PVT_kwHOAAp56M4BdsNb --id <item-id> \
  --field-id PVTSSF_lAHOAAp56M4BdsNbzhYL-ko --single-select-option-id f75ad846
```

Run a board-vs-`gh issue list --state open` diff periodically (or whenever drift is suspected) and
reconcile any missing items with the commands above.

## Critical rules

- The board **reflects** the saga/epic/issue model — don't invent a parallel taxonomy here.
- Sagas = profile-DAG points (`sagas-epics-and-issues`); keep titles stable (M0–M6 + Maintenance).
- Hierarchy is **native sub-issues** only — never milestones, never body checklists.
- Do **not** auto-assign issues to the Copilot cloud agent without explicit owner approval.
- **Epic/Saga Status always reflects its children** (see above) — check it on every board-touching pass.

## Checklist
- [ ] Release sagas + Maintenance saga exist as issues; Project created with Agent + Profile + Saga fields.
- [ ] Issues created from templates; sub-issue parent + labels + project set.
- [ ] Board groups by Saga/Agent; no cloud-agent assignment without go-ahead.
- [ ] Every `type:epic` / `type:saga` issue's Status matches the Status-reflects-children rule.
