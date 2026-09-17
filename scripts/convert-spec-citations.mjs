#!/usr/bin/env node
/**
 * Thin CLI shell for the spec-citation converter (saga #1180). All logic lives in
 * scripts/spec-citation-converter.mjs; this entry point parses argv, runs the conversion, prints
 * what it did, and exits non-zero when any site could not be converted. Per ADR-0009's pattern it
 * stays subprocess-tested and out of the loaded-module coverage set.
 *
 * Defaults to a DRY RUN. Pass --write to rewrite the tree.
 */

import { convertTree } from "./spec-citation-converter.mjs";

const argv = process.argv.slice(2);
const roots = argv
  .filter((arg) => arg.startsWith("--root="))
  .map((arg) => arg.slice("--root=".length));
const specDirectory = argv
  .find((arg) => arg.startsWith("--spec-dir="))
  ?.slice("--spec-dir=".length);
const specRoot = argv
  .find((arg) => arg.startsWith("--spec-root="))
  ?.slice("--spec-root=".length);
const write = argv.includes("--write");

const report = convertTree({
  roots: roots.length > 0 ? roots : undefined,
  specDirectory,
  specRoot,
  write,
});

console.log(
  `${write ? "converted" : "would convert"}: ${report.sites} line-form site(s) into ` +
    `${report.anchors} anchor citation(s) across ${report.filesChanged} of ${report.filesScanned} citing file(s)`,
);
for (const problem of report.problems) {
  console.log(
    `UNCONVERTED [${problem.kind}] ${problem.site}: ${problem.detail}`,
  );
  if (problem.context !== "") {
    console.log(`    ${problem.context}`);
  }
}
console.log(`unconverted: ${report.problems.length}`);

process.exit(report.problems.length === 0 ? 0 : 1);
