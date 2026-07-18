// OpenLogo language coverage report — discovers conformance fixtures and reports which are present.
// This is LANGUAGE coverage (every grammar production/variant is proven by a fixture), distinct
// from LINE coverage (every TS line is hit by a test).
//
// Usage: node scripts/coverage-report.mjs
// Exits 0 (report only, no enforcement yet). As S3-S22 stories land, fixtures will declare their
// story/row metadata and this report will compute coverage from discovered fixtures.

import { existsSync, readdirSync } from "node:fs";
import { basename, sep } from "node:path";

const ROOT = "tests/conformance";
const EXPECTED_SUFFIX = ".expected.json";

/** Discover fixture stems under tests/conformance/, excluding _harness-selftest/. */
function discoverFixtures() {
  if (!existsSync(ROOT)) {
    return [];
  }
  const stems = new Set();
  for (const entry of readdirSync(ROOT, { recursive: true }).map(String)) {
    if (!entry.endsWith(EXPECTED_SUFFIX)) {
      continue;
    }
    // Skip harness self-tests
    if (entry.startsWith("_harness-selftest")) {
      continue;
    }
    // Group by profile directory (e.g., "core-language")
    const parts = entry.split(sep);
    const profile = parts[0];
    const stem = basename(entry).slice(0, -EXPECTED_SUFFIX.length);
    stems.add(`${profile}/${stem}`);
  }
  return Array.from(stems).sort();
}

function main() {
  const fixtures = discoverFixtures();

  console.log("Language Coverage Report");
  console.log("========================\n");
  console.log(`Discovered ${fixtures.length} conformance fixture(s):\n`);

  if (fixtures.length === 0) {
    console.log("  (none)\n");
  } else {
    for (const fixture of fixtures) {
      console.log(`  ✓ ${fixture}`);
    }
    console.log("");
  }

  console.log(
    "Note: As S3-S22 production stories land, fixtures will declare story/row metadata",
  );
  console.log(
    "and this report will compute grammar coverage. For M1 (harness infra only),",
  );
  console.log("we report fixtures present without mapping to production rows.");

  return 0;
}

process.exit(main());
