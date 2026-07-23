# 14. Deterministic coverage gate (retry the cross-process V8 merge artifact)

- Status: Accepted
- Date: 2026-07-23
- Deciders: OpenLogo maintainer (@pmalarme) + devops + testing
- Related: [ADR-0005](0005-toolchain.md) (`node:test` + `--experimental-test-coverage`, Node 22 pin);
  [ADR-0009](0009-test-layout.md) (co-located `.test.mjs`, loaded-module coverage policy);
  [`testing/ci-and-conformance`](../../.github/skills/testing/ci-and-conformance/SKILL.md);
  issue #417 (+ duplicate #439); PR #41 (original 100% gate + `npm run coverage`)

## Context

The Definition of Done requires 100% line/branch/function coverage, enforced by `npm run coverage`
running `node --test --experimental-test-coverage --test-coverage-{lines,branches,functions}=100`
on Node 22 (see [ADR-0005](0005-toolchain.md)). Issue #417 reported that this gate **intermittently
fails on an unchanging, fully-covered tree**: roughly one run in six exits 1 with the aggregate a
hundredth of a percent short (e.g. `100.00 line / 99.99 branch / 100.00 func`), while the next run is
a clean 100%.

### Root cause — a stochastic cross-process V8 block-coverage merge artifact

`node --test` runs test files in **parallel worker/child processes** and merges each process's V8
block-coverage ranges into one report. V8 emits block-coverage ranges whose boundaries depend on
whether a function is still interpreted or has been JIT tier-optimised. For a **hot, recursive**
function this is non-deterministic across runs. In this repository the locus is `printedForm`, the
recursive value formatter in `@openlogo/runtime` (`packages/runtime/src/evaluate.ts`, dist
`evaluate.js`): under load its optimisation state varies, so the per-process range trees differ, and
**merging inconsistent trees occasionally leaves one or two source lines unattributed**. That single
file then reports e.g. `99.94 line / 99.90 branch` with a line or two listed as "uncovered", which
drags the whole-repo aggregate to 99.99% and trips the gate. The code is genuinely fully covered;
re-running clears it. Notably, the dip can surface **on an individual file row**, not only on the
aggregate, and its **magnitude is not bounded** — usually it is a hundredth of a percent, but under
load it can transiently leave a whole file several points below 100% while the aggregate stays high
(observed live: file rows dipping with the aggregate holding at 99.87–99.92). So a single report
snapshot cannot be distinguished from a real gap by its shape or magnitude — only by stochasticity.

### Alternatives considered and rejected

- **`--test-concurrency=1`** — reduces the frequency but does **not** eliminate it (isolated child
  processes still merge across sequential runs; a dip was still observed), and it roughly doubles
  wall-clock time. Rejected.
- **`--test-isolation=none`** — avoids the cross-process merge, but runs all tests in one process so
  per-file module initialisation executes only once. That genuinely **changes which branches run**,
  lowering the true measured surface (~99.96/99.86) — a semantic change, not a drop-in. Rejected.
- **`--no-opt` / `NODE_OPTIONS`** — disabling the JIT crashed the test workers / was rejected with a
  fatal exit. Rejected.
- **Lowering the threshold below 100%** — abandons the DoD guarantee and would mask real gaps.
  Rejected.
- **Editing `evaluate.ts`** — the flake is a measurement artifact, not a code defect; the source is
  `@interpreter`-owned and explicitly out of scope for this `@devops` toolchain fix. Rejected.

## Decision

`npm run coverage` runs through a **thin deterministic wrapper** instead of invoking `node --test`
directly:

- **`scripts/coverage-gate/classify.mjs`** — a pure, fully unit-tested logic module. It parses the
  coverage-report table and classifies a finished run as `PASS`, `RETRY`, or `FAIL`.
- **`scripts/coverage.mjs`** — a thin CLI shell that spawns the same coverage command (teeing output
  to the terminal), asks the classifier for the outcome, and retries `RETRY` outcomes up to
  `MAX_ATTEMPTS` (default 5, override via `OL_COVERAGE_MAX_ATTEMPTS`; a malformed override falls back
  to the default rather than silently disabling the gate). It explicitly selects the **TAP reporter**
  (`--test-reporter=tap --test-reporter-destination=stdout`): the classifier keys on TAP's
  `# `-prefixed report table, and `node --test`'s *default* reporter is TTY-dependent (`tap` when
  piped, `spec` when interactive) and has drifted across Node majors, so pinning it makes the parse
  robust regardless of Node version or whether stdout is a terminal. Following ADR-0009's
  loaded-module policy, this untested shell runs in a parent process **without**
  `--experimental-test-coverage`, so it is not itself part of the measured surface. Each retry logs
  the specific file(s)/aggregate that fell short, so a shortfall outside the expected `evaluate.js`
  locus is visible and investigable rather than silently smoothed.

The `package.json` `coverage` script becomes `node scripts/coverage.mjs`; the `precoverage` build
hook and the coverage **thresholds** (`--test-coverage-{lines,branches,functions}=100`) and Node 22
semantics are unchanged — the wrapper only adds an explicit `--test-reporter=tap` (see above) around
the same measurement. So **CI, the DoD checklist, and every doc/skill that says `npm run coverage` keep working verbatim**.

### Classification rules (never mask a real regression)

On a non-zero exit the classifier decides:

- **Fail fast** (never retried) only when a re-run cannot legitimately change the result: any reported
  **test failure** (`# fail > 0`), an **unreadable/absent** coverage report (no aggregate to reason
  about), or a non-zero exit whose report nonetheless shows a **fully-100 aggregate** (anomalous —
  looping would not change it).
- **Retry** (bounded) **every other** coverage shortfall — any non-test-failure exit where the report
  shows less than 100% — regardless of its magnitude or whether it lands on the aggregate or a single
  file row.

An earlier iteration additionally failed fast on *magnitude* (an aggregate below a floor, or any file
below a per-file floor). That was rejected: because the artifact is **not magnitude-bounded** (it can
transiently drop a whole file several points), those floors mis-classified the artifact itself as a
real gap and failed on the first attempt — the exact residual flake `@testing` caught (runs at
`99.87–99.92` exiting 1 with the retry never engaging). Magnitude is therefore deliberately **not** a
discriminator.

The safety argument rests entirely on **determinism, not magnitude**: a genuine coverage gap is
deterministic — it reproduces on every attempt, so it survives all `MAX_ATTEMPTS` retries and the
wrapper still exits non-zero. Only the **stochastic** artifact — which clears on a re-run — is
smoothed away. The retry therefore makes the gate deterministic **without** ever passing
genuinely-uncovered code; the only cost is that a real gap fails after up to N× the runtime (an
acceptable, rare event) rather than immediately. `MAX_ATTEMPTS` defaults to 5 so that even a brief
*burst* of consecutive dips clears well within the budget.

## Consequences

- **The 100% gate is deterministic.** Validation on Node 22.14.0: 50 consecutive `npm run coverage`
  runs all exited 0, including one run that hit a live dip, retried once, and recovered — proving the
  retry path fires on the real artifact end to end. An earlier magnitude-gated iteration still failed
  ~1.5% of runs (a dip larger than its floor was mis-classified as a real gap and failed on the first
  attempt); removing the magnitude discriminator eliminated that residual flake.
- **Real regressions still fail.** Test failures fail fast; every genuine coverage gap is
  deterministic and fails after the retries are exhausted (magnitude is irrelevant — a large real gap
  reproduces on every attempt just as a small one does). Coverage of `classify.mjs` is itself held at
  100% by `scripts/coverage-gate/classify.test.mjs`.
- **The contract surface is unchanged.** The `npm run coverage` name, the spawned `node --test`
  flags, the Node 22 pin, and the loaded-module policy all stay as-is; only an orchestration layer is
  added around them.
- **Tunable and observable.** Retry count is overridable via `OL_COVERAGE_MAX_ATTEMPTS`; each retry
  and any final give-up prints an explicit `[coverage]` notice so a persistent shortfall is
  investigated, not silently swallowed.
- **If the artifact ever disappears** (a future Node fixes the merge), the wrapper is a no-op on the
  happy path (first attempt passes) and can be retired by pointing `coverage` back at the raw command.
