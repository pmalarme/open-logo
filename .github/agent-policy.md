# OpenLogo — agent policy

The rules Copilot cloud agents get wrong most often. Read this **before your first commit**; each
item links to the SKILL that owns it. This file is a **briefing, not a gate** — CI is the gate. How
the layers fit together: [`devops/agent-policy`](skills/devops/agent-policy/SKILL.md).

## Branch and PR targeting

- Cut `feature/<issue>-<slug>` (or `fix/*` for a bug) **from the parent saga's `saga/*` branch**, and
  **target that same branch** — not `main`. Only **Maintenance-saga** work targets `main`.
- A cloud agent **cannot retarget a PR's base** after opening it. Get the base right the first time;
  if it is wrong, ask the maintainer to change it and say so on the PR.
- → [`devops/branching-and-commits`](skills/devops/branching-and-commits/SKILL.md)

## Commits and PR titles

- `type(scope): subject`. **Scope is optional**; when present, up to **three** comma-separated
  scopes from the allowlist (`feat(grammar,runtime): …`).
- The **PR title is the blocking check** — it becomes the squash-merge subject. Individual commit
  subjects are **advisory**, because the platform's bootstrap commit is unfixable by you.
- → [`devops/branching-and-commits`](skills/devops/branching-and-commits/SKILL.md)

## Write-set boundaries

- **Never edit `spec/`** — maintainer-owned and CODEOWNERS-gated. Raise an issue for
  `@product-owner` instead.
- **Never edit another agent's `.github/agents/*.agent.md`**, and never reach into another package's
  internals — depend on its public API (`src/index.ts`).
- Declare your write-set up front and stay inside it. Boy Scout fixes are welcome **within** it;
  unrelated refactors are not.
- → [team working agreement](instructions/openlogo-team.instructions.md) §4, §11

## Review and merge

- **Never self-merge.** Two non-author review verdicts are required (logic/spec reviewer + every
  domain QA expert), each stamped with the current PR HEAD.
- **Never merge `[spec]` or `[saga]` PRs** — maintainer-only and non-delegable.
- → [`shared/review-gate`](skills/shared/review-gate/SKILL.md),
  [`orchestrator/integrate-and-merge`](skills/orchestrator/integrate-and-merge/SKILL.md)

## Definition of Done — run all nine from a clean tree

```bash
npm ci && npm run build && npm run typecheck && npm run lint && npm run format:check \
  && npm run test && npm run coverage && npm run conformance && npm run examples \
  && npm run built-in-names
```

→ [`shared/definition-of-done`](skills/shared/definition-of-done/SKILL.md)

- **Adding or removing a primitive is a two-file change** — the registry **and**
  `spec/built-in-names.json` — and `npm run built-in-names` is red until both land. A **keyword**
  edits more: those two, plus `spec/grammar.md`'s normative block and `spec/tooling.md`'s C19 mirror
  (which that gate compares), plus each name's `tokenClass` in `spec/built-in-names.json` (which
  that gate re-paints through the shipped `highlight()` and compares; the reverse direction covers
  the name sources it reads, not arbitrary output, issue
  #959), plus
  `keywords.profiles.test.mjs`'s `EXPECTED_CORE_KEYWORDS`, which `npm run test` asserts rather than
  `npm run built-in-names`. `packages/parser/src/keywords.ts` carries the list and names the gate
  covering each. See [ADR-0021](../docs/adr/0021-built-in-names-list-and-ci-gate.md).

## Known traps

- **Run `npm run coverage` on Node 22** (the version in `.nvmrc`, the version CI pins). Node 24+
  silently excludes `*.test.mjs` from coverage and reports a false green that CI then fails.
- **`CLI shell runs via subprocess` is flaky** in the coverage job while the parallel test job
  passes — re-run it rather than "fixing" a non-regression.
- **Format generated artifacts before pushing.** Anything a scaffolding tool emits (for example the
  `gh aw init` output) still has to pass `npm run format:check`.
- **You cannot set Projects v2 fields** (board Status/Agent) from a cloud agent sandbox — say so and
  leave it to the orchestrator or maintainer.
