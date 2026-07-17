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

## Critical rules

- The board **reflects** the epic/story/milestone model — don't invent a parallel taxonomy here.
- Milestones = profile-DAG points (`epics-and-milestones`); keep titles stable (M0–M6).
- Do **not** auto-assign issues to the Copilot cloud agent without explicit owner approval.

## Checklist
- [ ] Milestones M0–M6 exist; Project created with Agent + Profile fields.
- [ ] Issues created from templates; milestone + labels + project set.
- [ ] Board groups by milestone/agent; no cloud-agent assignment without go-ahead.
