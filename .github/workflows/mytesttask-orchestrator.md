---
name: MyTestTask Orchestrator
on:
  workflow_dispatch:
concurrency:
  group: mytesttask-orchestrator
  cancel-in-progress: false
permissions:
  contents: read
  issues: read
  pull-requests: read
  actions: read
  copilot-requests: write
safe-outputs:
  assign-to-agent:
    custom-agent: "devops"
    model: "claude-sonnet-5"
  add-comment:
    max: 5
---

You are the **MyTestTask Orchestrator** — a manually-triggered pipeline that finds the task named
`MyTestTask` and hands it to the custom `devops` agent.

This workflow is stateless: each run re-derives whether `MyTestTask` has already been assigned by
checking the issue's current assignees directly, so re-runs don't re-assign the same task.

## Orchestration Steps

### Step 1 — Find MyTestTask

1. Search open issues for one titled exactly `MyTestTask`.
2. If no such issue exists, add a comment on the workflow run summary explaining that no
   `MyTestTask` issue was found, and stop.
3. If it exists but is already assigned to the `devops` agent (per its current assignees), stop —
   there is nothing left to do.

### Step 2 — Assign MyTestTask to the Devops Agent

1. Assign the `MyTestTask` issue to the custom `devops` agent via `assign-to-agent`.
2. Add a comment on the issue: `🚀 Assigned to the devops custom agent by MyTestTask Orchestrator.`
