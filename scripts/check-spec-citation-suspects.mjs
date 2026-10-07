#!/usr/bin/env node
/**
 * Thin CLI shell for the wrong-anchor suspect scanner (saga #1180). All logic lives in
 * scripts/spec-citation-suspects.mjs; this entry point parses argv, runs the scan, prints the
 * report, and exits non-zero ONLY when the tool's own self-check or a corpus invariant fails —
 * never on a finding. Per ADR-0009's pattern it stays subprocess-tested and out of the
 * loaded-module coverage set.
 *
 * The ranked rows are a queue for a human to read. Resolving one means reading the claim and the
 * cited section and deciding; a row found correct is closed as correct. Nothing here is re-pointed
 * because the tool ranked it.
 */

import { parseArgs } from "./spec-citations-gate.mjs";
import { reportSuspects } from "./spec-citation-suspects.mjs";

const result = reportSuspects(parseArgs(process.argv.slice(2)));

for (const line of result.lines) {
  console.log(line);
}

process.exit(result.ok ? 0 : 1);
