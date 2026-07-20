---
name: github-project
description: >-
  How @product-owner creates and manipulates the OpenLogo GitHub Project (Projects v2), milestones, and
  issues with the gh CLI — fields, views, adding items, setting status/agent/profile. Use to stand up
  or update the backlog board. Pairs with epics-and-milestones (concepts) and triage-and-label (labels).
created: 2026-07-17T00:00
updated: 2026-07-17T00:00
---

## Purpose

Operate the backlog: a single GitHub **Project** board plus **milestones** and **issues** that reflect
the epic/story/milestone structure from `epics-and-milestones`. This skill is the concrete `gh`
mechanics; it assumes `gh auth status` is green for `pmalarme/open-logo`.

## Create the milestones (profile-DAG sync points)

```bash
for m in \
  "M0 Foundation" "M1 Core Language" "M2 Turtle & Rendering" \
  "M3 Educational" "M4 Data & Geometry" \
  "M5 Heritage · Sprites · Interaction & Events · Sound" "M6 Modules · Localization · Tutor (AI)"; do
  gh api repos/pmalarme/open-logo/milestones -f title="$m" >/dev/null
done
gh api repos/pmalarme/open-logo/milestones --jq '.[].title'   # verify
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
gh project field-list <number> --owner pmalarme        # Status + Milestone exist by default
```

Board **views** (group by Milestone; group by Agent) are created once in the Project UI — `gh` manages
items/fields, not saved views.

## Add issues to the board and set fields

```bash
gh project item-add <number> --owner pmalarme --url https://github.com/pmalarme/open-logo/issues/<n>
# find the item id, then set a field:
gh project item-list <number> --owner pmalarme --format json
gh project item-edit --id <itemId> --project-id <projectId> \
  --field-id <AgentFieldId> --single-select-option-id <optionId>
```

## Create issues

Create each issue **from a template** in [`.github/ISSUE_TEMPLATE/`](../../../ISSUE_TEMPLATE/) (the
app's issue-creation tool when available, else `gh issue create --template feature-slice.yml`). Issue
forms apply their **default labels**; then attach milestone + project:

```bash
gh issue edit <n> --milestone "M2 Turtle & Rendering" --add-label "agent:interpreter"
gh issue edit <n> --add-project "OpenLogo"
```

## Tooling: `gh` vs the GitHub MCP

- **Issues** — you can create/edit them with the **GitHub MCP** (or this app's issue-creation tool)
  instead of `gh issue`; that is often the smoother path for coding agents. Either way, create from a
  **template** so the default labels apply, then set milestone + `agent:*` afterward.
- **Projects v2, milestones, and labels** — use **`gh`**: MCP coverage of Projects v2 fields/items is
  thin, and `gh project` / `gh api …/milestones` / `gh label` are the most complete. The commands
  below use `gh` for that reason.

## Epic Status must reflect its children

An epic's board **Status** is a derived field, not an independent one — it must always agree with the
Status of its child issues (child slices for a leaf epic, child sub-epics for a nesting epic like #43):

- **Any child `In Progress` or `Done` → the epic is `In Progress`.** Even one active or completed leaf
  is enough; don't wait for "most" children to move.
- **All children `Done` → the epic is `Done`.**
- **All children `Todo` (none started) → the epic stays `Todo`.**
- This applies **recursively** through nested epics: a leaf slice moving to `In Progress` propagates up
  through its immediate sub-epic to the top epic in the same pass.

Run this check **every time you touch the board** — triage, dispatch, or merge — not just as a one-off
sweep:

```bash
# 1. Find every type:epic issue and its children (child issues are listed in the epic body under
#    "Child slices" / a nested sub-epic list — read the body, GitHub sub-issues API is not used here).
gh issue list --label "type:epic" --state all --json number,title,body

# 2. For each epic, check its children's Status on the board.
gh project item-list 5 --owner pmalarme --limit 200 --format json > /tmp/proj.json
jq '.items[] | {number: .content.number, status, title}' /tmp/proj.json

# 3. Correct any epic whose Status doesn't match the rule above.
gh project item-edit --id <epicItemId> --project-id <projectId> \
  --field-id <StatusFieldId> --single-select-option-id <InProgressOptionId>
```

## Board hygiene — every issue must be on the board

`.github/workflows/add-to-project.yml` (owned by `@devops`) auto-adds every newly-opened issue and
PR to Project #5 as `Status = Todo`, once the maintainer has created the `ADD_TO_PROJECT_PAT`
secret (see the workflow's header comment). Use this **manual fallback** if the automation is ever
off, the secret is missing, or an issue was created before the workflow existed:

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

- The board **reflects** the epic/story/milestone model — don't invent a parallel taxonomy here.
- Milestones = profile-DAG points (`epics-and-milestones`); keep titles stable (M0–M6).
- Do **not** auto-assign issues to the Copilot cloud agent without explicit owner approval.
- **Epic Status always reflects its children** (see above) — check it on every board-touching pass.

## Checklist
- [ ] Milestones M0–M6 exist; Project created with Agent + Profile fields.
- [ ] Issues created from templates; milestone + labels + project set.
- [ ] Board groups by milestone/agent; no cloud-agent assignment without go-ahead.
- [ ] Every `type:epic` issue's Status matches the epic-Status-reflects-children rule.
