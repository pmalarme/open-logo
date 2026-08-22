#!/usr/bin/env node
/**
 * Thin CLI shell for the markdown fenced-block half of the examples DoD gate (issue #850). All
 * logic lives in scripts/markdown-examples-gate.mjs; this entry point just parses argv, runs the
 * gate, prints its report, and exits non-zero on failure. Per ADR-0009's pattern (mirroring
 * scripts/check-examples.mjs), this CLI wrapper stays subprocess-tested and out of the
 * loaded-module coverage set.
 */

import {
  parseArgs,
  runMarkdownExamplesGate,
} from "./markdown-examples-gate.mjs";

const options = parseArgs(process.argv.slice(2));
const result = runMarkdownExamplesGate(options);

for (const line of result.lines) {
  console.log(line);
}

process.exit(result.ok ? 0 : 1);
