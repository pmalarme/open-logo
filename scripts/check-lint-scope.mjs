#!/usr/bin/env node
/**
 * Thin CLI shell for the lint-scope gate (issue #978). All logic lives in
 * scripts/lint-scope-gate.mjs; this entry point just runs the gate, prints its report, and exits
 * non-zero on failure.
 *
 * Its one line of real behaviour is the exit code, and that line **is** exercised:
 * `lint-scope-gate.test.mjs` spawns this file as a subprocess against throwaway git repositories
 * and asserts both exits. Review found the first version had no such test — mutating the exit to a
 * constant `0` left the whole suite green while `npm run lint` passed on a tree with 200 unlinted
 * files. A gate's kill switch is exactly the line that must not be taken on trust.
 *
 * Unlike its sibling gate CLIs, this file makes no claim to sit outside the coverage set: Node 22
 * merges child-process coverage, so the subprocess test puts it in the report at 100%. Measured,
 * not assumed — the claim it used to carry was false in both halves.
 */

import { runLintScopeGate } from "./lint-scope-gate.mjs";

const result = runLintScopeGate();

for (const line of result.lines) {
  console.log(line);
}

process.exit(result.ok ? 0 : 1);
