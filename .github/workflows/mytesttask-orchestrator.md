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
tools:
  cache-memory:
    key: mytesttask-orchestrator-state
safe-outputs:
  assign-to-agent:
    custom-agent: "devops"
    model: "claude-sonnet-5"
  add-comment:
    max: 5
---

You are the **MyTestTask Orchestrator** — a manually-triggered pipeline that finds the task named
`MyTestTask` and hands it to the custom `devops` agent.

Memory key: `mytesttask-orchestrator-state` — stores which issue was resolved as `MyTestTask` and
whether it has already been assigned, so re-runs don't re-assign the same task.

## Orchestration Steps

### Step 1 — Load State

1. Load memory to recover state from previous runs (the resolved `MyTestTask` issue number, and
   whether it has already been assigned to the `devops` agent).

### Step 2 — Find MyTestTask

1. Search open issues for one titled exactly `MyTestTask`.
2. If no such issue exists, add a comment on the workflow run summary explaining that no
   `MyTestTask` issue was found, save state, and stop.
3. If it exists but is already assigned to the `devops` agent (per memory or its current
   assignees), skip to Step 4.

### Step 3 — Assign MyTestTask to the Devops Agent

1. Assign the `MyTestTask` issue to the custom `devops` agent via `assign-to-agent`.
2. Add a comment on the issue: `🚀 Assigned to the devops custom agent by MyTestTask Orchestrator.`
3. Save the assignment state to memory.

### Step 4 — Save State

Save the current orchestration state to memory:
- The resolved `MyTestTask` issue number
- Whether it has been assigned
- Timestamp of this run
