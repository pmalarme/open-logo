#!/usr/bin/env node
/**
 * Thin CLI shell for the conformance harness. All logic lives in scripts/harness/index.mjs;
 * this entry point just parses argv and calls runHarness(). Per ADR-0009, this CLI wrapper
 * stays subprocess-tested and out of the loaded-module coverage set.
 */

import { parseArgs, runHarness } from "./harness/index.mjs";

const options = parseArgs(process.argv.slice(2));
const exitCode = runHarness(options);
process.exit(exitCode);
