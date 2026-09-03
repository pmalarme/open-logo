#!/usr/bin/env node
/**
 * Thin CLI shell for the spec-citation Definition-of-Done gate (issue #934). All logic lives in
 * scripts/spec-citations-gate.mjs; this entry point just parses argv, runs the gate, prints its
 * report, and exits non-zero on failure. Per ADR-0009's pattern (mirroring
 * scripts/check-markdown-examples.mjs), this CLI wrapper stays subprocess-tested and out of the
 * loaded-module coverage set.
 */

import { parseArgs, runSpecCitationsGate } from "./spec-citations-gate.mjs";

const options = parseArgs(process.argv.slice(2));
const result = runSpecCitationsGate(options);

for (const line of result.lines) {
  console.log(line);
}

process.exit(result.ok ? 0 : 1);
