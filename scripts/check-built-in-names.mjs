#!/usr/bin/env node
/**
 * Thin CLI shell for the built-in-names Definition-of-Done gate (issue #841). All logic lives in
 * scripts/built-in-names-gate.mjs; this entry point just parses argv, runs the gate, prints its
 * report, and exits non-zero on failure. Per ADR-0009's pattern (mirroring
 * scripts/check-examples.mjs and scripts/check-markdown-examples.mjs), this CLI wrapper stays
 * subprocess-tested and out of the loaded-module coverage set.
 */

import {
  currentRowFingerprint,
  parseArgs,
  runBuiltInNamesGate,
} from "./built-in-names-gate.mjs";

const options = parseArgs(process.argv.slice(2));

if (options.printFingerprint) {
  // A separate, deliberate act — not a value the failure diagnostic hands out. See
  // rowFingerprintFindings: a hash gate whose failure mode is "paste in the new hash" certifies
  // nothing, so obtaining the digest is something you do AFTER re-deriving the class, on purpose.
  console.log(currentRowFingerprint(options));
  process.exit(0);
}

const result = runBuiltInNamesGate(options);

for (const line of result.lines) {
  console.log(line);
}

process.exit(result.ok ? 0 : 1);
