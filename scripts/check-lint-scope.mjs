#!/usr/bin/env node
/**
 * Thin CLI shell for the lint-scope gate (issue #978). All logic lives in
 * scripts/lint-scope-gate.mjs; this entry point just runs the gate, prints its report, and exits
 * non-zero on failure. Per ADR-0009's pattern (mirroring scripts/check-built-in-names.mjs), this
 * CLI wrapper stays subprocess-tested and out of the loaded-module coverage set.
 */

import { runLintScopeGate } from "./lint-scope-gate.mjs";

const result = runLintScopeGate();

for (const line of result.lines) {
  console.log(line);
}

process.exit(result.ok ? 0 : 1);
