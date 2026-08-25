#!/usr/bin/env node
/**
 * `npm run lint` — the single entry point for the lint Definition-of-Done gate (issue #978).
 *
 * ## Why this file exists rather than a shell chain
 *
 * The script used to be `biome lint . && node scripts/check-lint-scope.mjs`, and two review rounds
 * were spent trying to *assert* that string: first that it mentioned the gate at all (defeated by
 * flipping `&&` to `||`), then that it was a two-stage `&&` chain in the right order (defeated by
 * `biome lint . | node -e "…" && node scripts/check-lint-scope.mjs`, where a pipe masks Biome's
 * exit code while the text still parses as a valid conjunction).
 *
 * The lesson is that **a shell string has unbounded ways to discard an exit code, so parsing it can
 * never be complete.** So there is no shell string any more: `npm run lint` runs this one file,
 * which owns the sequencing in Node, and the test asserts the *behaviour* — a planted diagnostic
 * must make this exit non-zero — instead of the spelling.
 *
 * Two stages, both blocking:
 *   1. `biome lint .` — the diagnostics themselves, streamed to the terminal unchanged.
 *   2. the lint-scope gate — proof that step 1 actually looked at every source file git knows about.
 *
 * Step 2 runs even when step 1 found diagnostics, because "your code has a lint error" and "your
 * lint command is not looking at half the repository" are different problems and a developer should
 * not have to fix the first to discover the second.
 */

import { spawnSync } from "node:child_process";

import { resolveBiomeEntry, runLintScopeGate } from "./lint-scope-gate.mjs";

const biome = spawnSync(process.execPath, [resolveBiomeEntry(), "lint", "."], {
  stdio: "inherit",
});

const scope = runLintScopeGate();
for (const line of scope.lines) {
  console.log(line);
}

// No separate `spawnSync` error branch: `resolveBiomeEntry()` throws if Biome is not installed and
// `process.execPath` is always a valid executable, so the only reachable failure is a non-zero
// status — which this covers, including the `null` a signal produces.
process.exit(biome.status !== 0 || !scope.ok ? 1 : 0);
