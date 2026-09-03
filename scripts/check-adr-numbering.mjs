#!/usr/bin/env node
/**
 * Thin CLI shell for the ADR-numbering Definition-of-Done gate (issue #1042). All logic lives in
 * scripts/adr-numbering-gate.mjs; this entry point just parses argv, runs the gate, prints its
 * report, and exits non-zero on failure. Per ADR-0009's pattern (mirroring
 * scripts/check-spec-citations.mjs), this CLI wrapper stays subprocess-tested and out of the
 * loaded-module coverage set.
 */

import { parseArgs, runAdrNumberingGate } from "./adr-numbering-gate.mjs";

const options = parseArgs(process.argv.slice(2));
const result = runAdrNumberingGate(options);

for (const line of result.lines) {
  console.log(line);
}

process.exit(result.ok ? 0 : 1);
