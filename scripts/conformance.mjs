// OpenLogo conformance harness (Definition of Done §4). Loads stack-neutral fixtures under
// tests/conformance/ — each a `.logo` source paired with its expected `events` and
// `diagnostics` (see .github/skills/shared/conformance-fixture/SKILL.md) — runs them headlessly
// by profile along the spec DAG, and exits non-zero on any mismatch. Fixture event `kind`s and
// diagnostic `code`s are validated against the @openlogo/core registries, so a fixture can never
// assert an off-contract shape. See docs/adr/0007-conformance-harness.md.
//
// M1 note: `produce()` now calls the real parser (@openlogo/parser.parse) and collects
// diagnostics. When @openlogo/runtime lands, it will also execute and collect trace events.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join, sep } from "node:path";
import {
  OL_DIAGNOSTIC_CODES,
  OL_EVENT_KINDS,
  OL_STYLE_DIAGNOSTIC_CODES,
} from "@openlogo/core";
import { parse } from "@openlogo/parser";

const ROOT = "tests/conformance";
const EXPECTED_SUFFIX = ".expected.json";

// Profile dependency closure from spec/conformance.md's DAG. Selecting a profile runs that
// profile plus every profile it transitively depends on, so a claim is only exercised when its
// dependencies are too (the spec's "minimal conformance = Core + Turtle & Rendering" rule).
const PROFILE_DEPS = {
  "core-language": [],
  "turtle-rendering": ["core-language"],
  geometry: ["turtle-rendering", "data"],
  sprites: ["turtle-rendering"],
  data: ["core-language"],
  heritage: ["core-language", "data"],
  "interaction-events": ["core-language"],
  sound: ["core-language"],
  modules: ["core-language"],
  localization: ["modules"],
  educational: ["core-language"],
  "tutor-ai": ["educational"],
};

const EVENT_KINDS = new Set(OL_EVENT_KINDS);
const DIAGNOSTIC_CODES = new Set([
  ...OL_DIAGNOSTIC_CODES,
  ...OL_STYLE_DIAGNOSTIC_CODES,
]);

/** Expand a profile to itself plus every transitive dependency; throws on an unknown profile. */
function closureOf(profile) {
  const seen = new Set();
  const stack = [profile];
  while (stack.length > 0) {
    const current = stack.pop();
    if (seen.has(current)) {
      continue;
    }
    seen.add(current);
    const deps = PROFILE_DEPS[current];
    if (deps === undefined) {
      throw new Error(`unknown profile "${current}" (not in the spec DAG)`);
    }
    for (const dep of deps) {
      stack.push(dep);
    }
  }
  return seen;
}

/** Discover every `*.expected.json` fixture under tests/conformance/, sorted by path. */
function discoverFixtures() {
  if (!existsSync(ROOT)) {
    return [];
  }
  const fixtures = [];
  for (const entry of readdirSync(ROOT, { recursive: true }).map(String)) {
    if (!entry.endsWith(EXPECTED_SUFFIX)) {
      continue;
    }
    const expectedPath = join(ROOT, entry);
    const stem = basename(entry).slice(0, -EXPECTED_SUFFIX.length);
    fixtures.push({
      name: entry.split(sep).join("/"),
      expectedPath,
      logoPath: join(dirname(expectedPath), `${stem}.logo`),
    });
  }
  fixtures.sort((a, b) => a.name.localeCompare(b.name));
  return fixtures;
}

/** Parse and normalise a fixture; returns `{ error }` on malformed JSON. */
function loadFixture(fixture) {
  let spec;
  try {
    spec = JSON.parse(readFileSync(fixture.expectedPath, "utf8"));
  } catch (err) {
    return { error: `invalid JSON: ${err.message}` };
  }
  const expected = {
    description: spec.description ?? "",
    profiles: spec.profiles ?? [],
    expect: spec.expect ?? "match",
    events: spec.events ?? [],
    diagnostics: spec.diagnostics ?? [],
  };
  const source = existsSync(fixture.logoPath)
    ? readFileSync(fixture.logoPath, "utf8")
    : "";
  return { expected, source };
}

/** Static checks that a fixture references only registered profiles, event kinds, and codes. */
function fixtureErrors(expected) {
  const errors = [];
  for (const profile of expected.profiles) {
    if (!(profile in PROFILE_DEPS)) {
      errors.push(`profile "${profile}" is not a known OpenLogo profile`);
    }
  }
  for (const event of expected.events) {
    if (!EVENT_KINDS.has(event.kind)) {
      errors.push(
        `event kind "${event.kind}" is not in the @openlogo/core registry`,
      );
    }
  }
  for (const diagnostic of expected.diagnostics) {
    if (!DIAGNOSTIC_CODES.has(diagnostic.code)) {
      errors.push(
        `diagnostic code "${diagnostic.code}" is not in the @openlogo/core registry`,
      );
    }
  }
  return errors;
}

/**
 * Execute source and collect the output. For M1, this calls the parser to collect diagnostics.
 * When the runtime lands, this will also execute and collect trace events.
 *
 * Note: Parser diagnostics already use `source_span` (underscore), which matches the fixture
 * contract per ADR-0007 and tests/conformance/README.md. Events will use `source-span` (hyphen)
 * when the runtime lands. No conversion needed at this stage.
 */
function produce(source, _profiles) {
  const { diagnostics } = parse(source, "conformance-fixture");

  // Parser diagnostics are already in the correct wire format (source_span with underscore).
  // No events yet — runtime doesn't exist at M1.
  return { events: [], diagnostics };
}

/** Order-insensitive structural equality for the plain JSON values in a fixture. */
function deepEqual(a, b) {
  if (a === b) {
    return true;
  }
  if (
    a === null ||
    b === null ||
    typeof a !== "object" ||
    typeof b !== "object"
  ) {
    return false;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
      return false;
    }
    return a.every((value, index) => deepEqual(value, b[index]));
  }
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) {
    return false;
  }
  return keys.every(
    (key) => Object.hasOwn(b, key) && deepEqual(a[key], b[key]),
  );
}

/** Diff two streams element-by-element; return a readable report of the first mismatch, or null. */
function diffStream(label, keyField, expected, actual) {
  const count = Math.max(expected.length, actual.length);
  for (let index = 0; index < count; index++) {
    const expectedItem = expected[index];
    const actualItem = actual[index];
    if (deepEqual(expectedItem, actualItem)) {
      continue;
    }
    const key = expectedItem?.[keyField] ?? actualItem?.[keyField] ?? index;
    return [
      `  ${label} mismatch at ${keyField}=${JSON.stringify(key)} (index ${index}):`,
      `    expected: ${expectedItem === undefined ? "(missing)" : JSON.stringify(expectedItem)}`,
      `    actual:   ${actualItem === undefined ? "(missing)" : JSON.stringify(actualItem)}`,
    ].join("\n");
  }
  return null;
}

/** Compare produced output against expected; `matched` is true when both streams agree. */
function compare(expected, actual) {
  const reports = [
    diffStream("event", "seq", expected.events, actual.events),
    diffStream("diagnostic", "code", expected.diagnostics, actual.diagnostics),
  ].filter((report) => report !== null);
  return { matched: reports.length === 0, report: reports.join("\n") };
}

function parseArgs(argv) {
  let profile;
  for (const arg of argv) {
    if (arg.startsWith("--profile=")) {
      profile = arg.slice("--profile=".length);
    }
  }
  const flagIndex = argv.indexOf("--profile");
  if (flagIndex !== -1 && flagIndex + 1 < argv.length) {
    profile = argv[flagIndex + 1];
  }
  return { profile };
}

function main() {
  const { profile } = parseArgs(process.argv.slice(2));
  let selection;
  if (profile !== undefined) {
    try {
      selection = closureOf(profile);
    } catch (err) {
      console.error(`conformance: ${err.message}`);
      process.exit(2);
    }
  }

  const fixtures = discoverFixtures();
  if (fixtures.length === 0) {
    console.log(
      "conformance: no fixtures found under tests/conformance/ — nothing to run.",
    );
    process.exit(0);
  }

  let passed = 0;
  let failed = 0;
  let skipped = 0;
  const failures = [];

  for (const fixture of fixtures) {
    const loaded = loadFixture(fixture);
    if (loaded.error !== undefined) {
      failed++;
      failures.push(`FAIL ${fixture.name}\n  ${loaded.error}`);
      continue;
    }

    const { expected, source } = loaded;
    const isSelfTest = expected.expect === "mismatch";

    // Normal fixtures run only when their profile falls inside the selected closure; harness
    // self-tests validate the runner itself, so they always run.
    if (selection !== undefined && !isSelfTest) {
      if (!expected.profiles.some((candidate) => selection.has(candidate))) {
        skipped++;
        continue;
      }
    }

    const errors = fixtureErrors(expected);
    if (errors.length > 0) {
      failed++;
      failures.push(
        `FAIL ${fixture.name} (off-contract fixture)\n${errors.map((e) => `  ${e}`).join("\n")}`,
      );
      continue;
    }

    const result = compare(expected, produce(source, expected.profiles));

    if (isSelfTest) {
      if (result.matched) {
        failed++;
        failures.push(
          `FAIL ${fixture.name} (self-test expected a mismatch but the produced stream matched)`,
        );
      } else {
        passed++;
        console.log(
          `ok   ${fixture.name} — self-test: mismatch correctly detected`,
        );
        console.log(result.report);
      }
    } else if (result.matched) {
      passed++;
      console.log(`ok   ${fixture.name}`);
    } else {
      failed++;
      failures.push(`FAIL ${fixture.name}\n${result.report}`);
    }
  }

  const scope = profile === undefined ? "full DAG" : `profile "${profile}"`;
  console.log(
    `\nconformance: ${passed} passed, ${failed} failed, ${skipped} skipped (${scope})`,
  );
  if (failures.length > 0) {
    console.error(`\n${failures.join("\n\n")}`);
    process.exit(1);
  }
  process.exit(0);
}

main();
