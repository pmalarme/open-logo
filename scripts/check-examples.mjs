#!/usr/bin/env node
/**
 * Thin CLI shell for the examples DoD gate. All logic lives in scripts/examples-gate.mjs; this
 * entry point just parses argv, runs the gate, prints its report, and exits non-zero on failure.
 * Per ADR-0009's pattern (mirroring scripts/conformance.mjs), this CLI wrapper stays
 * subprocess-tested and out of the loaded-module coverage set.
 */

import { parseArgs, runExamplesGate } from "./examples-gate.mjs";

const options = parseArgs(process.argv.slice(2));
const result = runExamplesGate(options);

for (const line of result.lines) {
  console.log(line);
}

process.exit(result.ok ? 0 : 1);
